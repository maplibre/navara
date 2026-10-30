---
title: About
description: Overview and features of three_plugins.
sidebar:
  order: 1
---

## What is three_plugins?

`three_plugins` is a collection of use-case specific plugins for `navara_three`. While the core library provides the `Plugin` base class and `three_default_plugin` handles descriptor registration, `three_plugins` provides higher-level plugins that solve specific use cases out of the box.

## Relationship with Other Packages

```text
navara_three (core: ThreeView, Plugin, addPlugin)
  ├── three_default_descs (descriptor implementations)
  ├── three_default_plugin (DefaultPlugin: bulk descriptor registration)
  └── three_plugins (use-case specific plugins)
        ├── PersonViewPlugin (keyboard-driven first/third-person view controller)
        ├── OverlayPlugin (world-to-screen HTML overlay projection)
        ├── CesiumIonPlugin (Cesium Ion quantized-mesh terrain)
        ├── TileJsonPlugin (TileJSON 3.0.0 tile source registration)
        └── StreetLightsPlugin (street lamps, roof beacons and traffic at night)
```

`three_plugins` depends on `navara_three` for the `Plugin` base class and core APIs, and on `three_default_plugin` for the `DefaultDescriptions` type. Each plugin is independent. You can use one without the other.

## Installation

```typescript
import {
  PersonViewPlugin,
  OverlayPlugin,
  moveOverlayElement,
  CesiumIonPlugin,
  TileJsonPlugin,
  StreetLightsPlugin,
} from "@navaramap/three-plugins";
```

## Available Plugins

### PersonViewPlugin

A keyboard-driven first-/third-person view controller. Drives a virtual position on the globe with WASD / arrow keys and follows it with a chase camera (TPV) or eye camera (FPV). Optionally attaches a GLTF character whose animations cross-fade between idle and dash. See [PersonViewPlugin](../personviewplugin/) for details.

### OverlayPlugin

Projects geographic positions (lat/lng/alt) to screen coordinates on every render frame, enabling HTML overlays that track world positions. See [OverlayPlugin](../overlayplugin/) for details.

### CesiumIonPlugin

Resolves a Cesium Ion asset endpoint at `init()` time and registers it as a quantized-mesh terrain layer via `addTerrain()`. See [CesiumIonPlugin](../cesiumionplugin/) for details.

### TileJsonPlugin

Fetches a TileJSON 3.0.0 document and registers it as a single raster, vector, or raster-DEM (elevation) tile source via `addSource()`, deriving the tile URL, zoom range, scheme, attribution (and, for raster-DEM, the MapLibre-compatible `tileSize` / `encoding`) from the document. See [TileJsonPlugin](../tilejsonplugin/) for details.

### StreetLightsPlugin

Streams the zoom 14 tiles of an OpenMapTiles-schema vector tile set in around a position and places street lamps along the roads, red beacons on tall roofs and cars that drive the road segments, over dark road surfaces drawn with `addRoads()`. The lamps and beacons take part in the selective effects given to `start()`, such as the built-in bloom. See [StreetLightsPlugin](../streetlightsplugin/) for details.

## Usage

All plugins follow the standard plugin lifecycle: create an instance, register it with `view.addPlugin()` before `view.init()`, and then use plugin-specific methods after initialization.

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { PersonViewPlugin, OverlayPlugin } from "@navaramap/three-plugins";

const view = new ThreeView({ container, animation: true });

const defaultPlugin = new DefaultPlugin();
const personView = new PersonViewPlugin({
  character: {
    modelUrl: "/glTF/bird/scene.gltf",
    animation: {
      idleClip: "Gliding",
      dashClip: "Flapping",
      speed: 1.0,
      crossfadeDuration: 0.3,
    },
  },
});
const overlay = new OverlayPlugin({ maxDistance: 100_000 });

view.addPlugin(defaultPlugin);
view.addPlugin(personView);
view.addPlugin(overlay);

await view.init();

personView.start();
```

## Related Resources

- [About Plugin](../../three/introduction/about-plugin/): Plugin system concepts
- [Plugin API](../../three/core/plugin/): How to implement plugins
- [three_default_plugin](../../three_default_plugin/about/): DefaultPlugin details
