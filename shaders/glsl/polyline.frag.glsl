#include chunks/pick;

#include <common>
#include <packing>
#include <color_pars_fragment>

#include <lights_pars_begin>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>

uniform vec3 color;
uniform float nvr_uPickable;

flat in float nvr_vBatchId;
in vec3 vNormal;

#include chunks/show_pars_fragment;

#include chunks/gbuffer_pars_fragment;

#ifdef USE_SELECTIVE_EFFECT
    uniform float uEffectIdsMask;
    uniform vec3 uEmissiveColor;
    uniform float uEmissiveIntensity;
#endif

void main() {
    #include chunks/show_fragment;
    
    vec4 diffuseColor = vec4(color, 1.);
    #include <clipping_planes_fragment>

    ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = vec3(0.);

    #include <color_fragment>

#ifdef USE_BATCH_SHOW_OPACITY
    diffuseColor.a *= nvr_vOpacity;
#endif

    #include <specularmap_fragment>
    #include <normal_fragment_begin>
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
        GBUFFER_WRITE_NORMAL(vNormal, 0.0, 1.0)
        #ifdef USE_SELECTIVE_EFFECT
            GBUFFER_WRITE_EFFECT(uEffectIdsMask, (diffuseColor.rgb + uEmissiveColor) * uEmissiveIntensity)
        #else
            GBUFFER_WRITE_EFFECT_ZERO
        #endif

        // Polyline runs the lit pipeline (CSM accumulates nvr_shadowMask).
        GBUFFER_WRITE_SHADOW
    #endif
}
