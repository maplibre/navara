//! Pure numeric kernel for placing text labels along a line.
//!
//! Sibling of [`crate::declutter`], and split from TypeScript for the same
//! reason: everything here is a CPU mirror of what `sdfText.vert.glsl` does
//! with the same data, and that mirror already exists on this side of the
//! boundary. Doing it in TypeScript would mean a third copy of `nvr_pxToWorld`.
//!
//! Three decisions per label, all of which depend on the camera and so cannot
//! be baked when the tile is parsed:
//!
//! - **flip** — whether to walk the label's path backwards, so a name never
//!   reads right-to-left on screen (`keepUpright`).
//! - **fit** — whether the label is short enough to sit on the line at all.
//!   With `sizeInMeters: false` a label's world length grows as the camera
//!   pulls back, so a name that fits when zoomed in can overrun its road when
//!   zoomed out.
//! - **angle** — whether the line bends too sharply under the label to stay
//!   readable (`maxAngle`).
//! - **scale** — whether the anchor's level is the one on screen: along-line
//!   anchors are nested levels of density, each shown over a band of ground
//!   metres per pixel, so `spacing` holds in screen pixels wherever the camera
//!   is (see `navara_parser::line_placement`). A symbol longer than about
//!   three quarters of `spacing` asks for a sparser level, as MapLibre stretches
//!   `symbol-spacing` (see [`requested_meters_per_px`]).
//!
//! ## Label layout
//!
//! Labels arrive as a flat `f64` slice, [`LINE_LABEL_STRIDE`] values each, with
//! their path samples in a parallel `f32` slice of `2 * samples` values each:
//!
//! | offset | field | meaning |
//! |--------|-------|---------|
//! | 0,1,2  | anchorX/Y/Z | ECEF anchor in meters, before the height offset |
//! | 3      | addHeight | surface-normal height offset (meters) |
//! | 4      | reachEm | farthest the text runs from its anchor along the line, in ems |
//! | 5      | fontSize | px or meters, per `sizeInMeters` |
//! | 6      | sizeInMeters | `0.0` = px, non-zero = meters |
//! | 7      | maxAngleRad | largest turn allowed within the sliding window; `0` = straight only |
//! | 8      | keepUpright | `0.0` = never flip, non-zero = flip when backwards |
//! | 9      | stepMeters | straight-line distance between adjacent path samples |
//! | 10     | halfExtentMeters | real line either side of the anchor |
//! | 11     | bearingRad | the line's tangent at the anchor, clockwise from north |
//! | 12     | isFlipped | the label's current flip, for hysteresis |
//! | 13,14  | minX/maxX | the label's unrotated box along its baseline |
//! | 15,16  | minY/maxY | the same across it, +Y up, in the font's own units |
//! | 17     | lineOffset | shift off the line along its ground normal, in the font's own units |
//! | 18     | flatFacing | `0.0` = upright, non-zero = flat, as resolved for this label |
//! | 19,20  | minMpp/maxMpp | the `(min, max]` ground metres per pixel the anchor shows over |
//! | 21     | widthEm | the label's full length along the line, in ems |
//! | 22     | wordReach | half the widest word's length, in the font's own units |
//!
//! `reachEm` rather than the width because the anchor need not be the text's
//! centre: with `center.x = 0` the whole label runs off one side of it, and it
//! is that side that has to fit on the line. The caller owns the `center`
//! arithmetic (it also builds the box), so it hands over the larger of the two
//! sides.
//!
//! `lineOffset` and the text's own height are kept apart because they need not
//! run along the same axis: the shader always moves the text off the line
//! across the ground, but stands its glyphs up along the surface normal unless
//! the label lies flat.
//!
//! ## Result layout
//!
//! | offset | field |
//! |--------|-------|
//! | 0      | flip — walk the path backwards |
//! | 1      | rejected — out of its scale band, does not fit, or bends too far |
//! | 2,3,4,5| minX/maxX/minY/maxY of the *rotated* box, +Y up |
//! | 6      | ground metres per screen pixel at the anchor, for the caller's repeat test |
//!
//! ## Two phases
//!
//! The fit test needs no path samples at all — only the anchor, the label's
//! width, the length of line under it and its scale band — while the samples
//! are by far the
//! largest thing crossing the boundary (32 points per label against 17
//! scalars). On a dense city view roughly four labels in five are rejected for
//! fit, so sending every label's path and then discarding most of the work is
//! the wrong order.
//!
//! [`line_label_fit`] therefore runs that test alone over a compact input, and
//! the caller packs paths only for the labels that survive it. Both phases go
//! through the same [`fit_lengths`], so they cannot disagree about how long a
//! label is; [`line_label_place`] repeats the test rather than trusting its
//! caller, which keeps it correct on its own and lets it be called with every
//! label when the split is not worth it.

use wasm_bindgen::prelude::*;

/// Number of `f64` values per label in the packed input slice.
pub const LINE_LABEL_STRIDE: usize = 23;

/// Number of `f64` values per label in [`line_label_fit`]'s packed input.
///
/// | offset | field |
/// |--------|-------|
/// | 0,1,2  | anchorX/Y/Z — ECEF metres, before the height offset |
/// | 3      | addHeight — surface-normal height offset (metres) |
/// | 4      | reachEm — farthest the text runs from its anchor, in ems |
/// | 5      | fontSize — px or metres, per `sizeInMeters` |
/// | 6      | sizeInMeters — `0.0` = px, non-zero = metres |
/// | 7      | halfExtentMeters — real line either side of the anchor |
/// | 8,9    | minMpp/maxMpp — the anchor's scale band |
/// | 10     | widthEm — the label's full length along the line, in ems |
///
/// Offsets 0–6 are the full layout's, so a fit row is a prefix of a full row
/// plus its extent, band and width.
pub const LINE_LABEL_FIT_STRIDE: usize = 11;

/// Number of `f64` values per anchor in [`line_anchor_place`]'s packed input.
///
/// | offset | field |
/// |--------|-------|
/// | 0,1,2  | anchorX/Y/Z — ECEF metres, before the height offset |
/// | 3      | addHeight — surface-normal height offset (metres) |
/// | 4,5    | minMpp/maxMpp — the anchor's scale band |
/// | 6      | sizeInMeters — `0.0` = px, non-zero = metres |
/// | 7,8    | minX/maxX — the quad's box across its local x, px or metres per `sizeInMeters` |
/// | 9,10   | minY/maxY — the same along its local y |
/// | 11     | rotation — the quad's in-plane turn, radians clockwise, the line's bearing included when it follows the line |
/// | 12     | bearing — the line's tangent, radians clockwise from north |
/// | 13     | flatFacing — `0.0` = upright, non-zero = flat, as resolved for this anchor |
/// | 14     | rotateWithCamera — `0.0` = frozen in the anchor's frame, non-zero = follows the camera |
pub const LINE_ANCHOR_STRIDE: usize = 15;

/// Number of `f64` values per anchor in [`line_anchor_place`]'s output: shown
/// (`1.0`) or not (`0.0`), then minX/maxX/minY/maxY of the screen-aligned box
/// the quad covers, +Y up, in the input box's units.
pub const LINE_ANCHOR_RESULT_STRIDE: usize = 5;

/// Number of `f64` values per label in the packed output slice.
pub const LINE_LABEL_RESULT_STRIDE: usize = 7;

/// How far the sliding angle window reaches, as a multiple of the font size.
///
/// MapLibre's `checkMaxAngle` uses `3/5 * glyphSize`; a window of roughly one
/// em is the same idea — the turn that matters is the one a reader sees across
/// a couple of adjacent glyphs, not the total bend of a long gentle curve.
const ANGLE_WINDOW_EMS: f64 = 1.5;

/// Turn below which [`exceeds_max_angle`] treats the path as straight: about
/// 0.06°, far under anything visible and far over the f32 noise on the samples.
const ANGLE_TOLERANCE_RAD: f64 = 1e-3;

/// How near vertical a label has to run before its horizontal direction stops
/// being a meaningful test of whether it reads forwards.
const VERTICAL_BAND: f64 = 0.15;

/// Hysteresis on the flip decision, as a deadband on [`should_flip`]'s score.
///
/// The score is a unit-length projection, so this reads as an angle: 0.08 is
/// about 4.6° either side of the boundary that a label may drift through
/// before it turns. Small enough to be invisible — a name reading 4° past
/// upright is not something a reader notices — and large enough to cover the
/// camera movement between two placement passes, which is what decides whether
/// a label on the boundary turns once or oscillates.
const FLIP_HYSTERESIS: f64 = 0.08;

/// Place text labels along their lines.
///
/// `labels` is a packed `f64` slice of `n * LINE_LABEL_STRIDE` values (see the
/// module docs); `paths` holds each label's samples as `2 * samples` `f32`
/// values, east then north metres relative to its anchor. `view` and `proj` are
/// column-major 4x4 matrices.
///
/// Returns `n * LINE_LABEL_RESULT_STRIDE` values per label, in input order; see
/// the module docs for the layout. `spacing_px` is the layer's `spacing`.
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = lineLabelPlace)]
pub fn line_label_place(
    labels: &[f64],
    paths: &[f32],
    samples_per_label: usize,
    view: &[f64],
    height_px: f64,
    fov_rad: f64,
    spacing_px: f64,
) -> Vec<f64> {
    let cam = CameraView {
        view,
        height_px,
        fov_rad,
    };
    let n = labels.len() / LINE_LABEL_STRIDE;
    let mut out = vec![0.0; n * LINE_LABEL_RESULT_STRIDE];
    if samples_per_label < 2 {
        return out;
    }

    for i in 0..n {
        let l = &labels[i * LINE_LABEL_STRIDE..(i + 1) * LINE_LABEL_STRIDE];
        let path = &paths[i * samples_per_label * 2..(i + 1) * samples_per_label * 2];

        let (reach, half_extent, meters_per_em) = fit_lengths(l, l[10], &cam);
        let m = meters_per_px((l[0], l[1], l[2]), l[3], &cam);
        let shown = in_scale_band(m, (l[19], l[20]), label_length(l, l[21]), spacing_px);

        // The arc the text actually covers, in metres along the path from the
        // anchor. The box's baseline extent is exactly that in font units, and
        // walking the path backwards mirrors it.
        let meters_per_unit = if l[5] > 0.0 {
            meters_per_em / l[5]
        } else {
            0.0
        };
        let (x0, x1) = (l[13] * meters_per_unit, l[14] * meters_per_unit);

        let axes = enu_screen_axes(l, view);
        // Which way the label runs on screen. Taken across the text's own
        // extent rather than from the tangent at its anchor: on a curving road
        // the two disagree, and it is the overall reading direction that
        // decides whether a name comes out backwards. The unflipped extent,
        // not one symmetric about the anchor: with `center.x` off 0.5 the
        // text sits to one side, and on a hairpin the side it does not cover
        // can point the other way.
        let (sx, sy) = screen_direction(l, path, samples_per_label, (x0, x1), axes);

        let flip = l[8] != 0.0 && should_flip(sx, sy, l[12] != 0.0);
        let arc = if flip { (-x1, -x0) } else { (x0, x1) };

        // The fit test is repeated here rather than trusted from phase one, so
        // this stays correct when called with labels that never went through
        // it.
        let rejected = !shown
            || reach <= 0.0
            || reach > half_extent
            || exceeds_max_angle(path, samples_per_label, l[9], arc, meters_per_em, l[7]);

        let o = i * LINE_LABEL_RESULT_STRIDE;
        out[o] = if flip { 1.0 } else { 0.0 };
        out[o + 1] = if rejected { 1.0 } else { 0.0 };
        let (bx0, bx1, by0, by1) = if meters_per_unit > 0.0 && l[9] > 0.0 {
            path_box(l, path, samples_per_label, axes, flip, meters_per_unit)
        } else {
            let d = if flip { -1.0 } else { 1.0 };
            rotated_box(l[13], l[14], l[15], l[16], sx * d, sy * d)
        };
        out[o + 2] = bx0;
        out[o + 3] = bx1;
        out[o + 4] = by0;
        out[o + 5] = by1;
        out[o + 6] = m;
    }

    out
}

/// The camera terms the sizing arithmetic needs. Grouped because they always
/// travel together and are identical for every label in a pass.
struct CameraView<'a> {
    /// Column-major 4x4 view matrix.
    view: &'a [f64],
    height_px: f64,
    fov_rad: f64,
}

/// Metres one em of the label spans on the ground.
///
/// Mirrors `sdfText.vert.glsl`'s `scaleFactor`: metres directly when the font
/// size is metric, otherwise [`meters_per_px`] times the pixel size.
fn em_to_meters(
    anchor: (f64, f64, f64),
    add_height: f64,
    font_size: f64,
    size_in_meters: bool,
    cam: &CameraView<'_>,
) -> f64 {
    if size_in_meters {
        font_size
    } else {
        font_size * meters_per_px(anchor, add_height, cam)
    }
}

/// Ground metres one screen pixel spans at the anchor: `nvr_pxToWorld` at its
/// view depth — including its `|viewZ|` approximation of distance, so the CPU
/// and the shaders cannot disagree about how long a label is.
///
/// The depth is taken at the anchor *raised by `addHeight`*, as the shaders
/// apply `mvr_getMvHeightOffset` before reading `mvPosition.z` — and along
/// the same geocentric normal, which is also what the declutter kernel uses.
fn meters_per_px(anchor: (f64, f64, f64), add_height: f64, cam: &CameraView<'_>) -> f64 {
    let (mut x, mut y, mut z) = anchor;
    let len = (x * x + y * y + z * z).sqrt();
    if add_height != 0.0 && len > 0.0 {
        let s = add_height / len;
        x += x * s;
        y += y * s;
        z += z * s;
    }
    let v = cam.view;
    let vz = v[2] * x + v[6] * y + v[10] * z + v[14];
    if vz >= 0.0 {
        // Behind the camera: nothing sensible to scale by, and the declutter
        // pass will drop the label anyway.
        return 0.0;
    }
    (2.0 * (cam.fov_rad / 2.0).tan() * -vz) / cam.height_px
}

/// A symbol's extent along its line: `(length, in metres)`, the length in
/// pixels unless the flag says metres. For text it is the label's full width,
/// whichever side of the anchor it runs; `row` is either text layout, whose
/// offsets 5–6 are the font size and its unit.
fn label_length(row: &[f64], width_em: f64) -> (f64, bool) {
    (width_em * row[5], row[6] != 0.0)
}

/// The ground spacing a symbol asks for, as metres per pixel, at an anchor
/// where one pixel spans `m` metres.
///
/// `spacing_px` itself, unless the symbol is too long for it: MapLibre then
/// stretches `symbol-spacing` to the symbol's length plus a quarter of the
/// spacing, so repeats keep at least that gap between their ends rather than
/// being dropped (`getAnchors` in `get_anchors.ts`). The result is a factor on
/// `m`, compared against bands that were resolved for `spacing_px`.
fn requested_meters_per_px(m: f64, (length, metric): (f64, bool), spacing_px: f64) -> f64 {
    if !(spacing_px.is_finite() && spacing_px > 0.0) || m <= 0.0 {
        return m;
    }
    let length_px = if metric { length / m } else { length };
    m * (length_px + spacing_px * 0.25).max(spacing_px) / spacing_px
}

/// Whether the level an anchor belongs to is the one on screen: the requested
/// scale falls in its `(min, max]` band. `m` is [`meters_per_px`] at the
/// anchor; `0.0` (behind the camera) is never in band.
fn in_scale_band(m: f64, (min, max): (f64, f64), length: (f64, bool), spacing_px: f64) -> bool {
    let r = requested_meters_per_px(m, length, spacing_px);
    m > 0.0 && min < r && r <= max
}

/// How far the label runs from its anchor along the line, and how much line
/// it has either side.
///
/// The single place the fit test is defined, so [`line_label_fit`] and
/// [`line_label_place`] cannot drift apart. `row` is either phase's packed row:
/// offsets 0–6 are shared, which is what lets both read them in one place; the
/// extent sits at a different offset in each, so it is passed in. Returns
/// `(reach, half_extent, meters_per_em)`; the label fits when
/// `0 < reach <= half_extent`.
fn fit_lengths(row: &[f64], half_extent: f64, cam: &CameraView<'_>) -> (f64, f64, f64) {
    let meters_per_em = em_to_meters((row[0], row[1], row[2]), row[3], row[5], row[6] != 0.0, cam);
    (row[4] * meters_per_em, half_extent, meters_per_em)
}

/// Whether a label is short enough to sit on its line, using nothing but the
/// anchor, the label's width and the line's extent.
///
/// Returns one byte per label: `1` fits, `0` does not. See the module docs for
/// why this is worth a phase of its own.
#[wasm_bindgen(js_name = lineLabelFit)]
pub fn line_label_fit(
    labels: &[f64],
    view: &[f64],
    height_px: f64,
    fov_rad: f64,
    spacing_px: f64,
) -> Vec<u8> {
    let cam = CameraView {
        view,
        height_px,
        fov_rad,
    };
    let n = labels.len() / LINE_LABEL_FIT_STRIDE;
    let mut out = vec![0u8; n];
    for i in 0..n {
        let l = &labels[i * LINE_LABEL_FIT_STRIDE..(i + 1) * LINE_LABEL_FIT_STRIDE];
        let (reach, half_extent, _) = fit_lengths(l, l[7], &cam);
        let m = meters_per_px((l[0], l[1], l[2]), l[3], &cam);
        let shown = in_scale_band(m, (l[8], l[9]), label_length(l, l[10]), spacing_px);
        out[i] = u8::from(shown && reach > 0.0 && reach <= half_extent);
    }
    out
}

/// Place along-line anchors for meshes that lay no label along the line — a
/// sprite is one quad at its anchor: whether each one's level is the one on
/// screen, and the box its quad covers there for the declutter pass.
///
/// The level is chosen by the quad's extent *along its line*, measured in the
/// quad's own frame as MapLibre measures an icon: its local +y is turned
/// `rotation` from north and the line runs at `bearing`, so a quad turned to
/// follow its line is measured by its height, whatever its image's aspect.
///
/// The box mirrors `nvr_quadBasis`, so a quad turned by its line, its style or
/// its facing claims the space it is drawn over rather than its unrotated
/// rectangle.
///
/// `anchors` is packed [`LINE_ANCHOR_STRIDE`] values per anchor. Returns
/// [`LINE_ANCHOR_RESULT_STRIDE`] values per anchor, in input order.
#[wasm_bindgen(js_name = lineAnchorPlace)]
pub fn line_anchor_place(
    anchors: &[f64],
    view: &[f64],
    height_px: f64,
    fov_rad: f64,
    spacing_px: f64,
) -> Vec<f64> {
    let cam = CameraView {
        view,
        height_px,
        fov_rad,
    };
    let rows = anchors.as_chunks::<LINE_ANCHOR_STRIDE>().0;
    let mut out = Vec::with_capacity(rows.len() * LINE_ANCHOR_RESULT_STRIDE);
    for a in rows {
        let (min_x, max_x, min_y, max_y) = (a[7], a[8], a[9], a[10]);
        let (sin, cos) = (a[12] - a[11]).sin_cos();
        let length = (max_x - min_x) * sin.abs() + (max_y - min_y) * cos.abs();
        let m = meters_per_px((a[0], a[1], a[2]), a[3], &cam);
        let shown = in_scale_band(m, (a[4], a[5]), (length, a[6] != 0.0), spacing_px);
        let (right, up) = quad_screen_basis(a, view, a[13] != 0.0, a[14] != 0.0, a[11]);
        let (bx0, bx1, by0, by1) = basis_box(min_x, max_x, min_y, max_y, right, up);
        out.extend_from_slice(&[if shown { 1.0 } else { 0.0 }, bx0, bx1, by0, by1]);
    }
    out
}

/// Screen axes of an anchored quad's local +x and +y: `nvr_quadBasis` in
/// `shaders/glsl/chunks/quad_orientation.glsl`, kept as view-space x/y like
/// [`enu_screen_axes`]. `row` starts with the anchor.
fn quad_screen_basis(
    row: &[f64],
    view: &[f64],
    flat: bool,
    follow: bool,
    rotation: f64,
) -> ((f64, f64), (f64, f64)) {
    let (right, up) = match (flat, follow) {
        // Screen plane, screen up.
        (false, true) => ((1.0, 0.0), (0.0, 1.0)),
        // Tangent plane, yawed so screen right projected onto it stays right.
        (true, true) => {
            let (x, y, z) = (row[0], row[1], row[2]);
            let len = (x * x + y * y + z * z).sqrt();
            let n = (
                (view[0] * x + view[4] * y + view[8] * z) / len,
                (view[1] * x + view[5] * y + view[9] * z) / len,
                (view[2] * x + view[6] * y + view[10] * z) / len,
            );
            let reject = |a: (f64, f64, f64), d: f64| (a.0 - d * n.0, a.1 - d * n.1, a.2 - d * n.2);
            let t = reject((1.0, 0.0, 0.0), n.0);
            let t_len = (t.0 * t.0 + t.1 * t.1 + t.2 * t.2).sqrt();
            let r = if t_len > 1e-4 {
                (t.0 / t_len, t.1 / t_len, t.2 / t_len)
            } else {
                let t = reject((0.0, 1.0, 0.0), n.1);
                let t_len = (t.0 * t.0 + t.1 * t.1 + t.2 * t.2).sqrt();
                (t.0 / t_len, t.1 / t_len, t.2 / t_len)
            };
            // cross(n, r), screen plane only.
            let u = (n.1 * r.2 - n.2 * r.1, n.2 * r.0 - n.0 * r.2);
            ((r.0, r.1), u)
        }
        // Frozen in the anchor's east-north-up frame.
        _ => {
            let axes = enu_screen_axes(row, view);
            (axes.east, if flat { axes.north } else { axes.up })
        }
    };
    // Clockwise seen from the front, as the shader turns it.
    let (s, c) = rotation.sin_cos();
    (
        (c * right.0 - s * up.0, c * right.1 - s * up.1),
        (s * right.0 + c * up.0, s * right.1 + c * up.1),
    )
}

/// The anchor's east, north and up unit vectors, as view-space x/y.
#[derive(Clone, Copy)]
struct ScreenAxes {
    east: (f64, f64),
    north: (f64, f64),
    up: (f64, f64),
}

impl ScreenAxes {
    /// A ground-plane vector, east then north, carried onto the screen.
    fn ground(&self, (e, n): (f64, f64)) -> (f64, f64) {
        (
            e * self.east.0 + n * self.north.0,
            e * self.east.1 + n * self.north.1,
        )
    }
}

/// The anchor's east, north and up directions, projected into view space and
/// kept as 2D screen axes.
///
/// The derivation mirrors `nvr_enuBasis` in
/// `shaders/glsl/chunks/quad_orientation.glsl`, which is the basis the vertex
/// shader lays the label out in. Only the x/y components survive: view space
/// shares the screen's axes, and the label's orientation is a 2D question.
fn enu_screen_axes(l: &[f64], view: &[f64]) -> ScreenAxes {
    let (x, y, z) = (l[0], l[1], l[2]);
    let len = (x * x + y * y + z * z).sqrt();
    if len <= 0.0 {
        return ScreenAxes {
            east: (1.0, 0.0),
            north: (0.0, 1.0),
            up: (0.0, 0.0),
        };
    }
    let (nx, ny, nz) = (x / len, y / len, z / len);

    let (ex, ey) = (-ny, nx);
    let e_len = (ex * ex + ey * ey).sqrt();
    let east = if e_len > 1e-6 {
        (ex / e_len, ey / e_len, 0.0)
    } else {
        // At the poles every tangent direction is an equally valid "east".
        (1.0, 0.0, 0.0)
    };
    let north = (
        ny * east.2 - nz * east.1,
        nz * east.0 - nx * east.2,
        nx * east.1 - ny * east.0,
    );

    // Rotate both into view space (w = 0), keeping the screen plane only.
    let rot = |v: (f64, f64, f64)| {
        (
            view[0] * v.0 + view[4] * v.1 + view[8] * v.2,
            view[1] * v.0 + view[5] * v.1 + view[9] * v.2,
        )
    };
    ScreenAxes {
        east: rot(east),
        north: rot(north),
        up: rot((nx, ny, nz)),
    }
}

/// Unit direction the label reads in, on screen.
///
/// Measured as the chord across the label's own extent, so a road that curves
/// under the label is judged by where the text actually starts and ends rather
/// than by the tangent at its midpoint. Falls back to the anchor's bearing when
/// the label has no length yet — a label whose text has not been shaped.
fn screen_direction(
    l: &[f64],
    path: &[f32],
    samples: usize,
    arc_meters: (f64, f64),
    axes: ScreenAxes,
) -> (f64, f64) {
    let step = l[9];
    let (first, last) = if step > 0.0 {
        sample_range(samples, step, arc_meters)
    } else {
        // No step: every sample is the anchor, and the bearing below decides.
        (0, samples - 1)
    };

    let (mut de, mut dn) = (
        (path[last * 2] - path[first * 2]) as f64,
        (path[last * 2 + 1] - path[first * 2 + 1]) as f64,
    );
    if de.hypot(dn) <= 1e-6 {
        // A degenerate chord (a hairpin doubling back onto itself, or a label
        // with no extent). The bearing is clockwise from north, so it
        // decomposes as north*cos + east*sin.
        let (sin_b, cos_b) = l[11].sin_cos();
        de = sin_b;
        dn = cos_b;
    }

    let (sx, sy) = axes.ground((de, dn));
    let len = sx.hypot(sy);
    if len <= 1e-12 {
        // The label is edge-on to the camera; any direction reads the same.
        return (1.0, 0.0);
    }
    (sx / len, sy / len)
}

/// Whether a label running in screen direction `(sx, sy)` should be walked
/// backwards.
///
/// Normally this is just "does it read left-to-right", but a label running
/// nearly straight up or down the screen has no meaningful left-to-right to
/// test — `sx` there is noise. Those fall back to reading **bottom-to-top**,
/// the cartographic convention for a vertical street name, and the difference
/// between a name you tilt your head left to read and one you tilt it right
/// for.
///
/// The decision is asymmetric about zero so a label sitting on the boundary
/// keeps whichever way it already faces rather than flipping back and forth as
/// the camera drifts — the same failure `HYSTERESIS_PX` guards against in the
/// declutter pass.
fn should_flip(sx: f64, sy: f64, currently_flipped: bool) -> bool {
    // "Reads left to right, and bottom to top when it is too steep for that to
    // mean anything" is a single half-plane test, not two rules with a handover
    // between them: it keeps the label whenever its direction lies on the
    // positive side of a line tilted `asin(VERTICAL_BAND)` off vertical.
    //
    // Writing it as the branch it looks like is what caused labels near
    // vertical to flicker. That form picks *which component to test* from the
    // current flip, so in the strip where the two branches disagree an
    // unflipped label reads its neighbour's rule, flips, then reads its own
    // rule and flips straight back. It happened to be stable in one pair of
    // quadrants, which is why it survived earlier testing.
    //
    // As one continuous score the hysteresis is an ordinary deadband, and both
    // states are self-confirming inside it.
    let normal_x = (1.0 - VERTICAL_BAND * VERTICAL_BAND).sqrt();
    let score = sx * normal_x + sy * VERTICAL_BAND;
    let threshold = if currently_flipped {
        FLIP_HYSTERESIS
    } else {
        -FLIP_HYSTERESIS
    };
    score < threshold
}

/// Screen-space AABB of the label's box once turned to run along `(dx, dy)`.
///
/// The declutter grid is axis-aligned, so a label that follows a north-south
/// road has to be handed the box it actually covers: modelling it as the
/// horizontal rectangle it would occupy unrotated over-claims across the road
/// and, worse, under-claims along it — which is exactly where labels stack up
/// and overlap.
fn rotated_box(
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    dx: f64,
    dy: f64,
) -> (f64, f64, f64, f64) {
    // The label's own +x maps to (dx, dy) and its +y to the perpendicular.
    basis_box(min_x, max_x, min_y, max_y, (dx, dy), (-dy, dx))
}

/// Screen-space AABB of a local box laid out along `right` (its +x) and `up`
/// (its +y).
fn basis_box(
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    right: (f64, f64),
    up: (f64, f64),
) -> (f64, f64, f64, f64) {
    let corner = |lx: f64, ly: f64| (lx * right.0 + ly * up.0, lx * right.1 + ly * up.1);
    let corners = [
        corner(min_x, min_y),
        corner(max_x, min_y),
        corner(max_x, max_y),
        corner(min_x, max_y),
    ];
    corners.iter().fold(
        (f64::MAX, f64::MIN, f64::MAX, f64::MIN),
        |(x0, x1, y0, y1), &(x, y)| (x0.min(x), x1.max(x), y0.min(y), y1.max(y)),
    )
}

/// Screen-space AABB of the label as the shader lays it along its path.
///
/// [`rotated_box`] turns the whole label by one direction, which is exact on a
/// straight road but not on the long gentle curves [`exceeds_max_angle`]
/// deliberately accepts: there the glyphs bow away from the chord, and a box
/// that misses them lets decluttering overlap two labels it thinks are apart.
/// So the box is built the way the shader places glyphs instead.
///
/// The shader lays each word rigidly along the tangent of the segment its
/// centre falls on, so a word does not follow the path past that segment's
/// ends but runs straight on along its line. Where the words fall is not sent
/// here, only how far the widest one reaches (`wordReach`), so each segment the
/// text covers contributes the stretch of its own line that any word centred on
/// it could cover: no more than `wordReach` past the segment, and no further
/// than a word that still fits inside the text's own ends. That contains every
/// word wherever it sits, and on a straight road it is exactly the text. Each
/// such stretch is placed in that segment's own frame:
///
/// - along the segment's line, from the samples themselves;
/// - off it by `lineOffset`, across the ground (the shader's `normal`);
/// - up by the text's height, along that same ground normal when the label
///   lies flat, and along the surface normal when it stands upright.
///
/// Everything is carried onto the screen through the anchor's axes, in the
/// font's own units (the declutter kernel scales those to pixels at the
/// anchor), so an upright label seen from above and a flat one seen edge-on
/// both claim the thin strip they actually cover.
fn path_box(
    l: &[f64],
    path: &[f32],
    samples: usize,
    axes: ScreenAxes,
    flip: bool,
    meters_per_unit: f64,
) -> (f64, f64, f64, f64) {
    let (min_y, max_y, line_offset, flat) = (l[15], l[16], l[17], l[18] != 0.0);
    let step = l[9];
    let reach = l[22] * meters_per_unit;
    let d = if flip { -1.0 } else { 1.0 };
    // The arc the text covers, in metres along the path's own direction.
    let (a, b) = (d * l[13] * meters_per_unit, d * l[14] * meters_per_unit);
    let (lo, hi) = (a.min(b), a.max(b));

    let sample = |k: usize| (path[k * 2] as f64, path[k * 2 + 1] as f64);
    let centre = sample_index(samples, step, 0.0);

    let mut bounds = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    let (first, last) = sample_range(samples, step, (lo, hi));
    for k in first..last {
        let (k_lo, k_hi) = ((k as f64 - centre) * step, (k as f64 + 1.0 - centre) * step);
        // Where on this segment a word's centre can fall.
        let (c_lo, c_hi) = (lo.max(k_lo), hi.min(k_hi));
        if c_lo > c_hi {
            continue;
        }
        // The stretch of segment k's line its words can cover, as fractions
        // along the segment; past `[0, 1]` it runs on beyond the segment. A
        // word centred at `c` reaches at most `hi - c` back, or it would
        // overrun the text's far end.
        let (t0, t1) = (
            (lo.max(c_lo - reach).max(2.0 * c_lo - hi) - k_lo) / step,
            (hi.min(c_hi + reach).min(2.0 * c_hi - lo) - k_lo) / step,
        );
        let (pa, pb) = (sample(k), sample(k + 1));
        let (ge, gn) = (pb.0 - pa.0, pb.1 - pa.1);
        let len = ge.hypot(gn);
        // The shader's tangent, including its east fallback for a segment
        // with no length, turned by the flip.
        let (te, tn) = if len > 1e-6 {
            (ge / len * d, gn / len * d)
        } else {
            (d, 0.0)
        };
        let normal = axes.ground((-tn, te));
        let up = if flat { normal } else { axes.up };
        let offset = (normal.0 * line_offset, normal.1 * line_offset);
        for t in [t0, t1] {
            let p = axes.ground((pa.0 + ge * t, pa.1 + gn * t));
            let (px, py) = (
                p.0 / meters_per_unit + offset.0,
                p.1 / meters_per_unit + offset.1,
            );
            for h in [min_y, max_y] {
                let (x, y) = (px + up.0 * h, py + up.1 * h);
                bounds = (
                    bounds.0.min(x),
                    bounds.1.max(x),
                    bounds.2.min(y),
                    bounds.3.max(y),
                );
            }
        }
    }
    if bounds.0 > bounds.1 {
        // The text covers no segment: it has no extent, or runs wholly past
        // the sampled span — either way it is rejected, so nothing reads it.
        return (0.0, 0.0, 0.0, 0.0);
    }
    // Already anchor-relative: the samples are offsets from the anchor, and
    // the shader draws at `anchor + pathPos` from the same interpolation.
    bounds
}

/// Fractional index of the path sample at `arc_meters` from the anchor.
///
/// Mirrors the shader's `t = (s + halfSpan) / step`: the engine samples
/// symmetrically about the anchor, so with an even count the anchor falls
/// midway between the two middle samples rather than on either.
fn sample_index(samples: usize, step_meters: f64, arc_meters: f64) -> f64 {
    (samples - 1) as f64 * 0.5 + arc_meters / step_meters
}

/// The samples bracketing the arc `(lo, hi)` metres from the anchor, clamped to
/// the path: `first..=last` covers every segment the arc touches.
///
/// Always at least one segment, so a chord taken across it never degenerates
/// to a single sample. Requires `samples >= 2`.
fn sample_range(samples: usize, step_meters: f64, (lo, hi): (f64, f64)) -> (usize, usize) {
    let last_sample = samples - 1;
    // `as` saturates (and maps NaN to 0), so an arc past either end clamps.
    let first = (sample_index(samples, step_meters, lo).floor() as usize).min(last_sample - 1);
    let last =
        (sample_index(samples, step_meters, hi).ceil() as usize).clamp(first + 1, last_sample);
    (first, last)
}

/// Whether the path bends too sharply anywhere under the label.
///
/// The turn is accumulated over a sliding window rather than over the whole
/// label: a long road that curves gently is perfectly readable even though its
/// total bend is large, while a short sharp kink is not. Samples are uniform in
/// arc length, so the window is a fixed number of samples and the sliding sum
/// comes straight off a prefix sum.
fn exceeds_max_angle(
    path: &[f32],
    samples: usize,
    step_meters: f64,
    arc_meters: (f64, f64),
    meters_per_em: f64,
    max_angle_rad: f64,
) -> bool {
    if step_meters <= 0.0 {
        return false;
    }
    // Zero means "straight only", so it has to survive as a limit rather than
    // switch the test off; a negative limit is no more permissive than that.
    // The tolerance absorbs the f32 noise on the samples of a straight road,
    // which would otherwise read as a turn and reject it.
    let limit = max_angle_rad.max(0.0) + ANGLE_TOLERANCE_RAD;

    // Samples the label actually covers — not necessarily centred on the
    // anchor, since `center.x` can put the text to one side of it.
    let (first, last) = sample_range(samples, step_meters, arc_meters);
    if last - first < 2 {
        return false;
    }

    // Turn at each interior sample, as a prefix sum over the covered range.
    let mut prefix = vec![0.0f64; last - first];
    for k in (first + 1)..last {
        let turn = corner_angle(path, k);
        prefix[k - first] = prefix[k - first - 1] + turn;
    }

    let window_samples = ((ANGLE_WINDOW_EMS * meters_per_em) / step_meters)
        .ceil()
        .max(1.0) as usize;
    if window_samples >= prefix.len() {
        return *prefix.last().unwrap_or(&0.0) > limit;
    }
    for start in 0..(prefix.len() - window_samples) {
        if prefix[start + window_samples] - prefix[start] > limit {
            return true;
        }
    }
    false
}

/// Absolute turn, in radians, between the segments meeting at sample `k`.
fn corner_angle(path: &[f32], k: usize) -> f64 {
    let p = |i: usize| (path[i * 2] as f64, path[i * 2 + 1] as f64);
    let (ax, ay) = p(k - 1);
    let (bx, by) = p(k);
    let (cx, cy) = p(k + 1);
    let (ux, uy) = (bx - ax, by - ay);
    let (vx, vy) = (cx - bx, cy - by);
    let (ul, vl) = (ux.hypot(uy), vx.hypot(vy));
    if ul <= 0.0 || vl <= 0.0 {
        return 0.0;
    }
    // atan2 of the cross and dot products is stable where acos of the
    // normalized dot loses precision near zero turn — which is most corners.
    let cross = ux * vy - uy * vx;
    let dot = ux * vx + uy * vy;
    cross.atan2(dot).abs()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A camera hovering over the equator at longitude 0, looking straight down
    /// with screen right = east and screen up = north.
    ///
    /// Column-major, so `v[col * 4 + row]`: row 0 is `(v[0], v[4], v[8])`, the
    /// row `decide_flip` dots the tangent with. Putting east there is what makes
    /// the flip test reduce to the sign of the tangent's easting.
    fn top_down_view(distance_m: f64) -> Vec<f64> {
        vec![
            // col 0        col 1        col 2        col 3
            0.0,
            0.0,
            1.0,
            0.0, //
            1.0,
            0.0,
            0.0,
            0.0, //
            0.0,
            1.0,
            0.0,
            0.0, //
            0.0,
            0.0,
            -WGS84_EQ - distance_m,
            1.0,
        ]
    }

    /// The camera close enough that a pixel-sized label stays short.
    fn view() -> Vec<f64> {
        top_down_view(500.0)
    }

    fn label(bearing_rad: f64, keep_upright: bool, is_flipped: bool) -> [f64; LINE_LABEL_STRIDE] {
        [
            // Anchor on the equator at longitude 0, so east is ECEF +y and
            // north is ECEF +z.
            WGS84_EQ,
            0.0,
            0.0,  //
            0.0,  // addHeight
            2.0,  // reachEm: a 4-em label centred on its anchor
            10.0, // fontSize
            1.0,  // sizeInMeters
            std::f64::consts::FRAC_PI_4,
            if keep_upright { 1.0 } else { 0.0 },
            1.0,    // stepMeters
            1000.0, // halfExtentMeters
            bearing_rad,
            if is_flipped { 1.0 } else { 0.0 },
            // A 4-em label, one em tall, centred on its anchor.
            -2.0 * 10.0,
            2.0 * 10.0,
            0.0,
            10.0,
            0.0, // lineOffset
            1.0, // flatFacing: lying on the ground, like the top-down camera sees it
            0.0, // minMpp
            f64::INFINITY,
            4.0,  // widthEm
            20.0, // wordReach: one word, the whole label
        ]
    }

    /// A camera level with the anchor, south of it and looking due north:
    /// screen right = east, screen up = the surface normal, and north runs
    /// straight into the screen.
    fn level_view_north(distance_m: f64) -> Vec<f64> {
        vec![
            0.0,
            1.0,
            0.0,
            0.0, // col 0: ECEF x (up) -> screen y
            1.0,
            0.0,
            0.0,
            0.0, // col 1: ECEF y (east) -> screen x
            0.0,
            0.0,
            -1.0,
            0.0, // col 2: ECEF z (north) -> into the screen
            0.0,
            -WGS84_EQ,
            -distance_m,
            1.0,
        ]
    }

    const WGS84_EQ: f64 = 6378137.0;

    /// The layer's `spacing`, in pixels.
    const SPACING: f64 = 250.0;

    /// A dead-straight path through the anchor, running east.
    fn straight_path(samples: usize, step: f64) -> Vec<f32> {
        directed_path(samples, step, (1.0, 0.0))
    }

    /// A dead-straight path through the anchor along the given east/north
    /// direction. The label's reading direction is taken from the path, so a
    /// fixture's bearing and its samples have to agree. Centred between the two
    /// middle samples, as `anchor_path` lays them out.
    fn directed_path(samples: usize, step: f64, dir: (f64, f64)) -> Vec<f32> {
        let mid = (samples - 1) as f64 * 0.5;
        (0..samples)
            .flat_map(|k| {
                let t = (k as f64 - mid) * step;
                [(t * dir.0) as f32, (t * dir.1) as f32]
            })
            .collect()
    }

    #[test]
    fn straight_lines_are_accepted_and_not_flipped() {
        // Bearing 90 deg = due east, which reads left-to-right on this camera.
        let l = label(std::f64::consts::FRAC_PI_2, true, false);
        let path = straight_path(32, 1.0);
        let out = line_label_place(&l, &path, 32, &view(), 1000.0, 1.0, SPACING);
        assert_eq!(out[0], 0.0, "flip");
        assert_eq!(out[1], 0.0, "rejected");
    }

    #[test]
    fn westbound_lines_flip_when_keep_upright_is_on() {
        // Bearing 270 deg = due west: the text would read right-to-left.
        let west = 3.0 * std::f64::consts::FRAC_PI_2;
        let path = directed_path(32, 1.0, (-1.0, 0.0));

        let on = line_label_place(
            &label(west, true, false),
            &path,
            32,
            &view(),
            1000.0,
            1.0,
            SPACING,
        );
        assert_eq!(on[0], 1.0, "should flip");

        let off = line_label_place(
            &label(west, false, false),
            &path,
            32,
            &view(),
            1000.0,
            1.0,
            SPACING,
        );
        assert_eq!(off[0], 0.0, "keepUpright off must never flip");
    }

    #[test]
    fn vertical_labels_are_turned_to_read_bottom_to_top() {
        // A street running up the screen already reads bottom-to-top; one
        // running down the screen has to be turned, or the name comes out
        // needing the reader to tilt their head the wrong way. Neither has a
        // meaningful left-to-right to test, which is why the vertical
        // component decides.
        let up = line_label_place(
            &label(0.0, true, false),
            &directed_path(32, 1.0, (0.0, 1.0)),
            32,
            &view(),
            1000.0,
            1.0,
            SPACING,
        );
        assert_eq!(up[0], 0.0, "already reads bottom-to-top");

        let down = line_label_place(
            &label(0.0, true, false),
            &directed_path(32, 1.0, (0.0, -1.0)),
            32,
            &view(),
            1000.0,
            1.0,
            SPACING,
        );
        assert_eq!(down[0], 1.0, "should be turned to read bottom-to-top");
    }

    #[test]
    fn flip_is_sticky_where_the_two_rules_hand_over() {
        // Just steep enough that the horizontal rule would flip it, but the
        // vertical rule would not. Whichever way the label already faces has to
        // win, or a label sitting on this boundary flips every time the camera
        // drifts a pixel.
        let dir = (-0.15, 0.99f64);
        let len = (dir.0 * dir.0 + dir.1 * dir.1).sqrt();
        let path = directed_path(32, 1.0, (dir.0 / len, dir.1 / len));

        let was_upright = line_label_place(
            &label(0.0, true, false),
            &path,
            32,
            &view(),
            1000.0,
            1.0,
            SPACING,
        );
        let was_flipped = line_label_place(
            &label(0.0, true, true),
            &path,
            32,
            &view(),
            1000.0,
            1.0,
            SPACING,
        );

        assert_eq!(was_upright[0], 0.0);
        assert_eq!(was_flipped[0], 1.0);
    }

    #[test]
    fn the_reading_direction_comes_from_the_label_not_its_anchor() {
        // A road that runs east at the anchor but doubles back westward over
        // the label's own extent. The anchor's tangent says "reads fine"; the
        // chord across the label says otherwise, and the chord is what a reader
        // sees.
        let samples = 32;
        let mid = samples / 2;
        let path: Vec<f32> = (0..samples)
            .flat_map(|k| {
                // A shallow "V" opening westward: both ends sit west of the
                // anchor, so the label overall reads right-to-left.
                let t = (k as f64 - mid as f64) * 10.0;
                [(-t.abs()) as f32, (t * 0.05) as f32]
            })
            .collect();
        let mut l = label(std::f64::consts::FRAC_PI_2, true, false);
        l[9] = 10.0;
        let out = line_label_place(&l, &path, samples, &view(), 1000.0, 1.0, SPACING);
        assert_eq!(out[0], 0.0, "a symmetric V has no net direction to flip");

        // Now a plain westward road whose anchor bearing wrongly claims east.
        let west_path = directed_path(samples, 10.0, (-1.0, 0.0));
        let out = line_label_place(&l, &west_path, samples, &view(), 1000.0, 1.0, SPACING);
        assert_eq!(out[0], 1.0, "the chord should win over the bearing");
    }

    #[test]
    fn the_collision_box_turns_with_the_label() {
        // The fixture's box is 40 wide and 10 tall. Running east it stays that
        // way; running north it must come back 10 wide and 40 tall, or the
        // declutter grid models a vertical street label as a horizontal one and
        // lets its neighbours overlap it.
        // Paths long enough to hold the whole label: past the sampled span the
        // shader piles glyphs onto the last sample, and so does the box.
        let mut l = label(std::f64::consts::FRAC_PI_2, false, false);
        l[9] = 10.0;

        let east = line_label_place(
            &l,
            &straight_path(32, 10.0),
            32,
            &view(),
            1000.0,
            1.0,
            SPACING,
        );
        let (ew, eh) = (east[3] - east[2], east[5] - east[4]);
        assert!((ew - 40.0).abs() < 1e-6, "east width {ew}");
        assert!((eh - 10.0).abs() < 1e-6, "east height {eh}");

        let north = line_label_place(
            &l,
            &directed_path(32, 10.0, (0.0, 1.0)),
            32,
            &view(),
            1000.0,
            1.0,
            SPACING,
        );
        let (nw, nh) = (north[3] - north[2], north[5] - north[4]);
        assert!((nw - 10.0).abs() < 1e-6, "north width {nw}");
        assert!((nh - 40.0).abs() < 1e-6, "north height {nh}");
    }

    #[test]
    fn the_box_stands_the_text_up_the_way_the_shader_does() {
        // Flat text lies across the ground, so its height runs along the
        // road's normal; upright text stands along the surface normal. The
        // line offset always runs across the ground. Seen from above, then from
        // ground level looking along the road's normal, each of the three
        // either shows at full size or collapses to nothing.
        let path = straight_path(32, 10.0);
        let place = |flat: bool, view: &[f64]| {
            let mut l = label(std::f64::consts::FRAC_PI_2, false, false);
            l[9] = 10.0;
            l[17] = 5.0;
            l[18] = if flat { 1.0 } else { 0.0 };
            let out = line_label_place(&l, &path, 32, view, 1000.0, 1.0, SPACING);
            (out[3] - out[2], out[4], out[5])
        };
        let (above, level) = (top_down_view(500.0), level_view_north(500.0));

        for flat in [true, false] {
            let (w, _, _) = place(flat, &above);
            assert!((w - 40.0).abs() < 1e-6, "flat {flat}: width {w}");
        }
        // From above: the offset shows, and only flat text shows its height.
        let (_, y0, y1) = place(true, &above);
        assert!(
            (y0 - 5.0).abs() < 1e-6 && (y1 - 15.0).abs() < 1e-6,
            "flat above {y0}..{y1}"
        );
        let (_, y0, y1) = place(false, &above);
        assert!(
            (y0 - 5.0).abs() < 1e-6 && (y1 - 5.0).abs() < 1e-6,
            "upright above {y0}..{y1}"
        );
        // From ground level: the offset is depth, and only upright text shows
        // its height.
        let (_, y0, y1) = place(false, &level);
        assert!(
            y0.abs() < 1e-6 && (y1 - 10.0).abs() < 1e-6,
            "upright level {y0}..{y1}"
        );
        let (_, y0, y1) = place(true, &level);
        assert!(y0.abs() < 1e-6 && y1.abs() < 1e-6, "flat level {y0}..{y1}");
    }

    #[test]
    fn an_off_centre_label_reads_the_way_its_own_side_of_the_line_runs() {
        // A hairpin at the anchor: the line arrives heading east and leaves
        // heading west. With `center.x = 0` the text covers only the westward
        // leg, so it reads backwards and must flip — even though a chord taken
        // symmetrically about the anchor spans both legs and points east.
        let samples = 32;
        let step = 10.0;
        let centre = (samples - 1) as f64 * 0.5;
        let path: Vec<f32> = (0..samples)
            .flat_map(|k| {
                let a = (k as f64 - centre) * step;
                let e = if a < 0.0 { 3.0 * a } else { -a };
                [e as f32, 0.0f32]
            })
            .collect();
        let mut l = label(std::f64::consts::FRAC_PI_2, true, false);
        l[4] = 4.0; // the whole 4-em label ahead of the anchor
        l[9] = step;
        l[13] = 0.0;
        l[14] = 40.0;
        let out = line_label_place(&l, &path, samples, &view(), 1000.0, 1.0, SPACING);
        assert_eq!(out[0], 1.0, "text on the westward leg should flip");
    }

    #[test]
    fn a_zero_max_angle_accepts_only_straight_lines() {
        // Zero is the strictest limit, not "off": a straight road still fits,
        // any real bend does not.
        let mut l = label(std::f64::consts::FRAC_PI_2, true, false);
        l[9] = 10.0;
        let straight = straight_path(32, 10.0);
        let samples = 32;
        let centre = (samples - 1) as f64 * 0.5;
        let bent: Vec<f32> = (0..samples)
            .flat_map(|k| {
                let e = (k as f64 - centre) * 10.0;
                // A 2 deg kink at the anchor.
                let n = if e > 0.0 {
                    e * 2f64.to_radians().tan()
                } else {
                    0.0
                };
                [e as f32, n as f32]
            })
            .collect();
        for max_angle in [0.0, -1.0] {
            l[7] = max_angle;
            let out = line_label_place(&l, &straight, 32, &view(), 1000.0, 1.0, SPACING);
            assert_eq!(out[1], 0.0, "max {max_angle}: straight road fits");
            let out = line_label_place(&l, &bent, 32, &view(), 1000.0, 1.0, SPACING);
            assert_eq!(out[1], 1.0, "max {max_angle}: a bend is rejected");
        }
    }

    #[test]
    fn labels_longer_than_their_line_are_rejected() {
        let mut l = label(std::f64::consts::FRAC_PI_2, true, false);
        // 4 ems at 10 m/em is 40 m long, so 15 m of road either side is not
        // enough to hold it.
        l[10] = 15.0;
        let path = straight_path(32, 1.0);
        let out = line_label_place(&l, &path, 32, &view(), 1000.0, 1.0, SPACING);
        assert_eq!(out[1], 1.0, "should be rejected");
    }

    #[test]
    fn a_sharp_kink_under_the_label_is_rejected() {
        // A right-angle turn at the anchor: 90 deg of bend inside one window,
        // well past the 45 deg limit.
        let samples = 32;
        let mid = samples / 2;
        let path: Vec<f32> = (0..samples)
            .flat_map(|k| {
                if k <= mid {
                    [((k as f64 - mid as f64) * 1.0) as f32, 0.0f32]
                } else {
                    [0.0f32, ((k - mid) as f64 * 1.0) as f32]
                }
            })
            .collect();
        let out = line_label_place(
            &label(std::f64::consts::FRAC_PI_2, true, false),
            &path,
            samples,
            &view(),
            1000.0,
            1.0,
            SPACING,
        );
        assert_eq!(out[1], 1.0, "sharp kink should be rejected");
    }

    #[test]
    fn a_gentle_curve_is_accepted_even_when_its_total_bend_is_large() {
        // A wide arc turning 90 deg overall, but only a couple of degrees
        // within any window — exactly the case a whole-label angle sum would
        // wrongly reject, and the reason the window slides.
        let samples = 32;
        let mid = samples as f64 / 2.0;
        let radius = 400.0;
        let path: Vec<f32> = (0..samples)
            .flat_map(|k| {
                let t = (k as f64 - mid) / samples as f64 * std::f64::consts::FRAC_PI_2;
                [(radius * t.sin()) as f32, (radius * (1.0 - t.cos())) as f32]
            })
            .collect();
        let mut l = label(std::f64::consts::FRAC_PI_2, true, false);
        l[9] = radius * std::f64::consts::FRAC_PI_2 / samples as f64; // step
        let out = line_label_place(&l, &path, samples, &view(), 1000.0, 1.0, SPACING);
        assert_eq!(out[1], 0.0, "gentle curve should be accepted");
    }

    #[test]
    fn a_pixel_sized_label_grows_as_the_camera_pulls_back() {
        // Same label, same road, two camera distances: metres per em scales
        // with view depth, so the far camera's label overruns the road while
        // the near one fits.
        let mut l = label(std::f64::consts::FRAC_PI_2, true, false);
        l[6] = 0.0; // sizeInMeters = false, so fontSize is pixels
        l[10] = 60.0; // 60 m of road either side
        let path = straight_path(32, 10.0);

        let near_view = top_down_view(500.0);
        let far_view = top_down_view(20_000.0);

        let near = line_label_place(&l, &path, 32, &near_view, 1000.0, 1.0, SPACING);
        let far = line_label_place(&l, &path, 32, &far_view, 1000.0, 1.0, SPACING);
        assert_eq!(near[1], 0.0, "close camera: label fits");
        assert_eq!(far[1], 1.0, "far camera: label overruns the road");
    }

    /// The projection the caller performs to build phase one's input. Kept here
    /// so the two strides are pinned against each other by a test rather than
    /// by comment alone.
    fn fit_row(l: &[f64]) -> [f64; LINE_LABEL_FIT_STRIDE] {
        [
            l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[10], l[19], l[20], l[21],
        ]
    }

    #[test]
    fn the_fit_phase_agrees_with_the_full_placement() {
        // The whole point of the split is that phase one can reject a label
        // without its path. That is only safe while the two phases decide
        // identically, so sweep the axes the test depends on — label width,
        // road length, camera distance, metric-vs-pixel sizing and scale band
        // — against a straight path, which can never be rejected for angle.
        let path = straight_path(32, 10.0);
        let bands = [(0.0, f64::INFINITY), (0.0, 1.0), (1.0, f64::INFINITY)];
        for &reach_em in &[0.0, 0.5, 2.0, 20.0, 200.0] {
            for &half_extent in &[0.0, 5.0, 60.0, 1000.0] {
                for &distance in &[500.0, 20_000.0] {
                    for &metric in &[0.0, 1.0] {
                        for &add_height in &[0.0, 400.0] {
                            for &(min, max) in &bands {
                                let mut l = label(std::f64::consts::FRAC_PI_2, true, false);
                                l[3] = add_height;
                                l[4] = reach_em;
                                l[6] = metric;
                                l[10] = half_extent;
                                l[19] = min;
                                l[20] = max;
                                let view = top_down_view(distance);

                                let placed =
                                    line_label_place(&l, &path, 32, &view, 1000.0, 1.0, SPACING);
                                let fits =
                                    line_label_fit(&fit_row(&l), &view, 1000.0, 1.0, SPACING);

                                assert_eq!(
                                    fits[0] == 0,
                                    placed[1] == 1.0,
                                    "reach {reach_em}, extent {half_extent}, distance \
                                     {distance}, metric {metric}, height {add_height}, \
                                     band ({min}, {max}): phases disagree",
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn the_fit_phase_judges_each_label_independently() {
        // Results come back in input order, one byte each — a caller maps them
        // back onto a sparse label list by index, so a shifted or shared result
        // would silently cull the wrong labels.
        let mut fits_row = fit_row(&label(0.0, true, false));
        fits_row[7] = 1000.0; // plenty of road
        let mut overruns_row = fit_row(&label(0.0, true, false));
        overruns_row[7] = 1.0; // almost none

        let packed: Vec<f64> = fits_row
            .iter()
            .chain(overruns_row.iter())
            .chain(fits_row.iter())
            .copied()
            .collect();

        let out = line_label_fit(&packed, &view(), 1000.0, 1.0, SPACING);
        assert_eq!(out, vec![1, 0, 1]);
    }

    #[test]
    fn a_metric_label_is_judged_without_the_camera() {
        // `sizeInMeters` labels have a fixed ground length, so phase one must
        // reach the same verdict however far away the camera is — otherwise
        // pulling back would drop labels that are still exactly as long.
        let mut l = fit_row(&label(0.0, true, false));
        l[6] = 1.0; // sizeInMeters
        l[7] = 100.0; // 100 m of road either side; the label needs 2 * 10 = 20 m

        for &distance in &[10.0, 500.0, 1_000_000.0] {
            let out = line_label_fit(&l, &top_down_view(distance), 1000.0, 1.0, SPACING);
            assert_eq!(out[0], 1, "distance {distance}: metric label still fits");
        }
    }

    #[test]
    fn no_direction_makes_the_flip_oscillate() {
        // The defect this guards: feed `should_flip` its own previous answer
        // and it must settle. A direction where flipping makes the next pass
        // un-flip, and vice versa, is a label that flickers between the two
        // upright orientations for as long as the camera holds still.
        //
        // Swept over the whole circle rather than at a chosen direction,
        // because the broken version was stable in half the quadrants — a
        // single sample passed it for months.
        let steps = 2000;
        for i in 0..steps {
            let theta = (i as f64 / steps as f64) * std::f64::consts::TAU;
            let (sx, sy) = (theta.cos(), theta.sin());

            // Iterate the decision from both starting states. Either it
            // reaches a fixed point, or the two states disagree forever —
            // which is the oscillation.
            for start in [false, true] {
                let once = should_flip(sx, sy, start);
                let twice = should_flip(sx, sy, once);
                assert_eq!(
                    once,
                    twice,
                    "direction ({sx:.4}, {sy:.4}) at {:.1}° oscillates from {start}",
                    theta.to_degrees(),
                );
            }
        }
    }

    #[test]
    fn the_flip_boundary_sits_just_off_vertical() {
        // The deadband must not be so wide that it swallows the decision: a
        // label pointing clearly backwards still has to turn, whatever it did
        // last pass.
        for &(sx, sy, expected) in &[
            (1.0, 0.0, false), // reads left to right
            (-1.0, 0.0, true), // reads right to left
            (0.0, 1.0, false), // straight up: bottom-to-top is the convention
            (0.0, -1.0, true), // straight down
        ] {
            for start in [false, true] {
                assert_eq!(
                    should_flip(sx, sy, start),
                    expected,
                    "({sx}, {sy}) from {start} must not be held by hysteresis",
                );
            }
        }
    }

    /// A sprite anchor row: a `(width, height)` quad centred on its anchor,
    /// standing on screen, turned `rotation` on a line running at `bearing`.
    fn sprite(
        band: (f64, f64),
        (w, h): (f64, f64),
        metric: f64,
        rotation: f64,
        bearing: f64,
    ) -> [f64; LINE_ANCHOR_STRIDE] {
        [
            WGS84_EQ,
            0.0,
            0.0,
            0.0,
            band.0,
            band.1,
            metric,
            -w * 0.5,
            w * 0.5,
            -h * 0.5,
            h * 0.5,
            rotation,
            bearing,
            0.0, // upright
            1.0, // rotateWithCamera
        ]
    }

    fn shown(packed: &[f64]) -> Vec<bool> {
        line_anchor_place(packed, &view(), 1000.0, 1.0, SPACING)
            .chunks(LINE_ANCHOR_RESULT_STRIDE)
            .map(|r| r[0] != 0.0)
            .collect()
    }

    #[test]
    fn a_sprite_turned_to_its_line_is_measured_along_it() {
        // A 1:10 image 200 px tall on an eastbound line, turned to follow it:
        // it runs 200 px along the line, past three quarters of the spacing,
        // so it asks for a sparser level than a band just above the scale.
        // Not turned, the line crosses its 20 px width instead.
        let mpp = 2.0 * 0.5f64.tan() * 500.0 / 1000.0;
        let east = std::f64::consts::FRAC_PI_2;
        let packed: Vec<f64> = [
            sprite((0.0, mpp * 1.01), (20.0, 200.0), 0.0, east, east),
            sprite((0.0, mpp * 1.01), (20.0, 200.0), 0.0, 0.0, east),
        ]
        .concat();
        assert_eq!(shown(&packed), vec![false, true]);
    }

    #[test]
    fn a_sprite_claims_the_box_it_is_turned_into() {
        // A 100x10 px billboard turned a quarter for an eastbound line draws
        // 10x100 px on screen, and must claim that rather than 100x10.
        let east = std::f64::consts::FRAC_PI_2;
        let row = sprite((0.0, f64::INFINITY), (100.0, 10.0), 0.0, east, east);
        let out = line_anchor_place(&row, &view(), 1000.0, 1.0, SPACING);
        let expected = [-5.0, 5.0, -50.0, 50.0];
        for (got, want) in out[1..].iter().zip(expected) {
            assert!((got - want).abs() < 1e-9, "{:?}", &out[1..]);
        }

        // Lying flat and frozen to the ground, the top-down camera sees the
        // same turn: east is screen right, north is screen up.
        let mut flat = row;
        (flat[13], flat[14]) = (1.0, 0.0);
        let out = line_anchor_place(&flat, &view(), 1000.0, 1.0, SPACING);
        for (got, want) in out[1..].iter().zip(expected) {
            assert!((got - want).abs() < 1e-9, "{:?}", &out[1..]);
        }

        // Standing up but frozen, seen from straight above: the quad is
        // edge-on, so it claims only its width across the screen.
        let mut upright = row;
        (upright[11], upright[12], upright[14]) = (0.0, 0.0, 0.0);
        let out = line_anchor_place(&upright, &view(), 1000.0, 1.0, SPACING);
        assert!((out[2] - out[1] - 100.0).abs() < 1e-9 && (out[4] - out[3]).abs() < 1e-9);
    }

    #[test]
    fn an_anchor_shows_only_inside_its_scale_band() {
        // Looking straight down from 500 m with a one-radian field of view
        // over 1000 px: 2 * tan(0.5) * 500 / 1000 ≈ 0.546 m per pixel.
        let mpp = 2.0 * 0.5f64.tan() * 500.0 / 1000.0;
        let anchor = |min: f64, max: f64| sprite((min, max), (2.0, 20.0), 0.0, 0.0, 0.0);
        let packed: Vec<f64> = [
            anchor(0.0, f64::INFINITY),
            anchor(0.0, mpp * 1.01),
            anchor(mpp * 0.99, mpp * 1.01),
            // Too coarse a level for this view, and too fine.
            anchor(mpp * 1.01, f64::INFINITY),
            anchor(0.0, mpp * 0.99),
        ]
        .concat();
        assert_eq!(shown(&packed), vec![true, true, true, false, false]);

        // Text runs the same test before anything else.
        let mut l = label(std::f64::consts::FRAC_PI_2, true, false);
        l[19] = mpp * 1.01;
        assert_eq!(
            line_label_fit(&fit_row(&l), &view(), 1000.0, 1.0, SPACING)[0],
            0
        );
    }

    #[test]
    fn a_symbol_longer_than_its_spacing_asks_for_a_sparser_level() {
        // MapLibre's rule: past three quarters of the spacing, the spacing
        // becomes the symbol's length plus a quarter of it. At 0.546 m/px a
        // 400 px sprite asks for (400 + 62.5) / 250 = 1.85 times the scale.
        let mpp = 2.0 * 0.5f64.tan() * 500.0 / 1000.0;
        let anchor = |max: f64, length: f64, metric: f64| {
            sprite((0.0, max), (2.0, length), metric, 0.0, 0.0)
        };
        let packed: Vec<f64> = [
            // Short: the plain spacing, so a band just above the scale holds.
            anchor(mpp * 1.01, 150.0, 0.0),
            // Long: the level that fits it is 1.85 times coarser.
            anchor(mpp * 1.84, 400.0, 0.0),
            anchor(mpp * 1.86, 400.0, 0.0),
            // The same length in metres, converted at the anchor's scale.
            anchor(mpp * 1.84, 400.0 * mpp, 1.0),
            anchor(mpp * 1.86, 400.0 * mpp, 1.0),
        ]
        .concat();
        assert_eq!(shown(&packed), vec![true, false, true, false, true]);

        // Text is measured by its full width: 4 ems at 100 px.
        let mut l = label(std::f64::consts::FRAC_PI_2, true, false);
        l[5] = 100.0;
        l[6] = 0.0;
        l[20] = mpp * 1.84;
        assert_eq!(
            line_label_fit(&fit_row(&l), &view(), 1000.0, 1.0, SPACING)[0],
            0
        );
        l[20] = mpp * 1.86;
        l[10] = 1e6; // plenty of road, so only the band decides
        assert_eq!(
            line_label_fit(&fit_row(&l), &view(), 1000.0, 1.0, SPACING)[0],
            1
        );
    }

    #[test]
    fn a_label_with_no_width_is_rejected_rather_than_placed() {
        // A label whose text has not been shaped yet has zero width. It must
        // not slip through phase one as "fits trivially" — it draws nothing,
        // and letting it through would have it claim declutter space.
        let mut l = fit_row(&label(0.0, true, false));
        l[4] = 0.0;
        assert_eq!(line_label_fit(&l, &view(), 1000.0, 1.0, SPACING)[0], 0);
    }

    #[test]
    fn an_elevated_pixel_label_is_sized_at_its_raised_depth() {
        // The shader raises the anchor by `addHeight` before converting pixels
        // to metres, so a label lifted most of the way to a distant camera is
        // short on the ground. Sized at the unraised anchor it would overrun
        // 60 m of road; at the raised one it fits.
        let mut l = fit_row(&label(0.0, true, false));
        l[6] = 0.0; // pixel-sized
        l[7] = 60.0;
        let far = top_down_view(20_000.0);
        assert_eq!(
            line_label_fit(&l, &far, 1000.0, 1.0, SPACING)[0],
            0,
            "on the ground"
        );
        l[3] = 19_700.0;
        assert_eq!(
            line_label_fit(&l, &far, 1000.0, 1.0, SPACING)[0],
            1,
            "raised"
        );
    }

    #[test]
    fn the_angle_test_covers_only_the_side_the_text_is_on() {
        // A right-angle kink three samples behind the anchor. With `center.x =
        // 0` the text runs entirely ahead of the anchor and never crosses the
        // kink; with `center.x = 1` it runs entirely behind and does.
        let samples = 32;
        let step = 10.0;
        let centre = (samples - 1) as f64 * 0.5;
        let kink: usize = 13;
        let path: Vec<f32> = (0..samples)
            .flat_map(|k| {
                let e = (k.max(kink) as f64 - centre) * step;
                let n = -((kink.saturating_sub(k)) as f64) * step;
                [e as f32, n as f32]
            })
            .collect();
        let mut l = label(std::f64::consts::FRAC_PI_2, false, false);
        l[4] = 4.0; // the whole 4-em label on one side
        l[9] = step;

        l[13] = 0.0;
        l[14] = 40.0;
        let ahead = line_label_place(&l, &path, samples, &view(), 1000.0, 1.0, SPACING);
        assert_eq!(
            ahead[1], 0.0,
            "text ahead of the anchor never meets the kink"
        );

        l[13] = -40.0;
        l[14] = 0.0;
        let behind = line_label_place(&l, &path, samples, &view(), 1000.0, 1.0, SPACING);
        assert_eq!(behind[1], 1.0, "text behind the anchor runs over it");
    }

    #[test]
    fn a_curved_label_claims_the_space_its_glyphs_bow_into() {
        // A wide arc bowing north. The chord between the label's ends sits
        // ~49 m north of the anchor, so a box turned along the chord covers
        // only the first 10 m above the anchor and misses the glyphs where the
        // road bends up to meet it.
        let samples = 32;
        let centre = (samples - 1) as f64 * 0.5;
        let radius = 400.0;
        let step = 20.0;
        let path: Vec<f32> = (0..samples)
            .flat_map(|k| {
                let t = (k as f64 - centre) * step / radius;
                [(radius * t.sin()) as f32, (radius * (1.0 - t.cos())) as f32]
            })
            .collect();
        let mut l = label(std::f64::consts::FRAC_PI_2, false, false);
        l[4] = 20.0; // 40 ems, centred: 200 m either side
        l[9] = step;
        l[13] = -200.0;
        l[14] = 200.0;

        let out = line_label_place(&l, &path, samples, &view(), 1000.0, 1.0, SPACING);
        assert_eq!(out[1], 0.0, "a gentle curve is accepted");
        let sagitta = radius * (1.0 - (200.0f64 / radius).cos());
        assert!(
            out[5] > sagitta,
            "box top {} misses the bow at {sagitta}",
            out[5]
        );
        assert!(out[4] < 1.0, "box bottom {} lost the anchor", out[4]);
        // And it still spans the label's length.
        assert!(out[3] - out[2] > 2.0 * radius * (200.0f64 / radius).sin() - 1.0);
    }

    #[test]
    fn a_rigid_word_on_a_tight_curve_stays_inside_its_box() {
        // One 18-em word on a 100 m-radius bend: gentle enough within the angle
        // window to be accepted, but the shader lays the word straight along
        // the tangent at its centre, so its ends run ~12 m past where the road
        // itself has curved away to.
        let samples = 32;
        let centre = (samples - 1) as f64 * 0.5;
        let (radius, step) = (100.0f64, 10.0);
        // Sampled the way the engine does, a chord of `step` apart.
        let turn = 2.0 * (step / (2.0 * radius)).asin();
        let path: Vec<f32> = (0..samples)
            .flat_map(|k| {
                let t = (k as f64 - centre) * turn;
                [(radius * t.sin()) as f32, (radius * (1.0 - t.cos())) as f32]
            })
            .collect();
        let mut l = label(std::f64::consts::FRAC_PI_2, false, false);
        l[4] = 9.0; // 18 ems, centred
        l[9] = step;
        (l[13], l[14]) = (-90.0, 90.0);
        l[21] = 18.0;
        l[22] = 90.0;

        let out = line_label_place(&l, &path, samples, &view(), 1000.0, 1.0, SPACING);
        assert_eq!(out[1], 0.0, "the curve is gentle enough to accept");
        // The word's ends, as the shader draws them: its centre's segment,
        // carried 90 m either way along that segment's own direction.
        let p = |k: usize| (path[k * 2] as f64, path[k * 2 + 1] as f64);
        let (pa, pb) = (p(15), p(16));
        let len = (pb.0 - pa.0).hypot(pb.1 - pa.1);
        let dir = ((pb.0 - pa.0) / len, (pb.1 - pa.1) / len);
        let mid = ((pa.0 + pb.0) * 0.5, (pa.1 + pb.1) * 0.5);
        for side in [-90.0, 90.0] {
            let (x, y) = (mid.0 + dir.0 * side, mid.1 + dir.1 * side);
            assert!(
                out[2] <= x && x <= out[3] && out[4] <= y && y <= out[5],
                "word end ({x}, {y}) outside box {:?}",
                &out[2..6]
            );
        }
    }
}
