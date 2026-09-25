use std::cell::RefCell;
use std::collections::HashMap;

use navara_tile_component::MartiniComponent;

thread_local! {
    static MARTINI: RefCell<HashMap<u32, MartiniComponent>> = RefCell::new(HashMap::new());
}

/// Run `f` with this worker's Martini instance for a `size` (2^n + 1) grid,
/// built on first use and reused by every later mesh of that size: building
/// one costs about as much as meshing a tile with it.
///
/// The instance is taken out of the cell while `f` runs: a trap inside `f`
/// (`panic = "abort"` on wasm, the instance survives as a JS `RuntimeError`)
/// would otherwise leave the cell borrowed and break every later call.
pub(crate) fn with_martini<R>(size: u32, f: impl FnOnce(&mut MartiniComponent) -> R) -> R {
    let mut martini = MARTINI
        .with(|cache| cache.borrow_mut().remove(&size))
        .unwrap_or_else(|| MartiniComponent::new(size));
    let result = f(&mut martini);
    MARTINI.with(|cache| cache.borrow_mut().insert(size, martini));
    result
}
