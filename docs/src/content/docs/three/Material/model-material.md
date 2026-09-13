---
title: ModelMaterial
description: Model material for navara_three
sidebar:
  order: 520
---

`ModelMaterial` holds the render options for a [`3d-tiles`](../../../three/layer/3d-tiles-layer/) layer's models. It is set via the `model` key. The dataset URL and other fetch config live on the referenced [`3d-tiles`](../../../three/source/3d-tiles-source/) source, not here.

## Properties

### animationActiveClip

**Type:** `string | undefined`

**Description:** Specifies an animation registered in the GLTF.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    animationActiveClip: "Walk"
  }
}
```

:::tip[Full Animation Control]
For advanced animation features such as `animationAutoPlay`, `animationClips`, `animationCrossfadeDuration`, `animationEnabled`, and `animationLoop`, use [GLTFModelDesc](../../../three_default_descs/mesh-desc/gltf-model-desc/) which provides full animation control as a mesh Descriptor.
:::

### animationSpeed

**Type:** `number | undefined`

**Description:** Specifies the animation playback speed. 1.0 is normal speed.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    animationSpeed: 1.0
  }
}
```

### applyWaterNormal

**Type:** `boolean | undefined`

**Description:** Specifies whether to apply a water normal map.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    applyWaterNormal: true
  }
}
```

### castShadow

**Type:** `boolean | undefined`

**Description:** Specifies whether the model casts shadows. This works when shadows are enabled on the View and castShadow is enabled on the sunlight.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    castShadow: true
  }
}
```

### color

**Type:** `Color | undefined`

**Description:** Specifies the model color as a `Color` instance.

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  model: {
    color: new Color().setHex(0xffffff)
  }
}
```

### creaseNormalAngle

**Type:** `number | undefined`

**Description:** Specifies the crease angle (in radians) used when [`normals`](#normals) is enabled. Edges whose shared face angle exceeds this threshold are kept as creased (hard) edges. Smaller angles are smoothed.

**Default:** `Math.PI / 6` (30°, applied when `normals` is enabled and this property is omitted)

**Example:**

```typescript
{
  model: {
    normals: true,
    creaseNormalAngle: Math.PI / 3, // 60°
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
  model: {
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
  model: {
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
  model: {
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
  model: {
    emissiveIntensity: 0.5
  }
}
```

### height

**Type:** `number | undefined`

**Description:** Specifies the height of the model. The unit is meters.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    height: 50 // 50 meters
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
  model: {
    ior: 1.5 // Index of refraction for glass
  }
}
```

### lit

**Type:** `boolean | undefined`

**Description:** Applies the lighting equation to the color output. When `false`, the model renders as plain albedo. The rest of the lit pipeline still runs, so normals and the shadow G-buffer keep being written. Leaving it unset follows the scene default, [`view.lit`](../../../three/api/threeview-properties/#lit). Setting it explicitly overrides that default in either direction.

**Default:** `undefined` (follows `view.lit`)

**Example:**

```typescript
{
  model: {
    lit: false // Plain albedo output, e.g. for a deferred lighting pass
  }
}
```

### maxSse

**Type:** `number | undefined`

**Description:** The maximum value used to determine the level of detail (LOD). Higher values improve performance but reduce visual quality.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    maxSse: 8
  }
}
```

### metalness

**Type:** `number | undefined`

**Description:** Specifies the metalness of the material. Specified in the range of 0.0 to 1.0.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    metalness: 0.1
  }
}
```

### normals

**Type:** `boolean | undefined`

**Description:** When enabled, vertex normals are recomputed using a creased-normals algorithm after the model loads. This is useful for tiled glTF assets that ship without normals or with low-quality normals (for example, photogrammetry tilesets), so that lighting and the aerial perspective effect can shade them correctly. The crease angle is configured by [`creaseNormalAngle`](#creasenormalangle).

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    normals: true,
  }
}
```

### opacity

**Type:** `number | undefined`

**Description:** Specifies the opacity of the model. Valid range is 0.0 (fully transparent) to 1.0 (fully opaque). This property controls the alpha value when the material is rendered with transparency enabled.

**Default:** `1.0`

**Example:**

```typescript
{
  model: {
    transparent: true,
    opacity: 0.5 // 50% opacity
  }
}
```

### pointSize

**Type:** `number | undefined`

**Description:** Specifies the point size when rendering as a point cloud.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    pointSize: 2.0
  }
}
```

### receiveShadow

**Type:** `boolean | undefined`

**Description:** Specifies whether the model receives shadows.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
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
  model: {
    reflectivity: 0.8
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
  model: {
    roughness: 0.1
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
  model: {
    shininess: 30
  }
}
```

### shouldRotateInDefault

**Type:** `boolean | undefined`

**Description:** A property that automatically adjusts the model's orientation for correct placement on the ellipsoid.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    shouldRotateInDefault: true
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** Specifies whether to show the model.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    show: true
  }
}
```

### showBoundingBox

**Type:** `boolean | undefined`

**Description:** Specifies whether to show the bounding box. Used for debugging purposes.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    showBoundingBox: true
  }
}
```

### size

**Type:** `number | undefined`

**Description:** Specifies the size of the model.

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    size: 1.5 // 1.5x size
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
  model: {
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
  model: {
    specularStrength: 0.5
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** Enables transparency and alpha blending. When enabled, the material can be rendered with transparency based on the model's alpha channel.

**Default:** `false`

**Example:**

```typescript
{
  model: {
    transparent: true
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
  model: {
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
  model: {
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
  model: {
    waterSpeed: 0.003
  }
}
```
