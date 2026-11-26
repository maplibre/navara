import { packing } from "@takram/three-geospatial/shaders";
import { ShaderChunk } from "three";

export * from "@takram/three-geospatial/shaders";

/**
 * Codec for the normal buffer's RG channels, which are **octahedral**, not a
 * plain `xy * 2 - 1`: decode with `unpackVec2ToNormal`. Prepend to shaders
 * that cannot use `#include` resolution (postprocessing effect fragments).
 */
export const NORMAL_PACKING_SHADER: string = packing;

/**
 * Three's `packing` chunk, for reading the MRT pass's depth copies – check
 * `depthBufferPacking` / `globeDepthBufferPacking` for the packing in use:
 * `RGBADepthPacking` copies decode with `unpackRGBAToDepth`, while the float
 * copies of a reversed depth buffer (`BasicDepthPacking`, the default) are
 * read from `.r`. Its `perspectiveDepthToViewZ` handles reversed depth.
 */
export const DEPTH_PACKING_SHADER: string = ShaderChunk.packing;
