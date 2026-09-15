use crate::{Extent, Float, LngLat, Rad, Radians};
use navara_math::{FloatType, Two};
use regex::Regex;
use serde::{Deserialize, Serialize};
use url::Url;

/// Tiling scheme for a quadtree Globe.
///
/// `WebMercator`: single root `(0,0,0)`, tile extents use the Mercator projection.
/// `Geographic`: two roots `(0,0,0)` and `(1,0,0)`, tile extents are equal-degree
/// (EPSG:4326, 2^(z+1) columns × 2^z rows).
///
/// In both variants internal `coords.y` is XYZ-style (y=0 at the north edge).
/// The `tms` flag describes the URL endpoint convention: when `tms = true` the
/// URL receives a south-origin `{y}` (the y is flipped) for TMS-compatible servers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TilingScheme {
    WebMercator { tms: bool },
    Geographic { tms: bool },
}

impl Default for TilingScheme {
    fn default() -> Self {
        TilingScheme::WebMercator { tms: false }
    }
}

/// Polar caps belonging to a WebMercator tile.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PoleSides {
    pub north: bool,
    pub south: bool,
}

impl PoleSides {
    pub fn from_extent(scheme: &TilingScheme, extent: &Extent<FloatType, Radians>) -> Self {
        const WM_MAX_LAT: f64 = 1.484_422_229_745_332_4;
        const EPSILON: f64 = 1e-12;
        let mercator = matches!(scheme, TilingScheme::WebMercator { .. });
        Self {
            north: mercator && extent.north.val() >= WM_MAX_LAT - EPSILON,
            south: mercator && extent.south.val() <= -WM_MAX_LAT + EPSILON,
        }
    }

    pub fn extended_extent(
        self,
        mut extent: Extent<FloatType, Radians>,
    ) -> Extent<FloatType, Radians> {
        if self.north {
            extent.north = crate::Angle::new(std::f64::consts::FRAC_PI_2);
        }
        if self.south {
            extent.south = crate::Angle::new(-std::f64::consts::FRAC_PI_2);
        }
        extent
    }

    /// Bounds include the height-zero cap even when all DEM samples have the same sign.
    pub fn height_range(self, min_height: f64, max_height: f64) -> (f64, f64) {
        if self.north || self.south {
            (min_height.min(0.), max_height.max(0.))
        } else {
            (min_height, max_height)
        }
    }
}

impl TilingScheme {
    /// Root tile(s) for this scheme.
    pub fn root_tiles(&self) -> Vec<TileXYZ> {
        match self {
            TilingScheme::WebMercator { .. } => vec![TileXYZ { x: 0, y: 0, z: 0 }],
            TilingScheme::Geographic { .. } => {
                vec![TileXYZ { x: 0, y: 0, z: 0 }, TileXYZ { x: 1, y: 0, z: 0 }]
            }
        }
    }

    /// Tile extent in lng/lat radians for the given tile coordinates.
    pub fn tile_extent(&self, coords: TileXYZ) -> Extent<FloatType, Radians> {
        match self {
            TilingScheme::WebMercator { .. } => web_mercator_tile_extent(coords),
            TilingScheme::Geographic { .. } => geographic_tile_extent(coords),
        }
    }

    /// Build a tile URL for a server using this tiling scheme.
    /// `tms = true` flips the internal XYZ-style `y` into TMS's south-origin `y`.
    pub fn tile_url(&self, base_url: &str, coords: TileXYZ) -> String {
        let y = if self.tms() {
            (1usize << coords.z) - 1 - coords.y
        } else {
            coords.y
        };
        base_url
            .replace("{x}", &coords.x.to_string())
            .replace("{y}", &y.to_string())
            .replace("{z}", &coords.z.to_string())
    }

    pub fn tms(&self) -> bool {
        match self {
            TilingScheme::WebMercator { tms } | TilingScheme::Geographic { tms } => *tms,
        }
    }

    /// Tile containing `pos` at zoom `z` — the inverse of [`Self::tile_extent`].
    ///
    /// Returned `y` is XYZ-style (north-origin), matching `tile_extent`; apply
    /// the TMS flip only when building URLs (see [`Self::tile_url`]).
    /// Positions outside the scheme's domain clamp onto the nearest edge tile:
    /// for WebMercator a latitude beyond the ~±85.05° band lands on the edge
    /// row, and `lng = +π` lands in the last column.
    pub fn position_to_tile_xy(&self, pos: LngLat<FloatType, Radians>, z: usize) -> TileXYZ {
        match self {
            TilingScheme::WebMercator { .. } => {
                let n = 1usize << z;
                let last = (n - 1) as FloatType;
                // Clamp into the WM band first: beyond it `y` diverges.
                let max_lat = web_mercator_world_pos_to_lnglat::<FloatType>(0., 0.)
                    .lat
                    .val();
                let clamped = LngLat {
                    lng: pos.lng,
                    lat: Rad::new(pos.lat.val().clamp(-max_lat, max_lat)),
                };
                let (wx, wy) = web_mercator_lnglat_to_world_pos(clamped);
                let nf = n as FloatType;
                TileXYZ {
                    x: (wx * nf).floor().clamp(0.0, last) as usize,
                    y: (wy * nf).floor().clamp(0.0, last) as usize,
                    z,
                }
            }
            TilingScheme::Geographic { .. } => {
                let n_x = (1usize << (z + 1)) as FloatType;
                let n_y = (1usize << z) as FloatType;
                let lng_deg = pos.lng.val().to_degrees();
                let lat_deg = pos.lat.val().to_degrees();
                let x = ((lng_deg + 180.0) / 360.0 * n_x)
                    .floor()
                    .clamp(0.0, n_x - 1.0);
                let y = ((90.0 - lat_deg) / 180.0 * n_y)
                    .floor()
                    .clamp(0.0, n_y - 1.0);
                TileXYZ {
                    x: x as usize,
                    y: y as usize,
                    z,
                }
            }
        }
    }

    pub fn is_geographic(&self) -> bool {
        matches!(self, TilingScheme::Geographic { .. })
    }
}

/// Computes the Web Mercator tile extent from tile coordinates.
fn web_mercator_tile_extent(coords: TileXYZ) -> Extent<FloatType, Radians> {
    let e1 = coords.north_west_world_pos();
    let e2 = (TileXYZ {
        x: coords.x + 1,
        y: coords.y + 1,
        z: coords.z,
    })
    .north_west_world_pos();

    let p1 = web_mercator_world_pos_to_lnglat(e1.0, e1.1);
    let p2 = web_mercator_world_pos_to_lnglat(e2.0, e2.1);
    Extent::from_points(&[p1, p2])
}

/// Computes the EPSG:4326 tile extent from geographic tile coordinates.
/// At level z: 2^(z+1) columns × 2^z rows, each tile is (180/2^z)° square.
///
/// Internal `coords.y` is always XYZ-style: `y = 0` is the northernmost row.
fn geographic_tile_extent(coords: TileXYZ) -> Extent<FloatType, Radians> {
    let n_x = (1usize << (coords.z + 1)) as FloatType;
    let n_y = (1usize << coords.z) as FloatType;

    let x = coords.x as FloatType;
    let y = coords.y as FloatType;

    let tile_width_lon = 360.0 / n_x;
    let tile_height_lat = 180.0 / n_y;

    let west_rad = (x * tile_width_lon - 180.0).to_radians();
    let east_rad = ((x + 1.0) * tile_width_lon - 180.0).to_radians();
    let north_rad = (90.0 - y * tile_height_lat).to_radians();
    let south_rad = (90.0 - (y + 1.0) * tile_height_lat).to_radians();

    let sw = LngLat {
        lng: Rad::new(west_rad),
        lat: Rad::new(south_rad),
    };
    let ne = LngLat {
        lng: Rad::new(east_rad),
        lat: Rad::new(north_rad),
    };
    Extent::from_points(&[sw, ne])
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct TileXY {
    pub x: usize,
    pub y: usize,
}

impl From<TileXYZ> for TileXY {
    fn from(xyz: TileXYZ) -> Self {
        Self { x: xyz.x, y: xyz.y }
    }
}

impl TileXY {
    pub fn to_xyz(self, z: usize) -> TileXYZ {
        TileXYZ {
            x: self.x,
            y: self.y,
            z,
        }
    }
}

#[derive(Debug, Copy, Clone, Default, PartialEq, Eq, Hash)]
pub struct TileXYZ {
    pub x: usize,
    pub y: usize,
    pub z: usize,
}

#[derive(Debug)]
pub enum TileRegion {
    NorthWest,
    NorthEast,
    SouthEast,
    SouthWest,
}

impl TileXYZ {
    /// Returns the number of tiles in the x and y direction at this zoom level.
    pub fn n(self) -> usize {
        2_usize.pow(self.z as u32)
    }

    /// Returns the normalized world position of the north-west corner of the tile.
    pub fn north_west_world_pos(self) -> (FloatType, FloatType) {
        let n = self.n() as FloatType;
        (self.x as FloatType / n, self.y as FloatType / n)
    }
}

/// Converts a normalized world position in Web mercator to a longitude and latitude.
pub fn web_mercator_world_pos_to_lnglat<F: Float + Two<F>>(x: F, y: F) -> LngLat<F, Radians> {
    let pi_4 = F::PI / (F::two() * F::two());
    let lng = x * (F::two() * F::PI) - F::PI;
    let phi = F::PI - F::two() * F::PI * y; // y=0 -> PI, y=1 -> -PI
    let lat = F::two() * (phi.exp().atan() - pi_4);
    LngLat {
        lng: Rad::new(lng),
        lat: Rad::new(lat),
    }
}

/// Inverse of [`web_mercator_world_pos_to_lnglat`]: lng/lat (radians) →
/// normalized Web Mercator world position `(x, y)` in `[0, 1]`.
///
/// Latitude beyond the Web Mercator valid band (~±85.05°) is not representable
/// (`y` diverges), so callers that may pass polar latitudes should clamp first —
/// see [`web_mercator_overlapping_tiles`].
/// ref: https://en.wikipedia.org/wiki/Web_Mercator_projection
pub fn web_mercator_lnglat_to_world_pos<F: Float + Two<F>>(lnglat: LngLat<F, Radians>) -> (F, F) {
    let pi_4 = F::PI / (F::two() * F::two());
    let two_pi = F::two() * F::PI;
    let lng = lnglat.lng.val();
    let lat = lnglat.lat.val();
    let x = (lng + F::PI) / two_pi;
    // Forward: lat = 2*(atan(exp(phi)) - π/4) with phi = π - 2π*y.
    // Invert: phi = ln(tan(lat/2 + π/4)); y = (π - phi) / 2π.
    let phi = (lat / F::two() + pi_4).tan().ln();
    let y = (F::PI - phi) / two_pi;
    (x, y)
}

/// The WebMercator tiles at zoom `z` whose extent overlaps `extent` (geographic
/// lng/lat radians). Returned in row-major (y outer, x inner) order.
///
/// Used to drape WebMercator raster onto a terrain tile of a different scheme
/// (Geographic): one terrain tile overlaps several WM tiles. Latitude is clamped
/// to the WM valid band, so an extent reaching past it (toward the poles) collapses
/// onto the band-edge tile row — that edge tile is stretched across the polar cap by
/// the composite shader, since WM imagery carries no data beyond ~±85.05°. A
/// boundary-aligned extent resolves to exactly the tiles it covers (no spurious
/// extra tile).
pub fn web_mercator_overlapping_tiles(
    extent: Extent<FloatType, Radians>,
    z: usize,
) -> Vec<TileXYZ> {
    let n = (1usize << z) as FloatType;

    // WM latitude coverage: lat at y=0 (north) and y=1 (south).
    let max_lat = web_mercator_world_pos_to_lnglat::<FloatType>(0., 0.)
        .lat
        .val();
    let min_lat = web_mercator_world_pos_to_lnglat::<FloatType>(0., 1.)
        .lat
        .val();

    let ext_north = extent.north.val();
    let ext_south = extent.south.val();
    // No longitudinal overlap is impossible (WM x is defined for every lng), so the
    // only way to miss entirely is a degenerate extent. Clamp the latitude span into
    // the WM-representable band: a terrain tile reaching past the band (Geographic
    // terrain goes to ±90°, WM stops at ~±85.05°) collapses onto the band-edge row.
    // That edge raster tile is then stretched across the polar cap by the composite
    // shader — WM imagery has no polar data, so the last available row is reused.
    let north = ext_north.clamp(min_lat, max_lat);
    let south = ext_south.clamp(min_lat, max_lat);
    let west = extent.west.val();
    let east = extent.east.val();

    let nw = web_mercator_lnglat_to_world_pos(LngLat {
        lng: Rad::new(west),
        lat: Rad::new(north),
    });
    let se = web_mercator_lnglat_to_world_pos(LngLat {
        lng: Rad::new(east),
        lat: Rad::new(south),
    });

    // Tile i covers [i/n, (i+1)/n); it overlaps [min, max] for
    // i ∈ [floor(min*n), ceil(max*n) - 1]. North maps to the smaller y. The eps
    // nudge keeps boundary-aligned extents (e.g. a WM tile's own extent after a
    // projection round-trip) from leaking into the neighbouring tile.
    let last = (n as isize) - 1;
    let eps = 1e-9;
    let lo = |v: FloatType| (((v * n) + eps).floor() as isize).clamp(0, last) as usize;
    let hi = |v: FloatType| ((((v * n) - eps).ceil() as isize) - 1).clamp(0, last) as usize;

    let x0 = lo(nw.0);
    let x1 = hi(se.0);
    let y0 = lo(nw.1);
    let y1 = hi(se.1);

    let mut tiles = Vec::with_capacity((x1 - x0 + 1) * (y1 - y0 + 1));
    for y in y0..=y1 {
        for x in x0..=x1 {
            tiles.push(TileXYZ { x, y, z });
        }
    }
    tiles
}

/// Pick the WebMercator zoom whose tiles roughly match a terrain tile of the given
/// longitude span, so one terrain tile overlaps only a handful of WM tiles. A WM tile
/// at zoom `z` spans `2π / 2^z` radians of longitude, so `z = log2(2π / span)`. For
/// WebMercator terrain this returns the terrain tile's own zoom (identity drape).
/// Clamped to `max_zoom`.
pub fn wm_zoom_for_lng_span(lng_span: FloatType, max_zoom: usize) -> usize {
    if lng_span <= 0. {
        return 0;
    }
    let z = (std::f64::consts::TAU / lng_span).log2().round();
    (z.max(0.) as usize).min(max_zoom)
}

/// The WebMercator tiles covering `extent`, at the finest zoom `<= target_z` whose
/// overlap count fits `max_tiles`. Draping WebMercator tiles on a Geographic terrain
/// tile is N:M and the overlap grows toward the poles (Mercator compresses latitude),
/// so a single terrain tile can overlap more WM tiles than a renderer has slots for.
/// Coarsening the zoom shrinks the count — each step roughly halves the tile grid on
/// both axes — so we drop to the finest zoom that still fits `max_tiles`. At least one
/// tile is always returned (a `max_tiles` of 0 is treated as 1); the budget caps
/// fan-out, it never drops the drape entirely.
pub fn overlapping_tiles_within_budget(
    extent: Extent<FloatType, Radians>,
    target_z: usize,
    max_tiles: usize,
) -> Vec<TileXYZ> {
    let budget = max_tiles.max(1);
    let mut z = target_z;
    loop {
        let tiles = web_mercator_overlapping_tiles(extent, z);
        if tiles.len() <= budget || z == 0 {
            return tiles;
        }
        z -= 1;
    }
}

/// Converts a tile Y coordinate to latitude in radians using Web Mercator projection.
///
/// # Arguments
/// * `y` - Tile Y coordinate (can be fractional, e.g., y + 0.5 for tile center)
/// * `z` - Zoom level
///
/// # Returns
/// Latitude in radians
///
/// # Note
/// This uses the identity: lat = atan(sinh(π·(1 - 2·y_normalized)))
/// which is equivalent to: lat = 2·atan(exp(π·(1 - 2·y_normalized))) - π/2
pub fn tile_y_to_latitude(y: f64, z: usize) -> f64 {
    let tile_size = (z as f64).exp2();
    let normalized_y = y / tile_size;
    let phi = std::f64::consts::PI * (1.0 - 2.0 * normalized_y);
    phi.sinh().atan()
}

/// Calculates meters per texel for a tile at given coordinates.
/// This is used for hillshade normal map generation to determine the scale of elevation changes.
///
/// # Arguments
/// * `tile_y` - Tile Y coordinate
/// * `tile_z` - Tile zoom level
/// * `texture_zoom` - Texture zoom level (may differ from tile zoom for overscaled tiles)
/// * `texture_width` - Total texture width in pixels (including padding)
/// * `ellipsoid_semi_major_axis` - Semi-major axis of the ellipsoid in meters (e.g., WGS84: 6378137.0)
///
/// # Returns
/// Meters per texel at the tile's center latitude
///
/// # Note
/// The calculation accounts for:
/// - 2-pixel padding (content width = texture_width - 2)
/// - Web Mercator distortion (using cosine of latitude)
/// - Earth's curvature (using ellipsoid circumference)
pub fn calc_meters_per_texel(
    tile_y: usize,
    tile_z: usize,
    texture_zoom: usize,
    texture_width: u32,
    ellipsoid_semi_major_axis: f64,
) -> f32 {
    // Calculate latitude at tile center and get its cosine for Web Mercator correction
    let cos_lat = tile_y_to_latitude(tile_y as f64 + 0.5, tile_z).cos();
    let earth_circumference = 2.0 * std::f64::consts::PI * ellipsoid_semi_major_axis;
    let content_pixel_width = texture_width.saturating_sub(2).max(1) as f64;
    let meters_per_texel =
        (earth_circumference * cos_lat) / (content_pixel_width * (texture_zoom as f64).exp2());
    meters_per_texel as f32
}

/// Estimates the effective Web Mercator zoom level a camera is viewing the
/// surface at, from its ellipsoid height and vertical field of view.
///
/// Inverts the model in [`calc_meters_per_texel`] (256px tiles, Web Mercator
/// latitude correction): the ground meters-per-pixel implied by the camera
/// frustum is mapped back to a zoom level.
///
/// # Arguments
/// * `height_m` - Camera height above the ellipsoid in meters
/// * `fov_y` - Vertical field of view in radians
/// * `viewport_height_px` - Rendered viewport height in (CSS) pixels
/// * `lat_rad` - Camera latitude in radians
/// * `semi_major_axis` - Ellipsoid semi-major axis in meters (e.g. WGS84: 6378137.0)
///
/// # Returns
/// The fractional zoom level. The caller guards against invalid inputs
/// (non-positive height / viewport).
pub fn camera_zoom_level(
    height_m: f64,
    fov_y: f64,
    viewport_height_px: f64,
    lat_rad: f64,
    semi_major_axis: f64,
) -> f64 {
    const TILE_SIZE_PX: f64 = 256.0;
    let meters_per_pixel = (2.0 * height_m * (fov_y / 2.0).tan()) / viewport_height_px;
    let earth_circumference = 2.0 * std::f64::consts::PI * semi_major_axis;
    let meters_per_pixel_z0 = (earth_circumference * lat_rad.cos()) / TILE_SIZE_PX;
    (meters_per_pixel_z0 / meters_per_pixel).log2()
}

pub fn is_tile_url(s: &str) -> bool {
    s.contains("/{x}") && s.contains("/{y}") && s.contains("/{z}")
}

/// Returns true if the URL points to a PMTiles archive, i.e. its path ends with
/// `.pmtiles` (case-insensitive), ignoring any query string or fragment.
pub fn is_pmtiles_url(s: &str) -> bool {
    // Let the `url` crate strip the query/fragment via a real parser. It rejects
    // relative URLs, so fall back to a manual split for those.
    let path = match Url::parse(s) {
        Ok(url) => url.path().to_ascii_lowercase(),
        Err(_) => s.split(['?', '#']).next().unwrap_or(s).to_ascii_lowercase(),
    };
    path.ends_with(".pmtiles")
}

// Ref: https://github.com/mapbox/vector-tile-spec/tree/master/2.1#3-projection-and-bounds
// The function get_tile_pos_from_url is designed to parse the values of x, y, and z
// from the end of a URL in the format .../z/x/y.mvt
pub fn get_tile_pos_from_url(url: &str) -> Option<TileXYZ> {
    // Define a regular expression to match the three numbers in the URL
    let re = Regex::new(r"/(\d+)/(\d+)/(\d+)\.(mvt|pbf)$").unwrap();

    if let Some(captures) = re.captures(url) {
        // Parse and assign the three values to z, x, and y respectively
        let z: usize = captures[1].parse().ok()?;
        let x: usize = captures[2].parse().ok()?;
        let y: usize = captures[3].parse().ok()?;

        // Return (x, y, z)
        Some(TileXYZ { x, y, z })
    } else {
        None
    }
}

#[derive(Debug, Copy, Clone, PartialEq)]
pub struct TileXYZIterator {
    z: usize,
    x: usize,
    y: usize,
    n: usize,
}

impl Iterator for TileXYZIterator {
    type Item = TileXYZ;

    fn next(&mut self) -> Option<Self::Item> {
        if self.y < self.n {
            let result = Some(TileXYZ {
                x: self.x,
                y: self.y,
                z: self.z,
            });
            self.x += 1;
            if self.x == self.n {
                self.x = 0;
                self.y += 1;
            }
            result
        } else {
            None
        }
    }
}

pub fn iter_tiles(z: usize) -> TileXYZIterator {
    let n = 2_usize.pow(z as u32);
    TileXYZIterator { z, x: 0, y: 0, n }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_web_mercator_world_pos_to_west_north() {
        let p = web_mercator_world_pos_to_lnglat(0.5, 0.5);
        assert_eq!(p.lng, Rad::new(0.0));
        assert_eq!(p.lat, Rad::new(0.0));
    }

    #[test]
    fn test_camera_zoom_level() {
        const A: f64 = 6378137.0;
        // Doubling the camera altitude halves the ground resolution, so the
        // zoom level drops by exactly 1.
        let z1 = camera_zoom_level(1000.0, 1.0, 800.0, 0.0, A);
        let z2 = camera_zoom_level(2000.0, 1.0, 800.0, 0.0, A);
        assert!(
            (z1 - z2 - 1.0).abs() < 1e-6,
            "doubling height should drop zoom by 1"
        );
        // Closer to the surface means a higher zoom level.
        assert!(z1 > z2);
    }

    #[test]
    fn test_tile_y_to_latitude() {
        // Test at equator (tile center at y=0.5 at z=0 should give lat=0)
        let lat = tile_y_to_latitude(0.5, 0);
        assert!((lat - 0.0).abs() < 1e-10, "Equator should have latitude 0");

        // Test at zoom 1, center of tile (0, 0) should be north of equator
        let lat_north = tile_y_to_latitude(0.5, 1);
        assert!(lat_north > 0.0, "North tile should have positive latitude");

        // Test at zoom 1, center of tile (0, 1) should be south of equator
        let lat_south = tile_y_to_latitude(1.5, 1);
        assert!(lat_south < 0.0, "South tile should have negative latitude");

        // Test symmetry: tiles equidistant from equator should have opposite latitudes
        assert!(
            (lat_north + lat_south).abs() < 1e-10,
            "Latitudes should be symmetric around equator"
        );
    }

    #[test]
    fn test_tile_extent() {
        const PI: FloatType = std::f64::consts::PI;
        let max_lat = 2.0 * (((PI - 2.0 * PI * 0.0).exp().atan()) - PI / 4.0);
        let min_lat = 2.0 * (((PI - 2.0 * PI * 1.0).exp().atan()) - PI / 4.0);

        let xyz = TileXYZ { x: 0, y: 0, z: 0 };
        let extent = TilingScheme::WebMercator { tms: false }.tile_extent(xyz);
        assert_eq!(extent.west, Rad::new(-PI), "west");
        assert_eq!(extent.east, Rad::new(PI), "east");
        assert_eq!(extent.north, Rad::new(max_lat), "north");
        assert_eq!(extent.south, Rad::new(min_lat), "south");
    }

    #[test]
    fn test_geographic_tile_extent_z0() {
        use std::f64::consts::PI;
        // z=0: 2 columns × 1 row, each tile is 180°×180°
        let west =
            TilingScheme::Geographic { tms: false }.tile_extent(TileXYZ { x: 0, y: 0, z: 0 });
        assert!((west.west.val() - (-PI)).abs() < 1e-10, "west tile west");
        assert!((west.east.val() - 0.0).abs() < 1e-10, "west tile east");
        assert!(
            (west.south.val() - (-PI / 2.0)).abs() < 1e-10,
            "west tile south"
        );
        assert!(
            (west.north.val() - (PI / 2.0)).abs() < 1e-10,
            "west tile north"
        );

        let east =
            TilingScheme::Geographic { tms: false }.tile_extent(TileXYZ { x: 1, y: 0, z: 0 });
        assert!((east.west.val() - 0.0).abs() < 1e-10, "east tile west");
        assert!((east.east.val() - PI).abs() < 1e-10, "east tile east");
    }

    #[test]
    fn test_geographic_tile_extent_contiguous() {
        // Adjacent tiles at z=6 must share boundaries exactly.
        // Internal y is XYZ-style (north=0), so y=46 sits south of y=45.
        let scheme = TilingScheme::Geographic { tms: true };
        let a = scheme.tile_extent(TileXYZ { x: 56, y: 45, z: 6 });
        let b = scheme.tile_extent(TileXYZ { x: 56, y: 46, z: 6 });
        assert!(
            (a.south.val() - b.north.val()).abs() < 1e-12,
            "vertical boundary"
        );

        let c = scheme.tile_extent(TileXYZ { x: 57, y: 45, z: 6 });
        assert!(
            (a.east.val() - c.west.val()).abs() < 1e-12,
            "horizontal boundary"
        );
    }

    #[test]
    fn test_tiling_scheme_root_tiles() {
        assert_eq!(
            TilingScheme::WebMercator { tms: false }.root_tiles().len(),
            1
        );
        assert_eq!(
            TilingScheme::Geographic { tms: false }.root_tiles().len(),
            2
        );
    }

    #[test]
    fn position_to_tile_xy_round_trips_with_tile_extent() {
        // The extent of the returned tile must contain the queried position,
        // for both schemes across several zooms and positions.
        let positions = [
            (0.0, 0.0),
            (139.0_f64.to_radians(), 35.0_f64.to_radians()), // Tokyo area
            (-73.9_f64.to_radians(), 40.7_f64.to_radians()), // New York area
            (170.0_f64.to_radians(), -45.0_f64.to_radians()), // NZ area
        ];
        for scheme in [
            TilingScheme::WebMercator { tms: false },
            TilingScheme::Geographic { tms: false },
        ] {
            for &(lng, lat) in &positions {
                for z in [0usize, 1, 5, 10, 14] {
                    let pos = LngLat {
                        lng: Rad::new(lng),
                        lat: Rad::new(lat),
                    };
                    let tile = scheme.position_to_tile_xy(pos, z);
                    assert_eq!(tile.z, z);
                    let extent = scheme.tile_extent(tile);
                    assert!(
                        extent.west.val() <= lng && lng <= extent.east.val(),
                        "{scheme:?} z={z} lng {lng} outside {extent:?}"
                    );
                    assert!(
                        extent.south.val() <= lat && lat <= extent.north.val(),
                        "{scheme:?} z={z} lat {lat} outside {extent:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn position_to_tile_xy_geographic_roots() {
        // z=0 Geographic: west hemisphere -> root (0,0,0), east -> (1,0,0).
        let scheme = TilingScheme::Geographic { tms: false };
        let west = scheme.position_to_tile_xy(
            LngLat {
                lng: Rad::new(-1.0),
                lat: Rad::new(0.0),
            },
            0,
        );
        let east = scheme.position_to_tile_xy(
            LngLat {
                lng: Rad::new(1.0),
                lat: Rad::new(0.0),
            },
            0,
        );
        assert_eq!(west, TileXYZ { x: 0, y: 0, z: 0 });
        assert_eq!(east, TileXYZ { x: 1, y: 0, z: 0 });
    }

    #[test]
    fn position_to_tile_xy_clamps_domain_edges() {
        use std::f64::consts::PI;
        // lng = +π and lat = ±90° clamp onto the last column / edge rows
        // instead of overflowing the grid.
        for scheme in [
            TilingScheme::WebMercator { tms: false },
            TilingScheme::Geographic { tms: false },
        ] {
            let z = 4;
            let ne = scheme.position_to_tile_xy(
                LngLat {
                    lng: Rad::new(PI),
                    lat: Rad::new(PI / 2.0),
                },
                z,
            );
            let cols = if scheme.is_geographic() {
                1usize << (z + 1)
            } else {
                1usize << z
            };
            assert_eq!(ne.x, cols - 1, "{scheme:?} last column");
            assert_eq!(ne.y, 0, "{scheme:?} north edge row");

            let sw = scheme.position_to_tile_xy(
                LngLat {
                    lng: Rad::new(-PI),
                    lat: Rad::new(-PI / 2.0),
                },
                z,
            );
            assert_eq!(sw.x, 0, "{scheme:?} first column");
            assert_eq!(sw.y, (1usize << z) - 1, "{scheme:?} south edge row");
        }
    }

    #[test]
    fn test_tile_url_flip_on_tms() {
        // Internal y is always XYZ (north-origin); flip only when the URL is TMS.
        let xyz = TileXYZ { x: 3, y: 1, z: 2 };
        let xyz_url =
            TilingScheme::WebMercator { tms: false }.tile_url("https://s/{z}/{x}/{y}.png", xyz);
        let tms_url =
            TilingScheme::WebMercator { tms: true }.tile_url("https://s/{z}/{x}/{y}.png", xyz);
        assert_eq!(xyz_url, "https://s/2/3/1.png");
        // At z=2 there are 4 rows; flip 1 → 4 - 1 - 1 = 2.
        assert_eq!(tms_url, "https://s/2/3/2.png");

        // Geographic follows the same URL convention.
        let geo_xyz_url =
            TilingScheme::Geographic { tms: false }.tile_url("https://s/{z}/{x}/{y}.png", xyz);
        let geo_tms_url =
            TilingScheme::Geographic { tms: true }.tile_url("https://s/{z}/{x}/{y}.png", xyz);
        assert_eq!(geo_xyz_url, "https://s/2/3/1.png");
        assert_eq!(geo_tms_url, "https://s/2/3/2.png");
    }

    #[test]
    fn test_tile_xyz_iterator() {
        let mut iter = iter_tiles(0);
        assert_eq!(iter.next(), Some(TileXYZ { x: 0, y: 0, z: 0 }));
        assert_eq!(iter.next(), None);

        let mut iter = iter_tiles(1);
        assert_eq!(iter.next(), Some(TileXYZ { x: 0, y: 0, z: 1 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 1, y: 0, z: 1 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 0, y: 1, z: 1 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 1, y: 1, z: 1 }));
        assert_eq!(iter.next(), None);

        let mut iter = iter_tiles(2);
        assert_eq!(iter.next(), Some(TileXYZ { x: 0, y: 0, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 1, y: 0, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 2, y: 0, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 3, y: 0, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 0, y: 1, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 1, y: 1, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 2, y: 1, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 3, y: 1, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 0, y: 2, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 1, y: 2, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 2, y: 2, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 3, y: 2, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 0, y: 3, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 1, y: 3, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 2, y: 3, z: 2 }));
        assert_eq!(iter.next(), Some(TileXYZ { x: 3, y: 3, z: 2 }));
        assert_eq!(iter.next(), None);
    }

    #[test]
    fn test_calc_meters_per_texel_sanity() {
        let a = 6378137.0;
        // Width includes 2px padding => content width = 256
        let m = calc_meters_per_texel(0, 0, 0, 258, a);
        assert!(m.is_finite() && m > 0.0);
        let expected = (2.0 * std::f64::consts::PI * a) / 256.0;
        let rel_err = ((m as f64) - expected).abs() / expected;
        assert!(rel_err < 1e-4, "unexpected relative error: {rel_err}");
        // Guard: texture_width < 2 must not underflow or divide by zero
        let m_tiny = calc_meters_per_texel(0, 0, 0, 1, a);
        assert!(m_tiny.is_finite() && m_tiny > 0.0);
    }

    #[test]
    fn web_mercator_world_pos_round_trip() {
        for &(x, y) in &[
            (0.0, 0.0),
            (0.5, 0.5),
            (0.25, 0.75),
            (1.0, 1.0),
            (0.123, 0.456),
        ] {
            let ll = web_mercator_world_pos_to_lnglat::<f64>(x, y);
            let (rx, ry) = web_mercator_lnglat_to_world_pos(ll);
            assert!((rx - x).abs() < 1e-9, "x round-trip {x} -> {rx}");
            assert!((ry - y).abs() < 1e-9, "y round-trip {y} -> {ry}");
        }
    }

    #[test]
    fn overlapping_tiles_wm_identity() {
        // A WM tile's own extent at its own zoom resolves to exactly that tile.
        for &(x, y, z) in &[(0usize, 0usize, 0usize), (1, 2, 2), (5, 3, 3), (10, 6, 4)] {
            let coords = TileXYZ { x, y, z };
            let extent = web_mercator_tile_extent(coords);
            assert_eq!(
                web_mercator_overlapping_tiles(extent, z),
                vec![coords],
                "identity for {coords:?}"
            );
        }
    }

    #[test]
    fn overlapping_tiles_geographic_spans_multiple_and_all_overlap() {
        // A Geographic tile extent overlaps several WM tiles; every returned tile
        // genuinely overlaps the extent.
        let geo = TilingScheme::Geographic { tms: false };
        let extent = geo.tile_extent(TileXYZ { x: 1, y: 0, z: 1 });
        let tiles = web_mercator_overlapping_tiles(extent, 3);
        assert!(!tiles.is_empty());
        for t in &tiles {
            assert!(
                extent.intersects(web_mercator_tile_extent(*t)),
                "{t:?} should overlap the extent"
            );
        }
    }

    #[test]
    fn overlapping_tiles_polar_cap_returns_edge_row() {
        use std::f64::consts::PI;
        // Entirely north of the WM band (~85.05°): collapses onto the north edge
        // row (y == 0) so that edge tile can be stretched across the polar cap.
        let north_cap = Extent::from_points(&[
            LngLat {
                lng: Rad::new(-0.1),
                lat: Rad::new(1.5), // ~85.9°
            },
            LngLat {
                lng: Rad::new(0.1),
                lat: Rad::new(PI / 2.0), // 90°
            },
        ]);
        let north = web_mercator_overlapping_tiles(north_cap, 3);
        assert!(!north.is_empty());
        assert!(
            north.iter().all(|t| t.y == 0),
            "north cap -> y==0 row: {north:?}"
        );

        // Entirely south of the band: collapses onto the south edge row (y == 2^z-1).
        let south_cap = Extent::from_points(&[
            LngLat {
                lng: Rad::new(-0.1),
                lat: Rad::new(-PI / 2.0), // -90°
            },
            LngLat {
                lng: Rad::new(0.1),
                lat: Rad::new(-1.5), // ~-85.9°
            },
        ]);
        let south = web_mercator_overlapping_tiles(south_cap, 3);
        let last = (1usize << 3) - 1;
        assert!(!south.is_empty());
        assert!(
            south.iter().all(|t| t.y == last),
            "south cap -> y==last row: {south:?}"
        );
    }

    #[test]
    fn wm_zoom_matches_tile_lng_span() {
        // A WM tile at zoom z spans 2π/2^z radians; the helper recovers z.
        for z in [0usize, 3, 7, 12] {
            let span = std::f64::consts::TAU / (1u64 << z) as f64;
            assert_eq!(wm_zoom_for_lng_span(span, 30), z);
        }
        // Clamped to max_zoom.
        let tiny = std::f64::consts::TAU / (1u64 << 20) as f64;
        assert_eq!(wm_zoom_for_lng_span(tiny, 5), 5);
    }

    #[test]
    fn budget_coarsens_zoom_until_overlap_fits() {
        // A Geographic tile draped by WebMercator overlaps several WM tiles; pick a
        // zoom fine enough that the unbounded overlap exceeds a tight budget.
        let geo = TilingScheme::Geographic { tms: false };
        let extent = geo.tile_extent(TileXYZ { x: 1, y: 0, z: 3 });
        let target_z = wm_zoom_for_lng_span((extent.east - extent.west).val(), 30);

        let unbounded = web_mercator_overlapping_tiles(extent, target_z).len();
        assert!(unbounded >= 2, "need a multi-tile overlap to test the cap");

        // The budget caps the count and never coarsens past what's needed.
        for budget in 1..=unbounded {
            let tiles = overlapping_tiles_within_budget(extent, target_z, budget);
            assert!(
                tiles.len() <= budget,
                "budget {budget} exceeded by {tiles:?}"
            );
            assert!(!tiles.is_empty());
            assert!(tiles.iter().all(|t| t.z <= target_z));
        }

        // A budget at/above the unbounded count leaves the target zoom untouched.
        let full = overlapping_tiles_within_budget(extent, target_z, unbounded);
        assert_eq!(full.len(), unbounded);
        assert!(full.iter().all(|t| t.z == target_z));

        // A zero budget is treated as one tile, never an empty drape.
        assert!(!overlapping_tiles_within_budget(extent, target_z, 0).is_empty());
    }
}
