---
title: 3D Tiles Layer
description: Render a 3d-tiles source (buildings, point clouds, photogrammetry)
sidebar:
  order: 440
---

A `3d-tiles` layer renders a [`3d-tiles`](../../../three/source/3d-tiles-source/) source, a large-scale 3D dataset in the 3D Tiles format (building models, point clouds, photorealistic tiles, and more), with a model appearance.

## Properties

| Property | Type               | Description                          |
| -------- | ------------------ | ------------------------------------ |
| `type`   | `"3d-tiles"`       | Layer type (required).               |
| `source` | `Source \| string` | The `3d-tiles` source (required).    |

### Render options

| Material                                                       | Config key | Description                    |
| ------------------------------------------------------------- | ---------- | ------------------------------ |
| [ModelMaterial](../../../three/material/model-material/) | `model`    | Controls the 3D model appearance. |

## Examples

### Basic tileset

```typescript
import ThreeView, { Color } from "@navaramap/three";

const view = new ThreeView(/* options */);
await view.init();

const tileset = view.addSource({
  type: "3d-tiles",
  url: "https://example.com/tileset.json",
});

view.addLayer({
  type: "3d-tiles",
  source: tileset,
  model: { show: true, color: new Color().setHex(0xffffff), metalness: 0.1, roughness: 0.1 },
});
```

### Google Photorealistic 3D Tiles

```typescript
const tileset = view.addSource({
  type: "3d-tiles",
  url: `https://tile.googleapis.com/v1/3dtiles/root.json?key=${YOUR_GOOGLE_MAPS_API_KEY}`,
});

const layer = view.addLayer({ type: "3d-tiles", source: tileset, model: { maxSse: 30 } });
```

:::note
The `Layer` handle emits `featureCreated` / `featureRemoved` / `featureVisibilityChanged` events. `featureCreated` carries each tile's credit as `content.credit`. Use them to display attribution for sources such as Google Photorealistic 3D Tiles, as required by their [terms of service](https://cloud.google.com/maps-platform/terms). See the [3D Tiles Source](../../../three/source/3d-tiles-source/) page for supported specifications (b3dm, pnts, glTF extensions).
:::

## Related Resources

- [3D Tiles Source](../../../three/source/3d-tiles-source/): supported formats and extensions
- [ModelMaterial](../../../three/material/model-material/): detailed model settings
