#if defined(USE_BATCH_SHOW_OPACITY) && defined(USE_FEATURE_ID_TEXTURE)
// Set per fragment by feature_id_texture_fragment.glsl.
float nvr_vShow = 1.0;
float nvr_vOpacity = 1.0;
#elif defined(USE_BATCH_SHOW_OPACITY)
in float nvr_vShow;
in float nvr_vOpacity;
#endif
