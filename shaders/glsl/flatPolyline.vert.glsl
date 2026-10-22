// Flat polyline vertex shader for texturized tile rendering
// Positions are in normalized [-1, 1] tile coordinates

in float attrBatchId;

#include chunks/show_pars_vertex;

in vec4 right_normal_and_line_length;

#include <common>
#include <color_pars_vertex>
#include chunks/batch_texture_pars_vertex;
#include chunks/height_pars_vertex;

uniform vec3 minMaxHeightAndWidth;
// Drape render-target side length in texels (TileTextureCompositor.size).
uniform float uDrapeRtSize;

flat out float nvr_vBatchId;

#if defined(NVR_LINE_DASH) || defined(USE_BATCH_LINE_DASH)
uniform float uLineDashRow;
uniform sampler2D tLineDashAtlas;
// x: distance along the line, y: signed distance from its center line, both
// in drape texels.
out vec2 nvr_vLineDashCoord;
// x: atlas row of the dash pattern, y: line width in drape texels.
flat out vec2 nvr_vLineDashLine;
// Distances along the line of its own start and end, in drape texels; ±1e20
// where it has none there (a tile clip or a closed ring's seam).
flat out vec2 nvr_vLineDashEnds;
// (high, low) distance along the original line, in the position's units, the
// line's length in them, and which of its ends are its own (bit 0 the start,
// bit 1 the end).
in vec4 line_distance_and_ends;
out vec2 nvr_vLineDashDistance;
// x: log2 of the pattern's line width unit, in the position's units; y: drape
// texels per position unit.
flat out vec2 nvr_vLineDashUnit;
#endif

void main() {
    #include <begin_vertex>
    #include <color_vertex>

    #include chunks/height_vertex;
    #include chunks/line_width_vertex;
    #ifdef USE_BATCH_LINE_DASH
        float nvr_batchLineDash = 0.0;
    #endif

    #include chunks/batch_texture_vertex;

    nvr_vBatchId = attrBatchId;

    // Miter joint: normal direction and signed miter length are packed in the attribute
    vec2 miterNormal = right_normal_and_line_length.xy;
    float miterLength = right_normal_and_line_length.w; // signed: +/- for left/right, scaled for miter

    // Line width in normalized coordinates (width is in pixels, need to scale)
    // Use batchLineWidth when >= 0.0, otherwise fall back to default width.
    // Negative batchLineWidth indicates "use default width from minMaxHeightAndWidth.z"
    #ifdef USE_BATCH_LINE_WIDTH
        float baseWidth = batchLineWidth >= 0.0 ? batchLineWidth : minMaxHeightAndWidth.z;
    #else
        float baseWidth = minMaxHeightAndWidth.z;
    #endif
    // Positions span [-1, 1] (2.0 units) across the drape render target,
    // so one texel of width is 2.0 / uDrapeRtSize in normalized coordinates.
    float lineWidth = baseWidth * (2.0 / uDrapeRtSize);

    // Compensate for parent tile zoom-in: when a parent tile's mesh is rendered
    // for a child tile, the ortho camera narrows its bounds, magnifying the geometry.
    // projectionMatrix[0][0] = 2/(right-left); default camera (-1,1) gives 1.0,
    // parent fallback gives >1.0. Dividing cancels the magnification.
    lineWidth /= projectionMatrix[0][0];

    // Offset position by miter normal scaled by half width and miter length
    vec3 offsetPos = position + vec3(miterNormal * lineWidth * 0.5 * miterLength, 0.0);

    #if defined(NVR_LINE_DASH) || defined(USE_BATCH_LINE_DASH)
        #ifdef USE_BATCH_LINE_DASH
            nvr_vLineDashLine.x = nvr_batchLineDash;
        #else
            nvr_vLineDashLine.x = uLineDashRow;
        #endif
        // Distances along the line are in the position's units, which the bake
        // camera magnifies along with the geometry.
        float nvr_toTexels = 0.5 * uDrapeRtSize * projectionMatrix[0][0];
        float nvr_distance = right_normal_and_line_length.z;
        float nvr_lineLength = line_distance_and_ends.z;
        int nvr_lineEndMask = int(line_distance_and_ends.w + 0.5);
        bool nvr_hasStart = (nvr_lineEndMask & 1) != 0;
        bool nvr_hasEnd = (nvr_lineEndMask & 2) != 0;
        nvr_vLineDashLine.y = baseWidth;
        nvr_vLineDashEnds = vec2(
            nvr_hasStart ? 0.0 : -1.0e20,
            nvr_hasEnd ? nvr_lineLength * nvr_toTexels : 1.0e20
        );
        nvr_vLineDashCoord = vec2(nvr_distance * nvr_toTexels, sign(miterLength) * 0.5 * baseWidth);
        nvr_vLineDashDistance = line_distance_and_ends.xy;
        // The pattern's unit is the line width rounded up to a power of two of
        // the position's units. A drape level has half the texel size of the
        // one above, so the unit halves with it, and the periods of the finer
        // level keep every boundary of the coarser one.
        nvr_vLineDashUnit = vec2(ceil(log2(baseWidth / nvr_toTexels)), nvr_toTexels);
        // A round or square cap pushes the vertices at the line's own ends, at
        // distance zero and at its length, half a line width out along it.
        int nvr_lineDashRow = int(nvr_vLineDashLine.x + 0.5);
        if (((nvr_hasStart && nvr_distance == 0.0) || (nvr_hasEnd && nvr_distance == nvr_lineLength))
                && nvr_lineDashRow > 0
                && int(texelFetch(tLineDashAtlas, ivec2(0, nvr_lineDashRow), 0).z + 0.5) != 0) {
            float nvr_outward = nvr_distance == 0.0 ? -1.0 : 1.0;
            vec2 nvr_lineDirection = vec2(miterNormal.y, -miterNormal.x);
            offsetPos.xy += nvr_outward * nvr_lineDirection * lineWidth * 0.5;
            nvr_vLineDashCoord.x += nvr_outward * 0.5 * baseWidth;
            nvr_vLineDashDistance.y += nvr_outward * 0.5 * baseWidth / nvr_toTexels;
        }
    #endif

    // Transform to clip space (modelViewMatrix should be identity for orthographic camera)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(offsetPos, 1.0);
}
