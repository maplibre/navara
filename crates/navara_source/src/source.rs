use bevy_ecs::component::Component;
use navara_core::{CRS, ElevationDecoder, TilingScheme};
use navara_parser::geojson::GeoJson;

/// The origin and format of data consumed by one or more layers.
///
/// A `Source` owns everything required to fetch and decode data (URL, zoom
/// range, tiling scheme, decoder, inline data, ...). Rendering options live on
/// the layer side. Multiple layers may reference the same source by id; the
/// engine deduplicates the underlying fetch/tiling resources.
///
/// The enum is spawned as a single component on the source entity, so systems
/// can query `&Source` and dispatch on its variant.
#[derive(Debug, Clone, PartialEq, Component)]
pub enum Source {
    GeoJson(GeoJsonSource),
    VectorTile(VectorTileSource),
    RasterTile(RasterTileSource),
    RasterDem(RasterDemSource),
    QuantizedMesh(QuantizedMeshSource),
    Tiles3d(Tiles3dSource),
    B3dm(B3dmSource),
    Pnts(PntsSource),
}

impl Source {
    /// The engine-generated id of this source.
    pub fn source_id(&self) -> &str {
        match self {
            Source::GeoJson(s) => &s.source_id,
            Source::VectorTile(s) => &s.source_id,
            Source::RasterTile(s) => &s.source_id,
            Source::RasterDem(s) => &s.source_id,
            Source::QuantizedMesh(s) => &s.source_id,
            Source::Tiles3d(s) => &s.source_id,
            Source::B3dm(s) => &s.source_id,
            Source::Pnts(s) => &s.source_id,
        }
    }

    /// The fetch URL (template) of this source, if it has one. Inline GeoJSON
    /// and other URL-less variants return `None`.
    pub fn url(&self) -> Option<&str> {
        match self {
            Source::GeoJson(s) => match s.data.as_ref() {
                Some(GeoJsonData::Url(url)) => Some(url),
                _ => None,
            },
            Source::VectorTile(s) => Some(&s.url),
            Source::RasterTile(s) => Some(&s.url),
            Source::RasterDem(s) => Some(&s.url),
            Source::QuantizedMesh(s) => Some(&s.url),
            Source::Tiles3d(s) => Some(&s.url),
            Source::B3dm(s) => Some(&s.url),
            Source::Pnts(s) => Some(&s.url),
        }
    }

    /// Minimum zoom level this source provides tiles for.
    pub fn min_zoom(&self) -> usize {
        match self {
            Source::VectorTile(s) => s.min_zoom,
            Source::RasterTile(s) => s.min_zoom,
            Source::RasterDem(s) => s.min_zoom,
            Source::QuantizedMesh(s) => s.min_zoom,
            _ => unreachable!("min_zoom is not supported for this source variant"),
        }
    }

    /// Maximum zoom level new tiles are requested for.
    pub fn max_zoom(&self) -> usize {
        match self {
            Source::VectorTile(s) => s.max_zoom,
            Source::RasterTile(s) => s.max_zoom,
            Source::RasterDem(s) => s.max_zoom,
            Source::QuantizedMesh(s) => s.max_zoom,
            _ => unreachable!("max_zoom is not supported for this source variant"),
        }
    }

    /// Maximum zoom level overscaled (stretched-parent) tiles are used up to.
    pub fn overscaled_max_zoom(&self) -> usize {
        match self {
            Source::VectorTile(s) => s.overscaled_max_zoom,
            Source::RasterTile(s) => s.overscaled_max_zoom,
            Source::RasterDem(s) => s.overscaled_max_zoom,
            Source::QuantizedMesh(s) => s.overscaled_max_zoom,
            _ => unreachable!("overscaled_max_zoom is not supported for this source variant"),
        }
    }

    /// Whether the tile scheme is flipped along the Y axis (TMS).
    pub fn tms(&self) -> bool {
        match self {
            Source::RasterTile(s) => s.tms,
            Source::RasterDem(s) => s.tms,
            _ => unreachable!("tms is not supported for this source variant"),
        }
    }

    /// Maximum screen-space error driving vector-tile traversal.
    pub fn max_sse(&self) -> f32 {
        match self {
            Source::VectorTile(s) => s.max_sse,
            _ => unreachable!("max_sse is not supported for this source variant"),
        }
    }

    /// Whether `z` is at or beyond this source's minimum zoom.
    pub fn is_over_min_zoom(&self, z: usize) -> bool {
        z >= self.min_zoom()
    }

    /// Whether `z` is past this source's maximum zoom. `max_zoom` is the
    /// deepest level the source has tiles for and is fetched like any other,
    /// as `min_zoom` is the shallowest — the TileJSON reading, which is what
    /// a `maxZoom` written against a real tile set means.
    pub fn is_over_max_zoom(&self, z: usize) -> bool {
        z > self.max_zoom()
    }

    /// Whether `z` is past this source's overscaled maximum zoom, the deepest
    /// level tiles are upsampled to (inclusive, like `max_zoom`).
    pub fn is_over_overscaled_max_zoom(&self, z: usize) -> bool {
        z > self.overscaled_max_zoom()
    }

    /// Whether tiles at `z` should reuse an overscaled parent tile: past
    /// `max_zoom` but still within `overscaled_max_zoom`.
    pub fn should_overscale(&self, z: usize) -> bool {
        self.is_over_max_zoom(z) && !self.is_over_overscaled_max_zoom(z)
    }

    /// How RGB tile channels decode into a height value. Only raster-DEM terrain
    /// carries a decoder; other terrain variants return `None`.
    pub fn elevation_decoder(&self) -> Option<&ElevationDecoder> {
        match self {
            Source::RasterDem(s) => Some(&s.elevation_decoder),
            Source::QuantizedMesh(_) => None,
            _ => unreachable!("elevation_decoder is not supported for this source variant"),
        }
    }

    /// Pixel size of a terrain DEM tile.
    pub fn tile_size(&self) -> u32 {
        match self {
            Source::RasterDem(s) => s.tile_size,
            Source::QuantizedMesh(_) => 256,
            _ => unreachable!("tile_size is not supported for this source variant"),
        }
    }

    /// Tiling scheme used to lay out this terrain source's tiles.
    pub fn tiling_scheme(&self) -> TilingScheme {
        match self {
            Source::RasterDem(s) => TilingScheme::WebMercator { tms: s.tms },
            Source::QuantizedMesh(s) => s.tiling_scheme.clone(),
            _ => unreachable!("tiling_scheme is not supported for this source variant"),
        }
    }

    /// Bearer token sent as the `Authorization` header when fetching tiles. Only
    /// quantized-mesh terrain carries a token; other terrain variants return `None`.
    pub fn token(&self) -> Option<&str> {
        match self {
            Source::QuantizedMesh(s) => s.token.as_deref(),
            Source::RasterDem(_) => None,
            _ => unreachable!("token is not supported for this source variant"),
        }
    }

    /// Whether to request the quantized-mesh oct-encoded per-vertex normals
    /// extension. Always false for non-quantized-mesh terrain.
    pub fn request_vertex_normals(&self) -> bool {
        match self {
            Source::QuantizedMesh(s) => s.request_vertex_normals,
            Source::RasterDem(_) => false,
            _ => unreachable!("request_vertex_normals is not supported for this source variant"),
        }
    }

    /// Whether to request the quantized-mesh watermask extension. Always false
    /// for non-quantized-mesh terrain.
    pub fn request_water_mask(&self) -> bool {
        match self {
            Source::QuantizedMesh(s) => s.request_water_mask,
            Source::RasterDem(_) => false,
            _ => unreachable!("request_water_mask is not supported for this source variant"),
        }
    }

    /// The stable kebab-case type identifier of this source's variant. Shared
    /// with the TypeScript/WASM API, where it tags the source description.
    pub fn source_type(&self) -> &'static str {
        match self {
            Source::GeoJson(_) => "geojson",
            Source::VectorTile(_) => "vector-tile",
            Source::RasterTile(_) => "raster-tile",
            Source::RasterDem(_) => "raster-dem",
            Source::QuantizedMesh(_) => "quantized-mesh",
            Source::Tiles3d(_) => "3d-tiles",
            Source::B3dm(_) => "b3dm",
            Source::Pnts(_) => "pnts",
        }
    }
}

/// GeoJSON data, either provided inline or fetched from a URL.
#[derive(Debug, Clone, PartialEq)]
pub enum GeoJsonData {
    /// Inline GeoJSON. Has no URL, so sharing is governed solely by the
    /// source id rather than the URL-based fetch deduplication.
    GeoJson(GeoJson),
    /// A URL the GeoJSON document is fetched from.
    Url(String),
}

/// Vector data from a GeoJSON document (inline or URL).
#[derive(Debug, Clone, PartialEq)]
pub struct GeoJsonSource {
    pub source_id: String,
    pub data: Option<GeoJsonData>,
    pub crs: Option<CRS>,
    /// Whether to build a tiled spatial index (GeoJSON-VT) for large datasets.
    pub tiled: bool,
}

/// Mapbox Vector Tile (MVT) source. This describes only the tileset; which
/// source layers to render is chosen per layer (MapLibre's `source-layer`).
#[derive(Debug, Clone, PartialEq)]
pub struct VectorTileSource {
    pub source_id: String,
    pub url: String,
    /// Lowest zoom the source provides data for. Traversal never selects a
    /// tile below this level as a leaf, so LOD relaxation (dynamic SSE) can
    /// coarsen down to — but not past — the data-available floor.
    pub min_zoom: usize,
    pub max_zoom: usize,
    pub overscaled_max_zoom: usize,
    pub max_sse: f32,
    /// Per-layer override for the horizon dynamic-SSE relaxation strength
    /// (`0.0` off … `1.0` raster-equivalent). `None` falls back to a
    /// content-based default (see `TraversalConfig::from_appearances`).
    pub dynamic_sse_scale: Option<f32>,
    pub crs: Option<CRS>,
}

/// Raster imagery tile source (XYZ / TMS).
#[derive(Debug, Clone, PartialEq)]
pub struct RasterTileSource {
    pub source_id: String,
    pub url: String,
    pub tms: bool,
    pub min_zoom: usize,
    pub max_zoom: usize,
    pub overscaled_max_zoom: usize,
}

/// Raster DEM source (RGB-encoded elevation). Used by terrain meshing as well
/// as hillshade / elevation-heatmap raster layers, which decode the same tiles
/// via [`ElevationDecoder`].
#[derive(Debug, Clone, PartialEq)]
pub struct RasterDemSource {
    pub source_id: String,
    pub url: String,
    pub tms: bool,
    /// How to decode RGB channels into a height value.
    pub elevation_decoder: ElevationDecoder,
    pub tile_size: u32,
    pub min_zoom: usize,
    pub max_zoom: usize,
    pub overscaled_max_zoom: usize,
}

/// Cesium quantized-mesh terrain source.
#[derive(Debug, Clone, PartialEq)]
pub struct QuantizedMeshSource {
    pub source_id: String,
    pub url: String,
    pub tiling_scheme: TilingScheme,
    pub request_vertex_normals: bool,
    pub request_water_mask: bool,
    /// Bearer token sent as the `Authorization` header when fetching tiles.
    pub token: Option<String>,
    pub min_zoom: usize,
    pub max_zoom: usize,
    pub overscaled_max_zoom: usize,
}

/// 3D Tiles source pointing at a `tileset.json` hierarchy.
#[derive(Debug, Clone, PartialEq)]
pub struct Tiles3dSource {
    pub source_id: String,
    pub url: String,
    pub crs: Option<CRS>,
}

/// Single batched 3D model (b3dm) content source.
#[derive(Debug, Clone, PartialEq)]
pub struct B3dmSource {
    pub source_id: String,
    pub url: String,
    pub crs: Option<CRS>,
}

/// Single point cloud (pnts) content source.
#[derive(Debug, Clone, PartialEq)]
pub struct PntsSource {
    pub source_id: String,
    pub url: String,
    pub crs: Option<CRS>,
}
