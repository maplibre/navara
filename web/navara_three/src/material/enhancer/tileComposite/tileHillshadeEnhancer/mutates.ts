import { Uniform } from "three";

import type { CompositeLayer } from "../../../../tileTexture/types";
import type { CompositeUniformTarget } from "../tileCompositeBaseEnhancer";

export type HillshadeMutates = {
  attachUniforms: (target: CompositeUniformTarget, numTextures: number) => void;
  bindSlot: (compactSlot: number, layer: CompositeLayer | undefined) => void;
};

/**
 * Owns the hillshade per-slot flag array. Exaggeration is not a composite
 * input: the TileMesh shader applies it to the stored normal.
 */
export function createHillshadeMutates(): HillshadeMutates {
  const refs = {
    uIsHillshades: new Uniform<boolean[]>([]),
  };
  return {
    attachUniforms: (target, numTextures) => {
      refs.uIsHillshades.value = new Array<boolean>(numTextures).fill(false);
      target.uIsHillshades = refs.uIsHillshades;
    },
    bindSlot: (k, layer) => {
      refs.uIsHillshades.value[k] = layer?.kind === "hillshade";
    },
  };
}
