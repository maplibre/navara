//! Pure numeric kernel for screen-space label decluttering.
//!
//! This is the compute core of `@navaramap/three`'s `DeclutterManager`: given a
//! flat list of label candidates and the camera, it projects each anchor to a
//! screen-pixel box, sorts by priority (with placement hysteresis), and greedily
//! claims space in a uniform screen-space grid — returning one `hidden` flag per
//! candidate.
//!
//! The orchestration around it (collecting candidates from meshes, applying the
//! results as fade targets, throttling, dirty tracking) stays in TypeScript; only
//! this per-pass numeric work lives here. See `guide/DECLUTTER.md`.
//!
//! ## Candidate layout
//!
//! Candidates arrive as a flat `f64` slice, [`CANDIDATE_STRIDE`] values each:
//!
//! | offset | field | meaning |
//! |--------|-------|---------|
//! | 0,1,2  | anchorX/Y/Z | ECEF anchor in meters, before the height offset |
//! | 3      | addHeight | surface-normal height offset (meters) |
//! | 4,5,6,7| minX/maxX/minY/maxY | local box (px or meters), +Y up |
//! | 8      | sizeInMeters | `0.0` = px, non-zero = meters |
//! | 9      | priority | higher wins an overlap |
//! | 10     | isShown | `0.0` = hidden, non-zero = currently shown (feeds hysteresis) |

use wasm_bindgen::prelude::*;

/// Number of `f64` values per candidate in the packed input slice.
pub const CANDIDATE_STRIDE: usize = 11;

// Mirrors shaders/glsl/chunks/ellipsoid.glsl. These are duplicated as literals
// (rather than taken from `navara_core`) on purpose: the projection below is a
// CPU mirror of the vertex shaders, and must stay bit-for-bit with the GLSL, not
// with the engine's own ellipsoid constants.
const WGS84_A: f64 = 6378137.0;
const WGS84_B: f64 = 6_356_752.314_245_179;

/// Camera and viewport parameters for one placement pass.
struct ProjectionContext<'a> {
    /// View matrix (inverse of the camera's `matrixWorld`), column-major, 16 values.
    view: &'a [f64],
    /// Projection matrix, column-major, 16 values.
    proj: &'a [f64],
    camera_x: f64,
    camera_y: f64,
    camera_z: f64,
    /// Near-plane distance in meters; anchors nearer than this are clipped.
    near: f64,
    /// Viewport size in CSS pixels (matches the `uScreenHeightPx` uniform).
    width_px: f64,
    height_px: f64,
    /// Vertical field of view in radians (matches the `uFovRad` uniform).
    fov_rad: f64,
}

/// CPU mirror of `nvr_horizon_culled`
/// (shaders/glsl/chunks/horizon_culling_pars_vertex.glsl): true when the point
/// lies beyond the horizon of the ellipsoid shrunk by `min_height` (the
/// `nvrHorizonMinHeight` uniform, never positive) as seen from the camera, i.e.
/// the GPU will cull the label's vertices. Such labels must not claim collision
/// space, or an invisible label could suppress a visible one. Like the shader,
/// the test runs on the anchor *before* the height offset is applied.
fn is_beyond_horizon(
    px: f64,
    py: f64,
    pz: f64,
    cx: f64,
    cy: f64,
    cz: f64,
    min_height: f64,
) -> bool {
    let ra = WGS84_A + min_height;
    let rb = WGS84_B + min_height;
    let csx = cx / ra;
    let csy = cy / ra;
    let csz = cz / rb;
    let vtx = csx - px / ra;
    let vty = csy - py / ra;
    let vtz = csz - pz / rb;
    let a = csx * csx + csy * csy + csz * csz - 1.0;
    vtx * csx + vty * csy + vtz * csz > a
}

/// Project a candidate's local box to a screen-pixel AABB, mirroring the
/// billboard vertex shaders (sdfText.vert.glsl / instancedSprite.vert.glsl).
/// Writes `[minX, minY, maxX, maxY]` (y-down) into `out` and returns true; returns
/// false without writing when the anchor is behind the near plane.
fn project_candidate(c: &[f64], ctx: &ProjectionContext, out: &mut [f64; 4]) -> bool {
    let mut wx = c[0];
    let mut wy = c[1];
    let mut wz = c[2];
    let add_height = c[3];
    if add_height != 0.0 {
        let len = (wx * wx + wy * wy + wz * wz).sqrt();
        if len > 0.0 {
            let s = add_height / len;
            wx += wx * s;
            wy += wy * s;
            wz += wz * s;
        }
    }

    let v = ctx.view;
    let vx = v[0] * wx + v[4] * wy + v[8] * wz + v[12];
    let vy = v[1] * wx + v[5] * wy + v[9] * wz + v[13];
    let vz = v[2] * wx + v[6] * wy + v[10] * wz + v[14];

    // In view space the camera looks down -Z; anything with vz >= -near is
    // behind the camera or clipped by the near plane.
    if vz >= -ctx.near {
        return false;
    }

    let p = ctx.proj;
    let cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
    let cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
    let cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];

    let sx = (cx / cw + 1.0) * 0.5 * ctx.width_px;
    let sy = (1.0 - cy / cw) * 0.5 * ctx.height_px;

    // Mirror of nvr_pxToWorld (shaders/glsl/chunks/pixelToWorld.glsl), inverted:
    // pixels per world meter at the anchor's view depth. `|viewZ|` (here `-vz`,
    // vz being negative in front of the camera) approximates distance exactly as
    // the shader does, so the CPU box doesn't drift from the rendered quad.
    let size_in_meters = c[8] != 0.0;
    let k = if size_in_meters {
        ctx.height_px / (2.0 * (ctx.fov_rad / 2.0).tan() * -vz)
    } else {
        1.0
    };

    let min_x = c[4];
    let max_x = c[5];
    let min_y = c[6];
    let max_y = c[7];
    out[0] = sx + min_x * k;
    out[1] = sy - max_y * k;
    out[2] = sx + max_x * k;
    out[3] = sy - min_y * k;
    true
}

/// Outcome of one placement attempt against the grid.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Claim {
    /// The box was free: it now occupies its cells, and the label is shown.
    Claimed,
    /// An already-claimed box overlaps it; nothing was claimed.
    Blocked,
    /// The box lies entirely outside the tracked area (viewport + margin), so
    /// it contested no on-screen space and claimed nothing. Distinct from
    /// `Claimed` on purpose: such a label is off screen, and must stay *hidden*
    /// until it reaches the tracked area rather than fade in unseen and arrive
    /// at full opacity.
    OutsideArea,
}

/// Uniform screen-space grid for label collision (the same structure MapLibre
/// uses for symbol placement). Boxes are inserted greedily in priority order via
/// [`ScreenCollisionGrid::try_claim`].
///
/// The grid tracks a margin beyond the viewport so labels just off the edge still
/// compete for space — otherwise panning would let an off-screen label "win" the
/// moment it enters, popping its on-screen neighbor out.
struct ScreenCollisionGrid {
    cell_size: f64,
    margin: f64,
    width: f64,
    height: f64,
    cols: usize,
    rows: usize,
    /// Per-cell lists of indices into `boxes` (4 values per box).
    cells: Vec<Vec<usize>>,
    boxes: Vec<f64>,
}

impl ScreenCollisionGrid {
    fn new(width: f64, height: f64) -> Self {
        let cell_size = 64.0;
        let margin = 128.0;
        let cols = (((width + 2.0 * margin) / cell_size).ceil() as usize).max(1);
        let rows = (((height + 2.0 * margin) / cell_size).ceil() as usize).max(1);
        ScreenCollisionGrid {
            cell_size,
            margin,
            width,
            height,
            cols,
            rows,
            cells: vec![Vec::new(); cols * rows],
            boxes: Vec::new(),
        }
    }

    /// Claim `[minX, maxX] × [minY, maxY]` (screen px, y-down) if it does not
    /// overlap any previously claimed box. A box entirely outside the tracked
    /// area (viewport + margin) claims nothing and reports
    /// [`Claim::OutsideArea`].
    ///
    /// `test_shrink_px` shrinks the box used for the *collision test* by that many
    /// pixels per side while the full box is still claimed on success — the
    /// placement-hysteresis primitive: an already-shown label tolerates marginal
    /// overlaps (its shrunk test box clears) yet keeps competitors away from its
    /// real footprint.
    fn try_claim(
        &mut self,
        min_x: f64,
        min_y: f64,
        max_x: f64,
        max_y: f64,
        test_shrink_px: f64,
    ) -> Claim {
        let m = self.margin;
        if max_x <= -m || min_x >= self.width + m || max_y <= -m || min_y >= self.height + m {
            return Claim::OutsideArea;
        }

        let t_min_x = min_x + test_shrink_px;
        let t_max_x = max_x - test_shrink_px;
        let t_min_y = min_y + test_shrink_px;
        let t_max_y = max_y - test_shrink_px;

        // A box smaller than the shrink has no test area left — always free.
        if t_min_x < t_max_x && t_min_y < t_max_y {
            let c0 = self.col_of(t_min_x);
            let c1 = self.col_of(t_max_x);
            let r0 = self.row_of(t_min_y);
            let r1 = self.row_of(t_max_y);
            for r in r0..=r1 {
                for c in c0..=c1 {
                    for &b in &self.cells[r * self.cols + c] {
                        // Strict inequalities: exactly touching boxes do not collide.
                        if t_min_x < self.boxes[b + 2]
                            && t_max_x > self.boxes[b]
                            && t_min_y < self.boxes[b + 3]
                            && t_max_y > self.boxes[b + 1]
                        {
                            return Claim::Blocked;
                        }
                    }
                }
            }
        }

        let idx = self.boxes.len();
        self.boxes.push(min_x);
        self.boxes.push(min_y);
        self.boxes.push(max_x);
        self.boxes.push(max_y);
        let c0 = self.col_of(min_x);
        let c1 = self.col_of(max_x);
        let r0 = self.row_of(min_y);
        let r1 = self.row_of(max_y);
        for r in r0..=r1 {
            for c in c0..=c1 {
                self.cells[r * self.cols + c].push(idx);
            }
        }
        Claim::Claimed
    }

    fn col_of(&self, x: f64) -> usize {
        let c = ((x + self.margin) / self.cell_size).floor();
        (c.max(0.0) as usize).min(self.cols - 1)
    }

    fn row_of(&self, y: f64) -> usize {
        let r = ((y + self.margin) / self.cell_size).floor();
        (r.max(0.0) as usize).min(self.rows - 1)
    }
}

/// Padding added around every collision box (px); two placed labels never sit
/// closer than twice this. Matches `DeclutterManager.PADDING_PX`.
const DEFAULT_PADDING_PX: f64 = 2.0;

/// Run one placement pass. Returns a `hidden` flag (0 or 1) per candidate, in the
/// same order as the input slice.
///
/// `candidates` is a packed `f64` slice of `n * CANDIDATE_STRIDE` values (see the
/// module docs); `view` and `proj` are column-major 4×4 matrices (16 values each).
/// `horizon_min_height` is the renderer's `nvrHorizonMinHeight`, which the
/// horizon test shrinks the ellipsoid by. `padding_px` pads every box;
/// `hysteresis_px` is the collision-test shrink applied only to currently-shown
/// labels.
///
/// The result is *hidden-by-default*: only a label that claimed space inside the
/// tracked area (viewport + grid margin) comes back shown. Off-screen and
/// GPU-culled labels stay hidden so they cannot fade in unseen and then pan into
/// view at full opacity.
#[wasm_bindgen(js_name = declutterPlace)]
#[allow(clippy::too_many_arguments)]
pub fn declutter_place(
    candidates: &[f64],
    view: &[f64],
    proj: &[f64],
    camera_x: f64,
    camera_y: f64,
    camera_z: f64,
    near: f64,
    width_px: f64,
    height_px: f64,
    fov_rad: f64,
    horizon_min_height: f64,
    padding_px: f64,
    hysteresis_px: f64,
) -> Vec<u8> {
    let n = candidates.len() / CANDIDATE_STRIDE;
    let ctx = ProjectionContext {
        view,
        proj,
        camera_x,
        camera_y,
        camera_z,
        near,
        width_px,
        height_px,
        fov_rad,
    };

    // Project + horizon-cull each candidate. `placeable[i]` is false when the GPU
    // already hides it (behind camera / near plane / beyond the horizon).
    let mut boxes = vec![0.0f64; n * 4];
    let mut placeable = vec![false; n];
    for i in 0..n {
        let c = &candidates[i * CANDIDATE_STRIDE..i * CANDIDATE_STRIDE + CANDIDATE_STRIDE];
        let mut b = [0.0f64; 4];
        let visible = !is_beyond_horizon(
            c[0],
            c[1],
            c[2],
            ctx.camera_x,
            ctx.camera_y,
            ctx.camera_z,
            horizon_min_height,
        ) && project_candidate(c, &ctx, &mut b);
        placeable[i] = visible;
        if visible {
            boxes[i * 4..i * 4 + 4].copy_from_slice(&b);
        }
    }

    // Priority order with hysteresis: among equal priorities, currently-shown
    // labels place first (incumbents win ties). The final camera-independent
    // tiebreak (anchor position, then index) keeps fresh ties deterministic —
    // array order would reshuffle as tiles load and make labels flicker.
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| {
        let ca = &candidates[a * CANDIDATE_STRIDE..];
        let cb = &candidates[b * CANDIDATE_STRIDE..];
        // priority desc
        let pa = ca[9];
        let pb = cb[9];
        if pa != pb {
            return pb.partial_cmp(&pa).unwrap_or(std::cmp::Ordering::Equal);
        }
        // isShown first (desc)
        let sa = ca[10] != 0.0;
        let sb = cb[10] != 0.0;
        if sa != sb {
            return if sa {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        // anchor position asc (X, then Y, then Z)
        for k in 0..3 {
            if ca[k] != cb[k] {
                return ca[k]
                    .partial_cmp(&cb[k])
                    .unwrap_or(std::cmp::Ordering::Equal);
            }
        }
        a.cmp(&b)
    });

    let pad = if padding_px.is_finite() {
        padding_px
    } else {
        DEFAULT_PADDING_PX
    };
    let mut grid = ScreenCollisionGrid::new(width_px, height_px);
    let mut hidden = vec![0u8; n];
    // A label is shown only when it actually claimed space on (or just off)
    // screen. Everything else stays hidden — including labels the pass cannot
    // judge because they are nowhere near the viewport. Granting those a
    // fade-in while they are invisible is what used to make a pan reveal fully
    // opaque clutter that only the *next* pass faded back out.
    for &i in &order {
        if !placeable[i] {
            // Behind the camera or beyond the horizon: the GPU hides it already,
            // so it claims no space — and it stays hidden, so when it comes back
            // into view it fades in only if it wins its space then.
            hidden[i] = 1;
            continue;
        }
        let o = i * 4;
        let is_shown = candidates[i * CANDIDATE_STRIDE + 10] != 0.0;
        // Shown labels get a shrunk collision test (sticky); hidden labels need
        // their full padded box free before they may appear.
        let claim = grid.try_claim(
            boxes[o] - pad,
            boxes[o + 1] - pad,
            boxes[o + 2] + pad,
            boxes[o + 3] + pad,
            if is_shown { hysteresis_px } else { 0.0 },
        );
        hidden[i] = u8::from(claim != Claim::Claimed);
    }

    hidden
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: f64 = 6378137.0;

    /// View + projection matrices for a camera one earth-radius above (2R, 0, 0)
    /// looking at the surface point (R, 0, 0), with world +Z up — mirroring the
    /// TypeScript test's `makeCamera` (800×600, fov 60°, near 1, far 1e9).
    ///
    /// Computed here in closed form rather than via a matrix library to keep the
    /// crate dependency-free; values are the column-major arrays Three.js produces
    /// for the same camera.
    fn camera() -> (Vec<f64>, Vec<f64>, f64, f64, f64, f64, f64, f64, f64) {
        // Camera basis: looking down -X (toward the surface), up = +Z.
        // forward = (-1,0,0); right = up × forward direction. Three.js lookAt with
        // up=+Z gives right = (0,1,0)? Compute: z_axis = normalize(eye - target) =
        // (+1,0,0); x_axis = normalize(up × z) = normalize((0,0,1)×(1,0,0)) =
        // (0,1,0); y_axis = z × x = (1,0,0)×... recompute: y = cross(z, x) =
        // (1,0,0)×(0,1,0) = (0,0,1). So world +Y -> screen right, +Z -> screen up.
        // matrixWorld columns: [x_axis, y_axis, z_axis, eye].
        let eye = 2.0 * R;
        #[rustfmt::skip]
        let world = vec![
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            1.0, 0.0, 0.0, 0.0,
            eye, 0.0, 0.0, 1.0,
        ];
        // Invert a rigid transform: R^T and -R^T t.
        let view = invert_rigid(&world);

        let fov = 60.0f64.to_radians();
        let aspect = 800.0 / 600.0;
        let near = 1.0;
        let far = 1e9;
        let f = 1.0 / (fov / 2.0).tan();
        #[rustfmt::skip]
        let proj = vec![
            f / aspect, 0.0, 0.0, 0.0,
            0.0, f, 0.0, 0.0,
            0.0, 0.0, (far + near) / (near - far), -1.0,
            0.0, 0.0, (2.0 * far * near) / (near - far), 0.0,
        ];
        (view, proj, eye, 0.0, 0.0, near, 800.0, 600.0, fov)
    }

    /// Invert a column-major rigid-body 4×4 (rotation + translation, no scale).
    fn invert_rigid(m: &[f64]) -> Vec<f64> {
        // Rotation is the upper-left 3×3; its inverse is the transpose.
        let r = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
        let t = [m[12], m[13], m[14]];
        // R^T
        let rt = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
        // -R^T t
        let tx = -(rt[0] * t[0] + rt[3] * t[1] + rt[6] * t[2]);
        let ty = -(rt[1] * t[0] + rt[4] * t[1] + rt[7] * t[2]);
        let tz = -(rt[2] * t[0] + rt[5] * t[1] + rt[8] * t[2]);
        #[rustfmt::skip]
        let out = vec![
            rt[0], rt[1], rt[2], 0.0,
            rt[3], rt[4], rt[5], 0.0,
            rt[6], rt[7], rt[8], 0.0,
            tx, ty, tz, 1.0,
        ];
        out
    }

    /// Build a packed candidate with the same defaults as the TS test's `label`.
    #[allow(clippy::too_many_arguments)]
    fn label(
        anchor_x: f64,
        anchor_y: f64,
        anchor_z: f64,
        priority: f64,
        is_shown: bool,
    ) -> [f64; CANDIDATE_STRIDE] {
        [
            anchor_x,
            anchor_y,
            anchor_z, // anchor
            0.0,      // addHeight
            -10.0,    // minX
            10.0,     // maxX
            -10.0,    // minY
            10.0,     // maxY
            0.0,      // sizeInMeters (px)
            priority,
            if is_shown { 1.0 } else { 0.0 },
        ]
    }

    fn place(cands: &[[f64; CANDIDATE_STRIDE]]) -> Vec<u8> {
        let flat: Vec<f64> = cands.iter().flatten().copied().collect();
        let (view, proj, cx, cy, cz, near, w, h, fov) = camera();
        declutter_place(
            &flat,
            &view,
            &proj,
            cx,
            cy,
            cz,
            near,
            w,
            h,
            fov,
            0.0,
            DEFAULT_PADDING_PX,
            6.0,
        )
    }

    #[test]
    fn hides_lower_priority_of_overlapping_pair() {
        // Same anchor: both project to the same screen box. Third is far away.
        let hidden = place(&[
            label(R, 0.0, 0.0, 1.0, false),
            label(R, 0.0, 0.0, 5.0, false),
            label(R, 1e6, 0.0, 0.0, false),
        ]);
        assert_eq!(hidden[1], 0, "highest priority shown");
        assert_eq!(hidden[0], 1, "lower priority hidden");
        assert_eq!(hidden[2], 0, "far-away label shown");
    }

    #[test]
    fn equal_priority_ties_resolve_independent_of_order() {
        let a = label(R, 0.0, 0.0, 0.0, false);
        let b = label(R, 5e4, 0.0, 0.0, false);
        let forward = place(&[a, b]);
        let reversed = place(&[b, a]);
        // Smaller anchorY wins in both orders.
        assert_eq!(forward[0], 0);
        assert_eq!(forward[1], 1);
        assert_eq!(reversed[1], 0);
        assert_eq!(reversed[0], 1);
    }

    #[test]
    fn incumbents_win_equal_priority_ties() {
        // challenger has the smaller anchorY (anchor tiebreak would pick it), but
        // incumbent is currently shown, so hysteresis keeps incumbent.
        let challenger = label(R, 0.0, 0.0, 0.0, false);
        let incumbent = label(R, 5e4, 0.0, 0.0, true);
        let hidden = place(&[challenger, incumbent]);
        assert_eq!(hidden[1], 0, "incumbent stays shown");
        assert_eq!(hidden[0], 1, "challenger hidden");
    }

    #[test]
    fn horizon_culled_labels_claim_no_space_and_stay_hidden() {
        // Far side of the globe: GPU horizon culling hides it already. It must
        // claim no space, yet stay hidden — otherwise it fades in invisibly and
        // arrives at full opacity when the globe turns it into view.
        let far = label(-R, 0.0, 0.0, 10.0, false);
        let near = label(R, 0.0, 0.0, 0.0, false);
        let hidden = place(&[far, near]);
        assert_eq!(hidden[0], 1, "horizon-culled label stays hidden");
        assert_eq!(
            hidden[1], 0,
            "visible label not suppressed by invisible one"
        );
    }

    #[test]
    fn labels_outside_the_tracked_area_stay_hidden() {
        // Projectable and inside the horizon, but its pixel box sits ~2000px to
        // the right of the anchor — far beyond the viewport + margin, so it
        // contests nothing. Reported hidden so panning it into view starts a
        // fade-in instead of revealing it already opaque.
        let mut off_screen = label(R, 0.0, 0.0, 0.0, false);
        off_screen[4] = 2000.0; // minX
        off_screen[5] = 2100.0; // maxX
        let on_screen = label(R, 0.0, 0.0, 0.0, false);
        let hidden = place(&[off_screen, on_screen]);
        assert_eq!(hidden[0], 1, "label outside the tracked area stays hidden");
        assert_eq!(hidden[1], 0, "on-screen label shown");
    }

    // --- projection --------------------------------------------------------

    /// Camera at the origin looking down -Z with a 90° vertical FOV, so
    /// tan(fov/2) = 1 and the px-per-meter math is easy to verify by hand.
    /// Mirrors `projection.test.ts`'s `makeContext` (800×600, near 1, far 1e9).
    fn context_90() -> ProjectionContext<'static> {
        // Camera with identity orientation at the origin: view matrix is identity.
        static VIEW: [f64; 16] = [
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ];
        // fov 90°, aspect 800/600, near 1, far 1e9.
        static PROJ: [f64; 16] = [
            0.75,
            0.0,
            0.0,
            0.0, // f/aspect, f = 1/tan(45°) = 1
            0.0,
            1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            -1.000_000_002,
            -1.0,
            0.0,
            0.0,
            -2.000_000_002,
            0.0,
        ];
        ProjectionContext {
            view: &VIEW,
            proj: &PROJ,
            camera_x: 0.0,
            camera_y: 0.0,
            camera_z: 0.0,
            near: 1.0,
            width_px: 800.0,
            height_px: 600.0,
            fov_rad: std::f64::consts::FRAC_PI_2,
        }
    }

    /// `[anchor(3), addHeight, minX, maxX, minY, maxY, sizeInMeters]` packed the
    /// same way `label` does, with the projection defaults from the TS test.
    fn proj_candidate(
        anchor_z: f64,
        add_height: f64,
        min_x: f64,
        max_x: f64,
        min_y: f64,
        max_y: f64,
        size_in_meters: bool,
    ) -> [f64; CANDIDATE_STRIDE] {
        [
            0.0,
            0.0,
            anchor_z,
            add_height,
            min_x,
            max_x,
            min_y,
            max_y,
            if size_in_meters { 1.0 } else { 0.0 },
            0.0,
            0.0,
        ]
    }

    #[test]
    fn projection_centers_pixel_box_on_anchor() {
        let ctx = context_90();
        let c = proj_candidate(-100.0, 0.0, -10.0, 10.0, -5.0, 5.0, false);
        let mut out = [0.0; 4];
        assert!(project_candidate(&c, &ctx, &mut out));
        assert!((out[0] - 390.0).abs() < 1e-3);
        assert!((out[1] - 295.0).abs() < 1e-3);
        assert!((out[2] - 410.0).abs() < 1e-3);
        assert!((out[3] - 305.0).abs() < 1e-3);
    }

    #[test]
    fn projection_maps_local_up_to_decreasing_screen_y() {
        let ctx = context_90();
        let c = proj_candidate(-100.0, 0.0, -10.0, 10.0, 0.0, 10.0, false);
        let mut out = [0.0; 4];
        project_candidate(&c, &ctx, &mut out);
        assert!((out[1] - 290.0).abs() < 1e-3);
        assert!((out[3] - 300.0).abs() < 1e-3);
    }

    #[test]
    fn projection_meter_box_uses_viewz_distance() {
        let ctx = context_90();
        let c = proj_candidate(-100.0, 0.0, -10.0, 10.0, -10.0, 10.0, true);
        let mut out = [0.0; 4];
        project_candidate(&c, &ctx, &mut out);
        // k = 600 / (2 * 1 * 100) = 3.
        assert!((out[0] - (400.0 - 30.0)).abs() < 1e-3);
        assert!((out[1] - (300.0 - 30.0)).abs() < 1e-3);
        assert!((out[2] - (400.0 + 30.0)).abs() < 1e-3);
        assert!((out[3] - (300.0 + 30.0)).abs() < 1e-3);
    }

    #[test]
    fn projection_applies_add_height_along_normal() {
        let ctx = context_90();
        // Anchor at z=-100, +50 m along the normal (0,0,-1) -> z=-150.
        let c = proj_candidate(-100.0, 50.0, -10.0, 10.0, -5.0, 5.0, true);
        let mut out = [0.0; 4];
        project_candidate(&c, &ctx, &mut out);
        // k = 600 / (2 * 1 * 150) = 2.
        assert!((out[0] - (400.0 - 20.0)).abs() < 1e-3);
        assert!((out[2] - (400.0 + 20.0)).abs() < 1e-3);
    }

    #[test]
    fn projection_rejects_anchors_behind_camera_or_inside_near() {
        let ctx = context_90();
        let mut out = [0.0; 4];
        assert!(!project_candidate(
            &proj_candidate(100.0, 0.0, -10.0, 10.0, -5.0, 5.0, false),
            &ctx,
            &mut out
        ));
        assert!(!project_candidate(
            &proj_candidate(-0.5, 0.0, -10.0, 10.0, -5.0, 5.0, false),
            &ctx,
            &mut out
        ));
    }

    #[test]
    fn horizon_keeps_near_side_culls_far_side() {
        assert!(!is_beyond_horizon(
            WGS84_A,
            0.0,
            0.0,
            2.0 * WGS84_A,
            0.0,
            0.0,
            0.0
        ));
        assert!(is_beyond_horizon(
            -WGS84_A,
            0.0,
            0.0,
            2.0 * WGS84_A,
            0.0,
            0.0,
            0.0
        ));
        assert!(is_beyond_horizon(
            0.0,
            WGS84_A,
            0.0,
            2.0 * WGS84_A,
            0.0,
            0.0,
            0.0
        ));
    }

    /// A label between the ellipsoid's horizon and that of the ellipsoid shrunk
    /// by the horizon minimum is drawn, so it is not culled.
    #[test]
    fn horizon_follows_the_shrunk_ellipsoid() {
        // 1 km above the equator; the surface point ~150 km away lies beyond
        // the ellipsoid's horizon (~113 km) but within the one shrunk by 500 m
        // (~218 km).
        let theta: f64 = 150_000.0 / WGS84_A;
        let (px, py) = (WGS84_A * theta.cos(), WGS84_A * theta.sin());
        let cx = WGS84_A + 1000.0;
        assert!(is_beyond_horizon(px, py, 0.0, cx, 0.0, 0.0, 0.0));
        assert!(!is_beyond_horizon(px, py, 0.0, cx, 0.0, 0.0, -500.0));
    }

    // --- grid --------------------------------------------------------------

    fn grid() -> ScreenCollisionGrid {
        ScreenCollisionGrid::new(800.0, 600.0)
    }

    #[test]
    fn grid_places_non_overlapping_boxes() {
        let mut g = grid();
        assert_eq!(g.try_claim(10.0, 10.0, 50.0, 30.0, 0.0), Claim::Claimed);
        assert_eq!(g.try_claim(60.0, 10.0, 100.0, 30.0, 0.0), Claim::Claimed);
        assert_eq!(g.try_claim(10.0, 40.0, 50.0, 60.0, 0.0), Claim::Claimed);
    }

    #[test]
    fn grid_rejects_overlap_and_leaves_grid_untouched() {
        let mut g = grid();
        assert_eq!(g.try_claim(10.0, 10.0, 50.0, 30.0, 0.0), Claim::Claimed);
        assert_eq!(g.try_claim(40.0, 20.0, 80.0, 40.0, 0.0), Claim::Blocked);
        // The rejected box claimed nothing.
        assert_eq!(g.try_claim(55.0, 25.0, 80.0, 40.0, 0.0), Claim::Claimed);
    }

    #[test]
    fn grid_exactly_touching_boxes_do_not_collide() {
        let mut g = grid();
        assert_eq!(g.try_claim(10.0, 10.0, 50.0, 30.0, 0.0), Claim::Claimed);
        assert_eq!(g.try_claim(50.0, 10.0, 90.0, 30.0, 0.0), Claim::Claimed);
        assert_eq!(g.try_claim(10.0, 30.0, 50.0, 50.0, 0.0), Claim::Claimed);
    }

    #[test]
    fn grid_detects_collisions_across_cell_boundaries() {
        let mut g = grid();
        assert_eq!(g.try_claim(30.0, 30.0, 300.0, 90.0, 0.0), Claim::Claimed);
        // Overlaps only its far end, in a different cell than the origin.
        assert_eq!(g.try_claim(280.0, 50.0, 320.0, 70.0, 0.0), Claim::Blocked);
    }

    #[test]
    fn grid_competes_within_margin_not_beyond() {
        let mut g = grid();
        // Just off the left edge, inside the 128px margin: claims space.
        assert_eq!(g.try_claim(-60.0, 10.0, -10.0, 30.0, 0.0), Claim::Claimed);
        assert_eq!(g.try_claim(-40.0, 10.0, 20.0, 30.0, 0.0), Claim::Blocked);
        // Entirely beyond the margin: claims nothing, and is reported as such
        // rather than as a win — it is off screen, so it stays hidden.
        assert_eq!(
            g.try_claim(-500.0, 10.0, -400.0, 30.0, 0.0),
            Claim::OutsideArea
        );
        assert_eq!(
            g.try_claim(-480.0, 10.0, -420.0, 30.0, 0.0),
            Claim::OutsideArea
        );
    }

    #[test]
    fn grid_test_shrink_tolerates_marginal_overlap_but_claims_full_box() {
        let mut g = grid();
        assert_eq!(g.try_claim(10.0, 10.0, 50.0, 30.0, 0.0), Claim::Claimed);
        // Overlaps by 4px; a 6px shrink clears it (hysteresis case)...
        assert_eq!(g.try_claim(46.0, 10.0, 86.0, 30.0, 6.0), Claim::Claimed);
        // ...but the FULL box was claimed: a box overlapping the shrunk-away
        // strip still collides.
        assert_eq!(g.try_claim(80.0, 10.0, 120.0, 30.0, 0.0), Claim::Blocked);
    }

    #[test]
    fn grid_without_shrink_marginal_overlap_collides() {
        let mut g = grid();
        assert_eq!(g.try_claim(10.0, 10.0, 50.0, 30.0, 0.0), Claim::Claimed);
        assert_eq!(g.try_claim(46.0, 10.0, 86.0, 30.0, 0.0), Claim::Blocked);
    }

    #[test]
    fn grid_box_fully_consumed_by_shrink_is_free() {
        let mut g = grid();
        assert_eq!(g.try_claim(10.0, 10.0, 50.0, 30.0, 0.0), Claim::Claimed);
        // 8px-wide box inside the claimed area, but 6px/side shrink leaves no
        // test area — claimed anyway.
        assert_eq!(g.try_claim(20.0, 15.0, 28.0, 25.0, 6.0), Claim::Claimed);
    }
}
