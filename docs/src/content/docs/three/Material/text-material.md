---
title: TextMaterial
description: Text material for navara_three
sidebar:
  order: 580
---

`TextMaterial` represents a material for text rendering.

## Properties

### backfaceCulling

**Type:** `boolean | undefined`

**Description:** Whether the label is hidden when seen from behind. When `false`, both sides of the label are drawn. When `true`, only its front is drawn.

Only a flat label (see [`textFacing`](#textfacing)) has a back the camera can see. Its front faces away from the globe, so turning this on hides the parts of a large label that wrap over the horizon. It has no effect on an upright label, which always lies in the screen plane facing the viewer.

**Default:** `false`

**Example:**

```typescript
{
  text: {
    textFacing: "flat",
    backfaceCulling: true
  }
}
```

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

### declutterRank

**Type:** `number | undefined`

**Description:** Coarse placement order for decluttering, compared before [`declutterPriority`](#declutterpriority): every label of a material with a higher rank is placed before any label or sprite with a lower one, whatever their priorities. A per-feature `declutterPriority` therefore only reorders labels and sprites of the same rank. Only meaningful when [`declutter`](#declutter) is enabled.

**Default:** `0.0`

**Example:**

```typescript
{
  text: {
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

**Description:** Specifies the emissive color as a `Color` instance.

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

**Description:** Source geometry categories this material consumes. Adding `"line"` emits one label per line string by default, at its first vertex, as MapLibre places a `symbol-placement: "point"` symbol on a line. Set [`placement`](#placement) to lay labels along the line instead. Adding `"polygon"` emits one label per polygon, placed inside it at the point farthest from its edges (each part of a MultiPolygon gets its own), or along its rings with [`placement`](#placement). Setting the array replaces the default, so include `"point"` when point geometry should keep rendering. This option applies when the layer's geometry is built: set it at layer creation. `layer.update()` applies a new value only to tiles loaded afterwards, so already-loaded tiles keep their previous geometry until the layer is re-created.

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

### ignorePlacement

**Type:** `boolean | undefined`

**Description:** Keeps this label's box out of the collision check, so labels and sprites placed after it can overlap it. The label itself still hides when it collides with one placed before it, unless [`overlap`](#overlap) allows it. Only meaningful when [`declutter`](#declutter) is enabled. MapLibre's `text-ignore-placement`.

**Default:** `false`

**Example:**

```typescript
{
  text: {
    ignorePlacement: true
  }
}
```

### keepUpright

**Type:** `boolean | undefined`

**Description:** Flips a label placed along a line when it would otherwise read upside down, so that names stay legible whichever way the line was drawn. Only used when [`placement`](#placement) is `"line"` or `"line-center"`, and never flips a label drawn straight (see [`rotateWithCamera`](#rotatewithcamera)). Which way a label reads depends on the camera, so it is decided again as the camera moves, and `layer.update()` applies a new value to labels that are already shown.

**Default:** `true`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["line"],
    placement: "line",
    keepUpright: false // Always read in the direction the line was drawn
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

### letterSpacing

**Type:** `number | undefined`

**Description:** Specifies extra space between characters in ems (multiples of `size`). Spacing is added between characters only, never after the last one, so alignment and anchoring are unaffected, and it counts toward the [`maxWidth`](#maxwidth) wrap width. Negative values tighten the text. Combining marks stay attached to their base character. Spacing is ignored for labels containing Arabic-script text, where it would break the joined letterforms. Can also be set per feature with the `letterSpacing` key of a feature evaluator.

**Default:** `0`

**Example:**

```typescript
{
  text: {
    letterSpacing: 0.2 // Add 0.2 em between characters
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

### lineOffset

**Type:** `number | undefined`

**Description:** Shifts a label placed along a line sideways, away from the line. Positive values move it to the left of the line's direction of travel, which puts it above the line when the label reads left to right. The value uses the same unit as [`size`](#size): meters when [`sizeInMeters`](#sizeinmeters) is `true`, pixels otherwise. Use it to set a name beside a road instead of on top of it. Only used when [`placement`](#placement) is `"line"` or `"line-center"`, and not by a label drawn straight (see [`rotateWithCamera`](#rotatewithcamera)). `layer.update()` applies a new value to labels that are already shown.

**Default:** `0.0`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["line"],
    placement: "line",
    size: 14,
    sizeInMeters: false,
    lineOffset: 10 // 10 pixels beside the line
  }
}
```

### maxAngle

**Type:** `number | undefined`

**Description:** The largest turn, in degrees, that the line may make under a label placed along it before the label is hidden as unreadable. The turn is added up over a short stretch of the label, about one and a half times the font size, which slides along it: several small corners close together count together and can hide the label, while a long gentle curve is kept however far it turns in total. Only used when [`placement`](#placement) is `"line"` or `"line-center"`, and not for a label drawn straight (see [`rotateWithCamera`](#rotatewithcamera)), which does not bend. Whether a label fits is decided again as the camera moves, and `layer.update()` applies a new value to labels that are already shown.

**Default:** `45.0`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["line"],
    placement: "line",
    maxAngle: 90 // Allow labels on tighter curves
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

### overlap

**Type:** `"never" | "always" | "cooperative" | undefined`

**Description:** Whether the label may be drawn over labels and sprites placed before it (higher [`declutterRank`](#declutterrank), then higher [`declutterPriority`](#declutterpriority), places first). `"never"` hides it on any collision. `"always"` never hides it, and its box still keeps later `"never"` ones away unless [`ignorePlacement`](#ignoreplacement) is set. `"cooperative"` hides it only when it collides with a `"never"` one. Only meaningful when [`declutter`](#declutter) is enabled. MapLibre's `text-overlap`.

**Default:** `"never"`

**Example:**

```typescript
{
  text: {
    overlap: "always"
  }
}
```

### placement

**Type:** `"point" | "line" | "line-center" | undefined`

**Description:** How labels are placed on line and polygon geometry. Only takes effect when [`geometryTypes`](#geometrytypes) includes `"line"` or `"polygon"`. Point geometry is always labeled at the point itself.

- `"point"`: one label per line string, at its first vertex, and one label per polygon, inside it at the point farthest from its edges. On a vector-tile source, a line whose first vertex lies outside the tile (where the tile cut it) is not labeled in that tile.
- `"line"`: labels repeat along the line every [`spacing`](#spacing) and, by default, follow its curve word by word, like a street name on a map. Each word turns to match the line under it, and the letters within a word stay straight. Set [`spreadGlyphs`](#spreadglyphs) to turn each glyph instead. Polygon boundary rings, holes included, are followed the same way.
- `"line-center"`: a single label at the halfway point along each line string or polygon ring, bent along it in the same way.

A label along a line is hidden instead of drawn when it would not read well:

- it is longer than the line left on either side of its anchor, or
- it bends through more than [`maxAngle`](#maxangle).

These checks run again as the camera moves.

Along-line labels also accept [`keepUpright`](#keepupright), [`lineOffset`](#lineoffset), and [`spreadGlyphs`](#spreadglyphs). With none of [`rotateWithCamera`](#rotatewithcamera), [`spreadGlyphs`](#spreadglyphs), and [`textFacing`](#textfacing) set, a label lies flat on the surface and follows the line. Together they choose the layout:

| `rotateWithCamera` | `spreadGlyphs` | `textFacing` | Result |
| --- | --- | --- | --- |
| `false` (default) | `false` (default) | `"flat"` (default) | Words lie on the surface along the line, each word straight |
| `false` | `true` | `"flat"` | Each glyph lies on the surface, turned to the line under it (MapLibre's default street name: `text-rotation-alignment` and `text-pitch-alignment` both `"map"`) |
| `false` | either | `"upright"` | Glyphs, or words without `spreadGlyphs`, stay in the screen plane at the anchor's size. They are spaced along the line as it appears on screen, each turned to the line's direction on screen (`text-rotation-alignment: "map"` with `text-pitch-alignment: "viewport"`) |
| `true` | `true` | either | Each glyph sits on the line and turns to the camera like a point label, spaced on screen (`text-rotation-alignment: "viewport-glyph"`) |
| `true` | `false` | either | The label is not bent: it is drawn straight at each anchor, exactly like a point label, rotation and background included (`text-rotation-alignment: "viewport"`) |

A straight label still repeats every [`spacing`](#spacing), but it is never flipped by [`keepUpright`](#keepupright), is not checked against [`maxAngle`](#maxangle), and ignores [`lineOffset`](#lineoffset).

This option applies when the layer's geometry is built: set it at layer creation. `layer.update()` does not rebuild labels that are already loaded, so remove the layer and add it again to change it.

**Default:** `"point"`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["line"],
    placement: "line", // Repeat along the line, bending with it
    textFacing: "flat"
  }
}
```

### rotateWithCamera

**Type:** `boolean | undefined`

**Description:** Whether the label turns with the camera or with the map, as MapLibre's `text-rotation-alignment` (`true` is `"viewport"`, `false` is `"map"`).

When `true`, the label reads left to right on screen. With [`textFacing`](#textfacing) set to `"upright"`, it is a screen-aligned billboard. With `"flat"`, the label turns around the globe's surface normal so the text still reads left to right.

When `false`, the label is aligned with the map. With `"upright"`, it stays in the screen plane at full size but turns with the camera heading so that its x-axis keeps pointing east: the text reads along the east-west direction, and reads upside down when the camera faces south, as a north-up map label does. With `"flat"`, it is a north-up label painted on the surface that turns with the map.

When [`placement`](#placement) is `"line"` or `"line-center"`, `false` makes the label follow the line, and `true` draws it straight at each anchor like a point label unless [`spreadGlyphs`](#spreadglyphs) is set. See [`placement`](#placement) for the resulting layouts.

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/).

**Default:** `true` for `placement: "point"`, `false` along a line (MapLibre's `"auto"`)

**Example:**

```typescript
{
  text: {
    textFacing: "flat",
    rotateWithCamera: false // North-up, painted on the surface
  }
}
```

### rotation

**Type:** `number | undefined`

**Description:** Rotates the label within its own plane around its anchor point, in degrees, clockwise as seen from the front. The rotation is applied on top of the orientation that [`textFacing`](#textfacing) and [`rotateWithCamera`](#rotatewithcamera) resolve to. It spins a billboard on screen and turns a surface label like a compass bearing.

When [`placement`](#placement) is `"line"` or `"line-center"`, each glyph spins about its own center and keeps its place on the line, as MapLibre's `text-rotate` does on line labels. A label drawn straight (`rotateWithCamera: true` without [`spreadGlyphs`](#spreadglyphs)) turns as a whole around its anchor, as a point label does.

[`center`](#center) decides where inside the text the pivot sits. For example, `{ x: 0.5, y: 0.5 }` turns the label around its middle, and `{ x: 0.5, y: 0.0 }` turns it around the bottom of the text block.

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/), so every label in a layer can point a different way.

**Default:** `0.0`

**Example:**

```typescript
{
  text: {
    textFacing: "flat",
    rotateWithCamera: false,
    rotation: 45, // Turned 45° clockwise on the surface
    center: { x: 0.5, y: 0.5 } // Pivot around the middle of the text
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

### spacing

**Type:** `number | undefined`

**Description:** The distance between repeated labels when [`placement`](#placement) is `"line"`, in screen pixels. The unit is the same on `geojson` and `vector-tile` sources.

The labels shown on a line are decided again as the camera moves. Pulling the camera back thins them out, and moving closer fills in more labels between them. Labels never slide along the line: they only appear or disappear. The gap on screen stays between one and two times `spacing`, also in a tilted view, where the near and far parts of the view each get their own density.

A line always keeps the label at its halfway point, and a line shorter than `spacing` on screen gets only that one. Labels stop filling in very close to the ground (street level) on a GeoJSON source, and when a vector tile is shown much deeper than its own zoom level (overscaled). There they sit farther apart than `spacing`.

Three more rules follow MapLibre's `symbol-spacing`:

- A label longer than three quarters of `spacing` spreads its repeats to its own length plus a quarter of `spacing`, so long names are spaced out instead of hidden.
- A label closer than half of `spacing` to an earlier label with the same text in the same tile is hidden, so a road split into several lines, or two carriageways with one name, is not labeled twice in the same spot.
- On a vector tile source, each tile places labels only inside its own bounds. Each tile spaces its own labels, so repeats end up at most about one tile apart (512 to 1024 screen pixels) however large `spacing` is.

This option applies when the layer's geometry is built. `layer.update()` does not rebuild labels that are already loaded, so remove the layer and add it again to change it.

**Default:** `250.0`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["line"],
    placement: "line",
    spacing: 400
  }
}
```

### spreadGlyphs

**Type:** `boolean | undefined`

**Description:** Places each glyph of a label along a line on its own instead of each word. How a glyph turns depends on [`rotateWithCamera`](#rotatewithcamera):

- `false` (the default along a line): each glyph turns to match the line under it, the way MapLibre lays out `symbol-placement: "line"` labels. A word bends with a curve instead of staying straight, and on a tight bend the letters of a word spread apart.
- `true`: each glyph turns to follow the camera, as a point label does with the same [`textFacing`](#textfacing), so the text stays readable however the line runs (MapLibre's `text-rotation-alignment: "viewport-glyph"`). The glyphs also keep one size and are spaced along the line as it appears on screen, so a name stays evenly spaced where the line runs away from the camera. Without `spreadGlyphs`, `rotateWithCamera: true` draws the label straight instead.

Only used when [`placement`](#placement) is `"line"` or `"line-center"`. `layer.update()` applies a new value to labels that are already shown.

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/), for example to keep a label in a cursive script or font word by word while the rest of the layer spreads its glyphs.

**Default:** `false`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["line"],
    placement: "line",
    textFacing: "flat",
    rotateWithCamera: false, // Follow the line, like a MapLibre street name
    spreadGlyphs: true
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

### textFacing

**Type:** `"upright" | "flat" | undefined`

**Description:** Whether the label lies in the screen plane or on the globe surface, as MapLibre's `text-pitch-alignment` (`"upright"` is `"viewport"`, `"flat"` is `"map"`). An upright label is never foreshortened, however the camera is pitched. `"flat"` lays the label on the globe surface around its anchor, following the globe's curvature so that long text stays on the surface instead of lifting off at its ends. A flat label reads as painted onto the surface and foreshortens with camera pitch.

On a point label, combine with [`rotateWithCamera`](#rotatewithcamera) for four behaviours:

| `textFacing` | `rotateWithCamera` | Result |
| --- | --- | --- |
| `"upright"` | `true` | Screen-aligned billboard (the default) |
| `"upright"` | `false` | In the screen plane, turned with the camera heading so the text reads along east-west (upside down when the camera faces south) |
| `"flat"` | `true` | Painted on the surface, turned so it always reads left to right |
| `"flat"` | `false` | Painted on the surface, north-up, turning with the map |

For labels along a line, see [`placement`](#placement).

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/) as `facing`.

**Default:** `"upright"`, or `"flat"` when `rotateWithCamera` is `false` (MapLibre's `"auto"`)

**Example:**

```typescript
{
  text: {
    textFacing: "flat"
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
