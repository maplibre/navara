#ifdef USE_BATCH_TEXTURE
uniform sampler2D batchDataTexture;
in float _batchid;

vec2 getBatchTextureCoord(float batchId, float rowIndex) {
  vec2 texSize = vec2(textureSize(batchDataTexture, 0));

  // Planar 2D layout: batch IDs are arranged in a grid of width texSize.x
  // spanning batchRowGroups rows, and each attribute row occupies one
  // contiguous block of batchRowGroups physical rows (see batchBaseIndex in
  // batchTexture.ts).
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

#ifdef USE_BATCH_EMISSIVE
// Folded per-feature emissive (rgb × intensity); the fragment-side
// declaration lives in gbuffer_pars_fragment.glsl.
out vec3 nvr_vEmissive;
#endif
#endif // USE_BATCH_TEXTURE
