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

**Description:** Color lookup table for this layer, as a flattened RGBA `Float32Array`. Create it with [`ColorMap.flatten()`](../../../three/api/colormap/#flatten). When omitted, the elevation is shown in grayscale. See [ColorMap](../../../three/api/colormap/) for the array format, how colors are placed (see also [`colorStops`](#colorstops)), and how to change it at runtime.

```typescript
import { ColorMap, Color } from "@navaramap/three";

const colorMap = new ColorMap("sequential", "Example", [
  new Color().setStyle("#ffffd9"),
  new Color().setStyle("#1d91c0"),
  new Color().setStyle("#081d58"),
]);

{
  elevationHeatmap: {
    colorMap: colorMap.flatten(),
    maxHeight: 3000,
  }
}
```

### colorStops

**Type:** `Float32Array | undefined`

**Default:** `undefined`

**Description:** Elevation in meters of each `colorMap` entry, in ascending order. Entry `i` is drawn exactly at `colorStops[i]`, and elevations between two stops blend their colors, so unevenly spaced stops (for example a sharp coastline at 0 m) keep their exact positions. Elevations below the first stop or above the last stop show the first or last color. While set, `minHeight`, `maxHeight`, and `logarithmic` do not affect the colors. It must have one value per `colorMap` entry. Otherwise it is ignored with a warning and the colors are evenly spaced. An update that leaves out `colorStops` keeps the current stops.

```typescript
{
  elevationHeatmap: {
    // deep blue below sea level, green at the coast, white at 3000 m
    colorMap: new Float32Array([
      0, 0.1, 0.4, 1,
      0, 0.6, 0.2, 1,
      1, 1, 1, 1,
    ]),
    colorStops: new Float32Array([-1000, 1, 3000]),
  }
}
```

### maxHeight

**Type:** `number | undefined`

**Default:** `1000`

**Description:** Maximum elevation (meters) for the colormap. Elevations above this show in the colormap's maximum color. Has no effect on the colors while `colorStops` is set.

```typescript
{ elevationHeatmap: { maxHeight: 3000 } }
```

### minHeight

**Type:** `number | undefined`

**Default:** `0`

**Description:** Minimum elevation (meters) for the colormap. Elevations at or below this show in the colormap's minimum color. Has no effect on the colors while `colorStops` is set.

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

**Default:** `10`

**Description:** Boundary value used as the base for logarithmic calculations when `logarithmic` is enabled. Elevations between `-logBoundary` and `logBoundary` are scaled linearly and the rest logarithmically. It must be greater than 1. A value of 1 or less falls back to `10`.

```typescript
{ elevationHeatmap: { logBoundary: 1000 } }
```

### filter

**Type:** `string | undefined`

**Default:** `"linear"`

**Description:** How elevations are sampled between DEM pixels: `"linear"` or `"nearest"`. `"linear"` interpolates the decoded heights for smooth color transitions, and `"nearest"` uses the closest pixel, so each DEM pixel shows as a solid block of color. Any other value is treated as `"linear"`.

```typescript
{ elevationHeatmap: { filter: "nearest" } }
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
