// Shadow matrices for chunks/ground_shadow_coord_fragment. The vertex shader
// declares the same uniforms, which a program shares between its stages.
#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
    // Set by navara_three_csm (applyViewSpaceShadowReceive) when the vertex
    // shader samples the cascades from the view-space position; mirrors its
    // CSM_CASCADE_COUNT fallback.
    #ifdef NVR_VIEW_SPACE_SHADOW
        #ifndef CSM_CASCADE_COUNT
            #define CSM_CASCADE_COUNT NUM_DIR_LIGHT_SHADOWS
        #endif
        uniform mat4 nvrCsmShadowMatrixView[CSM_CASCADE_COUNT];
    #endif
    uniform mat4 directionalShadowMatrix[NUM_DIR_LIGHT_SHADOWS];

    // <shadowmap_vertex>'s world-space path for an eye-space position.
    vec4 nvrWorldShadowCoord(mat4 shadowMatrix, vec3 positionEc) {
        return shadowMatrix * vec4(cameraPosition + (vec4(positionEc, 0.0) * viewMatrix).xyz, 1.0);
    }
#endif
