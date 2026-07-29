export type Mode = {
  id: string;
  label: string;
  labelEn: string;
  /** Station property holding the day-of-year the phenomenon starts. */
  startKey: string;
  /** Optional property for the peak (e.g. 満開); falls back to start + peakLag. */
  peakKey?: string;
  peakLag: number;
  /** Days the peak holds before fading. */
  holdDays: number;
  /** Days from end of hold to fully gone. */
  fadeDays: number;
  /** Colour ramp walked from first appearance to the end of the fade. */
  ramp: string[];
  minSize: number;
  maxSize: number;
  /** Emissive tint, set on the material when the mode becomes active. */
  glow: string;
  /** Which direction the front travels — surfaced as the pill's tooltip. */
  direction: string;
  /**
   * When present, the mode is drawn as instanced 3D geometry instead of a point
   * sprite, and stations.ts skips its sprite layer entirely.
   */
  blossom?: BlossomStyle;
};

/**
 * Which shape blossomGeometry.ts builds, and the parameters only that shape has.
 * A union rather than one wide record so a maple never carries a petal count:
 * `kind` is what the geometry module switches on, and keeping it a plain string
 * keeps this module pure data, with no three.js import.
 */
export type FloraShape =
  | {
      kind: "blossom";
      petals: number;
      /** Multiplier baked into the centre disc's vertex colour. */
      centerTint: [number, number, number];
    }
  | { kind: "maple"; lobes: number; hubTint: [number, number, number] }
  | { kind: "ginkgo"; fans: number; hubTint: [number, number, number] };

/** 3D marker style: what to build, how big, and where to sit. */
export type BlossomStyle = {
  /**
   * World radius in metres at the dimmest and brightest point of the arc. The
   * fixed camera resolves about 2,450 m per pixel, so these track the
   * minSize/maxSize pixel range the sprites used — roughly 1,200 m per pixel of
   * sprite radius, plus a little, since blades with gaps between them read
   * smaller than a solid filled disc.
   */
  minRadius: number;
  maxRadius: number;
  /** Scales the bloom; the glow colour itself follows the ramp. */
  emissiveIntensity: number;
  /**
   * Lateral nudge in the station's tangent plane as [east, north], in units of
   * the instance's own radius. 紅葉 and 銀杏 are read at the same stations in
   * overlapping autumn windows, so at a shared origin one simply hides the other.
   * Same purpose as the screen-space `ANCHORS` the sprite path used, and the same
   * directions, but in metres on the ground so it survives the marker turning.
   */
  anchor: [number, number];
  shape: FloraShape;
};

export const MODES: Mode[] = [
  {
    id: "sakura",
    label: "桜",
    labelEn: "Cherry blossom",
    startKey: "sakuraKaika",
    peakKey: "sakuraMankai",
    peakLag: 7,
    holdDays: 6,
    fadeDays: 10,
    ramp: ["#f7c8da", "#ff9ec4", "#ff77ae", "#f5b7cd", "#cfd6cf"],
    // minSize/maxSize are unused while `blossom` is set — kept because they
    // document the pixel target the radii below were derived from, and they are
    // what the sprite layer falls back to if the mesh is ever reverted.
    minSize: 4,
    maxSize: 19,
    glow: "#ff5fa2",
    direction: "南 → 北 · south to north",
    blossom: {
      minRadius: 5_000,
      maxRadius: 25_000,
      emissiveIntensity: 0.5,
      // Spring is alone on the calendar, so 桜 keeps the station point itself.
      anchor: [0, 0],
      shape: {
        kind: "blossom",
        petals: 5,
        // Warm eye against pink petals.
        centerTint: [1.0, 0.86, 0.62],
      },
    },
  },
  {
    id: "kouyou",
    label: "紅葉",
    labelEn: "Autumn leaves",
    startKey: "kaedeKouyou",
    peakLag: 12,
    holdDays: 10,
    fadeDays: 16,
    ramp: ["#e8d48a", "#f0a23c", "#e0561f", "#b32615", "#6d3520"],
    minSize: 4,
    maxSize: 19,
    glow: "#ff6a1e",
    direction: "北 → 南 · north to south",
    blossom: {
      // A touch larger than 桜: five narrow lobes cover far less of their own
      // radius than five fat petals, so an equal radius reads smaller.
      minRadius: 5_500,
      maxRadius: 27_000,
      emissiveIntensity: 0.45,
      // Southwest of the station, mirroring the sprite anchor it replaces.
      anchor: [-0.5, -0.35],
      shape: {
        kind: "maple",
        lobes: 5,
        // Dark petiole junction, so the lobes read as joined rather than fused.
        hubTint: [0.42, 0.3, 0.22],
      },
    },
  },
  {
    id: "icho",
    label: "銀杏",
    labelEn: "Ginkgo",
    startKey: "ichoOuyou",
    peakLag: 12,
    holdDays: 10,
    fadeDays: 14,
    ramp: ["#efe7a8", "#f4d54e", "#e8b421", "#c98a16", "#7a5a1c"],
    minSize: 4,
    maxSize: 18,
    glow: "#ffcf2e",
    direction: "北 → 南 · north to south",
    blossom: {
      // Three broad fans fill their radius more solidly than either of the
      // others, so this one comes back down again.
      minRadius: 5_000,
      maxRadius: 23_000,
      emissiveIntensity: 0.45,
      // Northeast, opposite 紅葉.
      anchor: [0.5, 0.35],
      shape: {
        kind: "ginkgo",
        // A ginkgo short shoot bears its leaves in a cluster, which is lucky: a
        // lone fan is one-sided, and `place` spins each marker about its own
        // axis, so it would swing around the station instead of sitting on it.
        fans: 3,
        hubTint: [0.5, 0.42, 0.24],
      },
    },
  },
];

/**
 * Where a station sits in its seasonal arc on a given day.
 *
 * Returns `null` before the phenomenon starts and after it has finished, and
 * otherwise a 0..1 progress value across
 * start → peak → (hold) → gone, plus a 0..1 intensity used for size.
 */
export function phase(mode: Mode, day: number, start: number, peak: number) {
  const holdEnd = peak + mode.holdDays;
  const end = holdEnd + mode.fadeDays;
  if (day < start || day > end) return null;

  if (day < peak) {
    const t = (day - start) / Math.max(peak - start, 0.001);
    return { progress: t * 0.4, intensity: 0.35 + 0.65 * t };
  }
  if (day <= holdEnd) {
    const t = (day - peak) / Math.max(mode.holdDays, 0.001);
    return { progress: 0.4 + t * 0.25, intensity: 1 };
  }
  const t = (day - holdEnd) / mode.fadeDays;
  return { progress: 0.65 + t * 0.35, intensity: 1 - 0.8 * t };
}

function hexToRgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Samples a mode's ramp at 0..1 with linear interpolation. */
export function sampleRamp(ramp: string[], t: number) {
  const clamped = Math.min(Math.max(t, 0), 1);
  const scaled = clamped * (ramp.length - 1);
  const i = Math.min(Math.floor(scaled), ramp.length - 2);
  const f = scaled - i;
  const a = hexToRgb(ramp[i]);
  const b = hexToRgb(ramp[i + 1]);
  const mix = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return (mix[0] << 16) | (mix[1] << 8) | mix[2];
}
