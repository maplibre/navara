//! Trait abstraction for 3D Tiles content format parsing.
//!
//! Different tile content formats (B3DM, PNTS, GLB, glTF Features) share
//! the same lifecycle but differ in how raw data is parsed into model
//! components. This module defines the `TileContentParser` trait that
//! abstracts the format-specific parsing logic, allowing generic systems
//! to handle all formats uniformly.

use bevy_ecs::component::Component;
use navara_buffer_store::{BufferStore, Handle};
use navara_core::{Aabb, CRS};
use navara_feature_component::batch::{BatchTable, FeatureBatchId, GlobalBatchIds};
use navara_material::ModelMaterial;
use navara_math::{PI_OVER_TWO, Quat, Transform, Vec3};

/// Callback to modify the model appearance after creation.
pub type AppearanceModifier = Box<dyn FnOnce(&mut ModelMaterial) + Send + Sync>;

/// Callback to insert extra components on the spawned entity.
pub type ExtraComponentsInserter =
    Box<dyn FnOnce(&mut bevy_ecs::system::EntityCommands) + Send + Sync>;

/// Output of format-specific parsing.
///
/// Contains everything needed to spawn the model entity beyond the
/// common components that every format shares.
pub struct ParsedTileContent {
    /// Center/origin coordinates for `ModelGeometry`
    pub coords: Vec3,
    /// Coordinate reference system
    pub crs: CRS,
    /// Handle to the binary model data (GLB, point positions, etc.)
    pub model_bin_handle: Handle,
    /// Transform for the spawned entity
    pub transform: Transform,
    /// Feature batch ID (0 if no batch table)
    pub feature_batch_id: FeatureBatchId,
    /// Global batch IDs for per-feature identification
    pub global_batch_ids: GlobalBatchIds,
    /// Optional modification to appearance (e.g., PNTS sets ModelInternalMaterial)
    pub appearance_modifier: Option<AppearanceModifier>,
    /// Optional extra components to insert (e.g., Aabb for PNTS)
    pub extra_components: Option<ExtraComponentsInserter>,
}

/// Resources available during format-specific parsing.
///
/// No large data is cloned — `buf` and `batch_table` are mutable references,
/// and `Handle` is `Copy` (i32 alias).
pub struct ParseContext<'a> {
    /// Buffer store for reading/writing binary data
    pub buf: &'a mut BufferStore,
    /// Batch table resource for generating global batch IDs
    pub batch_table: &'a mut BatchTable,
    /// Handle to the raw tile data in BufferStore (Copy, no clone)
    pub requester_handle: Handle,
    /// Layer ID string
    pub layer_id: &'a str,
    /// Tile transform from tileset.json (available for PNTS)
    pub tile_transform: Option<&'a Transform>,
    /// Tile bounding box (available for PNTS)
    pub tile_aabb: Option<&'a Aabb>,
    /// Tileset-level schema for 3D Tiles 1.1 property resolution
    pub tileset_schema: Option<&'a serde_json::Value>,
}

/// Trait that each tile content format implements to define
/// how raw tile data is parsed and converted into model entities.
///
/// Each implementation provides marker component types for query filtering
/// and a `parse` method that extracts format-specific data.
///
/// # Adding a new format
///
/// 1. Create a struct (e.g., `I3dmParser`) and implement this trait
/// 2. Define tile and requester marker components
/// 3. Implement `parse()` with format-specific extraction logic
/// 4. Register generic systems in the plugin with the new type parameter
pub trait TileContentParser: 'static + Send + Sync {
    /// Marker component on the `RenderedCesium3dTileContent` entity
    type RenderedMarker: Component;
    /// Marker component on the `DataRequester` entity
    type RequesterMarker: Component;
    /// Whether `ParsedTileContent::model_bin_handle` holds a glTF, whose
    /// relative URIs resolve against the tile URL.
    const BIN_IS_GLTF: bool;

    /// Parse raw tile data and produce components for the model entity.
    ///
    /// Returns `None` to skip this tile (parse failure or unsupported data).
    fn parse(ctx: &mut ParseContext) -> Option<ParsedTileContent>;
}

/// Places glTF content as `tile_transform * T(rtc_center) * Y-up→Z-up`,
/// split into the ECEF origin for `ModelGeometry::coords` and the transform
/// applied around it.
pub fn gltf_placement(tile_transform: Option<&Transform>, rtc_center: Vec3) -> (Vec3, Transform) {
    let y_up_to_z_up = Transform::from_rotation(Quat::from_rotation_x(PI_OVER_TWO));
    match tile_transform {
        Some(tile) => {
            let linear = Transform {
                translation: Vec3::ZERO,
                ..*tile
            };
            (
                tile.transform_point(rtc_center),
                linear.mul_transform(y_up_to_z_up),
            )
        }
        None => (rtc_center, y_up_to_z_up),
    }
}

#[cfg(test)]
mod tests {
    use approx::assert_abs_diff_eq;
    use navara_math::Mat4;

    use super::*;

    #[test]
    fn gltf_placement_applies_rtc_inside_tile_transform() {
        let tile = Transform::from_matrix(Mat4::from_cols_array(&[
            0., 2., 0., 0., //
            -2., 0., 0., 0., //
            0., 0., 2., 0., //
            100., 200., 300., 1.,
        ]));
        let rtc = Vec3::new(1., 2., 3.);
        let (coords, transform) = gltf_placement(Some(&tile), rtc);

        let p = Vec3::new(4., 5., 6.);
        let expected = tile.transform_point(rtc + y_up_to_z_up_point(p));
        let actual = coords + transform.transform_point(p);
        assert_abs_diff_eq!(actual.x, expected.x, epsilon = 1e-9);
        assert_abs_diff_eq!(actual.y, expected.y, epsilon = 1e-9);
        assert_abs_diff_eq!(actual.z, expected.z, epsilon = 1e-9);
    }

    fn y_up_to_z_up_point(p: Vec3) -> Vec3 {
        Vec3::new(p.x, -p.z, p.y)
    }
}
