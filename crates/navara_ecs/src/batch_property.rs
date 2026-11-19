use bevy_ecs::entity::Entity;
use navara_buffer_store::BufferStore;
use navara_feature_component::{
    batch::{BatchProperty, BatchTable, GlobalBatchIds},
    render::RenderableFeature,
};
use navara_parser::b3dm::BatchTable as B3dmBatchTable;
use navara_property::{PropertyValue, json_value_to_filtered_properties, json_value_to_property};

use crate::App;

pub enum BatchProperties<V> {
    All(Option<V>),
    Filtered(Option<Vec<Option<V>>>),
}

impl App {
    /// Generate a new unique global batch id for picking.
    /// The returned id is in the range 1..0xffffff (24-bit RGB color range).
    pub fn gen_global_batch_id(&mut self) -> Option<u32> {
        let mut batch_table = self.app.world_mut().get_resource_mut::<BatchTable>()?;
        batch_table.gen_global_batch_id()
    }

    /// Get properties by a specified global batch id. Also returns the
    /// feature's canonical global batch id (its first instance's id): a
    /// picked instance of a multi-instance feature carries its own id, while
    /// the evaluator reports the canonical one, so callers correlating picks
    /// with styling need the canonical id back.
    pub fn read_property_by_global_batch_id<V: PropertyValue>(
        &mut self,
        batch_id: &u32,
    ) -> (Option<V>, Option<String>, Option<u32>) {
        // For batched features like MVT(polygon, polyline) and Cesium 3D Tiles.
        if let Some((entity, in_batch_id, canonical_batch_id)) =
            self.search_feature_entity_by_global_batch_id(batch_id)
        {
            return self
                .read_batch_table_by_global_batch_id(entity, &in_batch_id)
                .map(|(properties, layer_id)| {
                    (Some(properties), Some(layer_id), Some(canonical_batch_id))
                })
                .unwrap_or((None, None, None));
        };

        // For other features like GeoJSON and MVT point
        let batch_table = match self.app.world().get_resource::<BatchTable>() {
            Some(bt) => bt,
            None => return (None, None, None),
        };

        let batch_value = match batch_table.get(batch_id) {
            Some(bv) => bv,
            None => return (None, None, None),
        };

        let layer_id = batch_value.layer_id.clone();

        let Some(BatchProperty::Values(values)) = &batch_value.properties else {
            return (None, layer_id, Some(*batch_id));
        };
        // This should include only one batch.
        let properties: Option<V> = json_value_to_property(&values[0]);

        (properties, layer_id, Some(*batch_id))
    }

    fn read_batch_table_by_global_batch_id<V: PropertyValue>(
        &mut self,
        entity: Entity,
        in_batch_id: &usize,
    ) -> Option<(V, String)> {
        let world = self.app.world_mut();
        let mut query = world.query::<&RenderableFeature>();

        let batch_table = world.get_resource::<BatchTable>()?;

        let renderable_feature = query.get(world, entity).ok()?;

        let feature_batch_id = match renderable_feature {
            RenderableFeature::Model {
                feature_batch_id, ..
            }
            | RenderableFeature::Polyline {
                feature_batch_id, ..
            }
            | RenderableFeature::Polygon {
                feature_batch_id, ..
            }
            | RenderableFeature::Point {
                feature_batch_id, ..
            }
            | RenderableFeature::Billboard {
                feature_batch_id, ..
            }
            | RenderableFeature::Text {
                feature_batch_id, ..
            } => *feature_batch_id,
            RenderableFeature::Unknown => return None,
        };

        let buf_store = world.get_resource::<BufferStore>()?;
        let batch_value = batch_table.get(&feature_batch_id)?;
        let batch_prop = batch_value.properties.as_ref()?;

        let properties = match batch_prop {
            BatchProperty::Cesium3dTileset(in_batch_table) => {
                let batch_table_json = in_batch_table.json().ok()?;
                in_batch_table.get_property(&batch_table_json, *in_batch_id)
            }
            BatchProperty::Values(values) => json_value_to_property(values.get(*in_batch_id)?),
            BatchProperty::Mvt(mvt_layer_data) => mvt_layer_data.get_properties(*in_batch_id),
            BatchProperty::Cesium3dTilesetV11(gltf_table) => {
                gltf_table.get_properties(*in_batch_id, buf_store)
            }
        }?;

        Some((properties, batch_value.layer_id.clone()?))
    }

    /// Read properties from a batched feature.
    /// The batched feature contains a lot of feature, so [`callback`] will be invoked to each feature's property.
    pub fn read_all_batched_properties<
        V: PropertyValue,
        E,
        F: Fn(usize, u32, BatchProperties<V>) -> Result<(), E>,
    >(
        &mut self,
        renderable_feature_bits: u64,
        keys: Option<&[String]>,
        callback: &F,
    ) -> Result<Option<()>, E> {
        let renderable_feature_entity = Entity::from_bits(renderable_feature_bits);

        self.read_batch_table::<V, E, F>(renderable_feature_entity, keys, callback)
    }

    fn read_batch_table<
        V: PropertyValue,
        E,
        F: Fn(usize, u32, BatchProperties<V>) -> Result<(), E>,
    >(
        &mut self,
        renderable_feature_entity: Entity,
        keys: Option<&[String]>,
        callback: &F,
    ) -> Result<Option<()>, E> {
        let world = self.app.world_mut();
        let mut query = world.query::<&RenderableFeature>();

        let Some(batch_table) = world.get_resource::<BatchTable>() else {
            return Ok(None);
        };

        let Ok(renderable_feature) = query.get(world, renderable_feature_entity) else {
            return Ok(None);
        };

        let (feature_batch_id, global_batch_ids_entity, model_batch_length) =
            match renderable_feature {
                RenderableFeature::Model {
                    feature_batch_id,
                    batch_length,
                    feature_id,
                    ..
                }
                | RenderableFeature::Point {
                    feature_batch_id,
                    batch_length,
                    feature_id,
                    ..
                }
                | RenderableFeature::Billboard {
                    feature_batch_id,
                    batch_length,
                    feature_id,
                    ..
                }
                | RenderableFeature::Text {
                    feature_batch_id,
                    batch_length,
                    feature_id,
                    ..
                }
                | RenderableFeature::Polygon {
                    feature_batch_id,
                    batch_length,
                    feature_id,
                    ..
                }
                | RenderableFeature::Polyline {
                    feature_batch_id,
                    batch_length,
                    feature_id,
                    ..
                } => (*feature_batch_id, *feature_id, Some(*batch_length as usize)),
                RenderableFeature::Unknown => return Ok(Some(())),
            };

        let Some(batch_value) = batch_table.get(&feature_batch_id) else {
            return Ok(None);
        };
        let Some(batch_prop) = batch_value.properties.as_ref() else {
            return Ok(None);
        };

        let global_batch_ids_opt = world
            .get_entity(global_batch_ids_entity)
            .ok()
            .and_then(|e| e.get::<GlobalBatchIds>());

        // One representative global batch id per feature (per property row).
        // Multi-instance features (e.g. MultiPoint) store per-instance ids, so
        // map each feature to its first instance's id via the instance ->
        // feature index buffer; without that buffer, positions already are
        // feature ordinals.
        let global_batch_ids: Option<FeatureGlobalBatchIds> =
            global_batch_ids_opt.and_then(|ids| {
                let store = world.get_resource::<BufferStore>()?;
                let instance_ids = store.get_u32(&ids.handle)?;
                match ids
                    .instance_feature_indices
                    .and_then(|handle| store.get_u32(&handle))
                {
                    Some(feature_indices) => {
                        let mut per_feature: Vec<Option<u32>> = Vec::new();
                        for (&feature, &id) in feature_indices.iter().zip(instance_ids.iter()) {
                            let feature = feature as usize;
                            if feature >= per_feature.len() {
                                per_feature.resize(feature + 1, None);
                            }
                            per_feature[feature].get_or_insert(id);
                        }
                        Some(FeatureGlobalBatchIds::FirstInstance(per_feature))
                    }
                    None => Some(FeatureGlobalBatchIds::Direct(instance_ids)),
                }
            });
        let global_batch_id = |batch_idx: usize, fallback: u32| {
            global_batch_ids
                .as_ref()
                .and_then(|ids| ids.get(batch_idx))
                .unwrap_or(fallback)
        };

        match batch_prop {
            BatchProperty::Cesium3dTileset(in_batch_table) => {
                let Some(batch_length) = model_batch_length else {
                    return Ok(Some(()));
                };

                match keys {
                    None => {
                        let Some(batch_table_json) = in_batch_table.json().ok() else {
                            return Ok(None);
                        };
                        for batch_idx in 0..batch_length {
                            let props = in_batch_table.get_property(&batch_table_json, batch_idx);
                            callback(
                                batch_idx,
                                global_batch_id(batch_idx, batch_idx as u32),
                                BatchProperties::All(props),
                            )?;
                        }
                    }
                    Some(keys) => {
                        let Some(batch_table_json) = in_batch_table.json_filtered(keys).ok() else {
                            return Ok(None);
                        };
                        let columns = B3dmBatchTable::filtered_columns(&batch_table_json, keys);
                        for batch_idx in 0..batch_length {
                            let props = in_batch_table.get_filtered_properties(&columns, batch_idx);
                            callback(
                                batch_idx,
                                global_batch_id(batch_idx, batch_idx as u32),
                                BatchProperties::Filtered(Some(props)),
                            )?;
                        }
                    }
                }
            }
            BatchProperty::Cesium3dTilesetV11(gltf_table) => {
                let Some(batch_length) = model_batch_length else {
                    return Ok(Some(()));
                };

                let binary = world
                    .get_resource::<BufferStore>()
                    .and_then(|bs| gltf_table.resolve_binary(bs));

                match keys {
                    None => {
                        for batch_idx in 0..batch_length {
                            let props: Option<V> =
                                binary.and_then(|b| gltf_table.table.get_properties(batch_idx, b));
                            callback(
                                batch_idx,
                                global_batch_id(batch_idx, batch_idx as u32),
                                BatchProperties::All(props),
                            )?;
                        }
                    }
                    Some(keys) => {
                        let columns = binary.map(|b| gltf_table.table.filtered_columns(keys, b));
                        for batch_idx in 0..batch_length {
                            let props = columns.as_ref().and_then(|columns| {
                                gltf_table
                                    .table
                                    .get_filtered_properties::<V>(batch_idx, columns)
                            });
                            callback(
                                batch_idx,
                                global_batch_id(batch_idx, batch_idx as u32),
                                BatchProperties::Filtered(props),
                            )?;
                        }
                    }
                }
            }
            BatchProperty::Values(values) => {
                for (batch_idx, value) in values.iter().enumerate() {
                    let global_batch_id = global_batch_id(batch_idx, feature_batch_id);
                    match keys {
                        None => {
                            let props: Option<V> = json_value_to_property(value);
                            callback(batch_idx, global_batch_id, BatchProperties::All(props))?;
                        }
                        Some(keys) => {
                            let props = json_value_to_filtered_properties::<V>(value, keys);
                            callback(batch_idx, global_batch_id, BatchProperties::Filtered(props))?;
                        }
                    }
                }
            }
            BatchProperty::Mvt(mvt_layer_data) => {
                let key_filter = keys.map(|keys| mvt_layer_data.key_filter(keys));
                for batch_idx in 0..mvt_layer_data.feature_count() {
                    let global_batch_id = global_batch_id(batch_idx, feature_batch_id);
                    match &key_filter {
                        None => {
                            let props: Option<V> = mvt_layer_data.get_properties(batch_idx);
                            callback(batch_idx, global_batch_id, BatchProperties::All(props))?;
                        }
                        Some(key_filter) => {
                            let props =
                                mvt_layer_data.get_filtered_properties::<V>(batch_idx, key_filter);
                            callback(batch_idx, global_batch_id, BatchProperties::Filtered(props))?;
                        }
                    }
                }
            }
        }

        Ok(Some(()))
    }
}

/// Global batch ids indexed by feature (property row).
enum FeatureGlobalBatchIds<'a> {
    /// One instance per feature.
    Direct(&'a [u32]),
    /// Each feature's first instance id.
    FirstInstance(Vec<Option<u32>>),
}

impl FeatureGlobalBatchIds<'_> {
    fn get(&self, feature: usize) -> Option<u32> {
        match self {
            Self::Direct(ids) => ids.get(feature).copied(),
            Self::FirstInstance(ids) => ids.get(feature).copied().flatten(),
        }
    }
}
