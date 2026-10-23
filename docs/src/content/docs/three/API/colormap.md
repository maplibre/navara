---
title: ColorMap Class
description: API Reference for ColorMap Class - a class for defining color gradients
sidebar:
  order: 980
---

The `ColorMap` class defines color gradients (color interpolation) used for elevation heatmaps and similar visualizations. It converts values in the range 0.0-1.0 to colors based on a lookup table (LUT).

## Constructor

```typescript
new ColorMap(type: ColorMapType, name: string, lut: LUT)
```

**Parameters:**

- `type`: The type of color map
- `name`: The name of the color map (for identification)
- `lut`: Color lookup table (array of 2 or more colors)

**Example:**

```typescript
import { ColorMap, Color } from "@navaramap/three";

// ref: https://colorbrewer2.org/#type=sequential&scheme=YlGnBu&n=9
const ylGnBu = new ColorMap("sequential", "YlGnBu", [
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

// ref: https://colorbrewer2.org/#type=diverging&scheme=RdYlBu&n=11
const rdYlBu = new ColorMap("diverging", "RdYlBu", [
  new Color().setStyle("#a50026"),
  new Color().setStyle("#d73027"),
  new Color().setStyle("#f46d43"),
  new Color().setStyle("#fdae61"),
  new Color().setStyle("#fee090"),
  new Color().setStyle("#ffffbf"),
  new Color().setStyle("#e0f3f8"),
  new Color().setStyle("#abd9e9"),
  new Color().setStyle("#74add1"),
  new Color().setStyle("#4575b4"),
  new Color().setStyle("#313695"),
]);
```

## Types

### ColorMapType

A type representing the kind of color map.

```typescript
type ColorMapType = "sequential" | "diverging";
```

- `"sequential"`: Sequential color map (unidirectional gradient from low to high)
- `"diverging"`: Diverging color map (gradient in both directions from a center value)

### LUT

The type for the lookup table. Defined as an array of colors.

```typescript
type ColorTuple = [number, number, number]; // [r, g, b] (0.0-1.0)
type LUT = readonly (ColorTuple | Color)[];
```

Each color can be specified in one of the following formats:

- `[r, g, b]`: An array of RGB values in the range 0.0-1.0
- `Color`: An instance of the Color class

## Properties

### type

**Type:** `ColorMapType`

**Description:** The type of color map (read-only).

### name

**Type:** `string`

**Description:** The name of the color map (read-only).

### lut

**Type:** `ColorTuple[]`

**Description:** The normalized color lookup table. Colors passed to the constructor are internally converted to `[r, g, b]` format.

### count

**Type:** `number`

**Description:** The number of colors in the LUT (read-only).

## Methods

### linear()

Gets the interpolated color corresponding to a value.

**Syntax:**

```typescript
linear(value: number): ColorTuple
```

**Parameters:**

- `value`: A value in the range 0.0-1.0

**Returns:**

An interpolated `[r, g, b]` color tuple

---

### quantize()

Gets a specified number of evenly divided colors.

**Syntax:**

```typescript
quantize(count: number): ColorTuple[]
```

**Parameters:**

- `count`: The number of colors to retrieve (2 or more)

**Returns:**

An array of evenly divided colors

---

### ticks()

Generates tick values based on a specified range and count.

**Syntax:**

```typescript
ticks(range: [min: number, max: number], count: number): number[]
```

**Parameters:**

- `range`: The value range `[minimum, maximum]`
- `count`: The desired number of ticks

**Returns:**

An array of tick values

---

### createImage()

Generates the color map as a Canvas image. Can be used for legend displays and similar purposes.

**Syntax:**

```typescript
createImage(): HTMLCanvasElement
```

**Returns:**

A 1-pixel high Canvas element representing the color map

---

### flatten()

Converts the color map to a `Float32Array` for GPU use. Use this when setting the `colorMap` property on elevation heatmap layers.

**Syntax:**

```typescript
flatten(): Float32Array
```

**Returns:**

A flattened RGB array (length = number of colors in LUT x 3)

## Usage Examples

### Usage with Elevation Heatmaps

```typescript
import ThreeView, {
  ColorMap,
  Color,
  TERRARIUM_ELEVATION_DECODER,
} from "@navaramap/three";

const view = new ThreeView({
  animation: true,
});

await view.init();

// ref: https://colorbrewer2.org/#type=diverging&scheme=Spectral&n=11
const spectralColorMap = new ColorMap("diverging", "Spectral", [
  new Color().setStyle("#9e0142"),
  new Color().setStyle("#d53e4f"),
  new Color().setStyle("#f46d43"),
  new Color().setStyle("#fdae61"),
  new Color().setStyle("#fee08b"),
  new Color().setStyle("#ffffbf"),
  new Color().setStyle("#e6f598"),
  new Color().setStyle("#abdda4"),
  new Color().setStyle("#66c2a5"),
  new Color().setStyle("#3288bd"),
  new Color().setStyle("#5e4fa2"),
]);

// Add an elevation heatmap layer with the color map
const heatmapSource = view.addSource({
  type: "raster-dem",
  url: "https://example.com/terrain/{z}/{x}/{y}.png",
  elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
  maxZoom: 15,
});
view.addLayer({
  type: "raster",
  source: heatmapSource,
  elevationHeatmap: {
    colorMap: spectralColorMap.flatten(),
    maxHeight: 3000,
    minHeight: 0,
  },
});
```

### Dynamic Color Map Switching

```typescript
import ThreeView, { ColorMap, Color, TERRARIUM_ELEVATION_DECODER, type LayerDescription } from "@navaramap/three";

const view = new ThreeView();
await view.init();

// Define multiple color maps
const colorMaps = {
  // ref: https://colorbrewer2.org/#type=sequential&scheme=YlGnBu&n=9
  ylGnBu: new ColorMap("sequential", "YlGnBu", [
    new Color().setStyle("#ffffd9"),
    new Color().setStyle("#edf8b1"),
    new Color().setStyle("#c7e9b4"),
    new Color().setStyle("#7fcdbb"),
    new Color().setStyle("#41b6c4"),
    new Color().setStyle("#1d91c0"),
    new Color().setStyle("#225ea8"),
    new Color().setStyle("#253494"),
    new Color().setStyle("#081d58"),
  ]),

  // ref: https://colorbrewer2.org/#type=diverging&scheme=RdYlGn&n=11
  rdYlGn: new ColorMap("diverging", "RdYlGn", [
    new Color().setStyle("#a50026"),
    new Color().setStyle("#d73027"),
    new Color().setStyle("#f46d43"),
    new Color().setStyle("#fdae61"),
    new Color().setStyle("#fee08b"),
    new Color().setStyle("#ffffbf"),
    new Color().setStyle("#d9ef8b"),
    new Color().setStyle("#a6d96a"),
    new Color().setStyle("#66bd63"),
    new Color().setStyle("#1a9850"),
    new Color().setStyle("#006837"),
  ]),

  // ref: https://colorbrewer2.org/#type=diverging&scheme=BrBG&n=11
  brBG: new ColorMap("diverging", "BrBG", [
    new Color().setStyle("#543005"),
    new Color().setStyle("#8c510a"),
    new Color().setStyle("#bf812d"),
    new Color().setStyle("#dfc27d"),
    new Color().setStyle("#f6e8c3"),
    new Color().setStyle("#f5f5f5"),
    new Color().setStyle("#c7eae5"),
    new Color().setStyle("#80cdc1"),
    new Color().setStyle("#35978f"),
    new Color().setStyle("#01665e"),
    new Color().setStyle("#003c30"),
  ]),
};

const heatmapSource = view.addSource({
  type: "raster-dem",
  url: "https://example.com/terrain/{z}/{x}/{y}.png",
  elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
  maxZoom: 15,
});

const layerDef: LayerDescription = {
  type: "raster",
  source: heatmapSource.id,
  elevationHeatmap: {
    colorMap: colorMaps.rdYlGn.flatten(),
    maxHeight: 3000,
    minHeight: 0,
  },
};

const layer = view.addLayer(layerDef);

// Function to switch color maps
function setColorMap(name: keyof typeof colorMaps) {
  if (layerDef.elevationHeatmap) {
    layerDef.elevationHeatmap.colorMap = colorMaps[name].flatten();
    view.updateLayerById(layer.id, layerDef);
  }
}

// Usage example
setColorMap("rdYlGn");
```

## See Also

- [Color Class](../../../three/api/color/) - A class for representing colors
- [ElevationHeatmapMaterial](../../../three/material/elevation-heatmap-material/) - Using color maps with elevation heatmap layers
- [ElevationHeatmapMaterial](../../../three/material/elevation-heatmap-material/) - Elevation heatmap material
