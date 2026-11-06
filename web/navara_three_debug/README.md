# @navaramap/three-debug

Debug tools for `@navaramap/three`, as plugins that can be switched on and
off at runtime. They are meant for development builds and example pages, not
for shipping inside an application. Every row and setting explains itself on
hover.

- **`ProfilerPlugin`**: how fast the map draws and why. A summary (frame
  rate, frame time on CPU and GPU, draw calls, engine memory against its
  budget, downloads, workers), then where each frame's time goes step by step,
  memory by kind, downloads per source, background work, draw details, screen
  buffers, a buffer viewer, and frame recording to JSON.
- **`LayerDebuggerPlugin`**: the view's layers with what each costs (meshes,
  memory, downloads), a visibility checkbox per layer, solo / wireframe /
  bounding-box toggles, and a style form for the selected layer with every
  setting its materials accept.

## Usage

Add the plugins before `view.init()`. A `DebugPanel` hosts several tools on
one tweakpane with a tab per tool; without it each tool opens its own pane.

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import {
  DebugPanel,
  LayerDebuggerPlugin,
  ProfilerPlugin,
} from "@navaramap/three-debug";

const view = new ThreeView();
view.addPlugin(new DefaultPlugin());

const panel = new DebugPanel(); // press ` to show / hide
const profiler = new ProfilerPlugin({ panel });
view.addPlugin(profiler);
view.addPlugin(new LayerDebuggerPlugin({ panel, profiler }));

await view.init();

profiler.enabled = false; // detaches every listener and pass wrapper
profiler.enabled = true;
```

`@navaramap/three`, `three` and `postprocessing` are peer dependencies.

## Profiler

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

## Layers

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

## License

MIT OR Apache-2.0
