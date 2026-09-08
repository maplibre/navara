#ifdef USE_BATCH_TEXTURE
  float batchId = _batchid;

  #if defined(USE_BATCH_COLOR) && defined(USE_COLOR)
    vColor.rgb = getBatchTexel(batchId, BATCHED_TEXTURE_ROW_COLOR).rgb;
  #endif

  #ifdef USE_BATCH_SHOW_OPACITY
    // Packed: sign(show) * (1 + opacity); see packShowOpacity in web/navara_three/src/batchTexture/core.ts
    float nvr_batchShowOpacity = getBatchTexel(batchId, BATCHED_TEXTURE_ROW_SHOW_OPACITY)[BATCHED_TEXTURE_COMP_SHOW_OPACITY];
    nvr_vShow = step(0.0, nvr_batchShowOpacity);
    nvr_vOpacity = clamp(abs(nvr_batchShowOpacity) - 1.0, 0.0, 1.0);
  #endif

  #ifdef USE_BATCH_EMISSIVE
    // Both slots are always allocated together (see ensureEmissiveSlots).
    nvr_vEmissive = getBatchTexel(batchId, BATCHED_TEXTURE_ROW_EMISSIVE).rgb
      * getBatchTexel(batchId, BATCHED_TEXTURE_ROW_EMISSIVE_INTENSITY)[BATCHED_TEXTURE_COMP_EMISSIVE_INTENSITY];
  #endif

  #ifdef USE_BATCH_HEIGHT
    addHeight = getBatchTexel(batchId, BATCHED_TEXTURE_ROW_HEIGHT)[BATCHED_TEXTURE_COMP_HEIGHT];
  #endif

  #ifdef USE_BATCH_EXTRUDED_HEIGHT
    addExtrudedHeight = getBatchTexel(batchId, BATCHED_TEXTURE_ROW_EXTRUDED_HEIGHT)[BATCHED_TEXTURE_COMP_EXTRUDED_HEIGHT];
  #endif

  #ifdef USE_BATCH_LINE_WIDTH
    batchLineWidth = getBatchTexel(batchId, BATCHED_TEXTURE_ROW_LINE_WIDTH)[BATCHED_TEXTURE_COMP_LINE_WIDTH];
  #endif
#endif
