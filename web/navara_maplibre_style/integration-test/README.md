# MapLibre Style render tests

Renders [maplibre-gl-js render test](https://github.com/maplibre/maplibre-gl-js/tree/main/test/integration/render)
fixtures with `MapLibreStylePlugin` and compares them against MapLibre's
expected images.

The fixtures are not in this repository. Before each run, the Playwright
global setup (`render/setup.ts`) checks out maplibre-gl-js
`test/integration/{assets,render/tests}` at the commit pinned in
`maplibre.lock.json` into `maplibre-gl-js/` (gitignored), keeping its layout.
The first run downloads about 120 MB; later runs fetch only when the lock
changes.

| Path                                            | Contents                                   |
| ----------------------------------------------- | ------------------------------------------ |
| `maplibre-gl-js/test/integration/assets/`       | tiles, sprites, glyphs, images             |
| `maplibre-gl-js/test/integration/render/tests/` | one directory per case                     |
| `render/render.test.ts`                         | the Playwright spec                        |
| `render/results.html`                           | the report                                 |
| `lib/`                                          | test page, comparison, case classification |
| [`ISSUES.md`](ISSUES.md)                        | differences found so far                   |

## Running

```bash
# at the repo root
pnpm build                    # the test page uses the built dist packages
pnpm test:maplibre            # Playwright; `pnpm test:maplibre -g circle` to filter
```

The plugin is served from `../src`, so plugin edits need no rebuild; other
`@navaramap` packages and WASM come from their dist builds (`pnpm build`,
`cargo make build`). When the run finishes, `render/results.html` opens in
the default browser (not when `CI` is set), with the cases this run updated
listed first.

To re-run only the cases a change affects, filter by tag. Each test is tagged
with the layer types, paint/layout properties, source types, and expression
operators its style uses:

```bash
pnpm test:maplibre -g @circle-radius
pnpm test:maplibre -g "@fill-opacity|@line-opacity"
```

Reviewing results is covered by the
[`navara-maplibre-render-review`](../../../skills/navara-maplibre-render-review/SKILL.md)
skill.

Each case directory gets `actual.png` (Navara), `diff.png` (pixelmatch), and
`result.json` next to MapLibre's `expected*.png`; `render/results.html` shows
Navara and MapLibre side by side. Results are meant for visual review —
compare `actual.png` with the expected image, an LLM first, then a human.
Nothing is asserted beyond the page rendering without an error. The pixelmatch
diff ratio, computed as in maplibre-gl-js, is only a hint: Navara renders a
globe and does not implement every style property.

The DEM fixtures cover only the zoom MapLibre loads, one level below the map
zoom for a 256 px source, while Navara picks a level by screen-space error.
Styles with a `raster-dem` source therefore run with `maxSse: 1` and without
LOD fog (`lib/test-page.ts`), so Navara loads those same tiles.

## Unsupported cases

Every case is listed, but one whose style uses anything
[`supported.json`](../../../docs/src/content/docs/maplibre_style/supported.json)
marks ❌ or omits (`lib/classify.ts`; this includes a source's own properties,
such as `bounds`), or that needs test operations or test
options (`metadata.test`) the harness does not handle, is skipped and tagged
`@unsupported`. The report lists those cases with the reasons, so a
supported.json change takes effect on the next run. Properties Navara ignores
without changing the result, such as `projection`, are marked ⚠️ in
supported.json rather than special-cased here.

To render them anyway, e.g. to check whether a feature can be marked
supported:

```bash
RENDER_INCLUDE_UNSUPPORTED=1 pnpm test:maplibre -g @fill-extrusion-pattern
```

## Updating fixtures

Set `commit` in `maplibre.lock.json` to another full SHA (e.g. from
`git ls-remote https://github.com/maplibre/maplibre-gl-js main`); the next run
checks it out. The fetch is shallow and sparse, and a failure leaves the
previous checkout.
