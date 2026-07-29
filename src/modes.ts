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
    minSize: 4,
    maxSize: 19,
    glow: "#ff5fa2",
    direction: "南 → 北 · south to north",
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
