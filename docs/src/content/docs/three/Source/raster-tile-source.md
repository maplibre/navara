---
title: Raster Tile Source
description: A raster-tile (imagery) source
sidebar:
  order: 330
---

A `raster-tile` source describes raster imagery tiles (XYZ or TMS). Render it with a [`raster`](../../../three/layer/raster-layer/) layer.

## Properties

| Property            | Type            | Default    | Description                                              |
| ------------------- | --------------- | ---------- | ------------------------------------------------------- |
| `type`              | `"raster-tile"` | (required) | Source type.                                            |
| `url`               | `string`        | (required) | Tile URL template (contains `{z}/{x}/{y}`).             |
| `tms`               | `boolean`       | `false`    | Whether the tile scheme is flipped along the Y axis (TMS). |
| `tileSize`          | `number`        | `512`      | Pixel size of one tile. Zoom is defined for 512 px tiles, so `256` selects tiles one level deeper than `512` at the same camera height. |
| `minZoom`           | `number`        | `0`        | Minimum zoom level tiles are provided for.              |
| `maxZoom`           | `number`        | `20`       | Maximum zoom level new tiles are requested for.         |
| `overscaledMaxZoom` | `number`        | `24`       | Maximum zoom overscaled (stretched-parent) tiles are used up to. |

A smaller `tileSize` makes the terrain subdivide deeper so imagery stays sharp: with WebMercator terrain (the default) a `256` source makes the terrain tiles one level finer, about four times as many. With Geographic terrain the imagery is draped one level deeper instead, with the per-terrain-tile tile budget raised four times per level. The shift is limited to two levels deeper, so `tileSize` values below `128` behave like `128`. Values above `512` behave like `512`.

## Example

```typescript
import ThreeView from "@navaramap/three";

const imagery = view.addSource({
  type: "raster-tile",
  url: "https://example.com/{z}/{x}/{y}.png",
  maxZoom: 19,
});

view.addLayer({ type: "raster", source: imagery });

// Style the raster imagery with `raster`.
view.addLayer({ type: "raster", source: imagery, raster: { opacity: 0.8 } });
```

## Related Resources

- [About Source](../../../three/source/about/)
- [RasterMaterial](../../../three/material/raster-material/): raster layer rendering options
