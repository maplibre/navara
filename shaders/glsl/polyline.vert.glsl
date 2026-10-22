// Ref: https://github.com/CesiumGS/cesium/blob/165e0fb4fcc9a448b15de6a2df46db23c71fffda/packages/engine/Source/Shaders/PolylineShadowVolumeVS.glsl

#include chunks/branchFreeTernary;
#include chunks/planeDistance;
#include chunks/metersPerPixel;
#include chunks/horizon_culling_pars_vertex;

in float attrBatchId;

#include chunks/show_pars_vertex;

#ifdef USE_RTE
  #include chunks/rte_pars_vertex;
  attribute vec3 start_3d_high;
  attribute vec3 start_3d_low;
  attribute vec3 end_3d_high;
  attribute vec3 end_3d_low;
#else
  in vec3 start;
  in vec3 forward_offset;
#endif

// xyz: start plane normal, w: high part of the length so far along the line.
in vec4 start_normal_and_length_high;
// xyz: end plane normal, w: segment length, negative on the left side.
in vec4 end_normal_and_segment_length;
// xyz: right plane normal, w: low part of the length so far along the line.
in vec4 right_normal_and_line_length;

#include <common>
#include <color_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include chunks/batch_texture_pars_vertex;

uniform vec3 minMaxHeightAndWidth;
uniform vec3 viewportAndPixelRatio;
uniform vec2 frustumNearFar;
uniform vec4 frustumRatio;
uniform float maxWidth;
uniform float uAddHeight;

flat out vec4 v_startPlaneNormalEcAndHalfWidth;
flat out vec3 v_endPlaneNormalEc;
flat out vec4 v_rightPlaneEC;
flat out float v_startPlaneOffsetEc;
flat out float v_endPlaneOffsetEc;
out vec3 vViewPosition;
flat out float nvr_vBatchId;
out vec3 vNormal;

#if defined(NVR_LINE_DASH) || defined(USE_BATCH_LINE_DASH)
uniform float uLineDashRow;
// Height range of the terrain under a ground line; minMaxHeightAndWidth also
// covers the volume's allowance for the curvature.
uniform vec2 nvr_uGroundHeightRange;
// x: segment length, y/z: high/low part of the length so far along the line
// at the segment start (meters), w: atlas row of the dash pattern.
flat out vec4 nvr_vLineDash;
// Converts a distance from the start (x) / end (y) plane into a distance
// along the segment: the planes are miter planes, not perpendicular to it.
flat out vec2 nvr_vLineDashPlaneScale;
// This segment's entry in the line's segment table (the geometry's
// line_segments).
flat out float nvr_vLineDashSegment;
// x: height above the line's positions at which the dash pattern measures the
// line's width, y: how far from that height the volume reaches.
flat out vec2 nvr_vLineDashLift;
#endif


void main() {
    #ifdef USE_RTE
        // Horizon culling per segment: collapse only when BOTH endpoints are
        // beyond the ellipsoidal horizon. All shadow-volume vertices of a
        // segment share start/end, so the test cannot split a primitive.
        // Testing the vertex's own position instead would collapse one end of
        // a horizon-crossing segment and distort it. Must run before any flat
        // varying is written, and all vertices of the segment return together.
        vec3 segmentStartAbs = start_3d_high + start_3d_low;
        vec3 segmentEndAbs = end_3d_high + end_3d_low;
        if (nvr_horizon_culled(segmentStartAbs, cameraPosition)
            && nvr_horizon_culled(segmentEndAbs, cameraPosition)) {
            vHorizonCulled = 1;
            gl_Position = vec4(0.0);
            return;
        }
        vHorizonCulled = 0;
    #endif

    #ifdef USE_RTE
        #include chunks/rte_vertex;
        // Now 'transformed' contains camera-relative position
    #else
        #include <begin_vertex>
    #endif

    #include <color_vertex>

    #include chunks/height_vertex;
    #include chunks/line_width_vertex;
    #ifdef USE_BATCH_LINE_DASH
        float nvr_batchLineDash = 0.0;
    #endif

    #include chunks/batch_texture_vertex;

    #if defined(NVR_LINE_DASH) || defined(USE_BATCH_LINE_DASH)
        nvr_vLineDash.x = abs(end_normal_and_segment_length.w);
        nvr_vLineDash.y = start_normal_and_length_high.w;
        nvr_vLineDash.z = right_normal_and_line_length.w;
        #ifdef USE_BATCH_LINE_DASH
            nvr_vLineDash.w = nvr_batchLineDash;
        #else
            nvr_vLineDash.w = uLineDashRow;
        #endif
    #endif

    vec3 ecStart;
    vec3 ecEnd;
    vec3 offset;

    #ifdef USE_RTE
        // The u_rteOne (== 1.0) factors are load-bearing: see chunks/rte_pars_vertex.glsl.
        vec3 startHighDiff = (start_3d_high - u_cameraPositionHigh) * u_rteOne;
        vec3 startLowDiff = start_3d_low - u_cameraPositionLow;
        vec3 startCameraRelative = startHighDiff + startLowDiff;

        vec3 endHighDiff = (end_3d_high - u_cameraPositionHigh) * u_rteOne;
        vec3 endLowDiff = end_3d_low - u_cameraPositionLow;
        vec3 endCameraRelative = endHighDiff + endLowDiff;

        ecStart = (modelViewMatrixRTE * vec4(startCameraRelative, 1.0)).xyz;
        ecEnd = (modelViewMatrixRTE * vec4(endCameraRelative, 1.0)).xyz;
        offset = ecEnd - ecStart;
    #else
        ecStart = (modelViewMatrix * vec4(start, 1.0)).xyz;
        offset = normalMatrix * forward_offset;
        ecEnd = ecStart + offset;
    #endif

    nvr_vBatchId = attrBatchId;

    vec3 forwardDirectionEC = normalize(offset);

    // start plane
    vec4 startPlaneEC;
    #ifdef USE_RTE
        startPlaneEC.xyz = mat3(modelViewMatrixRTE) * start_normal_and_length_high.xyz;
    #else
        startPlaneEC.xyz = normalMatrix * start_normal_and_length_high.xyz;
    #endif
    startPlaneEC.w = -dot(startPlaneEC.xyz, ecStart);

    // end plane
    vec4 endPlaneEC;
    #ifdef USE_RTE
        endPlaneEC.xyz = mat3(modelViewMatrixRTE) * end_normal_and_segment_length.xyz;
    #else
        endPlaneEC.xyz = normalMatrix * end_normal_and_segment_length.xyz;
    #endif
    endPlaneEC.w = -dot(endPlaneEC.xyz, ecEnd);

    // Right plane
    #ifdef USE_RTE
        v_rightPlaneEC.xyz = mat3(modelViewMatrixRTE) * right_normal_and_line_length.xyz;
    #else
        v_rightPlaneEC.xyz = normalMatrix * right_normal_and_line_length.xyz;
    #endif
    v_rightPlaneEC.w = -dot(v_rightPlaneEC.xyz, ecStart);

    #if defined(NVR_LINE_DASH) || defined(USE_BATCH_LINE_DASH)
        nvr_vLineDashPlaneScale = vec2(
            1.0 / dot(startPlaneEC.xyz, forwardDirectionEC),
            -1.0 / dot(endPlaneEC.xyz, forwardDirectionEC)
        );
        // The geometry emits eight vertices per segment.
        nvr_vLineDashSegment = float(gl_VertexID / 8);
        #ifdef NVR_GROUND_POLYLINE
            // The positions lie on the ellipsoid; the ground is somewhere in
            // the terrain's height range.
            nvr_vLineDashLift = vec2(
                0.5 * (nvr_uGroundHeightRange.x + nvr_uGroundHeightRange.y),
                0.5 * abs(nvr_uGroundHeightRange.y - nvr_uGroundHeightRange.x)
            );
        #else
            nvr_vLineDashLift = vec2(
                addHeight,
                max(abs(minMaxHeightAndWidth.x), abs(minMaxHeightAndWidth.y))
            );
        #endif
    #endif

    #ifdef USE_RTE
        vec4 positionEC = modelViewMatrixRTE * vec4(transformed, 1.0);
    #else
        vec4 positionEC = modelViewMatrix * vec4(position, 1.0);
    #endif

    float absStartPlaneDistance = abs(nvr_planeDistance(startPlaneEC, positionEC.xyz));
    float absEndPlaneDistance = abs(nvr_planeDistance(endPlaneEC, positionEC.xyz));

    vec3 planeDirection = nvr_branchFreeTernary(absStartPlaneDistance < absEndPlaneDistance, startPlaneEC.xyz, endPlaneEC.xyz);
    vec3 upOrDown = normalize(cross(v_rightPlaneEC.xyz, planeDirection)); // Points "up" for start plane, "down" at end plane.
    vec3 normalEC = normalize(cross(planeDirection, upOrDown));           // In practice, the opposite seems to work too.

    // Extrudes height
    vec3 heightNormal = normalize(nvr_branchFreeTernary(absStartPlaneDistance < absEndPlaneDistance, cross(v_rightPlaneEC.xyz, startPlaneEC.xyz), cross(endPlaneEC.xyz, v_rightPlaneEC.xyz)));
    #ifdef USE_RTE
        // The wall is 1 m tall with its bottom on the segment end, below the
        // f32 step of eye coordinates at globe distances, so top and bottom
        // are told apart in world space, where the high/low difference is
        // exact. `heightNormal` is then oriented up for the same reason.
        bool atStart = absStartPlaneDistance < absEndPlaneDistance;
        vec3 wallOffset = (position_3d_high - nvr_branchFreeTernary(atStart, start_3d_high, end_3d_high)) * u_rteOne
            + (position_3d_low - nvr_branchFreeTernary(atStart, start_3d_low, end_3d_low));
        bool isTop = dot(wallOffset, wallOffset) > 0.25;
        vec3 upEC = mat3(modelViewMatrixRTE) * normalize(nvr_branchFreeTernary(atStart, segmentStartAbs, segmentEndAbs));
        heightNormal *= sign(dot(heightNormal, upEC));
        vec3 height = heightNormal * nvr_branchFreeTernary(isTop, minMaxHeightAndWidth.y, minMaxHeightAndWidth.x);
        positionEC.xyz += height;
    #else
        vec3 cur_point = nvr_branchFreeTernary(absStartPlaneDistance < absEndPlaneDistance, start, start + forward_offset);
        vec3 diff = normalize(position - cur_point);
        vec3 height = heightNormal * nvr_branchFreeTernary(dot(diff, heightNormal) > 0., minMaxHeightAndWidth.y, minMaxHeightAndWidth.x);
        positionEC.xyz += height;
    #endif

    // Apply per-feature height offset from batch texture or uniform
    positionEC.xyz += heightNormal * addHeight;

    vec3 transformedNormal = vec3( heightNormal );

	#include <normal_vertex>
 
    // Use batchLineWidth when >= 0.0, otherwise fall back to default width.
    // Negative batchLineWidth indicates "use default width from minMaxHeightAndWidth.z"
    #ifdef USE_BATCH_LINE_WIDTH
        float lineWidth = batchLineWidth >= 0.0 ? batchLineWidth : minMaxHeightAndWidth.z;
    #else
        float lineWidth = minMaxHeightAndWidth.z;
    #endif

    v_startPlaneNormalEcAndHalfWidth.xyz = startPlaneEC.xyz;
    v_startPlaneNormalEcAndHalfWidth.w = lineWidth * 0.5;

    v_endPlaneNormalEc.xyz = endPlaneEC.xyz;

    // Pass pre-computed plane offsets to avoid recomputation error in fragment shader
    v_startPlaneOffsetEc = startPlaneEC.w;
    v_endPlaneOffsetEc = endPlaneEC.w;

    lineWidth = lineWidth * max(0.0, nvr_metersPerPixel(positionEC, viewportAndPixelRatio, frustumNearFar, frustumRatio)); // lineWidth = distance to push along R
    // Clamp the width with maxWidth to reduce fragment shader overdraw.
    lineWidth = min(lineWidth, maxWidth);

    // Extend shadow volume past each end to cover the concave-side gap at joints.
    // The fragment shader's miter plane test preserves the clean miter boundary.
    float forwardPush = lineWidth * 0.5;
    float pushDirection = nvr_branchFreeTernary(absStartPlaneDistance < absEndPlaneDistance, -1.0, 1.0);
    positionEC.xyz += pushDirection * forwardPush * forwardDirectionEC;

    lineWidth = lineWidth / dot(normalEC, v_rightPlaneEC.xyz); // lineWidth = distance to push along N
    #ifndef NVR_GROUND_POLYLINE
        // Without the ground test nothing cuts the volume back to the line
        // width, so each side goes out half of it. The ground volume keeps
        // the full push, and its fragment test cuts it back.
        lineWidth *= 0.5;
    #endif

    normalEC *= sign(end_normal_and_segment_length.w);

    positionEC.xyz += lineWidth * normalEC;
    gl_Position = projectionMatrix * positionEC;
    #include <logdepthbuf_vertex>
    #ifdef NVR_GROUND_POLYLINE
        // The volume can reach thousands of kilometres below the ground over
        // a wide extent, and the faces it draws are the far ones. Clamped to
        // the far plane they still cover the ground, and the fragment shader
        // writes the ground's depth.
        gl_Position.z = min(gl_Position.z, gl_Position.w);
    #endif
    vViewPosition = -positionEC.xyz;

    // Alias for three's chunk convention: the CSM view-space shadow patch
    // (applyViewSpaceShadowReceive) requires `mvPosition` in scope at
    // #include <shadowmap_vertex>.
    vec4 mvPosition = positionEC;

    #include <worldpos_vertex>
    #include <shadowmap_vertex>
}
