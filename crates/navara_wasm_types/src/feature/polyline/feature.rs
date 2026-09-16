use navara_feature_component::batch::{BatchId, BatchIndex};
use wasm_bindgen::prelude::*;

use crate::{
    CRS, copy_f64_array, copy_u8_array, copy_u32_array, transfer_f64_array, transfer_u8_array,
    transfer_u32_array,
};

/// To transfer the batched feature efficiently, the all feature's properties are managed as one-dimensional array.
#[wasm_bindgen]
#[derive(Debug, Default)]
pub struct TransferablePolylineBatchedFeature {
    points: Vec<f64>,
    points_sizes: Vec<u32>,
    batch_ids: Vec<u32>,
    batch_indices: Vec<u32>,
    /// Per polyline, whether it is a polygon ring (1) or an open line (0). A
    /// ring's repeated first vertex is a seam the geometry joins; an open line
    /// keeps its end caps even when its endpoints coincide.
    ring_flags: Vec<u8>,

    #[wasm_bindgen(getter_with_clone)]
    pub crs: CRS,

    pub length: usize,

    cur_idx: usize,

    points_offset: usize,
}

#[wasm_bindgen]
impl TransferablePolylineBatchedFeature {
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(constructor)]
    pub fn constructor(crs: CRS, length: usize) -> Self {
        Self {
            points: vec![],
            points_sizes: vec![],
            batch_ids: vec![],
            batch_indices: vec![],
            ring_flags: vec![],
            crs,
            length,
            cur_idx: 0,
            points_offset: 0,
        }
    }

    #[wasm_bindgen(js_name = "setBatchIds")]
    pub fn set_batch_ids(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.batch_ids = transfer_u32_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setBatchIndices")]
    pub fn set_batch_indices(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.batch_indices = transfer_u32_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setPoints")]
    pub fn set_points(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.points = transfer_f64_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setPointsSizes")]
    pub fn set_points_sizes(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.points_sizes = transfer_u32_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setRingFlags")]
    pub fn set_ring_flags(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.ring_flags = transfer_u8_array(byte_length, f)
    }

    #[wasm_bindgen(js_name = "transferBatchIds")]
    pub fn transfer_batch_ids(&mut self) -> js_sys::Uint32Array {
        copy_u32_array(&self.batch_ids)
    }

    #[wasm_bindgen(js_name = "transferBatchIndices")]
    pub fn transfer_batch_indices(&mut self) -> js_sys::Uint32Array {
        copy_u32_array(&self.batch_indices)
    }

    #[wasm_bindgen(js_name = "transferPoints")]
    pub fn transfer_points(&mut self) -> js_sys::Float64Array {
        copy_f64_array(&self.points)
    }

    #[wasm_bindgen(js_name = "transferPointsSizes")]
    pub fn transfer_points_sizes(&mut self) -> js_sys::Uint32Array {
        copy_u32_array(&self.points_sizes)
    }

    #[wasm_bindgen(js_name = "transferRingFlags")]
    pub fn transfer_ring_flags(&mut self) -> js_sys::Uint8Array {
        copy_u8_array(&self.ring_flags)
    }
}

impl TransferablePolylineBatchedFeature {
    pub fn new<I: Iterator<Item = (u32, Vec<f64>)>>(geometries: I, length: usize) -> Self {
        let mut points = Vec::with_capacity(length);
        let mut points_sizes = Vec::with_capacity(length);
        let mut batch_ids = Vec::with_capacity(length);
        let mut batch_indices = Vec::with_capacity(length);

        let mut ring_flags = Vec::with_capacity(length);

        for (i, (batch_id, mut ps)) in geometries.into_iter().enumerate() {
            points_sizes.push(ps.len() as u32);
            points.append(&mut ps);

            batch_ids.push(batch_id);

            batch_indices.push(i as u32);
            ring_flags.push(0);
        }

        TransferablePolylineBatchedFeature {
            points,
            points_sizes,
            batch_ids,
            batch_indices,
            ring_flags,
            crs: CRS::default(),
            length,
            ..Default::default()
        }
    }

    pub fn empty(length: usize) -> Self {
        let points = Vec::with_capacity(length);
        let points_sizes = Vec::with_capacity(length);
        let batch_ids = Vec::with_capacity(length);

        TransferablePolylineBatchedFeature {
            points,
            points_sizes,
            batch_ids,
            crs: CRS::default(),
            length,
            ..Default::default()
        }
    }

    /// Create from taken polyline geometry data (retrieved from BufferStore).
    /// All fields are moved, zero clones.
    pub fn from_batched(
        geom: navara_feature_component::batched_geometry::TakenPolylineGeometry,
    ) -> Self {
        let length = geom.batch_indices.len();
        Self {
            points: geom.points,
            points_sizes: geom.points_sizes,
            batch_indices: geom.batch_indices,
            ring_flags: geom.ring_flags,
            length,
            ..Default::default()
        }
    }

    pub fn add(&mut self, points: &mut Vec<f64>, batch_index: BatchIndex, ring: bool) {
        self.points_sizes.push(points.len() as u32);
        self.points.append(points);
        self.ring_flags.push(ring as u8);

        self.batch_indices.push(batch_index.0);
    }

    pub fn add_batch_id(&mut self, batch_id: &mut Vec<u32>) {
        self.batch_ids.append(batch_id);
    }

    pub fn to_transferable_by_index(
        &mut self,
        idx: usize,
    ) -> (Vec<f64>, BatchIndex, BatchId, bool) {
        let size = self.points_sizes[idx] as usize;
        let start = self.points_offset;
        let end = start + size;
        let points = self.points[start..end].to_vec();
        self.points_offset = end;

        let batch_index = self.batch_indices[idx] as usize;

        let batch_id = BatchId(self.batch_ids[idx] as f32);

        // An older producer may not carry the flags; treat those as open lines.
        let ring = self.ring_flags.get(idx).is_some_and(|&f| f != 0);

        (points, BatchIndex(batch_index as u32), batch_id, ring)
    }
}

impl Iterator for TransferablePolylineBatchedFeature {
    type Item = (Vec<f64>, BatchIndex, BatchId, bool);
    fn next(&mut self) -> Option<Self::Item> {
        if self.cur_idx == self.length {
            return None;
        }

        let result = self.to_transferable_by_index(self.cur_idx);
        self.cur_idx += 1;
        Some(result)
    }
}

#[cfg(test)]
mod test {
    use super::TransferablePolylineBatchedFeature;
    use navara_feature_component::batch::BatchIndex;

    /// A MultiLineString feature owns several items sharing one batch index,
    /// but each item carries its own per-instance pick id.
    #[test]
    fn multi_instance_items_keep_their_own_pick_id() {
        let mut t = TransferablePolylineBatchedFeature::empty(3);
        // Feature 0 owns the first two polylines; feature 1 the third.
        t.add(&mut vec![0., 0., 0., 1., 1., 1.], BatchIndex(0), false);
        t.add(&mut vec![2., 2., 2., 3., 3., 3.], BatchIndex(0), true);
        t.add(&mut vec![4., 4., 4., 5., 5., 5.], BatchIndex(1), false);
        t.add_batch_id(&mut vec![100, 101, 102]);

        let items: Vec<_> = t.map(|(_, idx, id, ring)| (idx.0, id.0, ring)).collect();
        assert_eq!(
            items,
            vec![(0, 100.0, false), (0, 101.0, true), (1, 102.0, false)]
        );
    }

    #[test]
    fn it_should_get_a_points_of_batched_feature() {
        #[rustfmt::skip]
        let points = vec![
                vec![
                    0., 0., 0.,
                    1., 1., 1.,
                    2., 2., 2.,
                ],
                vec![
                    10., 10., 10.,
                    11., 11., 11.,
                    12., 12., 12.,
                ],
                vec![20., 20., 20.],
        ];

        struct BatchedFeature(u32, Vec<Vec<f64>>);
        impl Iterator for BatchedFeature {
            type Item = (u32, Vec<f64>);
            fn next(&mut self) -> Option<Self::Item> {
                if self.1.is_empty() {
                    return None;
                }
                let result = (self.0, self.1.remove(0));
                self.0 += 1;
                Some(result)
            }
        }

        let transferable_features = TransferablePolylineBatchedFeature::new(
            BatchedFeature(0, points.clone()),
            points.len(),
        );

        let mut features: Vec<Vec<f64>> = vec![];
        let mut batch_ids = vec![];
        let mut batch_idxs = vec![];
        for (feature, batch_index, batch_id, ring) in transferable_features {
            features.push(feature);
            batch_ids.push(batch_id.0);
            batch_idxs.push(batch_index.0);
            // `new` has no ring information, so every item is an open line.
            assert!(!ring);
        }

        assert_eq!(features, points);
        assert_eq!(batch_ids, vec![0.0, 1.0, 2.0]);
        assert_eq!(batch_idxs, vec![0, 1, 2]);
    }
}
