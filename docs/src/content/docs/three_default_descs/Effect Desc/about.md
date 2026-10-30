---
title: Effect Descriptor
description: Effect descriptor types for navara_three
sidebar:
  order: 50
---

`EffectDesc` is a descriptor type for applying post-processing effects to the rendering pipeline. You can add various visual effects such as anti-aliasing, depth of field, tone mapping, and more.

:::note
This page covers the effects provided by `@navaramap/three-default-descs`. A few effects that are tightly coupled to the rendering pipeline (e.g. `SkyEnvMapEffectDesc`) live in `@navaramap/three` core instead. See [Effect Descriptor (three core)](../../../three/effect-desc/about/).
:::

## Available EffectDescriptor Types

The following EffectDescriptor types are available in navara_three:

| Descriptor Type | Description |
|------------|------|
| [AerialPerspectiveEffectDesc](../aerial-perspective-effect-desc) | An effect that simulates light scattering and transmittance through the atmosphere |
| [BuildingWindowsEffectDesc](../building-windows-effect-desc) | An effect that draws lit windows on building walls |
| [CloudsEffectDesc](../clouds-effect-desc) | An effect that renders real-time volumetric clouds |
| [ColorGradingLUTEffectDesc](../color-grading-lut-effect-desc) | An effect that applies color grading using a LUT |
| [DepthOfFieldEffectDesc](../depth-of-field-effect-desc) | An effect that applies bokeh based on the camera's focal plane |
| [FogLightEffectDesc](../fog-light-effect-desc) | An effect that generates volumetric fog from point lights |
| [FXAAEffectDesc](../fxaa-effect-desc) | An effect that applies FXAA (Fast Approximate Anti-Aliasing) |
| [LensFlareEffectDesc](../lens-flare-effect-desc) | An effect that generates lens flares from the sun and moon |
| [RainDropEffectDesc](../rain-drop-effect-desc) | An effect that applies raindrop refraction to the screen |
| [SelectiveBloomEffectDesc](../selective-bloom-effect-desc) | An effect that applies selective bloom |
| [SelectiveOutlineEffectDesc](../selective-outline-effect-desc) | An effect that applies selective outlines |
| [SMAAEffectDesc](../smaa-effect-desc) | An effect that applies SMAA (Subpixel Morphological Anti-Aliasing) |
| [SSAOEffectDesc](../ssao-effect-desc) | An effect that applies screen-space ambient occlusion |
| [SSREffectDesc](../ssr-effect-desc) | An effect that generates real-time screen-space reflections |
| [ToneMappingEffectDesc](../tone-mapping-effect-desc) | An effect that performs HDR to LDR color adjustment |

## Basic Usage

Effect Descriptors are added by registering the descriptor class and then calling the `view.addEffect()` method:

```typescript
import ThreeView from "@navaramap/three";
import { AerialPerspectiveEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();

// Register the descriptor class
view.registerEffect("aerialPerspective", AerialPerspectiveEffectDesc);

await view.init();

const aerialPerspectiveDesc = view.addEffect<AerialPerspectiveEffectDesc>({
  aerialPerspective: {},
});
```

## Common Properties

All Effect Descriptors have the following basic settings:

- `id`: A unique identifier for the object
- `visible`: Toggles the object's visibility

Refer to each descriptor type's documentation for detailed usage.
