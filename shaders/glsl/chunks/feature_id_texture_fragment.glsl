// At the top of main(), before show_fragment.
#ifdef USE_FEATURE_ID_TEXTURE
{
  vec4 bytes = floor(textureLod(nvr_featureIdTexture, nvr_vFeatureIdUv, 0.0) * 255.0 + 0.5);
  float id = dot(bytes, nvr_featureIdChannelWeights);
  if (id != nvr_featureIdNull && id < nvr_featureIdCount) nvr_featureId = id;
}
#ifdef USE_BATCH_TEXTURE
if (nvr_featureId >= 0.0) {
  #ifdef USE_BATCH_PICK_ID
    nvr_featurePickId = getBatchTexel(nvr_featureId, BATCHED_TEXTURE_ROW_PICK_ID)[BATCHED_TEXTURE_COMP_PICK_ID];
  #endif
  #ifdef USE_BATCH_COLOR
    nvr_batchColor = getBatchTexel(nvr_featureId, BATCHED_TEXTURE_ROW_COLOR).rgb;
  #endif
  #ifdef USE_BATCH_SHOW_OPACITY
    vec2 nvr_showOpacity = nvr_batchShowOpacity(nvr_featureId);
    nvr_vShow = nvr_showOpacity.x;
    nvr_vOpacity = nvr_showOpacity.y;
  #endif
  #ifdef USE_BATCH_EMISSIVE
    nvr_vEmissive = nvr_batchEmissive(nvr_featureId);
  #endif
}
#endif
#endif
