//! Packing of parsed MVT groups into contiguous per-type streams.
//!
//! A worker-parsed tile produces one [`ParsedLayerGroup`] per (layer, kind)
//! pair, each holding several plain buffers. Transferring and storing that many
//! small buffers is inefficient (one `postMessage` transfer entry and one
//! `BufferStore` handle per buffer), so the whole tile is packed into four
//! contiguous streams — one per element type — plus a small per-group
//! [`ParsedMvtGroupHeader`] recording the segment lengths. The main thread
//! stores the four streams in the `BufferStore` under four handles and unpacks
//! per-group geometry with [`PackedMvtStreamsCursor`].
//!
//! Segment order is fixed and must match between pack and unpack. Per group:
//! - `f64_stream`: `coords` (flattened) | `points` | `outer_rings`, `holes`
//! - `f32_stream`: `encoded_coords`
//! - `u32_stream`: `batch_indices`, then the kind's size arrays
//!   (`points_sizes` for polylines; `outer_ring_sizes`, `holes_total_sizes`,
//!   `holes_sizes`, `holes_boundaries` for polygons), then
//!   `feature_tags_flat`, `feature_tag_sizes`
//! - `u8_stream`: `expected_winding_orders`, `ring_flags`

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::config::LayerParseKind;
use super::layer::ParsedLayerPropertiesMeta;
use super::parse::{ParsedGeometry, ParsedLayerGroup, unflatten_vec3};

/// Element counts of one packed group's segments within the shared streams.
/// Segments not used by the group's kind stay 0.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedMvtSegmentLens {
    pub batch_indices: u32,
    // Point-like (f64/f32 streams).
    pub coords: u32,
    pub encoded_coords: u32,
    // Polyline (f64/u32/u8 streams).
    pub points: u32,
    pub points_sizes: u32,
    pub ring_flags: u32,
    // Polygon (f64/u32/u8 streams).
    pub outer_rings: u32,
    pub outer_ring_sizes: u32,
    pub holes: u32,
    pub holes_total_sizes: u32,
    pub holes_sizes: u32,
    pub holes_boundaries: u32,
    pub expected_winding_orders: u32,
    // Property tags (u32 stream).
    pub feature_tags_flat: u32,
    pub feature_tag_sizes: u32,
}

/// Per-group metadata carried alongside the packed streams (structured clone /
/// serde across boundaries): everything needed to slice the group back out of
/// the streams and finalize it, except the bulk geometry itself.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ParsedMvtGroupHeader {
    pub layer_id: String,
    /// `LayerParseKind` as its stable u8 tag.
    pub kind: u8,
    pub feature_count: u32,
    pub lens: ParsedMvtSegmentLens,
    /// Index into the tile's [`ParsedMvtTileMeta::layer_properties`] table.
    /// Groups of the same source layer share one entry, so a layer's property
    /// keys/values cross the worker boundary once no matter how many kinds
    /// (point/polyline/polygon) it emits.
    pub properties_index: u32,
}

/// The non-stream half of a packed tile, crossing the worker boundary as one
/// structured clone: per-group headers plus the per-layer property tables the
/// headers index into.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ParsedMvtTileMeta {
    pub headers: Vec<ParsedMvtGroupHeader>,
    /// One keys/values table per source layer, indexed by
    /// [`ParsedMvtGroupHeader::properties_index`].
    pub layer_properties: Vec<ParsedLayerPropertiesMeta>,
}

/// A whole tile's parse result packed into four per-type streams.
#[derive(Debug, Default)]
pub struct PackedMvtParseResult {
    pub f64_stream: Vec<f64>,
    pub f32_stream: Vec<f32>,
    pub u32_stream: Vec<u32>,
    pub u8_stream: Vec<u8>,
    pub meta: ParsedMvtTileMeta,
}

/// Pack parsed groups into four contiguous streams plus per-group headers.
/// Inverse of draining a [`PackedMvtStreamsCursor`] with the same headers.
pub fn pack_parsed_mvt_groups(groups: Vec<ParsedLayerGroup>) -> PackedMvtParseResult {
    // Pre-size the streams so the appends below never reallocate.
    let mut f64_cap = 0usize;
    let mut f32_cap = 0usize;
    let mut u32_cap = 0usize;
    let mut u8_cap = 0usize;
    for group in &groups {
        u32_cap += group.feature_tags_flat.len() + group.feature_tag_sizes.len();
        match &group.geometry {
            ParsedGeometry::Points {
                coords,
                batch_indices,
                encoded_coords,
            } => {
                f64_cap += coords.len() * 3;
                f32_cap += encoded_coords.len();
                u32_cap += batch_indices.len();
            }
            ParsedGeometry::Polylines {
                points,
                points_sizes,
                batch_indices,
                ring_flags,
            } => {
                f64_cap += points.len();
                u32_cap += points_sizes.len() + batch_indices.len();
                u8_cap += ring_flags.len();
            }
            ParsedGeometry::Polygons {
                outer_rings,
                outer_ring_sizes,
                holes,
                holes_total_sizes,
                holes_sizes,
                holes_boundaries,
                expected_winding_orders,
                batch_indices,
            } => {
                f64_cap += outer_rings.len() + holes.len();
                u32_cap += outer_ring_sizes.len()
                    + holes_total_sizes.len()
                    + holes_sizes.len()
                    + holes_boundaries.len()
                    + batch_indices.len();
                u8_cap += expected_winding_orders.len();
            }
        }
    }

    let mut result = PackedMvtParseResult {
        f64_stream: Vec::with_capacity(f64_cap),
        f32_stream: Vec::with_capacity(f32_cap),
        u32_stream: Vec::with_capacity(u32_cap),
        u8_stream: Vec::with_capacity(u8_cap),
        meta: ParsedMvtTileMeta {
            headers: Vec::with_capacity(groups.len()),
            layer_properties: Vec::new(),
        },
    };

    // Groups of the same source layer share their keys/values `Arc`s (see
    // `parse_layer`), so pointer identity dedups the property tables: one
    // `ParsedLayerPropertiesMeta` per layer, referenced by index from each of
    // its group headers. Layer counts are small, so a linear scan suffices.
    let mut seen_properties: Vec<(Arc<Vec<String>>, u32)> = Vec::new();

    for group in groups {
        let properties_index = match seen_properties
            .iter()
            .find(|(keys, _)| Arc::ptr_eq(keys, &group.keys))
        {
            Some((_, index)) => *index,
            None => {
                let index = result.meta.layer_properties.len() as u32;
                result
                    .meta
                    .layer_properties
                    .push(ParsedLayerPropertiesMeta::from_parts(
                        &group.keys,
                        &group.values,
                    ));
                seen_properties.push((Arc::clone(&group.keys), index));
                index
            }
        };

        let mut lens = ParsedMvtSegmentLens {
            feature_tags_flat: group.feature_tags_flat.len() as u32,
            feature_tag_sizes: group.feature_tag_sizes.len() as u32,
            ..Default::default()
        };

        match group.geometry {
            ParsedGeometry::Points {
                coords,
                mut batch_indices,
                mut encoded_coords,
            } => {
                lens.batch_indices = batch_indices.len() as u32;
                lens.coords = (coords.len() * 3) as u32;
                lens.encoded_coords = encoded_coords.len() as u32;
                result.u32_stream.append(&mut batch_indices);
                for c in coords {
                    result.f64_stream.push(c.x);
                    result.f64_stream.push(c.y);
                    result.f64_stream.push(c.z);
                }
                result.f32_stream.append(&mut encoded_coords);
            }
            ParsedGeometry::Polylines {
                mut points,
                mut points_sizes,
                mut batch_indices,
                mut ring_flags,
            } => {
                lens.batch_indices = batch_indices.len() as u32;
                lens.points = points.len() as u32;
                lens.points_sizes = points_sizes.len() as u32;
                lens.ring_flags = ring_flags.len() as u32;
                result.u32_stream.append(&mut batch_indices);
                result.u32_stream.append(&mut points_sizes);
                result.f64_stream.append(&mut points);
                result.u8_stream.append(&mut ring_flags);
            }
            ParsedGeometry::Polygons {
                mut outer_rings,
                mut outer_ring_sizes,
                mut holes,
                mut holes_total_sizes,
                mut holes_sizes,
                mut holes_boundaries,
                mut expected_winding_orders,
                mut batch_indices,
            } => {
                lens.batch_indices = batch_indices.len() as u32;
                lens.outer_rings = outer_rings.len() as u32;
                lens.outer_ring_sizes = outer_ring_sizes.len() as u32;
                lens.holes = holes.len() as u32;
                lens.holes_total_sizes = holes_total_sizes.len() as u32;
                lens.holes_sizes = holes_sizes.len() as u32;
                lens.holes_boundaries = holes_boundaries.len() as u32;
                lens.expected_winding_orders = expected_winding_orders.len() as u32;
                result.u32_stream.append(&mut batch_indices);
                result.u32_stream.append(&mut outer_ring_sizes);
                result.u32_stream.append(&mut holes_total_sizes);
                result.u32_stream.append(&mut holes_sizes);
                result.u32_stream.append(&mut holes_boundaries);
                result.f64_stream.append(&mut outer_rings);
                result.f64_stream.append(&mut holes);
                result.u8_stream.append(&mut expected_winding_orders);
            }
        }

        let mut feature_tags_flat = group.feature_tags_flat;
        let mut feature_tag_sizes = group.feature_tag_sizes;
        result.u32_stream.append(&mut feature_tags_flat);
        result.u32_stream.append(&mut feature_tag_sizes);

        result.meta.headers.push(ParsedMvtGroupHeader {
            layer_id: group.layer_id,
            kind: group.kind.as_u8(),
            feature_count: group.feature_count,
            lens,
            properties_index,
        });
    }

    result
}

/// One group sliced back out of the packed streams, ready for finalization.
#[derive(Debug, PartialEq)]
pub struct UnpackedMvtGroup {
    pub geometry: ParsedGeometry,
    pub feature_tags_flat: Vec<u32>,
    pub feature_tag_sizes: Vec<u32>,
}

/// Slices groups back out of the four packed streams, advancing cumulative
/// offsets per call (no O(n²) drain-from-front). Call [`next_group`] once per
/// header, in header order.
///
/// [`next_group`]: PackedMvtStreamsCursor::next_group
pub struct PackedMvtStreamsCursor {
    f64_stream: Vec<f64>,
    f32_stream: Vec<f32>,
    u32_stream: Vec<u32>,
    u8_stream: Vec<u8>,
    f64_offset: usize,
    f32_offset: usize,
    u32_offset: usize,
    u8_offset: usize,
}

impl PackedMvtStreamsCursor {
    pub fn new(
        f64_stream: Vec<f64>,
        f32_stream: Vec<f32>,
        u32_stream: Vec<u32>,
        u8_stream: Vec<u8>,
    ) -> Self {
        Self {
            f64_stream,
            f32_stream,
            u32_stream,
            u8_stream,
            f64_offset: 0,
            f32_offset: 0,
            u32_offset: 0,
            u8_offset: 0,
        }
    }

    /// Take the next `len` f64s as an owned `Vec` (the buffer downstream
    /// components keep). When the segment spans the entire stream — a tile
    /// whose f64 data belongs to a single group, the common case — the stream's
    /// allocation is moved out instead of copied. `take_f32`/`take_u32`/
    /// `take_u8` mirror this.
    fn take_f64(&mut self, len: u32) -> Option<Vec<f64>> {
        if len == 0 {
            return Some(Vec::new());
        }
        let end = self.f64_offset + len as usize;
        if self.f64_offset == 0 && end == self.f64_stream.len() {
            self.f64_offset = end;
            return Some(std::mem::take(&mut self.f64_stream));
        }
        let out = self.f64_stream.get(self.f64_offset..end)?.to_vec();
        self.f64_offset = end;
        Some(out)
    }

    /// Borrow the next `len` f64s, advancing the offset. For segments that get
    /// re-shaped rather than stored (point coords, unflattened into `Vec3`s),
    /// so the reshape reads the stream directly instead of an intermediate
    /// `to_vec` copy.
    fn take_f64_slice(&mut self, len: u32) -> Option<&[f64]> {
        if len == 0 {
            return Some(&[]);
        }
        let end = self.f64_offset + len as usize;
        let out = self.f64_stream.get(self.f64_offset..end)?;
        self.f64_offset = end;
        Some(out)
    }

    fn take_f32(&mut self, len: u32) -> Option<Vec<f32>> {
        if len == 0 {
            return Some(Vec::new());
        }
        let end = self.f32_offset + len as usize;
        if self.f32_offset == 0 && end == self.f32_stream.len() {
            self.f32_offset = end;
            return Some(std::mem::take(&mut self.f32_stream));
        }
        let out = self.f32_stream.get(self.f32_offset..end)?.to_vec();
        self.f32_offset = end;
        Some(out)
    }

    fn take_u32(&mut self, len: u32) -> Option<Vec<u32>> {
        if len == 0 {
            return Some(Vec::new());
        }
        let end = self.u32_offset + len as usize;
        if self.u32_offset == 0 && end == self.u32_stream.len() {
            self.u32_offset = end;
            return Some(std::mem::take(&mut self.u32_stream));
        }
        let out = self.u32_stream.get(self.u32_offset..end)?.to_vec();
        self.u32_offset = end;
        Some(out)
    }

    fn take_u8(&mut self, len: u32) -> Option<Vec<u8>> {
        if len == 0 {
            return Some(Vec::new());
        }
        let end = self.u8_offset + len as usize;
        if self.u8_offset == 0 && end == self.u8_stream.len() {
            self.u8_offset = end;
            return Some(std::mem::take(&mut self.u8_stream));
        }
        let out = self.u8_stream.get(self.u8_offset..end)?.to_vec();
        self.u8_offset = end;
        Some(out)
    }

    /// Slice the next group's segments out of the streams. Returns `None` when
    /// the header's kind tag is unknown or a segment exceeds the stream bounds
    /// (corrupt/mismatched headers); the cursor must not be reused after that.
    pub fn next_group(&mut self, header: &ParsedMvtGroupHeader) -> Option<UnpackedMvtGroup> {
        let kind = LayerParseKind::from_u8(header.kind)?;
        let lens = &header.lens;

        let batch_indices = self.take_u32(lens.batch_indices)?;
        let geometry = match kind {
            LayerParseKind::Point | LayerParseKind::Billboard | LayerParseKind::Text => {
                // Unflatten straight off the stream: the `Vec3`s are the owned
                // buffer, so an intermediate `to_vec` would only be dropped.
                let coords = unflatten_vec3(self.take_f64_slice(lens.coords)?);
                let encoded_coords = self.take_f32(lens.encoded_coords)?;
                ParsedGeometry::Points {
                    coords,
                    batch_indices,
                    encoded_coords,
                }
            }
            LayerParseKind::Polyline => {
                let points_sizes = self.take_u32(lens.points_sizes)?;
                let points = self.take_f64(lens.points)?;
                let ring_flags = self.take_u8(lens.ring_flags)?;
                ParsedGeometry::Polylines {
                    points,
                    points_sizes,
                    batch_indices,
                    ring_flags,
                }
            }
            LayerParseKind::Polygon => {
                let outer_ring_sizes = self.take_u32(lens.outer_ring_sizes)?;
                let holes_total_sizes = self.take_u32(lens.holes_total_sizes)?;
                let holes_sizes = self.take_u32(lens.holes_sizes)?;
                let holes_boundaries = self.take_u32(lens.holes_boundaries)?;
                let outer_rings = self.take_f64(lens.outer_rings)?;
                let holes = self.take_f64(lens.holes)?;
                let expected_winding_orders = self.take_u8(lens.expected_winding_orders)?;
                ParsedGeometry::Polygons {
                    outer_rings,
                    outer_ring_sizes,
                    holes,
                    holes_total_sizes,
                    holes_sizes,
                    holes_boundaries,
                    expected_winding_orders,
                    batch_indices,
                }
            }
        };

        let feature_tags_flat = self.take_u32(lens.feature_tags_flat)?;
        let feature_tag_sizes = self.take_u32(lens.feature_tag_sizes)?;

        Some(UnpackedMvtGroup {
            geometry,
            feature_tags_flat,
            feature_tag_sizes,
        })
    }
}

#[cfg(test)]
mod test {
    use std::sync::Arc;

    use geozero::mvt::tile;
    use navara_math::Vec3;

    use super::*;

    fn points_group() -> ParsedLayerGroup {
        ParsedLayerGroup {
            layer_id: "poi".to_string(),
            kind: LayerParseKind::Point,
            feature_count: 2,
            feature_tags_flat: vec![0, 0, 1, 1],
            feature_tag_sizes: vec![2, 2],
            keys: Arc::new(vec!["name".to_string()]),
            values: Arc::new(vec![tile::Value {
                string_value: Some("a".to_string()),
                ..Default::default()
            }]),
            geometry: ParsedGeometry::Points {
                coords: vec![Vec3::new(1.0, 2.0, 0.0), Vec3::new(3.0, 4.0, 0.0)],
                batch_indices: vec![0, 1],
                encoded_coords: vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
            },
        }
    }

    fn polyline_group() -> ParsedLayerGroup {
        ParsedLayerGroup {
            layer_id: "roads".to_string(),
            kind: LayerParseKind::Polyline,
            feature_count: 1,
            feature_tags_flat: vec![],
            feature_tag_sizes: vec![0],
            keys: Arc::new(vec![]),
            values: Arc::new(vec![]),
            geometry: ParsedGeometry::Polylines {
                points: vec![10.0, 11.0, 0.0, 12.0, 13.0, 0.0, 14.0, 15.0, 0.0],
                points_sizes: vec![9],
                batch_indices: vec![0],
                ring_flags: vec![1],
            },
        }
    }

    fn polygon_group() -> ParsedLayerGroup {
        ParsedLayerGroup {
            layer_id: "buildings".to_string(),
            kind: LayerParseKind::Polygon,
            feature_count: 2,
            feature_tags_flat: vec![0, 1, 0, 2],
            feature_tag_sizes: vec![2, 2],
            keys: Arc::new(vec!["height".to_string()]),
            values: Arc::new(vec![
                tile::Value {
                    double_value: Some(10.0),
                    ..Default::default()
                },
                tile::Value {
                    double_value: Some(20.0),
                    ..Default::default()
                },
            ]),
            geometry: ParsedGeometry::Polygons {
                // Feature 0: triangle with one hole; feature 1: triangle, no holes.
                outer_rings: vec![
                    0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, // ring 0
                    5.0, 5.0, 0.0, 6.0, 5.0, 0.0, 5.0, 6.0, 0.0, // ring 1
                ],
                outer_ring_sizes: vec![9, 9],
                holes: vec![0.2, 0.2, 0.0, 0.4, 0.2, 0.0, 0.2, 0.4, 0.0],
                holes_total_sizes: vec![9, 0],
                holes_sizes: vec![9],
                holes_boundaries: vec![1, 0],
                expected_winding_orders: vec![0, 1, 0],
                batch_indices: vec![0, 1],
            },
        }
    }

    fn cursor_for(
        packed: PackedMvtParseResult,
    ) -> (Vec<ParsedMvtGroupHeader>, PackedMvtStreamsCursor) {
        let cursor = PackedMvtStreamsCursor::new(
            packed.f64_stream,
            packed.f32_stream,
            packed.u32_stream,
            packed.u8_stream,
        );
        (packed.meta.headers, cursor)
    }

    fn assert_round_trip(groups: Vec<ParsedLayerGroup>) {
        // Snapshot expectations before the pack consumes the groups.
        let mut expected = Vec::new();
        for g in &groups {
            let geometry = match &g.geometry {
                ParsedGeometry::Points {
                    coords,
                    batch_indices,
                    encoded_coords,
                } => ParsedGeometry::Points {
                    coords: coords.clone(),
                    batch_indices: batch_indices.clone(),
                    encoded_coords: encoded_coords.clone(),
                },
                ParsedGeometry::Polylines {
                    points,
                    points_sizes,
                    batch_indices,
                    ring_flags,
                } => ParsedGeometry::Polylines {
                    points: points.clone(),
                    points_sizes: points_sizes.clone(),
                    batch_indices: batch_indices.clone(),
                    ring_flags: ring_flags.clone(),
                },
                ParsedGeometry::Polygons {
                    outer_rings,
                    outer_ring_sizes,
                    holes,
                    holes_total_sizes,
                    holes_sizes,
                    holes_boundaries,
                    expected_winding_orders,
                    batch_indices,
                } => ParsedGeometry::Polygons {
                    outer_rings: outer_rings.clone(),
                    outer_ring_sizes: outer_ring_sizes.clone(),
                    holes: holes.clone(),
                    holes_total_sizes: holes_total_sizes.clone(),
                    holes_sizes: holes_sizes.clone(),
                    holes_boundaries: holes_boundaries.clone(),
                    expected_winding_orders: expected_winding_orders.clone(),
                    batch_indices: batch_indices.clone(),
                },
            };
            expected.push((
                g.layer_id.clone(),
                g.kind,
                g.feature_count,
                UnpackedMvtGroup {
                    geometry,
                    feature_tags_flat: g.feature_tags_flat.clone(),
                    feature_tag_sizes: g.feature_tag_sizes.clone(),
                },
                ParsedLayerPropertiesMeta::from_parts(&g.keys, &g.values),
            ));
        }

        let packed = pack_parsed_mvt_groups(groups);
        assert_eq!(packed.meta.headers.len(), expected.len());

        let layer_properties = packed.meta.layer_properties.clone();
        let (headers, mut cursor) = cursor_for(packed);
        for (header, (layer_id, kind, feature_count, group, properties)) in
            headers.iter().zip(expected)
        {
            assert_eq!(header.layer_id, layer_id);
            assert_eq!(header.kind, kind.as_u8());
            assert_eq!(header.feature_count, feature_count);
            assert_eq!(
                layer_properties.get(header.properties_index as usize),
                Some(&properties)
            );
            let unpacked = cursor.next_group(header).expect("group should unpack");
            assert_eq!(unpacked, group);
        }
    }

    #[test]
    fn it_should_round_trip_mixed_groups() {
        assert_round_trip(vec![points_group(), polyline_group(), polygon_group()]);
    }

    #[test]
    fn it_should_round_trip_a_single_polygon_group() {
        assert_round_trip(vec![polygon_group()]);
    }

    #[test]
    fn it_should_pack_no_groups_into_empty_streams() {
        let packed = pack_parsed_mvt_groups(Vec::new());
        assert!(packed.f64_stream.is_empty());
        assert!(packed.f32_stream.is_empty());
        assert!(packed.u32_stream.is_empty());
        assert!(packed.u8_stream.is_empty());
        assert!(packed.meta.headers.is_empty());
        assert!(packed.meta.layer_properties.is_empty());
    }

    #[test]
    fn it_should_reject_headers_exceeding_stream_bounds() {
        let packed = pack_parsed_mvt_groups(vec![points_group()]);
        let (headers, mut cursor) = cursor_for(packed);
        let mut header = headers[0].clone();
        header.lens.coords += 3;
        assert!(cursor.next_group(&header).is_none());
    }

    #[test]
    fn it_should_reject_an_unknown_kind_tag() {
        let packed = pack_parsed_mvt_groups(vec![points_group()]);
        let (headers, mut cursor) = cursor_for(packed);
        let mut header = headers[0].clone();
        header.kind = 99;
        assert!(cursor.next_group(&header).is_none());
    }

    /// Groups sharing a layer's keys/values `Arc`s must pack a single property
    /// table referenced by index, not one copy per group.
    #[test]
    fn it_should_share_one_property_table_across_groups_of_a_layer() {
        let base = polygon_group();
        let keys = Arc::clone(&base.keys);
        let values = Arc::clone(&base.values);
        let mut point = points_group();
        point.layer_id = base.layer_id.clone();
        point.keys = Arc::clone(&keys);
        point.values = Arc::clone(&values);
        // A group from a different layer (its own Arcs) gets its own entry.
        let other = polyline_group();

        let packed = pack_parsed_mvt_groups(vec![base, point, other]);
        assert_eq!(packed.meta.layer_properties.len(), 2);
        assert_eq!(packed.meta.headers[0].properties_index, 0);
        assert_eq!(packed.meta.headers[1].properties_index, 0);
        assert_eq!(packed.meta.headers[2].properties_index, 1);
        assert_eq!(
            packed.meta.layer_properties[0],
            ParsedLayerPropertiesMeta::from_parts(&keys, &values)
        );
    }

    /// A tile whose f64 data belongs to a single group moves the stream
    /// allocation out instead of copying, and later zero-length segments must
    /// still unpack.
    #[test]
    fn it_should_unpack_after_the_whole_stream_fast_path() {
        // A polyline group is the sole f64 consumer; its trailing zero-length
        // tag segments exercise the post-take zero-length reads.
        let packed = pack_parsed_mvt_groups(vec![polyline_group()]);
        let expected_points = match &polyline_group().geometry {
            ParsedGeometry::Polylines { points, .. } => points.clone(),
            _ => unreachable!(),
        };
        let (headers, mut cursor) = cursor_for(packed);
        let unpacked = cursor.next_group(&headers[0]).expect("group should unpack");
        match unpacked.geometry {
            ParsedGeometry::Polylines { points, .. } => assert_eq!(points, expected_points),
            _ => panic!("expected polylines"),
        }
    }
}
