import {
  BufferGeometry,
  Float32BufferAttribute,
} from "three";

const TAU = Math.PI * 2;

/**
 * 7 samples along the blade, 4 across. The width profile changes fastest at the
 * base, where each petal narrows to a point; with too few samples there the
 * straight chord between rings cuts inside the true outline and opens a visible
 * gap between neighbouring petals.
 */
const NU = 7;
const NV = 4;
/** Leaves room for the centre disc, so petals do not meet at a point. */
const BASE_R = 0.1;
/** Wide enough to cover the remaining chord gap where the petals converge. */
const CENTER_R = 0.22;

/**
 * One cherry-blossom petal as a parametric grid, in the XY plane with +Z up, so
 * an east-north-up frame lays the flower flat with its face to the sky.
 *
 * Deliberately not `ShapeGeometry`: that earcut-triangulates a flat outline into
 * a fan with almost no interior vertices, so there is nothing to displace for the
 * cupping and the normals come out flat. A grid gets silhouette, cup and smooth
 * normals in one pass.
 *
 * `u` runs base → tip, `v` runs across the blade. Normalised to radius 1, so the
 * per-instance scale carries the metres.
 */
function pushPetal(
  positions: number[],
  colors: number[],
  indices: number[],
  rotation: number,
) {
  const first = positions.length / 3;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  for (let iu = 0; iu <= NU; iu += 1) {
    const u = iu / NU;
    // Fat and round, tapering at the base, rounded at the tip.
    const halfWidth = 0.42 * Math.sin(Math.PI * u ** 0.62);

    for (let iv = 0; iv <= NV; iv += 1) {
      const v = (iv / NV) * 2 - 1;

      // The notched tip is the sakura signature: a bump on the centreline,
      // confined by u^5 to the last ~15% of the blade.
      const notch = 1 - 0.3 * Math.exp(-((v / 0.34) ** 2)) * u ** 5;

      const x = halfWidth * v;
      const y = BASE_R + (1 - BASE_R) * u * notch;
      // Cup: the tip and centreline lift, the flanks curl slightly down.
      const z = 0.2 * u * u * (1 - 0.55 * v * v) - 0.07 * v ** 4 * u;

      positions.push(x * cos - y * sin, x * sin + y * cos, z);

      // Darker at the throat, white mid-blade. Multiplies with the per-instance
      // ramp colour, so one geometry serves every stage of the arc.
      const shade = 0.82 + 0.18 * Math.min(u * 2.4, 1);
      colors.push(shade, shade * 0.99, shade * 1.02);
    }
  }

  for (let iu = 0; iu < NU; iu += 1) {
    for (let iv = 0; iv < NV; iv += 1) {
      const a = first + iu * (NV + 1) + iv;
      const b = a + (NV + 1);
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

/** Flat disc at the flower's throat, one shade warmer than the petals. */
function pushCenter(
  positions: number[],
  colors: number[],
  indices: number[],
  tint: [number, number, number],
) {
  const first = positions.length / 3;
  const segments = 12;

  positions.push(0, 0, 0.055);
  colors.push(tint[0], tint[1], tint[2]);

  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * TAU;
    positions.push(
      Math.cos(angle) * CENTER_R,
      Math.sin(angle) * CENTER_R,
      // Sits above the petal bases so it covers them rather than z-fighting.
      0.012,
    );
    // Rim slightly deeper, so the disc reads as a dish rather than a sticker.
    colors.push(tint[0] * 0.72, tint[1] * 0.72, tint[2] * 0.72);
  }

  for (let i = 0; i < segments; i += 1) {
    indices.push(first, first + 1 + i, first + 1 + ((i + 1) % segments));
  }
}

export function buildBlossomGeometry(petals: number, tint: [number, number, number]) {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let k = 0; k < petals; k += 1) {
    pushPetal(positions, colors, indices, (k / petals) * TAU);
  }
  pushCenter(positions, colors, indices, tint);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  // itemSize 3, not 4: an alpha channel would flip `vertexAlphas` and change
  // the shader define set.
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

