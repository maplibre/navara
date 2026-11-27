#ifdef USE_FEATURE_ID_TEXTURE
// three declares `uv` always and `uvN` only for its own USE_UVN.
#if FEATURE_ID_TEXCOORD == 0
#define NVR_FEATURE_ID_UV uv
#elif FEATURE_ID_TEXCOORD == 1
#ifndef USE_UV1
in vec2 uv1;
#endif
#define NVR_FEATURE_ID_UV uv1
#elif FEATURE_ID_TEXCOORD == 2
#ifndef USE_UV2
in vec2 uv2;
#endif
#define NVR_FEATURE_ID_UV uv2
#elif FEATURE_ID_TEXCOORD == 3
#ifndef USE_UV3
in vec2 uv3;
#endif
#define NVR_FEATURE_ID_UV uv3
#endif
out vec2 nvr_vFeatureIdUv;
#endif
