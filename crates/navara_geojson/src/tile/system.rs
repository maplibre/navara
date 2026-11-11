use bevy_ecs::prelude::*;
use navara_geojson_vt::{GeoJsonVt, Options as GeoJsonVtOptions};
use navara_layer::GeoJsonLayer;
use navara_material::Appearance;
use navara_source::{GeoJsonData, Source, SourceStore};
use navara_tile_component::VectorTileQuadtree;
use navara_vector_tile::{
    LayerResources, SourceId, TileCacheManager, TileSource, TraversalConfig, VectorTileSourceCache,
    VectorTileSourceResources,
};

use navara_geometry::DEFAULT_POLYLINE_GRANULARITY_METERS;

use super::densify::densify_geojson;
use super::source::GeoJsonTileSource;

#[derive(Component)]
pub(crate) struct Tiled;

/// `None` when no polygon or polyline appearance takes the tiled path,
/// otherwise whether any tiled one is geodesic. One index serves every
/// appearance of the layer, so a single geodesic appearance densifies the
/// shared geometry.
fn tiled_geodesic(appearances: &[Appearance]) -> Option<bool> {
    appearances
        .iter()
        .filter_map(|a| match a {
            Appearance::Polygon(p) if p.clamp_to_ground || p.tiled => Some(p.geodesic),
            Appearance::Polyline(p) if p.clamp_to_ground || p.tiled => Some(p.geodesic),
            _ => None,
        })
        .reduce(|a, b| a || b)
}

/// Sets up tiled rendering for GeoJSON layers with clamped polygon appearances.
///
/// When a GeoJsonLayer with `clamp_to_ground` polygon is added, this system:
/// 1. Builds a GeoJsonVt spatial index from the GeoJSON data
/// 2. Creates VectorTileSourceResources for the tile pipeline
/// 3. Registers the source in VectorTileSourceCache
#[allow(clippy::type_complexity)]
pub fn setup_tiled_geojson(
    mut commands: Commands,
    geojson_layers: Query<(Entity, &GeoJsonLayer), (Changed<GeoJsonLayer>, Without<Tiled>)>,
    source_store: Res<SourceStore>,
    mut source_cache: ResMut<VectorTileSourceCache>,
) {
    for (layer_entity, layer) in &geojson_layers {
        let Some(geodesic) = tiled_geodesic(&layer.appearances) else {
            continue;
        };

        // Read the inline GeoJSON live from the source; skip until a URL source
        // has been fetched and cached onto the source.
        let geojson = match layer
            .source_id
            .as_deref()
            .and_then(|id| source_store.get(id))
        {
            Some(Source::GeoJson(s)) => match &s.data {
                Some(GeoJsonData::GeoJson(g)) => g,
                _ => continue,
            },
            _ => continue,
        };

        // Use a much lower tolerance for layers with polyline appearances.
        // The default tolerance (2.0) aggressively simplifies lines at lower zoom
        // levels, removing intermediate points and leaving only 2-point segments.
        // These short segments render as spikes when the line width exceeds the
        // segment length.
        let has_polyline = layer
            .appearances
            .iter()
            .any(|a| matches!(a, Appearance::Polyline(_)));
        let opts = GeoJsonVtOptions {
            // Avoid to stop the tile splitting unexpectedly.
            index_max_points: 0,
            tolerance: if has_polyline { 1.0 } else { 2.0 },
            ..Default::default()
        };
        let max_zoom = opts.max_zoom;
        let extent = opts.extent;

        let densified = if geodesic {
            densify_geojson(geojson, DEFAULT_POLYLINE_GRANULARITY_METERS)
        } else {
            None
        };
        let geojson = densified.as_ref().unwrap_or(geojson);
        let vt = GeoJsonVt::new(geojson, opts);

        // GeoJSON is client-tiled from a single document, so it has data at
        // every zoom down to 0; no min-zoom floor is needed. Horizon relaxation
        // honors the layer's per-layer override, else the content-based default
        // — same treatment as MVT.
        let traversal_config = TraversalConfig::from_appearances(
            &layer.appearances,
            0,
            max_zoom as usize,
            2.0,
            24,
            layer.dynamic_sse_scale,
        );
        let source_id = SourceId::new(format!("geojson:{}", layer.layer_id), traversal_config);

        let quadtree = commands
            .spawn(VectorTileQuadtree::new_with_linear_qt())
            .id();
        let tile_cache_manager = commands.spawn(TileCacheManager::default()).id();

        let source_entity = commands
            .spawn((
                VectorTileSourceResources::new(
                    source_id.clone(),
                    quadtree,
                    tile_cache_manager,
                    vec![layer_entity],
                ),
                TileSource(Box::new(GeoJsonTileSource {
                    vt,
                    extent,
                    layer_id: layer.layer_id.clone(),
                    appearances: layer.appearances.clone(),
                    prepared: Default::default(),
                })),
            ))
            .id();

        source_cache.register_source(source_id, source_entity);

        commands
            .entity(layer_entity)
            .insert(LayerResources {
                layer_id: layer.layer_id.clone(),
                source: source_entity,
                quadtree,
                tile_cache_manager,
            })
            .insert(Tiled);
    }
}

#[cfg(test)]
mod test {
    use navara_material::{PolygonMaterial, PolylineMaterial};

    use super::*;

    fn polygon(clamp_to_ground: bool, geodesic: bool) -> Appearance {
        Appearance::Polygon(PolygonMaterial {
            clamp_to_ground,
            geodesic,
            ..Default::default()
        })
    }

    fn polyline(clamp_to_ground: bool, geodesic: bool) -> Appearance {
        Appearance::Polyline(PolylineMaterial {
            clamp_to_ground,
            geodesic,
            ..Default::default()
        })
    }

    #[test]
    fn tiled_geodesic_resolves_per_layer() {
        // No tiled appearance: the layer is not tiled at all.
        assert_eq!(tiled_geodesic(&[polygon(false, true)]), None);
        // Every tiled appearance opts out: densification is skipped.
        let all_off = [polygon(true, false), polyline(true, false)];
        assert_eq!(tiled_geodesic(&all_off), Some(false));
        // One geodesic tiled appearance densifies the shared geometry.
        let mixed = [polygon(true, false), polyline(true, true)];
        assert_eq!(tiled_geodesic(&mixed), Some(true));
        // A non-tiled appearance does not count.
        let untiled = [polygon(true, false), polyline(false, true)];
        assert_eq!(tiled_geodesic(&untiled), Some(false));
    }
}
