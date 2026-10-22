//! The view's line dash atlas; see `navara_material::line_dash`. The
//! frontend uploads [`LineDashAtlas::data`] as an RGBA float texture.

use navara_material::{
    LineCap,
    line_dash::{self, LINE_DASH_ROW_TEXELS, LineDashRejection, SOLID_DASH_ROW},
};
use navara_wasm_types::view_f32_array;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[derive(Default)]
pub struct LineDashAtlas {
    atlas: line_dash::LineDashAtlas,
    warned_too_long: bool,
    warned_full: bool,
    warned_unknown_cap: bool,
    warned_unheld_release: bool,
}

#[wasm_bindgen]
impl LineDashAtlas {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the row holding the pattern of `dash_array` drawn with `cap`
    /// (`"butt" | "round" | "square"`), adding it on first use, and holds it
    /// until `release`. A solid line with butt ends, and a pattern the atlas
    /// cannot hold, are row `0`; the latter warns once per reason. An unknown
    /// cap warns once and draws as `"butt"`.
    pub fn register(&mut self, dash_array: Option<Vec<f32>>, cap: &str) -> u32 {
        let cap = match LineCap::parse(cap) {
            Some(cap) => cap,
            None => {
                if !self.warned_unknown_cap {
                    self.warned_unknown_cap = true;
                    warn(&format!(
                        "LineDashAtlas: unknown cap {cap:?} (expected \"butt\", \"round\" or \"square\") is drawn as \"butt\"."
                    ));
                }
                LineCap::Butt
            }
        };
        match self
            .atlas
            .register(dash_array.as_deref().unwrap_or_default(), cap)
        {
            Ok(row) => row,
            Err(LineDashRejection::TooLong) => {
                if !self.warned_too_long {
                    self.warned_too_long = true;
                    warn(&format!(
                        "LineDashAtlas: a dash array with more than {} dashes, or longer than {} line widths, is drawn solid.",
                        line_dash::MAX_DASH_RANGES,
                        (line_dash::MAX_DASH_PERIOD_STEPS
                            / line_dash::DASH_PERIOD_STEPS_PER_LINE_WIDTH)
                            .floor()
                    ));
                }
                SOLID_DASH_ROW
            }
            Err(LineDashRejection::AtlasFull) => {
                if !self.warned_full {
                    self.warned_full = true;
                    warn(&format!(
                        "LineDashAtlas: more than {} dash patterns in use; further ones are drawn solid.",
                        line_dash::MAX_DASH_ROWS - 1
                    ));
                }
                SOLID_DASH_ROW
            }
        }
    }

    /// Ends one `register` of `row`; the last one frees the row for another
    /// pattern. A row nobody holds is left as is and warns once.
    pub fn release(&mut self, row: u32) {
        if !self.atlas.release(row) && !self.warned_unheld_release {
            self.warned_unheld_release = true;
            warn(&format!(
                "LineDashAtlas: released dash row {row}, which nobody holds."
            ));
        }
    }

    /// Changes whenever a row is written into `data`.
    #[wasm_bindgen(getter, js_name = dataVersion)]
    pub fn data_version(&self) -> u32 {
        self.atlas.data_version()
    }

    /// The rows as RGBA float texels, `rowTexels` wide and `rowCapacity`
    /// high. A view into WASM memory: copy it before the next allocation.
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> js_sys::Float32Array {
        view_f32_array(self.atlas.data())
    }

    /// Rows `data` holds; it grows when a row is added past it.
    #[wasm_bindgen(getter, js_name = rowCapacity)]
    pub fn row_capacity(&self) -> usize {
        self.atlas.row_capacity()
    }

    /// RGBA texels per row.
    #[wasm_bindgen(getter, js_name = rowTexels)]
    pub fn row_texels(&self) -> usize {
        LINE_DASH_ROW_TEXELS
    }
}

fn warn(message: &str) {
    web_sys::console::warn_1(&message.into());
}
