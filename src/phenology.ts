import { phase, type Mode } from "./modes";

export type StationProperties = Record<string, number | string | undefined>;

/** One observation station: where it is, how high, and its per-mode day-of-year means. */
export type Station = {
  lng: number;
  lat: number;
  /** Metres above sea level. */
  alt: number;
  properties: StationProperties;
};

export type Phenology = {
  /** The raw FeatureCollection, handed straight to a `geojson` source. */
  collection: unknown;
  stations: Station[];
  /** Current day-of-year; fractional. */
  readonly day: number;
  setDay(day: number): void;
  /** Stations inside their active window on the current day, for one mode. */
  activeCount(mode: Mode): number;
  /** Stations that have data for a mode at all. */
  totalCount(mode: Mode): number;
  /** Active count per day-of-year, for the timeline graph. */
  profile(mode: Mode): number[];
};

/**
 * The day-of-year a mode's phenomenon starts and peaks at one station, or null
 * when that station has no reading for it. 紅葉 and 銀杏 have no recorded peak,
 * so they fall back to a fixed lag after the start.
 */
export function eventDays(properties: StationProperties, mode: Mode) {
  const start = properties[mode.startKey];
  if (typeof start !== "number") return null;
  const peakRaw = mode.peakKey ? properties[mode.peakKey] : undefined;
  const peak = typeof peakRaw === "number" ? peakRaw : start + mode.peakLag;
  return { start, peak };
}

/**
 * Loads the station data and owns the clock plus every derived tally.
 *
 * The counts live here, not in a layer's FeatureEvaluator, because
 * `featureUpdated` fires per FeatureSet *and* per tile — tallies from different
 * days would accumulate and disagree. Everything that draws (the sprite layers,
 * the blossom mesh) reads the same parsed stations, so the numbers on screen and
 * the geometry on the globe can never diverge.
 */
export async function loadPhenology(): Promise<Phenology> {
  const collection = await (await fetch("data/phenology.geojson")).json();

  const stations: Station[] = collection.features.map(
    (feature: {
      geometry: { coordinates: [number, number] };
      properties: StationProperties;
    }) => ({
      lng: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
      alt: typeof feature.properties.alt === "number"
        ? feature.properties.alt
        : 0,
      properties: feature.properties,
    }),
  );

  let day = 1;
  const profileCache = new Map<string, number[]>();

  return {
    collection,
    stations,
    get day() {
      return day;
    },
    setDay(next) {
      day = next;
    },
    activeCount(mode) {
      let n = 0;
      for (const station of stations) {
        const days = eventDays(station.properties, mode);
        if (days && phase(mode, day, days.start, days.peak)) n += 1;
      }
      return n;
    },
    totalCount(mode) {
      let n = 0;
      for (const station of stations) {
        if (eventDays(station.properties, mode)) n += 1;
      }
      return n;
    },
    profile(mode) {
      const cached = profileCache.get(mode.id);
      if (cached) return cached;
      const series = Array.from({ length: 366 }, (_, index) => {
        let n = 0;
        for (const station of stations) {
          const days = eventDays(station.properties, mode);
          if (days && phase(mode, index, days.start, days.peak)) n += 1;
        }
        return n;
      });
      profileCache.set(mode.id, series);
      return series;
    },
  };
}
