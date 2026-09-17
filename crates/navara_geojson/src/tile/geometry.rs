use bevy_ecs::{entity::Entity, system::Commands};
use navara_buffer_store::BufferStore;
use navara_component::OrderByDistance;
use navara_core::CRS;
use navara_core::TileXYZ;
use navara_feature_component::batch::BatchTable;
use navara_geojson_vt::types::TileGeometry;
use navara_geometry::{
    Hierarchy, WindingOrder, close_flat_ring, open_ring_len, tile_ring_boundary_runs,
};
use navara_material::{Appearance, SourceGeometryType};
use navara_tile_component::{OverscaledTileHandle, TileExtent, TileHandle};
use navara_vector_tile::{PosConverter, VectorTileFeatureMarker};

use crate::geometry::builder::GeometryBuilder;

/// Emit one raw tile-space ring's boundary runs as non-draped polylines,
/// dropping tile-clip edges (see [`tile_ring_boundary_runs`]) so the tile
/// outline is not drawn through polygon interiors.
fn add_boundary_runs(builder: &mut GeometryBuilder, converter: &PosConverter, ring: &[[f64; 2]]) {
    // Strip the closing duplicate so run indices address unique vertices.
    let ring = &ring[..open_ring_len(ring, |p| (p[0], p[1]))];
    let runs = tile_ring_boundary_runs(ring.iter().map(|p| (p[0], p[1])), converter.extent());
    for run in runs {
        let projected = converter.project_points(run.iter().map(|&i| ring[i]));
        if !projected.is_empty() {
            builder.add_polyline(projected, CRS::Geographic, true);
        }
    }
}

/// Construct polygon entities from GeoJsonVt tile features.
///
/// Converts tile-local coordinates [0, extent] to normalized [-1, 1] space
/// (same as MVT's PosConverter::project_points_on_center) and spawns
/// flat polygon geometry entities for clamped rendering.
#[allow(clippy::too_many_arguments)]
pub(crate) fn construct_geojson_tile_geometry(
    commands: &mut Commands,
    batch_table: &mut BatchTable,
    buf: &mut BufferStore,
    tile: &navara_geojson_vt::types::Tile,
    extent: u32,
    layer_id: &str,
    appearances: &[Appearance],
    tile_info: Option<(
        TileHandle,
        navara_core::Extent<navara_math::FloatType, navara_core::Radians>,
    )>,
    order: &OrderByDistance,
) -> Option<Vec<Entity>> {
    if tile.features.is_empty() {
        return None;
    }

    // Determine whether polygons should use flat [-1,1] coordinates (clamped)
    // or geographic lon/lat coordinates (non-clamped 3D rendering).
    let flat = appearances.iter().any(|a| {
        matches!(a, Appearance::Polygon(p) if p.clamp_to_ground)
            || matches!(a, Appearance::Polyline(p) if p.clamp_to_ground)
    });

    let has_polygon = appearances
        .iter()
        .any(|a| matches!(a, Appearance::Polygon(_)));
    // Which source geometry the polyline appearances consume on this tiled path.
    let polyline_from_lines = appearances.iter().any(|a| {
        matches!(a, Appearance::Polyline(p)
            if p.geometry_types.contains(&SourceGeometryType::Line))
    });
    let polyline_from_polygons = appearances.iter().any(|a| {
        matches!(a, Appearance::Polyline(p)
            if (p.clamp_to_ground || (p.tiled && !flat))
                && p.geometry_types.contains(&SourceGeometryType::Polygon))
    });

    let converter = PosConverter::new(
        TileXYZ {
            x: tile.x as usize,
            y: tile.y as usize,
            z: tile.z as usize,
        },
        extent,
    );

    let mut builder = GeometryBuilder::new(batch_table, layer_id);

    for feature in &tile.features {
        let props_map = match feature.properties.as_ref() {
            serde_json::Value::Object(m) => Some(m.clone()),
            _ => None,
        };
        builder.begin_feature(&props_map);

        match &feature.geometry {
            TileGeometry::Polygons(polygons) if has_polygon || polyline_from_polygons => {
                for polygon in polygons {
                    if polygon.is_empty() {
                        continue;
                    }

                    let mut outer_ring = if !flat {
                        converter.project_points(&polygon[0])
                    } else {
                        converter.project_points_on_center(&polygon[0])
                    };

                    let holes: Vec<Hierarchy> = polygon[1..]
                        .iter()
                        .map(|ring| Hierarchy {
                            outer_ring: if !flat {
                                converter.project_points(ring)
                            } else {
                                converter.project_points_on_center(ring)
                            },
                            holes: None,
                            expected_winding_order: if flat {
                                WindingOrder::Clockwise
                            } else {
                                WindingOrder::CounterClockwise
                            },
                        })
                        .collect();

                    if outer_ring.is_empty() {
                        continue;
                    }

                    if has_polygon {
                        let winding_order = if flat {
                            WindingOrder::CounterClockwise
                        } else {
                            WindingOrder::Clockwise
                        };
                        // Keep the ring only when boundary derivation reads it below.
                        let ring = if polyline_from_polygons && flat {
                            outer_ring.clone()
                        } else {
                            std::mem::take(&mut outer_ring)
                        };
                        builder.add_polygon(ring, &holes, winding_order, CRS::Geographic);
                    }

                    // Derived boundary polylines reuse the rings the fill
                    // consumed above; fill/stroke stacking is resolved by the
                    // renderer (strokes get a higher render order), not by
                    // emission order.
                    if polyline_from_polygons {
                        if flat {
                            // Draped boundaries reuse the projected rings as
                            // closed polylines; the bake clips the tile-buffer
                            // zone, so clip edges never show.
                            close_flat_ring(&mut outer_ring);
                            builder.add_polyline(outer_ring, CRS::Geographic, true);
                            for hole in holes {
                                let mut ring = hole.outer_ring;
                                close_flat_ring(&mut ring);
                                builder.add_polyline(ring, CRS::Geographic, true);
                            }
                        } else {
                            // Non-draped boundaries render as real geometry,
                            // so tile-clip edges must be dropped instead.
                            for ring in polygon {
                                add_boundary_runs(&mut builder, &converter, ring);
                            }
                        }
                    }
                }
            }
            TileGeometry::Lines(lines) if polyline_from_lines => {
                for line in lines {
                    if line.is_empty() {
                        continue;
                    }
                    let projected = if flat {
                        converter.project_points_on_center(line)
                    } else {
                        converter.project_points(line)
                    };
                    if projected.is_empty() {
                        continue;
                    }
                    builder.add_polyline(projected, CRS::Geographic, false);
                }
            }
            _ => {}
        }
    }

    let entities = builder
        .groups
        .finalize(commands, buf, appearances, layer_id, false);

    for &entity in &entities {
        if let Some((tile_handle, tile_extent)) = tile_info {
            commands.entity(entity).insert((
                OverscaledTileHandle::new(tile_handle),
                TileExtent::new(tile_extent),
            ));
        }
        commands
            .entity(entity)
            .insert((order.clone(), VectorTileFeatureMarker));
    }

    if entities.is_empty() {
        None
    } else {
        Some(entities)
    }
}

#[cfg(test)]
mod test {
    use super::*;

    use std::sync::Arc;

    use bevy_app::{App, Update};
    use bevy_ecs::prelude::Resource;
    use bevy_ecs::query::With;
    use bevy_ecs::system::{Commands, ResMut};
    use navara_feature_component::{
        batch::{BatchTable, BatchedFeature},
        batched_geometry::{BatchedPolygonGeometry, BatchedPolylineGeometry},
        polygon::PolygonMarker,
        polyline::PolylineMarker,
    };
    use navara_geojson_vt::types::{Tile as VtTile, TileFeature};
    use navara_material::{PolygonMaterial, PolylineMaterial};

    // ── helpers ──────────────────────────────────────────────────────────

    fn polygon_feature(coords: Vec<Vec<[f64; 2]>>) -> TileFeature {
        TileFeature {
            geometry: TileGeometry::Polygons(vec![coords]),
            properties: Arc::new(serde_json::json!({})),
        }
    }

    fn polygon_feature_with_props(
        coords: Vec<Vec<[f64; 2]>>,
        props: serde_json::Value,
    ) -> TileFeature {
        TileFeature {
            geometry: TileGeometry::Polygons(vec![coords]),
            properties: Arc::new(props),
        }
    }

    fn point_feature(coords: Vec<[f64; 2]>) -> TileFeature {
        TileFeature {
            geometry: TileGeometry::Points(coords),
            properties: Arc::new(serde_json::json!({})),
        }
    }

    fn line_feature(coords: Vec<Vec<[f64; 2]>>) -> TileFeature {
        TileFeature {
            geometry: TileGeometry::Lines(coords),
            properties: Arc::new(serde_json::json!({})),
        }
    }

    fn make_tile(features: Vec<TileFeature>) -> VtTile {
        VtTile {
            features,
            z: 0,
            x: 0,
            y: 0,
            num_points: 0,
            num_simplified: 0,
            features_bbox: None,
        }
    }

    fn polygon_appearances() -> Vec<Appearance> {
        vec![Appearance::Polygon(PolygonMaterial {
            clamp_to_ground: true,
            ..Default::default()
        })]
    }

    fn polyline_appearances() -> Vec<Appearance> {
        vec![Appearance::Polyline(PolylineMaterial {
            clamp_to_ground: true,
            ..Default::default()
        })]
    }

    fn polygon_appearances_non_clamped() -> Vec<Appearance> {
        vec![Appearance::Polygon(PolygonMaterial {
            clamp_to_ground: false,
            ..Default::default()
        })]
    }

    #[derive(Resource)]
    struct TestInput {
        tile: VtTile,
        extent: u32,
        appearances: Vec<Appearance>,
    }

    #[derive(Resource, Default)]
    struct TestOutput(Option<Vec<Entity>>);

    fn test_system(
        mut commands: Commands,
        mut batch_table: ResMut<BatchTable>,
        mut buf: ResMut<BufferStore>,
        input: bevy_ecs::system::Res<TestInput>,
        mut out: ResMut<TestOutput>,
    ) {
        let order = OrderByDistance {
            sse: 0.0,
            distance: 0.0,
        };
        out.0 = construct_geojson_tile_geometry(
            &mut commands,
            &mut batch_table,
            &mut buf,
            &input.tile,
            input.extent,
            "test_layer",
            &input.appearances,
            None,
            &order,
        );
    }

    fn run_construct(tile: VtTile, appearances: Vec<Appearance>) -> App {
        let mut app = App::new();
        app.init_resource::<BufferStore>();
        app.init_resource::<BatchTable>();
        app.init_resource::<TestOutput>();
        app.insert_resource(TestInput {
            tile,
            extent: 4096,
            appearances,
        });
        app.add_systems(Update, test_system);
        app.update();
        app
    }

    // ── construct_geojson_tile_geometry tests ───────────────────────────

    #[test]
    fn empty_tile_returns_none() {
        let tile = make_tile(vec![]);
        let app = run_construct(tile, polygon_appearances());
        let out = app.world().resource::<TestOutput>();
        assert!(out.0.is_none());
    }

    #[test]
    fn single_polygon_creates_batched_feature() {
        let outer = vec![
            [0.0, 0.0],
            [4096.0, 0.0],
            [4096.0, 4096.0],
            [0.0, 4096.0],
            [0.0, 0.0],
        ];
        let tile = make_tile(vec![polygon_feature(vec![outer])]);
        let mut app = run_construct(tile, polygon_appearances());

        // One BatchedFeature parent with PolygonMarker and BatchedPolygonGeometry
        let mut query = app
            .world_mut()
            .query_filtered::<(&BatchedFeature, &BatchedPolygonGeometry), With<PolygonMarker>>();
        let results: Vec<_> = query.iter(app.world()).collect();
        assert_eq!(results.len(), 1);
        let (batched, geom) = results[0];
        assert!(!batched.default_active);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geom.feature_count(buf), 1); // 1 polygon
        assert_eq!(geom.batch_indices(buf).unwrap(), &[0]);

        // Parent should have VectorTileFeatureMarker
        let mut marker_query = app
            .world_mut()
            .query_filtered::<&VectorTileFeatureMarker, With<PolygonMarker>>();
        assert_eq!(marker_query.iter(app.world()).count(), 1);

        // Should return entity IDs
        let out = app.world().resource::<TestOutput>();
        let entities = out.0.as_ref().unwrap();
        assert_eq!(entities.len(), 1);
    }

    #[test]
    fn multiple_features_create_multiple_children() {
        let outer1 = vec![
            [0.0, 0.0],
            [2048.0, 0.0],
            [2048.0, 2048.0],
            [0.0, 2048.0],
            [0.0, 0.0],
        ];
        let outer2 = vec![
            [2048.0, 2048.0],
            [4096.0, 2048.0],
            [4096.0, 4096.0],
            [2048.0, 4096.0],
            [2048.0, 2048.0],
        ];
        let tile = make_tile(vec![
            polygon_feature(vec![outer1]),
            polygon_feature(vec![outer2]),
        ]);
        let mut app = run_construct(tile, polygon_appearances());

        // One BatchedFeature parent with 2 polygon features accumulated
        let mut query = app
            .world_mut()
            .query_filtered::<(&BatchedFeature, &BatchedPolygonGeometry), With<PolygonMarker>>();
        let results: Vec<_> = query.iter(app.world()).collect();
        assert_eq!(results.len(), 1);
        let (_batched, geom) = results[0];
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geom.feature_count(buf), 2); // 2 polygons accumulated
        assert_eq!(geom.batch_indices(buf).unwrap(), &[0, 1]);
    }

    #[test]
    fn polygon_with_hole_creates_single_polygon_entry() {
        let outer = vec![
            [0.0, 0.0],
            [4096.0, 0.0],
            [4096.0, 4096.0],
            [0.0, 4096.0],
            [0.0, 0.0],
        ];
        let hole = vec![
            [1024.0, 1024.0],
            [3072.0, 1024.0],
            [3072.0, 3072.0],
            [1024.0, 3072.0],
            [1024.0, 1024.0],
        ];
        let tile = make_tile(vec![polygon_feature(vec![outer, hole])]);
        let mut app = run_construct(tile, polygon_appearances());

        // One polygon entry with 1 hole
        let mut query = app
            .world_mut()
            .query_filtered::<&BatchedPolygonGeometry, With<PolygonMarker>>();
        let geoms: Vec<_> = query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geoms[0].feature_count(buf), 1);
        assert_eq!(geoms[0].holes_boundaries(buf).unwrap(), &[1]); // 1 hole
    }

    #[test]
    fn non_polygon_geometry_produces_no_entities() {
        let tile = make_tile(vec![
            point_feature(vec![[2048.0, 2048.0]]),
            line_feature(vec![vec![[0.0, 0.0], [4096.0, 4096.0]]]),
        ]);
        let app = run_construct(tile, polygon_appearances());
        let out = app.world().resource::<TestOutput>();
        assert!(out.0.is_none());
    }

    #[test]
    fn empty_polygon_ring_is_skipped() {
        // A polygon with an empty outer ring should be skipped
        let tile = make_tile(vec![polygon_feature(vec![vec![]])]);
        let app = run_construct(tile, polygon_appearances());
        let out = app.world().resource::<TestOutput>();
        assert!(out.0.is_none());
    }

    #[test]
    fn mismatched_appearance_produces_no_entities() {
        let outer = vec![
            [0.0, 0.0],
            [4096.0, 0.0],
            [4096.0, 4096.0],
            [0.0, 4096.0],
            [0.0, 0.0],
        ];
        let tile = make_tile(vec![polygon_feature(vec![outer])]);
        // Use a non-polygon appearance
        let app = run_construct(
            tile,
            vec![Appearance::Polyline(
                navara_material::PolylineMaterial::default(),
            )],
        );
        let out = app.world().resource::<TestOutput>();
        assert!(out.0.is_none());
    }

    #[test]
    fn tile_info_attaches_overscaled_handle_and_extent() {
        // Use a dedicated system that passes tile_info
        let mut app = App::new();
        app.init_resource::<BufferStore>();
        app.init_resource::<BatchTable>();
        app.init_resource::<TestOutput>();

        let outer = vec![
            [0.0, 0.0],
            [4096.0, 0.0],
            [4096.0, 4096.0],
            [0.0, 4096.0],
            [0.0, 0.0],
        ];
        let tile = make_tile(vec![polygon_feature(vec![outer])]);

        app.insert_resource(TestInput {
            tile,
            extent: 4096,
            appearances: polygon_appearances(),
        });

        app.add_systems(
            Update,
            |mut commands: Commands,
             mut batch_table: ResMut<BatchTable>,
             mut buf: ResMut<BufferStore>,
             input: bevy_ecs::system::Res<TestInput>,
             mut out: ResMut<TestOutput>| {
                let order = OrderByDistance {
                    sse: 0.0,
                    distance: 0.0,
                };
                let tile_handle: TileHandle = 42;
                let tile_extent = navara_core::Extent::default();
                out.0 = construct_geojson_tile_geometry(
                    &mut commands,
                    &mut batch_table,
                    &mut buf,
                    &input.tile,
                    input.extent,
                    "test_layer",
                    &input.appearances,
                    Some((tile_handle, tile_extent)),
                    &order,
                );
            },
        );
        app.update();

        // Should have OverscaledTileHandle and TileExtent on the parent entity
        let mut handle_query = app.world_mut().query::<&OverscaledTileHandle>();
        assert_eq!(handle_query.iter(app.world()).count(), 1);

        let mut extent_query = app.world_mut().query::<&TileExtent>();
        assert_eq!(extent_query.iter(app.world()).count(), 1);
    }

    #[test]
    fn order_by_distance_is_attached_to_entities() {
        let outer = vec![
            [0.0, 0.0],
            [4096.0, 0.0],
            [4096.0, 4096.0],
            [0.0, 4096.0],
            [0.0, 0.0],
        ];
        let tile = make_tile(vec![polygon_feature(vec![outer])]);
        let mut app = run_construct(tile, polygon_appearances());

        let mut order_query = app
            .world_mut()
            .query_filtered::<&OrderByDistance, With<PolygonMarker>>();
        assert_eq!(order_query.iter(app.world()).count(), 1);
    }

    #[test]
    fn feature_properties_are_stored_in_batch_table() {
        let outer = vec![
            [0.0, 0.0],
            [4096.0, 0.0],
            [4096.0, 4096.0],
            [0.0, 4096.0],
            [0.0, 0.0],
        ];
        let tile = make_tile(vec![polygon_feature_with_props(
            vec![outer],
            serde_json::json!({"name": "test_polygon", "id": 42}),
        )]);
        let app = run_construct(tile, polygon_appearances());

        // Verify batch table has entries (properties are stored there)
        let batch_table = app.world().resource::<BatchTable>();
        assert!(!batch_table.is_empty());
    }

    #[test]
    fn multipolygon_creates_multiple_polygon_entries_from_single_feature() {
        // A feature with multiple polygon geometries (Polygons variant wraps Vec<Vec<Vec<...>>>)
        let poly1_outer = vec![
            [0.0, 0.0],
            [2048.0, 0.0],
            [2048.0, 2048.0],
            [0.0, 2048.0],
            [0.0, 0.0],
        ];
        let poly2_outer = vec![
            [2048.0, 2048.0],
            [4096.0, 2048.0],
            [4096.0, 4096.0],
            [2048.0, 4096.0],
            [2048.0, 2048.0],
        ];
        // Create a feature with two separate polygon rings
        let feature = TileFeature {
            geometry: TileGeometry::Polygons(vec![vec![poly1_outer], vec![poly2_outer]]),
            properties: Arc::new(serde_json::json!({})),
        };
        let tile = make_tile(vec![feature]);
        let mut app = run_construct(tile, polygon_appearances());

        // Two polygon entries accumulated into a single BatchedPolygonGeometry
        let mut query = app
            .world_mut()
            .query_filtered::<(&BatchedFeature, &BatchedPolygonGeometry), With<PolygonMarker>>();
        let results: Vec<_> = query.iter(app.world()).collect();
        assert_eq!(results.len(), 1);
        let (_batched, geom) = results[0];
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geom.feature_count(buf), 2); // 2 polygons
        // Both polygons share batch_index 0 (same feature in multipolygon)
        assert_eq!(geom.batch_indices(buf).unwrap(), &[0, 0]);
    }

    #[test]
    fn non_clamped_polygon_uses_geographic_projection() {
        // With clamp_to_ground=false, coordinates should be geographic (lon/lat),
        // not flat [-1, 1]. For tile z=0, x=0, y=0, the centre of the tile
        // (extent/2, extent/2) should map approximately to (0, 0) in geographic.
        let outer = vec![
            [0.0, 0.0],
            [4096.0, 0.0],
            [4096.0, 4096.0],
            [0.0, 4096.0],
            [0.0, 0.0],
        ];
        let tile = make_tile(vec![polygon_feature(vec![outer])]);
        let mut app = run_construct(tile, polygon_appearances_non_clamped());

        // Should produce a BatchedPolygonGeometry
        let mut query = app
            .world_mut()
            .query_filtered::<&BatchedPolygonGeometry, With<PolygonMarker>>();
        let geoms: Vec<_> = query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        let outer_rings = geoms[0].outer_rings(buf).unwrap();

        // The outer ring values should NOT be in [-1, 1] range (geographic coords
        // for z=0 tile span [-180, 180] lon and ~[-85, 85] lat).
        // First point (tile 0,0) should be ~ -180 lon
        assert!(
            outer_rings[0] < -100.0,
            "expected geographic lon, got {}",
            outer_rings[0]
        );

        // Non-flat (3D globe) path must use Clockwise for outer rings so that
        // align_winding_order correctly re-winds after the Y-axis flip.
        let winding = geoms[0].expected_winding_orders(buf).unwrap();
        assert_eq!(
            winding[0],
            WindingOrder::Clockwise as u8,
            "non-clamped outer ring should hint Clockwise (same as MVT non-flat path)"
        );
    }

    // ── polygon boundary derivation (geometry_types) tests ─────────────

    fn boundary_polyline_appearances() -> Vec<Appearance> {
        vec![Appearance::Polyline(PolylineMaterial {
            clamp_to_ground: true,
            geometry_types: vec![SourceGeometryType::Line, SourceGeometryType::Polygon],
            ..Default::default()
        })]
    }

    #[test]
    fn polygon_derives_boundary_polyline_when_opted_in() {
        let outer = vec![
            [0.0, 0.0],
            [4096.0, 0.0],
            [4096.0, 4096.0],
            [0.0, 4096.0],
            [0.0, 0.0],
        ];
        let tile = make_tile(vec![polygon_feature(vec![outer])]);
        let mut appearances = polygon_appearances();
        appearances.extend(boundary_polyline_appearances());
        let mut app = run_construct(tile, appearances);

        // Both the fill and the derived boundary spawn.
        let mut poly_query = app
            .world_mut()
            .query_filtered::<&BatchedPolygonGeometry, With<PolygonMarker>>();
        assert_eq!(poly_query.iter(app.world()).count(), 1);

        let mut line_query = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let geoms: Vec<_> = line_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geoms[0].feature_count(buf), 1);
    }

    #[test]
    fn polygon_derives_boundary_polyline_without_polygon_appearance() {
        // A polyline-only layer opted into polygons renders the boundary and
        // spawns no polygon entity.
        let outer = vec![
            [0.0, 0.0],
            [4096.0, 0.0],
            [4096.0, 4096.0],
            [0.0, 4096.0],
            [0.0, 0.0],
        ];
        let hole = vec![
            [1024.0, 1024.0],
            [1024.0, 3072.0],
            [3072.0, 3072.0],
            [3072.0, 1024.0],
            [1024.0, 1024.0],
        ];
        let tile = make_tile(vec![polygon_feature(vec![outer, hole])]);
        let mut app = run_construct(tile, boundary_polyline_appearances());

        let mut poly_query = app
            .world_mut()
            .query_filtered::<&BatchedPolygonGeometry, With<PolygonMarker>>();
        assert_eq!(poly_query.iter(app.world()).count(), 0);

        let mut line_query = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let geoms: Vec<_> = line_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        // Outer ring + hole ring, sharing the feature's batch index.
        assert_eq!(geoms[0].feature_count(buf), 2);
        assert_eq!(geoms[0].batch_indices(buf).unwrap(), &[0, 0]);
    }

    #[test]
    fn non_draped_tiled_boundary_drops_tile_clip_edges() {
        // Two vertices sit in the tile's clip buffer (x = -64); the edge
        // between them traces the tile outline and must not render.
        let outer = vec![
            [-64.0, 10.0],
            [100.0, 10.0],
            [100.0, 100.0],
            [-64.0, 100.0],
            [-64.0, 10.0],
        ];
        let tile = make_tile(vec![polygon_feature(vec![outer])]);
        let appearances = vec![Appearance::Polyline(PolylineMaterial {
            clamp_to_ground: false,
            tiled: true,
            geometry_types: vec![SourceGeometryType::Line, SourceGeometryType::Polygon],
            ..Default::default()
        })];
        let mut app = run_construct(tile, appearances);

        let mut line_query = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let geoms: Vec<_> = line_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geoms[0].feature_count(buf), 1);
        let points = geoms[0].points(buf).unwrap();
        // One open run over the four real vertices (3 coords each).
        assert_eq!(points.len(), 12);
        assert_ne!(points[..3], points[points.len() - 3..]);
    }

    #[test]
    fn polygon_without_boundary_opt_in_derives_nothing() {
        let outer = vec![
            [0.0, 0.0],
            [4096.0, 0.0],
            [4096.0, 4096.0],
            [0.0, 4096.0],
            [0.0, 0.0],
        ];
        let tile = make_tile(vec![polygon_feature(vec![outer])]);
        // Default polyline appearance consumes lines only.
        let app = run_construct(tile, polyline_appearances());
        let out = app.world().resource::<TestOutput>();
        assert!(out.0.is_none());
    }

    // ── polyline (TileGeometry::Lines) tests ───────────────────────────

    #[test]
    fn line_feature_creates_batched_polyline() {
        let line = vec![[0.0, 0.0], [2048.0, 2048.0], [4096.0, 0.0]];
        let tile = make_tile(vec![line_feature(vec![line])]);
        let mut app = run_construct(tile, polyline_appearances());

        let mut query = app
            .world_mut()
            .query_filtered::<(&BatchedFeature, &BatchedPolylineGeometry), With<PolylineMarker>>();
        let results: Vec<_> = query.iter(app.world()).collect();
        assert_eq!(results.len(), 1);
        let (_batched, geom) = results[0];
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geom.feature_count(buf), 1);
        assert_eq!(geom.batch_indices(buf).unwrap(), &[0]);

        let out = app.world().resource::<TestOutput>();
        assert!(out.0.is_some());
        assert_eq!(out.0.as_ref().unwrap().len(), 1);
    }

    #[test]
    fn multiple_line_features_accumulate() {
        let line1 = vec![[0.0, 0.0], [2048.0, 2048.0]];
        let line2 = vec![[2048.0, 0.0], [4096.0, 4096.0]];
        let tile = make_tile(vec![line_feature(vec![line1]), line_feature(vec![line2])]);
        let mut app = run_construct(tile, polyline_appearances());

        let mut query = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let geoms: Vec<_> = query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geoms[0].feature_count(buf), 2);
        assert_eq!(geoms[0].batch_indices(buf).unwrap(), &[0, 1]);
    }

    #[test]
    fn empty_line_is_skipped() {
        let tile = make_tile(vec![line_feature(vec![vec![]])]);
        let app = run_construct(tile, polyline_appearances());
        let out = app.world().resource::<TestOutput>();
        assert!(out.0.is_none());
    }

    #[test]
    fn mixed_polygon_and_line_features() {
        let outer = vec![
            [0.0, 0.0],
            [4096.0, 0.0],
            [4096.0, 4096.0],
            [0.0, 4096.0],
            [0.0, 0.0],
        ];
        let line = vec![[0.0, 0.0], [4096.0, 4096.0]];
        let tile = make_tile(vec![polygon_feature(vec![outer]), line_feature(vec![line])]);
        let appearances = vec![
            Appearance::Polygon(PolygonMaterial {
                clamp_to_ground: true,
                ..Default::default()
            }),
            Appearance::Polyline(PolylineMaterial {
                clamp_to_ground: true,
                ..Default::default()
            }),
        ];
        let mut app = run_construct(tile, appearances);

        // Should have both polygon and polyline entities
        let mut poly_query = app
            .world_mut()
            .query_filtered::<&BatchedPolygonGeometry, With<PolygonMarker>>();
        assert_eq!(poly_query.iter(app.world()).count(), 1);

        let mut line_query = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        assert_eq!(line_query.iter(app.world()).count(), 1);

        let out = app.world().resource::<TestOutput>();
        assert_eq!(out.0.as_ref().unwrap().len(), 2);
    }
}
