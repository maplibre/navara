uniform sampler2D nvrShadowBuffer;
uniform float nvrShadowSoftness;

// Tap rejection threshold as a fraction of the view-space depth, which keeps it
// independent of the scene scale.
const float NVR_SHADOW_DEPTH_TOLERANCE = 0.02;

float nvrReadViewZ(const vec2 uv) {
  return getViewZ(readDepth(uv));
}

float nvrFilterShadow(const vec2 uv, const float centerShadow) {
  #if NVR_SHADOW_TAP_COUNT > 0
  float centerViewZ = nvrReadViewZ(uv);
  float threshold = NVR_SHADOW_DEPTH_TOLERANCE * max(abs(centerViewZ), 1.0);
  vec2 radius = nvrShadowSoftness * texelSize;
  float sum = centerShadow;
  float weight = 1.0;
  for (int i = 0; i < NVR_SHADOW_TAP_COUNT; ++i) {
    vec2 tapUv = uv + vogelDisk(i, NVR_SHADOW_TAP_COUNT, 0.0) * radius;
    vec4 tap = texture(nvrShadowBuffer, tapUv);
    float tapShadow = tap.r;
    float tapDeferredLit = step(0.5, tap.g);
    // Taps on another surface would blur the shadow across the silhouette.
    float sameSurface = step(abs(nvrReadViewZ(tapUv) - centerViewZ), threshold);
    // Pixels outside the deferred-lit set carry no shadow amount for this
    // term (a cleared texel reads 0), so averaging them in would brighten the
    // edge where a deferred-lit surface meets one of them.
    float w = sameSurface * tapDeferredLit;
    sum += tapShadow * w;
    weight += w;
  }
  return sum / weight;
  #else // NVR_SHADOW_TAP_COUNT > 0
  return centerShadow;
  #endif // NVR_SHADOW_TAP_COUNT > 0
}
