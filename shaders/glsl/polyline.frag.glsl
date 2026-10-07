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

#ifdef NVR_GROUND_POLYLINE
    flat in vec4 v_rightPlaneEC;
    #include chunks/globe_depth_pars_fragment;
    #include chunks/ground_shadow_coord_pars_fragment;

    uniform mat4 inverseProjectionMatrix;
    #ifdef NVR_GROUND_POLYLINE_NORMALS
        uniform sampler2D tGlobeNormal;
    #endif
    uniform vec3 viewportAndPixelRatio;
    uniform vec2 frustumNearFar;
    uniform vec4 frustumRatio;

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

    float nvrHalfWidth = v_startPlaneNormalEcAndHalfWidth.w
        * nvr_metersPerPixel(vec4(positionEc, 1.0), viewportAndPixelRatio, frustumNearFar, frustumRatio);
    if (abs(nvr_planeDistance(v_rightPlaneEC, positionEc)) > nvrHalfWidth
        || nvr_planeDistance(v_startPlaneNormalEcAndHalfWidth.xyz, v_startPlaneOffsetEc, positionEc) < 0.0
        || nvr_planeDistance(v_endPlaneNormalEc, v_endPlaneOffsetEc, positionEc) < 0.0) {
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
    if (nvr_planeDistance(v_startPlaneNormalEcAndHalfWidth.xyz, v_startPlaneOffsetEc, positionEc) < 0.0
        || nvr_planeDistance(v_endPlaneNormalEc, v_endPlaneOffsetEc, positionEc) < 0.0) {
        discard;
    }
    // The same depth as the rest of the scene, so the line can be
    // depth-tested against it.
    #include <logdepthbuf_fragment>
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
