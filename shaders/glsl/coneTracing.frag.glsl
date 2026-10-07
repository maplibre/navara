#include <common>
#include <packing>

#include "core/packing"
#include "core/depth"
#include "core/transform"

uniform sampler2D uDepthBuffer;             // Depth buffer
uniform sampler2D inputBuffer;              // Input buffer
uniform sampler2D uColorBuffer;             // Color buffer (mipmapped, pre-convolved)
uniform sampler2D uRayTracingBuffer;        // Ray tracing results from SSR pass
uniform sampler2D uNormalBuffer;            // View-space normals
// Declared to match ConeTracingMaterial's public parameters; nothing reads
// them yet - F0 comes from the normal buffer and there is no fallback probe.
uniform sampler2D uSpecularBuffer;          // rgb=F0 (or IOR-converted), a=roughness
uniform sampler2D uIndirectSpecularBuffer;  // Fallback indirect specular

uniform vec2  uBufferSize;          // (width, height) of uColorBuffer in pixels
uniform vec2  uRayTexelSize;        // 1 / (width, height) of uRayTracingBuffer
uniform int   uNumMips;             // total mip levels in uColorBuffer
uniform float uPrefilterExposure;   // exposure uColorBuffer was compressed with
uniform float uFadeStart;           // cb_fadeStart
uniform float uFadeEnd;             // cb_fadeEnd
uniform float uMaxDistance;         // cb_maxDistance
uniform float cameraNear;
uniform float cameraFar;
uniform mat4  inverseProjectionMatrix; // inverse of projection matrix
uniform mat4  projectionMatrix; // inverse of projection matrix

in vec2 vUv;

// --- constants / helpers ---
const float XI = 0.244;                          // used in cone angle

float readDepth(const vec2 uv) {
  #if DEPTH_PACKING == 3201
  return unpackRGBAToDepth(texture2D(uDepthBuffer, uv));
  #else
  return texture2D(uDepthBuffer, uv).r;
  #endif // DEPTH_PACKING == 3201
}

float getViewZ(const float depth) {
  #ifdef PERSPECTIVE_CAMERA
  return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  #else
  return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
  #endif
}

// Ref: https://graphicrants.blogspot.com/2013/08/specular-brdf-reference.html
float roughnessToSpecularPower( float r ) {
    float a = r * r;
    return max(2.0 / (a * a) - 2.0, 0.0);
}

// Constant normal incidence Fresnel factor for all dielectrics.
const vec3 Fdielectric = vec3(0.04);

vec3 fresnelSchlick( vec3 F0, float cosTheta ) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

float specularPowerToConeAngle( float specularPower ) {
    float exponent = 1.0 / (specularPower + 1.0);
    return acos(pow(XI, exponent));
}

float isoscelesTriangleOpposite( float adjacentLength, float coneTheta ) {
    return 2.0 * tan(coneTheta) * adjacentLength;
}

float isoscelesTriangleInRadius( float a, float h ) {
    float a2 = a * a;
    float fh2 = 4.0 * h * h;
    return (a * (sqrt(a2 + fh2) - a)) / (4.0 * h);
}

float isoscelesTriangleNextAdjacent( float adjacentLength, float incircleRadius ) {
    return adjacentLength - (incircleRadius * 2.0);
}

float readViewZ(const vec2 uv) {
    return getViewZ(reverseLogDepth(readDepth(uv), cameraNear, cameraFar));
}

// Ref: https://willpgfx.com/2015/07/screen-space-glossy-reflections/
void main() {
    vec2 pixel = vUv;

    vec4 packedNormal = texture2D(uNormalBuffer, pixel); // xy: compressed normal, z: F0, w: roughness

    // Nothing reflective here, so no neighbour can lend this pixel a
    // reflection either. Bailing on one fetch keeps the gather below off the
    // sky and every opaque surface, which is most of the screen. Roughness 1
    // zeroes fadeOnRoughness below, so it is skipped here as well.
    if (packedNormal.z < 0.01 || packedNormal.w >= 1.0) {
        gl_FragColor = vec4(0.0);
        return;
    }

    float depth = readDepth(vUv);
    depth = reverseLogDepth(depth, cameraNear, cameraFar);
    float viewZ = getViewZ(depth);
    vec3 viewPosition = screenToView(
        vUv,
        depth,
        viewZ,
        projectionMatrix,
        inverseProjectionMatrix
    );

    // Resolve: gather the ray results of the neighbourhood, not just this
    // pixel's own. One ray per pixel makes reflecting a binary, per-pixel
    // decision, so its silhouette comes out hard-edged and - once the rays are
    // jittered - dithered into blocks. Cone tracing cannot undo that: it
    // prefilters the colour a ray already found, and a pixel whose ray missed
    // never reaches the cone loop at all. Averaging the neighbours turns the
    // decision into a continuous coverage and makes each jittered ray an extra
    // sample of the same lobe for everyone around it, which is what makes
    // jitter worth having.
    // Ref: Stachowiak, "Stochastic Screen-Space Reflections", SIGGRAPH 2015.
    //      https://advances.realtimerendering.com/s2015/Stochastic%20Screen-Space%20Reflections.pptx
    const int radius = RESOLVE_KERNEL / 2;
    float sigma = max(1.0, float(radius));

    vec2 hitUV = vec2(0.0);
    float hitDepth = 0.0;
    float fade = 0.0;
    float validWeight = 0.0;
    float totalWeight = 0.0;

    for (int y = -radius; y <= radius; ++y) {
        for (int x = -radius; x <= radius; ++x) {
            vec2 offset = vec2(float(x), float(y));
            float spatial = exp(-dot(offset, offset) / (2.0 * sigma * sigma));
            vec2 tapUV = vUv + offset * uRayTexelSize;

            // Only consider rays cast from the same surface as ours, using the
            // relative view-Z falloff the fog light's joint bilateral upsample
            // uses, so a silhouette doesn't drag another object's reflections
            // in. This gates the tap before validity so that a neighbourhood
            // sitting entirely on our own surface resolves to full coverage no
            // matter how the surface curves away.
            float diff = abs(readViewZ(tapUV) - viewZ) / max(abs(viewZ), 1e-3);
            float weight = spatial * exp(-diff * 8.0);
            totalWeight += weight;

            // Negative depth marks a ray that found nothing. Counting it in
            // totalWeight but not validWeight is what pulls coverage towards
            // zero at the edge of a reflection instead of cutting it off.
            vec4 tap = texture2D(uRayTracingBuffer, tapUV);
            if (tap.z < 0.0) {
                continue;
            }

            hitUV += tap.xy * weight;
            hitDepth += tap.z * weight;
            fade += tap.w * weight;
            validWeight += weight;
        }
    }

    if (validWeight <= 1e-4) {
        gl_FragColor = vec4(0.0);
        return;
    }

    float coverage = validWeight / max(totalWeight, 1e-4);
    hitUV /= validWeight;
    hitDepth /= validWeight;
    fade /= validWeight;

    vec3 normalVS = unpackVec2ToNormal(packedNormal.xy);

    // B is the surface's reflectance at normal incidence (F0).
    vec4 specularAll = vec4(vec3(packedNormal.z), packedNormal.w);

    vec3 toViewPosition = normalize(viewPosition);

    float gloss = 1.0 - specularAll.a;
    float specularPower = roughnessToSpecularPower(specularAll.a);
    // The 0.25 is not in the derivation — specularPowerToConeAngle already
    // returns a half-angle, of the cone holding ~76% of the lobe's energy.
    // Without it reflections visibly over-blur, because the roughness the
    // G-buffer carries for water (0.4, sized for the wave slopes the sun glint
    // needs) is far above what a mirror-like reflection wants (0.02–0.05), and
    // the mips the cone reads average across depth, so a wide cone melts
    // neighbouring surfaces into each other.
    float coneTheta = specularPowerToConeAngle(specularPower) * 0.25;

    // P1 = current pixel, P2 = resolved hit. The cone is laid out in pixels:
    // UV units are anisotropic, so a disc radius measured in them over- or
    // under-states the blur depending on the ray's screen direction.
    vec2 deltaP = (hitUV - vUv) * uBufferSize;
    float adjacentLength = length(deltaP);
    vec2 adjacentUnit = (adjacentLength > 0.0) ? (deltaP / adjacentLength) : vec2(0.0);
    // The resolved hit can land on this very pixel; a zero-height triangle
    // has no incircle (0 / 0), so keep the cone a sliver long.
    adjacentLength = max(adjacentLength, 1e-3);

    vec4 colorSum = vec4(0.0);
    float remaining = 1.0;
    float maxMipLevel = float(uNumMips) - 1.0;
    float glossMult = gloss;

    // Approximate cone tracing in screen space with isosceles triangle
    for (int i = 0; i < ITERATION; ++i) {
        float oppositeLength = isoscelesTriangleOpposite(adjacentLength, coneTheta);
        float incircleSize = isoscelesTriangleInRadius(oppositeLength, adjacentLength);

        vec2 samplePos = vUv + adjacentUnit * (adjacentLength - incircleSize) / uBufferSize;

        float mipChannel = clamp(log2(incircleSize), 0.0, maxMipLevel);

        // Clip the last disc against what is left of the budget so the weights
        // sum to exactly 1 once the cone is covered. The previous form scaled
        // only the colour by `1 - abs(remainingAlpha)`, which is not the factor
        // that closes the sum, and left the accumulated weight overshooting.
        float weight = min(glossMult, remaining);
        colorSum += textureLod(uColorBuffer, samplePos, mipChannel) * weight;
        remaining -= weight;

        if (remaining <= 0.0) {
            break;
        }

        adjacentLength = isoscelesTriangleNextAdjacent(adjacentLength, incircleSize);
        glossMult *= gloss;
    }

    vec3 toEye = -toViewPosition;
    float ndotV = clamp(abs(dot(normalVS, toEye)), 0.0, 1.0);
    vec3 specularF = F_Schlick(specularAll.rgb, 1.0, ndotV);

    // fades
    vec2 boundary = abs(hitUV - vec2(0.5)) * 2.0;
    float fadeDiffRcp = 1.0 / (uFadeEnd - uFadeStart);
    float fadeOnBorder = 1.0 - clamp((boundary.x - uFadeStart) * fadeDiffRcp, 0.0, 1.0);
    fadeOnBorder *= 1.0 - clamp((boundary.y - uFadeStart) * fadeDiffRcp, 0.0, 1.0);
    fadeOnBorder = smoothstep(0.0, 1.0, fadeOnBorder);

    float rayDepth = reverseLogDepth(hitDepth, cameraNear, cameraFar);

    vec3 rayHitViewPosition = screenToView(
        hitUV,
        rayDepth,
        getViewZ(rayDepth),
        projectionMatrix,
        inverseProjectionMatrix
    );
    float fadeOnDistance = 1.0 - clamp(distance(rayHitViewPosition, viewPosition) / uMaxDistance, 0.0, 1.0);

    float fadeOnPerpendicular = clamp(mix(0.0, 1.0, clamp(fade * 4.0, 0.0, 1.0)), 0.0, 1.0);
    float fadeOnRoughness    = clamp(mix(0.0, 1.0, clamp(gloss * 4.0, 0.0, 1.0)), 0.0, 1.0);
    float totalFade = coverage * fadeOnBorder * fadeOnDistance * fadeOnPerpendicular * fadeOnRoughness;

    // Weighted average of the cone's discs, normalised by the accumulated
    // alpha: that is the sum of the weights wherever the footprint is all
    // geometry, and otherwise renormalises over the geometry left once the
    // prefilter's sky mask drops the rest. The division matters once the
    // gloss^k series stops reaching 1, which happens below gloss 0.5 (roughness
    // above 0.5): the colour would otherwise stay scaled by a weight under one.
    vec3 conedColor = colorSum.rgb / max(colorSum.a, 1e-4);
    // Share of the footprint that is geometry. A footprint all on sky has
    // nothing to reflect, and must not replace the surface colour with black.
    float geometryCoverage = colorSum.a / max(1.0 - remaining, 1e-4);
    // Undo the prefilter's compression (coneTracingPrefilter.frag.glsl).
    float conedLuma = dot(conedColor, vec3(0.2126, 0.7152, 0.0722));
    conedColor /= max(1.0 - conedLuma * uPrefilterExposure, 1e-4);

    // Premultiplied so the composite can filter this buffer when it upsamples:
    // interpolating a premultiplied colour across the edge of a reflection is
    // exact, whereas straight colour would drag reflection into pixels whose
    // coverage is on its way to zero.
    // Alpha carries the Fresnel term too, so the composite replaces only the
    // share of the surface colour that is specular reflection - at normal
    // incidence water keeps its own colour and reflects 2%.
    float reflectance = specularF.g * totalFade * geometryCoverage;
    gl_FragColor = vec4(conedColor * reflectance, reflectance);
}