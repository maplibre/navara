import type { CompositeLayerEnhancer } from "../types";

import { createHillshadeMutates } from "./mutates";
import {
  hillshadePerSlotPostSample,
  hillshadePostLoop,
  hillshadeSlotUniformDecls,
} from "./shader";

/**
 * Hillshade layers carry a DEM-derived normal map. They contribute no color to
 * the composite (their slot color is zeroed) but write a tangent-space normal
 * into the atlas's normal attachment, which the TileMesh main shader rotates
 * via its TBN.
 */
export function createTileHillshadeEnhancer(
  active: boolean,
): CompositeLayerEnhancer | undefined {
  if (!active) return undefined;
  const mutates = createHillshadeMutates();
  return {
    slotUniformDecls: hillshadeSlotUniformDecls,
    perSlotPostSample: hillshadePerSlotPostSample,
    postLoop: hillshadePostLoop,
    attachUniforms: mutates.attachUniforms,
    bindSlot: mutates.bindSlot,
  };
}
