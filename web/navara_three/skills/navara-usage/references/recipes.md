# Recipes — goal → composition

Proven combinations that get from zero to a high-quality scene. Prefer starting from a recipe and customizing, rather than assembling pieces from scratch.

> This collection grows over time. Each recipe states the goal, the exact composition, and a complete runnable snippet.

## Photoreal base scene

**Goal:** a realistic globe — real terrain relief, satellite imagery, physically-based sky/sun/atmosphere — as the base for any data visualization.

**Composition (current best practice):**

| Piece                                           | What it contributes                                                                                                                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DefaultPlugin` + `addDefaultPhotorealScene()`  | Sky, stars, sun light, sky light probe, aerial perspective, lens flare (skipped on mobile), tone mapping, antialiasing — mobile-aware                                                                                            |
| Re:Earth Terrain (`quantized-mesh` source)      | Global terrain relief with vertex normals and water mask. `requestWaterMask: true` also gives ocean pixels a default reflectivity/roughness automatically, so adding the SSR effect makes the sea reflective with no extra setup |
| EOX Sentinel-2 cloudless (`raster-tile` source) | Global satellite imagery draped over the terrain                                                                                                                                                                                 |
| Built-in attribution UI (`view.attribution`)    | Required data credits for the above                                                                                                                                                                                              |

```typescript
import ThreeView from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>({ shadow: true });
const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
await view.init();

defaultPlugin.addDefaultPhotorealScene();

// Terrain first (render order = add order), then imagery draped over it.
const terrain = view.addSource({
  type: "quantized-mesh",
  url: "https://terrain.reearth.land/cesium-mesh/ellipsoid/{z}/{x}/{y}.terrain",
  maxZoom: 18,
  requestVertexNormals: true,
  requestWaterMask: true,
});
view.addLayer({
  type: "terrain",
  source: terrain,
  terrain: { castShadow: true, receiveShadow: true },
});

const imagery = view.addSource({
  type: "raster-tile",
  url:
    "https://tiles.maps.eox.at/wmts?layer=s2cloudless-2020_3857&style=default" +
    "&tilematrixset=g&Service=WMTS&Request=GetTile" +
    "&Version=1.0.0&Format=image%2Fjpeg" +
    "&TileMatrix={z}&TileCol={x}&TileRow={y}",
  maxZoom: 15,
});
view.addLayer({ type: "raster", source: imagery });

view.attribution?.add([
  {
    attribution: "© Re:Earth Terrain",
    attributionUrl: "https://terrain.reearth.land/",
  },
  {
    attributionHtml:
      '<a href="https://s2maps.eu">Sentinel-2 cloudless 2020</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2020)',
  },
]);

view.setCamera({
  lng: 138.2,
  lat: 34.9,
  height: 11000,
  heading: 65,
  pitch: -8,
  roll: 0,
});
```

**Build on top:** add your data layers after this base — 3D Tiles (`type: "3d-tiles"`), vector data, meshes. Tweak individual pieces via the handles `addDefaultPhotorealScene()` returns (e.g. `scene.sun.update({ sun: { castShadow: true } })`), and adjust `view.toneMappingExposure` to taste.

**Variants:**

- Japan-focused, higher-resolution terrain: Cesium Ion PLATEAU terrain via `CesiumIonPlugin` (`cesiumIon.addTerrain({...})` after init; the plugin must be added before init because it resolves its asset endpoint during `view.init()`).
- Non-photoreal basemaps: swap EOX for any XYZ raster source (OSM, GSI); skip `addDefaultPhotorealScene()` if you want a plain look.

<!-- Future recipes: add sections here following the same Goal / Composition / Snippet / Variants shape. -->
