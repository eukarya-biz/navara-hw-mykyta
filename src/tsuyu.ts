import {
  Color,
  degreeToRadian,
  eastNorthUpToFixedFrame,
  geodeticToVector3,
} from "@navaramap/three";
import type ThreeView from "@navaramap/three";
import type {
  ArclineMeshConfig,
  ArclineMeshDesc,
} from "@navaramap/three-default-descs";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";

import {
  registerBlossomMesh,
  type BlossomMeshDesc,
  type BlossomsMeshConfig,
  type PlacedStation,
} from "./blossoms";
import { GRID, chain, distanceKm, gridCells, latitudeByDay } from "./front";
import { GLOW_ID } from "./glow";
import { phase, sampleRamp, type FrontStyle, type Mode } from "./modes";
import {
  eventDays,
  type Phenology,
  type SeasonIndex,
  type Station,
  type StationProperties,
} from "./phenology";

const TAU = Math.PI * 2;

/* ----------------------------------------------------------------- the data */

/**
 * One 地方.
 *
 * Structurally a {@link Station}, which is the whole trick: JMA announces 梅雨 for
 * a region rather than a station, but a region still has one date pair at one
 * point, so `eventDays` and `phase` take it unchanged and nothing about the
 * seasonal machinery had to learn a second shape.
 */
export type TsuyuRegion = Station & {
  code: string;
  id: string;
  name: string;
  nameEn: string;
  /** The observation stations inside this region, resolved from phenology. */
  members: Station[];
};

export type Tsuyu = SeasonIndex & {
  regions: TsuyuRegion[];
  /**
   * Stations belonging to no 梅雨 region — the sixteen in Hokkaido.
   *
   * A value rather than a comment, because 北海道に梅雨はない is the finding this
   * whole mode exists to land, and it should be checkable at runtime and not only
   * in the build script.
   */
  withoutTsuyu: Station[];
};

/**
 * Loads the twelve regional 梅雨 windows.
 *
 * Takes the {@link Phenology} rather than owning a clock of its own: two clocks
 * is exactly the divergence the comment in phenology.ts warns about, and main.ts
 * already advances the one clock for everything on screen.
 */
export async function loadTsuyu(phenology: Phenology): Promise<Tsuyu> {
  const collection = await (await fetch("data/tsuyu.geojson")).json();

  const byName = new Map(
    phenology.stations.map((station) => [station.properties.name, station]),
  );
  const claimed = new Set<Station>();

  const regions: TsuyuRegion[] = collection.features.map(
    (feature: {
      geometry: { coordinates: [number, number] };
      properties: StationProperties & { stations: string[] };
    }) => {
      const properties = feature.properties;
      const members = properties.stations.map((name) => {
        const station = byName.get(name);
        // The build asserts this join, so a failure here means the two committed
        // files have drifted apart — worth stopping for rather than rendering a
        // region that is quietly missing half its stations.
        if (!station) {
          throw new Error(`tsuyu.geojson names unknown station ${name}`);
        }
        claimed.add(station);
        return station;
      });

      return {
        lng: feature.geometry.coordinates[0],
        lat: feature.geometry.coordinates[1],
        alt: typeof properties.alt === "number" ? properties.alt : 0,
        properties,
        code: String(properties.code),
        id: String(properties.id),
        name: String(properties.name),
        nameEn: String(properties.nameEn),
        members,
      };
    },
  );

  const withoutTsuyu = phenology.stations.filter(
    (station) => !claimed.has(station),
  );

  const profileCache = new Map<string, number[]>();
  const activeOn = (mode: Mode, day: number) => {
    let n = 0;
    for (const region of regions) {
      const days = eventDays(region.properties, mode);
      if (days && phase(mode, day, days.start, days.peak, days.end)) n += 1;
    }
    return n;
  };

  return {
    regions,
    withoutTsuyu,
    activeCount: (mode) => activeOn(mode, phenology.day),
    totalCount: (mode) =>
      regions.filter((region) => eventDays(region.properties, mode)).length,
    profile(mode) {
      const cached = profileCache.get(mode.id);
      if (cached) return cached;
      const series = Array.from({ length: 366 }, (_, index) =>
        activeOn(mode, index),
      );
      profileCache.set(mode.id, series);
      return series;
    },
  };
}

/* ------------------------------------------------------------------ the deck */

type DeckCell = PlacedStation & {
  /** Window edges for this cell's region, already offset by its own jitter. */
  start: number;
  end: number;
  peak: number;
};

/**
 * Places one puff.
 *
 * Mirrors `place` in blossoms.ts, including the two things that are not
 * obvious there: each cell owns its own `Matrix4`, because `replaceAll` stores
 * child configs by reference and a shared scratch matrix would alias across every
 * instance; and the composition is pre-multiplied into that matrix, because
 * `composeInstanceMatrix` returns it verbatim once set.
 */
function placeCell(
  lng: number,
  lat: number,
  height: number,
  index: number,
  window: { start: number; end: number; peak: number },
): DeckCell {
  const origin = geodeticToVector3({
    lng: degreeToRadian(lng),
    lat: degreeToRadian(lat),
    height,
  });
  const frame = eastNorthUpToFixedFrame(origin);

  const matrix = new Matrix4();
  const local = new Matrix4();
  const offset = new Vector3();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3();

  const cell: DeckCell = {
    child: { matrix, color: new Color() },
    days: { start: window.start, peak: window.peak, end: window.end },
    start: window.start,
    end: window.end,
    peak: window.peak,
    radius: 0,
    seed: (index * 0.618033988749895) % 1,
    compose(time) {
      const { seed, radius } = cell;
      // Cloud mass churns rather than travels: a monotone drift would have to wrap
      // and pop, and at 15 days per second of timeline nothing reads as motion
      // anyway except the shape changing. Three different periods so neighbours
      // never pulse together.
      const churn = 1 + 0.1 * Math.sin(time * 0.00008 + seed * 6.3);
      const driftE = 0.3 * radius * Math.sin(time * 0.00005 + seed * 4.1);
      const driftN = 0.2 * radius * Math.cos(time * 0.00004 + seed * 2.3);
      offset.set(driftE, driftN, 0);
      // Flat to the sky, turned to its own fixed angle. No wobble: a cloud has no
      // blades to catch the sun at a changing angle, and 350 of them tilting in
      // unison would read as a shimmer.
      quaternion.setFromEuler(euler.set(0, 0, seed * TAU));
      local.compose(offset, quaternion, scale.setScalar(radius * churn));
      matrix.multiplyMatrices(frame, local);
    },
  };
  return cell;
}

/* ------------------------------------------------------------------- wiring */

export type TsuyuHandle = {
  /** Pushes the seasonal state for a day; safe to call every frame. */
  setDay(day: number, visible: boolean): void;
};

type TsuyuView = ThreeView<{ mesh: BlossomsMeshConfig | ArclineMeshConfig }>;

function frontConfig(style: FrontStyle, height: number, lat: number) {
  return {
    geometry: chain(lat),
    // 8 instances x 12 samples: enough that the bow reads as a curve rather than
    // a chain of straight chords, and the geodesic interpolation keeps it on the
    // ellipsoid across the full 2,000 km span.
    segments: 12,
    thickness: style.thickness,
    transparent: true,
    opacity: style.opacity,
    srcColor: new Color().setStyle(style.fromColor),
    tgtColor: new Color().setStyle(style.toColor),
    // Straight geodesic. The default 0.3 would bow the line up out of the
    // atmosphere over a span this long.
    arcHeightScale: 0,
    height,
    dashed: style.dash !== undefined,
    dashSize: style.dash?.size ?? 1,
    gapSize: style.dash?.gap ?? 1,
  };
}

/**
 * Adds the 梅雨 cloud deck and its two 前線 lines.
 *
 * The deck rides the same `blossoms` descriptor as the flora: it needs a shape, an
 * emissive and a list of per-instance matrices and colours, which is all that
 * descriptor ever wanted.
 */
export function addTsuyu(
  view: TsuyuView,
  { mode, tsuyu }: { mode: Mode; tsuyu: Tsuyu },
): TsuyuHandle {
  const style = mode.tsuyu;
  if (!style) throw new Error(`Mode ${mode.id} has no 梅雨 style`);

  /* --- the deck ---------------------------------------------------------- */

  registerBlossomMesh(view);

  // Every station that has a 梅雨 date, with the region it belongs to. Nearest
  // *station* rather than nearest region anchor, so the grid inherits the exact
  // 地方 partition the build asserted: cells around 下関 land in 九州北部 and not
  // in 中国, which is right and which no distance-to-anchor rule would get.
  const anchors = tsuyu.regions.flatMap((region) =>
    region.members.map((station) => ({ station, region })),
  );

  const cells: DeckCell[] = [];
  let index = 0;
  for (const { lng, lat } of gridCells()) {
    let nearest = anchors[0];
    let best = Infinity;
    for (const candidate of anchors) {
      const d = distanceKm(lng, lat, candidate.station.lng, candidate.station.lat);
      if (d < best) {
        best = d;
        nearest = candidate;
      }
    }
    if (best > GRID.reachKm) continue;

    // Counted only over cells that survived the land test, so the coverage
    // pattern is stable against the grid extents changing.
    const cellIndex = index;
    index += 1;
    // A second irrational so coverage and animation do not correlate — sharing
    // one hash would drop every cell that also happens to churn in phase.
    const cover = (cellIndex * 0.7548776662466927) % 1;
    if (cover >= style.coverage) continue;

    const days = eventDays(nearest.region.properties, mode);
    if (days?.end === undefined) continue;
    // The whole window slides together, so a cell arrives and leaves a day or two
    // off its neighbours and the deck knits itself in rather than appearing as a
    // field of growing discs.
    const jitter =
      (((cellIndex * 0.618033988749895) % 1) - 0.5) * 2 * style.jitterDays;
    cells.push(
      placeCell(lng, lat, style.deckHeight, cellIndex, {
        start: days.start + jitter,
        peak: days.peak + jitter,
        end: days.end + jitter,
      }),
    );
  }

  // Constructed at full radius so the instance capacity is pinned at the real
  // maximum and replaceAll never reallocates — same reasoning as blossoms.ts.
  for (const cell of cells) {
    cell.radius = style.maxRadius;
    cell.compose(0);
  }

  const deck = view.addMesh<BlossomMeshDesc>({
    blossoms: {
      shape: { kind: "puff", lobes: 5, crownTint: [1, 0.99, 0.96] },
      emissiveIntensity: style.deckEmissiveIntensity,
      effectIds: [GLOW_ID],
      children: cells.map((cell) => cell.child),
    },
  });
  deck.ref.setStations(cells);

  /* --- the two lines ----------------------------------------------------- */

  const onsetLat = latitudeByDay(
    tsuyu.regions.map((region) => ({
      day: Number(region.properties[mode.startKey]),
      lat: region.lat,
    })),
  );
  const withdrawalLat = latitudeByDay(
    tsuyu.regions.map((region) => ({
      day: Number(region.properties[mode.endKey!]),
      lat: region.lat,
    })),
  );

  const lines = ([
    ["onset", style.onset, onsetLat],
    ["withdrawal", style.withdrawal, withdrawalLat],
  ] as const).map(([name, front, latOf]) => {
    const handle = view.addMesh<ArclineMeshDesc>({
      arcLines: frontConfig(front, style.frontHeight, GRID.lat.from),
      emissiveColor: new Color().setStyle(front.emissive),
      emissiveIntensity: front.emissiveIntensity,
      effectIds: [GLOW_ID],
    });

    const root = handle.ref.raw;
    if (root) {
      // ArcLine computes its bounding sphere once, on rebuild, and then stubs out
      // computeBoundingSphere entirely — so the bounds stay at the latitude the
      // line was born at and it is culled the moment it migrates away from it.
      // Two sub-meshes' worth of draw call is not worth culling anyway.
      for (const child of root.children) child.frustumCulled = false;
    }
    // uViewport initialises to a hard-coded 1920x1080 and is only corrected on
    // resize, and thickness is in pixels, so without this the line is the wrong
    // width until someone drags the window.
    handle.ref.onResize(window.innerWidth, window.innerHeight);

    return { name, front, latOf, handle, root };
  });

  /* --- per-day state ---------------------------------------------------- */

  return {
    setDay(day, visible) {
      for (const cell of cells) {
        const state = visible
          ? phase(mode, day, cell.start, cell.peak, cell.end)
          : null;
        if (!state) {
          cell.radius = 0;
          continue;
        }
        cell.radius =
          style.minRadius + (style.maxRadius - style.minRadius) * state.intensity;
        // The deck's own ramp, not `mode.ramp`. The pill and the graph are DOM and
        // get no aerial-perspective inscatter, so they can be rain-blue; the deck
        // is in the world, where an additive pale blue is laid over everything and
        // only luminance and warmth survive it. Same phenomenon, two palettes.
        cell.child.color!.setHex(sampleRamp(style.deckRamp, state.progress));
      }

      for (const line of lines) {
        const lat = visible ? line.latOf(day) : null;
        // Hidden by visibility rather than by emptying `geometry`: a length change
        // triggers a full rebuild, and toggling that every frame would rebuild the
        // instanced geometry continuously.
        if (line.root) line.root.visible = lat !== null;
        if (lat === null) continue;

        line.handle.update({
          arcLines: {
            // Fresh points every frame — see `chain`.
            geometry: chain(lat),
            ...(line.front.dash
              ? { dashOffset: day * line.front.dash.metresPerSecond }
              : {}),
          },
        });
      }
    },
  };
}
