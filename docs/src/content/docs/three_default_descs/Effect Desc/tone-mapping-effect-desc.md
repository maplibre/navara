---
title: ToneMappingEffectDesc
description: Tone mapping effect descriptor for navara_three
sidebar:
  order: 62
---

The `ToneMappingEffectDesc` class is a Descriptor that applies a tone mapping effect. It performs color adjustment from HDR (High Dynamic Range) to LDR (Low Dynamic Range), converting to a range that can be displayed on screen.

## Properties

### visible

**Type:** `boolean | undefined`

**Description:** Controls the visibility of the effect descriptor.

**Default:** `true`

### mode

**Type:** `ToneMappingMode | undefined`

**Description:** Specifies the tone mapping mode. Available modes include AGX, ACES_FILMIC, NEUTRAL, LINEAR, REINHARD, REINHARD2, UNREAL, and more. AGX and ACES_FILMIC give a filmic contrast curve. NEUTRAL keeps the basemap's own colors and only rolls off the highlights, which suits imagery that should stay recognizable.

**Default:** `ToneMappingMode.AGX`

**Example:**

```typescript
{
  toneMapping: {
    mode: ToneMappingMode.ACES_FILMIC,
  }
}
```

## Usage Examples

### Using tone mapping with default effects

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// Add default photorealistic objects (includes ToneMappingEffectDesc)
const defaultLayers = plugin.addDefaultPhotorealScene();

// Set exposure
view.toneMappingExposure = 10;
```

### Using different tone mapping modes

```typescript
import ThreeView from "@navaramap/three";
import { ToneMappingEffectDesc, ToneMappingMode } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// AGX mode (default, well-balanced results)
view.addEffect<ToneMappingEffectDesc>({
  toneMapping: {
    mode: ToneMappingMode.AGX,
  },
});

// Or, ACES Filmic mode (cinematic look)
view.addEffect<ToneMappingEffectDesc>({
  toneMapping: {
    mode: ToneMappingMode.ACES_FILMIC,
  },
});

// Reinhard mode
view.addEffect<ToneMappingEffectDesc>({
  toneMapping: {
    mode: ToneMappingMode.REINHARD,
  },
});
```

### Usage combined with exposure adjustment

```typescript
import ThreeView from "@navaramap/three";
import { ToneMappingMode } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

const defaultLayers = plugin.addDefaultPhotorealScene();

// Enable tone mapping
defaultLayers.toneMapping.update({
  visible: true,
  toneMapping: {
    mode: ToneMappingMode.AGX,
  },
});

// Adjust exposure (bright scene)
view.toneMappingExposure = 15;

// Adjust exposure (dark scene)
view.toneMappingExposure = 5;
```

### Adding a tone mapping Descriptor individually

```typescript
import ThreeView from "@navaramap/three";
import { ToneMappingEffectDesc, SMAAEffectDesc, ToneMappingMode } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

view.toneMappingExposure = 3;

// Add tone mapping effect descriptor
view.addEffect<ToneMappingEffectDesc>({
  toneMapping: {
    mode: ToneMappingMode.NEUTRAL,
  },
});

// Add SMAA effect descriptor (applied after tone mapping)
view.addEffect<SMAAEffectDesc>({
  smaa: {},
});
```

## Choosing the exposure

`view.toneMappingExposure` scales the HDR frame before the curve is applied, so the right value depends on how bright the basemap is, not only on the lighting. Dark tiles such as satellite imagery sit around `10`. Bright tiles such as a light map style sit around `3`. Pairing that exposure with a mode like `NEUTRAL` keeps the tiles' brightness even across the frame, so the scene reads cleanly without a filmic curve crushing the darker tiles or clipping the brighter ones.

```typescript
const layers = plugin.addDefaultPhotorealScene({ deferredLighting: true });
layers.toneMapping.update({ toneMapping: { mode: ToneMappingMode.NEUTRAL } });
view.toneMappingExposure = 10; // satellite imagery; around 3 for a bright style
```

## Notes

By applying appropriate tone mapping, you can convert HDR rendering results into visually appealing images. The AGX mode is used by default and provides well-balanced results. Exposure can be adjusted with `view.toneMappingExposure`.
