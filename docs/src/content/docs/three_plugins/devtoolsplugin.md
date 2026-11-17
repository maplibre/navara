---
title: DevtoolsPlugin
description: Development tools for a running view on one panel, with a profiler, a layer inspector and a camera inspector.
sidebar:
  order: 7
since: 0.3.2
---

## Overview

`DevtoolsPlugin` adds a panel to the page for inspecting a running view. The panel has a tab per tool:

- **Profiler**: how fast the map draws and why. Frame rate, frame time on the CPU and the GPU, draw calls, engine memory against its budget, downloads per source, background work, and the renderer's images (normals, depth, shadows and more) in a corner of the map.
- **Layers**: the view's layers with what each one costs (meshes, memory, downloads), a checkbox to hide each layer, solo, wireframe and bounding-box toggles, and a style form with every setting the selected layer's materials accept.
- **Camera**: the camera's position, orientation and field of view, updated as the camera moves. Edit a value to move the camera, and copy or paste the camera as a JS object.

Every row and setting explains itself when you hover it. Each tool has an `enabled` toggle: a disabled tool stops all its work.

The tools are for development builds and example pages. Do not ship them in an application.

## Usage

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { DevtoolsPlugin } from "@navaramap/three-plugins";

const view = new ThreeView({ container });

const devtools = new DevtoolsPlugin();

view.addPlugin(new DefaultPlugin());
view.addPlugin(devtools);
await view.init();

// Press ` to show or hide the panel.
// Switch a tool off from code: it detaches every listener it added.
if (devtools.profiler) devtools.profiler.enabled = false;
```

Pick the tools, and set their options, in the constructor:

```typescript
const devtools = new DevtoolsPlugin({
  tools: ["layers"],
  panel: { visible: false, hotkey: "F2" },
  layers: { wireframe: false },
});
```

`DevtoolsPlugin` needs the `postprocessing` peer dependency, and brings `tweakpane` for its panel.

## Constructor

```typescript
new DevtoolsPlugin(options?: DevtoolsPluginOptions);
```

Register the plugin with `view.addPlugin()` **before** `view.init()`. The Layers tool starts recording each layer's configuration during `init()`, so it only knows layers added after that.

| Property   | Type                                         | Default                            | Description                                                                                                 |
| ---------- | -------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `tools`    | `DevtoolName[]`                              | `["profiler", "layers", "camera"]` | The tools to add, as tabs in this order. See [`DevtoolName`](#devtoolname).                                 |
| `panel`    | `DevtoolsPanelOptions`                       | `{}`                               | Title, size, hotkey and start visibility of the panel. See [`DevtoolsPanelOptions`](#devtoolspaneloptions). |
| `profiler` | `{ enabled?: boolean }`                      | `{}`                               | Options of the Profiler. `enabled` sets whether it starts enabled (default `true`).                         |
| `layers`   | `{ enabled?: boolean; wireframe?: boolean }` | `{}`                               | Options of the Layers tool. See [Wireframe and memory](#wireframe-and-memory).                              |
| `camera`   | `{ enabled?: boolean }`                      | `{}`                               | Options of the Camera tool. `enabled` sets whether it starts enabled (default `true`).                      |

## Properties

### panel

**Type:** `DevtoolsPanel`

**Description:** The panel the tools are tabs of. `panel.visible` shows or hides it, and `panel.toggle()` flips it.

### profiler

**Type:** `ProfilerPlugin | undefined`

**Description:** The Profiler, or `undefined` when `tools` leaves it out. Set `enabled` to switch it on and off. `record(count)` records the next `count` drawn frames and resolves with their timings and per-pass costs.

### layers

**Type:** `LayerInspectorPlugin | undefined`

**Description:** The Layers tool, or `undefined` when `tools` leaves it out. Set `enabled` to switch it on and off. `select(id)` selects a layer by id, and `selected()` returns the selected layer.

### camera

**Type:** `CameraInspectorPlugin | undefined`

**Description:** The Camera tool, or `undefined` when `tools` leaves it out. Set `enabled` to switch it on and off. `apply(camera)` sets the keys given on the next frame and keeps the others; `fov` changes only when it is given. `lng`, `lat` and `height` move together: one of them takes the other two from the camera. To read the camera, use [`view.getCamera()`](../../three/api/threeview-functions/#getcamera).

## Methods

### dispose()

```typescript
dispose(): void
```

Disables every tool and removes the panel from the page. `view.dispose()` calls it too, so the tools stop with the view. Calling it more than once is safe.

## Profiler

Navara draws only when something changes, so the frame rate and frame time cover drawn frames. The summary says "idle" while the map is still.

| Section                   | What it shows                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where the frame time goes | The latest drawn frame: the engine update, loading and building, each render pass (CPU time, GPU time, draw calls), and the rest.                                                          |
| Memory                    | Engine memory by kind against its budget, the cache of tiles kept for reuse, and whether detail is being reduced. Worker, font and JS heaps are listed outside the budget.                 |
| Downloads                 | Requests and bytes per source.                                                                                                                                                             |
| Background work           | Pending work per kind (terrain tiles, worker tasks, features, imagery textures, downloads) and worker threads.                                                                             |
| Draw details              | Draw calls, triangles, geometries and textures of the latest drawn frame, and shader programs compiled in the last 5 s. A count that never settles means something recompiles every frame. |
| Screen buffers            | Render targets sized to the screen, by the pass that owns them.                                                                                                                            |
| Buffer viewer             | One of the renderer's images in a corner of the map: scene color, normals, roughness, reflectance, depth (as distance), shadows, selective effects, emissive. Unavailable buffers say why. |
| Record frames             | The next N drawn frames' timings and per-pass costs, downloaded as JSON.                                                                                                                   |

GPU times need the `EXT_disjoint_timer_query_webgl2` WebGL extension (Chrome on desktop). Without it, the GPU columns are empty.

## Layers

Click a layer to select it. Its checkbox hides it by setting `show: false` on its materials.

The style form lists every setting of the selected layer's materials, from [MaterialSchemaPlugin](../materialschemaplugin/). A setting the layer sets is marked `•`, and the others show the engine default. `↻` marks a setting that applies to what is already drawn only after "Reload layer", and `∅` one with no effect on this layer type. Changes apply as you edit, and "Undo my changes" puts the values back. The form shows the configuration the app passed to `addLayer()` with every `layer.update()` merged on top, not values the engine derives.

### Wireframe and memory

The wireframe toggle needs each geometry's vertex arrays kept in JS memory. While the Layers tool is enabled, it keeps them for every terrain and polygon geometry built in that time. The Profiler's JS heap includes that copy. Disabling the tool stops this, but geometries built before the tool was enabled cannot show a wireframe. Pass `layers: { wireframe: false }` to measure memory without the copy. The wireframe toggle is then hidden.

## Camera

The tool shows `lng`, `lat` and `height` (meters above the ellipsoid), `heading`, `pitch` and `roll` (degrees), and `fov` (vertical field of view in degrees). They follow the camera only while the tab is shown. The controls are greyed out while the tool is disabled and until the engine camera exists (the first engine update).

"Copy as JS object" copies [`view.getCamera()`](../../three/api/threeview-functions/#getcamera), rounded to about 1 cm:

```typescript
{
  lng: 139.7454,
  lat: 35.6586,
  height: 600,
  heading: 0,
  pitch: -15,
  roll: 0,
  fov: 50,
}
```

"Paste JS object" reads `key: number` pairs from the clipboard, so a JS object, JSON or a `view.setCamera({ ... })` call all work. It reads the outermost object that has `lng`, `lat` and `height`, and skips nested objects and comments. A key left out keeps its current value. A value out of range (for example `lat` beyond ±90 or `fov` outside 1–179) is not applied, and the button says which key.

The clipboard works only on `https://` pages and `localhost`. On a dev server opened by its LAN address, the buttons say "Clipboard needs HTTPS".

## Types

### DevtoolName

```typescript
type DevtoolName = "profiler" | "layers" | "camera";
```

A tool `DevtoolsPlugin` can add, named by its tab.

### DevtoolsPluginOptions

```typescript
type DevtoolsPluginOptions = {
  tools?: DevtoolName[];
  panel?: DevtoolsPanelOptions;
  profiler?: { enabled?: boolean };
  layers?: { enabled?: boolean; wireframe?: boolean };
  camera?: { enabled?: boolean };
};
```

The constructor options. See [Constructor](#constructor).

### DevtoolsPanelOptions

```typescript
type DevtoolsPanelOptions = {
  title?: string;
  container?: HTMLElement;
  hotkey?: string | null;
  width?: number;
  visible?: boolean;
};
```

| Property    | Type             | Default             | Description                                                                                                           |
| ----------- | ---------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `title`     | `string`         | `"Navara devtools"` | Panel title.                                                                                                          |
| `container` | `HTMLElement`    | `document.body`     | Element the panel is appended to.                                                                                     |
| `hotkey`    | `string \| null` | ``"`"``             | Key that shows or hides the panel, as `KeyboardEvent.key`. Ignored while a text field has focus. `null` turns it off. |
| `width`     | `number`         | `440`               | Panel width in CSS pixels.                                                                                            |
| `visible`   | `boolean`        | `true`              | Whether the panel starts visible.                                                                                     |

## Notes

- **Development only.** The Profiler wraps `fetch` and each render pass while it is enabled, and the Layers tool keeps geometry arrays for wireframes while it is enabled. Both cost time and memory that an application does not need.
- **One tool at a time.** `ProfilerPlugin`, `LayerInspectorPlugin` and `CameraInspectorPlugin` are also exported. Add one of them alone with `view.addPlugin()` to get that tool in a panel of its own.

## Related Resources

- [About](../about/): Overview of three_plugins
- [Devtools example](https://navara.world/examples/plugin/devtools): The plugin over terrain, imagery, vector tiles and 3D Tiles
