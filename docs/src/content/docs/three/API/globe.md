---
title: Globe Class
description: API Reference for Globe Class - a class for managing globe display settings
sidebar:
  order: 1000
---

The Globe class provides an interface for accessing and modifying properties related to globe display. It manages globe display settings shared across different material types such as VectorTile, RasterTile, and RasterTerrain.

## How to Access

The Globe instance is accessed through the `globe` property of ThreeView.

```typescript
import ThreeView from "@navaramap/three";

const view = new ThreeView();

await view.init();

// Access the Globe instance
const globe = view.globe;

// Modify properties
globe.wireframe = true;
globe.opacity = 0.8;
```

## Properties

### maxSse

**Type:** `number`

**Description:** Screen space error threshold for LOD (Level of Detail) calculations. Smaller values load more detailed tiles.

**Default:** `2.0`

:::warning
This property is only effective at initialization time. Set it in the ThreeView constructor.
:::

**Example:**

```typescript
// Set in the constructor
const view = new ThreeView({
  maxSse: 1,
});

// Get the current value
console.log(view.globe.maxSse);
```

---

### segments

**Type:** `number`

**Description:** Number of segments for mesh tessellation. Larger values produce a smoother globe surface but have a performance impact.

**Default:** `64`

:::warning
This property is only effective at initialization time. Set it in the ThreeView constructor.
:::

**Example:**

```typescript
// Set in the constructor
const view = new ThreeView({
  segments: 32,
});

// Get the current value
console.log(view.globe.segments);
```

---

### color

**Type:** `Color | undefined`

**Description:** The base color of the globe surface. Sets the color displayed before tiles are loaded or in areas without tiles.

**Example:**

```typescript
import ThreeView, { Color } from "@navaramap/three";

const view = new ThreeView();

await view.init();

// Set the color
view.globe.color = new Color().setHex(0x1a1a2e);

// Set from a CSS color string
view.globe.color = new Color().setStyle("#2d3436");
```

---

### hideUnderground

**Type:** `boolean`

**Description:** Whether to hide underground geometry. Controls the display when the camera goes below the globe surface.

**Default:** `true`

:::warning
Disabling this value may cause unexpected behavior when using effect descriptors.
:::

**Example:**

```typescript
// Enable underground display (e.g., for underground model visualization)
view.globe.hideUnderground = false;

// Disable underground display (default)
view.globe.hideUnderground = true;
```

---

### useNormal

**Type:** `boolean`

**Description:** Whether to use normals. Affects lighting calculations.

**Default:** `false`

:::warning
This property is only effective at initialization time. Set it in the ThreeView constructor.
:::

**Example:**

```typescript
// Set in the constructor
const view = new ThreeView({
  useNormal: true,
});
```

---

### transparent

**Type:** `boolean`

**Description:** Whether to make the material transparent. When set to `true`, transparency can be adjusted using the `opacity` property.

**Default:** `false`

:::note
Blending only works with resource layers.
:::

**Example:**

```typescript
// Enable transparency
view.globe.transparent = true;
view.globe.opacity = 0.7;
```

---

### opacity

**Type:** `number`

**Description:** Global material opacity (0.0-1.0). Only takes effect when `transparent` is `true`.

**Default:** `1.0`

**Example:**

```typescript
// Set to semi-transparent
view.globe.transparent = true;
view.globe.opacity = 0.5;

// Restore to fully opaque
view.globe.opacity = 1.0;
```

---

### wireframe

**Type:** `boolean`

**Description:** Whether to render the material in wireframe mode. Used for debugging and visualization purposes.

**Default:** `false`

**Example:**

```typescript
// Enable wireframe mode
view.globe.wireframe = true;

// Disable wireframe mode
view.globe.wireframe = false;
```

## Setting Initialization-Time Properties

Some properties can only be set at initialization time. These are specified in the ThreeView constructor options.

```typescript
import ThreeView, { Color } from "@navaramap/three";

const view = new ThreeView({
  // Properties that can only be set at initialization
  maxSse: 1,
  segments: 64,
  useNormal: true,
  // Properties that can be changed at runtime
  color: new Color().setHex(0x1a1a2e),
  hideUnderground: true,
  transparent: false,
  opacity: 1.0,
  wireframe: false,
});

await view.init();

// After initialization, only runtime properties can be changed
view.globe.wireframe = true;
view.globe.opacity = 0.8;
```

## See Also

- [Color Class](../../../three/api/color/) - A class for representing colors
- [ColorMap Class](../../../three/api/colormap/) - Defining color gradients
- [ElevationHeatmapMaterial](../../../three/material/elevation-heatmap-material/) - Elevation heatmap material
- [ThreeView Class](../../../three/api/threeview-class/) - Main view class
