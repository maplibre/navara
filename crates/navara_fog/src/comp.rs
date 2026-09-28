use bevy_ecs::component::Component;
use bevy_ecs::resource::Resource;
use navara_math::{FloatType, Vec3};

#[derive(Component, Clone)]
pub struct Fog {
    pub enabled: bool,
    pub density: FloatType,
    pub sse_factor: FloatType,
}

impl Fog {
    /// Inert fog used as a fallback when no [`Fog`] entity exists yet.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            density: 0.,
            sse_factor: 0.,
        }
    }
}

/// Dynamic screen-space-error relaxation for tilted, street-level views,
/// mirroring CesiumJS `dynamicScreenSpaceError`: the same distance-weighted
/// `fog()` subtraction as the LOD fog, but with a density rescaled on every
/// traversal from the camera pose — zero looking straight down, strongest
/// near the ground looking toward the horizon — so far tiles coarsen only in
/// the horizon views that would otherwise over-refine them.
///
/// Lives on the same entity as [`Fog`]; traversals turn it into a
/// [`DynamicSseTerm`] once per run via [`DynamicSse::term`].
// Ref: https://github.com/CesiumGS/cesium/blob/9e93c9b6aa44a8a490f5ed9aa175a7e92348aaa2/packages/engine/Source/Scene/Cesium3DTileset.js#L433
#[derive(Component, Clone)]
pub struct DynamicSse {
    pub enabled: bool,
    /// Base fog density; scaled by the tilt/height factors per traversal.
    pub density: FloatType,
    /// SSE pixels tolerated at full fog saturation for a layer whose max SSE
    /// is [`REFERENCE_MAX_SSE`] (CesiumJS default: 24). Each traversal scales
    /// it by its own max SSE via [`DynamicSseTerm::for_max_sse`].
    pub sse_factor: FloatType,
    /// Fraction of the `[min_height, max_height]` band below which the
    /// relaxation is at full strength (CesiumJS default: 0.25).
    pub height_falloff: FloatType,
    /// Camera heights (meters above the ellipsoid) across which the effect
    /// fades: full strength below `min_height + falloff * range`, off above
    /// `max_height`.
    pub min_height: FloatType,
    pub max_height: FloatType,
}

impl Default for DynamicSse {
    // CesiumJS defaults (enabled/density/factor/heightFalloff).
    // Ref: https://github.com/CesiumGS/cesium/blob/9e93c9b6aa44a8a490f5ed9aa175a7e92348aaa2/packages/engine/Source/Scene/Cesium3DTileset.js#L433-L521
    fn default() -> Self {
        Self {
            enabled: true,
            density: 2.0e-4,
            sse_factor: 24.0,
            height_falloff: 0.25,
            min_height: 0.,
            max_height: 8000.,
        }
    }
}

impl DynamicSse {
    /// Inert instance used as a fallback when no entity exists yet.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ..Self::default()
        }
    }

    /// Per-traversal term: the density scaled by view tilt (zero looking
    /// straight down) and camera height (fading out above `max_height`).
    /// Mirrors CesiumJS `updateDynamicScreenSpaceError` (with a fixed,
    /// configurable height band instead of the tileset's bounding-volume
    /// heights, since Navara applies this globally to every traversal).
    // Ref: https://github.com/CesiumGS/cesium/blob/9e93c9b6aa44a8a490f5ed9aa175a7e92348aaa2/packages/engine/Source/Scene/Cesium3DTileset.js#L2447
    pub fn term(
        &self,
        camera_pos: Vec3,
        camera_forward: Vec3,
        camera_height: FloatType,
    ) -> DynamicSseTerm {
        if !self.enabled {
            return DynamicSseTerm::NONE;
        }
        let up = camera_pos.normalize_or_zero();
        let horizon_factor = 1.0 - camera_forward.dot(up).abs();
        let height_close =
            self.min_height + (self.max_height - self.min_height) * self.height_falloff;
        let t = if self.max_height > height_close {
            ((camera_height - height_close) / (self.max_height - height_close)).clamp(0., 1.)
        } else {
            1.
        };
        DynamicSseTerm {
            density: self.density * horizon_factor * (1. - t),
            sse_factor: self.sse_factor,
        }
    }
}

/// Max SSE that [`DynamicSse::sse_factor`] is expressed against: the CesiumJS
/// `Cesium3DTileset.maximumScreenSpaceError` default, where the 24 px factor
/// originates. Terrain, imagery and vector tiles select LOD against a max SSE
/// of 2 px, so the same absolute factor would relax them 8x harder than 3D
/// Tiles and collapse far terrain to a few levels in any tilted view; scaling
/// by `max_sse / REFERENCE_MAX_SSE` keeps the relaxation at the same ratio to
/// the threshold (at most 1.5x) for every layer.
pub const REFERENCE_MAX_SSE: FloatType = 16.0;

/// Precomputed dynamic-SSE inputs for one traversal run. `NONE` (zero
/// density) is a no-op since `fog(d, 0) == 0`, so callers apply it
/// unconditionally.
#[derive(Clone, Copy, Debug)]
pub struct DynamicSseTerm {
    pub density: FloatType,
    pub sse_factor: FloatType,
}

impl DynamicSseTerm {
    pub const NONE: Self = Self {
        density: 0.,
        sse_factor: 0.,
    };

    /// SSE pixels to subtract for a tile at `distance` from the camera.
    // Ref: https://github.com/CesiumGS/cesium/blob/9e93c9b6aa44a8a490f5ed9aa175a7e92348aaa2/packages/engine/Source/Scene/Cesium3DTile.js#L950-L954
    pub fn relaxation(&self, distance: FloatType) -> FloatType {
        crate::fog(distance, self.density) * self.sse_factor
    }

    /// This term with its relaxation strength scaled by `scale` (linear on the
    /// SSE-pixel amount): `0.0` disables it, `1.0` is full strength. Used to
    /// dial the horizon relaxation down per layer for content that coarsens
    /// poorly (draped geometry, discrete features) versus space-filling raster.
    pub fn scaled(&self, scale: FloatType) -> Self {
        Self {
            density: self.density,
            sse_factor: self.sse_factor * scale,
        }
    }

    /// This term rescaled for a traversal that selects LOD against `max_sse`
    /// pixels (see [`REFERENCE_MAX_SSE`]).
    pub fn for_max_sse(&self, max_sse: FloatType) -> Self {
        self.scaled(max_sse / REFERENCE_MAX_SSE)
    }
}

/// Buffered [`DynamicSse`] parameters, written by `Core.setDynamicSse` before
/// the `Startup` spawn exists; mirrors [`LodFogConfig`].
#[derive(Resource, Clone, Default)]
pub struct DynamicSseConfig(pub DynamicSse);

#[cfg(test)]
mod dynamic_sse_tests {
    use super::*;

    // Camera on the +X axis at `height` meters above a unit "ellipsoid"
    // surface point: up is +X.
    fn term_at(dyn_sse: &DynamicSse, forward: Vec3, height: FloatType) -> DynamicSseTerm {
        dyn_sse.term(Vec3::new(6_378_137. + height, 0., 0.), forward, height)
    }

    #[test]
    fn straight_down_view_has_no_relaxation() {
        let d = DynamicSse::default();
        // Looking straight down: forward is anti-parallel to up.
        let term = term_at(&d, Vec3::new(-1., 0., 0.), 100.);
        assert_eq!(term.density, 0.);
        assert_eq!(term.relaxation(10_000.), 0.);
    }

    #[test]
    fn horizon_view_near_ground_is_full_strength_and_fades_with_height() {
        let d = DynamicSse::default();
        let horizon = Vec3::new(0., 1., 0.);
        let low = term_at(&d, horizon, 100.);
        assert_eq!(low.density, d.density);
        // Far tiles get relaxed, near tiles (fog ≈ 0) stay sharp.
        assert!(low.relaxation(50_000.) > d.sse_factor * 0.9);
        assert!(low.relaxation(100.) < 0.1);

        let mid = term_at(&d, horizon, (d.max_height + d.min_height) / 2.);
        assert!(mid.density > 0. && mid.density < low.density);

        let high = term_at(&d, horizon, d.max_height + 1.);
        assert_eq!(high.density, 0.);
    }

    #[test]
    fn disabled_is_a_no_op() {
        let d = DynamicSse::disabled();
        let term = term_at(&d, Vec3::new(0., 1., 0.), 100.);
        assert_eq!(term.relaxation(50_000.), 0.);
    }

    #[test]
    fn scaled_dials_relaxation_strength_linearly() {
        let d = DynamicSse::default();
        let full = term_at(&d, Vec3::new(0., 1., 0.), 100.);
        let base = full.relaxation(50_000.);
        assert!(base > 0.);

        // Half strength halves the SSE pixels; zero disables it entirely.
        assert!((full.scaled(0.5).relaxation(50_000.) - base * 0.5).abs() < 1e-9);
        assert_eq!(full.scaled(0.0).relaxation(50_000.), 0.);
    }

    #[test]
    fn for_max_sse_keeps_relaxation_proportional_to_the_threshold() {
        let d = DynamicSse::default();
        let full = term_at(&d, Vec3::new(0., 1., 0.), 100.);
        // The reference threshold is unchanged; the globe's 2 px threshold
        // gets the same 1.5x ratio (3 px at saturation) instead of 24 px.
        assert_eq!(
            full.for_max_sse(REFERENCE_MAX_SSE).relaxation(50_000.),
            full.relaxation(50_000.)
        );
        let terrain = full.for_max_sse(2.0);
        assert!((terrain.relaxation(50_000.) - full.relaxation(50_000.) / 8.).abs() < 1e-9);
        assert!(terrain.relaxation(1e9) <= 3.0 + 1e-9);
    }
}

/// Buffered LOD fog parameters, written by `Core.setLodFog` (via
/// `App::set_lod_fog`) and applied to the [`Fog`] entity. `init_resource`'d at
/// plugin build so a `setLodFog` call that arrives BEFORE the first
/// `App::update()` — i.e. before the `Startup` system has spawned the `Fog`
/// entity — is not dropped: the value is stored here and the startup spawn reads
/// it, and later calls are applied to the live entity by a change-detection
/// system. Mirrors how `set_sse_multiplier_range` / `set_cache_bytes` buffer
/// into `MemoryLedger`.
#[derive(Resource, Clone)]
pub struct LodFogConfig {
    pub enabled: bool,
    pub density: FloatType,
    pub sse_factor: FloatType,
}

impl Default for LodFogConfig {
    fn default() -> Self {
        // Same defaults the original `Startup` spawn used.
        Self {
            enabled: true,
            density: 2.0e-4,
            sse_factor: 2.0,
        }
    }
}
