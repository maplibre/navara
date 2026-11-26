#include "core/packing"
#include "core/depth"
#include "nvr/depthConvention"
#include "core/transform"

uniform sampler2D uLightTex0; // color,intensity
uniform sampler2D uLightTex1; // position in world space (xyz), effective range baked on CPU (w)
uniform sampler2D normalBuffer;
uniform sampler2D copiedDepthBuffer;
uniform bool useSurfaceLighting;
uniform ivec2 uLightTexSize;
uniform vec3 cameraPos;
uniform float fogDensity;
uniform float haloFalloff;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform mat4 projectionMatrix;
uniform mat4 invProjectionMatrix;
uniform mat4 invViewMatrix;
uniform mat4 viewMatrix;
// Tiled culling
uniform sampler2D uResidual;       // per-tile haze from cap-dropped lights (rgb) + mean light distance (a)
uniform sampler2D uLightGrid;      // per-tile: (offsetTexel, count)
uniform sampler2D uLightIndex;     // packed 4 indices per texel (RGBA)
uniform ivec2 uLightGridSize;      // gridW, gridH (tiles)
uniform ivec2 uLightIndexTexSize;  // width, height of index texture
uniform float uTileSizePx;         // tile size in pixels

vec4 readCI(int idx) {
  ivec2 tc = ivec2(idx % uLightTexSize.x, idx / uLightTexSize.x);
  return texelFetch(uLightTex0, tc, 0);
}

vec4 readPos(int idx) {
  ivec2 tc = ivec2(idx % uLightTexSize.x, idx / uLightTexSize.x);
  return texelFetch(uLightTex1, tc, 0);
}

// ref: https://ijdykeman.github.io/graphics/simple_fog_shader
// `range` is the light's effective reach min(userRadius, analytic hMax),
// baked on the CPU (FogLightEffect.effectiveRange) into uLightTex1's w.
vec3 calculateFogScattering(vec3 worldPos, vec3 viewDir, float viewDist, vec3 lightPos, vec3 lightColor, vec3 normal, float intensity, float range, float pixelScale, vec3 albedo) {
    // Closest approach of the infinite view ray to the light: at ray
    // parameter sStar (negative when the light sits behind the camera),
    // with perpendicular distance h. Using the infinite-ray h keeps every
    // quantity continuous in the view direction - a clamped closest point
    // would jump when the light crosses the camera's side plane, which
    // renders as perfectly straight seams across the fog.
    vec3 camToLight = lightPos - cameraPos;
    float sStar = dot(camToLight, viewDir);

    // The integral peaks as 1/h; clamp h to half a fog pixel's world size at
    // the light's distance so a sub-pixel core renders as its pixel average
    // instead of a spike that flickers as the camera drifts.
    #ifdef PERSPECTIVE_CAMERA
    float hMin = max(0.001, pixelScale * max(sStar, 0.0) * 0.5);
    #else
    float hMin = max(0.001, pixelScale * 0.5);
    #endif
    float h = max(sqrt(max(dot(camToLight, camToLight) - sStar * sStar, 0.0)), hMin);

    float R = range;
    // Distance from the light to the nearest point of the VISIBLE segment.
    // The infinite-line h alone must not drive attenuation: for a light just
    // behind the camera the backward extension passes through it (h -> 0),
    // which would paint a spurious unattenuated hotspot at the antipodal
    // point. hSeg is continuous in the view direction.
    float sOff = sStar - clamp(sStar, 0.0, viewDist);
    float hSeg = sqrt(h * h + sOff * sOff);
    // The visible segment stays outside the influence sphere: the fog
    // integral is zero and the surface falloff (distance >= hSeg) is zero.
    if (hSeg >= R) return vec3(0.0);

    // Intersect the lit span [sStar - sMax, sStar + sMax] with the visible
    // segment [0, viewDist] and integrate dS / (h^2 + (s - sStar)^2).
    float sMax = sqrt(max(R*R - h*h, 0.0));
    float lo = max(0.0, sStar - sMax) - sStar;
    float hi = min(viewDist, sStar + sMax) - sStar;
    float integral = hi > lo ? (atan(hi / h) - atan(lo / h)) / h : 0.0;

    vec3 fogLight = lightColor * intensity * integral * fogDensity;

    float attenuation = 1.0 / (1.0 + hSeg * haloFalloff);
    fogLight *= attenuation;

    if(useSurfaceLighting) {
      // Calculate point lighting on the surface. (Deferred lighting)
      vec3 L = lightPos - worldPos;
      float d = length(L);
      float NdotL = max(dot(normal, L / max(d, 1e-4)), 0.0);

      // Windowed distance falloff, so surface lighting reaches exactly zero
      // at the effective range and stays consistent with tile culling.
      // Ref: https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf
      float w = d / R;
      float window = saturate(1.0 - w * w * w * w);
      float surfaceAtten = window * window / (1.0 + haloFalloff * d);

      fogLight += BRDF_Lambert(albedo) * lightColor * intensity * NdotL * surfaceAtten;
    }

    return fogLight;
}

float readDepth(const vec2 uv) {
  #if DEPTH_PACKING == 3201
  return unpackRGBAToDepth(texture2D(copiedDepthBuffer, uv));
  #else
  return texture2D(copiedDepthBuffer, uv).r;
  #endif // DEPTH_PACKING == 3201
}

float getViewZ(const float depth) {
  #ifdef PERSPECTIVE_CAMERA
  return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  #else
  return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
  #endif
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float depth = readDepth(uv);
    bool sky = nvr_isFarDepth(depth);
    depth = reverseLogDepth(depth, cameraNear, cameraFar);

    float viewZ = getViewZ(depth);
    vec3 viewPos = screenToView(
      uv,
      depth,
      viewZ,
      projectionMatrix,
      invProjectionMatrix
    );
    vec3 worldPos = (invViewMatrix * vec4(viewPos, 1.0)).xyz;
    
    // Get surface normal if surface lighting is enabled
    vec3 normal = vec3(0.0);
    if (useSurfaceLighting && !sky) {
        vec4 packedNormal = texture2D(normalBuffer, uv);
        normal = unpackVec2ToNormal(packedNormal.xy);
        // Transform normal from view space to world space
        normal = normalize((invViewMatrix * vec4(normal, 0.0)).xyz);
    }
    
    vec3 fogColor = vec3(0.0);

    // View ray is shared by every light this pixel iterates
    vec3 viewRay = worldPos - cameraPos;
    float viewDist = length(viewRay);
    vec3 viewDir = viewRay / max(viewDist, 1e-6);

    // World size of one fog pixel — per unit view distance for perspective
    // (multiply by the depth), absolute for orthographic
    float pixelScale = 2.0 / (resolution.y * projectionMatrix[1][1]);

    // Determine tile for this pixel
    ivec2 pixel = ivec2(uv * resolution);
    ivec2 tile = clamp(pixel / int(uTileSizePx), ivec2(0), uLightGridSize - ivec2(1));
    int tileIndex = tile.x + tile.y * uLightGridSize.x;
    ivec2 gridUv = ivec2(tileIndex % uLightGridSize.x, tileIndex / uLightGridSize.x);
    vec2 gridData = texelFetch(uLightGrid, gridUv, 0).rg;
    int offsetTexel = int(gridData.x + 0.5);
    int count = int(min(gridData.y + 0.5, float(MAX_LIGHTS_PER_TILE)));

    for (int j = 0; j < MAX_LIGHTS_PER_TILE; ++j) {
      if (j >= count) break;
      // RGBA‑packed (4 indices per texel)
      int texelIndex = offsetTexel + (j >> 2);
      int comp = j & 3;
      ivec2 idxUv = ivec2(texelIndex % uLightIndexTexSize.x, texelIndex / uLightIndexTexSize.x);
      vec4 packed = texelFetch(uLightIndex, idxUv, 0);
      float fidx = comp == 0 ? packed.r : (comp == 1 ? packed.g : (comp == 2 ? packed.b : packed.a));
      int i = int(floor(fidx + 0.5));
      if (i < 0) continue;

      vec4 ci = readCI(i); // color,intensity
      vec4 posData = readPos(i); // position in world space
      vec3 lightColor = ci.rgb;
      float intensity = ci.a;
      vec3 lightPos = posData.xyz;
      if (intensity > 0.0) {
        vec3 lightContribution = calculateFogScattering(
          worldPos,
          viewDir,
          viewDist,
          lightPos,
          lightColor,
          normal,
          intensity,
          posData.w,
          pixelScale,
          inputColor.rgb
        );
        fogColor += lightContribution;
      }
    }
    // Residual haze from lights dropped by the per-tile cap. Manual bilinear
    // across tiles (float textures aren't filterable without an extension)
    // smooths it; the ray-length factor keeps it off foreground surfaces
    // that sit well in front of the dropped lights.
    vec2 rpos = (uv * resolution) / uTileSizePx - 0.5;
    ivec2 rbase = ivec2(floor(rpos));
    vec2 rf = fract(rpos);
    ivec2 rmax = uLightGridSize - ivec2(1);
    vec4 r00 = texelFetch(uResidual, clamp(rbase, ivec2(0), rmax), 0);
    vec4 r10 = texelFetch(uResidual, clamp(rbase + ivec2(1, 0), ivec2(0), rmax), 0);
    vec4 r01 = texelFetch(uResidual, clamp(rbase + ivec2(0, 1), ivec2(0), rmax), 0);
    vec4 r11 = texelFetch(uResidual, clamp(rbase + ivec2(1, 1), ivec2(0), rmax), 0);
    vec4 residual = mix(mix(r00, r10, rf.x), mix(r01, r11, rf.x), rf.y);
    if (residual.a > 0.0) {
      // Approximate fraction of the full-ray integral a ray of this length
      // accumulates: ~0.5 when the surface sits at the lights' mean distance
      // (half the scattering lobe), approaching 1 far beyond it.
      float rayFactor = viewDist / (viewDist + residual.a);
      fogColor += residual.rgb * rayFactor;
    }

    #ifdef DEBUG_SHOW_GRID
      // Visualize tile grid and occupancy.
      float occ = clamp(float(count) / float(MAX_LIGHTS_PER_TILE), 0.0, 1.0);

      vec2 pix = uv * resolution;
      vec2 tm = mod(pix, vec2(uTileSizePx));
      float left   = 1.0 - step(1.0, tm.x);
      float right  = step(uTileSizePx - 1.0, tm.x);
      float top    = 1.0 - step(1.0, tm.y);
      float bottom = step(uTileSizePx - 1.0, tm.y);
      float gridLine = clamp(left + right + top + bottom, 0.0, 1.0);

      vec3 gridFill = vec3(1.0) * occ * 0.05;
      vec3 gridLines = vec3(1.0) * gridLine;
      fogColor += gridFill + gridLines;
    #endif

    #ifdef FOG_ONLY_OUTPUT
      // When downsampling: output only the fog contribution. The host pass will composite over input.
      outputColor = vec4(fogColor, 1.0);
    #else
      vec3 finalColor = inputColor.rgb + fogColor;
      outputColor = vec4(finalColor, inputColor.a);
    #endif
}
