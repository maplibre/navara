---
title: ElevationHeatmapMaterial
description: Elevation heatmap material for navara_three
sidebar:
  order: 590
---

`ElevationHeatmapMaterial` holds the render options for visualizing elevation as a color-coded heatmap on a [`raster`](../../../three/layer/raster-layer/) layer. It decodes DEM tiles and applies a colormap based on elevation values. Set it via the `elevationHeatmap` key.

Because it decodes DEM tiles, it requires a [`raster-dem`](../../../three/source/raster-dem-source/) source. The elevation decoder is taken from the source, not from this material.

## Use Cases

- Visually representing the elevation distribution of terrain
- Terrain analysis and visualizing mountainous areas
- Intuitive understanding of elevation data

## Properties

### colorMap

**Type:** `Float32Array | undefined`

**Default:** `undefined`

**Description:** Color map lookup table for this layer. A flattened RGB array `[r0,g0,b0, r1,g1,b1, ...]` where each color component is in the range [0, 1]. Use `ColorMap.flatten()` to convert a ColorMap instance to this format.

```typescript
import { ColorMap, Color } from "@navaramap/three";

const colorMap = new ColorMap("sequential", "YlGnBu", [
  new Color().setStyle("#ffffd9"),
  new Color().setStyle("#edf8b1"),
  new Color().setStyle("#c7e9b4"),
  new Color().setStyle("#7fcdbb"),
  new Color().setStyle("#41b6c4"),
  new Color().setStyle("#1d91c0"),
  new Color().setStyle("#225ea8"),
  new Color().setStyle("#253494"),
  new Color().setStyle("#081d58"),
]);

{
  elevationHeatmap: {
    colorMap: colorMap.flatten(),
    maxHeight: 3000,
  }
}
```

### maxHeight

**Type:** `number | undefined`

**Default:** `1000`

**Description:** Maximum elevation (meters) for the colormap. Elevations above this show in the colormap's maximum color.

```typescript
{ elevationHeatmap: { maxHeight: 3000 } }
```

### minHeight

**Type:** `number | undefined`

**Default:** `0`

**Description:** Minimum elevation (meters) for the colormap. Elevations at or below this show in the colormap's minimum color.

```typescript
{ elevationHeatmap: { minHeight: 0 } }
```

### logarithmic

**Type:** `boolean | undefined`

**Default:** `false`

**Description:** Whether to use a logarithmic scale, making subtle elevation differences in lowland areas more visible when the low–high range is large.

```typescript
{ elevationHeatmap: { logarithmic: true } }
```

### logBoundary

**Type:** `number | undefined`

**Default:** `0`

**Description:** Boundary value used as the base for logarithmic calculations when `logarithmic` is enabled.

```typescript
{ elevationHeatmap: { logBoundary: 1000 } }
```

## Usage Examples

### Basic usage

```typescript
import ThreeView, { TERRARIUM_ELEVATION_DECODER } from "@navaramap/three";

const view = new ThreeView({ container: document.getElementById("map") });
await view.init();

const dem = view.addSource({
  type: "raster-dem",
  url: "https://example.com/terrarium/{z}/{x}/{y}.png",
  elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
  maxZoom: 15,
});

view.addLayer({
  type: "raster",
  source: dem,
  elevationHeatmap: { maxHeight: 3000, minHeight: 0 },
});
```

### Logarithmic scale

```typescript
view.addLayer({
  type: "raster",
  source: dem,
  elevationHeatmap: { maxHeight: 3000, minHeight: 0, logarithmic: true, logBoundary: 1000 },
});
```

### Customizing the colormap

Each layer can have its own color map. Define it using the `colorMap` property.

```typescript
import ThreeView, { ColorMap, Color, TERRARIUM_ELEVATION_DECODER } from "@navaramap/three";

const view = new ThreeView();
await view.init();

// ref: https://colorbrewer2.org/#type=diverging&scheme=RdYlBu&n=11
const rdYlBuColorMap = new ColorMap("diverging", "RdYlBu", [
  new Color().setStyle("#313695"),
  new Color().setStyle("#4575b4"),
  new Color().setStyle("#74add1"),
  new Color().setStyle("#abd9e9"),
  new Color().setStyle("#e0f3f8"),
  new Color().setStyle("#ffffbf"),
  new Color().setStyle("#fee090"),
  new Color().setStyle("#fdae61"),
  new Color().setStyle("#f46d43"),
  new Color().setStyle("#d73027"),
  new Color().setStyle("#a50026"),
]);

const dem = view.addSource({
  type: "raster-dem",
  url: "https://example.com/terrarium/{z}/{x}/{y}.png",
  elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
  maxZoom: 15,
});

view.addLayer({
  type: "raster",
  source: dem,
  elevationHeatmap: {
    colorMap: rdYlBuColorMap.flatten(),
    maxHeight: 3000,
    minHeight: 0,
  },
});
```

## Related Resources

- [Raster Layer](../../../three/layer/raster-layer/): how to use this material
- [Raster DEM Source](../../../three/source/raster-dem-source/): DEM source and its elevation decoder
- [ColorMap class](../../../three/api/colormap/): creating and managing color maps
- [HillshadeMaterial](../../../three/material/hillshade-material/): shaded relief from DEM tiles
