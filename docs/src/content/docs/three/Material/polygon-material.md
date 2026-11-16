---
title: PolygonMaterial
description: Polygon material for navara_three
sidebar:
  order: 540
---

`PolygonMaterial` represents a material for polygon geometry rendering.

## Properties

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

### depthPrePass

**Type:** `boolean | undefined`

**Description:** Writes the polygon's depth before any transparent mesh is drawn, so a `transparent` polygon blends only its nearest surface. Without it, faces behind that surface show through and add up, which darkens overlaps such as the sides of extruded polygons. Faces at the same depth, such as a feature that neighboring tiles both contain, are blended once. The written depth also hides any other transparent mesh behind the polygon, so a translucent layer or particle drawn behind it does not show through. Effective when `transparent` is `true` and `clampToGround` is `false`.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    transparent: true,
    opacity: 0.8,
    depthPrePass: true
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

### geodesic :since[0.3.2]

**Type:** `boolean | undefined`

**Description:** Specifies whether edges drawn through the tiled path (`clampToGround` or `tiled`) of a GeoJSON source follow the geodesic. When `true`, two consecutive vertices more than 180° apart in longitude are also joined the short way, across the antimeridian; a closed ring that would then no longer close, such as one around a pole, is kept as given. When `false`, edges are straight lines in Web Mercator and longitudes are used as given, so a longitude of 190° lies east of 180°, as in MapLibre. Edges outside the tiled path and edges from vector tile sources are not affected.

The option applies to the whole layer: its tiled `polygon` and `polyline` share one geometry, which follows the geodesic unless both set `geodesic: false`. It is read when the layer's tiles are first built, so changing it on an existing layer has no effect.

**Default:** `true`

**Example:**

```typescript
{
  polygon: {
    clampToGround: true,
    geodesic: false
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

**Description:** Specifies the index of refraction of the `specular` highlight's Fresnel term. Has no effect on water.

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

**Description:** Whether to compute outline geometry even while `outlineShow` is `false`, so an update can show it later. Showing the outline always computes it. Read when geometry is built: tiles already loaded keep what they have.

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

**Description:** Specifies the reflectance at normal incidence (F0) that SSR and the aerial perspective's `specular` term read. Water uses `0.02` regardless. Values below `0.01` disable both. It also weights the environment map when one is set.

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

**Description:** Specifies the roughness for post-processing such as SSR and the aerial perspective's specular term. Specified in the range of 0.0 to 1.0, where 0.0 is a mirror.

**Default:** `0.44`

**Example:**

```typescript
{
  polygon: {
    roughness: 0.2
  }
}
```

### shadeSidesAsSurface

**Type:** `boolean | undefined`

**Description:** Shades the sides of an extruded polygon with the surface's upward normal instead of their own, so they light the same as the top. Use it when the extrusion stands for a continuous surface rather than a solid, for example per-cell water levels whose sides fill the steps between neighboring cells. Effective when `clampToGround` is `false`.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    extrudedHeight: 2,
    shadeSidesAsSurface: true
  }
}
```

### shininess

**Type:** `number | undefined`

**Description:** Specifies the shininess of the `specular` highlight. Has no effect on water.

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

**Description:** Specifies whether to enable the specular effect. When enabled, the `shininess` and `specularStrength` values are used. Has no effect on water.

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

**Description:** Specifies the intensity of the `specular` highlight. Has no effect on water.

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

**Description:** Specifies whether to render the polygon as a water surface. Its waves follow [`waveStrength`](#wavestrength) and [`waveDirection`](#wavedirection). They keep their size in meters and are visible up close, and from about 2 km away the surface reads as one uniformly rough plane under the sun's glitter. The surface reflects the sky with a Fresnel term and the sun with its own highlight, so `reflectivity`, `roughness`, `shininess`, `specularStrength`, `specular`, and `ior` have no effect on it. Waves move only while frames render, for example with `ThreeView.animation` on.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    water: true
  }
}
```

### waveExaggeration

**Type:** `number | undefined`

**Description:** Scales the slopes of the water's waves, keeping their size and speed. `0` makes a still, mirror-like surface. Only used when `water` is enabled.

**Default:** `1`

**Example:**

```typescript
{
  polygon: {
    water: true,
    waveExaggeration: 0.5
  }
}
```

### waterScale

**Type:** `"ocean" | "large" | "medium" | "small" | undefined`

**Description:** Extent of the water body. Waves grow with the open distance across the water, so a smaller body gets shorter, finer waves at the same `waveStrength`. `"ocean"` grows the waves as far as `waveStrength` allows. `"large"` assumes about 20 km of open water, such as a bay or a large lake. `"medium"` assumes about 2 km, such as a lake or a wide river. `"small"` assumes about 200 m, such as a river or a pond. The slope of the waves still follows `waveStrength`. Only used when `water` is enabled.

**Default:** `"ocean"`

**Example:**

```typescript
{
  polygon: {
    water: true,
    waterScale: "small"
  }
}
```

### waveStrength

**Type:** `number | undefined`

**Description:** Sets the size, steepness, and speed of the waves. About `1` is a calm ripple, `5` is moderate, and `20` is a storm. To change only their height, use [`waveExaggeration`](#waveexaggeration). Only used when `water` is enabled.

**Default:** `5`

**Example:**

```typescript
{
  polygon: {
    water: true,
    waveStrength: 12
  }
}
```

### waveDirection

**Type:** `number | undefined`

**Description:** The direction the waves travel, in degrees clockwise from north. Only used when `water` is enabled.

**Default:** `0`

**Example:**

```typescript
{
  polygon: {
    water: true,
    waveDirection: 225
  }
}
```

### flowSpeed

**Type:** `number | undefined`

**Description:** The speed in m/s of a current that carries the waves along [`waveDirection`](#wavedirection), without changing their size or slope. The whole surface moves as one. Only used when `water` is enabled.

**Default:** `0`

**Example:**

```typescript
{
  polygon: {
    water: true,
    waveDirection: 90,
    flowSpeed: 2
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
