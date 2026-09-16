use bevy_ecs::{component::Component, entity::Entity, prelude::Resource, system::Commands};

use navara_buffer_store::{BufferStore, Handle};
use navara_component::Deleted;

pub use navara_parser::cesium3dtiles::property_table::{PropertyColumnData, PropertyTableData};
use navara_parser::{b3dm::BatchTable as B3dmBatchTable, mvt::MvtLayerData};
use navara_property::PropertyValue;
use rustc_hash::FxHashMap;

use crate::unique_id::{UniqueFeatureId, UniqueGlobalBatchId, UniqueId};

#[derive(Component, Debug, Default)]
pub struct BatchedFeature {
    pub construct_polygon_feature: Option<Entity>,
    pub construct_polyline_feature: Option<Entity>,
    /// Whether the feature should be active (visible) immediately when transferred.
    /// GeoJSON sets this to `true`; MVT tiles use `false` (activated by tile visibility).
    pub default_active: bool,
}

impl BatchedFeature {
    /// Marks worker task entities as `Deleted` for cleanup.
    pub fn despawn_recursively(&self, commands: &mut Commands) {
        if let Some(e) = self.construct_polyline_feature {
            let _ = commands.get_entity(e).as_mut().map(|e| e.insert(Deleted));
        }
        if let Some(e) = self.construct_polygon_feature {
            let _ = commands.get_entity(e).as_mut().map(|e| e.insert(Deleted));
        }
    }
}

#[derive(Component, Debug)]
pub struct BatchId(pub f32);

/// This is used to retrieve batch's properties by index.
#[derive(Component, Debug, Clone)]
pub struct BatchIndex(pub u32);

// b3dm feature's batch id
#[derive(Component, Debug, Default)]
pub struct FeatureBatchId(pub u32);

// The global batch ID and the selection state corresponding to the internal batch ID in b3dm.
#[derive(Component, Default, Clone, Debug)]
pub struct GlobalBatchIds {
    pub handle: Handle,
    pub batch_length: u32,
    /// Maps each per-instance entry in `handle` to its feature ordinal (the row
    /// index into the batch properties). `None` means instances and features are
    /// 1:1, so the position in `handle` is already the feature ordinal.
    pub instance_feature_indices: Option<Handle>,
}

impl GlobalBatchIds {
    /// Free the id buffers and return every contained picking id to the
    /// generator. Idempotent across clones sharing the same handles, so both
    /// the `FeatureBatchIdMap` entry and the feature's own component can be
    /// destroyed through this without double effects.
    pub fn destroy(&self, buf: &mut BufferStore, batch_table: &mut BatchTable) {
        if let Some(global_ids) = buf.remove_u32(&self.handle) {
            for id in global_ids {
                batch_table.release_global_batch_id(id);
            }
        }
        if let Some(feature_indices) = self.instance_feature_indices {
            buf.remove(&feature_indices);
        }
    }
}

// Search b3dm feature by global batch id
#[derive(Resource, Default, Debug)]
pub struct FeatureBatchIdMap {
    pub map: FxHashMap<Entity, GlobalBatchIds>,
}

impl FeatureBatchIdMap {
    pub fn new() -> Self {
        Self {
            map: FxHashMap::default(),
        }
    }

    pub fn add(&mut self, key: Entity, ids: GlobalBatchIds) {
        self.map.insert(key, ids);
    }
    pub fn get(&self, key: &Entity) -> Option<&GlobalBatchIds> {
        self.map.get(key)
    }
    pub fn remove(
        &mut self,
        key: &Entity,
        buf: &mut BufferStore,
        batch_table: &mut BatchTable,
    ) -> bool {
        if let Some(ids) = self.get(key) {
            ids.destroy(buf, batch_table);
            self.map.remove(key);
            return true;
        }
        false
    }
}

pub enum BatchProperty {
    Values(Vec<serde_json::Value>),
    Cesium3dTileset(B3dmBatchTable),
    /// Lazy MVT properties - parsed on demand
    Mvt(MvtLayerData),
    /// 3D Tiles 1.1 property table from EXT_structural_metadata.
    /// Properties are decoded lazily from binary buffers on demand.
    /// Binary data is resolved from BufferStore at read time via the handle.
    Cesium3dTilesetV11(GltfPropertyTable),
}

/// Wraps a PropertyTableData with the information needed to resolve
/// binary data lazily from BufferStore at read time.
pub struct GltfPropertyTable {
    pub table: PropertyTableData,
    /// Handle to the GLB binary in BufferStore.
    pub handle: Handle,
    /// Byte offset where the BIN chunk **data** starts within the full GLB binary
    /// (i.e. after the 8-byte chunk header: chunk_length + chunk_type).
    pub bin_data_start: usize,
}

impl GltfPropertyTable {
    /// Resolve the BIN chunk slice from BufferStore.
    pub fn resolve_binary<'a>(&self, buf_store: &'a BufferStore) -> Option<&'a [u8]> {
        let glb = buf_store.get_u8(&self.handle)?;
        glb.get(self.bin_data_start..)
    }

    /// Get all properties for a feature at the given index.
    pub fn get_properties<V: PropertyValue>(
        &self,
        index: usize,
        buf_store: &BufferStore,
    ) -> Option<V> {
        let binary = self.resolve_binary(buf_store)?;
        self.table.get_properties(index, binary)
    }

    /// Get filtered properties for a feature at the given index.
    pub fn get_filtered_properties<V: PropertyValue>(
        &self,
        index: usize,
        keys: &[String],
        buf_store: &BufferStore,
    ) -> Option<Vec<Option<V>>> {
        let binary = self.resolve_binary(buf_store)?;
        self.table.get_filtered_properties(index, keys, binary)
    }
}

pub struct BatchTableValue {
    pub properties: Option<BatchProperty>,
    pub layer_id: Option<String>,
}

impl BatchTableValue {
    pub fn empty() -> Self {
        Self {
            properties: None,
            layer_id: None,
        }
    }
}

/// Per-entry accounting record, so `remove` can reverse exactly what `add`
/// contributed (owned bytes + which shared `Arc`s it referenced).
#[derive(Default)]
struct EntryAccounting {
    /// Bytes owned exclusively by this entry.
    owned_bytes: usize,
    /// Pointers into `arc_registry` for shared tables this entry references.
    arc_ptrs: [Option<usize>; 2],
}

/// Refcounted shared allocation (an MVT keys/values table) so multiple batch
/// entries sharing one tile's `Arc` count its bytes only once.
struct ArcEntry {
    bytes: usize,
    refs: u32,
}

/// Rough byte size of a `serde_json::Value` tree (GeoJSON property path).
fn json_bytes(value: &serde_json::Value) -> usize {
    use serde_json::Value;
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => size_of::<Value>(),
        Value::String(s) => size_of::<Value>() + s.capacity(),
        Value::Array(a) => size_of::<Value>() + a.iter().map(json_bytes).sum::<usize>(),
        Value::Object(o) => {
            size_of::<Value>()
                + o.iter()
                    .map(|(k, v)| k.capacity() + json_bytes(v))
                    .sum::<usize>()
        }
    }
}

#[derive(Resource)]
pub struct BatchTable {
    map: FxHashMap<u32, Option<BatchTableValue>>,
    /// Parallel accounting keyed by the same batch id. Kept separate from
    /// `BatchTableValue` so the (externally constructed) value struct stays
    /// unchanged.
    accounting: FxHashMap<u32, EntryAccounting>,
    /// Shared `Arc` allocations by pointer identity, refcounted within this
    /// table so a layer's shared keys/values table is counted once.
    arc_registry: FxHashMap<usize, ArcEntry>,
    /// Sum of all owned + shared bytes currently held. Surfaced to the memory
    /// ledger as external (non-BufferStore) CPU bytes.
    total_bytes: usize,
    unique_feature_batch_id: UniqueFeatureId,
    unique_global_batch_id: UniqueGlobalBatchId,
}

impl Default for BatchTable {
    fn default() -> Self {
        Self::new()
    }
}

impl BatchTable {
    pub fn new() -> Self {
        Self {
            map: FxHashMap::default(),
            accounting: FxHashMap::default(),
            arc_registry: FxHashMap::default(),
            total_bytes: 0,
            unique_feature_batch_id: UniqueFeatureId::new(),
            unique_global_batch_id: UniqueGlobalBatchId::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Bytes held by this table's property data — invisible to `BufferStore`
    /// (plain `Vec`s/`HashMap`s), so the memory ledger reads it from here.
    pub fn total_bytes(&self) -> usize {
        self.total_bytes
    }

    /// Register a shared allocation: adds its bytes to the total only on first
    /// reference. Returns the ptr so the caller records it for `remove`.
    fn register_arc(&mut self, ptr: usize, bytes: usize) -> usize {
        self.arc_registry
            .entry(ptr)
            .and_modify(|e| e.refs += 1)
            .or_insert_with(|| {
                self.total_bytes += bytes;
                ArcEntry { bytes, refs: 1 }
            });
        ptr
    }

    /// Drop one reference to a shared allocation, freeing its bytes when the
    /// last reference within this table goes away.
    fn unregister_arc(&mut self, ptr: usize) {
        if let Some(entry) = self.arc_registry.get_mut(&ptr) {
            entry.refs -= 1;
            if entry.refs == 0 {
                self.total_bytes -= entry.bytes;
                self.arc_registry.remove(&ptr);
            }
        }
    }

    /// Compute the accounting for a freshly inserted value and fold it into
    /// the running totals.
    fn account_insert(&mut self, value: Option<&BatchTableValue>) -> EntryAccounting {
        let mut acc = EntryAccounting::default();
        let Some(BatchTableValue {
            properties: Some(props),
            ..
        }) = value
        else {
            return acc;
        };
        match props {
            BatchProperty::Mvt(d) => {
                acc.owned_bytes = d.owned_bytes();
                self.total_bytes += acc.owned_bytes;
                acc.arc_ptrs[0] = Some(self.register_arc(d.keys_ptr(), d.keys_shared_bytes()));
                acc.arc_ptrs[1] = Some(self.register_arc(d.values_ptr(), d.values_shared_bytes()));
            }
            BatchProperty::Values(vals) => {
                acc.owned_bytes = vals.iter().map(json_bytes).sum();
                self.total_bytes += acc.owned_bytes;
            }
            // b3dm batch tables own their JSON + binary property blobs as plain
            // `Vec`s (invisible to BufferStore); attribute-rich tiles make these
            // large, so count them.
            BatchProperty::Cesium3dTileset(bt) => {
                acc.owned_bytes = bt.json_data.capacity() + bt.binary_data.capacity();
                self.total_bytes += acc.owned_bytes;
            }
            // glTF 1.1 (EXT_structural_metadata) resolves its bulk binary from
            // BufferStore via the handle (already counted); only small column
            // metadata lives here, so it is not tracked.
            BatchProperty::Cesium3dTilesetV11(_) => {}
        }
        acc
    }

    /// Store the feature property to `map`.
    pub fn add(&mut self, value: Option<BatchTableValue>) -> Option<u32> {
        let key = self.unique_feature_batch_id.get()?;
        let acc = self.account_insert(value.as_ref());
        self.accounting.insert(key, acc);
        self.map.insert(key, value);
        Some(key)
    }

    pub fn init_values(&mut self, layer_id: Option<String>) -> Option<u32> {
        self.add(Some(BatchTableValue {
            properties: Some(BatchProperty::Values(vec![])),
            layer_id,
        }))
    }

    /// Initialize with lazy MVT property storage.
    /// Properties are not parsed until accessed.
    pub fn init_mvt(&mut self, layer_id: Option<String>, mvt_data: MvtLayerData) -> Option<u32> {
        self.add(Some(BatchTableValue {
            properties: Some(BatchProperty::Mvt(mvt_data)),
            layer_id,
        }))
    }

    pub fn gen_global_batch_id(&mut self) -> Option<u32> {
        let key = self.unique_global_batch_id.get()?;

        Some(key)
    }

    /// Return a destroyed feature's global batch id to the generator. The
    /// 24-bit picking id space is shared by the whole session, so ids must be
    /// recycled when their geometry is destroyed or long sessions exhaust it.
    /// Idempotent, so destroy paths that see the same id twice (e.g. via the
    /// `FeatureBatchIdMap` and the geometry's own attribute) are safe.
    pub fn release_global_batch_id(&mut self, id: u32) -> bool {
        self.unique_global_batch_id.release(id)
    }

    pub fn add_values(&mut self, key: u32, props: serde_json::Value) {
        let Some(Some(table_value)) = self.map.get_mut(&key) else {
            return;
        };

        let Some(BatchProperty::Values(values)) = &mut table_value.properties else {
            return;
        };

        // The Values vec is append-only and never mutated in place, so the
        // owned-bytes delta is exactly this one value's bytes — compute it once
        // instead of re-summing the whole vec (which made a k-element layer O(k²)
        // over its k pushes).
        let delta = json_bytes(&props);
        values.push(props);

        if let Some(acc) = self.accounting.get_mut(&key) {
            acc.owned_bytes += delta;
            self.total_bytes += delta;
        }
    }

    pub fn get(&self, key: &u32) -> Option<&BatchTableValue> {
        self.map.get(key).and_then(|value| value.as_ref())
    }

    pub fn remove(&mut self, key: &u32) {
        if let Some(acc) = self.accounting.remove(key) {
            self.total_bytes -= acc.owned_bytes;
            for ptr in acc.arc_ptrs.into_iter().flatten() {
                self.unregister_arc(ptr);
            }
        }
        self.map.remove(key);
        self.unique_feature_batch_id.release(*key);
    }
}

#[cfg(test)]
mod accounting_tests {
    use super::*;
    use navara_parser::mvt::MvtLayerData;
    use std::sync::Arc;

    fn mvt(keys: Arc<Vec<geozero::mvt::tile::Value>>) -> MvtLayerData {
        // Reuse a shared values Arc across entries to exercise dedup.
        MvtLayerData::from_raw(
            Arc::new(vec!["name".to_string(), "height".to_string()]),
            keys,
            vec![0, 0, 1, 1],
            &[4],
        )
    }

    fn shared_values() -> Arc<Vec<geozero::mvt::tile::Value>> {
        Arc::new(vec![
            geozero::mvt::tile::Value {
                string_value: Some("a_long_building_name".to_string()),
                ..Default::default()
            },
            geozero::mvt::tile::Value {
                double_value: Some(1.0),
                ..Default::default()
            },
        ])
    }

    #[test]
    fn insert_and_remove_balances_to_zero() {
        let mut t = BatchTable::new();
        let id = t.init_mvt(None, mvt(shared_values())).unwrap();
        assert!(t.total_bytes() > 0);
        t.remove(&id);
        assert_eq!(t.total_bytes(), 0);
        assert!(t.arc_registry.is_empty());
    }

    #[test]
    fn shared_values_arc_counted_once() {
        let mut t = BatchTable::new();
        let values = shared_values();
        // Two batch entries share the same values Arc (same tile/layer).
        let a = t.init_mvt(None, mvt(values.clone())).unwrap();
        let after_first = t.total_bytes();
        let b = t.init_mvt(None, mvt(values.clone())).unwrap();

        // The second entry adds only its own owned bytes + keys arc, NOT a
        // second copy of the shared values table.
        let values_bytes = mvt(values.clone()).values_shared_bytes();
        let delta = t.total_bytes() - after_first;
        assert!(
            delta < values_bytes,
            "second entry re-counted the shared values table: delta={delta} values={values_bytes}"
        );

        // The values arc survives until BOTH sharers are removed.
        let values_ptr = mvt(values.clone()).values_ptr();
        t.remove(&a);
        assert!(t.arc_registry.contains_key(&values_ptr));
        t.remove(&b);
        assert!(!t.arc_registry.contains_key(&values_ptr));
        assert_eq!(t.total_bytes(), 0);
    }

    #[test]
    fn values_path_grows_and_frees() {
        let mut t = BatchTable::new();
        let id = t.init_values(None).unwrap();
        let empty = t.total_bytes();
        t.add_values(id, serde_json::json!({ "name": "some feature name" }));
        assert!(t.total_bytes() > empty);
        t.remove(&id);
        assert_eq!(t.total_bytes(), 0);
    }

    #[test]
    fn b3dm_batch_table_json_and_binary_counted() {
        let mut t = BatchTable::new();
        let bt = B3dmBatchTable {
            json_data: vec![0u8; 4096],
            binary_data: vec![0u8; 8192],
        };
        let id = t
            .add(Some(BatchTableValue {
                properties: Some(BatchProperty::Cesium3dTileset(bt)),
                layer_id: None,
            }))
            .unwrap();
        assert!(t.total_bytes() >= 4096 + 8192);
        t.remove(&id);
        assert_eq!(t.total_bytes(), 0);
    }
}

#[cfg(test)]
mod global_batch_id_tests {
    use super::*;

    /// Destroying a feature's ids must return them to the generator — the
    /// 24-bit picking space is session-global, so unreleased ids would leak
    /// until the tab dies — and free both id buffers.
    #[test]
    fn destroy_releases_picking_ids_and_buffers() {
        let mut t = BatchTable::new();
        let mut buf = BufferStore::default();
        let a = t.gen_global_batch_id().unwrap();
        let b = t.gen_global_batch_id().unwrap();
        // MultiPoint-style: two instances of feature `a`, one of `b`.
        let ids = GlobalBatchIds {
            handle: buf.new_u32(vec![a, a, b]),
            batch_length: 3,
            instance_feature_indices: Some(buf.new_u32(vec![0, 0, 1])),
        };
        ids.destroy(&mut buf, &mut t);

        // Already released, so a second release reports the id as absent.
        assert!(!t.release_global_batch_id(a));
        assert!(!t.release_global_batch_id(b));
        assert!(buf.get_u32(&ids.handle).is_none());
        assert!(
            buf.get_u32(&ids.instance_feature_indices.unwrap())
                .is_none()
        );

        // A shared clone destroyed through another path stays a no-op.
        ids.destroy(&mut buf, &mut t);
    }
}
