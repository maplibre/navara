---
title: Terrain Layer
description: Render a raster-dem or quantized-mesh source as 3D terrain
sidebar:
  order: 430
---

A `terrain` layer renders a [`raster-dem`](../../../three/source/raster-dem-source/) source (RGB-encoded elevation tiles decoded on the GPU) or a [`quantized-mesh`](../../../three/source/quantized-mesh-source/) source (pre-meshed tiles, e.g. Cesium Ion) as the 3D globe surface. Rendering options are the same regardless of the source's data format. All fetch/geometry config lives on the source.

## Properties

| Property | Type               | Description                                             |
| -------- | ------------------ | ------------------------------------------------------ |
| `type`   | `"terrain"`        | Layer type (required).                                 |
| `source` | `Source \| string` | The `raster-dem` or `quantized-mesh` source (required).|

### Render options

| Material                                                          | Config key | Description                          |
| ---------------------------------------------------------------- | ---------- | ------------------------------------ |
| [TerrainMaterial](../../../three/material/terrain-material/) | `terrain`  | Terrain mesh appearance (shadows, skirts, …). |

## Examples

### Raster DEM

```typescript
import ThreeView, { JAPAN_GSI_ELEVATION_DECODER } from "@navaramap/three";

const view = new ThreeView(/* options */);
await view.init();

const dem = view.addSource({
  type: "raster-dem",
  url: "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png",
  elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  maxZoom: 15,
  minZoom: 5,
});

view.addLayer({
  type: "terrain",
  source: dem,
  terrain: { castShadow: true, receiveShadow: true },
});
```

### Quantized-mesh

```typescript
const terrain = view.addSource({
  type: "quantized-mesh",
  url: "https://example.com/{z}/{x}/{y}.terrain",
  requestVertexNormals: true,
  requestWaterMask: true,
  maxZoom: 18,
});

view.addLayer({
  type: "terrain",
  source: terrain,
  terrain: { castShadow: true, receiveShadow: true },
});
```

:::note
For Cesium Ion quantized-mesh assets (endpoint + token resolved at runtime), use the [`CesiumIonPlugin`](../../../three_plugins/cesiumionplugin/) instead of calling `addSource` directly.
:::

### Draping imagery onto terrain

A terrain layer provides only the 3D surface. Add a [`raster`](../../../three/layer/raster-layer/) layer over it. Its tiles are draped onto the mesh. Later layers render on top, so a higher-resolution overlay can refine a wider base layer. The number of layers that can be draped at once depends on the device (see [Draped layer limit](../../../three/layer/raster-layer/#draped-layer-limit)).

```typescript
const terrain = view.addSource({ type: "quantized-mesh", url: "https://example.com/{z}/{x}/{y}.terrain", maxZoom: 18 });
const satellite = view.addSource({ type: "raster-tile", url: "https://example.com/satellite/{z}/{x}/{y}.jpg", maxZoom: 15 });

view.addLayer({ type: "terrain", source: terrain });
view.addLayer({ type: "raster", source: satellite });
```

### Draping vector features onto terrain

A [`vector`](../../../three/layer/vector-layer/) layer whose polygon/polyline materials set `clampToGround: true` also drapes onto the terrain surface, hugging the mesh instead of floating at a fixed height. This works over any terrain source, both `raster-dem` (WebMercator) and `quantized-mesh` (geographic / EPSG:4326) terrain, so clamp-to-ground vectors stay glued to the ground regardless of the terrain's tiling scheme.

```typescript
const terrain = view.addSource({ type: "quantized-mesh", url: "https://example.com/{z}/{x}/{y}.terrain", maxZoom: 18 });
const tiles = view.addSource({ type: "vector-tile", url: "https://example.com/tiles/{z}/{x}/{y}.mvt", maxZoom: 16 });

view.addLayer({ type: "terrain", source: terrain });
view.addLayer({
  type: "vector",
  source: tiles,
  sourceLayers: ["water"],
  polygon: { color: new Color().setStyle("#00aaff"), clampToGround: true },
});
```

## Related Resources

- [Raster DEM Source](../../../three/source/raster-dem-source/) / [Quantized Mesh Source](../../../three/source/quantized-mesh-source/)
- [TerrainMaterial](../../../three/material/terrain-material/): detailed terrain settings
- [Raster Layer](../../../three/layer/raster-layer/): drape imagery / add hillshade over terrain
- [Vector Layer](../../../three/layer/vector-layer/): drape clamp-to-ground vector features over terrain
- [CesiumIonPlugin](../../../three_plugins/cesiumionplugin/): Cesium Ion quantized-mesh assets
