// Feature IDs per texel (EXT_mesh_features "Feature ID by Texture
// Coordinates"); see web/navara_three/src/batchTexture/featureIdTexture.ts.
#ifdef USE_FEATURE_ID_TEXTURE
#include "batch_texture_pars.glsl"

uniform sampler2D nvr_featureIdTexture;
// Weight of each texel byte: the set's channels, little-endian.
uniform vec4 nvr_featureIdChannelWeights;
// -1 without a nullFeatureId.
uniform float nvr_featureIdNull;
uniform float nvr_featureIdCount;
in vec2 nvr_vFeatureIdUv;

// Set by feature_id_texture_fragment.glsl: the feature index (-1 for none)
// and its pick ID (0 for none).
float nvr_featureId = -1.0;
float nvr_featurePickId = 0.0;
#ifdef USE_BATCH_COLOR
vec3 nvr_batchColor = vec3(1.0);
#endif
#define NVR_PICK_ID_OR(vertexId) nvr_featurePickId
#else
#define NVR_PICK_ID_OR(vertexId) (vertexId)
#endif
