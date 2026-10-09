use navara_buffer_store::BufferStore;
use navara_camera::CameraFrustum;
use navara_core::{CRS, EncodedVec3, Extent, Radians, WGS84_64};
use navara_feature_component::batched_geometry::BatchedPointGeometry;
use navara_feature_component::render::TransferablePointGeometry;
use navara_math::{FloatType, Vec3};
use navara_occluder::ellipsoidal_occluder::EllipsoidalOccluder;
use navara_tile_component::{
    LOWEST_TERRAIN_HEIGHT, TerrainExaggeration, TerrainTileQuadtree, TileExtent, TileMeshMarker,
    TileTerrainDataRequesterQuery, collect_terrain_leaves, compute_terrain_height_by_tile_handle,
    find_terrain_tile_for_extent,
};

/// Holds position data encoded as either RTC or RTE f32 values.
/// Positions are encoded on push, avoiding intermediate `Vec<Vec3>` allocations.
pub enum PositionBuffer {
    Rtc { coords: Vec<f32>, center: Vec3 },
    Rte { high: Vec<f32>, low: Vec<f32> },
}

impl PositionBuffer {
    /// Creates a new buffer. RTC when `rtc_center` is `Some`, RTE when `None`.
    pub fn new(rtc_center: Option<Vec3>, capacity: usize) -> Self {
        if let Some(center) = rtc_center {
            Self::Rtc {
                coords: Vec::with_capacity(capacity * 3),
                center,
            }
        } else {
            Self::Rte {
                high: Vec::with_capacity(capacity * 3),
                low: Vec::with_capacity(capacity * 3),
            }
        }
    }

    /// Replaces position buffers in the geometry with the encoded positions from this buffer.
    pub fn apply_to(self, buf: &mut BufferStore, geometry: &mut TransferablePointGeometry) {
        match self {
            Self::Rtc { coords, .. } => {
                if let Some(position) = &mut geometry.position {
                    buf.remove(&position.data);
                    position.data = buf.new_f32(coords);
                }
            }
            Self::Rte { high, low } => {
                if let (Some(high_attr), Some(low_attr)) = (
                    &mut geometry.position_3d_high,
                    &mut geometry.position_3d_low,
                ) {
                    buf.remove(&high_attr.data);
                    high_attr.data = buf.new_f32(high);
                    buf.remove(&low_attr.data);
                    low_attr.data = buf.new_f32(low);
                }
            }
        }
    }

    /// Converts coordinates from the given CRS to ECEF, applies height and terrain offset,
    /// then encodes and appends the resulting world position.
    pub fn push_from_crs(&mut self, coords: Vec3, crs: &CRS, height: f32, terrain_height: f64) {
        let world_pos = crs.to_vec3(WGS84_64, coords, height + terrain_height as f32);
        match self {
            Self::Rtc {
                coords: buf,
                center,
            } => {
                buf.push((world_pos.x - center.x) as f32);
                buf.push((world_pos.y - center.y) as f32);
                buf.push((world_pos.z - center.z) as f32);
            }
            Self::Rte { high, low } => {
                let encoded = EncodedVec3::encode(world_pos);
                high.push(encoded.high.x as f32);
                high.push(encoded.high.y as f32);
                high.push(encoded.high.z as f32);
                low.push(encoded.low.x as f32);
                low.push(encoded.low.y as f32);
                low.push(encoded.low.z as f32);
            }
        }
    }
}

/// Collects extents of newly added terrain tiles from the terrain-tile quadtree.
pub fn collect_changed_tile_extents<'a>(
    qt: &TerrainTileQuadtree,
    tile_meshes: impl Iterator<Item = &'a TileMeshMarker>,
) -> Vec<Extent<FloatType, Radians>> {
    tile_meshes
        .filter_map(|tm| qt.qt.get(tm.handle).map(|t| t.extent))
        .collect()
}

/// Returns true if terrain height should be recalculated for a feature
/// whose `should_recalculate_height` is false, based on whether any
/// changed terrain tile extents overlap the feature's spatial extent.
pub fn should_update_for_changed_terrain(
    clamp_to_ground: bool,
    changed_extents: &[Extent<FloatType, Radians>],
    batched_point_geom: &BatchedPointGeometry,
    tile_extent: Option<&TileExtent>,
) -> bool {
    if changed_extents.is_empty() || !clamp_to_ground {
        return false;
    }
    if let Some(te) = tile_extent {
        changed_extents.iter().any(|e| e.intersects(te.extent))
    } else {
        coords_overlap_changed_extents(
            &batched_point_geom.coords,
            &batched_point_geom.crs,
            changed_extents,
        )
    }
}

/// Single-pass terrain height resolution for tiled (MVT) features.
/// Finds the raster tile once, then for each point: converts to lng_lat,
/// computes height from the tile's DEM, and pushes the position.
///
/// Only the terrain height is baked into the position (for clamp-to-ground).
/// The material `height` offset is applied in the vertex shader, so it is
/// intentionally not added here — baking it too would double the offset.
#[allow(clippy::too_many_arguments)]
pub fn resolve_tiled_heights_and_build_positions(
    tile_extent: &Extent<FloatType, Radians>,
    coords: &[Vec3],
    crs: &CRS,
    clamp_to_ground: bool,
    terrain_heights: &mut [f64],
    qt: &mut TerrainTileQuadtree,
    buf: &mut BufferStore,
    terrain_data_requester: &TileTerrainDataRequesterQuery,
    exaggeration: &TerrainExaggeration,
    positions: &mut PositionBuffer,
) {
    let tile_handle = if clamp_to_ground {
        find_terrain_tile_for_extent(qt, tile_extent)
    } else {
        None
    };

    for (i, c) in coords.iter().enumerate() {
        if let Some(handle) = tile_handle {
            let lng_lat = crs.to_lng_lat(WGS84_64, *c);
            // The vector tile is rendered after the terrain tile is rendered, so this should work.
            terrain_heights[i] = compute_terrain_height_by_tile_handle(
                qt,
                buf,
                terrain_data_requester,
                exaggeration,
                handle,
                &lng_lat,
            );
        } else {
            terrain_heights[i] = 0.0;
        }
        positions.push_from_crs(*c, crs, 0.0, terrain_heights[i]);
    }
}

/// Check if any of the given coords fall within any of the changed tile extents.
pub fn coords_overlap_changed_extents(
    coords: &[Vec3],
    crs: &CRS,
    changed_extents: &[Extent<FloatType, Radians>],
) -> bool {
    coords.iter().any(|c| {
        let lng_lat = crs.to_lng_lat(WGS84_64, *c);
        changed_extents.iter().any(|e| e.contains(&lng_lat))
    })
}

/// Single-pass terrain height resolution for GeoJSON points.
/// For each point: checks visibility, converts to lng_lat, finds containing terrain leaf,
/// computes height, and pushes the position. Culled points use the previous terrain height.
///
/// `material_height` is used only for visibility culling (`is_point_visible`); it is not
/// baked into the position. The material height offset is applied in the vertex shader, so
/// baking it here as well would double the offset.
#[allow(clippy::too_many_arguments)]
pub fn resolve_absolute_heights_and_build_positions(
    coords: &[Vec3],
    crs: &CRS,
    material_height: f32,
    clamp_to_ground: bool,
    size: f32,
    size_in_meters: bool,
    frustum: Option<&CameraFrustum>,
    occluder: Option<&EllipsoidalOccluder>,
    camera_position: Vec3,
    screen_height: FloatType,
    terrain_heights: &mut [f64],
    qt: &mut TerrainTileQuadtree,
    buf: &mut BufferStore,
    terrain_data_requester: &TileTerrainDataRequesterQuery,
    exaggeration: &TerrainExaggeration,
    positions: &mut PositionBuffer,
) {
    let leaf_handles = collect_terrain_leaves(qt);

    for (i, c) in coords.iter().enumerate() {
        if !clamp_to_ground {
            terrain_heights[i] = 0.0;
            positions.push_from_crs(*c, crs, 0.0, terrain_heights[i]);
            continue;
        }

        if let (Some(f), Some(o)) = (frustum, occluder)
            && !is_point_visible(
                *c,
                crs,
                material_height,
                size,
                size_in_meters,
                f,
                o,
                camera_position,
                screen_height,
                exaggeration,
            )
        {
            positions.push_from_crs(*c, crs, 0.0, terrain_heights[i]);
            continue;
        }

        let lng_lat = crs.to_lng_lat(WGS84_64, *c);
        if let Some(height) = leaf_handles
            .iter()
            .find(|h| qt.qt.get(**h).is_some_and(|t| t.extent.contains(&lng_lat)))
            .map(|handle| {
                compute_terrain_height_by_tile_handle(
                    qt,
                    buf,
                    terrain_data_requester,
                    exaggeration,
                    *handle,
                    &lng_lat,
                )
            })
        {
            terrain_heights[i] = height;
        }
        positions.push_from_crs(*c, crs, 0.0, terrain_heights[i]);
    }
}

/// Highest unexaggerated terrain height (meters) for visibility testing of
/// clamp-to-ground features whose actual terrain height is not yet known: above
/// Everest (8849 m). The lowest is [`LOWEST_TERRAIN_HEIGHT`].
const MAX_TERRAIN_HEIGHT: FloatType = 8850.0;

/// Rust-side equivalent of `nvr_pxToWorld` in `shaders/glsl/chunks/pixelToWorld.glsl`.
/// If the shader changes, update this function.
fn pixel_to_world(
    pixel_size: FloatType,
    sse_denominator: FloatType,
    screen_height: FloatType,
    distance: FloatType,
) -> FloatType {
    let world_per_pixel = sse_denominator * distance / screen_height;
    pixel_size * world_per_pixel
}

fn compute_sprite_radius(
    size: f32,
    size_in_meters: bool,
    sse_denominator: FloatType,
    screen_height: FloatType,
    camera_position: Vec3,
    world_pos: Vec3,
) -> FloatType {
    if size_in_meters {
        size as FloatType
    } else {
        let distance = (camera_position - world_pos).length();
        pixel_to_world(size as FloatType, sse_denominator, screen_height, distance)
    }
}

/// Check if a point is visible within the camera frustum and not occluded by the horizon.
///
/// Uses a bounding sphere derived from the sprite's rendered size to avoid false culling
/// at frustum edges. For clamp-to-ground features, a conservative terrain height buffer
/// is added since the actual terrain height is not yet computed.
#[allow(clippy::too_many_arguments)]
pub fn is_point_visible(
    coords: Vec3,
    crs: &CRS,
    material_height: f32,
    size: f32,
    size_in_meters: bool,
    frustum: &CameraFrustum,
    occluder: &EllipsoidalOccluder,
    camera_position: Vec3,
    screen_height: FloatType,
    exaggeration: &TerrainExaggeration,
) -> bool {
    // For clamp-to-ground, terrain height is unknown. Model the possible height range
    // as a sphere centered at the midpoint, with radius covering the full range.
    let min = exaggeration.apply(LOWEST_TERRAIN_HEIGHT);
    let max = exaggeration.apply(MAX_TERRAIN_HEIGHT);
    let height_radius = (max - min) / 2.0;
    let world_pos = crs.to_vec3(
        WGS84_64,
        coords,
        material_height + ((min + max) / 2.0) as f32,
    );

    let sprite_radius = compute_sprite_radius(
        size,
        size_in_meters,
        frustum.sse_denominator,
        screen_height,
        camera_position,
        world_pos,
    );
    let radius = sprite_radius + height_radius;

    // Frustum check with bounding sphere
    if !frustum.contains_sphere(world_pos, radius) {
        return false;
    }

    // Horizon occlusion check at the highest possible ground, against a horizon
    // lowered to the lowest, so that no possible terrain height is hidden.
    let top_pos = crs.to_vec3(WGS84_64, coords, material_height + max as f32);
    occluder
        .is_point_visible_possibly_under_ellipsoid(top_pos, exaggeration.horizon_minimum_height())
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;
    use navara_math::{EPSILON4, EPSILON12};

    #[test]
    fn push_from_crs_rtc_encodes_relative() {
        let center = Vec3::new(1.0, 2.0, 3.0);
        let mut buf = PositionBuffer::new(Some(center), 1);
        // Geocentric CRS passes coords through as-is
        buf.push_from_crs(Vec3::new(10.0, 20.0, 30.0), &CRS::Geocentric, 0.0, 0.0);
        match buf {
            PositionBuffer::Rtc { coords, .. } => {
                assert_eq!(coords.len(), 3);
                assert_eq!(coords[0], 9.0);
                assert_eq!(coords[1], 18.0);
                assert_eq!(coords[2], 27.0);
            }
            _ => panic!("expected RTC"),
        }
    }

    #[test]
    fn push_from_crs_rte_encodes_high_low() {
        let mut buf = PositionBuffer::new(None, 1);
        let input = Vec3::new(1_000_000.5, 2_000_000.25, 3_000_000.75);
        buf.push_from_crs(input, &CRS::Geocentric, 0.0, 0.0);
        match buf {
            PositionBuffer::Rte { high, low } => {
                assert_eq!(high.len(), 3);
                assert_eq!(low.len(), 3);
                let reconstructed_x = high[0] as f64 + low[0] as f64;
                let reconstructed_y = high[1] as f64 + low[1] as f64;
                let reconstructed_z = high[2] as f64 + low[2] as f64;
                assert_abs_diff_eq!(reconstructed_x, input.x, epsilon = EPSILON12);
                assert_abs_diff_eq!(reconstructed_y, input.y, epsilon = EPSILON12);
                assert_abs_diff_eq!(reconstructed_z, input.z, epsilon = EPSILON12);
            }
            _ => panic!("expected RTE"),
        }
    }

    #[test]
    fn push_from_crs_applies_height_and_terrain() {
        let coords = Vec3::new(100.0, 200.0, 300.0);
        let crs = CRS::Geocentric;
        let height = 5.0_f32;
        let terrain_height = 10.0_f64;

        // Compute expected world position using the same CRS conversion
        let expected = crs.to_vec3(WGS84_64, coords, height + terrain_height as f32);

        let mut buf = PositionBuffer::new(Some(Vec3::ZERO), 1);
        buf.push_from_crs(coords, &crs, height, terrain_height);

        match buf {
            PositionBuffer::Rtc { coords: result, .. } => {
                assert_eq!(result.len(), 3);
                // f32 precision loss from the RTC encoding
                assert_abs_diff_eq!(result[0] as f64, expected.x, epsilon = EPSILON4);
                assert_abs_diff_eq!(result[1] as f64, expected.y, epsilon = EPSILON4);
                assert_abs_diff_eq!(result[2] as f64, expected.z, epsilon = EPSILON4);
            }
            _ => panic!("expected RTC"),
        }
    }

    #[test]
    fn apply_to_rtc_replaces_buffer() {
        let mut store = BufferStore::default();
        let center = Vec3::new(100.0, 200.0, 300.0);
        let mut geom = TransferablePointGeometry::with_buf_rtc(
            &mut store,
            vec![1.0, 2.0, 3.0],
            vec![0],
            vec![1.0],
        );

        let mut updated = PositionBuffer::new(Some(center), 1);
        updated.push_from_crs(Vec3::new(110.0, 220.0, 330.0), &CRS::Geocentric, 0.0, 0.0);
        updated.apply_to(&mut store, &mut geom);

        let handle = &geom.position.as_ref().unwrap().data;
        let data = store.get_f32(handle).unwrap();
        assert_eq!(data.len(), 3);
        assert_eq!(data[0], 10.0); // 110 - 100
        assert_eq!(data[1], 20.0); // 220 - 200
        assert_eq!(data[2], 30.0); // 330 - 300
    }

    #[test]
    fn apply_to_rte_replaces_buffer() {
        let mut store = BufferStore::default();
        let mut geom = TransferablePointGeometry::with_buf_rte(
            &mut store,
            vec![1.0, 2.0, 3.0],
            vec![0.1, 0.2, 0.3],
            vec![0],
            vec![1.0],
        );

        let mut updated = PositionBuffer::new(None, 1);
        updated.push_from_crs(
            Vec3::new(1_000_001.0, 2_000_001.0, 3_000_001.0),
            &CRS::Geocentric,
            0.0,
            0.0,
        );
        updated.apply_to(&mut store, &mut geom);

        let high_handle = &geom.position_3d_high.as_ref().unwrap().data;
        let high_data = store.get_f32(high_handle).unwrap();
        assert_eq!(high_data.len(), 3);
        let low_handle = &geom.position_3d_low.as_ref().unwrap().data;
        let low_data = store.get_f32(low_handle).unwrap();
        assert_eq!(low_data.len(), 3);
    }

    #[test]
    fn coords_overlap_changed_extents_detects_overlap() {
        use navara_core::{Angle, Extent};

        // CRS::Geographic treats x=lng(degrees), y=lat(degrees), then converts to radians.
        // Use radian values for the extent to match the output of to_lng_lat.
        let lng_deg = 10.0;
        let lat_deg = 20.0;
        let coords = vec![Vec3::new(lng_deg, lat_deg, 0.0)];
        let crs = CRS::Geographic;

        let lng_rad = lng_deg.to_radians();
        let lat_rad = lat_deg.to_radians();

        let extent = Extent {
            west: Angle::new(lng_rad - 0.1),
            south: Angle::new(lat_rad - 0.1),
            east: Angle::new(lng_rad + 0.1),
            north: Angle::new(lat_rad + 0.1),
        };
        assert!(coords_overlap_changed_extents(&coords, &crs, &[extent]));
    }

    #[test]
    fn coords_overlap_changed_extents_no_overlap() {
        use navara_core::{Angle, Extent};

        let coords = vec![Vec3::new(50.0, 50.0, 0.0)];
        let crs = CRS::Geographic;

        // Extent far from the point
        let extent = Extent {
            west: Angle::new(0.0),
            south: Angle::new(0.0),
            east: Angle::new(0.1),
            north: Angle::new(0.1),
        };
        assert!(!coords_overlap_changed_extents(&coords, &crs, &[extent]));
    }

    #[test]
    fn coords_overlap_changed_extents_empty_extents() {
        let coords = vec![Vec3::new(10.0, 20.0, 0.0)];
        let crs = CRS::Geographic;
        assert!(!coords_overlap_changed_extents(&coords, &crs, &[]));
    }

    // --- pixel_to_world tests ---

    #[test]
    fn pixel_to_world_matches_shader_formula() {
        // sse_denominator = 2 * tan(fov_y / 2), which is the same as
        // world_screen_height / distance in the shader (tan(fov/2) * distance * 2).
        // So: world_per_pixel = sse_denominator * distance / screen_height
        //     result = pixel_size * world_per_pixel
        let pixel_size = 16.0;
        let sse_denominator = 1.0; // ~fov_y≈53°
        let screen_height = 800.0;
        let distance = 1000.0;

        let result = pixel_to_world(pixel_size, sse_denominator, screen_height, distance);
        let expected = pixel_size * (sse_denominator * distance / screen_height);
        assert_abs_diff_eq!(result, expected, epsilon = 1e-10);
    }

    #[test]
    fn pixel_to_world_small_value_not_clamped() {
        // With very small pixel_size and close distance, the computed value
        // is returned as-is (matching the shader behavior, which has no clamp).
        let result = pixel_to_world(1.0, 0.5, 1000.0, 1.0);
        // 1.0 * 0.5 * 1.0 / 1000.0 = 0.0005
        assert_abs_diff_eq!(result, 0.0005, epsilon = 1e-10);
    }

    #[test]
    fn pixel_to_world_large_distance() {
        // At large distance, the computed world size should exceed the minimum.
        let pixel_size = 10.0;
        let sse_denominator = 1.0;
        let screen_height = 600.0;
        let distance = 1_000_000.0;

        let result = pixel_to_world(pixel_size, sse_denominator, screen_height, distance);
        let expected = pixel_size * sse_denominator * distance / screen_height;
        assert_abs_diff_eq!(result, expected, epsilon = 1e-6);
    }

    #[test]
    fn pixel_to_world_zero_distance_returns_zero() {
        // distance = 0 → computed = 0 (matches shader: no clamp applied)
        let result = pixel_to_world(16.0, 1.0, 800.0, 0.0);
        assert_abs_diff_eq!(result, 0.0, epsilon = 1e-10);
    }

    #[test]
    fn pixel_to_world_scales_linearly_with_pixel_size() {
        let sse_denominator = 0.8;
        let screen_height = 1080.0;
        let distance = 50_000.0;

        let r1 = pixel_to_world(10.0, sse_denominator, screen_height, distance);
        let r2 = pixel_to_world(20.0, sse_denominator, screen_height, distance);
        assert_abs_diff_eq!(r2, r1 * 2.0, epsilon = 1e-10);
    }

    #[test]
    fn pixel_to_world_scales_linearly_with_distance() {
        let pixel_size = 20.0;
        let sse_denominator = 1.0;
        let screen_height = 800.0;

        let r1 = pixel_to_world(pixel_size, sse_denominator, screen_height, 100_000.0);
        let r2 = pixel_to_world(pixel_size, sse_denominator, screen_height, 200_000.0);
        assert_abs_diff_eq!(r2, r1 * 2.0, epsilon = 1e-6);
    }

    // --- compute_sprite_radius tests ---

    #[test]
    fn compute_sprite_radius_size_in_meters_returns_size_directly() {
        let radius = compute_sprite_radius(
            42.0,
            true, // size_in_meters
            1.0,
            800.0,
            Vec3::new(0.0, 0.0, 1000.0),
            Vec3::ZERO,
        );
        assert_abs_diff_eq!(radius, 42.0, epsilon = 1e-10);
    }

    #[test]
    fn compute_sprite_radius_size_in_meters_ignores_camera_distance() {
        // Changing camera position should not affect the result when size_in_meters = true.
        let r1 = compute_sprite_radius(
            100.0,
            true,
            1.0,
            800.0,
            Vec3::new(0.0, 0.0, 1000.0),
            Vec3::ZERO,
        );
        let r2 = compute_sprite_radius(
            100.0,
            true,
            1.0,
            800.0,
            Vec3::new(0.0, 0.0, 100_000.0),
            Vec3::ZERO,
        );
        assert_abs_diff_eq!(r1, r2, epsilon = 1e-10);
    }

    #[test]
    fn compute_sprite_radius_pixel_mode_uses_pixel_to_world() {
        let size = 16.0_f32;
        let sse_denominator = 1.0;
        let screen_height = 800.0;
        let camera_pos = Vec3::new(0.0, 0.0, 50_000.0);
        let world_pos = Vec3::ZERO;

        let radius = compute_sprite_radius(
            size,
            false, // pixel mode
            sse_denominator,
            screen_height,
            camera_pos,
            world_pos,
        );

        let distance = (camera_pos - world_pos).length();
        let expected = pixel_to_world(size as f64, sse_denominator, screen_height, distance);
        assert_abs_diff_eq!(radius, expected, epsilon = 1e-10);
    }

    #[test]
    fn compute_sprite_radius_pixel_mode_grows_with_distance() {
        let size = 16.0_f32;
        let sse_denominator = 1.0;
        let screen_height = 800.0;
        let world_pos = Vec3::ZERO;

        let r_near = compute_sprite_radius(
            size,
            false,
            sse_denominator,
            screen_height,
            Vec3::new(0.0, 0.0, 100_000.0),
            world_pos,
        );
        let r_far = compute_sprite_radius(
            size,
            false,
            sse_denominator,
            screen_height,
            Vec3::new(0.0, 0.0, 1_000_000.0),
            world_pos,
        );
        assert!(r_far > r_near);
    }

    #[test]
    fn compute_sprite_radius_pixel_mode_zero_distance_returns_zero() {
        // Camera at same position as world_pos → distance = 0 → returns 0 (matches shader)
        let radius = compute_sprite_radius(
            16.0,
            false,
            1.0,
            800.0,
            Vec3::new(100.0, 200.0, 300.0),
            Vec3::new(100.0, 200.0, 300.0),
        );
        assert_abs_diff_eq!(radius, 0.0, epsilon = 1e-10);
    }

    // --- is_point_visible tests ---

    /// Helper: create a frustum and occluder for a camera at the given ECEF position,
    /// looking toward the Earth's center.
    fn make_frustum_and_occluder(camera_ecef: Vec3) -> (CameraFrustum, EllipsoidalOccluder, Vec3) {
        use navara_core::Angle;
        use navara_math::Transform;

        let transform = Transform::from_translation(camera_ecef).looking_at(Vec3::ZERO, Vec3::Y);
        let fov_deg = 60.0;
        let frustum =
            CameraFrustum::new(&transform, 0.1, 1e9, Angle::new(fov_deg).rad().val(), 1.0);
        let occluder = EllipsoidalOccluder::new(&camera_ecef, WGS84_64);
        (frustum, occluder, camera_ecef)
    }

    #[test]
    fn is_point_visible_in_front_of_camera() {
        use navara_core::WGS84_A_64;
        // Camera above (0°N, 0°E) at 2x Earth radius
        let camera_ecef = Vec3::new(WGS84_A_64 * 2.0, 0.0, 0.0);
        let (frustum, occluder, cam_pos) = make_frustum_and_occluder(camera_ecef);

        // Point at (0°N, 0°E) on the surface — directly below the camera
        let visible = is_point_visible(
            Vec3::new(0.0, 0.0, 0.0), // lng=0, lat=0 in Geographic CRS
            &CRS::Geographic,
            0.0,
            16.0,
            false,
            &frustum,
            &occluder,
            cam_pos,
            800.0,
            &TerrainExaggeration::default(),
        );
        assert!(visible, "point directly below camera should be visible");
    }

    #[test]
    fn is_point_visible_behind_camera() {
        use navara_core::WGS84_A_64;
        // Camera above (0°N, 0°E)
        let camera_ecef = Vec3::new(WGS84_A_64 * 2.0, 0.0, 0.0);
        let (frustum, occluder, cam_pos) = make_frustum_and_occluder(camera_ecef);

        // Point at (0°N, 180°E) — opposite side of the globe, behind the camera
        let visible = is_point_visible(
            Vec3::new(180.0, 0.0, 0.0),
            &CRS::Geographic,
            0.0,
            16.0,
            false,
            &frustum,
            &occluder,
            cam_pos,
            800.0,
            &TerrainExaggeration::default(),
        );
        assert!(
            !visible,
            "point on opposite side of globe should not be visible"
        );
    }

    /// Terrain the exaggeration lifts above sea level is seen beyond the
    /// sea-level horizon.
    #[test]
    fn is_point_visible_beyond_the_sea_level_horizon_on_raised_terrain() {
        use navara_core::WGS84_A_64;
        use navara_math::Transform;

        // 1 km above (0°N, 0°E): the sea-level horizon is ~113 km away.
        let camera_ecef = Vec3::new(WGS84_A_64 + 1000., 0., 0.);
        // A point at sea level ~170 km east, beyond that horizon.
        let lng = 1.53;
        let target = CRS::Geographic.to_vec3(WGS84_64, Vec3::new(lng, 0., 0.), 0.);
        let transform = Transform::from_translation(camera_ecef).looking_at(target, Vec3::Z);
        let frustum = CameraFrustum::new(&transform, 0.1, 1e9, 60f64.to_radians(), 1.0);
        let occluder = EllipsoidalOccluder::new(&camera_ecef, WGS84_64);
        let visible = |exaggeration: &TerrainExaggeration| {
            is_point_visible(
                Vec3::new(lng, 0., 0.),
                &CRS::Geographic,
                0.0,
                1.0,
                true,
                &frustum,
                &occluder,
                camera_ecef,
                800.0,
                exaggeration,
            )
        };

        // Scale 0 lifts every surface to 1000 m, whose horizon reaches ~226 km.
        assert!(visible(&TerrainExaggeration::new(0., 1000.)));
        // Flattened onto the ellipsoid, the point is hidden.
        assert!(!visible(&TerrainExaggeration::new(0., 0.)));
    }

    #[test]
    fn is_point_visible_occluded_by_horizon() {
        use navara_core::WGS84_A_64;
        // Camera very close to surface above (0°N, 0°E)
        let camera_ecef = Vec3::new(WGS84_A_64 * 1.001, 0.0, 0.0);
        let (frustum, occluder, cam_pos) = make_frustum_and_occluder(camera_ecef);

        // Point at (0°N, 90°E) — on the limb/far side, occluded by Earth's curvature
        let visible = is_point_visible(
            Vec3::new(90.0, 0.0, 0.0),
            &CRS::Geographic,
            0.0,
            1.0,
            true, // small meter-size to avoid bounding sphere passing frustum
            &frustum,
            &occluder,
            cam_pos,
            800.0,
            &TerrainExaggeration::default(),
        );
        assert!(!visible, "point past the horizon should be occluded");
    }
}
