use bevy_ecs::prelude::*;
use navara_layer::TerrainLayer;
use navara_math::FloatType;

/// Lowest unexaggerated terrain height (meters) assumed where the actual
/// height is not known: below the Dead Sea (-430 m).
pub const LOWEST_TERRAIN_HEIGHT: FloatType = -500.;

/// Vertical exaggeration of the rendered terrain surface.
///
/// Terrain meshes, the per-vertex height buffers and the heights stored on
/// tiles stay unexaggerated (upsampling rebuilds positions from them); the
/// renderer displaces vertices on the GPU, and everything that must agree with
/// the drawn surface — tile bounds, height queries, ground-clamped features —
/// maps heights through [`Self::apply`].
#[derive(Resource, Clone, Copy, Debug, PartialEq)]
pub struct TerrainExaggeration {
    /// Multiplier on the height above `relative_height`. Never negative.
    scale: FloatType,
    /// Height (meters) that stays fixed while the terrain is scaled around it.
    relative_height: FloatType,
}

impl Default for TerrainExaggeration {
    fn default() -> Self {
        Self {
            scale: 1.,
            relative_height: 0.,
        }
    }
}

impl TerrainExaggeration {
    /// A negative `scale` is clamped to 0 (a flat surface at `relative_height`).
    pub fn new(scale: FloatType, relative_height: FloatType) -> Self {
        Self {
            scale: scale.max(0.),
            relative_height,
        }
    }

    /// The exaggeration a terrain layer renders with: identity without an
    /// appearance.
    pub fn of_layer(layer: &TerrainLayer) -> Self {
        layer
            .appearance
            .as_ref()
            .map(|appearance| {
                Self::new(
                    appearance.exaggeration,
                    appearance.exaggeration_relative_height,
                )
            })
            .unwrap_or_default()
    }

    pub fn scale(&self) -> FloatType {
        self.scale
    }

    pub fn relative_height(&self) -> FloatType {
        self.relative_height
    }

    /// Height of the rendered surface for an unexaggerated terrain height.
    /// Monotonic non-decreasing, so it maps a min/max pair to a min/max pair.
    pub fn apply(&self, height: FloatType) -> FloatType {
        (height - self.relative_height) * self.scale + self.relative_height
    }

    /// Height (never positive) the ellipsoid is shrunk by for horizon culling,
    /// so that rendered terrain down to [`LOWEST_TERRAIN_HEIGHT`] is not hidden
    /// behind the ellipsoid.
    pub fn horizon_minimum_height(&self) -> FloatType {
        self.apply(LOWEST_TERRAIN_HEIGHT).min(0.)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_by_default() {
        let e = TerrainExaggeration::default();
        assert_eq!(e.apply(1234.5), 1234.5);
        assert_eq!(e.apply(-20.), -20.);
    }

    #[test]
    fn scales_around_relative_height() {
        let e = TerrainExaggeration::new(3., 0.);
        assert_eq!(e.apply(1000.), 3000.);

        let e = TerrainExaggeration::new(2., 1000.);
        assert_eq!(e.apply(1000.), 1000.);
        assert_eq!(e.apply(3000.), 5000.);
        assert_eq!(e.apply(0.), -1000.);
    }

    #[test]
    fn zero_scale_flattens_to_relative_height() {
        let e = TerrainExaggeration::new(0., 500.);
        assert_eq!(e.apply(3776.), 500.);
        assert_eq!(e.apply(-10.), 500.);
    }

    #[test]
    fn negative_scale_is_clamped_to_zero() {
        let e = TerrainExaggeration::new(-2., 0.);
        assert_eq!(e.scale(), 0.);
        assert_eq!(e.apply(1000.), 0.);
    }

    #[test]
    fn horizon_minimum_height_follows_the_lowest_terrain() {
        assert_eq!(
            TerrainExaggeration::default().horizon_minimum_height(),
            LOWEST_TERRAIN_HEIGHT
        );
        // Scale 5 around 2000 m moves -500 m to -10500 m.
        assert_eq!(
            TerrainExaggeration::new(5., 2000.).horizon_minimum_height(),
            -10500.
        );
        // Lifted above the ellipsoid, the terrain needs no shrinking.
        assert_eq!(
            TerrainExaggeration::new(0., 100.).horizon_minimum_height(),
            0.
        );
    }
}
