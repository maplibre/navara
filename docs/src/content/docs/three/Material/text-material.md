---
title: TextMaterial
description: Text material for navara_three
sidebar:
  order: 580
---

`TextMaterial` represents a material for text rendering.

## Properties

### backgroundColor

**Type:** `Color | undefined`

**Description:** Specifies the text background color as a `Color` instance.

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text: {
    backgroundColor: new Color().setHex(0xffffff) // White background
  }
}
```

### borderColor

**Type:** `Color | undefined`

**Description:** Specifies the text background border color as a `Color` instance.

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text: {
    borderColor: new Color().setHex(0x000000) // Black border
  }
}
```

### borderWidth

**Type:** `number | undefined`

**Description:** Specifies the text border width. Specified as a ratio to the frame height, between 0 and 0.5.

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    borderWidth: 2
  }
}
```

### center

**Type:** [`Vec2`](../../api/types/#vec2) | undefined

**Description:** Specifies the shift amount from the center. The range is between 0 and 1.

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    center: { x: 0.5, y: 0.0 }
  }
}
```

### clampToGround

**Type:** `boolean | undefined`

**Description:** Specifies whether to clamp the text to the ground.

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    clampToGround: true
  }
}
```

### color

**Type:** `Color | undefined`

**Description:** Specifies the text color as a `Color` instance.

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text: {
    color: new Color().setHex(0x000000)
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
  text: {
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
  text: {
    declutter: true,
    declutterPriority: 1
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
  text: {
    depthTest: true
  }
}
```

### effectIds

**Type:** `string[] | undefined`

**Description:** Specifies the IDs of selective effects to apply (e.g., "bloom", "outline"). Used in conjunction with SelectiveBloomEffectDesc or SelectiveOutlineEffectDesc. With bloom, only the glyph fill glows. The outline and background stay dark.

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    effectIds: ["bloom", "outline"]
  }
}
```

### emissiveColor

**Type:** `Color | undefined`

**Description:** Specifies the emissive intensity.

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text: {
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
  text: {
    emissiveIntensity: 0.5
  }
}
```

### font

**Type:** `string | undefined`

**Description:** Specifies either the URL of a single font file or the `family` name of a font family previously registered with [`view.addFontFamily()`](../../api/threeview-functions/#addfontfamily). Supported file formats are ttf, otf, woff, and woff2.

When a family name is used, only the face files whose unicode ranges cover the characters in `text` are fetched, so large scripts (CJK, etc.) can be split into multiple faces and loaded on demand.

For each codepoint, the first face (in `faces` order) whose `unicodeRanges` include the codepoint is used, so earlier entries win when ranges overlap. Codepoints not covered by any face fall back to the first face (`faces[0]`), which may therefore be downloaded even for characters outside its declared ranges. See [`addFontFamily()`](../../api/threeview-functions/#addfontfamily) for details.

Faces and their unicode ranges can also be derived from a stylesheet's `@font-face` rules (e.g. the Google Fonts CSS API) instead of being written by hand. See [Font Family from CSS](../../api/font-family-from-css/).

**Default:** `undefined` (no font is loaded, and the text layer will not render until a font is specified).

**Example (single font file):**

```typescript
{
  text: {
    font: "https://example.com/fonts/NotoSansJP-Regular.ttf"
  }
}
```

**Example (registered font family):**

```typescript
view.addFontFamily({
  family: "MapFont",
  faces: [
    { url: "/fonts/latin.woff2", unicodeRanges: [{ from: 0x0000, to: 0x024f }] },
    { url: "/fonts/cjk.woff2", unicodeRanges: [{ from: 0x4e00, to: 0x9fff }] },
  ],
});

// Later, in a text layer material:
{
  text: {
    font: "MapFont"
  }
}
```

### geometryTypes

**Type:** `("point" | "line" | "polygon")[] | undefined`

**Description:** Source geometry categories this material consumes. Adding `"line"` emits one label per line-string vertex, and adding `"polygon"` emits one label per polygon-ring vertex (the closing duplicate vertex is skipped). Setting the array replaces the default, so include `"point"` when point geometry should keep rendering. This option applies when the layer's geometry is built: set it at layer creation. `layer.update()` applies a new value only to tiles loaded afterwards, so already-loaded tiles keep their previous geometry until the layer is re-created.

**Default:** `["point"]`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["point", "polygon"]
  }
}
```

### height

**Type:** `number | undefined`

**Description:** Specifies the altitude of the text. The unit is meters.

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    height: 100 // 100 meters
  }
}
```

### lang

**Type:** `string | undefined`

**Description:** Specifies the language code for text shaping (e.g., "en", "ja", "ar"). Used to correctly render text.

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    lang: "ja"
  }
}
```

### lineHeight

**Type:** `number | undefined`

**Description:** Specifies the line height of multi-line text as a multiplier of the font's natural line height (ascender − descender + line gap).

**Default:** `1.0`

**Example:**

```typescript
{
  text: {
    lineHeight: 1.2
  }
}
```

### maxWidth

**Type:** `number | undefined`

**Description:** Specifies the maximum line width in ems (multiples of `size`) before the text wraps at word boundaries. `0` disables wrapping. Explicit `\n` characters in `text` always break lines regardless of this setting. Because the value is in ems, the wrap width stays proportional to the text size whether `sizeInMeters` is on or off.

**Default:** `0` (no wrapping)

**Example:**

```typescript
{
  text: {
    maxWidth: 10 // Wrap lines longer than 10 ems
  }
}
```

### offsetDepth

**Type:** `boolean | undefined`

**Description:** Avoids overlap with the earth's surface. Use this to prevent the text from clipping into the earth's surface.

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    offsetDepth: true
  }
}
```

### opacity

**Type:** `number | undefined`

**Description:** Specifies the opacity of the text. The range is 0.0 (fully transparent) to 1.0 (fully opaque).

**Default:** `1.0`

**Example:**

```typescript
{
  text: {
    opacity: 0.5
  }
}
```

### outlineColor

**Type:** `Color | undefined`

**Description:** Specifies the text outline color as a `Color` instance.

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text: {
    outlineColor: new Color().setHex(0x000000) // Black outline
  }
}
```

### outlineOpacity

**Type:** `number | undefined`

**Description:** Specifies the opacity of the text outline. The range is 0.0 to 1.0.

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    outlineOpacity: 0.8
  }
}
```

### outlineWidth

**Type:** `number | undefined`

**Description:** Specifies the outline thickness in CSS pixels.

**Default:** `0.0`

**Example:**

```typescript
{
  text: {
    outlineWidth: 2
  }
}
```

### highQuality

**Type:** `boolean | undefined`

**Description:** Enables high-quality glyph rendering. When `true`, text uses an MSDF atlas, which preserves sharp corners at large sizes but is significantly slower to rasterize per glyph. When `false` or omitted, the default single-channel SDF atlas is used, which is dramatically faster with slightly soft corners at extreme zoom.

**Default:** `false`

**Example:**

```typescript
{
  text: {
    highQuality: true
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
  text: {
    sizeInMeters: true
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** Specifies whether to show the text.

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    show: true
  }
}
```

### size

**Type:** `number | undefined`

**Description:** Specifies the size of the text. The unit is pixels.

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    size: 16
  }
}
```

### text

**Type:** `string | undefined`

**Description:** Specifies the text content to display.

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    text: "Tokyo Station"
  }
}
```

### textAlign

**Type:** `string | undefined`

**Description:** Specifies the horizontal alignment of lines within a multi-line text block. One of `"left"`, `"center"`, or `"right"`. Has a visible effect only when the text spans multiple lines (via [`maxWidth`](#maxwidth) or explicit `\n` characters).

**Default:** `"center"`

**Example:**

```typescript
{
  text: {
    textAlign: "left"
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** Enables transparency and alpha blending. When enabled, the `opacity` property can be used to control transparency.

**Default:** `true`

**Example:**

```typescript
{
  text: {
    transparent: true,
    opacity: 0.5
  }
}
```
