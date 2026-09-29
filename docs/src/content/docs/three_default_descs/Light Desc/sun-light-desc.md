---
title: SunLightDesc
description: Sun light descriptor for navara_three
sidebar:
  order: 154
---

The `SunLightDesc` class represents a directional light descriptor that simulates sunlight. It supports high-quality shadow rendering using Cascaded Shadow Maps (CSM) and works in conjunction with atmospheric scattering simulation to reproduce natural sunlight.

The sun direction is automatically calculated based on `view.atmosphere.date`, and shadow directions change accordingly.

:::tip[Related Documentation]
For details on the atmosphere system, see the [Atmosphere class](../../../three/api/atmosphere/).
:::

## Common Properties

### visible

**Type:** `boolean | undefined`

**Description:** Controls the visibility of the object.

**Default:** `true`

**Example:**

```typescript
{
  visible: false,
  sun: { ... }
}
```

## Properties

### sun

**Type:** `object | undefined`

**Description:** Configuration options for the sunlight.

#### distance

**Type:** `number | undefined`

**Description:** Specifies the distance of the sunlight from the target position. The unit is meters.

**Default:** `300`

:::note[Configurable only at initialization]
This property can only be set when creating the Descriptor. It cannot be changed via the `update()` method.
:::

**Example:**

```typescript
{
  sun: {
    distance: 300,
  }
}
```

#### color

**Type:** `Color | undefined`

**Description:** Specifies the sunlight color using a `Color` object. Used when `applyColor` is `true`.

**Default:** `new Color().setHex(0xffffff)`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  sun: {
    color: new Color().setHex(0xffffee),
  }
}
```

#### applyColor

**Type:** `boolean | undefined`

**Description:** Specifies whether to apply the color directly or use atmospheric scattering calculations. When `false`, the color is dynamically computed from the atmosphere texture.

**Default:** `false`

**Example:**

```typescript
{
  sun: {
    applyColor: false,
  }
}
```

#### intensity

**Type:** `number | undefined`

**Description:** Specifies the intensity of the sunlight. Higher values result in brighter light.

**Default:** `1`

**Example:**

```typescript
{
  sun: {
    intensity: 1.0,
  }
}
```

## Shadow Properties

### castShadow

**Type:** `boolean | undefined`

**Description:** Specifies whether to cast shadows using Cascaded Shadow Maps (CSM).

**Default:** `true`

**Example:**

```typescript
{
  sun: {
    castShadow: true,
  }
}
```

### shadowCascadeCount

**Type:** `number | undefined`

**Description:** Specifies the number of shadow cascades. More cascades improve shadow quality distribution but consume more GPU resources.

**Default:** `4`

**Example:**

```typescript
{
  sun: {
    shadowCascadeCount: 4,
  }
}
```

### shadowMapSize

**Type:** `number | undefined`

**Description:** Specifies the shadow map resolution (per cascade). Higher values improve shadow quality but consume more GPU memory.

**Default:** `2048`

**Example:**

```typescript
{
  sun: {
    shadowMapSize: 2048,
  }
}
```

### shadowFar

**Type:** `number | undefined`

**Description:** The maximum distance from the camera beyond which shadows are not rendered. The unit is meters.

**Default:** `50000`

**Example:**

```typescript
{
  sun: {
    shadowFar: 50000,
  }
}
```

### shadowMode

**Type:** `"uniform" | "logarithmic" | "practical" | undefined`

**Description:** Defines the splitting scheme for the camera frustum.

- `"uniform"`: Linear split distribution
- `"logarithmic"`: Logarithmic split distribution (suitable for large-scale scenes)
- `"practical"`: A hybrid approach that balances quality and performance (recommended)

**Default:** `"practical"`

**Example:**

```typescript
{
  sun: {
    shadowMode: "practical",
  }
}
```

### shadowLambda

**Type:** `number | undefined`

**Description:** The lambda parameter for the "practical" split mode. Controls the blend between the uniform (0.0) and logarithmic (1.0) splitting schemes.

**Default:** `0.8`

**Example:**

```typescript
{
  sun: {
    shadowLambda: 0.8,
  }
}
```

### shadowMargin

**Type:** `number | undefined`

**Description:** Defines the distance at which the shadow camera is placed behind the cascade frustum. Larger values prevent shadow clipping but may reduce precision. The unit is meters.

**Default:** `5000`

**Example:**

```typescript
{
  sun: {
    shadowMargin: 5000,
  }
}
```

### shadowFade

**Type:** `boolean | undefined`

**Description:** Enables smooth transitions between shadow cascades to reduce visible seams.

**Default:** `true`

**Example:**

```typescript
{
  sun: {
    shadowFade: true,
  }
}
```

### shadowIntensity

**Type:** `number | undefined`

**Description:** Specifies the shadow intensity (0 = no shadow, 1 = full shadow).

**Default:** `1`

**Example:**

```typescript
{
  sun: {
    shadowIntensity: 1.0,
  }
}
```

### shadowBias

**Type:** `number | undefined`

**Description:** Shadow map bias to reduce shadow acne. Similar to THREE.LightShadow.bias.

**Default:** `0.0001`

**Example:**

```typescript
{
  sun: {
    shadowBias: 0.0001,
  }
}
```

### shadowNormalBias

**Type:** `number | undefined`

**Description:** Normal-based shadow bias to reduce shadow acne on surfaces at oblique angles.

**Default:** `0`

**Example:**

```typescript
{
  sun: {
    shadowNormalBias: 0,
  }
}
```

### shadowRadius

**Type:** `number | undefined`

**Description:** Width of the shadow map filter kernel, in shadow map texels. The kernel takes a fixed nine samples, so above about `4` the samples show up individually instead of forming a soft edge. Where the [AerialPerspectiveEffectDesc](../../../three_default_descs/effect-desc/aerial-perspective-effect-desc/) re-applies these shadows, its `shadowSoftness` option widens the edge in screen space instead.

**Default:** `1`

**Example:**

```typescript
{
  sun: {
    shadowRadius: 2,
  }
}
```

### debugCSMHelper

**Type:** `boolean | undefined`

**Description:** Specifies whether to display debug visualization of shadow cascades.

**Default:** `false`

**Example:**

```typescript
{
  sun: {
    debugCSMHelper: false,
  }
}
```

## Usage Examples

### Basic Usage

```typescript
import ThreeView from "@navaramap/three";
import { SunLightDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView({
  shadow: true  // Enable shadows
});
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// Add default photorealistic objects (includes SunLightDesc)
const defaultLayers = plugin.addDefaultPhotorealScene();

// Update sunlight settings
defaultLayers.sun.update({
  sun: {
    castShadow: true,
    shadowMapSize: 2048,
    shadowCascadeCount: 4
  }
});
```

### Shadow Quality Adjustment

```typescript
const sun = view.addLight<SunLightDesc>({
  sun: {
    intensity: 1.0,
    castShadow: true,
    shadowCascadeCount: 4,
    shadowMapSize: 4096,  // High quality
    shadowFar: 50000,
    shadowMode: "practical",
    shadowLambda: 0.8,
    shadowFade: true,
    shadowIntensity: 1.0,
    shadowBias: 0.0001,
    shadowNormalBias: 0,
    shadowRadius: 1
  }
});
```

### Debug Visualization

```typescript
// Visualize CSM cascades for debugging
sun.update({
  sun: {
    debugCSMHelper: true
  }
});
```

### Dynamic Shadow Control

```typescript
// Integrate with UI control panel
const params = {
  castShadow: true,
  shadowIntensity: 1.0,
  shadowMapSize: 2048
};

// Toggle shadows on/off
sun.update({
  sun: {
    castShadow: params.castShadow
  }
});

// Adjust shadow intensity
sun.update({
  sun: {
    shadowIntensity: params.shadowIntensity
  }
});
```

### Applying Custom Color

```typescript
import { Color } from "@navaramap/three";

// Disable atmospheric calculation and use custom color
const sun = view.addLight<SunLightDesc>({
  sun: {
    applyColor: true,  // Use custom color
    color: new Color().setHex(0xffffee),
    intensity: 1.0
  }
});
```

## About Cascaded Shadow Maps (CSM)

Cascaded Shadow Maps is a technique for achieving high-quality shadows across wide-ranging scenes:

- **Multiple shadow maps**: Uses multiple shadow maps based on distance from the camera
- **Adaptive resolution**: High resolution for near distances, low resolution for far distances
- **Cascade fading**: Seamless transitions hide seams between cascades

### Performance Optimization Tips

1. **Adjust cascade count**: 3-4 is usually sufficient. More improves quality but increases cost.
2. **Shadow map size**: 2048 is standard. 4096 is high quality but heavy.
3. **Limit shadowFar**: Only render shadows within the required range
4. **Choose shadowMode**: "practical" is usually optimal

## Integration with the Atmosphere System

SunLightDesc works in conjunction with atmospheric scattering simulation:

1. **Sun direction synchronization**: Obtained from `view.atmosphere.sunDirection`
2. **Transmittance texture usage**: Considers light attenuation through the atmosphere
3. **Dynamic color computation**: When `applyColor` is `false`, color is computed from the atmosphere

This enables natural sunlight that responds to time of day and atmospheric conditions.

## Notes

- To use SunLightDesc, you need to specify `shadow: true` when initializing `ThreeView`.
- CSM uses multiple shadow maps, which impacts GPU memory and performance.
- Increasing `shadowMapSize` increases memory usage (e.g., 4096 = 16MB/cascade).
- To receive shadows on terrain or models, `receiveShadow: true` must be set on the material.
- To cast shadows, `castShadow: true` must be set on the object.
- `debugCSMHelper` should only be used during development and disabled in production.
