//! Pure numeric kernel for placing text labels along a line.
//!
//! Sibling of [`crate::declutter`]: everything here is a CPU mirror of what
//! `sdfText.vert.glsl` does with the same data.
//!
//! Four decisions per label, all of which depend on the camera and so cannot
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
//! | 4      | reachEm | farthest the text's ink runs from its anchor along the line, in ems |
//! | 5      | fontSize | px or meters, per `sizeInMeters` |
//! | 6      | sizeInMeters | `0.0` = px, non-zero = meters |
//! | 7      | maxAngleRad | largest turn allowed within the sliding window; `0` = straight only |
//! | 8      | keepUpright | `0.0` = never flip, non-zero = flip when backwards |
//! | 9      | stepMeters | straight-line distance between adjacent path samples |
//! | 10     | halfExtentMeters | real line either side of the anchor |
//! | 11     | bearingRad | the line's tangent at the anchor, clockwise from north |
//! | 12     | isFlipped | the label's current flip, for hysteresis |
//! | 13,14  | minX/maxX | the label's unrotated box along its baseline, over its glyphs' ink |
//! | 15,16  | minY/maxY | the same across it, +Y up, in the font's own units |
//! | 17     | lineOffset | shift off the line along its ground normal, in the font's own units |
//! | 18     | flatFacing | `0.0` = upright, non-zero = flat, as resolved for this label |
//! | 19,20  | minMpp/maxMpp | the `(min, max]` ground metres per pixel the anchor shows over |
//! | 21     | widthEm | the label's full drawn length along the line, in ems |
//! | 22     | wordReach | half the widest word's length, in the font's own units |
//! | 23     | glyphMode | how the glyphs follow the line, a [`GlyphMode`] |
//! | 24     | rotationRad | each glyph's in-plane turn about its own centre, radians clockwise |
//! | 25     | glyphReach | half the widest glyph's length, in the font's own units |
//!
//! `reachEm` rather than the width because the anchor need not be the text's
//! centre: with `center.x = 0` the whole label runs off one side of it, and it
//! is that side that has to fit on the line. The caller owns the `center`
//! arithmetic (it also builds the box), so it hands over the larger of the two
//! sides.
//!
//! All three horizontal measures are the glyphs' ink, not their advances: a
//! glyph can overhang its advance, and it is the ink that has to stay on the
//! line and inside the box.
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
//! are by far the largest thing crossing the boundary. Most labels on a dense
//! view fail that test, so sending every label's path first would waste most
//! of the transfer.
//!
//! [`line_label_fit`] therefore runs that test alone over a compact input, and
//! the caller packs paths only for the labels that survive it. Both phases go
//! through the same [`fits`], so they cannot disagree about how long a
//! label is; [`line_label_place`] repeats the test rather than trusting its
//! caller, which keeps it correct on its own and lets it be called with every
//! label when the split is not worth it.

use wasm_bindgen::prelude::*;

/// Number of `f64` values per label in the packed input slice.
pub const LINE_LABEL_STRIDE: usize = 26;

/// Number of `f64` values per label in [`line_label_fit`]'s packed input.
///
/// | offset | field |
/// |--------|-------|
/// | 0,1,2  | anchorX/Y/Z — ECEF metres, before the height offset |
/// | 3      | addHeight — surface-normal height offset (metres) |
/// | 4      | reachEm — farthest the text's ink runs from its anchor, in ems |
/// | 5      | fontSize — px or metres, per `sizeInMeters` |
/// | 6      | sizeInMeters — `0.0` = px, non-zero = metres |
/// | 7      | halfExtentMeters — real line either side of the anchor |
/// | 8,9    | minMpp/maxMpp — the anchor's scale band |
/// | 10     | widthEm — the label's full drawn length along the line, in ems |
/// | 11     | glyphMode — a [`GlyphMode`]; only `Ground` has its length tested here |
///
/// Offsets 0–6 are the full layout's, so a fit row is a prefix of a full row
/// plus its extent, band, width and facing.
pub const LINE_LABEL_FIT_STRIDE: usize = 12;

/// How an along-line label's glyphs follow its line, as resolved from its
/// facing, `rotateWithCamera` and `spreadGlyphs`: `LineGlyphMode` in
/// `linePlacement.ts`, and the branches of the vertex shader's line walk.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum GlyphMode {
    /// Flat and aligned with the map: words or glyphs lie on the ground along
    /// the line.
    Ground,
    /// Spread glyphs turned to the camera, keeping the anchor's size on the
    /// screen and spaced on it (MapLibre's `viewport-glyph`).
    FacesCamera,
    /// Upright and aligned with the map: on the screen at the anchor's size,
    /// spaced on it, each turned to the line as it runs on the screen.
    ScreenTangent,
    /// Not bent at all: the whole label is drawn at its anchor as a point
    /// label turned to the camera would be (MapLibre's `viewport` rotation).
    Straight,
}

impl GlyphMode {
    fn from_row(value: f64) -> Self {
        match value as u8 {
            0 => Self::Ground,
            1 => Self::FacesCamera,
            2 => Self::ScreenTangent,
            3 => Self::Straight,
            _ => unreachable!("glyph mode {value}"),
        }
    }

    /// Glyphs keep the anchor's size on the screen, so they are spaced on it
    /// and their ground reach is only known once the path is walked.
    fn screen_spaced(self) -> bool {
        matches!(self, Self::FacesCamera | Self::ScreenTangent)
    }
}

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
/// | 14     | rotateWithCamera — `0.0` = aligned with the map, non-zero = follows the camera |
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
/// values, east then north metres relative to its anchor. `view` is a
/// column-major 4x4 matrix.
///
/// Returns [`LINE_LABEL_RESULT_STRIDE`] values per label, in input order; see
/// the module docs for the layout. `spacing_px` is the layer's `spacing`.
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
    debug_assert!(samples_per_label >= 2);
    let rows = labels.as_chunks::<LINE_LABEL_STRIDE>().0;
    let mut out = Vec::with_capacity(rows.len() * LINE_LABEL_RESULT_STRIDE);
    let mut turns = Vec::with_capacity(samples_per_label);

    for (l, path) in rows.iter().zip(paths.chunks_exact(samples_per_label * 2)) {
        let m = meters_per_px((l[0], l[1], l[2]), l[3], &cam);
        let mode = GlyphMode::from_row(l[23]);

        // A straight label is a point label at its anchor: no reading
        // direction to flip, no bend to measure, and the box of its block
        // turned as the shader turns it.
        if mode == GlyphMode::Straight {
            let rejected = !fits(l, m, l[10], (l[19], l[20]), l[21], spacing_px, false);
            let (bx0, bx1, by0, by1) = if rejected {
                (0.0, 0.0, 0.0, 0.0)
            } else {
                let (right, up) = quad_screen_basis(l, view, l[18] != 0.0, true, l[24]);
                basis_box(l[13], l[14], l[15], l[16], right, up)
            };
            out.extend_from_slice(&[0.0, if rejected { 1.0 } else { 0.0 }, bx0, bx1, by0, by1, m]);
            continue;
        }

        let meters_per_unit = meters_per_font_unit(l, m);
        let meters_per_em = l[5] * meters_per_unit;

        // The arc the text actually covers, in metres along the path from the
        // anchor. The box's baseline extent is exactly that in font units, and
        // walking the path backwards mirrors it.
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

        // Glyphs on the screen keep the anchor's size there, so they are also
        // spaced on it: the arc is walked on the screen and becomes the
        // stretch of ground it lands on.
        let frame = ViewFrame::new(l, view);
        let glyphs = match mode {
            GlyphMode::Ground => GlyphBasis::Ground,
            GlyphMode::FacesCamera => {
                let (right, up) = quad_screen_basis(l, view, l[18] != 0.0, true, 0.0);
                GlyphBasis::Fixed(right, up)
            }
            GlyphMode::ScreenTangent => GlyphBasis::ScreenTangent,
            GlyphMode::Straight => unreachable!(),
        };
        // Where a piece's centre can fall: no nearer either end of the text
        // than the widest piece reaches, so it does not run past it.
        let (arc, overruns, centres) = if mode.screen_spaced() {
            let centre = (samples_per_label - 1) as f64 * 0.5;
            let walk = |s| screen_walk(path, samples_per_label, &frame, s);
            let ground = |t: f64| (t - centre) * l[9];
            let ((t0, out0), (t1, out1)) = (walk(arc.0), walk(arc.1));
            let reach = (l[22] * meters_per_unit).min(0.5 * (arc.1 - arc.0));
            let (c0, c1) = (walk(arc.0 + reach).0, walk(arc.1 - reach).0);
            let arc = (ground(t0), ground(t1));
            (
                arc,
                out0 || out1 || -arc.0 > l[10] || arc.1 > l[10],
                (ground(c0), ground(c1)),
            )
        } else {
            (arc, false, arc)
        };

        // The fit test is repeated here rather than trusted from phase one, so
        // this stays correct when called with labels that never went through
        // it. A screen-walked label's length is judged by `overruns` alone:
        // the ground length `fits` measures is not the arc it covers.
        let rejected = !fits(
            l,
            m,
            l[10],
            (l[19], l[20]),
            l[21],
            spacing_px,
            mode == GlyphMode::Ground,
        ) || overruns
            || exceeds_max_angle(
                path,
                samples_per_label,
                l[9],
                arc,
                meters_per_em,
                l[7],
                &mut turns,
            );

        // A rejected label's box is never read; its flip still is, for hysteresis.
        let (bx0, bx1, by0, by1) = if rejected {
            (0.0, 0.0, 0.0, 0.0)
        } else {
            path_box(
                l,
                path,
                samples_per_label,
                &frame,
                glyphs,
                (flip, arc, centres),
                meters_per_unit,
            )
        };
        out.extend_from_slice(&[
            if flip { 1.0 } else { 0.0 },
            if rejected { 1.0 } else { 0.0 },
            bx0,
            bx1,
            by0,
            by1,
            m,
        ]);
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

/// Metres one unit of the font size spans on the ground, at an anchor where a
/// pixel spans `m` metres: `sdfText.vert.glsl`'s `scaleFactor` per unit of
/// size. `row` is either text layout, whose offset 6 is the size's unit.
fn meters_per_font_unit(row: &[f64], m: f64) -> f64 {
    if row[6] != 0.0 { 1.0 } else { m }
}

/// Ground metres one screen pixel spans at the anchor: `nvr_pxToWorld` at its
/// view depth — including its `|viewZ|` approximation of distance, so the CPU
/// and the shaders cannot disagree about how long a label is.
///
/// The depth is taken at the anchor *raised by `addHeight`*, as the shaders
/// apply `mvr_getMvHeightOffset` before reading `mvPosition.z` — and along
/// the same geocentric normal, which is also what the declutter kernel uses.
fn meters_per_px(anchor: (f64, f64, f64), add_height: f64, cam: &CameraView<'_>) -> f64 {
    let (x, y, z) = raised(anchor, add_height);
    let v = cam.view;
    let vz = v[2] * x + v[6] * y + v[10] * z + v[14];
    if vz >= 0.0 {
        // Behind the camera: nothing sensible to scale by, and the declutter
        // pass will drop the label anyway.
        return 0.0;
    }
    (2.0 * (cam.fov_rad / 2.0).tan() * -vz) / cam.height_px
}

/// The anchor raised by `add_height` along its geocentric normal, as
/// `mvr_getMvHeightOffset` raises it.
fn raised((x, y, z): Vec3, add_height: f64) -> Vec3 {
    let len = (x * x + y * y + z * z).sqrt();
    if add_height == 0.0 || len == 0.0 {
        return (x, y, z);
    }
    let s = 1.0 + add_height / len;
    (x * s, y * s, z * s)
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

/// Whether a label's level is the one on screen and its text reaches no
/// further along the line than the `half_extent` metres of line under it.
///
/// The single place the fit test is defined, so [`line_label_fit`] and
/// [`line_label_place`] cannot drift apart. `row` is either phase's packed row,
/// whose offsets 0–6 are shared; the extent, band and width sit at different
/// offsets in each, so they are passed in. `m` is [`meters_per_px`] at the
/// anchor.
///
/// `on_ground` is unset unless the label lies along the ground
/// ([`GlyphMode::Ground`]): a label spaced on the screen has a ground reach
/// only known once its path is walked, so [`line_label_place`] tests its
/// length, and a straight label does not follow the line at all.
fn fits(
    row: &[f64],
    m: f64,
    half_extent: f64,
    band: (f64, f64),
    width_em: f64,
    spacing_px: f64,
    on_ground: bool,
) -> bool {
    let reach = row[4] * row[5] * meters_per_font_unit(row, m);
    let length = (width_em * row[5], row[6] != 0.0);
    in_scale_band(m, band, length, spacing_px)
        && reach > 0.0
        && (!on_ground || reach <= half_extent)
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
    labels
        .as_chunks::<LINE_LABEL_FIT_STRIDE>()
        .0
        .iter()
        .map(|l| {
            let m = meters_per_px((l[0], l[1], l[2]), l[3], &cam);
            u8::from(fits(
                l,
                m,
                l[7],
                (l[8], l[9]),
                l[10],
                spacing_px,
                GlyphMode::from_row(l[11]) == GlyphMode::Ground,
            ))
        })
        .collect()
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
pub(crate) fn quad_screen_basis(
    row: &[f64],
    view: &[f64],
    flat: bool,
    follow: bool,
    rotation: f64,
) -> ((f64, f64), (f64, f64)) {
    let (right, up) = if !flat && follow {
        // Screen plane, screen up.
        ((1.0, 0.0), (0.0, 1.0))
    } else {
        let (east, north, normal) = enu_basis(row);
        let (east, north, n) = (
            view_dir(view, east),
            view_dir(view, north),
            view_dir(view, normal),
        );
        if flat && !follow {
            // Tangent plane, north-up.
            ((east.0, east.1), (north.0, north.1))
        } else {
            // Screen right projected onto the tangent plane.
            let reject = |a: Vec3, d: f64| (a.0 - d * n.0, a.1 - d * n.1, a.2 - d * n.2);
            let t = reject((1.0, 0.0, 0.0), n.0);
            let t_len = (t.0 * t.0 + t.1 * t.1 + t.2 * t.2).sqrt();
            let t = if t_len > 1e-4 {
                (t.0 / t_len, t.1 / t_len, t.2 / t_len)
            } else {
                let t = reject((0.0, 1.0, 0.0), n.1);
                let t_len = (t.0 * t.0 + t.1 * t.1 + t.2 * t.2).sqrt();
                (t.0 / t_len, t.1 / t_len, t.2 / t_len)
            };
            if flat {
                // Tangent plane, yawed to read left-to-right: up = cross(n, t).
                ((t.0, t.1), (n.1 * t.2 - n.2 * t.1, n.2 * t.0 - n.0 * t.2))
            } else {
                // Screen plane, turned by the camera heading so x points east.
                let dot = |a: Vec3, b: Vec3| a.0 * b.0 + a.1 * b.1 + a.2 * b.2;
                let r = (dot(t, east), -dot(t, north));
                (r, (-r.1, r.0))
            }
        }
    };
    // Clockwise seen from the front, as the shader turns it.
    let (s, c) = rotation.sin_cos();
    (
        (c * right.0 - s * up.0, c * right.1 - s * up.1),
        (s * right.0 + c * up.0, s * right.1 + c * up.1),
    )
}

/// The anchor's east and north unit vectors, as view-space x/y.
#[derive(Clone, Copy)]
struct ScreenAxes {
    east: (f64, f64),
    north: (f64, f64),
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

type Vec3 = (f64, f64, f64);

/// The anchor's east, north and up unit vectors in world space: `nvr_enuBasis`
/// in `shaders/glsl/chunks/quad_orientation.glsl`. `l` starts with the anchor.
fn enu_basis(l: &[f64]) -> (Vec3, Vec3, Vec3) {
    let (x, y, z) = (l[0], l[1], l[2]);
    let len = (x * x + y * y + z * z).sqrt();
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
    (east, north, (nx, ny, nz))
}

/// A world-space direction rotated into view space (w = 0).
fn view_dir(view: &[f64], v: Vec3) -> Vec3 {
    (
        view[0] * v.0 + view[4] * v.1 + view[8] * v.2,
        view[1] * v.0 + view[5] * v.1 + view[9] * v.2,
        view[2] * v.0 + view[6] * v.1 + view[10] * v.2,
    )
}

/// The anchor's east and north directions, projected into view space and
/// kept as 2D screen axes.
///
/// Built from the same basis the vertex shader lays the label out in. Only the
/// x/y components survive: view space shares the screen's axes, and the
/// label's orientation is a 2D question.
fn enu_screen_axes(l: &[f64], view: &[f64]) -> ScreenAxes {
    let (east, north, _) = enu_basis(l);
    let rot = |v: Vec3| {
        let r = view_dir(view, v);
        (r.0, r.1)
    };
    ScreenAxes {
        east: rot(east),
        north: rot(north),
    }
}

/// The anchor in view space with its east and north directions, for carrying
/// a label's points onto the screen with perspective, as the shader's
/// projection does.
#[derive(Clone, Copy)]
struct ViewFrame {
    anchor: Vec3,
    east: Vec3,
    north: Vec3,
}

impl ViewFrame {
    fn new(l: &[f64], view: &[f64]) -> Self {
        let (east, north, _) = enu_basis(l);
        let a = raised((l[0], l[1], l[2]), l[3]);
        let r = view_dir(view, a);
        ViewFrame {
            anchor: (r.0 + view[12], r.1 + view[13], r.2 + view[14]),
            east: view_dir(view, east),
            north: view_dir(view, north),
        }
    }

    /// A ground offset from the anchor, east then north metres, as a view-space
    /// offset.
    fn ground(&self, (e, n): (f64, f64)) -> Vec3 {
        let (ev, nv) = (self.east, self.north);
        (
            e * ev.0 + n * nv.0,
            e * ev.1 + n * nv.1,
            e * ev.2 + n * nv.2,
        )
    }

    /// A view-space offset from the anchor as it lands on the screen relative
    /// to the anchor, in metres at the anchor's depth, with its own view depth.
    fn project_offset(&self, d: Vec3) -> ((f64, f64), f64) {
        let a = self.anchor;
        let p = (a.0 + d.0, a.1 + d.1, a.2 + d.2);
        let z = p.2.min(-1e-3);
        let k = a.2 / z;
        ((p.0 * k - a.0, p.1 * k - a.1), z)
    }

    /// A ground offset from the anchor, east then north metres, projected as
    /// [`Self::project_offset`]: `nvr_screenAtAnchorDepth`.
    fn project(&self, g: (f64, f64)) -> ((f64, f64), f64) {
        self.project_offset(self.ground(g))
    }
}

/// The fractional sample index `s` metres from the anchor along the path, the
/// distance measured on the screen at the anchor's depth: `nvr_screenWalk`.
/// Also whether the path ran out first, in which case the index is its end.
///
/// Within a segment the screen fraction is turned into a ground fraction
/// perspective-correctly (`1/z` is what interpolates linearly on screen), so a
/// glyph lands exactly `s` from the anchor on a straight road.
fn screen_walk(path: &[f32], samples: usize, frame: &ViewFrame, s: f64) -> (f64, bool) {
    let sample = |k: usize| (path[k * 2] as f64, path[k * 2 + 1] as f64);
    let last = (samples - 1) as f64;
    let mut t = last * 0.5;
    // The shader's `mix` across the segment `t` falls on.
    let seg = (t.floor() as usize).min(samples - 2);
    let (a, b, f) = (sample(seg), sample(seg + 1), t - seg as f64);
    let (mut q, mut z) = frame.project((a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f));
    let mut remaining = s.abs();
    while remaining > 0.0 {
        let next = if s > 0.0 {
            t.floor() + 1.0
        } else {
            t.ceil() - 1.0
        };
        if !(0.0..=last).contains(&next) {
            return (t, true);
        }
        let (qn, zn) = frame.project(sample(next as usize));
        let len = (qn.0 - q.0).hypot(qn.1 - q.1);
        if len >= remaining {
            let u = remaining / len.max(1e-6);
            let f = u * z / ((1.0 - u) * zn + u * z);
            return (t + (next - t) * f, false);
        }
        remaining -= len;
        (q, z) = (qn, zn);
        t = next;
    }
    (t, false)
}

/// Unit direction the label reads in, on screen.
///
/// Measured as the chord across the label's own extent, so a road that curves
/// under the label is judged by where the text actually starts and ends rather
/// than by the tangent at its midpoint. Falls back to the anchor's bearing when
/// that chord degenerates.
fn screen_direction(
    l: &[f64],
    path: &[f32],
    samples: usize,
    arc_meters: (f64, f64),
    axes: ScreenAxes,
) -> (f64, f64) {
    let (first, last) = sample_range(samples, l[9], arc_meters);
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
/// the camera drifts — the same failure `HYSTERESIS_PX` in `DeclutterManager.ts`
/// guards against.
fn should_flip(sx: f64, sy: f64, currently_flipped: bool) -> bool {
    // One half-plane test, tilted `asin(VERTICAL_BAND)` off vertical, rather
    // than a branch on which component to test: a branch chosen from the
    // current flip disagrees with itself near vertical and oscillates, while a
    // single continuous score makes the hysteresis an ordinary deadband.
    let normal_x = (1.0 - VERTICAL_BAND * VERTICAL_BAND).sqrt();
    let score = sx * normal_x + sy * VERTICAL_BAND;
    let threshold = if currently_flipped {
        FLIP_HYSTERESIS
    } else {
        -FLIP_HYSTERESIS
    };
    score < threshold
}

/// Screen-space AABB of a local box laid out along `right` (its +x) and `up`
/// (its +y).
pub(crate) fn basis_box(
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
/// The declutter grid is axis-aligned, and on the gentle curves
/// [`exceeds_max_angle`] accepts the glyphs bow away from the label's chord, so
/// the box is built the way the shader places glyphs.
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
/// - up by the text's height, along that same ground normal.
///
/// Every corner is carried onto the screen through the `frame` with
/// perspective, as the shader's projection sees the 3D point it draws, in the
/// font's own units at the anchor's depth (the declutter kernel scales those
/// to pixels there). So a label seen edge-on claims the thin strip it actually
/// covers, and the end of a word running toward a pitched camera claims the
/// larger space it is drawn in.
///
/// A label spaced on the screen ([`GlyphBasis::Fixed`] or
/// [`GlyphBasis::ScreenTangent`]) has its pieces centred on the path, but
/// their quads span a screen basis rather than the segment's ground axes:
/// `wordReach` either side, its height across. Only the piece's centre is
/// projected; the quads keep their size at the anchor's depth, as the
/// shader's `glyphDepthScale` keeps them.
///
/// A non-zero `rotationRad` spins each glyph about its own centre on the
/// label's mid-line. A glyph `2g` wide and `2h` tall turned by `θ` spans
/// `g·|cos θ| + h·|sin θ|` along its piece and `g·|sin θ| + h·|cos θ|` across,
/// so with `g` bounded by `glyphReach` each piece grows by `h·|sin θ|` along
/// the line and spans that across, which at zero is the unturned box.
///
/// `arc` is the stretch of path the text covers, in ground metres from the
/// anchor, already walked backwards when `flip`ped; `centres` the part of it a
/// screen-spaced piece's centre can fall on.
/// The screen axes a bent label's pieces are laid along, per [`GlyphMode`].
#[derive(Clone, Copy)]
enum GlyphBasis {
    /// Each segment's own ground axes.
    Ground,
    /// One basis for every piece, as view-space x/y.
    Fixed((f64, f64), (f64, f64)),
    /// Each segment's direction as it runs on the screen, and its screen
    /// perpendicular.
    ScreenTangent,
}

fn path_box(
    l: &[f64],
    path: &[f32],
    samples: usize,
    frame: &ViewFrame,
    glyphs: GlyphBasis,
    (flip, (lo, hi), (centre_lo, centre_hi)): (bool, (f64, f64), (f64, f64)),
    meters_per_unit: f64,
) -> (f64, f64, f64, f64) {
    let line_offset = l[17];
    let step = l[9];
    let reach = l[22] * meters_per_unit;
    let d = if flip { -1.0 } else { 1.0 };
    let (sin, cos) = l[24].sin_cos();
    let half_height = 0.5 * (l[16] - l[15]);
    let mid = 0.5 * (l[15] + l[16]);
    // The extra reach along the line a spun glyph claims, in font units, and
    // its half span across about the mid-line.
    let along = half_height * sin.abs();
    let across = l[25] * sin.abs() + half_height * cos.abs();
    let (min_y, max_y) = (mid - across, mid + across);
    // A view-space offset from the anchor, in metres, on the screen in font
    // units.
    let project = |v: Vec3| {
        let p = frame.project_offset(v).0;
        (p.0 / meters_per_unit, p.1 / meters_per_unit)
    };
    let mut bounds = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    let mut extend = |(x, y): (f64, f64)| {
        bounds = (
            bounds.0.min(x),
            bounds.1.max(x),
            bounds.2.min(y),
            bounds.3.max(y),
        );
    };

    let sample = |k: usize| (path[k * 2] as f64, path[k * 2 + 1] as f64);
    let centre = sample_index(samples, step, 0.0);

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
        let slack = along * meters_per_unit;
        let (t0, t1) = (
            (lo.max(c_lo - reach).max(2.0 * c_lo - hi) - slack - k_lo) / step,
            (hi.min(c_hi + reach).min(2.0 * c_hi - lo) + slack - k_lo) / step,
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
        // `lineOffset` in metres, across the ground (the shader's `normal`).
        let offset = (
            -tn * line_offset * meters_per_unit,
            te * line_offset * meters_per_unit,
        );
        let on_line = |t: f64| frame.ground((pa.0 + ge * t + offset.0, pa.1 + gn * t + offset.1));
        let screen_basis = match glyphs {
            GlyphBasis::Ground => None,
            GlyphBasis::Fixed(right, up) => Some((right, up)),
            // The shader's direction from the projected samples, without the
            // line offset, including its fallback and turned by the flip.
            GlyphBasis::ScreenTangent => {
                let (qa, qb) = (frame.project(pa).0, frame.project(pb).0);
                let (dx, dy) = (qb.0 - qa.0, qb.1 - qa.1);
                let len = dx.hypot(dy);
                let r = if len > 1e-6 {
                    (dx / len * d, dy / len * d)
                } else {
                    (d, 0.0)
                };
                Some((r, (-r.1, r.0)))
            }
        };
        match screen_basis {
            // A piece's centre on the path, with its quad around it on the
            // screen.
            Some((right, up)) => {
                let (c_lo, c_hi) = (c_lo.max(centre_lo), c_hi.min(centre_hi));
                if c_lo > c_hi {
                    continue;
                }
                for t in [(c_lo - k_lo) / step, (c_hi - k_lo) / step] {
                    let (px, py) = project(on_line(t));
                    for (w, h) in [(-1.0, min_y), (-1.0, max_y), (1.0, min_y), (1.0, max_y)] {
                        let w = w * (l[22] + along);
                        extend((px + right.0 * w + up.0 * h, py + right.1 * w + up.1 * h));
                    }
                }
            }
            // A rigid word along this segment's own line, its height across
            // the ground: each corner is a point in 3D, projected at its own
            // depth.
            None => {
                debug_assert!(l[18] != 0.0, "only a flat label lies along the ground");
                let up = frame.ground((-tn, te));
                for t in [t0, t1] {
                    let p = on_line(t);
                    for h in [min_y, max_y] {
                        let h = h * meters_per_unit;
                        extend(project((p.0 + up.0 * h, p.1 + up.1 * h, p.2 + up.2 * h)));
                    }
                }
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
/// total bend is large, while a short sharp kink is not. Samples are a uniform
/// chord apart, so the window is a fixed number of samples and the sliding sum
/// comes straight off a prefix sum, built in `prefix` (scratch reused across
/// labels).
fn exceeds_max_angle(
    path: &[f32],
    samples: usize,
    step_meters: f64,
    arc_meters: (f64, f64),
    meters_per_em: f64,
    max_angle_rad: f64,
    prefix: &mut Vec<f64>,
) -> bool {
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
    prefix.clear();
    prefix.push(0.0);
    for k in (first + 1)..last {
        prefix.push(prefix[k - first - 1] + corner_angle(path, k));
    }

    // At least two corners: the samples are uniform chords, so a polyline
    // vertex falling between two samples splits its turn across both.
    let window_samples = ((ANGLE_WINDOW_EMS * meters_per_em) / step_meters)
        .ceil()
        .max(2.0) as usize;
    if window_samples >= prefix.len() {
        return prefix[prefix.len() - 1] > limit;
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
    // atan2 of the cross and dot products is stable where acos of the
    // normalized dot loses precision near zero turn — which is most corners —
    // and is 0 for a zero-length segment.
    let cross = ux * vy - uy * vx;
    let dot = ux * vx + uy * vy;
    cross.atan2(dot).abs()
}

#[cfg(test)]
mod tests {
    use navara_core::WGS84_A_64;

    use super::*;

    /// A camera hovering over the equator at longitude 0, looking straight down
    /// with screen right = east and screen up = north.
    ///
    /// Column-major, so `v[col * 4 + row]`: row 0 is `(v[0], v[4], v[8])`, the
    /// row `screen_direction` reads the east component from. Putting east there is what makes
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
            -WGS84_A_64 - distance_m,
            1.0,
        ]
    }

    /// [`top_down_view`] with the camera turned to `heading_rad`, clockwise
    /// from north: screen up is the heading, screen right a quarter turn on.
    fn top_down_view_heading(distance_m: f64, heading_rad: f64) -> Vec<f64> {
        let (s, c) = heading_rad.sin_cos();
        vec![
            0.0,
            0.0,
            1.0,
            0.0, // col 0: ECEF x (up) -> towards the camera
            c,
            s,
            0.0,
            0.0, // col 1: ECEF y (east)
            -s,
            c,
            0.0,
            0.0, // col 2: ECEF z (north)
            0.0,
            0.0,
            -WGS84_A_64 - distance_m,
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
            WGS84_A_64,
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
            0.0,  // glyphMode: Ground
            0.0,  // rotationRad
            4.0,  // glyphReach: glyphs 0.8 em wide
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
            -WGS84_A_64,
            -distance_m,
            1.0,
        ]
    }

    /// A camera south of the anchor and as high above it, looking down at it
    /// at 45°: screen right = east, and north recedes up the screen.
    fn tilted_view_north(height_m: f64) -> Vec<f64> {
        let s = std::f64::consts::FRAC_1_SQRT_2;
        vec![
            0.0,
            s,
            s,
            0.0, // col 0: ECEF x (up)
            1.0,
            0.0,
            0.0,
            0.0, // col 1: ECEF y (east) -> screen x
            0.0,
            s,
            -s,
            0.0, // col 2: ECEF z (north)
            0.0,
            -s * WGS84_A_64,
            -s * (WGS84_A_64 + 2.0 * height_m),
            1.0,
        ]
    }

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
    fn the_box_lies_flat_or_stands_on_the_screen_the_way_the_shader_does() {
        // Flat text lies across the ground, so its height runs along the
        // road's normal there. Upright text aligned with the map stays on the
        // screen at the anchor's size, turned to the road as it runs there.
        // The line offset always runs across the ground. Seen from above, then
        // from ground level looking along the road's normal.
        let path = straight_path(32, 10.0);
        let place = |mode: f64, view: &[f64]| {
            let mut l = label(std::f64::consts::FRAC_PI_2, false, false);
            l[9] = 10.0;
            l[17] = 5.0;
            l[18] = if mode == 0.0 { 1.0 } else { 0.0 };
            l[23] = mode;
            let out = line_label_place(&l, &path, 32, view, 1000.0, 1.0, SPACING);
            (out[3] - out[2], out[4], out[5])
        };
        let (above, level) = (top_down_view(500.0), level_view_north(500.0));
        let (ground, screen) = (0.0, 2.0);

        // From above both show the offset, their full length and height.
        for mode in [ground, screen] {
            let (w, y0, y1) = place(mode, &above);
            assert!(
                (w - 40.0).abs() < 1e-6 && (y0 - 5.0).abs() < 1e-6 && (y1 - 15.0).abs() < 1e-6,
                "mode {mode} above: {w} wide, {y0}..{y1}"
            );
        }
        // From ground level the offset is depth. Flat text collapses to its
        // edge; on the screen it keeps its full size.
        let (_, y0, y1) = place(ground, &level);
        assert!(y0.abs() < 1e-6 && y1.abs() < 1e-6, "flat level {y0}..{y1}");
        let (w, y0, y1) = place(screen, &level);
        assert!(
            (w - 40.0).abs() < 1e-6 && y0.abs() < 1e-6 && (y1 - 10.0).abs() < 1e-6,
            "screen level: {w} wide, {y0}..{y1}"
        );
    }

    #[test]
    fn a_glyph_facing_the_camera_spans_the_screen_not_the_road() {
        // A road running up the screen, seen from above, with glyphs one em
        // (10 units) wide. A word along the road, on the ground or turned to
        // it on the screen, lays its height across the road (left of travel,
        // screen left) and its length up it. Glyphs that face the camera each
        // claim their own width across the road and their height up it,
        // whichever way they would otherwise face, but no glyph runs past the
        // text's own ends.
        let path = directed_path(32, 10.0, (0.0, 1.0));
        let place = |mode: f64, flat: bool| {
            let mut l = label(std::f64::consts::FRAC_PI_2, false, false);
            l[9] = 10.0;
            l[18] = if flat { 1.0 } else { 0.0 };
            l[22] = 5.0;
            l[23] = mode;
            let out = line_label_place(&l, &path, 32, &view(), 1000.0, 1.0, SPACING);
            (out[2], out[3], out[4], out[5])
        };
        let close = |a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)| {
            (a.0 - b.0).abs() < 1e-6
                && (a.1 - b.1).abs() < 1e-6
                && (a.2 - b.2).abs() < 1e-6
                && (a.3 - b.3).abs() < 1e-6
        };

        for (mode, flat) in [(0.0, true), (2.0, false)] {
            let b = place(mode, flat);
            assert!(close(b, (-10.0, 0.0, -20.0, 20.0)), "mode {mode}: {b:?}");
        }
        for flat in [false, true] {
            let b = place(1.0, flat);
            assert!(
                close(b, (-5.0, 5.0, -15.0, 25.0)),
                "facing camera, flat {flat}: {b:?}"
            );
        }
    }

    #[test]
    fn the_screen_walk_keeps_its_distance_on_screen() {
        // A road receding from a tilted camera: the far side is foreshortened,
        // so the same distance on screen covers more ground there than on the
        // near side, and lands exactly that far from the anchor on screen.
        let samples = 32;
        let step = 10.0;
        let path = directed_path(samples, step, (0.0, 1.0));
        let l = label(0.0, false, false);
        let frame = ViewFrame::new(&l, &tilted_view_north(300.0));
        let centre = (samples - 1) as f64 * 0.5;
        let on_screen = |t: f64| frame.project((0.0, (t - centre) * step)).0;

        let mut ground = Vec::new();
        for s in [-30.0, 30.0] {
            let (t, ran_out) = screen_walk(&path, samples, &frame, s);
            assert!(!ran_out);
            let (q, a) = (on_screen(t), on_screen(centre));
            let d = (q.0 - a.0).hypot(q.1 - a.1);
            assert!((d - 30.0).abs() < 1e-6, "walked {s}, landed {d} away");
            ground.push(((t - centre) * step).abs());
        }
        assert!(
            ground[1] > ground[0],
            "far {} near {}",
            ground[1],
            ground[0]
        );

        let (_, ran_out) = screen_walk(&path, samples, &frame, 1e6);
        assert!(ran_out, "a walk past the samples has to say so");
    }

    #[test]
    fn glyphs_facing_the_camera_keep_their_spacing_on_a_receding_road() {
        // Rigid flat words foreshorten with the ground, so their box shrinks up
        // the screen. Glyphs facing the camera are spaced on the screen, so the
        // text keeps its full 40 units: glyph centres from half a glyph inside
        // either end, each glyph standing its height up the screen — all of it
        // when upright, foreshortened by the 45° tilt when flat.
        let path = directed_path(32, 10.0, (0.0, 1.0));
        let view = tilted_view_north(300.0);
        let place = |faces_camera: bool, flat: bool| {
            let mut l = label(0.0, false, false);
            l[9] = 10.0;
            l[18] = if flat { 1.0 } else { 0.0 };
            l[22] = 5.0;
            l[23] = if faces_camera { 1.0 } else { 0.0 };
            let out = line_label_place(&l, &path, 32, &view, 1000.0, 1.0, SPACING);
            assert_eq!(out[1], 0.0, "rejected");
            (out[3] - out[2], out[5] - out[4])
        };

        let (_, h) = place(false, true);
        assert!(h < 40.0, "rigid flat words foreshorten: {h}");
        let (w, h) = place(true, false);
        assert!(
            (w - 10.0).abs() < 1e-6 && (h - 40.0).abs() < 1e-6,
            "upright facing camera: {w}x{h}"
        );
        let (w, h) = place(true, true);
        let flat_h = 30.0 + 10.0 * std::f64::consts::FRAC_1_SQRT_2;
        assert!(
            (w - 10.0).abs() < 1e-6 && (h - flat_h).abs() < 1e-6,
            "flat facing camera: {w}x{h}"
        );
    }

    #[test]
    fn a_screen_walked_box_stays_on_its_anchor_off_screen_centre() {
        // The box is anchor-relative wherever the anchor sits on screen. Slide
        // the camera sideways so the anchor lands 100 m right of centre: the
        // glyphs still sit on it, give or take perspective, so the box has to
        // straddle it rather than follow the anchor's offset from the centre.
        let path = directed_path(32, 10.0, (0.0, 1.0));
        let mut view = tilted_view_north(300.0);
        view[12] += 100.0;
        for flat in [false, true] {
            let mut l = label(0.0, false, false);
            l[9] = 10.0;
            l[18] = if flat { 1.0 } else { 0.0 };
            l[22] = 5.0;
            l[23] = 1.0;
            let out = line_label_place(&l, &path, 32, &view, 1000.0, 1.0, SPACING);
            assert_eq!(out[1], 0.0, "flat {flat}: rejected");
            let (cx, cy) = ((out[2] + out[3]) * 0.5, (out[4] + out[5]) * 0.5);
            assert!(
                cx.abs() < 5.0 && cy.abs() < 10.0,
                "flat {flat}: box centred at ({cx}, {cy})"
            );
        }
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
    fn a_corner_split_across_two_samples_still_counts_whole() {
        // A right angle whose vertex falls midway between samples 15 and 16
        // reads as two 45 deg turns. The 20 m step is longer than the 15 m
        // angle window, which must still take both of them.
        let mut l = label(std::f64::consts::FRAC_PI_2, true, false);
        l[7] = std::f64::consts::FRAC_PI_4;
        l[9] = 20.0;
        let d = 20.0 / 2f64.sqrt();
        let corner: Vec<f32> = (0..32)
            .flat_map(|k| {
                let k = k as f64;
                let (e, n) = if k <= 15.0 {
                    (-d - (15.0 - k) * 20.0, 0.0)
                } else {
                    (0.0, d + (k - 16.0) * 20.0)
                };
                [e as f32, n as f32]
            })
            .collect();
        let out = line_label_place(&l, &corner, 32, &view(), 1000.0, 1.0, SPACING);
        assert_eq!(out[1], 1.0);
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
            l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[10], l[19], l[20], l[21], l[23],
        ]
    }

    #[test]
    fn the_fit_phase_leaves_a_screen_spaced_label_to_its_walk() {
        // A 2-em reach (20 m) on 5 m of line: too long on the ground, but a
        // label spaced on the screen covers whatever ground its walk lands on,
        // which only phase two knows. Phase one keeps it; a ground-spaced one
        // with the same row is rejected.
        let view = view();
        let mut l = label(std::f64::consts::FRAC_PI_2, false, false);
        l[10] = 5.0;
        let ground = line_label_fit(&fit_row(&l), &view, 1000.0, 1.0, SPACING);
        l[23] = 1.0;
        let screen = line_label_fit(&fit_row(&l), &view, 1000.0, 1.0, SPACING);
        assert_eq!((ground[0], screen[0]), (0, 1));
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
        // Fed its own previous answer, `should_flip` must settle: otherwise a
        // label flickers between its two upright orientations while the camera
        // holds still. Swept over the whole circle, since a broken rule can be
        // stable in some quadrants only.
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
            WGS84_A_64,
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

        // Upright but aligned with the map stays in the screen plane, turned
        // by the camera heading — none here — so it claims the same box.
        let mut upright = row;
        upright[14] = 0.0;
        let out = line_anchor_place(&upright, &view(), 1000.0, 1.0, SPACING);
        for (got, want) in out[1..].iter().zip(expected) {
            assert!((got - want).abs() < 1e-9, "{:?}", &out[1..]);
        }
    }

    /// Upright and aligned with the map: on screen, never foreshortened, with
    /// its x-axis turned by the camera heading to keep pointing east.
    #[test]
    fn an_upright_map_aligned_quad_turns_with_the_camera_heading() {
        let row = sprite((0.0, f64::INFINITY), (1.0, 1.0), 0.0, 0.0, 0.0);
        let close =
            |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).abs() < 1e-9 && (a.1 - b.1).abs() < 1e-9;
        for (heading_deg, right, up) in [
            (0.0, (1.0, 0.0), (0.0, 1.0)),
            // Looking east, east runs up the screen.
            (90.0, (0.0, 1.0), (-1.0, 0.0)),
            // Looking south, the label reads upside down, as on the map.
            (180.0, (-1.0, 0.0), (0.0, -1.0)),
        ] {
            let view = top_down_view_heading(500.0, f64::to_radians(heading_deg));
            let (r, u) = quad_screen_basis(&row, &view, false, false, 0.0);
            assert!(
                close(r, right) && close(u, up),
                "{heading_deg}°: {r:?} {u:?}"
            );
        }
        // Pitched or level, it stays full size in the screen plane.
        for view in [tilted_view_north(500.0), level_view_north(500.0)] {
            let (r, u) = quad_screen_basis(&row, &view, false, false, 0.0);
            assert!(close(r, (1.0, 0.0)) && close(u, (0.0, 1.0)), "{r:?} {u:?}");
        }
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

    #[test]
    fn a_rigid_word_running_toward_a_pitched_camera_stays_inside_its_box() {
        // A road receding from a camera 30 m up and 30 m south: the text's
        // near end is a third closer than its anchor, so the shader's
        // perspective draws it half as large again. Each corner is projected
        // here as the shader does it — the full 3D point in view space,
        // divided by its own depth — and must land inside the box, which is in
        // metres at the anchor's depth.
        let view = tilted_view_north(30.0);
        let path = directed_path(32, 10.0, (0.0, 1.0));
        // Column-major view matrix applied to an ECEF point.
        let to_view = |(x, y, z): Vec3| {
            let v = &view;
            (
                v[0] * x + v[4] * y + v[8] * z + v[12],
                v[1] * x + v[5] * y + v[9] * z + v[13],
                v[2] * x + v[6] * y + v[10] * z + v[14],
            )
        };
        let a = to_view((WGS84_A_64, 0.0, 0.0));
        let mut l = label(0.0, false, false);
        l[9] = 10.0;
        let out = line_label_place(&l, &path, 32, &view, 1000.0, 1.0, SPACING);
        assert_eq!(out[1], 0.0, "rejected");
        // One 4-em word, 20 m either side of the anchor along the road
        // (ECEF +z, north), 10 m tall left of travel across the ground (west,
        // ECEF -y).
        for s in [-20.0, 20.0] {
            for h in [0.0, 10.0] {
                let p = to_view((WGS84_A_64, -h, s));
                let k = a.2 / p.2;
                let (x, y) = (p.0 * k - a.0, p.1 * k - a.1);
                assert!(
                    out[2] - 1e-6 <= x
                        && x <= out[3] + 1e-6
                        && out[4] - 1e-6 <= y
                        && y <= out[5] + 1e-6,
                    "corner ({x}, {y}) at {s} m outside box {:?}",
                    &out[2..6]
                );
            }
        }
    }

    /// Upright and aligned with the map, a word on a receding road stays at
    /// the anchor's size on the screen, turned to the road as it runs there:
    /// up the screen, its height to the left.
    #[test]
    fn a_word_on_the_screen_keeps_its_size_on_a_receding_road() {
        let path = directed_path(32, 10.0, (0.0, 1.0));
        let mut l = label(0.0, false, false);
        l[9] = 10.0;
        (l[18], l[23]) = (0.0, 2.0);
        let out = line_label_place(
            &l,
            &path,
            32,
            &tilted_view_north(30.0),
            1000.0,
            1.0,
            SPACING,
        );
        assert_eq!(out[1], 0.0, "rejected");
        for (got, want) in out[2..6].iter().zip([-10.0, 0.0, -20.0, 20.0]) {
            assert!((got - want).abs() < 1e-6, "{:?}", &out[2..6]);
        }
    }

    /// A straight label is a point label at its anchor: never flipped, never
    /// bent, and its box the block turned as the shader turns it, whichever
    /// way the road runs under it.
    #[test]
    fn a_straight_label_claims_its_turned_block() {
        let path = directed_path(32, 10.0, (-1.0, 0.0));
        let place = |rotation: f64| {
            let mut l = label(-std::f64::consts::FRAC_PI_2, true, false);
            l[9] = 10.0;
            (l[18], l[23], l[24]) = (0.0, 3.0, rotation);
            line_label_place(&l, &path, 32, &view(), 1000.0, 1.0, SPACING)
        };
        let close = |out: &[f64], want: [f64; 4]| {
            out[2..6]
                .iter()
                .zip(want)
                .all(|(g, w)| (g - w).abs() < 1e-6)
        };

        let out = place(0.0);
        assert_eq!(
            (out[0], out[1]),
            (0.0, 0.0),
            "a westbound road flips no straight label"
        );
        assert!(close(&out, [-20.0, 20.0, 0.0, 10.0]), "{:?}", &out[2..6]);
        // A quarter turn clockwise: the text reads down the screen.
        let out = place(std::f64::consts::FRAC_PI_2);
        assert!(close(&out, [0.0, 10.0, -20.0, 20.0]), "{:?}", &out[2..6]);
    }

    /// Glyphs spun about their own centres grow the box by their turned
    /// extent: along the road by half their height, across it to their own
    /// width about the text's mid-line. Unturned, the box is the word.
    #[test]
    fn spun_glyphs_claim_their_turned_extent() {
        let path = straight_path(32, 10.0);
        let place = |mode: f64, rotation: f64| {
            let mut l = label(std::f64::consts::FRAC_PI_2, false, false);
            l[9] = 10.0;
            l[18] = if mode == 0.0 { 1.0 } else { 0.0 };
            (l[23], l[24]) = (mode, rotation);
            line_label_place(&l, &path, 32, &view(), 1000.0, 1.0, SPACING)
        };
        for mode in [0.0, 2.0] {
            let out = place(mode, 0.0);
            let want = [-20.0, 20.0, 0.0, 10.0];
            assert!(
                out[2..6]
                    .iter()
                    .zip(want)
                    .all(|(g, w)| (g - w).abs() < 1e-6),
                "mode {mode}: {:?}",
                &out[2..6]
            );
            // A quarter turn: glyphs 8 wide and 10 tall stand 8 tall about
            // the mid-line (5 ± 4), and reach 5 past either end.
            let out = place(mode, std::f64::consts::FRAC_PI_2);
            let want = [-25.0, 25.0, 1.0, 9.0];
            assert!(
                out[2..6]
                    .iter()
                    .zip(want)
                    .all(|(g, w)| (g - w).abs() < 1e-6),
                "mode {mode}: {:?}",
                &out[2..6]
            );
        }
    }
}
