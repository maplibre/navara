// Keeps the draped volume from being clipped at the far plane. It can reach
// hundreds of kilometres below the ground, and its back faces only have to
// land behind the terrain for the stencil count, which a depth clamped to the
// far plane still does. Placed after <logdepthbuf_vertex>: a logarithmic depth
// is written per fragment from `w`, which this leaves as is; otherwise the
// unclamped window depth goes to chunks/drape_depth_clamp_fragment.
#ifndef USE_LOGARITHMIC_DEPTH_BUFFER
    // Window depth times `w`, which interpolates exactly.
    nvrDrapeWindowZ = 0.5 * (gl_Position.z + gl_Position.w);
#endif
gl_Position.z = min(gl_Position.z, gl_Position.w);
