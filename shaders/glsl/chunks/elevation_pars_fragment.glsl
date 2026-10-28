#if USE_ELEVATION_HEATMAP
  #include "branchFreeTernary.glsl"
  #include "dem_util.glsl"

  uniform sampler2D uColorMapTexture;

  // Per-layer logarithmic scaling function
  // Takes logBase and logBoundary as parameters instead of using global uniforms
  float pseudoLog(float value, float logBase, float logBoundary) {
    return value > logBoundary ? log(value) / logBase : value < -logBoundary ? -log(-value) / logBase : value / logBoundary;
  }

  // Decode raw height from RGB DEM texture for elevation heatmap
  // Takes slot index to look up the correct per-layer decoder
  float decodeRawHeightForElevation(vec4 color, int slot) {
    return decodeDEMHeight(
      color,
      uElevationRGBScalersAndBoundaries[slot].xyz,  // rgbScaler
      uElevationRGBScalersAndBoundaries[slot].w,    // boundary
      uElevationDecoderOffsets[slot].x,             // minOffset
      uElevationDecoderOffsets[slot].y,             // maxOffset
      uElevationDecoderOffsets[slot].z,             // epsilon
      uElevationDecoderOffsets[slot].w              // offset
    );
  }

  // Normalize raw height to [0, 1] range with optional logarithmic scaling
  // Takes per-layer min/max heights and logarithmic parameters
  float normalizeElevationHeight(float h, float minHeight, float maxHeight, bool logarithmic, float logBase, float logBoundary) {
    float normalizedMinHeight = minHeight;
    float normalizedMaxHeight = maxHeight;
    float value = h;
    // A real branch, not nvr_branchFreeTernary: with logarithmic off,
    // logBoundary is 0 and pseudoLog(0.0, …) is 0/0 = NaN, which a branch-free
    // select (NaN * 0) propagates on strict-IEEE backends such as SwiftShader.
    if (logarithmic) {
      normalizedMinHeight = pseudoLog(minHeight, logBase, logBoundary);
      normalizedMaxHeight = pseudoLog(maxHeight, logBase, logBoundary);
      value = pseudoLog(h, logBase, logBoundary);
    }

    // Guard min == max (e.g. a single color-relief stop) against division by zero.
    float range = max(normalizedMaxHeight - normalizedMinHeight, 1e-6);
    return clamp((value - normalizedMinHeight) / range, 0.0, 1.0);
  }

  // Sample elevation with bilinear interpolation in decoded height space.
  // texSize: actual texture size obtained via textureSize(demTexture, 0).
  // Returns the height in meters; `valid` reports whether the sample decoded to
  // an actual elevation (0.0 is returned otherwise).
  float sampleElevationBilinear(sampler2D demTexture, vec2 uv, ivec2 texSize, int slot, out bool valid) {
    // Prepare bilinear sampling data (pixel coordinates and interpolation weights)
    DEMBilinearData data = prepareDEMBilinear(texSize, uv);

    float h = invalidHeight; // Default to invalid height

    // Decode heights at 4 sample points using per-layer decoder
    float h00 = decodeRawHeightForElevation(texelFetch(demTexture, data.p00, 0), slot);
    if(isValidHeight(h00)) {
      float h10 = decodeRawHeightForElevation(texelFetch(demTexture, data.p10, 0), slot);
      float h01 = decodeRawHeightForElevation(texelFetch(demTexture, data.p01, 0), slot);
      float h11 = decodeRawHeightForElevation(texelFetch(demTexture, data.p11, 0), slot);

      // Perform bilinear interpolation with artifact detection
      h = interpolateDEMHeights(h00, h10, h01, h11, data.frac);
    }

    valid = isValidHeight(h);
    return valid ? h : 0.0;
  }

  // Sample elevation using nearest neighbor (no interpolation).
  // Directly samples the single closest texel without any interpolation.
  // Useful for color-relief layers that require sharp boundaries.
  // Returns the height in meters (see sampleElevationBilinear).
  float sampleElevationNearest(sampler2D demTexture, vec2 uv, ivec2 texSize, int slot, out bool valid) {
    // Convert UV to pixel coordinates and round to nearest
    vec2 pixelCoord = uv * vec2(texSize);
    ivec2 nearestPixel = ivec2(floor(pixelCoord + 0.5));

    // Clamp to texture bounds
    nearestPixel = clamp(nearestPixel, ivec2(0), texSize - 1);

    // Fetch and decode the single texel using per-layer decoder
    float h = decodeRawHeightForElevation(texelFetch(demTexture, nearestPixel, 0), slot);

    valid = isValidHeight(h);
    return valid ? h : 0.0;
  }

  // Look up a color ramp row of the colorMap atlas (see ColorMapAtlas): stop i
  // is texel 2i (premultiplied color) and texel 2i+1 (position in .r).
  // Binary-searches the stops bracketing `key`, interpolates in premultiplied
  // space like MapLibre's color-relief, and returns straight alpha. Keys
  // outside the stops clamp to the end colors.
  vec4 sampleColorRamp(int row, int stopCount, float key) {
    int l = 0;
    int r = stopCount - 1;
    float pl = texelFetch(uColorMapTexture, ivec2(1, row), 0).r;
    float pr = texelFetch(uColorMapTexture, ivec2(r * 2 + 1, row), 0).r;
    while (r - l > 1) {
      int m = (l + r) / 2;
      float pm = texelFetch(uColorMapTexture, ivec2(m * 2 + 1, row), 0).r;
      if (key < pm) {
        r = m;
        pr = pm;
      } else {
        l = m;
        pl = pm;
      }
    }
    float t = pr > pl ? clamp((key - pl) / (pr - pl), 0.0, 1.0) : step(pr, key);
    vec4 c = mix(
      texelFetch(uColorMapTexture, ivec2(l * 2, row), 0),
      texelFetch(uColorMapTexture, ivec2(r * 2, row), 0),
      t
    );
    return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
  }
#endif