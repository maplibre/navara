import { Uniform, Vector3, Vector4, type Texture } from "three";

import type {
  CompositeGlobals,
  CompositeLayer,
} from "../../../../tileTexture/types";
import type { CompositeUniformTarget } from "../tileCompositeBaseEnhancer";

export type ElevationMutates = {
  attachUniforms: (
    target: CompositeUniformTarget,
    numTextures: number,
    placeholder: Texture,
  ) => void;
  bindSlot: (compactSlot: number, layer: CompositeLayer | undefined) => void;
  bindGlobal: (globals: CompositeGlobals) => void;
};

/**
 * Owns the elevation heatmap per-slot flag array plus the slot-independent
 * colormap sampler and DEM decoder params.
 */
export function createElevationMutates(): ElevationMutates {
  const refs = {
    uIsElevationHeatmaps: new Uniform<boolean[]>([]),
    uElevationHeatmapUsesBilinear: new Uniform<boolean[]>([]),
    uColorMapTexture: new Uniform<Texture | null>(null),
    uElevationRGBScaler: new Uniform(new Vector3()),
    uElevationMinMaxHeightAndBoundary: new Uniform(new Vector3()),
    uElevationMinMaxOffsetAndEpsilonAndOffset: new Uniform(new Vector4()),
    uLogarithmic: new Uniform(false),
    uLogBase: new Uniform(10),
    uLogBoundary: new Uniform(10),
  };
  return {
    attachUniforms: (target, numTextures, placeholder) => {
      refs.uIsElevationHeatmaps.value = new Array<boolean>(numTextures).fill(
        false,
      );
      refs.uElevationHeatmapUsesBilinear.value = new Array<boolean>(
        numTextures,
      ).fill(true);
      refs.uColorMapTexture.value = placeholder;
      target.uIsElevationHeatmaps = refs.uIsElevationHeatmaps;
      target.uElevationHeatmapUsesBilinear = refs.uElevationHeatmapUsesBilinear;
      target.uColorMapTexture = refs.uColorMapTexture;
      target.uElevationRGBScaler = refs.uElevationRGBScaler;
      target.uElevationMinMaxHeightAndBoundary =
        refs.uElevationMinMaxHeightAndBoundary;
      target.uElevationMinMaxOffsetAndEpsilonAndOffset =
        refs.uElevationMinMaxOffsetAndEpsilonAndOffset;
      target.uLogarithmic = refs.uLogarithmic;
      target.uLogBase = refs.uLogBase;
      target.uLogBoundary = refs.uLogBoundary;
    },
    bindSlot: (k, layer) => {
      const isHeatmap = layer?.kind === "elevationHeatmap";
      refs.uIsElevationHeatmaps.value[k] = isHeatmap;
      if (isHeatmap) {
        // Set filter: "linear" = true (bilinear), "nearest" = false (nearest)
        refs.uElevationHeatmapUsesBilinear.value[k] =
          layer.filter !== "nearest";
      } else {
        refs.uElevationHeatmapUsesBilinear.value[k] = true; // Default
      }
    },
    bindGlobal: (globals) => {
      refs.uColorMapTexture.value = globals.colorMapTexture;
      refs.uElevationRGBScaler.value.copy(globals.elevationRGBScaler);
      refs.uElevationMinMaxHeightAndBoundary.value.copy(
        globals.elevationMinMaxHeightAndBoundary,
      );
      refs.uElevationMinMaxOffsetAndEpsilonAndOffset.value.copy(
        globals.elevationMinMaxOffsetAndEpsilonAndOffset,
      );
      refs.uLogarithmic.value = globals.logarithmic;
      refs.uLogBase.value = globals.logBase;
      refs.uLogBoundary.value = globals.logBoundary;
    },
  };
}
