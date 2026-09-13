---
title: PolygonMaterial
description: Polygon material for navara_three
sidebar:
  order: 540
---

`PolygonMaterial` represents a material for polygon geometry rendering.

## Properties

### applyWaterNormal

**Type:** `boolean | undefined`

**Description:** Specifies whether to apply a water normal map.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    applyWaterNormal: false
  }
}
```

### castShadow

**Type:** `boolean | undefined`

**Description:** Specifies whether the polygon casts shadows.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    castShadow: true
  }
}
```

### clampToGround

**Type:** `boolean | undefined`

**Description:** Specifies whether to clamp to the ground.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    clampToGround: true
  }
}
```

### color

**Type:** `Color`

**Description:** Specifies the polygon color as a `Color` instance.

**Default:** Required

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polygon: {
    color: new Color().setHex(0x00cc66)
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
  polygon: {
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
  polygon: {
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
  polygon: {
    emissiveIntensity: 0.5
  }
}
```

### extrudedHeight

**Type:** `number | undefined`

**Description:** Specifies the extrusion height. This works when `clampToGround` is false.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    extrudedHeight: 50 // 50 meters extrusion
  }
}
```

### height

**Type:** `number | undefined`

**Description:** Specifies the height. This works when `clampToGround` is false. The unit is meters.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    height: 10 // 10 meters height
  }
}
```

### ior

**Type:** `number | undefined`

**Description:** Specifies the Index of Refraction. Affects the refraction of light passing through the material.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    ior: 1.5 // Index of refraction for glass
  }
}
```

### lit

**Type:** `boolean | undefined`

**Description:** Applies the lighting equation to the color output. When `false`, the polygon renders as plain albedo. The rest of the lit pipeline still runs, so normals and the shadow G-buffer keep being written. Leaving it unset follows the scene default, [`view.lit`](../../../three/api/threeview-properties/#lit). Setting it explicitly overrides that default in either direction.

**Default:** `undefined` (follows `view.lit`)

**Example:**

```typescript
{
  polygon: {
    lit: false // Plain albedo output, e.g. for a deferred lighting pass
  }
}
```

### opacity

**Type:** `number | undefined`

**Description:** Specifies the opacity of the polygon. Specified in the range of 0.0 (fully transparent) to 1.0 (fully opaque). Requires `transparent` to be enabled.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    opacity: 0.5
  }
}
```

### outline

**Type:** `boolean | undefined`

**Description:** Whether to compute outline geometry. Only effective at initial load time. When not set, inferred from `outlineShow`.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    outline: true
  }
}
```

### outlineColor

**Type:** `Color | undefined`

**Description:** Specifies the outline color as a `Color` instance. Currently, this property is only supported for GeoJSON.

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polygon: {
    outlineColor: new Color().setHex(0xff00ff)
  }
}
```

### outlineShow

**Type:** `boolean | undefined`

**Description:** Specifies whether to show the outline. Currently, this property is only supported for GeoJSON.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    outlineShow: false
  }
}
```

### outlineWidth

**Type:** `number | undefined`

**Description:** Specifies the outline width. Currently, this property is only supported for GeoJSON. The unit is pixels.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    outlineWidth: 2
  }
}
```

### perPositionHeight

**Type:** `boolean | undefined`

**Description:** Specifies whether to obtain height from the data. When false, the height is a constant value.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    perPositionHeight: true
  }
}
```

### receiveShadow

**Type:** `boolean | undefined`

**Description:** Specifies whether the polygon receives shadows.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    receiveShadow: true
  }
}
```

### reflectivity

**Type:** `number | undefined`

**Description:** Specifies the reflectivity for post-processing or environment maps.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    reflectivity: 0.5
  }
}
```

### roughness

**Type:** `number | undefined`

**Description:** Specifies the roughness for post-processing. Specified in the range of 0.0 to 1.0.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    roughness: 0.2
  }
}
```

### shininess

**Type:** `number | undefined`

**Description:** Specifies the shininess of the material.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    shininess: 100
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** Specifies whether to show the polygon.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    show: true
  }
}
```

### specular

**Type:** `boolean | undefined`

**Description:** Specifies whether to enable the specular effect. When enabled, the `shininess` and `specularStrength` values are used.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    specular: true
  }
}
```

### specularStrength

**Type:** `number | undefined`

**Description:** Specifies the intensity of specular highlights.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    specularStrength: 2
  }
}
```

### surfaceShow

**Type:** `boolean | undefined`

**Description:** Specifies whether to show the polygon surface. Currently, this property is only supported for GeoJSON. This is effective when `outlineShow` is `true`.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    surfaceShow: true
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** Specifies whether to enable transparency. Must be set to `true` to use `opacity`. May cause unexpected behavior when using effects.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    transparent: true
  }
}
```

### tiled

**Type:** `boolean | undefined`

**Description:** Splits the polygon into XYZ vector tiles for rendering, even when the data source is not an MVT layer. This can improve performance for large polygons. Enabling `clampToGround` implicitly forces `tiled` to `true`. Outline rendering is not supported when `tiled` is enabled.

**Default:** `false`

**Example:**

```typescript
{
  polygon: {
    tiled: true
  }
}
```

### water

**Type:** `boolean | undefined`

**Description:** Specifies whether to apply a water surface material to the polygon. May slow down mesh loading.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    water: true
  }
}
```

### waterScaleNormal

**Type:** `number | undefined`

**Description:** Specifies the scale of the water surface normals. Smaller values make the water surface rougher.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    waterScaleNormal: 2.0
  }
}
```

### waterSpeed

**Type:** `number | undefined`

**Description:** Specifies the speed of water waves.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    waterSpeed: 0.003
  }
}
```

### wireframe

**Type:** `boolean | undefined`

**Description:** Specifies whether to display as wireframe.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    wireframe: false
  }
}
```
