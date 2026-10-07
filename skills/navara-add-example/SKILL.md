---
name: navara-add-example
description: >
  Conventions for adding or modifying examples in web/navara_three/example.
  Use when creating a new example page, editing an existing one, registering it
  in the gallery, or generating its screenshot.
---

# Adding a navara_three example

**First read [.claude/skills/navara-usage/SKILL.md](../navara-usage/SKILL.md)** (and the reference file matching your example's topic) for correct API usage. The canonical process doc is `web/navara_three/example/README.md` — follow it for *process* (directories, dev server, screenshots). For *code style*, prefer this skill's boilerplate: the README's code template predates the current conventions (it uses `addDefaultAtmosphereLayers()` and inline `data` instead of DefaultPlugin + source/layer split).

## Philosophy (from README — enforced in review)

> "Don't hide our API inside abstractions in the example"

- Call `view.addLayer()`, `layer.on("featureUpdated", ...)`, `layer.update()` directly — no wrapper functions that obscure API calls.
- One example = one feature. Don't combine unrelated features.

## Two example tracks — and who decides what goes where

1. **Dev/demo examples (the default track):** `pages/<name>/` (URL `/<name>`) or `pages/<category>/<name>/` (URL `/<category>-<name>`). Existing category dirs: `styling/`, `terrain/`, `plugins/`, `use-cases/`, `debug/`, `mesh-layers/`, or root (uncategorized). A directory only acts as a category when it has **no** `main.ts` of its own (see `vite.config.example.ts`) — e.g. `pages/atmosphere/` and `pages/camera/` are single examples, not categories, and the README's `basic/`/`effects/` categories don't exist yet. New examples — including anything for development or debugging — go here.
2. **Curated gallery:** `pages/examples/<section>/<name>/` with a `meta.ts` next to `main.ts`.

   **The gallery is curated, not exhaustive.** Pages under `pages/examples/` require **design approval** and are planned against the gallery's overall design. Never add a page there for development/debug purposes, and never add one proactively "for coverage" the way docs pages are added — only add a gallery example when explicitly asked to, with the placement already decided.

   Sections and the `ExampleMeta` type are declared in `pages/examples/sections.ts` (`getting-started`, `2d`, `2.5d`, `3d`, `basemap`, `terrain`, `source`, `styling`, `interaction`, `lighting-effect`). `meta.ts` shape:

```typescript
import type { ExampleMeta } from "../../sections";

export default {
  section: "getting-started",
  order: 1,
  title: { en: "Hello World", ja: "Hello World" },
  description: { en: "One-line summary.", ja: "一行の説明。" },
  docs: "three/tutorial/basic-visualization",   // docs-site path or absolute URL
} satisfies ExampleMeta;
```

Provide both `en` and `ja` for title/description (a bare string is a fallback for all languages).

## File structure convention

Non-trivial examples split into two files:

```typescript
// main.ts — thin entry: construct the view, delegate
import ThreeView from "@navaramap/three";
import { run, type CustomDescriptions } from "./run";
const view = new ThreeView<CustomDescriptions>({ shadow: true });
run(view);
```

```typescript
// run.ts — the actual logic
export type CustomDescriptions = DefaultDescriptions;  // or a union adding custom descriptors
export const run = async (view: ThreeView<CustomDescriptions>) => {
  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);
  const attribution = new AttributionPlugin();
  view.addPlugin(attribution);
  await view.init();
  const scene = defaultPlugin.addDefaultPhotorealScene();
  view.setCamera({ ... });
  // ... addSource / addLayer / addEffect ...
  // ... Tweakpane UI ...
  attribution.show([TERRAIN_DATASETS.gsi, TILE_DATASETS.gsiSeamlessphoto]);
};
```

Tiny examples (hello-world scale) may inline everything in `main.ts` and use **top-level `await`** directly (`await view.init()`) — no `run()` wrapper or async IIFE. The example bundler supports top-level await.

## Curated gallery code layout — main.ts is the displayed story

The detail page (`pages/detail/DetailApp.tsx`) renders **only the example's `main.ts`** (collected via a vite `?raw` glob) as its "Source" section. Structure gallery examples so that single file reads as the feature's API story (reference: `pages/examples/getting-started/layers/`):

- **`main.ts`** — view/plugin setup + the feature's Navara API calls, written with top-level `await` (no `run()` wrapper). Keep `addSource` / `addLayer` / `layer.update()` / `layer.delete()` calls direct and visible (philosophy rule). Comments: only a few one-liners stating non-obvious API facts (e.g. why extruded polygons need `clampToGround: false`); **no header doc comment** — the example's summary belongs in `meta.ts` (`title` / `description`), not main.ts.
- **`data.ts`** — bulky inline data (GeoJSON fixtures etc.) as a typed exported constant. It is not shown on the detail page, so main.ts stays readable. **A fixture used by more than one example moves to `example/data/<name>.ts`** (named after the data, exporting a matching constant — e.g. `data/gorakShepHuts.ts`) instead of being copied per directory. Each page still keeps its own `data.ts`, re-exporting the shared constant as `data`, so main.ts always imports the same way and never reaches across example directories:

  ```typescript
  // pages/examples/effect/selective-bloom/data.ts
  export { gorakShepHuts as data } from "../../../../data/gorakShepHuts";
  ```

  ```typescript
  // main.ts — the `data` name lets addSource use shorthand
  import { data } from "./data";
  const source = view.addSource({ type: "geojson", data });
  ```
- **UI chrome → `example/helpers/button.ts`** — gallery demos use a few plain DOM buttons via `addButton(label)` (fixed top-left bar styled for the neutral basemap; returns a plain `HTMLButtonElement` — drive it with `.textContent` / `.disabled` / `.onclick` from main.ts). **Tweakpane is for dev/debug pages only, not the gallery.** Never move Navara API calls into helpers — helpers hold presentation only.
- **`initializeExample(view, loadingMeshes?)` (required)** — every gallery example calls `initializeExample(view)` (`example/helpers/initialize.ts`) as the **last line** of main.ts, with no explanatory comment. Pages that add async-loading meshes (GLTF models, 3D Gaussian Splats) pass their handles: `initializeExample(view, [splat])`. It bundles the example-harness plumbing that is *not* part of the API story — the opaque name signals readers to skip it; no monkey-patching, it only listens to public events. Currently that plumbing is scene-loaded signalling: the **detail page** (`pages/detail/DetailApp.tsx`) renders the loading overlay (progress bar + percentage; scene loading has no measurable progress, so a pseudo-progress eases toward 90% and snaps to 100% on the demo's signal) over the demo iframe, and the demo posts `SCENE_LOADED_MESSAGE` once the page settles — no engine `postUpdate` for a quiet window (a single `idle` event is not reliable: the first can fire mid-setup) and every passed mesh has emitted its `load` event (`GLTFModelDesc`, `InstancedGltfModelMeshDesc`, `SplatMeshDesc`). Spark loads splats through its own pipeline that emits no engine events, which is why splat handles must be passed; give any new async-loading desc the same `load` event and pass its handle the same way. Add any future per-page boilerplate inside `initializeExample`, not as new lines in main.ts.

Gallery visual conventions (from the AD_EXAMPLE.md direction):

- Neutral stage: the grayscale basemap `https://papers.reearth.land/styles/grayscale/tilejson.json` added via `TileJsonPlugin` (`tilejson.addSource({ type: "raster-tile", url }) ` + `view.addLayer({ type: "raster", source })`), so the data colors are the hero.
- **A dark basemap needs a dark globe.** Raster tiles seam on terrain, and the gap shows the globe's own color (near-white by default), so a dark stage gets bright hairlines drawn across it. Set `view.globe.color` to the basemap's background (e.g. `new Color().setStyle("#15181c")` for `papers-dark`) whenever the basemap is dark. Light basemaps hide the seam, which is why only dark pages hit this.
- Data colors: one vivid accent per state rather than one hue per geometry (e.g. blue `#0091ff`, switching to orange `#ff6b2c` to visualize a style update).
- Lighting for meshes/extrusions (Lambert materials render black unlit): `view.addLight({ ambient: { intensity: 0.6 } })` + `view.addLight({ sun: { intensity: 1.8 } })` with a **fixed UTC** `view.atmosphere.date`, instead of the full photoreal scene. **Unlit content needs no lights at all**: clamp-to-ground (draped) vectors, `point`/`billboard` sprites, and raster basemaps render identically with zero lights — pure-2D pages should add none.
- **Fill the frame with the subject.** Frame the camera so the feature being demonstrated dominates the shot — no small subject floating in empty basemap. Full-globe shots: the globe nearly fills or slightly overflows the frame (e.g. draped world polygons at `height: ~6_500_000`, straight down near the equator — at higher latitudes the geodetic normal misses the globe center and the sphere drifts off-center). Screen-space symbols (billboard/point/text with `sizeInMeters: false`) are sized for the 1200×750 capture viewport, so pick sizes that read in a 400px-wide thumbnail (pin ~240px, labels ~72px).
- **Animations advance by wall-clock time, never per frame.** A fixed per-frame increment runs 2× faster on a 120 Hz display. Scale progression by the elapsed time between `requestAnimationFrame` timestamps (capped, e.g. `Math.min(time - prevTime, 100)`, so a suspended tab doesn't jump) — see the smoothline reveal and the sun-time day loop.
- **Vary the camera angle across the lineup — not everything top-down.** Mix straight-down shots with oblique/side compositions where the scene recedes toward the horizon or shows sky (`distance` + shallow pitch like `-8`…`-38`). A narrow FOV (`view.camera.fov = 25` after `setCamera`) gives a compressed telephoto shot for small subjects like a GLTF model. When two examples share a subject (two globes, two GLTF models), give them clearly different compositions: different altitude, lens, viewing angle, and stage (grayscale vs black basemap).

## Shared helpers — use these, don't reinvent

Under `example/helpers/`:

- `constants.ts` — `TERRAIN_DATASETS`, `TILE_DATASETS`, `TILES_3D_DATASETS`, `VECTOR_DATASETS`, `LOCAL_DATASETS` (GSI tiles/terrain, PLATEAU 3D Tiles, etc. with attribution metadata)
- `control.ts` — `addCameraControl(view, pane)`, `addDateControl(view, pane)`, `addHidePaneKeyShortcut`
- `panel.ts` — `addFieldsToFolder` for Tweakpane folders with many fields
- `button.ts` — `addButton(label, onClick?)` plain DOM buttons for gallery examples (see the gallery code layout section)
- `initialize.ts` — `initializeExample(view)` example-harness bootstrap + `SCENE_LOADED_MESSAGE`, required in every gallery example; the detail page owns the loading overlay (see the gallery code layout section)
- `keys.ts` — API keys (e.g. `GOOGLE_MAPS_API_KEY`)

Dev/debug page UI is **Tweakpane** (`new Pane({ title })` + `.addBinding(...).on("change", ...)`); gallery example UI is plain DOM buttons from `button.ts`. The gallery/detail pages additionally use React + local shadcn/ui components (`example/components/ui`, imported via `@/components/ui/*`) — those are example-only, not part of the library.

## Checklist for a new example

1. Pick the track: dev/debug or unprompted additions → `pages/<category>/<name>/`; curated gallery (`pages/examples/`) only with explicit design approval. Create the directory.
2. Write `main.ts` (+ `run.ts`, + `meta.ts` for the gallery track). Code comments in English.
3. Run it: `cargo make dev` (or `pnpm --filter @navaramap/three dev`) → `http://localhost:5173/examples/<category>-<name>`.
4. Show data credits via `AttributionPlugin` when using external datasets.
5. Screenshot for the index card: `pnpm navara_three screenshots <page>` (dev server must be running; adjust wait time in `web/navara_three/scripts/generate-screenshots.ts` via `PAGE_CONFIGS` if the scene loads slowly). The script hides everything except the canvas (buttons, panels, attribution) and, for curated demos, waits for the `initializeExample` scene-loaded postMessage before capturing, so thumbnails show only the settled scene.
6. Before committing: `pnpm run build:example`, `pnpm run format`, `pnpm run lint`, `pnpm run test` (from the repo root).

## Verifying an example actually works (not just loads)

- Dev server: `pnpm --filter @navaramap/three dev` picks the next free port when 5173 is taken — pass the real port to the screenshot script via `SERVER_URL=http://localhost:<port>/examples` (the `/examples` base is required).
- Gallery demo URLs are slash-form: `/demo/<section>/<slug>` (e.g. `/demo/getting-started/source`); only legacy pages use the dash form.
- Drive the page headlessly (playwright: load `/demo/...`, collect `pageerror`, count `canvas`, click the example's buttons, screenshot before/after) and **look at the images** — a page with a canvas and no errors can still be a broken or badly framed scene. Tune camera/sun from what you see.
- If every page throws `SyntaxError: ... does not provide an export named ...` for a `navara_wasm_*` module, the WASM binaries are stale relative to the TS source — rebuild them (`cargo make build-dev-all`), then reload. If that build fails with "requires rustc X", run it with a newer installed toolchain: `RUSTUP_TOOLCHAIN=<ver> cargo make build-dev-all` (don't change the rustup override).

## Judging gallery thumbnails as a lineup

Thumbnails are viewed side by side on the index, so after `pnpm navara_three screenshots <path...>` review them **as a set, not one by one**: composite the section's `.avif` files into one strip (sharp: resize each to 400×250, `composite` onto one canvas, output PNG) and check —

- one vivid accent per state (blue `#0091ff`) against neutral stages, not a new hue per example;
- adjacent cards alternate light/dark stages (grayscale basemap vs space/dark map) so the row doesn't blur together;
- no two near-identical compositions — when two examples share a subject (e.g. two space globes), mirror the composition via `atmosphere.date` (put the terminator on opposite sides) or change altitude/framing.
