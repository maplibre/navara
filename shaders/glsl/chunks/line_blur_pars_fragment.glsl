// Distance of a fragment inside the line's edge: from its side edge, and
// within a round cap at the line's own end, from the cap's arc. `beyond` is
// how far the fragment lies past that end along the line (0 or less within
// the line) and `across` its signed distance from the center line, in the
// unit of `halfWidth`. A square cap and a dash end keep their edge.
float nvr_lineEdgeDistance(float beyond, float across, float halfWidth, bool roundCap) {
    return roundCap && beyond > 0.0
        ? halfWidth - length(vec2(beyond, across))
        : halfWidth - abs(across);
}

// Opacity of a fragment `edgeDistance` inside the line's edge, fading over
// `blur` in the same unit: MapLibre's line-blur without its antialiasing
// pixel, so a blurred line keeps its width.
// ref: https://github.com/maplibre/maplibre-gl-js/blob/d9c722ee771c281f4dc5fd46607c82ac584b5a87/src/shaders/glsl/line.fragment.glsl#L25-L26
float nvr_lineBlurAlpha(float edgeDistance, float blur) {
    return blur > 0.0 ? clamp(edgeDistance / blur, 0.0, 1.0) : 1.0;
}
