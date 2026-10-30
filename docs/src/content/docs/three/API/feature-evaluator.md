---
title: FeatureEvaluator
description: API Reference for FeatureEvaluator class
sidebar:
  order: 960
---

FeatureEvaluator is a class that provides access to feature data and dynamic styling of features based on their properties. It can be obtained through the `featureCreated` and `featureUpdated` events of a Layer.

This class allows you to:
- Read feature properties from data sources
- Dynamically style features based on their properties

:::note
For detailed parameter types of events, see [Descriptor Types](../desc-types#events).
:::

## Properties

### id

**Type:** `FeatureSetId`

**Description:** Gets the unique identifier of this feature set.

**Example:**

```typescript
layer.on("featureCreated", ({ evaluator }) => {
  console.log("Feature ID:", evaluator.id);
});
```

## Types

### FeatureInfo

```typescript
type FeatureInfo = {
  batchId: number;
  properties: Record<string, unknown> | undefined;
  layerId: string | undefined;
};
```

### FeatureEvaluatorCallback

```typescript
type FeatureEvaluatorCallback = (
  info: FeatureInfo,
) => Partial<EvaluatedValue>;
```

## Methods

### readFeatureProperties()

Reads the properties of this feature from the data source. The callback is invoked for each batch within this feature.

**Syntax:**

```typescript
readFeatureProperties(
  f: (info: FeatureInfo) => void
): void
```

**Parameters:**

- `f`: A callback function that receives a FeatureInfo object for each batch

**Example:**

```typescript
// Log all properties
evaluator.readFeatureProperties(({ batchId, properties }) => {
  console.log(`Batch ${batchId}:`, properties);
});

evaluator.readFeatureProperties(({ properties }) => {
  const attributes = properties?.["attributes"] ?? {};
  const minHeight = attributes["minHeight"];
  const maxHeight = attributes["maxHeight"];
  console.log("Height range:", minHeight, "-", maxHeight);
});
```

### readFilteredFeatureProperties()

Reads only the specified root property keys of this feature from the data source. More efficient than `readFeatureProperties()` when only a few properties are needed.

**Syntax:**

```typescript
readFilteredFeatureProperties(
  keys: string[],
  f: (info: FeatureInfo) => void
): void
```

**Parameters:**

- `keys`: An array of root property keys to read
- `f`: A callback function that receives a FeatureInfo object with only the filtered properties

**Example:**

```typescript
evaluator.readFilteredFeatureProperties(["height", "name"], ({ batchId, properties }) => {
  console.log(`Batch ${batchId}: height=${properties?.["height"]}, name=${properties?.["name"]}`);
});
```

### evaluate()

Evaluates and applies dynamic styles to features based on their properties. The callback is invoked for each batch (sub-feature) within this feature.

**Syntax:**

```typescript
evaluate(
  f: FeatureEvaluatorCallback,
  options?: {
    filters?: string[];
  }
): void
```

**Parameters:**

- `f`: A callback function that receives a FeatureInfo object and returns style values
- `options`: Optional configuration
  - `options.filters`: An array of root property keys to read. When specified, only the matched properties are passed to the callback, improving performance for large datasets.

**Returns:**

The callback function can return an object containing the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `color` | `Color` | Feature color (using `new Color()`) |
| `show` | `boolean` | Feature visibility (show/hide) |
| `height` | `number` | Feature height (meters) |
| `extrudedHeight` | `number` | Polygon extrusion height (meters) |
| `text` | `string` | Label text content (for text/label features) |
| `width` | `number` | Line width (pixels, for polyline features) |
| `dashArray` | `number[]` | Dash and gap lengths in line widths (for polyline features). An empty array draws the feature solid. Overrides the material's [`dashArray`](../../../three/material/polyline-material/#dasharray) |
| `cap` | `"butt" \| "round" \| "square"` | Shape of the ends of each dash (for polyline features). Overrides the material's [`cap`](../../../three/material/polyline-material/#cap) |
| `size` | `number` | Point/text size (meters or pixels, for point/text features) |
| `letterSpacing` | `number` | Extra space between characters in ems (for text features). Overrides the material's [`letterSpacing`](../../../three/material/text-material/#letterspacing) |
| `opacity` | `number` | Feature opacity, range 0.0-1.0 (for polygons/points/billboards/models/text) |
| `declutterPriority` | `number` | Placement priority for decluttering. Higher wins an overlap (for points/billboards/text with [`declutter`](../../../three/material/text-material/#declutter) enabled). Overrides the layer's `declutterPriority`, but never the material's [`declutterRank`](../../../three/material/text-material/#declutterrank), which is compared first |
| `image` | `string \| null` | Image URL (for billboard features). Each distinct URL is loaded once and packed into the layer's texture atlas. Return `null` to clear a previous per-feature image and revert to the billboard material's default `url` (the feature becomes invisible if the material has no `url`) |
| `facing` | `"upright" \| "flat"` | Whether the point, billboard, or label lies in the screen plane (`"upright"`) or on the globe surface (`"flat"`) (for points/billboards/text). Overrides the value the material's `pointFacing`/`billboardFacing`/`textFacing` resolves to |
| `rotateWithCamera` | `boolean` | Whether the point, billboard, or label turns with the camera (`true`) or with the map (`false`) (for points/billboards/text). Along a line, `false` makes a label follow the line, and `true` draws it straight unless `spreadGlyphs` is set. Overrides the value the material's `rotateWithCamera` resolves to |
| `spreadGlyphs` | `boolean` | Whether the label places each glyph on its own along its line (for text placed along a line). Overrides the material's `spreadGlyphs`, for example to keep cursive scripts or fonts word by word in a layer that spreads the rest |
| `rotation` | `number` | In-plane rotation, in degrees, clockwise as seen from the front (for points/billboards/text). It turns the feature around its anchor, except that a label following a line spins each glyph about its own center. Lets every feature in one layer point a different way. Overrides the material's `rotation` |
| `anchor` | `"center" \| "left" \| "right" \| "top" \| "bottom" \| "top-left" \| "top-right" \| "bottom-left" \| "bottom-right"` | Which part of the point, billboard, or label sits on its position (for points/billboards/text). Overrides the material's `anchor` (see [`anchor`](../../../three/material/text-material/#anchor)) |
| `offset` | `{ x: number, y: number }` | Shift from the anchor point, `x` right and `y` down: in ems for text, in the unit of `size` for points and billboards. Overrides the material's `offset` (see [`offset`](../../../three/material/text-material/#offset)) |
| `variableAnchors` | `{ anchor: Anchor, offset?: { x: number, y: number } }[]` | Placements the declutter pass tries in order for this label (for text features), offsets in ems. Overrides the material's [`variableAnchors`](../../../three/material/text-material/#variableanchors) |
| `textAlign` | `"left" \| "center" \| "right" \| "auto"` | Line justification (for text features). `"auto"` follows the label's `anchor`. Overrides the material's [`textAlign`](../../../three/material/text-material/#textalign) |
| `emissive` | `Color` | Emissive color (for batched polygons/3D Tiles models/points/billboards/text, ignored on models without batch/feature ids). Pairs with `emissiveIntensity` and drives selective bloom. On text only the glyph fill glows, while the outline and background stay dark |
| `emissiveIntensity` | `number` | Emissive intensity multiplier (for batched polygons/3D Tiles models/points/billboards/text) |

:::note
Evaluated styles override the layer's default styles.
:::

Per-feature `facing` and `rotateWithCamera` are not resolved like MapLibre's `"auto"`. Each replaces only its own half of the orientation the material resolved, so returning only `rotateWithCamera: false` for a point label keeps it upright, turned with the camera heading. Return `facing: "flat"` as well for a north-up label on the surface.

**Example:**

```typescript
import { Color } from "@navaramap/three";

// Color 3D Tiles buildings by height
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => {
    const measuredHeight = properties?.["height"] as number;

    const color = (() => {
      if (measuredHeight < 30) return new Color().setStyle("#00ff00");
      if (measuredHeight < 60) return new Color().setStyle("#ffff00");
      if (measuredHeight < 90) return new Color().setStyle("#ff00ff");
      return new Color().setStyle("#ff0000");
    })();

    return {
      color,
      show: measuredHeight >= 30, // Hide low buildings
    };
  });
});
```

```typescript
// Apply property-based extrusion to GeoJSON polygons
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => {
    const height = (properties?.["height"] as number) ?? 0;
    const extrudedHeight = (properties?.["extrudedHeight"] as number) ?? 0;

    return {
      height,
      extrudedHeight,
    };
  });
});
```

```typescript
// Color MVT features by category property
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => {
    const category = properties?.["category"] as string;

    const color = (() => {
      if (category === "A") return "#0000ff";
      if (category === "B") return "#00ff00";
      return "#ff0000";
    })();

    return {
      color: new Color().setStyle(color),
    };
  });
});
```

```typescript
// Filter and style text labels
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => {
    const text = properties?.["name"] as string;

    return {
      text,
      show: !!text,
    };
  });
});
```

```typescript
// Set per-feature billboard images based on a property
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(
    ({ properties }) => {
      const icon = properties?.["icon"] as string | undefined;
      // Features without an icon fall back to the billboard material's
      // default url; `image: null` also clears a previously set image
      return { image: icon ? `/icons/${icon}.svg` : null };
    },
    { filters: ["icon"] },
  );
});
```

```typescript
// Rank city labels above village labels when decluttering
const TIER_PRIORITY: Record<number, number> = { 1: 3, 2: 2, 3: 1 };

layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => ({
    text: properties?.["name"] as string,
    declutterPriority: TIER_PRIORITY[properties?.["tier"] as number] ?? 0,
  }));
});
```

```typescript
// Highlight selected feature with pick event
let selectedId: string | undefined;

// Select feature on click
view.on("featureClick", (info) => {
  selectedId = info?.properties?.["id"] as string;
  layer.forceUpdate(); // Re-evaluate styles
});

// Change color based on selection state
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => {
    const id = properties?.["id"] as string;

    return {
      color: new Color().setHex(selectedId === id ? 0xff0000 : 0xffffff),
    };
  });
});
```

```typescript
// Make features glow per property via selective bloom
// (the layer's material must list the bloom effect in `effectIds`)
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(
    ({ properties }) => ({
      emissive: new Color().setStyle("#7fd0ff"),
      emissiveIntensity: (properties?.["glow"] as number) ?? 0,
    }),
    { filters: ["glow"] },
  );
});
```

## EvaluatedValue Type

Type definition that can be returned from the `evaluate()` callback:

```typescript
type EvaluatedValue = {
  /** Feature color */
  color?: Color;
  /** Feature visibility (show/hide) */
  show?: boolean;
  /** Polygon extrusion height (meters) */
  extrudedHeight?: number;
  /** Feature height (meters) */
  height?: number;
  /** Label text content */
  text?: string;
  /** Line width (pixels, for polyline features) */
  width?: number;
  /** Point/text size (meters or pixels, for point/text features) */
  size?: number;
  /** Extra space between characters in ems (for text features). Overrides
   * the material's `letterSpacing` */
  letterSpacing?: number;
  /** Feature opacity, range 0.0-1.0 (for polygons/points/billboards/models/text) */
  opacity?: number;
  /** Placement priority for decluttering; higher wins an overlap (for
   * points/billboards/text with `declutter` enabled). Overrides the
   * layer's `declutterPriority` */
  declutterPriority?: number;
  /** Image URL (for billboard features); each distinct URL is loaded once and
   * packed into the layer's texture atlas. `null` clears a previous
   * per-feature image, reverting to the billboard material's default url */
  image?: string | null;
  /** Whether the point, billboard, or label lies in the screen plane
   * ("upright") or on the globe surface ("flat") (for points/billboards/text).
   * Overrides the material's facing option */
  facing?: "upright" | "flat";
  /** Whether the point, billboard, or label turns with the camera (`true`) or
   * with the map (`false`) (for points/billboards/text). Along a line, `false`
   * makes a label follow the line */
  rotateWithCamera?: boolean;
  /** Whether the label places each glyph on its own along its line (for
   * text placed along a line) */
  spreadGlyphs?: boolean;
  /** In-plane rotation, in degrees, clockwise as seen from the front (for
   * points/billboards/text). A label following a line spins each glyph about
   * its own center */
  rotation?: number;
  /** Which part of the point, billboard, or label sits on its position (for
   * points/billboards/text). Overrides the material's `anchor` */
  anchor?:
    | "center"
    | "left"
    | "right"
    | "top"
    | "bottom"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right";
  /** Shift from the anchor point, `x` right and `y` down: in ems for text, in
   * the unit of `size` for points and billboards. Overrides the material's
   * `offset` */
  offset?: { x: number; y: number };
  /** Placements the declutter pass tries in order (for text features),
   * offsets in ems. Overrides the material's `variableAnchors` */
  variableAnchors?: {
    anchor: NonNullable<EvaluatedValue["anchor"]>;
    offset?: { x: number; y: number };
  }[];
  /** Line justification (for text features); `"auto"` follows `anchor`.
   * Overrides the material's `textAlign` */
  textAlign?: "left" | "center" | "right" | "auto";
  /** Emissive color (for batched polygons/3D Tiles models/points/billboards/
   * text; ignored on models without batch/feature ids). Pairs with
   * `emissiveIntensity` and drives selective bloom. On text only the glyph
   * fill glows, while the outline and background stay dark */
  emissive?: Color;
  /** Emissive intensity multiplier (for batched polygons/3D Tiles
   * models/points/billboards/text) */
  emissiveIntensity?: number;
};
```

:::tip[Recommendation]
Only return the properties you want to change from `evaluate()`. All properties are optional.
:::
