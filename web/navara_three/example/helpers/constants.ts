import type { AttributionChild } from "@navaramap/three";

import { withBase } from "./base";

/** A tile/asset data source used by the examples, with its attribution fields. */
export type Dataset = {
  url: string;
  attribution?: string;
  attributionHtml?: string;
  attributionUrl?: string;
  /**
   * Optional logo image path. When provided, the logo is shown in the
   * always-visible logo frame — used to satisfy provider attribution
   * requirements (Google Photoreal, Cesium Ion, etc.).
   */
  logo?: string;
  /**
   * Optional click target for the logo. Separate from `attributionUrl` so a
   * mark can be shown without linking it (some marks must be displayed but not
   * turned into a link).
   */
  logoUrl?: string;
  /** Optional zoom-banded sub-credits, shown when the current zoom is within the band. */
  children?: AttributionChild[];
};

/**
 * Raster tile datasets
 */
export const TILE_DATASETS = {
  openstreetmap: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
  eox: {
    url:
      "https://tiles.maps.eox.at/wmts?layer=s2cloudless-2020_3857&style=default" +
      "&tilematrixset=g&Service=WMTS&Request=GetTile" +
      "&Version=1.0.0&Format=image%2Fjpeg" +
      "&TileMatrix={z}&TileCol={x}&TileRow={y}",
    attributionHtml:
      '<a href="https://s2maps.eu">Sentinel-2 cloudless 2020</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2020)',
  },
  gsiStd: {
    url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
    attribution:
      "Geospatial Information Authority of Japan Tiles - Standard Map",
    attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
    children: [
      // z9-11
      {
        attribution:
          "1:1,000,000 International Map (Electronic topographic map (tiles) / Geospatial Information Authority of Japan (GSI))",
        minZoom: 9,
        maxZoom: 11,
      },
      // z5-8
      {
        attribution:
          "Japan And Its Surroundings (Electronic topographic map (tiles) / Geospatial Information Authority of Japan (GSI))",
        minZoom: 5,
        maxZoom: 8,
      },
      {
        attribution:
          "The bathymetric contours are derived from those contained within the GEBCO Digital Atlas, published by the BODC on behalf of IOC and IHO (2003) (https://www.gebco.net) 海上保安庁許可第292502号（水路業務法第25条に基づく類似刊行物）",
        minZoom: 5,
        maxZoom: 8,
      },
      {
        attribution:
          'Shoreline data is derived from: United States. National Imagery and Mapping Agency. "Vector Map Level 0 (VMAP0)." Bethesda, MD: Denver, CO: The Agency; USGS Information Services, 1997.',
        minZoom: 5,
        maxZoom: 8,
      },
    ],
  },
  gsiSeamlessphoto: {
    url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
    attribution:
      "Geospatial Information Authority of Japan Tiles - Latest Nationwide Photo (Seamless)",
    attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
    children: [
      // z14-18
      {
        attribution: "Nationwide latest aerial photos (seamless)",
        minZoom: 14,
        maxZoom: 18,
      },
      { attribution: "GRUS画像（© Axelspace）", minZoom: 14, maxZoom: 18 },
      // z9-13
      {
        attribution: "Nationwide Landsat mosaic imagery",
        minZoom: 9,
        maxZoom: 13,
      },
      {
        attribution:
          "データソース：Landsat8画像（GSI,TSIC,GEO Grid/AIST）, Landsat8画像（courtesy of the U.S. Geological Survey）, 海底地形（GEBCO）",
        minZoom: 9,
        maxZoom: 13,
      },
      // z2-8
      {
        attribution: "Global satellite mosaic imagery",
        minZoom: 2,
        maxZoom: 8,
      },
      {
        attribution:
          "Images on 世界衛星モザイク画像 obtained from site https://lpdaac.usgs.gov/data_access maintained by the NASA Land Processes Distributed Active Archive Center (LP DAAC), USGS/Earth Resources Observation and Science (EROS) Center, Sioux Falls, South Dakota, (Year). Source of image data product.",
        minZoom: 2,
        maxZoom: 8,
      },
    ],
  },
} satisfies Record<string, Dataset>;

/**
 * Terrain/DEM datasets
 */
export const TERRAIN_DATASETS = {
  gsi: {
    url: "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png",
    attribution:
      "Geospatial Information Authority of Japan Tiles - Digital Elevation Map",
    attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
  },
  mapterhorn: {
    url: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
    attribution: "© Mapterhorn",
    attributionUrl: "https://mapterhorn.com/attribution",
  },
  reearthQuantizedMesh: {
    url: "https://terrain.reearth.land/cesium-mesh/ellipsoid/{z}/{x}/{y}.terrain",
    attribution: "© Re:Earth Terrain",
    attributionUrl: "https://terrain.reearth.land/",
  },
  cesiumIon: {
    // The URL is resolved at runtime via the Cesium Ion endpoint API; this
    // constant exists so the dataset's attribution can be displayed.
    url: "https://api.cesium.com/v1/assets",
    attribution: "© Cesium Ion",
    attributionUrl: "https://cesium.com/legal/terms-of-service/",
    logo: withBase("credits/CesiumIon.png"),
  },
  mapbox: {
    url: `https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.webp?access_token=${
      import.meta.env.NAVARA_MAPBOX_ACCESS_TOKEN
    }`,
    attribution: "© Mapbox Terrain-RGB",
    attributionUrl:
      "https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/",
  },
} satisfies Record<string, Dataset>;

/**
 * Vector tile datasets
 */
export const VECTOR_DATASETS = {
  gsiExperimentalVector: {
    url: "https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf",
    attribution:
      "Geospatial Information Authority of Japan Vector Tile Experimental Service",
    attributionUrl:
      "https://github.com/gsi-cyberjapan/gsimaps-vector-experiment",
  },
  // OpenFreeMap serves the whole planet on the OpenMapTiles schema, z0-14,
  // with no API key and `access-control-allow-origin: *`.
  //
  // The schema splits roads in two: `transportation` carries the geometry,
  // while `transportation_name` (z6-14) carries `name`, `name:en`, `ref` and
  // `class` on linestrings that have been **merged across the tile**. That
  // merging is what makes street labels tractable — labelling the raw
  // `transportation` layer instead repeats a name on every short segment.
  //
  // The path below is republished weekly, so prefer resolving the TileJSON at
  // `https://tiles.openfreemap.org/planet` (e.g. through `TileJsonPlugin`) and
  // treat this pinned URL as the fallback.
  openFreeMapPlanet: {
    url: "https://tiles.openfreemap.org/planet/20260913_164504_pt/{z}/{x}/{y}.pbf",
    attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
    attributionUrl: "https://openfreemap.org/",
  },
} satisfies Record<string, Dataset>;

/** TileJSON endpoint for {@link VECTOR_DATASETS.openFreeMapPlanet}, which
 *  resolves to whichever weekly build is current. */
export const OPEN_FREE_MAP_TILEJSON = "https://tiles.openfreemap.org/planet";

/**
 * PMTiles datasets — a single archive served over HTTP range requests, with an
 * MVT payload (resolved by PmtilesSource). The URL has no `{z}/{x}/{y}`.
 */
export const PMTILES_DATASETS = {
  protomapsFirenze: {
    url: "https://pmtiles.io/protomaps(vector)ODbL_firenze.pmtiles",
    attribution: "© OpenStreetMap contributors, © Protomaps",
    attributionUrl: "https://protomaps.com",
  },
  // Overture Maps publishes a worldwide PMTiles archive per theme with every
  // release, served over HTTP range requests. Each theme is a single global
  // `.pmtiles` file (no `{z}/{x}/{y}`, and ~200 GB for `base`), so it resolves
  // through a PmtilesSource exactly like the Protomaps sample above — only the
  // header directory plus the visible tiles are ever fetched.
  // Ref: https://docs.overturemaps.org/examples/overture-tiles/
  //
  // `tiles.overturemaps.org` is Overture's canonical CloudFront endpoint in
  // front of the release S3 bucket (edge-cached, HTTP/2 — same bytes, lower
  // latency than hitting the us-west-2 origin directly).
  //
  // NOTE: releases have a 60-day retention window, so a dated path 404s ~2
  // months after its release date (`2026-07-22.0` expires ~2026-09-20).
  // Expiry is per-object, not per-release: when `2026-06-17.0` lapsed,
  // `divisions`/`transportation` 404'd while `base`/`buildings`/`places` were
  // still served — which looks like a broken layer (labels vanish, basemap
  // draws) rather than a dead source. Check the specific file, not the prefix.
  // When the fetches start failing, bump the date below to a live release —
  // list them at:
  //   https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=tiles/&delimiter=/
  overtureBase: {
    url: "https://tiles.overturemaps.org/2026-07-22.0/base.pmtiles",
    attribution: "© OpenStreetMap contributors, © Overture Maps Foundation",
    attributionUrl: "https://overturemaps.org",
  },
  overtureDivisions: {
    url: "https://tiles.overturemaps.org/2026-07-22.0/divisions.pmtiles",
    attribution: "© OpenStreetMap contributors, © Overture Maps Foundation",
    attributionUrl: "https://overturemaps.org",
  },
  overtureBuildings: {
    url: "https://tiles.overturemaps.org/2026-07-22.0/buildings.pmtiles",
    attribution: "© OpenStreetMap contributors, © Overture Maps Foundation",
    attributionUrl: "https://overturemaps.org",
  },
  overturePlaces: {
    url: "https://tiles.overturemaps.org/2026-07-22.0/places.pmtiles",
    attribution: "© Overture Maps Foundation",
    attributionUrl: "https://overturemaps.org",
  },
} satisfies Record<string, Dataset>;

/**
 * 3D Tiles datasets (PLATEAU)
 */
export const TILES_3D_DATASETS = {
  plateauChiyoda: {
    url: "https://assets.cms.plateau.reearth.io/assets/db/070026-aa27-431b-8d53-7cc6b03244f8/13101_chiyoda-ku_pref_2023_citygml_1_op_bldg_3dtiles_13101_chiyoda-ku_lod2_no_texture/tileset.json",
    attribution:
      "3D City Model (Project PLATEAU) Chiyoda Ward (FY2023) - MLIT PLATEAU",
    attributionUrl:
      "https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2023",
  },
  ChiyodaSubway: {
    url: "https://assets.cms.plateau.reearth.io/assets/62/e6884a-2c59-409c-9f1b-29c887bc7f58/13101_chiyoda-ku_pref_2023_citygml_2_op_ubld_3dtiles_lod4/tileset.json",
    attribution:
      "3D City Model (Project PLATEAU) Chiyoda Ward (FY2023) - MLIT PLATEAU",
    attributionUrl:
      "https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2023",
  },
  plateauShinjuku: {
    url: "https://assets.cms.plateau.reearth.io/assets/f0/840fc4-114c-41e4-9a65-67768efd3629/13104_shinjuku-ku_pref_2023_citygml_2_op_bldg_3dtiles_13104_shinjuku-ku_lod2_no_texture/tileset.json",
    attribution:
      "3D City Model (Project PLATEAU) Shinjuku Ward (FY2023) - MLIT PLATEAU",
    attributionUrl:
      "https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2023",
  },
  plateauAjigasawa: {
    url: "https://assets.cms.plateau.reearth.io/assets/89/c2aabc-6010-4c01-97e2-ce0fd8838fb3/02321_ajigasawa-machi_city_2025_citygml_1_op_bldg_3dtiles_lod1/tileset.json",
    attribution:
      "3D City Model (Project PLATEAU) Ajigasawa town (FY2023) - MLIT PLATEAU",
    attributionUrl:
      "https://www.geospatial.jp/ckan/dataset/plateau-02321-ajigasawa-machi-2025",
  },
  plateauChiyodaB3DM: {
    url: "https://assets.cms.plateau.reearth.io/assets/23/bf39db-cd61-4e07-9be3-065a13ddf432/13101_chiyoda-ku_pref_2023_citygml_1_op_bldg_3dtiles_13101_chiyoda-ku_lod2/data/data500.b3dm",
    attribution:
      "3D City Model (Project PLATEAU) Chiyoda Ward (FY2023) - MLIT PLATEAU",
    attributionUrl:
      "https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2023",
  },
  plateauChuo: {
    url: "https://assets.cms.plateau.reearth.io/assets/4c/f2436a-e2be-40e2-83da-f1781f36e30b/13102_chuo-ku_pref_2023_citygml_1_op_bldg_3dtiles_13102_chuo-ku_lod2_no_texture/tileset.json",
    attribution:
      "3D City Model (Project PLATEAU) Chuo Ward (FY2023) - MLIT PLATEAU",
    attributionUrl:
      "https://www.geospatial.jp/ckan/dataset/plateau-13102-chuo-ku-2023",
  },
  plateauToranomonHillsBIM: {
    url: "https://assets.cms.plateau.reearth.io/assets/fa/eabbc5-b24a-45bf-ba7b-2a0af1fdf8fb/uc_pv1_13100_tokyo/toranomon_hills_others/tileset.json",
    attribution:
      "3D City Model (Project PLATEAU) Toranomon Hills BIM Model - MLIT PLATEAU",
    attributionUrl: "https://www.mlit.go.jp/plateau/use-case/uc20-014/",
  },
  plateauTakanawa: {
    url: "https://assets.cms.plateau.reearth.io/assets/c1/28f9ff-e9d0-44df-b092-88ac7ebdfa42/tngw_4gaiku/tileset.json",
    attribution:
      "[UC23-11] Advanced Area Management Using Storytelling GIS - MLIT PLATEAU",
    attributionUrl: "https://www.geospatial.jp/ckan/dataset/plateau-uc23-11",
  },
  plateauTokyoFlood: {
    url: "https://assets.cms.plateau.reearth.io/assets/bc/d3b4bd-77dd-428f-9ab9-9d77546a702b/13_tokyo-to_pref_2023_citygml_1_op_fld_pref_sumidagaw-shingashigawa-ryuiki_3dtiles_l2_no_texture/tileset.json",
    attribution:
      "3D City Model (Project PLATEAU) Shinagawa Ward (FY2023) - MLIT PLATEAU",
    attributionUrl:
      "https://www.geospatial.jp/ckan/dataset/plateau-13109-shinagawa-ku-2023",
  },
  plateauKakegawaCastle: {
    url: "https://assets.cms.plateau.reearth.io/assets/6b/68c785-f43d-4451-ba7f-d4d130ef6ba5/uc_pv1_22213_kakegawa/pointcloud/22213_kakegawa_castle/tileset.json",
    attribution: "kakegawa castle point cloud model - 国土交通省 PLATEAU",
    attributionUrl: "https://www.geospatial.jp/ckan/dataset/kakegawacastle",
  },
  YamanashiKyonaka: {
    url: "https://yamanashi-tile.geospatial.jp/tile/2024/01_kyouchu/tileset.json",
    attribution: "Yamanashi Prefecture point cloud data - Kyonaka",
    attributionUrl:
      "https://www.geospatial.jp/ckan/dataset/yamanashi-pointcloud-2024",
  },
  googlePhotorealTiles: {
    url: `https://tile.googleapis.com/v1/3dtiles/root.json`, // API key should be appended via query parameter, e.g. "https://tile.googleapis.com/v1/3dtiles/root.json?key=YOUR_API_KEY"
    attribution: "Google Maps Photorealistic 3D Tiles",
    attributionUrl: "https://www.google.com/permissions/geoguidelines/",
    logo: withBase("credits/GoogleMaps.png"),
  },
} satisfies Record<string, Dataset>;

/**
 * MVT (Mapbox Vector Tiles) datasets (PLATEAU)
 */
export const MVT_DATASETS = {
  plateauWakayamaGen: {
    url: "https://assets.cms.plateau.reearth.io/assets/d4/ee889d-98b4-4425-a5b6-c60bf36e2e5a/30201_wakayama-shi_city_2023_citygml_1_op_gen_20_mvt_lod0/{z}/{x}/{y}.mvt",
    attribution:
      "3D City Model (Project PLATEAU) Wakayama City (FY2023) - MLIT PLATEAU",
    attributionUrl:
      "https://www.geospatial.jp/ckan/dataset/plateau-30201-wakayama-shi-2023",
  },
  plateauGifuTran: {
    url: "https://assets.cms.plateau.reearth.io/assets/67/b5b3c6-71d8-405c-88c8-4ead72890b2b/21201_gifu-shi_city_2023_citygml_1_op_tran_mvt_lod0/{z}/{x}/{y}.mvt",
    attribution:
      "3D City Model (Project PLATEAU) Gifu City (FY2023) - MLIT PLATEAU",
    attributionUrl:
      "https://www.geospatial.jp/ckan/dataset/plateau-21201-gifu-shi-2023",
  },
  plateauTokyoFirePrevention: {
    url: "https://assets.cms.plateau.reearth.io/assets/d9/5ce2d6-0aa8-4a17-a86a-028c2dc2b817/13_tokyo_pref_2023_citygml_1_op_urf_FirePreventionDistrict_mvt_lod1/{z}/{x}/{y}.mvt",
    attribution:
      "3D City Model (Project PLATEAU) Tokyo 23 Wards - MLIT PLATEAU",
    attributionUrl: "https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku",
  },
  plateauTokyoHeightControl: {
    url: "https://assets.cms.plateau.reearth.io/assets/a2/81a1a7-03b8-4cf2-bb26-19103b32e255/13_tokyo_pref_2023_citygml_1_op_urf_HeightControlDistrict_mvt_lod1/{z}/{x}/{y}.mvt",
    attribution:
      "3D City Model (Project PLATEAU) Tokyo 23 Wards - MLIT PLATEAU",
    attributionUrl: "https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku",
  },
} satisfies Record<string, Dataset>;

/**
 * GeoJSON datasets
 */
export const GEOJSON_DATASETS = {
  worldCities: {
    url: withBase("world-cities.geojson"),
    attribution: "World Major Cities",
  },
  calderdaleDefibrillators: {
    url: "https://dataworks.calderdale.gov.uk/download/e6xdw/b1z/Council%20owned%20defibrillators%202025.geojson",
    attribution: "© Calderdale Council - Open Government Licence v3.0",
    attributionUrl:
      "https://dataworks.calderdale.gov.uk/dataset/defibrillators-e6xdw",
  },
} satisfies Record<string, Dataset>;

/**
 * Local asset datasets
 */
export const LOCAL_DATASETS = {
  blueMarbleClouds: {
    url: "https://assets.cms.reearth.io/assets/11/ea0a6a-a94f-47e0-a163-4c675261a1f6/blue-marble-clouds/{z}/{x}/{y}.webp",
    attribution: "NASA Blue Marble Clouds(Converted as raster tiles)",
  },
  blueMarbleNight: {
    url: "https://papers.reearth.land/blackmarble/{z}/{x}/{y}.webp",
    attributionHtml:
      '\u003Ca href="https://papers.reearth.land"\u003ERe:Earth Papers\u003C/a\u003E · \u003Ca href="https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps"\u003ENASA Earth Observatory\u003C/a\u003E · Suomi NPP VIIRS · Black Marble 2016',
  },
  airportTrafficVolume: {
    url: "https://assets.cms.reearth.io/assets/3b/63858d-9197-4b39-bbed-c17b6add52a4/airport-traffic-volume.geojson",
    attribution:
      "Processed and created from the National Land Numerical Information (inter-airport flow volume data) - MLIT",
    attributionUrl:
      "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-S10b-2014.html",
  },
  tokyoFlood: {
    url: "https://assets.cms.reearth.io/assets/11/55daed-a75e-4e8d-b021-c7fd0666e839/tokyo-flood.geojson",
    attribution: "Flood Inundation Zone Data (River-Based) - MLIT",
    attributionUrl:
      "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A31a-2024.html",
  },
  railways: {
    url: "https://assets.cms.reearth.io/assets/51/794e3a-9464-4655-b96b-ff745781270b/railways.geojson",
    attribution: "Railway Data - MLIT",
    attributionUrl:
      "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2024.html",
  },
  railwaysTimeSeries: {
    url: "https://assets.cms.reearth.io/assets/7c/f0b635-b985-491a-86c2-ff78b91f139b/railwaysTimeSeries.geojson",
    attribution: "Railway Time Series Data - MLIT",
    attributionUrl:
      "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N05-2024.html",
  },
  steelDrumGLTF: {
    url: withBase("glTF/steel_drum/scene.gltf"),
    attribution:
      "themaayur - SKETCHFAB Standard(https://sketchfab.com/licenses)",
    attributionUrl: withBase("glTF/steel_drum/license.txt"),
  },
  soldierGLTF: {
    url: withBase("glTF/Soldier/Soldier.glb"),
    attribution:
      "https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Soldier.glb",
  },
  animatedBirdPigeonGLTF: {
    url: withBase("glTF/animated_bird_pigeon/scene.gltf"),
    attribution: "Animated Bird Pigeon by dudecon - CC BY 4.0",
    attributionUrl:
      "https://sketchfab.com/3d-models/animated-bird-pigeon-797d27b68af3453e865149435df6aa30",
  },
  globeGeoJSON: {
    url: withBase("globe.geojson"),
    attribution: "GeoJSON Maps of the globe",
    attributionUrl: "https://geojson-maps.kyd.au/",
  },
  streetLightGeoJSON: {
    url: withBase("street_light.geojson"),
  },
  takanawaPointLightGeoJSON: {
    url: withBase("takanawa_point_light.geojson"),
  },
  tokyoPoints100GeoJSON: {
    url: withBase("tokyo_points_100.geojson"),
  },
  interiorGeoJSON: {
    url: withBase("interior.geojson"),
  },
} satisfies Record<string, Dataset>;

/**
 * 3D Gaussian Splatting datasets
 */
export const SPLAT_DATASETS = {
  quechua: {
    url: withBase("splat/QUECHUA%20-%20Webviewer/webviewer.spz"),
    attribution: "QUECHUA - Webviewer by Christoph SCHINDELAR - CC BY 4.0",
    attributionUrl: "https://superspl.at/scene/f83d530f",
  },
  pencilSharpener: {
    url: withBase(
      "splat/Pencil%20sharpener%20shaped%20like%20a%20duck/duck.spz",
    ),
    attribution:
      "Pencil sharpener shaped like a duck by Alfred Duemlein - CC BY 4.0",
    attributionUrl: "https://superspl.at/scene/d34e7de1",
  },
} satisfies Record<string, Dataset>;

/**
 * LUT datasets
 */
export const LUT_DATASETS = {
  presetproCinematic3dl: {
    url: "https://raw.githubusercontent.com/pmndrs/postprocessing/refs/heads/main/demo/static/textures/lut/3dl/presetpro-cinematic.3dl",
    attribution: "(C) Copyright 2018 https://www.presetpro.com and Tim Martin",
    attributionUrl: "https://www.presetpro.com",
  },
  djangoCube: {
    url: "https://raw.githubusercontent.com/pmndrs/postprocessing/refs/heads/main/demo/static/textures/lut/cube/django-25.cube",
    attribution: "(C) Copyright 2017 RocketStock",
  },
  Blackmagic4_6KFilmtoExtendedVideov4Cube: {
    url: "https://raw.githubusercontent.com/imnz730/LUTs/refs/heads/master/Blackmagic%20Design/Blackmagic%204.6K%20Film%20to%20Extended%20Video%20v4.cube",
    attribution: "(C) 2018 Blackmagic Design",
  },
  fuji160cPNG: {
    url: "https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/1a932c055ea624b14816f40fc321e95a3a98dfce/storybook/assets/clut/Fuji/Fuji%20160C%202.png",
    attribution: "Fuji 160C - RawTherapee",
    attributionUrl: "https://rawpedia.rawtherapee.com/Film_Simulation",
  },
  fuji800Z3PNG: {
    url: "https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/1a932c055ea624b14816f40fc321e95a3a98dfce/storybook/assets/clut/Fuji/Fuji%20800Z%203%20%2B.png",
    attribution: "Fuji 800Z 3 + - RawTherapee",
    attributionUrl: "https://rawpedia.rawtherapee.com/Film_Simulation",
  },
  fujiFP100C7PNG: {
    url: "https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/1a932c055ea624b14816f40fc321e95a3a98dfce/storybook/assets/clut/Fuji/Fuji%20FP-100c%207%20%2B%2B%20Alt.png",
    attribution: "Fuji FP-100C 7 - RawTherapee",
    attributionUrl: "https://rawpedia.rawtherapee.com/Film_Simulation",
  },
  KodakE100GXEktachrome100PNG: {
    url: "https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/1a932c055ea624b14816f40fc321e95a3a98dfce/storybook/assets/clut/Kodak/Kodak%20E-100%20GX%20Ektachrome%20100.png",
    attribution: "Kodak E-100 GX Ektachrome 100 - RawTherapee",
    attributionUrl: "https://rawpedia.rawtherapee.com/Film_Simulation",
  },
  agfaVista200PNG: {
    url: "https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/1a932c055ea624b14816f40fc321e95a3a98dfce/storybook/assets/clut/Agfa/Agfa%20Vista%20200.png",
    attribution: "Agfa Vista 200 - RawTherapee",
    attributionUrl: "https://rawpedia.rawtherapee.com/Film_Simulation",
  },
  agfaPrecisa100PNG: {
    url: "https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/1a932c055ea624b14816f40fc321e95a3a98dfce/storybook/assets/clut/Agfa/Agfa%20Precisa%20100.png",
    attribution: "Agfa Precisa 100 - RawTherapee",
    attributionUrl: "https://rawpedia.rawtherapee.com/Film_Simulation",
  },
  agfaColorUltra100PNG: {
    url: "https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/1a932c055ea624b14816f40fc321e95a3a98dfce/storybook/assets/clut/Agfa/Agfa%20Ultra%20Color%20100.png",
    attribution: "Agfacolor Ultra 100 - RawTherapee",
    attributionUrl: "https://rawpedia.rawtherapee.com/Film_Simulation",
  },
} satisfies Record<string, Dataset>;

export const FONT_DATASETS = {
  LineSeedJP: {
    url: withBase("fonts/lineseedjp/LINESeedJP-Bold.ttf"),
    attribution: "LINE Seed JP - Google Fonts",
    attributionUrl: "https://fonts.google.com/specimen/LINE+Seed+JP",
  },
  Roboto: {
    url: withBase("fonts/roboto/Roboto[wdth,wght].ttf"),
    attribution: "Roboto - Google Fonts",
    attributionUrl: "https://fonts.google.com/specimen/Roboto",
  },
  Borel: {
    url: withBase("fonts/borel/Borel-Regular.ttf"),
    attribution: "Borel - Google Fonts",
    attributionUrl: "https://fonts.google.com/specimen/Borel",
  },
  SourceCodePro: {
    url: "https://raw.githubusercontent.com/adobe-fonts/source-code-pro/refs/heads/release/OTF/SourceCodePro-Bold.otf",
    attribution: "Source Code Pro - Adobe Fonts",
    attributionUrl: "https://github.com/adobe-fonts/source-code-pro",
  },
  // Roboto WOFF2 splits by unicode range (from Google Fonts CSS2 API)
  RobotoLatin: {
    url: withBase("fonts/woff2/roboto/roboto-latin.woff2"),
    attribution: "Roboto - Google Fonts",
    attributionUrl: "https://fonts.google.com/specimen/Roboto",
  },
  RobotoLatinExt: {
    url: withBase("fonts/woff2/roboto/roboto-latin-ext.woff2"),
    attribution: "Roboto - Google Fonts",
    attributionUrl: "https://fonts.google.com/specimen/Roboto",
  },
  RobotoCyrillic: {
    url: withBase("fonts/woff2/roboto/roboto-cyrillic.woff2"),
    attribution: "Roboto - Google Fonts",
    attributionUrl: "https://fonts.google.com/specimen/Roboto",
  },
  RobotoCyrillicExt: {
    url: withBase("fonts/woff2/roboto/roboto-cyrillic-ext.woff2"),
    attribution: "Roboto - Google Fonts",
    attributionUrl: "https://fonts.google.com/specimen/Roboto",
  },
  RobotoGreek: {
    url: withBase("fonts/woff2/roboto/roboto-greek.woff2"),
    attribution: "Roboto - Google Fonts",
    attributionUrl: "https://fonts.google.com/specimen/Roboto",
  },
  RobotoVietnamese: {
    url: withBase("fonts/woff2/roboto/roboto-vietnamese.woff2"),
    attribution: "Roboto - Google Fonts",
    attributionUrl: "https://fonts.google.com/specimen/Roboto",
  },
  // Noto Sans script-specific subsets (from Google Fonts CSS2 API)
  NotoSansJP: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-jp.woff2"),
    attribution: "Noto Sans JP - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+JP",
  },
  NotoSansSC: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-sc.woff2"),
    attribution: "Noto Sans SC - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+SC",
  },
  NotoSansKR: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-kr.woff2"),
    attribution: "Noto Sans KR - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+KR",
  },
  NotoSansArabic: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-arabic.woff2"),
    attribution: "Noto Sans Arabic - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+Arabic",
  },
  NotoSansThai: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-thai.woff2"),
    attribution: "Noto Sans Thai - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+Thai",
  },
  NotoSansDevanagari: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-devanagari.woff2"),
    attribution: "Noto Sans Devanagari - Google Fonts",
    attributionUrl:
      "https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari",
  },
  NotoSansHebrew: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-hebrew.woff2"),
    attribution: "Noto Sans Hebrew - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+Hebrew",
  },
  NotoSansGeorgian: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-georgian.woff2"),
    attribution: "Noto Sans Georgian - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+Georgian",
  },
  NotoSansBengali: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-bengali.woff2"),
    attribution: "Noto Sans Bengali - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+Bengali",
  },
  NotoSansTamil: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-tamil.woff2"),
    attribution: "Noto Sans Tamil - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+Tamil",
  },
  NotoSansTelugu: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-telugu.woff2"),
    attribution: "Noto Sans Telugu - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+Telugu",
  },
  NotoSansKannada: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-kannada.woff2"),
    attribution: "Noto Sans Kannada - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+Kannada",
  },
  NotoSansArmenian: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-armenian.woff2"),
    attribution: "Noto Sans Armenian - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+Armenian",
  },
  NotoSansMyanmar: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-myanmar.woff2"),
    attribution: "Noto Sans Myanmar - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+Myanmar",
  },
  NotoSansLao: {
    url: withBase("fonts/woff2/noto-sans/noto-sans-lao.woff2"),
    attribution: "Noto Sans Lao - Google Fonts",
    attributionUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+Lao",
  },
} satisfies Record<string, Dataset>;
