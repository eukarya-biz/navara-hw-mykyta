export type Mode = {
  id: string;
  label: string;
  labelEn: string;
  /** Station property holding the day-of-year the phenomenon starts. */
  startKey: string;
  /** Optional property for the peak (e.g. 満開); falls back to start + peakLag. */
  peakKey?: string;
  /**
   * Property holding the day-of-year the phenomenon *ends*, when the source
   * measures it. 梅雨 is the only mode that has one: JMA announces 梅雨明け, while
   * 桜, 紅葉 and 銀杏 have their end synthesised from peakLag/holdDays/fadeDays.
   */
  endKey?: string;
  peakLag: number;
  /** Days the peak holds before fading. Unused when `endKey` is set. */
  holdDays: number;
  /** Days from end of hold to fully gone; the withdrawal ramp when `endKey` is set. */
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
   * What the readout is counting. Every other mode is read at observation
   * stations; 梅雨 is announced for a whole 地方. Without this the `96` in
   * `43 / 96` never said what it was.
   */
  unit: string;
  /**
   * The mode's unit is a 地方, not a station: its tallies come from the region
   * index rather than the station index, and stations.ts must not build it a
   * sprite layer over features that carry none of its properties.
   */
  regional?: boolean;
  /**
   * When present, the mode is drawn as instanced 3D geometry instead of a point
   * sprite, and stations.ts skips its sprite layer entirely.
   */
  blossom?: BlossomStyle;
  /** Present only on 梅雨: the cloud deck and the two 前線 lines. */
  tsuyu?: TsuyuStyle;
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
  | { kind: "ginkgo"; fans: number; hubTint: [number, number, number] }
  /**
   * A cumulus clump for the 梅雨 deck. Not flora, but it is the same problem —
   * a handful of rounded blades round a filled hub, normalised to unit radius —
   * so it rides the same profile machinery rather than duplicating it.
   */
  | { kind: "puff"; lobes: number; crownTint: [number, number, number] };

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

/** One 前線 line: an ArcLine drawn across the archipelago at the season's edge. */
export type FrontStyle = {
  /** Half-width in screen pixels — the rendered line is twice this. */
  thickness: number;
  opacity: number;
  /** Gradient along the line, west to east. */
  fromColor: string;
  toColor: string;
  emissive: string;
  emissiveIntensity: number;
  /** Dash and gap in metres along the arc; omit for a solid line. */
  dash?: { size: number; gap: number; metresPerSecond: number };
};

/**
 * 梅雨's 3D style: an elevated cloud deck plus the two lines that bound it.
 *
 * All heights are metres above the ellipsoid and already include the terrain
 * exaggeration, because the deck has to clear the *exaggerated* mountains rather
 * than the real ones. All radii are metres on the ground.
 *
 * The fixed camera resolves about 2,450 m per pixel, and a vertical offset h
 * projects to only h/4,620 px at pitch −58 — so vertical structure is nearly
 * free of visual consequence here and horizontal extent carries everything. That
 * is why the deck is wide and flat rather than tall.
 */
export type TsuyuStyle = {
  deckHeight: number;
  /** Puff radius at the edge of the ramp and at full season. */
  minRadius: number;
  maxRadius: number;
  deckEmissiveIntensity: number;
  /**
   * The deck's own colour ramp, walked across the season.
   *
   * Separate from `Mode.ramp` on purpose, and the one place in the codebase where
   * a mode has two palettes. `Mode.ramp` drives the pill, the swatch and the graph
   * — all DOM, which gets no aerial-perspective inscatter, so it is free to be
   * rain-blue. This one is in the world, where an additive pale blue is laid over
   * everything and only luminance and warmth survive it, so it is warm near-white
   * throughout. Same phenomenon, two media, two right answers.
   */
  deckRamp: string[];
  /**
   * Fraction of grid cells that ever appear. Below 1 on purpose: at the plateau
   * every region is inside 梅雨 at once, and a fully populated deck is a white
   * blob with no coastline showing through it.
   */
  coverage: number;
  /**
   * Per-cell scatter on the window edges, so the deck knits itself in rather than
   * appearing as a field of growing discs. The ramps themselves come from
   * `peakLag`/`fadeDays`, which are JMA's own 平均５日間程度.
   */
  jitterDays: number;
  frontHeight: number;
  onset: FrontStyle;
  withdrawal: FrontStyle;
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
    unit: "地点",
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
    unit: "地点",
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
    unit: "地点",
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
  {
    id: "tsuyu",
    label: "梅雨",
    labelEn: "Rainy season",
    startKey: "tsuyuIri",
    // The only measured end in the set. Everything else about this mode follows
    // from that: the window is JMA's announced one, not a synthesised decay.
    endKey: "tsuyuAke",
    // JMA announces both edges as 「○月○日頃」 because there is a 平均５日間程度
    // transition at each, so no single day can be named. Those five days are the
    // two ramps, and phase() keeps both *inside* the window — nothing is ever
    // drawn on a day JMA did not name.
    peakLag: 5,
    fadeDays: 5,
    // Unused on the measured path: the season runs to 梅雨明け, not for a fixed
    // count of days after a peak. Zero so a misread cannot extend the window.
    holdDays: 0,
    // Forming, thickening, saturated, saturated, clearing. Cool in the DOM and
    // warm in the world — see the note on TsuyuStyle colours below.
    ramp: ["#dbe7ef", "#a9c9de", "#7fb0cd", "#5f97b8", "#c3cfd4"],
    // Unused: `regional` keeps this mode off the sprite path entirely.
    minSize: 5,
    maxSize: 22,
    glow: "#5aa8d4",
    // The pill's tooltip, which makes it the free home for the finding.
    direction: "南 → 北 · south to north — 北海道を除く / except Hokkaido",
    unit: "地方",
    regional: true,
    tsuyu: {
      // 6,400 m × the 2.5 terrain exaggeration. Clears 富士山 exaggerated (9,440 m)
      // by 6.5 km, and is only 3.5 px of parallax at this camera, so the deck sits
      // *on* the country rather than floating visibly above it.
      deckHeight: 16_000,
      minRadius: 0,
      maxRadius: 34_000,
      // Deliberately far below the blossoms' 0.45–0.5. glow.ts warns that the
      // bloom already swallows shape at a 19 px marker; several hundred near-white
      // puffs at that intensity would be one flat blowout.
      deckEmissiveIntensity: 0.12,
      // Forming, thickening, saturated, saturated, then the warm break as the
      // sun starts coming back through at 梅雨明け.
      deckRamp: ["#cdc6b8", "#e6dfd2", "#f2ece1", "#f2ece1", "#ffe6bc"],
      coverage: 0.7,
      jitterDays: 2,
      frontHeight: 20_000,
      // Warm near-white, and bright, for the reason terrain.ts documents at
      // length: aerial-perspective inscatter lays an additive pale blue over
      // everything at this camera, so only luminance and warmth survive it. A
      // cool grey rain colour — the obvious choice — dissolves into the haze.
      // The DOM overlay gets no inscatter at all, which is why `ramp` above is
      // free to be blue while everything here is not.
      onset: {
        thickness: 1.6,
        opacity: 0.95,
        fromColor: "#ffe7bd",
        toColor: "#fff6e4",
        emissive: "#ffdca8",
        emissiveIntensity: 0.55,
        // Solid: a dashed leading edge would read as provisional, and it avoids
        // the per-instance dash phase break at each chain joint.
      },
      withdrawal: {
        thickness: 1.1,
        opacity: 0.62,
        // The tail of the 桜 ramp, already proven legible at this camera.
        fromColor: "#cfd6cf",
        toColor: "#e4e9e2",
        emissive: "#cfd6cf",
        emissiveIntensity: 0.3,
        // Dashed reads as "has passed", which is exactly what 梅雨明け is.
        dash: { size: 140_000, gap: 90_000, metresPerSecond: 18_000 },
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
 *
 * `end` is the measured end date, for the one mode whose source publishes one.
 * It is an optional argument rather than a second function because all four call
 * sites — the two tallies, the sprite evaluator and the instanced mesh — can pass
 * it unconditionally, so 梅雨 inherits every one of those paths untouched.
 */
export function phase(
  mode: Mode,
  day: number,
  start: number,
  peak: number,
  end?: number,
) {
  if (end !== undefined) {
    // Measured span. The window is exactly [start, end] and *both* ramps live
    // inside it, so a marker never appears on a day the source did not name —
    // which matters here, because JMA's 「○月○日頃」 already carries the ±5-day
    // vagueness that these ramps are depicting.
    if (day < start || day > end) return null;
    const span = Math.max(end - start, 0.001);
    // Clamped to half the span so a short season cannot have its two ramps
    // overlap and dip in the middle. 梅雨's normals run 42–48 days, but the
    // per-year record includes spans as short as 25.
    const rise = Math.max(Math.min(peak - start, span / 2), 0.001);
    const fall = Math.max(Math.min(mode.fadeDays, span / 2), 0.001);
    const intensity =
      day < start + rise
        ? 0.25 + 0.75 * ((day - start) / rise)
        : day > end - fall
          ? 0.25 + 0.75 * ((end - day) / fall)
          : 1;
    // Progress walks the whole season rather than tracking the size envelope, so
    // the ramp reads as early/mid/late 梅雨.
    return { progress: (day - start) / span, intensity };
  }

  // Synthesised span, for the three modes whose source gives no end date.
  const holdEnd = peak + mode.holdDays;
  const gone = holdEnd + mode.fadeDays;
  if (day < start || day > gone) return null;

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
