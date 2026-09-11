---
title: BillboardMaterial
description: Billboard material for navara_three
sidebar:
  order: 510
---

`BillboardMaterial` represents a material for billboard rendering.

## Properties

### alphaTest

**Type:** `number | undefined`

**Description:** Pixels with an RGBA alpha value below this threshold will not be rendered.

**Default:** `undefined`

**Example:**

```typescript
{
  billboard: {
    alphaTest: 0.5
  }
}
```

### center

**Type:** [`Vec2`](../../api/types/#vec2)

**Description:** Specifies the shift amount from the center. The range is between 0 and 1.

**Default:** Required

**Example:**

```typescript
{
  billboard: {
    center: { x: 0.5, y: 0.5 }
  }
}
```

### clampToGround

**Type:** `boolean`

**Description:** Specifies whether to clamp the billboard to the ground.

**Default:** Required

**Example:**

```typescript
{
  billboard: {
    clampToGround: true
  }
}
```

### color

**Type:** `Color`

**Description:** Specifies the billboard color as a `Color` instance.

**Default:** Required

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  billboard: {
    color: new Color().setHex(0xffffff)
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
  billboard: {
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
  billboard: {
    declutter: true,
    declutterPriority: 1
  }
}
```

### depthTest

**Type:** `boolean`

**Description:** A variable that determines whether front-facing models occlude back-facing models.

**Default:** `true`

**Example:**

```typescript
{
  billboard: {
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
  billboard: {
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
  billboard: {
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
  billboard: {
    emissiveIntensity: 0.5
  }
}
```

### geometryTypes

**Type:** `("point" | "line" | "polygon")[] | undefined`

**Description:** Source geometry categories this material consumes. Adding `"line"` emits one billboard per line-string vertex, and adding `"polygon"` emits one billboard per polygon-ring vertex (the closing duplicate vertex is skipped). Setting the array replaces the default, so include `"point"` when point geometry should keep rendering. This option applies when the layer's geometry is built: set it at layer creation. `layer.update()` applies a new value only to tiles loaded afterwards, so already-loaded tiles keep their previous geometry until the layer is re-created.

**Default:** `["point"]`

**Example:**

```typescript
{
  billboard: {
    geometryTypes: ["point", "line"]
  }
}
```

### height

**Type:** `number`

**Description:** Specifies the height of the billboard. The unit is meters.

**Default:** Required

**Example:**

```typescript
{
  billboard: {
    height: 100 // 100 meters
  }
}
```

### offsetDepth

**Type:** `boolean | undefined`

**Description:** Avoids overlap with the earth's surface. Use this to prevent the billboard from clipping into the earth's surface.

**Default:** `undefined`

**Example:**

```typescript
{
  billboard: {
    offsetDepth: true
  }
}
```

### opacity

**Type:** `number | undefined`

**Description:** Specifies the opacity of the billboard. Valid range is 0.0 (fully transparent) to 1.0 (fully opaque).

**Default:** `1.0`

**Example:**

```typescript
{
  billboard: {
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
  billboard: {
    sizeInMeters: true
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** Specifies whether to show the billboard.

**Default:** `undefined`

**Example:**

```typescript
{
  billboard: {
    show: true
  }
}
```

### size

**Type:** `number`

**Description:** Specifies the size of the billboard. The unit is meters.

**Default:** Required

**Example:**

```typescript
{
  billboard: {
    size: 10 // 10 meters
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** Specifies whether to consider the billboard's transparency. Note that setting this to true may cause the billboard to not display correctly when effects are enabled.

**Default:** `undefined`

**Example:**

```typescript
{
  billboard: {
    transparent: false
  }
}
```

### url

**Type:** `string | undefined`

**Description:** Specifies the URL of the object. Supports image files. This is the default image for every feature in the layer. Individual features can override it by returning `image` from [`FeatureEvaluator.evaluate()`](../../api/feature-evaluator/#evaluate), and returning `image: null` reverts an overridden feature to this default.

**Default:** `undefined`

**Example:**

```typescript
{
  billboard: {
    url: "https://example.com/icons/marker.png"
  }
}
```

:::note
Omit `url` when every image comes from [`FeatureEvaluator`](../../api/feature-evaluator/). Features then stay invisible until an `image` is set for them, and `image: null` hides a feature again instead of reverting it to a default.
:::
