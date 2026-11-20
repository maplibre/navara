// Conversions between window depth and view distance in the view's depth
// convention (chunks/depth_convention). With USE_REVERSED_DEPTH_BUFFER clip z
// spans [0, w]; with neither define three's standard [-w, w]. The
// logarithmic case needs `logDepthBufFC`, declared by three's
// <logdepthbuf_pars_fragment>, before this chunk.
#include depth_convention;
#ifndef USE_LOGARITHMIC_DEPTH_BUFFER
    uniform mat4 projectionMatrix;
#endif

// Eye-space distance along -z at a window depth.
float nvr_viewDistanceAtDepth(float depth) {
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
    return exp2(2.0 * depth / logDepthBufFC) - 1.0;
#else
    #ifdef USE_REVERSED_DEPTH_BUFFER
        float ndcZ = depth;
    #else
        float ndcZ = depth * 2.0 - 1.0;
    #endif
    return projectionMatrix[3][2] / (ndcZ + projectionMatrix[2][2]);
#endif
}

// Window depth at an eye-space distance along -z; the inverse of
// nvr_viewDistanceAtDepth.
float nvr_depthAtViewDistance(float distance) {
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
    return log2(1.0 + distance) * logDepthBufFC * 0.5;
#else
    float ndcZ = projectionMatrix[3][2] / distance - projectionMatrix[2][2];
    #ifdef USE_REVERSED_DEPTH_BUFFER
        return ndcZ;
    #else
        return ndcZ * 0.5 + 0.5;
    #endif
#endif
}
