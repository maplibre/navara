import ElevationParsFragment from "@shaders/glsl/chunks/elevation_pars_fragment.glsl";

import type { CompositeSlotContext } from "../tileCompositeBaseEnhancer";

export const elevationSlotUniformDecls = (numTextures: number): string =>
  `// Packed elevation heatmap params: (isHeatmap, usesBilinear, colorMapRowIndex, logBoundary)
uniform vec4 uElevationHeatmapParams[${numTextures}];
uniform vec2 uElevationMinMaxHeights[${numTextures}];
uniform vec2 uGlobalMinMaxHeight;  // (min, max) global height range
uniform vec4 uElevationRGBScalersAndBoundaries[${numTextures}];  // (r, g, b, boundary)
uniform vec4 uElevationDecoderOffsets[${numTextures}];  // (minOffset, maxOffset, epsilon, offset)`;

export const elevationIncludes = (): string => ElevationParsFragment;

/**
 * Replaces the per-slot sampler with a DEM-decode + colormap lookup; non-heatmap
 * slots fall back to the straight raster fetch in the else branch.
 *
 * The heatmap alpha derives from the decode's validity: a no-data (boundary)
 * texel — including a baked drape render target's uncovered regions, which the
 * bake paints with the boundary color — renders transparent instead of being
 * colormapped as height 0. The DEM texel's alpha channel is never read: it is
 * not part of any elevation encoding and stays reserved for future RGBA ones.
 *
 * Filter mode: uElevationHeatmapUsesBilinear[k] controls interpolation.
 * - true (linear): Use bilinear interpolation in decoded height space for smooth transitions
 * - false (nearest): Use nearest neighbor sampling for sharp boundaries
 */
export const elevationSampleProducer = ({
  k,
}: CompositeSlotContext): string => `
    vec4 texColor${k};
    // Extract packed params: (isHeatmap, usesBilinear, colorMapRowIndex, logBoundary)
    vec4 params${k} = uElevationHeatmapParams[${k}];
    bool isHeatmap${k} = params${k}.x > 0.5;

    if (isHeatmap${k}) {
      bool usesBilinear${k} = params${k}.y > 0.5;
      float colorMapY = params${k}.z;
      float logBoundary = params${k}.w;

      ivec2 demTexSize = textureSize(uTextures[${k}], 0);
      bool demValid${k};
      float normalized_h;

      // Per-layer logarithmic scaling: 0 = off, >0 = on with boundary value
      bool logarithmic = logBoundary > 0.0;
      float logBase = logarithmic ? log(logBoundary) : 1.0;  // ln(boundary)

      // Use GLOBAL min/max for elevation normalization (shared across all layers)
      // This matches MapLibre's behavior where multiple color-relief layers on the
      // same source share the elevation range for consistent colormap sampling
      if (usesBilinear${k}) {
        normalized_h = sampleElevationBilinear(uTextures[${k}], texUv${k}, demTexSize, ${k}, uGlobalMinMaxHeight.x, uGlobalMinMaxHeight.y, logarithmic, logBase, logBoundary, demValid${k});
      } else {
        normalized_h = sampleElevationNearest(uTextures[${k}], texUv${k}, demTexSize, ${k}, uGlobalMinMaxHeight.x, uGlobalMinMaxHeight.y, logarithmic, logBase, logBoundary, demValid${k});
      }

      // Sample from 2D colorMap atlas: x = normalized height, y = layer's row index
      texColor${k} = vec4(texture2D(uColorMapTexture, vec2(normalized_h, colorMapY)).rgb, demValid${k} ? 1.0 : 0.0);
    } else {
      texColor${k} = texture2D(uTextures[${k}], texUv${k}) * vec4(uColors[${k}], 1.0);
    }`;
