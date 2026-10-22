import { Uniform, Vector2, Vector4, type Texture } from "three";

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
    // Packed params: (isHeatmap, usesBilinear, colorMapRowIndex, logBoundary)
    uElevationHeatmapParams: new Uniform<Vector4[]>([]),
    uElevationMinMaxHeights: new Uniform<Vector2[]>([]),
    uColorMapTexture: new Uniform<Texture | null>(null),
    uElevationRGBScalersAndBoundaries: new Uniform<Vector4[]>([]), // Per-layer (r, g, b, boundary)
    uElevationDecoderOffsets: new Uniform<Vector4[]>([]), // Per-layer (minOffset, maxOffset, epsilon, offset)
    uGlobalMinMaxHeight: new Uniform(new Vector2(0, 1)),
  };
  return {
    attachUniforms: (target, numTextures, placeholder) => {
      // Initialize packed params: (isHeatmap, usesBilinear, colorMapRowIndex, logBoundary)
      refs.uElevationHeatmapParams.value = Array.from(
        { length: numTextures },
        () => new Vector4(0, 1, 0.5, 0), // defaults: not heatmap, bilinear, row 0.5, log off
      );
      refs.uElevationMinMaxHeights.value = Array.from(
        { length: numTextures },
        () => new Vector2(0, 1),
      );
      refs.uElevationRGBScalersAndBoundaries.value = Array.from(
        { length: numTextures },
        () => new Vector4(0, 0, 0, 0),
      );
      refs.uElevationDecoderOffsets.value = Array.from(
        { length: numTextures },
        () => new Vector4(0, 0, 1, 0), // epsilon defaults to 1
      );
      refs.uColorMapTexture.value = placeholder;
      target.uElevationHeatmapParams = refs.uElevationHeatmapParams;
      target.uElevationMinMaxHeights = refs.uElevationMinMaxHeights;
      target.uColorMapTexture = refs.uColorMapTexture;
      target.uElevationRGBScalersAndBoundaries =
        refs.uElevationRGBScalersAndBoundaries;
      target.uElevationDecoderOffsets = refs.uElevationDecoderOffsets;
      target.uGlobalMinMaxHeight = refs.uGlobalMinMaxHeight;
    },
    bindSlot: (k, layer) => {
      const isHeatmap = layer?.kind === "elevationHeatmap";
      if (isHeatmap) {
        // Pack params into vec4: (isHeatmap, usesBilinear, colorMapRowIndex, logBoundary)
        const usesBilinear = layer.filter !== "nearest" ? 1 : 0;
        const colorMapRowIndex = layer.colorMapRowIndex ?? 0.5;
        const logBoundary =
          (layer.logarithmic ?? false) ? (layer.logBoundary ?? 10) : 0;
        refs.uElevationHeatmapParams.value[k].set(
          1,
          usesBilinear,
          colorMapRowIndex,
          logBoundary,
        );

        // Set per-layer min/max heights
        const minH = layer.minHeight ?? 0;
        refs.uElevationMinMaxHeights.value[k].set(
          minH,
          layer.maxHeight ?? minH + 1,
        );

        // Set per-layer decoder parameters
        if (layer.rgbScalersAndBoundary) {
          refs.uElevationRGBScalersAndBoundaries.value[k].copy(
            layer.rgbScalersAndBoundary,
          );
        }
        if (layer.decoderOffsets) {
          refs.uElevationDecoderOffsets.value[k].copy(layer.decoderOffsets);
        }
      } else {
        // Reset to defaults: (isHeatmap=0, usesBilinear=1, colorMapRowIndex=0.5, logBoundary=0)
        refs.uElevationHeatmapParams.value[k].set(0, 1, 0.5, 0);
        refs.uElevationMinMaxHeights.value[k].set(0, 1);
        refs.uElevationRGBScalersAndBoundaries.value[k].set(0, 0, 0, 0);
        refs.uElevationDecoderOffsets.value[k].set(0, 0, 1, 0);
      }
    },
    bindGlobal: (globals) => {
      refs.uColorMapTexture.value = globals.colorMapTexture;
      refs.uGlobalMinMaxHeight.value.copy(globals.globalMinMaxHeight);
    },
  };
}
