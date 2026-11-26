// The label depth (SDF text, sprites): written in three's logarithmic
// encoding (log of 1 + view distance over log of 1 + far), then converted to
// the view's own depth convention. The label depth offsets are applied in
// this encoding, so they scale the view distance by the same factor in every
// convention.
#ifndef USE_LOGARITHMIC_DEPTH_BUFFER
#include <packing>
#include depth_pars_fragment;
#endif

// `logDepth` in the view's depth convention; `far` is the far plane.
float nvr_fromLogDepth(float logDepth, float far) {
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
    return logDepth;
#else
    return nvr_depthAtViewDistance(exp2(logDepth * log2(far + 1.0)) - 1.0);
#endif
}
