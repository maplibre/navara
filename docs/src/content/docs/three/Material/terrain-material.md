---
title: TerrainMaterial
description: Terrain mesh rendering options for a terrain layer
sidebar:
  order: 560
---

`TerrainMaterial` holds the render options for a [`terrain`](../../../three/layer/terrain-layer/) layer's mesh. It is set via the `terrain` key and applies regardless of the source's data format: [`raster-dem`](../../../three/source/raster-dem-source/) (RGB-encoded elevation) or [`quantized-mesh`](../../../three/source/quantized-mesh-source/). All fetch/geometry config (zoom range, tiling scheme, elevation decoder, extensions, token) lives on the referenced source, not here.

## Properties

### show

**Type:** `boolean | undefined`

**Default:** `true`

**Description:** Whether to show the terrain.

```typescript
{ terrain: { show: true } }
```

### castShadow

**Type:** `boolean | undefined`

**Default:** `false`

**Description:** Whether the terrain casts shadows.

```typescript
{ terrain: { castShadow: true } }
```

### receiveShadow

**Type:** `boolean | undefined`

**Default:** `false`

**Description:** Whether the terrain receives shadows.

```typescript
{ terrain: { receiveShadow: true } }
```

### lit

**Type:** `boolean | undefined`

**Default:** `undefined` (follows `view.lit`)

**Description:** Applies the lighting equation to the color output. When `false`, the terrain renders as plain albedo. The rest of the lit pipeline still runs, so normals and the shadow G-buffer keep being written. Leaving it unset follows the scene default, [`view.lit`](../../../three/api/threeview-properties/#lit). Setting it explicitly overrides that default in either direction.

```typescript
{ terrain: { lit: false } }
```

:::note
The terrain only takes the lit path when the tiles have normals: use a [`quantized-mesh`](../../../three/source/quantized-mesh-source/) source with `requestVertexNormals: true`, or a hillshade layer. Without normals the tiles are unlit already and `lit` changes nothing.
:::

### showBoundingBox

**Type:** `boolean | undefined`

**Default:** `false`

**Description:** Whether to show per-tile bounding boxes. Used for debugging.

```typescript
{ terrain: { showBoundingBox: true } }
```

### skirt

**Type:** `boolean | undefined`

**Default:** `true`

**Description:** Whether to render skirts along tile boundaries to hide gaps between neighboring tiles at different LODs. Disable this if you want to visualize underground models.

```typescript
{ terrain: { skirt: true } }
```

### skirtExaggeration

**Type:** `number | undefined`

**Default:** `1.0`

**Description:** Multiplier applied to the auto-calculated skirt height. `1.0` uses the default calculated height.

```typescript
{ terrain: { skirtExaggeration: 1.5 } }
```

### exaggeration

**Type:** `number | undefined`

**Default:** `1`

**Description:** Vertical exaggeration of the terrain. Terrain heights are multiplied by this factor around [`exaggerationRelativeHeight`](#exaggerationrelativeheight), and level of detail and culling follow the exaggerated surface. `sampleTerrainHeight`, `observeTerrainHeightAt`, `sampleTerrainHeightRange`, `observeTerrainHeightRange`, and `sampleTerrainMostDetailed` return exaggerated heights, so clamp-to-ground features and meshes with `heightReference: "terrain"` stay on the surface. 3D Tiles and glTF models are not stretched, and elevation heatmaps and hillshade keep using the source heights. A negative value is treated as `0`, which flattens the terrain to `exaggerationRelativeHeight`. Can be changed at runtime with `layer.update()`, and the exaggeration is reset when the terrain layer is deleted.

```typescript
const terrainLayer = view.addLayer({
  type: "terrain",
  source: terrain,
  terrain: { exaggeration: 2 },
});

// Change it at runtime
terrainLayer.update({ terrain: { exaggeration: 3 } });
```

### exaggerationRelativeHeight

**Type:** `number | undefined`

**Default:** `0`

**Description:** Height in meters that stays in place while the terrain is exaggerated. It is an absolute height measured like the terrain heights themselves (height above the WGS84 ellipsoid, which for a `raster-dem` source is the decoded elevation value as is), not an offset from the camera or the ground. A terrain height `h` is rendered at `(h - exaggerationRelativeHeight) * exaggeration + exaggerationRelativeHeight`. With the default `0`, high regions are lifted as a whole, so set it to the elevation of the ground you are looking at (for example a valley floor on a plateau, or the ground under 3D Tiles or models, which are not exaggerated) to emphasize the relief around it while that ground stays in place. Keep `0` when the view spans from the coast to the mountains, so the sea level does not move.

```typescript
// Exaggerate relief around a basin at 1000 m without moving the basin floor
terrainLayer.update({
  terrain: { exaggeration: 2, exaggerationRelativeHeight: 1000 },
});
```

## Combining with other layers

A terrain layer provides only the 3D surface. Drape imagery or shaded relief on top with a [`raster`](../../../three/layer/raster-layer/) layer:

| Over terrain            | Supported | Notes                                                                            |
| ----------------------- | --------- | -------------------------------------------------------------------------------- |
| `raster` (imagery)      | ✅ Yes    | Raster imagery is reprojected and draped onto the mesh. Multiple can be stacked. |
| `raster` (hillshade)    | ✅ Yes    | Shaded relief computed from DEM tiles, rendered over the 3D surface.             |
| `vector` (vector tiles) | ❌ Not yet | Vector tiles cannot currently be draped onto quantized-mesh terrain.            |

## Related Resources

- [Terrain Layer](../../../three/layer/terrain-layer/): how to use this material
- [Raster DEM Source](../../../three/source/raster-dem-source/) / [Quantized Mesh Source](../../../three/source/quantized-mesh-source/): terrain data sources
- [CesiumIonPlugin](../../../three_plugins/cesiumionplugin/): Cesium Ion quantized-mesh assets
