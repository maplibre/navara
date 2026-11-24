# Issues found by the MapLibre render tests

Found by visually reviewing `render/results.html` (Navara vs. MapLibre
expected images) for 224 supported cases at maplibre-gl-js `397dd408`.
Marking `projection`, `transition`, `sky.atmosphere-blend`, and
`raster-fade-duration` as ignored (⚠️) in supported.json has since made 38
more cases, mostly raster, supported; those are not reviewed yet.
Supporting `sprite` has made 110 more cases supported; the entries below cover
the ones reviewed (`sprites/*`, `icon-*`, `symbol-*`, `visibility/*`).

Each entry lists representative case ids (directories under
`maplibre-gl-js/test/integration/render/tests/`). "Verified" marks
causes confirmed in code or by experiment; everything else is an observation.
Delete an entry once its cases match, and narrow it when they match only
partly.

## Rendering

### Only the top-most background layer is used

Background layers are not composited. The top-most one alone sets the globe
color.

- `regressions/mapbox-gl-js#3819`: an opacity-0 green background above an
  opaque red one leaves the globe transparent; MapLibre shows red.
- `combinations/background-translucent--background-translucent`: Navara shows
  only the upper layer.

### Circles draw above layers listed after them

Circles are sprites drawn above the globe, while backgrounds, fills, and lines
are draped into its surface, so a circle shows on top whatever the layer
order.

- `combinations/circle-translucent--background-opaque`: the opaque blue
  background listed after the circles should cover them; Navara shows red
  circles on blue.
- `combinations/circle-translucent--fill-opaque`: the blue fill should cover
  the inner quarter of each red circle; Navara draws whole circles over it.

### Translucent colors are blended in linear space

- `combinations/background-opaque--fill-translucent`: a 50% blue fill over red
  is `(187, 0, 188)` in Navara and `(128, 0, 128)` in MapLibre.
- 0.5 composited in linear space and encoded back to sRGB gives ≈188, which
  matches Navara's value.
- Also visible in `fill-opacity/*`, `line-opacity/*`, `combinations/*`, and
  `regressions/mapbox-gl-native#7714`.
- Also in `fill-extrusion-opacity/*`: a 75% black extrusion over white is ≈137
  in Navara and 64 in MapLibre. Those cases still differ by about 66%, since
  the extrusion's sides are shaded differently too (see "Lighting").

### Draped features inherit a translucent background's opacity

- `combinations/background-translucent--fill-opaque`: an opaque blue fill over
  a 50% red background is `(137, 137, 255)` in Navara and pure blue in
  MapLibre.
- Fills and lines appear to be baked into the globe texture, which is then
  drawn with the background opacity.

### fill-extrusion draws above later 2D layers

The extrusions render once the scene has lights, which the harness adds
(see "Lighting" below); without them every extrusion is black.

- `combinations/fill-extrusion--fill-opaque` and
  `combinations/fill-extrusion-translucent--background-opaque`: a height-0
  extrusion listed below a fill or background still shows on top. MapLibre
  follows the layer order and shows only the upper layer.

### `interpolate-hcl` (legacy `colorSpace: "hcl"`) yields a different color

- `background-color/colorSpace-hcl`: Navara draws `(224, 38, 88)` and MapLibre
  `(245, 7, 53)`.
- `colorSpace-lab` matches.

### Symbol text is never drawn

Verified: the styles load fonts through `glyphs` (PBF glyph ranges), which the
plugin does not read, and `lib/test-page.ts` passes no font overrides, so the
plugin skips every `text-field` ("no font was provided"). Text layout and
placement are therefore untested here; a low `diffRatio` on a text-only case
only means both images are mostly background.

- Cases: `text-anchor/*`, `text-offset/*`, `text-variable-anchor/*`,
  `text-variable-anchor-offset/*`, `text-radial-offset/basic`.

### Vector-tile symbol layers draw no icons

Every case that draws `icon-image` from a vector tile source is blank, while
the same style from a GeoJSON source draws (`icon-image/property-function`,
`sprites/array-multiple`).

- Verified: the layer's billboard description is built correctly, but the
  plugin's evaluator never runs for these features (`featureCreated` does not
  fire, not even before the filter). A variant with no `sprite` and an image
  URL as `icon-image` is blank too, so sprites are not the cause. The cause is
  not found.
- Cases: `icon-offset/*`, `icon-translate/*`, `icon-translate-anchor/*`,
  `icon-pixelratio-mismatch/default`, `symbol-placement/*`,
  `symbol-spacing/*`, `linear-filter-opacity-edge/literal`,
  `visibility/icon/visible`, `visibility/symbol/visible`. A low `diffRatio`
  here only means both images are mostly background.
- `visibility/*/none` match because both images are blank.

### SDF sprite icons are not drawn as SDF

The plugin ignores `"sdf": true` in the sprite index, so the icon's distance
field is drawn as a plain image.

- Verified: `dot.sdf` has white RGB everywhere and its shape only in alpha. It
  is invisible on a white background, where MapLibre draws it in its default
  `icon-color`, black. With `icon-color` set, Navara draws a soft-edged blob
  where MapLibre draws a crisp shape (`icon-color/literal`).
- Cases that use `dot.sdf`: `icon-anchor/*`, `icon-color/*`,
  `icon-image/literal`, `icon-overlap/*`, `within/paint-icon`,
  `combinations/*symbol-translucent*`, `regressions/mapbox-gl-js#5576`,
  `regressions/mapbox-gl-native#11451`.
- `icon-halo-*`, `icon-text-fit`, and the index's `stretchX`/`stretchY`/
  `content` are not supported either (see supported.json).

## Style parsing and evaluation

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
