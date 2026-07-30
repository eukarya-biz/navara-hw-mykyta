import {
  Color,
  InstancedMeshDesc,
  degreeToRadian,
  eastNorthUpToFixedFrame,
  geodeticToVector3,
  setupSelectiveEffectUniforms,
  type InstancedChildConfig,
  type InstancedMeshConfig,
  type InstancedMeshUpdate,
  type ViewContext,
} from "@navaramap/three";
import type ThreeView from "@navaramap/three";
import {
  BufferGeometry,
  Color as ThreeColor,
  DoubleSide,
  Euler,
  type InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three";
import { buildFloraGeometry } from "./blossomGeometry";
import { GLOW_ID } from "./glow";
import { phase, sampleRamp, type FloraShape, type Mode } from "./modes";
import { eventDays, type EventDays, type Station } from "./phenology";

const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- descriptor */

export type BlossomChildConfig = InstancedChildConfig & { color?: Color };

export type BlossomsDescription = {
  shape?: FloraShape;
  emissiveColor?: Color;
  emissiveIntensity?: number;
  effectIds?: string[];
  children?: BlossomChildConfig[];
};

export type BlossomsMeshConfig = InstancedMeshConfig & {
  blossoms?: BlossomsDescription;
};

export type BlossomsMeshUpdate = InstancedMeshUpdate & {
  blossoms?: BlossomsDescription;
};

/** Only reached if a config arrives without a shape; every mode supplies one. */
const DEFAULT_SHAPE: FloraShape = {
  kind: "blossom",
  petals: 5,
  centerTint: [1, 0.86, 0.62],
};

const _tempColor = new ThreeColor();

/**
 * One `InstancedMesh` holding every station's marker.
 *
 * Per-frame work is split in two: {@link setStates} takes the seasonal state from
 * the app clock, and `update(time)` composes the matrices. The split matters —
 * `update(time)` is driven by the engine every frame, so the markers keep
 * turning while the timeline is paused or being scrubbed.
 */
export class BlossomMeshDesc extends InstancedMeshDesc<
  BufferGeometry,
  MeshLambertMaterial,
  BlossomsMeshConfig,
  BlossomsMeshUpdate,
  BlossomChildConfig
> {
  private config: BlossomsMeshConfig;
  private placed: PlacedStation[] = [];

  constructor(
    view: ThreeView,
    ctx: ViewContext,
    config: BlossomsMeshConfig,
  ) {
    // MeshDescWithSelectiveEffect's constructor reads the top-level field, so a
    // nested-only effectIds would be silently dropped and nothing would glow.
    if (config.blossoms?.effectIds) {
      config.effectIds = config.blossoms.effectIds;
    }
    super(view, ctx, config);
    this.config = config;
  }

  /** Hands over the placed stations that `update(time)` animates. */
  setStations(placed: PlacedStation[]) {
    this.placed = placed;
  }

  protected getChildConfigs(): BlossomChildConfig[] {
    return this.config.blossoms?.children ?? [];
  }

  protected createGeometry(): BufferGeometry {
    return buildFloraGeometry(this.config.blossoms?.shape ?? DEFAULT_SHAPE);
  }

  protected createMaterial(): MeshLambertMaterial {
    const cfg = this.config.blossoms;
    const material = new MeshLambertMaterial({
      color: 0xffffff,
      // Black emissive with a nonzero intensity makes the MRT emissive write
      // `diffuse * intensity`, so each marker blooms in its own per-instance
      // ramp colour and desaturates by itself as the ramp runs out.
      emissive: cfg?.emissiveColor?.raw ?? 0x000000,
      emissiveIntensity: cfg?.emissiveIntensity ?? 0.5,
      vertexColors: true,
      // Petals and leaves both cup, so some faces turn away from this camera.
      side: DoubleSide,
    });
    setupSelectiveEffectUniforms(material);
    return material;
  }

  protected getInstanceColor(config: BlossomChildConfig) {
    return config.color ? _tempColor.set(config.color.raw) : undefined;
  }

  override onCreate(): void {
    super.onCreate();
    const mesh = this.raw;
    if (!mesh) return;
    // The view is constructed with shadow: true, and CSM replaces the material's
    // directional-light path. Without this the markers render unlit.
    this.ctx.applyShadowMaterial(mesh.material);
    // The instance count changes every frame and three caches an InstancedMesh's
    // bounding sphere on first frustum test without ever invalidating it. One
    // draw call for 102 instances gains nothing from culling anyway.
    mesh.frustumCulled = false;
  }

  /** Constructing with every station pins the capacity, so this should never
   * fire — but the flag has to survive if it ever does. */
  protected override onInstanceMeshReplaced(
    newMesh: InstancedMesh<BufferGeometry, MeshLambertMaterial>,
  ): void {
    newMesh.frustumCulled = false;
  }

  override update(time: number): void {
    const active: BlossomChildConfig[] = [];

    for (const station of this.placed) {
      if (!station.radius) continue;
      station.compose(time);
      active.push(station.child);
    }

    // One batched upload and one update notification, and it handles the count
    // varying from 0 to 70 across the season without index bookkeeping.
    this.replaceAll(active);
  }

  override onUpdateConfig(updates: BlossomsMeshUpdate): void {
    const u = updates.blossoms;
    if (u && this.raw) {
      const material = this.raw.material;
      if (u.emissiveColor !== undefined) material.emissive.set(u.emissiveColor.raw);
      if (u.emissiveIntensity !== undefined) {
        material.emissiveIntensity = u.emissiveIntensity;
      }
      if (u.effectIds !== undefined) updates.effectIds = u.effectIds;
      this.config.blossoms = { ...this.config.blossoms, ...u };
    }
    super.onUpdateConfig(updates);
  }

  override onDestroy(): void {
    if (this.raw) this.ctx.removeShadowMaterial(this.raw.material);
    super.onDestroy();
  }
}

/* ------------------------------------------------------------------ placement */

/**
 * A station's fixed tangent frame plus the mutable per-frame state.
 *
 * Each owns its own `Matrix4` rather than sharing a scratch one: `replaceAll`
 * stores the child configs by reference, so a shared matrix would alias across
 * every instance.
 *
 * Exported because tsuyu.ts places its cloud deck on the same descriptor: the
 * mesh only needs something that can put a matrix and a colour on a child config
 * once per frame, and "station" is the historical name for that, not a constraint.
 */
export type PlacedStation = {
  child: BlossomChildConfig;
  /** Day-of-year window this station occupies, resolved once at placement. */
  days: EventDays;
  radius: number;
  /** Stable 0..1 hash, so spin and wobble differ per station but never drift. */
  seed: number;
  compose(time: number): void;
};

function place(
  station: Station,
  days: EventDays,
  index: number,
  exaggeration: number,
  anchor: [number, number],
): PlacedStation {
  // The station's own recorded elevation, scaled to match the exaggerated DEM.
  // Terrain sampling would be more faithful in principle but returns the
  // currently loaded LOD, so every marker would pop as tiles refine.
  const origin = geodeticToVector3({
    lng: degreeToRadian(station.lng),
    lat: degreeToRadian(station.lat),
    height: station.alt * exaggeration,
  });
  const frame = eastNorthUpToFixedFrame(origin);

  const matrix = new Matrix4();
  const local = new Matrix4();
  const offset = new Vector3();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3();

  const placed: PlacedStation = {
    child: { matrix, color: new Color() },
    days,
    radius: 0,
    seed: (index * 0.618033988749895) % 1,
    compose(time) {
      const { seed, radius } = placed;
      // A flat, radially symmetric disc spinning about its own axis is nearly
      // invisible; the wobble is what actually reads, by changing how the blades
      // catch the sun.
      const spin = seed * TAU + time * 0.00012 * (0.6 + 0.8 * seed);
      const tiltX = 0.22 * Math.sin(time * 0.00009 + seed * 5.1);
      const tiltY = 0.22 * Math.cos(time * 0.00007 + seed * 2.7);

      // East/north hold the mode apart from the others reading at this station;
      // up lifts it clear of the mountains. All three scale with the instance, so
      // the separation stays proportional as the marker grows and fades.
      offset.set(anchor[0] * radius, anchor[1] * radius, 0.45 * radius);
      quaternion.setFromEuler(euler.set(tiltX, tiltY, spin));
      local.compose(offset, quaternion, scale.setScalar(radius));
      // composeInstanceMatrix returns `matrix` verbatim when set, so the tilt,
      // spin and scale have to be pre-multiplied in here.
      matrix.multiplyMatrices(frame, local);
    },
  };
  return placed;
}

/* -------------------------------------------------------------------- wiring */

export type BlossomHandle = {
  /** Pushes the seasonal state for a day; safe to call every frame. */
  setDay(day: number, visible: boolean): void;
};

let registered = false;

/**
 * Registers the descriptor under the `blossoms` key, once.
 *
 * Exported so tsuyu.ts can add its cloud deck without depending on `addBlossoms`
 * having run first: both call this, whichever goes first pays for it. Calling
 * `registerMesh` twice for one key would otherwise be an ordering trap that only
 * breaks when someone reorders main.ts.
 *
 * `registerMesh` is safe after `view.init()` — unlike `addPlugin`, it has no
 * initialisation guard.
 */
export function registerBlossomMesh(view: ThreeView<{ mesh: BlossomsMeshConfig }>) {
  if (registered) return;
  view.registerMesh("blossoms", BlossomMeshDesc);
  registered = true;
}

/** Adds one instanced mesh for a mode carrying a `blossom` style. */
export function addBlossoms(
  view: ThreeView<{ mesh: BlossomsMeshConfig }>,
  {
    mode,
    stations,
    exaggeration,
  }: { mode: Mode; stations: Station[]; exaggeration: number },
): BlossomHandle {
  const style = mode.blossom;
  if (!style) throw new Error(`Mode ${mode.id} has no 3D style`);

  registerBlossomMesh(view);

  const placed = stations
    .flatMap((station) => {
      const days = eventDays(station.properties, mode);
      return days ? [{ station, days }] : [];
    })
    .map(({ station, days }, index) =>
      place(station, days, index, exaggeration, style.anchor),
    );

  // Constructed with every station present, which pins the instance capacity at
  // the real maximum so replaceAll never has to reallocate, and avoids the
  // empty-mesh bounding sphere that three would cache and cull against forever.
  for (const station of placed) {
    station.radius = style.minRadius;
    station.compose(0);
  }

  const handle = view.addMesh<BlossomMeshDesc>({
    blossoms: {
      shape: style.shape,
      emissiveIntensity: style.emissiveIntensity,
      effectIds: [GLOW_ID],
      children: placed.map((station) => station.child),
    },
  });
  handle.ref.setStations(placed);

  return {
    setDay(day, visible) {
      for (const station of placed) {
        const { days } = station;
        const state = visible
          ? phase(mode, day, days.start, days.peak, days.end)
          : null;
        if (!state) {
          station.radius = 0;
          continue;
        }
        // The same two calls the sprite evaluator makes, so the mesh and the
        // counts can never disagree about what is in bloom.
        station.radius =
          style.minRadius +
          (style.maxRadius - style.minRadius) * state.intensity;
        station.child.color!.setHex(sampleRamp(mode.ramp, state.progress));
      }
    },
  };
}
