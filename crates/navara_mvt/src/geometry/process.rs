use bevy_ecs::{entity::Entity, system::Commands};
use navara_buffer_store::BufferStore;
use navara_component::OrderByDistance;
use navara_core::{Aabb, CRS, Extent, Radians, TileXYZ};
use navara_feature_component::{
    batch::BatchTable,
    batched_geometry::{
        EncodedPointPositions, PointGeometryAccumulator, PolygonGeometryAccumulator,
        PolylineGeometryAccumulator,
    },
    geometry_builder::{
        AccumulatedGeometry, GeometryAppearanceKind, GeometryGroup, GeometryGroups,
    },
};
use navara_material::{Appearance, SourceGeometryType};
use navara_math::{FloatType, Transform, Vec3};
use navara_parser::mvt::{
    LayerParseConfig, LayerParseKind, MvtLayerData, ParsedGeometry, ParsedLayerGroup, PointEmitter,
    parse_mvt_tile,
};
use navara_tile_component::{OverscaledTileHandle, TileExtent, TileHandle};
use navara_vector_tile::VectorTileFeatureMarker;

// ============================================================================
// Multi-layer support: parse MVT once, spawn features for multiple layers
// ============================================================================

/// Information about a matched layer for multi-layer processing.
pub struct MatchedLayerInfo<'a> {
    /// The layer ID
    pub layer_id: &'a str,
    /// The layer's appearances
    pub appearances: &'a [Appearance],
    /// Optional layer filter for MVT sublayers
    pub limit_layers: &'a Option<Vec<String>>,
}

/// Reduce a matched layer's `Appearance`s to the ECS-free parse configuration
/// the geometry walk needs. `Appearance` (and thus `navara_material`) is
/// bevy_ecs-coupled, so this lowering keeps it out of the lean parse core.
pub(crate) fn layer_parse_config(matched: &MatchedLayerInfo) -> LayerParseConfig {
    let flat = matched.appearances.iter().any(|a| match a {
        Appearance::Polyline(app) => app.clamp_to_ground,
        Appearance::Polygon(app) => app.clamp_to_ground,
        _ => false,
    });

    let point_emitter = |kind, height, geometry_types: &[SourceGeometryType]| PointEmitter {
        kind,
        height,
        from_points: geometry_types.contains(&SourceGeometryType::Point),
        from_lines: geometry_types.contains(&SourceGeometryType::Line),
        from_polygons: geometry_types.contains(&SourceGeometryType::Polygon),
    };

    let mut point_emitters = Vec::new();
    let mut polyline = false;
    let mut polyline_from_polygons = false;
    let mut polygon = false;
    for a in matched.appearances {
        match a {
            Appearance::Point(m) => point_emitters.push(point_emitter(
                LayerParseKind::Point,
                m.height,
                &m.geometry_types,
            )),
            Appearance::Billboard(m) => point_emitters.push(point_emitter(
                LayerParseKind::Billboard,
                m.height,
                &m.geometry_types,
            )),
            Appearance::Text(m) => point_emitters.push(point_emitter(
                LayerParseKind::Text,
                m.height,
                &m.geometry_types,
            )),
            Appearance::Polyline(m) => {
                polyline |= m.geometry_types.contains(&SourceGeometryType::Line);
                // Boundary derivation requires the polyline's render
                // interpretation to match the layer projection: a clamped
                // polyline drapes the flat tile-local rings, and when nothing
                // forces `flat` the rings stay geographic for a non-clamped
                // polyline.
                polyline_from_polygons |= (m.clamp_to_ground || !flat)
                    && m.geometry_types.contains(&SourceGeometryType::Polygon);
            }
            Appearance::Polygon(_) => polygon = true,
            _ => {}
        }
    }
    // Drop emitters whose geometry_types opted out of every source; they can
    // never emit and would only slow down the per-coordinate walk.
    point_emitters.retain(|e| e.from_points || e.from_lines || e.from_polygons);

    LayerParseConfig {
        layer_id: matched.layer_id.to_owned(),
        flat,
        point_emitters,
        polyline,
        polyline_from_polygons,
        polygon,
        limit_layers: matched.limit_layers.clone(),
    }
}

pub(crate) fn to_appearance_kind(kind: LayerParseKind) -> GeometryAppearanceKind {
    match kind {
        LayerParseKind::Point => GeometryAppearanceKind::Point,
        LayerParseKind::Billboard => GeometryAppearanceKind::Billboard,
        LayerParseKind::Text => GeometryAppearanceKind::Text,
        LayerParseKind::Polyline => GeometryAppearanceKind::Polyline,
        LayerParseKind::Polygon => GeometryAppearanceKind::Polygon,
    }
}

/// Main entry point for multi-layer MVT processing.
///
/// Parses the MVT binary once via the ECS-free parse core, then finalizes the
/// resulting plain geometry into batched `BatchedFeature` entities. Batch-id
/// assignment, tag registration and entity spawning stay on the main thread
/// while the (worker-offloadable) parse produces only plain data.
#[allow(clippy::too_many_arguments)]
pub fn construct_geometry_multi_layer(
    commands: &mut Commands,
    batch_table: &mut BatchTable,
    buf: &mut BufferStore,
    mvt_bin: Vec<u8>,
    xyz: TileXYZ,
    matched_layers: &[MatchedLayerInfo],
    tile_info: Option<(TileHandle, Extent<FloatType, Radians>)>,
    order: &OrderByDistance,
) -> Option<Vec<Entity>> {
    if matched_layers.is_empty() {
        return None;
    }

    let rtc_center = tile_info
        .map(|(_, ext)| Aabb::from_extent_f64(ext, 0., 1.).center)
        .unwrap_or(Vec3::ZERO);

    let configs: Vec<LayerParseConfig> = matched_layers.iter().map(layer_parse_config).collect();

    let parsed = parse_mvt_tile(&mvt_bin, xyz, rtc_center, &configs);
    if parsed.is_empty() {
        return None;
    }

    let mut result = Vec::new();
    for group in parsed {
        // Each group carries the target layer it was emitted for; recover that
        // layer's appearances by id, resolving a duplicated id the way the parse
        // core does (last matching id wins).
        let Some(appearances) = matched_layers
            .iter()
            .rev()
            .find(|ml| ml.layer_id == group.layer_id)
            .map(|ml| ml.appearances)
        else {
            continue;
        };

        let entities = finalize_parsed_group(
            commands,
            batch_table,
            buf,
            group,
            appearances,
            rtc_center,
            tile_info,
            order,
        );
        result.extend(entities);
    }

    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

/// Convert one parsed group into a batched entity: assign batch ids, build the
/// handle-based geometry component and spawn via the shared finalize path.
#[allow(clippy::too_many_arguments)]
fn finalize_parsed_group(
    commands: &mut Commands,
    batch_table: &mut BatchTable,
    buf: &mut BufferStore,
    group: ParsedLayerGroup,
    appearances: &[Appearance],
    rtc_center: Vec3,
    tile_info: Option<(TileHandle, Extent<FloatType, Radians>)>,
    order: &OrderByDistance,
) -> Vec<Entity> {
    let layer_id = group.layer_id;
    let kind = to_appearance_kind(group.kind);

    let batch_id = batch_table
        .init_mvt(
            Some(layer_id.clone()),
            MvtLayerData::from_raw(
                group.keys,
                group.values,
                group.feature_tags_flat,
                &group.feature_tag_sizes,
            ),
        )
        .unwrap_or(0);

    let item_count = group.geometry.item_count();
    let mut global_batch_ids = Vec::with_capacity(item_count);
    for _ in 0..item_count {
        global_batch_ids.push(batch_table.gen_global_batch_id().unwrap_or(0));
    }

    let accumulated = build_accumulated_geometry(group.geometry, &global_batch_ids, rtc_center);

    spawn_finalized_group(
        commands,
        buf,
        kind,
        global_batch_ids,
        batch_id,
        group.feature_count,
        accumulated,
        appearances,
        &layer_id,
        tile_info,
        order,
    )
}

/// Build the handle-free [`AccumulatedGeometry`] for one parsed group from its
/// plain buffers. Shared by the synchronous finalize and the worker-completion
/// finalize (`async_finalize`) so the mapping from parsed buffers to accumulators
/// — CRS, RTC encoding, batch-id packing, transform — is defined in one place and
/// cannot drift between the two paths.
pub(crate) fn build_accumulated_geometry(
    geometry: ParsedGeometry,
    global_batch_ids: &[u32],
    rtc_center: Vec3,
) -> AccumulatedGeometry {
    match geometry {
        ParsedGeometry::Points {
            coords,
            batch_indices,
            encoded_coords,
        } => {
            let batch_ids = global_batch_ids.iter().map(|&id| id as f32).collect();
            AccumulatedGeometry::Points(PointGeometryAccumulator {
                coords,
                crs: CRS::Geographic,
                batch_indices,
                encoded: EncodedPointPositions::Rtc {
                    coords: encoded_coords,
                    center: rtc_center,
                },
                batch_ids,
                transform: Transform::default(),
            })
        }
        ParsedGeometry::Polylines {
            points,
            points_sizes,
            batch_indices,
            ring_flags,
        } => AccumulatedGeometry::Polylines(PolylineGeometryAccumulator {
            points,
            points_sizes,
            batch_indices,
            ring_flags,
            crs: CRS::Geographic,
        }),
        ParsedGeometry::Polygons {
            outer_rings,
            outer_ring_sizes,
            holes,
            holes_total_sizes,
            holes_sizes,
            holes_boundaries,
            expected_winding_orders,
            batch_indices,
        } => AccumulatedGeometry::Polygons(PolygonGeometryAccumulator {
            outer_rings,
            outer_ring_sizes,
            holes,
            holes_total_sizes,
            holes_sizes,
            holes_boundaries,
            expected_winding_orders,
            batch_indices,
            crs: CRS::Geographic,
        }),
    }
}

/// Spawn a single batched-feature entity from a fully-built accumulator and tag
/// it with tile/order markers. Shared by the synchronous finalize and the
/// worker-completion finalize (`async_finalize`).
#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_finalized_group(
    commands: &mut Commands,
    buf: &mut BufferStore,
    kind: GeometryAppearanceKind,
    global_batch_ids: Vec<u32>,
    batch_id: u32,
    feature_count: u32,
    accumulated: AccumulatedGeometry,
    appearances: &[Appearance],
    layer_id: &str,
    tile_info: Option<(TileHandle, Extent<FloatType, Radians>)>,
    order: &OrderByDistance,
) -> Vec<Entity> {
    let groups = GeometryGroups {
        groups: vec![GeometryGroup {
            kind,
            global_batch_ids,
            batch_id,
            feature_count,
            committed: false,
            current_batch_index: 0,
            accumulated,
        }],
    };

    let entities = groups.finalize(commands, buf, appearances, layer_id, false);

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

    entities
}

#[cfg(test)]
mod test {
    use super::*;
    use bevy_app::{App, Update};
    use bevy_ecs::prelude::Resource;
    use bevy_ecs::query::With;
    use bevy_ecs::system::{Commands, ResMut};
    use geozero::mvt::{Message, tile};
    use navara_feature_component::{
        batch::{BatchTable, BatchedFeature, FeatureBatchId, GlobalBatchIds},
        batched_geometry::{BatchedPointGeometry, BatchedPolygonGeometry, BatchedPolylineGeometry},
        billboard::BillboardMarker,
        point::PointMarker,
        polygon::PolygonMarker,
        polyline::PolylineMarker,
        text::TextMarker,
    };
    use navara_layer::LayerId;
    use navara_material::{
        BillboardMaterial, PointMaterial, PolygonMaterial, PolylineMaterial, TextMaterial,
    };

    /// Helper: encode a zigzag integer (MVT spec parameter encoding).
    fn zigzag(n: i32) -> u32 {
        ((n << 1) ^ (n >> 31)) as u32
    }

    /// Helper: create MVT command integer.
    fn command(id: u32, count: u32) -> u32 {
        (count << 3) | id
    }

    /// Helper: build a point feature at the given tile coordinates.
    fn point_feature(x: i32, y: i32, tags: Vec<u32>) -> tile::Feature {
        tile::Feature {
            id: None,
            tags,
            r#type: Some(tile::GeomType::Point as i32),
            geometry: vec![command(1, 1), zigzag(x), zigzag(y)],
        }
    }

    /// Helper: build a multipoint feature from multiple tile coordinates.
    fn multipoint_feature(points: &[(i32, i32)], tags: Vec<u32>) -> tile::Feature {
        let mut geometry = Vec::new();
        if !points.is_empty() {
            geometry.push(command(1, points.len() as u32)); // MoveTo(n)
            let mut prev = (0i32, 0i32);
            for &(x, y) in points {
                geometry.push(zigzag(x - prev.0));
                geometry.push(zigzag(y - prev.1));
                prev = (x, y);
            }
        }
        tile::Feature {
            id: None,
            tags,
            r#type: Some(tile::GeomType::Point as i32),
            geometry,
        }
    }

    /// Helper: build a multilinestring feature from multiple line segments.
    fn multilinestring_feature(lines: &[&[(i32, i32)]], tags: Vec<u32>) -> tile::Feature {
        let mut geometry = Vec::new();
        for line in lines {
            if let Some(&(x0, y0)) = line.first() {
                geometry.push(command(1, 1));
                geometry.push(zigzag(x0));
                geometry.push(zigzag(y0));
                if line.len() > 1 {
                    geometry.push(command(2, (line.len() - 1) as u32));
                    let mut prev = (x0, y0);
                    for &(x, y) in &line[1..] {
                        geometry.push(zigzag(x - prev.0));
                        geometry.push(zigzag(y - prev.1));
                        prev = (x, y);
                    }
                }
            }
        }
        tile::Feature {
            id: None,
            tags,
            r#type: Some(tile::GeomType::Linestring as i32),
            geometry,
        }
    }

    /// Helper: build a multipolygon feature from multiple polygon rings.
    fn multipolygon_feature(rings: &[&[(i32, i32)]], tags: Vec<u32>) -> tile::Feature {
        let mut geometry = Vec::new();
        for ring in rings {
            if let Some(&(x0, y0)) = ring.first() {
                geometry.push(command(1, 1));
                geometry.push(zigzag(x0));
                geometry.push(zigzag(y0));
                if ring.len() > 1 {
                    geometry.push(command(2, (ring.len() - 1) as u32));
                    let mut prev = (x0, y0);
                    for &(x, y) in &ring[1..] {
                        geometry.push(zigzag(x - prev.0));
                        geometry.push(zigzag(y - prev.1));
                        prev = (x, y);
                    }
                }
                geometry.push(command(7, 1)); // ClosePath
            }
        }
        tile::Feature {
            id: None,
            tags,
            r#type: Some(tile::GeomType::Polygon as i32),
            geometry,
        }
    }

    /// Helper: build a linestring feature from the given points.
    fn linestring_feature(points: &[(i32, i32)], tags: Vec<u32>) -> tile::Feature {
        let mut geometry = Vec::new();
        if let Some(&(x0, y0)) = points.first() {
            geometry.push(command(1, 1)); // MoveTo(1)
            geometry.push(zigzag(x0));
            geometry.push(zigzag(y0));
            if points.len() > 1 {
                geometry.push(command(2, (points.len() - 1) as u32)); // LineTo(n-1)
                let mut prev = (x0, y0);
                for &(x, y) in &points[1..] {
                    geometry.push(zigzag(x - prev.0));
                    geometry.push(zigzag(y - prev.1));
                    prev = (x, y);
                }
            }
        }
        tile::Feature {
            id: None,
            tags,
            r#type: Some(tile::GeomType::Linestring as i32),
            geometry,
        }
    }

    /// Helper: build a polygon feature from the given ring of points.
    fn polygon_feature(ring: &[(i32, i32)], tags: Vec<u32>) -> tile::Feature {
        let mut geometry = Vec::new();
        if let Some(&(x0, y0)) = ring.first() {
            geometry.push(command(1, 1));
            geometry.push(zigzag(x0));
            geometry.push(zigzag(y0));
            if ring.len() > 1 {
                geometry.push(command(2, (ring.len() - 1) as u32));
                let mut prev = (x0, y0);
                for &(x, y) in &ring[1..] {
                    geometry.push(zigzag(x - prev.0));
                    geometry.push(zigzag(y - prev.1));
                    prev = (x, y);
                }
            }
            geometry.push(command(7, 1)); // ClosePath
        }
        tile::Feature {
            id: None,
            tags,
            r#type: Some(tile::GeomType::Polygon as i32),
            geometry,
        }
    }

    /// Helper: build a tile::Layer with the given features.
    fn make_layer(
        name: &str,
        features: Vec<tile::Feature>,
        keys: Vec<String>,
        values: Vec<tile::Value>,
    ) -> tile::Layer {
        tile::Layer {
            version: 2,
            name: name.to_string(),
            features,
            keys,
            values,
            extent: Some(4096),
        }
    }

    /// Helper: encode a Tile to protobuf bytes.
    fn encode_tile(layers: Vec<tile::Layer>) -> Vec<u8> {
        use geozero::mvt::Tile;
        let tile = Tile { layers };
        Message::encode_to_vec(&tile)
    }

    #[derive(Resource)]
    struct MvtTestInput {
        mvt_bin: Vec<u8>,
        appearances: Vec<Appearance>,
    }

    #[derive(Resource, Default)]
    struct MvtTestOutput(Option<Vec<Entity>>);

    fn test_construct_system(
        mut commands: Commands,
        mut batch_table: ResMut<BatchTable>,
        mut buf: ResMut<BufferStore>,
        input: bevy_ecs::system::Res<MvtTestInput>,
        mut out: ResMut<MvtTestOutput>,
    ) {
        let xyz = TileXYZ { x: 0, y: 0, z: 0 };
        let matched_layers = [MatchedLayerInfo {
            layer_id: "test_layer",
            appearances: &input.appearances,
            limit_layers: &None,
        }];
        let order = OrderByDistance {
            sse: 0.0,
            distance: 0.0,
        };
        out.0 = construct_geometry_multi_layer(
            &mut commands,
            &mut batch_table,
            &mut buf,
            input.mvt_bin.clone(),
            xyz,
            &matched_layers,
            None,
            &order,
        );
    }

    fn run_mvt_construct(mvt_bin: Vec<u8>, appearances: Vec<Appearance>) -> App {
        let mut app = App::new();
        app.init_resource::<BufferStore>();
        app.init_resource::<BatchTable>();
        app.init_resource::<MvtTestOutput>();
        app.insert_resource(MvtTestInput {
            mvt_bin,
            appearances,
        });
        app.add_systems(Update, test_construct_system);
        app.update();
        app
    }

    #[test]
    fn boundary_derivation_is_guarded_against_flat_projection_mismatch() {
        // A clamped polygon forces flat projection; a non-clamped, non-tiled
        // polyline would interpret the projected rings as geographic, so its
        // boundary derivation must stay off.
        let appearances = vec![
            Appearance::Polygon(PolygonMaterial {
                clamp_to_ground: true,
                ..Default::default()
            }),
            Appearance::Polyline(PolylineMaterial {
                clamp_to_ground: false,
                tiled: false,
                geometry_types: vec![SourceGeometryType::Line, SourceGeometryType::Polygon],
                ..Default::default()
            }),
        ];
        let matched = MatchedLayerInfo {
            layer_id: "l",
            appearances: &appearances,
            limit_layers: &None,
        };
        let config = layer_parse_config(&matched);
        assert!(config.flat);
        assert!(config.polyline);
        assert!(!config.polyline_from_polygons);

        // The material's `tiled` flag changes neither the projection nor the
        // render interpretation on MVT, so it must not bypass the guard.
        let appearances = vec![
            Appearance::Polygon(PolygonMaterial {
                clamp_to_ground: true,
                ..Default::default()
            }),
            Appearance::Polyline(PolylineMaterial {
                clamp_to_ground: false,
                tiled: true,
                geometry_types: vec![SourceGeometryType::Line, SourceGeometryType::Polygon],
                ..Default::default()
            }),
        ];
        let matched = MatchedLayerInfo {
            layer_id: "l",
            appearances: &appearances,
            limit_layers: &None,
        };
        let config = layer_parse_config(&matched);
        assert!(config.flat);
        assert!(!config.polyline_from_polygons);
    }

    #[test]
    fn boundary_derivation_stays_on_for_fully_geographic_layers() {
        // With nothing forcing flat projection, rings stay geographic and a
        // non-clamped polyline can derive boundaries safely.
        let appearances = vec![Appearance::Polyline(PolylineMaterial {
            clamp_to_ground: false,
            tiled: false,
            geometry_types: vec![SourceGeometryType::Line, SourceGeometryType::Polygon],
            ..Default::default()
        })];
        let matched = MatchedLayerInfo {
            layer_id: "l",
            appearances: &appearances,
            limit_layers: &None,
        };
        let config = layer_parse_config(&matched);
        assert!(!config.flat);
        assert!(config.polyline_from_polygons);
    }

    #[derive(Resource)]
    struct MvtMultiLayerInput {
        mvt_bin: Vec<u8>,
        /// `(layer id, appearances, sublayer filter)` per target layer.
        layers: Vec<(String, Vec<Appearance>, Option<Vec<String>>)>,
    }

    fn test_construct_multi_layer_system(
        mut commands: Commands,
        mut batch_table: ResMut<BatchTable>,
        mut buf: ResMut<BufferStore>,
        input: bevy_ecs::system::Res<MvtMultiLayerInput>,
        mut out: ResMut<MvtTestOutput>,
    ) {
        let matched_layers: Vec<MatchedLayerInfo> = input
            .layers
            .iter()
            .map(|(layer_id, appearances, limit_layers)| MatchedLayerInfo {
                layer_id,
                appearances,
                limit_layers,
            })
            .collect();
        out.0 = construct_geometry_multi_layer(
            &mut commands,
            &mut batch_table,
            &mut buf,
            input.mvt_bin.clone(),
            TileXYZ { x: 0, y: 0, z: 0 },
            &matched_layers,
            None,
            &OrderByDistance {
                sse: 0.0,
                distance: 0.0,
            },
        );
    }

    fn run_mvt_construct_multi_layer(
        mvt_bin: Vec<u8>,
        layers: Vec<(String, Vec<Appearance>, Option<Vec<String>>)>,
    ) -> App {
        let mut app = App::new();
        app.init_resource::<BufferStore>();
        app.init_resource::<BatchTable>();
        app.init_resource::<MvtTestOutput>();
        app.insert_resource(MvtMultiLayerInput { mvt_bin, layers });
        app.add_systems(Update, test_construct_multi_layer_system);
        app.update();
        app
    }

    /// Two layers pointing at the same source both spawn features. The source is
    /// parsed once, so the two layers' point geometry is identical.
    #[test]
    fn two_layers_on_one_source_both_spawn_features() {
        let layer = make_layer(
            "points",
            vec![
                point_feature(2048, 2048, vec![]),
                point_feature(1024, 1024, vec![]),
            ],
            vec![],
            vec![],
        );
        let mvt_bin = encode_tile(vec![layer]);

        let mut app = run_mvt_construct_multi_layer(
            mvt_bin,
            vec![
                (
                    "first".to_string(),
                    vec![Appearance::Point(PointMaterial::default())],
                    None,
                ),
                (
                    "second".to_string(),
                    vec![Appearance::Point(PointMaterial::default())],
                    None,
                ),
            ],
        );

        let mut query = app
            .world_mut()
            .query_filtered::<(&LayerId, &BatchedPointGeometry), With<PointMarker>>();
        let mut results: Vec<_> = query
            .iter(app.world())
            .map(|(layer_id, geom)| (layer_id.0.clone(), geom.coords.clone()))
            .collect();
        results.sort_by(|a, b| a.0.cmp(&b.0));

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].0, "first");
        assert_eq!(results[1].0, "second");
        assert_eq!(results[0].1.len(), 2);
        assert_eq!(results[0].1, results[1].1);
    }

    /// Layers on one source keep their own appearance kinds: a polygon layer and
    /// a polyline layer reading the same features each get their own geometry.
    #[test]
    fn layers_on_one_source_keep_independent_appearances() {
        let layer = make_layer(
            "shapes",
            vec![polygon_feature(
                &[(0, 0), (1000, 0), (1000, 1000), (0, 1000)],
                vec![],
            )],
            vec![],
            vec![],
        );
        let mvt_bin = encode_tile(vec![layer]);

        let mut app = run_mvt_construct_multi_layer(
            mvt_bin,
            vec![
                (
                    "fill".to_string(),
                    vec![Appearance::Polygon(PolygonMaterial::default())],
                    None,
                ),
                (
                    "outline".to_string(),
                    vec![Appearance::Polyline(PolylineMaterial {
                        geometry_types: vec![SourceGeometryType::Polygon],
                        ..Default::default()
                    })],
                    None,
                ),
            ],
        );

        let mut polygons = app
            .world_mut()
            .query_filtered::<&LayerId, With<PolygonMarker>>();
        let polygon_layers: Vec<_> = polygons.iter(app.world()).map(|l| l.0.clone()).collect();
        assert_eq!(polygon_layers, vec!["fill".to_string()]);

        let mut polylines = app
            .world_mut()
            .query_filtered::<&LayerId, With<PolylineMarker>>();
        let polyline_layers: Vec<_> = polylines.iter(app.world()).map(|l| l.0.clone()).collect();
        assert_eq!(polyline_layers, vec!["outline".to_string()]);
    }

    #[test]
    fn point_creates_batched_feature_with_mvt_marker() {
        let layer = make_layer(
            "points",
            vec![
                point_feature(2048, 2048, vec![]),
                point_feature(1024, 1024, vec![]),
            ],
            vec![],
            vec![],
        );
        let mvt_bin = encode_tile(vec![layer]);

        let mut app = run_mvt_construct(mvt_bin, vec![Appearance::Point(PointMaterial::default())]);

        // Should have 1 BatchedFeature parent with PointMarker and BatchedPointGeometry
        let mut query = app
            .world_mut()
            .query_filtered::<(&BatchedFeature, &BatchedPointGeometry), With<PointMarker>>();
        let results: Vec<_> = query.iter(app.world()).collect();
        assert_eq!(results.len(), 1);
        let (batched, geom) = results[0];
        assert!(!batched.default_active);
        assert_eq!(geom.coords.len(), 2);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geom.batch_indices(buf).unwrap(), &[0, 1]);

        // Should have VectorTileFeatureMarker
        let mut mvt_query = app
            .world_mut()
            .query_filtered::<&VectorTileFeatureMarker, With<PointMarker>>();
        assert_eq!(mvt_query.iter(app.world()).count(), 1);
    }

    #[test]
    fn multiple_appearances_create_separate_batched_features() {
        let layer = make_layer(
            "points",
            vec![
                point_feature(2048, 2048, vec![]),
                point_feature(1024, 1024, vec![]),
            ],
            vec![],
            vec![],
        );
        let mvt_bin = encode_tile(vec![layer]);

        let mut app = run_mvt_construct(
            mvt_bin,
            vec![
                Appearance::Point(PointMaterial::default()),
                Appearance::Billboard(BillboardMaterial::default()),
                Appearance::Text(TextMaterial::default()),
            ],
        );

        // Each appearance kind should produce its own parent with BatchedPointGeometry
        let mut point_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<PointMarker>>();
        let points: Vec<_> = point_query.iter(app.world()).collect();
        assert_eq!(points.len(), 1);
        assert_eq!(points[0].coords.len(), 2);

        let mut billboard_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<BillboardMarker>>();
        let billboards: Vec<_> = billboard_query.iter(app.world()).collect();
        assert_eq!(billboards.len(), 1);
        assert_eq!(billboards[0].coords.len(), 2);

        let mut text_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<TextMarker>>();
        let texts: Vec<_> = text_query.iter(app.world()).collect();
        assert_eq!(texts.len(), 1);
        assert_eq!(texts[0].coords.len(), 2);

        // Each parent should have VectorTileFeatureMarker
        let mut mvt_point = app
            .world_mut()
            .query_filtered::<&VectorTileFeatureMarker, With<PointMarker>>();
        assert_eq!(mvt_point.iter(app.world()).count(), 1);

        let mut mvt_billboard = app
            .world_mut()
            .query_filtered::<&VectorTileFeatureMarker, With<BillboardMarker>>();
        assert_eq!(mvt_billboard.iter(app.world()).count(), 1);

        let mut mvt_text = app
            .world_mut()
            .query_filtered::<&VectorTileFeatureMarker, With<TextMarker>>();
        assert_eq!(mvt_text.iter(app.world()).count(), 1);
    }

    #[test]
    fn linestring_creates_polyline_batched_feature() {
        let layer = make_layer(
            "roads",
            vec![linestring_feature(&[(0, 0), (100, 100), (200, 50)], vec![])],
            vec![],
            vec![],
        );
        let mvt_bin = encode_tile(vec![layer]);

        let mut app = run_mvt_construct(
            mvt_bin,
            vec![Appearance::Polyline(PolylineMaterial::default())],
        );

        let mut query = app
            .world_mut()
            .query_filtered::<(&BatchedFeature, &BatchedPolylineGeometry), With<PolylineMarker>>();
        let results: Vec<_> = query.iter(app.world()).collect();
        assert_eq!(results.len(), 1);
        let (_batched, geom) = results[0];

        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geom.feature_count(buf), 1); // 1 polyline feature
        assert_eq!(geom.batch_indices(buf).unwrap(), &[0]);
        // 3 points * 3 coords = 9
        assert_eq!(geom.points(buf).unwrap().len(), 9);
    }

    #[test]
    fn polygon_creates_polygon_batched_feature() {
        // Clockwise ring (MVT convention for outer rings)
        let layer = make_layer(
            "buildings",
            vec![polygon_feature(
                &[(0, 0), (4096, 0), (4096, 4096), (0, 4096)],
                vec![],
            )],
            vec![],
            vec![],
        );
        let mvt_bin = encode_tile(vec![layer]);

        let mut app = run_mvt_construct(
            mvt_bin,
            vec![Appearance::Polygon(PolygonMaterial::default())],
        );

        let mut query = app
            .world_mut()
            .query_filtered::<(&BatchedFeature, &BatchedPolygonGeometry), With<PolygonMarker>>();
        let results: Vec<_> = query.iter(app.world()).collect();
        assert_eq!(results.len(), 1);
        let (_batched, geom) = results[0];

        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geom.feature_count(buf), 1); // 1 polygon
        assert_eq!(geom.batch_indices(buf).unwrap(), &[0]);
        // 4 vertices + closing vertex from ClosePath = 5 * 3 coords = 15
        assert_eq!(geom.outer_rings(buf).unwrap().len(), 15);
    }

    #[test]
    fn mismatched_appearance_produces_no_parent() {
        let layer = make_layer(
            "points",
            vec![point_feature(2048, 2048, vec![])],
            vec![],
            vec![],
        );
        let mvt_bin = encode_tile(vec![layer]);

        let mut app = run_mvt_construct(
            mvt_bin,
            vec![Appearance::Polyline(PolylineMaterial::default())],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PolylineMarker>>();
        assert_eq!(batched_query.iter(app.world()).count(), 0);
    }

    #[test]
    fn global_batch_ids_has_correct_length() {
        let layer = make_layer(
            "points",
            vec![
                point_feature(100, 100, vec![]),
                point_feature(200, 200, vec![]),
                point_feature(300, 300, vec![]),
            ],
            vec![],
            vec![],
        );
        let mvt_bin = encode_tile(vec![layer]);

        let mut app = run_mvt_construct(mvt_bin, vec![Appearance::Point(PointMaterial::default())]);

        let mut query = app
            .world_mut()
            .query_filtered::<(&GlobalBatchIds, &BatchedPointGeometry), With<PointMarker>>();
        let results: Vec<_> = query.iter(app.world()).collect();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0.batch_length, 3);
        assert_eq!(results[0].1.coords.len(), 3);
    }

    #[test]
    fn construct_returns_entity_ids() {
        let layer = make_layer(
            "points",
            vec![point_feature(2048, 2048, vec![])],
            vec![],
            vec![],
        );
        let mvt_bin = encode_tile(vec![layer]);

        let app = run_mvt_construct(mvt_bin, vec![Appearance::Point(PointMaterial::default())]);

        let output = app.world().resource::<MvtTestOutput>();
        let entities = output.0.as_ref().unwrap();
        assert_eq!(entities.len(), 1);
    }

    #[test]
    fn empty_tile_returns_none() {
        let mvt_bin = encode_tile(vec![]);

        let app = run_mvt_construct(mvt_bin, vec![Appearance::Point(PointMaterial::default())]);

        let output = app.world().resource::<MvtTestOutput>();
        assert!(output.0.is_none());
    }

    #[test]
    fn it_should_handle_all_geometry_types_with_all_appearances() {
        // MVT layer with mixed geometry types:
        // - 1 Point + 1 MultiPoint(2) = 3 point coords per point-like appearance
        // - 1 LineString + 1 MultiLineString(2 segments) = 3 polyline segments
        // - 1 Polygon + 1 MultiPolygon(2 rings) = 3 polygon features
        let layer = make_layer(
            "mixed",
            vec![
                // Point features
                point_feature(100, 100, vec![]),
                multipoint_feature(&[(200, 200), (300, 300)], vec![]),
                // LineString features
                linestring_feature(&[(0, 0), (100, 100), (200, 50)], vec![]),
                multilinestring_feature(
                    &[&[(500, 500), (600, 600)], &[(700, 700), (800, 800)]],
                    vec![],
                ),
                // Polygon features
                polygon_feature(&[(0, 0), (1000, 0), (1000, 1000), (0, 1000)], vec![]),
                multipolygon_feature(
                    &[
                        &[(1500, 1500), (2000, 1500), (2000, 2000), (1500, 2000)],
                        &[(2500, 2500), (3000, 2500), (3000, 3000), (2500, 3000)],
                    ],
                    vec![],
                ),
            ],
            vec![],
            vec![],
        );
        let mvt_bin = encode_tile(vec![layer]);

        let mut app = run_mvt_construct(
            mvt_bin,
            vec![
                Appearance::Point(PointMaterial::default()),
                Appearance::Billboard(BillboardMaterial::default()),
                Appearance::Text(TextMaterial::default()),
                Appearance::Polyline(PolylineMaterial::default()),
                Appearance::Polygon(PolygonMaterial::default()),
            ],
        );

        // Point: 1 + 2 (multipoint) = 3 coords
        let mut point_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<PointMarker>>();
        let points: Vec<_> = point_query.iter(app.world()).collect();
        assert_eq!(points.len(), 1);
        assert_eq!(points[0].coords.len(), 3);

        // Billboard: same 3 coords
        let mut billboard_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<BillboardMarker>>();
        let billboards: Vec<_> = billboard_query.iter(app.world()).collect();
        assert_eq!(billboards.len(), 1);
        assert_eq!(billboards[0].coords.len(), 3);

        // Text: same 3 coords
        let mut text_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<TextMarker>>();
        let texts: Vec<_> = text_query.iter(app.world()).collect();
        assert_eq!(texts.len(), 1);
        assert_eq!(texts[0].coords.len(), 3);

        // Polyline: 1 (LineString) + 2 (MultiLineString) = 3 segments
        let mut polyline_query = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let polylines: Vec<_> = polyline_query.iter(app.world()).collect();
        assert_eq!(polylines.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(polylines[0].feature_count(buf), 3);

        // Polygon: 1 (Polygon) + 2 (MultiPolygon) = 3 polygons
        let mut polygon_query = app
            .world_mut()
            .query_filtered::<&BatchedPolygonGeometry, With<PolygonMarker>>();
        let polygons: Vec<_> = polygon_query.iter(app.world()).collect();
        assert_eq!(polygons.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(polygons[0].feature_count(buf), 3);

        // All 5 parent entities should have VectorTileFeatureMarker
        let mut mvt_query = app.world_mut().query::<&VectorTileFeatureMarker>();
        assert_eq!(mvt_query.iter(app.world()).count(), 5);
    }

    #[test]
    fn it_should_have_separate_feature_batch_id_per_appearance() {
        // A Point feature with Point + Billboard + Text appearances gets separate
        // feature_batch_ids per kind, with tags duplicated into each batch.
        let layer = make_layer(
            "points",
            vec![point_feature(2048, 2048, vec![0, 0])],
            vec!["name".to_string()],
            vec![tile::Value {
                string_value: Some("shared".to_string()),
                ..Default::default()
            }],
        );
        let mvt_bin = encode_tile(vec![layer]);

        let mut app = run_mvt_construct(
            mvt_bin,
            vec![
                Appearance::Point(PointMaterial::default()),
                Appearance::Billboard(BillboardMaterial::default()),
                Appearance::Text(TextMaterial::default()),
            ],
        );

        // Each BatchedFeature parent should have its own FeatureBatchId
        let mut point_query = app
            .world_mut()
            .query_filtered::<&FeatureBatchId, With<PointMarker>>();
        let point_batch_id = point_query.iter(app.world()).next().unwrap().0;

        let mut billboard_query = app
            .world_mut()
            .query_filtered::<&FeatureBatchId, With<BillboardMarker>>();
        let billboard_batch_id = billboard_query.iter(app.world()).next().unwrap().0;

        let mut text_query = app
            .world_mut()
            .query_filtered::<&FeatureBatchId, With<TextMarker>>();
        let text_batch_id = text_query.iter(app.world()).next().unwrap().0;

        // Each batch has its own copy of the tags
        let batch_table = app.world().resource::<BatchTable>();
        for batch_id in [point_batch_id, billboard_batch_id, text_batch_id] {
            let batch_value = batch_table.get(&batch_id).unwrap();
            let properties = batch_value.properties.as_ref().unwrap();
            match properties {
                navara_feature_component::batch::BatchProperty::Mvt(mvt_data) => {
                    assert_eq!(mvt_data.feature_count(), 1);
                    assert_eq!(mvt_data.feature_tags(0), Some(&[0, 0][..]));
                }
                _ => panic!("Expected BatchProperty::Mvt"),
            }
        }
    }
}
