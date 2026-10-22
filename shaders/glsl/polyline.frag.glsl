#include chunks/pick;
#include chunks/planeDistance;
#include chunks/metersPerPixel;

#include <common>
#include <packing>
#include <color_pars_fragment>

#include <lights_pars_begin>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <logdepthbuf_pars_fragment>

uniform vec3 color;
uniform float uOpacity;
uniform float nvr_uPickable;

flat in float nvr_vBatchId;
flat in vec4 v_startPlaneNormalEcAndHalfWidth;
flat in vec3 v_endPlaneNormalEc;
flat in float v_startPlaneOffsetEc;
flat in float v_endPlaneOffsetEc;
in vec3 vNormal;

#if defined(NVR_LINE_DASH) || defined(USE_BATCH_LINE_DASH)
    #define NVR_USE_LINE_DASH
#endif

#if defined(NVR_GROUND_POLYLINE) || defined(NVR_USE_LINE_DASH)
    flat in vec4 v_rightPlaneEC;
    uniform float maxWidth;
    uniform vec3 viewportAndPixelRatio;
    uniform vec2 frustumNearFar;
    uniform vec4 frustumRatio;
#endif

#ifdef NVR_USE_LINE_DASH
    #include chunks/line_dash_pars_fragment;
    flat in vec4 nvr_vLineDash;
    flat in vec2 nvr_vLineDashPlaneScale;
    flat in float nvr_vLineDashSegment;
    flat in vec2 nvr_vLineDashLift;
    uniform sampler2D tLineDashSegments;
    // Volume polylines are always built for RTE, which the segment table
    // relies on.
    #ifndef USE_RTE
        #error "A dashed volume polyline needs USE_RTE"
    #endif
    uniform mat4 modelViewMatrixRTE;
    uniform vec3 u_cameraPositionHigh;
    uniform vec3 u_cameraPositionLow;
    // Always 1.0; see chunks/rte_pars_vertex.glsl.
    uniform float u_rteOne;

    vec4 nvr_lineDashSegmentTexel(int index) {
        int width = textureSize(tLineDashSegments, 0).x;
        return texelFetch(tLineDashSegments, ivec2(index % width, index / width), 0);
    }

    // Number of segments before a segment in its line, from its position in
    // the line; see append_line_segment.
    int nvr_lineDashSegmentsBefore(float positionInLine) {
        return int(positionInLine < 0.0 ? -positionInLine - 0.5 : positionInLine + 0.5);
    }

    // How far the length `lengthHigh + lengthLow` lies past the start of
    // `segment`.
    float nvr_lineDashPastSegmentStart(int segment, float lengthHigh, float lengthLow) {
        return (lengthHigh - nvr_lineDashSegmentTexel(segment * 3).w)
            + (lengthLow - nvr_lineDashSegmentTexel(segment * 3 + 1).w);
    }

    // Eye-space point of the line where its length is `lengthHigh +
    // lengthLow`, at most this segment's end, lifted by nvr_vLineDashLift.x.
    // It is read from the segment table, never from this fragment's own
    // varyings, so that every fragment asking about one length gets one point,
    // whichever segment it lies in.
    vec3 nvr_lineDashPointAt(float lengthHigh, float lengthLow) {
        int segment = int(nvr_vLineDashSegment + 0.5);
        // Search the line's segments up to this one for the last starting at
        // or before the length; their lengths so far increase. Before the
        // line's first segment, extrapolate it.
        if ((lengthHigh - nvr_vLineDash.y) + (lengthLow - nvr_vLineDash.z) < 0.0) {
            int high = segment - 1;
            int low = segment - nvr_lineDashSegmentsBefore(nvr_lineDashSegmentTexel(segment * 3 + 2).w);
            // A float holds segment indices exactly up to 2^24.
            for (int i = 0; i < 24; i++) {
                if (low >= high) {
                    break;
                }
                int middle = (low + high + 1) / 2;
                if (nvr_lineDashPastSegmentStart(middle, lengthHigh, lengthLow) >= 0.0) {
                    low = middle;
                } else {
                    high = middle - 1;
                }
            }
            segment = low;
        }
        vec4 start = nvr_lineDashSegmentTexel(segment * 3);
        vec4 startLow = nvr_lineDashSegmentTexel(segment * 3 + 1);
        // Volume polylines have no zero-length segments: the geometry builder
        // drops a position within a millimeter of the previous one.
        vec3 offset = nvr_lineDashSegmentTexel(segment * 3 + 2).xyz;
        float t = ((lengthHigh - start.w) + (lengthLow - startLow.w)) / length(offset);
        vec3 up = normalize(start.xyz + startLow.xyz);
        vec3 relative = (start.xyz - u_cameraPositionHigh) * u_rteOne
            + (startLow.xyz - u_cameraPositionLow)
            + offset * t + up * nvr_vLineDashLift.x;
        return (modelViewMatrixRTE * vec4(relative, 1.0)).xyz;
    }

    // Whether this segment starts (x) / ends (y) an open line. A closed ring
    // has no ends.
    bvec2 nvr_lineDashSegmentEnds() {
        int segment = int(nvr_vLineDashSegment + 0.5);
        float positionInLine = nvr_lineDashSegmentTexel(segment * 3 + 2).w;
        if (positionInLine < 0.0) {
            return bvec2(false);
        }
        // The line ends where the next entry starts another line, or where the
        // table does.
        int next = (segment + 1) * 3 + 2;
        ivec2 size = textureSize(tLineDashSegments, 0);
        return bvec2(
            positionInLine == 0.0,
            next >= size.x * size.y || nvr_lineDashSegmentTexel(next).w <= 0.0
        );
    }

    // Whether a fragment `fromStart` / `toEnd` meters from the segment's start
    // / end plane along it (negative past the plane) and `across` from the
    // center line lies in the line, counting the round or square cap at the
    // line's own ends.
    bool nvr_lineDashKeepsEnds(float fromStart, float toEnd, float across, float halfWidth) {
        float beyond = max(-fromStart, -toEnd);
        if (beyond <= 0.0) {
            return true;
        }
        int row = int(nvr_vLineDash.w + 0.5);
        int cap = row > 0 ? int(texelFetch(tLineDashAtlas, ivec2(0, row), 0).z + 0.5) : NVR_LINE_CAP_BUTT;
        if (cap == NVR_LINE_CAP_BUTT || beyond > halfWidth) {
            return false;
        }
        bvec2 ends = nvr_lineDashSegmentEnds();
        bool lineEnds = fromStart < 0.0 ? ends.x : ends.y;
        return lineEnds && (cap == NVR_LINE_CAP_SQUARE || length(vec2(beyond, across)) <= halfWidth);
    }

    // The line's width in meters at `depth` meters in front of the eye.
    // Clamped to maxWidth like the volume the vertex shader builds.
    float nvr_lineDashLineWidthAtDepth(float depth) {
        float lineWidth = 2.0 * v_startPlaneNormalEcAndHalfWidth.w
            * nvr_metersPerPixel(vec4(0.0, 0.0, -depth, 1.0), viewportAndPixelRatio, frustumNearFar, frustumRatio);
        return min(lineWidth, maxWidth);
    }

    // The line's width in meters at an eye-space point.
    float nvr_lineDashLineWidthAt(vec3 pointEc) {
        return nvr_lineDashLineWidthAtDepth(-pointEc.z);
    }
#endif

#ifdef NVR_GROUND_POLYLINE
    #include chunks/globe_depth_pars_fragment;
    #include chunks/ground_shadow_coord_pars_fragment;

    uniform mat4 inverseProjectionMatrix;
    #ifdef NVR_GROUND_POLYLINE_NORMALS
        uniform sampler2D tGlobeNormal;
    #endif

    // Eye-space globe position on the view ray through `ndcXy`.
    vec3 nvr_groundPositionEc(vec2 ndcXy, float depth) {
        vec4 nearPoint = inverseProjectionMatrix * vec4(ndcXy, -1.0, 1.0);
        vec3 nearPointEc = nearPoint.xyz / nearPoint.w;
        return nearPointEc * (nvr_globeEyeDistance(depth) / -nearPointEc.z);
    }
#endif

#include chunks/show_pars_fragment;

#include chunks/gbuffer_pars_fragment;

#ifdef USE_SELECTIVE_EFFECT
    uniform float uEffectIdsMask;
    uniform vec3 uEmissiveColor;
    uniform float uEmissiveIntensity;
#endif

void main() {
    #include chunks/show_fragment;

#ifdef NVR_GROUND_POLYLINE
    // Keep the fragment only where the ground point lies within half a line
    // width of the segment, between its miter planes.
    vec2 nvrGroundUv = gl_FragCoord.xy / vec2(textureSize(tGlobeDepth, 0));
    float nvrGroundDepth = unpackRGBAToDepth(texture2D(tGlobeDepth, nvrGroundUv));
    // Sky. A cleared 1.0 packs to vec4(1), which decodes to 1.0 or one f32
    // step below it; no reconstructible ground depth is that close to 1.
    if (nvrGroundDepth >= 1.0 - 1.0 / 8388608.0) {
        discard;
    }

    vec3 positionEc = nvr_groundPositionEc(nvrGroundUv * 2.0 - 1.0, nvrGroundDepth);

#ifdef NVR_GROUND_POLYLINE_NORMALS
    vec3 nvrGroundNormal = normalize(unpackVec2ToNormal(texture2D(
        tGlobeNormal, gl_FragCoord.xy / vec2(textureSize(tGlobeNormal, 0))
    ).xy));
#endif

    // Clamped to maxWidth like the volume, whose forward push only reaches
    // half the clamped width past each end.
    float nvrHalfWidth = min(
        v_startPlaneNormalEcAndHalfWidth.w
            * nvr_metersPerPixel(vec4(positionEc, 1.0), viewportAndPixelRatio, frustumNearFar, frustumRatio),
        0.5 * maxWidth
    );
    float nvrAcross = nvr_planeDistance(v_rightPlaneEC, positionEc);
    float nvrFromStart = nvr_planeDistance(v_startPlaneNormalEcAndHalfWidth.xyz, v_startPlaneOffsetEc, positionEc);
    float nvrToEnd = nvr_planeDistance(v_endPlaneNormalEc, v_endPlaneOffsetEc, positionEc);
    if (abs(nvrAcross) > nvrHalfWidth
#ifdef NVR_USE_LINE_DASH
        || !nvr_lineDashKeepsEnds(
            nvr_vLineDashPlaneScale.x * nvrFromStart,
            nvr_vLineDashPlaneScale.y * nvrToEnd,
            nvrAcross,
            nvrHalfWidth
        )
#else
        || nvrFromStart < 0.0 || nvrToEnd < 0.0
#endif
    ) {
        discard;
    }

    // Depth-test at the ground point so geometry in front of it occludes the
    // line. The bias covers the RGBA packing error against the globe depth.
    gl_FragDepth = max(nvrGroundDepth - 1e-6, 0.0);

    vec3 nvrGroundViewPosition = -positionEc;
#ifdef NVR_GROUND_POLYLINE_NORMALS
    vec3 nvrGroundShadowNormal = nvrGroundNormal;
#else
    vec3 nvrGroundShadowNormal = normalize(vNormal);
#endif
    #include chunks/ground_shadow_coord_fragment;
#else
    // The vertex shader pushes each segment past both ends to cover joint
    // gaps; clip it back to the start/end planes (both face into the segment)
    // so adjacent segments meet on their shared miter plane.
    vec3 positionEc = -vViewPosition;
    float nvrFromStart = nvr_planeDistance(v_startPlaneNormalEcAndHalfWidth.xyz, v_startPlaneOffsetEc, positionEc);
    float nvrToEnd = nvr_planeDistance(v_endPlaneNormalEc, v_endPlaneOffsetEc, positionEc);
#ifdef NVR_USE_LINE_DASH
    if (!nvr_lineDashKeepsEnds(
            nvr_vLineDashPlaneScale.x * nvrFromStart,
            nvr_vLineDashPlaneScale.y * nvrToEnd,
            nvr_planeDistance(v_rightPlaneEC, positionEc),
            0.5 * nvr_lineDashLineWidthAt(positionEc)
        )) {
        discard;
    }
#else
    if (nvrFromStart < 0.0 || nvrToEnd < 0.0) {
        discard;
    }
#endif
    // The same depth as the rest of the scene, so the line can be
    // depth-tested against it.
    #include <logdepthbuf_fragment>
#endif

#ifdef NVR_USE_LINE_DASH
    // Row 0 is a solid line. Gaps stay pickable.
    int nvr_lineDashRow = int(nvr_vLineDash.w + 0.5);
    if (nvr_lineDashRow > 0 && nvr_uPickable <= 0.0) {
        // Both planes face into the segment, so the distances to them along
        // the segment split it at the fragment.
        float nvr_fromStart = nvr_vLineDashPlaneScale.x
            * nvr_planeDistance(v_startPlaneNormalEcAndHalfWidth.xyz, v_startPlaneOffsetEc, positionEc);
        float nvr_toEnd = nvr_vLineDashPlaneScale.y
            * nvr_planeDistance(v_endPlaneNormalEc, v_endPlaneOffsetEc, positionEc);
        // A square cap past the line's end takes the pattern at the end; a
        // round one shows the round dashes reaching past the end.
        float nvr_alongSegment = nvr_vLineDash.x * nvr_fromStart / (nvr_fromStart + nvr_toEnd);
        if (!nvr_lineDashRound(nvr_lineDashRow)) {
            nvr_alongSegment = clamp(nvr_alongSegment, 0.0, nvr_vLineDash.x);
        }
        float nvr_across = nvr_planeDistance(v_rightPlaneEC, positionEc);
        vec3 nvr_centerEc = positionEc - v_rightPlaneEC.xyz * nvr_across;
        float nvr_lineWidth = nvr_lineDashLineWidthAt(nvr_centerEc);
        float nvr_periodWidths = texelFetch(tLineDashAtlas, ivec2(0, nvr_lineDashRow), 0).x;

        // The pattern is laid out in a unit of a power of two meters, the
        // line width rounded up. The power is chosen per period from the
        // width at the period's start, never per fragment: every fragment of
        // a dash then draws it at one size, and the size changes only between
        // periods. Search from two powers above this fragment's own, coarsest
        // first, so that fragments sharing a period also share the search.
        // The period's start comes from the segment table, so fragments of
        // one period agree on it across segments too. It lies within one
        // period along the line and within nvr_vLineDashLift.y of the lift,
        // and the width grows with the depth: where that bounds the width at
        // the start to one side of the test, the table is not read.
        float nvr_depth = -nvr_centerEc.z;
        int nvr_unitLog2 = int(ceil(log2(nvr_lineWidth))) + 2;
        for (int i = 0; i < 3; i++) {
            float nvr_minPeriodStartWidth = exp2(float(nvr_unitLog2 - 1));
            float nvr_reach = 1.01 * (nvr_periodWidths * exp2(float(nvr_unitLog2)) + nvr_vLineDashLift.y + nvr_lineWidth)
                + 1.0e-4 * nvr_depth;
            if (nvr_lineDashLineWidthAtDepth(nvr_depth + nvr_reach) <= nvr_minPeriodStartWidth) {
                nvr_unitLog2 -= 1;
                continue;
            }
            if (nvr_lineDashLineWidthAtDepth(nvr_depth - nvr_reach) > nvr_minPeriodStartWidth) {
                break;
            }
            float nvr_toPeriodStart = -nvr_lineDashPhase(
                nvr_lineDashRow,
                nvr_vLineDash.y,
                nvr_vLineDash.z + nvr_alongSegment,
                NVR_LINE_LENGTH_HIGH_STEP_LOG2,
                nvr_unitLog2
            ) * nvr_periodWidths * exp2(float(nvr_unitLog2));
            float nvr_periodStartWidth = nvr_lineDashLineWidthAt(nvr_lineDashPointAt(
                nvr_vLineDash.y,
                nvr_vLineDash.z + nvr_alongSegment + nvr_toPeriodStart
            ));
            if (nvr_periodStartWidth > nvr_minPeriodStartWidth) {
                break;
            }
            nvr_unitLog2 -= 1;
        }
        float nvr_phase = nvr_lineDashPhase(
            nvr_lineDashRow,
            nvr_vLineDash.y,
            nvr_vLineDash.z + nvr_alongSegment,
            NVR_LINE_LENGTH_HIGH_STEP_LOG2,
            nvr_unitLog2
        );
        float nvr_unit = exp2(float(nvr_unitLog2));
        // Periods start in the middle of the pattern's longest gap, so that a
        // change of unit between two periods cuts no dash.
        float nvr_position = (nvr_phase * nvr_periodWidths + nvr_lineDashGapCenter(nvr_lineDashRow)) * nvr_unit;
        float nvr_capRadius = nvr_lineWidth * 0.5;
        // Only a dash within a cap radius of the line's end can reach past
        // it.
        vec2 nvr_lineEnds = vec2(-1.0e20, 1.0e20);
        if (nvr_alongSegment < nvr_capRadius || nvr_vLineDash.x - nvr_alongSegment < nvr_capRadius) {
            bvec2 nvr_ends = nvr_lineDashSegmentEnds();
            if (nvr_ends.x) {
                nvr_lineEnds.x = nvr_position - nvr_alongSegment;
            }
            if (nvr_ends.y) {
                nvr_lineEnds.y = nvr_position + nvr_vLineDash.x - nvr_alongSegment;
            }
        }
        if (nvr_lineDashDistance(
                nvr_lineDashRow,
                nvr_position,
                nvr_across,
                nvr_unit,
                nvr_capRadius,
                nvr_lineEnds
            ) > 0.0) {
            discard;
        }
    }
#endif

    vec4 diffuseColor = vec4(color, uOpacity);
    #include <clipping_planes_fragment>

    ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = vec3(0.);

    #include <color_fragment>

#ifdef USE_BATCH_SHOW_OPACITY
    diffuseColor.a *= nvr_vOpacity;
#endif

    #include <specularmap_fragment>
    #include <normal_fragment_begin>
#ifdef NVR_GROUND_POLYLINE_NORMALS
    normal = nvrGroundNormal;
#endif
    #include <emissivemap_fragment>

    #include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>

    vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;

#if !defined(NVR_LIT) && (defined(NVR_UNLIT) || defined(NVR_UNLIT_SCENE))
    // Albedo-only output (`lit` option / `view.lit` default).
    outgoingLight = diffuseColor.rgb;
#endif
    #include <opaque_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    if(nvr_uPickable > 0.0) {
        vec3 pickColor = nvr_batchIdToColor(nvr_vBatchId);
        gl_FragColor = vec4(pickColor.xyz, 1.0);
    }

    #ifndef USE_SHADOWMAP_DEPTH
    #ifdef NVR_GROUND_POLYLINE_NORMALS
        GBUFFER_WRITE_NORMAL(nvrGroundNormal, 0.0, 1.0)
    #else
        GBUFFER_WRITE_NORMAL(vNormal, 0.0, 1.0)
    #endif
        #ifdef USE_SELECTIVE_EFFECT
            GBUFFER_WRITE_EFFECT(uEffectIdsMask, (diffuseColor.rgb + uEmissiveColor) * uEmissiveIntensity)
        #else
            GBUFFER_WRITE_EFFECT_ZERO
        #endif

        // Polyline runs the lit pipeline (CSM accumulates nvr_shadowMask).
        GBUFFER_WRITE_SHADOW
    #endif
}
