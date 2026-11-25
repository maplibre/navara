use std::sync::Arc;

use bevy_ecs::component::Component;
use navara_buffer_store::Handle;
use navara_core::CRS;
use navara_math::Vec3;

#[derive(Component)]
pub struct ModelMarker;

#[derive(Component)]
pub struct ModelGeometry {
    pub coords: Vec3,
    pub crs: CRS,
}

#[derive(Clone, Debug, Default, PartialEq, Component)]
pub struct ModelBin {
    pub handle: Handle,
    /// `None` when the bin is not glTF or was not fetched over http(s).
    pub gltf_resource: Option<Arc<GltfResourceBase>>,
}

/// 3D Tiles metadata of the tile, content and group a model was loaded from,
/// as a JSON object `{ tile?, content?, group? }` of resolved entities.
#[derive(Clone, Debug, PartialEq, Component)]
pub struct TileContentMetadata(pub Arc<str>);

/// Where relative URIs inside a glTF bin resolve.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GltfResourceBase {
    /// Directory of the bin's URL, without query.
    pub path: String,
    /// Query of the bin's URL; fills in parameters a resolved URI lacks.
    pub query: Option<String>,
}
