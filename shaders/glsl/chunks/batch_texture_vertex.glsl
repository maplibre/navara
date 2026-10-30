#ifdef USE_BATCH_TEXTURE
  // Default source is the `_batchid` attribute; a shader without one (e.g.
  // sdfText, whose glyph instances get the feature index via the label data
  // texture) overrides NVR_BATCH_ID_EXPR before this include.
  #ifndef NVR_BATCH_ID_EXPR
  #define NVR_BATCH_ID_EXPR _batchid
  #endif
  float batchId = NVR_BATCH_ID_EXPR;

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

  #ifdef USE_BATCH_LINE_DASH
    // Row in the view's line dash atlas; 0 is a solid line.
    nvr_batchLineDash = getBatchTexel(batchId, BATCHED_TEXTURE_ROW_LINE_DASH)[BATCHED_TEXTURE_COMP_LINE_DASH];
  #endif

  #ifdef USE_BATCH_ROTATION
    // Radians; the CPU converts the material's degrees before writing.
    nvr_batchRotation = getBatchTexel(batchId, BATCHED_TEXTURE_ROW_ROTATION)[BATCHED_TEXTURE_COMP_ROTATION];
  #endif

  #ifdef USE_BATCH_ORIENTATION
    // Packed: spreadGlyphs (text only, read by sdfText.vert.glsl) in the 4s
    // place, flatFacing in the 2s place, rotateWithCamera in the 1s place; see
    // packOrientation in web/navara_three/src/batchTexture/core.ts
    float nvr_batchOrientation = getBatchTexel(batchId, BATCHED_TEXTURE_ROW_ORIENTATION)[BATCHED_TEXTURE_COMP_ORIENTATION];
    nvr_batchFlatFacing = mod(nvr_batchOrientation, 4.0) >= 1.5;
    nvr_batchRotateWithCamera = mod(nvr_batchOrientation, 2.0) >= 0.5;
  #endif

  #ifdef USE_BATCH_ANCHOR
    // Packed 2h + 6v, h and v in {0, 0.5, 1}; see anchorCode in
    // web/navara_three/src/material/anchor.ts. The +0.5 keeps floor() off the
    // exact multiples of 3.
    float nvr_batchAnchorCode = getBatchTexel(batchId, BATCHED_TEXTURE_ROW_ANCHOR)[BATCHED_TEXTURE_COMP_ANCHOR];
    nvr_batchAnchor = vec2(
      mod(nvr_batchAnchorCode, 3.0) * 0.5 - 0.5,
      0.5 - floor((nvr_batchAnchorCode + 0.5) / 3.0) * 0.5
    );
  #endif

  #ifdef USE_BATCH_OFFSET
    // Both halves are always allocated together (see ensureOffsetSlots).
    nvr_batchOffset = vec2(
      getBatchTexel(batchId, BATCHED_TEXTURE_ROW_OFFSET_X)[BATCHED_TEXTURE_COMP_OFFSET_X],
      getBatchTexel(batchId, BATCHED_TEXTURE_ROW_OFFSET_Y)[BATCHED_TEXTURE_COMP_OFFSET_Y]
    );
  #endif

  #ifdef USE_BATCH_SIZE
    // Negative = fall back to the material size (see SCALAR_FALLBACK in
    // web/navara_three/src/batchTexture/core.ts)
    batchSize = getBatchTexel(batchId, BATCHED_TEXTURE_ROW_SIZE)[BATCHED_TEXTURE_COMP_SIZE];
  #endif
#endif
