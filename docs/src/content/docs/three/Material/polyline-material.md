---
title: PolylineMaterial
description: Polyline material for navara_three
sidebar:
  order: 550
---

`PolylineMaterial` represents a material for polyline geometry rendering.

## Properties

### castShadow

**Type:** `boolean | undefined`

**Description:** Specifies whether the polyline casts shadows.

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    castShadow: true
  }
}
```

### clampToGround

**Type:** `boolean`

**Description:** Specifies whether to clamp the polyline to the ground.

**Default:** Required

**Example:**

```typescript
{
  polyline: {
    clampToGround: true
  }
}
```

### color

**Type:** `Color`

**Description:** Specifies the polyline color as a `Color` instance.

**Default:** Required

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polyline: {
    color: new Color().setHex(0x0066cc)
  }
}
```

### depthWrite

**Type:** `boolean | undefined`

**Description:** Enables writing to the depth buffer. Set to `false` for transparent materials to prevent depth sorting issues.

**Default:** `true`

**Example:**

```typescript
{
  polyline: {
    depthWrite: false
  }
}
```

### effectIds

**Type:** `string[] | undefined`

**Description:** Specifies the IDs of selective effects to apply (e.g., "bloom", "outline"). Used in conjunction with SelectiveBloomEffectDesc or SelectiveOutlineEffectDesc.

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    effectIds: ["bloom", "outline"]
  }
}
```

### emissiveColor

**Type:** `Color | undefined`

**Description:** Specifies the emissive color as a `Color` instance.

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polyline: {
    emissiveColor: new Color().setHex(0xff0000)
  }
}
```

### emissiveIntensity

**Type:** `number | undefined`

**Description:** Specifies the emissive intensity.

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    emissiveIntensity: 0.5
  }
}
```

### geometryTypes

**Type:** `("line" | "polygon")[] | undefined`

**Description:** Source geometry categories this material consumes. When set to include `"polygon"`, polygon boundary rings (the outer ring and any holes) render as closed polylines at the ring's base height. Extruded side edges are not included, so use the polygon material's [`outline`](../polygon-material/#outline) for extruded polygons. Setting the array replaces the default, so include `"line"` when line geometry should keep rendering. This option applies when the layer's geometry is built: set it at layer creation. `layer.update()` applies a new value only to tiles loaded afterwards, so already-loaded tiles keep their previous geometry until the layer is re-created.

**Default:** `["line"]`

**Example:**

```typescript
{
  polyline: {
    geometryTypes: ["line", "polygon"]
  }
}
```

### height

**Type:** `number | undefined`

**Description:** Specifies the height of the polyline. The unit is meters.

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    height: 1
  }
}
```

### lit

**Type:** `boolean | undefined`

**Description:** Applies the lighting equation to the color output. When `false`, the polyline renders as plain albedo. The rest of the lit pipeline still runs, so normals and the shadow G-buffer keep being written. Leaving it unset follows the scene default, [`view.lit`](../../../three/api/threeview-properties/#lit). Setting it explicitly overrides that default in either direction.

**Default:** `undefined` (follows `view.lit`)

**Example:**

```typescript
{
  polyline: {
    lit: false // Plain albedo output, e.g. for a deferred lighting pass
  }
}
```

### maxWidth

**Type:** `number | undefined`

**Description:** Maximum line width in pixels, clamping the rendered width regardless of zoom level. Smaller values are cheaper to render as they reduce fragment shader overdraw.

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    maxWidth: 10
  }
}
```

### receiveShadow

**Type:** `boolean | undefined`

**Description:** Specifies whether the polyline receives shadows.

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    receiveShadow: true
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** Specifies whether to show the polyline.

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    show: true
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** Enables transparency and alpha blending. This allows the polyline to be rendered with opacity.

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    transparent: true
  }
}
```

:::note
Enabling `transparent` might cause unexpected behavior when using selective effects.
:::

### tiled

**Type:** `boolean | undefined`

**Description:** Splits the polyline into XYZ vector tiles for rendering, even when the data source is not an MVT layer. This can improve performance for large polylines. Enabling `clampToGround` implicitly forces `tiled` to `true`.

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    tiled: true
  }
}
```

### width

**Type:** `number`

**Description:** Specifies the width of the polyline. The unit is pixels.

**Default:** Required

**Example:**

```typescript
{
  polyline: {
    width: 3
  }
}
```
