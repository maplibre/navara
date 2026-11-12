---
title: Text3DMeshDesc
description: Extruded 3D text mesh descriptor for navara_three
sidebar:
  order: 119
since: 0.3.2
---

The `Text3DMeshDesc` class is a mesh Descriptor that draws text as a solid 3D object. It reads the outline of each character from a font file and extrudes it to the given depth.

It is registered as the `"text3D"` mesh key by `DefaultPlugin`, so any `view.addMesh({ text3D: { ... } })` call routes to this Descriptor.

The font is fetched when the mesh is added. `addMesh` returns immediately, and the text appears once the font has loaded. A font that cannot be fetched or read is reported through the `error` event.

The text stands upright on its placement. The bottom center of the text block sits on the placed position (the bottom is the font's descender line under the last line, so it does not move as the letters change), and under `geodetic` the front of the text faces `heading`.

In addition to the properties below, all common properties from the base class (`position`, `rotation`, `scale`, `matrix`, `matrixWorld`, `geodetic`, `visible`) are available. See [MeshDesc](../mesh-desc-base) for details.

## Properties

### text

**Type:** `string`

**Description:** The text to display. Required. A line break (`\n`) starts a new line, and lines are aligned to the left.

**Example:**

```typescript
{
  text3D: {
    text: "Navara\n3D",
    font: "/fonts/your-font.ttf",
  }
}
```

### font

**Type:** `string`

**Description:** URL of the font file. Required. It accepts a TTF font file or a three.js typeface.json font. Host the font with your application, for example under the project's `public/fonts/` directory (referenced as `/fonts/your-font.ttf`), or use the URL of an externally hosted font with a verified license.

A font file holds one style, so an italic or another weight is a separate file: set the URL of that file.

When `font` is changed with `update()`, the text keeps the current font until the new one has loaded. When several fonts are requested in a row, the last one is used.

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
  }
}
```

### size

**Type:** `number`

**Description:** Text size in meters. Capital letters are about this tall, and the exact height depends on the font.

**Default:** `100`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    size: 150,
  }
}
```

### lineHeight

**Type:** `number`

**Description:** Distance between the baselines of consecutive lines, as a multiple of `size`. When unset, the line spacing defined by the font is used.

**Default:** The line spacing of the font

**Example:**

```typescript
{
  text3D: {
    text: "Navara\n3D",
    font: "/fonts/your-font.ttf",
    lineHeight: 1.5,
  }
}
```

### depth

**Type:** `number`

**Description:** Thickness of the text in meters, from its front face to its back face.

**Default:** `50`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    depth: 60,
  }
}
```

### curveSegments

**Type:** `number`

**Description:** Number of points that approximate each curve of a character outline. A higher value gives smoother curves and more triangles.

**Default:** `12`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    curveSegments: 4,
  }
}
```

### bevelEnabled

**Type:** `boolean`

**Description:** Specifies whether the edges of the text are beveled.

**Default:** `false`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    bevelEnabled: true,
  }
}
```

### bevelThickness

**Type:** `number`

**Description:** Depth of the bevel in meters. The bevel is added in front of and behind the text, so the total thickness grows by twice this value. It is an absolute length that does not follow `size`.

**Default:** `10`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    bevelEnabled: true,
    bevelThickness: 4,
  }
}
```

### bevelSize

**Type:** `number`

**Description:** Distance in meters that the bevel extends outward from the character outline. Every stroke grows by this value on each side. It is an absolute length that does not follow `size`.

**Default:** `8`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    bevelEnabled: true,
    bevelSize: 3,
  }
}
```

### color

**Type:** `Color`

**Description:** Specifies the color of the text using a `Color` instance. The `Color` class supports hexadecimal color codes and CSS-style color specifications.

**Default:** `new Color().setStyle("#ffffff")`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    color: new Color().setStyle("#ff0000"),
  }
}
```

### sideColor

**Type:** `Color`

**Description:** Specifies the color of the sides between the front and the back faces using a `Color` instance. The bevel is part of the sides.

**Default:** The value of `color`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    color: new Color().setStyle("#ff0000"),
    sideColor: new Color().setStyle("#ffffff"),
  }
}
```

### emissiveColor

**Type:** `Color`

**Description:** Specifies the emissive (self-illuminating) color using a `Color` instance. It is added to the shaded color of every face, including faces turned away from the light.

**Default:** `new Color().setHex(0x000000)`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    emissiveColor: new Color().setStyle("#ff0000"),
    emissiveIntensity: 0.3,
  }
}
```

### sideEmissiveColor

**Type:** `Color`

**Description:** Specifies the emissive color of the sides using a `Color` instance. Set it to black to make only the front and back faces glow.

**Default:** The value of `emissiveColor`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    color: new Color().setStyle("#ff0000"),
    sideColor: new Color().setStyle("#ffffff"),
    emissiveColor: new Color().setStyle("#ff0000"),
    sideEmissiveColor: new Color().setHex(0x000000),
    emissiveIntensity: 0.3,
  }
}
```

### emissiveIntensity

**Type:** `number`

**Description:** Specifies the emissive intensity.

**Default:** `0`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    emissiveIntensity: 0.5,
  }
}
```

### opacity

**Type:** `number`

**Description:** Specifies the opacity. Ranges from 0.0 (fully transparent) to 1.0 (fully opaque).

**Default:** `1`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    opacity: 0.5,
    transparent: true,
  }
}
```

### transparent

**Type:** `boolean`

**Description:** Specifies whether to enable transparency.

**Default:** `false`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    transparent: true,
  }
}
```

### castShadow

**Type:** `boolean`

**Description:** Specifies whether the text casts shadows. See [Text with a Shadow](#text-with-a-shadow) for the scene settings that shadows need.

**Default:** `false`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    castShadow: true,
  }
}
```

### receiveShadow

**Type:** `boolean`

**Description:** Specifies whether the text receives shadows.

**Default:** `false`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    receiveShadow: true,
  }
}
```

## Config

### effectIds

**Type:** `string[]` (optional)

**Description:** Specifies an array of selective effect descriptor IDs to apply to this mesh.

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    effectIds: ["bloom-effect", "outline-effect"],
  }
}
```

## Events

### load

**Description:** Fired each time a font has loaded and the text is displayed with it, including after `font` is changed with `update()`. Not fired on a failed load (the `error` event fires instead).

**Example:**

```typescript
sign.ref.on("load", () => {
  console.log("Text displayed!");
});
```

### error

**Description:** Fired when a font cannot be fetched or read. If it is the first font, no text is created until another `font` is set with `update()`. Otherwise the text keeps the current font. Setting the same URL again retries it.

**Example:**

```typescript
sign.ref.on("error", (error) => {
  console.warn("Font failed to load:", error);
});
```

## Usage Examples

### Basic Usage

```typescript
import ThreeView, { Color } from "@navaramap/three";
import type { Text3DMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>();
view.addPlugin(new DefaultPlugin()); // registers "text3D" → Text3DMeshDesc
await view.init();

// The text is shaded by the lights of the scene.
view.addLight({ ambient: { intensity: 0.6 } });
view.addLight({ sun: { intensity: 1.8 } });

const sign = view.addMesh<Text3DMeshDesc>({
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    size: 150,
    depth: 60,
    color: new Color().setStyle("#ff0000"),
  },
  // The bottom center of the text stands here, and its front faces south.
  geodetic: { lng: 139.7671, lat: 35.6812, heading: 180 },
});
```

### Changing the Text

Every property can be changed with `update()`. An `undefined` value leaves a property unchanged, so `sideColor`, `sideEmissiveColor` and `lineHeight` do not return to their defaults once set; set the value explicitly instead. An update made before the font has loaded is applied when the text appears.

```typescript
sign.update({
  text3D: {
    text: "Navara\n3D",
    font: "/fonts/another-font.ttf",
    color: new Color().setStyle("#0091ff"),
  },
});
```

### Switching the Font

An italic is a separate font file. The text keeps the current font until the new one has loaded, and a font that cannot be read fires the `error` event and leaves the text as it was.

```typescript
sign.ref.on("load", () => {
  console.log("Font switched");
});
sign.ref.on("error", (error) => {
  console.warn("Font failed to load:", error);
});

sign.update({ text3D: { font: "/fonts/your-font-italic.ttf" } });
```

### Front and Side Colors

The sides take their own color. To make only the front and back faces glow, set the emissive color of the sides to black.

```typescript
view.addMesh<Text3DMeshDesc>({
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    color: new Color().setStyle("#ff0000"),
    sideColor: new Color().setStyle("#ffffff"),
    emissiveColor: new Color().setStyle("#ff0000"),
    sideEmissiveColor: new Color().setHex(0x000000),
    emissiveIntensity: 0.3,
  },
  geodetic: { lng: 139.7671, lat: 35.6812, heading: 180 },
});
```

### Beveled Text

The bevel lengths are absolute, so set them in proportion to `size`.

```typescript
view.addMesh<Text3DMeshDesc>({
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    size: 150,
    depth: 60,
    bevelEnabled: true,
    bevelThickness: 4,
    bevelSize: 3,
  },
  geodetic: { lng: 139.7671, lat: 35.6812, heading: 180 },
});
```

### Text with a Shadow

Shadows need a view created with `shadow: true` and a [sun light](../../light-desc/sun-light-desc). The terrain shows them when its material sets [`receiveShadow`](../../../three/material/terrain-material/#receiveshadow) and its source sets `requestVertexNormals`.

```typescript
import ThreeView from "@navaramap/three";
import type { Text3DMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>({ shadow: true });
const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
await view.init();

// Adds the sun light that casts the shadows.
defaultPlugin.addDefaultPhotorealScene();

const terrain = view.addSource({
  type: "quantized-mesh",
  url: "https://example.com/terrain/{z}/{x}/{y}.terrain",
  requestVertexNormals: true,
});
view.addLayer({
  type: "terrain",
  source: terrain,
  terrain: { receiveShadow: true },
});

view.addMesh<Text3DMeshDesc>({
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    castShadow: true,
  },
  // 100 m above the terrain, so the shadow falls clear of the text.
  geodetic: {
    lng: 139.7671,
    lat: 35.6812,
    height: 100,
    heading: 180,
    heightReference: "terrain",
  },
});
```

### Text Lying Flat

A `pitch` of `90` lays the text on its back, facing up. With `heading: 180` its top points north, so it reads the right way up on a north-up map.

```typescript
view.addMesh<Text3DMeshDesc>({
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    depth: 10,
  },
  geodetic: { lng: 139.7671, lat: 35.6812, heading: 180, pitch: 90 },
});
```

## Supported Specifications

### Font formats

| Font format | Description |
| ----------- | ----------- |
| `.ttf` | TrueType font |
| typeface.json | three.js font format, converted from a font file with [facetype.js](https://gero3.github.io/facetype.js/) |

The format is detected from the file content, not from the URL.

:::note
- OTF fonts load, but the holes of their letters render incorrectly with three.js before 0.185. WOFF2 fonts are not supported; use the TTF file of the font.
- A variable font is drawn in its default style. Use a static font file for a specific weight.
:::

## Limitations

- **Simple text layout**: Characters are placed one after another by their advance width. Kerning, ligatures, and right-to-left or complex scripts are not supported.
- **Characters missing from the font**: A character the font does not contain is drawn as the font's fallback glyph. A typeface.json font uses its `?` glyph, so it must contain one. Only `\n` breaks the line, and other control characters such as a tab are treated as characters.
- **No picking**: The text does not support `pickable`.
