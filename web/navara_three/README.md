# @navaramap/three

Web map engines have long forced a choice: engines with polished declarative APIs are easy to adopt but hard to extend beyond their built-in features, while engines that expose deep low-level control are powerful but demand steep expertise. Fully 3D globe applications usually leave no option but the latter. Navara is a highly extensible 3D map engine built to remove that trade-off. It streams real-world GIS data, from satellite imagery and terrain to 3D city models and vector data, onto an interactive globe, and lets you present it the way your application needs: as a clean basemap for data visualization, styled per feature by attributes, or as a photorealistic scene with atmosphere, sunlight, and shadows.

Navara's answer to the trade-off is a tiered API. Capabilities are organized into four tiers, so you start with the simplicity of a declarative engine and drop down, as far as the render pipeline itself, only when you need more control:

- **Declarative**: declare sources and layers as plain config objects (basemaps, terrain, vector data, 3D Tiles). Meshes, effects, and lights work the same declarative way.
- **Plugin**: add purpose-built features as ready-made bundles, such as the photorealistic scene, first-person walking, DOM overlays, and the attribution UI. Anyone can package and share their own plugin.
- **API**: per-feature styling by attributes (`FeatureEvaluator`), feature picking, terrain sampling, camera control, and standalone geodetic/ECEF math utilities usable without the map engine.
- **Shader**: full access to the rendering engine for your own shaders and effects, writing custom mesh/effect/light Descriptors against its scene graph and render pipeline.

Under the hood, Navara is a headless GIS core, independent of the rendering engine. The complex but reusable GIS logic (data parsing, geometry construction, and more) lives in Rust / WebAssembly, and drawing is delegated to libraries specialized in CG rendering. This package is the Three.js-based binding and the main entry point for building Navara applications. Its public API is `ThreeView` plus a declarative Source/Layer/Descriptor model.

- 📖 **Documentation**: https://navara.world/docs/
- 🌏 **Live examples**: https://navara.world/examples/

## Install

```bash
pnpm add @navaramap/three @navaramap/three-default-plugin three postprocessing
```

`three` and `postprocessing` are peer dependencies. Most apps also want `@navaramap/three-default-plugin`, which registers the built-in mesh/effect/light Descriptors.

## Quick Start

Plugins must be added before `init()`, and sources/layers/effects after it:

```typescript
import ThreeView from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>({ shadow: true }); // 1. construct
const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin); // 2. add ALL plugins before init
await view.init(); // 3. async init (WASM + workers + pipeline)
defaultPlugin.addDefaultPhotorealScene(); // 4. optional photoreal sky/sun/AA bundle

view.setCamera({
  lng: 139.77,
  lat: 35.68,
  height: 10000,
  heading: 0,
  pitch: -30,
  roll: 0,
});

const source = view.addSource({
  type: "raster-tile",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  maxZoom: 18,
});
view.addLayer({ type: "raster", source });

// Credit the data through the built-in attribution UI (enabled by default).
view.attribution?.add([
  {
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
]);
```

See [What is Navara?](https://navara.world/docs/guides/introduction/what-is-navara/) for an overview and [Getting Started](https://navara.world/docs/guides/introduction/getting-started/) to build your first 3D map.

## AI coding agents

This package ships the `navara-usage` [agent skill](https://pnpm.io/agent-skills) (`skills/navara-usage`), a concise guide to `@navaramap/three` best practices for agents such as Claude Code. With pnpm 12.11 or later, run `pnpm approve` after installing to link it into your project's agent skills directory (for example `.claude/skills`). With another package manager, copy `node_modules/@navaramap/three/skills/navara-usage` there instead.

## Related packages

- [`@navaramap/three-default-plugin`](https://github.com/reearth/navara/tree/main/web/navara_three_default_plugin): registers all built-in Descriptors at once
- [`@navaramap/three-default-descs`](https://github.com/reearth/navara/tree/main/web/navara_three_default_descs): the individual Descriptor classes and their config types
- [`@navaramap/three-plugins`](https://github.com/reearth/navara/tree/main/web/navara_three_plugins): optional feature plugins (first-person walk, DOM overlays, Cesium ion, TileJSON)
- [`@navaramap/three-react`](https://github.com/reearth/navara/tree/main/web/navara_three_react): React bindings

## Documentation

Full documentation, including every source/layer/material option and runnable examples, is at https://navara.world/docs/.

## License

MIT OR Apache-2.0
