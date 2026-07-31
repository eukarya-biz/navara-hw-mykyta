import {
  BufferGeometry,
  Float32BufferAttribute,
} from "three";
import type { FloraShape } from "./modes";

const TAU = Math.PI * 2;

/**
 * One blade — a cherry petal, a maple lobe, a ginkgo fan — as a parametric grid
 * in the XY plane with +Z up, so an east-north-up frame lays the marker flat with
 * its face to the sky.
 *
 * Deliberately not `ShapeGeometry`: that earcut-triangulates a flat outline into a
 * fan with almost no interior vertices, so there is nothing to displace for the
 * cupping and the normals come out flat. A grid gets silhouette, cup and smooth
 * normals in one pass.
 *
 * `u` runs base → margin, `v` runs across the blade. Normalised to radius 1, so
 * the per-instance scale carries the metres.
 */
type BladeProfile = {
  /**
   * Samples along the blade. The lower bound is set by whichever feature varies
   * fastest in `u`: for a petal that is the base, where the width profile
   * collapses to a point and a straight chord between rings cuts inside the true
   * outline and opens a visible gap between neighbours; for the maple it is the
   * serration.
   */
  nu: number;
  /** Samples across. Has to resolve anything `edge` or `shade` varies in `v`. */
  nv: number;
  /** Radius the blade starts at, leaving room for the hub. */
  baseR: number;
  /** Half-width across the blade at u. */
  halfWidth(u: number): number;
  /**
   * Multiplies the radial extent, so it carves the outer outline: the cherry's
   * notched tip, the ginkgo's central cleft and rounded margin.
   */
  edge(u: number, v: number): number;
  /** Out-of-plane cup. */
  lift(u: number, v: number): number;
  /** Vertex-brightness, multiplied by the per-instance ramp colour. */
  shade(u: number, v: number): number;
  /** Channel weights on `shade`, for a warm or cool cast within the blade. */
  bias: [number, number, number];
};

type FloraRecipe = {
  blades: number;
  profile: BladeProfile;
  hubRadius: number;
  hubTint: [number, number, number];
};

function pushBlade(
  positions: number[],
  colors: number[],
  indices: number[],
  rotation: number,
  profile: BladeProfile,
) {
  const first = positions.length / 3;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const { nu, nv, baseR } = profile;

  for (let iu = 0; iu <= nu; iu += 1) {
    const u = iu / nu;
    const halfWidth = profile.halfWidth(u);

    for (let iv = 0; iv <= nv; iv += 1) {
      const v = (iv / nv) * 2 - 1;

      const x = halfWidth * v;
      const y = baseR + (1 - baseR) * u * profile.edge(u, v);

      positions.push(x * cos - y * sin, x * sin + y * cos, profile.lift(u, v));

      const shade = profile.shade(u, v);
      colors.push(
        shade * profile.bias[0],
        shade * profile.bias[1],
        shade * profile.bias[2],
      );
    }
  }

  for (let iu = 0; iu < nu; iu += 1) {
    for (let iv = 0; iv < nv; iv += 1) {
      const a = first + iu * (nv + 1) + iv;
      const b = a + (nv + 1);
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

/**
 * Flat disc where the blades converge — the flower's throat, or the leaves'
 * petiole junction. Also load-bearing geometry: the blades taper to a point at
 * their base, so without it the chord gaps between them leave a hole at the
 * centre.
 */
function pushHub(
  positions: number[],
  colors: number[],
  indices: number[],
  radius: number,
  tint: [number, number, number],
) {
  const first = positions.length / 3;
  const segments = 12;

  positions.push(0, 0, 0.055);
  colors.push(tint[0], tint[1], tint[2]);

  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * TAU;
    positions.push(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      // Sits above the blade bases so it covers them rather than z-fighting.
      0.012,
    );
    // Rim slightly deeper, so the disc reads as a dish rather than a sticker.
    colors.push(tint[0] * 0.72, tint[1] * 0.72, tint[2] * 0.72);
  }

  for (let i = 0; i < segments; i += 1) {
    indices.push(first, first + 1 + i, first + 1 + ((i + 1) % segments));
  }
}

/* ---------------------------------------------------------------- 桜 blossom */

const BLOSSOM: BladeProfile = {
  nu: 7,
  nv: 4,
  baseR: 0.1,
  // Fat and round, tapering at the base, rounded at the tip.
  halfWidth: (u) => 0.42 * Math.sin(Math.PI * u ** 0.62),
  // The notched tip is the sakura signature: a bump on the centreline, confined
  // by u^5 to the last ~15% of the blade.
  edge: (u, v) => 1 - 0.3 * Math.exp(-((v / 0.34) ** 2)) * u ** 5,
  // Cup: the tip and centreline lift, the flanks curl slightly down.
  lift: (u, v) => 0.2 * u * u * (1 - 0.55 * v * v) - 0.07 * v ** 4 * u,
  // Darker at the throat, white mid-blade.
  shade: (u) => 0.82 + 0.18 * Math.min(u * 2.4, 1),
  // A hair cool, which is what keeps the pink from going salmon.
  bias: [1, 0.99, 1.02],
};

/* ------------------------------------------------------------ 紅葉 momiji */

/**
 * Acer palmatum: narrow lanceolate lobes on sinuses cut nearly to the petiole,
 * with a toothed margin. The teeth are coarser than life — three or four per edge
 * against a real leaf's dozen — because at ~20 px the true count is sub-pixel and
 * samples down to a fuzzy edge rather than a serrated one.
 */
const MAPLE: BladeProfile = {
  // The serration runs 3.5 cycles over the blade, so nu has to be well above its
  // Nyquist limit or the teeth alias into asymmetric lumps.
  nu: 14,
  nv: 4,
  // Almost at the hub: deep sinuses are what make this read as a maple and not a
  // narrow-petalled flower.
  baseR: 0.06,
  // `sin(π·u^p)` peaks at u = 0.5^(1/p), and where that peak lands decides whether
  // this is a leaf or a flower. At p = 0.45 it sits at u = 0.21, where five lobes
  // 0.4 wide have only 0.31 of circumference each — they overlap, the sinuses fill
  // in, and the result is a daisy. p = 0.8 puts the widest point at u = 0.42, where
  // a lanceolate lobe belongs, and the 1.25 power then narrows the blade either
  // side of that point without moving it, which is what sharpens the tip and cuts
  // the sinuses deep.
  halfWidth: (u) =>
    0.21 *
    Math.sin(Math.PI * u ** 0.8) ** 1.25 *
    (1 + 0.16 * Math.cos(u * Math.PI * 7)),
  // Pointed tip — no notch. `halfWidth` closing to zero at u = 1 does that work.
  edge: () => 1,
  // Barely dished. A maple leaf is close to flat, and the little lift is here to
  // catch the low seasonal sun rather than to be seen as a curve.
  lift: (u, v) => 0.1 * u * u * (1 - 0.4 * v * v),
  // Bright at the tips, dark along the midrib: also the order momiji colours in.
  shade: (u, v) => (0.78 + 0.22 * u) * (1 - 0.12 * Math.exp(-((v / 0.4) ** 2))),
  bias: [1, 0.95, 0.9],
};

/* -------------------------------------------------------------- 銀杏 ginkgo */

/**
 * A flabellate fan: a wedge widening to a broad, rounded, *open* distal margin —
 * unlike a petal or a lobe, the blade does not close to a point — split by the
 * central cleft.
 */
const GINKGO: BladeProfile = {
  nu: 8,
  // Carries the cleft and the veins, both of which vary only across the blade.
  nv: 8,
  baseR: 0.05,
  // Wide enough to read as a fan rather than a petal, but not so wide that the
  // three of them close into a disc: at 0.86 each subtends ~112°, leaving 8° gaps
  // and 93% angular coverage, which at 20px is a circle with nicks in it. 0.62
  // gives ~90° fans with 30° gaps between them.
  halfWidth: (u) => 0.62 * u ** 0.8,
  edge: (u, v) =>
    // Rounds the margin, which a plain grid would leave as a straight chord with
    // the corners reaching further than the centre.
    (1 - 0.3 * v * v) *
    // The cleft, cut into the outer margin only. Depth has to stay well under the
    // rounding above: at 0.45 against a 0.4 round the centreline ended up *behind*
    // the corners, which inverts the margin and splits each fan into two lumps —
    // three fans then read as a six-petal flower rather than a ginkgo cluster.
    (1 - 0.2 * Math.exp(-((v / 0.26) ** 2)) * u ** 4),
  // Curls like a taco, flanks up — the ginkgo tell, and the opposite of the
  // blossom's centreline lift, so the two catch the sun differently.
  lift: (u, v) => 0.18 * u * v * v,
  shade: (u, v) =>
    // Yellows from the margin inward.
    (0.8 + 0.2 * u) *
    // Dichotomous veins. 3.5 cycles is deliberately not a whole number of nv
    // steps: on a round frequency every sample would land on a zero crossing and
    // the veins would vanish entirely.
    (1 - 0.06 * Math.abs(Math.sin(v * Math.PI * 3.5))),
  bias: [1, 0.98, 0.9],
};

/* ---------------------------------------------------------------- 雪 crystal */

/**
 * A stellar dendrite arm: a narrow shaft carrying two pairs of side branches and
 * closing to a point.
 *
 * The blade model has no way to angle a branch off the shaft — `halfWidth` is
 * symmetric in `v`, so what it can make is a *swelling* of the arm at a given
 * radius. That is enough: at the ~20 px these markers occupy, two swellings at
 * distinct radii read as branch pairs, and an actually-angled dendrite would be
 * sub-pixel detail either way. The important thing is that the arms stay
 * separated — six of them at 0.13 half-width have less than a third of their
 * available circumference each, so the gaps between them survive, and a snow
 * crystal that closes into a disc is a daisy.
 */
const CRYSTAL: BladeProfile = {
  // Set by the branch swellings: each is a Gaussian about 0.22 wide in u, so at
  // nu = 24 there are five samples across one and the pair stays symmetric.
  // Halve this and they alias into a single off-centre lump.
  nu: 24,
  // Nothing varies across the arm but the margin rounding and the spine
  // highlight, both of which are smooth.
  nv: 3,
  baseR: 0.05,
  halfWidth: (u) =>
    (// Shaft, tapering outward the way a real one thins away from the core.
    0.055 * (1 - 0.55 * u) +
      // Inner branch pair.
      0.085 * Math.exp(-(((u - 0.4) / 0.055) ** 2)) +
      // Outer pair, a little longer — dendrites branch bigger further out.
      0.105 * Math.exp(-(((u - 0.7) / 0.06) ** 2))) *
    // Closes to a point over the last ~15%, which is what makes the silhouette
    // spiky rather than club-ended.
    (1 - u ** 7),
  // Rounds the margin corners, the same job it does on the ginkgo.
  edge: (_u, v) => 1 - 0.18 * v * v,
  // Nearly flat, because ice is. Just enough of a spine ridge that the arms
  // catch the low winter sun as the marker wobbles — without it a radially
  // symmetric flat star is close to invisible.
  lift: (u, v) => 0.045 * u * (1 - v * v),
  // Brightest at the tips and along the spine, which is also where a real
  // crystal is thickest.
  shade: (u, v) => (0.84 + 0.16 * u) * (1 - 0.1 * Math.abs(v)),
  // A hair blue. The ramp is already near-white, so this is what stops the
  // crystals reading as the same colour as the 桜 at the end of its own ramp.
  bias: [0.96, 0.99, 1.02],
};

/* -------------------------------------------------------------------- build */

/**
 * Scales the shape so its furthest point sits at radius exactly 1, in place.
 *
 * `minRadius`/`maxRadius` in modes.ts are metres, and they can only mean the same
 * thing for all three shapes if each is built to the same unit radius. A blade
 * that closes to a point on the centreline reaches 1 on its own, but the ginkgo's
 * margin stays open, so its *corners* are the extreme and land at 1.18 — the fan
 * would quietly render 18% larger than the radius it was given. Uniform, so the
 * cup keeps its proportions.
 */
function normaliseRadius(positions: number[]) {
  let maxR = 0;
  for (let i = 0; i < positions.length; i += 3) {
    maxR = Math.max(maxR, Math.hypot(positions[i], positions[i + 1]));
  }
  if (maxR === 0) return;
  const scale = 1 / maxR;
  for (let i = 0; i < positions.length; i += 1) {
    positions[i] *= scale;
  }
}

function recipeOf(shape: FloraShape): FloraRecipe {
  switch (shape.kind) {
    case "blossom":
      return {
        blades: shape.petals,
        profile: BLOSSOM,
        // Wide enough to cover the chord gap where the petals converge.
        hubRadius: 0.22,
        hubTint: shape.centerTint,
      };
    case "maple":
      return {
        blades: shape.lobes,
        profile: MAPLE,
        hubRadius: 0.13,
        hubTint: shape.hubTint,
      };
    case "ginkgo":
      return {
        blades: shape.fans,
        profile: GINKGO,
        hubRadius: 0.12,
        hubTint: shape.hubTint,
      };
    case "crystal":
      return {
        blades: shape.arms,
        profile: CRYSTAL,
        // Larger than the maple's despite a similar base width: six arms leave
        // six chord gaps at the centre rather than five, and the core of a real
        // crystal is a solid hexagonal plate anyway.
        hubRadius: 0.15,
        hubTint: shape.hubTint,
      };
  }
}

export function buildFloraGeometry(shape: FloraShape): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const { blades, profile, hubRadius, hubTint } = recipeOf(shape);

  for (let k = 0; k < blades; k += 1) {
    pushBlade(positions, colors, indices, (k / blades) * TAU, profile);
  }
  pushHub(positions, colors, indices, hubRadius, hubTint);
  normaliseRadius(positions);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  // itemSize 3, not 4: an alpha channel would flip `vertexAlphas` and change
  // the shader define set.
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
