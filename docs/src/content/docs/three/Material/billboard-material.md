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

### backfaceCulling

**Type:** `boolean | undefined`

**Description:** Whether the billboard is hidden when seen from behind. When `false`, both sides of the billboard are drawn. When `true`, only its front is drawn.

It has no effect on an upright billboard that follows the camera (the default), which always shows its front. It matters in two cases. With [`rotateWithCamera`](#rotatewithcamera) set to `false`, the billboard can be seen from behind, where it appears mirrored, and turning this on hides it instead. With [`billboardFacing`](#billboardfacing) set to `"flat"`, its front faces away from the globe, so turning this on also hides the parts of a large billboard that wrap over the horizon.

**Default:** `false`

**Example:**

```typescript
{
  billboard: {
    billboardFacing: "flat",
    backfaceCulling: true
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

**Description:** Source geometry categories this material consumes. Adding `"line"` emits one billboard per line-string vertex by default. Set [`placement`](#placement) to repeat billboards along the line instead. Adding `"polygon"` emits one billboard per polygon-ring vertex (the closing duplicate vertex is skipped). Setting the array replaces the default, so include `"point"` when point geometry should keep rendering. This option applies when the layer's geometry is built: set it at layer creation. `layer.update()` applies a new value only to tiles loaded afterwards, so already-loaded tiles keep their previous geometry until the layer is re-created.

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

### placement

**Type:** `"point" | "line" | "line-center" | undefined`

**Description:** How billboards are placed on line geometry. Only takes effect when [`geometryTypes`](#geometrytypes) includes `"line"`. Point geometry is always placed at the point itself, and polygon rings always get one billboard per vertex.

- `"point"`: one billboard per line-string vertex.
- `"line"`: billboards repeat along the line every [`spacing`](#spacing), evenly spaced regardless of where the line's vertices are.
- `"line-center"`: a single billboard at the halfway point along each line string.

With `"line"` and `"line-center"`, each billboard is also turned to the direction of the line where it sits (see [`rotateToLine`](#rotatetoline)).

This option applies when the layer's geometry is built: set it at layer creation. `layer.update()` does not rebuild billboards that are already loaded, so remove the layer and add it again to change it.

**Default:** `"point"`

**Example:**

```typescript
{
  billboard: {
    url: "/icons/arrow.png",
    geometryTypes: ["line"],
    placement: "line",
    spacing: 120, // Screen pixels
    billboardFacing: "flat",
    rotateWithCamera: false, // Arrows lie on the surface and point along the line
    clampToGround: true
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

### billboardFacing

**Type:** `"upright" | "flat" | undefined`

**Description:** Whether the billboard stands up or lies on the globe surface. `"upright"` keeps it standing. `"flat"` lays it on the globe surface around its anchor, following the globe's curvature, so it reads as painted onto the surface and foreshortens with camera pitch.

Combine with [`rotateWithCamera`](#rotatewithcamera) for four behaviours:

| `billboardFacing` | `rotateWithCamera` | Result |
| --- | --- | --- |
| `"upright"` | `true` | Screen-aligned billboard, never foreshortened (the default) |
| `"upright"` | `false` | Standing on the surface at a fixed bearing |
| `"flat"` | `true` | Painted on the surface, turned to keep facing the viewer |
| `"flat"` | `false` | Painted on the surface, north-up, turning with the map |

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/) as `facing`.

**Default:** `"upright"`

**Example:**

```typescript
{
  billboard: {
    billboardFacing: "flat"
  }
}
```

### rotateToLine

**Type:** `boolean | undefined`

**Description:** Whether a billboard placed along a line turns with the line. When `true`, the direction of the line at the billboard's anchor, as a compass bearing, is added to [`rotation`](#rotation). Only used when [`placement`](#placement) is `"line"` or `"line-center"`.

The added bearing reads as a direction on the map when the billboard is fixed to the surface, so combine it with `billboardFacing: "flat"` and `rotateWithCamera: false`. The top of the image then points along the line, and `rotation` turns it further from there. On a billboard that follows the camera, the bearing only spins the image on screen.

This option applies when the layer's geometry is built. `layer.update()` does not change it for billboards that are already loaded, so remove the layer and add it again to change it.

**Default:** `true`

**Example:**

```typescript
{
  billboard: {
    geometryTypes: ["line"],
    placement: "line",
    billboardFacing: "flat",
    rotateWithCamera: false,
    rotateToLine: true,
    rotation: 90 // Point to the right of the line's direction
  }
}
```

### rotateWithCamera

**Type:** `boolean | undefined`

**Description:** Whether the billboard turns to follow the camera. When `true`, it always faces the viewer. When `false`, it is fixed in its anchor's local east/north/up frame, and moving the camera never reorients it. With `"upright"`, it stands on the surface facing south, so it is seen edge-on from directly above and mirrored from behind.

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/).

**Default:** `true`

**Example:**

```typescript
{
  billboard: {
    billboardFacing: "upright",
    rotateWithCamera: false
  }
}
```

### rotation

**Type:** `number | undefined`

**Description:** Rotates the billboard within its own plane around its anchor point, in degrees, clockwise as seen from the front. The rotation is applied on top of the orientation that [`billboardFacing`](#billboardfacing) and [`rotateWithCamera`](#rotatewithcamera) resolve to.

[`center`](#center) decides where inside the billboard the pivot sits.

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/), so every billboard in a layer can point a different way.

**Default:** `0.0`

**Example:**

```typescript
{
  billboard: {
    rotation: 45
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

### spacing

**Type:** `number | undefined`

**Description:** The distance between repeated billboards when [`placement`](#placement) is `"line"`, in screen pixels. The unit is the same on `geojson` and `vector-tile` sources.

The billboards shown on a line are decided again as the camera moves. Pulling the camera back thins them out, and moving closer fills in more billboards between them. Billboards never slide along the line: they only appear or disappear. The gap on screen stays between one and two times `spacing`, also in a tilted view, where the near and far parts of the view each get their own density.

A line always keeps the billboard at its halfway point, and a line shorter than `spacing` on screen gets only that one. Billboards stop filling in very close to the ground (street level) on a GeoJSON source, and when a vector tile is shown much deeper than its own zoom level (overscaled). There they sit farther apart than `spacing`.

As with MapLibre's `symbol-spacing`, a billboard longer along the line than three quarters of `spacing` spreads its repeats to that length plus a quarter of `spacing`. The length is measured in the billboard's own frame: with `rotateToLine` the top of the image points along the line, so its height is what counts, and `rotation` turns it from there. On a vector tile source, each tile places billboards only inside its own bounds. Each tile spaces its own billboards, so repeats end up at most about one tile apart (512 to 1024 screen pixels) however large `spacing` is.

This option applies when the layer's geometry is built. `layer.update()` does not rebuild billboards that are already loaded, so remove the layer and add it again to change it.

**Default:** `250.0`

**Example:**

```typescript
{
  billboard: {
    geometryTypes: ["line"],
    placement: "line",
    spacing: 120
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
