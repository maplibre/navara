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
| `size` | `number` | Point/text size (meters or pixels, for point/text features) |
| `opacity` | `number` | Feature opacity, range 0.0-1.0 (for polygons/points/billboards/models/text) |
| `declutterPriority` | `number` | Placement priority for decluttering. Higher wins an overlap (for points/billboards/text with [`declutter`](../../../three/material/text-material/#declutter) enabled). Overrides the layer's `declutterPriority` |
| `image` | `string \| null` | Image URL (for billboard features). Each distinct URL is loaded once and packed into the layer's texture atlas. Return `null` to clear a previous per-feature image and revert to the billboard material's default `url` (the feature becomes invisible if the material has no `url`) |
| `emissive` | `Color` | Emissive color (for batched polygons/3D Tiles models/points/billboards/text, ignored on models without batch/feature ids). Pairs with `emissiveIntensity` and drives selective bloom. On text only the glyph fill glows, while the outline and background stay dark |
| `emissiveIntensity` | `number` | Emissive intensity multiplier (for batched polygons/3D Tiles models/points/billboards/text) |

:::note
Evaluated styles override the layer's default styles.
:::

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
