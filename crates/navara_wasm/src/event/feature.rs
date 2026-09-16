use navara_buffer_store::Handle;
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::{
    Transform,
    geometry::{
        TransferableModelGeometry, TransferablePointGeometry, TransferablePolygonGeometry,
        TransferablePolygonOutlineGeometry, TransferablePolylineGeometry,
    },
};
use navara_wasm_types::{
    Aabb, BillboardMaterial, BoundingSphere, CRS, ModelMaterial, PointMaterial, PolygonMaterial,
    PolylineMaterial, TextMaterial, polygon::TransferablePolygonBatchedFeature,
    polyline::TransferablePolylineBatchedFeature,
};

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct PointMesh {
    #[wasm_bindgen(getter_with_clone)]
    pub material: PointMaterial,
    pub transform: Transform,
    #[wasm_bindgen(getter_with_clone)]
    pub geometry: TransferablePointGeometry,
    pub active: bool,
    pub batch_length: u32,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct BillboardMesh {
    #[wasm_bindgen(getter_with_clone)]
    pub material: BillboardMaterial,
    pub transform: Transform,
    #[wasm_bindgen(getter_with_clone)]
    pub geometry: TransferablePointGeometry,
    pub active: bool,
    pub batch_length: u32,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct TextMesh {
    #[wasm_bindgen(getter_with_clone)]
    pub material: TextMaterial,
    pub transform: Transform,
    #[wasm_bindgen(getter_with_clone)]
    pub geometry: TransferablePointGeometry,
    pub active: bool,
    pub batch_length: u32,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct PolylineMesh {
    #[wasm_bindgen(getter_with_clone)]
    pub material: PolylineMaterial,
    #[wasm_bindgen(getter_with_clone)]
    pub geometry: TransferablePolylineGeometry,
    pub transform: Transform,
    pub active: bool,
    /// Whether the polyline should be rendered as a texturized draped feature
    pub should_be_texturized: bool,
    pub batch_length: u32,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct PolygonMesh {
    #[wasm_bindgen(getter_with_clone)]
    pub material: PolygonMaterial,
    #[wasm_bindgen(getter_with_clone)]
    pub geometry: TransferablePolygonGeometry,
    #[wasm_bindgen(getter_with_clone)]
    pub outline_geometry: Option<TransferablePolygonOutlineGeometry>,
    pub transform: Transform,
    pub active: bool,
    #[wasm_bindgen(getter_with_clone)]
    pub bounding_sphere: Option<BoundingSphere>,
    pub batch_length: u32,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct ModelMesh {
    #[wasm_bindgen(getter_with_clone)]
    pub material: ModelMaterial,
    pub transform: Transform,
    pub bin: Option<Handle>,
    pub aabb: Aabb,
    #[wasm_bindgen(getter_with_clone)]
    pub geometry: TransferableModelGeometry,
    pub active: bool,
    pub batch_length: u32,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Default, Serialize)]
pub struct RenderableFeature {
    #[wasm_bindgen(getter_with_clone)]
    pub point: Option<PointMesh>,
    #[wasm_bindgen(getter_with_clone)]
    pub billboard: Option<BillboardMesh>,
    #[wasm_bindgen(getter_with_clone)]
    pub text: Option<TextMesh>,
    #[wasm_bindgen(getter_with_clone)]
    pub polyline: Option<PolylineMesh>,
    #[wasm_bindgen(getter_with_clone)]
    pub polygon: Option<PolygonMesh>,
    #[wasm_bindgen(getter_with_clone)]
    pub model: Option<ModelMesh>,
}

impl<'a> From<&'a navara_feature_component::render::RenderableFeature> for RenderableFeature {
    fn from(v: &'a navara_feature_component::render::RenderableFeature) -> Self {
        match v {
            navara_feature_component::render::RenderableFeature::Point {
                material,
                transform,
                geometry,
                active,
                batch_length,
                ..
            } => Self {
                point: Some(PointMesh {
                    material: material.into(),
                    transform: transform.into(),
                    geometry: geometry.into(),
                    active: *active,
                    batch_length: *batch_length,
                }),
                ..Default::default()
            },
            navara_feature_component::render::RenderableFeature::Billboard {
                material,
                transform,
                geometry,
                active,
                batch_length,
                ..
            } => Self {
                billboard: Some(BillboardMesh {
                    material: material.into(),
                    transform: transform.into(),
                    geometry: geometry.into(),
                    active: *active,
                    batch_length: *batch_length,
                }),
                ..Default::default()
            },
            navara_feature_component::render::RenderableFeature::Text {
                material,
                transform,
                geometry,
                active,
                batch_length,
                ..
            } => Self {
                text: Some(TextMesh {
                    material: material.into(),
                    transform: transform.into(),
                    geometry: geometry.into(),
                    active: *active,
                    batch_length: *batch_length,
                }),
                ..Default::default()
            },
            navara_feature_component::render::RenderableFeature::Polyline {
                material,
                transform,
                geometry,
                active,
                render_info,
                batch_length,
                ..
            } => Self {
                polyline: Some(PolylineMesh {
                    material: material.into(),
                    geometry: geometry.into(),
                    transform: transform.into(),
                    active: *active,
                    should_be_texturized: render_info.should_be_texturized,
                    batch_length: *batch_length,
                }),
                ..Default::default()
            },
            navara_feature_component::render::RenderableFeature::Polygon {
                material,
                geometry,
                outline_geometry,
                transform,
                active,
                bounding_sphere,
                batch_length,
                ..
            } => Self {
                polygon: Some(PolygonMesh {
                    material: material.into(),
                    geometry: geometry.into(),
                    outline_geometry: outline_geometry.as_ref().map(|og| og.into()),
                    transform: transform.into(),
                    active: *active,
                    bounding_sphere: bounding_sphere.as_ref().map(|bs| (*bs).into()),
                    batch_length: *batch_length,
                }),
                ..Default::default()
            },
            navara_feature_component::render::RenderableFeature::Model {
                material,
                transform,
                bin,
                geometry,
                active,
                aabb,
                batch_length,
                ..
            } => Self {
                model: Some(ModelMesh {
                    material: material.into(),
                    transform: transform.into(),
                    bin: bin.as_ref().map(|v| v.0),
                    aabb: aabb.clone().into(),
                    geometry: geometry.into(),
                    active: *active,
                    batch_length: *batch_length,
                }),
                ..Default::default()
            },
            navara_feature_component::render::RenderableFeature::Unknown => unreachable!(),
        }
    }
}

#[wasm_bindgen]
pub struct ReturnedTransferablePolygonBatchedFeature {
    pub(crate) transferable: TransferablePolygonBatchedFeature,
    #[wasm_bindgen(getter_with_clone)]
    pub material: PolygonMaterial,
}

#[wasm_bindgen]
impl ReturnedTransferablePolygonBatchedFeature {
    #[wasm_bindgen(js_name = "transferBatchIds")]
    pub fn transfer_batch_ids(&mut self) -> js_sys::Uint32Array {
        self.transferable.transfer_batch_ids()
    }

    #[wasm_bindgen(js_name = "transferBatchIndices")]
    pub fn transfer_batch_indices(&mut self) -> js_sys::Uint32Array {
        self.transferable.transfer_batch_indices()
    }

    #[wasm_bindgen(js_name = "transferOuterRing")]
    pub fn transfer_outer_ring(&mut self) -> js_sys::Float64Array {
        self.transferable.transfer_outer_ring()
    }

    #[wasm_bindgen(js_name = "transferOuterRingSizes")]
    pub fn transfer_outer_ring_sizes(&mut self) -> js_sys::Uint32Array {
        self.transferable.transfer_outer_ring_sizes()
    }

    #[wasm_bindgen(js_name = "transferHoles")]
    pub fn transfer_holes(&mut self) -> js_sys::Float64Array {
        self.transferable.transfer_holes()
    }

    #[wasm_bindgen(js_name = "transferHolesBoundaries")]
    pub fn transfer_holes_boundaries(&mut self) -> js_sys::Uint32Array {
        self.transferable.transfer_holes_boundaries()
    }

    #[wasm_bindgen(js_name = "transferHolesSizes")]
    pub fn transfer_holes_sizes(&mut self) -> js_sys::Uint32Array {
        self.transferable.transfer_holes_sizes()
    }

    #[wasm_bindgen(js_name = "transferHolesTotalSizes")]
    pub fn transfer_holes_total_sizes(&mut self) -> js_sys::Uint32Array {
        self.transferable.transfer_holes_total_sizes()
    }

    #[wasm_bindgen(js_name = "transferExpectedWindingOrders")]
    pub fn transfer_expected_winding_orders(&mut self) -> js_sys::Uint8Array {
        self.transferable.transfer_expected_winding_orders()
    }

    pub fn crs(&self) -> CRS {
        self.transferable.crs.clone()
    }

    pub fn length(&self) -> usize {
        self.transferable.length
    }
}

#[wasm_bindgen]
pub struct ReturnedTransferablePolylineBatchedFeature {
    pub(crate) transferable: TransferablePolylineBatchedFeature,
    #[wasm_bindgen(getter_with_clone)]
    pub material: PolylineMaterial,
}

#[wasm_bindgen]
impl ReturnedTransferablePolylineBatchedFeature {
    #[wasm_bindgen(js_name = "transferBatchIds")]
    pub fn transfer_batch_ids(&mut self) -> js_sys::Uint32Array {
        self.transferable.transfer_batch_ids()
    }

    #[wasm_bindgen(js_name = "transferBatchIndices")]
    pub fn transfer_batch_indices(&mut self) -> js_sys::Uint32Array {
        self.transferable.transfer_batch_indices()
    }

    #[wasm_bindgen(js_name = "transferPoints")]
    pub fn transfer_points(&mut self) -> js_sys::Float64Array {
        self.transferable.transfer_points()
    }

    #[wasm_bindgen(js_name = "transferPointsSizes")]
    pub fn transfer_points_sizes(&mut self) -> js_sys::Uint32Array {
        self.transferable.transfer_points_sizes()
    }

    #[wasm_bindgen(js_name = "transferRingFlags")]
    pub fn transfer_ring_flags(&mut self) -> js_sys::Uint8Array {
        self.transferable.transfer_ring_flags()
    }

    pub fn crs(&self) -> CRS {
        self.transferable.crs.clone()
    }

    pub fn length(&self) -> usize {
        self.transferable.length
    }
}
