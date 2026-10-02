use bevy_ecs::entity::Entity;
use bevy_ecs::system::Commands;

use navara_buffer_store::BufferStore;
use navara_core::CRS;
use navara_feature_component::batch::BatchTable;
use navara_geometry::{Hierarchy, WindingOrder, close_flat_ring, mercator_y_to_lat, open_ring_len};
use navara_material::{Appearance, Placement, SourceGeometryType};
use navara_math::Vec3;
use navara_parser::geojson::{GeoJson, Geometry, GeometryValue, Position};
use navara_parser::line_placement::{AlongLine, LinePath, PointPlacement, tangent_to_bearing};

use super::builder::{GeometryAppearanceKind, GeometryBuilder};

fn coords(f: &Position) -> Vec3 {
    Vec3::new(f[0], f[1], if f.len() > 2 { f[2] } else { 0. })
}

fn multi_flat_coords(f: &[Position]) -> Vec<f64> {
    f.iter()
        .flat_map(|p| [p[0], p[1], if p.len() > 2 { p[2] } else { 0. }])
        .collect::<Vec<_>>()
}

/// Ring vertices without the closing duplicate (GeoJSON rings repeat the
/// first position at the end). Falls back to the full slice for open rings.
fn ring_vertices(ring: &[Position]) -> &[Position] {
    &ring[..open_ring_len(ring, |p| (p[0], p[1]))]
}

/// Flatten a polygon ring and close it when the source ring omits the closing
/// duplicate, so derived boundary polylines are always closed.
fn closed_ring_coords(ring: &[Position]) -> Vec<f64> {
    let mut coords = multi_flat_coords(ring);
    close_flat_ring(&mut coords);
    coords
}

fn get_polygon_holes(f: &[Vec<Position>]) -> Option<Vec<Hierarchy>> {
    let holes: Vec<Hierarchy> = f[1..]
        .iter()
        .map(|hole| Hierarchy {
            outer_ring: multi_flat_coords(hole),
            holes: None,
            expected_winding_order: WindingOrder::Unknown,
        })
        .collect();

    (!holes.is_empty()).then_some(holes)
}

/// Construct batched feature entities from GeoJSON data.
///
/// This follows the MVT batched feature pattern:
/// 1. For each feature, spawn child entities with `BatchedFeatureMarker` + geometry + `BatchIndex`
/// 2. Group children by geometry-appearance kind
/// 3. Spawn a `BatchedFeature` parent for each group with the appropriate marker and material
///
/// Returns the spawned `BatchedFeature` parent entity IDs.
pub fn construct_geometry(
    commands: &mut Commands,
    batch_table: &mut BatchTable,
    buf: &mut BufferStore,
    geojson: &GeoJson,
    appearances: &[Appearance],
    layer_id: &str,
) -> Vec<Entity> {
    let mut builder = GeometryBuilder::new(batch_table, layer_id);

    match geojson {
        GeoJson::FeatureCollection(features) => {
            for feature in features {
                if let Some(geometry) = &feature.geometry {
                    builder.begin_feature(&feature.properties);
                    process_geometry(&mut builder, geometry, appearances);
                }
            }
        }
        GeoJson::Feature(feature) => {
            if let Some(geometry) = &feature.geometry {
                builder.begin_feature(&feature.properties);
                process_geometry(&mut builder, geometry, appearances);
            }
        }
        GeoJson::Geometry(geometry) => {
            builder.begin_feature(&None);
            process_geometry(&mut builder, geometry, appearances);
        }
    }

    builder
        .groups
        .finalize(commands, buf, appearances, layer_id, true)
}

/// Process a single GeoJSON geometry, accumulating it into the builder.
///
/// `begin_feature` must be called by the caller before invoking this function.
/// GeometryCollection recurses without resetting feature state, so all
/// sub-geometries share a single feature's batch indices and properties.
fn process_geometry(
    builder: &mut GeometryBuilder,
    geometry: &Geometry,
    appearances: &[Appearance],
) {
    // Handle GeometryCollection by recursing into each sub-geometry.
    // No begin_feature here — sub-geometries share the parent feature's state.
    if let GeometryValue::GeometryCollection { geometries: geoms } = &geometry.value {
        for g in geoms {
            process_geometry(builder, g, appearances);
        }
        return;
    }

    for appearance in appearances {
        match appearance {
            Appearance::Point(m) => {
                accumulate_point_rte(
                    builder,
                    geometry,
                    GeometryAppearanceKind::Point,
                    m.height,
                    &m.geometry_types,
                    m.placement,
                    m.spacing,
                );
            }
            Appearance::Billboard(m) => {
                accumulate_point_rte(
                    builder,
                    geometry,
                    GeometryAppearanceKind::Billboard,
                    m.height,
                    &m.geometry_types,
                    m.placement,
                    m.spacing,
                );
            }
            Appearance::Text(m) => {
                accumulate_point_rte(
                    builder,
                    geometry,
                    GeometryAppearanceKind::Text,
                    m.height,
                    &m.geometry_types,
                    m.placement,
                    m.spacing,
                );
            }
            Appearance::Polyline(p) => {
                // Skip clamped/tiled polylines - they go through the tiled rendering pipeline
                if !p.clamp_to_ground && !p.tiled {
                    accumulate_polyline(builder, geometry, &p.geometry_types);
                }
            }
            // Skip clamped/tiled polygons - they go through the tiled rendering pipeline
            Appearance::Polygon(p) if !p.clamp_to_ground && !p.tiled => {
                accumulate_polygon(builder, geometry);
            }
            _ => {}
        }
    }
}

/// Accumulate point geometry with RTE encoding (GeoJSON direct path).
///
/// `geometry_types` opts the point-like appearance into deriving a point per
/// line-string vertex and/or polygon-ring vertex (closing duplicates skipped).
/// `placement` then decides whether a line-string gives one anchor per vertex
/// or anchors spaced `spacing` screen pixels apart along it.
fn accumulate_point_rte(
    builder: &mut GeometryBuilder,
    geometry: &Geometry,
    kind: GeometryAppearanceKind,
    height: f32,
    geometry_types: &[SourceGeometryType],
    placement: Placement,
    spacing: f32,
) {
    let add_vertices = |builder: &mut GeometryBuilder, ps: &[Position]| {
        for f in ps {
            builder.add_point(kind, coords(f), CRS::Geographic, height);
        }
    };
    let placement = match placement {
        Placement::Point => PointPlacement::Point,
        Placement::Line => PointPlacement::Line,
        Placement::LineCenter => PointPlacement::LineCenter,
    };
    let add_line = |builder: &mut GeometryBuilder, ps: &[Position]| {
        if placement.is_along_line() {
            add_line_anchors(builder, ps, kind, height, placement, spacing);
        } else {
            add_vertices(builder, ps);
        }
    };

    match &geometry.value {
        GeometryValue::Point { coordinates: f }
            if geometry_types.contains(&SourceGeometryType::Point) =>
        {
            builder.add_point(kind, coords(f), CRS::Geographic, height);
        }
        GeometryValue::MultiPoint { coordinates: fs }
            if geometry_types.contains(&SourceGeometryType::Point) =>
        {
            add_vertices(builder, fs);
        }
        GeometryValue::LineString { coordinates: f }
            if geometry_types.contains(&SourceGeometryType::Line) =>
        {
            add_line(builder, f);
        }
        GeometryValue::MultiLineString { coordinates: fs }
            if geometry_types.contains(&SourceGeometryType::Line) =>
        {
            for f in fs {
                add_line(builder, f);
            }
        }
        GeometryValue::Polygon { coordinates: rings }
            if geometry_types.contains(&SourceGeometryType::Polygon) =>
        {
            for ring in rings {
                add_vertices(builder, ring_vertices(ring));
            }
        }
        GeometryValue::MultiPolygon { coordinates: fs }
            if geometry_types.contains(&SourceGeometryType::Polygon) =>
        {
            for rings in fs {
                for ring in rings {
                    add_vertices(builder, ring_vertices(ring));
                }
            }
        }
        _ => {}
    }
}

/// Radius of the Web Mercator sphere (EPSG:3857).
const MERCATOR_RADIUS_M: f64 = 6_378_137.0;

/// Latitude, in degrees, that [`to_mercator`] holds the poles at. Web Mercator
/// sends a pole itself to infinity, but a GeoJSON line is drawn on the globe
/// all the way to it, so the walk must not stop at the ±85.05° that
/// [`navara_geometry::mercator_y`] clamps tile coordinates to. A vertex on a pole moves about
/// 0.1 m.
const MAX_LAT_DEG: f64 = 90.0 - 1e-6;

/// Web Mercator position of a longitude/latitude in degrees, in metres at the
/// equator, with y growing southward as [`LinePath`] expects.
fn to_mercator(lon: f64, lat: f64) -> (f64, f64) {
    let lat = lat.clamp(-MAX_LAT_DEG, MAX_LAT_DEG).to_radians();
    (
        lon.to_radians() * MERCATOR_RADIUS_M,
        -(lat * 0.5 + std::f64::consts::FRAC_PI_4).tan().ln() * MERCATOR_RADIUS_M,
    )
}

/// Latitude in degrees of a [`to_mercator`] y.
fn mercator_lat(y: f64) -> f64 {
    mercator_y_to_lat(-y / MERCATOR_RADIUS_M).to_degrees()
}

/// Web Mercator positions of a line-string, unwrapped across the antimeridian.
///
/// Each longitude is taken within 180° of the previous vertex's, so a segment
/// from 179° to -179° is the 2° hop the line is drawn as (polylines go through
/// ECEF, where the seam does not exist) rather than 358° the long way round.
/// The result may run past ±180°; [`wrap_lon`] brings anchors back.
fn project_unwrapped(line: &[Position]) -> Vec<(f64, f64)> {
    let mut prev: Option<f64> = None;
    line.iter()
        .map(|p| {
            let mut lon = p[0];
            if let Some(prev) = prev {
                lon -= ((lon - prev) / 360.0).round() * 360.0;
            }
            prev = Some(lon);
            to_mercator(lon, p[1])
        })
        .collect()
}

/// A longitude in degrees, back in `[-180, 180)`.
fn wrap_lon(lon: f64) -> f64 {
    (lon + 180.0).rem_euclid(360.0) - 180.0
}

/// Ground metres per screen pixel of the closest view along-line anchors are
/// generated for: roughly a street-level camera. Nearer than this the pattern
/// stops densifying, and anchors sit further apart on screen than `spacing`
/// asks. Halving it doubles the anchor count.
const FINEST_METERS_PER_PX: f64 = 0.15;

/// Anchors spaced along one line-string, `spacing_px` screen pixels apart.
///
/// The walk runs in Web Mercator: it is conformal, so tangent bearings come out
/// exact, and one of its units covers `cos(lat)` metres of ground.
///
/// An untiled source has no zoom of its own, so the finest level is sized for
/// [`FINEST_METERS_PER_PX`] and the renderer picks the level per anchor. The
/// level spacing converts to Mercator units at the line's midpoint, since the
/// walk needs one constant step per line; bands and path samples convert at
/// each anchor's own latitude.
fn add_line_anchors(
    builder: &mut GeometryBuilder,
    line: &[Position],
    kind: GeometryAppearanceKind,
    height: f32,
    placement: PointPlacement,
    spacing_px: f32,
) {
    let projected = project_unwrapped(line);
    let Some(path) = LinePath::new(&projected) else {
        return; // Degenerate: fewer than two vertices, or all coincide.
    };
    let spacing_px = spacing_px as f64;
    let (mid, _) = path.sample(path.length() * 0.5);
    let finest = spacing_px * FINEST_METERS_PER_PX / mercator_lat(mid.1).to_radians().cos();
    // Only text bends its glyphs along the line; a sprite is one quad at the
    // anchor and needs nothing but the tangent bearing.
    let wants_path = kind == GeometryAppearanceKind::Text;

    for a in path.anchors(placement, finest, wants_path) {
        let (pos, tangent) = path.sample(a.s);
        let lat = mercator_lat(pos.1);
        let (seg, t) = path.segment_at(a.s);
        let z0 = coords(&line[seg]).z;
        let z = z0 + (coords(&line[seg + 1]).z - z0) * t;
        let anchor = Vec3::new(wrap_lon((pos.0 / MERCATOR_RADIUS_M).to_degrees()), lat, z);
        let meters_per_unit = lat.to_radians().cos();
        let along = AlongLine {
            bearing: tangent_to_bearing(tangent),
            scale_band: a.scale_band(meters_per_unit, spacing_px),
            path: wants_path.then(|| path.anchor_path(a.s, a.path_spacing, meters_per_unit)),
        };
        builder.add_line_anchor(kind, anchor, height, along);
    }
}

/// Accumulate polyline geometry into the builder.
///
/// `geometry_types` opts the polyline appearance into deriving a closed
/// polyline per polygon ring (outer ring and holes).
fn accumulate_polyline(
    builder: &mut GeometryBuilder,
    geometry: &Geometry,
    geometry_types: &[SourceGeometryType],
) {
    match &geometry.value {
        GeometryValue::LineString { coordinates: f }
            if geometry_types.contains(&SourceGeometryType::Line) =>
        {
            builder.add_polyline(multi_flat_coords(f), CRS::Geographic, false);
        }
        GeometryValue::MultiLineString { coordinates: fs }
            if geometry_types.contains(&SourceGeometryType::Line) =>
        {
            for f in fs {
                builder.add_polyline(multi_flat_coords(f), CRS::Geographic, false);
            }
        }
        GeometryValue::Polygon { coordinates: rings }
            if geometry_types.contains(&SourceGeometryType::Polygon) =>
        {
            for ring in rings {
                builder.add_polyline(closed_ring_coords(ring), CRS::Geographic, true);
            }
        }
        GeometryValue::MultiPolygon { coordinates: fs }
            if geometry_types.contains(&SourceGeometryType::Polygon) =>
        {
            for rings in fs {
                for ring in rings {
                    builder.add_polyline(closed_ring_coords(ring), CRS::Geographic, true);
                }
            }
        }
        _ => {}
    }
}

/// Accumulate polygon geometry into the builder.
fn accumulate_polygon(builder: &mut GeometryBuilder, geometry: &Geometry) {
    let accumulate_one = |builder: &mut GeometryBuilder, f: &[Vec<Position>]| {
        let outer_ring = f.first().map_or_else(Vec::new, |v| multi_flat_coords(v));
        let holes = get_polygon_holes(f).unwrap_or_default();
        builder.add_polygon(outer_ring, &holes, WindingOrder::Unknown, CRS::Geographic);
    };

    match &geometry.value {
        GeometryValue::Polygon { coordinates: f } => {
            accumulate_one(builder, f);
        }
        GeometryValue::MultiPolygon { coordinates: fs } => {
            for f in fs {
                accumulate_one(builder, f);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use bevy_app::{App, Update};
    use bevy_ecs::prelude::Resource;
    use bevy_ecs::query::With;
    use bevy_ecs::system::{Commands, ResMut};
    use navara_buffer_store::BufferStore;
    use navara_feature_component::{
        batch::{BatchTable, BatchedFeature, FeatureBatchId, GlobalBatchIds},
        batched_geometry::{BatchedPointGeometry, BatchedPolygonGeometry, BatchedPolylineGeometry},
        billboard::BillboardMarker,
        point::PointMarker,
        polygon::PolygonMarker,
        polyline::PolylineMarker,
        text::TextMarker,
    };
    use navara_material::{
        Appearance, BillboardMaterial, PointMaterial, PolygonMaterial, PolylineMaterial,
        TextMaterial,
    };
    use navara_parser::geojson::GeoJson;
    use navara_parser::line_placement::{PATH_META_STRIDE, PATH_SAMPLES};

    #[derive(Resource)]
    struct TestInput {
        geojson: GeoJson,
        appearances: Vec<Appearance>,
    }

    fn test_construct_system(
        mut commands: Commands,
        mut batch_table: ResMut<BatchTable>,
        mut buf: ResMut<BufferStore>,
        input: bevy_ecs::system::Res<TestInput>,
    ) {
        construct_geometry(
            &mut commands,
            &mut batch_table,
            &mut buf,
            &input.geojson,
            &input.appearances,
            "test_layer",
        );
    }

    fn run_construct(json: &str, appearances: Vec<Appearance>) -> App {
        let mut app = App::new();
        app.init_resource::<BufferStore>();
        app.init_resource::<BatchTable>();

        let geojson: GeoJson = json.parse().unwrap();
        app.insert_resource(TestInput {
            geojson,
            appearances,
        });
        app.add_systems(Update, test_construct_system);
        app.update();
        app
    }

    // --- Helper function tests ---

    #[test]
    fn coords_2d_defaults_z_to_zero() {
        let result = coords(&Position::from([139.75, 35.68]));
        assert_eq!(result.x, 139.75);
        assert_eq!(result.y, 35.68);
        assert_eq!(result.z, 0.0);
    }

    #[test]
    fn coords_3d_preserves_elevation() {
        let result = coords(&Position::from([139.75, 35.68, 100.5]));
        assert_eq!(result.x, 139.75);
        assert_eq!(result.y, 35.68);
        assert_eq!(result.z, 100.5);
    }

    #[test]
    fn multi_flat_coords_flattens_with_default_z() {
        let input = vec![Position::from([1.0, 2.0]), Position::from([3.0, 4.0])];
        let result = multi_flat_coords(&input);
        assert_eq!(result, vec![1.0, 2.0, 0.0, 3.0, 4.0, 0.0]);
    }

    #[test]
    fn multi_flat_coords_flattens_with_z() {
        let input = vec![
            Position::from([1.0, 2.0, 10.0]),
            Position::from([3.0, 4.0, 20.0]),
        ];
        let result = multi_flat_coords(&input);
        assert_eq!(result, vec![1.0, 2.0, 10.0, 3.0, 4.0, 20.0]);
    }

    #[test]
    fn get_polygon_holes_returns_none_for_single_ring() {
        let rings = vec![vec![
            Position::from([0.0, 0.0]),
            Position::from([1.0, 0.0]),
            Position::from([1.0, 1.0]),
            Position::from([0.0, 0.0]),
        ]];
        assert!(get_polygon_holes(&rings).is_none());
    }

    #[test]
    fn get_polygon_holes_returns_holes() {
        let rings = vec![
            vec![
                Position::from([0.0, 0.0]),
                Position::from([10.0, 0.0]),
                Position::from([10.0, 10.0]),
                Position::from([0.0, 0.0]),
            ],
            vec![
                Position::from([2.0, 2.0]),
                Position::from([4.0, 2.0]),
                Position::from([4.0, 4.0]),
                Position::from([2.0, 2.0]),
            ],
        ];
        let holes = get_polygon_holes(&rings).unwrap();
        assert_eq!(holes.len(), 1);
        assert_eq!(
            holes[0].outer_ring,
            vec![2.0, 2.0, 0.0, 4.0, 2.0, 0.0, 4.0, 4.0, 0.0, 2.0, 2.0, 0.0]
        );
    }

    // --- construct_geometry tests ---

    #[test]
    fn it_should_create_batched_feature_for_point() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": "Tokyo"},
            "geometry": {
                "coordinates": [139.75227193360223, 35.68520091767046],
                "type": "Point"
            }
        },
        {
            "type": "Feature",
            "properties": {"name": "Shinjuku"},
            "geometry": {
                "coordinates": [139.77250531915263, 35.71562661633277],
                "type": "Point"
            }
        }
    ]
}"#,
            vec![Appearance::Point(PointMaterial::default())],
        );

        // Should have 1 BatchedFeature parent with PointMarker
        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PointMarker>>();
        let batched_features: Vec<_> = batched_query.iter(app.world()).collect();
        assert_eq!(batched_features.len(), 1);

        // Should have BatchedPointGeometry on the parent with 2 coords
        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<PointMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        assert_eq!(geoms[0].coords.len(), 2);

        // Verify GlobalBatchIds
        let mut global_ids_query = app
            .world_mut()
            .query_filtered::<&GlobalBatchIds, With<PointMarker>>();
        let global_ids: Vec<_> = global_ids_query.iter(app.world()).collect();
        assert_eq!(global_ids.len(), 1);
        assert_eq!(global_ids[0].batch_length, 2);
    }

    #[test]
    fn it_should_create_batched_feature_for_multipoint() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [
                    [139.75227193360223, 35.68520091767046],
                    [139.77250531915263, 35.71562661633277]
                ],
                "type": "MultiPoint"
            }
        }
    ]
}"#,
            vec![Appearance::Point(PointMaterial::default())],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PointMarker>>();
        let batched_features: Vec<_> = batched_query.iter(app.world()).collect();
        assert_eq!(batched_features.len(), 1);

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<PointMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        assert_eq!(geoms[0].coords.len(), 2);
    }

    #[test]
    fn it_should_create_batched_feature_for_billboard() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [139.75, 35.68],
                "type": "Point"
            }
        },
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [139.77, 35.71],
                "type": "Point"
            }
        }
    ]
}"#,
            vec![Appearance::Billboard(BillboardMaterial::default())],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<BillboardMarker>>();
        let batched_features: Vec<_> = batched_query.iter(app.world()).collect();
        assert_eq!(batched_features.len(), 1);

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<BillboardMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        assert_eq!(geoms[0].coords.len(), 2);
    }

    #[test]
    fn it_should_create_batched_feature_for_text() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [139.75, 35.68],
                "type": "Point"
            }
        }
    ]
}"#,
            vec![Appearance::Text(TextMaterial::default())],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<TextMarker>>();
        let batched_features: Vec<_> = batched_query.iter(app.world()).collect();
        assert_eq!(batched_features.len(), 1);

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<TextMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        assert_eq!(geoms[0].coords.len(), 1);
    }

    #[test]
    fn it_should_create_batched_feature_for_linestring() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [
                    [139.75, 35.68],
                    [139.76, 35.69],
                    [139.77, 35.70]
                ],
                "type": "LineString"
            }
        },
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [
                    [139.78, 35.71],
                    [139.79, 35.72]
                ],
                "type": "LineString"
            }
        }
    ]
}"#,
            vec![Appearance::Polyline(PolylineMaterial {
                clamp_to_ground: false,
                tiled: false,
                ..Default::default()
            })],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PolylineMarker>>();
        let batched_features: Vec<_> = batched_query.iter(app.world()).collect();
        assert_eq!(batched_features.len(), 1);

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geoms[0].feature_count(buf), 2);
    }

    #[test]
    fn it_should_create_batched_feature_for_multilinestring() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [
                    [[139.75, 35.68], [139.76, 35.69]],
                    [[139.77, 35.70], [139.78, 35.71]]
                ],
                "type": "MultiLineString"
            }
        }
    ]
}"#,
            vec![Appearance::Polyline(PolylineMaterial {
                clamp_to_ground: false,
                tiled: false,
                ..Default::default()
            })],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PolylineMarker>>();
        let batched_features: Vec<_> = batched_query.iter(app.world()).collect();
        assert_eq!(batched_features.len(), 1);

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geoms[0].feature_count(buf), 2);
    }

    #[test]
    fn it_should_create_batched_feature_for_polygon() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [
                    [
                        [139.75, 35.68],
                        [139.76, 35.68],
                        [139.76, 35.69],
                        [139.75, 35.69],
                        [139.75, 35.68]
                    ]
                ],
                "type": "Polygon"
            }
        }
    ]
}"#,
            vec![Appearance::Polygon(PolygonMaterial {
                clamp_to_ground: false,
                tiled: false,
                ..Default::default()
            })],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PolygonMarker>>();
        let batched_features: Vec<_> = batched_query.iter(app.world()).collect();
        assert_eq!(batched_features.len(), 1);

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPolygonGeometry, With<PolygonMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geoms[0].feature_count(buf), 1);
    }

    #[test]
    fn it_should_create_batched_feature_for_multipolygon() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [
                    [
                        [
                            [139.75, 35.68],
                            [139.76, 35.68],
                            [139.76, 35.69],
                            [139.75, 35.69],
                            [139.75, 35.68]
                        ]
                    ],
                    [
                        [
                            [139.77, 35.70],
                            [139.78, 35.70],
                            [139.78, 35.71],
                            [139.77, 35.71],
                            [139.77, 35.70]
                        ]
                    ]
                ],
                "type": "MultiPolygon"
            }
        }
    ]
}"#,
            vec![Appearance::Polygon(PolygonMaterial {
                clamp_to_ground: false,
                tiled: false,
                ..Default::default()
            })],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PolygonMarker>>();
        let batched_features: Vec<_> = batched_query.iter(app.world()).collect();
        assert_eq!(batched_features.len(), 1);

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPolygonGeometry, With<PolygonMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geoms[0].feature_count(buf), 2);
    }

    #[test]
    fn it_should_handle_single_feature_geojson() {
        let mut app = run_construct(
            r#"{
    "type": "Feature",
    "properties": {"name": "single"},
    "geometry": {
        "coordinates": [139.75, 35.68],
        "type": "Point"
    }
}"#,
            vec![Appearance::Point(PointMaterial::default())],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PointMarker>>();
        let batched_features: Vec<_> = batched_query.iter(app.world()).collect();
        assert_eq!(batched_features.len(), 1);

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<PointMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        assert_eq!(geoms[0].coords.len(), 1);
    }

    #[test]
    fn it_should_handle_geometry_only_geojson() {
        let mut app = run_construct(
            r#"{
    "coordinates": [139.75, 35.68],
    "type": "Point"
}"#,
            vec![Appearance::Point(PointMaterial::default())],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PointMarker>>();
        let batched_features: Vec<_> = batched_query.iter(app.world()).collect();
        assert_eq!(batched_features.len(), 1);

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<PointMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        assert_eq!(geoms[0].coords.len(), 1);
    }

    #[test]
    fn it_should_create_separate_batched_features_for_mixed_geometry() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [139.75, 35.68],
                "type": "Point"
            }
        },
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [[139.75, 35.68], [139.76, 35.69]],
                "type": "LineString"
            }
        }
    ]
}"#,
            vec![
                Appearance::Point(PointMaterial::default()),
                Appearance::Polyline(PolylineMaterial {
                    clamp_to_ground: false,
                    tiled: false,
                    ..Default::default()
                }),
            ],
        );

        let mut point_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PointMarker>>();
        assert_eq!(point_query.iter(app.world()).count(), 1);

        let mut polyline_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PolylineMarker>>();
        assert_eq!(polyline_query.iter(app.world()).count(), 1);
    }

    #[test]
    fn it_should_handle_polygon_with_holes() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [
                    [
                        [139.75, 35.68],
                        [139.78, 35.68],
                        [139.78, 35.71],
                        [139.75, 35.71],
                        [139.75, 35.68]
                    ],
                    [
                        [139.76, 35.69],
                        [139.77, 35.69],
                        [139.77, 35.70],
                        [139.76, 35.70],
                        [139.76, 35.69]
                    ]
                ],
                "type": "Polygon"
            }
        }
    ]
}"#,
            vec![Appearance::Polygon(PolygonMaterial {
                clamp_to_ground: false,
                tiled: false,
                ..Default::default()
            })],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PolygonMarker>>();
        let batched_features: Vec<_> = batched_query.iter(app.world()).collect();
        assert_eq!(batched_features.len(), 1);

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPolygonGeometry, With<PolygonMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geoms[0].feature_count(buf), 1);
        assert_eq!(geoms[0].holes_boundaries(buf).unwrap()[0], 1);
    }

    #[test]
    fn it_should_not_create_batched_feature_for_mismatched_appearance() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [139.75, 35.68],
                "type": "Point"
            }
        }
    ]
}"#,
            vec![Appearance::Polyline(PolylineMaterial {
                clamp_to_ground: false,
                tiled: false,
                ..Default::default()
            })],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PolylineMarker>>();
        assert_eq!(batched_query.iter(app.world()).count(), 0);
    }

    #[derive(Resource, Default)]
    struct TestOutput(Vec<Entity>);

    fn test_construct_with_output_system(
        mut commands: Commands,
        mut batch_table: ResMut<BatchTable>,
        mut buf: ResMut<BufferStore>,
        input: bevy_ecs::system::Res<TestInput>,
        mut out: ResMut<TestOutput>,
    ) {
        out.0 = construct_geometry(
            &mut commands,
            &mut batch_table,
            &mut buf,
            &input.geojson,
            &input.appearances,
            "test_layer",
        );
    }

    #[test]
    fn it_should_return_spawned_parent_entities() {
        let mut app = App::new();
        app.init_resource::<BufferStore>();
        app.init_resource::<BatchTable>();
        app.init_resource::<TestOutput>();

        let geojson: GeoJson = r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": { "coordinates": [139.75, 35.68], "type": "Point" }
        },
        {
            "type": "Feature",
            "properties": {},
            "geometry": { "coordinates": [139.75, 35.68], "type": "Point" }
        },
        {
            "type": "Feature",
            "properties": {},
            "geometry": { "coordinates": [139.75, 35.68], "type": "Point" }
        }
    ]
}"#
        .parse()
        .unwrap();
        app.insert_resource(TestInput {
            geojson,
            appearances: vec![Appearance::Point(PointMaterial::default())],
        });
        app.add_systems(Update, test_construct_with_output_system);
        app.update();

        let output = app.world().resource::<TestOutput>();
        assert_eq!(output.0.len(), 1);
    }

    const MIXED_LINE_AND_POLYGON: &str = r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"type": "line"},
            "geometry": {
                "coordinates": [[139.70, 35.60], [139.71, 35.61], [139.72, 35.62]],
                "type": "LineString"
            }
        },
        {
            "type": "Feature",
            "properties": {"type": "polygon"},
            "geometry": {
                "coordinates": [
                    [
                        [139.75, 35.68],
                        [139.76, 35.68],
                        [139.76, 35.69],
                        [139.75, 35.69],
                        [139.75, 35.68]
                    ]
                ],
                "type": "Polygon"
            }
        }
    ]
}"#;

    #[test]
    fn polyline_geometry_types_polygon_derives_boundary_rings() {
        // With geometry_types opted into polygons, both the line and the
        // polygon boundary accumulate into the polyline batch.
        let mut app = run_construct(
            MIXED_LINE_AND_POLYGON,
            vec![Appearance::Polyline(PolylineMaterial {
                clamp_to_ground: false,
                tiled: false,
                geometry_types: vec![SourceGeometryType::Line, SourceGeometryType::Polygon],
                ..Default::default()
            })],
        );

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        // 1 line string + 1 polygon outer ring
        assert_eq!(geoms[0].feature_count(buf), 2);
        // Two distinct features → two batch indices
        assert_eq!(geoms[0].batch_indices(buf).unwrap(), &[0, 1]);
    }

    #[test]
    fn polyline_default_geometry_types_ignores_polygons() {
        let mut app = run_construct(
            MIXED_LINE_AND_POLYGON,
            vec![Appearance::Polyline(PolylineMaterial {
                clamp_to_ground: false,
                tiled: false,
                ..Default::default()
            })],
        );

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        // Only the line string accumulates by default.
        assert_eq!(geoms[0].feature_count(buf), 1);
    }

    #[test]
    fn polygon_with_holes_derives_polyline_per_ring() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "coordinates": [
                    [
                        [139.75, 35.68],
                        [139.78, 35.68],
                        [139.78, 35.71],
                        [139.75, 35.71],
                        [139.75, 35.68]
                    ],
                    [
                        [139.76, 35.69],
                        [139.77, 35.69],
                        [139.77, 35.70],
                        [139.76, 35.70],
                        [139.76, 35.69]
                    ]
                ],
                "type": "Polygon"
            }
        }
    ]
}"#,
            vec![Appearance::Polyline(PolylineMaterial {
                clamp_to_ground: false,
                tiled: false,
                geometry_types: vec![SourceGeometryType::Line, SourceGeometryType::Polygon],
                ..Default::default()
            })],
        );

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        // Outer ring + hole ring, both from the same feature.
        assert_eq!(geoms[0].feature_count(buf), 2);
        assert_eq!(geoms[0].batch_indices(buf).unwrap(), &[0, 0]);
    }

    #[test]
    fn open_polygon_ring_derives_closed_boundary_polyline() {
        // The source ring omits the closing duplicate; the derived boundary
        // must still be closed, matching the tiled paths.
        let mut app = run_construct(
            r#"{
    "type": "Feature",
    "properties": {},
    "geometry": {
        "coordinates": [
            [
                [139.75, 35.68],
                [139.76, 35.68],
                [139.76, 35.69],
                [139.75, 35.69]
            ]
        ],
        "type": "Polygon"
    }
}"#,
            vec![Appearance::Polyline(PolylineMaterial {
                clamp_to_ground: false,
                tiled: false,
                geometry_types: vec![SourceGeometryType::Line, SourceGeometryType::Polygon],
                ..Default::default()
            })],
        );

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        let points = geoms[0].points(buf).unwrap();
        // 4 source vertices + appended closing duplicate = 5 * 3 coords.
        assert_eq!(points.len(), 15);
        assert_eq!(points[..3], points[points.len() - 3..]);
    }

    #[test]
    fn point_geometry_types_derives_vertices_without_closing_duplicate() {
        // LineString has 3 vertices; the polygon ring has 5 positions with a
        // closing duplicate, contributing 4.
        let mut app = run_construct(
            MIXED_LINE_AND_POLYGON,
            vec![Appearance::Point(PointMaterial {
                geometry_types: vec![
                    SourceGeometryType::Point,
                    SourceGeometryType::Line,
                    SourceGeometryType::Polygon,
                ],
                ..Default::default()
            })],
        );

        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<PointMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        assert_eq!(geoms[0].coords.len(), 7);
    }

    #[test]
    fn point_default_geometry_types_ignores_lines_and_polygons() {
        let mut app = run_construct(
            MIXED_LINE_AND_POLYGON,
            vec![Appearance::Point(PointMaterial::default())],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PointMarker>>();
        assert_eq!(batched_query.iter(app.world()).count(), 0);
    }

    #[test]
    fn point_geometry_types_can_opt_out_of_native_points() {
        // geometry_types replaces the default: with only Line, a point
        // geometry no longer emits.
        let mut app = run_construct(
            r#"{
    "type": "Feature",
    "properties": {},
    "geometry": { "coordinates": [139.75, 35.68], "type": "Point" }
}"#,
            vec![Appearance::Point(PointMaterial {
                geometry_types: vec![SourceGeometryType::Line],
                ..Default::default()
            })],
        );

        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PointMarker>>();
        assert_eq!(batched_query.iter(app.world()).count(), 0);
    }

    #[test]
    fn it_should_handle_geometry_collection() {
        // GeometryCollection containing a Point and a LineString
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": "collection"},
            "geometry": {
                "type": "GeometryCollection",
                "geometries": [
                    {
                        "type": "Point",
                        "coordinates": [139.75, 35.68]
                    },
                    {
                        "type": "LineString",
                        "coordinates": [[139.75, 35.68], [139.76, 35.69]]
                    },
                    {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [139.75, 35.68],
                                [139.76, 35.68],
                                [139.76, 35.69],
                                [139.75, 35.69],
                                [139.75, 35.68]
                            ]
                        ]
                    }
                ]
            }
        }
    ]
}"#,
            vec![
                Appearance::Point(PointMaterial::default()),
                Appearance::Polyline(PolylineMaterial {
                    clamp_to_ground: false,
                    tiled: false,
                    ..Default::default()
                }),
                Appearance::Polygon(PolygonMaterial {
                    clamp_to_ground: false,
                    tiled: false,
                    ..Default::default()
                }),
            ],
        );

        // Point from GeometryCollection - no child entities, coords on parent
        let mut point_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PointMarker>>();
        let points: Vec<_> = point_query.iter(app.world()).collect();
        assert_eq!(points.len(), 1);

        let mut point_geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<PointMarker>>();
        let point_geoms: Vec<_> = point_geom_query.iter(app.world()).collect();
        assert_eq!(point_geoms.len(), 1);
        assert_eq!(point_geoms[0].coords.len(), 1);

        // LineString from GeometryCollection
        let mut polyline_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PolylineMarker>>();
        let polylines: Vec<_> = polyline_query.iter(app.world()).collect();
        assert_eq!(polylines.len(), 1);

        let mut polyline_geom = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let polyline_geoms: Vec<_> = polyline_geom.iter(app.world()).collect();
        assert_eq!(polyline_geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(polyline_geoms[0].feature_count(buf), 1);

        // Polygon from GeometryCollection
        let mut polygon_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PolygonMarker>>();
        let polygons: Vec<_> = polygon_query.iter(app.world()).collect();
        assert_eq!(polygons.len(), 1);

        let mut polygon_geom = app
            .world_mut()
            .query_filtered::<&BatchedPolygonGeometry, With<PolygonMarker>>();
        let polygon_geoms: Vec<_> = polygon_geom.iter(app.world()).collect();
        assert_eq!(polygon_geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(polygon_geoms[0].feature_count(buf), 1);
    }

    #[test]
    fn geometry_collection_sub_geometries_share_single_feature() {
        // A GeometryCollection with two Points inside a single Feature should
        // produce two child entities that share the same batch index (one feature).
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": "collection"},
            "geometry": {
                "type": "GeometryCollection",
                "geometries": [
                    {
                        "type": "Point",
                        "coordinates": [139.75, 35.68]
                    },
                    {
                        "type": "Point",
                        "coordinates": [139.76, 35.69]
                    }
                ]
            }
        }
    ]
}"#,
            vec![Appearance::Point(PointMaterial::default())],
        );

        // Both points come from one feature → one BatchedFeature parent with coords on parent
        let mut batched_query = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PointMarker>>();
        let batched: Vec<_> = batched_query.iter(app.world()).collect();
        assert_eq!(batched.len(), 1);

        // Both points accumulated into BatchedPointGeometry on parent
        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<PointMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms.len(), 1);
        assert_eq!(geoms[0].coords.len(), 2);

        // Properties should be stored once (not duplicated per sub-geometry)
        let mut batch_id_query = app
            .world_mut()
            .query_filtered::<&FeatureBatchId, With<PointMarker>>();
        let feature_batch_id = batch_id_query.iter(app.world()).next().unwrap().0;
        let batch_table = app.world().resource::<BatchTable>();
        let batch_value = batch_table.get(&feature_batch_id).unwrap();
        let properties = batch_value.properties.as_ref().unwrap();
        match properties {
            navara_feature_component::batch::BatchProperty::Values(values) => {
                assert_eq!(values.len(), 1); // one feature, not two
                assert_eq!(values[0], serde_json::json!({"name": "collection"}));
            }
            _ => panic!("Expected BatchProperty::Values"),
        }
    }

    #[test]
    fn it_should_handle_all_geometry_types_with_all_appearances() {
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"type": "point"},
            "geometry": {
                "coordinates": [139.75, 35.68],
                "type": "Point"
            }
        },
        {
            "type": "Feature",
            "properties": {"type": "multipoint"},
            "geometry": {
                "coordinates": [[139.76, 35.69], [139.77, 35.70]],
                "type": "MultiPoint"
            }
        },
        {
            "type": "Feature",
            "properties": {"type": "linestring"},
            "geometry": {
                "coordinates": [[139.75, 35.68], [139.76, 35.69], [139.77, 35.70]],
                "type": "LineString"
            }
        },
        {
            "type": "Feature",
            "properties": {"type": "multilinestring"},
            "geometry": {
                "coordinates": [
                    [[139.75, 35.68], [139.76, 35.69]],
                    [[139.77, 35.70], [139.78, 35.71]]
                ],
                "type": "MultiLineString"
            }
        },
        {
            "type": "Feature",
            "properties": {"type": "polygon"},
            "geometry": {
                "coordinates": [
                    [
                        [139.75, 35.68],
                        [139.76, 35.68],
                        [139.76, 35.69],
                        [139.75, 35.69],
                        [139.75, 35.68]
                    ]
                ],
                "type": "Polygon"
            }
        },
        {
            "type": "Feature",
            "properties": {"type": "multipolygon"},
            "geometry": {
                "coordinates": [
                    [
                        [
                            [139.80, 35.72],
                            [139.81, 35.72],
                            [139.81, 35.73],
                            [139.80, 35.73],
                            [139.80, 35.72]
                        ]
                    ],
                    [
                        [
                            [139.82, 35.74],
                            [139.83, 35.74],
                            [139.83, 35.75],
                            [139.82, 35.75],
                            [139.82, 35.74]
                        ]
                    ]
                ],
                "type": "MultiPolygon"
            }
        }
    ]
}"#,
            vec![
                Appearance::Point(PointMaterial::default()),
                Appearance::Billboard(BillboardMaterial::default()),
                Appearance::Text(TextMaterial::default()),
                Appearance::Polyline(PolylineMaterial {
                    clamp_to_ground: false,
                    tiled: false,
                    ..Default::default()
                }),
                Appearance::Polygon(PolygonMaterial {
                    clamp_to_ground: false,
                    tiled: false,
                    ..Default::default()
                }),
            ],
        );

        // Point/MultiPoint features match Point, Billboard, and Text appearances.
        // Point: 1 (Point) + 2 (MultiPoint) = 3 coords on parent
        let mut point_batched = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PointMarker>>();
        let point_features: Vec<_> = point_batched.iter(app.world()).collect();
        assert_eq!(point_features.len(), 1);

        let mut point_geom = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<PointMarker>>();
        let point_geoms: Vec<_> = point_geom.iter(app.world()).collect();
        assert_eq!(point_geoms.len(), 1);
        assert_eq!(point_geoms[0].coords.len(), 3);

        // Billboard: same 3 coords from Point/MultiPoint
        let mut billboard_batched = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<BillboardMarker>>();
        let billboard_features: Vec<_> = billboard_batched.iter(app.world()).collect();
        assert_eq!(billboard_features.len(), 1);

        let mut billboard_geom = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<BillboardMarker>>();
        let billboard_geoms: Vec<_> = billboard_geom.iter(app.world()).collect();
        assert_eq!(billboard_geoms.len(), 1);
        assert_eq!(billboard_geoms[0].coords.len(), 3);

        // Text: same 3 coords from Point/MultiPoint
        let mut text_batched = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<TextMarker>>();
        let text_features: Vec<_> = text_batched.iter(app.world()).collect();
        assert_eq!(text_features.len(), 1);

        let mut text_geom = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<TextMarker>>();
        let text_geoms: Vec<_> = text_geom.iter(app.world()).collect();
        assert_eq!(text_geoms.len(), 1);
        assert_eq!(text_geoms[0].coords.len(), 3);

        // Polyline: 1 (LineString) + 2 (MultiLineString) = 3 accumulated
        let mut polyline_batched = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PolylineMarker>>();
        let polyline_features: Vec<_> = polyline_batched.iter(app.world()).collect();
        assert_eq!(polyline_features.len(), 1);

        let mut polyline_geom = app
            .world_mut()
            .query_filtered::<&BatchedPolylineGeometry, With<PolylineMarker>>();
        let polyline_geoms: Vec<_> = polyline_geom.iter(app.world()).collect();
        assert_eq!(polyline_geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(polyline_geoms[0].feature_count(buf), 3);

        // Polygon: 1 (Polygon) + 2 (MultiPolygon) = 3 accumulated
        let mut polygon_batched = app
            .world_mut()
            .query_filtered::<&BatchedFeature, With<PolygonMarker>>();
        let polygon_features: Vec<_> = polygon_batched.iter(app.world()).collect();
        assert_eq!(polygon_features.len(), 1);

        let mut polygon_geom = app
            .world_mut()
            .query_filtered::<&BatchedPolygonGeometry, With<PolygonMarker>>();
        let polygon_geoms: Vec<_> = polygon_geom.iter(app.world()).collect();
        assert_eq!(polygon_geoms.len(), 1);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(polygon_geoms[0].feature_count(buf), 3);
    }

    #[test]
    fn it_should_have_separate_feature_batch_id_per_appearance() {
        // A Point feature with Point + Billboard + Text appearances gets separate
        // feature_batch_ids per kind, with properties duplicated into each batch.
        let mut app = run_construct(
            r#"{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": "shared"},
            "geometry": {
                "coordinates": [139.75, 35.68],
                "type": "Point"
            }
        }
    ]
}"#,
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

        // Each batch has its own copy of the properties
        let batch_table = app.world().resource::<BatchTable>();
        for batch_id in [point_batch_id, billboard_batch_id, text_batch_id] {
            let batch_value = batch_table.get(&batch_id).unwrap();
            let properties = batch_value.properties.as_ref().unwrap();
            match properties {
                navara_feature_component::batch::BatchProperty::Values(values) => {
                    assert_eq!(values.len(), 1);
                    assert_eq!(values[0], serde_json::json!({"name": "shared"}));
                }
                _ => panic!("Expected BatchProperty::Values"),
            }
        }
    }

    // --- Along-line placement ---

    #[test]
    fn a_line_crossing_the_antimeridian_takes_the_short_way() {
        // 179 E to 179 W is a 2 deg hop across the seam, not 358 deg the long
        // way round. At a 50 km finest level that is a handful of anchors, all
        // within a degree of the seam and heading east — not thousands spread
        // over the globe heading west.
        let acc = line_anchors(
            &[[179.0, 0.0, 0.0], [-179.0, 0.0, 0.0]],
            GeometryAppearanceKind::Point,
            PointPlacement::Line,
            50_000.0,
        );
        assert!(
            !acc.coords.is_empty() && acc.coords.len() < 10,
            "{} anchors",
            acc.coords.len()
        );
        for (c, &b) in acc.coords.iter().zip(&acc.bearings) {
            assert!(c.x.abs() > 178.9 && c.x.abs() <= 180.0, "lon {}", c.x);
            assert!((b - 90.0).abs() < 1e-3, "bearing {b}");
        }
    }

    #[test]
    fn native_points_and_line_anchors_share_a_group_aligned() {
        // `geometryTypes: ["point", "line"]` with along-line text: a point
        // feature, then a line, then another point, all into one text group.
        // Every per-anchor buffer has to stay one entry per point, or the
        // renderer reads a neighbour's path and bearing (or past the end).
        use navara_feature_component::geometry_builder::AccumulatedGeometry;
        use navara_parser::line_placement::{
            ALWAYS_SHOWN, PATH_META_STRIDE, PATH_SAMPLES, SCALE_BAND_STRIDE,
        };
        let kind = GeometryAppearanceKind::Text;
        let mut batch_table = BatchTable::default();
        let mut builder = GeometryBuilder::new(&mut batch_table, "l");
        builder.begin_feature(&None);
        builder.add_point(kind, Vec3::new(1.0, 1.0, 0.0), CRS::Geographic, 0.0);
        let line: Vec<Position> = [[0.0, 0.0, 0.0], [0.01, 0.0, 0.0]]
            .iter()
            .map(|p| Position::from(*p))
            .collect();
        add_line_anchors(&mut builder, &line, kind, 0.0, PointPlacement::Line, 250.0);
        builder.add_point(kind, Vec3::new(2.0, 2.0, 0.0), CRS::Geographic, 0.0);

        let acc = match builder.groups.groups.pop().map(|g| g.accumulated) {
            Some(AccumulatedGeometry::Points(acc)) => acc,
            _ => panic!("expected points"),
        };
        let n = acc.coords.len();
        assert!(n >= 3, "{n} points");
        assert_eq!(acc.bearings.len(), n);
        assert_eq!(acc.scale_bands.len(), n * SCALE_BAND_STRIDE);
        assert_eq!(acc.path_samples.len(), n * PATH_SAMPLES * 2);
        assert_eq!(acc.path_meta.len(), n * PATH_META_STRIDE);
        // The native points are marked by a zero step; the anchors are not.
        let step = |i: usize| acc.path_meta[i * PATH_META_STRIDE];
        assert_eq!(step(0), 0.0);
        assert_eq!(step(n - 1), 0.0);
        assert!((1..n - 1).all(|i| step(i) > 0.0));
        assert_eq!((acc.bearings[0], acc.bearings[n - 1]), (0.0, 0.0));
        // And shown at every scale, like any plain point.
        assert_eq!(acc.scale_bands[..SCALE_BAND_STRIDE], ALWAYS_SHOWN);
        assert_eq!(acc.scale_bands[(n - 1) * SCALE_BAND_STRIDE..], ALWAYS_SHOWN);
    }

    /// Run [`add_line_anchors`] over one line and return the resulting points,
    /// with the spacing chosen so the finest level repeats every `finest_m`
    /// metres.
    fn line_anchors(
        line: &[[f64; 3]],
        kind: GeometryAppearanceKind,
        placement: PointPlacement,
        finest_m: f64,
    ) -> navara_feature_component::batched_geometry::PointGeometryAccumulator {
        let spacing_px = (finest_m / FINEST_METERS_PER_PX) as f32;
        use navara_feature_component::geometry_builder::AccumulatedGeometry;
        let line: Vec<Position> = line.iter().map(|p| Position::from(*p)).collect();
        let mut batch_table = BatchTable::default();
        let mut builder = GeometryBuilder::new(&mut batch_table, "l");
        builder.begin_feature(&None);
        add_line_anchors(&mut builder, &line, kind, 0.0, placement, spacing_px);
        match builder.groups.groups.pop().map(|g| g.accumulated) {
            Some(AccumulatedGeometry::Points(acc)) => acc,
            _ => panic!("expected points"),
        }
    }

    /// Ground metres per degree of longitude on the Web Mercator sphere.
    const M_PER_DEG: f64 = MERCATOR_RADIUS_M * std::f64::consts::PI / 180.0;

    #[test]
    fn line_placement_sizes_levels_in_ground_metres() {
        // 1000 m of line due east. The finest level is a ground distance, so
        // the count must not depend on latitude even though a degree of
        // longitude covers half the ground at 60°N.
        for lat in [0.0, 60.0] {
            let deg = 1000.0 / (M_PER_DEG * f64::to_radians(lat).cos());
            let acc = line_anchors(
                &[[0.0, lat, 0.0], [deg, lat, 0.0]],
                GeometryAppearanceKind::Billboard,
                PointPlacement::Line,
                100.0,
            );
            // Centred on the line: 100, 200, ... 900 m.
            assert_eq!(acc.coords.len(), 9, "at {lat}°");
            let first_m = acc.coords[0].x * M_PER_DEG * f64::to_radians(lat).cos();
            assert!((first_m - 100.0).abs() < 0.5, "first anchor at {first_m} m");
            assert!((acc.coords[0].y - lat).abs() < 1e-9);
            // The 200 m anchor is finest-level only: shown up to the closest
            // view the levels are sized for, wherever on the globe.
            let max = acc.scale_bands[3] as f64;
            assert!(
                (max - FINEST_METERS_PER_PX).abs() < 1e-4,
                "at {lat}°: {max}"
            );
        }
    }

    #[test]
    fn line_placement_reaches_past_the_tile_latitude_limit() {
        // Web tiles stop at ±85.05°, but a GeoJSON line is drawn to the pole.
        let along = line_anchors(
            &[[0.0, 89.0, 0.0], [1.0, 89.0, 0.0]],
            GeometryAppearanceKind::Billboard,
            PointPlacement::LineCenter,
            100.0,
        );
        assert!(
            (along.coords[0].y - 89.0).abs() < 1e-9,
            "{}",
            along.coords[0].y
        );

        let up = line_anchors(
            &[[0.0, 86.0, 0.0], [0.0, 87.0, 0.0]],
            GeometryAppearanceKind::Billboard,
            PointPlacement::LineCenter,
            100.0,
        );
        assert_eq!(up.coords.len(), 1);
        assert!((86.0..87.0).contains(&up.coords[0].y), "{}", up.coords[0].y);

        let to_pole = line_anchors(
            &[[0.0, 89.0, 0.0], [0.0, 90.0, 0.0]],
            GeometryAppearanceKind::Billboard,
            PointPlacement::LineCenter,
            100.0,
        );
        assert!(to_pole.coords[0].y.is_finite() && to_pole.coords[0].y > 89.0);
    }

    #[test]
    fn line_placement_bearings_follow_the_line() {
        let east = line_anchors(
            &[[0.0, 0.0, 0.0], [0.01, 0.0, 0.0]],
            GeometryAppearanceKind::Billboard,
            PointPlacement::LineCenter,
            100.0,
        );
        assert_eq!(east.bearings.len(), 1);
        assert!((east.bearings[0] - 90.0).abs() < 1e-3);

        let north = line_anchors(
            &[[0.0, 0.0, 0.0], [0.0, 0.01, 0.0]],
            GeometryAppearanceKind::Billboard,
            PointPlacement::LineCenter,
            100.0,
        );
        assert!(north.bearings[0].abs() < 1e-3);
    }

    #[test]
    fn line_center_placement_interpolates_the_midpoint() {
        let acc = line_anchors(
            &[[0.0, 0.0, 0.0], [0.02, 0.0, 100.0]],
            GeometryAppearanceKind::Point,
            PointPlacement::LineCenter,
            10.0,
        );
        assert_eq!(acc.coords.len(), 1);
        assert!((acc.coords[0].x - 0.01).abs() < 1e-9);
        assert!((acc.coords[0].z - 50.0).abs() < 1e-6);
    }

    #[test]
    fn line_placement_samples_a_path_for_text_only() {
        let line = [[0.0, 35.0, 0.0], [0.05, 35.0, 0.0]];
        let text = line_anchors(
            &line,
            GeometryAppearanceKind::Text,
            PointPlacement::Line,
            500.0,
        );
        let n = text.coords.len();
        assert!(n > 1);
        assert_eq!(text.bearings.len(), n);
        assert_eq!(text.path_samples.len(), n * 2 * PATH_SAMPLES);
        assert_eq!(text.path_meta.len(), n * PATH_META_STRIDE);
        // Metres per sample step: two finest spacings across the first path.
        let step = 2.0 * 500.0 / (PATH_SAMPLES - 1) as f32;
        assert!((text.path_meta[0] - step).abs() < step * 1e-3);
        // Due east: every sample on the east axis.
        for k in 0..PATH_SAMPLES {
            assert!(text.path_samples[k * 2 + 1].abs() < 1e-2);
        }

        let sprite = line_anchors(
            &line,
            GeometryAppearanceKind::Billboard,
            PointPlacement::Line,
            500.0,
        );
        // One sprite per position; text stacks an anchor per level on each.
        assert!(sprite.bearings.len() > 1 && sprite.bearings.len() < n);
        assert!(sprite.path_samples.is_empty());
        assert!(sprite.path_meta.is_empty());
    }

    #[test]
    fn point_placement_keeps_one_anchor_per_vertex() {
        let mut app = run_construct(
            r#"{
    "type": "Feature",
    "properties": {},
    "geometry": { "coordinates": [[0, 0], [0.01, 0], [0.02, 0.01]], "type": "LineString" }
}"#,
            vec![Appearance::Text(TextMaterial {
                geometry_types: vec![SourceGeometryType::Line],
                ..Default::default()
            })],
        );
        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<TextMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        assert_eq!(geoms[0].coords.len(), 3);
    }

    #[test]
    fn line_placement_is_read_from_the_material() {
        let mut app = run_construct(
            r#"{
    "type": "Feature",
    "properties": {},
    "geometry": { "coordinates": [[0, 0], [0.01, 0], [0.02, 0.01]], "type": "LineString" }
}"#,
            vec![Appearance::Text(TextMaterial {
                geometry_types: vec![SourceGeometryType::Line],
                placement: navara_material::Placement::LineCenter,
                ..Default::default()
            })],
        );
        let mut geom_query = app
            .world_mut()
            .query_filtered::<&BatchedPointGeometry, With<TextMarker>>();
        let geoms: Vec<_> = geom_query.iter(app.world()).collect();
        // One position, the midpoint: text stacks an anchor there per level.
        let coords = &geoms[0].coords;
        assert!(coords.iter().all(|c| *c == coords[0]), "{coords:?}");
    }
}
