export const FEATURE_RENDER_ORDER = 1;
/**
 * Polylines (strokes) must draw after polygon fills. In the per-tile bake
 * scene, sibling fill/stroke meshes are created asynchronously and land in
 * the scene in arbitrary order, so a fill baked later paints over the stroke.
 * In the MRT scene, polyline materials skip the depth test but still write
 * depth, so a coplanar fill drawn after a stroke z-fights against the
 * stroke's depth per fragment (mottled boundaries). Encoding the stacking in
 * renderOrder makes both cases deterministic.
 */
export const STROKE_RENDER_ORDER = FEATURE_RENDER_ORDER + 1;
export const SKY_RENDER_ORDER = 100;
export const STARS_RENDER_ORDER = SKY_RENDER_ORDER + 1;
/**
 * A polygon's `depthPrePass` mesh draws in the opaque list after every opaque
 * mesh of its scene: drawn earlier, its depth would hide what lies under the
 * blended surface.
 */
export const DEPTH_PRE_PASS_RENDER_ORDER = 1000;
