//! State exploration of the vector tile traversal: random sequences of
//! outside events ([`Action`]: camera moves, max SSE changes, fetch answers
//! and failures, frontend builds and render reports, passes) drive the real
//! `update_tiles`, `clear_caches` and `enforce_memory_budget` systems
//! headlessly; only the source and the frontend are mocked. Each case also
//! picks a [`Variant`] of the source: a clamp-to-ground (texturized) layer,
//! a `min_zoom` with a small descent budget, tiles that parse to no
//! features, a tight memory budget.
//!
//! # What it checks
//!
//! After every pass ([`Explorer::check_traversal`]) and once the view settled
//! ([`Explorer::check_settled`]); each failure message starts with the rule
//! it breaks:
//!
//! - `drawn-area-kept-until-replaced` (user-spec): no tile is drawn under a
//!   drawn ancestor; an area in view that was drawn stays drawn unless a
//!   finer tile there failed for good; drawn tiles are replaced by a coarser
//!   one only when it meets the error (or, texturized, is selected outside
//!   the frustum). A texturized layer draws the area outside the frustum
//!   too, up to the horizon.
//! - `settled-no-hole-no-double` and `settled-selection-is-sse-rule`
//!   (user-spec): once settled, the drawn tiles are the selection of
//!   [`Explorer::select`], which knows only the camera, the config and the
//!   tiles that failed for good, and they cover the view once (a tile with
//!   no features covers its area, an area the descent budget leaves out
//!   has none); where a
//!   selected tile failed for good, the tiles already drawn under it stay
//!   drawn until a selected tile above them is drawn.
//! - `idle-means-settled` (user-spec): a settled view asks for no pass.
//! - `within-budget-or-nothing-evictable` (user-spec): once settled over the
//!   memory budget, nothing pooled may be evicted and no tile is kept drawn
//!   only for an area outside the view (`drawn-area-kept-until-replaced`
//!   lets those go over the budget). It is also checked every pass: once
//!   eviction is needed (over the budget, or above its target while the load
//!   gate is closed) and no evictable pooled tile is left, the tiles kept
//!   only for an area outside the view go in that pass, unless usage is down
//!   to the target.
//! - `draws-only-selected` and `requests-only-selected` (proposed): a tile
//!   starts being drawn only when it or a tile above it is selected (and did
//!   not fail for good), and only selected tiles are fetched; a texturized
//!   tile may also stand in for selected tiles under it.
//!
//! The tile errors and the culling come from the tile geometry
//! ([`Explorer::probe`]); the selection rule built on them is the
//! expectation's own.
//!
//! The exploration also fails when no case reaches one of the [`Reach`]
//! states, where the invariants would hold vacuously.
//!
//! # Running
//!
//! `cargo test -p navara_vector_tile traversal_exploration` runs 128 cases
//! from a fixed seed. A deep run picks a new seed and prints it on failure:
//!
//! ```sh
//! PROPTEST_RNG_SEED=$(date +%s) PROPTEST_CASES=1024 cargo test -p navara_vector_tile traversal_exploration
//! ```
//!
//! A failing seed is saved under `proptest-regressions/` and replayed first;
//! commit it with the fix. The failure prints the shrunk actions after
//! `actions:`, with the tiles each indexed action resolved to.
//!
//! `NAVARA_UNMASK_KNOWN_BUGS=<Name>,…` (or `all`) stops masking the
//! [`KnownBug`]s named, e.g. to check a fix.
//!
//! # Retiring a known bug
//!
//! Fix the bug, then in the same change remove its `#[ignore]`, its
//! [`KnownBug`] variant and every mask that reads it.

use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;

use bevy_app::{App, PreUpdate, Update};
use bevy_ecs::prelude::*;
use navara_buffer_store::BufferStore;
use navara_camera::CameraFrustum;
use navara_core::{TileXYZ, WGS84_64};
use navara_feature_component::{
    id::FeatureId,
    render::{PointRenderInformation, RenderableFeature},
};
use navara_fog::{DynamicSseTerm, Fog};
use navara_frame::FrameManager;
use navara_globe::Globe;
use navara_layer::{LayerId, LayerStore};
use navara_math::Transform;
use navara_memory::{
    MemoryLedger, SsePressure, TileCost, eviction::is_evictable, reset_pending_evicted_gpu_bytes,
    update_sse_pressure,
};
use navara_occluder::ellipsoidal_occluder::EllipsoidalOccluder;
use navara_tile_component::{
    MinZoomDescentBudget, Tile, VectorTile, VectorTileQuadtree, terrain_height_for_tile,
};
use navara_window::Window;
use proptest::prelude::*;
use proptest::test_runner::{RngSeed, TestRunner};
use rustc_hash::{FxHashMap, FxHashSet};

use super::render::RenderedTile;
use super::system::keep_drawn_descendants_tests::{
    Coords, MockSource, Scene, look_with_fov, set_max_sse, setup, traversal_config, traverse,
};
use super::system::{clear_caches, enforce_memory_budget, update_tiles};
use super::traverse::raise_aabb;
use crate::{
    VectorTileFeatureMarker, VectorTileSourceResources,
    layer::{resource::LayerResources, tile_cache_manager::TileCacheManager},
    source::TileSource,
};

/// The seed of the PR runs; a deep run sets `PROPTEST_RNG_SEED`.
const PR_SEED: u64 = 1;
const PR_CASES: u32 = 128;
const MAX_ACTIONS: usize = 32;

const ROOT: Coords = (0, 0, 0);

#[derive(Clone, Copy, Debug)]
enum Action {
    /// Moves the camera above the equator at `lng * 45°`, through a 20° or
    /// 90° wide view.
    Look {
        lng: u8,
        narrow: bool,
    },
    /// Turns the camera by `steps * 5.625°` of longitude, keeping its view.
    Turn(i8),
    /// Picks a max SSE between the errors of two zoom levels.
    SetMaxSse(u8),
    /// The data of an outstanding request arrives.
    Deliver(u8),
    /// An outstanding request fails, for good.
    Fail(u8),
    /// The frontend builds the features of a selected tile...
    Construct(u8),
    /// ...and reports them rendered.
    Report(u8),
    Traverse,
    /// Passes with every request answered and every selected tile built and
    /// reported in between: the tiles of the view get drawn.
    Load,
    /// Like [`Action::Load`], but only the selected tiles arrive: the tiles a
    /// texturized layer requests to stand in for them keep loading.
    LoadSelected,
    /// Picks the next coarser max SSE and runs a pass: the tiles drawn hold
    /// the area while the coarser ones load.
    ZoomOut,
    /// Turns the camera away (by `steps * 11.25°`, or behind the horizon for
    /// 0), runs a pass, optionally answers every request, and turns back:
    /// the tiles holding drawn tiles leave the view and come back with their
    /// data in another state.
    Glance {
        steps: u8,
        deliver: bool,
    },
    /// [`Action::ZoomOut`], then [`Action::Glance`]: the coarser tiles leave
    /// and come back while they load.
    HoldAndGlance {
        steps: u8,
        deliver: bool,
    },
    /// Narrows the view, then [`Action::LoadSelected`] and
    /// [`Action::Glance`]: the tiles a texturized layer requests to stand in
    /// leave the frustum and come back while they load.
    LoadSelectedAndGlance {
        steps: u8,
        deliver: bool,
    },
    /// [`Action::ZoomOut`], then the coarser tile with the most drawn tiles
    /// under it fails for good.
    ZoomOutAndFail,
    /// With a tight budget, the application sets the budget to
    /// `(6 + n % 5) / 8` of the memory the tiles in use take (outside the
    /// retention pool), then a pass runs: lowering and raising it closes the
    /// load gate and holds it closed between the eviction target and the
    /// budget.
    SetBudget(u8),
}

fn action() -> impl Strategy<Value = Action> {
    prop_oneof![
        2 => (0..8u8, any::<bool>()).prop_map(|(lng, narrow)| Action::Look { lng, narrow }),
        2 => (-3..=3i8).prop_map(Action::Turn),
        2 => any::<u8>().prop_map(Action::SetMaxSse),
        3 => any::<u8>().prop_map(Action::Deliver),
        1 => any::<u8>().prop_map(Action::Fail),
        2 => any::<u8>().prop_map(Action::Construct),
        2 => any::<u8>().prop_map(Action::Report),
        4 => Just(Action::Traverse),
        1 => Just(Action::Load),
        1 => Just(Action::LoadSelected),
        1 => Just(Action::ZoomOut),
        1 => (0..4u8, any::<bool>()).prop_map(|(steps, deliver)| Action::Glance { steps, deliver }),
        2 => (0..4u8, any::<bool>())
            .prop_map(|(steps, deliver)| Action::HoldAndGlance { steps, deliver }),
        3 => (1..4u8, any::<bool>())
            .prop_map(|(steps, deliver)| Action::LoadSelectedAndGlance { steps, deliver }),
        1 => Just(Action::ZoomOutAndFail),
        2 => any::<u8>().prop_map(Action::SetBudget),
    ]
}

/// What the source and its layers are like, beyond the zoom range.
#[derive(Clone, Copy, Debug, Default)]
struct Variant {
    /// A clamp-to-ground layer: tiles outside the frustum are drawn without
    /// descending, and the globe's max SSE applies.
    texturized: bool,
    /// `min_zoom` 2 with a descent budget of [`MIN_ZOOM_BUDGET`] tiles.
    min_zoom_budget: bool,
    /// Some tiles parse to no features ([`Variant::is_empty_tile`]).
    empty_tiles: bool,
    /// A memory budget of [`TIGHT_BUDGET`] tiles, with the real load gate
    /// (nothing is delivered while it is closed) and eviction.
    tight_budget: bool,
}

/// Each built tile costs one byte.
const TIGHT_BUDGET: u64 = 16;

const MIN_ZOOM: usize = 2;
const MIN_ZOOM_BUDGET: usize = 2;

impl Variant {
    fn from_bits(bits: u8) -> Self {
        Self {
            texturized: bits & 1 != 0,
            min_zoom_budget: bits & 2 != 0,
            empty_tiles: bits & 4 != 0,
            tight_budget: bits & 8 != 0,
        }
    }

    /// The root among them.
    fn is_empty_tile(&self, (x, y, z): Coords) -> bool {
        self.empty_tiles && (x * 7 + y * 3 + z * 2) % 5 == 0
    }
}

/// A bug the exploration found and still masks, each with an `#[ignore]`d
/// test below that reproduces it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum KnownBug {
    /// `update_tiles` hands over to the root as soon as it loads, before its
    /// features are built (selected, or standing in for the selected tiles
    /// of a texturized layer): nothing is drawn until they are.
    RootTakesOverUnbuilt,
    /// A tile under a selected tile that failed for good starts being drawn.
    StartsUnderFailedTile,
    /// Once the `min_zoom` descent budget runs out, the tiles drawn under a
    /// tile it leaves out are dropped although they are in view.
    BudgetDropsDrawnTiles,
    /// A texturized tile falls back to drawing itself over drawn tiles under
    /// it while the selected tiles replacing them are not on screen yet.
    TexturizedFallbackOverDrawn,
}

impl KnownBug {
    const ALL: [KnownBug; 4] = [
        KnownBug::RootTakesOverUnbuilt,
        KnownBug::StartsUnderFailedTile,
        KnownBug::BudgetDropsDrawnTiles,
        KnownBug::TexturizedFallbackOverDrawn,
    ];
}

/// The set of masked [`KnownBug`]s.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct KnownBugs(u8);

impl KnownBugs {
    const NONE: KnownBugs = KnownBugs(0);

    /// Every known bug but those `NAVARA_UNMASK_KNOWN_BUGS` names (comma
    /// separated, or `all`).
    fn masked_unless_env() -> Self {
        let unmasked = std::env::var("NAVARA_UNMASK_KNOWN_BUGS").unwrap_or_default();
        let mut bugs = KnownBugs::NONE;
        for bug in KnownBug::ALL {
            let name = format!("{bug:?}");
            if !unmasked.split(',').any(|n| n == "all" || n == name) {
                bugs.0 |= 1 << bug as u8;
            }
        }
        bugs
    }

    fn all_masked() -> Self {
        KnownBugs(u8::MAX)
    }

    fn masks(self, bug: KnownBug) -> bool {
        self.0 & (1 << bug as u8) != 0
    }
}

/// The states a case reached, so that the invariants over them do not hold
/// vacuously.
#[derive(Clone, Copy, Default)]
struct Reach {
    /// A pass ended with tiles drawn.
    drawn: bool,
    /// Finer tiles replaced a drawn one.
    zoom_in_handover: bool,
    /// A coarser tile replaced drawn ones.
    zoom_out_handover: bool,
    /// Drawn tiles stayed while the coarser tile replacing them loads.
    zoom_out_hold: bool,
    /// A coarser tile was selected in the pass right after the tiles under
    /// it started being drawn.
    zoom_out_after_first_draw: bool,
    /// A tile in view failed for good.
    failed_in_view: bool,
    /// The memory budget pooled a tile.
    retained: bool,
    /// A tile was evicted from the source.
    evicted: bool,
    /// A tile stayed drawn under a selected tile that failed for good.
    kept_under_failed: bool,
    /// A texturized tile outside the frustum was drawn.
    drawn_outside_frustum: bool,
    /// A tile with drawn tiles under it left the view and came back while
    /// its own data was not requested, loading, loaded but not built, or
    /// built.
    reentered_unloaded: bool,
    reentered_loading: bool,
    reentered_ready_unbuilt: bool,
    reentered_built: bool,
    /// The `min_zoom` descent budget ran out on a tile in view.
    budget_spent_in_view: bool,
    /// A selected tile parsed to no features.
    empty_selected: bool,
    /// A tile kept drawn outside the view was evicted.
    off_view_evicted: bool,
    /// Settled above the eviction target and within the budget, with the
    /// load gate closed.
    settled_gate_closed_in_band: bool,
    /// Passes run, tiles that stopped being drawn, and the most in one pass.
    passes: usize,
    hidden: usize,
    hidden_max: usize,
}

impl Reach {
    const NAMES: [&'static str; 18] = [
        "drawn",
        "zoom_in_handover",
        "zoom_out_handover",
        "zoom_out_hold",
        "zoom_out_after_first_draw",
        "failed_in_view",
        "retained",
        "evicted",
        "kept_under_failed",
        "drawn_outside_frustum",
        "reentered_unloaded",
        "reentered_loading",
        "reentered_ready_unbuilt",
        "reentered_built",
        "budget_spent_in_view",
        "empty_selected",
        "off_view_evicted",
        "settled_gate_closed_in_band",
    ];

    fn flags(&self) -> [bool; 18] {
        [
            self.drawn,
            self.zoom_in_handover,
            self.zoom_out_handover,
            self.zoom_out_hold,
            self.zoom_out_after_first_draw,
            self.failed_in_view,
            self.retained,
            self.evicted,
            self.kept_under_failed,
            self.drawn_outside_frustum,
            self.reentered_unloaded,
            self.reentered_loading,
            self.reentered_ready_unbuilt,
            self.reentered_built,
            self.budget_spent_in_view,
            self.empty_selected,
            self.off_view_evicted,
            self.settled_gate_closed_in_band,
        ]
    }
}

/// The tiles the traversal should draw once settled.
struct Target {
    tiles: BTreeSet<Coords>,
    /// Selected tiles that failed for good: the tiles already drawn under
    /// them stay drawn until a selected tile above them is drawn, and no
    /// other tile under them starts being drawn.
    failed: FxHashSet<Coords>,
    /// Tiles in view left out because the `min_zoom` descent budget ran out.
    budget_culled: Vec<Coords>,
}

impl Target {
    fn is_under_failed(&self, c: Coords) -> bool {
        ancestors_and_self(c)
            .skip(1)
            .any(|a| self.failed.contains(&a))
    }
}

/// A tile's culling and error for the current camera, computed with the tile
/// geometry the traversal uses.
#[derive(Clone, Copy)]
struct Probe {
    occluded: bool,
    /// Outside the frustum, with the AABB raised by the feature height.
    outside: bool,
    /// Outside the frustum by the test a texturized traversal uses.
    outside_texturized: bool,
    sse: f64,
}

/// What the traversal should select under a tile, given the camera, the
/// config and the failed tiles, whatever has loaded.
enum Selection {
    Culled,
    NoData,
    Tiles(Vec<Coords>),
}

struct Explorer {
    app: App,
    scene: Scene,
    max_sse_choices: Vec<f64>,
    masked: KnownBugs,
    drawn: BTreeSet<Coords>,
    /// The tiles drawn before the last pass.
    previous: BTreeSet<Coords>,
    reach: Reach,
    /// [`Self::probe_full`] per tile, for the current camera.
    probes: RefCell<FxHashMap<Coords, Probe>>,
    variant: Variant,
    /// The camera's longitude in degrees and whether its view is narrow.
    camera: (f64, bool),
    /// The index of the max SSE in `max_sse_choices`.
    max_sse_choice: usize,
    /// Tiles in view with drawn tiles under them after the last pass.
    holding: BTreeSet<Coords>,
    /// Those of them that left the view since.
    left_view: BTreeSet<Coords>,
    /// The tiles the descent budget left out in the last pass.
    budget_culled_before: Vec<Coords>,
    /// Tiles kept drawn outside the view since they were last destroyed.
    ever_drawn_off_view: BTreeSet<Coords>,
}

impl Explorer {
    fn new(max_zoom: usize, budget: bool, masked: KnownBugs) -> Self {
        Self::with_variant(max_zoom, budget, Variant::default(), masked)
    }

    fn with_variant(max_zoom: usize, budget: bool, variant: Variant, masked: KnownBugs) -> Self {
        let (mut app, scene) = setup();
        let config = traversal_config(&mut app, &scene);
        config.max_zoom = max_zoom;
        if variant.texturized {
            config.has_clamp_to_ground = true;
            config.overscaled_max_zoom = max_zoom;
        }
        if variant.min_zoom_budget {
            config.min_zoom = MIN_ZOOM;
            app.world_mut()
                .get_mut::<TileCacheManager>(scene.tile_cache_manager)
                .unwrap()
                .min_zoom_descent = MinZoomDescentBudget::with_limit(MIN_ZOOM_BUDGET);
        }
        app.init_resource::<LayerStore>();
        app.insert_resource(MemoryLedger {
            budget_bytes: if variant.tight_budget {
                Some(TIGHT_BUDGET)
            } else {
                budget.then_some(u64::MAX)
            },
            ..Default::default()
        });
        app.world_mut().spawn(LayerResources {
            layer_id: "test".to_string(),
            source: scene.source,
            quadtree: scene.quadtree,
            tile_cache_manager: scene.tile_cache_manager,
        });
        // The SSE degrade is not modelled: the pressure only drives the load
        // gate.
        {
            let mut ledger = app.world_mut().resource_mut::<MemoryLedger>();
            ledger.max_sse_multiplier = ledger.min_sse_multiplier;
        }
        // At the start of each frame, as `MemoryPlugin` does.
        app.add_systems(PreUpdate, reset_pending_evicted_gpu_bytes);
        app.add_systems(
            Update,
            (
                clear_caches,
                enforce_memory_budget,
                sync_retained_bytes,
                update_sse_pressure,
            )
                .chain()
                .after(update_tiles),
        );
        let mut explorer = Self {
            app,
            scene,
            max_sse_choices: vec![],
            masked,
            drawn: BTreeSet::new(),
            previous: BTreeSet::new(),
            reach: Reach::default(),
            probes: RefCell::default(),
            variant,
            camera: (0., false),
            max_sse_choice: 0,
            holding: BTreeSet::new(),
            left_view: BTreeSet::new(),
            budget_culled_before: vec![],
            ever_drawn_off_view: BTreeSet::new(),
        };
        explorer.mock().loaded = Some(FxHashSet::default());
        explorer.max_sse_choices = explorer.level_thresholds(max_zoom);
        let max_sse = explorer.config().1;
        explorer.set_max_sse(max_sse);
        explorer
    }

    /// Sets the max SSE the traversal uses: the source's, or the globe's for
    /// a texturized layer.
    fn set_max_sse(&mut self, max_sse: f64) {
        set_max_sse(&mut self.app, &self.scene, max_sse);
        self.app.world_mut().resource_mut::<Globe>().max_sse = max_sse as f32;
    }

    fn look(&mut self, lng: f64, narrow: bool) {
        self.camera = (lng, narrow);
        look_with_fov(
            &mut self.app,
            &self.scene,
            lng,
            if narrow { 20. } else { 90. },
        );
        self.probes.borrow_mut().clear();
    }

    fn mock(&mut self) -> &mut MockSource {
        self.app
            .world_mut()
            .get_mut::<TileSource>(self.scene.source)
            .unwrap()
            .into_inner()
            .0
            .as_any_mut()
            .downcast_mut::<MockSource>()
            .unwrap()
    }

    /// Max SSE values that select each zoom level in view, from the errors
    /// seen from the initial camera.
    fn level_thresholds(&self, max_zoom: usize) -> Vec<f64> {
        let mut level_max = vec![0f64; max_zoom + 2];
        for c in all_tiles(max_zoom + 1) {
            if let Some(sse) = self.probe(c) {
                level_max[c.2] = level_max[c.2].max(sse);
            }
        }
        let mut choices = vec![0.];
        for z in (0..=max_zoom).rev() {
            choices.push((level_max[z] * level_max[z + 1]).sqrt());
        }
        choices.push(level_max[0] * 2.);
        choices
    }

    /// The tile's error, or `None` when it is out of view, by the frustum
    /// test the traversal uses for the layer.
    fn probe(&self, c: Coords) -> Option<f64> {
        let probe = self.probe_full(c);
        let outside = if self.variant.texturized {
            probe.outside_texturized
        } else {
            probe.outside
        };
        (!probe.occluded && !outside).then_some(probe.sse)
    }

    fn probe_full(&self, c: Coords) -> Probe {
        if let Some(probe) = self.probes.borrow().get(&c) {
            return *probe;
        }
        let probe = self.compute_probe(c);
        self.probes.borrow_mut().insert(c, probe);
        probe
    }

    fn compute_probe(&self, (x, y, z): Coords) -> Probe {
        let world = self.app.world();
        let frustum = world.get::<CameraFrustum>(self.scene.camera).unwrap();
        let camera = world.get::<Transform>(self.scene.camera).unwrap();
        let occluder = world
            .get::<EllipsoidalOccluder>(self.scene.occluder)
            .unwrap();
        let tc = world
            .get::<TileCacheManager>(self.scene.tile_cache_manager)
            .unwrap();
        let coords = TileXYZ { x, y, z };
        let (max_height, min_height) =
            terrain_height_for_tile(world.resource(), world.resource(), coords);
        let mut tile = VectorTile::new(coords, 0., 0.);
        tile.update_heights(max_height, min_height);
        tile.update_tile_occludee_point(&WGS84_64, occluder);
        let occluded = tile.is_occluded_by_horizon(occluder);
        let outside = !tile.is_root()
            && !frustum.intersection_with_aabb(&raise_aabb(tile.aabb(), tc.feature_height_margin));
        let outside_texturized = !tile.intersect_with_camera_frustum(frustum);
        let distance = tile.calc_distance_from_camera(camera, &WGS84_64);
        let fog = Fog {
            enabled: false,
            density: 0.,
            sse_factor: 1.,
        };
        let sse = tile.calc_sse(
            frustum,
            world.resource::<Window>(),
            &WGS84_64,
            64.,
            distance,
            &fog,
            DynamicSseTerm::NONE,
        );
        Probe {
            occluded,
            outside,
            outside_texturized,
            sse,
        }
    }

    fn config(&self) -> (usize, f64) {
        let config = self
            .app
            .world()
            .get::<VectorTileSourceResources>(self.scene.source)
            .unwrap()
            .source_id
            .traversal_config();
        (config.max_zoom, config.max_sse() as f64)
    }

    fn min_zoom(&self) -> usize {
        if self.variant.min_zoom_budget {
            MIN_ZOOM
        } else {
            0
        }
    }

    /// The reference selection: a tile meeting the error is drawn, else its
    /// children are, except where no child in view has data (each is past
    /// `max_zoom` or failed), where the tile is the finest data. A tile under
    /// `min_zoom` is never drawn; descending from one that meets the error
    /// takes one of the `budget` tiles, in traversal order, and once they
    /// are spent it is left out. A texturized tile outside the frustum is
    /// drawn without descending.
    fn select(
        &self,
        c: Coords,
        failed: &FxHashSet<Coords>,
        budget: &mut usize,
        out: &mut Target,
    ) -> Selection {
        let (max_zoom, max_sse) = self.config();
        if c.2 > max_zoom {
            return Selection::NoData;
        }
        let probe = self.probe_full(c);
        let leaf = |out: &mut Target| {
            if failed.contains(&c) {
                out.failed.insert(c);
                Selection::NoData
            } else {
                Selection::Tiles(vec![c])
            }
        };
        if probe.occluded {
            return Selection::Culled;
        }
        if self.variant.texturized {
            if probe.outside_texturized {
                return leaf(out);
            }
        } else if probe.outside {
            return Selection::Culled;
        }
        let meets_error = probe.sse <= max_sse;
        if meets_error && c.2 >= self.min_zoom() {
            return leaf(out);
        }
        if meets_error {
            if *budget == 0 {
                if self.is_in_view(c) {
                    out.budget_culled.push(c);
                }
                return Selection::Culled;
            }
            *budget -= 1;
        }
        let (mut without_data, mut with_data) = (false, false);
        let mut tiles = vec![];
        for child in children(c) {
            match self.select(child, failed, budget, out) {
                Selection::NoData => without_data = true,
                Selection::Culled => {}
                Selection::Tiles(t) => {
                    with_data = true;
                    tiles.extend(t);
                }
            }
        }
        if without_data && !with_data {
            if c.2 < self.min_zoom() {
                return Selection::Tiles(vec![]);
            }
            return leaf(out);
        }
        Selection::Tiles(tiles)
    }

    /// The selected tiles, and the selected tiles that failed for good.
    fn selection(&mut self) -> Target {
        let failed = self.mock().failed.clone();
        let mut budget = if self.variant.min_zoom_budget {
            MIN_ZOOM_BUDGET
        } else {
            usize::MAX
        };
        let mut target = Target {
            tiles: BTreeSet::new(),
            failed: FxHashSet::default(),
            budget_culled: vec![],
        };
        if let Selection::Tiles(tiles) = self.select(ROOT, &failed, &mut budget, &mut target) {
            target.tiles = tiles.into_iter().collect();
        }
        target
    }

    /// Whether the tile and every tile above it pass the culling.
    fn is_in_view(&self, c: Coords) -> bool {
        ancestors_and_self(c).all(|a| self.probe(a).is_some())
    }

    /// Whether the layer draws the tile's area: in view, or for a texturized
    /// layer, anywhere before the horizon (the drape covers terrain outside
    /// the frustum too).
    fn is_drawn_area(&self, c: Coords) -> bool {
        if self.variant.texturized {
            ancestors_and_self(c).all(|a| !self.probe_full(a).occluded)
        } else {
            self.is_in_view(c)
        }
    }

    fn rendered_tiles(&self) -> Vec<(Coords, Entity)> {
        let world = self.app.world();
        let tc = world
            .get::<TileCacheManager>(self.scene.tile_cache_manager)
            .unwrap();
        let qt = world
            .get::<VectorTileQuadtree>(self.scene.quadtree)
            .unwrap();
        let mut tiles: Vec<(Coords, Entity)> = tc
            .rendered_tile_caches
            .iter()
            .map(|(handle, e)| {
                let c = qt.qt.get(*handle).unwrap().coords;
                ((c.x, c.y, c.z), *e)
            })
            .collect();
        tiles.sort();
        tiles
    }

    fn renderables(&self, tile: Entity) -> Vec<Entity> {
        let world = self.app.world();
        world
            .get::<RenderedTile>(tile)
            .and_then(|t| t.feature_ids.as_ref())
            .map(|ids| {
                ids.iter()
                    .map(|id| world.get::<FeatureId>(*id).unwrap().0.unwrap())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn drawn_tiles(&self) -> BTreeSet<Coords> {
        let world = self.app.world();
        self.rendered_tiles()
            .into_iter()
            .filter(|(_, e)| {
                self.renderables(*e).iter().any(|r| {
                    world
                        .get::<RenderableFeature>(*r)
                        .is_some_and(|f| f.is_active())
                })
            })
            .map(|(c, _)| c)
            .collect()
    }

    fn outstanding(&mut self) -> Vec<Coords> {
        let mock = self.mock();
        let loaded = mock.loaded.as_ref().unwrap();
        let requested: BTreeSet<Coords> = mock.requests.iter().map(|(c, _)| *c).collect();
        requested
            .into_iter()
            .filter(|c| {
                !loaded.contains(c) && !mock.failed.contains(c) && !mock.cancelled.contains(c)
            })
            .collect()
    }

    fn unbuilt(&self) -> Vec<(Coords, Entity)> {
        let world = self.app.world();
        self.rendered_tiles()
            .into_iter()
            .filter(|(_, e)| world.get::<RenderedTile>(*e).unwrap().feature_ids.is_none())
            .collect()
    }

    fn unreported(&self) -> Vec<(Coords, Entity)> {
        let world = self.app.world();
        self.rendered_tiles()
            .into_iter()
            .flat_map(|(c, e)| self.renderables(e).into_iter().map(move |r| (c, r)))
            .filter(|(_, r)| !world.get::<RenderableFeature>(*r).unwrap().is_rendered())
            .collect()
    }

    fn construct(&mut self, tile: Entity) {
        let coords = self
            .rendered_tiles()
            .into_iter()
            .find(|(_, e)| *e == tile)
            .unwrap()
            .0;
        let world = self.app.world_mut();
        world
            .entity_mut(tile)
            .insert(TileCost { cpu: 0, gpu_est: 1 });
        if self.variant.is_empty_tile(coords) {
            world.get_mut::<RenderedTile>(tile).unwrap().feature_ids = Some(vec![]);
            return;
        }
        let renderable = world
            .spawn(RenderableFeature::Point {
                coordinates: Default::default(),
                crs: Default::default(),
                active: false,
                material: Default::default(),
                transform: Default::default(),
                feature_id: Entity::PLACEHOLDER,
                render_info: PointRenderInformation::default(),
                geometry: Default::default(),
                feature_batch_id: 0,
                batch_length: 0,
            })
            .id();
        let feature = world
            .spawn((
                FeatureId(Some(renderable)),
                LayerId("test".to_string()),
                VectorTileFeatureMarker,
            ))
            .id();
        world.get_mut::<RenderedTile>(tile).unwrap().feature_ids = Some(vec![feature]);
    }

    fn report(&mut self, renderable: Entity) {
        let mut feature = self
            .app
            .world_mut()
            .get_mut::<RenderableFeature>(renderable)
            .unwrap();
        if let RenderableFeature::Point { render_info, .. } = &mut *feature {
            render_info.is_rendered = true;
        }
    }

    /// Answers every outstanding request, and builds and reports every
    /// selected tile.
    fn answer_everything(&mut self) {
        self.deliver_everything();
        self.build_everything();
    }

    fn deliver_everything(&mut self) {
        for c in self.outstanding() {
            self.deliver(c);
        }
    }

    /// The data of `c` arrives, unless the load gate is closed: no request
    /// is dispatched then.
    fn deliver(&mut self, c: Coords) {
        if !self.is_load_gate_closed() {
            self.mock().loaded.as_mut().unwrap().insert(c);
        }
    }

    fn is_load_gate_closed(&self) -> bool {
        self.app.world().resource::<SsePressure>().load_gate_closed
    }

    /// Pooled tiles past their grace.
    fn evictable_pooled(&self) -> usize {
        let world = self.app.world();
        let frame = world.resource::<FrameManager>().rendered_frame();
        world
            .get::<TileCacheManager>(self.scene.tile_cache_manager)
            .unwrap()
            .retained
            .values()
            .filter(|entry| is_evictable(entry.retained_at, frame))
            .count()
    }

    fn hard_usage(&self) -> u64 {
        let world = self.app.world();
        world
            .resource::<MemoryLedger>()
            .hard_usage(world.resource::<BufferStore>().total_bytes() as u64)
    }

    fn usage(&self) -> u64 {
        let world = self.app.world();
        world
            .resource::<MemoryLedger>()
            .usage(world.resource::<BufferStore>().total_bytes() as u64)
    }

    /// Whether `enforce_memory_budget` evicts: over the budget, or above
    /// the eviction target while the load gate is closed.
    fn needs_eviction(&self) -> bool {
        self.app
            .world()
            .resource::<MemoryLedger>()
            .needs_eviction(self.usage(), self.is_load_gate_closed())
    }

    /// Drawn tiles a texturized layer keeps under a tile outside the
    /// frustum, though they are not selected.
    fn kept_off_view(&self, target: &BTreeSet<Coords>) -> BTreeSet<Coords> {
        self.drawn
            .iter()
            .copied()
            .filter(|c| {
                self.variant.texturized
                    && !target.contains(c)
                    && self.is_drawn_area(*c)
                    && ancestors_and_self(*c)
                        .skip(1)
                        .any(|a| self.probe_full(a).outside_texturized)
            })
            .collect()
    }

    fn build_everything(&mut self) {
        for (_, tile) in self.unbuilt() {
            self.construct(tile);
        }
        for (_, renderable) in self.unreported() {
            self.report(renderable);
        }
    }

    /// Applies the action and returns it with the tile an index picked.
    fn apply(&mut self, action: &Action) -> Result<String, String> {
        let pick = |items: usize, i: u8| (items > 0).then(|| i as usize % items);
        let picked = |c: Option<Coords>| match c {
            Some(c) => format!("({c:?})"),
            None => "(none)".to_string(),
        };
        let resolved = match *action {
            Action::Look { lng, narrow } => {
                self.look(lng as f64 * 45., narrow);
                format!("{action:?}")
            }
            Action::Turn(steps) => {
                let (lng, narrow) = self.camera;
                self.look(lng + steps as f64 * 5.625, narrow);
                format!("{action:?}")
            }
            Action::SetMaxSse(i) => {
                let i = i as usize % self.max_sse_choices.len();
                self.max_sse_choice = i;
                self.set_max_sse(self.max_sse_choices[i]);
                format!("SetMaxSse({i})")
            }
            Action::LoadSelected => {
                self.load_selected()?;
                "LoadSelected".to_string()
            }
            Action::LoadSelectedAndGlance { steps, deliver } => {
                self.look(self.camera.0, true);
                self.load_selected()?;
                self.glance(steps, deliver)?;
                format!("{action:?}")
            }
            Action::ZoomOut => format!("ZoomOut(to {})", self.zoom_out()?),
            Action::SetBudget(n) => {
                if self.variant.tight_budget {
                    let budget = (self.hard_usage() * (6 + n as u64 % 5) / 8).max(1);
                    self.app
                        .world_mut()
                        .resource_mut::<MemoryLedger>()
                        .budget_bytes = Some(budget);
                    self.traverse_and_check()?;
                    format!("SetBudget(to {budget})")
                } else {
                    "SetBudget(none)".to_string()
                }
            }
            Action::ZoomOutAndFail => {
                let i = self.zoom_out()?;
                let drawn = self.drawn.clone();
                let c = self.outstanding().into_iter().max_by_key(|c| {
                    drawn
                        .iter()
                        .filter(|d| ancestors_and_self(**d).skip(1).any(|a| a == *c))
                        .count()
                });
                if let Some(c) = c {
                    self.reach.failed_in_view |= self.is_in_view(c);
                    self.mock().failed.insert(c);
                }
                format!("ZoomOutAndFail(to {i}, {})", picked(c))
            }
            Action::Glance { steps, deliver } => {
                self.glance(steps, deliver)?;
                format!("{action:?}")
            }
            Action::HoldAndGlance { steps, deliver } => {
                let i = self.zoom_out()?;
                self.glance(steps, deliver)?;
                format!("{action:?}(to {i})")
            }
            Action::Deliver(i) => {
                let outstanding = self.outstanding();
                let c = pick(outstanding.len(), i).map(|i| outstanding[i]);
                if let Some(c) = c {
                    self.deliver(c);
                }
                format!("Deliver{}", picked(c))
            }
            Action::Fail(i) => {
                let outstanding = self.outstanding();
                let c = pick(outstanding.len(), i).map(|i| outstanding[i]);
                if let Some(c) = c {
                    self.reach.failed_in_view |= self.is_in_view(c);
                    self.mock().failed.insert(c);
                }
                format!("Fail{}", picked(c))
            }
            Action::Construct(i) => {
                let unbuilt = self.unbuilt();
                let tile = pick(unbuilt.len(), i).map(|i| unbuilt[i]);
                if let Some((_, e)) = tile {
                    self.construct(e);
                }
                format!("Construct{}", picked(tile.map(|(c, _)| c)))
            }
            Action::Report(i) => {
                let unreported = self.unreported();
                let renderable = pick(unreported.len(), i).map(|i| unreported[i]);
                if let Some((_, r)) = renderable {
                    self.report(r);
                }
                format!("Report{}", picked(renderable.map(|(c, _)| c)))
            }
            Action::Traverse => {
                self.traverse_and_check()?;
                "Traverse".to_string()
            }
            Action::Load => {
                self.traverse_and_check()?;
                self.deliver_everything();
                self.traverse_and_check()?;
                self.build_everything();
                self.traverse_and_check()?;
                "Load".to_string()
            }
        };
        Ok(resolved)
    }

    fn load_selected(&mut self) -> Result<(), String> {
        self.traverse_and_check()?;
        let target = self.selection().tiles;
        for c in self.outstanding() {
            if target.contains(&c) {
                self.deliver(c);
            }
        }
        self.traverse_and_check()?;
        self.build_everything();
        self.traverse_and_check()
    }

    fn zoom_out(&mut self) -> Result<usize, String> {
        let i = (self.max_sse_choice + 1).min(self.max_sse_choices.len() - 1);
        self.max_sse_choice = i;
        self.set_max_sse(self.max_sse_choices[i]);
        self.traverse_and_check()?;
        Ok(i)
    }

    fn glance(&mut self, steps: u8, deliver: bool) -> Result<(), String> {
        let (lng, narrow) = self.camera;
        let turn = if steps == 0 {
            180.
        } else {
            steps as f64 * 11.25
        };
        self.look(lng + turn, narrow);
        self.traverse_and_check()?;
        if deliver {
            self.deliver_everything();
        }
        self.look(lng, narrow);
        Ok(())
    }

    fn needs_update(&self) -> bool {
        self.app
            .world()
            .get::<TileCacheManager>(self.scene.tile_cache_manager)
            .unwrap()
            .needs_update
    }

    /// Built tiles that parse to no features.
    fn empty_built(&self) -> BTreeSet<Coords> {
        let world = self.app.world();
        self.rendered_tiles()
            .into_iter()
            .filter(|(_, e)| {
                world
                    .get::<RenderedTile>(*e)
                    .unwrap()
                    .feature_ids
                    .as_ref()
                    .is_some_and(|ids| ids.is_empty())
            })
            .map(|(c, _)| c)
            .collect()
    }

    /// Records the tiles holding drawn tiles that left the view, and the
    /// state of their data when they come back.
    fn record_reentries(&mut self) {
        for c in std::mem::take(&mut self.holding) {
            if !self.is_in_view(c) {
                self.left_view.insert(c);
            }
        }
        let back: Vec<Coords> = self
            .left_view
            .iter()
            .copied()
            .filter(|c| self.is_in_view(*c))
            .collect();
        if back.is_empty() {
            return;
        }
        let built: BTreeSet<Coords> = self
            .rendered_tiles()
            .into_iter()
            .filter(|(_, e)| {
                self.app
                    .world()
                    .get::<RenderedTile>(*e)
                    .unwrap()
                    .feature_ids
                    .is_some()
            })
            .map(|(c, _)| c)
            .collect();
        let outstanding = self.outstanding();
        for c in back {
            self.left_view.remove(&c);
            if built.contains(&c) {
                self.reach.reentered_built = true;
            } else if self.mock().loaded.as_ref().unwrap().contains(&c) {
                self.reach.reentered_ready_unbuilt = true;
            } else if outstanding.contains(&c) {
                self.reach.reentered_loading = true;
            } else {
                self.reach.reentered_unloaded = true;
            }
        }
    }

    fn traverse_and_check(&mut self) -> Result<(), String> {
        self.record_reentries();
        let needed_eviction = self.needs_eviction();
        let requested_before = self.mock().requests.len();
        traverse(&mut self.app, &self.scene);
        // Asking again for a loaded or failed tile fetches nothing.
        let mock = self.mock();
        let loaded = mock.loaded.as_ref().unwrap();
        let requested: BTreeSet<Coords> = mock.requests[requested_before..]
            .iter()
            .map(|(c, _)| *c)
            .filter(|c| !loaded.contains(c) && !mock.failed.contains(c))
            .collect();
        let target = self.selection();
        let after = self.drawn_tiles();
        let before = std::mem::replace(&mut self.drawn, after.clone());
        let hidden = before.difference(&after).count();
        self.reach.passes += 1;
        self.reach.hidden += hidden;
        self.reach.hidden_max = self.reach.hidden_max.max(hidden);
        let previous = std::mem::replace(&mut self.previous, before.clone());
        self.record_reach(&previous, &before, &after, &target);
        self.holding = after
            .iter()
            .flat_map(|c| ancestors_and_self(*c).skip(1))
            .filter(|a| self.is_in_view(*a))
            .collect();
        // An empty tile reads as drawn whatever its target: it covers its
        // area where it is selected or stands in for selected tiles.
        let shown_empty: BTreeSet<Coords> = self
            .empty_built()
            .into_iter()
            .filter(|c| target.tiles.contains(c) || self.is_texturized_fallback(*c, &target.tiles))
            .collect();
        self.reach.empty_selected |= !shown_empty.is_empty();
        let failed = self.mock().failed.clone();
        let rendered: BTreeSet<Coords> =
            self.rendered_tiles().into_iter().map(|(c, _)| c).collect();
        self.reach.off_view_evicted |= self
            .ever_drawn_off_view
            .iter()
            .any(|c| !rendered.contains(c));
        self.ever_drawn_off_view.retain(|c| rendered.contains(c));
        self.ever_drawn_off_view
            .extend(self.kept_off_view(&target.tiles));
        let result = self.check_traversal(
            &before,
            &after,
            &shown_empty,
            &requested,
            &target,
            &failed,
            needed_eviction,
        );
        self.budget_culled_before = target.budget_culled.clone();
        result
    }

    fn record_reach(
        &mut self,
        previous: &BTreeSet<Coords>,
        before: &BTreeSet<Coords>,
        after: &BTreeSet<Coords>,
        target: &Target,
    ) {
        let is_under = |c: Coords, a: Coords| ancestors_and_self(c).skip(1).any(|p| p == a);
        let has_selected_ancestor = |c: &Coords| {
            ancestors_and_self(*c)
                .skip(1)
                .any(|a| target.tiles.contains(&a))
        };
        let started: Vec<Coords> = after.difference(before).copied().collect();
        let drawn_outside_frustum = self.variant.texturized
            && after.iter().any(|c| {
                let probe = self.probe_full(*c);
                probe.outside_texturized && !probe.occluded
            });
        let reach = &mut self.reach;
        reach.drawn_outside_frustum |= drawn_outside_frustum;
        reach.drawn |= !after.is_empty();
        reach.zoom_in_handover |= started
            .iter()
            .any(|c| before.iter().any(|d| is_under(*c, *d)));
        reach.zoom_out_handover |= started
            .iter()
            .any(|c| before.iter().any(|d| is_under(*d, *c)));
        reach.zoom_out_hold |= before.intersection(after).any(has_selected_ancestor);
        reach.zoom_out_after_first_draw |= before.difference(previous).any(has_selected_ancestor);
        reach.kept_under_failed |= after.iter().any(|c| target.is_under_failed(*c));
        reach.budget_spent_in_view |= !target.budget_culled.is_empty();
        let world = self.app.world();
        reach.retained |= !world
            .get::<TileCacheManager>(self.scene.tile_cache_manager)
            .unwrap()
            .retained
            .is_empty();
    }

    /// A texturized tile stands in for selected tiles under it while they
    /// load, so it may be requested and drawn.
    fn is_texturized_fallback(&self, c: Coords, target: &BTreeSet<Coords>) -> bool {
        self.variant.texturized
            && target
                .iter()
                .any(|t| ancestors_and_self(*t).skip(1).any(|a| a == c))
    }

    /// Invariants that hold after every pass.
    #[allow(clippy::too_many_arguments)]
    fn check_traversal(
        &self,
        before: &BTreeSet<Coords>,
        after: &BTreeSet<Coords>,
        // Selected tiles that parse to no features: they cover their area.
        shown_empty: &BTreeSet<Coords>,
        requested: &BTreeSet<Coords>,
        selection: &Target,
        failed: &FxHashSet<Coords>,
        // The memory budget needed eviction when the pass started.
        needed_eviction: bool,
    ) -> Result<(), String> {
        let target = &selection.tiles;
        for &c in after {
            if let Some(a) = ancestors_and_self(c).skip(1).find(|a| after.contains(a)) {
                return Err(format!(
                    "drawn-area-kept-until-replaced: {c:?} is drawn under the drawn {a:?}"
                ));
            }
        }
        // A tile starts being drawn over drawn tiles still in view only when
        // it meets the error, on a zoom-out, or when it is selected and they
        // are kept under a selected tile that failed for good.
        let (max_zoom, max_sse) = self.config();
        for &p in after.difference(before) {
            let covered: Vec<Coords> = before
                .iter()
                .copied()
                .filter(|d| {
                    *d != p && ancestors_and_self(*d).any(|a| a == p) && self.is_drawn_area(*d)
                })
                .collect();
            let replaces_kept_tiles =
                target.contains(&p) && covered.iter().all(|d| selection.is_under_failed(*d));
            // A texturized tile outside the frustum is selected whatever its
            // error.
            let is_selected_outside_frustum = self.variant.texturized
                && target.contains(&p)
                && self.probe_full(p).outside_texturized;
            let texturized_fallback_over_drawn =
                self.masked.masks(KnownBug::TexturizedFallbackOverDrawn)
                    && self.is_texturized_fallback(p, target);
            if !covered.is_empty()
                && self.probe(p).is_none_or(|sse| sse > max_sse)
                && !replaces_kept_tiles
                && !is_selected_outside_frustum
                && !texturized_fallback_over_drawn
            {
                return Err(format!(
                    "drawn-area-kept-until-replaced: {p:?} replaced finer drawn tiles: {before:?}"
                ));
            }
        }
        // Tiles under a selected one may fill its area while it loads.
        for &c in after.difference(before) {
            let starts_under_failed_tile =
                self.masked.masks(KnownBug::StartsUnderFailedTile) && selection.is_under_failed(c);
            if !ancestors_and_self(c).any(|a| target.contains(&a))
                && !starts_under_failed_tile
                && !self.is_texturized_fallback(c, target)
            {
                return Err(format!(
                    "draws-only-selected: {c:?} started being drawn, but the selection is {target:?}"
                ));
            }
        }
        for c in requested {
            if !target.contains(c) && !self.is_texturized_fallback(*c, target) {
                return Err(format!(
                    "requests-only-selected: {c:?} was requested, but the selection is {target:?}"
                ));
            }
        }
        // The root is selected, or stands in for the selected tiles of a
        // texturized layer.
        let root_takes_over_unbuilt = self.masked.masks(KnownBug::RootTakesOverUnbuilt)
            && after.is_empty()
            && (target.len() == 1 && target.contains(&ROOT)
                || self.is_texturized_fallback(ROOT, target)
                    && self.unbuilt().iter().any(|(c, _)| *c == ROOT));
        if root_takes_over_unbuilt {
            return Ok(());
        }
        // `within-budget-or-nothing-evictable`, every pass: once eviction is
        // needed and no evictable pooled tile is left, the tiles kept only
        // for an area outside the view go in the same pass.
        // `enforce_memory_budget` evicting them right after the pooled tiles
        // is an implementation detail this check uses to make the rule
        // observable every pass.
        if needed_eviction {
            let usage = self.usage();
            let target_bytes = self.app.world().resource::<MemoryLedger>().evict_target();
            let kept = self.kept_off_view(target);
            if usage > target_bytes && self.evictable_pooled() == 0 && !kept.is_empty() {
                return Err(format!(
                    "within-budget-or-nothing-evictable (per pass): eviction is needed (usage {usage}, target {target_bytes}, load gate closed: {}), but {kept:?} stay kept outside the view",
                    self.is_load_gate_closed()
                ));
            }
        }
        let covers =
            |drawn: &BTreeSet<Coords>, c: Coords| ancestors_and_self(c).find(|a| drawn.contains(a));
        let shown: BTreeSet<Coords> = after.union(shown_empty).copied().collect();
        for c in all_tiles(max_zoom).filter(|c| c.2 == max_zoom) {
            // The tiles under one left out stay drawn for the pass the cache
            // keeps unvisited tiles.
            let budget_drops_drawn_tiles = self.masked.masks(KnownBug::BudgetDropsDrawnTiles)
                && ancestors_and_self(c).any(|a| {
                    selection.budget_culled.contains(&a) || self.budget_culled_before.contains(&a)
                });
            // Tiles kept outside the view may be evicted over the budget.
            let evicted_off_view = needed_eviction && !self.is_in_view(c);
            if let Some(was) = covers(before, c)
                && covers(&shown, c).is_none()
                && !budget_drops_drawn_tiles
                && !evicted_off_view
                && !ancestors_and_self(c)
                    .take_while(|a| *a != was)
                    .any(|a| failed.contains(&a))
                && self.is_drawn_area(c)
            {
                return Err(format!(
                    "drawn-area-kept-until-replaced: {c:?} in the drawn area lost its drawn {was:?}; drawn now: {after:?}"
                ));
            }
        }
        Ok(())
    }

    /// Answers everything until the view settles, then compares the drawn
    /// tiles with the selection.
    fn check_settled(&mut self) -> Result<(), String> {
        let mut gate_closed = false;
        for _ in 0..12 {
            self.traverse_and_check()?;
            gate_closed |= self.is_load_gate_closed();
            self.answer_everything();
        }
        self.traverse_and_check()?;
        if gate_closed || self.needs_eviction() {
            // The load gate held data back, so the selection may not be
            // drawn: what is pooled or kept outside the view goes first, over
            // a few passes.
            for _ in 0..4 {
                self.traverse_and_check()?;
            }
            let evictable = self.evictable_pooled();
            let target = self.selection().tiles;
            let off_view = self.kept_off_view(&target);
            let ledger = self.app.world().resource::<MemoryLedger>();
            let (budget, target) = (ledger.budget_bytes.unwrap(), ledger.evict_target());
            let usage = self.usage();
            let gate_closed = self.is_load_gate_closed();
            self.reach.settled_gate_closed_in_band |=
                gate_closed && usage > target && usage <= budget;
            // Eviction runs over the budget, and down to the target while the
            // gate is closed: then nothing it may evict is left.
            if self.needs_eviction() && (evictable > 0 || !off_view.is_empty()) {
                return Err(format!(
                    "within-budget-or-nothing-evictable: usage {usage} (budget {budget}, target {target}, load gate closed: {gate_closed}) with {evictable} evictable pooled tiles and {off_view:?} kept outside the view"
                ));
            }
            return Ok(());
        }
        let selection = self.selection();
        let target = &selection.tiles;
        let failed = self.mock().failed.clone();
        // Tiles already drawn under a failed selected tile stay drawn while
        // no selected tile above them is (no tile is drawn under a drawn
        // one); the per-pass `draws-only-selected` checks that none starts
        // there.
        let is_selected_or_kept = |c: &Coords| target.contains(c) || selection.is_under_failed(*c);
        let empty_built = self.empty_built();
        let shown: BTreeSet<Coords> = self
            .drawn
            .iter()
            .copied()
            .chain(empty_built.intersection(target).copied())
            .collect();
        if !target.is_subset(&shown) || !self.drawn.iter().all(is_selected_or_kept) {
            return Err(format!(
                "settled-selection-is-sse-rule: settled on {:?}, but the selection is {target:?} with the failed {:?}",
                self.drawn, selection.failed
            ));
        }
        let (max_zoom, _) = self.config();
        for c in all_tiles(max_zoom).filter(|c| c.2 == max_zoom) {
            let drawn_over = ancestors_and_self(c).filter(|a| shown.contains(a)).count();
            // Failed for good, or left out once the descent budget ran out.
            let has_no_data = ancestors_and_self(c)
                .any(|a| failed.contains(&a) || selection.budget_culled.contains(&a));
            if drawn_over > 1 || (drawn_over == 0 && !has_no_data && self.is_drawn_area(c)) {
                return Err(format!(
                    "settled-no-hole-no-double: {c:?} is drawn by {drawn_over} tiles: {:?}",
                    self.drawn
                ));
            }
        }
        if self.needs_update() {
            return Err("idle-means-settled: the settled view asks for another pass".to_string());
        }
        self.reach.evicted |= self.mock().evictions > 0;
        Ok(())
    }
}

/// Mirrors `navara_ecs::memory::sync_retained_bytes` for the vector pools:
/// the retention pools count as evictable, so the load gate reads the
/// resident footprint without them.
fn sync_retained_bytes(vector: Query<&TileCacheManager>, mut ledger: ResMut<MemoryLedger>) {
    ledger.retained_evictable_bytes = vector
        .iter()
        .flat_map(|tc| tc.retained.values())
        .map(|entry| entry.cost.total())
        .sum();
}

fn children((x, y, z): Coords) -> [Coords; 4] {
    [
        (2 * x, 2 * y, z + 1),
        (2 * x + 1, 2 * y, z + 1),
        (2 * x, 2 * y + 1, z + 1),
        (2 * x + 1, 2 * y + 1, z + 1),
    ]
}

fn ancestors_and_self(c: Coords) -> impl Iterator<Item = Coords> {
    std::iter::successors(Some(c), |&(x, y, z)| (z > 0).then(|| (x / 2, y / 2, z - 1)))
}

fn all_tiles(max_zoom: usize) -> impl Iterator<Item = Coords> {
    (0..=max_zoom).flat_map(|z| (0..1 << z).flat_map(move |x| (0..1 << z).map(move |y| (x, y, z))))
}

/// Runs `actions` from a cold start, then settles and checks the drawn tiles
/// against the selection.
fn run(
    max_zoom: usize,
    budget: bool,
    masked: KnownBugs,
    actions: &[Action],
) -> Result<Reach, String> {
    run_variant(max_zoom, budget, Variant::default(), masked, actions)
}

fn run_variant(
    max_zoom: usize,
    budget: bool,
    variant: Variant,
    masked: KnownBugs,
    actions: &[Action],
) -> Result<Reach, String> {
    let mut explorer = Explorer::with_variant(max_zoom, budget, variant, masked);
    let mut trace = vec![];
    for action in actions {
        let r = explorer.apply(action);
        match r {
            Ok(resolved) => trace.push(resolved),
            Err(e) => {
                trace.push(format!("{action:?}"));
                return Err(format!("{e}; {variant:?}; actions: {}", trace.join(" ")));
            }
        }
    }
    explorer.check_settled().map_err(|e| {
        format!(
            "after settling: {e}; {variant:?}; actions: {}",
            trace.join(" ")
        )
    })?;
    Ok(explorer.reach)
}

/// A fixed seed and [`PR_CASES`] cases unless `PROPTEST_RNG_SEED` and
/// `PROPTEST_CASES` say otherwise; failing seeds go to
/// `proptest-regressions/` and are replayed first.
fn exploration_config() -> ProptestConfig {
    let mut config = ProptestConfig {
        source_file: Some(file!()),
        ..ProptestConfig::default()
    };
    if std::env::var_os("PROPTEST_CASES").is_none() {
        config.cases = PR_CASES;
    }
    if std::env::var_os("PROPTEST_RNG_SEED").is_none() {
        config.rng_seed = RngSeed::Fixed(PR_SEED);
    }
    config
}

#[test]
fn it_should_keep_the_traversal_rules_on_any_action_sequence() {
    let mut runner = TestRunner::new(exploration_config());
    let masked = KnownBugs::masked_unless_env();
    let cases_reaching = Cell::new([0usize; Reach::NAMES.len()]);
    // Passes, tiles that stopped being drawn, and the most in one pass.
    let walked = Cell::new((0usize, 0usize, 0usize));
    let strategy = (
        2..=4usize,
        any::<bool>(),
        0..16u8,
        prop::collection::vec(action(), 0..MAX_ACTIONS),
    );
    let result = runner.run(&strategy, |(max_zoom, budget, variant, actions)| {
        let variant = Variant::from_bits(variant);
        let reach = run_variant(max_zoom, budget, variant, masked, &actions)
            .map_err(TestCaseError::fail)?;
        let mut counts = cases_reaching.get();
        for (count, reached) in counts.iter_mut().zip(reach.flags()) {
            *count += usize::from(reached);
        }
        cases_reaching.set(counts);
        let (passes, total, max) = walked.get();
        walked.set((
            passes + reach.passes,
            total + reach.hidden,
            max.max(reach.hidden_max),
        ));
        Ok(())
    });
    if let Err(e) = result {
        panic!("{e}");
    }
    let counts = cases_reaching.get();
    let mut unreached = vec![];
    let mut per_state = String::new();
    for (name, count) in Reach::NAMES.iter().zip(counts) {
        if count == 0 {
            unreached.push(*name);
        }
        per_state.push_str(&format!(" {name}={count}"));
    }
    let (passes, total, max) = walked.get();
    eprintln!(
        "cases per state:{per_state}; tiles hidden: {total} in {passes} passes, at most {max} in one"
    );
    assert!(
        unreached.is_empty(),
        "no case reached {unreached:?}; cases per state:{per_state}"
    );
}

/// The pass that first draws the tiles is followed by a zoom-out that
/// selects their unloaded parent.
#[test]
fn it_should_keep_the_drawn_tiles_on_a_zoom_out_right_after_they_are_drawn() {
    run(
        2,
        false,
        KnownBugs::NONE,
        &[Action::Load, Action::SetMaxSse(3)],
    )
    .unwrap();
}

/// With a memory budget, a zoom-out right after the tiles are first drawn
/// selects their parent, which is already loaded and built.
#[test]
fn it_should_hide_the_children_when_the_parent_takes_over_right_after_they_are_drawn() {
    use Action::*;
    let actions = [
        Traverse,
        Deliver(0),
        Look {
            lng: 7,
            narrow: false,
        },
        Deliver(0),
        Traverse,
        Construct(32),
        Deliver(152),
        Deliver(235),
        Report(0),
        Traverse,
        Traverse,
        SetMaxSse(3),
    ];
    run(2, true, KnownBugs::NONE, &actions).unwrap();
}

#[test]
#[ignore = "bug: update_tiles hands over to the root before its features are built, leaving the view empty"]
fn it_should_keep_the_drawn_tiles_until_the_root_is_built() {
    use Action::*;
    run(
        2,
        false,
        KnownBugs::NONE,
        &[Load, Traverse, Traverse, SetMaxSse(4)],
    )
    .unwrap();
}

/// The tiles drawn last are kept drawn for a pass after they leave the view;
/// the view comes back with a zoom-out to their unloaded parent.
#[test]
fn it_should_keep_the_tiles_drawn_out_of_view_on_a_zoom_out_back_to_them() {
    use Action::*;
    let actions = [
        Traverse,
        Fail(108),
        Look {
            lng: 3,
            narrow: false,
        },
        Load,
        Look {
            lng: 0,
            narrow: false,
        },
        Traverse,
        Look {
            lng: 3,
            narrow: false,
        },
        SetMaxSse(2),
    ];
    run(2, true, KnownBugs::NONE, &actions).unwrap();
}

/// A tile whose children in view all failed is drawn while a child that just
/// left the view is still kept drawn.
#[test]
fn it_should_hide_the_children_out_of_view_when_their_parent_is_drawn() {
    use Action::*;
    let actions = [
        Traverse,
        Fail(0),
        Load,
        Look {
            lng: 3,
            narrow: false,
        },
        Load,
        Look {
            lng: 0,
            narrow: false,
        },
    ];
    run(2, true, KnownBugs::NONE, &actions).unwrap();
}

/// The tiles drawn under a tile stay drawn when a zoom-out selects it and it
/// has failed for good.
#[test]
fn it_should_keep_the_drawn_tiles_under_a_selected_tile_that_failed() {
    use Action::*;
    let actions = [
        SetMaxSse(3),
        Traverse,
        Look {
            lng: 0,
            narrow: false,
        },
        Fail(108),
        Look {
            lng: 3,
            narrow: true,
        },
        Load,
        Traverse,
        SetMaxSse(4),
    ];
    run(2, true, KnownBugs::NONE, &actions).unwrap();
}

#[test]
#[ignore = "bug: a tile under a selected tile that failed for good starts being drawn"]
fn it_should_start_no_tile_under_a_selected_tile_that_failed() {
    use Action::*;
    let actions = [
        SetMaxSse(3),
        Traverse,
        Look {
            lng: 0,
            narrow: true,
        },
        Fail(108),
        Load,
        Look {
            lng: 3,
            narrow: true,
        },
        Load,
        Look {
            lng: 0,
            narrow: false,
        },
        Traverse,
    ];
    run(2, true, KnownBugs::NONE, &actions).unwrap();
}

/// A loading tile is culled for a pass while the tiles under it hold its
/// area, then comes back into view.
#[test]
fn it_should_keep_the_drawn_tiles_when_their_loading_parent_is_culled_for_a_pass() {
    use Action::*;
    let actions = [
        Load,
        SetMaxSse(3),
        Traverse,
        Look {
            lng: 4,
            narrow: true,
        },
        Traverse,
        Look {
            lng: 0,
            narrow: false,
        },
        Traverse,
    ];
    run(3, true, KnownBugs::NONE, &actions).unwrap();
}

/// A selected tile fails for good with tiles drawn under it, and its parent
/// becomes the finest data there: they stay drawn until the parent is.
#[test]
fn it_should_keep_the_drawn_tiles_under_a_failed_tile_until_their_finest_data_parent_is_drawn() {
    use Action::*;
    let actions = [
        Look {
            lng: 4,
            narrow: true,
        },
        Load,
        Traverse,
        Traverse,
        SetMaxSse(41),
        Traverse,
        Fail(0),
        Deliver(0),
    ];
    run(3, false, KnownBugs::NONE, &actions).unwrap();
}

/// Texturized (clamp-to-ground) tiles outside the frustum are drawn without
/// descending: one that takes over while finer tiles under it are drawn
/// hides them. Built z3 tiles are hidden under drawn z4 tiles, then the
/// camera narrows onto a sweep of longitudes.
#[test]
fn it_should_hide_the_drawn_tiles_under_a_texturized_tile_outside_the_frustum() {
    let mut explorer = Explorer::new(4, true, KnownBugs::NONE);
    let config = traversal_config(&mut explorer.app, &explorer.scene);
    config.has_clamp_to_ground = true;
    config.overscaled_max_zoom = 4;
    let (coarse, fine) = (explorer.max_sse_choices[3], explorer.max_sse_choices[2]);
    let settle_at = |explorer: &mut Explorer, max_sse: f64| {
        explorer
            .app
            .world_mut()
            .resource_mut::<navara_globe::Globe>()
            .max_sse = max_sse as f32;
        for _ in 0..6 {
            traverse(&mut explorer.app, &explorer.scene);
            explorer.answer_everything();
        }
        traverse(&mut explorer.app, &explorer.scene);
    };
    let check = |explorer: &Explorer, lng: f64| {
        let drawn = explorer.drawn_tiles();
        for &c in &drawn {
            if let Some(a) = ancestors_and_self(c).skip(1).find(|a| drawn.contains(a)) {
                panic!("looking at lng {lng}: {c:?} is drawn under the drawn {a:?}");
            }
        }
    };
    for i in 0..16 {
        look_with_fov(&mut explorer.app, &explorer.scene, 0., 90.);
        settle_at(&mut explorer, coarse);
        settle_at(&mut explorer, fine);
        let lng = i as f64 * 5.625;
        look_with_fov(&mut explorer.app, &explorer.scene, lng, 20.);
        for _ in 0..2 {
            traverse(&mut explorer.app, &explorer.scene);
            check(&explorer, lng);
        }
    }
}

#[test]
#[ignore = "bug: tiles drawn under a tile the min_zoom descent budget leaves out are dropped although they are in view"]
fn it_should_keep_the_drawn_tiles_under_a_tile_the_descent_budget_leaves_out() {
    use Action::*;
    let variant = Variant {
        min_zoom_budget: true,
        ..Variant::default()
    };
    let actions = [
        Load,
        SetMaxSse(3),
        Look {
            lng: 0,
            narrow: false,
        },
    ];
    run_variant(2, false, variant, KnownBugs::NONE, &actions).unwrap();
}

#[test]
#[ignore = "bug: a texturized tile falls back to drawing itself over drawn tiles under it while the selected tiles replacing them are not on screen yet"]
fn it_should_keep_the_drawn_tiles_under_a_texturized_tile_until_the_selected_ones_are_drawn() {
    use Action::*;
    let variant = Variant {
        texturized: true,
        ..Variant::default()
    };
    let actions = [
        Look {
            lng: 6,
            narrow: false,
        },
        Load,
        LoadSelectedAndGlance {
            steps: 1,
            deliver: false,
        },
        HoldAndGlance {
            steps: 0,
            deliver: false,
        },
        ZoomOutAndFail,
        Glance {
            steps: 0,
            deliver: false,
        },
    ];
    run_variant(3, false, variant, KnownBugs::NONE, &actions).unwrap();
}

/// The tiles drawn under a texturized tile that leaves the frustum while it
/// loads stay drawn and flagged; once an ancestor takes over, they are
/// hidden.
#[test]
fn it_should_hide_the_tiles_kept_under_a_texturized_tile_outside_the_frustum_when_an_ancestor_takes_over()
 {
    use Action::*;
    let variant = Variant {
        texturized: true,
        ..Variant::default()
    };
    let actions = [
        Look {
            lng: 3,
            narrow: false,
        },
        Load,
        Look {
            lng: 0,
            narrow: true,
        },
        LoadSelected,
        SetMaxSse(5),
        HoldAndGlance {
            steps: 3,
            deliver: false,
        },
    ];
    run_variant(4, true, variant, KnownBugs::NONE, &actions).unwrap();
}

/// A texturized tile that leaves the frustum while it loads, then loads but
/// is not built yet: the tiles drawn under it stay drawn.
#[test]
fn it_should_keep_the_tiles_drawn_under_a_texturized_tile_outside_the_frustum_until_it_is_built() {
    use Action::*;
    let variant = Variant {
        texturized: true,
        ..Variant::default()
    };
    for budget in [false, true] {
        let mut explorer = Explorer::with_variant(4, budget, variant, KnownBugs::NONE);
        explorer
            .apply(&Look {
                lng: 0,
                narrow: true,
            })
            .unwrap();
        explorer.apply(&LoadSelected).unwrap();
        let drawn = explorer.drawn.clone();
        explorer.deliver_everything();
        explorer.look(33.75, true);
        for pass in 0..3 {
            explorer.apply(&Traverse).unwrap();
            let unbuilt_outside: Vec<Coords> = explorer
                .unbuilt()
                .into_iter()
                .map(|(c, _)| c)
                .filter(|c| {
                    let probe = explorer.probe_full(*c);
                    probe.outside_texturized && !probe.occluded
                })
                .collect();
            let under_them: Vec<Coords> = drawn
                .iter()
                .copied()
                .filter(|d| {
                    unbuilt_outside
                        .iter()
                        .any(|o| ancestors_and_self(*d).skip(1).any(|a| a == *o))
                })
                .collect();
            assert!(!under_them.is_empty());
            for d in under_them {
                assert!(
                    explorer.drawn.contains(&d),
                    "budget {budget}, pass {pass}: {d:?} was hidden"
                );
            }
        }
    }
}

/// A tile the `min_zoom` descent budget leaves out is in view: it is not
/// hidden with what is drawn under it as one that left the view.
#[test]
fn it_should_not_hide_the_tiles_under_one_the_descent_budget_leaves_out() {
    use Action::*;
    let variant = Variant {
        min_zoom_budget: true,
        ..Variant::default()
    };
    let mut explorer = Explorer::with_variant(2, true, variant, KnownBugs::all_masked());
    explorer.apply(&Load).unwrap();
    let drawn = explorer.drawn.clone();
    explorer.apply(&SetMaxSse(3)).unwrap();
    explorer.apply(&Traverse).unwrap();
    assert!(!explorer.selection().budget_culled.is_empty());
    assert_eq!(explorer.drawn, drawn);
}

/// Over a tight memory budget, the tiles kept drawn under a texturized tile
/// outside the frustum go to the pool and may be evicted.
#[test]
fn it_should_let_the_budget_evict_the_tiles_kept_outside_the_view() {
    use Action::*;
    let variant = Variant {
        texturized: true,
        tight_budget: true,
        ..Variant::default()
    };
    let actions = [
        LoadSelected,
        LoadSelectedAndGlance {
            steps: 1,
            deliver: false,
        },
    ];
    run_variant(4, false, variant, KnownBugs::NONE, &actions).unwrap();
}

/// The camera turns until tiles drawn under a texturized tile outside the
/// frustum fall behind the horizon: they are not kept.
#[test]
fn it_should_not_keep_the_tiles_behind_the_horizon_under_a_texturized_tile_outside_the_frustum() {
    use Action::*;
    let variant = Variant {
        texturized: true,
        ..Variant::default()
    };
    let mut explorer = Explorer::with_variant(4, true, variant, KnownBugs::NONE);
    explorer
        .apply(&Look {
            lng: 0,
            narrow: true,
        })
        .unwrap();
    explorer.apply(&LoadSelected).unwrap();
    explorer.look(45., true);
    for _ in 0..2 {
        explorer.apply(&Traverse).unwrap();
        let behind_horizon: Vec<Coords> = explorer
            .drawn
            .iter()
            .copied()
            .filter(|c| ancestors_and_self(*c).any(|a| explorer.probe_full(a).occluded))
            .collect();
        assert_eq!(behind_horizon, vec![]);
    }
}
