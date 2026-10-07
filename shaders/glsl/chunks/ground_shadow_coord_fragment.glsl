// Shades and receives directional shadows at the ground point instead of this
// fragment, for the rest of `main`. Requires `nvrGroundViewPosition` (the
// ground point's `vViewPosition`, i.e. its negated eye position) and
// `nvrGroundShadowNormal` (view space, for the normal bias), plus
// chunks/ground_shadow_coord_pars_fragment. Point and spot light shadows keep
// the fragment's own coordinates.
#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
    vec4 nvrGroundShadowCoord[NUM_DIR_LIGHT_SHADOWS];
    #pragma unroll_loop_start
    for (int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i++) {
        // Unrolled without a scope per iteration, so the block supplies one.
        {
            // The biased position <shadowmap_vertex> would use, in eye space.
            vec3 nvrShadowPositionEc = -nvrGroundViewPosition
                + nvrGroundShadowNormal * directionalLightShadows[i].shadowNormalBias;
            #ifdef NVR_VIEW_SPACE_SHADOW
                #if UNROLLED_LOOP_INDEX < CSM_CASCADE_COUNT
                    nvrGroundShadowCoord[i] = nvrCsmShadowMatrixView[i] * vec4(nvrShadowPositionEc, 1.0);
                #else
                    nvrGroundShadowCoord[i] = nvrWorldShadowCoord(directionalShadowMatrix[i], nvrShadowPositionEc);
                #endif
            #else
                nvrGroundShadowCoord[i] = nvrWorldShadowCoord(directionalShadowMatrix[i], nvrShadowPositionEc);
            #endif
        }
    }
    #pragma unroll_loop_end
    #define vDirectionalShadowCoord nvrGroundShadowCoord
#endif
#define vViewPosition nvrGroundViewPosition
