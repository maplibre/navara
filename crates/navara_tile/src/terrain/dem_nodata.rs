use bevy_ecs::prelude::*;
use navara_buffer_store::{BufferStore, BufferStoreLoadedEvent};
use navara_core::PoleSides;
use navara_data_requester::DataRequester;
use navara_geometry::fill_polar_nodata_rows;
use navara_layer::TilesLayer;
use navara_tile_component::{
    TerrainDataRequesterMarker, TerrainTileQuadtree, TileTextureFragmentMarker,
};

use crate::hillshade::HillshadeTextureMarker;

/// Rewrites a band-edge raster DEM in place as soon as its bytes land, so the
/// terrain mesh and the hillshade texture (which share the buffer through
/// `DataManager`) both see the dataset's last covered row instead of the 0 m
/// no-data rows past its polar coverage.
#[allow(clippy::type_complexity)]
pub fn fill_polar_dem_nodata(
    mut events: MessageReader<BufferStoreLoadedEvent>,
    mut buf: ResMut<BufferStore>,
    qt: Res<TerrainTileQuadtree>,
    source_store: Res<navara_source::SourceStore>,
    layers: Query<&TilesLayer>,
    requesters: Query<(
        &DataRequester,
        Option<&TerrainDataRequesterMarker>,
        Option<&TileTextureFragmentMarker>,
        Has<HillshadeTextureMarker>,
    )>,
) {
    for event in events.read() {
        let Ok((request, terrain, fragment, hillshade)) = requesters.get(event.id) else {
            continue;
        };
        let handle = match (terrain, fragment, hillshade) {
            (Some(marker), _, _) => marker.0,
            (None, Some(marker), true) => marker.0,
            _ => continue,
        };
        let Some(tile) = qt.qt.get(handle) else {
            continue;
        };
        let sides = PoleSides::from_extent(&tile.tiling_scheme, &tile.extent);
        if sides == PoleSides::default() {
            continue;
        }
        let decoder = if terrain.is_some() {
            tile.terrain_data
                .as_ref()
                .and_then(|t| t.decoder().copied())
        } else {
            layers
                .iter()
                .filter(|layer| layer.hillshade_config.is_some())
                .filter_map(|layer| source_store.get(layer.source_id.as_deref()?))
                .find(|source| {
                    source.url().is_some_and(|template| {
                        source.tiling_scheme().tile_url(template, tile.coords) == request.url
                    })
                })
                .and_then(|source| source.elevation_decoder().copied())
        };
        let Some(decoder) = decoder else {
            continue;
        };
        let Some(bytes) = buf.get_u8(&request.handle) else {
            continue;
        };
        let width = ((bytes.len() / 4) as f64).sqrt() as usize;
        if let Some(filled) = fill_polar_nodata_rows(bytes, width, &decoder, sides) {
            buf.set_u8(request.handle, filled);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_app::{App, PostUpdate};
    use navara_core::{TERRARIUM_ELEVATION_DECODER, TileXYZ};
    use navara_data_requester::{DataRequesterExtension, DataRequesterStatus};
    use navara_geometry::decode_height_from_dem;
    use navara_tile_component::{RasterDEMData, TerrainTile};

    fn terrarium(h: f64) -> [u8; 4] {
        let v = h + 32768.;
        [(v / 256.) as u8, (v % 256.) as u8, 0, 255]
    }

    fn heights(bytes: &[u8], width: usize) -> Vec<f64> {
        bytes
            .as_chunks::<4>()
            .0
            .iter()
            .step_by(width)
            .map(|p| {
                decode_height_from_dem(
                    p[0] as i64,
                    p[1] as i64,
                    p[2] as i64,
                    0.,
                    &TERRARIUM_ELEVATION_DECODER,
                )
            })
            .collect()
    }

    #[test]
    fn rewrites_the_shared_buffer_once_the_terrain_dem_lands() {
        let mut app = App::new();
        app.init_resource::<BufferStore>();
        app.init_resource::<navara_source::SourceStore>();
        app.add_message::<BufferStoreLoadedEvent>();
        app.add_systems(PostUpdate, fill_polar_dem_nodata);

        // The root WebMercator tile touches both poles.
        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| TerrainTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = qt.qt.zero().unwrap().handle();
        qt.qt.get_mut(handle).unwrap().terrain_data =
            Some(Box::new(RasterDEMData::new(TERRARIUM_ELEVATION_DECODER)));
        app.insert_resource(qt);

        // Two zero rows and a blended row on the north side, one zero row and
        // a blended row on the south side.
        let rows = [0., 0., 120., 100., 90., 80., 0.];
        let bytes: Vec<u8> = rows
            .iter()
            .flat_map(|&h| (0..rows.len()).flat_map(move |_| terrarium(h)))
            .collect();
        let buffer = app
            .world_mut()
            .resource_mut::<BufferStore>()
            .new_u8(bytes.clone());
        let requester = app
            .world_mut()
            .spawn((
                DataRequester::new_with_status(
                    buffer,
                    "dem".into(),
                    DataRequesterExtension::Png,
                    DataRequesterStatus::Success,
                ),
                TerrainDataRequesterMarker(handle),
            ))
            .id();
        app.world_mut().write_message(BufferStoreLoadedEvent {
            id: requester,
            ty: navara_buffer_store::BufferType::U8,
            handle: buffer,
        });
        app.update();

        let filled = app
            .world()
            .resource::<BufferStore>()
            .get_u8(&buffer)
            .unwrap();
        assert_eq!(
            heights(filled, rows.len()),
            [100., 100., 100., 100., 90., 90., 90.]
        );

        // A requester without a tile marker leaves its buffer alone.
        let other = app
            .world_mut()
            .resource_mut::<BufferStore>()
            .new_u8(bytes.clone());
        let plain = app
            .world_mut()
            .spawn(DataRequester::new_with_status(
                other,
                "dem".into(),
                DataRequesterExtension::Png,
                DataRequesterStatus::Success,
            ))
            .id();
        app.world_mut().write_message(BufferStoreLoadedEvent {
            id: plain,
            ty: navara_buffer_store::BufferType::U8,
            handle: other,
        });
        app.update();
        assert_eq!(
            app.world()
                .resource::<BufferStore>()
                .get_u8(&other)
                .unwrap(),
            &bytes
        );
    }
}
