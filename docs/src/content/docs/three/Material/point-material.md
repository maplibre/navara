---
title: PointMaterial
description: Point material for navara_three
sidebar:
  order: 530
---

`PointMaterial` represents a material for point geometry rendering.

## Properties

### center

**Type:** `{ x: number, y: number }`

**Description:** Specifies the shift amount from the center. The range is between 0 and 1. The unit is a relative position to the point circle.

**Default:** Required

**Example:**

```typescript
{
  point: {
    center: { x: 0.5, y: 0.5 }
  }
}
```

### clampToGround

**Type:** `boolean`

**Description:** Specifies whether to clamp to the ground.

**Default:** Required

**Example:**

```typescript
{
  point: {
    clampToGround: true
  }
}
```

### color

**Type:** `Color`

**Description:** Specifies the point color as a `Color` instance.

**Default:** Required

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  point: {
    color: new Color().setHex(0xff0000)
  }
}
```

### declutter

**Type:** `boolean | undefined`

**Description:** Participate in screen-space decluttering: when labels/sprites overlap on screen, lower-priority ones are hidden. Enabled by default. Set to `false` to draw every label unconditionally.

**Default:** `true`

**Example:**

```typescript
{
  point: {
    declutter: false
  }
}
```

### declutterPriority

**Type:** `number | undefined`

**Description:** Placement priority for decluttering. Higher wins. Only meaningful when [`declutter`](#declutter) is enabled. Can be overridden per feature via [`FeatureEvaluator.evaluate()`](../../api/feature-evaluator/#evaluate).

**Default:** `0.0`

**Example:**

```typescript
{
  point: {
    declutter: true,
    declutterPriority: 1
  }
}
```

### depthTest

**Type:** `boolean | undefined`

**Description:** A variable that determines whether front-facing models occlude back-facing models.

**Default:** `true`

**Example:**

```typescript
{
  point: {
    depthTest: true
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
  point: {
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
  point: {
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
  point: {
    emissiveIntensity: 0.5
  }
}
```

### geometryTypes

**Type:** `("point" | "line" | "polygon")[] | undefined`

**Description:** Source geometry categories this material consumes. Adding `"line"` emits one point per line-string vertex, and adding `"polygon"` emits one point per polygon-ring vertex (the closing duplicate vertex is skipped). Setting the array replaces the default, so include `"point"` when point geometry should keep rendering. This option applies when the layer's geometry is built: set it at layer creation. `layer.update()` applies a new value only to tiles loaded afterwards, so already-loaded tiles keep their previous geometry until the layer is re-created.

**Default:** `["point"]`

**Example:**

```typescript
{
  point: {
    geometryTypes: ["point", "polygon"]
  }
}
```

### height

**Type:** `number`

**Description:** Specifies the height. The unit is meters.

**Default:** Required

**Example:**

```typescript
{
  point: {
    height: 100 // 100 meters
  }
}
```

### offsetDepth

**Type:** `boolean | undefined`

**Description:** Avoids overlap with the earth's surface. Use this to prevent the point from clipping into the earth's surface.

**Default:** `undefined`

**Example:**

```typescript
{
  point: {
    offsetDepth: true
  }
}
```

### opacity

**Type:** `number | undefined`

**Description:** Specifies the opacity of the point. Valid range is 0.0 (fully transparent) to 1.0 (fully opaque).

**Default:** `1.0`

**Example:**

```typescript
{
  point: {
    transparent: true,
    opacity: 0.5 // 50% opacity
  }
}
```

### sizeInMeters

**Type:** `boolean | undefined`

**Description:** Whether the size is specified in meters. If false, the size is in pixels.

**Default:** `true`

**Example:**

```typescript
{
  point: {
    sizeInMeters: true
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** Specifies whether to show the point.

**Default:** `undefined`

**Example:**

```typescript
{
  point: {
    show: true
  }
}
```

### size

**Type:** `number`

**Description:** Specifies the size of the point. The unit is meters.

**Default:** Required

**Example:**

```typescript
{
  point: {
    size: 10 // 10 meters
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** Specifies whether to consider the point's transparency. Note that setting this to true may cause the point to not display correctly when effects are enabled.

**Default:** `undefined`

**Example:**

```typescript
{
  point: {
    transparent: false
  }
}
```
