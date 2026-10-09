use navara_buffer_store::Handle;
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::attribute::{TransferableFloatAttribute, TransferableUintAttribute};

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct TransferableGeometry {
    pub vertices: Handle,
    pub uvs: Handle,
    pub indices: Handle,
    pub normals: Option<Handle>,
    pub skirt_vertices: Option<Handle>,
    pub skirt_uvs: Option<Handle>,
    pub skirt_indices: Option<Handle>,
    pub skirt_normals: Option<Handle>,
    pub skirt_heights: Option<Handle>,
}

#[wasm_bindgen]
impl TransferableGeometry {
    #[wasm_bindgen(constructor)]
    pub fn new(vertices: Handle, uvs: Handle, indices: Handle) -> Self {
        Self {
            vertices,
            uvs,
            indices,
            normals: None,
            skirt_vertices: None,
            skirt_uvs: None,
            skirt_indices: None,
            skirt_normals: None,
            skirt_heights: None,
        }
    }
}

impl From<TransferableGeometry> for navara_geometry::TransferableGeometry {
    fn from(val: TransferableGeometry) -> Self {
        navara_geometry::TransferableGeometry {
            vertices: val.vertices,
            uvs: val.uvs,
            indices: val.indices,
            normals: val.normals,
            skirt_vertices: val.skirt_vertices,
            skirt_uvs: val.skirt_uvs,
            skirt_indices: val.skirt_indices,
            skirt_normals: val.skirt_normals,
            skirt_heights: val.skirt_heights,
        }
    }
}
impl<'a> From<&'a navara_geometry::TransferableGeometry> for TransferableGeometry {
    fn from(val: &'a navara_geometry::TransferableGeometry) -> Self {
        TransferableGeometry {
            vertices: val.vertices,
            uvs: val.uvs,
            indices: val.indices,
            normals: val.normals,
            skirt_vertices: val.skirt_vertices,
            skirt_uvs: val.skirt_uvs,
            skirt_indices: val.skirt_indices,
            skirt_normals: val.skirt_normals,
            skirt_heights: val.skirt_heights,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct TransferablePolylineGeometry {
    #[wasm_bindgen(getter_with_clone)]
    pub position: TransferableFloatAttribute,
    #[wasm_bindgen(getter_with_clone)]
    pub position_high: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub position_low: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub start: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub start_high: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub start_low: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub forward_offset: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub end_high: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub end_low: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub start_normals: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub end_normal_and_texture_coordinate_normalization_x: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub right_normal_and_texture_coordinate_normalization_y: TransferableFloatAttribute,
    #[wasm_bindgen(getter_with_clone)]
    pub batch_ids: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub batch_index: Option<TransferableUintAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub indices: Handle,
}

#[wasm_bindgen]
impl TransferablePolylineGeometry {
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(constructor)]
    pub fn new(
        position: TransferableFloatAttribute,
        position_high: Option<TransferableFloatAttribute>,
        position_low: Option<TransferableFloatAttribute>,
        start: Option<TransferableFloatAttribute>,
        start_high: Option<TransferableFloatAttribute>,
        start_low: Option<TransferableFloatAttribute>,
        forward_offset: Option<TransferableFloatAttribute>,
        end_high: Option<TransferableFloatAttribute>,
        end_low: Option<TransferableFloatAttribute>,
        start_normals: Option<TransferableFloatAttribute>,
        end_normal_and_texture_coordinate_normalization_x: Option<TransferableFloatAttribute>,
        right_normal_and_texture_coordinate_normalization_y: TransferableFloatAttribute,
        batch_ids: Option<TransferableFloatAttribute>,
        batch_index: Option<TransferableUintAttribute>,
        indices: Handle,
    ) -> Self {
        Self {
            position,
            position_high,
            position_low,
            start,
            start_high,
            start_low,
            forward_offset,
            end_high,
            end_low,
            start_normals,
            end_normal_and_texture_coordinate_normalization_x,
            right_normal_and_texture_coordinate_normalization_y,
            batch_ids,
            batch_index,
            indices,
        }
    }
}

impl From<TransferablePolylineGeometry>
    for navara_feature_component::render::TransferablePolylineGeometry
{
    fn from(val: TransferablePolylineGeometry) -> Self {
        navara_feature_component::render::TransferablePolylineGeometry {
            position: val.position.into(),
            position_high: val.position_high.map(|p| p.into()),
            position_low: val.position_low.map(|p| p.into()),
            start: val.start.map(|p| p.into()),
            start_high: val.start_high.map(|p| p.into()),
            start_low: val.start_low.map(|p| p.into()),
            forward_offset: val.forward_offset.map(|p| p.into()),
            end_high: val.end_high.map(|p| p.into()),
            end_low: val.end_low.map(|p| p.into()),
            start_normals: val.start_normals.map(|p| p.into()),
            end_normal_and_texture_coordinate_normalization_x: val
                .end_normal_and_texture_coordinate_normalization_x
                .map(|p| p.into()),
            right_normal_and_texture_coordinate_normalization_y: val
                .right_normal_and_texture_coordinate_normalization_y
                .into(),
            batch_ids: val.batch_ids.map(|b| b.into()),
            batch_index: val.batch_index.map(|b| b.into()),
            indices: val.indices,
        }
    }
}
impl<'a> From<&'a navara_feature_component::render::TransferablePolylineGeometry>
    for TransferablePolylineGeometry
{
    fn from(
        val: &'a navara_feature_component::render::TransferablePolylineGeometry,
    ) -> TransferablePolylineGeometry {
        TransferablePolylineGeometry {
            position: (&val.position).into(),
            position_high: val.position_high.as_ref().map(|p| p.into()),
            position_low: val.position_low.as_ref().map(|p| p.into()),
            start: val.start.as_ref().map(|p| p.into()),
            start_high: val.start_high.as_ref().map(|p| p.into()),
            start_low: val.start_low.as_ref().map(|p| p.into()),
            forward_offset: val.forward_offset.as_ref().map(|p| p.into()),
            end_high: val.end_high.as_ref().map(|p| p.into()),
            end_low: val.end_low.as_ref().map(|p| p.into()),
            start_normals: val.start_normals.as_ref().map(|p| p.into()),
            end_normal_and_texture_coordinate_normalization_x: val
                .end_normal_and_texture_coordinate_normalization_x
                .as_ref()
                .map(|p| p.into()),
            right_normal_and_texture_coordinate_normalization_y: (&val
                .right_normal_and_texture_coordinate_normalization_y)
                .into(),
            batch_ids: val.batch_ids.as_ref().map(|b| b.into()),
            batch_index: val.batch_index.as_ref().map(|b| b.into()),
            indices: val.indices,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct TransferablePolygonGeometry {
    #[wasm_bindgen(getter_with_clone)]
    pub position: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub position_3d_high: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub position_3d_low: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub normal: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub scale_normal_and_cap: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub batch_ids: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub batch_index: Option<TransferableUintAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub indices: Handle,
}

#[wasm_bindgen]
impl TransferablePolygonGeometry {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        position: Option<TransferableFloatAttribute>,
        position_3d_high: Option<TransferableFloatAttribute>,
        position_3d_low: Option<TransferableFloatAttribute>,
        normal: Option<TransferableFloatAttribute>,
        scale_normal_and_cap: Option<TransferableFloatAttribute>,
        batch_ids: Option<TransferableFloatAttribute>,
        batch_index: Option<TransferableUintAttribute>,
        indices: Handle,
    ) -> Self {
        Self {
            position,
            position_3d_high,
            position_3d_low,
            normal,
            scale_normal_and_cap,
            batch_ids,
            batch_index,
            indices,
        }
    }
}

impl From<TransferablePolygonGeometry>
    for navara_feature_component::render::TransferablePolygonGeometry
{
    fn from(val: TransferablePolygonGeometry) -> Self {
        navara_feature_component::render::TransferablePolygonGeometry {
            position: val.position.map(|p| p.into()),
            position_3d_high: val.position_3d_high.map(|p| p.into()),
            position_3d_low: val.position_3d_low.map(|p| p.into()),
            normal: val.normal.map(|n| n.into()),
            scale_normal_and_cap: val.scale_normal_and_cap.map(|n| n.into()),
            batch_ids: val.batch_ids.map(|n| n.into()),
            batch_index: val.batch_index.map(|n| n.into()),
            indices: val.indices,
        }
    }
}
impl<'a> From<&'a navara_feature_component::render::TransferablePolygonGeometry>
    for TransferablePolygonGeometry
{
    fn from(
        val: &'a navara_feature_component::render::TransferablePolygonGeometry,
    ) -> TransferablePolygonGeometry {
        TransferablePolygonGeometry {
            position: val.position.as_ref().map(|p| p.into()),
            position_3d_high: val.position_3d_high.as_ref().map(|p| p.into()),
            position_3d_low: val.position_3d_low.as_ref().map(|p| p.into()),
            normal: val.normal.as_ref().map(|n| n.into()),
            scale_normal_and_cap: val.scale_normal_and_cap.as_ref().map(|n| n.into()),
            batch_ids: val.batch_ids.as_ref().map(|n| n.into()),
            batch_index: val.batch_index.as_ref().map(|n| n.into()),
            indices: val.indices,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct TransferablePolygonOutlineGeometry {
    #[wasm_bindgen(getter_with_clone)]
    pub position: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub position_3d_high: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub position_3d_low: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub scale_normal_and_cap: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub skip_indices: Option<Handle>,
    #[wasm_bindgen(getter_with_clone)]
    pub batch_index: Option<TransferableFloatAttribute>,
}

#[wasm_bindgen]
impl TransferablePolygonOutlineGeometry {
    #[wasm_bindgen(constructor)]
    pub fn new(
        position: Option<TransferableFloatAttribute>,
        position_3d_high: Option<TransferableFloatAttribute>,
        position_3d_low: Option<TransferableFloatAttribute>,
        scale_normal_and_cap: Option<TransferableFloatAttribute>,
        skip_indices: Option<Handle>,
        batch_index: Option<TransferableFloatAttribute>,
    ) -> Self {
        Self {
            position,
            position_3d_high,
            position_3d_low,
            scale_normal_and_cap,
            skip_indices,
            batch_index,
        }
    }
}

impl From<TransferablePolygonOutlineGeometry>
    for navara_feature_component::render::TransferablePolygonOutlineGeometry
{
    fn from(val: TransferablePolygonOutlineGeometry) -> Self {
        navara_feature_component::render::TransferablePolygonOutlineGeometry {
            position: val.position.map(|p| p.into()),
            position_3d_high: val.position_3d_high.map(|p| p.into()),
            position_3d_low: val.position_3d_low.map(|p| p.into()),
            scale_normal_and_cap: val.scale_normal_and_cap.map(|p| p.into()),
            skip_indices: val.skip_indices,
            batch_index: val.batch_index.map(|b| b.into()),
        }
    }
}
impl<'a> From<&'a navara_feature_component::render::TransferablePolygonOutlineGeometry>
    for TransferablePolygonOutlineGeometry
{
    fn from(
        val: &'a navara_feature_component::render::TransferablePolygonOutlineGeometry,
    ) -> TransferablePolygonOutlineGeometry {
        TransferablePolygonOutlineGeometry {
            position: val.position.as_ref().map(|p| p.into()),
            position_3d_high: val.position_3d_high.as_ref().map(|p| p.into()),
            position_3d_low: val.position_3d_low.as_ref().map(|p| p.into()),
            scale_normal_and_cap: val.scale_normal_and_cap.as_ref().map(|p| p.into()),
            skip_indices: val.skip_indices,
            batch_index: val.batch_index.as_ref().map(|b| b.into()),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct TransferablePointGeometry {
    #[wasm_bindgen(getter_with_clone)]
    pub position: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub position_3d_high: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub position_3d_low: Option<TransferableFloatAttribute>,
    #[wasm_bindgen(getter_with_clone)]
    pub batch_ids: TransferableFloatAttribute,
    #[wasm_bindgen(getter_with_clone)]
    pub batch_index: TransferableUintAttribute,
    /// Per-anchor tangent bearing in degrees clockwise from north, present only
    /// when the anchors were placed along a line.
    #[wasm_bindgen(getter_with_clone)]
    pub bearings: Option<TransferableFloatAttribute>,
    /// Per-anchor `(min, max]` ground metres per screen pixel over which it is
    /// shown; `size` is the stride. Present exactly when `bearings` is.
    #[wasm_bindgen(getter_with_clone)]
    pub scale_bands: Option<TransferableFloatAttribute>,
    /// Per-anchor east/north samples of the line, for bending glyphs along it.
    /// `size` is the stride: two floats per sample.
    #[wasm_bindgen(getter_with_clone)]
    pub path_samples: Option<TransferableFloatAttribute>,
    /// Per-anchor metres between adjacent path samples, then metres of real
    /// line either side of the anchor.
    #[wasm_bindgen(getter_with_clone)]
    pub path_meta: Option<TransferableFloatAttribute>,
}

impl From<TransferablePointGeometry>
    for navara_feature_component::render::TransferablePointGeometry
{
    fn from(val: TransferablePointGeometry) -> Self {
        navara_feature_component::render::TransferablePointGeometry {
            position: val.position.map(|p| p.into()),
            position_3d_high: val.position_3d_high.map(|p| p.into()),
            position_3d_low: val.position_3d_low.map(|p| p.into()),
            batch_ids: val.batch_ids.into(),
            batch_index: val.batch_index.into(),
            bearings: val.bearings.map(|b| b.into()),
            scale_bands: val.scale_bands.map(|b| b.into()),
            path_samples: val.path_samples.map(|b| b.into()),
            path_meta: val.path_meta.map(|b| b.into()),
        }
    }
}

impl<'a> From<&'a navara_feature_component::render::TransferablePointGeometry>
    for TransferablePointGeometry
{
    fn from(val: &'a navara_feature_component::render::TransferablePointGeometry) -> Self {
        TransferablePointGeometry {
            position: val.position.as_ref().map(|p| p.into()),
            position_3d_high: val.position_3d_high.as_ref().map(|p| p.into()),
            position_3d_low: val.position_3d_low.as_ref().map(|p| p.into()),
            batch_ids: (&val.batch_ids).into(),
            batch_index: (&val.batch_index).into(),
            bearings: val.bearings.as_ref().map(|b| b.into()),
            scale_bands: val.scale_bands.as_ref().map(|b| b.into()),
            path_samples: val.path_samples.as_ref().map(|b| b.into()),
            path_meta: val.path_meta.as_ref().map(|b| b.into()),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct TransferableModelGeometry {
    #[wasm_bindgen(getter_with_clone)]
    pub batch_ids: Option<TransferableFloatAttribute>,
}

impl From<TransferableModelGeometry>
    for navara_feature_component::render::TransferableModelGeometry
{
    fn from(val: TransferableModelGeometry) -> Self {
        navara_feature_component::render::TransferableModelGeometry {
            batch_ids: val.batch_ids.map(|b| b.into()),
        }
    }
}
impl<'a> From<&'a navara_feature_component::render::TransferableModelGeometry>
    for TransferableModelGeometry
{
    fn from(
        val: &'a navara_feature_component::render::TransferableModelGeometry,
    ) -> TransferableModelGeometry {
        TransferableModelGeometry {
            batch_ids: val.batch_ids.as_ref().map(|b| b.into()),
        }
    }
}
