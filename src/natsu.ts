import { Color } from "@navaramap/three";
import type ThreeView from "@navaramap/three";
import type { DefaultDescriptions } from "@navaramap/three-default-plugin";

import { MONTH_STARTS, phase, sampleRamp, type Mode } from "./modes";
import {
  eventDays,
  type SeasonIndex,
  type Station,
  type StationProperties,
} from "./phenology";

/* ----------------------------------------------------------------- the data */

export type Natsu = SeasonIndex & {
  /**
   * The 101 気象官署 whose 日最高気温 curve reaches 30 °C.
   *
   * The same roster 雪 is read at — both come out of the 平年値 archive's surface
   * station index — but a different subset of it, and the two barely intersect:
   * everything in Hokkaido has a 雪 season and no 猛暑, and the Ryukyus have the
   * reverse. Its own index rather than a column on snow.geojson, because the two
   * are separate builds of separate elements and a shared file would make one
   * mode's parse a reason to regenerate the other's.
   */
  stations: Station[];
  /**
   * The painted field's grid, handed straight to a `geojson` source.
   *
   * A second file rather than more properties on the first, because they are
   * different *kinds* of thing and conflating them would be the lie: heat.geojson
   * is 101 measurements at 101 places, and this is an interpolation over a grid
   * that measures nothing. Keeping them apart is what lets the caveat sit on one
   * and not the other.
   */
  field: unknown;
  /** Current day-of-year, fractional, set from main.ts's one clock. */
  readonly day: number;
  setDay(day: number): void;
  /**
   * The fifty-six stations that never reach 30 °C — all of Hokkaido, the Tohoku
   * coast, the high ground, and the capes and small islands the sea holds down.
   *
   * A value rather than a comment, for the same reason `Snow.withoutSnow` is:
   * it is half of what the mode has to say and it should be checkable at
   * runtime. Names rather than stations, because having no season is exactly
   * what keeps them out of the dataset.
   */
  withoutHeat: string[];
};

export async function loadNatsu(): Promise<Natsu> {
  // Both at once: the field is ~600 kB and the stations are ~50, and serialising
  // the two fetches would put the larger one behind the smaller for no reason.
  const [collection, field] = await Promise.all([
    fetch("data/heat.geojson").then((r) => r.json()),
    fetch("data/heat-field.geojson").then((r) => r.json()),
  ]);

  const stations: Station[] = collection.features.map(
    (feature: {
      geometry: { coordinates: [number, number] };
      properties: StationProperties;
    }) => ({
      lng: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
      alt:
        typeof feature.properties.alt === "number" ? feature.properties.alt : 0,
      properties: feature.properties,
    }),
  );

  const withoutHeat: string[] = collection.metadata?.stationsWithoutHeat ?? [];
  if (withoutHeat.length === 0) {
    throw new Error(
      "heat.geojson lists no stations without a 真夏日 season; 北海道に真夏日はない " +
        "is half the mode",
    );
  }

  const profileCache = new Map<string, number[]>();
  const activeOn = (mode: Mode, day: number) => {
    let n = 0;
    for (const station of stations) {
      const days = eventDays(station.properties, mode);
      if (days && phase(mode, day, days.start, days.peak, days.end)) n += 1;
    }
    return n;
  };

  let day = 1;

  return {
    stations,
    field,
    withoutHeat,
    get day() {
      return day;
    },
    setDay(next) {
      day = next;
    },
    activeCount: (mode) => activeOn(mode, day),
    totalCount: (mode) =>
      stations.filter((station) => eventDays(station.properties, mode)).length,
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

/* ------------------------------------------------------------------- wiring */

export type NatsuHandle = {
  /** Pushes the seasonal state for a day; safe to call every frame. */
  setDay(day: number, visible: boolean): void;
};

/**
 * Adds the 猛暑 field: the 真夏日 footprint painted on the ground.
 *
 * One layer, and it took three tries to get there. It began as a full-frame warm
 * colour grade, which could speak about the whole country at once and was too
 * subtle to notice. Then 入道雲 on the shared cloud pass were added under it —
 * physically the right thing to draw, since heat over land is what makes the
 * towers — and they were the opposite problem: from 1,600 km straight down a
 * convective tower reads as a flat grey blob, and a field of them sat on top of
 * the one layer that was doing the explaining.
 *
 * So both are gone and this is the whole mode: where the country is at or above
 * 30 °C today, and how far above. It is the only mode drawn as a painted area
 * rather than as markers or cloud, which is right — heat has no shape of its own
 * at this scale, and a temperature is a property of *everywhere*, not of the 101
 * points that happen to measure it.
 */
export function addNatsu(
  view: ThreeView<DefaultDescriptions>,
  { mode, natsu }: { mode: Mode; natsu: Natsu },
): NatsuHandle {
  const style = mode.natsu;
  if (!style) throw new Error(`Mode ${mode.id} has no 猛暑 style`);

  /* --- the field ---------------------------------------------------------- */

  const source = view.addSource({
    type: "geojson",
    data: natsu.field,
    // ~2,000 cells is past the point where a flat feature list is the right
    // shape; the spatial index is what keeps the evaluator working on the tiles
    // in view instead of the whole country every repaint.
    tiled: true,
  });

  const fieldLayer = view.addLayer({
    type: "vector",
    source,
    polygon: {
      // Clamped, and it has to be — for two reasons, only one of which is
      // obvious.
      //
      // The obvious one: the cells are 2D geometry at ellipsoid height 0 and the
      // terrain is exaggerated 1.3× on top of that, so unclamped they are buried
      // inside the landmass exactly the way stations.ts documents for its points.
      //
      // The one that cost a detour: a constant `height` puts the field at an
      // altitude, and an altitude has a place in the depth order. Lifted to 5 km
      // to clear the exaggerated Alps, the sheet sat *above* both cloud decks —
      // 雪's base is 900 m and 梅雨's is 2,000 — so a map of ground temperature
      // rendered on top of the cloud tops. There is no height that is both above
      // the terrain and below the weather, because the terrain goes higher than
      // the cloud bases do. Clamping is the only way to be on the ground, and
      // being on the ground is the only way the clouds occlude it correctly.
      clampToGround: true,
      // Tiled with the source, or only the first tile's geometry is built.
      tiled: true,
      // Set per feature by the evaluator below; this is only the value a cell
      // has before its first evaluation.
      color: new Color().setStyle(style.field.ramp[0]),
      opacity: style.field.opacity,
      // Off explicitly. An outline on an 11 km cell would draw the grid rather
      // than the field, and the grid is an artefact of how this was computed,
      // not something the data has to say.
      outline: false,
      // No shadow either way: the field is a reading of the ground, not a thing
      // standing on it, and an 11 km cell casting a shadow would be nonsense.
      castShadow: false,
      receiveShadow: false,
      // Deliberately *not* in the bloom slot. The markers glow because they are
      // objects with light in them; a temperature field that bloomed would wash
      // the coastline out from under itself, which is the one thing it must not
      // do.
    },
  });

  /**
   * The annual curve at one cell, in °C on `day`.
   *
   * A duplicate of `curveAt` in scripts/build-heat.mjs, and duplicated for the
   * same reason MONTH_STARTS is: `tsconfig.json` has `include: ["src"]` and the
   * build scripts are plain .mjs, so sharing across that boundary needs a loader
   * and is not worth it for twenty lines. **If the interpolation there changes,
   * this has to change with it** — the build derives each cell's window from that
   * curve and this colours the cell inside it, so a divergence would show as
   * cells painted a temperature their own window disagrees with.
   */
  const ANCHORS = MONTH_STARTS.map((start) => start + 15);
  const curveAt = (kion: number[], day: number) => {
    const n = ANCHORS.length;
    let i = n - 1;
    for (let k = 0; k < n; k += 1) if (ANCHORS[k] <= day) i = k;
    if (day < ANCHORS[0]) i = n - 1;
    const x0 = ANCHORS[i];
    let x1 = ANCHORS[(i + 1) % n];
    if (x1 <= x0) x1 += 365;
    const u = ((day >= x0 ? day : day + 365) - x0) / (x1 - x0);
    // Stored in tenths, as integers — see build-heat.mjs.
    const p0 = kion[(i - 1 + n) % n] / 10;
    const p1 = kion[i % n] / 10;
    const p2 = kion[(i + 1) % n] / 10;
    const p3 = kion[(i + 2) % n] / 10;
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * u +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
        (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
    );
  };

  const fieldColor = new Color();
  let fieldDay = 1;
  let fieldVisible = true;

  fieldLayer.on("featureUpdated", ({ evaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        if (!fieldVisible || !properties) return { show: false };
        const kion = properties.kion as number[] | undefined;
        const start = properties.natsuKaishi as number | undefined;
        const end = properties.natsuOwari as number | undefined;
        if (!kion || start === undefined || end === undefined) {
          return { show: false };
        }
        if (fieldDay < start || fieldDay > end) return { show: false };

        const celsius = curveAt(kion, fieldDay);
        // The curve can dip a hair under the threshold at the very edge of the
        // window, because the window is found at whole-day resolution and this
        // is evaluated at the fractional clock. Clamp rather than hide, or cells
        // flicker off for a frame on their first and last day.
        const t = Math.min(
          Math.max(
            (celsius - style.field.from) / (style.field.to - style.field.from),
            0,
          ),
          1,
        );
        // Fade at both edges of the cell's own window, so the footprint grows
        // and retreats instead of switching on in slabs.
        const edge = Math.min(
          1,
          (fieldDay - start) / style.field.edgeDays,
          (end - fieldDay) / style.field.edgeDays,
        );
        return {
          show: true,
          color: fieldColor.setHex(sampleRamp(style.field.ramp, t)),
          opacity: style.field.opacity * Math.max(edge, 0),
        };
      },
      { filters: ["kion", "natsuKaishi", "natsuOwari"] },
    );
  });

  /* --- per-day state ------------------------------------------------------ */

  let lastQuantized = Number.NaN;
  let lastVisible: boolean | undefined;

  const handle: NatsuHandle = {
    setDay(day, visible) {
      // Half-day steps, for the same reason the two weather seasons use them:
      // the dates move day by day and re-evaluating two thousand cells every
      // frame would be waste. The cells carry their own twelve monthly values,
      // so the temperature the evaluator reads is continuous in `day` — the
      // quantisation costs nothing but the redundant work.
      const quantized = Math.round(day * 2) / 2;
      if (quantized === lastQuantized && visible === lastVisible) return;
      lastQuantized = quantized;
      lastVisible = visible;

      fieldDay = quantized;
      fieldVisible = visible;
      fieldLayer.forceUpdate();
    },
  };

  // Untyped on purpose, same as the other seasons': these are the levers worth
  // reaching for from the console while tuning.
  return Object.assign(handle, { debug: { fieldLayer, source } });
}
