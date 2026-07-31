import type ThreeView from "@navaramap/three";
import type { DefaultDescriptions } from "@navaramap/three-default-plugin";
import type { RainDropEffectDesc } from "@navaramap/three-default-descs";

import { phase, type Mode } from "./modes";
import {
  eventDays,
  type EventDays,
  type Phenology,
  type SeasonIndex,
  type Station,
  type StationProperties,
} from "./phenology";
import type { WeatherDeckConfig, WeatherHandle } from "./weather";
import {
  buildPaintGrid,
  TSUYU_EXTENT,
  type WeatherAnchor,
} from "./weatherMap";

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

/* ------------------------------------------------------------------- wiring */

export type TsuyuHandle = {
  /** Pushes the seasonal state for a day; safe to call every frame. */
  setDay(day: number, visible: boolean): void;
};

/** Key this season's deck is registered under in weather.ts. */
export const TSUYU_DECK = "tsuyu";

/**
 * The 梅雨 cloud deck, as a declaration for {@link addWeather}.
 *
 * Separate from {@link addTsuyu} because there is only one cloud pass in the
 * scene and its layer roster is constructor-only, so every season's deck has to
 * be declared before the pass exists. Building the paint grid here keeps the
 * geography with the season that owns it.
 */
export function tsuyuDeck({
  mode,
  tsuyu,
}: {
  mode: Mode;
  tsuyu: Tsuyu;
}): WeatherDeckConfig {
  const style = mode.tsuyu;
  if (!style) throw new Error(`Mode ${mode.id} has no 梅雨 style`);

  // Every station that has a 梅雨 date, tagged with its region's index. Nearest
  // *station* rather than nearest region anchor, so the paint grid inherits the
  // exact 地方 partition the build asserted: cells around 下関 land in 九州北部
  // and not in 中国, which is right and which no distance-to-anchor rule would
  // get.
  //
  // No weights: the source announces that a 地方 is inside 梅雨 and says nothing
  // about how hard it rains there, so every station is worth the same. 雪 is the
  // mode that has an amount to carry.
  const anchors: WeatherAnchor[] = tsuyu.regions.flatMap((region, index) =>
    region.members.map((station) => ({
      lng: station.lng,
      lat: station.lat,
      group: index,
    })),
  );

  return {
    id: TSUYU_DECK,
    // 雪 takes green.
    channel: "r",
    points: buildPaintGrid(anchors, {
      size: 1024,
      stepDeg: style.paintStepDeg,
      reachKm: style.reachKm,
      shoreKm: style.shoreKm,
      extent: TSUYU_EXTENT,
      // No bearing: a 梅雨 front is a stationary boundary, not a wind, so its
      // cloud is isotropic blobs and not streets.
    }),
    stampTexels: [style.stampTexels, style.stampTexels],
    // The defaults put a 650 m-thick deck at 750 m — invisible from orbit. This
    // is a 2.4 km-thick stratus shelf, dense enough to have real optical depth
    // straight down.
    altitude: 2000,
    height: 2400,
    densityScale: 0.45,
    coverage: style.coverage,
  };
}

/**
 * Adds the 梅雨 weather: the shared cloud deck confined to the regions currently
 * inside the season, and a screen-space raindrop overlay whose strength follows
 * how much of the country is in rain.
 *
 * The clouds are the effect the photoreal scene already knows how to light —
 * real scattering against the same sun `syncSun` steers — so unlike the old
 * instanced deck nothing here needs a hand-tuned palette to survive the aerial
 * perspective: the atmosphere is applied to the clouds, not painted onto them.
 */
export function addTsuyu(
  view: ThreeView<DefaultDescriptions>,
  {
    mode,
    tsuyu,
    weather,
  }: { mode: Mode; tsuyu: Tsuyu; weather: WeatherHandle },
): TsuyuHandle {
  const style = mode.tsuyu;
  if (!style) throw new Error(`Mode ${mode.id} has no 梅雨 style`);

  const deck = weather.deck(TSUYU_DECK);

  /* --- the raindrops ------------------------------------------------------ */

  const rain = view.addEffect<RainDropEffectDesc>({
    rainDrop: {
      opacity: 0,
      dropDensity: style.rainDensity,
      // Smaller, sparser, gentler than the effect's downpour defaults
      // (12 / 0.015 / 0.3 / 4): the overlay should register as weather on the
      // glass, not stand between the viewer and the map.
      dropGridSize: 18,
      dropSizeFactor: 0.012,
      refractionStrength: 0.18,
      dropLayers: 3,
    },
    visible: false,
  });

  /* --- per-day state ------------------------------------------------------ */

  const windows: (EventDays | null)[] = tsuyu.regions.map((region) =>
    eventDays(region.properties, mode),
  );
  const intensities = new Array<number>(tsuyu.regions.length).fill(0);

  let lastQuantized = Number.NaN;
  let lastVisible: boolean | undefined;
  let rainOn = false;
  let lastRainOpacity = 0;

  const handle: TsuyuHandle = {
    setDay(day, visible) {
      // Repainting a 1024² canvas per frame would be waste — the dates only
      // move day by day. Half-day steps keep the deck's advance smooth at the
      // slowed 梅雨 playback rate while capping repaints well under the frame
      // rate. Scrubbing lands on the same quantised days, so it is exactly as
      // deterministic as playback.
      const quantized = Math.round(day * 2) / 2;
      if (quantized === lastQuantized && visible === lastVisible) return;
      lastQuantized = quantized;
      lastVisible = visible;

      let sum = 0;
      for (let i = 0; i < windows.length; i += 1) {
        const window = windows[i];
        const state =
          visible && window && window.end !== undefined
            ? phase(mode, day, window.start, window.peak, window.end)
            : null;
        // `phase` opens at intensity 0.25 — right for a marker that must be
        // seen the day it is announced, but a cloud deck materialising at a
        // quarter strength in one frame is a pop. One day of ramp at each edge
        // takes it from and to zero; inside those days the announced ramps
        // rule as before.
        const edge = state
          ? Math.min(1, day - window!.start, window!.end! - day)
          : 0;
        const value = state ? state.intensity * Math.max(edge, 0) : 0;
        intensities[i] = value;
        sum += value;
      }
      // weather.ts owns whether the pass runs at all, so it needs to be told
      // whether this season wants cloud, not just where.
      deck.paint(intensities, visible && sum > 0.001);

      // The overlay's strength follows how much of the country is in rain:
      // barely-there while 沖縄 waits alone in May, strongest at the plateau
      // when all twelve 地方 are inside at once.
      const opacity = style.rainMaxOpacity * (sum / windows.length);
      const wantRain = visible && opacity > 0.003;
      if (
        wantRain !== rainOn ||
        Math.abs(opacity - lastRainOpacity) > 0.01
      ) {
        rainOn = wantRain;
        lastRainOpacity = opacity;
        rain.update({ rainDrop: { opacity }, visible: wantRain });
      }
    },
  };

  // Untyped on purpose: main.ts puts the handle on `window`, and these are the
  // levers worth reaching for from the console while tuning the deck. The cloud
  // levers now live on the weather handle, which main.ts exposes separately.
  return Object.assign(handle, { debug: { deck, rain } });
}
