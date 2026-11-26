use navara_core::{Aabb, Extent, Radians};
use navara_geometry::{
    FloatAttribute, Hierarchy, PolygonGeometryAttributes, PolygonResource, UintAttribute,
};
use navara_math::{FloatType, Vec3};
use navara_wasm_types::{
    ExtentRadianF32, PolygonMaterial,
    polygon::{
        ConstructedPolygonGeometry, ConstructedPolygonOutlineGeometry, PolygonGeometry,
        TransferablePolygonBatchedFeature,
    },
};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(js_name = constructPolygonBatchedFeature)]
pub fn construct_polygon_batched_feature(
    features: TransferablePolygonBatchedFeature,
    material: PolygonMaterial,
    flat: bool,
    tile_extent: Option<ExtentRadianF32>,
) -> Option<ConstructedPolygonGeometry> {
    if flat {
        construct_flat_polygon(features, material)
    } else {
        construct_polygon(features, material, tile_extent)
    }
}

pub fn construct_polygon(
    mut features: TransferablePolygonBatchedFeature,
    material: PolygonMaterial,
    tile_extent: Option<ExtentRadianF32>,
) -> Option<ConstructedPolygonGeometry> {
    let mut polygon_resource = PolygonResource::new();
    let material: navara_material::PolygonMaterial = material.into();
    let crs: navara_core::CRS = (&features.crs).into();

    // Determine whether to use RTE based on tile_extent availability
    // When tile_extent is Some: use RTC (simpler, pre-calculated center)
    // When tile_extent is None: use RTE (more flexible, no translation needed)
    let use_rte = tile_extent.is_none();

    // Pre-calculate RTC center if tile_extent is available
    let rtc_center = tile_extent.as_ref().map(|extent| {
        let extent_radians: Extent<FloatType, Radians> = (*extent).into();
        calculate_tile_center(&extent_radians)
    });

    let mut combined_attributes = PolygonGeometryAttributes {
        position: (!use_rte).then(|| FloatAttribute::new(vec![], 3)),
        position_3d_high: (use_rte).then(|| FloatAttribute::new(vec![], 3)),
        position_3d_low: (use_rte).then(|| FloatAttribute::new(vec![], 3)),
        normal: None,
        scale_normal_and_cap: Some(FloatAttribute::new(vec![], 4)),
        batch_ids: Some(FloatAttribute::new(vec![], 1)),
        batch_index: Some(UintAttribute::new(vec![], 1)),
    };
    let mut indices = vec![];
    let mut index_offset = 0;

    // Outline accumulators
    let mut outline_positions: Vec<f32> = Vec::new();
    let mut outline_position_high: Vec<f32> = Vec::new();
    let mut outline_position_low: Vec<f32> = Vec::new();
    let mut outline_scale_normal_and_cap: Vec<f32> = Vec::new();
    let mut outline_skip_indices: Vec<u32> = Vec::new();
    let mut outline_batch_index: Vec<f32> = Vec::new();

    let mut combined_extent: Option<Extent<f64, Radians>> = None;
    for idx in 0..features.length {
        let (transferable_hierarchy, batch_idx, batch_id, outline_edges) =
            features.to_transferable_hierarchy_by_index(idx);
        let geometry_hierarchy: Hierarchy = transferable_hierarchy.into();

        let (extent_opt, polygon_result_opt) =
            navara_feature_component::polygon::construct_polygon_feature(
                geometry_hierarchy,
                outline_edges.as_deref(),
                &crs,
                &material,
                &mut polygon_resource,
                use_rte, // Use RTE when tile_extent is None, RTC when Some
            );

        let (extent, mut polygon_result) = match (extent_opt, polygon_result_opt) {
            (Some(extent), Some(polygon_result)) => (extent, polygon_result),
            _ => continue,
        };

        combined_extent = Some(match combined_extent {
            Some(e) => e.union(extent),
            None => extent,
        });

        // Calculate position length based on mode (RTE or RTC)
        let position_length = if use_rte {
            let pos = polygon_result
                .geometry
                .attributes
                .position_3d_high
                .as_ref()
                .unwrap();
            pos.data.len() / pos.size as usize
        } else {
            let pos = polygon_result
                .geometry
                .attributes
                .position
                .as_ref()
                .unwrap();
            pos.data.len() / pos.size as usize
        };
        if position_length == 0 {
            continue;
        }

        // Append position attributes based on mode
        if use_rte {
            // RTE mode: append high/low positions
            combined_attributes
                .position_3d_high
                .as_mut()
                .unwrap()
                .data
                .append(
                    &mut polygon_result
                        .geometry
                        .attributes
                        .position_3d_high
                        .unwrap()
                        .data,
                );
            combined_attributes
                .position_3d_low
                .as_mut()
                .unwrap()
                .data
                .append(
                    &mut polygon_result
                        .geometry
                        .attributes
                        .position_3d_low
                        .unwrap()
                        .data,
                );
        } else {
            // RTC mode: append regular positions
            combined_attributes
                .position
                .as_mut()
                .unwrap()
                .data
                .append(&mut polygon_result.geometry.attributes.position.unwrap().data);
        }
        if let Some(normal) = polygon_result.geometry.attributes.normal.as_mut() {
            combined_attributes
                .normal
                .get_or_insert_with(|| FloatAttribute::new(vec![], 3))
                .data
                .append(&mut normal.data);
        }
        combined_attributes
            .scale_normal_and_cap
            .as_mut()
            .unwrap()
            .data
            .append(
                &mut polygon_result
                    .geometry
                    .attributes
                    .scale_normal_and_cap
                    .unwrap()
                    .data,
            );

        let mut batch_ids = vec![];
        let mut batch_indices = vec![];
        for _i in 0..position_length {
            batch_ids.push(batch_id.0);

            batch_indices.push(batch_idx.0);
        }

        combined_attributes
            .batch_ids
            .as_mut()
            .unwrap()
            .data
            .append(&mut batch_ids);
        combined_attributes
            .batch_index
            .as_mut()
            .unwrap()
            .data
            .append(&mut batch_indices);

        if index_offset == 0 {
            indices.append(&mut polygon_result.geometry.indices);
        } else {
            for i in polygon_result.geometry.indices {
                indices.push(i + index_offset);
            }
        }

        index_offset += position_length as u32;

        // Accumulate outline geometry
        if let Some(outline) = polygon_result.outline {
            let vertex_offset = (outline_positions.len() / 3) as u32;
            // Add boundary skip to prevent connecting separate polygons
            if vertex_offset > 0 {
                outline_skip_indices.push(vertex_offset - 1);
            }
            for &idx in &outline.skip_indices {
                outline_skip_indices.push(idx + vertex_offset);
            }
            let outline_vertex_count = outline.position.data.len() / 3;
            for _ in 0..outline_vertex_count {
                outline_batch_index.push(batch_idx.0 as f32);
            }
            outline_positions.extend_from_slice(&outline.position.data);
            if let Some(high) = &outline.position_3d_high {
                outline_position_high.extend_from_slice(&high.data);
            }
            if let Some(low) = &outline.position_3d_low {
                outline_position_low.extend_from_slice(&low.data);
            }
            outline_scale_normal_and_cap.extend_from_slice(&outline.scale_normal_and_cap.data);
        }
    }

    let combined_extent = combined_extent?;

    // Handle RTC translation based on mode
    let rtc_translation = if use_rte {
        // RTE mode: positions are already encoded as high/low, no translation needed
        None
    } else {
        // RTC mode: calculate translation and translate positions
        let center = rtc_center.unwrap();
        translate_positions_to_center(&mut combined_attributes, &center);
        // Also translate outline positions to RTC space
        for [x, y, z] in outline_positions.as_chunks_mut::<3>().0 {
            *x -= center.x as f32;
            *y -= center.y as f32;
            *z -= center.z as f32;
        }
        Some(center.into())
    };

    let outline = if outline_positions.is_empty() {
        None
    } else {
        // RTE mode fills high/low; RTC mode leaves them empty (positions are
        // tile-center relative instead).
        let outline_high_low = (use_rte && !outline_position_high.is_empty()).then(|| {
            (
                navara_wasm_types::FloatAttribute::new(outline_position_high, 3),
                navara_wasm_types::FloatAttribute::new(outline_position_low, 3),
            )
        });
        let (outline_high, outline_low) = match outline_high_low {
            Some((high, low)) => (Some(high), Some(low)),
            None => (None, None),
        };
        Some(ConstructedPolygonOutlineGeometry::new(
            navara_wasm_types::FloatAttribute::new(outline_positions, 3),
            outline_high,
            outline_low,
            navara_wasm_types::FloatAttribute::new(outline_scale_normal_and_cap, 4),
            outline_skip_indices,
            Some(navara_wasm_types::FloatAttribute::new(
                outline_batch_index,
                1,
            )),
        ))
    };

    Some(ConstructedPolygonGeometry::new(
        PolygonGeometry::new(combined_attributes.into(), indices),
        Some((&combined_extent).into()),
        rtc_translation,
        outline,
    ))
}

/// Calculate the geometric center of a tile extent in ECEF coordinates
/// This is used as the RTC (Relative-To-Center) translation origin
fn calculate_tile_center(extent: &Extent<FloatType, Radians>) -> Vec3 {
    let aabb = Aabb::from_extent_f64(*extent, 0., 1.);

    aabb.center
}

/// Translate all vertex positions to be relative to the tile center
/// This converts world-space positions to local RTC space
fn translate_positions_to_center(attributes: &mut PolygonGeometryAttributes, center: &Vec3) {
    if let Some(position_attr) = attributes.position.as_mut() {
        let positions = &mut position_attr.data;
        let component_count = position_attr.size as usize;

        // Iterate through positions in chunks (x, y, z)
        for i in 0..(positions.len() / component_count) {
            let idx = i * component_count;
            positions[idx] -= center.x as f32; // X
            positions[idx + 1] -= center.y as f32; // Y
            positions[idx + 2] -= center.z as f32; // Z
        }
    }
}

pub fn construct_flat_polygon(
    mut features: TransferablePolygonBatchedFeature,
    material: PolygonMaterial,
) -> Option<ConstructedPolygonGeometry> {
    let mut polygon_resource = PolygonResource::new();
    let material: navara_material::PolygonMaterial = material.into();

    let mut combined_attributes = PolygonGeometryAttributes {
        position: Some(FloatAttribute::new(vec![], 3)),
        position_3d_high: None,
        position_3d_low: None,
        normal: None,
        scale_normal_and_cap: None,
        batch_ids: Some(FloatAttribute::new(vec![], 1)),
        batch_index: Some(UintAttribute::new(vec![], 1)),
    };
    let mut indices = vec![];
    let mut index_offset = 0;

    for idx in 0..features.length {
        let (transferable_hierarchy, batch_idx, batch_id, _) =
            features.to_transferable_hierarchy_by_index(idx);
        let geometry_hierarchy: Hierarchy = transferable_hierarchy.into();

        let polygon_result_opt = navara_feature_component::polygon::construct_flat_polygon_feature(
            geometry_hierarchy,
            &material,
            &mut polygon_resource,
            false, // use_rte = false for batched MVT features
        );

        let mut polygon_result = match polygon_result_opt {
            Some(polygon_result) => polygon_result,
            None => continue,
        };

        let position_length = polygon_result
            .geometry
            .attributes
            .position
            .as_ref()
            .unwrap()
            .data
            .len()
            / polygon_result
                .geometry
                .attributes
                .position
                .as_ref()
                .unwrap()
                .size as usize;
        if position_length == 0 {
            continue;
        }

        combined_attributes
            .position
            .as_mut()
            .unwrap()
            .data
            .append(&mut polygon_result.geometry.attributes.position.unwrap().data);

        let mut batch_ids = vec![];
        let mut batch_indices = vec![];
        for _i in 0..position_length {
            batch_ids.push(batch_id.0);

            batch_indices.push(batch_idx.0);
        }

        combined_attributes
            .batch_ids
            .as_mut()
            .unwrap()
            .data
            .append(&mut batch_ids);
        combined_attributes
            .batch_index
            .as_mut()
            .unwrap()
            .data
            .append(&mut batch_indices);

        if index_offset == 0 {
            indices.append(&mut polygon_result.geometry.indices);
        } else {
            for i in polygon_result.geometry.indices {
                indices.push(i + index_offset);
            }
        }

        index_offset += position_length as u32;
    }

    // Flat polygons don't have extent or RTC translation or outline
    Some(ConstructedPolygonGeometry::new(
        PolygonGeometry::new(combined_attributes.into(), indices),
        None,
        None, // No RTC translation for flat polygons
        None, // No outline for flat polygons
    ))
}
