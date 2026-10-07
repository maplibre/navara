// Research and development by https://github.com/takram-design-engineering

// Based on the following work and adapted to Three.js.
// https://github.com/kode80/kode80SSR/blob/master/Assets/Resources/Shaders/SSR.shader
//
//  Copyright (c) 2015, Ben Hopkins (kode80)
//  All rights reserved.
//
//  Redistribution and use in source and binary forms, with or without modification,
//  are permitted provided that the following conditions are met:
//
//  1. Redistributions of source code must retain the above copyright notice,
//     this list of conditions and the following disclaimer.
//
//  2. Redistributions in binary form must reproduce the above copyright notice,
//     this list of conditions and the following disclaimer in the documentation
//     and/or other materials provided with the distribution.
//
//  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
//  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
//  MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
//  THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
//  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT
//  OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
//  HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
//  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
//  EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

#include <common>
#include <packing>

#include "core/depth"
#include "core/interleavedGradientNoise"
#include "core/packing"
#include "core/transform"

uniform sampler2D inputBuffer;
uniform sampler2D geometryBuffer;
uniform sampler2D depthBuffer;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float cameraNear;
uniform float cameraFar;
uniform mat4 projectionMatrix;
uniform mat4 inverseProjectionMatrix;

uniform float iterations;
uniform float binarySearchIterations;
uniform float pixelZSize;
uniform float pixelStride;
uniform float pixelStrideZCutoff;
uniform float pixelRatio;
uniform float maxRayDistance;
uniform float screenEdgeFadeStart;
uniform float eyeFadeStart;
uniform float eyeFadeEnd;
uniform float jitter;

in vec2 vUv;

// What a pixel writes when it produces no reflection. With cone tracing the
// buffer carries hit coordinates rather than colour, and .w carries a signed
// rdotv fade that legitimately goes negative at near-normal incidence — so a
// miss cannot be encoded there. A negative .z can never be a real depth, which
// leaves the resolve pass able to tell "no hit" from "hit that faces the eye".
#ifdef GENERATE_RAY_TRACING_BUFFER
#define SSR_NO_HIT vec4(0.0, 0.0, -1.0, 0.0)
#else
#define SSR_NO_HIT vec4(0.0)
#endif

float readDepth(const vec2 uv) {
  #if DEPTH_PACKING == 3201
  return unpackRGBAToDepth(texture2D(depthBuffer, uv));
  #else
  return texture2D(depthBuffer, uv).r;
  #endif // DEPTH_PACKING == 3201
}

float getViewZ(const float depth) {
  #ifdef PERSPECTIVE_CAMERA
  return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  #else
  return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
  #endif
}

void swapIfBigger(inout float aa, inout float bb) {
  if (aa > bb) {
    float tmp = aa;
    aa = bb;
    bb = tmp;
  }
}

float distanceSquared(vec2 a, vec2 b) {
  a -= b;
  return dot(a, a);
}

float readSceneViewZ(vec2 uv) {
  return getViewZ(reverseLogDepth(readDepth(uv), cameraNear, cameraFar));
}

bool rayIntersectsDepth(float zA, float zB, float sceneZMax) {
  float sceneZMin = sceneZMax - pixelZSize;
  return zB >= sceneZMin && zA <= sceneZMax;
}

// Trace a ray in screenspace from rayOrg (in camera space) pointing in
// rayDirection (in camera space) using jitter to offset the ray based on
// (jitter * pixelStride).
// Returns true if the ray hits a pixel in the depth buffer and outputs the
// hitPixel (in UV space), the hitPoint (in camera space) and the number of
// iterations it took to get there.
//
// Based on Morgan McGuire & Mike's GLSL implementation:
// http://casual-effects.blogspot.com/2014/08/screen-space-ray-tracing.html
bool traceScreenSpaceRay(
  vec3 rayOrigin,
  vec3 rayDirection,
  float jitter,
  out vec2 hitPixel,
  out vec3 hitPoint,
  out float iterationCount
) {
  // Clip to the near plane
  float rayLength =
    rayOrigin.z + rayDirection.z * maxRayDistance > -cameraNear
      ? (-cameraNear - rayOrigin.z) / rayDirection.z
      : maxRayDistance;
  vec3 rayEnd = rayOrigin + rayDirection * rayLength;

  // Project into homogeneous clip space
  vec4 H0 = projectionMatrix * vec4(rayOrigin, 1.0);
  vec4 H1 = projectionMatrix * vec4(rayEnd, 1.0);
  float k0 = 1.0 / H0.w;
  float k1 = 1.0 / H1.w;

  // The interpolated homogeneous version of the camera-space points
  vec3 Q0 = rayOrigin * k0;
  vec3 Q1 = rayEnd * k1;

  // Screen-space endpoints
  vec2 P0 = H0.xy * k0;
  vec2 P1 = H1.xy * k1;
  P0 = (P0 * 0.5 + 0.5) * resolution;
  P1 = (P1 * 0.5 + 0.5) * resolution;

  // If the line is degenerate, make it cover at least one pixel to avoid
  // handling zero-pixel extent as a special case later.
  P1 += distanceSquared(P0, P1) < 0.0001 ? 0.01 : 0.0;
  vec2 delta = P1 - P0;

  // Permute so that the primary iteration is in x to collapse all quadrant-
  // specific DDA class later.
  bool permute = false;
  if (abs(delta.x) < abs(delta.y)) {
    // This is a more-vertical line
    permute = true;
    delta = delta.yx;
    P0 = P0.yx;
    P1 = P1.yx;
  }

  float stepDirection = sign(delta.x);
  float invdx = stepDirection / delta.x;

  // Track the derivatives of Q and K
  vec3 dQ = (Q1 - Q0) * invdx;
  float dk = (k1 - k0) * invdx;
  vec2 dP = vec2(stepDirection, delta.y * invdx);

  // Calculate pixel stride based on distance of ray origin from camera.
  // Since perspective means distant objects will be smaller in screen space,
  // we can use this to have higher quality reflections for far away objects
  // while still using a large pixel stride for near objects (and increase
  // performance). This also helps mitigate artifacts on distance reflections
  // when we use a large pixel stride.
  float strideScaler = 1.0 - min(1.0, -rayOrigin.z / pixelStrideZCutoff);
  // In device pixels, so a fixed iteration budget reaches the same share of
  // the screen whatever the display density.
  float pixelStride = (1.0 + strideScaler * pixelStride) * pixelRatio;

  // Scale derivatives by the desired pixel stride and then offset the starting
  // values by the jitter fraction.
  dP *= pixelStride;
  dQ *= pixelStride;
  dk *= pixelStride;
  P0 += dP * jitter;
  Q0 += dQ * jitter;
  k0 += dk * jitter;

  float zA = 0.0;
  float zB = 0.0;

  // Track ray step and derivatives in a vec4 to parallelize.
  vec4 PQK = vec4(P0, Q0.z, k0);
  vec4 dPQK = vec4(dP, dQ.z, dk);
  bool intersect = false;
  bool refined = false;
  bool wasInFront = true;

  float count = 0.0;
  for (int i = 0; i < MAX_ITERATIONS; ++i) {
    if (float(i) >= iterations) {
      break;
    }
    if (intersect) {
      break;
    }

    PQK += dPQK;
    zA = zB;
    zB = (dPQK.z * 0.5 + PQK.z) / (dPQK.w * 0.5 + PQK.w);
    swapIfBigger(zB, zA);

    hitPixel = permute ? PQK.yx : PQK.xy;
    hitPixel *= texelSize;
    float sceneZ = readSceneViewZ(hitPixel);
    intersect = rayIntersectsDepth(zA, zB, sceneZ);

    // A strided step can carry the ray from in front of a surface to further
    // behind it than pixelZSize, which the test above reads as passing behind
    // an occluder. Surfaces seen edge-on change depth that fast, so bisect the
    // step and test the thickness where the ray actually crosses.
    float rayZ = PQK.z / PQK.w;
    if (!intersect && wasInFront && rayZ <= sceneZ) {
      vec4 front = PQK - dPQK;
      vec4 behind = PQK;
      for (int j = 0; j < MAX_BINARY_SEARCH_ITERATIONS; ++j) {
        if (float(j) >= binarySearchIterations) {
          break;
        }
        vec4 mid = 0.5 * (front + behind);
        vec2 midPixel = (permute ? mid.yx : mid.xy) * texelSize;
        if (mid.z / mid.w <= readSceneViewZ(midPixel)) {
          behind = mid;
        } else {
          front = mid;
        }
      }

      vec2 behindPixel = (permute ? behind.yx : behind.xy) * texelSize;
      float behindZ = behind.z / behind.w;
      if (rayIntersectsDepth(behindZ, behindZ, readSceneViewZ(behindPixel))) {
        intersect = true;
        refined = true;
        PQK = behind;
        hitPixel = behindPixel;
      }
    }
    wasInFront = rayZ > sceneZ;

    count = float(i);
  }

  // Binary search refinement
  if (pixelStride > 1.0 && intersect && !refined) {
    float originalStride = pixelStride * 0.5;
    float stride = originalStride;

    // The search can end on a probe that does not intersect, which near a
    // silhouette lies off the object the ray hit. Report the closest probe
    // that did.
    vec4 hitPQK = PQK;
    vec2 hitPQKPixel = hitPixel;

    PQK -= dPQK;
    dPQK /= pixelStride;
    zA = PQK.z / PQK.w;
    zB = zA;

    for (int i = 0; i < MAX_BINARY_SEARCH_ITERATIONS; ++i) {
      if (float(i) >= binarySearchIterations) {
        break;
      }

      PQK += dPQK * stride;
      zA = zB;
      zB = (dPQK.z * -0.5 + PQK.z) / (dPQK.w * -0.5 + PQK.w);
      swapIfBigger(zB, zA);

      hitPixel = permute ? PQK.yx : PQK.xy;
      hitPixel *= texelSize;

      originalStride *= 0.5;
      if (rayIntersectsDepth(zA, zB, readSceneViewZ(hitPixel))) {
        hitPQK = PQK;
        hitPQKPixel = hitPixel;
        stride = -originalStride;
      } else {
        stride = originalStride;
      }
    }

    PQK = hitPQK;
    hitPixel = hitPQKPixel;
  }

  Q0.xy += dQ.xy * count;
  Q0.z = PQK.z;
  hitPoint = Q0 / PQK.w;
  iterationCount = count;

  return intersect;
}

// https://github.com/kode80/kode80SSR
float calculateAlphaForIntersection(
  bool intersect,
  float iterationCount,
  float specularStrength,
  vec2 hitPixel,
  vec3 hitPoint,
  vec3 rayOrigin,
  vec3 rayDirection
) {
  float alpha = 1.0;
  // float alpha = min(1.0, specularStrength);

  // Fade ray hits test approach the maximum iterations.
  alpha *= 1.0 - iterationCount / iterations;

  // Fade ray hits that approach the screen edge.
  float screenFade = screenEdgeFadeStart;
  vec2 hitPixelNDC = hitPixel * 2.0 - 1.0;
  float maxDistance = min(1.0, max(abs(hitPixelNDC.x), abs(hitPixelNDC.y)));
  alpha *= 1.0 - max(0.0, maxDistance - screenFade) / (1.0 - screenFade);

  // Fade ray hits base on how much they face the camera.
  float eyeFadeStart = eyeFadeStart;
  float eyeFadeEnd = eyeFadeEnd;
  swapIfBigger(eyeFadeStart, eyeFadeEnd);
  float eyeDirection = clamp(rayDirection.z, eyeFadeStart, eyeFadeEnd);
  alpha *= 1.0 - (eyeDirection - eyeFadeStart) / (eyeFadeEnd - eyeFadeStart);

  // Fade ray hits based on distance from ray origin.
  float rayDistance = distance(rayOrigin, hitPoint);
  alpha *= 1.0 - clamp(rayDistance / maxRayDistance, 0.0, 1.0);

  alpha *= intersect ? 1.0 : 0.0;

  return alpha;
}

// TODO: Use blue noise.
vec2 whiteNoise(vec3 v) {
  v = fract(v * vec3(443.897, 441.423, 0.0973));
  v += dot(v, v.yzx + 19.19);
  return fract((v.xx + v.yz) * v.zy);
}

// Source: https://github.com/tuxalin/vulkanri/blob/master/examples/pbr_ibl/shaders/importanceSampleGGX.glsl
vec3 sampleGGX(const vec3 n, const vec2 u, float roughness) {
  float alpha = roughness * roughness;
  float alpha2 = alpha * alpha;

  float phi = 2.0 * PI * u.x;
  float cosTheta = sqrt((1.0 - u.y) / (1.0 + (alpha2 - 1.0) * u.y));
  float sinTheta = sqrt(1.0 - cosTheta * cosTheta);

  vec3 H;
  H.x = cos(phi) * sinTheta;
  H.y = sin(phi) * sinTheta;
  H.z = cosTheta;

  vec3 up = abs(n.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(up, n));
  vec3 bitangent = cross(n, tangent);

  vec3 sampleVec = tangent * H.x + bitangent * H.y + n * H.z;
  return normalize(sampleVec);
}

void main() {
  vec4 geometry = texture2D(geometryBuffer, vUv);
  float reflectance = geometry.z;
  float roughness = geometry.w;
  // Every early-out below must still write gl_FragColor. The output target is
  // never cleared (postprocessing's ShaderPass doesn't clear and the composer
  // disables autoClear), so a bare return leaves the fragment undefined, which
  // surfaces as tile-shaped garbage on tiled GPUs.
  // Same gate as coneTracing.frag.glsl, which reads this buffer's misses.
  if (reflectance < 0.01 || roughness >= 1.0) {
    gl_FragColor = SSR_NO_HIT;
    return;
  }

  float depth = readDepth(vUv);
  if (depth > 0.9999) {
    gl_FragColor = SSR_NO_HIT;
    return;
  }
  depth = reverseLogDepth(depth, cameraNear, cameraFar);
  float viewZ = getViewZ(depth);

  vec3 viewPosition = screenToView(
    vUv,
    depth,
    viewZ,
    projectionMatrix,
    inverseProjectionMatrix
  );
  vec3 viewNormal = unpackVec2ToNormal(geometry.xy);

  vec3 rayOrigin = viewPosition;
  vec3 rayDirection = reflect(normalize(rayOrigin), viewNormal);

  #ifndef GENERATE_RAY_TRACING_BUFFER
    // Scale the GGX lobe by the reflectance so barely-reflective surfaces
    // don't scatter their rays.
    float scaledRoughness = reflectance * roughness;
    if (scaledRoughness > 0.0001) {
      rayDirection = sampleGGX(
        rayDirection,
        whiteNoise(vec3(vUv, 0.0)),
        scaledRoughness
      );
    }
  #endif

  // Interleaved gradient noise rather than a fixed 4-pixel diagonal ramp: the
  // resolve pass averages each pixel's neighbours, so their offsets have to be
  // decorrelated to act as extra samples of the same lobe instead of replaying
  // the same handful of phases over and over.
  float jitter = interleavedGradientNoise(vUv * resolution) * jitter;

  vec2 hitPixel;
  vec3 hitPoint;
  float iterationCount;

  bool intersect = traceScreenSpaceRay(
    rayOrigin,
    rayDirection,
    jitter,
    hitPixel,
    hitPoint,
    iterationCount
  );

  // Bail before the fades rather than after: they end up multiplied by zero
  // for a ray that hit nothing, and a miss is the common case.
  if (!intersect) {
    gl_FragColor = SSR_NO_HIT;
    return;
  }

  float alpha = calculateAlphaForIntersection(
    intersect,
    iterationCount,
    1.0,
    hitPixel,
    hitPoint,
    rayOrigin,
    rayDirection
  );

  // A hit the fades cancel must read as a miss: the resolve pass averages the
  // hit coordinates of every valid neighbour, and a ray that ran to the screen
  // border would drag that average off the reflected object.
  if (alpha <= 0.0) {
    gl_FragColor = SSR_NO_HIT;
    return;
  }

  // Ref: https://willpgfx.com/2015/07/screen-space-glossy-reflections/
  #ifdef GENERATE_RAY_TRACING_BUFFER

    // How much the reflected ray turns back towards the eye. Rays that do are
    // unreliable in screen space, so the resolve fades them out; it goes
    // negative at near-normal incidence, which is why validity lives in .z.
    float rdotv = dot(rayDirection, normalize(rayOrigin));

    // Store ray tracing results in a format compatible with cone tracing
    // x,y = hit UV coordinates
    // z = hit depth at the hit point (negative marks a miss)
    // w = rdotv * alpha (fade only)
    float hitDepth = readDepth(hitPixel);
    gl_FragColor = vec4(hitPixel.x, hitPixel.y, hitDepth, rdotv * alpha);
  #else
    // Premultiplied, with the Fresnel term in alpha, matching the cone
    // tracing path so that either buffer composites the same way.
    float dotNV = clamp(abs(dot(viewNormal, -normalize(viewPosition))), 0.0, 1.0);
    alpha *= F_Schlick(vec3(reflectance), 1.0, dotNV).g;
    vec3 color = texture2D(inputBuffer, hitPixel).rgb;
    gl_FragColor = vec4(color * alpha, alpha);
  #endif
  
}
