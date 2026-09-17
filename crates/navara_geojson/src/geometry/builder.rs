use navara_core::{CRS, EncodedVec3, WGS84_64};
use navara_geometry::{Hierarchy, WindingOrder};
use navara_math::Vec3;

use navara_feature_component::batch::BatchTable;
pub(crate) use navara_feature_component::geometry_builder::GeometryAppearanceKind;
use navara_feature_component::geometry_builder::GeometryGroups;

/// Accumulates feature entities and batch IDs during geometry construction.
///
/// Each appearance kind gets its own batch with its own feature count and
/// batch indices. Properties are stored per-kind: when a feature produces
/// entities for multiple kinds, its properties are duplicated into each
/// kind's batch.
///
/// Properties are stored lazily: `begin_feature` prepares the data, but it is
/// only committed to the batch table when geometry is first added for that
/// kind. This avoids phantom batch entries for features whose geometry does
/// not match any appearance.
pub(crate) struct GeometryBuilder<'a> {
    pub(crate) groups: GeometryGroups,
    batch_table: &'a mut BatchTable,
    layer_id: &'a str,
    pending_properties: Option<serde_json::Value>,
}

impl<'a> GeometryBuilder<'a> {
    pub(crate) fn new(batch_table: &'a mut BatchTable, layer_id: &'a str) -> Self {
        Self {
            groups: GeometryGroups::new(),
            batch_table,
            layer_id,
            pending_properties: None,
        }
    }

    /// Begin processing a new feature. Stores properties lazily.
    pub(crate) fn begin_feature(
        &mut self,
        properties: &Option<serde_json::Map<String, serde_json::Value>>,
    ) {
        let props = properties
            .as_ref()
            .and_then(|prop| serde_json::to_value(prop).ok())
            .unwrap_or(serde_json::Value::Null);
        self.pending_properties = Some(props);
        self.groups.begin_feature();
    }

    /// Ensure a kind is registered, lazily initializing its batch in the table.
    fn ensure_kind(&mut self, kind: GeometryAppearanceKind) {
        if !self.groups.has_kind(kind) {
            let batch_id = self
                .batch_table
                .init_values(Some(self.layer_id.to_owned()))
                .unwrap_or(0);
            self.groups.register_kind(kind, batch_id);
        }
    }

    /// Commit pending properties if this is the first geometry for this kind in the current feature.
    fn maybe_commit_props(&mut self, commit_batch_id: Option<u32>) {
        if let Some(batch_id) = commit_batch_id {
            let props = self.pending_properties.clone().unwrap();
            self.batch_table.add_values(batch_id, props);
        }
    }

    /// Accumulate point geometry with RTE encoding (GeoJSON direct, no tile).
    pub(crate) fn add_point(
        &mut self,
        kind: GeometryAppearanceKind,
        coords: Vec3,
        crs: CRS,
        height: f32,
    ) -> u32 {
        self.ensure_kind(kind);
        let global_batch_id = self.batch_table.gen_global_batch_id().unwrap_or(0);
        let world_pos = crs.to_vec3(WGS84_64, coords, height);
        let enc = EncodedVec3::encode(world_pos);
        let high = [enc.high.x as f32, enc.high.y as f32, enc.high.z as f32];
        let low = [enc.low.x as f32, enc.low.y as f32, enc.low.z as f32];
        let (batch_index, commit_batch_id) =
            self.groups
                .track_point_rte(kind, coords, crs, high, low, global_batch_id);
        self.maybe_commit_props(commit_batch_id);
        batch_index
    }

    /// Accumulate polyline geometry without spawning a child entity. `ring`
    /// marks a polygon boundary, whose repeated first vertex is a seam to join
    /// rather than two ends to cap.
    pub(crate) fn add_polyline(&mut self, points: Vec<f64>, crs: CRS, ring: bool) -> u32 {
        let kind = GeometryAppearanceKind::Polyline;
        self.ensure_kind(kind);
        let global_batch_id = self.batch_table.gen_global_batch_id().unwrap_or(0);
        let (batch_index, commit_batch_id) =
            self.groups
                .track_polyline(kind, points, crs, global_batch_id, ring);
        self.maybe_commit_props(commit_batch_id);
        batch_index
    }

    /// Accumulate polygon geometry without spawning a child entity.
    pub(crate) fn add_polygon(
        &mut self,
        outer_ring: Vec<f64>,
        holes: &[Hierarchy],
        winding_order: WindingOrder,
        crs: CRS,
    ) -> u32 {
        let kind = GeometryAppearanceKind::Polygon;
        self.ensure_kind(kind);
        let global_batch_id = self.batch_table.gen_global_batch_id().unwrap_or(0);
        let (batch_index, commit_batch_id) =
            self.groups
                .track_polygon(kind, outer_ring, holes, winding_order, crs, global_batch_id);
        self.maybe_commit_props(commit_batch_id);
        batch_index
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use bevy_app::{App, Update};
    use bevy_ecs::prelude::Resource;
    use bevy_ecs::system::{Commands, ResMut};
    use navara_feature_component::batch::BatchTable;
    use navara_feature_component::geometry_builder::GeometryGroup;

    #[derive(Resource, Default)]
    struct BuilderTestOutput {
        groups: Vec<GeometryGroup>,
    }

    fn run_builder_test(
        setup: impl FnOnce(&mut Commands, &mut GeometryBuilder) + Send + Sync + 'static,
    ) -> App {
        let mut app = App::new();
        app.init_resource::<BatchTable>();
        app.init_resource::<BuilderTestOutput>();

        let setup = std::sync::Mutex::new(Some(setup));
        app.add_systems(
            Update,
            move |mut commands: Commands,
                  mut batch_table: ResMut<BatchTable>,
                  mut out: ResMut<BuilderTestOutput>| {
                let setup_fn = setup.lock().unwrap().take().unwrap();
                let mut builder = GeometryBuilder::new(&mut batch_table, "test_layer");
                setup_fn(&mut commands, &mut builder);
                out.groups = std::mem::take(&mut builder.groups.groups);
            },
        );
        app.update();
        app
    }

    #[test]
    fn new_builder_has_empty_groups() {
        let app = run_builder_test(|_, _| {});
        let out = app.world().resource::<BuilderTestOutput>();
        assert!(out.groups.is_empty());
    }

    #[test]
    fn begin_feature_without_add_does_not_store_properties() {
        let app = run_builder_test(|_, builder| {
            builder.begin_feature(&None);
        });
        let out = app.world().resource::<BuilderTestOutput>();
        assert!(out.groups.is_empty());
    }

    #[test]
    fn add_point_stores_properties_in_batch_table() {
        let props = Some(serde_json::Map::from_iter([(
            "name".to_string(),
            serde_json::Value::String("test".to_string()),
        )]));

        let app = run_builder_test(move |_commands, builder| {
            builder.begin_feature(&props);
            builder.add_point(
                GeometryAppearanceKind::Point,
                Vec3::new(1., 2., 0.),
                CRS::Geographic,
                0.0,
            );
        });

        let out = app.world().resource::<BuilderTestOutput>();
        let feature_batch_id = out.groups[0].batch_id;

        let batch_table = app.world().resource::<BatchTable>();
        let batch_value = batch_table.get(&feature_batch_id).unwrap();
        let properties = batch_value.properties.as_ref().unwrap();
        match properties {
            navara_feature_component::batch::BatchProperty::Values(values) => {
                assert_eq!(values.len(), 1);
                assert_eq!(values[0], serde_json::json!({"name": "test"}));
            }
            _ => panic!("Expected BatchProperty::Values"),
        }
    }

    #[test]
    fn batch_ids_separate_per_kind() {
        let app = run_builder_test(|_commands, builder| {
            builder.begin_feature(&None);
            builder.add_point(
                GeometryAppearanceKind::Point,
                Vec3::new(1., 2., 0.),
                CRS::Geographic,
                0.0,
            );
            builder.add_point(
                GeometryAppearanceKind::Billboard,
                Vec3::new(1., 2., 0.),
                CRS::Geographic,
                0.0,
            );
        });
        let out = app.world().resource::<BuilderTestOutput>();
        assert_eq!(out.groups.len(), 2);
        assert_ne!(out.groups[0].batch_id, out.groups[1].batch_id);
    }
}
