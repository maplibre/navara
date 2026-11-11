import {
  buildCompositeFragmentShader,
  composeCompositeContributions,
  compositeSlotMarker,
  COMPOSITE_VERTEX_SHADER,
  createCompositeLayerEnhancers,
} from "../material/enhancer/tileComposite";

import type { CompositeFeatures } from "./types";

// Re-exported from the composite enhancer modules so existing import sites
// (tests, index) keep resolving them from here.
export { compositeSlotMarker, COMPOSITE_VERTEX_SHADER };

/**
 * Produce the fragment shader for the offscreen composite pass.
 *
 * Slot layout — to avoid wasting blocks on the sparse gap between active raster
 * slots (low indices) and active vector slots (starting at
 * `texturizedSceneIndexFrom`), the shader emits a **compact** index space:
 *
 *   compact slot k ∈ [0, rasterCount)              → absSlot = k             (raster)
 *   compact slot k ∈ [rasterCount, rasterCount+vectorCount)
 *                                                  → absSlot = texturizedSceneIndexFrom + (k - rasterCount)
 *
 * The absolute index is baked into `winningSlot = <abs>` so the TileMesh main
 * shader's per-slot uniform arrays (sized at the original maxTextures) still
 * index correctly via `winIdx`.
 *
 * Each expression (hillshade, elevation heatmap, water, watermask) is owned by a
 * composite layer enhancer; `createCompositeLayerEnhancers` builds the chain for
 * this feature set and `composeCompositeContributions` folds it onto the base
 * enhancer's skeleton. CPU branch elision falls out naturally: an inactive
 * enhancer contributes empty GLSL, so absent features cost nothing.
 * `writesNormal` declares the normal output for an atlas that has it.
 */
export function generateCompositeFragmentShader(
  rasterCount: number,
  vectorCount: number,
  texturizedSceneIndexFrom: number,
  features: CompositeFeatures,
  writesNormal = true,
): string {
  const enhancers = createCompositeLayerEnhancers(features);
  const contributions = composeCompositeContributions(
    enhancers,
    rasterCount + vectorCount,
  );
  return buildCompositeFragmentShader(
    rasterCount,
    vectorCount,
    texturizedSceneIndexFrom,
    contributions,
    writesNormal,
  );
}
