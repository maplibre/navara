use navara_wasm_types::{ExtentRadianF32, Vec3};
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::{
    entity::ReconstructableEntity,
    geometry::{TransferablePolygonGeometry, TransferablePolygonOutlineGeometry},
};

#[wasm_bindgen]
#[derive(Clone, Debug, Serialize)]
pub struct ConstructPolygonBatchedFeatureParameters {
    #[wasm_bindgen(getter_with_clone)]
    pub batched_feature: ReconstructableEntity,
    pub flat: bool,
    pub tile_extent: Option<ExtentRadianF32>,
}

impl<'a> From<&'a navara_worker::construct_polygon_batched_feature::ConstructPolygonBatchedFeatureParameters>
    for ConstructPolygonBatchedFeatureParameters
{
    fn from(
        val: &'a navara_worker::construct_polygon_batched_feature::ConstructPolygonBatchedFeatureParameters,
    ) -> ConstructPolygonBatchedFeatureParameters {
        ConstructPolygonBatchedFeatureParameters {
            batched_feature: ReconstructableEntity(val.batched_feature.to_bits()),
            flat: val.flat,
            tile_extent: val.tile_extent.map(|t| (&t).into()),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug, Serialize)]
pub struct ConstructPolygonBatchedFeatureResult {
    #[wasm_bindgen(getter_with_clone)]
    pub geometry: TransferablePolygonGeometry,
    #[wasm_bindgen(getter_with_clone)]
    pub outline_geometry: Option<TransferablePolygonOutlineGeometry>,
    pub extent: Option<ExtentRadianF32>,
    /// RTC (Relative-To-Center) translation vector
    pub rtc_translation: Option<Vec3>,
}

#[wasm_bindgen]
impl ConstructPolygonBatchedFeatureResult {
    #[wasm_bindgen(constructor)]
    pub fn new(
        geometry: TransferablePolygonGeometry,
        outline_geometry: Option<TransferablePolygonOutlineGeometry>,
        extent: Option<ExtentRadianF32>,
        rtc_translation: Option<Vec3>,
    ) -> Self {
        Self {
            geometry,
            outline_geometry,
            extent,
            rtc_translation,
        }
    }
}

impl From<ConstructPolygonBatchedFeatureResult>
    for navara_worker::construct_polygon_batched_feature::ConstructPolygonBatchedFeatureResult
{
    fn from(val: ConstructPolygonBatchedFeatureResult) -> Self {
        navara_worker::construct_polygon_batched_feature::ConstructPolygonBatchedFeatureResult {
            geometry: val.geometry.into(),
            outline_geometry: val.outline_geometry.map(|og| og.into()),
            extent: val.extent.map(|e| e.into()),
            rtc_translation: val.rtc_translation.map(|v| v.into()),
        }
    }
}
impl<'a>
    From<&'a navara_worker::construct_polygon_batched_feature::ConstructPolygonBatchedFeatureResult>
    for ConstructPolygonBatchedFeatureResult
{
    fn from(
        val: &'a navara_worker::construct_polygon_batched_feature::ConstructPolygonBatchedFeatureResult,
    ) -> ConstructPolygonBatchedFeatureResult {
        ConstructPolygonBatchedFeatureResult {
            geometry: (&val.geometry).into(),
            outline_geometry: val.outline_geometry.as_ref().map(|og| og.into()),
            extent: val.extent.as_ref().map(|e| e.into()),
            rtc_translation: val.rtc_translation.map(|v| v.into()),
        }
    }
}
