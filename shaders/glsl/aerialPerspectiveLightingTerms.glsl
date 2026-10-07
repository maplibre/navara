// Injected into takram's `aerialPerspectiveEffect.frag` ahead of `mainImage`.
// See `aerialPerspective/lightingTerms.ts`

#include "chunks/screen_space_shadow_filter.glsl"

uniform float nvrShadowIntensity;
uniform float nvrSpecularIntensity;

#ifdef NVR_SPECULAR

const float NVR_MIN_REFLECTIVITY = 0.01;
const float NVR_MIN_ROUGHNESS = 0.02;
// Caps the unbounded lobe peak (D·V reaches 1e12 at the minimum roughness near grazing)
// so the half-float frame never stores Inf.
const float NVR_MAX_SPECULAR_BRDF = 1024.0;

// ref: https://github.com/mrdoob/three.js/blob/r185/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js#L89
float nvr_D_GGX(const float a2, const float dotNH) {
  float denom = dotNH * dotNH * (a2 - 1.0) + 1.0;
  return RECIPROCAL_PI * a2 / (denom * denom);
}

// ref: https://github.com/mrdoob/three.js/blob/r185/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js#L76
float nvr_V_GGX(const float a2, const float dotNL, const float dotNV) {
  float gv = dotNV * sqrt(a2 + (1.0 - a2) * dotNL * dotNL);
  float gl = dotNL * sqrt(a2 + (1.0 - a2) * dotNV * dotNV);
  return 0.5 / max(gv + gl, EPSILON);
}

vec3 nvr_F_Schlick(const vec3 f0, const float dotVH) {
  return f0 + (1.0 - f0) * pow(1.0 - dotVH, 5.0);
}

// The sun's GGX lobe as a BRDF value; the caller multiplies by the sun
// irradiance, which already carries N·L.
vec3 nvrSunSpecularBrdf(
  const float reflectance,
  const float roughness,
  const vec3 normal,
  const vec3 viewDirection,
  const float dotNL
) {
  float dotNV = dot(normal, viewDirection);
  if (dotNV <= 0.0) {
    return vec3(0.0);
  }
  vec3 halfDirection = normalize(sunDirection + viewDirection);
  float dotNH = clamp(dot(normal, halfDirection), 0.0, 1.0);
  float dotVH = clamp(dot(viewDirection, halfDirection), 0.0, 1.0);

  float alpha2 = pow(clamp(roughness, NVR_MIN_ROUGHNESS, 1.0), 4.0);

  float D = nvr_D_GGX(alpha2, dotNH);
  vec3 F = nvr_F_Schlick(vec3(reflectance), dotVH);
  float V = nvr_V_GGX(alpha2, dotNL, dotNV);
  return min((D * V) * F, vec3(NVR_MAX_SPECULAR_BRDF));
}

#endif // NVR_SPECULAR

// The specular reads the host's `normalBuffer`, so HAS_NORMALS gates both terms.
#if defined(SUN_LIGHT) && defined(SKY_LIGHT) && defined(HAS_NORMALS)

// ref: https://github.com/takram-design-engineering/three-geospatial/blob/b012ad06d858fc035d88aacfd73f092f93c994e4/packages/atmosphere/src/shaders/aerialPerspectiveEffect.frag#L104
vec3 nvrGetSunSkyIrradiance(
  const vec2 uv,
  const vec3 positionECEF,
  const vec3 normalECEF,
  const vec3 inputColor,
  const float sunTransmittance
) {
  // The host's Lambertian term, unchanged.
  vec3 diffuse = inputColor * albedoScale * RECIPROCAL_PI;
  vec3 skyIrradiance;
  vec3 sunIrradiance = GetSunAndSkyIrradiance(
    positionECEF,
    normalECEF,
    sunDirection,
    skyIrradiance
  );
  #ifdef HAS_SHADOW
  // Cloud shadows, ahead of the terms so the specular is under them too.
  sunIrradiance *= sunTransmittance;
  #endif // HAS_SHADOW

  vec4 shadowSample = texture(nvrShadowBuffer, uv);
  // R is the CSM shadow amount, G flags the pixel as deferred-lit (albedo
  // output); forward-lit pixels already carry their own shadow and specular.
  float shadowAmount = shadowSample.r;
  bool deferredLit = shadowSample.g >= 0.5;

  #ifdef NVR_SHADOW
  if (deferredLit) {
    float shadow = clamp(
      nvrFilterShadow(uv, shadowAmount) * nvrShadowIntensity,
      0.0,
      1.0
    );
    // Only the sun is occluded; what survives in shadow is the sky's share.
    sunIrradiance *= 1.0 - shadow;
  }
  #endif // NVR_SHADOW

  vec3 radiance = diffuse * (sunIrradiance + skyIrradiance);

  #ifdef NVR_SPECULAR
  if (deferredLit) {
    // Normal buffer: B = reflectance at normal incidence (F0), A = roughness
    vec4 surface = texture(normalBuffer, uv);
    float reflectance = surface.b;
    float roughness = surface.a;
    vec3 normal = normalize(normalECEF);
    float dotNL = dot(normal, sunDirection);
    if (reflectance >= NVR_MIN_REFLECTIVITY && dotNL > 0.0) {
      vec3 viewDirection = normalize(vCameraPosition - positionECEF);
      vec3 brdf = nvrSunSpecularBrdf(
        reflectance,
        roughness,
        normal,
        viewDirection,
        dotNL
      );
      // `sunIrradiance` carries N·L, the cloud transmittance and the shadow.
      // `albedoScale` keeps the highlight in step with the diffuse it dims.
      radiance += brdf * sunIrradiance * (albedoScale * nvrSpecularIntensity);
    }
  }
  #endif // NVR_SPECULAR

  return radiance;
}

#endif // defined(SUN_LIGHT) && defined(SKY_LIGHT) && defined(HAS_NORMALS)
