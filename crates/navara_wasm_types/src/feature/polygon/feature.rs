use navara_feature_component::batch::{BatchId, BatchIndex};
use navara_geometry::Hierarchy;
use wasm_bindgen::prelude::*;

use crate::{
    CRS, copy_f64_array, copy_u8_array, copy_u32_array, transfer_f64_array, transfer_u8_array,
    transfer_u32_array,
};

use super::{TransferableHierarchy, TransferableHoles, WindingOrder};

/// To transfer the batched feature efficiently, the all feature's properties are managed as one-dimensional array.
#[wasm_bindgen]
#[derive(Debug, Default)]
pub struct TransferablePolygonBatchedFeature {
    outer_ring: Vec<f64>,
    outer_ring_sizes: Vec<u32>,
    /// All holes for a batched feature
    holes: Vec<f64>,
    /// Total holes for one feature.
    holes_total_sizes: Vec<u32>,
    /// Each hole size
    holes_sizes: Vec<u32>,
    /// Each hole boundaries
    holes_boundaries: Vec<u32>,
    batch_ids: Vec<u32>,
    batch_indices: Vec<u32>,
    expected_winding_orders: Vec<u8>,
    outline_edges: Vec<u8>,

    #[wasm_bindgen(getter_with_clone)]
    pub crs: CRS,

    pub length: usize,

    cur_idx: usize,

    // Offsets for zero-shift iteration (avoids O(n²) drain-from-front)
    outer_ring_offset: usize,
    holes_offset: usize,
    holes_sizes_offset: usize,
    expected_winding_orders_offset: usize,
    outline_edges_offset: usize,
}

#[wasm_bindgen]
impl TransferablePolygonBatchedFeature {
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(constructor)]
    pub fn constructor(crs: CRS, length: usize) -> Self {
        Self {
            outer_ring: vec![],
            outer_ring_sizes: vec![],
            holes: vec![],
            holes_total_sizes: vec![],
            holes_sizes: vec![],
            holes_boundaries: vec![],
            batch_ids: vec![],
            batch_indices: vec![],
            expected_winding_orders: vec![],
            outline_edges: vec![],
            crs,
            length,
            cur_idx: 0,
            outer_ring_offset: 0,
            holes_offset: 0,
            holes_sizes_offset: 0,
            expected_winding_orders_offset: 0,
            outline_edges_offset: 0,
        }
    }

    #[wasm_bindgen(js_name = "setOuterRing")]
    pub fn set_outer_ring(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.outer_ring = transfer_f64_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setOuterRingSizes")]
    pub fn set_outer_ring_sizes(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.outer_ring_sizes = transfer_u32_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setHoles")]
    pub fn set_holes(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.holes = transfer_f64_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setHolesSizes")]
    pub fn set_holes_sizes(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.holes_sizes = transfer_u32_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setHolesTotalSizes")]
    pub fn set_holes_total_sizes(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.holes_total_sizes = transfer_u32_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setHolesBoundaries")]
    pub fn set_holes_boundaries(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.holes_boundaries = transfer_u32_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setBatchIds")]
    pub fn set_batch_ids(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.batch_ids = transfer_u32_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setBatchIndices")]
    pub fn set_batch_indices(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.batch_indices = transfer_u32_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setExpectedWindingOrders")]
    pub fn set_expected_winding_orders(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.expected_winding_orders = transfer_u8_array(byte_length, f)
    }
    #[wasm_bindgen(js_name = "setOutlineEdges")]
    pub fn set_outline_edges(&mut self, byte_length: usize, f: &js_sys::Function) {
        self.outline_edges = transfer_u8_array(byte_length, f)
    }

    #[wasm_bindgen(js_name = "transferBatchIds")]
    pub fn transfer_batch_ids(&mut self) -> js_sys::Uint32Array {
        copy_u32_array(&self.batch_ids)
    }

    #[wasm_bindgen(js_name = "transferBatchIndices")]
    pub fn transfer_batch_indices(&mut self) -> js_sys::Uint32Array {
        copy_u32_array(&self.batch_indices)
    }

    #[wasm_bindgen(js_name = "transferOuterRing")]
    pub fn transfer_outer_ring(&mut self) -> js_sys::Float64Array {
        copy_f64_array(&self.outer_ring)
    }

    #[wasm_bindgen(js_name = "transferOuterRingSizes")]
    pub fn transfer_outer_ring_sizes(&mut self) -> js_sys::Uint32Array {
        copy_u32_array(&self.outer_ring_sizes)
    }

    #[wasm_bindgen(js_name = "transferHoles")]
    pub fn transfer_holes(&mut self) -> js_sys::Float64Array {
        copy_f64_array(&self.holes)
    }

    #[wasm_bindgen(js_name = "transferHolesBoundaries")]
    pub fn transfer_holes_boundaries(&mut self) -> js_sys::Uint32Array {
        copy_u32_array(&self.holes_boundaries)
    }

    #[wasm_bindgen(js_name = "transferHolesSizes")]
    pub fn transfer_holes_sizes(&mut self) -> js_sys::Uint32Array {
        copy_u32_array(&self.holes_sizes)
    }

    #[wasm_bindgen(js_name = "transferHolesTotalSizes")]
    pub fn transfer_holes_total_sizes(&mut self) -> js_sys::Uint32Array {
        copy_u32_array(&self.holes_total_sizes)
    }

    #[wasm_bindgen(js_name = "transferExpectedWindingOrders")]
    pub fn transfer_expected_winding_orders(&mut self) -> js_sys::Uint8Array {
        copy_u8_array(&self.expected_winding_orders)
    }

    #[wasm_bindgen(js_name = "transferOutlineEdges")]
    pub fn transfer_outline_edges(&mut self) -> js_sys::Uint8Array {
        copy_u8_array(&self.outline_edges)
    }
}

impl TransferablePolygonBatchedFeature {
    #[allow(unused)]
    fn new<I: Iterator<Item = (usize, Hierarchy)>>(hierarchies: I, length: usize) -> Self {
        let mut outer_ring = Vec::with_capacity(length);
        let mut outer_ring_sizes = Vec::with_capacity(length);
        let mut holes = Vec::with_capacity(length);
        let mut holes_total_sizes = Vec::with_capacity(length);
        let mut holes_boundaries = Vec::with_capacity(length);
        let mut holes_sizes = Vec::with_capacity(length);
        let mut batch_ids = Vec::with_capacity(length);
        let mut batch_indices = Vec::with_capacity(length);
        let mut expected_winding_orders = Vec::with_capacity(length);

        for (i, (batch_id, mut hierarchy)) in hierarchies.into_iter().enumerate() {
            outer_ring_sizes.push(hierarchy.outer_ring.len() as u32);
            outer_ring.append(&mut hierarchy.outer_ring);

            batch_ids.push(batch_id as u32);

            batch_indices.push(i as u32);

            expected_winding_orders
                .push(Into::<WindingOrder>::into(hierarchy.expected_winding_order).0);

            let Some(h_holes) = hierarchy.holes else {
                holes_boundaries.push(0);
                holes_total_sizes.push(0);
                continue;
            };
            holes_boundaries.push(h_holes.len() as u32);
            let mut holes_total_size = 0;
            for mut hole in h_holes {
                holes_total_size += hole.outer_ring.len();
                holes_sizes.push(hole.outer_ring.len() as u32);
                holes.append(&mut hole.outer_ring);
                expected_winding_orders
                    .push(Into::<WindingOrder>::into(hole.expected_winding_order).0);
            }
            holes_total_sizes.push(holes_total_size as u32);
        }

        TransferablePolygonBatchedFeature {
            outer_ring,
            outer_ring_sizes,
            holes,
            holes_sizes,
            holes_total_sizes,
            holes_boundaries,
            batch_ids,
            batch_indices,
            expected_winding_orders,
            crs: CRS::default(),
            length,
            ..Default::default()
        }
    }

    pub fn empty(length: usize) -> Self {
        let outer_ring = Vec::with_capacity(length);
        let outer_ring_sizes = Vec::with_capacity(length);
        let holes = Vec::with_capacity(length);
        let holes_total_sizes = Vec::with_capacity(length);
        let holes_boundaries = Vec::with_capacity(length);
        let holes_sizes = Vec::with_capacity(length);
        let batch_ids = Vec::with_capacity(length);
        let batch_indices = Vec::with_capacity(length);
        let expected_winding_orders = Vec::with_capacity(length);

        TransferablePolygonBatchedFeature {
            outer_ring,
            outer_ring_sizes,
            holes,
            holes_sizes,
            holes_total_sizes,
            holes_boundaries,
            batch_ids,
            batch_indices,
            expected_winding_orders,
            crs: CRS::default(),
            length,
            ..Default::default()
        }
    }

    /// Create from taken polygon geometry data (retrieved from BufferStore).
    /// All fields are moved, zero clones.
    pub fn from_batched(
        geom: navara_feature_component::batched_geometry::TakenPolygonGeometry,
    ) -> Self {
        let length = geom.batch_indices.len();
        Self {
            outer_ring: geom.outer_rings,
            outer_ring_sizes: geom.outer_ring_sizes,
            holes: geom.holes,
            holes_total_sizes: geom.holes_total_sizes,
            holes_sizes: geom.holes_sizes,
            holes_boundaries: geom.holes_boundaries,
            batch_indices: geom.batch_indices,
            expected_winding_orders: geom.expected_winding_orders,
            outline_edges: geom.outline_edges,
            length,
            ..Default::default()
        }
    }

    pub fn add(&mut self, hierarchy: &mut Hierarchy, batch_index: BatchIndex) {
        self.outer_ring_sizes
            .push(hierarchy.outer_ring.len() as u32);
        self.outer_ring.append(&mut hierarchy.outer_ring);

        self.expected_winding_orders
            .push(Into::<WindingOrder>::into(hierarchy.expected_winding_order).0);

        self.batch_indices.push(batch_index.0);

        let Some(h_holes) = &mut hierarchy.holes else {
            self.holes_boundaries.push(0);
            self.holes_total_sizes.push(0);
            return;
        };

        self.holes_boundaries.push(h_holes.len() as u32);
        let mut holes_total_size = 0;
        for hole in h_holes {
            holes_total_size += hole.outer_ring.len();
            self.holes_sizes.push(hole.outer_ring.len() as u32);
            self.holes.append(&mut hole.outer_ring);
            self.expected_winding_orders
                .push(Into::<WindingOrder>::into(hole.expected_winding_order).0);
        }
        self.holes_total_sizes.push(holes_total_size as u32);
    }

    pub fn add_batch_id(&mut self, batch_id: &mut Vec<u32>) {
        self.batch_ids.append(batch_id);
    }

    pub fn to_transferable_hierarchy_by_index(
        &mut self,
        idx: usize,
    ) -> (TransferableHierarchy, BatchIndex, BatchId, Option<Vec<u8>>) {
        // Extract outer_ring slice
        let or_size = self.outer_ring_sizes[idx] as usize;
        let or_start = self.outer_ring_offset;
        let or_end = or_start + or_size;
        let outer_ring = self.outer_ring[or_start..or_end].to_vec();
        self.outer_ring_offset = or_end;

        // Extract winding order for the outer ring
        let expected_winding_order =
            self.expected_winding_orders[self.expected_winding_orders_offset];
        self.expected_winding_orders_offset += 1;

        // Extract holes
        let holes_total = self.holes_total_sizes[idx] as usize;
        let h_start = self.holes_offset;
        let h_end = h_start + holes_total;
        let holes_data = self.holes[h_start..h_end].to_vec();
        self.holes_offset = h_end;

        let boundaries = self.holes_boundaries[idx] as usize;
        let hs_start = self.holes_sizes_offset;
        let hs_end = hs_start + boundaries;
        let holes_sizes = self.holes_sizes[hs_start..hs_end].to_vec();
        self.holes_sizes_offset = hs_end;

        let ewo_start = self.expected_winding_orders_offset;
        let ewo_end = ewo_start + boundaries;
        let holes_winding_orders = self.expected_winding_orders[ewo_start..ewo_end].to_vec();
        self.expected_winding_orders_offset = ewo_end;

        let transferable_hierarchy = TransferableHierarchy {
            outer_ring,
            expected_winding_order,
            holes: TransferableHoles {
                holes: holes_data,
                sizes: holes_sizes,
                expected_winding_orders: holes_winding_orders,
            },
        };

        let outline_edges = (!self.outline_edges.is_empty()).then(|| {
            let start = self.outline_edges_offset;
            let end = start + (or_size + holes_total) / 3;
            self.outline_edges_offset = end;
            self.outline_edges[start..end].to_vec()
        });

        let batch_idx = self.batch_indices[idx] as usize;

        let batch_id = BatchId(self.batch_ids[idx] as f32);

        (
            transferable_hierarchy,
            BatchIndex(batch_idx as u32),
            batch_id,
            outline_edges,
        )
    }
}

impl Iterator for TransferablePolygonBatchedFeature {
    type Item = (TransferableHierarchy, BatchIndex, BatchId, Option<Vec<u8>>);
    fn next(&mut self) -> Option<Self::Item> {
        if self.cur_idx == self.length {
            return None;
        }

        let result = self.to_transferable_hierarchy_by_index(self.cur_idx);
        self.cur_idx += 1;
        Some(result)
    }
}

#[cfg(test)]
mod test {
    use super::TransferablePolygonBatchedFeature;
    use navara_feature_component::batch::BatchIndex;
    use navara_geometry::Hierarchy;

    /// A MultiPolygon feature owns several items sharing one batch index, but
    /// each item carries its own per-instance pick id.
    #[test]
    fn multi_instance_items_keep_their_own_pick_id() {
        let square = |offset: f64| Hierarchy {
            outer_ring: vec![
                offset,
                offset,
                0.,
                offset + 1.,
                offset,
                0.,
                offset + 1.,
                offset + 1.,
                0.,
            ],
            holes: None,
            expected_winding_order: navara_geometry::WindingOrder::Unknown,
        };

        let mut t = TransferablePolygonBatchedFeature::empty(3);
        // Feature 0 owns the first two polygons; feature 1 the third.
        t.add(&mut square(0.), BatchIndex(0));
        t.add(&mut square(10.), BatchIndex(0));
        t.add(&mut square(20.), BatchIndex(1));
        t.add_batch_id(&mut vec![100, 101, 102]);

        let items: Vec<_> = t.map(|(_, idx, id, _)| (idx.0, id.0)).collect();
        assert_eq!(items, vec![(0, 100.0), (0, 101.0), (1, 102.0)]);
    }

    #[test]
    fn it_should_get_a_hierarchy_of_batched_feature() {
        let hierarchies = vec![
            Hierarchy {
                #[rustfmt::skip]
                outer_ring: vec![
                    0., 0., 0.,
                    1., 1., 1.,
                    2., 2., 2.,
                ],
                holes: Some(vec![
                    Hierarchy {
                        #[rustfmt::skip]
                        outer_ring: vec![
                            3., 3., 3.,
                            4., 4., 4.,
                            5., 5., 5.,
                        ],
                        holes: None,
                        expected_winding_order: navara_geometry::WindingOrder::Clockwise,
                    },
                    Hierarchy {
                        #[rustfmt::skip]
                        outer_ring: vec![
                            6., 6., 6.,
                            7., 7., 7.,
                            8., 8., 8.,
                        ],
                        holes: None,
                        expected_winding_order: navara_geometry::WindingOrder::Clockwise,
                    },
                ]),
                expected_winding_order: navara_geometry::WindingOrder::CounterClockwise,
            },
            Hierarchy {
                #[rustfmt::skip]
                outer_ring: vec![
                    10., 10., 10.,
                    11., 11., 11.,
                    12., 12., 12.,
                ],
                holes: Some(vec![
                    Hierarchy {
                        outer_ring: vec![13., 13., 13.],
                        holes: None,
                        expected_winding_order: navara_geometry::WindingOrder::Clockwise,
                    },
                    Hierarchy {
                        #[rustfmt::skip]
                        outer_ring: vec![
                            14., 14., 14.,
                            15., 15., 15.
                        ],
                        holes: None,
                        expected_winding_order: navara_geometry::WindingOrder::Clockwise,
                    },
                ]),
                expected_winding_order: navara_geometry::WindingOrder::CounterClockwise,
            },
            Hierarchy {
                outer_ring: vec![20., 20., 20.],
                holes: Some(vec![
                    Hierarchy {
                        outer_ring: vec![21., 21., 21.],
                        holes: None,
                        expected_winding_order: navara_geometry::WindingOrder::Clockwise,
                    },
                    Hierarchy {
                        outer_ring: vec![22., 22., 22.],
                        holes: None,
                        expected_winding_order: navara_geometry::WindingOrder::Clockwise,
                    },
                ]),
                expected_winding_order: navara_geometry::WindingOrder::CounterClockwise,
            },
        ];

        struct BatchedHierarchy(usize, Vec<Hierarchy>);
        impl Iterator for BatchedHierarchy {
            type Item = (usize, Hierarchy);
            fn next(&mut self) -> Option<Self::Item> {
                if self.1.is_empty() {
                    return None;
                }
                let result = (self.0, self.1.remove(0));
                self.0 += 1;
                Some(result)
            }
        }

        let transferable_features = TransferablePolygonBatchedFeature::new(
            BatchedHierarchy(0, hierarchies.clone()),
            hierarchies.len(),
        );

        let mut features: Vec<Hierarchy> = vec![];
        let mut batch_ids = vec![];
        let mut batch_idxs = vec![];
        for (feature, batch_index, batch_id, _) in transferable_features {
            features.push(feature.into());
            batch_ids.push(batch_id.0);
            batch_idxs.push(batch_index.0);
        }

        assert_eq!(features, hierarchies);
        assert_eq!(batch_ids, vec![0.0, 1.0, 2.0]);
        assert_eq!(batch_idxs, vec![0, 1, 2,]);
    }

    #[test]
    fn it_should_handle_features_without_holes() {
        let hierarchies = vec![
            Hierarchy {
                #[rustfmt::skip]
                outer_ring: vec![
                    0., 0., 0.,
                    1., 1., 1.,
                ],
                holes: Some(vec![Hierarchy {
                    outer_ring: vec![2., 2., 2.],
                    holes: None,
                    expected_winding_order: navara_geometry::WindingOrder::Clockwise,
                }]),
                expected_winding_order: navara_geometry::WindingOrder::CounterClockwise,
            },
            // Feature without holes in the middle to catch indexing bugs
            Hierarchy {
                #[rustfmt::skip]
                outer_ring: vec![
                    10., 10., 10.,
                    11., 11., 11.,
                ],
                holes: None,
                expected_winding_order: navara_geometry::WindingOrder::CounterClockwise,
            },
            Hierarchy {
                outer_ring: vec![20., 20., 20.],
                holes: Some(vec![Hierarchy {
                    outer_ring: vec![21., 21., 21.],
                    holes: None,
                    expected_winding_order: navara_geometry::WindingOrder::Clockwise,
                }]),
                expected_winding_order: navara_geometry::WindingOrder::CounterClockwise,
            },
        ];

        struct BatchedHierarchy(usize, Vec<Hierarchy>);
        impl Iterator for BatchedHierarchy {
            type Item = (usize, Hierarchy);
            fn next(&mut self) -> Option<Self::Item> {
                if self.1.is_empty() {
                    return None;
                }
                let result = (self.0, self.1.remove(0));
                self.0 += 1;
                Some(result)
            }
        }

        let transferable_features = TransferablePolygonBatchedFeature::new(
            BatchedHierarchy(0, hierarchies.clone()),
            hierarchies.len(),
        );

        let mut features: Vec<Hierarchy> = vec![];
        let mut batch_ids = vec![];
        let mut batch_idxs = vec![];
        for (feature, batch_index, batch_id, _) in transferable_features {
            features.push(feature.into());
            batch_ids.push(batch_id.0);
            batch_idxs.push(batch_index.0);
        }

        // From<TransferableHierarchy> always produces Some(vec![]) even for holes: None,
        // so the expected output differs from input for the no-holes feature.
        let expected = vec![
            hierarchies[0].clone(),
            Hierarchy {
                holes: Some(vec![]),
                ..hierarchies[1].clone()
            },
            hierarchies[2].clone(),
        ];
        assert_eq!(features, expected);
        assert_eq!(batch_ids, vec![0.0, 1.0, 2.0]);
        assert_eq!(batch_idxs, vec![0, 1, 2]);
    }
}
