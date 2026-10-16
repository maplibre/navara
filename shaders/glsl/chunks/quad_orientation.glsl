#ifndef QUAD_ORIENTATION_GLSL
#define QUAD_ORIENTATION_GLSL

/**
 * The anchor's local east-north-up frame, in WORLD space.
 *
 * `cross(polar axis, normal)` vanishes at the poles, where every tangent
 * direction is an equally valid "east"; ECEF +x is the fallback there.
 */
void nvr_enuBasis(vec3 worldPos, out vec3 east, out vec3 north, out vec3 up) {
    vec3 nWorld = normalize(worldPos);
    vec3 e = vec3(-nWorld.y, nWorld.x, 0.0);
    float eLen = length(e);
    east = eLen > 1e-6 ? e / eLen : vec3(1.0, 0.0, 0.0);
    north = cross(nWorld, east);
    up = nWorld;
}

/**
 * View-space basis an anchored quad (a text label, a sprite) is laid out in:
 * `right` spans the quad's local +x, `up` its local +y. A vertex is then
 * `mvPosition + vec4(localPos.x * right + localPos.y * up, 0.0)`.
 *
 * A view-space offset with zero Z is what makes a quad screen-aligned, so both
 * upright modes have zero-Z axes; the flat modes span the tangent plane of the
 * anchor's local east-north-up frame. Shared by sdfText.vert.glsl and
 * instancedSprite.vert.glsl so the two cannot drift; mirrored on the CPU by
 * `quad_screen_basis` in navara_wasm_api's line_label.rs.
 *
 * `flatFacing`  false = the quad lies in the screen plane, true = its basis
 *               spans the tangent plane at the anchor (nvr_quadOffset then
 *               wraps the offsets onto the globe).
 * `rotateWithCamera` true = the quad reads left-to-right on screen, false = it
 *               is aligned with the map: x-axis east.
 *
 * `worldPos` is the anchor in ECEF meters; its normalized direction is the
 * surface normal, matching mvr_getMvHeightOffset's spherical approximation.
 */
void nvr_quadOrientation(
    vec3 worldPos,
    bool flatFacing,
    bool rotateWithCamera,
    out vec3 right,
    out vec3 up
) {
    if (!flatFacing && rotateWithCamera) {
        // Screen plane, screen up — the default billboard.
        right = vec3(1.0, 0.0, 0.0);
        up = vec3(0.0, 1.0, 0.0);
        return;
    }

    vec3 eastWorld, northWorld, normalWorld;
    nvr_enuBasis(worldPos, eastWorld, northWorld, normalWorld);
    vec3 eastView = (viewMatrix * vec4(eastWorld, 0.0)).xyz;
    vec3 northView = (viewMatrix * vec4(northWorld, 0.0)).xyz;

    if (flatFacing && !rotateWithCamera) {
        // Tangent plane, north-up: a pure function of the anchor.
        right = eastView;
        up = northView;
        return;
    }

    // Screen right projected onto the tangent plane. It degenerates only when
    // the normal points along screen x, where a flat quad is edge-on anyway.
    vec3 n = (viewMatrix * vec4(normalWorld, 0.0)).xyz;
    vec3 t = vec3(1.0, 0.0, 0.0) - n.x * n;
    float tLen = length(t);
    t = tLen > 1e-4 ? t / tLen : normalize(vec3(0.0, 1.0, 0.0) - n.y * n);

    if (flatFacing) {
        // Tangent plane, yawed so the text still reads left-to-right.
        right = t;
        up = cross(n, right);
        return;
    }

    // Screen plane, turned by the camera heading β (clockwise from north) so
    // the x-axis keeps pointing east: t = cos β · east − sin β · north, and
    // east sits β counter-clockwise from screen right.
    right = vec3(dot(t, eastView), -dot(t, northView), 0.0);
    up = vec3(-right.y, right.x, 0.0);
}

/**
 * The basis above, then spun by `rotation` radians inside the quad's own
 * plane. Both axes turn together, so the quad rotates rigidly and never leaves
 * the plane its orientation mode put it in.
 *
 * Local offsets are measured from the anchor, so this pivots the quad about
 * that anchor — which makes the material's `center` the control for where the
 * pivot sits inside the quad.
 */
void nvr_quadBasis(
    vec3 worldPos,
    bool flatFacing,
    bool rotateWithCamera,
    float rotation,
    out vec3 right,
    out vec3 up
) {
    nvr_quadOrientation(worldPos, flatFacing, rotateWithCamera, right, up);
    if (rotation == 0.0) {
        return;
    }
    // Negated sine relative to the usual counter-clockwise matrix, so a
    // positive angle reads clockwise from in front of the quad.
    float s = sin(rotation);
    float c = cos(rotation);
    vec3 rotatedRight = c * right - s * up;
    up = s * right + c * up;
    right = rotatedRight;
}

/**
 * The wrap step of nvr_quadOffset on its own, for a view-space `offset`
 * already laid out in the tangent plane. A flat offset must be wrapped whole:
 * wrapping two parts of it separately and summing them leaves the first part
 * planar, rising off the surface quadratically with its length.
 */
vec3 nvr_wrapOffset(vec3 offset, bool flatFacing, vec3 worldPos, float addHeight) {
    float dist = length(offset);
    float radius = length(worldPos) + addHeight;
    if (!flatFacing || dist < 1e-6 || radius < 1.0) {
        return offset;
    }
    vec3 n = (viewMatrix * vec4(normalize(worldPos), 0.0)).xyz;
    // Exponential map on the sphere: arc length `dist` along the offset's
    // direction. cos(theta) - 1 is written as -2 sin^2(theta / 2) so small
    // angles do not cancel to zero in float32.
    float theta = dist / radius;
    float halfSin = sin(0.5 * theta);
    return offset * (radius * sin(theta) / dist)
        - n * (2.0 * radius * halfSin * halfSin);
}

/**
 * View-space offset of a quad vertex at `local` (already scaled to meters)
 * from its anchor, laid out in the `(right, up)` basis above.
 *
 * An upright quad is a plain planar offset. A flat one is instead wrapped onto
 * the sphere through the anchor: the tangent-plane offset is walked the same
 * distance along the great circle it points down, so the quad follows the
 * globe's curvature. A planar quad only touches the surface at its anchor and
 * rises off it quadratically with distance, which is invisible for a
 * street-scale label but lifts a pixel-sized label at globe scale thousands
 * of kilometres wide clean off the surface, past the limb.
 *
 * Each vertex is bent, not each fragment, so a quad stays a flat chord between
 * its bent corners. That is why a text background is drawn as glyph-wide
 * strips (backgroundSliceCount in glyphBuffers.ts), and why a sprite switches
 * to a subdivided grid while any of its features can be flat
 * (FLAT_QUAD_SEGMENTS in instancedSprite.ts): as one quad, either would stay
 * a flat plane while the surface under it curves. A glyph-, strip- or
 * cell-wide chord's dip below the arc is tiny next to the offset it corrects,
 * and `offsetDepth` keeps it from sinking into the globe.
 *
 * `worldPos` is the anchor in ECEF meters and `addHeight` its height offset,
 * so the sphere is concentric with the one `mvr_getMvHeightOffset` lifts the
 * anchor along.
 */
vec3 nvr_quadOffset(
    vec2 local,
    vec3 right,
    vec3 up,
    bool flatFacing,
    vec3 worldPos,
    float addHeight
) {
    return nvr_wrapOffset(local.x * right + local.y * up, flatFacing, worldPos, addHeight);
}

#endif // QUAD_ORIENTATION_GLSL
