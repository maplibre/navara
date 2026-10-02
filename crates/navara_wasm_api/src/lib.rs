use navara_wasm_utils::set_panic_hook;
use wasm_bindgen::prelude::*;

mod css_font_family;
mod declutter;
mod ellipsoid;
mod intersection;
mod line_label;
mod rte;
mod terrain;
mod transform;

pub use css_font_family::*;
pub use declutter::*;
pub use ellipsoid::*;
pub use intersection::*;
pub use rte::*;
pub use terrain::*;
pub use transform::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen(start)]
pub fn start() {
    set_panic_hook();
    log("init navara_wasm_api");
}
