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
  /** Present only on 梅雨: the volumetric cloud deck and the rain overlay. */
  tsuyu?: TsuyuStyle;
  /** Present only on 雪: the 筋状雲 deck and the falling-snow overlay. */
  snow?: SnowStyle;
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
  | { kind: "crystal"; arms: number; hubTint: [number, number, number] };

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

/**
 * 梅雨's style: a real volumetric cloud deck plus a screen-space rain overlay.
 *
 * Kept as plain numbers — no three.js import — because this module is data. The
 * geometry of *where* cloud exists comes from weatherMap.ts painting a coverage
 * texture per day; everything here just parameterises that painting and the two
 * effects tsuyu.ts adds.
 */
export type TsuyuStyle = {
  /**
   * The cloud effect's global coverage knob, 0..1. This is a *threshold shaper*,
   * not an amount of sky: where the painted weather map is zero there is no
   * cloud at any coverage. It must stay at or below 1 − coverageFilterWidth
   * (0.25 in tsuyu.ts), because past that the effect's remap floods the whole
   * globe with cloud regardless of the map.
   */
  coverage: number;
  /**
   * How far from the nearest 梅雨-region station the weather map may paint, in
   * kilometres. The 86 stations trace the archipelago closely enough to serve
   * as a land mask, so the deck follows the country without a coastline to
   * load — and stops at the Tsugaru Strait, which is the point of the mode.
   */
  reachKm: number;
  /**
   * Width of the fade band at the outer edge of `reachKm`, in km. Fifty: full
   * strength up to 90 km from a station and easing to nothing over the last
   * fifty, so the deck edge is a fade over water rather than a stamp-shaped
   * sawtooth.
   */
  shoreKm: number;
  /** Paint-grid spacing in degrees; must stay well under reachKm. */
  paintStepDeg: number;
  /** Diameter of one painted blob on the 1024² weather canvas, in texels. */
  stampTexels: number;
  /**
   * Screen raindrop opacity when every region is inside 梅雨 at once. The
   * overlay scales linearly with the active fraction, so this is the ceiling,
   * not the constant.
   */
  rainMaxOpacity: number;
  /** Raindrop spawn density, 0..1 — the effect's own default of 1 is a downpour. */
  rainDensity: number;
};

/**
 * 雪's style: the 筋状雲 cloud deck and the falling-snow overlay.
 *
 * Same division of labour as {@link TsuyuStyle} — plain numbers, no three.js
 * import, parameterising a painting done in weatherMap.ts and two things
 * snow.ts adds. The one structural difference is that 雪 does not get its own
 * cloud effect: `CloudsEffectDesc` carries no `allowDuplication`, so there is
 * exactly one volumetric pass in the scene and the two weather seasons share it
 * through separate channels of one texture. Hence `cloudChannel` here and the
 * per-channel client API in weather.ts.
 */
export type SnowStyle = {
  /**
   * How far from the nearest snow-observing station the weather map may paint,
   * in kilometres. Wider than 梅雨's 140: the deck that matters is the one over
   * the *sea*, because that is where the monsoon picks up the moisture, and the
   * cloud streets are visible from the Korean coast to Honshu. The stations are
   * still the mask, so this is what lets the paint reach out over the Sea of
   * Japan without a coastline to load.
   */
  reachKm: number;
  /**
   * Width of the fade band at the outer edge of `reachKm`, in km. Much wider
   * than 梅雨's fifty, because there is no coast to stop at out here: the deck
   * should thin out gradually across the open sea rather than end on a line
   * 260 km offshore that means nothing.
   */
  shoreKm: number;
  /** Paint-grid spacing in degrees; must stay well under reachKm. */
  paintStepDeg: number;
  /**
   * One painted streak on the 1024² canvas, `[along, across]` in texels.
   *
   * Anisotropic on purpose, and this is the whole wind device: 筋状の雲 are
   * cloud *streets*, parallel bands lying along the wind, and a field of
   * blobs stretched along one bearing is what reads as them from orbit.
   */
  streakTexels: [number, number];
  /**
   * Bearing the winter monsoon blows *towards*, in degrees clockwise from
   * north. 135° is southeast: the Siberian high pushes cold air out of the
   * northwest, it crosses the Sea of Japan, and it unloads on the windward
   * side of the spine.
   *
   * This is the *only* place the wind's direction is expressed, and it reaches
   * the screen as the orientation of the painted bands and nothing else. There
   * is deliberately no animated drift: the cloud pass integrates its velocity
   * into the very texture offset the paint is projected against, so drifting the
   * field walks the deck off the country — see the note in weather.ts.
   */
  windBearing: number;
  /**
   * Which channel of the shared weather texture this deck reads. Not alpha —
   * canvas 2D stores premultiplied colour, so painting into alpha would rescale
   * the channels that carry the actual weather; see weatherMap.ts.
   */
  cloudChannel: "r" | "g" | "b";
  /** Base of the deck in metres, and its thickness. */
  cloudAltitude: number;
  cloudHeight: number;
  cloudDensity: number;
  /**
   * The cloud effect's global coverage knob while 雪 owns it, 0..1. Same bound
   * as 梅雨's: at or below 1 − the layer's coverageFilterWidth.
   */
  coverage: number;
  /**
   * Falling-snow overlay opacity when the whole country is at peak depth. The
   * overlay scales with the active fraction, so this is the ceiling.
   */
  snowMaxOpacity: number;
  /** Particles in the overlay field. */
  particleCount: number;
  /** Particle sprite size, in the point material's own units. */
  particleSize: number;
  /**
   * How far a particle is blown off vertical, in metres, at the peak of the
   * season. The falling snow is the one place the wind is drawn directly rather
   * than through its consequence, so this is what makes it slant.
   */
  particleDrift: number;
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
    /**
     * Forming, thickening, saturated, saturated, clearing — 紫陽花 violet.
     *
     * It was a pale blue, and so is 雪's, and the two were not separable: they
     * are two rows apart in the readout and two curves in the same graph.
     * Violet is the free hue with 桜 on pink and the autumn pair on orange and
     * yellow, and it happens to be the colour of the season's own flower.
     *
     * This is a DOM-only choice, which is what makes it cheap: `regional: true`
     * keeps the mode off the sprite path entirely (no `ramp[1]` colour, no
     * emissive) and it carries no `blossom`, so nothing on the globe samples
     * this. The deck itself cannot be tinted at any price — `CloudsOptions`
     * exposes no colour, because the cloud is lit by the same sun and
     * atmosphere as everything else.
     */
    ramp: ["#d6d8ec", "#a9a7dc", "#7b7cc9", "#5d5eab", "#c4c2d6"],
    // Unused: `regional` keeps this mode off the sprite path entirely.
    minSize: 5,
    maxSize: 22,
    glow: "#8b7fe0",
    // The pill's tooltip, which makes it the free home for the finding.
    direction: "南 → 北 · south to north — 北海道を除く / except Hokkaido",
    unit: "地方",
    regional: true,
    tsuyu: {
      coverage: 0.45,
      reachKm: 140,
      shoreKm: 50,
      paintStepDeg: 0.15,
      stampTexels: 14,
      rainMaxOpacity: 0.5,
      rainDensity: 0.35,
    },
  },
  {
    id: "yuki",
    label: "雪",
    labelEn: "Snow",
    startKey: "yukiHatsu",
    // The only mode with all three edges measured. 初雪 and 終雪 are announced
    // dates like 梅雨's, and the peak is the month 最深積雪 actually peaks in,
    // derived per station in build-snow.mjs rather than assumed.
    peakKey: "sekisetsuPeak",
    endKey: "yukiShu",
    // Unused while `peakKey` resolves, and deliberately long: it is the fallback
    // for a station whose peak month went missing, and snow at these latitudes
    // takes six weeks to reach its depth, not five days.
    peakLag: 45,
    // The withdrawal. `phase` clamps this to half the span, so 稚内's 203-day
    // season melts over 45 days and 高知's 43-day one over 21 — which is right:
    // the thaw is proportional to what fell.
    fadeDays: 45,
    // Unused on the measured path, and zero so a misread cannot extend the
    // window past 終雪.
    holdDays: 0,
    // First flakes, settling, deep, deep, thawing. This used to be a compromise
    // — paler and colder than 梅雨's blue, in the hope that two blues could be
    // told apart. 梅雨 is violet now, so the compromise is off and this is
    // simply the colour of ice, which is also what the crystals want: unlike
    // 梅雨's ramp, this one is sampled on the globe as well as in the DOM.
    ramp: ["#f2f7fb", "#d5e6f2", "#b8d4ea", "#93b9d8", "#dfe6ea"],
    // Unused: this mode draws as instanced geometry, not sprites.
    minSize: 4,
    maxSize: 20,
    glow: "#cfe8ff",
    // The pill's tooltip, and so the home for the finding the labels also carry.
    direction:
      "北 → 南 · north to south — 日本海側に厚く / deep on the Sea of Japan side",
    unit: "地点",
    blossom: {
      // A six-armed crystal is mostly gaps, so it needs a little more radius
      // than a maple to read at the same apparent size. These are the *unweighted*
      // bounds: snow.ts scales each station by its own 最深積雪, so only the
      // deepest station ever reaches maxRadius.
      minRadius: 5_500,
      maxRadius: 29_000,
      emissiveIntensity: 0.55,
      // Northwest — the one quadrant 紅葉 (southwest) and 銀杏 (northeast) leave
      // free, which matters because 雪 genuinely overlaps both: 初雪 arrives in
      // November while the leaves are still turning, and 終雪 in Hokkaido lands
      // in the first week of May, after 桜 has opened there. Also happens to be
      // the direction the snow comes from.
      anchor: [-0.55, 0.45],
      shape: {
        kind: "crystal",
        // Six-fold, like a real one, and for the same reason 銀杏 uses three
        // fans: `place` spins each marker about its own axis, so a radially
        // symmetric marker sits on its station instead of swinging around it.
        arms: 6,
        // A faintly blue hub, so the arms read as joined at a core rather than
        // crossing through each other.
        hubTint: [0.72, 0.82, 0.92],
      },
    },
    snow: {
      // Well past 梅雨's 140 km: the cloud that matters forms *over the sea*, on
      // the fetch between the continent and Honshu, so the paint has to be able
      // to leave the coast.
      reachKm: 260,
      shoreKm: 120,
      paintStepDeg: 0.2,
      // Long enough to read as a band at this camera; not so narrow that the
      // stamp's bright core is squeezed to a texel or two and disappears under
      // the shader's own sampling. Four texels across was invisible.
      streakTexels: [44, 6],
      // Southeast.
      windBearing: 135,
      // 梅雨 owns `r`; tsuyu.ts already zeroes the other three.
      cloudChannel: "g",
      // Lower and thinner than 梅雨's 2.4 km shelf at 2 km. 筋状雲 are shallow
      // convective cloud in a cold airmass, and a low deck also keeps the
      // streaks legible against the relief they are dumping snow on.
      cloudAltitude: 900,
      cloudHeight: 1_400,
      // Four times 梅雨's 0.45, and every bit of it is needed. The effect's
      // height profile only makes cloud in roughly the bottom 40% of a layer
      // (`shapeAlteringBias` peaks at a height fraction of ~0.14), so this
      // 1.4 km shell has about 560 m of usable depth against 梅雨's 960 m — and
      // 雪's paint is dimmer on top of that, because its per-station weight is
      // below 1 almost everywhere. At 0.6 the deck was there in the buffers and
      // invisible on screen.
      cloudDensity: 1.8,
      // Just under the hard bound of 1 − coverageFilterWidth (0.5 in
      // weather.ts). Past it an *unpainted* texel starts producing cloud and
      // the whole globe floods — and because `coverage` is global while the
      // filter width is per layer, the flood would come out of whichever layer
      // has the widest window, not necessarily this one.
      coverage: 0.48,
      snowMaxOpacity: 0.45,
      particleCount: 6_000,
      particleSize: 2.2,
      particleDrift: 4_200,
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
    //
    // 雪 is the first mode whose season crosses the new year — 稚内's 初雪 is
    // 10月19日 and its 終雪 is 5月10日, so `end` is numerically *before* `start`
    // at 120 of the 142 stations. Lifting every value into the same year as
    // `start` puts the whole window back on a monotone line, and the rest of
    // the arithmetic below is unchanged.
    //
    // Uniform rather than conditional on a wrap: for a season that sits inside
    // one year, lifting a day that precedes `start` pushes it past `end`, and
    // the guard rejects it — which is the answer the plain comparison already
    // gave. So 梅雨 and 桜 keep their exact previous behaviour.
    const lift = (value: number) => (value < start ? value + 365 : value);
    const liftedEnd = lift(end);
    const liftedPeak = lift(peak);
    const today = lift(day);
    if (today < start || today > liftedEnd) return null;
    const span = Math.max(liftedEnd - start, 0.001);
    // Clamped to half the span so a short season cannot have its two ramps
    // overlap and dip in the middle. 梅雨's normals run 42–48 days, but the
    // per-year record includes spans as short as 25.
    const rise = Math.max(Math.min(liftedPeak - start, span / 2), 0.001);
    const fall = Math.max(Math.min(mode.fadeDays, span / 2), 0.001);
    const intensity =
      today < start + rise
        ? 0.25 + 0.75 * ((today - start) / rise)
        : today > liftedEnd - fall
          ? 0.25 + 0.75 * ((liftedEnd - today) / fall)
          : 1;
    // Progress walks the whole season rather than tracking the size envelope, so
    // the ramp reads as early/mid/late 梅雨.
    return { progress: (today - start) / span, intensity };
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
