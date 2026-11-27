#ifdef USE_BATCH_TEXTURE
uniform sampler2D batchDataTexture;

vec2 getBatchTextureCoord(float batchId, float rowIndex) {
  vec2 texSize = vec2(textureSize(batchDataTexture, 0));

  // Planar 2D layout: batch IDs are arranged in a grid of width texSize.x
  // spanning batchRowGroups rows, and each attribute row occupies one
  // contiguous block of batchRowGroups physical rows (see batchBaseIndex in
  // web/navara_three/src/batchTexture/layout.ts).
  float batchRowGroups = texSize.y / BATCHED_TEXTURE_ROW_COUNT;
  float col = mod(batchId, texSize.x);
  float batchRow = floor(batchId / texSize.x);

  float u = (col + 0.5) / texSize.x;
  float v = (rowIndex * batchRowGroups + batchRow + 0.5) / texSize.y;

  return vec2(u, v);
}

// Row and component assignment comes from the BATCHED_TEXTURE_ROW_* /
// BATCHED_TEXTURE_COMP_* defines stamped from BatchTextureLayout. Fetches of
// scalars sharing a row hit the same texel.
vec4 getBatchTexel(float batchId, float rowIndex) {
  return texture2D(batchDataTexture, getBatchTextureCoord(batchId, rowIndex));
}

#ifdef USE_BATCH_SHOW_OPACITY
// (show, opacity) from sign(show) * (1 + opacity); see packShowOpacity in
// web/navara_three/src/batchTexture/core.ts
vec2 nvr_batchShowOpacity(float batchId) {
  float showOpacity = getBatchTexel(batchId, BATCHED_TEXTURE_ROW_SHOW_OPACITY)[BATCHED_TEXTURE_COMP_SHOW_OPACITY];
  return vec2(step(0.0, showOpacity), clamp(abs(showOpacity) - 1.0, 0.0, 1.0));
}
#endif

#ifdef USE_BATCH_EMISSIVE
// Both slots are always allocated together (see ensureEmissiveSlots).
vec3 nvr_batchEmissive(float batchId) {
  return getBatchTexel(batchId, BATCHED_TEXTURE_ROW_EMISSIVE).rgb
    * getBatchTexel(batchId, BATCHED_TEXTURE_ROW_EMISSIVE_INTENSITY)[BATCHED_TEXTURE_COMP_EMISSIVE_INTENSITY];
}
#endif
#endif // USE_BATCH_TEXTURE
