import type ThreeView from "@navaramap/three";
import type { DefaultDescriptions } from "@navaramap/three-default-plugin";
import type {
  CloudOptions,
  CloudsEffectDesc,
} from "@navaramap/three-default-descs";
import { Vector2, Vector3 } from "three";

import {
  createWeatherPainter,
  WEATHER_OFFSET,
  WEATHER_REPEAT,
  type PaintPoint,
  type WeatherChannel,
  type WeatherChannelName,
} from "./weatherMap";

/**
 * The scene's one volumetric cloud pass, shared by every weather season.
 *
 * There is exactly one, and not by choice: `CloudsEffectDesc` declares no
 * `static allowDuplication` — unlike `FogLightEffectDesc` and
 * `RainDropEffectDesc`, which do — so `view.addEffect` will not give out a
 * second. 梅雨 and 雪 therefore share a single pass, a single local-weather
 * canvas and a single set of global knobs, and are kept apart by taking
 * different *colour channels* of that canvas: the effect drives one independent
 * cloud layer per channel, each with its own altitude, thickness and density.
 *
 * That sharing is only safe because the two seasons never coincide. 梅雨 runs
 * from 沖縄 in early May to 東北 in late July; 雪 starts with 稚内's 初雪 in
 * mid-October and ends with its 終雪 in early May. Nothing in the year has both,
 * which is why the genuinely global settings below — `coverage` and
 * `localWeatherVelocity` — can simply be handed to whichever deck is active.
 *
 * This module owns every hard-won fix that used to live in tsuyu.ts, because
 * every one of them is a property of the pass rather than of a season.
 */

/** Weather canvas resolution. Power of two — the shader leans on mipmaps. */
const MAP_SIZE = 1024;

/**
 * How coverage painted into the weather map is thresholded by the effect.
 *
 * The effect remaps the sampled weather value through a window this wide; a
 * zero texel stays cloud-free only while `coverage` ≤ 1 − this width, which is
 * why modes.ts documents that bound on both styles' `coverage`. Wide on purpose:
 * a narrow window snaps most of the painted range to full density, and a
 * fully-dense texel is beyond the reach of the shape noise (the erosion remap
 * tops out), leaving a flat slab. The wide window keeps the interior in
 * mid-densities where the billows live. Constructor-only: the wrapper's update
 * path does not forward per-layer coverageFilterWidth, which is also why every
 * deck has to be declared before the pass is built rather than added later.
 */
const COVERAGE_FILTER_WIDTH = 0.5;

export type WeatherDeckConfig = {
  id: string;
  /** Which channel of the shared map this deck's paint lives in. */
  channel: WeatherChannelName;
  points: PaintPoint[];
  stampTexels: [number, number];
  /** Base of the deck in metres above the ellipsoid, and its thickness. */
  altitude: number;
  height: number;
  densityScale: number;
  /** The pass's global coverage knob while this deck is the active one. */
  coverage: number;
};

export type WeatherDeck = {
  /**
   * Pushes per-group intensities for this deck. `active` is false when the
   * season is off or outside its window; the pass switches off entirely once no
   * deck wants cloud. Safe to call as often as the caller repaints, which is a
   * few times a second — not every frame.
   */
  paint(intensities: number[], active: boolean): void;
};

export type WeatherHandle = {
  deck(id: string): WeatherDeck;
  /** Untyped bag of levers worth reaching for from the console while tuning. */
  debug: Record<string, unknown>;
};

/**
 * Adds the shared cloud pass and returns a handle per declared deck.
 *
 * Every deck must be declared up front: `coverageFilterWidth` and the layer
 * roster are constructor-only on the pass, so a deck added later would get the
 * effect's defaults instead of its own geometry.
 */
export function addWeather(
  view: ThreeView<DefaultDescriptions>,
  decks: WeatherDeckConfig[],
): WeatherHandle {
  if (decks.length === 0) throw new Error("addWeather needs at least one deck");

  const painter = createWeatherPainter({ size: MAP_SIZE });

  /* --- the layers -------------------------------------------------------- */

  // One layer per channel, in the effect's own r/g/b/a order. The painter's
  // stamps are channel-masked, but the *unused* channels must still be
  // explicitly dead: the effect's defaults would otherwise draw a second deck
  // and a cirrus veil from whatever happened to be in them.
  const CHANNELS = ["r", "g", "b", "a"] as const;
  const byChannel = new Map(decks.map((deck) => [deck.channel, deck]));
  const cloudLayers = CHANNELS.map((channel) => {
    const deck = byChannel.get(channel as WeatherChannelName);
    if (!deck) {
      // A dead layer still contributes its altitude band to the interval the
      // ray marches, and the default third layer is a cirrus veil at 7.5–8 km.
      // Left alone it stretched the marched shell from 900 m to 8,000 m —
      // nine times the depth, for a layer whose density is zero. Collapsed onto
      // the first real deck so the shell stays tight.
      return {
        channel,
        densityScale: 0,
        altitude: decks[0].altitude,
        height: decks[0].height,
      };
    }
    return {
      channel,
      altitude: deck.altitude,
      height: deck.height,
      densityScale: deck.densityScale,
      shapeAmount: 1,
      shapeDetailAmount: 0.15,
      coverageFilterWidth: COVERAGE_FILTER_WIDTH,
    };
  });
  const layerIndexOf = (channel: WeatherChannelName) =>
    CHANNELS.indexOf(channel);

  /* --- the pass ---------------------------------------------------------- */

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
      coverage: decks[0].coverage,
      // The equirectangular tiling weatherMap.ts paints for — see the note on
      // WEATHER_REPEAT there, and the shader patch below that makes the
      // mapping actually equirectangular.
      localWeatherRepeat: new Vector2(WEATHER_REPEAT.x, WEATHER_REPEAT.y),
      localWeatherOffset: new Vector2(WEATHER_OFFSET.x, WEATHER_OFFSET.y),
      // Stays zero, permanently, and this is load-bearing: the pass *integrates*
      // this velocity into `localWeatherOffset` every frame, and every texel
      // position weatherMap.ts paints is computed against WEATHER_OFFSET as a
      // constant. Give it any velocity and the sampling window walks away from
      // the offset the paint was projected for, so the deck slides off the
      // country and then off the visible globe — verified: after a minute the
      // offset had moved half a repeat tile and neither season rendered at all.
      //
      // So the wind is not drawn by sliding the map. 雪's direction lives in the
      // *shape* of the paint — bands elongated along the monsoon bearing, see
      // `streakTexels` in modes.ts. If animated motion is wanted later, the
      // lever is `shapeOffset`/`shapeDetailOffset`, which move the erosion noise
      // without touching where the deck is.
      localWeatherVelocity: new Vector2(0, 0),
      // Cloud shadows need aerial-perspective irradiance, which relights the
      // terrain globally — not worth coupling the other seasons to.
      shadows: false,
      lightShafts: false,
      resolutionScale: 0.75,
      // A slant path through the deck is ~50–60 steps at these shell
      // thicknesses; the preset's 500 would be budget spent on empty sky.
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
      // A touch of absorption darkens the deck's core so it reads as weather
      // rather than fair-weather cumulus against the dark basemap.
      absorptionCoefficient: 0.02,
      // CloudOptions is typed as a full record, but the pass merges each given
      // field over the layer defaults with `??` — partial entries are safe,
      // hence the cast.
      cloudLayers: cloudLayers as CloudOptions[],
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
        "weather: clouds shader changed — getCubeSphereUv patch not applied; " +
          "expect phantom cloud copies over the sea",
      );
    }
  }

  /* --- per-deck state ---------------------------------------------------- */

  type DeckState = {
    config: WeatherDeckConfig;
    channel: WeatherChannel;
    active: boolean;
  };

  const states = new Map<string, DeckState>();
  for (const config of decks) {
    states.set(config.id, {
      config,
      channel: painter.addChannel({
        channel: config.channel,
        points: config.points,
        stampTexels: config.stampTexels,
      }),
      active: false,
    });
  }

  let cloudsOn = true;
  let currentOwner: string | null = null;

  /**
   * Applies the global settings for whichever deck is currently active, and
   * switches the whole pass off when none is.
   *
   * With nothing painted the march still costs its texture taps, so the pass is
   * switched off entirely outside every season — which is a good part of the
   * year, and all of the year when both weather pills are off.
   */
  function sync() {
    // First active deck wins. With two seasons that never overlap this is
    // never a real choice; it is written down so that if a third weather season
    // ever does overlap one of these, the ambiguity is visible here rather than
    // being whatever the iteration order happened to be.
    let owner: DeckState | null = null;
    for (const state of states.values()) {
      if (state.active) {
        owner = state;
        break;
      }
    }

    const wantClouds = owner !== null;
    const handover = owner !== null && currentOwner !== owner.config.id;
    if (!handover && wantClouds === cloudsOn) return;

    // `coverage` goes through the descriptor's update path rather than the raw
    // pass: `onUpdateConfig` forwards it to the wrapper's setter, and it is the
    // only path that reaches the pass's enabled flag at all (verified: the
    // handle's `visible` setter leaves the deck rendering).
    clouds.update({
      visible: wantClouds,
      ...(owner ? { clouds: { coverage: owner.config.coverage } } : {}),
    });

    if (wantClouds !== cloudsOn) {
      cloudsOn = wantClouds;
      // The clouds also push a scatter overlay into the atmosphere system, and
      // the atmosphere keeps compositing whatever was pushed last — disabling
      // the pass alone leaves a frozen ghost of the deck in the sky (verified).
      // Pull the overlay with the pass, and push it back on re-enable, since
      // the effect only re-emits it on change.
      view.atmosphere.overlay.value = wantClouds
        ? (inner?.atmosphereOverlay ?? null)
        : null;
    }
    currentOwner = owner?.config.id ?? null;
  }

  const handle: WeatherHandle = {
    deck(id) {
      const state = states.get(id);
      if (!state) throw new Error(`no weather deck ${id}`);
      return {
        paint(intensities, active) {
          // The pass asynchronously loads the default weather PNG at startup
          // and installs it on arrival — after ours. Cheap identity check, and
          // the map is back on the next painted frame no matter who won the
          // race.
          if (inner && inner.localWeatherTexture !== painter.texture) {
            inner.localWeatherTexture = painter.texture;
          }
          state.active = active;
          state.channel.paint(intensities);
          sync();
        },
      };
    },
    debug: { painter, clouds, inner, cloudLayers, layerIndexOf },
  };

  // Nothing is painted yet, so nothing should be marching.
  sync();

  return handle;
}
