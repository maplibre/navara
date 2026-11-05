// Wave-perturbed water surface shared by the tile, polygon and model
// materials. The uniforms come from `WaterState` (src/water/waterState.ts).
// Needs three's lights pars (directional lights, light probe, ambient) above it.

#include "ggx.glsl"

uniform sampler2D nvrWaveTexture;
// View-space east, north and up at the camera.
struct NvrWaterFrame {
  vec3 east;
  vec3 north;
  vec3 up;
};
uniform NvrWaterFrame nvrWaterFrame;
// The waves of one water surface. The array sizes match WATER_TAP_COUNT and
// WATER_CASCADE_COUNT in waterState.ts.
struct NvrWaterWaves {
  // xy: east/north wave direction / tile length (1/m), zw: phase.
  vec4 taps[6];
  // x: rms slope, y: 1 / tile length (1/m), z: 1 / dominant wavelength (1/m).
  // The first cascade's w: mean square slope no cascade resolves.
  vec4 cascades[3];
  // Laid out like a tap.
  vec4 gust;
};
// Surfaces take an index into this array, not a struct: passing the struct to
// the functions copies it and costs several milliseconds at full-screen water.
#ifndef NVR_WATER_WAVES_COUNT
#define NVR_WATER_WAVES_COUNT 1
#endif
uniform NvrWaterWaves nvrWaterWaves[NVR_WATER_WAVES_COUNT];
// Position in the flow cycle, in [0, 1).
uniform float nvrWaterFlowPhase;
uniform samplerCube nvrWaterSkyEnvMap;
uniform bool nvrWaterUseSkyEnvMap;

// Water's reflectance at normal incidence (IOR 1.333).
const float NVR_WATER_F0 = 0.02;
// Must match WAVE_SLOPE_RANGE in waveTexture.ts.
const float NVR_WAVE_SLOPE_RANGE = 4.0;
// A cascade's normals fade out as one texture repeat shrinks from the upper to
// the lower bound in pixels; its slopes move into the roughness. Its finer
// detail is already averaged away by the mipmaps by then.
const vec2 NVR_WATER_FADE_PIXELS = vec2(32.0, 128.0);
// Stricter for the G-buffer, which SSR traces at reduced resolution.
const vec2 NVR_WATER_GBUFFER_FADE_PIXELS = vec2(64.0, 256.0);
// Looser for the sun highlight: its narrow lobe picks out the few wave facets
// that mirror the sun, which glitter only while the waves stay resolved.
const vec2 NVR_WATER_SUN_FADE_PIXELS = vec2(8.0, 32.0);
// Every cascade's normals and the gust patches fade out as the water recedes
// over this range in meters, whatever their size. Beyond it the eye no longer
// separates them, and the surface reads as one uniformly rough plane.
const vec2 NVR_WATER_WAVE_FADE_DISTANCE = vec2(300.0, 2000.0);
// Share of the unresolved ripples' slope variance that widens the sun lobe
// while resolved waves are drawn. A narrower lobe than Cox–Munk lets the
// resolved facets break the glitter path into separate highlights, as the
// ripples' own glints do.
const float NVR_WATER_SUN_FINE_SHARE = 0.3;
// The sun's extra taps run only where the half vector's tilt is within this
// many times the mean square slope (Beckmann falls to e^-16 of its peak).
const float NVR_WATER_SUN_LOBE_RANGE = 16.0;
// How much the gust patches scale the slopes around 1.
const float NVR_WATER_PATCH_AMOUNT = 0.15;
// Caps the slope variance added for the slope change across one pixel.
const float NVR_WATER_MAX_ANTIALIAS_SLOPE = 0.18;
// Length of one flow cycle in seconds. Must match WATER_FLOW_PERIOD in
// waterState.ts. Spatially varying flow stretches the pattern by its gradient
// times half this, so shorter cycles distort less but crossfade more often.
const float NVR_WATER_FLOW_PERIOD = 8.0;
// Offset between the two flow layers in meters, so their patterns differ.
const vec2 NVR_WATER_FLOW_LAYER_OFFSET = vec2(37.1, 61.3);
// Scales the mean tilt of the visible facets toward the viewer down to the
// tilt that reflects the Fresnel-weighted mean sky elevation (fitted by Monte
// Carlo over Cox–Munk slopes at grazing views).
const float NVR_WATER_VISIBLE_TILT_SCALE = 0.7;
// The sun's angular radius in radians, SkyMesh's default `sunAngularRadius`.
const float NVR_WATER_SUN_ANGULAR_RADIUS = 0.004675;
// Keeps the sun lobe finite on still water. Its tail stays within a pixel even
// where the highlight overexposes, so the reflected disc stays round.
const float NVR_WATER_MIN_SUN_MEAN_SQUARE_SLOPE = 4e-8;
// Caps the unbounded lobe peak so the half-float frame never stores Inf.
const float NVR_WATER_MAX_SPECULAR_BRDF = 1024.0;

// Camera-relative east/north meters on the water and their screen derivatives.
struct NvrWaterCoord {
  vec2 position;
  vec2 dx;
  vec2 dy;
  // View-space direction to the camera.
  vec3 toEye;
  // Meters to the camera.
  float distance;
};

struct NvrWaterSurface {
  // View space, for the forward shading.
  vec3 normal;
  // Mean square of the slopes the normal leaves out.
  float meanSquareSlope;
  // Mean square of all slopes, resolved or not.
  float totalMeanSquareSlope;
  // The sun highlight's normal and mean square of the slopes it leaves out.
  vec3 sunNormal;
  float sunMeanSquareSlope;
  vec3 gbufferNormal;
  float gbufferRoughness;
};

// Takes the derivatives, so call it in uniform control flow.
NvrWaterCoord nvrWaterCoord(const in vec3 viewPosition) {
  vec3 relative = -viewPosition;
  vec2 position = vec2(dot(relative, nvrWaterFrame.east), dot(relative, nvrWaterFrame.north));
  return NvrWaterCoord(position, dFdx(position), dFdy(position), normalize(viewPosition), length(viewPosition));
}

// Slope of one tap in east/north, from realization A (RG) or B (BA).
vec2 nvrWaterTapSlope(const in vec4 tap, const in NvrWaterCoord coord, const in bool realizationB) {
  vec2 across = vec2(-tap.y, tap.x);
  vec2 uv = vec2(dot(coord.position, tap.xy), dot(coord.position, across)) + tap.zw;
  vec2 uvDx = vec2(dot(coord.dx, tap.xy), dot(coord.dx, across));
  vec2 uvDy = vec2(dot(coord.dy, tap.xy), dot(coord.dy, across));
  vec4 texel = textureGrad(nvrWaveTexture, uv, uvDx, uvDy);
  vec2 slope = ((realizationB ? texel.ba : texel.rg) - 0.5) * (2.0 * NVR_WAVE_SLOPE_RANGE);
  vec2 along = normalize(tap.xy);
  return slope.x * along + slope.y * vec2(-along.y, along.x);
}

float nvrWaterRoughness(const in float meanSquareSlope) {
  // GGX alpha ≈ Beckmann m = √mss, and the G-buffer stores √alpha.
  return sqrt(sqrt(meanSquareSlope));
}

vec3 nvrWaterPerturb(const in vec3 normal, const in vec2 slope) {
  vec3 tangent = normalize(nvrWaterFrame.east - dot(nvrWaterFrame.east, normal) * normal);
  vec3 bitangent = cross(normal, tangent);
  return normalize(normal - slope.x * tangent - slope.y * bitangent);
}

// Resolved slopes and the variance left to the roughness, before the
// exaggeration and gust scale them.
struct NvrWaterSlopes {
  vec2 slope;
  vec2 gbufferSlope;
  vec2 sunSlope;
  float hidden;
  float gbufferHidden;
  float sunHidden;
  float antialias;
};

// Mean square of all the waves' slopes, resolved or not.
float nvrWaterTotalMeanSquareSlope(const in int waves) {
  float total = nvrWaterWaves[waves].cascades[0].w;
  for (int i = 0; i < 3; i++) {
    vec4 cascade = nvrWaterWaves[waves].cascades[i];
    total += cascade.x * cascade.x;
  }
  return total;
}

// Whether any wave facet can mirror the sun toward the camera here.
bool nvrWaterNearSunGlitter(const in NvrWaterCoord coord, const in vec3 geometryNormal, const in float exaggeration, const in int waves) {
  #if NUM_DIR_LIGHTS > 0
  vec3 halfDirection = normalize(directionalLights[0].direction + coord.toEye);
  float cosHalf = dot(geometryNormal, halfDirection);
  if (cosHalf <= 0.0) return false;
  float tan2 = (1.0 - cosHalf * cosHalf) / (cosHalf * cosHalf);
  return tan2 < NVR_WATER_SUN_LOBE_RANGE * nvrWaterTotalMeanSquareSlope(waves) * exaggeration * exaggeration;
  #else
  return false;
  #endif
}

// `exaggeration` only sets the filtering: steeper waves change more across a
// pixel, so they are filtered and faded as if seen from that much farther.
// `resolveSun` keeps finer waves in the sun's normal; elsewhere it is the
// forward normal.
NvrWaterSlopes nvrWaterSlopes(const in NvrWaterCoord coord, const in float exaggeration, const in bool resolveSun, const in int waves) {
  // Ground meters per pixel along the most stretched screen axis.
  float footprint = max(max(length(coord.dx), length(coord.dy)), 1e-6);
  float filterScale = max(exaggeration, 1.0);
  NvrWaterCoord filtered = NvrWaterCoord(coord.position, coord.dx * filterScale, coord.dy * filterScale, coord.toEye, coord.distance);
  float waveFade = 1.0 - smoothstep(NVR_WATER_WAVE_FADE_DISTANCE.x, NVR_WATER_WAVE_FADE_DISTANCE.y, coord.distance * filterScale);

  float fine = nvrWaterWaves[waves].cascades[0].w;
  float sunFine = resolveSun ? fine * mix(1.0, NVR_WATER_SUN_FINE_SHARE, waveFade) : fine;
  NvrWaterSlopes slopes = NvrWaterSlopes(vec2(0.0), vec2(0.0), vec2(0.0), fine, fine, sunFine, 0.0);
  for (int i = 0; i < 3; i++) {
    vec4 cascade = nvrWaterWaves[waves].cascades[i];
    float pixels = 1.0 / (cascade.y * footprint * filterScale);
    float weight = waveFade * smoothstep(NVR_WATER_FADE_PIXELS.x, NVR_WATER_FADE_PIXELS.y, pixels);
    float gbufferWeight = waveFade * smoothstep(NVR_WATER_GBUFFER_FADE_PIXELS.x, NVR_WATER_GBUFFER_FADE_PIXELS.y, pixels);
    float sunWeight = resolveSun ? waveFade * smoothstep(NVR_WATER_SUN_FADE_PIXELS.x, NVR_WATER_SUN_FADE_PIXELS.y, pixels) : weight;
    float variance = cascade.x * cascade.x;
    // The sun's normal fades last, so a cascade it drops adds only roughness
    // and skips its taps (explicit gradients keep the branch legal).
    if (sunWeight == 0.0) {
      slopes.hidden += variance;
      slopes.gbufferHidden += variance;
      slopes.sunHidden += variance;
      continue;
    }
    // Both realizations have unit mean square slope.
    vec2 cascadeSlope = (nvrWaterTapSlope(nvrWaterWaves[waves].taps[i * 2], filtered, false)
      + nvrWaterTapSlope(nvrWaterWaves[waves].taps[i * 2 + 1], filtered, true)) * (cascade.x * 0.70710678);
    slopes.slope += weight * cascadeSlope;
    slopes.gbufferSlope += gbufferWeight * cascadeSlope;
    slopes.sunSlope += sunWeight * cascadeSlope;
    slopes.hidden += (1.0 - weight * weight) * variance;
    slopes.gbufferHidden += (1.0 - gbufferWeight * gbufferWeight) * variance;
    slopes.sunHidden += (1.0 - sunWeight * sunWeight) * variance;
    // Slope change across one pixel of the waves still drawn.
    float perPixel = weight * cascade.x * PI2 * footprint * cascade.z;
    slopes.antialias += perPixel * perPixel;
  }
  return slopes;
}

NvrWaterSurface nvrWaterSurfaceFromSlopes(
  const in NvrWaterSlopes slopes,
  const in NvrWaterCoord coord,
  const in vec3 geometryNormal,
  const in float exaggeration,
  const in int waves
) {
  float patchAmount = NVR_WATER_PATCH_AMOUNT
    * (1.0 - smoothstep(NVR_WATER_WAVE_FADE_DISTANCE.x, NVR_WATER_WAVE_FADE_DISTANCE.y, coord.distance));
  float gust = 1.0;
  // Explicit gradients keep the branch legal.
  if (patchAmount > 0.0) {
    gust += patchAmount * clamp(nvrWaterTapSlope(nvrWaterWaves[waves].gust, coord, false).x, -2.0, 2.0);
  }
  float amplitude = exaggeration * gust;
  float energy = amplitude * amplitude;
  float antialias = min(slopes.antialias * energy, NVR_WATER_MAX_ANTIALIAS_SLOPE);

  NvrWaterSurface surface;
  surface.normal = nvrWaterPerturb(geometryNormal, slopes.slope * amplitude);
  surface.meanSquareSlope = slopes.hidden * energy + antialias;
  surface.totalMeanSquareSlope = nvrWaterTotalMeanSquareSlope(waves) * energy;
  surface.sunNormal = nvrWaterPerturb(geometryNormal, slopes.sunSlope * amplitude);
  surface.sunMeanSquareSlope = slopes.sunHidden * energy;
  surface.gbufferNormal = nvrWaterPerturb(geometryNormal, slopes.gbufferSlope * amplitude);
  surface.gbufferRoughness = nvrWaterRoughness(slopes.gbufferHidden * energy + antialias);
  return surface;
}

NvrWaterSurface nvrWaterSurface(
  const in NvrWaterCoord coord,
  const in vec3 geometryNormal,
  const in float exaggeration,
  const in int waves
) {
  bool resolveSun = nvrWaterNearSunGlitter(coord, geometryNormal, exaggeration, waves);
  return nvrWaterSurfaceFromSlopes(nvrWaterSlopes(coord, exaggeration, resolveSun, waves), coord, geometryNormal, exaggeration, waves);
}

// Waves also carried by a current, `flow` in east/north m/s, which may vary
// per fragment (a view-space vector v becomes
// vec2(dot(v, nvrWaterFrame.east), dot(v, nvrWaterFrame.north))). Two layers
// each drift with the flow for one cycle and restart; each fades out before it
// restarts, so the pattern never stretches without bound. Samples twice as many
// taps.
// ref: Alex Vlachos, "Water Flow in Portal 2", SIGGRAPH 2010
NvrWaterSurface nvrWaterFlowSurface(
  const in NvrWaterCoord coord,
  const in vec3 geometryNormal,
  const in float exaggeration,
  const in vec2 flow,
  const in int waves
) {
  float phaseA = nvrWaterFlowPhase;
  float phaseB = fract(phaseA + 0.5);
  // Each layer peaks mid-cycle, where its drift is centered on zero.
  float weightA = 1.0 - abs(2.0 * phaseA - 1.0);
  float weightB = 1.0 - weightA;

  NvrWaterCoord coordA = coord;
  coordA.position -= flow * ((phaseA - 0.5) * NVR_WATER_FLOW_PERIOD);
  NvrWaterCoord coordB = coord;
  coordB.position -= flow * ((phaseB - 0.5) * NVR_WATER_FLOW_PERIOD) - NVR_WATER_FLOW_LAYER_OFFSET;
  bool resolveSun = nvrWaterNearSunGlitter(coord, geometryNormal, exaggeration, waves);
  NvrWaterSlopes a = nvrWaterSlopes(coordA, exaggeration, resolveSun, waves);
  NvrWaterSlopes b = nvrWaterSlopes(coordB, exaggeration, resolveSun, waves);

  // The layers are uncorrelated, so rescale their blend to the full variance.
  float rescale = inversesqrt(weightA * weightA + weightB * weightB);
  NvrWaterSlopes slopes;
  slopes.slope = (weightA * a.slope + weightB * b.slope) * rescale;
  slopes.gbufferSlope = (weightA * a.gbufferSlope + weightB * b.gbufferSlope) * rescale;
  slopes.sunSlope = (weightA * a.sunSlope + weightB * b.sunSlope) * rescale;
  slopes.hidden = weightA * a.hidden + weightB * b.hidden;
  slopes.gbufferHidden = weightA * a.gbufferHidden + weightB * b.gbufferHidden;
  slopes.sunHidden = weightA * a.sunHidden + weightB * b.sunHidden;
  slopes.antialias = weightA * a.antialias + weightB * b.antialias;
  return nvrWaterSurfaceFromSlopes(slopes, coord, geometryNormal, exaggeration, waves);
}

// Fresnel averaged over the unresolved slopes.
// ref: https://github.com/Scrawk/Brunetons-Ocean/blob/master/Assets/BrunetonsOcean/Shaders/OceanBRDF.cginc
float nvrWaterFresnel(const in float dotNV, const in float meanSquareSlope) {
  float sigma = sqrt(0.5 * meanSquareSlope);
  float mean = pow(1.0 - dotNV, 5.0 * exp(-2.69 * sigma)) / (1.0 + 22.7 * pow(sigma, 1.5));
  return NVR_WATER_F0 + (1.0 - NVR_WATER_F0) * mean;
}

// Sky radiance along a view-space direction, blurred by the reflected rays'
// spread.
vec3 nvrWaterSky(in vec3 direction, const in float meanSquareSlope) {
  if (nvrWaterUseSkyEnvMap) {
    // The env map sees the ground below the camera's horizontal plane. A ray
    // leaving distant water can point below that plane (the surface there
    // tilts with the Earth's curvature) yet still meets sky, so fold it up.
    direction -= 2.0 * min(dot(direction, nvrWaterFrame.up), 0.0) * nvrWaterFrame.up;
    float faceSize = float(textureSize(nvrWaterSkyEnvMap, 0).x);
    // The rays spread over about twice the rms slope; a face spans π/2.
    float lod = log2(max(2.0 * sqrt(meanSquareSlope) * faceSize / PI_HALF, 1.0));
    return textureLod(nvrWaterSkyEnvMap, transformDirectionByInverseViewMatrix(direction, viewMatrix), lod).rgb;
  }
  #if defined(USE_LIGHT_PROBES)
  return getLightProbeIrradiance(lightProbe, direction) * RECIPROCAL_PI;
  #else
  return ambientLightColor * RECIPROCAL_PI;
  #endif
}

// Beckmann distribution of Gaussian slopes with mean square slope `m2`, widened
// by the sun's disc: flat over the half vectors that see the disc and Gaussian
// beyond them. `discArea` is the disc's area in slope space, and the
// normalization keeps the energy for any ratio of `m2` to it. Sea slopes are
// close to Gaussian (Cox–Munk); a GGX tail would spread the highlight far from
// the sun's mirror direction.
float nvrWaterSunLobe(const in float m2, const in float discArea, const in vec3 normal, const in vec3 halfDirection) {
  vec3 tilt = cross(normal, halfDirection);
  float cos2 = max(pow2(dot(normal, halfDirection)), 1e-8);
  float area = PI * (m2 + sqrt(m2 * discArea)) + discArea;
  return exp(-dot(tilt, tilt) / (m2 * cos2)) / (area * cos2 * cos2);
}

vec3 nvrWaterSun(const in NvrWaterSurface surface, const in vec3 toEye) {
  #if NUM_DIR_LIGHTS > 0
  // Assumes the first directional light is the sun.
  DirectionalLight sun = directionalLights[0];
  vec3 normal = surface.sunNormal;
  float dotNL = dot(normal, sun.direction);
  float dotNV = dot(normal, toEye);
  if (dotNL <= 0.0 || dotNV <= 0.0) return vec3(0.0);
  // The point on the sun's disc closest to the mirror direction.
  // ref: https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf
  vec3 mirror = reflect(-toEye, normal);
  vec3 toMirror = dot(sun.direction, mirror) * mirror - sun.direction;
  vec3 lightDirection = normalize(
    sun.direction + toMirror * saturate(NVR_WATER_SUN_ANGULAR_RADIUS / max(length(toMirror), 1e-6))
  );
  vec3 halfDirection = normalize(lightDirection + toEye);
  float alpha2 = max(surface.sunMeanSquareSlope, NVR_WATER_MIN_SUN_MEAN_SQUARE_SLOPE);
  float dotVH = saturate(dot(toEye, halfDirection));
  // A half vector turns half as far as the light, and 1/dotVH as far across the
  // plane of incidence, so the disc is an ellipse in slope space.
  float discArea = PI * pow2(0.5 * NVR_WATER_SUN_ANGULAR_RADIUS) / max(dotVH, 1e-2);
  float D = nvrWaterSunLobe(alpha2, discArea, normal, halfDirection);
  float V = nvr_V_GGX(alpha2, dotNL, dotNV);
  vec3 F = nvr_F_Schlick(vec3(NVR_WATER_F0), dotVH);
  return min(D * V * F, vec3(NVR_WATER_MAX_SPECULAR_BRDF)) * dotNL * sun.color;
  #else
  return vec3(0.0);
  #endif
}

// Light leaving the water: what `bodyLight` lit beneath the surface lets
// through, plus the reflected sky and sun.
vec3 nvrWaterShade(
  const in NvrWaterSurface surface,
  const in vec3 viewPosition,
  const in vec3 geometryNormal,
  const in vec3 bodyLight
) {
  vec3 toEye = normalize(viewPosition);
  vec3 normal = surface.normal;
  float fresnel = nvrWaterFresnel(saturate(dot(normal, toEye)), surface.meanSquareSlope);
  // Facets tilted toward the viewer fill more of a grazing view and hide the
  // ones behind them, so the sky they mirror sits higher than the mean
  // normal's mirror direction. Their mean tilt for Gaussian slopes of
  // variance sigma² along the view:
  // sigma²Φ(c/sigma) / (cΦ(c/sigma) + sigma·φ(c/sigma)), c = cot θ.
  // ref: Heitz, "Importance Sampling Microfacet-Based BSDFs using the Distribution of Visible Normals", EGSR 2014
  float cosView = saturate(dot(geometryNormal, toEye));
  vec3 towardEye = toEye - cosView * geometryNormal;
  float sinView = length(towardEye);
  float sigma = sqrt(0.5 * surface.totalMeanSquareSlope);
  float c = cosView / max(sinView, 1e-4);
  // Beyond 6 the CDF is 1; the clamp keeps tanh's argument finite.
  float x = min(c / max(sigma, 1e-4), 6.0);
  float cdf = 0.5 + 0.5 * tanh(0.7978846 * (x + 0.044715 * x * x * x));
  float pdf = 0.3989423 * exp(-0.5 * x * x);
  float tilt = sigma * sigma * cdf / max(c * cdf + sigma * pdf, 1e-6);
  vec3 visibleNormal = normalize(normal + NVR_WATER_VISIBLE_TILT_SCALE * tilt * towardEye / max(sinView, 1e-4));
  vec3 reflected = reflect(-toEye, visibleNormal);
  // A wave facing away can reflect below the horizon; fold it back up.
  reflected -= 2.0 * min(dot(reflected, geometryNormal), 0.0) * geometryNormal;
  vec3 sky = nvrWaterSky(reflected, surface.meanSquareSlope);
  return bodyLight * (1.0 - fresnel) + sky * fresnel + nvrWaterSun(surface, toEye);
}
