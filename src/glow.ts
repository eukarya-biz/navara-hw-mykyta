import type ThreeView from "@navaramap/three";
import type { DefaultDescriptions } from "@navaramap/three-default-plugin";

/**
 * Effect id for the shared seasonal bloom. Materials opt into a selective effect
 * by naming the *descriptor's* id, so this string has to be the same one passed
 * as `id` to `addEffect` — hence a constant rather than a literal at each site.
 */
export const GLOW_ID = "seasonGlow";

/**
 * Adds the bloom that every seasonal marker glows through.
 *
 * Must be called before any layer that references {@link GLOW_ID}: layer
 * materials resolve `effectIds` to a bitmask once, when the material is built,
 * and never recompute it. Meshes do re-resolve (they subscribe to the registry's
 * slot changes), so only the layer ordering is load-bearing.
 */
export function addSeasonGlow(view: ThreeView<DefaultDescriptions>) {
  return view.addEffect({
    id: GLOW_ID,
    selectiveBloom: {
      // Restrained on purpose. The markers reach 19px, and at 0.9/0.35 the halo
      // swallowed the shape — the autumn sprites read as featureless blobs
      // rather than dots, and the blossoms lost their petals.
      strength: 0.55,
      radius: 0.22,
      // Only materials carrying the selective-effect define write the emissive
      // buffer at all, so this gates brightness among markers, not the terrain.
      threshold: 0,
    },
  });
}
