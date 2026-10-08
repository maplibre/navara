---
title: 3D Tiles Source
description: A 3d-tiles (3D Tiles tileset) source
sidebar:
  order: 360
---

A `3d-tiles` source points at a 3D Tiles tileset (a `tileset.json` hierarchy). Render it with a [`3d-tiles`](../../../three/layer/3d-tiles-layer/) layer.

## Properties

| Property | Type         | Default    | Description                                 |
| -------- | ------------ | ---------- | ------------------------------------------- |
| `type`   | `"3d-tiles"` | (required) | Source type.                                |
| `url`    | `string`     | (required) | URL of the `tileset.json`.                  |
| `crs`    | `string`     | —          | Coordinate reference system of the content. |

## Supported Specifications

### 3D Tiles 1.0

| Tile Format                    | Description                                                |
| ------------------------------ | ---------------------------------------------------------- |
| b3dm (Batched 3D Model)        | Batched 3D models such as buildings.                       |
| pnts (Point Cloud)             | Point cloud data. See [PNTS attributes](#pnts-attributes). |
| Google Photorealistic 3D Tiles | Photorealistic tiles provided by Google Maps Platform.     |

### PNTS attributes

Navara reads only part of the pnts feature table. Point colors are interpreted as sRGB. A tile that stores its positions only as `POSITION_QUANTIZED` is not rendered.

| Semantic                          | Support                               |
| --------------------------------- | ------------------------------------- |
| `POSITION`                        | ✅                                    |
| `POSITION_QUANTIZED`              | ❌                                    |
| `RTC_CENTER`                      | ✅                                    |
| `RGB`                             | ⚠️ Draco-compressed tiles only        |
| `RGBA`                            | ⚠️ Draco-compressed tiles only        |
| `RGB565`                          | ❌                                    |
| `CONSTANT_RGBA`                   | ❌                                    |
| `NORMAL` / `NORMAL_OCT16P`        | ❌                                    |
| `BATCH_ID` and the batch table    | ❌                                    |
| `3DTILES_draco_point_compression` | ⚠️ `POSITION`, `RGB`, and `RGBA` only |

### 3D Tiles 1.1

| Feature                      | Description                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| GLB content                  | Tiles using GLB (binary glTF) as the content format.                                  |
| GLB POINTS primitive         | Point cloud rendering for glTF meshes with `mode: POINTS` (3D Tiles 1.1 point cloud). |
| `EXT_mesh_features`          | Feature identification via FeatureId sets in glTF meshes.                             |
| `EXT_structural_metadata`    | Access to per-feature metadata via property tables embedded in glTF assets.           |
| `KHR_draco_mesh_compression` | Decoding of Draco-compressed mesh data.                                               |
| `KHR_mesh_quantization`      | Quantized vertex attributes for compact glTF assets.                                  |
| `EXT_meshopt_compression`    | Decoding of meshopt-compressed buffers.                                               |

:::note
Only GLB (binary glTF container) content is supported. Plain `.gltf` files referencing external `.bin` buffers are not supported yet. Implicit tiling is not supported either, so a tileset must describe its tile hierarchy explicitly in `tileset.json`.
:::

## Example

```typescript
import ThreeView from "@navaramap/three";

const tileset = view.addSource({
  type: "3d-tiles",
  url: "https://example.com/tileset.json",
});
view.addLayer({ type: "3d-tiles", source: tileset, model: { opacity: 1.0 } });
```

## Related Resources

- [About Source](../../../three/source/about/)
- [ModelMaterial](../../../three/material/model-material/): 3D model rendering options
