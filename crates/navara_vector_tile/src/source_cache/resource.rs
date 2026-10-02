use bevy_ecs::prelude::*;
use navara_material::Appearance;
use rustc_hash::FxHashMap;

/// Horizon dynamic-SSE relaxation strength (`0.0` off … `1.0`
/// raster-equivalent) for draped clamp-to-ground polyline/polygon layers.
/// They render as a terrain-draped texture like raster, so the default is
/// raster-equivalent strength (1.0) unless overridden per layer.
pub const CLAMP_TO_GROUND_DYNAMIC_SSE_SCALE: f32 = 1.0;
/// Horizon relaxation strength for point / non-clamped geometry layers: only
/// a slight coarsening of far tiles, since these render as discrete features
/// that vanish (not just blur) when over-coarsened.
pub const GEOMETRY_DYNAMIC_SSE_SCALE: f32 = 0.5;

/// Factor on `max_sse` for a layer drawing only symbols (text, billboards,
/// points).
///
/// The vector traversal's screen-space error is a tile's on-screen width over
/// 256 pixels (a 64-sample geometric error), so the default `max_sse` of 2
/// draws tiles 256–512 CSS pixels across. MapLibre lays symbols out on tiles
/// of 512–1024: `symbol-spacing` then fits several repeats into one tile.
/// Twice as small, a tile's piece of a line has room for about one, and the
/// spacing stops deciding where labels go. Doubling the error budget gives
/// symbol layers MapLibre's tile size; geometry keeps the finer tiles its
/// shapes need.
pub const SYMBOL_SSE_SCALE: f32 = 2.0;

/// Configuration for tile traversal derived from layer properties.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TraversalConfig {
    pub has_clamp_to_ground: bool,
    /// Data-available floor: a tile below this zoom is never selected as a
    /// leaf (nor requested), so dynamic-SSE relaxation cannot coarsen past
    /// where the source has data. Mirrors the raster traverse's `min_zoom`
    /// gate (and MapLibre's `minzoom`).
    pub min_zoom: usize,
    pub max_zoom: usize,
    pub max_sse_bits: u32,
    /// Horizon dynamic-SSE relaxation strength for this layer, as `f32` bits
    /// (kept as bits so the config stays `Eq`/`Hash`, like `max_sse_bits`).
    pub dynamic_sse_scale_bits: u32,
    pub overscaled_max_zoom: usize,
}

impl Default for TraversalConfig {
    fn default() -> Self {
        Self {
            has_clamp_to_ground: false,
            min_zoom: 0,
            max_zoom: 20,
            max_sse_bits: 2.0_f32.to_bits(),
            dynamic_sse_scale_bits: GEOMETRY_DYNAMIC_SSE_SCALE.to_bits(),
            overscaled_max_zoom: 24,
        }
    }
}

impl TraversalConfig {
    pub fn from_appearances(
        appearances: &[Appearance],
        min_zoom: usize,
        max_zoom: usize,
        max_sse: f32,
        overscaled_max_zoom: usize,
        // Per-layer horizon relaxation override; `None` picks a content-based
        // default from `clamp_to_ground`.
        dynamic_sse_scale: Option<f32>,
    ) -> Self {
        let has_clamp_to_ground = appearances.iter().any(|a| {
            matches!(a, Appearance::Polygon(p) if p.clamp_to_ground)
                || matches!(a, Appearance::Polyline(p) if p.clamp_to_ground)
        });

        let dynamic_sse_scale = dynamic_sse_scale.unwrap_or(if has_clamp_to_ground {
            CLAMP_TO_GROUND_DYNAMIC_SSE_SCALE
        } else {
            GEOMETRY_DYNAMIC_SSE_SCALE
        });

        let symbols_only = !appearances.is_empty()
            && appearances.iter().all(|a| {
                matches!(
                    a,
                    Appearance::Text(_) | Appearance::Billboard(_) | Appearance::Point(_)
                )
            });
        let max_sse = if symbols_only {
            max_sse * SYMBOL_SSE_SCALE
        } else {
            max_sse
        };

        Self {
            has_clamp_to_ground,
            min_zoom,
            max_zoom,
            max_sse_bits: max_sse.to_bits(),
            dynamic_sse_scale_bits: dynamic_sse_scale.to_bits(),
            overscaled_max_zoom,
        }
    }

    pub fn max_sse(&self) -> f32 {
        f32::from_bits(self.max_sse_bits)
    }

    pub fn dynamic_sse_scale(&self) -> f32 {
        f32::from_bits(self.dynamic_sse_scale_bits)
    }
}

/// Unique identifier for a tile source.
///
/// Source-agnostic: the `key` is an opaque string that uniquely identifies the
/// data origin (e.g. a URL template for MVT, a layer ID for GeoJSON).
/// Adding new source types (MLT, etc.) does not require modifying this struct.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SourceId {
    pub key: String,
    pub traversal_config: TraversalConfig,
}

impl SourceId {
    pub fn new(key: String, traversal_config: TraversalConfig) -> Self {
        Self {
            key,
            traversal_config,
        }
    }

    pub fn traversal_config(&self) -> &TraversalConfig {
        &self.traversal_config
    }
}

/// Shared resources for a single vector tile source.
#[derive(Component)]
pub struct VectorTileSourceResources {
    pub source_id: SourceId,
    pub quadtree: Entity,
    pub tile_cache_manager: Entity,
    pub layer_refs: Vec<Entity>,
}

impl VectorTileSourceResources {
    pub fn new(
        source_id: SourceId,
        quadtree: Entity,
        tile_cache_manager: Entity,
        layer_refs: Vec<Entity>,
    ) -> Self {
        Self {
            source_id,
            quadtree,
            tile_cache_manager,
            layer_refs,
        }
    }

    pub fn add_layer_ref(&mut self, layer: Entity) {
        if !self.layer_refs.contains(&layer) {
            self.layer_refs.push(layer);
        }
    }

    pub fn remove_layer_ref(&mut self, layer: Entity) -> bool {
        self.layer_refs.retain(|&e| e != layer);
        self.layer_refs.is_empty()
    }

    pub fn has_no_refs(&self) -> bool {
        self.layer_refs.is_empty()
    }

    pub fn ref_count(&self) -> usize {
        self.layer_refs.len()
    }
}

/// Global registry mapping source identifiers to their shared resources.
#[derive(Resource, Default)]
pub struct VectorTileSourceCache {
    sources: FxHashMap<SourceId, Entity>,
}

impl VectorTileSourceCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get_source(&self, source_id: &SourceId) -> Option<Entity> {
        self.sources.get(source_id).copied()
    }

    pub fn register_source(&mut self, source_id: SourceId, entity: Entity) {
        debug_assert!(
            !self.sources.contains_key(&source_id),
            "VectorTileSourceCache: register_source called for an existing SourceId"
        );
        self.sources.entry(source_id).or_insert(entity);
    }

    pub fn has_source(&self, source_id: &SourceId) -> bool {
        self.sources.contains_key(source_id)
    }

    pub fn remove_source(&mut self, source_id: &SourceId) {
        self.sources.remove(source_id);
    }

    pub fn len(&self) -> usize {
        self.sources.len()
    }

    pub fn is_empty(&self) -> bool {
        self.sources.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&SourceId, &Entity)> {
        self.sources.iter()
    }
}

#[cfg(test)]
mod tests {
    use navara_material::{BillboardMaterial, PolygonMaterial, PolylineMaterial, TextMaterial};

    use super::*;

    fn config(appearances: &[Appearance]) -> TraversalConfig {
        TraversalConfig::from_appearances(appearances, 0, 14, 2.0, 20, None)
    }

    #[test]
    fn symbol_only_layers_are_traversed_at_maplibres_tile_size() {
        let labels = [
            Appearance::Text(TextMaterial::default()),
            Appearance::Billboard(BillboardMaterial::default()),
        ];
        assert_eq!(config(&labels).max_sse(), 2.0 * SYMBOL_SSE_SCALE);
    }

    #[test]
    fn layers_drawing_geometry_keep_the_source_sse() {
        // Mixed with a line, labels share the geometry's finer tiles.
        let mixed = [
            Appearance::Text(TextMaterial::default()),
            Appearance::Polyline(PolylineMaterial::default()),
        ];
        assert_eq!(config(&mixed).max_sse(), 2.0);
        let polygon = [Appearance::Polygon(PolygonMaterial::default())];
        assert_eq!(config(&polygon).max_sse(), 2.0);
        assert_eq!(config(&[]).max_sse(), 2.0);
    }
}
