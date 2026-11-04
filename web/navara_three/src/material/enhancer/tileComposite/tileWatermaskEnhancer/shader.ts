/**
 * The watermask sampler plus a cubic B-spline lookup of it. The mask is
 * binary at its texel size, so its 0.5 contour is a staircase; the B-spline
 * smooths the mask first, which turns that contour into curves.
 */
export const watermaskGlobalUniformDecls = (): string => `
uniform sampler2D uWatermask;

// Cubic B-spline interpolation from four bilinear fetches; needs a
// LinearFilter texture. A one-texel-wide line keeps 2/3 at its center and
// survives the 0.5 threshold; an isolated texel drops to 4/9 and goes away.
// ref: Sigg & Hadwiger, "Fast Third-Order Texture Filtering", GPU Gems 2 ch. 20
float nvrWatermaskBSpline(const in vec2 uv) {
  vec2 size = vec2(textureSize(uWatermask, 0));
  vec2 coord = uv * size - 0.5;
  vec2 index = floor(coord);
  vec2 f = coord - index;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  // Each fetch lands between two texels so the bilinear filter weighs them.
  vec2 uv0 = (index - 0.5 + w1 / g0) / size;
  vec2 uv1 = (index + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * texture(uWatermask, uv0).r + g1.x * texture(uWatermask, vec2(uv1.x, uv0.y)).r)
    + g1.y * (g0.x * texture(uWatermask, vec2(uv0.x, uv1.y)).r + g1.x * texture(uWatermask, uv1).r);
}`;

/**
 * Sampled once after the slot loop and OR'd into isWater so it takes priority
 * even when no per-slot water flag fired (e.g. open-ocean tiles with no
 * raster/vector layers).
 */
export const watermaskPostLoop = (): string => `
  // Quantized-mesh watermask: 0 = land, 255 = water (per spec). Takes priority
  // over per-slot uWaters — even if no winning slot flagged water, watermask
  // can still mark this pixel as water. Threshold at 0.5 (byte > 127).
  isWater = max(isWater, step(0.5, nvrWatermaskBSpline(vUv)));`;
