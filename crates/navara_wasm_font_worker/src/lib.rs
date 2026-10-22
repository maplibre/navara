#![doc = include_str!("../README.md")]

pub mod atlas;
pub mod cache;
pub mod color_raster;
pub mod msdf;
pub mod shaping;

pub use atlas::{Atlas, GlyphMetrics};
pub use cache::{FontCache, FontEntry};
use navara_wasm_types::{copy_u8_array, transfer_u8_array};
use navara_wasm_utils::set_panic_hook;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn start() {
    set_panic_hook();
}

/// Pack `(font_index, glyph_id)` into a u64. Exported so TS uses the same
/// layout as Rust.
#[wasm_bindgen]
pub fn composite_key(font_index: u32, glyph_id: u32) -> u64 {
    atlas::composite_key(font_index, glyph_id)
}

// ---------------------------------------------------------------------------
// WASM types
// ---------------------------------------------------------------------------

/// Atlas bytes returned to TypeScript. `channels`: 1 → R8 (SDF),
/// 4 → RGBA8 (MSDF or color).
#[wasm_bindgen]
pub struct FontAtlas {
    #[wasm_bindgen(getter_with_clone)]
    pub data: js_sys::Uint8Array,
    pub width: u32,
    pub height: u32,
    pub channels: u32,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct WasmGlyphMetrics {
    pub glyph_id: u32,
    pub font_index: u32,
    pub atlas_x: i32,
    pub atlas_y: i32,
    pub atlas_w: u32,
    pub atlas_h: u32,
    pub bearing_x: f32,
    pub bearing_y: f32,
    /// True when the glyph lives in the COLRv1 RGBA atlas rather than the SDF.
    pub is_color: bool,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct WasmShapedGlyph {
    pub glyph_id: u32,
    pub font_index: u32,
    pub x_advance: i32,
    pub y_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
    /// One of the `shaping::CHAR_CLASS_*` constants (line-break info).
    pub char_class: u8,
    /// Same cluster as the previous glyph; letter spacing skips these.
    pub continues_cluster: bool,
    /// One of the `shaping::DIRECTION_*` constants (segment direction).
    pub direction: u8,
}

#[wasm_bindgen]
pub struct ShapeTextResult {
    #[wasm_bindgen(getter_with_clone)]
    pub glyphs: Vec<WasmShapedGlyph>,
    #[wasm_bindgen(getter_with_clone)]
    pub metrics: Vec<WasmGlyphMetrics>,
    pub units_per_em: u16,
    /// Vertical line metrics in font units, for multi-line layout.
    pub ascender: i16,
    pub descender: i16,
    pub line_gap: i16,
    pub font_index: u32,
    pub atlas_changed: bool,
    /// True when this font is COLRv1 — glyphs were packed into the color atlas.
    pub is_color: bool,
    /// True if any glyph was evicted to make room while packing this text. The
    /// reused rects mean cached TS metrics for this atlas may be stale, so TS
    /// bumps the atlas generation to force a re-shape on next use.
    pub evicted: bool,
    /// False when letter spacing must not be applied to this text (it contains
    /// cursive Arabic).
    pub allows_letter_spacing: bool,
}

// ---------------------------------------------------------------------------
// WASM methods on FontCache
// ---------------------------------------------------------------------------

/// Look up an atlas by key, falling back to the font URL → atlas_key map.
fn lookup_atlas<'a>(
    atlases: &'a std::collections::HashMap<String, Atlas>,
    fonts: &std::collections::HashMap<String, cache::FontEntry>,
    key: &str,
) -> Option<&'a Atlas> {
    atlases
        .get(key)
        .or_else(|| atlases.get(&fonts.get(key)?.atlas_key))
}

fn snapshot_atlas(atlas: &Atlas) -> FontAtlas {
    FontAtlas {
        data: copy_u8_array(&atlas.pixel_data),
        width: atlas.width,
        height: atlas.height,
        channels: atlas.channels as u32,
    }
}

#[wasm_bindgen]
impl FontCache {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Load font bytes into the cache.
    ///
    /// `atlas_key`: shared atlas identifier (e.g. family name). Omit to get a
    /// per-URL atlas.
    /// `mode`: `"msdf"` → MTSDF; anything else (including `None`) → SDF.
    /// Selected by the TS `highQuality` boolean knob (`true` → `"msdf"`).
    ///
    /// Returns the font's cmap coverage as flattened `[from, to, ...]`
    /// codepoint ranges (see [`cache::cmap_ranges`]) so the TS FontManager
    /// can correct a face's declared unicode ranges once per file, or `None`
    /// when the font failed to load.
    #[wasm_bindgen(js_name = loadFont)]
    pub fn wasm_load_font(
        &mut self,
        url: String,
        byte_length: usize,
        f: &js_sys::Function,
        atlas_key: Option<String>,
        mode: Option<String>,
    ) -> Option<Vec<u32>> {
        let data = transfer_u8_array(byte_length, f);
        let mode = match mode.as_deref() {
            Some("msdf") => crate::atlas::AtlasMode::Msdf,
            _ => crate::atlas::AtlasMode::Sdf,
        };
        self.load_font(url.clone(), data, atlas_key, mode).ok()?;
        // `data` was decompressed (WOFF/WOFF2) during load — read the stored
        // bytes back for cmap parsing.
        Some(cache::cmap_ranges(&self.fonts.get(&url)?.data))
    }

    #[wasm_bindgen(js_name = getAtlasKey)]
    pub fn wasm_get_atlas_key(&self, url: &str) -> Option<String> {
        self.get_atlas_key(url).map(|s| s.to_owned())
    }

    #[wasm_bindgen(js_name = unloadFont)]
    pub fn wasm_unload_font(&mut self, url: String) -> bool {
        self.unload_font(&url).is_ok()
    }

    #[wasm_bindgen(js_name = isFontLoaded)]
    pub fn wasm_is_font_loaded(&self, url: &str) -> bool {
        self.is_font_loaded(url)
    }

    /// Shape `text` and ensure every glyph is in the appropriate atlas (SDF
    /// for monochrome fonts, RGBA for COLRv1 fonts).
    #[wasm_bindgen(js_name = shapeText)]
    pub fn wasm_shape_text(&mut self, url: &str, text: &str) -> Option<ShapeTextResult> {
        let entry = self.fonts.get(url)?;
        let shaped = shaping::shape_text(&entry.data, text)?;
        let units_per_em = entry.units_per_em;
        let line_metrics = entry.line_metrics;
        let atlas_key = entry.atlas_key.clone();
        let font_index = entry.font_index;
        let is_color = entry.is_color;

        // Synthetic newline markers carry glyph_id 0 but represent no real
        // glyph — keep them out of the atlas (would rasterize .notdef).
        let glyph_ids: Vec<u32> = shaped
            .iter()
            .filter(|g| g.char_class != shaping::CHAR_CLASS_NEWLINE)
            .map(|g| g.glyph_id)
            .collect();

        // Memory budget: this atlas may only grow up to what the budget
        // leaves after every other resident byte in the cache.
        let max_atlas_bytes = self.max_bytes_for_atlas(&atlas_key, is_color);

        // Split-borrow: hand the immutable font bytes to a mutable atlas
        // method without cloning the (possibly multi-MB) buffer.
        let entry = self.fonts.get(url)?;
        let raster_font = &entry.raster_font;
        let font_data = entry.data.as_slice();
        let atlases = if is_color {
            &mut self.color_atlases
        } else {
            &mut self.atlases
        };
        let atlas = atlases.get_mut(&atlas_key)?;
        let mut evicted = false;
        let atlas_changed = atlas.ensure_glyphs_in_atlas(
            raster_font,
            font_data,
            font_index,
            &glyph_ids,
            &mut evicted,
            max_atlas_bytes,
        );

        let glyphs: Vec<WasmShapedGlyph> = shaped
            .iter()
            .map(|g| WasmShapedGlyph {
                glyph_id: g.glyph_id,
                font_index,
                x_advance: g.x_advance,
                y_advance: g.y_advance,
                x_offset: g.x_offset,
                y_offset: g.y_offset,
                char_class: g.char_class,
                continues_cluster: g.continues_cluster,
                direction: g.direction,
            })
            .collect();

        let mut unique_ids = glyph_ids;
        unique_ids.sort_unstable();
        unique_ids.dedup();

        let atlas_ref = if is_color {
            self.color_atlases.get(&atlas_key)?
        } else {
            self.atlases.get(&atlas_key)?
        };
        let metrics: Vec<WasmGlyphMetrics> = unique_ids
            .iter()
            .filter_map(|&gid| {
                let m = atlas_ref.get_metrics(atlas::composite_key(font_index, gid))?;
                Some(WasmGlyphMetrics {
                    glyph_id: gid,
                    font_index,
                    atlas_x: m.atlas_x,
                    atlas_y: m.atlas_y,
                    atlas_w: m.atlas_w,
                    atlas_h: m.atlas_h,
                    bearing_x: m.bearing_x,
                    bearing_y: m.bearing_y,
                    is_color,
                })
            })
            .collect();

        Some(ShapeTextResult {
            glyphs,
            metrics,
            units_per_em,
            ascender: line_metrics.ascender,
            descender: line_metrics.descender,
            line_gap: line_metrics.line_gap,
            font_index,
            atlas_changed,
            is_color,
            evicted,
            allows_letter_spacing: shaping::allows_letter_spacing(text),
        })
    }

    /// SDF atlas bytes by atlas key or font URL.
    #[wasm_bindgen(js_name = getFontAtlas)]
    pub fn wasm_get_font_atlas(&self, key: &str) -> Option<FontAtlas> {
        lookup_atlas(&self.atlases, &self.fonts, key).map(snapshot_atlas)
    }

    /// RGBA color atlas bytes by atlas key or font URL. `None` if no COLRv1
    /// face has been loaded under this key.
    #[wasm_bindgen(js_name = getColorAtlas)]
    pub fn wasm_get_color_atlas(&self, key: &str) -> Option<FontAtlas> {
        lookup_atlas(&self.color_atlases, &self.fonts, key).map(snapshot_atlas)
    }

    /// Add one visible-label reference to each glyph (composite keys) under
    /// `atlas_key`. Called when a label using these glyphs becomes visible, so
    /// the glyphs are pinned against eviction while on screen.
    #[wasm_bindgen(js_name = retainGlyphs)]
    pub fn wasm_retain_glyphs(&mut self, atlas_key: &str, keys: &[u64]) {
        self.retain_glyphs(atlas_key, keys);
    }

    /// Drop one visible-label reference from each glyph under `atlas_key`.
    /// Called when a label hides or is disposed; once a glyph's count hits zero
    /// it becomes eligible for eviction when the atlas next needs space.
    #[wasm_bindgen(js_name = releaseGlyphs)]
    pub fn wasm_release_glyphs(&mut self, atlas_key: &str, keys: &[u64]) {
        self.release_glyphs(atlas_key, keys);
    }

    /// Sets the cache's memory budget in bytes (font data + atlas pixels).
    /// The budget caps further atlas growth — the WASM heap never shrinks —
    /// so over-budget glyph bursts degrade to missing glyphs instead of
    /// growing the atlas. `undefined` removes the budget.
    #[wasm_bindgen(js_name = setBudget)]
    pub fn wasm_set_budget(&mut self, bytes: Option<f64>) {
        self.set_budget(bytes.map(|b| b as usize));
    }

    /// Snapshot of the cache's modeled resident bytes for diagnostics.
    #[wasm_bindgen(js_name = memoryStats)]
    pub fn wasm_memory_stats(&self) -> FontCacheStats {
        let (font_bytes, atlas_bytes, color_atlas_bytes) = self.modeled_bytes();
        FontCacheStats {
            font_count: self.fonts.len() as u32,
            atlas_count: (self.atlases.len() + self.color_atlases.len()) as u32,
            glyph_count: (self
                .atlases
                .values()
                .map(|a| a.glyph_count())
                .sum::<usize>()
                + self
                    .color_atlases
                    .values()
                    .map(|a| a.glyph_count())
                    .sum::<usize>()) as u32,
            font_bytes: font_bytes as f64,
            atlas_bytes: atlas_bytes as f64,
            color_atlas_bytes: color_atlas_bytes as f64,
            budget_bytes: self.budget_bytes.map(|b| b as f64).unwrap_or(0.),
        }
    }
}

/// Modeled memory usage of the font cache. Byte counts are `f64` because JS
/// has no u64; `budget_bytes == 0` means no budget is set.
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub struct FontCacheStats {
    #[wasm_bindgen(js_name = fontCount, readonly)]
    pub font_count: u32,
    #[wasm_bindgen(js_name = atlasCount, readonly)]
    pub atlas_count: u32,
    #[wasm_bindgen(js_name = glyphCount, readonly)]
    pub glyph_count: u32,
    #[wasm_bindgen(js_name = fontBytes, readonly)]
    pub font_bytes: f64,
    #[wasm_bindgen(js_name = atlasBytes, readonly)]
    pub atlas_bytes: f64,
    #[wasm_bindgen(js_name = colorAtlasBytes, readonly)]
    pub color_atlas_bytes: f64,
    #[wasm_bindgen(js_name = budgetBytes, readonly)]
    pub budget_bytes: f64,
}
