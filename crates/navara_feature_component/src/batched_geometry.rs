use bevy_ecs::component::Component;
use navara_buffer_store::{BufferStore, Handle};
use navara_core::CRS;
use navara_geometry::WindingOrder;
use navara_math::{Transform, Vec3};

// ── Builder-side types (Vec-based, used during accumulation) ─────────

/// Pre-encoded point positions, ready for GPU transfer.
///
/// Computed once at geometry construction time so `transfer_batched_mesh`
/// can move the data out in O(1) without per-coordinate CRS conversion.
///
/// This is a **builder-side** type used during accumulation.
/// At finalize time it is converted into BufferStore handles.
#[derive(Default)]
pub enum EncodedPointPositions {
    /// MVT path: f32 positions relative to tile center.
    Rtc { coords: Vec<f32>, center: Vec3 },
    /// GeoJSON path: high/low f32 encoded for globe-scale precision.
    Rte { high: Vec<f32>, low: Vec<f32> },
    /// Not yet encoded (default state after `std::mem::take`).
    #[default]
    Empty,
}

impl EncodedPointPositions {
    /// Push pre-computed RTC position (3 f32s relative to center).
    pub fn push_rtc(&mut self, x: f32, y: f32, z: f32, center: Vec3) {
        match self {
            Self::Rtc { coords, .. } => {
                coords.push(x);
                coords.push(y);
                coords.push(z);
            }
            Self::Empty => {
                *self = Self::Rtc {
                    coords: vec![x, y, z],
                    center,
                };
            }
            _ => unreachable!("mixing Rtc push into Rte buffer"),
        }
    }

    /// Push pre-computed RTE position (high + low f32 triplets).
    pub fn push_rte(&mut self, high: [f32; 3], low: [f32; 3]) {
        match self {
            Self::Rte {
                high: h, low: l, ..
            } => {
                h.extend_from_slice(&high);
                l.extend_from_slice(&low);
            }
            Self::Empty => {
                *self = Self::Rte {
                    high: high.to_vec(),
                    low: low.to_vec(),
                };
            }
            _ => unreachable!("mixing Rte push into Rtc buffer"),
        }
    }

    /// Store the encoded data into BufferStore and return handle-based fields.
    fn into_handles(self, buf: &mut BufferStore) -> (PointEncoding, Handle, Option<Handle>) {
        match self {
            Self::Rtc { coords, .. } => {
                let handle = buf.new_f32(coords);
                (PointEncoding::Rtc, handle, None)
            }
            Self::Rte { high, low } => {
                let h = buf.new_f32(high);
                let l = buf.new_f32(low);
                (PointEncoding::Rte, h, Some(l))
            }
            Self::Empty => unreachable!("into_handles called on empty EncodedPointPositions"),
        }
    }
}

/// Builder-side accumulator for point geometry (Vec-based).
///
/// Used by `GeometryGroups` during accumulation, then converted
/// to `BatchedPointGeometry` (handle-based component) at finalize time.
pub struct PointGeometryAccumulator {
    pub coords: Vec<Vec3>,
    pub crs: CRS,
    pub batch_indices: Vec<u32>,
    pub encoded: EncodedPointPositions,
    pub batch_ids: Vec<f32>,
    pub transform: Transform,
}

impl PointGeometryAccumulator {
    pub fn new(crs: CRS) -> Self {
        Self {
            coords: Vec::new(),
            crs,
            batch_indices: Vec::new(),
            encoded: EncodedPointPositions::Empty,
            batch_ids: Vec::new(),
            transform: Transform::default(),
        }
    }

    /// Convert to a handle-based component, storing Vec data in BufferStore.
    pub fn into_component(self, buf: &mut BufferStore) -> BatchedPointGeometry {
        let batch_indices = buf.new_u32(self.batch_indices);
        let batch_ids = buf.new_f32(self.batch_ids);
        let (encoding, encoded_a, encoded_b) = self.encoded.into_handles(buf);
        BatchedPointGeometry {
            coords: self.coords,
            crs: self.crs,
            transform: self.transform,
            batch_indices,
            batch_ids,
            encoding,
            encoded_a,
            encoded_b,
        }
    }
}

/// Builder-side accumulator for polyline geometry (Vec-based).
///
/// Used by `GeometryGroups` during accumulation, then converted
/// to `BatchedPolylineGeometry` (handle-based component) at finalize time.
pub struct PolylineGeometryAccumulator {
    pub points: Vec<f64>,
    pub points_sizes: Vec<u32>,
    pub batch_indices: Vec<u32>,
    /// Per polyline, whether it is a polygon ring (1) or an open line (0).
    /// A ring's repeated first vertex is a seam to join; an open line keeps its
    /// end caps even when its endpoints coincide.
    pub ring_flags: Vec<u8>,
    pub crs: CRS,
}

impl PolylineGeometryAccumulator {
    pub fn new(crs: CRS) -> Self {
        Self {
            points: Vec::new(),
            points_sizes: Vec::new(),
            batch_indices: Vec::new(),
            ring_flags: Vec::new(),
            crs,
        }
    }

    /// Convert to a handle-based component, storing Vec data in BufferStore.
    pub fn into_component(self, buf: &mut BufferStore) -> BatchedPolylineGeometry {
        BatchedPolylineGeometry {
            points: buf.new_f64(self.points),
            points_sizes: buf.new_u32(self.points_sizes),
            batch_indices: buf.new_u32(self.batch_indices),
            ring_flags: buf.new_u8(self.ring_flags),
            crs: self.crs,
        }
    }
}

/// Builder-side accumulator for polygon geometry (Vec-based).
///
/// Used by `GeometryGroups` during accumulation, then converted
/// to `BatchedPolygonGeometry` (handle-based component) at finalize time.
pub struct PolygonGeometryAccumulator {
    pub outer_rings: Vec<f64>,
    pub outer_ring_sizes: Vec<u32>,
    pub holes: Vec<f64>,
    pub holes_total_sizes: Vec<u32>,
    pub holes_sizes: Vec<u32>,
    pub holes_boundaries: Vec<u32>,
    pub expected_winding_orders: Vec<u8>,
    pub batch_indices: Vec<u32>,
    pub crs: CRS,
}

impl PolygonGeometryAccumulator {
    pub fn new(crs: CRS) -> Self {
        Self {
            outer_rings: Vec::new(),
            outer_ring_sizes: Vec::new(),
            holes: Vec::new(),
            holes_total_sizes: Vec::new(),
            holes_sizes: Vec::new(),
            holes_boundaries: Vec::new(),
            expected_winding_orders: Vec::new(),
            batch_indices: Vec::new(),
            crs,
        }
    }

    /// Append a polygon feature's geometry to this accumulator.
    pub fn add(
        &mut self,
        outer_ring: Vec<f64>,
        holes: &[navara_geometry::Hierarchy],
        winding_order: WindingOrder,
        batch_index: u32,
    ) {
        self.outer_ring_sizes.push(outer_ring.len() as u32);
        self.outer_rings.extend(outer_ring);

        self.expected_winding_orders.push(winding_order as u8);

        let mut total_hole_size: u32 = 0;
        let hole_count = holes.len() as u32;

        for hole in holes {
            let hole_size = hole.outer_ring.len() as u32;
            self.holes.extend_from_slice(&hole.outer_ring);
            self.holes_sizes.push(hole_size);
            self.expected_winding_orders
                .push(hole.expected_winding_order as u8);
            total_hole_size += hole_size;
        }

        self.holes_total_sizes.push(total_hole_size);
        self.holes_boundaries.push(hole_count);
        self.batch_indices.push(batch_index);
    }

    /// Convert to a handle-based component, storing Vec data in BufferStore.
    pub fn into_component(self, buf: &mut BufferStore) -> BatchedPolygonGeometry {
        BatchedPolygonGeometry {
            outer_rings: buf.new_f64(self.outer_rings),
            outer_ring_sizes: buf.new_u32(self.outer_ring_sizes),
            holes: buf.new_f64(self.holes),
            holes_total_sizes: buf.new_u32(self.holes_total_sizes),
            holes_sizes: buf.new_u32(self.holes_sizes),
            holes_boundaries: buf.new_u32(self.holes_boundaries),
            expected_winding_orders: buf.new_u8(self.expected_winding_orders),
            batch_indices: buf.new_u32(self.batch_indices),
            crs: self.crs,
        }
    }
}

// ── Component types (Handle-based, stored on ECS entities) ───────────

/// Discriminant for encoded point positions.
#[derive(Clone, Copy, Debug)]
pub enum PointEncoding {
    Rtc,
    Rte,
}

/// Pre-accumulated point geometry for all features in a batch.
///
/// Stored on the `BatchedFeature` parent entity. The `coords` and `crs`
/// fields are kept inline for ongoing terrain height updates. Transfer
/// data (encoded positions, batch indices/ids) is stored in `BufferStore`
/// and converted to `TransferablePointGeometry` via the `From` impl.
#[derive(Component)]
pub struct BatchedPointGeometry {
    /// Original coords kept for terrain height updates.
    pub coords: Vec<Vec3>,
    /// Original CRS kept for terrain height updates.
    pub crs: CRS,
    /// Pre-computed transform (RTC center + scale).
    pub transform: Transform,
    pub(crate) batch_indices: Handle,
    pub(crate) batch_ids: Handle,
    pub(crate) encoding: PointEncoding,
    /// Rtc: coords (f32), Rte: high (f32)
    pub(crate) encoded_a: Handle,
    /// Rtc: None, Rte: Some(low f32)
    pub(crate) encoded_b: Option<Handle>,
}

impl BatchedPointGeometry {
    /// Read batch_indices from BufferStore (read-only).
    pub fn batch_indices<'a>(&self, buf: &'a BufferStore) -> Option<&'a [u32]> {
        buf.get_u32(&self.batch_indices)
    }

    /// Remove all buffers from store (cleanup without returning data).
    pub fn remove_from_buf(&self, buf: &mut BufferStore) {
        buf.remove(&self.batch_indices);
        buf.remove(&self.batch_ids);
        buf.remove(&self.encoded_a);
        if let Some(encoded_b) = &self.encoded_b {
            buf.remove(encoded_b);
        }
    }
}

/// Owned data taken from `BatchedPolylineGeometry` via `take_from_buf()`.
pub struct TakenPolylineGeometry {
    pub points: Vec<f64>,
    pub points_sizes: Vec<u32>,
    pub batch_indices: Vec<u32>,
    pub ring_flags: Vec<u8>,
}

/// Pre-accumulated polyline geometry for all features in a batch.
///
/// Coordinates and metadata are stored in `BufferStore` as flat arrays.
/// Access geometry data via `take_from_buf()`.
#[derive(Component, Clone)]
pub struct BatchedPolylineGeometry {
    points: Handle,
    points_sizes: Handle,
    batch_indices: Handle,
    ring_flags: Handle,
    pub crs: CRS,
}

impl BatchedPolylineGeometry {
    /// Get the number of polyline features in this batch.
    pub fn feature_count(&self, buf: &BufferStore) -> usize {
        buf.get_u32(&self.points_sizes).map_or(0, |s| s.len())
    }

    /// Read batch_indices from BufferStore (read-only).
    pub fn batch_indices<'a>(&self, buf: &'a BufferStore) -> Option<&'a [u32]> {
        buf.get_u32(&self.batch_indices)
    }

    /// Read points from BufferStore (read-only).
    pub fn points<'a>(&self, buf: &'a BufferStore) -> Option<&'a [f64]> {
        buf.get_f64(&self.points)
    }

    /// Take all geometry data out of BufferStore, consuming the handles.
    /// Returns owned Vecs ready for WASM transfer. Removes buffers from store.
    pub fn take_from_buf(&self, buf: &mut BufferStore) -> TakenPolylineGeometry {
        TakenPolylineGeometry {
            points: buf.remove_f64(&self.points).unwrap_or_default(),
            points_sizes: buf.remove_u32(&self.points_sizes).unwrap_or_default(),
            batch_indices: buf.remove_u32(&self.batch_indices).unwrap_or_default(),
            ring_flags: buf.remove_u8(&self.ring_flags).unwrap_or_default(),
        }
    }

    /// Remove all buffers from store (cleanup without returning data).
    pub fn remove_from_buf(&self, buf: &mut BufferStore) {
        buf.remove(&self.points);
        buf.remove(&self.points_sizes);
        buf.remove(&self.batch_indices);
        buf.remove(&self.ring_flags);
    }
}

/// Owned data taken from `BatchedPolygonGeometry` via `take_from_buf()`.
pub struct TakenPolygonGeometry {
    pub outer_rings: Vec<f64>,
    pub outer_ring_sizes: Vec<u32>,
    pub holes: Vec<f64>,
    pub holes_total_sizes: Vec<u32>,
    pub holes_sizes: Vec<u32>,
    pub holes_boundaries: Vec<u32>,
    pub expected_winding_orders: Vec<u8>,
    pub batch_indices: Vec<u32>,
}

/// Pre-accumulated polygon geometry for all features in a batch.
///
/// Flat-array data is stored in `BufferStore`, enabling lightweight ECS
/// components. Access geometry data via `take_from_buf()`.
#[derive(Component, Clone)]
pub struct BatchedPolygonGeometry {
    outer_rings: Handle,
    outer_ring_sizes: Handle,
    holes: Handle,
    holes_total_sizes: Handle,
    holes_sizes: Handle,
    holes_boundaries: Handle,
    expected_winding_orders: Handle,
    batch_indices: Handle,
    pub crs: CRS,
}

impl BatchedPolygonGeometry {
    /// Get the number of polygon features in this batch.
    pub fn feature_count(&self, buf: &BufferStore) -> usize {
        buf.get_u32(&self.outer_ring_sizes).map_or(0, |s| s.len())
    }

    /// Read batch_indices from BufferStore (read-only).
    pub fn batch_indices<'a>(&self, buf: &'a BufferStore) -> Option<&'a [u32]> {
        buf.get_u32(&self.batch_indices)
    }

    /// Read outer_rings from BufferStore (read-only).
    pub fn outer_rings<'a>(&self, buf: &'a BufferStore) -> Option<&'a [f64]> {
        buf.get_f64(&self.outer_rings)
    }

    /// Read the holes_boundaries data from BufferStore (read-only).
    pub fn holes_boundaries<'a>(&self, buf: &'a BufferStore) -> Option<&'a [u32]> {
        buf.get_u32(&self.holes_boundaries)
    }

    /// Read expected_winding_orders from BufferStore (read-only).
    pub fn expected_winding_orders<'a>(&self, buf: &'a BufferStore) -> Option<&'a [u8]> {
        buf.get_u8(&self.expected_winding_orders)
    }

    /// Take all geometry data out of BufferStore, consuming the handles.
    /// Returns owned Vecs ready for WASM transfer. Removes buffers from store.
    pub fn take_from_buf(&self, buf: &mut BufferStore) -> TakenPolygonGeometry {
        TakenPolygonGeometry {
            outer_rings: buf.remove_f64(&self.outer_rings).unwrap_or_default(),
            outer_ring_sizes: buf.remove_u32(&self.outer_ring_sizes).unwrap_or_default(),
            holes: buf.remove_f64(&self.holes).unwrap_or_default(),
            holes_total_sizes: buf.remove_u32(&self.holes_total_sizes).unwrap_or_default(),
            holes_sizes: buf.remove_u32(&self.holes_sizes).unwrap_or_default(),
            holes_boundaries: buf.remove_u32(&self.holes_boundaries).unwrap_or_default(),
            expected_winding_orders: buf
                .remove_u8(&self.expected_winding_orders)
                .unwrap_or_default(),
            batch_indices: buf.remove_u32(&self.batch_indices).unwrap_or_default(),
        }
    }

    /// Remove all buffers from store (cleanup without returning data).
    pub fn remove_from_buf(&self, buf: &mut BufferStore) {
        buf.remove(&self.outer_rings);
        buf.remove(&self.outer_ring_sizes);
        buf.remove(&self.holes);
        buf.remove(&self.holes_total_sizes);
        buf.remove(&self.holes_sizes);
        buf.remove(&self.holes_boundaries);
        buf.remove(&self.expected_winding_orders);
        buf.remove(&self.batch_indices);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_rtc_initializes_from_empty() {
        let mut enc = EncodedPointPositions::Empty;
        let center = Vec3::new(100., 200., 300.);
        enc.push_rtc(1.0, 2.0, 3.0, center);

        match &enc {
            EncodedPointPositions::Rtc { coords, center: c } => {
                assert_eq!(coords, &[1.0, 2.0, 3.0]);
                assert_eq!(*c, center);
            }
            _ => panic!("expected Rtc"),
        }
    }

    #[test]
    fn push_rtc_appends_to_existing() {
        let center = Vec3::new(100., 200., 300.);
        let mut enc = EncodedPointPositions::Rtc {
            coords: vec![1.0, 2.0, 3.0],
            center,
        };
        enc.push_rtc(4.0, 5.0, 6.0, center);

        match &enc {
            EncodedPointPositions::Rtc { coords, .. } => {
                assert_eq!(coords, &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
            }
            _ => panic!("expected Rtc"),
        }
    }

    #[test]
    fn push_rte_initializes_from_empty() {
        let mut enc = EncodedPointPositions::Empty;
        enc.push_rte([1.0, 2.0, 3.0], [0.1, 0.2, 0.3]);

        match &enc {
            EncodedPointPositions::Rte { high, low } => {
                assert_eq!(high, &[1.0, 2.0, 3.0]);
                assert_eq!(low, &[0.1, 0.2, 0.3]);
            }
            _ => panic!("expected Rte"),
        }
    }

    #[test]
    fn push_rte_appends_to_existing() {
        let mut enc = EncodedPointPositions::Rte {
            high: vec![1.0, 2.0, 3.0],
            low: vec![0.1, 0.2, 0.3],
        };
        enc.push_rte([4.0, 5.0, 6.0], [0.4, 0.5, 0.6]);

        match &enc {
            EncodedPointPositions::Rte { high, low } => {
                assert_eq!(high, &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
                assert_eq!(low, &[0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
            }
            _ => panic!("expected Rte"),
        }
    }

    #[test]
    fn default_is_empty() {
        let enc = EncodedPointPositions::default();
        assert!(matches!(enc, EncodedPointPositions::Empty));
    }

    #[test]
    fn take_leaves_empty() {
        let mut enc = EncodedPointPositions::Rtc {
            coords: vec![1.0, 2.0, 3.0],
            center: Vec3::ZERO,
        };
        let taken = std::mem::take(&mut enc);
        assert!(matches!(enc, EncodedPointPositions::Empty));
        assert!(matches!(taken, EncodedPointPositions::Rtc { .. }));
    }

    #[test]
    fn polygon_accumulator_add_and_into_component() {
        let mut buf = BufferStore::new();
        let mut acc = PolygonGeometryAccumulator::new(CRS::Geographic);

        acc.add(
            vec![0., 0., 0., 1., 0., 0., 1., 1., 0.],
            &[],
            WindingOrder::Clockwise,
            0,
        );

        let geom = acc.into_component(&mut buf);
        let taken = geom.take_from_buf(&mut buf);
        assert_eq!(taken.outer_rings, vec![0., 0., 0., 1., 0., 0., 1., 1., 0.]);
        assert_eq!(taken.outer_ring_sizes, vec![9]);
        assert_eq!(taken.batch_indices, vec![0]);
    }

    #[test]
    fn polyline_accumulator_into_component() {
        let mut buf = BufferStore::new();
        let mut acc = PolylineGeometryAccumulator::new(CRS::Geographic);

        acc.points.extend_from_slice(&[0., 0., 0., 1., 1., 0.]);
        acc.points_sizes.push(6);
        acc.batch_indices.push(0);

        let geom = acc.into_component(&mut buf);
        let taken = geom.take_from_buf(&mut buf);
        assert_eq!(taken.points, vec![0., 0., 0., 1., 1., 0.]);
        assert_eq!(taken.points_sizes, vec![6]);
        assert_eq!(taken.batch_indices, vec![0]);
    }

    #[test]
    fn point_accumulator_rtc_into_component() {
        let mut buf = BufferStore::new();
        let center = Vec3::new(100., 200., 300.);
        let mut acc = PointGeometryAccumulator::new(CRS::Geographic);
        acc.coords.push(Vec3::new(1., 2., 0.));
        acc.batch_indices.push(0);
        acc.batch_ids.push(100.0);
        acc.encoded.push_rtc(10.0, 20.0, 30.0, center);

        let geom = acc.into_component(&mut buf);
        assert_eq!(buf.get_u32(&geom.batch_indices).unwrap(), &[0]);
        assert_eq!(buf.get_f32(&geom.batch_ids).unwrap(), &[100.0]);
        assert!(matches!(geom.encoding, PointEncoding::Rtc));
        assert_eq!(buf.get_f32(&geom.encoded_a).unwrap(), &[10.0, 20.0, 30.0]);
    }

    #[test]
    fn point_accumulator_rte_into_component() {
        let mut buf = BufferStore::new();
        let mut acc = PointGeometryAccumulator::new(CRS::Geographic);
        acc.coords.push(Vec3::new(1., 2., 0.));
        acc.batch_indices.push(0);
        acc.batch_ids.push(100.0);
        acc.encoded.push_rte([1.0, 2.0, 3.0], [0.1, 0.2, 0.3]);

        let geom = acc.into_component(&mut buf);
        assert!(matches!(geom.encoding, PointEncoding::Rte));
        assert_eq!(buf.get_f32(&geom.encoded_a).unwrap(), &[1.0, 2.0, 3.0]);
        assert_eq!(
            buf.get_f32(&geom.encoded_b.unwrap()).unwrap(),
            &[0.1, 0.2, 0.3]
        );
    }

    #[test]
    fn polygon_remove_from_buf_cleans_up() {
        let mut buf = BufferStore::new();
        let acc = PolygonGeometryAccumulator::new(CRS::Geographic);
        let geom = acc.into_component(&mut buf);
        assert_eq!(buf.len(), 8); // 8 handles
        geom.remove_from_buf(&mut buf);
        assert!(buf.is_empty());
    }

    #[test]
    fn polyline_remove_from_buf_cleans_up() {
        let mut buf = BufferStore::new();
        let acc = PolylineGeometryAccumulator::new(CRS::Geographic);
        let geom = acc.into_component(&mut buf);
        assert_eq!(buf.len(), 4);
        geom.remove_from_buf(&mut buf);
        assert!(buf.is_empty());
    }
}
