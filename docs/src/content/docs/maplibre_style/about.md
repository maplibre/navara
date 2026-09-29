---
title: About
description: MapLibre Style support for Navara - render existing MapLibre styles on a 3D globe.
sidebar:
  order: 1
---

:::warning[Experimental Feature]
The MapLibre Style plugin is currently experimental. APIs may change, and some features are not yet fully implemented. See [Supported Features](../supported-features/) for details on current limitations.
:::

## What is maplibre_style?

`@navaramap/maplibre-style` provides `MapLibreStylePlugin`, which parses a [MapLibre Style](https://maplibre.org/maplibre-style-spec/) JSON specification and translates its sources and layers into Navara layer operations and per-feature evaluators. This enables existing MapLibre GL JS styles to be rendered on Navara's 3D globe with minimal changes.

The plugin handles:
- **Expression evaluation** - Supported MapLibre expressions (math, decision, lookup, zoom, etc.)

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

See [MapLibreStylePlugin Usage](../maplibre-style-plugin/) for examples.

## Relationship with Other Packages

```text
@navaramap/three (core: ThreeView, Plugin, Source, Layer)
  ├── @navaramap/three-default-plugin (DefaultPlugin: descriptor registration)
  └── @navaramap/maplibre-style (MapLibreStylePlugin: MapLibre Style support)
        └── Uses @maplibre/maplibre-gl-style-spec for expression evaluation
```

## Features and Limitations

The plugin supports a practical subset of the MapLibre Style Specification, including common layer types (fill, line, circle, symbol, etc.), multiple source types (vector, raster, GeoJSON), and most expression operators.

For a complete list of supported features, limitations, and implementation details, see the [Supported Features](../supported-features/) page.

## Related Resources

- [MapLibreStylePlugin](../maplibre-style-plugin/) - Usage guide, API reference, and font configuration
- [Supported Features](../supported-features/) - Complete feature matrix
