use navara_core::{Extent, Radians};
use navara_feature_component::polyline::{
    construct_flat_polyline_feature, construct_polyline_feature,
};
use navara_geometry::PolylineGeometryAttributes;
use navara_wasm_types::{
    PolylineMaterial,
    polyline::{ConstructedPolylineGeometry, PolylineGeometry, TransferablePolylineBatchedFeature},
};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(js_name = constructPolylineBatchedFeature)]
pub fn construct_polyline_batched_feature(
    features: TransferablePolylineBatchedFeature,
    material: PolylineMaterial,
    flat: bool,
) -> Option<ConstructedPolylineGeometry> {
    if flat {
        construct_flat_polyline(features, material)
    } else {
        construct_polyline(features, material)
    }
}

fn construct_polyline(
    mut features: TransferablePolylineBatchedFeature,
    material: PolylineMaterial,
) -> Option<ConstructedPolylineGeometry> {
    let material: navara_material::PolylineMaterial = material.into();
    let crs: navara_core::CRS = (&features.crs).into();

    let mut combined_attributes = PolylineGeometryAttributes::with_batch_id_and_rte();
    let mut indices = vec![];
    let mut index_offset = 0;

    let mut combined_extent: Option<Extent<f64, Radians>> = None;

    for idx in 0..features.length {
        let (geometry, batch_index, batch_id, ring) = features.to_transferable_by_index(idx);

        // TODO: Support RTC for MVT without clamp_to_ground.
        let Some((extent, mut constructed_geometry)) =
            construct_polyline_feature(&material, geometry, &crs, true, ring)
        else {
            continue;
        };

        let position_length = constructed_geometry.attributes.position.data.len()
            / constructed_geometry.attributes.position.size as usize;
        if position_length == 0 {
            continue;
        }

        combined_extent = Some(match combined_extent {
            Some(e) => e.union(extent),
            None => extent,
        });

        combined_attributes
            .position
            .data
            .append(&mut constructed_geometry.attributes.position.data);
        if let (Some(combined), Some(ref mut src)) = (
            combined_attributes.start.as_mut(),
            constructed_geometry.attributes.start,
        ) {
            combined.data.append(&mut src.data);
        }
        if let (Some(combined), Some(ref mut src)) = (
            combined_attributes.forward_offset.as_mut(),
            constructed_geometry.attributes.forward_offset,
        ) {
            combined.data.append(&mut src.data);
        }
        if let (Some(combined), Some(ref mut src)) = (
            combined_attributes.start_normals.as_mut(),
            constructed_geometry.attributes.start_normals,
        ) {
            combined.data.append(&mut src.data);
        }
        if let (Some(combined), Some(ref mut src)) = (
            combined_attributes
                .end_normal_and_texture_coordinate_normalization_x
                .as_mut(),
            constructed_geometry
                .attributes
                .end_normal_and_texture_coordinate_normalization_x,
        ) {
            combined.data.append(&mut src.data);
        }
        combined_attributes
            .right_normal_and_texture_coordinate_normalization_y
            .data
            .append(
                &mut constructed_geometry
                    .attributes
                    .right_normal_and_texture_coordinate_normalization_y
                    .data,
            );

        let mut batch_ids = vec![];
        let mut batch_indices = vec![];
        for _i in 0..position_length {
            batch_ids.push(batch_id.0);

            batch_indices.push(batch_index.0);
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

        if let (Some(combined), Some(geo)) = (
            &mut combined_attributes.position_high,
            &mut constructed_geometry.attributes.position_high,
        ) {
            combined.data.append(&mut geo.data);
        }
        if let (Some(combined), Some(geo)) = (
            &mut combined_attributes.position_low,
            &mut constructed_geometry.attributes.position_low,
        ) {
            combined.data.append(&mut geo.data);
        }
        if let (Some(combined), Some(geo)) = (
            &mut combined_attributes.start_high,
            &mut constructed_geometry.attributes.start_high,
        ) {
            combined.data.append(&mut geo.data);
        }
        if let (Some(combined), Some(geo)) = (
            &mut combined_attributes.start_low,
            &mut constructed_geometry.attributes.start_low,
        ) {
            combined.data.append(&mut geo.data);
        }
        if let (Some(combined), Some(geo)) = (
            &mut combined_attributes.end_high,
            &mut constructed_geometry.attributes.end_high,
        ) {
            combined.data.append(&mut geo.data);
        }
        if let (Some(combined), Some(geo)) = (
            &mut combined_attributes.end_low,
            &mut constructed_geometry.attributes.end_low,
        ) {
            combined.data.append(&mut geo.data);
        }

        if index_offset == 0 {
            indices.append(&mut constructed_geometry.indices);
        } else {
            for i in constructed_geometry.indices {
                indices.push(i + index_offset);
            }
        }

        index_offset += position_length as u32;
    }

    Some(ConstructedPolylineGeometry::new(
        Some((&combined_extent?).into()),
        PolylineGeometry::new(combined_attributes.into(), indices),
    ))
}

fn construct_flat_polyline(
    mut features: TransferablePolylineBatchedFeature,
    material: PolylineMaterial,
) -> Option<ConstructedPolylineGeometry> {
    let material: navara_material::PolylineMaterial = material.into();

    let mut combined_attributes = PolylineGeometryAttributes::with_batch_id();
    let mut indices = vec![];
    let mut index_offset = 0;

    for idx in 0..features.length {
        let (geometry, batch_index, batch_id, ring) = features.to_transferable_by_index(idx);

        let Some(mut constructed_geometry) =
            construct_flat_polyline_feature(geometry, &material, ring)
        else {
            continue;
        };

        let position_length = constructed_geometry.attributes.position.data.len()
            / constructed_geometry.attributes.position.size as usize;
        if position_length == 0 {
            continue;
        }

        combined_attributes
            .position
            .data
            .append(&mut constructed_geometry.attributes.position.data);
        if let (Some(combined), Some(ref mut src)) = (
            combined_attributes.start.as_mut(),
            constructed_geometry.attributes.start,
        ) {
            combined.data.append(&mut src.data);
        }
        if let (Some(combined), Some(ref mut src)) = (
            combined_attributes.forward_offset.as_mut(),
            constructed_geometry.attributes.forward_offset,
        ) {
            combined.data.append(&mut src.data);
        }
        if let (Some(combined), Some(ref mut src)) = (
            combined_attributes.start_normals.as_mut(),
            constructed_geometry.attributes.start_normals,
        ) {
            combined.data.append(&mut src.data);
        }
        if let (Some(combined), Some(ref mut src)) = (
            combined_attributes
                .end_normal_and_texture_coordinate_normalization_x
                .as_mut(),
            constructed_geometry
                .attributes
                .end_normal_and_texture_coordinate_normalization_x,
        ) {
            combined.data.append(&mut src.data);
        }
        combined_attributes
            .right_normal_and_texture_coordinate_normalization_y
            .data
            .append(
                &mut constructed_geometry
                    .attributes
                    .right_normal_and_texture_coordinate_normalization_y
                    .data,
            );

        let mut batch_ids = vec![];
        let mut batch_indices = vec![];
        for _i in 0..position_length {
            batch_ids.push(batch_id.0);
            batch_indices.push(batch_index.0);
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
            indices.append(&mut constructed_geometry.indices);
        } else {
            for i in constructed_geometry.indices {
                indices.push(i + index_offset);
            }
        }

        index_offset += position_length as u32;
    }

    // Flat polylines don't have extent since they're in flat coordinates
    Some(ConstructedPolylineGeometry::new(
        None,
        PolylineGeometry::new(combined_attributes.into(), indices),
    ))
}
