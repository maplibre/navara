import ElevationParsFragment from "@shaders/glsl/chunks/elevation_pars_fragment.glsl";

import type { CompositeSlotContext } from "../tileCompositeBaseEnhancer";

export const elevationSlotUniformDecls = (numTextures: number): string =>
  `// Packed elevation heatmap params: (isElevationHeatmap, usesBilinear, colorMapRow, logBoundary)
uniform vec4 uElevationHeatmapParams[${numTextures}];
uniform vec2 uElevationColorRamps[${numTextures}];  // Per-layer (stopCount, hasColorStops)
uniform vec2 uElevationMinMaxHeights[${numTextures}];  // Per-layer (min, max) normalization range
uniform vec4 uElevationRGBScalersAndBoundaries[${numTextures}];  // (r, g, b, boundary)
uniform vec4 uElevationDecoderOffsets[${numTextures}];  // (minOffset, maxOffset, epsilon, offset)`;

export const elevationIncludes = (): string => ElevationParsFragment;

/**
 * Replaces the per-slot sampler with a DEM-decode + colormap lookup; slots that are
 * not elevation heatmaps fall back to the straight raster fetch in the else branch.
 *
 * The color comes from the layer's color ramp row (`sampleColorRamp`): with
 * `colorStops` the decoded height in meters is matched against the stops,
 * otherwise the height normalized by minHeight/maxHeight (and logarithmic
 * scaling) is matched against evenly spaced 0..1 stops.
 *
 * The elevation heatmap alpha is the colorMap's alpha, zeroed by the decode's validity:
 * a no-data (boundary) texel — including a baked drape render target's uncovered regions, which the
 * bake paints with the boundary color — renders transparent instead of being
 * colormapped as height 0. The DEM texel's alpha channel is never read: it is
 * not part of any elevation encoding and stays reserved for future RGBA ones.
 *
 * Filter mode: uElevationHeatmapParams[k].y (usesBilinear) selects the DEM sampling.
 * - 1 (linear): bilinear interpolation in decoded height space for smooth transitions
 * - 0 (nearest): nearest neighbor sampling for sharp boundaries
 */
export const elevationSampleProducer = ({
  k,
}: CompositeSlotContext): string => `
    vec4 texColor${k};
    // Extract packed params: (isElevationHeatmap, usesBilinear, colorMapRow, logBoundary)
    vec4 params${k} = uElevationHeatmapParams[${k}];
    bool isElevationHeatmap${k} = params${k}.x > 0.5;

    if (isElevationHeatmap${k}) {
      bool usesBilinear${k} = params${k}.y > 0.5;
      float logBoundary = params${k}.w;

      ivec2 demTexSize = textureSize(uTextures[${k}], 0);
      bool demValid${k};
      float h${k} = usesBilinear${k}
        ? sampleElevationBilinear(uTextures[${k}], texUv${k}, demTexSize, ${k}, demValid${k})
        : sampleElevationNearest(uTextures[${k}], texUv${k}, demTexSize, ${k}, demValid${k});

      // Ramp key: the height itself for colorStops (meters), otherwise the
      // height normalized with the layer's own minHeight/maxHeight and
      // logarithmic scaling (0 = off, >0 = on with boundary value).
      vec2 ramp${k} = uElevationColorRamps[${k}];
      float key${k} = h${k};
      if (ramp${k}.y < 0.5) {
        bool logarithmic = logBoundary > 0.0;
        float logBase = logarithmic ? log(logBoundary) : 1.0;  // ln(boundary)
        vec2 minMax${k} = uElevationMinMaxHeights[${k}];
        key${k} = normalizeElevationHeight(h${k}, minMax${k}.x, minMax${k}.y, logarithmic, logBase, logBoundary);
      }

      // The ramp's (straight) alpha is kept; no-data texels stay transparent.
      vec4 mapped${k} = sampleColorRamp(int(params${k}.z), int(ramp${k}.x), key${k});
      texColor${k} = vec4(mapped${k}.rgb, demValid${k} ? mapped${k}.a : 0.0);
    } else {
      texColor${k} = texture2D(uTextures[${k}], texUv${k}) * vec4(uColors[${k}], 1.0);
    }`;
