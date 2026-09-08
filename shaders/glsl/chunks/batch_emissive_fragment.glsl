#ifdef USE_BATCH_EMISSIVE
  // Per-feature emissive (folded rgb × intensity in the vertex stage)
  // replaces the material's emissive term. Injected before
  // emissivemap_fragment so the emissiveMap factor still applies on top.
  // Declared in gbuffer_pars_fragment.glsl.
  totalEmissiveRadiance = nvr_vEmissive;
#endif
