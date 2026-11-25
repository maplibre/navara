use bevy_ecs::entity::Entity;
use navara_core::{
    Extent, Radians, TileXYZ, TilingScheme, overlapping_tiles_within_budget, wm_zoom_for_lng_span,
};
use navara_geometry::{TileUvTransform, uv_rect_from_extents_mercator};
use navara_math::FloatType;
use navara_tile_component::{RasterTileQuadtree, TileTextureFragmentQuery};
use rustc_hash::FxHashSet;

/// Maximum WebMercator raster tiles baked into a single layer's render target for one
/// terrain tile. Draping WebMercator raster onto a Geographic terrain tile is N:M and
/// the overlap grows toward the poles. Every overlapping tile for a layer is baked into
/// that layer's one render target (see the web `renderRasterTiles`), so this cap is
/// **per layer** and independent of how many layers are draped — each layer costs one
/// composite slot no matter its overlap. Beyond this the overlap query coarsens the
/// zoom. Mirrors `VECTOR_DRAPE_OVERLAP_BUDGET`.
pub const RASTER_DRAPE_OVERLAP_BUDGET: usize = 5;

/// One WebMercator raster texture draped on a terrain tile: the texture fragment
/// entity, the affine UV mapping the terrain tile's `[0, 1]` UV into this raster
/// tile's texture, and the raster tile's geographic extent (used by the composite
/// shader to reproject the latitude axis when terrain and raster schemes differ).
#[derive(Debug, Clone, Copy)]
pub struct ResolvedRasterTexture {
    pub entity: bevy_ecs::entity::Entity,
    pub uv_transform: TileUvTransform,
    pub raster_extent: Extent<FloatType, Radians>,
}

/// Resolve the single WebMercator raster tile draping `terrain_extent` for one
/// layer. Only used for WebMercator terrain — Geographic drapes resolve through
/// the baked path ([`resolve_raster_tile_states`]) — so the drape is same-scheme:
/// the terrain tile's own identity WM tile at `target_z`, or, when its fragment
/// isn't loaded, its nearest loaded ancestor. `None` while nothing has loaded yet.
pub fn resolve_raster_texture(
    qt: &RasterTileQuadtree,
    terrain_extent: &Extent<FloatType, Radians>,
    target_z: usize,
    layer_index: usize,
    texture_fragment: &TileTextureFragmentQuery,
) -> Option<ResolvedRasterTexture> {
    let is_loaded = fragment_loaded(texture_fragment);
    let coords = overlapping_tiles_within_budget(*terrain_extent, target_z, 1)
        .into_iter()
        .next()?;
    let (entity, resolved) = resolve_loaded_tile(qt, coords, layer_index, &is_loaded)?;

    let raster_extent = TilingScheme::WebMercator { tms: false }.tile_extent(resolved);
    Some(ResolvedRasterTexture {
        entity,
        // WM terrain meshes carry Mercator-fraction UVs and the raster texture's
        // v axis is Mercator-linear, so an ancestor's sub-rect is framed by its
        // Mercator fraction (identity for the tile's own texture either way).
        uv_transform: uv_rect_from_extents_mercator(*terrain_extent, raster_extent),
        raster_extent,
    })
}

/// Fragment-loaded predicate over the system-side texture fragment query. The resolve
/// walk-up is generic over this so `navara_ecs` (which only has `&mut World`, not a
/// system `Query`) can supply its own lookup for the baked-drape resolve.
fn fragment_loaded<'a>(
    texture_fragment: &'a TileTextureFragmentQuery,
) -> impl Fn(Entity) -> bool + 'a {
    |entity| {
        texture_fragment
            .get(entity)
            .is_ok_and(|t| t.1.is_succeeded())
    }
}

/// Per-layer input for the baked-drape resolve ([`resolve_raster_tile_states`]): the
/// layer's slot in the shared raster quadtree's `texture_fragment_entity_ids` arrays
/// (the full sorted-layer index, hillshade included) and its source's max zoom (the
/// drape zoom cap, read live from the referenced source).
#[derive(Debug, Clone, Copy)]
pub struct RasterBakeLayer {
    pub layer_index: usize,
    pub max_zoom: usize,
}

/// One WebMercator raster tile to bake into a layer's drape render target, flattened
/// across layers for the wasm boundary (one entry per overlapping WM tile per layer).
/// Mirrors `ResolvedVectorTileState` (the texturized-vector drape): `layer_ordinal` is
/// the layer's position among the baked (pure raster) layers in sorted order — the web
/// side pairs it with the k-th baked composite slot, which `update_mesh_material`
/// emits from the same sorted, filtered layer list.
#[derive(Debug, Clone, Copy)]
pub struct ResolvedRasterTileState {
    pub layer_ordinal: usize,
    /// The loaded texture fragment entity; the web side derives its `loadedTexs` key
    /// from the entity id.
    pub fragment: Entity,
    /// Mercator affine UV framing the terrain tile's sub-region of this raster tile,
    /// for the offscreen **bake** camera (`uv_rect_from_extents_mercator`).
    pub uv_offset: [f32; 2],
    pub uv_scale: [f32; 2],
    /// Terrain `[south, north]` latitude (radians) for Mercator reprojection;
    /// `None` on WebMercator terrain (identity drape, no reprojection).
    pub reproject_terrain_lat: Option<[f32; 2]>,
}

/// Resolve, for every baked (pure raster) layer, the WebMercator tiles covering
/// `terrain_extent` and flatten them for the wasm boundary. Picks each layer's overlap
/// zoom from the terrain tile's longitude span capped by that layer's max zoom, caps
/// the overlap **per layer** ([`RASTER_DRAPE_OVERLAP_BUDGET`] — the sources are baked
/// into one render target per layer, so the budget is not divided across layers), and
/// attaches the Mercator reprojection latitude band when the terrain is Geographic.
/// A tile whose own fragment isn't loaded falls back to its nearest loaded ancestor
/// (several gaps may share one ancestor, which is baked once).
pub fn resolve_raster_tile_states(
    qt: &RasterTileQuadtree,
    terrain_extent: &Extent<FloatType, Radians>,
    terrain_is_geographic: bool,
    layers: &[RasterBakeLayer],
    is_loaded: &impl Fn(Entity) -> bool,
) -> Vec<ResolvedRasterTileState> {
    let lng_span = (terrain_extent.east - terrain_extent.west).val();

    let reproject_terrain_lat = terrain_is_geographic.then(|| {
        [
            terrain_extent.south.val() as f32,
            terrain_extent.north.val() as f32,
        ]
    });

    let mut out = Vec::new();
    for (ordinal, layer) in layers.iter().enumerate() {
        let target_z = wm_zoom_for_lng_span(lng_span, layer.max_zoom);
        let mut resolved_coords: FxHashSet<TileXYZ> = FxHashSet::default();

        for coords in
            overlapping_tiles_within_budget(*terrain_extent, target_z, RASTER_DRAPE_OVERLAP_BUDGET)
        {
            let Some((entity, resolved)) =
                resolve_loaded_tile(qt, coords, layer.layer_index, is_loaded)
            else {
                continue;
            };
            // A coarser ancestor can back several of the requested tiles; bake it once.
            if !resolved_coords.insert(resolved) {
                continue;
            }

            let raster_extent = TilingScheme::WebMercator { tms: false }.tile_extent(resolved);
            // Mercator UV: this drives the offscreen bake camera, which frames the
            // terrain tile's sub-region of the (mercator-laid-out) raster tile.
            let uv = uv_rect_from_extents_mercator(*terrain_extent, raster_extent);
            out.push(ResolvedRasterTileState {
                layer_ordinal: ordinal,
                fragment: entity,
                uv_offset: [uv.offset.x as f32, uv.offset.y as f32],
                uv_scale: [uv.scale.x as f32, uv.scale.y as f32],
                reproject_terrain_lat,
            });
        }
    }
    out
}

/// Walk up from `coords` to the nearest tile (inclusive) whose `layer_index`
/// texture fragment has finished loading. Returns the fragment entity and the
/// coordinates of the tile it was found on.
fn resolve_loaded_tile(
    qt: &RasterTileQuadtree,
    coords: TileXYZ,
    layer_index: usize,
    is_loaded: &impl Fn(Entity) -> bool,
) -> Option<(Entity, TileXYZ)> {
    let (mut x, mut y, mut z) = (coords.x, coords.y, coords.z);
    loop {
        if let Some(leaf) = qt.qt.leaf((x, y, z))
            && let Some(tile) = qt.qt.get(leaf.handle())
            && let Some(entity) = tile
                .texture_fragment_entity_ids
                .as_ref()
                .and_then(|ids| ids.get(layer_index).copied().flatten())
            && is_loaded(entity)
        {
            return Some((entity, TileXYZ { x, y, z }));
        }
        if z == 0 {
            return None;
        }
        z -= 1;
        x /= 2;
        y /= 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_app::{App, Update};
    use bevy_ecs::prelude::{Res, ResMut, Resource};
    use navara_texture_fragment::{TextureFragment, TextureFragmentStatus};
    use navara_tile_component::{RasterTile, TileTextureFragmentMarker};

    #[derive(Resource, Default)]
    struct Out(Option<ResolvedRasterTexture>);

    /// WebMercator terrain over its own tile resolves to the identity drape
    /// (one texture, identity UV).
    #[test]
    fn resolve_wm_identity_single_texture() {
        let mut app = App::new();

        // Raster quadtree root (0,0,0) carrying a loaded texture for layer 0.
        let entity = app
            .world_mut()
            .spawn((
                TileTextureFragmentMarker(0),
                TextureFragment::with_status("u".into(), TextureFragmentStatus::Success),
            ))
            .id();

        let mut qt = RasterTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| RasterTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = qt.qt.zero().unwrap().handle();
        qt.qt.get_mut(handle).unwrap().texture_fragment_entity_ids = Some(vec![Some(entity)]);

        // Terrain extent == the WM root tile extent.
        let terrain_extent =
            TilingScheme::WebMercator { tms: false }.tile_extent(TileXYZ { x: 0, y: 0, z: 0 });

        app.insert_resource(qt);
        app.init_resource::<Out>();
        app.add_systems(
            Update,
            move |raster_qt: Res<RasterTileQuadtree>,
                  texture_fragment: TileTextureFragmentQuery,
                  mut out: ResMut<Out>| {
                out.0 =
                    resolve_raster_texture(&raster_qt, &terrain_extent, 0, 0, &texture_fragment);
            },
        );
        app.update();

        let resolved = app.world().resource::<Out>().0.expect("loaded fragment");
        assert_eq!(resolved.entity, entity);
        // identity UV (terrain extent == raster extent).
        assert!((resolved.uv_transform.scale.x - 1.0).abs() < 1e-9);
        assert!((resolved.uv_transform.scale.y - 1.0).abs() < 1e-9);
        assert!(resolved.uv_transform.offset.x.abs() < 1e-9);
        assert!(resolved.uv_transform.offset.y.abs() < 1e-9);
    }

    // ----- resolve_raster_tile_states (baked drape) ---------------------------

    use bevy_ecs::world::World;
    use rustc_hash::FxHashSet as EntitySet;

    /// A raster quadtree with just the WM root, carrying one fragment entity per
    /// layer slot. Returns the per-layer entities.
    fn qt_with_root_fragments(
        world: &mut World,
        num_layers: usize,
    ) -> (RasterTileQuadtree, Vec<Entity>) {
        let mut qt = RasterTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| RasterTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = qt.qt.zero().unwrap().handle();
        let entities: Vec<Entity> = (0..num_layers).map(|_| world.spawn_empty().id()).collect();
        qt.qt.get_mut(handle).unwrap().texture_fragment_entity_ids =
            Some(entities.iter().copied().map(Some).collect());
        (qt, entities)
    }

    fn loaded(entities: &[Entity]) -> impl Fn(Entity) -> bool + '_ {
        let set: EntitySet<Entity> = entities.iter().copied().collect();
        move |e| set.contains(&e)
    }

    fn wm_root_extent() -> Extent<FloatType, Radians> {
        TilingScheme::WebMercator { tms: false }.tile_extent(TileXYZ { x: 0, y: 0, z: 0 })
    }

    fn bake_layers(n: usize) -> Vec<RasterBakeLayer> {
        (0..n)
            .map(|layer_index| RasterBakeLayer {
                layer_index,
                max_zoom: 20,
            })
            .collect()
    }

    /// WebMercator terrain over its own tile → a single identity drape per layer, no
    /// reprojection band, ordinal propagated.
    #[test]
    fn resolve_states_wm_identity_single_tile() {
        let mut world = World::new();
        let (qt, entities) = qt_with_root_fragments(&mut world, 1);

        let states = resolve_raster_tile_states(
            &qt,
            &wm_root_extent(),
            false,
            &bake_layers(1),
            &loaded(&entities),
        );

        assert_eq!(states.len(), 1);
        assert_eq!(states[0].layer_ordinal, 0);
        assert_eq!(states[0].fragment, entities[0]);
        assert!(states[0].reproject_terrain_lat.is_none());
        assert!((states[0].uv_scale[0] - 1.0).abs() < 1e-6);
        assert!((states[0].uv_scale[1] - 1.0).abs() < 1e-6);
        assert!(states[0].uv_offset[0].abs() < 1e-6);
        assert!(states[0].uv_offset[1].abs() < 1e-6);
    }

    /// A Geographic terrain tile overlaps several WM tiles, but only the root fragment
    /// is loaded, so every overlap falls back to it and it is baked once — with the
    /// terrain `[south, north]` reprojection band attached.
    #[test]
    fn resolve_states_geographic_dedups_ancestor_and_attaches_band() {
        let mut world = World::new();
        let (qt, entities) = qt_with_root_fragments(&mut world, 1);
        let terrain_extent =
            TilingScheme::Geographic { tms: false }.tile_extent(TileXYZ { x: 0, y: 0, z: 0 });

        let states = resolve_raster_tile_states(
            &qt,
            &terrain_extent,
            true,
            &bake_layers(1),
            &loaded(&entities),
        );

        assert_eq!(states.len(), 1, "shared ancestor baked once: {states:?}");
        assert_eq!(states[0].fragment, entities[0]);
        let band = states[0].reproject_terrain_lat.expect("geographic → band");
        assert!(band[0] < band[1], "south < north: {band:?}");
    }

    /// The overlap budget is per layer, NOT divided across layers: three layers on a
    /// Geographic terrain tile (the reported bug shape) each keep every overlapping WM
    /// tile instead of collapsing to one coarse tile per layer.
    #[test]
    fn resolve_states_budget_is_per_layer_not_divided() {
        let mut world = World::new();
        let mut qt = RasterTileQuadtree::new_with_linear_qt();
        let init = |(x, y, z): (usize, usize, usize)| RasterTile::new(TileXYZ { x, y, z }, 0., 0.);
        qt.qt.initialize_zero(&init);
        qt.qt.initialize_children((0, 0, 0), &init);

        // The Geographic root spans WM z1 tiles (0,0,1) and (0,1,1): a 2-tile overlap.
        let terrain_extent =
            TilingScheme::Geographic { tms: false }.tile_extent(TileXYZ { x: 0, y: 0, z: 0 });
        let mut entities = Vec::new();
        for coords in [(0, 0, 1), (0, 1, 1)] {
            let handle = qt.qt.leaf(coords).unwrap().handle();
            let per_layer: Vec<Entity> = (0..3).map(|_| world.spawn_empty().id()).collect();
            entities.extend(per_layer.iter().copied());
            qt.qt.get_mut(handle).unwrap().texture_fragment_entity_ids =
                Some(per_layer.into_iter().map(Some).collect());
        }

        let states = resolve_raster_tile_states(
            &qt,
            &terrain_extent,
            true,
            &bake_layers(3),
            &loaded(&entities),
        );

        // 3 layers × 2 overlapping tiles: a divided budget (5/3 = 1 per layer) would
        // have coarsened every layer to a single tile.
        for ordinal in 0..3 {
            assert_eq!(
                states.iter().filter(|s| s.layer_ordinal == ordinal).count(),
                2,
                "layer {ordinal} must keep its full overlap: {states:?}"
            );
        }
    }

    /// `layer_ordinal` is the position in the input layer list, not compacted over
    /// layers that resolved nothing — the web pairs ordinals with the k-th baked
    /// composite slot, so a not-yet-loaded layer must not shift the ones after it.
    #[test]
    fn resolve_states_ordinal_is_stable_when_a_layer_is_unloaded() {
        let mut world = World::new();
        let (qt, entities) = qt_with_root_fragments(&mut world, 2);

        // Only layer 1's fragment is loaded.
        let states = resolve_raster_tile_states(
            &qt,
            &wm_root_extent(),
            false,
            &bake_layers(2),
            &loaded(&entities[1..]),
        );

        assert_eq!(states.len(), 1);
        assert_eq!(states[0].layer_ordinal, 1);
        assert_eq!(states[0].fragment, entities[1]);
    }

    /// Nothing loaded anywhere → no drape (the layer simply doesn't draw yet).
    #[test]
    fn resolve_empty_when_unloaded() {
        let mut app = App::new();
        let mut qt = RasterTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| RasterTile::new(TileXYZ { x, y, z }, 0., 0.));
        let terrain_extent =
            TilingScheme::WebMercator { tms: false }.tile_extent(TileXYZ { x: 0, y: 0, z: 0 });
        app.insert_resource(qt);
        app.init_resource::<Out>();
        app.add_systems(
            Update,
            move |raster_qt: Res<RasterTileQuadtree>,
                  texture_fragment: TileTextureFragmentQuery,
                  mut out: ResMut<Out>| {
                out.0 =
                    resolve_raster_texture(&raster_qt, &terrain_extent, 0, 0, &texture_fragment);
            },
        );
        app.update();
        assert!(app.world().resource::<Out>().0.is_none());
    }
}
