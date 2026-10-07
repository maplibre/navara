uniform sampler2D inputBuffer;
uniform sampler2D depthBuffer;
uniform float exposure;
uniform vec2 resolution; // size of the target written to

in vec2 vUv;

// Builds the colour the cone's mip chain is generated from; coneTracing.frag.glsl
// undoes both transforms after sampling.
//
// - Reversible tonemap: box-filtered mips of raw HDR let a few bright texels
//   dominate the average around a dark silhouette; averaging compressed values
//   bounds each texel's share. Scaled by the tone-mapping exposure so it acts
//   on display-referred brightness; 0 disables it.
//   Ref: https://graphicrants.blogspot.com/2013/12/tone-mapping.html
// - Sky mask, premultiplied into alpha: a ray only ever resolves onto geometry
//   (a miss writes no hit), so sky texels must not reach its blur footprint.
//   The sky the water should show comes from the surface's own shading.
//
// Written at `resolutionScale` of inputBuffer, so every source texel this
// output texel covers is fetched unfiltered: a bilinear fetch would blend sky
// into a silhouette texel whose depth says geometry.

// Per axis. Footprints wider than this (resolutionScale below 1/8) are strided.
#define MAX_FOOTPRINT 8

void main() {
  ivec2 inputSize = textureSize(inputBuffer, 0);
  ivec2 depthSize = textureSize(depthBuffer, 0);
  vec2 ratio = vec2(inputSize) / resolution;

  // Source texels whose centres fall inside this output texel.
  vec2 lo = ceil((gl_FragCoord.xy - 0.5) * ratio - 0.5);
  vec2 hi = max(ceil((gl_FragCoord.xy + 0.5) * ratio - 0.5), lo + 1.0);
  ivec2 first = ivec2(lo);
  ivec2 count = ivec2(hi - lo);
  ivec2 stride = (count + MAX_FOOTPRINT - 1) / MAX_FOOTPRINT;

  vec4 sum = vec4(0.0);
  float taps = 0.0;
  for (int y = 0; y < MAX_FOOTPRINT; ++y) {
    if (y * stride.y >= count.y) break;
    for (int x = 0; x < MAX_FOOTPRINT; ++x) {
      if (x * stride.x >= count.x) break;
      ivec2 coord = clamp(first + ivec2(x, y) * stride, ivec2(0), inputSize - 1);
      vec3 color = texelFetch(inputBuffer, coord, 0).rgb;
      float depth = texelFetch(depthBuffer, coord * depthSize / inputSize, 0).r;
      // Ref: https://en.wikipedia.org/wiki/Relative_luminance
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float geometry = step(depth, 0.9999);
      sum += vec4(color / (1.0 + luma * exposure), 1.0) * geometry;
      taps += 1.0;
    }
  }
  gl_FragColor = sum / taps;
}
