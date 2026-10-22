// Flat polyline fragment shader for texturized tile rendering
// Outputs a simple color without lighting (lighting is applied to the tile)

#include chunks/pick;

#include <common>
#include <color_pars_fragment>

uniform vec3 color;
uniform float nvr_uPickable;

flat in float nvr_vBatchId;

#include chunks/show_pars_fragment;

#if defined(NVR_LINE_DASH) || defined(USE_BATCH_LINE_DASH)
#include chunks/line_dash_pars_fragment;
in vec2 nvr_vLineDashCoord;
flat in vec2 nvr_vLineDashLine;
flat in vec2 nvr_vLineDashEnds;
in vec2 nvr_vLineDashDistance;
flat in vec2 nvr_vLineDashUnit;
#endif

void main() {
    #include chunks/show_fragment;

    vec4 diffuseColor = vec4(color, 1.0);
    #include <clipping_planes_fragment>

    #include <color_fragment>

#ifdef USE_BATCH_SHOW_OPACITY
    diffuseColor.a *= nvr_vOpacity;
#endif

#if defined(NVR_LINE_DASH) || defined(USE_BATCH_LINE_DASH)
    // Row 0 is a solid line. Gaps stay pickable.
    int nvr_lineDashRow = int(nvr_vLineDashLine.x + 0.5);
    if (nvr_lineDashRow > 0 && nvr_uPickable <= 0.0) {
        float nvr_capRadius = nvr_vLineDashLine.y * 0.5;
        // Laid out along the original line, from its start, so the tiles a line
        // was clipped into continue one pattern. Distances are then compared in
        // drape texels.
        int nvr_unitLog2 = int(floor(nvr_vLineDashUnit.x + 0.5));
        float nvr_unit = exp2(float(nvr_unitLog2)) * nvr_vLineDashUnit.y;
        float nvr_position = nvr_lineDashPhase(
            nvr_lineDashRow,
            nvr_vLineDashDistance.x,
            nvr_vLineDashDistance.y,
            NVR_FLAT_LINE_DISTANCE_HIGH_STEP_LOG2,
            nvr_unitLog2
        ) * texelFetch(tLineDashAtlas, ivec2(0, nvr_lineDashRow), 0).x * nvr_unit;
        float nvr_along = nvr_vLineDashCoord.x;
        vec2 nvr_lineEnds = nvr_position - nvr_along + nvr_vLineDashEnds;
        // A square cap takes the pattern at the end it continues. Round
        // dashes are cut to the line where they lie, past its end too.
        if (!nvr_lineDashRound(nvr_lineDashRow)) {
            nvr_position += clamp(nvr_along, nvr_vLineDashEnds.x, nvr_vLineDashEnds.y) - nvr_along;
        }
        float nvr_dashDistance = nvr_lineDashDistance(
            nvr_lineDashRow,
            nvr_position,
            nvr_vLineDashCoord.y,
            nvr_unit,
            nvr_capRadius,
            nvr_lineEnds
        );
        // The bake maps one drape texel to one pixel.
        diffuseColor.a *= clamp(0.5 - nvr_dashDistance, 0.0, 1.0);
    }
#endif

    gl_FragColor = diffuseColor;
    #include <colorspace_fragment>

    if(nvr_uPickable > 0.0) {
        vec3 pickColor = nvr_batchIdToColor(nvr_vBatchId);
        gl_FragColor = vec4(pickColor.xyz, 1.0);
    }
}
