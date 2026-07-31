import type ThreeView from "@navaramap/three";
import type { DefaultDescriptions } from "@navaramap/three-default-plugin";
import type { SnowMeshDesc } from "@navaramap/three-default-descs";

import { phase, type Mode } from "./modes";
import {
  eventDays,
  type EventDays,
  type SeasonIndex,
  type Station,
  type StationProperties,
} from "./phenology";
import type { WeatherDeckConfig, WeatherHandle } from "./weather";
import {
  buildPaintGrid,
  SNOW_EXTENT,
  type WeatherAnchor,
} from "./weatherMap";

/* ----------------------------------------------------------------- the data */

export type Snow = SeasonIndex & {
  /**
   * The 142 気象官署 with a 雪の初日 normal.
   *
   * Its own roster, not phenology's: 初雪 is a 気象観測 made at the 気象官署, and
   * that is a different and larger set than the 生物季節観測 stations 桜 is read
   * at. `addBlossoms` already takes its stations as an argument, so nothing had
   * to change for this to be a second station index — the same seam that let
   * 梅雨 be a 地方 index.
   */
  stations: Station[];
  /**
   * Current day-of-year, fractional, and the setter main.ts calls.
   *
   * The same shape `Phenology` uses, and for the same reason: the tallies are
   * derived from the day, so the day has to live next to them. Still exactly one
   * clock — main.ts sets this in `render` alongside `stations.setDay`, and the
   * warning in phenology.ts about a second one still stands.
   */
  readonly day: number;
  setDay(day: number): void;
  /**
   * The fifteen stations with no 雪 at all — the Ryukyus, 奄美, 種子島 and 屋久島,
   * the Ogasawaras, and JMA's Antarctic station.
   *
   * A value rather than a comment, for the same reason `Tsuyu.withoutTsuyu` is:
   * it is half of what this mode has to say, and it should be checkable at
   * runtime and not only in the build script. Names rather than stations,
   * because they are not in the dataset at all — having no season is exactly
   * what excludes them.
   */
  withoutSnow: string[];
  /** Per-station crystal size, 0..1, floored so every season is visible. */
  depthWeight(station: Station): number;
  /** Per-station cloud strength, 0..1, unfloored. */
  cloudWeight(station: Station): number;
};

/**
 * Altitude above which a station's 最深積雪 stops describing its surroundings.
 *
 * 富士山 measures 214 cm at 3,775 m — deeper than anywhere else in the country
 * and half again the next deepest, 倶知安's 183 cm. That is true of the summit
 * and true of nothing within a hundred kilometres of it, so the crystal stays
 * (it is a real reading at a real place) but the station is not allowed to
 * anchor cloud, where it would put the country's heaviest deck over the Pacific
 * side of Honshu and flatly contradict the finding. The threshold sits between
 * 富士山 and the next highest station, 日光 at 1,292 m, which is a mountain town
 * whose 40 cm genuinely is areal.
 */
const SUMMIT_ALTITUDE = 2000;

export async function loadSnow(): Promise<Snow> {
  const collection = await (await fetch("data/snow.geojson")).json();

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

  const withoutSnow: string[] = collection.metadata?.stationsWithoutSnow ?? [];
  if (withoutSnow.length === 0) {
    throw new Error(
      "snow.geojson lists no snowless stations; 南西諸島に雪はない is half the mode",
    );
  }

  const depthOf = (station: Station) => {
    const value = station.properties.saishinSekisetsu;
    return typeof value === "number" ? value : 0;
  };

  // Normalised against the deepest *areal* station rather than the deepest
  // station, so 富士山's summit reading does not set the scale everything else
  // is measured against and squash the rest of the country into the bottom
  // fifth of the range.
  const areal = stations.filter((s) => s.alt < SUMMIT_ALTITUDE);
  const deepest = Math.max(1, ...areal.map(depthOf));

  // Square-rooted. 最深積雪 runs 0–183 cm across the areal stations but the
  // distribution is heavily bottom-weighted — over a third of them are under
  // 10 cm — so a linear map would put most of Japan at one indistinguishable
  // size and spend the whole range on Hokkaido. The root spreads the low end,
  // which is where the east/west contrast actually has to be read.
  const normalised = (station: Station) =>
    Math.min(Math.sqrt(depthOf(station) / deepest), 1);

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
    withoutSnow,
    get day() {
      return day;
    },
    setDay(next) {
      day = next;
    },
    // Floored: a station with a season always has a marker, even where the snow
    // never lies. The twenty-two Pacific-coast stations at 0 cm do get snow —
    // that is what having a 初雪 means — and a marker of size zero would be
    // claiming they do not.
    depthWeight: (station) => 0.28 + 0.72 * normalised(station),
    // Not floored, and the whole point: no lying snow, no deck. This is what
    // leaves 静岡 and 宮崎 under clear sky while 北陸 is buried.
    cloudWeight: (station) =>
      station.alt >= SUMMIT_ALTITUDE ? 0 : normalised(station),
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

export type SnowHandle = {
  /** Pushes the seasonal state for a day; safe to call every frame. */
  setDay(day: number, visible: boolean): void;
};

/** Key this season's deck is registered under in weather.ts. */
export const SNOW_DECK = "snow";

/**
 * The 筋状雲 deck, as a declaration for {@link addWeather}.
 *
 * Separate from {@link addSnowfall} for the same reason `tsuyuDeck` is: one
 * cloud pass, a constructor-only layer roster, so every deck has to exist before
 * the pass does.
 */
export function snowDeck({
  mode,
  snow,
}: {
  mode: Mode;
  snow: Snow;
}): WeatherDeckConfig {
  const style = mode.snow;
  if (!style) throw new Error(`Mode ${mode.id} has no 雪 style`);

  // One group per station rather than per region: 雪 is measured at 地点 and
  // there is no administrative grouping to inherit, so the paint grid's
  // nearest-anchor rule *is* the geography. That also means the intensity array
  // is 142 long rather than 12, which is the same amount of work per repaint —
  // the cost is in the points, not the groups.
  const anchors: WeatherAnchor[] = snow.stations.map((station, index) => ({
    lng: station.lng,
    lat: station.lat,
    group: index,
    weight: snow.cloudWeight(station),
  }));

  return {
    id: SNOW_DECK,
    // 梅雨 owns red.
    channel: style.cloudChannel,
    points: buildPaintGrid(anchors, {
      size: 1024,
      stepDeg: style.paintStepDeg,
      reachKm: style.reachKm,
      shoreKm: style.shoreKm,
      extent: SNOW_EXTENT,
      bearing: style.windBearing,
    }),
    stampTexels: style.streakTexels,
    altitude: style.cloudAltitude,
    height: style.cloudHeight,
    densityScale: style.cloudDensity,
    coverage: style.coverage,
  };
}

/**
 * Adds the 雪 weather: the shared cloud deck painted as cloud streets over the
 * Sea of Japan and the windward coast, and a falling-snow overlay whose strength
 * follows how much of the country is under snow.
 *
 * The overlay is `SnowMeshDesc`, which is the library's own particle field and
 * the nearest thing it has to 梅雨's `RainDropEffectDesc` — deliberately
 * non-diegetic weather on the glass rather than snowflakes at their real size,
 * which from 1,620 km would each be a five-thousandth of a pixel.
 */
export function addSnowfall(
  view: ThreeView<DefaultDescriptions>,
  {
    mode,
    snow,
    weather,
  }: { mode: Mode; snow: Snow; weather: WeatherHandle },
): SnowHandle {
  const style = mode.snow;
  if (!style) throw new Error(`Mode ${mode.id} has no 雪 style`);

  const deck = weather.deck(SNOW_DECK);

  /* --- the falling snow --------------------------------------------------- */

  const flakes = view.addMesh<SnowMeshDesc>({
    snow: {
      particleCount: style.particleCount,
      // The field is a box around the camera — `followCamera` makes it wrap so
      // it reads as unbounded. `areaWidth × radius` is its horizontal extent
      // and `areaHeight` its vertical, both in metres, and both are set far
      // larger than the mesh's own defaults (5 km and 1 km, for a camera
      // standing on the ground) because this camera's near plane is itself tens
      // of kilometres out. A 400 km box puts particles across the whole frame
      // and comfortably past it.
      areaWidth: 40_000,
      radius: 10,
      areaHeight: 300_000,
      // One fall through areaHeight takes ~20 s at this rate, which is about
      // one turn of the season at the timeline's normal pace.
      speed: 0.00005,
      size: style.particleSize,
      color: 0xffffff,
      // Sway, not slant. The shader's movement terms are
      // `sin(time × speed + index)` — an oscillation about the particle's own
      // position, so they cannot express a prevailing direction, only agitation.
      // That is worth having (snow crossing the frame at an angle reads as
      // wind-blown rather than as falling) but it is not where this mode's wind
      // direction comes from: that is the deck's streak bearing and drift.
      movementStrength: {
        x: style.particleDrift,
        y: style.particleDrift * 0.25,
        z: style.particleDrift,
      },
      movementSpeed: { x: 0.0005, y: 0.0002, z: 0.0005 },
      followCamera: true,
      // The mesh's own height falloff is `1 − cameraHeight / maxHeight`, tuned
      // for a camera a few kilometres up: at this camera's 1,620 km any finite
      // value crushes the field to nothing. Infinity disables that branch —
      // which also means the branch never writes `material.opacity`, so the
      // per-day opacity is set on the material directly below.
      maxHeight: Infinity,
      opacity: 0,
    },
    visible: false,
  });

  const mesh = flakes.ref.raw;
  if (mesh) {
    // The instance count is fixed but the shader displaces every particle by up
    // to the full box extent, and three computes the bounding sphere from the
    // undisplaced attribute and caches it. Same trap the blossom mesh pays for
    // in blossoms.ts, and the same fix.
    mesh.frustumCulled = false;
    // Pixel-constant particles. The material sets `sizeAttenuation = true`,
    // which is right for a camera inside the weather and wrong for one above
    // it: particles spread 200 km either side of the camera would differ by
    // two orders of magnitude in apparent size, a handful of blobs among
    // thousands of sub-pixel specks. Off, `size` is simply pixels — which is
    // what a screen overlay wants, and what the raindrops already are.
    mesh.material.sizeAttenuation = false;
    mesh.material.needsUpdate = true;
  }

  /* --- per-day state ------------------------------------------------------ */

  const windows: (EventDays | null)[] = snow.stations.map((station) =>
    eventDays(station.properties, mode),
  );
  const intensities = new Array<number>(snow.stations.length).fill(0);
  const weights = snow.stations.map((station) => snow.cloudWeight(station));

  let lastQuantized = Number.NaN;
  let lastVisible: boolean | undefined;
  let flakesOn = false;
  let lastOpacity = 0;

  const handle: SnowHandle = {
    setDay(day, visible) {
      // Half-day steps, for the same reason 梅雨 uses them: the dates move day
      // by day and repainting a 1024² canvas per frame would be waste.
      const quantized = Math.round(day * 2) / 2;
      if (quantized === lastQuantized && visible === lastVisible) return;
      lastQuantized = quantized;
      lastVisible = visible;

      let sum = 0;
      let active = 0;
      for (let i = 0; i < windows.length; i += 1) {
        const window = windows[i];
        const state =
          visible && window && window.end !== undefined
            ? phase(mode, day, window.start, window.peak, window.end)
            : null;
        if (!state) {
          intensities[i] = 0;
          continue;
        }
        active += 1;
        // `phase` opens at intensity 0.25, and a deck arriving at a quarter
        // strength in one frame is a pop — the same one-day ramp 梅雨 adds at
        // each edge. Both edges have to be measured on the *lifted* window,
        // because 120 of these 142 seasons cross the new year and the raw
        // difference would be negative for most of the year.
        const start = window!.start;
        const end = window!.end!;
        const lift = (value: number) => (value < start ? value + 365 : value);
        const edge = Math.min(1, lift(day) - start, lift(end) - lift(day));
        const value = state.intensity * Math.max(edge, 0);
        intensities[i] = value;
        // Weighted, so the overlay follows how much snow is falling and not
        // merely how many stations have a season open — otherwise the twenty-two
        // dry Pacific stations would drive the same downpour as 北陸.
        sum += value * weights[i];
      }
      deck.paint(intensities, visible && active > 0);

      // Scaled by the *weighted* active fraction against the total weight, so
      // "everywhere at once at full depth" is 1 and midwinter lands well below
      // it. Without the weighting this would peak in January at almost exactly
      // the same value every year and never breathe.
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      const opacity = style.snowMaxOpacity * Math.min(sum / total, 1);
      const wantFlakes = visible && opacity > 0.003;
      if (wantFlakes !== flakesOn || Math.abs(opacity - lastOpacity) > 0.01) {
        flakesOn = wantFlakes;
        lastOpacity = opacity;
        flakes.update({ visible: wantFlakes });
        // Direct, because `maxHeight: Infinity` means the mesh's own update
        // never touches it — see the note on that setting above.
        if (mesh) mesh.material.opacity = opacity;
      }
    },
  };

  // Untyped on purpose, same as 梅雨's: these are the levers worth reaching for
  // from the console while tuning.
  return Object.assign(handle, { debug: { deck, flakes, mesh } });
}
