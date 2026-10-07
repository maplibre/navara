use navara_core::{CRS, Ellipsoid, EncodedVec3, Meters, WGS84_64};
use navara_math::{EPSILON10, EqualEpsilon, FloatType, RADIANS_PER_DEGREE, Vec2, Vec3};

use crate::{FloatAttribute, helpers::vec::unpack_flatten_vec3_from_f32};

use super::{
    HierarchyDVec3, PolygonGeometryAttributes, PolygonResource, WindingOrder,
    helpers::{
        compute_outline_positions, compute_wall_geometry, create_geometry_from_positions,
        polygons_from_hierarchy, project_to_2d, scale_to_geodetic_height_extruded,
    },
    types::Polygon,
};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PolygonGeometry {
    pub attributes: PolygonGeometryAttributes,
    pub indices: Vec<u32>,
}

/// Longest cap triangle edge, in radians, unless the options set one.
pub const DEFAULT_POLYGON_GRANULARITY: f32 = RADIANS_PER_DEGREE as f32;

pub struct PolygonGeometryOptions {
    pub hierarchy: HierarchyDVec3,
    pub granularity: f32,
    pub crs: CRS,
    pub clamp_to_ground: bool,
    pub extruded_height: f32,
    pub height: f32,
    pub per_position_height: bool,
    pub use_rte: bool,
    pub outline: bool,
}

impl Default for PolygonGeometryOptions {
    fn default() -> Self {
        Self {
            hierarchy: HierarchyDVec3 {
                outer_ring: vec![],
                holes: None,
                expected_winding_order: WindingOrder::Unknown,
            },
            granularity: DEFAULT_POLYGON_GRANULARITY,
            crs: Default::default(),
            clamp_to_ground: false,
            extruded_height: 0.,
            height: 1.,
            per_position_height: false,
            use_rte: true, // Default to true for individual features
            outline: false,
        }
    }
}

pub struct PolygonGeometryResult {
    pub geometry: PolygonGeometry,
    pub outline: Option<PolygonOutlineGeometry>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PolygonOutlineGeometry {
    pub position: FloatAttribute,
    /// RTE-encoded positions (present when use_rte). `position` is still
    /// emitted alongside for bounding volumes and non-RTE fallbacks.
    pub position_3d_high: Option<FloatAttribute>,
    pub position_3d_low: Option<FloatAttribute>,
    pub scale_normal_and_cap: FloatAttribute,
    pub skip_indices: Vec<u32>, // [a,b ..] segments (a, a+1), (b, b+1) will be skipped
}

/// Creates a flat polygon geometry from a polygon hierarchy in Cartesian coordinates.
/// This function assumes the polygon is on a flat plane, not on an ellipsoid.
pub fn create_flat_polygon_geometry(
    options: PolygonGeometryOptions,
    polygon_resource: &mut PolygonResource,
) -> Option<PolygonGeometryResult> {
    let polygon_hierarchy = &options.hierarchy;

    let outer_positions = &polygon_hierarchy.outer_ring;
    if outer_positions.len() < 3 {
        return None;
    }

    // Simple projection for Cartesian coordinates - just extract x and y
    let project_to_cartesian_2d = |positions: &[Vec3]| -> Vec<Vec2> {
        positions.iter().map(|p| Vec2::new(p.x, p.y)).collect()
    };

    let (polygons, _) = polygons_from_hierarchy(polygon_hierarchy, project_to_cartesian_2d);

    if polygons.is_empty() {
        return None;
    }

    let use_rte = options.use_rte;
    let mut combined_position = vec![];
    let mut combined_position_high = vec![];
    let mut combined_position_low = vec![];
    let mut combined_indices = vec![];

    // Process each polygon
    for polygon in &polygons {
        // Get triangulation indices using earcut
        let mut polygon_indices = polygon_resource.earcut(polygon);
        if polygon_indices.len() < 3 {
            polygon_indices = vec![0, 1, 2];
        }

        // Add positions to the combined buffer
        let positions_len = if use_rte {
            combined_position_high.len() / 3
        } else {
            combined_position.len() / 3
        };

        for position in &polygon.positions {
            let vec3_pos = Vec3::new(position.x, position.y, position.z);

            if use_rte {
                // Encode to RTE high/low
                let encoded = EncodedVec3::encode(vec3_pos);
                combined_position_high.push(encoded.high.x as f32);
                combined_position_high.push(encoded.high.y as f32);
                combined_position_high.push(encoded.high.z as f32);
                combined_position_low.push(encoded.low.x as f32);
                combined_position_low.push(encoded.low.y as f32);
                combined_position_low.push(encoded.low.z as f32);
            } else {
                // Use regular position
                combined_position.push(vec3_pos.x as f32);
                combined_position.push(vec3_pos.y as f32);
                combined_position.push(vec3_pos.z as f32);
            }
        }

        // Adjust and add indices to the combined buffer
        for idx in polygon_indices {
            combined_indices.push((idx + positions_len) as u32);
        }
    }

    if combined_indices.is_empty() {
        return None;
    }

    // Create the final geometry with conditional RTE encoding
    let combined_attributes = if use_rte {
        PolygonGeometryAttributes {
            position: None,
            position_3d_high: Some(FloatAttribute::new(combined_position_high, 3)),
            position_3d_low: Some(FloatAttribute::new(combined_position_low, 3)),
            normal: None,
            scale_normal_and_cap: None,
            batch_ids: None,
            batch_index: None,
        }
    } else {
        PolygonGeometryAttributes {
            position: Some(FloatAttribute::new(combined_position, 3)),
            position_3d_high: None,
            position_3d_low: None,
            normal: None,
            scale_normal_and_cap: None,
            batch_ids: None,
            batch_index: None,
        }
    };

    Some(PolygonGeometryResult {
        geometry: PolygonGeometry {
            attributes: combined_attributes,
            indices: combined_indices,
        },
        outline: None,
    })
}

fn create_side_outline(
    ring: &[Vec3],
    positions: &mut Vec<f64>,
    skip_indices: &mut Vec<u32>,
    scale_normal_cap: &mut Vec<f32>,
    per_position_height: bool,
) {
    for p in ring {
        let mut side_seg = vec![p.x, p.y, p.z, p.x, p.y, p.z];
        let s_n_c = scale_to_geodetic_height_extruded(&mut side_seg, WGS84_64, per_position_height);
        scale_normal_cap.extend(s_n_c);

        positions.extend(side_seg);
        skip_indices.push((positions.len() / 3 - 1) as u32);
    }
}

fn outlines_from_hierarchy(
    hierarchies: &[HierarchyDVec3],
    granularity: f64,
    per_position_height: bool,
    use_rte: bool,
) -> PolygonOutlineGeometry {
    let mut positions = vec![];
    let mut skip_indices = vec![];
    let mut scale_normal_cap = vec![];

    for hierarchy in hierarchies {
        let outer_ring = &(hierarchy.outer_ring);
        let mut poss = compute_outline_positions(WGS84_64, outer_ring, granularity);
        let s_n_c = scale_to_geodetic_height_extruded(&mut poss, WGS84_64, per_position_height);
        scale_normal_cap.extend(s_n_c);

        // top end index
        skip_indices.push((positions.len() / 3 + poss.len() / 3 / 2 - 1) as u32);
        // bottom end index
        skip_indices.push((positions.len() / 3 + poss.len() / 3 - 1) as u32);
        positions.extend(poss);

        create_side_outline(
            outer_ring,
            &mut positions,
            &mut skip_indices,
            &mut scale_normal_cap,
            per_position_height,
        );

        if let Some(holes_src) = &(hierarchy.holes) {
            for hole_src in holes_src {
                let mut poss =
                    compute_outline_positions(WGS84_64, &hole_src.outer_ring, granularity);
                let s_n_c =
                    scale_to_geodetic_height_extruded(&mut poss, WGS84_64, per_position_height);
                scale_normal_cap.extend(s_n_c);

                // top end index
                skip_indices.push((positions.len() / 3 + poss.len() / 3 / 2 - 1) as u32);
                // bottom end index
                skip_indices.push((positions.len() / 3 + poss.len() / 3 - 1) as u32);
                positions.extend(poss);

                create_side_outline(
                    &(hole_src.outer_ring),
                    &mut positions,
                    &mut skip_indices,
                    &mut scale_normal_cap,
                    per_position_height,
                );
            }
        }
    }

    // Always emit f32 positions (bounding volumes / raycast / non-RTE
    // fallback); additionally emit RTE high/low pairs when requested so the
    // shader can render jitter-free at globe scale.
    let f32_positions: Vec<f32> = positions.iter().map(|&p| p as f32).collect();
    let (position_3d_high, position_3d_low) = if use_rte {
        let (_, high, low) = encode_positions_conditionally(positions, true);
        (
            high.map(|h| FloatAttribute::new(h, 3)),
            low.map(|l| FloatAttribute::new(l, 3)),
        )
    } else {
        (None, None)
    };

    PolygonOutlineGeometry {
        position: FloatAttribute::new(f32_positions, 3),
        position_3d_high,
        position_3d_low,
        scale_normal_and_cap: FloatAttribute::new(scale_normal_cap, 4),
        skip_indices,
    }
}

// Ref: https://github.com/CesiumGS/cesium/blob/baaabaa49058067c855ad050be73a9cdfe9b6ac7/packages/engine/Source/Core/PolygonGeometry.js#L1278
pub fn create_polygon_geometry(
    options: PolygonGeometryOptions,
    polygon_resource: &mut PolygonResource,
) -> Option<PolygonGeometryResult> {
    let per_position_height = options.per_position_height;
    let granularity = options.granularity;
    let polygon_hierarchy = &options.hierarchy;
    let clamp_to_ground = options.clamp_to_ground;

    let outer_positions = &polygon_hierarchy.outer_ring;
    if outer_positions.len() < 3 {
        return None;
    }

    let (polygons, hierarchies) =
        polygons_from_hierarchy(polygon_hierarchy, project_to_2d(WGS84_64, outer_positions));

    if hierarchies.is_empty() {
        return None;
    }

    let outline_geometry = if options.outline {
        Some(outlines_from_hierarchy(
            &hierarchies,
            granularity as f64,
            per_position_height,
            options.use_rte,
        ))
    } else {
        None
    };

    let mut geometries = vec![];

    let use_rte = options.use_rte;
    let polygons_length = polygons.len();
    for i in 0..polygons_length {
        let mut split_geometry = create_geometry_from_positions_extruded(
            WGS84_64,
            polygon_resource,
            &polygons[i],
            granularity as f64,
            &hierarchies[i],
            per_position_height,
            use_rte,
        );

        if !clamp_to_ground {
            let top_bottom_normals = compute_extruded_normals(
                WGS84_64,
                &split_geometry.top_bottom_geometry.attributes,
                false,
                per_position_height,
            );
            split_geometry.top_bottom_geometry.attributes.normal =
                Some(FloatAttribute::new(top_bottom_normals, 3));
        }

        geometries.push(split_geometry.top_bottom_geometry);

        for mut wall_geometry in split_geometry.wall_geometries {
            if !clamp_to_ground {
                let wall_normals = compute_extruded_normals(
                    WGS84_64,
                    &wall_geometry.attributes,
                    true,
                    per_position_height,
                );
                wall_geometry.attributes.normal = Some(FloatAttribute::new(wall_normals, 3));
            }
            geometries.push(wall_geometry);
        }
    }

    let mut combined_attributes = PolygonGeometryAttributes {
        position: (!use_rte).then(|| FloatAttribute::new(vec![], 3)),
        position_3d_high: use_rte.then(|| FloatAttribute::new(vec![], 3)),
        position_3d_low: use_rte.then(|| FloatAttribute::new(vec![], 3)),
        normal: None,
        scale_normal_and_cap: Some(FloatAttribute::new(vec![], 4)),
        batch_ids: None,
        batch_index: None,
    };
    let mut indices = vec![];

    let mut index_offset = 0;
    // Combine all attributes into one geometry
    for mut geometry in geometries {
        let position_length = if use_rte {
            geometry
                .attributes
                .position_3d_high
                .as_ref()
                .unwrap()
                .data
                .len()
                / 3
        } else {
            geometry.attributes.position.as_ref().unwrap().data.len() / 3
        };

        if use_rte {
            combined_attributes
                .position_3d_high
                .as_mut()
                .unwrap()
                .data
                .append(&mut geometry.attributes.position_3d_high.as_mut().unwrap().data);
            combined_attributes
                .position_3d_low
                .as_mut()
                .unwrap()
                .data
                .append(&mut geometry.attributes.position_3d_low.as_mut().unwrap().data);
        } else {
            combined_attributes
                .position
                .as_mut()
                .unwrap()
                .data
                .append(&mut geometry.attributes.position.as_mut().unwrap().data);
        }
        if let Some(normal) = geometry.attributes.normal.as_mut() {
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
            .append(&mut geometry.attributes.scale_normal_and_cap.unwrap().data);

        if index_offset == 0 {
            indices.append(&mut geometry.indices);
        } else {
            let mut new_indices = geometry
                .indices
                .into_iter()
                .map(|i| i + index_offset)
                .collect::<Vec<_>>();
            indices.append(&mut new_indices);
        }

        index_offset += position_length as u32;
    }

    Some(PolygonGeometryResult {
        geometry: PolygonGeometry {
            attributes: combined_attributes,
            indices,
        },
        outline: outline_geometry,
    })
}

pub struct ExtrudedPolygonGeometry {
    pub top_bottom_geometry: PolygonGeometry,
    pub wall_geometries: Vec<PolygonGeometry>,
}

// Ref: https://github.com/CesiumGS/cesium/blob/baaabaa49058067c855ad050be73a9cdfe9b6ac7/packages/engine/Source/Core/PolygonGeometry.js#L428
pub fn create_geometry_from_positions_extruded(
    ellipsoid: Ellipsoid<FloatType>,
    polygon_resource: &mut PolygonResource,
    polygon: &Polygon,
    granularity: FloatType,
    hierarchy: &HierarchyDVec3,
    per_position_height: bool,
    use_rte: bool,
) -> ExtrudedPolygonGeometry {
    let (mut top_positions, mut top_indices) = create_geometry_from_positions(
        ellipsoid,
        polygon_resource,
        polygon,
        per_position_height,
        granularity,
    );

    let mut top_bottom_positions = Vec::with_capacity(top_positions.len() * 2);
    top_bottom_positions.append(&mut top_positions);
    top_bottom_positions.extend_from_within(..);

    let bottom_positions_length = top_bottom_positions.len() / 3 / 2;
    let top_indices_length = top_indices.len();
    let mut top_bottom_indices = Vec::with_capacity(top_indices_length * 2);
    top_bottom_indices.append(&mut top_indices);
    for i in 0..(top_indices_length / 3) {
        let i = i * 3;
        let i0 = top_bottom_indices[i] + bottom_positions_length as u32;
        let i1 = top_bottom_indices[i + 1] + bottom_positions_length as u32;
        let i2 = top_bottom_indices[i + 2] + bottom_positions_length as u32;

        top_bottom_indices.push(i2);
        top_bottom_indices.push(i1);
        top_bottom_indices.push(i0);
    }

    let scale_normal_and_cap = scale_to_geodetic_height_extruded(
        &mut top_bottom_positions,
        ellipsoid,
        per_position_height,
    );

    // Conditionally encode positions based on use_rte
    let (top_bottom_pos, top_bottom_pos_high, top_bottom_pos_low) =
        encode_positions_conditionally(top_bottom_positions, use_rte);

    let outer_ring = &hierarchy.outer_ring;

    let mut wall_geometries =
        Vec::with_capacity(hierarchy.holes.as_ref().map(|h| h.len()).unwrap_or(0) + 1);

    let (mut wall_positions, wall_indices) =
        compute_wall_geometry(ellipsoid, outer_ring, granularity);

    let wall_scale_normal_and_cap =
        scale_to_geodetic_height_extruded(&mut wall_positions, ellipsoid, per_position_height);

    // Conditionally encode wall positions based on use_rte
    let (wall_pos, wall_pos_high, wall_pos_low) =
        encode_positions_conditionally(wall_positions, use_rte);

    wall_geometries.push(PolygonGeometry {
        attributes: PolygonGeometryAttributes {
            position: wall_pos.map(|p| FloatAttribute::new(p, 3)),
            position_3d_high: wall_pos_high.map(|p| FloatAttribute::new(p, 3)),
            position_3d_low: wall_pos_low.map(|p| FloatAttribute::new(p, 3)),
            normal: None,
            scale_normal_and_cap: Some(FloatAttribute::new(wall_scale_normal_and_cap, 4)),
            batch_ids: None,
            batch_index: None,
        },
        indices: wall_indices,
    });

    if let Some(holes_src) = &hierarchy.holes {
        for hole_src in holes_src {
            let (mut hole_wall_pos, hole_wall_i) =
                compute_wall_geometry(ellipsoid, &hole_src.outer_ring, granularity);

            let hole_scale_normal_and_cap = scale_to_geodetic_height_extruded(
                &mut hole_wall_pos,
                ellipsoid,
                per_position_height,
            );

            // Conditionally encode hole wall positions based on use_rte
            let (hole_pos, hole_pos_high, hole_pos_low) =
                encode_positions_conditionally(hole_wall_pos, use_rte);

            wall_geometries.push(PolygonGeometry {
                attributes: PolygonGeometryAttributes {
                    position: hole_pos.map(|p| FloatAttribute::new(p, 3)),
                    position_3d_high: hole_pos_high.map(|p| FloatAttribute::new(p, 3)),
                    position_3d_low: hole_pos_low.map(|p| FloatAttribute::new(p, 3)),
                    normal: None,
                    scale_normal_and_cap: Some(FloatAttribute::new(hole_scale_normal_and_cap, 4)),
                    batch_ids: None,
                    batch_index: None,
                },
                indices: hole_wall_i,
            });
        }
    }

    ExtrudedPolygonGeometry {
        top_bottom_geometry: PolygonGeometry {
            attributes: PolygonGeometryAttributes {
                position: top_bottom_pos.map(|p| FloatAttribute::new(p, 3)),
                position_3d_high: top_bottom_pos_high.map(|p| FloatAttribute::new(p, 3)),
                position_3d_low: top_bottom_pos_low.map(|p| FloatAttribute::new(p, 3)),
                normal: None,
                scale_normal_and_cap: Some(FloatAttribute::new(scale_normal_and_cap, 4)),
                batch_ids: None,
                batch_index: None,
            },
            indices: top_bottom_indices,
        },
        wall_geometries,
    }
}

/// Helper function to encode positions conditionally
#[allow(clippy::type_complexity)]
fn encode_positions_conditionally(
    positions: Vec<f64>,
    use_rte: bool,
) -> (Option<Vec<f32>>, Option<Vec<f32>>, Option<Vec<f32>>) {
    if use_rte {
        // Encode to RTE high/low
        let mut pos_high = Vec::with_capacity(positions.len());
        let mut pos_low = Vec::with_capacity(positions.len());

        for chunk in positions.chunks(3) {
            let encoded = EncodedVec3::encode(Vec3::new(chunk[0], chunk[1], chunk[2]));
            pos_high.push(encoded.high.x as f32);
            pos_high.push(encoded.high.y as f32);
            pos_high.push(encoded.high.z as f32);
            pos_low.push(encoded.low.x as f32);
            pos_low.push(encoded.low.y as f32);
            pos_low.push(encoded.low.z as f32);
        }
        (None, Some(pos_high), Some(pos_low))
    } else {
        let mut pos = Vec::with_capacity(positions.len());
        for chunk in positions.chunks(3) {
            pos.push(chunk[0] as f32);
            pos.push(chunk[1] as f32);
            pos.push(chunk[2] as f32);
        }
        // Use regular positions
        (Some(pos), None, None)
    }
}

// Ref: https://github.com/CesiumGS/cesium/blob/baaabaa49058067c855ad050be73a9cdfe9b6ac7/packages/engine/Source/Core/PolygonGeometry.js#L62
fn compute_extruded_normals(
    ellipsoid: Ellipsoid<FloatType>,
    attributes: &PolygonGeometryAttributes,
    wall: bool,
    per_position_height: bool,
) -> Vec<f32> {
    // Helper closure to get position at index i, decoding from RTE if needed
    let get_position = |idx: usize| -> Vec3 {
        if let Some(pos_high) = &attributes.position_3d_high {
            let pos_low = attributes.position_3d_low.as_ref().unwrap();
            let i = idx * 3;
            Vec3::new(
                pos_high.data[i] as f64 + pos_low.data[i] as f64,
                pos_high.data[i + 1] as f64 + pos_low.data[i + 1] as f64,
                pos_high.data[i + 2] as f64 + pos_low.data[i + 2] as f64,
            )
        } else {
            let positions = attributes.position.as_ref().unwrap();
            unpack_flatten_vec3_from_f32(&positions.data, idx * 3)
        }
    };

    let positions_count = if let Some(pos_high) = &attributes.position_3d_high {
        pos_high.data.len() / 3
    } else {
        attributes.position.as_ref().unwrap().data.len() / 3
    };

    let mut normals = vec![0.; positions_count * 3];

    let mut is_in_corner = true;

    let bottom_offset = positions_count / 2;
    let mut normal = Vec3::ZERO;
    for i in 0..bottom_offset {
        let p0 = get_position(i);
        if wall {
            if i + 1 < bottom_offset {
                let mut p1 = get_position(i + 1);
                if is_in_corner {
                    let mut bottom_p = get_position(i + bottom_offset);

                    if per_position_height {
                        // Adjust position for correct normal.
                        let p0_geo = ellipsoid.xyz_to_lle(p0.into());
                        let mut p1_geo = ellipsoid.xyz_to_lle(p1.into());
                        let mut bottom_p_geo = ellipsoid.xyz_to_lle(bottom_p.into());
                        p1_geo.height = p0_geo.height;
                        bottom_p_geo.height = Meters::new(p1_geo.height.val() - 100.0);
                        p1 = p1_geo.to_xyz(ellipsoid).into();
                        bottom_p = bottom_p_geo.to_xyz(ellipsoid).into();
                    }

                    p1 -= p0;
                    bottom_p -= p0;
                    normal = bottom_p.cross(p1).normalize();
                    is_in_corner = false;
                }
                if p0.equal_diff_epsilon(p1, EPSILON10) {
                    is_in_corner = true;
                }
            }
        } else {
            normal = Into::<Vec3>::into(ellipsoid.geodetic_surface_normal_from_vec3(p0.into()))
                .normalize();
        }

        let i0 = i * 3;
        let i1 = i0 + 1;
        let i2 = i0 + 2;

        if wall {
            normals[i0 + bottom_offset * 3] = normal.x as f32;
            normals[i1 + bottom_offset * 3] = normal.y as f32;
            normals[i2 + bottom_offset * 3] = normal.z as f32;
        } else {
            normals[i0 + bottom_offset * 3] = -normal.x as f32;
            normals[i1 + bottom_offset * 3] = -normal.y as f32;
            normals[i2 + bottom_offset * 3] = -normal.z as f32;
        }

        normals[i0] = normal.x as f32;
        normals[i1] = normal.y as f32;
        normals[i2] = normal.z as f32;
    }

    normals
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ecef(lng: f64, lat: f64) -> Vec3 {
        CRS::Geographic.to_vec3(WGS84_64, Vec3::new(lng, lat, 0.0), 0.0)
    }

    fn square_hierarchy() -> HierarchyDVec3 {
        let mut hierarchy = HierarchyDVec3 {
            outer_ring: vec![
                ecef(0.00, 0.00),
                ecef(0.01, 0.00),
                ecef(0.01, 0.01),
                ecef(0.00, 0.01),
            ],
            holes: None,
            expected_winding_order: WindingOrder::Unknown,
        };
        hierarchy.align_winding_order();
        hierarchy
    }

    fn build_outline(use_rte: bool) -> PolygonOutlineGeometry {
        let mut polygon_resource = PolygonResource::new();
        create_polygon_geometry(
            PolygonGeometryOptions {
                hierarchy: square_hierarchy(),
                outline: true,
                use_rte,
                ..Default::default()
            },
            &mut polygon_resource,
        )
        .expect("polygon geometry")
        .outline
        .expect("outline geometry")
    }

    fn build_square(clamp_to_ground: bool) -> PolygonGeometryResult {
        let mut polygon_resource = PolygonResource::new();
        create_polygon_geometry(
            PolygonGeometryOptions {
                hierarchy: square_hierarchy(),
                clamp_to_ground,
                use_rte: true,
                ..Default::default()
            },
            &mut polygon_resource,
        )
        .expect("polygon geometry")
    }

    #[test]
    fn clamped_polygon_carries_no_shading_normals() {
        assert!(build_square(true).geometry.attributes.normal.is_none());
    }

    #[test]
    fn unclamped_polygon_carries_one_usable_normal_per_vertex() {
        let result = build_square(false);
        let attributes = &result.geometry.attributes;
        let normal = attributes
            .normal
            .as_ref()
            .expect("normal should be present when clamp_to_ground=false");
        let positions = attributes
            .position_3d_high
            .as_ref()
            .expect("position_3d_high");

        assert_eq!(normal.size, 3);
        assert_eq!(normal.data.len(), positions.data.len());
        // Wall normals use the 1m edge between the caps, so a zero normal means
        // the caps collapsed.
        for (i, n) in normal.data.chunks(3).enumerate() {
            let length = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            assert!(
                (length - 1.0).abs() < 1e-3,
                "normal {i} should be unit length, got {length}"
            );
        }
    }

    #[test]
    fn outline_rte_high_low_reconstructs_f32_positions() {
        // With use_rte=true the outline must carry high/low pairs encoding the
        // same f64 coordinates as the (truncated) f32 position attribute.
        let outline = build_outline(true);

        let high = outline
            .position_3d_high
            .as_ref()
            .expect("position_3d_high should be present when use_rte=true");
        let low = outline
            .position_3d_low
            .as_ref()
            .expect("position_3d_low should be present when use_rte=true");

        let positions = &outline.position.data;
        assert!(!positions.is_empty());
        assert_eq!(high.data.len(), positions.len());
        assert_eq!(low.data.len(), positions.len());
        assert_eq!(high.size, 3);
        assert_eq!(low.size, 3);

        for (i, _) in positions.iter().enumerate() {
            let reconstructed = high.data[i] + low.data[i];
            let diff = (reconstructed - positions[i]).abs();
            // f32 truncation of the absolute ECEF coordinate loses up to ~0.5m
            // at earth radius; high+low retains more precision, so compare with
            // that tolerance.
            assert!(
                diff <= 1.0,
                "high+low should reconstruct position at index {i}: {reconstructed} vs {}",
                positions[i]
            );
        }
    }

    #[test]
    fn outline_without_rte_has_no_high_low() {
        let outline = build_outline(false);
        assert!(outline.position_3d_high.is_none());
        assert!(outline.position_3d_low.is_none());
        assert!(!outline.position.data.is_empty());
    }
}
