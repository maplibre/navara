---
title: PointMaterial
description: Point material for navara_three
sidebar:
  order: 530
---

`PointMaterial` represents a material for point geometry rendering.

## Properties

### backfaceCulling

**Type:** `boolean | undefined`

**Description:** Whether the point is hidden when seen from behind. When `false`, both sides of the point are drawn. When `true`, only its front is drawn.

Only a flat point (see [`pointFacing`](#pointfacing)) has a back the camera can see. Its front faces away from the globe, so turning this on hides the parts of a large point that wrap over the horizon. It has no effect on an upright point, which always lies in the screen plane facing the viewer.

**Default:** `false`

**Example:**

```typescript
{
  point: {
    pointFacing: "flat",
    backfaceCulling: true
  }
}
```

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

### declutterRank

**Type:** `number | undefined`

**Description:** Coarse placement order for decluttering, compared before [`declutterPriority`](#declutterpriority): every point of a material with a higher rank is placed before any label or sprite with a lower one, whatever their priorities. A per-feature `declutterPriority` therefore only reorders labels and sprites of the same rank. Only meaningful when [`declutter`](#declutter) is enabled.

**Default:** `0.0`

**Example:**

```typescript
{
  point: {
    declutterRank: 1
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

**Description:** Source geometry categories this material consumes. Adding `"line"` emits one point per line-string vertex by default. Set [`placement`](#placement) to repeat points along the line instead. Adding `"polygon"` emits one point per polygon-ring vertex (the closing duplicate vertex is skipped), or points along the rings with [`placement`](#placement). Setting the array replaces the default, so include `"point"` when point geometry should keep rendering. This option applies when the layer's geometry is built: set it at layer creation. `layer.update()` applies a new value only to tiles loaded afterwards, so already-loaded tiles keep their previous geometry until the layer is re-created.

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

### ignorePlacement

**Type:** `boolean | undefined`

**Description:** Keeps this point's box out of the collision check, so labels and sprites placed after it can overlap it. The point itself still hides when it collides with one placed before it, unless [`overlap`](#overlap) allows it. Only meaningful when [`declutter`](#declutter) is enabled.

**Default:** `false`

**Example:**

```typescript
{
  point: {
    ignorePlacement: true
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

### overlap

**Type:** `"never" | "always" | "cooperative" | undefined`

**Description:** Whether the point may be drawn over labels and sprites placed before it (higher [`declutterRank`](#declutterrank), then higher [`declutterPriority`](#declutterpriority), places first). `"never"` hides it on any collision. `"always"` never hides it, and its box still keeps later `"never"` ones away unless [`ignorePlacement`](#ignoreplacement) is set. `"cooperative"` hides it only when it collides with a `"never"` one. Only meaningful when [`declutter`](#declutter) is enabled.

**Default:** `"never"`

**Example:**

```typescript
{
  point: {
    overlap: "always"
  }
}
```

### placement

**Type:** `"point" | "line" | "line-center" | undefined`

**Description:** How points are placed on line and polygon geometry. Only takes effect when [`geometryTypes`](#geometrytypes) includes `"line"` or `"polygon"`. Point geometry is always placed at the point itself.

- `"point"`: one point per line-string vertex and per polygon-ring vertex.
- `"line"`: points repeat along the line every [`spacing`](#spacing), evenly spaced regardless of where the line's vertices are. Polygon boundary rings, holes included, are followed the same way.
- `"line-center"`: a single point at the halfway point along each line string or polygon ring.

With `"line"` and `"line-center"`, each point is also turned to the direction of the line where it sits (see [`rotateToLine`](#rotatetoline)). Unless [`pointFacing`](#pointfacing) or [`rotateWithCamera`](#rotatewithcamera) is set, it lies flat on the surface and is aligned with the map.

This option applies when the layer's geometry is built: set it at layer creation. `layer.update()` does not rebuild points that are already loaded, so remove the layer and add it again to change it.

**Default:** `"point"`

**Example:**

```typescript
{
  point: {
    geometryTypes: ["line"],
    placement: "line",
    spacing: 50, // Screen pixels
    size: 6,
    sizeInMeters: false,
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
  point: {
    sizeInMeters: true
  }
}
```

### pointFacing

**Type:** `"upright" | "flat" | undefined`

**Description:** Whether the point lies in the screen plane or on the globe surface, as MapLibre's `icon-pitch-alignment` (`"upright"` is `"viewport"`, `"flat"` is `"map"`). An upright point is never foreshortened, however the camera is pitched. `"flat"` lays it on the globe surface around its anchor, following the globe's curvature, so it reads as painted onto the surface and foreshortens with camera pitch.

Combine with [`rotateWithCamera`](#rotatewithcamera) for four behaviours:

| `pointFacing` | `rotateWithCamera` | Result |
| --- | --- | --- |
| `"upright"` | `true` | Screen-aligned billboard (the default for `placement: "point"`) |
| `"upright"` | `false` | In the screen plane, turned with the camera heading so the point's x-axis points east |
| `"flat"` | `true` | Painted on the surface, turned to keep facing the viewer |
| `"flat"` | `false` | Painted on the surface, north-up, turning with the map (the default along a line) |

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/) as `facing`.

**Default:** `"upright"`, or `"flat"` when `rotateWithCamera` is `false` (MapLibre's `"auto"`)

**Example:**

```typescript
{
  point: {
    pointFacing: "flat"
  }
}
```

### rotateToLine

**Type:** `boolean | undefined`

**Description:** Whether a point placed along a line turns with the line. When `true`, the direction of the line at the point's anchor, as a compass bearing, is added to [`rotation`](#rotation). Only used when [`placement`](#placement) is `"line"` or `"line-center"`.

The added bearing reads as a direction on the map when the point is aligned with the map ([`rotateWithCamera`](#rotatewithcamera) `false`, as it is by default along a line). Upright, the point stays in the screen plane and is turned by the camera heading plus the line's bearing. On a point that turns with the camera, the bearing only spins it on screen.

This option applies when the layer's geometry is built. `layer.update()` does not change it for points that are already loaded, so remove the layer and add it again to change it.

**Default:** `true`

**Example:**

```typescript
{
  point: {
    geometryTypes: ["line"],
    placement: "line",
    pointFacing: "flat",
    rotateWithCamera: false,
    rotateToLine: true
  }
}
```

### rotateWithCamera

**Type:** `boolean | undefined`

**Description:** Whether the point turns with the camera or with the map, as MapLibre's `icon-rotation-alignment` (`true` is `"viewport"`, `false` is `"map"`). When `true`, it stays upright on screen: a screen-aligned billboard, or with [`pointFacing`](#pointfacing) set to `"flat"`, a surface quad turned to keep facing the viewer. When `false`, it is aligned with the map. With `"upright"`, it stays in the screen plane at full size but turns with the camera heading so that its x-axis keeps pointing east, and it shows upside down when the camera faces south. With `"flat"`, it lies on the surface north-up and turns with the map.

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/).

**Default:** `true` for `placement: "point"`, `false` along a line (MapLibre's `"auto"`)

**Example:**

```typescript
{
  point: {
    pointFacing: "upright",
    rotateWithCamera: false // On screen, turned with the camera heading
  }
}
```

### rotation

**Type:** `number | undefined`

**Description:** Rotates the point within its own plane around its anchor point, in degrees, clockwise as seen from the front. The rotation is applied on top of the orientation that [`pointFacing`](#pointfacing) and [`rotateWithCamera`](#rotatewithcamera) resolve to.

[`center`](#center) decides where inside the point the pivot sits.

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/), so every point in a layer can point a different way.

**Default:** `0.0`

**Example:**

```typescript
{
  point: {
    rotation: 45
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

### spacing

**Type:** `number | undefined`

**Description:** The distance between repeated points when [`placement`](#placement) is `"line"`, in screen pixels. The unit is the same on `geojson` and `vector-tile` sources.

The points shown on a line are decided again as the camera moves. Pulling the camera back thins them out, and moving closer fills in more points between them. Points never slide along the line: they only appear or disappear. The gap on screen stays between one and two times `spacing`, also in a tilted view, where the near and far parts of the view each get their own density.

A line always keeps the point at its halfway point, and a line shorter than `spacing` on screen gets only that one. Points stop filling in very close to the ground (street level) on a GeoJSON source, and when a vector tile is shown much deeper than its own zoom level (overscaled). There they sit farther apart than `spacing`.

As with MapLibre's `symbol-spacing`, a point longer along the line than three quarters of `spacing` spreads its repeats to that length plus a quarter of `spacing`. The length is measured in the point's own frame: with `rotateToLine` its top points along the line, so its height is what counts, and `rotation` turns it from there. On a vector tile source, each tile places points only inside its own bounds. Each tile spaces its own points, so repeats end up at most about one tile apart (512 to 1024 screen pixels) however large `spacing` is.

This option applies when the layer's geometry is built. `layer.update()` does not rebuild points that are already loaded, so remove the layer and add it again to change it.

**Default:** `250.0`

**Example:**

```typescript
{
  point: {
    geometryTypes: ["line"],
    placement: "line",
    spacing: 100
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
