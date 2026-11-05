// GGX microfacet terms shared by the aerial perspective's sun specular and
// the forward water shading.

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
