import { Uniform, Vector2, Vector4, type Texture } from "three";

import {
  DEFAULT_ELEVATION_HEATMAP_LOG_BOUNDARY,
  type CompositeGlobals,
  type CompositeLayer,
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
    // Packed params: (isElevationHeatmap, usesBilinear, colorMapRow, logBoundary)
    uElevationHeatmapParams: new Uniform<Vector4[]>([]),
    uElevationColorRamps: new Uniform<Vector2[]>([]), // Per-layer (stopCount, hasColorStops)
    uElevationMinMaxHeights: new Uniform<Vector2[]>([]),
    uColorMapTexture: new Uniform<Texture | null>(null),
    uElevationRGBScalersAndBoundaries: new Uniform<Vector4[]>([]), // Per-layer (r, g, b, boundary)
    uElevationDecoderOffsets: new Uniform<Vector4[]>([]), // Per-layer (minOffset, maxOffset, epsilon, offset)
  };
  // Never leave the sampler unbound (a null texture samples black).
  let placeholderTexture: Texture | null = null;
  return {
    attachUniforms: (target, numTextures, placeholder) => {
      // Initialize packed params: (isElevationHeatmap, usesBilinear, colorMapRow, logBoundary)
      refs.uElevationHeatmapParams.value = Array.from(
        { length: numTextures },
        () => new Vector4(0, 1, 0, 0), // defaults: not an elevation heatmap, bilinear, default row, log off
      );
      refs.uElevationColorRamps.value = Array.from(
        { length: numTextures },
        () => new Vector2(2, 0), // default grayscale ramp: 2 evenly spaced stops
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
      placeholderTexture = placeholder;
      refs.uColorMapTexture.value = placeholder;
      target.uElevationHeatmapParams = refs.uElevationHeatmapParams;
      target.uElevationColorRamps = refs.uElevationColorRamps;
      target.uElevationMinMaxHeights = refs.uElevationMinMaxHeights;
      target.uColorMapTexture = refs.uColorMapTexture;
      target.uElevationRGBScalersAndBoundaries =
        refs.uElevationRGBScalersAndBoundaries;
      target.uElevationDecoderOffsets = refs.uElevationDecoderOffsets;
    },
    bindSlot: (k, layer) => {
      const isElevationHeatmap = layer?.kind === "elevationHeatmap";
      if (isElevationHeatmap) {
        // Pack params into vec4: (isElevationHeatmap, usesBilinear, colorMapRow, logBoundary)
        const usesBilinear = layer.filter !== "nearest" ? 1 : 0;
        const ramp = layer.colorRamp;
        const logBoundary =
          (layer.logarithmic ?? false)
            ? (layer.logBoundary ?? DEFAULT_ELEVATION_HEATMAP_LOG_BOUNDARY)
            : 0;
        refs.uElevationHeatmapParams.value[k].set(
          1,
          usesBilinear,
          ramp?.row ?? 0,
          logBoundary,
        );
        refs.uElevationColorRamps.value[k].set(
          ramp?.stopCount ?? 2,
          ramp?.hasColorStops ? 1 : 0,
        );

        // Set per-layer min/max heights
        const minH = layer.minHeight ?? 0;
        refs.uElevationMinMaxHeights.value[k].set(
          minH,
          layer.maxHeight ?? minH + 1,
        );

        // Set per-layer decoder parameters; reset when absent so the slot
        // never decodes with the previous layer's decoder.
        if (layer.rgbScalersAndBoundary) {
          refs.uElevationRGBScalersAndBoundaries.value[k].copy(
            layer.rgbScalersAndBoundary,
          );
        } else {
          refs.uElevationRGBScalersAndBoundaries.value[k].set(0, 0, 0, 0);
        }
        if (layer.decoderOffsets) {
          refs.uElevationDecoderOffsets.value[k].copy(layer.decoderOffsets);
        } else {
          refs.uElevationDecoderOffsets.value[k].set(0, 0, 1, 0);
        }
      } else {
        // Reset to defaults: (isElevationHeatmap=0, usesBilinear=1, colorMapRow=0, logBoundary=0)
        refs.uElevationHeatmapParams.value[k].set(0, 1, 0, 0);
        refs.uElevationColorRamps.value[k].set(2, 0);
        refs.uElevationMinMaxHeights.value[k].set(0, 1);
        refs.uElevationRGBScalersAndBoundaries.value[k].set(0, 0, 0, 0);
        refs.uElevationDecoderOffsets.value[k].set(0, 0, 1, 0);
      }
    },
    bindGlobal: (globals) => {
      refs.uColorMapTexture.value =
        globals.colorMapTexture ?? placeholderTexture;
    },
  };
}
