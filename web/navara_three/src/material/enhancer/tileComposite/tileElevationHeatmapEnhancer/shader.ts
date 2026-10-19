import ElevationParsFragment from "@shaders/glsl/chunks/elevation_pars_fragment.glsl";

import type { CompositeSlotContext } from "../tileCompositeBaseEnhancer";

export const elevationSlotUniformDecls = (numTextures: number): string =>
  `uniform bool uIsElevationHeatmaps[${numTextures}];
uniform bool uElevationHeatmapUsesBilinear[${numTextures}];`;

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
    if (uIsElevationHeatmaps[${k}]) {
      ivec2 demTexSize = textureSize(uTextures[${k}], 0);
      bool demValid${k};
      float normalized_h;
      if (uElevationHeatmapUsesBilinear[${k}]) {
        normalized_h = sampleElevationBilinear(uTextures[${k}], texUv${k}, demTexSize, demValid${k});
      } else {
        normalized_h = sampleElevationNearest(uTextures[${k}], texUv${k}, demTexSize, demValid${k});
      }
      texColor${k} = vec4(texture2D(uColorMapTexture, vec2(normalized_h, 0.5)).rgb, demValid${k} ? 1.0 : 0.0);
    } else {
      texColor${k} = texture2D(uTextures[${k}], texUv${k}) * vec4(uColors[${k}], 1.0);
    }`;
