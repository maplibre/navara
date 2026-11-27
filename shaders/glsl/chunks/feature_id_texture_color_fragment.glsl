// After <color_fragment>: the vertex stage left vColor white.
#if defined(USE_FEATURE_ID_TEXTURE) && defined(USE_BATCH_COLOR)
  diffuseColor.rgb *= nvr_batchColor;
#endif
