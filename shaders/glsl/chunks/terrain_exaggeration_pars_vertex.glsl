#ifndef TERRAIN_EXAGGERATION_PARS_VERTEX_GLSL
#define TERRAIN_EXAGGERATION_PARS_VERTEX_GLSL

#include "ellipsoid.glsl"

// x: scale, y: relative height. The rendered height of a vertex at terrain
// height h is (h - y) * x + y.
uniform vec2 uTerrainExaggeration;
// Unexaggerated terrain height (meters) of the vertex.
attribute float terrainHeight;

// Geodetic surface normal at a model-space position, in model space.
vec3 nvr_terrainUp(vec3 positionMC) {
  vec3 positionWC = (modelMatrix * vec4(positionMC, 1.0)).xyz;
  return inverseTransformDirection(normalize(positionWC * ONE_OVER_WGS84_RADII_SQUARED), modelMatrix);
}

// Model-space offset that moves a vertex from its terrain height to the
// exaggerated one.
vec3 nvr_terrainExaggerationOffset(vec3 up) {
  float scale = uTerrainExaggeration.x;
  float relativeHeight = uTerrainExaggeration.y;
  return up * ((terrainHeight - relativeHeight) * (scale - 1.0));
}

// Scaling heights by `scale` scales the surface slopes by `scale`: keep the
// normal's component along `up` and scale the tangential remainder.
vec3 nvr_exaggerateTerrainNormal(vec3 normal, vec3 up) {
  vec3 along = dot(normal, up) * up;
  return normalize(along + (normal - along) * uTerrainExaggeration.x);
}

#endif // TERRAIN_EXAGGERATION_PARS_VERTEX_GLSL
