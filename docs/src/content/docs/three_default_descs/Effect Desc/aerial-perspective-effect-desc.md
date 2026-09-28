---
title: AerialPerspectiveEffectDesc
description: Aerial perspective effect descriptor for navara_three
sidebar:
  order: 51
---

The `AerialPerspectiveEffectDesc` class is a Descriptor that represents the aerial perspective effect. It calculates atmospheric light scattering (inscatter) and transmittance, producing the effect where distant objects appear more bluish.

This effect uses precomputed textures and sun/moon directions provided by the `Atmosphere` class to reproduce physically accurate atmospheric scattering.

:::tip[Related Documentation]
See [Atmosphere class](../../../three/api/atmosphere/) for details on the atmosphere system.
:::

## Properties

### visible

**Type:** `boolean | undefined`

**Description:** Controls the visibility of the effect descriptor.

**Default:** `true`

**Example:**

```typescript
{
  visible: true,
}
```

### inscatter

**Type:** `boolean | undefined`

**Description:** Specifies whether to enable the atmospheric light scattering effect. This produces the effect where distant objects appear bright and hazy.

**Default:** `true`

**Example:**

```typescript
{
  aerialPerspective: {
    inscatter: true,
  }
}
```

### transmittance

**Type:** `boolean | undefined`

**Description:** Specifies whether to enable the atmospheric light transmittance effect. This produces the effect where distant objects appear darker.

**Default:** `true`

**Example:**

```typescript
{
  aerialPerspective: {
    transmittance: true,
  }
}
```

### irradiance

**Type:** `boolean | undefined`

**Description:** Lights the scene from the precomputed sun and sky irradiance in post, reading the G-buffer normals instead of the forward lighting. Pair it with [`view.lit = false`](../../../three/api/threeview-properties/#lit), or the forward pass and this option both apply lighting. This lighting is diffuse only; [`shadow`](#shadow) and [`specular`](#specular) add the sun's shadows and its specular highlight. Cloud shadows require this option. Transparent materials are not re-lit. `DefaultPlugin.addDefaultPhotorealScene({ deferredLighting: true })` sets both halves.

**Default:** `false`

**Example:**

```typescript
{
  aerialPerspective: {
    irradiance: true,
  }
}
```

### sky

**Type:** `boolean | undefined`

**Description:** Specifies whether to apply sky color to the atmospheric effect.

**Default:** `false`

**Example:**

```typescript
{
  aerialPerspective: {
    sky: false,
  }
}
```

### sun

**Type:** `boolean | undefined`

**Description:** Specifies whether to apply the sun direction to the atmospheric effect.

**Default:** `true`

**Example:**

```typescript
{
  aerialPerspective: {
    sun: true,
  }
}
```

### moon

**Type:** `boolean | undefined`

**Description:** Specifies whether to apply the moon direction to the atmospheric effect.

**Default:** `true`

**Example:**

```typescript
{
  aerialPerspective: {
    moon: true,
  }
}
```

### useNormalBuffer

**Type:** `boolean | undefined`

**Description:** Specifies whether to bind the normal buffer to the effect, which controls whether deferred lighting (irradiance applied via this pass) is performed on scene materials. When `false`, the normal buffer is not provided to the effect and post-processing lighting is not applied to materials: atmospheric in-scatter and transmittance still compute, but materials are not relit by this pass. Disable this when scene geometry does not produce a reliable normal buffer (for example, tiled glTF assets without authored normals) and material lighting should be left untouched.

**Default:** `true`

**Example:**

```typescript
{
  aerialPerspective: {
    useNormalBuffer: false,
  }
}
```

### albedoScale

**Type:** `number | undefined`

**Description:** Specifies the scale factor passed to the underlying `AerialPerspectiveEffect`'s `albedoScale` uniform. It is multiplied with the scene color when computing the diffuse term used by the irradiance pass.

**Default:** `2 / Math.PI`

**Example:**

```typescript
{
  aerialPerspective: {
    albedoScale: 2 / Math.PI,
  }
}
```

### shadow

**Type:** `boolean | undefined`

**Description:** Enables the sun's shadows in a scene lit by [`irradiance`](#irradiance). A shadowed pixel loses the sun's light and keeps the sky's, so shadows are bright under a clear midday sky and deepen towards dusk. For the shadows the clouds cast, see the clouds effect's `shadows` option.

Requirements:

- `irradiance: true` and [`useNormalBuffer`](#usenormalbuffer) enabled on this Descriptor.
- `shadow: true` on the `ThreeView` constructor, and `castShadow: true` on the sun light.
- Terrain needs vertex normals (a `quantized-mesh` source with `requestVertexNormals: true`) or a hillshade material.

Objects with `lit: true` keep their forward shading, and transparent surfaces are not affected. The `shadowIntensity`, `shadowSoftness`, and `shadowSamples` properties below tune the term, and are kept while it is off.

**Default:** `false`

**Example:**

```typescript
{
  aerialPerspective: {
    irradiance: true,
    shadow: true,
  }
}
```

### shadowIntensity

**Type:** `number | undefined`

**Description:** Scales the [`shadow`](#shadow) term. Unlike switching `shadow` off, `0` does not recompile the shader.

**Default:** `1`

**Example:**

```typescript
{
  aerialPerspective: {
    shadowIntensity: 0.6,
  }
}
```

### shadowSoftness

**Type:** `number | undefined`

**Description:** Radius of the screen-space blur applied to the shadow edge, in pixels.

**Default:** `1.5`

**Example:**

```typescript
{
  aerialPerspective: {
    shadowSoftness: 3,
  }
}
```

### shadowSamples

**Type:** `number | undefined`

**Description:** Number of taps of the [`shadowSoftness`](#shadowsoftness) blur.

**Default:** `12`

**Example:**

```typescript
{
  aerialPerspective: {
    shadowSamples: 16,
  }
}
```

### specular

**Type:** `boolean | undefined`

**Description:** Adds the sun's specular reflection with a GGX microfacet lobe. The [`irradiance`](#irradiance) lighting path is diffuse only, so reflective materials stay matte without this option. The highlight is lit by the same sunlight the [`shadow`](#shadow) term dims, so it disappears in shadow and under cloud shadows.

How much a surface reflects is a material property, not an effect option. It is the glTF metalness for models and 3D Tiles and the material reflectivity elsewhere, and roughness sets how wide the highlight spreads. Anything below `0.01` reflectance is skipped, so terrain, polylines, sprites and text stay matte unless their material says otherwise.

Requires `irradiance: true` and [`useNormalBuffer`](#usenormalbuffer), like [`shadow`](#shadow). [`albedoScale`](#albedoscale) dims the reflection together with the diffuse light.

The [SSR effect](../ssr-effect-desc/) does not overlap with this term: it reflects what is already on screen and treats the sky as a miss, so it cannot produce the sun's own highlight.

**Default:** `false`

**Example:**

```typescript
{
  aerialPerspective: {
    irradiance: true,
    specular: true,
  }
}
```

### specularIntensity

**Type:** `number | undefined`

**Description:** Scales the [`specular`](#specular) reflection. Unlike switching `specular` off, `0` does not recompile the shader.

**Default:** `1`

**Example:**

```typescript
{
  aerialPerspective: {
    specularIntensity: 0.5,
  }
}
```

## Usage Examples

### Enable aerial perspective with default effect descriptors

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// Add default photorealistic objects (includes AerialPerspectiveEffectDesc)
const defaultLayers = plugin.addDefaultPhotorealScene();

// Update aerial perspective effect settings
defaultLayers.aerialPerspective.update({
  aerialPerspective: {
    inscatter: true,
    transmittance: true,
    sky: false,
  },
});
```

### Aerial perspective combined with cloud shadows

```typescript
import ThreeView from "@navaramap/three";
import { CloudsEffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

const defaultLayers = plugin.addDefaultPhotorealScene();

// Enable irradiance when using cloud shadows
defaultLayers.aerialPerspective.update({
  aerialPerspective: {
    inscatter: true,
    transmittance: true,
    irradiance: true,
  },
});

// Add clouds effect descriptor
view.addEffect<CloudsEffectDesc>({
  clouds: {
    shadows: true,
  },
});
```

### Deferred lighting with cascaded shadows

```typescript
import ThreeView from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

// Renders shadow maps. This option can only be set on the constructor.
const view = new ThreeView<DefaultDescriptions>({ shadow: true });
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// The atmosphere lights the scene (irradiance + view.lit = false) with the
// sun's shadows.
const layers = plugin.addDefaultPhotorealScene({
  deferredLighting: true,
  shadow: true,
});
layers.sun.update({ sun: { castShadow: true } });
view.toneMappingExposure = 3;

// Terrain writes the shadow buffer only with vertex normals.
const terrainSource = view.addSource({
  type: "quantized-mesh",
  url: "https://example.com/terrain",
  requestVertexNormals: true,
});
view.addLayer({
  type: "terrain",
  source: terrainSource,
  terrain: { castShadow: true, receiveShadow: true },
});
```

## See Also

- [Color class](../../../three/api/color/) - How to configure colors
