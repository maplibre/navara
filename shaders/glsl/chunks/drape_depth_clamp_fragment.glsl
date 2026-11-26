// Writes the depth chunks/drape_depth_clamp_vertex kept off `gl_Position`,
// clamped to the far plane. Placed after <logdepthbuf_fragment>.
#ifdef USE_REVERSED_DEPTH_BUFFER
    gl_FragDepth = max(nvrDrapeWindowZ * gl_FragCoord.w, 0.0);
#elif !defined(USE_LOGARITHMIC_DEPTH_BUFFER)
    gl_FragDepth = min(nvrDrapeWindowZ * gl_FragCoord.w, 1.0);
#endif
