# Issues found by the MapLibre render tests

Found by visually reviewing `render/results.html` (Navara vs. MapLibre
expected images) for 224 supported cases at maplibre-gl-js `397dd408`.
Marking `projection`, `transition`, `sky.atmosphere-blend`, and
`raster-fade-duration` as ignored (⚠️) in supported.json has since made 38
more cases, mostly raster, supported; those are not reviewed yet.

Each entry lists representative case ids (directories under
`maplibre-gl-js/test/integration/render/tests/`). "Verified" marks
causes confirmed in code or by experiment; everything else is an observation.
Delete an entry once its cases match, and narrow it when they match only
partly.

## Rendering

### A style without a visible background layer paints the globe opaque black

MapLibre leaves the canvas transparent when no background layer is drawn;
Navara fills the globe with opaque black (`BackgroundHandler`'s
`applyDefaultBackground`, documented there as "MapLibre's fallback").

- Affects nearly every GeoJSON case. It also hides black features on top, for
  example the 50% black fills in `within/*`.
- Cases: `empty/empty`, `visibility/background/none`, `fill-color/*`,
  `geojson/*`, `within/*`.

### Only the top-most background layer is used

Background layers are not composited. The top-most one alone sets the globe
color.

- `regressions/mapbox-gl-js#3819`: an opacity-0 green background above an
  opaque red one leaves the globe transparent; MapLibre shows red.
- `combinations/background-translucent--background-translucent`: Navara shows
  only the upper layer.

### `circle-radius` is applied in meters, so circles vanish at low zoom

No circle appears in any case. The cause is the size unit, not the color.

- Verified: `createCircleLayer` in `src/adapters/toLayerDescription.ts`
  builds a `point` material without `sizeInMeters: false`, so
  `circle-radius: 8` becomes 8 m (the symbol materials in the same file do set
  it).
- The same `circle-color/literal` style viewed at z18 over a white background
  shows the blue circle. At the fixtures' z0–z2 it is sub-pixel, even over
  white.
- Once fixed in pixels, also check that `size` matches MapLibre's radius
  semantics (MapLibre's value is a radius, not a diameter).
- Cases: `circle-*/*`, `filter/*`, `regressions/mapbox-gl-js#4124`, `#4651`,
  `regressions/mapbox-gl-native#14402`, `combinations/*circle*`.

### Unset paint colors render white instead of the spec default (black)

- `fill-opacity/default`: the fill sets no `fill-color` and is drawn white;
  MapLibre draws it black.
- `line-join/default`, `line-width/*`, `line-pitch/*`: the lines set no
  `line-color` and are drawn white, invisible over the white background.
- `fill-extrusion-color/default`: the extrusion sets no color and is drawn
  white.

### Translucent colors are blended in linear space

- `combinations/background-opaque--fill-translucent`: a 50% blue fill over red
  is `(187, 0, 188)` in Navara and `(128, 0, 128)` in MapLibre.
- 0.5 composited in linear space and encoded back to sRGB gives ≈188, which
  matches Navara's value.
- Also visible in `fill-opacity/*`, `line-opacity/*`, `combinations/*`, and
  `regressions/mapbox-gl-native#7714`.

### Draped features inherit a translucent background's opacity

- `combinations/background-translucent--fill-opaque`: an opaque blue fill over
  a 50% red background is `(137, 137, 255)` in Navara and pure blue in
  MapLibre.
- Fills and lines appear to be baked into the globe texture, which is then
  drawn with the background opacity.

### fill-extrusion ignores opacity and draws above later 2D layers

The extrusions render once the scene has lights, which the harness adds
(see "Lighting" below); without them every extrusion is black.

- `fill-extrusion-opacity/*`: extrusions stay opaque; MapLibre blends them.
- `combinations/fill-extrusion--fill-opaque` and
  `combinations/fill-extrusion-translucent--background-opaque`: a height-0
  extrusion listed below a fill or background still shows on top. MapLibre
  follows the layer order and shows only the upper layer.
- `fill-extrusion-color/default`, `fill-extrusion-height/*`,
  `fill-extrusion-base/*`: the unset color is drawn white (see "Unset paint colors").

### hillshade relief is barely visible

- With the harness lights the terrain is an almost flat light gray; MapLibre
  draws strong relief with its own illumination
  (`hillshade-illumination-direction`, default 335°), independent of scene
  lights.
- `hillshade-*-color` paint properties have no effect (supported.json marks
  the layer ⚠️, "layer only").
- Cases: `hillshade-*/default`, `hillshade-accent-color/terrarium`,
  `hillshade-maxzoom/*`, `resampling/hillshade/default`.

### Overzoomed GeoJSON lines are partially missing

- `regressions/mapbox-gl-js#9009`: a GeoJSON source with `maxzoom: 10` is
  viewed at z18.
- Only part of the 20 px wide V-shaped line is drawn.

### `interpolate-hcl` (legacy `colorSpace: "hcl"`) yields a different color

- `background-color/colorSpace-hcl`: Navara draws `(224, 38, 88)` and MapLibre
  `(245, 7, 53)`.
- `colorSpace-lab` matches.

### GeoJSON longitudes outside ±180° are dropped

- In `projection/globe/antimeridian-overdraw/wide-band-*`, polygons given with
  longitudes such as 319° or -191° lose those parts. In `wide-band-pole-view`
  only slivers of the ring around the pole remain.
- MapLibre wraps them across the antimeridian.
- `geojson-crossing-z0`/`-z3`, whose coordinates stay within ±180°, match.

### A polygon covering the pole is not drawn

- `projection/globe/pole-cap`: a GeoJSON polygon spanning the eastern
  hemisphere up to 90°N, seen pitched from 85°N, is missing entirely.
- The background reaches the pole, and MapLibre draws the fill there too.

### A vector source's `scheme: "tms"` is ignored

- `tms/tms` requests `{z}-{x}-{y}.tms.mvt` with XYZ rows, so it hits tiles the
  fixture does not ship and renders nothing.
- Verified: `MapLibreStylePlugin` never reads `scheme`, and the engine's
  vector-tile source has no `tms` flag (`request_mvt_data` in
  `crates/navara_mvt` always builds URLs with `tms: false`). Raster and
  raster-dem sources already support it.

### Symbol text is never drawn

Verified: the styles load fonts through `glyphs` (PBF glyph ranges), which the
plugin does not read, and `lib/test-page.ts` passes no font overrides, so the
plugin skips every `text-field` ("no font was provided"). Text layout and
placement are therefore untested here; a low `diffRatio` on a text-only case
only means both images are mostly background.

- Cases: `text-anchor/*`, `text-offset/*`, `text-variable-anchor/*`,
  `text-variable-anchor-offset/*`, `text-radial-offset/basic`.

## Style parsing and evaluation

### CSS named colors are only partially supported

- `pink` (`fill-extrusion-multiple/interleaved-layers`) and `forestgreen`
  (`sparse-tileset/*`) fail with `Could not parse color from value '…'`.
- The evaluator or background layer is dropped as a result.

### Invalid color results raise errors instead of falling back to the default

- Expressions evaluating to `null`, `0`, or `"invalid"` log
  `Expression evaluation error: … CouldNotParse { ty: "color" … }`.
- MapLibre uses the property default instead.
- Cases: `global-state/default`, `regressions/mapbox-gl-js#4124`, `#4150`.

### Valid styles are rejected during validation

Both styles are valid for MapLibre, but `MapLibreStylePlugin` throws from
`init` and nothing is rendered. Verified: both causes are in
`RustStyleEngine.parseStyle` (`src/engine/RustStyleEngine.ts`).

- **Warnings are treated as errors.** `filter/mixed-legacy-expression` mixes
  legacy and expression filter syntax. The style spec (already in 26.2.1)
  reports this with `severity: "warning"`, and maplibre-gl-js stopped failing
  the load on warnings in
  [#7941](https://github.com/maplibre/maplibre-gl-js/pull/7941). `parseStyle`
  throws on any validation result, including warnings.
- **Validation runs after `migrate()`.** `regressions/mapbox-gl-js#4146` uses a
  legacy `interval` function with one stop. The original style validates
  cleanly, but `migrate()` (also in style-spec 26.4.4) turns it into
  `["step", input, "blue", 0, 0]`, which then fails validation (`Expected color
but found number`). maplibre-gl-js never migrates at render time.
- Likely fix: validate the original style, then migrate, and throw only on
  `severity` other than `"warning"`. Report the `migrate()` output upstream.

### TileJSON without a `tilejson` field is rejected

- `tilejson-bounds/overwrite-bounds`: `TileJsonPlugin: invalid or missing
"tilejson" version field`, so the source and its layer are dropped.
- MapLibre accepts such TileJSON.

### A style with only one of `center` and `zoom` gets no camera

Verified: `setupCameraFromStyle` and `applyCamera` in
`src/MapLibreStylePlugin.ts` return unless both are set, so the view keeps
Navara's default camera. MapLibre fills the missing one from its `Map`
defaults (`center: [0, 0]`, `zoom: 0`).

- 191 styles set only `zoom` and 2 only `center` (e.g.
  `background-pattern/zoomed`, `feature-state/promote-id-circle`,
  `regressions/mapbox-gl-js#4551`). Another 620 set neither, where keeping the
  application's camera may be intended.
- Hidden from the render tests: `lib/test-page.ts` fills in the same
  defaults before passing the style to the plugin.

## Packaging and docs

### `@navaramap/three` bundles part of three

- `web/navara_three/dist/index.js` contains three's
  `Multiple instances of Three.js being imported` registration code.
- Every page that also imports `three` logs the warning, even with
  `resolve.dedupe: ["three"]`.

## Expected differences (not bugs)

- **Lighting.** Navara lights fill-extrusion and hillshade only through scene
  lights, and the plugin adds none, so `lib/test-page.ts` adds a white `sun`
  (pinned to 60° elevation over the style center, no shadows) and an
  `ambient`. Shading therefore approximates MapLibre's default `light` but
  does not match it: MapLibre anchors the light to the viewport (azimuth
  210°).
- **Globe vs. Web Mercator.** Navara always renders a globe. At low zoom,
  straight lines bow (`line-opacity/*`, `regressions/mapbox-gl-native#7714`) and
  the globe's limb is visible inside 256 px canvases at z0
  (`sparse-tileset/*`, `line-join/default`).
- **Soft edges in small canvases.** Draped fills and lines have blurred edges
  in 64 px fixtures (`fill-color/*`, `line-layer-opacity/default`).
- **Draping blur at z0.** Small polygons are rounded at z0
  (`projection/globe/antimeridian-overdraw/geojson-z0`).
- **Vector tile zoom.** Navara picks vector tiles by screen-space error and
  can load a zoom level above MapLibre's. It shows only where every tile has
  the same content: `projection/globe/fill-seams/checkerboard` draws squares
  half the size.
- **404s for terrain tiles.** Navara requests `*.terrain.png` tiles MapLibre's
  fixtures do not ship; maplibre-gl-js's test server 404s them too.
