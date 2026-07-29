import { Color } from "@navaramap/three";
import type ThreeView from "@navaramap/three";
import { GLOW_ID } from "./glow";
import { MODES, phase, sampleRamp, type Mode } from "./modes";
import { eventDays, type Phenology, type StationProperties } from "./phenology";

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
 *
 * Every mode now carries a 3D style, so nothing below reaches this at runtime;
 * `BlossomStyle.anchor` is the live equivalent, in ground metres rather than
 * screen fractions. Kept in step with it, because this is the whole layer's
 * fallback if a mode ever drops back to sprites.
 */
const ANCHORS: [number, number][] = [
  [0, 0],
  [-0.42, -0.32],
  [0.42, 0.32],
];

/**
 * Sprite layers for every mode that is *not* drawn as 3D geometry.
 *
 * Modes carrying a `blossom` config are skipped entirely — blossoms.ts renders
 * those as an instanced mesh instead, and a layer left in place would keep
 * re-evaluating 102 features to draw nothing. The counts are unaffected either
 * way: they come from the shared phenology index, not from any evaluator.
 */
export function addStations(
  view: ThreeView<never>,
  phenology: Phenology,
  selected: Set<string>,
): StationLayers {
  // One source, reused by every mode's layer — tile fetches and parsing are
  // deduplicated, so the extra layers are close to free.
  const source = view.addSource({
    type: "geojson",
    data: phenology.collection,
  });

  let active = new Set(selected);

  const layers = MODES.flatMap((mode, index) => {
    if (mode.blossom) return [];

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
        // Was 0.75, which was harmless while the glow was inert but blows out
        // now that the bloom effect actually exists.
        emissiveIntensity: 0.5,
        // Without this the emissive pair above is inert: the glow is a selective
        // bloom, and a material only writes the emissive buffer once it names
        // the effect. Registered in main.ts before this layer is built.
        effectIds: [GLOW_ID],
      },
    });

    layer.on("featureUpdated", ({ evaluator }) => {
      const visible = active.has(mode.id);
      evaluator.evaluate(
        ({ properties: featureProperties }) => {
          if (!visible) return { show: false };
          const days = eventDays(featureProperties as StationProperties, mode);
          if (!days) return { show: false };

          const state = phase(mode, phenology.day, days.start, days.peak);
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

    return [{ mode, layer }];
  });

  const refresh = () => layers.forEach(({ layer }) => layer.forceUpdate());

  return {
    setDay(next) {
      if (next === phenology.day) return;
      phenology.setDay(next);
      refresh();
    },
    setSelected(next) {
      active = new Set(next);
      refresh();
    },
    activeCount: (mode) => phenology.activeCount(mode),
    totalCount: (mode) => phenology.totalCount(mode),
    profile: (mode) => phenology.profile(mode),
  };
}
