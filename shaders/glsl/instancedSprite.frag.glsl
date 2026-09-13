#include "point.frag.glsl"
#include "chunks/pick.glsl"
#ifdef BILLBOARD
    uniform sampler2D uTexture;
#endif

#include "chunks/gbuffer_pars_fragment.glsl"

#ifndef USE_SHADOWMAP_DEPTH
    #ifdef USE_SELECTIVE_EFFECT
        uniform float uEffectIdsMask;
        uniform vec3 uEmissiveColor;
        uniform float uEmissiveIntensity;
    #endif

    // Pack normal to vec2 for MRT
    vec2 packNormalToVec2(vec3 normal) {
        return normal.xy * 0.5 + 0.5;
    }

    vec3 screenSpaceNormal() {
        vec3 fdx = dFdx(gl_FragCoord.xyz);
        vec3 fdy = dFdy(gl_FragCoord.xyz);
        vec3 normal = normalize(cross(fdx, fdy));
        if (normal.z < 0.0) normal = -normal;
        return normal;
    }
#endif

varying vec2 vUv;
varying vec3 vColor;
flat varying float vBatchID;
varying float vFragDepth;
varying float vOpacity;

uniform bool uOffsetDepth;
uniform float nvr_uPickable;
uniform float uAlphaTest;
uniform float uFarPlane;

void main() {
    // Logarithmic depth buffer
    gl_FragDepth = log(vFragDepth) / log(uFarPlane + 1.0);

    // Offset depth to make sure to be drawn over ellipsoid surface
    if (uOffsetDepth) { gl_FragDepth -= 0.01; }

    float alphaForTest = 1.0;
    float alphaForColor = 1.0;
    #ifdef BILLBOARD
        // vUv already targets this instance's atlas sub-rect (see vertex shader)
        vec4 color = texture(uTexture, vUv);
        // Tint RGB only, preserve texture alpha (avoid squaring alpha)
        color.rgb *= vColor;
        alphaForTest = color.a;
        alphaForColor = color.a * vOpacity;
    #else
        alphaForTest = nvr_circle_alpha(vUv - vec2(0.5));
        alphaForColor = vOpacity;
        vec4 color = vec4(vColor, 1.0);
    #endif

    if (alphaForTest <= uAlphaTest) { discard; };
    
    if (nvr_uPickable > 0.0 && alphaForTest > 0.0) {
        vec3 pickColor = nvr_batchIdToColor(vBatchID);
        color = vec4(pickColor.xyz, 1.0);
    } else {
        color.a = alphaForColor;
    }

    gl_FragColor = color;

    #ifndef USE_SHADOWMAP_DEPTH
        // Calculate screen-space normal for MRT compatibility
        vec3 normal = screenSpaceNormal();
        GBUFFER_WRITE_NORMAL(normal, 0.0, 1.0)

        #ifdef USE_SELECTIVE_EFFECT
            // Per-feature emissive (batch texture) replaces the material term.
            GBUFFER_WRITE_EFFECT(uEffectIdsMask, NVR_BATCH_EMISSIVE_OR((color.rgb + uEmissiveColor) * uEmissiveIntensity) * alphaForColor)
        #else
            GBUFFER_WRITE_EFFECT_ZERO
        #endif

        GBUFFER_WRITE_SHADOW_ZERO
    #endif
}