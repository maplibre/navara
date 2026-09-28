---
title: MapLibreStylePlugin
description: Parse and render MapLibre Style specifications on Navara's 3D globe.
sidebar:
  order: 2
---

## Overview

`MapLibreStylePlugin` parses a [MapLibre Style](https://maplibre.org/maplibre-style-spec/) JSON specification and translates its sources and layers into Navara layer operations. This enables existing MapLibre GL JS styles to be rendered on Navara's 3D globe with minimal changes.

The plugin automatically handles:
- Expression evaluation (supported MapLibre operators, including zoom-dependent expressions)
- Background layers with intelligent caching
- Multiple source types (vector, raster, raster-DEM, GeoJSON)
- Symbol layers with SDF text rendering and automatic decluttering
- Font configuration from CSS or direct font-faces

## Basic Usage

Pass a MapLibre Style JSON to the plugin and add it before `view.init()`:

```typescript
import ThreeView from "@navaramap/three";
import { MapLibreStylePlugin } from "@navaramap/maplibre-style";
import style from "./style.json";

const view = new ThreeView({ container });
view.addPlugin(new MapLibreStylePlugin(style));
await view.init();

// Credit data sources
view.attribution?.add([
  {
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
]);
```

### Loading from URL

Load a style from a remote URL instead of a static JSON:

```typescript
const styleUrl = "https://example.com/style.json";
const plugin = new MapLibreStylePlugin(styleUrl);
view.addPlugin(plugin);
await view.init();
```

The plugin will fetch and parse the style during initialization.

## Advanced Usage

### With Font Configuration

To render text labels from symbol layers, pre-load fonts and pass them as style overrides:

```typescript
import { MapLibreStylePlugin, fetchFontStyleOverrides } from "@navaramap/maplibre-style";

const fontOverrides = await fetchFontStyleOverrides(
  "Open Sans",
  "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap",
);

const plugin = new MapLibreStylePlugin(style, {
  overrides: fontOverrides,
});
view.addPlugin(plugin);
await view.init();
```

#### Multiple Fonts

Load multiple fonts for different symbol layers:

```typescript
const [openSans, roboto] = await Promise.all([
  fetchFontStyleOverrides("Open Sans", googleFontsUrl1),
  fetchFontStyleOverrides("Roboto", googleFontsUrl2),
]);

const plugin = new MapLibreStylePlugin(style, {
  overrides: {
    "font-faces": {
      ...openSans["font-faces"],
      ...roboto["font-faces"],
    },
  },
});
```

#### Font Selection in Layers

Symbol layers use `text-font` to select fonts:

```json
{
  "layout": {
    "text-field": ["get", "name"],
    "text-font": ["Open Sans"]
  }
}
```

For fallback fonts, provide multiple options:

```json
{
  "layout": {
    "text-font": ["Noto Sans CJK", "Open Sans", "Arial"]
  }
}
```

**Note:** The `glyphs` property is not supported. Use `font-faces` via style overrides instead.

### With Custom TileJsonPlugin

Share a `TileJsonPlugin` instance across multiple plugins:

```typescript
import { TileJsonPlugin } from "@navaramap/three-plugins";
import { MapLibreStylePlugin } from "@navaramap/maplibre-style";

const tileJsonPlugin = new TileJsonPlugin();

const plugin = new MapLibreStylePlugin(style, {
  tileJsonPlugin,
});

view.addPlugin(tileJsonPlugin);
view.addPlugin(plugin);
await view.init();
```

When `tileJsonPlugin` is provided, the plugin will not create its own instance and will not dispose it.

### Style Overrides

Style overrides let you add font faces for text rendering without editing the original style JSON:

```typescript
const plugin = new MapLibreStylePlugin(style, {
  overrides: {
    // Add font-faces for text rendering
    "font-faces": {
      "Open Sans": [
        {
          url: "https://fonts.gstatic.com/.../opensans.woff2",
          "unicode-range": "U+0-7F",
        },
      ],
    },
  },
});
```

**Note:** Currently, only `font-faces` overrides are supported. Other properties (like `layers` or `sources`) are not merged.

### Zoom-Dependent Styles

The plugin automatically handles zoom-dependent expressions and re-evaluates features when zoom changes:

```typescript
const style = {
  version: 8,
  sources: {
    // ... sources
  },
  layers: [
    {
      id: "buildings",
      type: "fill-extrusion",
      source: "vector-source",
      "source-layer": "buildings",
      paint: {
        // Height grows with zoom
        "fill-extrusion-height": [
          "interpolate",
          ["linear"],
          ["zoom"],
          15,
          0,
          16,
          ["get", "height"],
        ],
        // Color changes with zoom
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14,
          "#cccccc",
          16,
          "#888888",
        ],
      },
    },
  ],
};
```

Features are automatically re-evaluated when zoom changes by more than 0.1, with smooth fade transitions.

### Background Layers

Background layers are mapped to the globe's color and opacity:

```typescript
const style = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#000033",
        "background-opacity": 0.8,
      },
    },
  ],
};
```

When multiple background layers exist, the last applicable layer (respecting `minzoom`/`maxzoom` and `visibility`) is used. Background can vary with zoom level using expressions.

### Complete Example

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";
import {
  MapLibreStylePlugin,
  fetchFontStyleOverrides,
} from "@navaramap/maplibre-style";

// Load fonts
const fontOverrides = await fetchFontStyleOverrides(
  "Open Sans",
  "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap",
);

// Load style
const style = await fetch("https://example.com/style.json").then(r => r.json());

// Create plugins
const view = new ThreeView({ container });
const tileJsonPlugin = new TileJsonPlugin();
const maplibrePlugin = new MapLibreStylePlugin(style, {
  overrides: fontOverrides,
  tileJsonPlugin,
});

// Add plugins
view.addPlugin(new DefaultPlugin());
view.addPlugin(tileJsonPlugin);
view.addPlugin(maplibrePlugin);

await view.init();

// Add attribution
view.attribution?.add([
  {
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
]);
```

## Constructor

```typescript
new MapLibreStylePlugin(
  styleOrUrl: StyleSpecification | string,
  options?: MapLibreStylePluginOptions
)
```

Creates a new MapLibre Style plugin instance.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `styleOrUrl` | `StyleSpecification \| string` | MapLibre Style JSON object or URL to fetch it from |
| `options` | `MapLibreStylePluginOptions` | Optional configuration |

### Options

```typescript
type MapLibreStylePluginOptions = {
  overrides?: Partial<StyleSpecification>;
  tileJsonPlugin?: TileJsonPlugin;
};
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `overrides` | `Partial<StyleSpecification>` | `undefined` | Partial style overrides; currently the plugin merges only `font-faces`. |
| `tileJsonPlugin` | `TileJsonPlugin` | `undefined` | Custom TileJsonPlugin instance. If not provided, a new one will be created and managed internally. |

### Example

```typescript
import { MapLibreStylePlugin } from "@navaramap/maplibre-style";

// With style object
const plugin = new MapLibreStylePlugin(styleJson);

// With style URL
const plugin = new MapLibreStylePlugin("https://example.com/style.json");

// With options
const plugin = new MapLibreStylePlugin(styleJson, {
  overrides: await fetchFontStyleOverrides("Open Sans", cssUrl),
});
```

## Methods

### dispose()

```typescript
dispose(): void
```

Cleans up all resources when the plugin is removed. Removes event listeners, deletes layers/sources, and disposes child plugins. Call this method when removing the plugin to prevent memory leaks.

After calling `dispose()`, the plugin instance should not be reused.

```typescript
plugin.dispose();
```

## Helper Functions

### fetchFontStyleOverrides()

```typescript
async function fetchFontStyleOverrides(
  familyName: string,
  cssUrl: string | string[]
): Promise<Partial<StyleSpecification>>
```

Fetches font files from a CSS URL (e.g., Google Fonts) and returns style overrides with `font-faces` configuration.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `familyName` | `string` | Font family name to register (e.g., "Open Sans") |
| `cssUrl` | `string \| string[]` | CSS URL(s) to fetch the font from |

#### Returns

`Promise<Partial<StyleSpecification>>` - Style overrides with `font-faces` field populated.

#### Example

```typescript
import { fetchFontStyleOverrides } from "@navaramap/maplibre-style";

const overrides = await fetchFontStyleOverrides(
  "Open Sans",
  "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap"
);

const plugin = new MapLibreStylePlugin(style, { overrides });
```

### fontFamilyToStyleOverrides()

```typescript
function fontFamilyToStyleOverrides(
  fontFamilies: FontFamily[]
): Partial<StyleSpecification>
```

Converts Navara `FontFamily` objects to MapLibre Style `font-faces` format.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fontFamilies` | `FontFamily[]` | Array of FontFamily objects to convert |

#### Returns

`Partial<StyleSpecification>` - Style overrides with `font-faces` field.

#### Example

```typescript
import { fetchFontFamilyFromCss } from "@navaramap/three";
import { fontFamilyToStyleOverrides } from "@navaramap/maplibre-style";

const openSans = await fetchFontFamilyFromCss(
  "Open Sans",
  "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap"
);

const roboto = await fetchFontFamilyFromCss(
  "Roboto",
  "https://fonts.googleapis.com/css2?family=Roboto:wght@400&display=swap"
);

const overrides = fontFamilyToStyleOverrides([openSans, roboto]);
const plugin = new MapLibreStylePlugin(style, { overrides });
```

### convertFontFacesToFontFamilies()

```typescript
function convertFontFacesToFontFamilies(
  fontFaces: FontFacesSpecification
): FontFamily[]
```

Converts MapLibre Style `font-faces` to Navara `FontFamily` objects. Useful for extracting fonts from an existing style.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fontFaces` | `FontFacesSpecification` | MapLibre Style font-faces object |

#### Returns

`FontFamily[]` - Array of Navara FontFamily objects.

#### Example

```typescript
import { convertFontFacesToFontFamilies } from "@navaramap/maplibre-style";

// Extract fonts from a style
const fontFamilies = convertFontFacesToFontFamilies(style["font-faces"]);

// Register fonts manually
for (const family of fontFamilies) {
  view.addFontFamily(family);
}
```

## Types

### MapLibreStylePluginOptions

```typescript
type MapLibreStylePluginOptions = {
  overrides?: Partial<StyleSpecification>;
  tileJsonPlugin?: TileJsonPlugin;
};
```

Configuration options for `MapLibreStylePlugin` constructor.

See [Constructor Options](#options) for details.

### StyleSpecification

Defined by `@maplibre/maplibre-gl-style-spec`. See the [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/) for the complete schema.

### FontFacesSpecification

Part of `StyleSpecification`, defines font files for text rendering:

```typescript
type FontFacesSpecification = {
  [familyName: string]:
    | FontFaceSpecification
    | FontFaceSpecification[];
};

type FontFaceSpecification = {
  url: string;
  "unicode-range"?: string | string[];
};
```

#### Example

```json
{
  "font-faces": {
    "Open Sans": [
      {
        "url": "https://fonts.gstatic.com/.../opensans-regular.woff2",
        "unicode-range": "U+0-7F"
      },
      {
        "url": "https://fonts.gstatic.com/.../opensans-japanese.woff2",
        "unicode-range": "U+3040-309F, U+30A0-30FF"
      }
    ]
  }
}
```

## Lifecycle

The plugin follows the standard Navara plugin lifecycle:

1. **Construction** - `new MapLibreStylePlugin(style, options)`
2. **Registration** - `view.addPlugin(plugin)` (before `view.init()`)
3. **Initialization** - `await view.init()` triggers the plugin's `init()` method
   - Fetches style from URL if needed
   - Parses and validates the style
   - Registers fonts from `font-faces`
   - Initializes background handler
   - Adds all sources and layers
   - Sets up zoom change detection
4. **Usage** - The plugin is now active and managing the style
5. **Disposal** - `plugin.dispose()` cleans up resources

## Performance

### Background Layer Caching

- Evaluators are compiled once and cached
- Only recompiled when the active layer or paint changes
- Zoom dependency detection skips unnecessary re-evaluations

### Zoom Change Detection

- Features only re-evaluated when zoom changes > 0.1
- Layers without zoom dependencies skip re-evaluation
- Smooth fade transitions minimize visual discontinuities

### Expression Compilation

- Expressions compiled once per layer at initialization
- Evaluators reused for all features in the layer
- Cached evaluators persist until paint properties change

## Related Resources

- [Supported Features](../supported-features/) - Complete feature matrix
- [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/) - Official spec
