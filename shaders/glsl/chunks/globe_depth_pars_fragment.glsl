// The RGBA-packed globe depth copy and its inverse. Requires `logDepthBufFC`
// declared when USE_LOGARITHMIC_DEPTH_BUFFER is defined.
uniform sampler2D tGlobeDepth;
#ifndef USE_LOGARITHMIC_DEPTH_BUFFER
    uniform mat4 projectionMatrix;
#endif

// Eye-space distance along -z of the globe at an unpacked globe depth. A
// logarithmic depth stores `log2(1 + w) * logDepthBufFC * 0.5`.
float nvr_globeEyeDistance(float depth) {
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
    return exp2(2.0 * depth / logDepthBufFC) - 1.0;
#else
    return projectionMatrix[3][2] / (depth * 2.0 - 1.0 + projectionMatrix[2][2]);
#endif
}
