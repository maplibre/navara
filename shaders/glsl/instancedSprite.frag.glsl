#include "point.frag.glsl"
#include "chunks/pick.glsl"
#ifdef BILLBOARD
    uniform sampler2D uTexture;
    flat varying float vSdf;
    flat varying float vIconScale;
    flat varying vec3 vOutlineColor;
    // (opacity, width, blur), width and blur in screen pixels.
    flat varying vec3 vOutline;

    // MapLibre's SDF icon encoding: the shape's edge sits at alpha 0.75, and
    // alpha drops by 1/8 per icon pixel outward. Icon pixels are CSS pixels:
    // a `@2x` sheet spreads each step over 2 sheet pixels.
    const float SDF_EDGE = 0.75;
    const float SDF_PX = 8.0;

    // An SDF icon in `fillColor` over its halo, as MapLibre's symbol_sdf shader
    // draws it. `gamma` smooths edges over about 1.7 screen pixels
    // (MapLibre's EDGE_GAMMA).
    vec4 nvr_sdfColor(float dist, float gamma, vec3 fillColor) {
        float fill = smoothstep(SDF_EDGE - gamma, SDF_EDGE + gamma, dist);
        float opacity = vOutline.x;
        float width = vOutline.y;
        float blur = vOutline.z;
        if (width <= 0.0 || opacity <= 0.0) {
            return vec4(fillColor, fill);
        }
        // Distances are in icon pixels; the halo's are in screen pixels.
        float scale = max(vIconScale, 1e-4);
        float haloGamma = blur * 1.19 / (SDF_PX * scale) + gamma;
        float inner = SDF_EDGE + haloGamma;
        float haloInner = smoothstep(inner - haloGamma, inner + haloGamma, dist);
        float haloEdge = SDF_EDGE - width / (SDF_PX * scale);
        // The field ends at alpha 0, where MapLibre's halo would fill the
        // icon's whole box: fade out there over about a screen pixel instead.
        float fieldEnd = smoothstep(0.0, 2.0 * gamma, dist);
        float halo = opacity * fieldEnd * min(
            smoothstep(haloEdge - haloGamma, haloEdge + haloGamma, dist),
            1.0 - haloInner
        );
        float alpha = fill + (1.0 - fill) * halo;
        vec3 rgb = (fillColor * fill + vOutlineColor * halo * (1.0 - fill))
            / max(alpha, 1e-4);
        return vec4(rgb, alpha);
    }
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

#include "chunks/label_depth_pars_fragment.glsl"

void main() {
    // Logarithmic depth buffer
    float logDepth = log(vFragDepth) / log(uFarPlane + 1.0);

    // Offset depth to make sure to be drawn over ellipsoid surface
    if (uOffsetDepth) { logDepth -= 0.01; }
    gl_FragDepth = nvr_fromLogDepth(logDepth, uFarPlane);

    float alphaForTest = 1.0;
    float alphaForColor = 1.0;
    #ifdef BILLBOARD
        // vUv already targets this instance's atlas sub-rect (see vertex shader)
        vec4 color = texture(uTexture, vUv);
        // Outside the branch: derivatives need every pixel of the quad.
        float sdfGamma = max(
            0.84 * length(vec2(dFdx(color.a), dFdy(color.a))),
            1e-4
        );
        if (vSdf > 0.5) {
            // The shape takes the material color; the sheet's RGB is unused.
            color = nvr_sdfColor(color.a, sdfGamma, vColor);
        } else {
            // Tint RGB only, preserve texture alpha (avoid squaring alpha)
            color.rgb *= vColor;
        }
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
    #ifdef OPAQUE
        // three draws `transparent: false` without blending, so a lower alpha
        // would reach the canvas and show the page through it.
        color.a = 1.0;
    #endif

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