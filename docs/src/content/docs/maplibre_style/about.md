---
title: About
description: MapLibre Style support for Navara - render existing MapLibre styles on a 3D globe.
sidebar:
  order: 1
---

## What is maplibre_style?

`@navaramap/maplibre-style` provides `MapLibreStylePlugin`, which parses a [MapLibre Style](https://maplibre.org/maplibre-style-spec/) JSON specification and translates its sources and layers into Navara layer operations and per-feature evaluators. This enables existing MapLibre GL JS styles to be rendered on Navara's 3D globe with minimal changes.

The plugin handles:
- **Expression evaluation** - All MapLibre expressions (math, decision, lookup, zoom, etc.)
- **Background layers** - Mapped to globe color/opacity with intelligent caching
- **Multiple source types** - Vector, raster, raster-DEM, and GeoJSON
- **Symbol layers** - Text and icon rendering with SDF text and automatic decluttering
- **Font configuration** - Flexible font loading from CSS or direct font-faces

## Package Overview

```text
@navaramap/maplibre-style
  ├── MapLibreStylePlugin (main plugin class)
  └── Font helpers
        ├── fetchFontStyleOverrides (fetch fonts from CSS URLs)
        ├── fontFamilyToStyleOverrides (convert FontFamily to style overrides)
        └── convertFontFacesToFontFamilies (convert style font-faces to FontFamily)
```

## Installation

```bash
npm install @navaramap/maplibre-style
```

## Quick Start

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

## Key Features

### Expression Support

The supported [MapLibre expression operators](https://maplibre.org/maplibre-style-spec/expressions/) include:

- **Lookup:** `get`, `has`, `in`, `index-of`, `length`
- **Decision:** `case`, `match`, `coalesce`
- **Type:** `to-boolean`, `to-number`, `to-string`, `to-color`, `array`, `literal`, `typeof`
- **String:** `concat`, `upcase`, `downcase`
- **Math:** `+`, `-`, `*`, `/`, `%`, `^`, `sqrt`, `log10`, `ln`, `abs`, `ceil`, `floor`, `round`, `min`, `max`
- **Comparison:** `==`, `!=`, `>`, `>=`, `<`, `<=`
- **Logical:** `!`, `all`, `any`
- **Zoom:** `zoom` (uses current camera zoom, auto re-evaluation on zoom changes)
- **Geometry:** `geometry-type`, `id`, `properties`

### Background Layer Optimization

Background layers are intelligently managed:
- **Automatic caching** - Evaluators are compiled once and reused until the layer or paint changes
- **Zoom dependency detection** - Background is only re-evaluated when it uses zoom expressions or zoom constraints
- **Multiple layer support** - When multiple background layers exist, the last applicable layer (respecting `minzoom`/`maxzoom` and `visibility`) is used

### Font Configuration

Fonts can be loaded in multiple ways:
- **Direct from CSS** - `fetchFontStyleOverrides()` fetches from Google Fonts or other CSS URLs
- **Manual configuration** - `fontFamilyToStyleOverrides()` converts FontFamily objects
- **Style overrides** - Fonts are passed via the `overrides` option

See [Font Configuration](../maplibre-style-plugin/#with-font-configuration) for details.

## Relationship with Other Packages

```text
@navaramap/three (core: ThreeView, Plugin, Source, Layer)
  ├── @navaramap/three-default-plugin (DefaultPlugin: descriptor registration)
  └── @navaramap/maplibre-style (MapLibreStylePlugin: MapLibre Style support)
        └── Uses @maplibre/maplibre-gl-style-spec for expression evaluation
```

## What's Supported

The plugin supports a practical subset of the MapLibre Style Specification:

**Layer types:** `fill`, `fill-extrusion`, `line`, `circle`, `symbol`, `raster`, `hillshade`, `background`

**Source types:** `vector`, `raster`, `raster-dem`, `geojson`

**Expressions:** All operators including zoom-dependent expressions

See [Supported Features](../supported-features/) for a complete list of implemented properties.

## What's Not Supported

- **Sky and heatmap layers** - Not yet implemented
- **Sprite-based icons** - `fill-pattern`, `line-pattern` not supported
- **Advanced line styling** - Dasharray, gradient, caps, joins not implemented
- **Camera expressions** - `pitch`, `distance-from-center`, etc. not available
- **Glyphs protocol** - Use `font-faces` via style overrides instead

## Related Resources

- [MapLibreStylePlugin](../maplibre-style-plugin/) - Usage guide, API reference, and font configuration
- [Supported Features](../supported-features/) - Complete feature matrix
