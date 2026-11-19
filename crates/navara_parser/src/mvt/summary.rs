//! Per-feature id and geometry summary, computed while an MVT feature is walked.

use navara_core::WGS84_A_64;

use super::pos_converter::PosConverter;

/// An MVT feature's id and a summary of its geometry in one tile.
///
/// MVT clips geometry to the tile and its buffer, so a feature crossing a tile
/// edge is summarized once per tile, from the part that tile holds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FeatureSummary {
    /// The MVT feature id; `None` when the feature has none.
    pub id: Option<u64>,
    /// `[west, south, east, north]` in degrees.
    pub bbox: [f64; 4],
    /// `[lng, lat]` in degrees: the area-weighted centroid of a polygon, the
    /// length-weighted centroid of a line, the mean of points. Computed in Web
    /// Mercator, and outside a concave polygon when its shape puts it there.
    pub centroid: [f64; 2],
    pub shape: FeatureShape,
}

/// The MVT geometry type of a feature, with its measure.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FeatureShape {
    Point,
    /// `length` in metres.
    LineString {
        length: f64,
    },
    /// `area` in square metres, holes excluded.
    Polygon {
        area: f64,
    },
}

impl FeatureShape {
    /// Stable numeric tag for crossing the Web Worker and WASM boundaries.
    pub fn tag(self) -> u8 {
        match self {
            FeatureShape::Point => 0,
            FeatureShape::LineString { .. } => 1,
            FeatureShape::Polygon { .. } => 2,
        }
    }

    /// The length or area; 0 for points.
    pub fn measure(self) -> f64 {
        match self {
            FeatureShape::Point => 0.0,
            FeatureShape::LineString { length } => length,
            FeatureShape::Polygon { area } => area,
        }
    }

    /// Inverse of [`Self::tag`] and [`Self::measure`]; `None` for unknown tags.
    pub fn from_tag(tag: u8, measure: f64) -> Option<Self> {
        match tag {
            0 => Some(FeatureShape::Point),
            1 => Some(FeatureShape::LineString { length: measure }),
            2 => Some(FeatureShape::Polygon { area: measure }),
            _ => None,
        }
    }
}

/// Number of f64s one summary takes in [`FeatureSummary::write_f64s`].
pub const SUMMARY_F64_STRIDE: usize = 7;

impl FeatureSummary {
    /// Append `bbox`, `centroid` and the shape's measure.
    pub fn write_f64s(&self, out: &mut Vec<f64>) {
        out.extend_from_slice(&self.bbox);
        out.extend_from_slice(&self.centroid);
        out.push(self.shape.measure());
    }

    /// Rebuild from [`Self::write_f64s`] output, the id, and the shape tag.
    pub fn from_parts(f64s: &[f64; SUMMARY_F64_STRIDE], id: Option<u64>, tag: u8) -> Option<Self> {
        let [w, s, e, n, cx, cy, measure] = *f64s;
        Some(Self {
            id,
            bbox: [w, s, e, n],
            centroid: [cx, cy],
            shape: FeatureShape::from_tag(tag, measure)?,
        })
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Point,
    Line,
    Polygon,
}

/// Streams one feature's tile coordinates into its [`FeatureSummary`].
///
/// Polygon area is spherical (the Chamberlain–Duquette ring formula `turf`
/// uses), so it stays right on low-zoom tiles spanning many degrees of
/// latitude. Line length scales each Web Mercator segment by the cosine of its
/// mid latitude.
pub(crate) struct SummaryAccum {
    kind: Option<Kind>,
    min: [f64; 2],
    max: [f64; 2],
    /// Previous vertex of the current ring or line: tile x, tile y, and
    /// `sin(lat)` (polygons) or the Web Mercator `t` (lines).
    prev: Option<[f64; 3]>,
    ring_index: usize,
    /// Current ring: twice its planar signed area, its centroid moments, and
    /// its spherical sum `Σ Δx·(sin φᵢ + sin φⱼ)`.
    ring_cross: f64,
    ring_mx: f64,
    ring_my: f64,
    ring_sphere: f64,
    /// Feature totals: weight and moments of the centroid, and the measure in
    /// tile-derived units (see [`Self::finish`]).
    weight: f64,
    mx: f64,
    my: f64,
    measure: f64,
}

impl SummaryAccum {
    pub(crate) fn new() -> Self {
        Self {
            kind: None,
            min: [f64::INFINITY; 2],
            max: [f64::NEG_INFINITY; 2],
            prev: None,
            ring_index: 0,
            ring_cross: 0.0,
            ring_mx: 0.0,
            ring_my: 0.0,
            ring_sphere: 0.0,
            weight: 0.0,
            mx: 0.0,
            my: 0.0,
            measure: 0.0,
        }
    }

    pub(crate) fn begin_point(&mut self) {
        self.kind = Some(Kind::Point);
    }

    pub(crate) fn begin_polygon(&mut self) {
        self.kind = Some(Kind::Polygon);
        self.ring_index = 0;
    }

    /// Start a ring (inside a polygon) or a line string.
    pub(crate) fn begin_linestring(&mut self) {
        if self.kind != Some(Kind::Polygon) {
            self.kind = Some(Kind::Line);
        }
        self.prev = None;
        self.ring_cross = 0.0;
        self.ring_mx = 0.0;
        self.ring_my = 0.0;
        self.ring_sphere = 0.0;
    }

    pub(crate) fn coordinate(&mut self, converter: &PosConverter, x: f64, y: f64) {
        self.min = [self.min[0].min(x), self.min[1].min(y)];
        self.max = [self.max[0].max(x), self.max[1].max(y)];
        match self.kind {
            Some(Kind::Point) | None => {
                self.weight += 1.0;
                self.mx += x;
                self.my += y;
            }
            Some(Kind::Polygon) => {
                let sin_lat = converter.mercator_t(y).tanh();
                if let Some([px, py, p_sin]) = self.prev {
                    let cross = px * y - x * py;
                    self.ring_cross += cross;
                    self.ring_mx += (px + x) * cross;
                    self.ring_my += (py + y) * cross;
                    self.ring_sphere += (x - px) * (p_sin + sin_lat);
                }
                self.prev = Some([x, y, sin_lat]);
            }
            Some(Kind::Line) => {
                let t = converter.mercator_t(y);
                if let Some([px, py, pt]) = self.prev {
                    let len = (x - px).hypot(y - py);
                    // cos(lat) = sech(t) at the segment's mid latitude.
                    self.measure += len / ((pt + t) * 0.5).cosh();
                    self.weight += len;
                    self.mx += (px + x) * 0.5 * len;
                    self.my += (py + y) * 0.5 * len;
                }
                self.prev = Some([x, y, t]);
            }
        }
    }

    /// Close a ring (inside a polygon). The first ring of each polygon is its
    /// exterior, the rest are holes, whatever their winding.
    pub(crate) fn end_ring(&mut self) {
        let sign = if self.ring_index == 0 { 1.0 } else { -1.0 };
        let orient = sign * self.ring_cross.signum();
        self.weight += orient * self.ring_cross;
        self.mx += orient * self.ring_mx;
        self.my += orient * self.ring_my;
        self.measure += sign * self.ring_sphere.abs();
        self.ring_index += 1;
    }

    /// The summary of the walked feature. Only a feature that emitted
    /// geometry is summarized, so it has a kind and a coordinate.
    pub(crate) fn finish(&self, converter: &PosConverter, id: Option<u64>) -> FeatureSummary {
        debug_assert!(self.kind.is_some() && self.min[0].is_finite());
        let kind = self.kind.unwrap_or(Kind::Point);
        let (west, north) = converter.project_point(self.min[0], self.min[1]);
        let (east, south) = converter.project_point(self.max[0], self.max[1]);

        let units_to_m = converter.ground_meters_per_unit(0.0);
        let (shape, moment_scale) = match kind {
            Kind::Point => (FeatureShape::Point, 1.0),
            Kind::Line => (
                FeatureShape::LineString {
                    length: self.measure * units_to_m,
                },
                1.0,
            ),
            Kind::Polygon => {
                // Σ (λⱼ − λᵢ)(sin φᵢ + sin φⱼ) · R² / 2, where a tile unit
                // spans 2π / size = units_to_m / R radians of longitude.
                let area = self.measure * units_to_m * WGS84_A_64 / 2.0;
                (
                    FeatureShape::Polygon {
                        area: area.max(0.0),
                    },
                    3.0,
                )
            }
        };
        let (cx, cy) = if self.weight > 0.0 {
            let w = self.weight * moment_scale;
            (self.mx / w, self.my / w)
        } else {
            (
                (self.min[0] + self.max[0]) * 0.5,
                (self.min[1] + self.max[1]) * 0.5,
            )
        };
        let (lng, lat) = converter.project_point(cx, cy);

        FeatureSummary {
            id,
            bbox: [west, south, east, north],
            centroid: [lng, lat],
            shape,
        }
    }
}

#[cfg(test)]
mod test {
    use navara_core::TileXYZ;

    use super::*;

    fn walk_polygon(acc: &mut SummaryAccum, conv: &PosConverter, rings: &[&[(f64, f64)]]) {
        acc.begin_polygon();
        for ring in rings {
            acc.begin_linestring();
            for &(x, y) in ring.iter().chain(ring.first()) {
                acc.coordinate(conv, x, y);
            }
            acc.end_ring();
        }
    }

    fn rel_eq(a: f64, b: f64, tol: f64) -> bool {
        ((a - b) / b).abs() < tol
    }

    #[test]
    fn square_area_matches_spherical_reference() {
        // Tile 14/14552/6451 (Tokyo), a 400×400-unit square of a 4096 extent.
        let conv = PosConverter::new(
            TileXYZ {
                x: 14552,
                y: 6451,
                z: 14,
            },
            4096,
        );
        let mut acc = SummaryAccum::new();
        let ring = [
            (100.0, 100.0),
            (500.0, 100.0),
            (500.0, 500.0),
            (100.0, 500.0),
        ];
        walk_polygon(&mut acc, &conv, &[&ring]);
        let s = acc.finish(&conv, Some(7));

        let [w, so, e, n] = s.bbox;
        let r = WGS84_A_64;
        let expected =
            r * r * (e - w).to_radians() * (n.to_radians().sin() - so.to_radians().sin()).abs();
        let FeatureShape::Polygon { area } = s.shape else {
            panic!("expected polygon, got {:?}", s.shape);
        };
        assert!(rel_eq(area, expected, 1e-9), "area {area} vs {expected}");
        assert_eq!(s.id, Some(7));
        assert!(w < e && so < n);
        assert!(s.centroid[0] > w && s.centroid[0] < e);
        assert!(s.centroid[1] > so && s.centroid[1] < n);
    }

    #[test]
    fn hole_is_subtracted_and_winding_is_ignored() {
        let conv = PosConverter::new(TileXYZ { x: 0, y: 0, z: 0 }, 4096);
        let outer = [
            (1000.0, 1000.0),
            (3000.0, 1000.0),
            (3000.0, 3000.0),
            (1000.0, 3000.0),
        ];
        let hole = [
            (1500.0, 1500.0),
            (2500.0, 1500.0),
            (2500.0, 2500.0),
            (1500.0, 2500.0),
        ];
        let hole_reversed: Vec<_> = hole.iter().rev().copied().collect();

        let area_of = |rings: &[&[(f64, f64)]]| {
            let mut acc = SummaryAccum::new();
            walk_polygon(&mut acc, &conv, rings);
            acc.finish(&conv, None).shape.measure()
        };
        let solid = area_of(&[&outer]);
        let hole_area = area_of(&[&hole]);
        let with_hole = area_of(&[&outer, &hole]);
        assert!(rel_eq(with_hole, solid - hole_area, 1e-9));
        assert!(rel_eq(area_of(&[&outer, &hole_reversed]), with_hole, 1e-9));
    }

    #[test]
    fn multipolygon_sums_its_polygons_and_centers_between_them() {
        let conv = PosConverter::new(TileXYZ { x: 0, y: 0, z: 0 }, 4096);
        let a = [
            (100.0, 2000.0),
            (300.0, 2000.0),
            (300.0, 2200.0),
            (100.0, 2200.0),
        ];
        let b = [
            (3796.0, 2000.0),
            (3996.0, 2000.0),
            (3996.0, 2200.0),
            (3796.0, 2200.0),
        ];
        let mut acc = SummaryAccum::new();
        walk_polygon(&mut acc, &conv, &[&a]);
        walk_polygon(&mut acc, &conv, &[&b]);
        let s = acc.finish(&conv, None);
        // Symmetric about the tile's center meridian.
        assert!(s.centroid[0].abs() < 1e-9, "centroid {:?}", s.centroid);
        let single = {
            let mut acc = SummaryAccum::new();
            walk_polygon(&mut acc, &conv, &[&a]);
            acc.finish(&conv, None).shape.measure()
        };
        assert!(rel_eq(s.shape.measure(), 2.0 * single, 1e-9));
    }

    #[test]
    fn line_length_matches_ground_distance() {
        let conv = PosConverter::new(
            TileXYZ {
                x: 14552,
                y: 6451,
                z: 14,
            },
            4096,
        );
        let mut acc = SummaryAccum::new();
        acc.begin_linestring();
        acc.coordinate(&conv, 0.0, 2048.0);
        acc.coordinate(&conv, 4096.0, 2048.0);
        let s = acc.finish(&conv, None);
        let lat = s.centroid[1];
        let expected = conv.ground_meters_per_unit(lat) * 4096.0;
        let FeatureShape::LineString { length } = s.shape else {
            panic!("expected line, got {:?}", s.shape);
        };
        assert!(
            rel_eq(length, expected, 1e-9),
            "length {length} vs {expected}"
        );
    }

    #[test]
    fn points_center_on_their_mean() {
        let conv = PosConverter::new(TileXYZ { x: 0, y: 0, z: 0 }, 4096);
        let mut acc = SummaryAccum::new();
        acc.begin_point();
        acc.coordinate(&conv, 1024.0, 2048.0);
        acc.coordinate(&conv, 3072.0, 2048.0);
        let s = acc.finish(&conv, None);
        assert_eq!(s.shape, FeatureShape::Point);
        assert!(s.centroid[0].abs() < 1e-9 && s.centroid[1].abs() < 1e-9);
        let expected = [-90.0, 0.0, 90.0, 0.0];
        for (got, want) in s.bbox.iter().zip(expected) {
            assert!((got - want).abs() < 1e-9, "bbox {:?}", s.bbox);
        }
    }
}
