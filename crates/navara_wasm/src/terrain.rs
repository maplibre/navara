use navara_math::FloatType;
use navara_tile_component::TerrainExaggeration;
use wasm_bindgen::prelude::wasm_bindgen;

/// Height of the rendered terrain surface for an unexaggerated terrain height:
/// `(height - relativeHeight) * scale + relativeHeight`, with a negative
/// `scale` clamped to 0.
///
/// Exported so the web side (tile bounds, `sampleTerrainMostDetailed`) maps
/// heights with the same function the engine's bounds and height queries use.
#[wasm_bindgen(js_name = "exaggerateTerrainHeight")]
pub fn exaggerate_terrain_height(
    height: FloatType,
    scale: FloatType,
    relative_height: FloatType,
) -> FloatType {
    TerrainExaggeration::new(scale, relative_height).apply(height)
}
