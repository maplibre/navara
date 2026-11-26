// The depth convention of the view, for shaders that read a depth copy or
// write their own depth. three defines USE_REVERSED_DEPTH_BUFFER (window
// depth 1 at the near plane and 0 at the far plane) or
// USE_LOGARITHMIC_DEPTH_BUFFER; with neither, depth is three's standard one.
// Reading an RGBA-packed copy needs three's <packing>.

// The depth of the far plane, which a cleared depth buffer holds.
#ifdef USE_REVERSED_DEPTH_BUFFER
    #define NVR_FAR_DEPTH 0.0
#else
    #define NVR_FAR_DEPTH 1.0
#endif

// A depth copy (globe depth, all depth) at `uv`. Copies of a reversed depth
// are floats; the others are RGBA-packed (three's <packing>).
float nvr_readDepthCopy(sampler2D copy, vec2 uv) {
#ifdef USE_REVERSED_DEPTH_BUFFER
    return texture2D(copy, uv).r;
#else
    return unpackRGBAToDepth(texture2D(copy, uv));
#endif
}

// Whether a depth is the cleared far plane: nothing was drawn there. A
// reversed far plane is exactly 0, and the float depth copies keep it exact.
// No margin there: a reversed depth falls toward 0 like near / distance, so
// even `<= 2^-23` would also take every surface past ~89 % of a far plane
// 1e6 times the near one. The packed copies of the other conventions keep a
// margin of 2^-23 below 1.
bool nvr_isFarDepth(float depth) {
#ifdef USE_REVERSED_DEPTH_BUFFER
    return depth <= 0.0;
#else
    return depth >= 1.0 - 1.0 / 8388608.0;
#endif
}

// Whether depth `a` is nearer the camera than depth `b`.
bool nvr_isNearerDepth(float a, float b) {
#ifdef USE_REVERSED_DEPTH_BUFFER
    return a > b;
#else
    return a < b;
#endif
}

// `depth` nudged toward the camera by more than a depth copy rounds it: an
// RGBA-packed copy is exact to about 2^-32, a float one to 2^-24 of its value.
float nvr_depthTowardCamera(float depth) {
#ifdef USE_REVERSED_DEPTH_BUFFER
    return min(depth * (1.0 + 1e-6), 1.0);
#else
    return max(depth - 1e-6, 0.0);
#endif
}
