// Lit windows on building walls: a world-anchored window atlas pasted onto
// the pixels whose layer lists the effect in `effectIds`. Roofs and floors
// get none, the lit share rises with height above the ground, and distant
// walls fade so they do not flare into a white sheet.
//
// Prepended by the pass: three's <packing>, NORMAL_PACKING_SHADER,
// selective_effect_mask.glsl, takram's depth chunk (reverseLogDepth) and the
// NVR_* defines carrying the atlas layout.

uniform sampler2D nvrDiffuse;
uniform sampler2D nvrEffectIds;
uniform sampler2D nvrNormal;
uniform sampler2D nvrDepth;
uniform sampler2D nvrWindows;
uniform int nvrSlot;
uniform float nvrCameraNear;
uniform float nvrCameraFar;
uniform mat4 nvrInverseProjection;
uniform mat3 nvrCameraRotation;
uniform vec3 nvrEast;
uniform vec3 nvrNorth;
uniform vec3 nvrUp;
uniform vec3 nvrCameraFromOrigin;
uniform float nvrLitRatio;
uniform float nvrFloorHeight;
uniform float nvrColumnWidth;
uniform float nvrIntensity;
uniform float nvrGroundHeight;
// Radians per screen pixel.
uniform float nvrPixelAngle;

varying vec2 nvrUv;

// Lit share ramps from NVR_LOW_FRACTION on the ground to 1.0 at NVR_TALL_HEIGHT.
const float NVR_TALL_HEIGHT = 35.0;
const float NVR_LOW_FRACTION = 0.7;
// Color temperature varies in patches about this size (meters).
const float NVR_TINT_SCALE = 40.0;
const float NVR_FADE_DISTANCE = 6000.0;
// Windows shrunk to a pixel or two average out to a faint gray; brighten
// them up to this factor so low-rise districts still read as lit from afar.
const float NVR_FAR_BOOST = 3.0;
const vec3 NVR_WHITE = vec3(1.0, 0.97, 0.88);
const vec3 NVR_WARM = vec3(1.0, 0.78, 0.5);

float nvrHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float nvrTintNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = nvrHash(i);
  float b = nvrHash(i + vec2(1.0, 0.0));
  float c = nvrHash(i + vec2(0.0, 1.0));
  float d = nvrHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Interpolates the baked lit patterns to a continuous lit share.
float nvrLitMask(vec4 m, float ratio) {
  if (ratio < NVR_LIT_LEVEL_0) return m.r * (ratio / NVR_LIT_LEVEL_0);
  if (ratio < NVR_LIT_LEVEL_1) return mix(m.r, m.g, (ratio - NVR_LIT_LEVEL_0) / (NVR_LIT_LEVEL_1 - NVR_LIT_LEVEL_0));
  if (ratio < NVR_LIT_LEVEL_2) return mix(m.g, m.b, (ratio - NVR_LIT_LEVEL_1) / (NVR_LIT_LEVEL_2 - NVR_LIT_LEVEL_1));
  if (ratio < NVR_LIT_LEVEL_3) return mix(m.b, m.a, (ratio - NVR_LIT_LEVEL_2) / (NVR_LIT_LEVEL_3 - NVR_LIT_LEVEL_2));
  return m.a;
}

// No early returns: the atlas lookup relies on screen-space derivatives for
// its mip level, which need uniform control flow.
void main() {
  vec4 base = texture2D(nvrDiffuse, nvrUv);
  float rawDepth = unpackRGBAToDepth(texture2D(nvrDepth, nvrUv));
  // Pixels at the far plane (the sky) are never walls.
  float selected = extractEffectBit(texture2D(nvrEffectIds, nvrUv).r, nvrSlot) * (1.0 - step(1.0 - 1.0 / 8388608.0, rawDepth));

  vec3 normalWorld = nvrCameraRotation * unpackVec2ToNormal(texture2D(nvrNormal, nvrUv).xy);
  // Roofs and floors get no windows.
  float wall = 1.0 - step(0.5, abs(dot(normalWorld, nvrUp)));

  // Distance along the view axis, with logarithmic depth undone first so the
  // same code serves both depth modes.
  float depth = reverseLogDepth(rawDepth, nvrCameraNear, nvrCameraFar);
  float eyeDistance = -perspectiveDepthToViewZ(depth, nvrCameraNear, nvrCameraFar);

  // Position relative to the anchor origin, in world orientation.
  vec4 nearPoint = nvrInverseProjection * vec4(nvrUv * 2.0 - 1.0, -1.0, 1.0);
  vec3 nearEc = nearPoint.xyz / nearPoint.w;
  vec3 local = nvrCameraRotation * (nearEc * (eyeDistance / -nearEc.z)) + nvrCameraFromOrigin;

  // Height above the ground. The ground itself drops below the anchor's
  // tangent plane with distance (by d² / 2R), so that drop is added back.
  float rise = dot(local, nvrUp);
  float horizontal2 = dot(local, local) - rise * rise;
  float height = rise + horizontal2 / (2.0 * NVR_EARTH_RADIUS) - nvrGroundHeight;
  float aboveGround = step(0.0, height);

  // Distance along the wall on the anchor's ground plane.
  vec2 plane = vec2(dot(local, nvrEast), dot(local, nvrNorth));
  vec3 tangent = cross(nvrUp, normalWorld);
  vec2 alongRaw = vec2(dot(tangent, nvrEast), dot(tangent, nvrNorth));
  float alongLength = length(alongRaw);
  vec2 along = alongLength > 1e-4 ? alongRaw / alongLength : vec2(1.0, 0.0);
  float s = dot(plane, along);

  vec2 uv = vec2(s / nvrColumnWidth, height / nvrFloorHeight) / NVR_CELLS;
  vec4 masks = texture2D(nvrWindows, uv);
  float ratio = nvrLitRatio * mix(NVR_LOW_FRACTION, 1.0, smoothstep(0.0, NVR_TALL_HEIGHT, height));
  float lit = nvrLitMask(masks, ratio) * NVR_MAX_BRIGHTNESS;

  float warmth = nvrTintNoise(plane / NVR_TINT_SCALE);
  vec3 color = mix(NVR_WHITE, NVR_WARM, smoothstep(0.35, 0.75, warmth));

  // Distant walls hold thousands of windows per pixel; without this they
  // flare into a white sheet. Squared so the foreground keeps full strength.
  float ratioDistance = eyeDistance / NVR_FADE_DISTANCE;
  float fade = exp(-ratioDistance * ratioDistance);

  // Boost once a pixel spans more than half a window pitch.
  float metersPerPixel = eyeDistance * nvrPixelAngle;
  float boost = clamp(
    (2.0 * metersPerPixel) / min(nvrColumnWidth, nvrFloorHeight),
    1.0,
    NVR_FAR_BOOST
  );

  vec3 glow = color * (lit * fade * boost * nvrIntensity * selected * wall * aboveGround);
  gl_FragColor = vec4(base.rgb + glow, base.a);
}
