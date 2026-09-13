// chunks/batch_definition.glsl is deliberately NOT included: it declares
// `nvr_uBatchId` as a uniform, which only works when one material draws one
// feature. Text batches every label in a tile-layer into a single draw call,
// so the id arrives per-instance as vBatchID instead — same approach as
// instancedSprite.frag.glsl.
#include "chunks/pick.glsl"

// 1.0: enable picking, 0.0: disable picking
uniform float nvr_uPickable;

#include "chunks/gbuffer_pars_fragment.glsl"

#ifndef USE_SHADOWMAP_DEPTH
    #ifdef USE_SELECTIVE_EFFECT
        uniform float uEffectIdsMask;
        uniform vec3 uEmissiveColor;
        uniform float uEmissiveIntensity;
    #endif

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

// Varyings
varying vec2 vAtlasUv;
flat varying vec2 vAtlasUvMin;
flat varying vec2 vAtlasUvMax;
varying float vFragDepth;
flat varying int vHorizonCulled;
flat varying int vBackGroundSprite;
flat varying float vBackGroundRatio;
flat varying int vIsColor;
// Per-label style, resolved in the vertex shader from the label data texture.
flat varying vec3 vColor;
// Style opacity already scaled by the declutter fade.
flat varying float vOpacity;
flat varying float vBatchID;

// Uniforms — batch-wide only.
uniform sampler2D uAtlas;
uniform sampler2D uColorAtlas;
uniform vec2 uSdfAtlasSize;
uniform float uSdfThreshold;
uniform vec3 uOutlineColor;
uniform float uOutlineWidth;
uniform float uOutlineOpacity;
uniform bool uOffsetDepth;
uniform float uFarPlane;
uniform vec3 uBackgroundColor;
uniform float uBackgroundOutlineWidth;
uniform vec3 uBackgroundOutlineColor;

float nvr_median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
}

// Distance-field range expressed in output screen pixels. Deriving this from
// UV gradients, rather than from fwidth(distance), keeps the AA width stable
// at narrow-stroke medial axes where the sampled distance gradient becomes
// zero or changes direction.
float nvr_screenPxRange() {
    vec2 uvDx = dFdx(vAtlasUv);
    vec2 uvDy = dFdy(vAtlasUv);
    vec2 uvGradient = sqrt(uvDx * uvDx + uvDy * uvDy);
    vec2 screenTexSize = vec2(1.0) / max(uvGradient, vec2(1e-6));
    vec2 unitRange =
        vec2(float(NVR_SDF_PX_RANGE)) / max(uSdfAtlasSize, vec2(1.0));
    return max(0.5 * dot(unitRange, screenTexSize), 1.0);
}

// Returns (display distance, true SDF). MTSDF uses the RGB median for sharp
// corners when large enough, then falls back to alpha's topology-safe true SDF
// as the glyph becomes too small for independent color edges to survive.
vec2 nvr_sampleDistances(vec2 atlasUv, float msdfDetail) {
    // The worker packs one zero-valued texel around every SDF glyph and the
    // glyph bounds identify the inner edge of that padding ring. Clamp to the
    // boundary itself: bilinear filtering then mixes with the transparent
    // padding texel while still being unable to reach a neighbouring glyph.
    // Moving the clamp half a texel inward would instead repeat the outermost
    // distance texel, making the rectangular glyph quad faintly visible.
    vec2 clampedUv = clamp(atlasUv, vAtlasUvMin, vAtlasUvMax);

    #ifdef USE_MSDF
        vec4 sampleValue = texture2D(uAtlas, clampedUv);
        float msdf = nvr_median(
            sampleValue.r,
            sampleValue.g,
            sampleValue.b
        );
        return vec2(mix(sampleValue.a, msdf, msdfDetail), sampleValue.a);
    #else
        float sdf = texture2D(uAtlas, clampedUv).r;
        return vec2(sdf, sdf);
    #endif
}

// Linear one-screen-pixel coverage. Unlike smoothstep(threshold ± fwidth),
// this does not accidentally spend two pixels on the transition.
float nvr_edgeCoverage(
    float distanceValue,
    float edge,
    float screenPxRange
) {
    return clamp(
        screenPxRange * (distanceValue - edge) + 0.5,
        0.0,
        1.0
    );
}

void main() {
    // Horizon culling discard
    if (vHorizonCulled == 1) discard;

    // Per-label style opacity, already scaled by the declutter fade in the
    // vertex shader.
    float opacity = vOpacity;

    // Logarithmic depth buffer
    // When offsetDepth is enabled, multiply input by 0.8 to shift depth slightly
    // closer to camera.
    float depthInput = uOffsetDepth ? vFragDepth * 0.8 : vFragDepth;
    gl_FragDepth = log(depthInput) / log(uFarPlane + 1.0);
    gl_FragDepth = clamp(gl_FragDepth + 0.0001, 0.0, 1.0);
    // Picking mode
    if (nvr_uPickable > 0.0) {
        gl_FragColor = vec4(nvr_batchIdToColor(vBatchID), 1.0);
        return;
    }
    
    if (vBackGroundSprite == 1) {
        vec2 p = abs(vAtlasUv - vec2(0.5));

        if ((p.x > (0.5 - uBackgroundOutlineWidth / vBackGroundRatio)) ||
            (p.y > (0.5 - uBackgroundOutlineWidth))) {
            gl_FragColor = vec4(uBackgroundOutlineColor, opacity);
        } else {
            gl_FragColor = vec4(uBackgroundColor, opacity);
        }

        return;
    }

    // Color glyph path: sample the COLRv1 RGBA atlas directly. The pre-rasterized
    // bitmap already encodes shape, anti-aliasing, gradients and palette colors —
    // SDF math, outline, and the label color are all bypassed.
    if (vIsColor == 1) {
        vec4 c = texture2D(uColorAtlas, vAtlasUv);
        if (c.a <= 0.0) discard;
        c.a *= opacity; // Apply text opacity (incl. declutter fade)
        gl_FragColor = c;

        #ifndef USE_SHADOWMAP_DEPTH
            vec3 normal = screenSpaceNormal();
            GBUFFER_WRITE_NORMAL(normal, 0.0, 1.0)
            #ifdef USE_SELECTIVE_EFFECT
                // Per-feature emissive (batch texture) replaces the material
                // term; the glyph's own coverage scales it so soft edges
                // don't bloom at full strength.
                GBUFFER_WRITE_EFFECT(uEffectIdsMask, NVR_BATCH_EMISSIVE_OR((vColor + uEmissiveColor) * uEmissiveIntensity) * c.a)
            #else
                GBUFFER_WRITE_EFFECT_ZERO
            #endif
            GBUFFER_WRITE_SHADOW_ZERO
        #endif
        return;
    }

    float screenPxRange = nvr_screenPxRange();
    float projectedPpem =
        screenPxRange *
        (float(NVR_SDF_PX_SIZE) / float(NVR_SDF_PX_RANGE));

    #ifdef USE_MSDF
        float msdfDetail = smoothstep(
            float(NVR_MSDF_TRUE_SDF_END_PPEM),
            float(NVR_MSDF_FULL_DETAIL_PPEM),
            projectedPpem
        );
    #else
        float msdfDetail = 0.0;
    #endif

    float outlineWidth = clamp(uOutlineWidth, 0.0, 0.4);
    // Correct area coverage can make a subpixel stem mathematically accurate
    // but perceptually too light. Expand only the fill by at most 0.15 screen
    // pixels per side, fading the adjustment out by normal text sizes.
    float stemDarkeningPx =
        float(NVR_SMALL_TEXT_DARKEN_MAX_PX) *
        (
            1.0 - smoothstep(
                float(NVR_SMALL_TEXT_DARKEN_FULL_PPEM),
                float(NVR_SMALL_TEXT_DARKEN_END_PPEM),
                projectedPpem
            )
        );
    float fillEdge =
        uSdfThreshold - (stemDarkeningPx / screenPxRange);
    float outerEdge = uSdfThreshold - outlineWidth;
    vec2 centerDistances = nvr_sampleDistances(vAtlasUv, msdfDetail);
    float fillAlpha = nvr_edgeCoverage(
        centerDistances.x,
        fillEdge,
        screenPxRange
    );
    float outlineAlpha = nvr_edgeCoverage(
        centerDistances.y,
        outerEdge,
        screenPxRange
    );

    // A center sample cannot integrate several thin strokes/counters inside
    // one screen pixel — the failure mode that makes small CJK look muddy or
    // incomplete. Four taps at the subpixel quadrant centers approximate that
    // area coverage. Fade the extra work out by 32 ppem so large text retains
    // the single-sample MTSDF result without an LOD pop.
    float supersampleBlend = 1.0 - smoothstep(
        float(NVR_SMALL_TEXT_SS_FULL_PPEM),
        float(NVR_SMALL_TEXT_SS_END_PPEM),
        projectedPpem
    );
    if (supersampleBlend > 0.0) {
        vec2 uvDx = dFdx(vAtlasUv);
        vec2 uvDy = dFdy(vAtlasUv);
        vec2 sample0 = nvr_sampleDistances(
            vAtlasUv - 0.25 * uvDx - 0.25 * uvDy,
            msdfDetail
        );
        vec2 sample1 = nvr_sampleDistances(
            vAtlasUv + 0.25 * uvDx - 0.25 * uvDy,
            msdfDetail
        );
        vec2 sample2 = nvr_sampleDistances(
            vAtlasUv - 0.25 * uvDx + 0.25 * uvDy,
            msdfDetail
        );
        vec2 sample3 = nvr_sampleDistances(
            vAtlasUv + 0.25 * uvDx + 0.25 * uvDy,
            msdfDetail
        );

        float supersampledFill = (
            nvr_edgeCoverage(sample0.x, fillEdge, screenPxRange) +
            nvr_edgeCoverage(sample1.x, fillEdge, screenPxRange) +
            nvr_edgeCoverage(sample2.x, fillEdge, screenPxRange) +
            nvr_edgeCoverage(sample3.x, fillEdge, screenPxRange)
        ) * 0.25;
        float supersampledOutline = (
            nvr_edgeCoverage(sample0.y, outerEdge, screenPxRange) +
            nvr_edgeCoverage(sample1.y, outerEdge, screenPxRange) +
            nvr_edgeCoverage(sample2.y, outerEdge, screenPxRange) +
            nvr_edgeCoverage(sample3.y, outerEdge, screenPxRange)
        ) * 0.25;

        fillAlpha = mix(fillAlpha, supersampledFill, supersampleBlend);
        outlineAlpha = mix(
            outlineAlpha,
            supersampledOutline,
            supersampleBlend
        );
    }

    if (outlineWidth > 0.0) {
        if (outlineAlpha <= 0.0) discard;

        // Composite the fill over the outline. Weighting the outline color by
        // its actual alpha is essential for small, partially covered strokes:
        // a plain color mix washes them toward a translucent outline's color.
        float outlineLayer = outlineAlpha * uOutlineOpacity;
        float behindFill = outlineLayer * (1.0 - fillAlpha);
        float alpha = fillAlpha + behindFill;
        vec3 color = alpha > 0.0
            ? (
                vColor * fillAlpha +
                uOutlineColor * behindFill
            ) / alpha
            : vColor;
        alpha *= opacity;
        // A fully faded label (or a transparent outline outside the fill)
        // must not occlude later geometry when depthWrite is enabled.
        if (alpha <= 0.0) discard;
        // Pull the FILL toward the camera (SMALLER depth = nearer). Outline pixels
        // (fillAlpha≈0) get no pull and stay at the base label depth — coplanar with
        // the background quad. Net effect, with depthWrite enabled:
        //   • a neighbouring glyph's fill (nearer) occludes this glyph's outline → seams hidden
        //   • the fill also sits in front of the background quad
        //   • outline stays coplanar with the background, so it still draws over it
        //     via instance draw order (the background occupies the first slot
        //     of the label's glyph run, so it is drawn first).
        // AA band ramps smoothly because fillAlpha is the weight.
        gl_FragDepth = clamp(gl_FragDepth - (0.0002 * fillAlpha), 0.0, 1.0);
        gl_FragColor = vec4(color, alpha);
    } else {
        float alpha = fillAlpha * opacity;
        if (alpha <= 0.0) discard;
        gl_FragColor = vec4(vColor, alpha);
        gl_FragDepth = clamp(gl_FragDepth - 0.0001, 0.0, 1.0);
    }

    #ifndef USE_SHADOWMAP_DEPTH
        vec3 normal = screenSpaceNormal();
        GBUFFER_WRITE_NORMAL(normal, 0.0, 1.0)
        #ifdef USE_SELECTIVE_EFFECT
            // FILL-only emissive: outline pixels (fillAlpha≈0) stay dark, and
            // the fill's coverage (and the label's fade) scales the term so
            // AA edges don't halo.
            GBUFFER_WRITE_EFFECT(uEffectIdsMask, NVR_BATCH_EMISSIVE_OR((vColor + uEmissiveColor) * uEmissiveIntensity) * fillAlpha * opacity)
        #else
            GBUFFER_WRITE_EFFECT_ZERO
        #endif
        GBUFFER_WRITE_SHADOW_ZERO
    #endif
}
