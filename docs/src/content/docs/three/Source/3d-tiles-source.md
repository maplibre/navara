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

Google Photorealistic 3D Tiles from Google Maps Platform are supported. A tile whose content format is not supported is skipped, and the rest of the tileset still renders.

| Tile Format                                  | Support                                                               |
| -------------------------------------------- | --------------------------------------------------------------------- |
| b3dm (Batched 3D Model)                      | ⚠️ glTF 2.0 payloads only                                             |
| pnts (Point Cloud)                           | ⚠️ Part of the feature table, see [PNTS attributes](#pnts-attributes) |
| i3dm (Instanced 3D Model)                    | ❌                                                                    |
| cmpt (Composite)                             | ❌                                                                    |
| External tileset (`tileset.json` as content) | ✅                                                                    |

### PNTS attributes

Navara reads only part of the pnts feature table. Point colors are interpreted as sRGB. A tile without colors is drawn in the layer color. Point alpha (from `RGBA` or `CONSTANT_RGBA`) applies only when the layer material sets `transparent: true`; otherwise points are drawn opaque. Translucent points blend without being sorted, so where they overlap, the result can depend on the drawing order.

| Semantic                          | Support                               |
| --------------------------------- | ------------------------------------- |
| `POSITION`                        | ✅                                    |
| `POSITION_QUANTIZED`              | ✅                                    |
| `RTC_CENTER`                      | ✅                                    |
| `RGB`                             | ✅                                    |
| `RGBA`                            | ✅                                    |
| `RGB565`                          | ✅                                    |
| `CONSTANT_RGBA`                   | ✅                                    |
| `NORMAL` / `NORMAL_OCT16P`        | ❌                                    |
| `BATCH_ID` and the batch table    | ❌                                    |
| `3DTILES_draco_point_compression` | ⚠️ `POSITION`, `RGB`, and `RGBA` only |

### 3D Tiles 1.1

| Feature                      | Description                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| GLB content                  | Tiles using GLB (binary glTF) as the content format.                                  |
| glTF content                 | Tiles using glTF (JSON, `.gltf`) as the content format.                               |
| GLB POINTS primitive         | Point cloud rendering for glTF meshes with `mode: POINTS` (3D Tiles 1.1 point cloud). |
| `EXT_mesh_features`          | Feature identification via FeatureId sets in glTF meshes.                             |
| `EXT_structural_metadata`    | Access to per-feature metadata via property tables embedded in glTF assets.           |
| Tileset metadata             | Tileset, tile, content and group `metadata`, see [Metadata](#metadata).               |
| `KHR_draco_mesh_compression` | Decoding of Draco-compressed mesh data.                                               |
| `KHR_mesh_quantization`      | Quantized vertex attributes for compact glTF assets.                                  |
| `EXT_meshopt_compression`    | Decoding of meshopt-compressed buffers.                                               |

:::note
Implicit tiling is not supported, so a tileset must describe its tile hierarchy explicitly in `tileset.json`.
:::

### Tileset features

| Feature                                               | Support                   |
| ----------------------------------------------------- | ------------------------- |
| `refine` (`ADD` / `REPLACE`)                          | ✅                        |
| Tile `transform`                                      | ✅                        |
| b3dm `RTC_CENTER` and glTF `CESIUM_RTC`               | ✅                        |
| `data:` URI content                                   | ✅                        |
| Multiple contents per tile (`contents`)               | ✅                        |
| Pre-1.0 tilesets (`content.url`, legacy b3dm headers) | ✅                        |
| `viewerRequestVolume`                                 | ❌                        |
| `asset.gltfUpAxis`                                    | ⚠️ `Y` (the default) only |

## Metadata

Navara reads the 3D Tiles 1.1 metadata of the tileset, tiles, contents and groups, and resolves each value with the tileset `schema`: `normalized`, `offset` and `scale` are applied, a `noData` value becomes the property's `default` (or `null`), and an omitted property gets its `default`.

- Tile, content and group metadata arrive with each feature set in the layer's `featureCreated` event, as `content.metadata: { tile?, content?, group? }` where `content.type` is `"3d-tiles"`. Each picked feature carries the same `content` in the view's `featureClick` / `featureHover` / `featureEnter` events.
- Tileset metadata and the schema arrive once per load in the layer's `tilesetLoaded` event, and stay readable as `layer.tileset`.

The schema must be inline in the root tileset JSON: `schemaUri` is not fetched. As in CesiumJS, every tile resolves against the root tileset's `schema` and `groups`, and those of an external (nested) tileset are ignored. Metadata in implicit tiling subtrees and the 1.0 `3DTILES_metadata` extension are not read.

```typescript
const layer = view.addLayer({ type: "3d-tiles", source: tileset });

layer.on("tilesetLoaded", ({ metadata }) => {
  console.log("Tileset metadata:", metadata?.properties);
});

view.on("featureClick", (info) => {
  const content = info?.content;
  if (content?.type === "3d-tiles") {
    console.log("Tile metadata:", content.metadata?.tile);
  }
});
```

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
