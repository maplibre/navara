#include "batch_texture_pars.glsl"

#ifdef USE_BATCH_TEXTURE
in float _batchid;

#if defined(USE_BATCH_EMISSIVE) && !defined(USE_FEATURE_ID_TEXTURE)
// Folded per-feature emissive (rgb × intensity); the fragment-side
// declaration lives in gbuffer_pars_fragment.glsl.
out vec3 nvr_vEmissive;
#endif
#endif // USE_BATCH_TEXTURE
