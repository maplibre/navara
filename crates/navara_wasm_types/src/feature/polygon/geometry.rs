use wasm_bindgen::prelude::*;

use crate::{ExtentRadianF32, FloatAttribute, UintAttribute, Vec3, copy_f32_array, copy_u32_array};

#[wasm_bindgen]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ConstructedPolygonOutlineGeometry {
    position: FloatAttribute,
    position_3d_high: Option<FloatAttribute>,
    position_3d_low: Option<FloatAttribute>,
    scale_normal_and_cap: FloatAttribute,
    skip_indices: Vec<u32>,
    batch_index: Option<FloatAttribute>,
}

impl ConstructedPolygonOutlineGeometry {
    pub fn new(
        position: FloatAttribute,
        position_3d_high: Option<FloatAttribute>,
        position_3d_low: Option<FloatAttribute>,
        scale_normal_and_cap: FloatAttribute,
        skip_indices: Vec<u32>,
        batch_index: Option<FloatAttribute>,
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

#[wasm_bindgen]
impl ConstructedPolygonOutlineGeometry {
    pub fn position(&mut self) -> js_sys::Float32Array {
        copy_f32_array(&self.position.data)
    }
    pub fn position_size(&self) -> u8 {
        self.position.size
    }
    pub fn position_3d_high(&mut self) -> Option<js_sys::Float32Array> {
        self.position_3d_high
            .as_ref()
            .map(|p| copy_f32_array(&p.data))
    }
    pub fn position_3d_high_size(&self) -> Option<u8> {
        self.position_3d_high.as_ref().map(|p| p.size)
    }
    pub fn position_3d_low(&mut self) -> Option<js_sys::Float32Array> {
        self.position_3d_low
            .as_ref()
            .map(|p| copy_f32_array(&p.data))
    }
    pub fn position_3d_low_size(&self) -> Option<u8> {
        self.position_3d_low.as_ref().map(|p| p.size)
    }
    pub fn scale_normal_and_cap(&mut self) -> js_sys::Float32Array {
        copy_f32_array(&self.scale_normal_and_cap.data)
    }
    pub fn scale_normal_and_cap_size(&self) -> u8 {
        self.scale_normal_and_cap.size
    }
    pub fn skip_indices(&mut self) -> js_sys::Uint32Array {
        copy_u32_array(&self.skip_indices)
    }
    pub fn batch_index(&mut self) -> Option<js_sys::Float32Array> {
        self.batch_index.as_ref().map(|b| copy_f32_array(&b.data))
    }
    pub fn batch_index_size(&self) -> Option<u8> {
        self.batch_index.as_ref().map(|b| b.size)
    }
}

#[wasm_bindgen]
pub struct ConstructedPolygonGeometry {
    geometry: PolygonGeometry,
    pub extent: Option<ExtentRadianF32>,
    /// RTC (Relative-To-Center) translation vector
    /// Contains the tile center in world-space ECEF coordinates
    /// Used to position the mesh while keeping vertex positions in local space
    pub rtc_translation: Option<Vec3>,
    outline: Option<ConstructedPolygonOutlineGeometry>,
}

impl ConstructedPolygonGeometry {
    pub fn new(
        geometry: PolygonGeometry,
        extent: Option<ExtentRadianF32>,
        rtc_translation: Option<Vec3>,
        outline: Option<ConstructedPolygonOutlineGeometry>,
    ) -> Self {
        Self {
            geometry,
            extent,
            rtc_translation,
            outline,
        }
    }
}

#[wasm_bindgen]
impl ConstructedPolygonGeometry {
    pub fn position_3d_high(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.position_3d_high()
    }
    pub fn position_3d_high_size(&mut self) -> Option<u8> {
        self.geometry.position_3d_high_size()
    }
    pub fn position_3d_low(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.position_3d_low()
    }
    pub fn position_3d_low_size(&mut self) -> Option<u8> {
        self.geometry.position_3d_low_size()
    }
    pub fn position(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.position()
    }
    pub fn position_size(&mut self) -> Option<u8> {
        self.geometry.position_size()
    }
    pub fn normal(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.normal()
    }
    pub fn normal_size(&mut self) -> Option<u8> {
        self.geometry.normal_size()
    }
    pub fn scale_normal_and_cap(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.scale_normal_and_cap()
    }
    pub fn scale_normal_and_cap_size(&mut self) -> Option<u8> {
        self.geometry.scale_normal_and_cap_size()
    }
    pub fn batch_id(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.batch_id()
    }
    pub fn batch_id_size(&mut self) -> Option<u8> {
        self.geometry.batch_id_size()
    }
    pub fn batch_index(&mut self) -> Option<js_sys::Uint32Array> {
        self.geometry.batch_index()
    }
    pub fn batch_index_size(&mut self) -> Option<u8> {
        self.geometry.batch_index_size()
    }
    pub fn indices(&mut self) -> js_sys::Uint32Array {
        self.geometry.indices()
    }
    pub fn outline(&mut self) -> Option<ConstructedPolygonOutlineGeometry> {
        self.outline.take()
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PolygonGeometry {
    attributes: PolygonGeometryAttributes,
    indices: Vec<u32>,
}

impl PolygonGeometry {
    pub fn new(attributes: PolygonGeometryAttributes, indices: Vec<u32>) -> Self {
        Self {
            attributes,
            indices,
        }
    }
}

#[wasm_bindgen]
impl PolygonGeometry {
    pub fn position_3d_high(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_position_3d_high()
    }
    pub fn position_3d_high_size(&mut self) -> Option<u8> {
        self.attributes.transfer_position_3d_high_size()
    }
    pub fn position_3d_low(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_position_3d_low()
    }
    pub fn position_3d_low_size(&mut self) -> Option<u8> {
        self.attributes.transfer_position_3d_low_size()
    }
    pub fn position(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_position()
    }
    pub fn position_size(&mut self) -> Option<u8> {
        self.attributes.transfer_position_size()
    }
    pub fn normal(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_normal()
    }
    pub fn normal_size(&mut self) -> Option<u8> {
        self.attributes.transfer_normal_size()
    }
    pub fn scale_normal_and_cap(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_scale_normal_and_cap()
    }
    pub fn scale_normal_and_cap_size(&mut self) -> Option<u8> {
        self.attributes.transfer_scale_normal_and_cap_size()
    }
    pub fn batch_id(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_batch_id()
    }
    pub fn batch_id_size(&mut self) -> Option<u8> {
        self.attributes.transfer_batch_id_size()
    }
    pub fn batch_index(&mut self) -> Option<js_sys::Uint32Array> {
        self.attributes.transfer_batch_index()
    }
    pub fn batch_index_size(&mut self) -> Option<u8> {
        self.attributes.transfer_batch_index_size()
    }
    pub fn indices(&mut self) -> js_sys::Uint32Array {
        copy_u32_array(&self.indices)
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PolygonGeometryAttributes {
    position: Option<FloatAttribute>,
    position_3d_high: Option<FloatAttribute>,
    position_3d_low: Option<FloatAttribute>,
    normal: Option<FloatAttribute>,
    scale_normal_and_cap: Option<FloatAttribute>,
    batch_ids: Option<FloatAttribute>,
    batch_index: Option<UintAttribute>,
}

#[wasm_bindgen]
impl PolygonGeometryAttributes {
    pub fn transfer_position_3d_high(&mut self) -> Option<js_sys::Float32Array> {
        self.position_3d_high.as_mut().map(|p| p.transfer_data())
    }
    pub fn transfer_position_3d_high_size(&mut self) -> Option<u8> {
        self.position_3d_high.as_ref().map(|p| p.size)
    }
    pub fn transfer_position_3d_low(&mut self) -> Option<js_sys::Float32Array> {
        self.position_3d_low.as_mut().map(|p| p.transfer_data())
    }
    pub fn transfer_position_3d_low_size(&mut self) -> Option<u8> {
        self.position_3d_low.as_ref().map(|p| p.size)
    }
    pub fn transfer_position(&mut self) -> Option<js_sys::Float32Array> {
        self.position.as_mut().map(|p| p.transfer_data())
    }
    pub fn transfer_position_size(&mut self) -> Option<u8> {
        self.position.as_ref().map(|p| p.size)
    }
    pub fn transfer_normal(&mut self) -> Option<js_sys::Float32Array> {
        let Some(normal) = &mut self.normal else {
            return None;
        };
        Some(normal.transfer_data())
    }
    pub fn transfer_normal_size(&mut self) -> Option<u8> {
        let Some(normal) = &mut self.normal else {
            return None;
        };
        Some(normal.size)
    }
    pub fn transfer_scale_normal_and_cap(&mut self) -> Option<js_sys::Float32Array> {
        let Some(scale_normal_and_cap) = &mut self.scale_normal_and_cap else {
            return None;
        };
        Some(scale_normal_and_cap.transfer_data())
    }
    pub fn transfer_scale_normal_and_cap_size(&mut self) -> Option<u8> {
        let Some(scale_normal_and_cap) = &mut self.scale_normal_and_cap else {
            return None;
        };
        Some(scale_normal_and_cap.size)
    }
    pub fn transfer_batch_id(&mut self) -> Option<js_sys::Float32Array> {
        let Some(batch_ids) = &mut self.batch_ids else {
            return None;
        };
        Some(batch_ids.transfer_data())
    }
    pub fn transfer_batch_id_size(&mut self) -> Option<u8> {
        let Some(batch_ids) = &mut self.batch_ids else {
            return None;
        };
        Some(batch_ids.size)
    }
    pub fn transfer_batch_index(&mut self) -> Option<js_sys::Uint32Array> {
        let Some(batch_index) = &mut self.batch_index else {
            return None;
        };
        Some(batch_index.transfer_data())
    }
    pub fn transfer_batch_index_size(&mut self) -> Option<u8> {
        let Some(batch_index) = &mut self.batch_index else {
            return None;
        };
        Some(batch_index.size)
    }
}

impl From<PolygonGeometryAttributes> for navara_geometry::PolygonGeometryAttributes {
    fn from(val: PolygonGeometryAttributes) -> Self {
        navara_geometry::PolygonGeometryAttributes {
            position: val.position.map(|v| v.into()),
            position_3d_high: val.position_3d_high.map(|v| v.into()),
            position_3d_low: val.position_3d_low.map(|v| v.into()),
            normal: val.normal.map(|v| v.into()),
            scale_normal_and_cap: val.scale_normal_and_cap.map(|v| v.into()),
            batch_ids: val.batch_ids.map(|v| v.into()),
            batch_index: val.batch_index.map(|v| v.into()),
        }
    }
}
impl From<navara_geometry::PolygonGeometryAttributes> for PolygonGeometryAttributes {
    fn from(val: navara_geometry::PolygonGeometryAttributes) -> Self {
        PolygonGeometryAttributes {
            position: val.position.map(|v| v.into()),
            position_3d_high: val.position_3d_high.map(|v| v.into()),
            position_3d_low: val.position_3d_low.map(|v| v.into()),
            normal: val.normal.map(|v| v.into()),
            scale_normal_and_cap: val.scale_normal_and_cap.map(|v| v.into()),
            batch_ids: val.batch_ids.map(|v| v.into()),
            batch_index: val.batch_index.map(|v| v.into()),
        }
    }
}
