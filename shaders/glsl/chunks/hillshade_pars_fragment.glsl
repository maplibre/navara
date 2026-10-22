#if USE_HILLSHADE
  #include "dem_util.glsl"

  // Hillshade-specific uniforms for DEM decoding
  uniform vec3 uHillshadeRGBScaler;
  uniform float uHillshadeBoundary; // Boundary value marking no-data
  uniform float uHillshadeMinOffset; // Offset for values below boundary
  uniform float uHillshadeMaxOffset; // Offset for values above boundary
  uniform float uHillshadeEpsilon; // Scale factor for height conversion
  uniform float uHillshadeOffset; // Additive offset (applied after epsilon)

  // Decode height from RGB DEM texture
  float decodeHeightForHillshade(vec4 color) {
    return decodeDEMHeight(
      color,
      uHillshadeRGBScaler,
      uHillshadeBoundary,
      uHillshadeMinOffset,
      uHillshadeMaxOffset,
      uHillshadeEpsilon,
      uHillshadeOffset
    );
  }

  // Sample height with manual bilinear interpolation in decoded height space
  // texSize: actual texture size obtained via textureSize(demTexture, 0)
  float sampleHeightBilinear(sampler2D demTexture, vec2 uv, ivec2 texSize) {
    // Prepare bilinear sampling data (pixel coordinates and interpolation weights)
    DEMBilinearData data = prepareDEMBilinear(texSize, uv);

    // Decode heights at 4 sample points
    float h00 = decodeHeightForHillshade(texelFetch(demTexture, data.p00, 0));
    if(!isValidHeight(h00)) {
      return invalidHeight;
    }

    float h10 = decodeHeightForHillshade(texelFetch(demTexture, data.p10, 0));
    float h01 = decodeHeightForHillshade(texelFetch(demTexture, data.p01, 0));
    float h11 = decodeHeightForHillshade(texelFetch(demTexture, data.p11, 0));

    // Perform bilinear interpolation with artifact detection
    return interpolateDEMHeights(h00, h10, h01, h11, data.frac);
  }

  // Compute normal from DEM using Sobel operator
  // Uses real-world meters-per-texel for accurate hillshade across zoom levels
  vec3 computeNormalFromDEM(sampler2D demTexture, vec2 uv, vec2 texelSize, float metersPerTexel) {
    // Get texture size once to avoid repeated textureSize calls
    ivec2 texSize = textureSize(demTexture, 0);

    // Sample 3x3 grid of heights with bilinear interpolation
    // Grid layout (DEM rows run top-down, so +v points south):
    //   g  h  i   north
    //   d  e  f
    //   a  b  c   south
    // Texture has 1-pixel padding with backfilled neighbor data, so we can sample freely
    float a = sampleHeightBilinear(demTexture, uv + vec2(-texelSize.x,  texelSize.y), texSize);
    float b = sampleHeightBilinear(demTexture, uv + vec2(0.0,           texelSize.y), texSize);
    float c = sampleHeightBilinear(demTexture, uv + vec2( texelSize.x,  texelSize.y), texSize);
    float d = sampleHeightBilinear(demTexture, uv + vec2(-texelSize.x,  0.0), texSize);
    float e = sampleHeightBilinear(demTexture, uv, texSize);
    float f = sampleHeightBilinear(demTexture, uv + vec2( texelSize.x,  0.0), texSize);
    float g = sampleHeightBilinear(demTexture, uv + vec2(-texelSize.x, -texelSize.y), texSize);
    float h = sampleHeightBilinear(demTexture, uv + vec2(0.0,          -texelSize.y), texSize);
    float i = sampleHeightBilinear(demTexture, uv + vec2( texelSize.x, -texelSize.y), texSize);

    // Handle invalid data (ocean/no-data marked as -1.0)
    if (!isValidHeight(e)) return vec3(0.0, 0.0, 1.0); // Flat normal for invalid areas
    if (!isValidHeight(a)) a = e;
    if (!isValidHeight(b)) b = e;
    if (!isValidHeight(c)) c = e;
    if (!isValidHeight(d)) d = e;
    if (!isValidHeight(f)) f = e;
    if (!isValidHeight(g)) g = e;
    if (!isValidHeight(h)) h = e;
    if (!isValidHeight(i)) i = e;

    // Sobel operator for gradient calculation
    float dX = (c + f + f + i) - (a + d + d + g);
    float dY = (a + b + b + c) - (g + h + h + i);

    // Sobel weights sum to 4 and the differences span 2 texels
    float slopeX = dX / (8.0 * metersPerTexel);
    float slopeY = dY / (8.0 * metersPerTexel);

    // Construct normal vector
    vec3 normal = vec3(-slopeX, slopeY, 1.0);

    return normalize(normal);
  }
#endif