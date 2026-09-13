// Flat polyline fragment shader for texturized tile rendering
// Outputs a simple color without lighting (lighting is applied to the tile)

#include chunks/pick;

#include <common>
#include <color_pars_fragment>

uniform vec3 color;
uniform float nvr_uPickable;

flat in float nvr_vBatchId;

#include chunks/show_pars_fragment;

void main() {
    #include chunks/show_fragment;

    vec4 diffuseColor = vec4(color, 1.0);
    #include <clipping_planes_fragment>

    #include <color_fragment>

#ifdef USE_BATCH_SHOW_OPACITY
    diffuseColor.a *= nvr_vOpacity;
#endif

    gl_FragColor = diffuseColor;
    #include <colorspace_fragment>

    if(nvr_uPickable > 0.0) {
        vec3 pickColor = nvr_batchIdToColor(nvr_vBatchId);
        gl_FragColor = vec4(pickColor.xyz, 1.0);
    }
}
