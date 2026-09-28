---
title: Supported Features
description: Complete list of supported MapLibre Style features and properties.
sidebar:
  order: 4
---

This page lists all MapLibre Style Spec features supported by `@navaramap/maplibre-style`. Only the properties listed below are actually implemented and functional. Other properties in the same layer type are parsed but ignored.

## Layer Types

### ✅ fill

Filled polygons.

**Supported Paint Properties:**
- `fill-color`
- `fill-opacity`

**Not Supported:**
- `fill-outline-color`, `fill-antialias`, `fill-translate`, `fill-pattern`, etc.

**Example:**

```json
{
  "id": "water",
  "type": "fill",
  "source": "vector-source",
  "source-layer": "water",
  "paint": {
    "fill-color": "#0080ff",
    "fill-opacity": 0.5
  }
}
```

### ✅ fill-extrusion

3D extruded polygons (buildings, terrain features).

**Supported Paint Properties:**
- `fill-extrusion-color`
- `fill-extrusion-opacity`
- `fill-extrusion-height`
- `fill-extrusion-base`

**Note:** Vertical height values only - no translation or pattern support.

**Example:**

```json
{
  "id": "buildings",
  "type": "fill-extrusion",
  "source": "vector-source",
  "source-layer": "buildings",
  "paint": {
    "fill-extrusion-color": "#cccccc",
    "fill-extrusion-height": ["get", "height"],
    "fill-extrusion-base": ["get", "min_height"],
    "fill-extrusion-opacity": 0.9
  }
}
```

### ✅ line

Lines and strokes.

**Supported Paint Properties:**
- `line-color`
- `line-opacity`
- `line-width`

**Not Supported:**
- `line-dasharray`, `line-pattern`, `line-cap`, `line-join`, `line-gradient`, etc.

**Example:**

```json
{
  "id": "roads",
  "type": "line",
  "source": "vector-source",
  "source-layer": "roads",
  "paint": {
    "line-color": "#ffffff",
    "line-width": 2,
    "line-opacity": 0.8
  }
}
```

### ✅ circle

Circular point features.

**Supported Paint Properties:**
- `circle-color`
- `circle-opacity`
- `circle-radius`

**Not Supported:**
- `circle-stroke-*`, `circle-blur`, `circle-translate`, `circle-pitch-scale`, etc.

**Example:**

```json
{
  "id": "cities",
  "type": "circle",
  "source": "geojson-source",
  "paint": {
    "circle-color": "#ff0000",
    "circle-radius": 5,
    "circle-opacity": 0.7
  }
}
```

### ✅ symbol

Icons and text labels.

**Supported Paint Properties:**
- `icon-color`
- `icon-opacity`
- `text-color`
- `text-opacity`
- `text-halo-color` (evaluated once at layer construction)
- `text-halo-width` (evaluated once at layer construction)

**Supported Layout Properties:**
- `icon-image`
- `icon-size`
- `text-field`
- `text-size`
- `text-font`

**Features:**
- Fonts configured via style overrides (see [Font Configuration](../maplibre-style-plugin/#with-font-configuration))
- `text-font` selects font from `font-faces` (supports string or array for fallback)
- `text-halo-color` and `text-halo-width` map to Navara's `outlineColor` and `outlineWidth`
- Text rendering uses SDF (signed distance field)
- Automatic label deduplication via Navara's declutter system

**Limitations:**
- `text-halo-*` expressions are evaluated once at layer construction, not per-feature or zoom-reactive
- `text-anchor`, `icon-anchor`, `text-offset`, `icon-offset` are parsed but not applied
- No text rotation or symbol sorting
- No sprite-based icons

**Example:**

```json
{
  "id": "place-labels",
  "type": "symbol",
  "source": "vector-source",
  "source-layer": "places",
  "layout": {
    "text-field": ["get", "name"],
    "text-font": ["Open Sans"],
    "text-size": 14
  },
  "paint": {
    "text-color": "#000000",
    "text-halo-color": "#ffffff",
    "text-halo-width": 2
  }
}
```

### ⚠️ raster (Layer)

Raster imagery display layer.

**Supported:**
- Basic raster tile display

**Not Supported:**
- Paint properties like `raster-opacity`, `raster-brightness-min`, `raster-brightness-max`, `raster-contrast`, `raster-saturation`, `raster-fade-duration`, etc. are parsed but not applied

**Example:**

```json
{
  "id": "satellite",
  "type": "raster",
  "source": "satellite-source"
}
```

### ⚠️ hillshade

Hillshade visualization of elevation data.

**Supported:**
- Basic hillshade rendering

**Not Supported:**
- No paint properties are processed

**Example:**

```json
{
  "id": "hillshade",
  "type": "hillshade",
  "source": "dem-source"
}
```

### ✅ background

Global background color/opacity.

**Supported Paint Properties:**
- `background-color`
- `background-opacity`

**Supported Layout Properties:**
- `visibility`

**Features:**
- Background layers are mapped to `view.globe.color` and `view.globe.opacity`
- No source required
- When multiple background layers exist, the last applicable layer (respecting `minzoom`/`maxzoom` and `visibility`) is used
- Background evaluators are cached and only recompiled when the active layer changes
- Zoom-dependent backgrounds (using zoom expressions or zoom constraints) are automatically re-evaluated on zoom changes

**Example:**

```json
{
  "id": "background",
  "type": "background",
  "paint": {
    "background-color": "#000033",
    "background-opacity": 0.8
  }
}
```

### ❌ Not Supported

- `sky` - Not implemented
- `heatmap` - Not implemented

## Source Types

### ✅ geojson

GeoJSON feature collections.

**Supported Formats:**

Inline data:
```json
{
  "type": "geojson",
  "data": {
    "type": "FeatureCollection",
    "features": [...]
  }
}
```

URL reference:
```json
{
  "type": "geojson",
  "data": "https://example.com/data.geojson"
}
```

### ✅ vector

Vector tiles (Mapbox Vector Tiles / MVT).

**Supported Formats:**

Direct tile URL:
```json
{
  "type": "vector",
  "tiles": ["https://example.com/{z}/{x}/{y}.pbf"]
}
```

TileJSON URL:
```json
{
  "type": "vector",
  "url": "https://example.com/tiles.json"
}
```

**Note:** Both `tiles` (direct URL array) and `url` (TileJSON) are supported.

### ✅ raster (Source)

Raster tile source for imagery.

**Supported Formats:**

Direct tile URL:
```json
{
  "type": "raster",
  "tiles": ["https://example.com/{z}/{x}/{y}.png"],
  "tileSize": 256
}
```

TileJSON URL:
```json
{
  "type": "raster",
  "url": "https://example.com/tiles.json"
}
```

**Note:** Both `tiles` and `url` (TileJSON) are supported.

### ✅ raster-dem

Raster elevation tiles.

**Supported Formats:**

Direct tile URL:
```json
{
  "type": "raster-dem",
  "tiles": ["https://example.com/{z}/{x}/{y}.png"],
  "encoding": "terrarium"
}
```

TileJSON URL:
```json
{
  "type": "raster-dem",
  "url": "https://example.com/tiles.json",
  "encoding": "terrarium"
}
```

**Supported Encodings:**
- `terrarium` - Terrarium format (Mapzen/AWS terrain tiles)
- `mapbox` - Mapbox RGB encoding

**Features:**
- Can be used with `terrain` property for 3D terrain rendering
- Both `tiles` and `url` (TileJSON) are supported

### ❌ Not Supported

- `image` - Not implemented
- `video` - Not implemented
- `canvas` - Not implemented

## Expression Support

The following commonly used [MapLibre expression operators](https://maplibre.org/maplibre-style-spec/expressions/) are supported:

### Lookup

- `get` - Get feature property value
- `has` - Check if feature has property
- `in` - Check if value is in array
- `index-of` - Find index of value in array
- `length` - Get array length

### Decision

- `case` - Conditional branching
- `match` - Pattern matching
- `coalesce` - First non-null value

### Type

- `to-boolean` - Convert to boolean
- `to-number` - Convert to number
- `to-string` - Convert to string
- `to-color` - Convert to color
- `array` - Assert array type
- `literal` - Literal array/object
- `typeof` - Get type name

### String

- `concat` - Concatenate strings
- `upcase` - Convert to uppercase
- `downcase` - Convert to lowercase

### Math

- `+`, `-`, `*`, `/`, `%`, `^` - Arithmetic operators
- `sqrt`, `log10`, `ln` - Logarithmic functions
- `abs`, `ceil`, `floor`, `round` - Rounding functions
- `min`, `max` - Min/max values

### Comparison

- `==`, `!=` - Equality
- `>`, `>=`, `<`, `<=` - Comparison

### Logical

- `!` - Logical NOT
- `all` - Logical AND
- `any` - Logical OR

### Zoom

- `zoom` - Current camera zoom level

**Features:**
- Uses current camera zoom for all features
- Features automatically re-evaluated when zoom changes > 0.1
- Smooth fade transitions for show/hide on zoom changes

### Geometry

- `geometry-type` - Feature geometry type
- `id` - Feature ID
- `properties` - Feature properties object

### Camera (Not Supported)

- `pitch` - Camera pitch angle (not available)
- `distance-from-center` - Distance from screen center (not available)

## Other Features

### Terrain

3D terrain rendering from raster-DEM sources.

**Example:**

```json
{
  "terrain": {
    "source": "dem-source",
    "exaggeration": 1.5
  }
}
```

### Font Faces

Font configuration for symbol layers.

**Example:**

```json
{
  "font-faces": {
    "Open Sans": [
      {
        "url": "https://fonts.gstatic.com/.../opensans.woff2",
        "unicode-range": "U+0-7F"
      }
    ]
  }
}
```

See [Font Configuration](../maplibre-style-plugin/#with-font-configuration) for details.

### Attribution

Source attribution is automatically handled when using TileJSON sources with the `url` field.

## Performance Optimizations

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

## Known Limitations

### Sources

- **Multiple tile URLs** - Only the first URL in a `tiles` array is used (load spreading not supported)

### Layers

- **Limited property support** - Many MapLibre Style Spec properties not implemented (see layer sections above)
- **No patterns or sprites** - `fill-pattern`, `line-pattern`, sprite-based icons not supported
- **No advanced line styling** - Dasharray, gradient, caps, joins not implemented
- **Limited raster support** - Basic display only, no paint properties
- **No heatmap layers** - Not yet implemented
- **No sky layers** - Not implemented

### Expressions

- **Camera expressions** - `pitch`, `distance-from-center`, etc. not available

### Symbol Layers

- **Text halo limitations** - `text-halo-color` and `text-halo-width` evaluated once at layer construction, not per-feature or zoom-reactive
- **No text rotation** - Limited support for rotated text
- **No symbol sorting** - z-order not controlled by `symbol-sort-key`
- **Text rendering differences** - SDF text may differ slightly from MapLibre GL JS

### Performance

- **Large feature counts** - Symbol layers with thousands of features may impact performance on lower-end devices
