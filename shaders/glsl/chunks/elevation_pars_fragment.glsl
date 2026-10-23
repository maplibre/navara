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
    // Apply logarithmic scaling if enabled
    float normalizedMinHeight = nvr_branchFreeTernary(logarithmic, pseudoLog(minHeight, logBase, logBoundary), minHeight);
    float normalizedMaxHeight = nvr_branchFreeTernary(logarithmic, pseudoLog(maxHeight, logBase, logBoundary), maxHeight);
    float value = nvr_branchFreeTernary(logarithmic, pseudoLog(h, logBase, logBoundary), h);

    return clamp(
        (value - normalizedMinHeight) / (normalizedMaxHeight - normalizedMinHeight),
        0.0,
        1.0
    );
  }

  // Sample elevation with bilinear interpolation in decoded height space.
  // texSize: actual texture size obtained via textureSize(demTexture, 0).
  // `valid` reports whether the sample decoded to an actual elevation AND is within
  // the layer's [minHeight, maxHeight] range. Out-of-range elevations are treated as
  // invalid so the layer becomes transparent, matching MapLibre's behavior.
  float sampleElevationBilinear(sampler2D demTexture, vec2 uv, ivec2 texSize, int slot, float minHeight, float maxHeight, bool logarithmic, float logBase, float logBoundary, out bool valid) {
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
    if (!valid) {
      return 0.0;
    }

    // Normalize the interpolated height with per-layer min/max and logarithmic parameters
    return normalizeElevationHeight(h, minHeight, maxHeight, logarithmic, logBase, logBoundary);
  }

  // Sample elevation using nearest neighbor (no interpolation).
  // Directly samples the single closest texel without any interpolation.
  // Useful for color-relief layers that require sharp boundaries.
  float sampleElevationNearest(sampler2D demTexture, vec2 uv, ivec2 texSize, int slot, float minHeight, float maxHeight, bool logarithmic, float logBase, float logBoundary, out bool valid) {
    // Convert UV to pixel coordinates and round to nearest
    vec2 pixelCoord = uv * vec2(texSize);
    ivec2 nearestPixel = ivec2(floor(pixelCoord + 0.5));

    // Clamp to texture bounds
    nearestPixel = clamp(nearestPixel, ivec2(0), texSize - 1);

    // Fetch and decode the single texel using per-layer decoder
    float h = decodeRawHeightForElevation(texelFetch(demTexture, nearestPixel, 0), slot);

    valid = isValidHeight(h);
    if (!valid) {
      return 0.0;
    }

    // Normalize the height with per-layer min/max and logarithmic parameters
    return normalizeElevationHeight(h, minHeight, maxHeight, logarithmic, logBase, logBoundary);
  }
#endif