# @navaramap/three-plugins

Optional feature plugins for `@navaramap/three`. Each plugin packages a self-contained capability on top of the core view:

- **`PersonViewPlugin`**: first-person walk mode with a controllable character (GLTF model, animations, key bindings, teleport, view-mode switching).
- **`OverlayPlugin`**: anchors DOM elements to geographic positions and keeps them projected to screen space as the camera moves.
- **`CesiumIonPlugin`**: resolves a Cesium Ion asset endpoint and registers the asset as a quantized-mesh terrain layer via `addTerrain()`.
- **`TileJsonPlugin`**: fetches a TileJSON 3.0.0 document and registers it as a Navara source, surfacing its attribution through the view's built-in credit UI.
- **`DevtoolsPlugin`**: development-only tools on a tweakpane panel, a profiler and a layer inspector (see [Devtools](#devtools)).
- **`StreetLightsPlugin`**: street lamps, roof beacons and moving traffic at night, streamed in around the camera from vector tiles, read through the caller's readers for any schema.

## Usage

Like all Navara plugins, add them before `view.init()`:

```typescript
import ThreeView from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { OverlayPlugin, moveOverlayElement } from "@navaramap/three-plugins";

const view = new ThreeView<DefaultDescriptions>();
view.addPlugin(new DefaultPlugin());
const overlay = new OverlayPlugin();
view.addPlugin(overlay); // must happen before init()
await view.init();

// Basemap, credited through the built-in attribution UI.
const source = view.addSource({
  type: "raster-tile",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  maxZoom: 18,
});
view.addLayer({ type: "raster", source });
view.attribution?.add([
  {
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
]);

// Anchor a DOM element to a geographic position.
overlay.setPositions([{ id: "tokyo", lng: 139.77, lat: 35.68, alt: 0 }]);
overlay.onUpdate(({ projected }) => {
  const pos = projected.get("tokyo");
  if (pos) moveOverlayElement(markerElement, pos.x, pos.y);
});
```

`@navaramap/three`, `@navaramap/three-default-plugin`, and `three` are peer dependencies (plus `postprocessing` for the devtools).

## Devtools

Tools for inspecting a running view, each of which can be switched on
and off at runtime. They are meant for development builds and example pages, not
for shipping inside an application. Every row and setting explains itself on
hover.

- **Profiler** (`ProfilerPlugin`): how fast the map draws and why. A summary (frame
  rate, frame time on CPU and GPU, draw calls, engine memory against its
  budget, downloads, workers), then where each frame's time goes step by step,
  memory by kind, downloads per source, background work, draw details, screen
  buffers, a buffer viewer, and frame recording to JSON.
- **Layers** (`LayerInspectorPlugin`): the view's layers with what each costs (meshes,
  memory, downloads), a visibility checkbox per layer, solo / wireframe /
  bounding-box toggles, and a style form for the selected layer with every
  setting its materials accept.

### Usage

Add `DevtoolsPlugin` before `view.init()`. It puts every tool on one
tweakpane, a tab per tool.

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { DevtoolsPlugin } from "@navaramap/three-plugins";

const view = new ThreeView();
view.addPlugin(new DefaultPlugin());

const devtools = new DevtoolsPlugin(); // press ` to show / hide
view.addPlugin(devtools);

await view.init();

devtools.profiler!.enabled = false; // detaches every listener and pass wrapper
devtools.profiler!.enabled = true;
```

`tools: ["profiler"]` picks the tools; `panel`, `profiler` and `layers` take
each part's options. `ProfilerPlugin` and `LayerInspectorPlugin` are exported
too: added alone, a tool opens a pane of its own.

They also need `postprocessing` (a peer dependency) and bring `tweakpane`.

### Profiler

Navara draws only when something changes, so frame rate and frame time cover
drawn frames; the summary says "idle" while the map is still.

| Section                   | What it shows                                                                                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the frame time goes | The latest drawn frame: the WASM engine update, loading and building, each render pass (CPU, GPU, draw calls), and the rest. Each pass's `render` is wrapped on its instance; GPU times come from `EXT_disjoint_timer_query_webgl2` (Chrome desktop) and are summed, since queries cannot nest. |
| Memory                    | `view.memoryStats()` by kind against the budget, the cache of tiles kept for reuse, evictions and whether detail is being reduced; worker, font and JS heaps outside the budget.                                                                                                                |
| Downloads                 | `fetch` is wrapped while enabled and requests are matched to their source by URL template. Sizes are `Content-Length`, or resource timing where the server allows it.                                                                                                                           |
| Background work           | Frontend jobs per kind (terrain tiles, worker tasks, features, imagery textures, downloads) and worker threads.                                                                                                                                                                                 |
| Draw details              | `renderer.info` of the latest drawn frame, and shader programs compiled in the last 5 s: a count that never settles means something recompiles every frame.                                                                                                                                     |
| Screen buffers            | Render targets sized to the screen, by the pass that owns them.                                                                                                                                                                                                                                 |
| Buffer viewer             | One of the renderer's images in a corner of the map, decoded for you: scene color, normals, roughness, reflectance, depth (as distance), the terrain-only depth and normals, shadows, selective effects, emissive. Unavailable buffers say why.                                                 |
| Record frames             | The next N drawn frames' timings and per-pass costs, downloaded as JSON.                                                                                                                                                                                                                        |

### Layers

Click a layer to select it; its checkbox hides it by setting `show: false` on
its styles. The style form is generated from the engine's material
definitions (`MATERIAL_SCHEMA`, from `pnpm run generate:schema`): a field set
on the layer is marked `•`, the others show the engine default, and hovering
one shows its documentation. Changes apply as you edit; "Undo my changes"
puts the values back.

The wireframe toggle needs geometry arrays kept on the CPU
(`ViewContext.retainGeometryArrays`), which the plugin turns on before layers
load. That costs a JS-heap copy of every terrain and polygon geometry; pass
`wireframe: false` to profile memory without it.

## Documentation

Each plugin's options and events are documented at https://navara.world/docs/.

## License

MIT OR Apache-2.0
