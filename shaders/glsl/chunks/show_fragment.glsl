#ifdef USE_BATCH_SHOW_OPACITY
// nvr_vShow (0 or 1) and nvr_vOpacity (0.0-1.0) are decoded in
// batch_texture_vertex.glsl from the packed show/opacity component
// (see packShowOpacity in web/navara_three/src/batchTexture/core.ts).
if (nvr_vShow < 0.5) {
    discard;
}

// Treat fully transparent features as non-existent (prevents depth-write / picking artifacts)
if (nvr_vOpacity <= 0.0) {
    discard;
}

#endif
