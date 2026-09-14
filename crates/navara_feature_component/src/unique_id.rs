use bevy_ecs::resource::Resource;
use rand::{RngExt, rng};
use rustc_hash::FxHashSet;

pub(super) trait UniqueId {
    fn random(&mut self) -> u32;
    fn hashset(&mut self) -> &mut FxHashSet<u32>;
    fn retry_count(&self) -> usize {
        10
    }
    fn get(&mut self) -> Option<u32> {
        let mut key = self.random();
        let mut retry_count = self.retry_count();

        while (self.hashset().contains(&key)) && retry_count > 0 {
            key = self.random();
            retry_count -= 1;
        }

        if retry_count > 0 {
            self.hashset().insert(key);
            Some(key)
        } else {
            None
        }
    }
    /// Return a dead id to the pool so `get` can hand it out again.
    fn release(&mut self, key: u32) -> bool {
        self.hashset().remove(&key)
    }
}

/// Global batch id have to be generated in the color range,
/// because it is used to render the id in GPU for picking.
#[derive(Resource)]
pub(super) struct UniqueGlobalBatchId {
    hashset: FxHashSet<u32>,
}

impl UniqueGlobalBatchId {
    pub(super) fn new() -> Self {
        Self {
            hashset: Default::default(),
        }
    }
}

impl UniqueId for UniqueGlobalBatchId {
    fn random(&mut self) -> u32 {
        rng().random_range(1..0xffffff)
    }

    fn hashset(&mut self) -> &mut FxHashSet<u32> {
        &mut self.hashset
    }
}

#[derive(Resource)]
pub(super) struct UniqueFeatureId {
    hashset: FxHashSet<u32>,
}

impl UniqueFeatureId {
    pub(super) fn new() -> Self {
        Self {
            hashset: Default::default(),
        }
    }
}

impl UniqueId for UniqueFeatureId {
    fn random(&mut self) -> u32 {
        rng().random()
    }

    fn hashset(&mut self) -> &mut FxHashSet<u32> {
        &mut self.hashset
    }
}
