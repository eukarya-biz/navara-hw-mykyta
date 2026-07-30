import type ThreeView from "@navaramap/three";
import type { DefaultDescriptions } from "@navaramap/three-default-plugin";
import type {
  CloudOptions,
  CloudsEffectDesc,
  RainDropEffectDesc,
} from "@navaramap/three-default-descs";
import { Vector2, Vector3 } from "three";

import { phase, type Mode } from "./modes";
import {
  eventDays,
  type EventDays,
  type Phenology,
  type SeasonIndex,
  type Station,
  type StationProperties,
} from "./phenology";
import {
  buildPaintGrid,
  createWeatherPainter,
  WEATHER_OFFSET,
  WEATHER_REPEAT,
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

/** Weather canvas resolution. Power of two — the shader leans on mipmaps. */
const MAP_SIZE = 1024;

/**
 * How coverage painted into the weather map is thresholded by the effect.
 *
 * The effect remaps the sampled weather value through a window this wide; a
 * zero texel stays cloud-free only while `coverage` ≤ 1 − this width, which is
 * why modes.ts documents that bound on its `coverage`. Wide on purpose: a
 * narrow window snaps most of the painted range to full density, and a
 * fully-dense texel is beyond the reach of the shape noise (the erosion remap
 * tops out), leaving a flat slab. The wide window keeps the interior in
 * mid-densities where the billows live. Constructor-only: the wrapper's
 * update path does not forward per-layer coverageFilterWidth.
 */
const COVERAGE_FILTER_WIDTH = 0.5;

/**
 * Adds the 梅雨 weather: a volumetric cloud deck confined to the regions
 * currently inside the season, and a screen-space raindrop overlay whose
 * strength follows how much of the country is in rain.
 *
 * The clouds are the effect the photoreal scene already knows how to light —
 * real scattering against the same sun `syncSun` steers — so unlike the old
 * instanced deck nothing here needs a hand-tuned palette to survive the aerial
 * perspective: the atmosphere is applied to the clouds, not painted onto them.
 */
export function addTsuyu(
  view: ThreeView<DefaultDescriptions>,
  { mode, tsuyu }: { mode: Mode; tsuyu: Tsuyu },
): TsuyuHandle {
  const style = mode.tsuyu;
  if (!style) throw new Error(`Mode ${mode.id} has no 梅雨 style`);

  /* --- the weather map --------------------------------------------------- */

  // Every station that has a 梅雨 date, tagged with its region's index. Nearest
  // *station* rather than nearest region anchor, so the paint grid inherits the
  // exact 地方 partition the build asserted: cells around 下関 land in 九州北部
  // and not in 中国, which is right and which no distance-to-anchor rule would
  // get.
  const anchors: WeatherAnchor[] = tsuyu.regions.flatMap((region, index) =>
    region.members.map((station) => ({
      lng: station.lng,
      lat: station.lat,
      region: index,
    })),
  );

  const points = buildPaintGrid(anchors, {
    size: MAP_SIZE,
    stepDeg: style.paintStepDeg,
    reachKm: style.reachKm,
  });
  const painter = createWeatherPainter(points, {
    size: MAP_SIZE,
    stampTexels: style.stampTexels,
  });

  /* --- the clouds -------------------------------------------------------- */

  const clouds = view.addEffect<CloudsEffectDesc>({
    clouds: {
      // Vendored into public/ (from @navaramap/three/dist/assets): the
      // library's own asset URLs are `new URL(..., import.meta.url)`, which
      // the production bundle does not rewrite — deployed builds would 404.
      // Served like data/, so the same relative-path deployment rules apply.
      assetsUrl: "assets/cloud",
      stbnUrl: "assets/noise/stbn.bin",
      // "medium" keeps turbulence and light shafts off — right for a deck seen
      // from 1,600 km, where both are sub-pixel — and the static camera lets
      // the temporal accumulation do the denoising a higher preset would buy.
      qualityPreset: "medium",
      coverage: style.coverage,
      // The equirectangular tiling weatherMap.ts paints for — see the note on
      // WEATHER_REPEAT there, and the shader patch below that makes the
      // mapping actually equirectangular. Velocity stays zero: drift belongs
      // in the canvas, not in a sliding sample offset.
      localWeatherRepeat: new Vector2(WEATHER_REPEAT.x, WEATHER_REPEAT.y),
      localWeatherOffset: new Vector2(WEATHER_OFFSET.x, WEATHER_OFFSET.y),
      localWeatherVelocity: new Vector2(0, 0),
      // Cloud shadows need aerial-perspective irradiance, which relights the
      // terrain globally — not worth coupling the other three seasons to.
      shadows: false,
      lightShafts: false,
      resolutionScale: 0.75,
      // A slant path through the deck is ~50–60 steps at the shell thickness
      // below; the preset's 500 would be budget spent on empty sky.
      maxIterationCount: 128,
      // The shape-noise defaults are tuned for a camera *inside* the weather:
      // ~3 km tiles that are one pixel from 1,600 km up, which renders as a
      // featureless slab. Stretched to ~170 km / ~33 km tiles the billows and
      // holes come back at a scale this camera can resolve.
      shapeRepeat: new Vector3(0.000006, 0.000006, 0.000006),
      shapeDetailRepeat: new Vector3(0.00003, 0.00003, 0.00003),
      // Pushed well past the physical-ish defaults, because the scene's tone
      // mapping sits at exposure 1.1 — a night-leaning grade the photoreal
      // cloud presets never meet (their demos run at 10–60). Without this the
      // deck renders as dim slate instead of rain-lit white.
      scatteringCoefficient: 1.4,
      skyLightScale: 3,
      groundBounceScale: 1.5,
      // A touch of absorption darkens the deck's core so it reads as rain
      // cloud rather than fair-weather cumulus against the dark basemap.
      absorptionCoefficient: 0.02,
      // CloudOptions is typed as a full record, but the pass merges each given
      // field over the layer defaults with `??` — partial entries are safe,
      // hence the cast.
      cloudLayers: [
        {
          channel: "r",
          // The defaults put a 650 m-thick deck at 750 m — invisible from
          // orbit. This is a 2.4 km-thick stratus shelf, dense enough to have
          // real optical depth straight down.
          altitude: 2000,
          height: 2400,
          densityScale: 0.45,
          shapeAmount: 1,
          shapeDetailAmount: 0.15,
          coverageFilterWidth: COVERAGE_FILTER_WIDTH,
        },
        // The painter's stamps are grayscale, so every channel carries the
        // map; the unused layers must be explicitly dead or the defaults
        // would draw a second deck and a cirrus veil from the same paint.
        { channel: "g", densityScale: 0 },
        { channel: "b", densityScale: 0 },
        { channel: "a", densityScale: 0 },
      ] as CloudOptions[],
    },
    visible: true,
  });

  const inner = clouds.ref.raw?.inner;
  if (inner) {
    // The march's first step is minStepSize + (perspectiveStepScale − 1) ×
    // rayNear. The default 1.01 is tuned for a camera *under* the clouds;
    // from 1,620 km up, rayNear is ~1.6e6 m and the first step would leap the
    // whole shell. 1.0 makes stepping uniform. Set on the raw effect — the
    // descriptor doesn't expose it, and a runtime qualityPreset change would
    // silently reset it, which is one reason the preset above is final.
    inner.clouds.perspectiveStepScale = 1;
    inner.localWeatherTexture = painter.texture;

    // The shader's default globe→uv mapping (`getCubeSphereUv`) repeats the
    // weather texture once per cube face, and two of those copies are in frame
    // at this camera: paint over western Japan comes back as phantom cloud in
    // the Sea of Japan, Tohoku's over the Pacific. The shader ships the
    // injective alternative right next to it, so swap the one call. String
    // surgery on the assembled material is blunt, but the material keeps the
    // patched source through define-driven recompiles, and the guard below
    // fails loudly if a library update ever moves the seam.
    const material = inner.cloudsPass.currentMaterial;
    const cubeCall = "return getCubeSphereUv(position);";
    if (material.fragmentShader.includes(cubeCall)) {
      material.fragmentShader = material.fragmentShader.replace(
        cubeCall,
        "return getSphericalUv(position);",
      );
      material.needsUpdate = true;
    } else {
      console.warn(
        "tsuyu: clouds shader changed — getCubeSphereUv patch not applied; " +
          "expect phantom cloud copies over the sea",
      );
    }
  }

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
  let cloudsOn = true;
  let rainOn = false;
  let lastRainOpacity = 0;

  const handle: TsuyuHandle = {
    setDay(day, visible) {
      // The pass asynchronously loads the default weather PNG at startup and
      // installs it on arrival — after our texture. Cheap identity check, and
      // the map is back on the next painted frame no matter who won the race.
      if (inner && inner.localWeatherTexture !== painter.texture) {
        inner.localWeatherTexture = painter.texture;
      }

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
      painter.paint(intensities);

      // With nothing painted the march still costs its texture taps, so the
      // pass is switched off entirely outside the season — which is most of
      // the year.
      const wantClouds = visible && sum > 0.001;
      if (wantClouds !== cloudsOn) {
        cloudsOn = wantClouds;
        // Through update(), not the handle's `visible` setter — only the
        // update path reaches the pass's enabled flag (verified: the setter
        // leaves the deck rendering).
        clouds.update({ visible: wantClouds });
        // The clouds also push a scatter overlay into the atmosphere system,
        // and the atmosphere keeps compositing whatever was pushed last —
        // disabling the pass alone leaves a frozen ghost of the deck in the
        // sky (verified). Pull the overlay with the pass, and push it back on
        // re-enable, since the effect only re-emits it on change.
        view.atmosphere.overlay.value = wantClouds
          ? (inner?.atmosphereOverlay ?? null)
          : null;
      }

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
  // levers worth reaching for from the console while tuning the deck.
  return Object.assign(handle, { debug: { painter, clouds, rain, inner } });
}
