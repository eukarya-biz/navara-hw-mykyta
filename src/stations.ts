import { Color } from "@navaramap/three";
import type ThreeView from "@navaramap/three";
import { MODES, phase, sampleRamp, type Mode } from "./modes";

export type StationProperties = Record<string, number | string | undefined>;

export type StationLayers = {
  setDay(day: number): void;
  setSelected(selected: Set<string>): void;
  /** Stations inside their active window on the current day, for one mode. */
  activeCount(mode: Mode): number;
  /** Stations that have data for a mode at all. */
  totalCount(mode: Mode): number;
  /** Active count per day-of-year, for the timeline graph. */
  profile(mode: Mode): number[];
};

/**
 * Sprite-anchor nudges, in fractions of sprite size, so that modes overlapping
 * in time (紅葉 and 銀杏 are both autumn) do not stack into one dot and hide
 * each other. Ordered to match MODES.
 */
const ANCHORS: [number, number][] = [
  [0, 0],
  [-0.42, -0.32],
  [0.42, 0.32],
];

function eventDays(properties: StationProperties, mode: Mode) {
  const start = properties[mode.startKey];
  if (typeof start !== "number") return null;
  const peakRaw = mode.peakKey ? properties[mode.peakKey] : undefined;
  const peak = typeof peakRaw === "number" ? peakRaw : start + mode.peakLag;
  return { start, peak };
}

export async function addStations(
  view: ThreeView<never>,
  selected: Set<string>,
): Promise<StationLayers> {
  // Fetched here rather than handed to the source as a `url` so the same parsed
  // features back both the render and the counts. Counting inside the
  // FeatureEvaluator does not work: `featureUpdated` fires per FeatureSet and
  // per tile, so tallies from different days accumulate and disagree.
  const collection = await (await fetch("data/phenology.geojson")).json();
  const properties: StationProperties[] = collection.features.map(
    (feature: { properties: StationProperties }) => feature.properties,
  );

  // One source, reused by every mode's layer — tile fetches and parsing are
  // deduplicated, so the extra layers are close to free.
  const source = view.addSource({ type: "geojson", data: collection });

  let day = 1;
  let active = new Set(selected);

  const layers = MODES.map((mode, index) => {
    const layer = view.addLayer({
      type: "vector",
      source,
      point: {
        color: new Color().setStyle(mode.ramp[1]),
        // Default is metres, which at archipelago scale is sub-pixel.
        sizeInMeters: false,
        size: mode.maxSize,
        // 2D GeoJSON sits at ellipsoid height 0, below the exaggerated terrain
        // surface, so unclamped points end up inside the landmass.
        clampToGround: true,
        // Every station is a distinct reading; hiding overlaps would silently
        // drop stations out of the front.
        declutter: false,
        center: { x: ANCHORS[index][0], y: ANCHORS[index][1] },
        emissiveColor: new Color().setStyle(mode.glow),
        emissiveIntensity: 0.75,
      },
    });

    layer.on("featureUpdated", ({ evaluator }) => {
      const visible = active.has(mode.id);
      evaluator.evaluate(
        ({ properties: featureProperties }) => {
          if (!visible) return { show: false };
          const days = eventDays(featureProperties as StationProperties, mode);
          if (!days) return { show: false };

          const state = phase(mode, day, days.start, days.peak);
          if (!state) return { show: false };

          return {
            show: true,
            color: new Color().setHex(sampleRamp(mode.ramp, state.progress)),
            size:
              mode.minSize + (mode.maxSize - mode.minSize) * state.intensity,
          };
        },
        { filters: [mode.startKey, mode.peakKey].filter(Boolean) as string[] },
      );
    });

    return { mode, layer };
  });

  const refresh = () => layers.forEach(({ layer }) => layer.forceUpdate());
  const profileCache = new Map<string, number[]>();

  return {
    setDay(next) {
      if (next === day) return;
      day = next;
      refresh();
    },
    setSelected(next) {
      active = new Set(next);
      refresh();
    },
    activeCount(mode) {
      let n = 0;
      for (const props of properties) {
        const days = eventDays(props, mode);
        if (days && phase(mode, day, days.start, days.peak)) n += 1;
      }
      return n;
    },
    totalCount(mode) {
      let n = 0;
      for (const props of properties) if (eventDays(props, mode)) n += 1;
      return n;
    },
    profile(mode) {
      const cached = profileCache.get(mode.id);
      if (cached) return cached;
      const series = Array.from({ length: 366 }, (_, index) => {
        let n = 0;
        for (const props of properties) {
          const days = eventDays(props, mode);
          if (days && phase(mode, index, days.start, days.peak)) n += 1;
        }
        return n;
      });
      profileCache.set(mode.id, series);
      return series;
    },
  };
}
