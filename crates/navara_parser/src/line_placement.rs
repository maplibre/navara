//! Anchors spaced along line geometry, shared by every source that derives
//! point-like anchors (points, billboards, text) from lines.
//!
//! Everything here works in a planar, **conformal** frame whose y axis grows
//! southward: MVT tile units, or Web Mercator for sources in degrees. Conformal
//! is what makes [`tangent_to_bearing`] exact — a direction in the frame is the
//! same direction on the ground — while the frame's scale may vary with
//! latitude, which is why metre conversions take a per-anchor
//! `meters_per_unit`.

/// How an emitter derives anchors from line geometry.
///
/// Mirrors `navara_material::Placement` but is ECS-free, for the same reason
/// `LayerParseKind` mirrors `GeometryAppearanceKind`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PointPlacement {
    /// One anchor per source vertex.
    #[default]
    Point,
    /// Anchors repeated along the line at `spacing` intervals.
    Line,
    /// A single anchor at the line's arc-length midpoint.
    LineCenter,
}

impl PointPlacement {
    /// Whether this mode resamples the line rather than emitting per vertex.
    pub fn is_along_line(self) -> bool {
        matches!(self, Self::Line | Self::LineCenter)
    }
}

/// Path samples stored per along-line text anchor.
///
/// Neighbouring samples are a uniform `step` apart **in a straight line**,
/// which is the whole point: the vertex shader finds the segment containing a
/// glyph with `floor(s / step)` instead of walking the path, so bending a glyph
/// costs two texel fetches rather than a loop. Uniform chords rather than
/// uniform arc length, because the shader moves along the chords: a chord
/// across a bend is shorter than the arc it spans, and the text would run
/// slower there than its own em ruler.
pub const PATH_SAMPLES: usize = 32;

// The anchor sits midway between the two middle samples (see
// `LinePath::anchor_path`), which needs an even count.
const _: () = assert!(PATH_SAMPLES.is_multiple_of(2));

// The transfer attribute's `size` is a u8 holding the two-floats-per-sample
// stride, so the count cannot exceed 127.
const _: () = assert!(PATH_SAMPLES * 2 <= u8::MAX as usize);

/// Arc length a label's sampled path covers, as a multiple of the anchor
/// spacing. Repeated labels are spaced by `spacing`, so a label that needs more
/// than this would collide with its own neighbours anyway; it is rejected
/// instead of being given a longer path.
const PATH_SPAN_SPACINGS: f64 = 2.0;

/// Most anchor positions one line may receive at its finest level. The finest
/// spacing comes from the style, so a vanishingly small value would otherwise
/// ask for an unbounded number of them; flooring the spacing instead of
/// truncating the count keeps the anchors spread along the whole line.
const MAX_ANCHORS_PER_LINE: f64 = 10_000.0;

/// Scalars stored per anchor in the scale-band buffer: the `(min, max]` ground
/// metres per screen pixel over which the renderer shows it.
pub const SCALE_BAND_STRIDE: usize = 2;

/// The band a plain point sharing a group with along-line anchors takes: shown
/// at every scale.
pub const ALWAYS_SHOWN: [f32; SCALE_BAND_STRIDE] = [0.0, f32::INFINITY];

/// One anchor [`LinePath::anchors`] places, with the range of on-screen scales
/// it is shown over.
///
/// The requested spacing `r` is `spacing` screen pixels expressed in frame
/// units at the camera's current scale; the anchor shows while
/// `min_spacing < r <= max_spacing`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LineAnchor {
    /// Arc length along the line, in frame units.
    pub s: f64,
    pub min_spacing: f64,
    /// `INFINITY` for the anchor that stays on however far the camera pulls
    /// back: the line's midpoint.
    pub max_spacing: f64,
    /// Pattern spacing the anchor's path span is sized for (see
    /// [`LinePath::anchor_path`]).
    pub path_spacing: f64,
}

impl LineAnchor {
    /// The shown range as ground metres per screen pixel, for a pattern
    /// `spacing_px` pixels apart. `meters_per_unit` is the frame's ground scale
    /// at the anchor.
    pub fn scale_band(&self, meters_per_unit: f64, spacing_px: f64) -> [f32; SCALE_BAND_STRIDE] {
        // An unusable spacing resolved to the lone midpoint anchor, which
        // shows at every scale.
        if !(spacing_px.is_finite() && spacing_px > 0.0) {
            return ALWAYS_SHOWN;
        }
        let per_px = meters_per_unit / spacing_px;
        [
            (self.min_spacing * per_px) as f32,
            (self.max_spacing * per_px) as f32,
        ]
    }
}

/// Scalars stored per anchor alongside its path samples: the metre step between
/// samples, then the arc length of *real* line either side of the anchor.
///
/// The second matters because samples past a line's end are extrapolated (so
/// the tangent never degenerates), which leaves the renderer unable to tell
/// where the road actually stopped. Without it a name would happily run along
/// 200 m of imaginary straight road off the end of a 30 m stub.
pub const PATH_META_STRIDE: usize = 2;

/// The sampled line under one along-line text anchor.
#[derive(Clone, Debug, PartialEq)]
pub struct AnchorPath {
    /// [`PATH_SAMPLES`] east/north metre offsets from the anchor.
    pub samples: Vec<f32>,
    /// See [`PATH_META_STRIDE`].
    pub meta: [f32; PATH_META_STRIDE],
}

/// A linestring prepared for arc-length queries.
pub struct LinePath<'a> {
    verts: &'a [(f64, f64)],
    /// Prefix sums of segment lengths, one per vertex.
    cum: Vec<f64>,
}

impl<'a> LinePath<'a> {
    /// `None` when the line has fewer than two vertices or no length, which
    /// would make every arc-length query degenerate.
    pub fn new(verts: &'a [(f64, f64)]) -> Option<Self> {
        if verts.len() < 2 {
            return None;
        }
        let mut cum = Vec::with_capacity(verts.len());
        cum.push(0.0);
        let mut total = 0.0;
        for w in verts.windows(2) {
            total += (w[1].0 - w[0].0).hypot(w[1].1 - w[0].1);
            cum.push(total);
        }
        (total > 0.0).then_some(Self { verts, cum })
    }

    /// Total arc length, in frame units.
    pub fn length(&self) -> f64 {
        self.cum[self.cum.len() - 1]
    }

    /// The segment containing arc length `s` (clamped to the line) and the
    /// fraction along it, for interpolating per-vertex values such as height.
    pub fn segment_at(&self, s: f64) -> (usize, f64) {
        let clamped = s.clamp(0.0, self.length());
        let last_seg = self.verts.len() - 2;
        // The first segment whose end is at or past `clamped` contains it.
        // Binary search, since this runs for every path sample of every anchor
        // and a line can have thousands of vertices.
        let first = self.cum[1..]
            .partition_point(|&c| c < clamped)
            .min(last_seg);
        // Zero-length segments (repeated vertices) are skipped: a line opening
        // with a duplicate would otherwise hand every query at its start that
        // segment, whose tangent is undefined, and the extrapolation before the
        // first anchor would run off in an arbitrary direction. Only a run of
        // duplicates at `clamped == 0` can be found this way — any later
        // zero-length segment ends where its predecessor did, so the search
        // stops on the predecessor — and the line has positive length, so a
        // real segment follows.
        let seg = (first..=last_seg)
            .find(|&i| self.cum[i + 1] > self.cum[i])
            .unwrap_or(last_seg);
        let len = self.cum[seg + 1] - self.cum[seg];
        let t = if len > 0.0 {
            (clamped - self.cum[seg]) / len
        } else {
            0.0
        };
        (seg, t)
    }

    /// Position and unit tangent at arc length `s`.
    ///
    /// Past either end the path is **extrapolated** along that end's tangent
    /// rather than clamped: a label longer than the line it sits on then runs
    /// straight off the end, which reads correctly and — unlike a clamped,
    /// zero-length end segment — never yields a degenerate tangent for the
    /// shader to normalize.
    pub fn sample(&self, s: f64) -> ((f64, f64), (f64, f64)) {
        let (seg, t) = self.segment_at(s);
        let (a, b) = (self.verts[seg], self.verts[seg + 1]);
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let norm = dx.hypot(dy);
        let tangent = if norm > 0.0 {
            (dx / norm, dy / norm)
        } else {
            (1.0, 0.0)
        };
        // Zero whenever `s` is on the path, so this is a no-op for anchor queries.
        let overshoot = s - s.clamp(0.0, self.length());
        (
            (
                a.0 + dx * t + tangent.0 * overshoot,
                a.1 + dy * t + tangent.1 * overshoot,
            ),
            tangent,
        )
    }

    /// The anchors `placement` puts on this line, as nested levels so the
    /// renderer can pick the density per anchor from its on-screen scale.
    ///
    /// Level `l` repeats every `finest * 2^l` frame units, centred on the
    /// line's midpoint, and every level's positions are a subset of the level
    /// below — so as the camera pulls back anchors only drop out, never move.
    /// The renderer shows the level whose spacing is the smallest one at least
    /// the requested spacing, which keeps the gap on screen between one and
    /// two times `spacing` pixels wherever the camera is. A position sits at
    /// least half its level's interval from either end, so an anchor never
    /// lands on an endpoint where a label has no line left to sit on. The
    /// midpoint belongs to every level, up to the first one whose interval
    /// covers the whole line; it is therefore the one anchor a line always
    /// keeps, and the only one a `LineCenter` line has.
    ///
    /// With `banded`, each position gets one anchor per level it belongs to,
    /// finest first, each shown only while its own level is the one selected
    /// and with a path sized for that level. A text path has a fixed sample
    /// count, so a single anchor would bend a label across a coarse level's
    /// long chords once the camera zooms in. Without it — a sprite needs no
    /// path — each position gets one anchor, shown at every scale up to its
    /// coarsest level.
    pub fn anchors(&self, placement: PointPlacement, finest: f64, banded: bool) -> Vec<LineAnchor> {
        debug_assert!(placement.is_along_line());
        let total = self.length();
        let finest = self.resolve_spacing(finest);
        let half = total * 0.5;
        let top = (total / finest).log2().ceil().max(0.0) as i32;
        let spacing = |level: i32| finest * 2f64.powi(level);
        // A line measuring a whole number of intervals must keep its end
        // anchors, which rounding in the projected length would otherwise push
        // a hair past the limit.
        let fits = |k: i64, level: i32| {
            k.unsigned_abs() as f64 * finest + spacing(level) * 0.5 <= half + finest * 1e-6
        };
        let reach = match placement {
            PointPlacement::LineCenter => 0,
            _ => ((half - finest * 0.5) / finest + 1e-6).floor().max(0.0) as i64,
        };

        let mut out = Vec::new();
        for k in -reach..=reach {
            // `reach` already keeps every position clear of the ends at level 0.
            let coarsest = if k == 0 {
                top
            } else {
                let mut level = 0;
                while level < k.trailing_zeros() as i32 && fits(k, level + 1) {
                    level += 1;
                }
                level
            };
            let s = half + k as f64 * finest;
            let max_spacing = |level: i32| {
                if k == 0 && level == top {
                    f64::INFINITY
                } else {
                    spacing(level)
                }
            };
            if banded {
                for level in 0..=coarsest {
                    out.push(LineAnchor {
                        s,
                        min_spacing: if level == 0 { 0.0 } else { spacing(level - 1) },
                        max_spacing: max_spacing(level),
                        path_spacing: spacing(level),
                    });
                }
            } else {
                out.push(LineAnchor {
                    s,
                    min_spacing: 0.0,
                    max_spacing: max_spacing(coarsest),
                    path_spacing: spacing(coarsest),
                });
            }
        }
        out
    }

    /// The spacing the resampler actually uses, given the style's.
    ///
    /// A zero, negative or non-finite value has no meaningful interval, so it
    /// falls back to the whole line — one anchor, at the midpoint — rather than
    /// being divided by. A valid one is floored at [`MAX_ANCHORS_PER_LINE`].
    fn resolve_spacing(&self, spacing: f64) -> f64 {
        let total = self.length();
        if spacing.is_finite() && spacing > 0.0 {
            spacing.max(total / MAX_ANCHORS_PER_LINE)
        } else {
            total
        }
    }

    /// [`PATH_SAMPLES`] points centred on the anchor at arc length `s`, as
    /// east/north metre offsets from it, for a pattern `spacing` frame units
    /// apart — an anchor's [`LineAnchor::path_spacing`].
    ///
    /// The two middle samples straddle the anchor half a step either side, and
    /// from there each sample is the first point along the line a chord of
    /// `step` away from its neighbour (see [`PATH_SAMPLES`]).
    ///
    /// Metres rather than frame units because glyph sizes are metric
    /// downstream, and relative to the anchor so the values stay small enough
    /// for `f32` — a few hundred metres, against the ~6.4e6 of an absolute
    /// ECEF coordinate. `meters_per_unit` is the frame's ground scale at the
    /// anchor.
    pub fn anchor_path(&self, s: f64, spacing: f64, meters_per_unit: f64) -> AnchorPath {
        let spacing = self.resolve_spacing(spacing);
        let step = spacing * PATH_SPAN_SPACINGS / (PATH_SAMPLES - 1) as f64;
        let (origin, _) = self.sample(s);
        let mid = PATH_SAMPLES / 2;
        let mut arcs = [0.0; PATH_SAMPLES];
        arcs[mid - 1] = self.chord_step(s, step * 0.5, false);
        for k in mid..PATH_SAMPLES {
            arcs[k] = self.chord_step(arcs[k - 1], step, true);
        }
        for k in (0..mid - 1).rev() {
            arcs[k] = self.chord_step(arcs[k + 1], step, false);
        }
        let mut samples = Vec::with_capacity(PATH_SAMPLES * 2);
        for arc in arcs {
            let (p, _) = self.sample(arc);
            // The frame's y grows southward, so north is the negated delta.
            samples.push(((p.0 - origin.0) * meters_per_unit) as f32);
            samples.push(((origin.1 - p.1) * meters_per_unit) as f32);
        }
        let half_extent = s.min(self.length() - s) * meters_per_unit;
        AnchorPath {
            samples,
            meta: [(step * meters_per_unit) as f32, half_extent as f32],
        }
    }

    /// Arc length of the first point past `s`, walking forwards or backwards,
    /// that lies `chord` away from the point at `s` in a straight line —
    /// extrapolated off the end like [`Self::sample`] when the line runs out.
    ///
    /// The path is walked one straight run at a time. Along a run the squared
    /// distance from the start is a convex quadratic in arc length, and still
    /// under `chord²` where the run begins, so the crossing is its root on the
    /// walking side; a run that ends inside the circle cannot cross it.
    fn chord_step(&self, s: f64, chord: f64, forward: bool) -> f64 {
        let (from, _) = self.sample(s);
        let mut lo = s;
        loop {
            // Where this straight run ends: the next vertex in the walking
            // direction, or never for the extrapolation past either end.
            // Strict comparisons skip the zero-length runs of repeated vertices.
            let hi = if forward {
                let i = self.cum.partition_point(|&c| c <= lo);
                self.cum.get(i).copied().unwrap_or(f64::INFINITY)
            } else {
                let i = self.cum.partition_point(|&c| c < lo);
                if i > 0 {
                    self.cum[i - 1]
                } else {
                    f64::NEG_INFINITY
                }
            };
            // The run is straight, so a point and tangent from inside it give
            // every position on it: `base + (σ - mid)·tangent`.
            let mid = if hi.is_finite() {
                (lo + hi) * 0.5
            } else if forward {
                lo + 1.0
            } else {
                lo - 1.0
            };
            let (base, t) = self.sample(mid);
            let w = (base.0 - from.0 - mid * t.0, base.1 - from.1 - mid * t.1);
            let b = w.0 * t.0 + w.1 * t.1;
            let root = (b * b - (w.0 * w.0 + w.1 * w.1) + chord * chord)
                .max(0.0)
                .sqrt();
            let sigma = if forward { -b + root } else { -b - root };
            if (forward && sigma <= hi) || (!forward && sigma >= hi) {
                return sigma;
            }
            lo = hi;
        }
    }
}

/// What an anchor placed along a line carries beyond its position.
#[derive(Clone, Debug, PartialEq)]
pub struct AlongLine {
    /// The line's tangent, in degrees clockwise from north.
    pub bearing: f32,
    /// See [`LineAnchor::scale_band`].
    pub scale_band: [f32; SCALE_BAND_STRIDE],
    /// The sampled line under it; text only.
    pub path: Option<AnchorPath>,
}

/// Append one point's along-line data to a point group's buffers, keeping them
/// one entry per point.
///
/// A group can mix along-line anchors with native points — a material with
/// `geometryTypes: ["point", "line"]` puts both in one batch — while the
/// renderer indexes every buffer by instance. So once any point in the group
/// carries a bearing or a path, every point does: the ones without get a
/// bearing of `0.0` (no rotation added), the [`ALWAYS_SHOWN`] band, and a path
/// whose sample step is `0.0`, which is how the renderer tells them apart.
/// Points pushed before the group's first along-line anchor are backfilled the
/// same way.
///
/// `points_before` is the number of points already in the group.
pub fn push_anchor_line_data(
    points_before: usize,
    bearings: &mut Vec<f32>,
    scale_bands: &mut Vec<f32>,
    path_samples: &mut Vec<f32>,
    path_meta: &mut Vec<f32>,
    line: Option<AlongLine>,
) {
    let (bearing, band, path) = match line {
        Some(l) => (Some(l.bearing), Some(l.scale_band), l.path),
        None => (None, None, None),
    };
    if bearing.is_some() || !bearings.is_empty() {
        bearings.resize(points_before, 0.0);
        bearings.push(bearing.unwrap_or(0.0));
        for _ in scale_bands.len() / SCALE_BAND_STRIDE..points_before {
            scale_bands.extend_from_slice(&ALWAYS_SHOWN);
        }
        scale_bands.extend_from_slice(&band.unwrap_or(ALWAYS_SHOWN));
    }
    if path.is_some() || !path_meta.is_empty() {
        path_samples.resize(points_before * PATH_SAMPLES * 2, 0.0);
        path_meta.resize(points_before * PATH_META_STRIDE, 0.0);
        match path {
            Some(p) => {
                path_samples.extend_from_slice(&p.samples);
                path_meta.extend_from_slice(&p.meta);
            }
            None => {
                path_samples.resize(path_samples.len() + PATH_SAMPLES * 2, 0.0);
                path_meta.resize(path_meta.len() + PATH_META_STRIDE, 0.0);
            }
        }
    }
}

/// Convert a frame tangent to a compass bearing in degrees.
///
/// East is `+x` and north is `-y`, so clockwise-from-north matches the
/// `rotation` field's sense.
pub fn tangent_to_bearing(tangent: (f64, f64)) -> f32 {
    tangent.0.atan2(-tangent.1).to_degrees() as f32
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn rejects_degenerate_lines() {
        assert!(LinePath::new(&[(0.0, 0.0)]).is_none());
        assert!(LinePath::new(&[(1.0, 1.0), (1.0, 1.0)]).is_none());
    }

    #[test]
    fn segment_at_locates_the_containing_segment() {
        let verts = [(0.0, 0.0), (10.0, 0.0), (10.0, 30.0)];
        let path = LinePath::new(&verts).unwrap();
        assert_eq!(path.segment_at(5.0), (0, 0.5));
        assert_eq!(path.segment_at(25.0), (1, 0.5));
        // Clamped past the end, so the last vertex's values are reused.
        assert_eq!(path.segment_at(100.0), (1, 1.0));
    }

    /// Arc lengths of the anchors shown when the requested spacing is `r`.
    fn shown(anchors: &[LineAnchor], r: f64) -> Vec<f64> {
        anchors
            .iter()
            .filter(|a| a.min_spacing < r && r <= a.max_spacing)
            .map(|a| a.s)
            .collect()
    }

    fn line_1000() -> [(f64, f64); 2] {
        [(0.0, 0.0), (1000.0, 0.0)]
    }

    #[test]
    fn levels_are_centred_and_thin_out_without_moving() {
        let verts = line_1000();
        let path = LinePath::new(&verts).unwrap();
        let anchors = path.anchors(PointPlacement::Line, 100.0, false);

        // Finer than the finest level: every position, still 100 apart.
        let all: Vec<f64> = (1..=9).map(|i| i as f64 * 100.0).collect();
        assert_eq!(shown(&anchors, 50.0), all);
        assert_eq!(shown(&anchors, 100.0), all);
        // One level up: every other position, 200 apart — within [r, 2r).
        assert_eq!(
            shown(&anchors, 150.0),
            vec![100.0, 300.0, 500.0, 700.0, 900.0]
        );
        // 100 and 900 are only 100 from the ends, too close for a 400 interval.
        assert_eq!(shown(&anchors, 300.0), vec![500.0]);
        // Pulled far back, the midpoint is all that is left.
        assert_eq!(shown(&anchors, 1e9), vec![500.0]);
    }

    #[test]
    fn banded_anchors_show_each_position_once_with_a_path_for_its_level() {
        let verts = line_1000();
        let path = LinePath::new(&verts).unwrap();
        let single = path.anchors(PointPlacement::Line, 100.0, false);
        let banded = path.anchors(PointPlacement::Line, 100.0, true);
        for r in [10.0, 100.0, 120.0, 200.0, 250.0, 799.0, 1600.0, 1e6] {
            // Same positions as the unbanded pattern, none of them twice.
            assert_eq!(shown(&banded, r), shown(&single, r), "r {r}");
            for a in banded
                .iter()
                .filter(|a| a.min_spacing < r && r <= a.max_spacing)
            {
                // Sized for the level on screen: never shorter than asked,
                // and under twice it once the finest level is left behind.
                assert!(a.path_spacing >= r.min(100.0), "r {r}: {a:?}");
                if r > 100.0 && a.max_spacing.is_finite() {
                    assert!(a.path_spacing < 2.0 * r, "r {r}: {a:?}");
                }
            }
        }
        // A position's anchors are adjacent, finest first.
        let at_500: Vec<&LineAnchor> = banded.iter().filter(|a| a.s == 500.0).collect();
        assert!(
            at_500
                .windows(2)
                .all(|w| w[0].max_spacing == w[1].min_spacing)
        );
        assert_eq!(at_500.last().unwrap().max_spacing, f64::INFINITY);
    }

    #[test]
    fn line_center_and_short_lines_keep_their_midpoint() {
        let verts = line_1000();
        let path = LinePath::new(&verts).unwrap();
        let center = path.anchors(PointPlacement::LineCenter, 100.0, false);
        assert_eq!(center.len(), 1);
        assert_eq!((center[0].s, center[0].min_spacing), (500.0, 0.0));
        assert_eq!(center[0].max_spacing, f64::INFINITY);
        // Banded, it is a stack at the midpoint, each level's path its own.
        let stack = path.anchors(PointPlacement::LineCenter, 100.0, true);
        assert!(stack.len() > 1 && stack.iter().all(|a| a.s == 500.0));

        // Shorter than one interval: one anchor at the midpoint, not none.
        let short = path.anchors(PointPlacement::Line, 5000.0, false);
        assert_eq!(shown(&short, 1.0), vec![500.0]);
        assert_eq!(shown(&short, 1e9), vec![500.0]);
    }

    #[test]
    fn invalid_spacing_gives_one_anchor_rather_than_unbounded_many() {
        let verts = line_1000();
        let path = LinePath::new(&verts).unwrap();
        for spacing in [0.0, -5.0, f64::NAN, f64::INFINITY] {
            let anchors = path.anchors(PointPlacement::Line, spacing, true);
            assert_eq!(anchors.len(), 1, "spacing {spacing}");
            assert_eq!(anchors[0].s, 500.0, "spacing {spacing}");
            assert_eq!(anchors[0].scale_band(1.0, spacing), ALWAYS_SHOWN);
            let p = path.anchor_path(500.0, anchors[0].path_spacing, 1.0);
            assert!(
                p.meta[0].is_finite() && p.meta[0] > 0.0,
                "spacing {spacing}"
            );
            assert!(p.samples.iter().all(|v| v.is_finite()), "spacing {spacing}");
        }
        // Valid but absurdly dense: capped, and still spread over the line.
        let dense = path.anchors(PointPlacement::Line, 1e-12, false);
        assert!(dense.len() <= MAX_ANCHORS_PER_LINE as usize + 1);
        assert!(dense.last().unwrap().s > 999.0);
    }

    #[test]
    fn scale_bands_are_ground_metres_per_pixel() {
        let a = LineAnchor {
            s: 0.0,
            min_spacing: 100.0,
            max_spacing: 200.0,
            path_spacing: 200.0,
        };
        // 2 m per unit, 50 px apart: 200 m .. 400 m, so 4 .. 8 m per pixel.
        assert_eq!(a.scale_band(2.0, 50.0), [4.0, 8.0]);
    }

    #[test]
    fn a_repeated_first_vertex_does_not_bend_the_start() {
        // The line runs due south (+y) but opens with a duplicate vertex. The
        // extrapolation before its start has to continue that direction, not
        // fall back to east for the zero-length first segment.
        let verts = [(0.0, 0.0), (0.0, 0.0), (0.0, 100.0)];
        let path = LinePath::new(&verts).unwrap();
        let (pos, tangent) = path.sample(-10.0);
        assert_eq!(tangent, (0.0, 1.0));
        assert!((pos.0 - 0.0).abs() < 1e-12 && (pos.1 + 10.0).abs() < 1e-12);
        assert_eq!(path.segment_at(0.0), (1, 0.0));
    }

    #[test]
    fn segment_at_skips_duplicates_anywhere_in_the_line() {
        // Duplicates in the middle and at the end, too: every query lands on a
        // segment with length, and the binary search agrees with the old scan.
        let verts = [
            (0.0, 0.0),
            (0.0, 0.0),
            (10.0, 0.0),
            (10.0, 0.0),
            (10.0, 10.0),
            (10.0, 10.0),
        ];
        let path = LinePath::new(&verts).unwrap();
        for s in [-1.0, 0.0, 5.0, 10.0, 15.0, 20.0, 25.0] {
            let (seg, _) = path.segment_at(s);
            let (a, b) = (verts[seg], verts[seg + 1]);
            assert!(a != b, "s {s} landed on zero-length segment {seg}");
        }
        assert_eq!(path.segment_at(10.0), (1, 1.0));
        assert_eq!(path.segment_at(20.0), (3, 1.0));
    }

    #[test]
    fn mixed_groups_keep_one_entry_per_point() {
        // native, anchor, native: the leading native point is backfilled when
        // the anchor arrives, the trailing one padded as it is pushed.
        let (mut b, mut z, mut s, mut m) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let anchor = AlongLine {
            bearing: 90.0,
            scale_band: [1.0, 2.0],
            path: Some(AnchorPath {
                samples: vec![1.0; PATH_SAMPLES * 2],
                meta: [2.0, 3.0],
            }),
        };
        push_anchor_line_data(0, &mut b, &mut z, &mut s, &mut m, None);
        assert!(
            b.is_empty() && z.is_empty() && m.is_empty(),
            "no line data until an anchor needs it"
        );
        push_anchor_line_data(1, &mut b, &mut z, &mut s, &mut m, Some(anchor));
        push_anchor_line_data(2, &mut b, &mut z, &mut s, &mut m, None);

        assert_eq!(b, vec![0.0, 90.0, 0.0]);
        let inf = f32::INFINITY;
        assert_eq!(z, vec![0.0, inf, 1.0, 2.0, 0.0, inf]);
        assert_eq!(s.len(), 3 * PATH_SAMPLES * 2);
        assert_eq!(m, vec![0.0, 0.0, 2.0, 3.0, 0.0, 0.0]);
        assert!(
            s[PATH_SAMPLES * 2..PATH_SAMPLES * 4]
                .iter()
                .all(|&v| v == 1.0)
        );

        // A sprite group carries bearings and bands but never paths.
        let (mut b, mut z, mut s, mut m) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let sprite = AlongLine {
            bearing: 45.0,
            scale_band: [0.0, 5.0],
            path: None,
        };
        push_anchor_line_data(0, &mut b, &mut z, &mut s, &mut m, Some(sprite));
        push_anchor_line_data(1, &mut b, &mut z, &mut s, &mut m, None);
        assert_eq!(b, vec![45.0, 0.0]);
        assert_eq!(z, vec![0.0, 5.0, 0.0, inf]);
        assert!(s.is_empty() && m.is_empty());
    }

    #[test]
    fn bearings_are_clockwise_from_north() {
        assert!((tangent_to_bearing((0.0, -1.0)) - 0.0).abs() < 1e-5);
        assert!((tangent_to_bearing((1.0, 0.0)) - 90.0).abs() < 1e-5);
        assert!((tangent_to_bearing((0.0, 1.0)) - 180.0).abs() < 1e-5);
    }

    /// Straight-line distance between neighbouring path samples.
    fn chords(p: &AnchorPath) -> Vec<f64> {
        p.samples
            .chunks(2)
            .collect::<Vec<_>>()
            .windows(2)
            .map(|w| ((w[1][0] - w[0][0]) as f64).hypot((w[1][1] - w[0][1]) as f64))
            .collect()
    }

    #[test]
    fn anchor_path_samples_are_a_step_apart_in_a_straight_line() {
        // A right-angle bend next to the anchor, plus extrapolation past both
        // ends: every chord is still exactly one step, which is what the
        // shader's `floor(s / step)` walk assumes.
        let verts = [(0.0, 0.0), (100.0, 0.0), (100.0, 37.0), (100.0, 100.0)];
        let path = LinePath::new(&verts).unwrap();
        let p = path.anchor_path(97.0, 40.0, 1.0);
        let step = p.meta[0] as f64;
        for (k, c) in chords(&p).iter().enumerate() {
            assert!((c - step).abs() < 1e-3, "chord {k}: {c} vs {step}");
        }

        // On a straight line chords and arcs agree: samples sit at
        // (k - 15.5) steps either side of the anchor, as before.
        let verts = line_1000();
        let path = LinePath::new(&verts).unwrap();
        let p = path.anchor_path(500.0, 100.0, 1.0);
        let step = p.meta[0] as f64;
        for k in 0..PATH_SAMPLES {
            let expected = (k as f64 - (PATH_SAMPLES - 1) as f64 * 0.5) * step;
            assert!((p.samples[k * 2] as f64 - expected).abs() < 1e-3, "{k}");
            assert_eq!(p.samples[k * 2 + 1], 0.0);
        }
    }

    #[test]
    fn anchor_path_scales_to_metres() {
        let verts = [(0.0, 0.0), (1000.0, 0.0)];
        let path = LinePath::new(&verts).unwrap();
        let p = path.anchor_path(500.0, 100.0, 2.0);
        assert_eq!(p.samples.len(), PATH_SAMPLES * 2);
        let step = (100.0 * PATH_SPAN_SPACINGS / (PATH_SAMPLES - 1) as f64 * 2.0) as f32;
        assert!((p.meta[0] - step).abs() < 1e-4);
        // 500 frame units either side at 2 m each.
        assert!((p.meta[1] - 1000.0).abs() < 1e-3);
    }
}
