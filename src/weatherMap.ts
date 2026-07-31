import { degreeToRadian, geodeticToVector3 } from "@navaramap/three";
import {
  CanvasTexture,
  LinearFilter,
  NoColorSpace,
  RepeatWrapping,
} from "three";

/**
 * The weather map: geography → cloud-coverage texture.
 *
 * The volumetric cloud effect decides where cloud exists by sampling a "local
 * weather" texture — by default a tiling noise PNG, which is why its coverage is
 * statistical and global. This module replaces that texture with a canvas we
 * repaint as the season advances, so the deck exists exactly over the places
 * currently inside a season and nowhere else.
 *
 * One canvas serves both weather seasons, on separate colour channels, because
 * there is only one cloud pass in the scene to serve — see weather.ts. The
 * channels are independent: the compositing is a per-channel max, so 梅雨's red
 * and 雪's green cannot bleed into each other.
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

/** Bounds of a paint grid, in degrees. */
export type Extent = {
  lat: { from: number; to: number };
  lng: { from: number; to: number };
};

/**
 * 梅雨's extent.
 *
 * Wider than the old cloud grid on every side: the stations are the land mask
 * (see `reachKm` in modes.ts), so a generous margin costs only a few rejected
 * candidates, while a tight one would clip 沖縄 and 奄美 — which the old deck
 * never carried, and which are exactly where 梅雨 begins. It stops short of
 * Hokkaido because the mode does.
 */
export const TSUYU_EXTENT: Extent = {
  lat: { from: 24.0, to: 42.0 },
  lng: { from: 127.0, to: 147.0 },
};

/**
 * 雪's extent.
 *
 * North to 47°N, because 稚内 is at 45.4 and this mode is emphatically about
 * Hokkaido; west to 124°E, because the cloud that matters forms out over the
 * Sea of Japan on the fetch from the continent and the paint has to be able to
 * leave the coast.
 */
export const SNOW_EXTENT: Extent = {
  lat: { from: 25.0, to: 47.0 },
  lng: { from: 124.0, to: 148.0 },
};

/**
 * How the shader's globe → texture mapping is configured.
 *
 * The cloud shader's default mapping (`getCubeSphereUv`) repeats the texture on
 * every cube face, and for this camera two of the copies land in frame: paint
 * over western Japan re-emerges as phantom cloud in the Sea of Japan, and paint
 * over Tohoku re-emerges over the Pacific south of Honshu. weather.ts therefore
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

/**
 * A compass bearing at one latitude, as a rotation in canvas space.
 *
 * The projection is equirectangular, so one degree of latitude is always
 * exactly twice as many texels as one degree of longitude (180° of latitude
 * against 360° of longitude over the same repeat count), and a degree of
 * longitude is only cos(lat) of a degree's ground distance. Both distortions
 * have to be undone or a streak drawn at 135° would point somewhere else on the
 * ground — and by 30° of it at Hokkaido's latitude.
 *
 * `bearing` is degrees clockwise from north, the direction the wind blows
 * *towards*. Canvas y runs opposite to latitude (see the flipY note below),
 * which is why the north component is negated.
 */
function bearingToCanvasAngle(bearing: number, lat: number) {
  const theta = degreeToRadian(bearing);
  const east = Math.sin(theta) / Math.max(Math.cos(degreeToRadian(lat)), 1e-6);
  const north = Math.cos(theta);
  return Math.atan2(-north * WEATHER_REPEAT.y * 2, east * WEATHER_REPEAT.x);
}

/** A station that pulls nearby grid points into its group's window. */
export type WeatherAnchor = {
  lng: number;
  lat: number;
  /** Index into the per-group intensity array handed to `paint`. */
  group: number;
  /**
   * How much weather this anchor is worth, 0..1. 1 for every 梅雨 station — the
   * source announces a 地方 is in 梅雨 and says nothing about how hard it rains.
   * For 雪 it carries 最深積雪, which is what puts a deck over 北陸 and leaves the
   * Pacific coast clear.
   */
  weight?: number;
};

export type PaintPoint = {
  /** Texel coordinates in the size×size canvas. */
  x: number;
  y: number;
  group: number;
  /** Shore falloff × break-up × anchor weight, folded into one multiplier. */
  alpha: number;
  /** Stamp rotation in canvas space, radians; 0 when the style has no bearing. */
  angle: number;
};

export type PaintGridOptions = {
  size: number;
  stepDeg: number;
  reachKm: number;
  /**
   * Width of the fade band at the outer edge of `reachKm`, in km, so the deck
   * edge is a fade over water rather than a stamp-shaped sawtooth.
   */
  shoreKm: number;
  extent: Extent;
  /**
   * Compass bearing to orient stamps along. Omitted for an isotropic deck.
   */
  bearing?: number;
};

/**
 * Builds the set of paintable points, once at init.
 *
 * A dense geographic grid rather than one shape per group, because the
 * nearest-*station* rule is what gives the deck a coastline without loading
 * one — the anchor stations trace the archipelago closely enough that a
 * `reachKm` cutoff is a land mask. Nearest station rather than nearest region
 * anchor so, for 梅雨, the grid inherits the exact 地方 partition the build
 * asserted.
 */
export function buildPaintGrid(
  anchors: WeatherAnchor[],
  options: PaintGridOptions,
): PaintPoint[] {
  const { size, stepDeg, reachKm, shoreKm, extent, bearing } = options;
  const points: PaintPoint[] = [];

  // Stepped by count rather than by accumulating the step, so floating-point
  // drift cannot drop or add a final row — same reasoning as the old gridCells.
  const rows = Math.floor((extent.lat.to - extent.lat.from) / stepDeg);
  const cols = Math.floor((extent.lng.to - extent.lng.from) / stepDeg);

  let index = 0;
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      const lat = extent.lat.from + r * stepDeg;
      const lng = extent.lng.from + c * stepDeg;

      let group = -1;
      let weight = 1;
      let best = Infinity;
      for (const anchor of anchors) {
        const d = distanceKm(lng, lat, anchor.lng, anchor.lat);
        if (d < best) {
          best = d;
          group = anchor.group;
          weight = anchor.weight ?? 1;
        }
      }
      if (best > reachKm) continue;
      // A zero-weight anchor is a station that records a season but no depth —
      // the twenty-two Pacific-coast ones where snow falls and never lies. They
      // still get a crystal, because they still have a season; they get no
      // cloud, which is the whole point of the east/west contrast.
      if (weight <= 0) continue;

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

      // Shore falloff: full strength inland, easing to nothing at reachKm.
      const t = Math.min(
        Math.max((reachKm - best) / Math.max(shoreKm, 1e-6), 0),
        1,
      );
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
        group,
        alpha: shore * patch * breakUp * weight,
        angle: bearing === undefined ? 0 : bearingToCanvasAngle(bearing, lat),
      });
    }
  }
  return points;
}

/**
 * Which colour channel of the shared map a deck reads.
 *
 * Red, green and blue only. Alpha is excluded on purpose: canvas 2D stores
 * premultiplied colour, so painting into alpha would rescale the three channels
 * that carry the actual weather on the way to the GPU. The cloud effect's fourth
 * layer is simply left dead.
 */
export type WeatherChannelName = "r" | "g" | "b";

export type WeatherChannelConfig = {
  channel: WeatherChannelName;
  points: PaintPoint[];
  /** One stamp as `[along, across]` in texels; equal values give a round blob. */
  stampTexels: [number, number];
};

export type WeatherChannel = {
  /**
   * Repaints this channel from one intensity per group (0 = clear of cloud).
   * Cheap enough for its real cadence — a few times per second while the
   * timeline plays — but not free: don't call it per frame.
   */
  paint(intensities: number[]): void;
};

export type WeatherPainter = {
  texture: CanvasTexture;
  addChannel(config: WeatherChannelConfig): WeatherChannel;
};

/**
 * The canvas-backed weather texture.
 *
 * Alpha stays 1 everywhere, deliberately. Canvas 2D stores premultiplied
 * colour, and the GPU upload un-premultiplies — so any brightness painted with
 * partial alpha would be distorted on the way in. Instead the canvas starts
 * opaque black and stamps *add* brightness ("lighten" blending) with the
 * stamp's own gradient carrying the falloff: what the shader reads in a given
 * channel is then exactly the sum we painted, clamped at 1.
 *
 * A repaint of one channel redraws every registered channel, because clearing a
 * single channel of a canvas is not something canvas 2D can do. That is cheaper
 * than it sounds: 梅雨 runs to mid-July and 雪 starts in October, so on any given
 * day at most one channel has a nonzero intensity anywhere and the others exit
 * on their first comparison.
 */
export function createWeatherPainter(options: {
  size: number;
}): WeatherPainter {
  const { size } = options;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Pre-rendered stamps at quantised brightness levels, drawn thousands of
  // times under "lighten" (per-channel max). Max rather than sum, because the
  // paint grid's texel spacing varies with latitude — an additive pile-up would
  // saturate unevenly across Japan, while the max of overlapping soft blobs is
  // simply the strongest point's own value everywhere. Opaque and black-rimmed:
  // under a max an opaque black margin changes nothing, which is what lets a
  // square sprite behave as a round soft blob.
  const STAMP = 64;
  const LEVELS = 16;
  const CHANNEL_MASK: Record<WeatherChannelName, [number, number, number]> = {
    r: [1, 0, 0],
    g: [0, 1, 0],
    b: [0, 0, 1],
  };

  function buildStamps(channel: WeatherChannelName) {
    const mask = CHANNEL_MASK[channel];
    const stamps: HTMLCanvasElement[] = [];
    for (let level = 0; level <= LEVELS; level += 1) {
      const stamp = document.createElement("canvas");
      stamp.width = STAMP;
      stamp.height = STAMP;
      const stampCtx = stamp.getContext("2d")!;
      const peak = Math.round((255 * level) / LEVELS);
      const rgb = (scale: number) =>
        `rgb(${Math.round(peak * scale * mask[0])},` +
        `${Math.round(peak * scale * mask[1])},` +
        `${Math.round(peak * scale * mask[2])})`;
      const gradient = stampCtx.createRadialGradient(
        STAMP / 2,
        STAMP / 2,
        0,
        STAMP / 2,
        STAMP / 2,
        STAMP / 2,
      );
      gradient.addColorStop(0, rgb(1));
      gradient.addColorStop(0.5, rgb(0.62));
      gradient.addColorStop(1, "rgb(0,0,0)");
      stampCtx.fillStyle = "#000";
      stampCtx.fillRect(0, 0, STAMP, STAMP);
      stampCtx.fillStyle = gradient;
      stampCtx.fillRect(0, 0, STAMP, STAMP);
      stamps.push(stamp);
    }
    return stamps;
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

  type Registered = WeatherChannelConfig & {
    stamps: HTMLCanvasElement[];
    intensities: number[];
  };
  const layers: Registered[] = [];

  // Scales the whole painting into the lower half of the effect's coverage
  // window: the interior lands in mid-densities — where the shape noise can
  // still carve billows and holes — instead of clamping to a solid slab, and
  // the shore falloff crosses the cloud-free floor early enough to keep a
  // recognisable coastline.
  const AMPLITUDE = 0.8;

  function repaint() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);

    ctx.globalCompositeOperation = "lighten";
    for (const layer of layers) {
      const [along, across] = layer.stampTexels;
      for (const point of layer.points) {
        const a =
          point.alpha * (layer.intensities[point.group] ?? 0) * AMPLITUDE;
        if (a <= 0.002) continue;
        const stamp = layer.stamps[Math.min(LEVELS, Math.round(a * LEVELS))];
        // Rotation and scale in one transform. For an isotropic deck the angle
        // is zero and `along === across`, which reduces to the plain
        // axis-aligned draw this replaced.
        const cos = Math.cos(point.angle);
        const sin = Math.sin(point.angle);
        ctx.setTransform(cos, sin, -sin, cos, point.x, point.y);
        ctx.drawImage(stamp, -along / 2, -across / 2, along, across);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    texture.needsUpdate = true;
  }

  return {
    texture,
    addChannel(config) {
      if (layers.some((layer) => layer.channel === config.channel)) {
        throw new Error(`weather channel ${config.channel} is already taken`);
      }
      const layer: Registered = {
        ...config,
        stamps: buildStamps(config.channel),
        intensities: [],
      };
      layers.push(layer);
      return {
        paint(intensities) {
          layer.intensities = intensities;
          repaint();
        },
      };
    },
  };
}
