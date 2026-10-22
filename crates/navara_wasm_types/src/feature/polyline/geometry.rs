use wasm_bindgen::prelude::*;

use crate::{ExtentRadianF32, FloatAttribute, UintAttribute, copy_u32_array};

#[wasm_bindgen]
pub struct ConstructedPolylineGeometry {
    extent: Option<ExtentRadianF32>,
    geometry: PolylineGeometry,
}

impl ConstructedPolylineGeometry {
    pub fn new(extent: Option<ExtentRadianF32>, geometry: PolylineGeometry) -> Self {
        Self { extent, geometry }
    }
}

#[wasm_bindgen]
impl ConstructedPolylineGeometry {
    #[wasm_bindgen(getter)]
    pub fn extent(&self) -> Option<ExtentRadianF32> {
        self.extent
    }
}

#[wasm_bindgen]
impl ConstructedPolylineGeometry {
    pub fn position(&mut self) -> js_sys::Float32Array {
        self.geometry.position()
    }
    pub fn position_size(&mut self) -> u8 {
        self.geometry.position_size()
    }
    pub fn position_high(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.position_high()
    }
    pub fn position_high_size(&mut self) -> Option<u8> {
        self.geometry.position_high_size()
    }
    pub fn position_low(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.position_low()
    }
    pub fn position_low_size(&mut self) -> Option<u8> {
        self.geometry.position_low_size()
    }
    pub fn start(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.start()
    }
    pub fn start_size(&mut self) -> Option<u8> {
        self.geometry.start_size()
    }
    pub fn start_high(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.start_high()
    }
    pub fn start_high_size(&mut self) -> Option<u8> {
        self.geometry.start_high_size()
    }
    pub fn start_low(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.start_low()
    }
    pub fn start_low_size(&mut self) -> Option<u8> {
        self.geometry.start_low_size()
    }
    pub fn forward_offset(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.forward_offset()
    }
    pub fn forward_offset_size(&mut self) -> Option<u8> {
        self.geometry.forward_offset_size()
    }
    pub fn end_high(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.end_high()
    }
    pub fn end_high_size(&mut self) -> Option<u8> {
        self.geometry.end_high_size()
    }
    pub fn end_low(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.end_low()
    }
    pub fn end_low_size(&mut self) -> Option<u8> {
        self.geometry.end_low_size()
    }
    pub fn start_normal_and_length_high(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.start_normal_and_length_high()
    }
    pub fn start_normal_and_length_high_size(&mut self) -> Option<u8> {
        self.geometry.start_normal_and_length_high_size()
    }
    pub fn end_normal_and_segment_length(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.end_normal_and_segment_length()
    }
    pub fn end_normal_and_segment_length_size(&mut self) -> Option<u8> {
        self.geometry.end_normal_and_segment_length_size()
    }
    pub fn right_normal_and_line_length(&mut self) -> js_sys::Float32Array {
        self.geometry.right_normal_and_line_length()
    }
    pub fn right_normal_and_line_length_size(&mut self) -> u8 {
        self.geometry.right_normal_and_line_length_size()
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
    pub fn line_segments(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.line_segments()
    }
    pub fn line_distance_and_ends(&mut self) -> Option<js_sys::Float32Array> {
        self.geometry.line_distance_and_ends()
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PolylineGeometry {
    attributes: PolylineGeometryAttributes,
    indices: Vec<u32>,
}

impl PolylineGeometry {
    pub fn new(attributes: PolylineGeometryAttributes, indices: Vec<u32>) -> Self {
        Self {
            attributes,
            indices,
        }
    }
}

#[wasm_bindgen]
impl PolylineGeometry {
    pub fn position(&mut self) -> js_sys::Float32Array {
        self.attributes.transfer_position()
    }
    pub fn position_size(&mut self) -> u8 {
        self.attributes.transfer_position_size()
    }
    pub fn position_high(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_position_high()
    }
    pub fn position_high_size(&mut self) -> Option<u8> {
        self.attributes.transfer_position_high_size()
    }
    pub fn position_low(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_position_low()
    }
    pub fn position_low_size(&mut self) -> Option<u8> {
        self.attributes.transfer_position_low_size()
    }
    pub fn start(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_start()
    }
    pub fn start_size(&mut self) -> Option<u8> {
        self.attributes.transfer_start_size()
    }
    pub fn start_high(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_start_high()
    }
    pub fn start_high_size(&mut self) -> Option<u8> {
        self.attributes.transfer_start_high_size()
    }
    pub fn start_low(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_start_low()
    }
    pub fn start_low_size(&mut self) -> Option<u8> {
        self.attributes.transfer_start_low_size()
    }
    pub fn forward_offset(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_forward_offset()
    }
    pub fn forward_offset_size(&mut self) -> Option<u8> {
        self.attributes.transfer_forward_offset_size()
    }
    pub fn end_high(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_end_high()
    }
    pub fn end_high_size(&mut self) -> Option<u8> {
        self.attributes.transfer_end_high_size()
    }
    pub fn end_low(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_end_low()
    }
    pub fn end_low_size(&mut self) -> Option<u8> {
        self.attributes.transfer_end_low_size()
    }
    pub fn start_normal_and_length_high(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_start_normal_and_length_high()
    }
    pub fn start_normal_and_length_high_size(&mut self) -> Option<u8> {
        self.attributes.transfer_start_normal_and_length_high_size()
    }
    pub fn end_normal_and_segment_length(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_end_normal_and_segment_length()
    }
    pub fn end_normal_and_segment_length_size(&mut self) -> Option<u8> {
        self.attributes
            .transfer_end_normal_and_segment_length_size()
    }
    pub fn right_normal_and_line_length(&mut self) -> js_sys::Float32Array {
        self.attributes.transfer_right_normal_and_line_length()
    }
    pub fn right_normal_and_line_length_size(&mut self) -> u8 {
        self.attributes.transfer_right_normal_and_line_length_size()
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
    pub fn line_segments(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_line_segments()
    }
    pub fn line_distance_and_ends(&mut self) -> Option<js_sys::Float32Array> {
        self.attributes.transfer_line_distance_and_ends()
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PolylineGeometryAttributes {
    position: FloatAttribute,
    position_high: Option<FloatAttribute>,
    position_low: Option<FloatAttribute>,
    start: Option<FloatAttribute>,
    start_high: Option<FloatAttribute>,
    start_low: Option<FloatAttribute>,
    forward_offset: Option<FloatAttribute>,
    end_high: Option<FloatAttribute>,
    end_low: Option<FloatAttribute>,
    start_normal_and_length_high: Option<FloatAttribute>,
    end_normal_and_segment_length: Option<FloatAttribute>,
    right_normal_and_line_length: FloatAttribute,
    batch_ids: Option<FloatAttribute>,
    batch_index: Option<UintAttribute>,
    line_segments: Option<FloatAttribute>,
    line_distance_and_ends: Option<FloatAttribute>,
}

#[wasm_bindgen]
impl PolylineGeometryAttributes {
    pub fn transfer_position(&mut self) -> js_sys::Float32Array {
        self.position.transfer_data()
    }
    pub fn transfer_position_size(&mut self) -> u8 {
        self.position.size
    }
    pub fn transfer_position_high(&mut self) -> Option<js_sys::Float32Array> {
        self.position_high.as_mut().map(|attr| attr.transfer_data())
    }
    pub fn transfer_position_high_size(&mut self) -> Option<u8> {
        self.position_high.as_ref().map(|attr| attr.size)
    }
    pub fn transfer_position_low(&mut self) -> Option<js_sys::Float32Array> {
        self.position_low.as_mut().map(|attr| attr.transfer_data())
    }
    pub fn transfer_position_low_size(&mut self) -> Option<u8> {
        self.position_low.as_ref().map(|attr| attr.size)
    }
    pub fn transfer_start(&mut self) -> Option<js_sys::Float32Array> {
        self.start.as_mut().map(|attr| attr.transfer_data())
    }
    pub fn transfer_start_size(&mut self) -> Option<u8> {
        self.start.as_ref().map(|attr| attr.size)
    }
    pub fn transfer_start_high(&mut self) -> Option<js_sys::Float32Array> {
        self.start_high.as_mut().map(|attr| attr.transfer_data())
    }
    pub fn transfer_start_high_size(&mut self) -> Option<u8> {
        self.start_high.as_ref().map(|attr| attr.size)
    }
    pub fn transfer_start_low(&mut self) -> Option<js_sys::Float32Array> {
        self.start_low.as_mut().map(|attr| attr.transfer_data())
    }
    pub fn transfer_start_low_size(&mut self) -> Option<u8> {
        self.start_low.as_ref().map(|attr| attr.size)
    }
    pub fn transfer_forward_offset(&mut self) -> Option<js_sys::Float32Array> {
        self.forward_offset
            .as_mut()
            .map(|attr| attr.transfer_data())
    }
    pub fn transfer_forward_offset_size(&mut self) -> Option<u8> {
        self.forward_offset.as_ref().map(|attr| attr.size)
    }
    pub fn transfer_end_high(&mut self) -> Option<js_sys::Float32Array> {
        self.end_high.as_mut().map(|attr| attr.transfer_data())
    }
    pub fn transfer_end_high_size(&mut self) -> Option<u8> {
        self.end_high.as_ref().map(|attr| attr.size)
    }
    pub fn transfer_end_low(&mut self) -> Option<js_sys::Float32Array> {
        self.end_low.as_mut().map(|attr| attr.transfer_data())
    }
    pub fn transfer_end_low_size(&mut self) -> Option<u8> {
        self.end_low.as_ref().map(|attr| attr.size)
    }
    pub fn transfer_start_normal_and_length_high(&mut self) -> Option<js_sys::Float32Array> {
        self.start_normal_and_length_high
            .as_mut()
            .map(|attr| attr.transfer_data())
    }
    pub fn transfer_start_normal_and_length_high_size(&mut self) -> Option<u8> {
        self.start_normal_and_length_high
            .as_ref()
            .map(|attr| attr.size)
    }
    pub fn transfer_end_normal_and_segment_length(&mut self) -> Option<js_sys::Float32Array> {
        self.end_normal_and_segment_length
            .as_mut()
            .map(|attr| attr.transfer_data())
    }
    pub fn transfer_end_normal_and_segment_length_size(&mut self) -> Option<u8> {
        self.end_normal_and_segment_length
            .as_ref()
            .map(|attr| attr.size)
    }
    pub fn transfer_right_normal_and_line_length(&mut self) -> js_sys::Float32Array {
        self.right_normal_and_line_length.transfer_data()
    }
    pub fn transfer_right_normal_and_line_length_size(&mut self) -> u8 {
        self.right_normal_and_line_length.size
    }
    pub fn transfer_batch_id(&mut self) -> Option<js_sys::Float32Array> {
        let Some(batch_id) = &mut self.batch_ids else {
            return None;
        };
        Some(batch_id.transfer_data())
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
    pub fn transfer_line_segments(&mut self) -> Option<js_sys::Float32Array> {
        self.line_segments.as_mut().map(|attr| attr.transfer_data())
    }
    pub fn transfer_line_distance_and_ends(&mut self) -> Option<js_sys::Float32Array> {
        self.line_distance_and_ends
            .as_mut()
            .map(|attr| attr.transfer_data())
    }
}

impl From<PolylineGeometryAttributes> for navara_geometry::PolylineGeometryAttributes {
    fn from(val: PolylineGeometryAttributes) -> Self {
        navara_geometry::PolylineGeometryAttributes {
            position: val.position.into(),
            position_high: val.position_high.map(|v| v.into()),
            position_low: val.position_low.map(|v| v.into()),
            start: val.start.map(|v| v.into()),
            start_high: val.start_high.map(|v| v.into()),
            start_low: val.start_low.map(|v| v.into()),
            start_normal_and_length_high: val.start_normal_and_length_high.map(|v| v.into()),
            forward_offset: val.forward_offset.map(|v| v.into()),
            end_high: val.end_high.map(|v| v.into()),
            end_low: val.end_low.map(|v| v.into()),
            end_normal_and_segment_length: val.end_normal_and_segment_length.map(|v| v.into()),
            right_normal_and_line_length: val.right_normal_and_line_length.into(),
            batch_ids: val.batch_ids.map(|v| v.into()),
            batch_index: val.batch_index.map(|v| v.into()),
            line_segments: val.line_segments.map(|v| v.into()),
            line_distance_and_ends: val.line_distance_and_ends.map(|v| v.into()),
        }
    }
}
impl From<navara_geometry::PolylineGeometryAttributes> for PolylineGeometryAttributes {
    fn from(val: navara_geometry::PolylineGeometryAttributes) -> Self {
        PolylineGeometryAttributes {
            position: val.position.into(),
            position_high: val.position_high.map(|v| v.into()),
            position_low: val.position_low.map(|v| v.into()),
            start: val.start.map(|v| v.into()),
            start_high: val.start_high.map(|v| v.into()),
            start_low: val.start_low.map(|v| v.into()),
            start_normal_and_length_high: val.start_normal_and_length_high.map(|v| v.into()),
            forward_offset: val.forward_offset.map(|v| v.into()),
            end_high: val.end_high.map(|v| v.into()),
            end_low: val.end_low.map(|v| v.into()),
            end_normal_and_segment_length: val.end_normal_and_segment_length.map(|v| v.into()),
            right_normal_and_line_length: val.right_normal_and_line_length.into(),
            batch_ids: val.batch_ids.map(|v| v.into()),
            batch_index: val.batch_index.map(|v| v.into()),
            line_segments: val.line_segments.map(|v| v.into()),
            line_distance_and_ends: val.line_distance_and_ends.map(|v| v.into()),
        }
    }
}
