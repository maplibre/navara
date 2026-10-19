#if USE_ELEVATION_HEATMAP
  #include "branchFreeTernary.glsl"
  #include "dem_util.glsl"

  uniform sampler2D uColorMapTexture;
  uniform vec3 uElevationRGBScaler;
  uniform vec3 uElevationMinMaxHeightAndBoundary;
  uniform vec4 uElevationMinMaxOffsetAndEpsilonAndOffset;
  uniform bool uLogarithmic; // Whether to apply logarithmic scaling
  uniform float uLogBase; // Logarithmic base
  uniform float uLogBoundary; // Boundary for pseudo-logarithmic scaling

  float pseudoLog(float value) {
    return value > uLogBoundary ? log(value) / uLogBase : value < -uLogBoundary ? -log(-value) / uLogBase : value / uLogBoundary;
  }

  // Decode raw height from RGB DEM texture for elevation heatmap
  float decodeRawHeightForElevation(vec4 color) {
    return decodeDEMHeight(
      color,
      uElevationRGBScaler,
      uElevationMinMaxHeightAndBoundary.z,  // boundary
      uElevationMinMaxOffsetAndEpsilonAndOffset.x,  // minOffset
      uElevationMinMaxOffsetAndEpsilonAndOffset.y,  // maxOffset
      uElevationMinMaxOffsetAndEpsilonAndOffset.z,  // epsilon
      uElevationMinMaxOffsetAndEpsilonAndOffset.w   // offset
    );
  }

  // Normalize raw height to [0, 1] range with optional logarithmic scaling
  float normalizeElevationHeight(float h) {
    // Apply logarithmic scaling if enabled
    float minHeight = nvr_branchFreeTernary(uLogarithmic, pseudoLog(uElevationMinMaxHeightAndBoundary.x), uElevationMinMaxHeightAndBoundary.x);
    float maxHeight = nvr_branchFreeTernary(uLogarithmic, pseudoLog(uElevationMinMaxHeightAndBoundary.y), uElevationMinMaxHeightAndBoundary.y);
    float value = nvr_branchFreeTernary(uLogarithmic, pseudoLog(h), h);

    return clamp(
        (value - minHeight) / (maxHeight - minHeight),
        0.0,
        1.0
    );
  }

  // Sample elevation with bilinear interpolation in decoded height space.
  // texSize: actual texture size obtained via textureSize(demTexture, 0).
  // `valid` reports whether the sample decoded to an actual elevation: no-data
  // (boundary) texels — including a baked drape target's uncovered regions,
  // which the bake paints with the boundary color — must render transparent
  // instead of being colormapped as the fallback 0.0. The DEM's alpha channel
  // is deliberately never read here: it stays reserved for future RGBA height
  // encodings.
  float sampleElevationBilinear(sampler2D demTexture, vec2 uv, ivec2 texSize, out bool valid) {
    // Prepare bilinear sampling data (pixel coordinates and interpolation weights)
    DEMBilinearData data = prepareDEMBilinear(texSize, uv);

    float h = invalidHeight; // Default to invalid height

    // Decode heights at 4 sample points
    float h00 = decodeRawHeightForElevation(texelFetch(demTexture, data.p00, 0));
    if(isValidHeight(h00)) {
      float h10 = decodeRawHeightForElevation(texelFetch(demTexture, data.p10, 0));
      float h01 = decodeRawHeightForElevation(texelFetch(demTexture, data.p01, 0));
      float h11 = decodeRawHeightForElevation(texelFetch(demTexture, data.p11, 0));

      // Perform bilinear interpolation with artifact detection
      h = interpolateDEMHeights(h00, h10, h01, h11, data.frac);
    }

    valid = isValidHeight(h);
    if (!valid) {
      return 0.0;
    }

    // Normalize the interpolated height
    return normalizeElevationHeight(h);
  }

  // Sample elevation using nearest neighbor (no interpolation).
  // Directly samples the single closest texel without any interpolation.
  // Useful for color-relief layers that require sharp boundaries.
  float sampleElevationNearest(sampler2D demTexture, vec2 uv, ivec2 texSize, out bool valid) {
    // Convert UV to pixel coordinates and round to nearest
    vec2 pixelCoord = uv * vec2(texSize);
    ivec2 nearestPixel = ivec2(floor(pixelCoord + 0.5));

    // Clamp to texture bounds
    nearestPixel = clamp(nearestPixel, ivec2(0), texSize - 1);

    // Fetch and decode the single texel
    float h = decodeRawHeightForElevation(texelFetch(demTexture, nearestPixel, 0));

    valid = isValidHeight(h);
    if (!valid) {
      return 0.0;
    }

    // Normalize the height
    return normalizeElevationHeight(h);
  }
#endif