use navara_buffer_store::{BufferStore, Handle};
use navara_math::{Vec2, Vec3};

#[derive(Debug)]
pub struct Polygon {
    pub positions: Vec<Vec3>,
    pub hole_indices: Vec<u32>,
    pub positions_2d: Vec<Vec2>,
}

#[derive(Default, Debug, PartialEq, Copy, Clone)]
pub enum WindingOrder {
    #[default]
    Unknown,
    Clockwise,
    CounterClockwise,
}

/// What the bottom of an extruded polygon follows when the polygon keeps the
/// height of each position. Without per-position heights the positions lie on
/// the ellipsoid, so both give the same polygon.
#[derive(Default, Debug, PartialEq, Eq, Copy, Clone)]
pub enum ExtrusionBase {
    /// Both caps follow the positions: the bottom is offset from them by
    /// `height`, the top by `height` + `extruded_height`.
    #[default]
    Position,
    /// The bottom lies flat on the ellipsoid, offset by `height`, and the top
    /// is offset from the positions by `extruded_height`.
    Ellipsoid,
}

impl ExtrusionBase {
    /// Parse the JS-facing name (`"position" | "ellipsoid"`).
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "position" => Some(Self::Position),
            "ellipsoid" => Some(Self::Ellipsoid),
            _ => None,
        }
    }

    /// JS-facing name of this base.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Position => "position",
            Self::Ellipsoid => "ellipsoid",
        }
    }
}

/// Offsets of the bottom and the top cap of an unclamped polygon along the up
/// vector, from the bases the geometry places them on. The top is raised by
/// `height` only when both caps share a base.
pub fn polygon_cap_offsets(
    height: f64,
    extruded_height: f64,
    per_position_height: bool,
    extrusion_base: ExtrusionBase,
) -> (f64, f64) {
    let caps_apart = per_position_height && extrusion_base == ExtrusionBase::Ellipsoid;
    let top = if caps_apart {
        extruded_height
    } else {
        height + extruded_height
    };
    (height, top)
}

#[derive(Default, Debug)]
pub struct HierarchyDVec3 {
    pub outer_ring: Vec<Vec3>,
    pub holes: Option<Vec<HierarchyDVec3>>,
    pub expected_winding_order: WindingOrder, // for outer ring
}

impl HierarchyDVec3 {
    /// Aligns rings given on a plane, judging the winding as seen from +Z.
    pub fn align_winding_order(&mut self) {
        self.align_winding_order_facing(Vec3::Z);
    }

    /// Aligns rings given in ECEF, judging the winding as seen from above the
    /// ring. Seen from +Z instead, a ring south of the equator is mirrored.
    pub fn align_winding_order_on_globe(&mut self) {
        let up = self
            .outer_ring
            .iter()
            .fold(Vec3::ZERO, |sum, p| sum + *p)
            .normalize();
        self.align_winding_order_facing(up);
    }

    fn align_winding_order_facing(&mut self, up: Vec3) {
        match self.expected_winding_order {
            // If the polygon's orientation is unknown,
            // all outer rings and inner rings need to be checked,
            // adjusting the outer rings to CounterClockwise and the inner rings to Clockwise.
            WindingOrder::Unknown => {
                self.expected_winding_order = check_winding_order_dvec3(&self.outer_ring, up);
                if self.expected_winding_order == WindingOrder::Clockwise {
                    self.outer_ring.reverse();
                    self.expected_winding_order = WindingOrder::CounterClockwise;
                }

                if let Some(holes) = self.holes.as_mut() {
                    for hole in holes.iter_mut() {
                        hole.expected_winding_order =
                            check_winding_order_dvec3(&hole.outer_ring, up);
                        if hole.expected_winding_order == WindingOrder::CounterClockwise {
                            hole.outer_ring.reverse();
                            hole.expected_winding_order = WindingOrder::Clockwise;
                        }
                    }
                }
            }
            WindingOrder::Clockwise => {
                self.outer_ring.reverse();
                self.expected_winding_order = WindingOrder::CounterClockwise;

                if let Some(holes) = self.holes.as_mut() {
                    for hole in holes.iter_mut() {
                        hole.outer_ring.reverse();
                        hole.expected_winding_order = WindingOrder::Clockwise;
                    }
                }
            }
            // In the MVT spec, it is mentioned that the outer ring of a polygon is clockwise,
            // which is based on the origin being at the top-left.
            WindingOrder::CounterClockwise => {}
        }
    }
}

#[derive(Default, Debug, Clone, PartialEq)]
pub struct Hierarchy {
    pub outer_ring: Vec<f64>,
    pub holes: Option<Vec<Hierarchy>>,
    pub expected_winding_order: WindingOrder, // for outer ring
}

impl Hierarchy {
    pub fn from_transferred(value: &TransferableHierarchy, buf: &mut BufferStore) -> Option<Self> {
        let holes = match &value.holes {
            Some(h_holes) => {
                let mut holes = vec![];
                for hole in h_holes {
                    let outer_ring = buf.remove_f64(&hole.outer_ring)?;

                    holes.push(Hierarchy {
                        outer_ring,
                        holes: None,
                        expected_winding_order: hole.expected_winding_order,
                    });
                }
                Some(holes)
            }
            None => None,
        };

        let outer_ring = buf.remove_f64(&value.outer_ring)?;
        Some(Hierarchy {
            outer_ring,
            holes,
            expected_winding_order: value.expected_winding_order,
        })
    }

    pub fn from_transferred_cloned(
        value: &TransferableHierarchy,
        buf: &BufferStore,
    ) -> Option<Self> {
        let outer_ring = buf.get_f64(&value.outer_ring)?;

        let holes = match &value.holes {
            Some(h_holes) => {
                let mut holes = vec![];
                for hole in h_holes {
                    let outer_ring = buf.get_f64(&hole.outer_ring)?;

                    holes.push(Hierarchy {
                        outer_ring: outer_ring.to_vec(),
                        holes: None,
                        expected_winding_order: hole.expected_winding_order,
                    });
                }
                Some(holes)
            }
            None => None,
        };
        Some(Hierarchy {
            outer_ring: outer_ring.to_vec(),
            holes,
            expected_winding_order: value.expected_winding_order,
        })
    }

    pub fn transfer(self, buf: &mut BufferStore) -> TransferableHierarchy {
        let outer_ring = buf.new_f64(self.outer_ring);
        let holes = match self.holes {
            Some(h_holes) => {
                let mut holes = vec![];
                for hole in h_holes {
                    let outer_ring = buf.new_f64(hole.outer_ring);
                    holes.push(TransferableHierarchy {
                        outer_ring,
                        holes: None,
                        expected_winding_order: hole.expected_winding_order,
                    });
                }
                Some(holes)
            }
            None => None,
        };

        TransferableHierarchy {
            outer_ring,
            holes,
            expected_winding_order: self.expected_winding_order,
        }
    }
}

// Use the area method to determine the orientation of a polygon.
// ref: https://github.com/CesiumGS/cesium/blob/91821cc54d274ad7a28ecc164a4c5c867849e111/packages/engine/Source/Core/PolygonPipeline.js#L56
/// `up` is the side the ring is viewed from; the area is the Newell vector
/// area projected onto it, so `Vec3::Z` gives the plain XY shoelace area.
fn check_winding_order_dvec3(positions: &[Vec3], up: Vec3) -> WindingOrder {
    let length = positions.len();
    if length < 3 {
        return WindingOrder::Unknown;
    }

    let mut vector_area = Vec3::ZERO;
    for i in 0..length {
        let i0 = if i == 0 { length - 1 } else { i - 1 };
        vector_area += positions[i0].cross(positions[i]);
    }
    let area = vector_area.dot(up) * 0.5;

    if area > 0.0 {
        WindingOrder::CounterClockwise
    } else if area < 0.0 {
        WindingOrder::Clockwise
    } else {
        WindingOrder::Unknown
    }
}

#[derive(Debug, Clone)]
pub struct TransferableHierarchy {
    pub outer_ring: Handle,
    pub holes: Option<Vec<TransferableHierarchy>>,
    pub expected_winding_order: WindingOrder,
}

impl TransferableHierarchy {
    /// Removes all buffer handles from BufferStore recursively.
    /// Must be called before despawning the entity to avoid memory leaks.
    pub fn remove_from_buf(&self, buf: &mut BufferStore) {
        buf.remove(&self.outer_ring);
        if let Some(holes) = &self.holes {
            for hole in holes {
                hole.remove_from_buf(buf);
            }
        }
    }
}

#[cfg(test)]
mod test {
    use navara_math::Vec3;

    use crate::WindingOrder;

    use super::{ExtrusionBase, check_winding_order_dvec3, polygon_cap_offsets};

    #[test]
    fn top_is_raised_by_the_bottom_height_when_both_caps_share_a_base() {
        for (per_position_height, base) in [
            (false, ExtrusionBase::Ellipsoid),
            (true, ExtrusionBase::Position),
        ] {
            assert_eq!(
                polygon_cap_offsets(5., 20., per_position_height, base),
                (5., 25.)
            );
        }
    }

    #[test]
    fn top_keeps_its_own_offset_when_the_caps_have_different_bases() {
        assert_eq!(
            polygon_cap_offsets(5., 20., true, ExtrusionBase::Ellipsoid),
            (5., 20.)
        );
    }

    #[test]
    fn it_should_compute_counter_clockwise() {
        #[rustfmt::skip]
        assert!(matches!(
            check_winding_order_dvec3(&[
                Vec3::new(0., 0., 0.),
                Vec3::new(2., 0., 0.),
                Vec3::new(2., 1., 0.),
                Vec3::new(0., 1., 0.),
            ], Vec3::Z),
            WindingOrder::CounterClockwise
        ));
    }

    #[test]
    fn it_should_judge_globe_rings_from_above_in_both_hemispheres() {
        use navara_core::{CRS, WGS84_64};

        use crate::HierarchyDVec3;

        // Counter-clockwise seen from above: east, then north.
        let ring = |lat: f64| -> Vec<Vec3> {
            [(0., 0.), (10., 0.), (10., 10.), (0., 10.)]
                .iter()
                .map(|(lng, dlat)| {
                    CRS::Geographic.to_vec3(WGS84_64, Vec3::new(*lng, lat + dlat, 0.), 0.)
                })
                .collect()
        };
        for lat in [20., -40.] {
            let original = ring(lat);
            let mut hierarchy = HierarchyDVec3 {
                outer_ring: original.clone(),
                ..Default::default()
            };
            hierarchy.align_winding_order_on_globe();
            assert_eq!(hierarchy.outer_ring, original, "lat {lat}");
        }
    }

    #[test]
    fn it_should_compute_clockwise() {
        #[rustfmt::skip]
        assert!(matches!(
            check_winding_order_dvec3(&[
                Vec3::new(0., 0., 0.),
                Vec3::new(0., 2., 0.),
                Vec3::new(1., 2., 0.),
                Vec3::new(1., 0., 0.),
            ], Vec3::Z),
            WindingOrder::Clockwise
        ));
    }
}
