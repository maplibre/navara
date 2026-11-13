// Re:Earth Buildings are modeled on Re:Earth Terrain, so their bases meet
// this terrain without a height offset.
export const TERRAIN = {
  url: "https://terrain.reearth.land/cesium-mesh/ellipsoid/{z}/{x}/{y}.terrain",
  attribution: "© Re:Earth Terrain",
  attributionUrl: "https://terrain.reearth.land/",
};

// Global imagery under the GSI photo, which covers Japan from zoom 9 (and
// the world below it, coarser); the TileJSON carries its attribution.
export const SATELLITE_TILEJSON =
  "https://papers.reearth.land/s2cloudless_2016/tilejson.json";

export const IMAGERY = {
  url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
  minZoom: 9,
  attribution:
    "Geospatial Information Authority of Japan Tiles - Latest Nationwide Photo (Seamless)",
  attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
};

export const BUILDINGS = {
  url: "https://buildings.reearth.land/tileset.json",
  attributionHtml:
    '<a href="https://buildings.reearth.land/">Re:Earth Buildings</a> — Buildings © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, <a href="https://overturemaps.org/">Overture Maps Foundation</a> (ODbL)',
};
