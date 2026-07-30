import { degreeToRadian, geodeticToVector3 } from "@navaramap/three";
import {
  CanvasTexture,
  LinearFilter,
  NoColorSpace,
  RepeatWrapping,
} from "three";

/**
 * The 梅雨 weather map: geography → cloud-coverage texture.
 *
 * The volumetric cloud effect decides where cloud exists by sampling a "local
 * weather" texture — by default a tiling noise PNG, which is why its coverage is
 * statistical and global. This module replaces that texture with a canvas we
 * repaint as the season advances, so the deck exists exactly over the regions
 * currently inside 梅雨 and nowhere else.
 *
 * Split from tsuyu.ts for the same reason front.ts was: everything here is
 * arithmetic over the data — a projection, a grid and a canvas — checkable
 * without a globe, a WASM core or a GL context.
 */

const KM_PER_DEGREE = 111.32;

/** Equirectangular distance in km — ample at this scale, and cheap. */
export function distanceKm(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
) {
  const mid = ((aLat + bLat) / 2) * (Math.PI / 180);
  return Math.hypot(
    (aLng - bLng) * Math.cos(mid) * KM_PER_DEGREE,
    (aLat - bLat) * KM_PER_DEGREE,
  );
}

/**
 * Extent of the paint grid, in degrees.
 *
 * Wider than the old cloud grid on every side: the stations are the land mask
 * (see `reachKm` in modes.ts), so a generous margin costs only a few rejected
 * candidates, while a tight one would clip 沖縄 and 奄美 — which the old deck
 * never carried, and which are exactly where 梅雨 begins.
 */
const EXTENT = {
  lat: { from: 24.0, to: 42.0 },
  lng: { from: 127.0, to: 147.0 },
};

/**
 * How the shader's globe → texture mapping is configured.
 *
 * The cloud shader's default mapping (`getCubeSphereUv`) repeats the texture on
 * every cube face, and for this camera two of the copies land in frame: paint
 * over western Japan re-emerges as phantom cloud in the Sea of Japan, and paint
 * over Tohoku re-emerges over the Pacific south of Honshu. tsuyu.ts therefore
 * patches the material over to the shader's other mapping, `getSphericalUv` —
 * plain equirectangular over geocentric lng/lat, which visits every texel
 * exactly once per repeat tile.
 *
 * The repeat then tiles the map 3×3 over the globe (one tile = 120° × 60°), so
 * the nearest repeated copy of Japan sits 120° of longitude away — the far side
 * of the horizon — while the texture still resolves ~11 km per texel here. The
 * v-offset re-centres the tile so Japan's latitudes sit inside one tile rather
 * than across a wrap seam. (Offset length also feeds the shader's shape
 * "evolution" term, shifting shape-noise sampling by ~3 km — invisible under
 * 170 km noise tiles.)
 */
export const WEATHER_REPEAT = { x: 3, y: 3 };
export const WEATHER_OFFSET = { x: 0, y: 0.15 };

/** Geocentric equirectangular uv (`getSphericalUv`), with repeat and offset
 *  folded in so the result is a texel position in the repeat-wrapped canvas. */
function weatherTexel(n: { x: number; y: number; z: number }): {
  u: number;
  v: number;
} {
  const lng = Math.atan2(n.y, n.x);
  const lat = Math.asin(n.z);
  const u = (lng / (2 * Math.PI) + 0.5) * WEATHER_REPEAT.x + WEATHER_OFFSET.x;
  const v = (lat / Math.PI + 0.5) * WEATHER_REPEAT.y + WEATHER_OFFSET.y;
  return { u: u - Math.floor(u), v: v - Math.floor(v) };
}

/** A station that pulls nearby grid points into its region's window. */
export type WeatherAnchor = {
  lng: number;
  lat: number;
  /** Index into the per-region intensity array handed to `paint`. */
  region: number;
};

export type PaintPoint = {
  /** Texel coordinates in the size×size canvas. */
  x: number;
  y: number;
  region: number;
  /** Shore falloff × per-point break-up, folded into one multiplier. */
  alpha: number;
};

/**
 * Builds the set of paintable points, once at init.
 *
 * A dense geographic grid rather than one shape per region, because the
 * nearest-*station* rule is what gives the deck a coastline without loading
 * one — the 86 anchor stations trace the archipelago closely enough that a
 * `reachKm` cutoff is a land mask. Nearest station rather than nearest region
 * anchor so the grid inherits the exact 地方 partition the build asserted.
 */
export function buildPaintGrid(
  anchors: WeatherAnchor[],
  options: { size: number; stepDeg: number; reachKm: number },
): PaintPoint[] {
  const { size, stepDeg, reachKm } = options;
  const points: PaintPoint[] = [];

  // Stepped by count rather than by accumulating the step, so floating-point
  // drift cannot drop or add a final row — same reasoning as the old gridCells.
  const rows = Math.floor((EXTENT.lat.to - EXTENT.lat.from) / stepDeg);
  const cols = Math.floor((EXTENT.lng.to - EXTENT.lng.from) / stepDeg);

  let index = 0;
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      const lat = EXTENT.lat.from + r * stepDeg;
      const lng = EXTENT.lng.from + c * stepDeg;

      let region = -1;
      let best = Infinity;
      for (const anchor of anchors) {
        const d = distanceKm(lng, lat, anchor.lng, anchor.lat);
        if (d < best) {
          best = d;
          region = anchor.region;
        }
      }
      if (best > reachKm) continue;

      const position = geodeticToVector3({
        lng: degreeToRadian(lng),
        lat: degreeToRadian(lat),
        height: 0,
      });
      const length = Math.hypot(position.x, position.y, position.z);
      const { u, v } = weatherTexel({
        x: position.x / length,
        y: position.y / length,
        z: position.z / length,
      });

      // Shore falloff: full strength inland, easing to nothing at reachKm, so
      // the deck edge is a fade over water rather than a stamp-shaped sawtooth.
      const t = Math.min(Math.max((reachKm - best) / (reachKm - 90), 0), 1);
      const shore = t * t * (3 - 2 * t);
      // Two scales of break-up, so the interior is a field of denser and
      // thinner weather rather than a uniform slab. The coarse term varies over
      // ~1° patches — real rain-band texture at this camera — and the fine term
      // is per-point, the same golden-ratio hash trick the old deck used for
      // coverage. Both reach low enough that the cloud effect's coverage remap
      // keeps genuine holes in the deck.
      const patchSeed =
        Math.floor(lng / 1.1) * 127.1 + Math.floor(lat / 1.1) * 311.7;
      const patch = 0.45 + 0.55 * Math.abs(Math.sin(patchSeed) * 43758.5453 % 1);
      const breakUp = 0.55 + 0.45 * ((index * 0.618033988749895) % 1);
      index += 1;

      points.push({
        // flipY is left at the CanvasTexture default (true), so canvas row 0
        // is v = 1.
        x: u * size,
        y: (1 - v) * size,
        region,
        alpha: shore * patch * breakUp,
      });
    }
  }
  return points;
}

export type WeatherPainter = {
  texture: CanvasTexture;
  /**
   * Repaints the map from one intensity per region (0 = clear of cloud).
   * Cheap enough for its real cadence — a few times per second while the
   * timeline plays — but not free: don't call it per frame.
   */
  paint(intensities: number[]): void;
};

/**
 * The canvas-backed weather texture.
 *
 * Alpha stays 1 everywhere, deliberately. Canvas 2D stores premultiplied
 * colour, and the GPU upload un-premultiplies — so any brightness painted with
 * partial alpha would be distorted on the way in. Instead the canvas starts
 * opaque black and stamps *add* brightness ("lighter" blending) with the
 * stamp's own gradient carrying the falloff: what the shader reads in the red
 * channel is then exactly the sum we painted, clamped at 1.
 */
export function createWeatherPainter(
  points: PaintPoint[],
  options: { size: number; stampTexels: number },
): WeatherPainter {
  const { size, stampTexels } = options;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Pre-rendered stamps at quantised brightness levels, drawn thousands of
  // times under "lighten" (per-channel max). Max rather than sum, because the
  // paint grid's texel spacing varies by cube face — an additive pile-up would
  // saturate unevenly across Japan, while the max of overlapping soft blobs is
  // simply the strongest point's own value everywhere. Opaque and black-rimmed:
  // under a max an opaque black margin changes nothing, which is what lets a
  // square sprite behave as a round soft blob.
  const STAMP = 64;
  const LEVELS = 16;
  const stamps: HTMLCanvasElement[] = [];
  for (let level = 0; level <= LEVELS; level += 1) {
    const stamp = document.createElement("canvas");
    stamp.width = STAMP;
    stamp.height = STAMP;
    const stampCtx = stamp.getContext("2d")!;
    const peak = Math.round((255 * level) / LEVELS);
    const gradient = stampCtx.createRadialGradient(
      STAMP / 2,
      STAMP / 2,
      0,
      STAMP / 2,
      STAMP / 2,
      STAMP / 2,
    );
    gradient.addColorStop(0, `rgb(${peak},${peak},${peak})`);
    gradient.addColorStop(0.5, `rgb(${Math.round(peak * 0.62)},${Math.round(peak * 0.62)},${Math.round(peak * 0.62)})`);
    gradient.addColorStop(1, "rgb(0,0,0)");
    stampCtx.fillStyle = "#000";
    stampCtx.fillRect(0, 0, STAMP, STAMP);
    stampCtx.fillStyle = gradient;
    stampCtx.fillRect(0, 0, STAMP, STAMP);
    stamps.push(stamp);
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // Weather is data, not colour: an sRGB decode would bend every painted
  // value.
  texture.colorSpace = NoColorSpace;
  // No mip pyramid. The shader picks its mip from the screen-space footprint,
  // and at this camera the far, grazing pixels land on mip 4+ — which averages
  // the sparse bright paint into the surrounding black and smears a ghost
  // overcast hundreds of kilometres past the deck's real edge. Level-0
  // sampling (textureLod clamps to what exists) keeps the edge honest, at the
  // cost of a little far-field aliasing a static camera never shows. It also
  // saves regenerating the pyramid on every repaint.
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;

  return {
    texture,
    paint(intensities) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, size, size);

      ctx.globalCompositeOperation = "lighten";
      const d = stampTexels;
      // Scales the whole painting into the lower half of the effect's coverage
      // window: the interior lands in mid-densities — where the shape noise
      // can still carve billows and holes — instead of clamping to a solid
      // slab, and the shore falloff crosses the cloud-free floor early enough
      // to keep a recognisable coastline.
      const AMPLITUDE = 0.8;
      for (const point of points) {
        const a = point.alpha * (intensities[point.region] ?? 0) * AMPLITUDE;
        if (a <= 0.002) continue;
        const stamp = stamps[Math.min(LEVELS, Math.round(a * LEVELS))];
        ctx.drawImage(stamp, point.x - d / 2, point.y - d / 2, d, d);
      }

      texture.needsUpdate = true;
    },
  };
}
