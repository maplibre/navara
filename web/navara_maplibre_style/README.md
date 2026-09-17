# @navaramap/maplibre-style

MapLibre Style support for Navara. This package provides `MapLibreStylePlugin`, which parses a [MapLibre Style](https://maplibre.org/maplibre-style-spec/) JSON specification and translates its sources and layers into Navara layer operations and per-feature evaluators, so existing styles can be rendered on Navara's 3D globe.

## Supported Features

### Layer Types & Properties

Only the properties listed below are actually implemented and functional. Other MapLibre Style Spec properties in the same layer type are parsed but ignored.

#### ✅ `fill`

- **Paint:** `fill-color`, `fill-opacity`
- **Note:** `fill-outline-color`, `fill-antialias`, `fill-translate` etc. are not supported

#### ✅ `fill-extrusion`

- **Paint:** `fill-extrusion-color`, `fill-extrusion-opacity`, `fill-extrusion-height`, `fill-extrusion-base`
- **Note:** Vertical height values only (no translation or pattern support)

#### ✅ `line`

- **Paint:** `line-color`, `line-opacity`, `line-width`
- **Note:** `line-dasharray`, `line-pattern`, `line-cap`, `line-join` are not supported

#### ✅ `circle`

- **Paint:** `circle-color`, `circle-opacity`, `circle-radius`
- **Note:** `circle-stroke-*`, `circle-blur`, `circle-translate` are not supported

#### ✅ `symbol`

- **Paint:** `icon-color`, `icon-opacity`, `text-color`, `text-opacity`, `text-halo-color`, `text-halo-width`
- **Layout:** `icon-image`, `icon-size`, `text-field`, `text-size`, `text-font`
- **Note:**
  - Font configuration is done via plugin options (see Font Configuration section below), not through `text-font` property
  - `text-halo-color` and `text-halo-width` map to Navara's `outlineColor` and `outlineWidth` for constant values; expressions are currently evaluated once at layer construction (no feature-driven or zoom-reactive halo yet)
  - `text-anchor`, `icon-anchor`, `text-offset`, `icon-offset` are parsed but not applied
  - Text rendering uses SDF (signed distance field)
  - Automatic label deduplication via Navara's declutter system
  - No text rotation or symbol sorting

#### ⚠️ `hillshade`

- **Paint:** No paint properties are processed

#### ⚠️ `raster`

- **Paint:** No paint properties are processed (raster displays as-is from source)
- **Note:**
  - Properties like `raster-opacity`, `raster-brightness`, `raster-contrast` are parsed but not applied
  - Basic raster tile display only

#### ✅ `background`

- **Paint:** `background-color`, `background-opacity`
- **Layout:** `visibility`
- **Note:** Background layers are mapped to `view.globe.color` and `view.globe.opacity`. No source required.

#### ❌ Not Supported

- `sky`: Not implemented
- `heatmap`: Not implemented

### Source Types

#### ✅ `geojson`

```json
{
  "type": "geojson",
  "data": { "type": "FeatureCollection", "features": [...] }
}
```

or

```json
{
  "type": "geojson",
  "data": "https://example.com/data.geojson"
}
```

#### ✅ `vector`

```json
{
  "type": "vector",
  "tiles": ["https://example.com/{z}/{x}/{y}.pbf"]
}
```

or

```json
{
  "type": "vector",
  "url": "https://example.com/tiles.json"
}
```

- **Note:** Both `tiles` (direct URL array) and `url` (TileJSON) are supported

#### ✅ `raster`

```json
{
  "type": "raster",
  "tiles": ["https://example.com/{z}/{x}/{y}.png"],
  "tileSize": 256
}
```

or

```json
{
  "type": "raster",
  "url": "https://example.com/tiles.json"
}
```

- **Note:** Both `tiles` and `url` (TileJSON) are supported

#### ✅ `raster-dem`

```json
{
  "type": "raster-dem",
  "tiles": ["https://example.com/{z}/{x}/{y}.png"],
  "encoding": "terrarium" | "mapbox"
}
```

or

```json
{
  "type": "raster-dem",
  "url": "https://example.com/tiles.json",
  "encoding": "terrarium" | "mapbox"
}
```

- Supports `terrarium` and `mapbox` encodings
- Can be used with `terrain` property for 3D terrain rendering
- Both `tiles` and `url` (TileJSON) are supported

#### ❌ Not Supported

- `image`, `video`, `canvas`: Not implemented

### Expression Support

All [MapLibre expression operators](https://maplibre.org/maplibre-style-spec/expressions/) are supported:

- **Lookup:** `get`, `has`, `in`, `index-of`, `length`
- **Decision:** `case`, `match`, `coalesce`
- **Type:** `to-boolean`, `to-number`, `to-string`, `to-color`, `array`, `literal`, `typeof`
- **String:** `concat`, `upcase`, `downcase`
- **Math:** `+`, `-`, `*`, `/`, `%`, `^`, `sqrt`, `log10`, `ln`, `abs`, `ceil`, `floor`, `round`, `min`, `max`
- **Comparison:** `==`, `!=`, `>`, `>=`, `<`, `<=`
- **Logical:** `!`, `all`, `any`
- **Zoom:** `zoom` ✅ Uses current camera zoom for all features
- **Geometry:** `geometry-type`, `id`, `properties`

## Usage

Pass the style JSON to the plugin and add it before `view.init()`:

```typescript
import ThreeView from "@navaramap/three";
import { MapLibreStylePlugin } from "@navaramap/maplibre-style";
import style from "./style.json";

const view = new ThreeView();
view.addPlugin(new MapLibreStylePlugin(style)); // must happen before init()
await view.init();

// Credit the style's data sources through the built-in attribution UI.
view.attribution?.add([
  {
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
]);
```

### Font Configuration

To render text labels from symbol layers, pre-load fonts and pass them to the plugin:

```typescript
import { fetchFontFamilyFromCssForMapLibreStyle } from "@navaramap/maplibre-style";

const fontFamily = await fetchFontFamilyFromCssForMapLibreStyle(
  "Open Sans",
  "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap",
);

const plugin = new MapLibreStylePlugin(style, { fontFamily });
view.addPlugin(plugin);
```

When fonts are configured, all symbol layers will use the provided font family, and the style's `text-font` and `glyphs` properties are ignored.

## Known Limitations

### Sources

- **TileJSON support**: Both `url` (TileJSON) and `tiles` (direct URL array) are supported for vector, raster, and raster-dem sources

### Layers

- **Limited property support**: Many MapLibre Style Spec properties are not implemented (see layer types section above for supported properties)
- **No patterns or sprites**: `fill-pattern`, `line-pattern`, sprite-based icons not supported
- **No advanced line styling**: Dasharray, gradient, caps, joins not implemented
- **Limited raster support**: Raster layers have basic support but may not render identically to MapLibre GL JS
- **No heatmap layers**: Not yet implemented
- **No sky layers**: Not implemented

### Expressions

- **Zoom support**: The `zoom` expression uses the current camera zoom. Features are automatically re-evaluated when zoom changes significantly (> 0.1), with smooth fade transitions for show/hide
- **Camera expressions not supported**: `pitch`, `distance-from-center`, etc. are not available

### Symbol Layers

- **Text rendering**: Uses SDF (signed distance field) text rendering, which may differ slightly from MapLibre GL JS
- **Label deduplication**: Automatic deduplication of overlapping labels via Navara's declutter system with 300ms fade animations
- **Text rotation**: Limited support for rotated text
- **No symbol sorting**: z-order not controlled by `symbol-sort-key`

### Performance

- **Large feature counts**: Symbol layers with thousands of features may have performance implications on lower-end devices

## Documentation

See https://navara.world/docs/ for the full Navara documentation.

## License

MIT OR Apache-2.0
