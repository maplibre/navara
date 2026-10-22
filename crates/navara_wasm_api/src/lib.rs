use navara_wasm_utils::set_panic_hook;
use wasm_bindgen::prelude::*;

mod css_font_family;
mod declutter;
mod ellipsoid;
mod intersection;
mod line_dash;
mod line_label;
mod polygon;
mod polyline;
mod rte;
mod terrain;
mod transform;

pub use css_font_family::*;
pub use declutter::*;
pub use ellipsoid::*;
pub use intersection::*;
pub use line_dash::*;
pub use polygon::*;
pub use polyline::*;
pub use rte::*;
pub use terrain::*;
pub use transform::*;

#[wasm_bindgen(start)]
pub fn start() {
    set_panic_hook();
    web_sys::console::log_1(&"init navara_wasm_api".into());
}
