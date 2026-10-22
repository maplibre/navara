use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct BatchPropResult {
    #[wasm_bindgen(getter_with_clone)]
    pub properties: JsValue,
    #[wasm_bindgen(getter_with_clone, js_name = layerId)]
    pub layer_id: Option<String>,
    /// The picked feature's canonical global batch id (its first instance's
    /// id). A picked instance of a multi-instance feature (e.g. MultiPoint)
    /// carries its own id, while styling APIs report the canonical one, so
    /// consumers correlate picks through this field.
    #[wasm_bindgen(js_name = batchId)]
    pub batch_id: Option<u32>,
}
