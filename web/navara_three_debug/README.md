# @navaramap/three-debug

Debug tools for `@navaramap/three`, as plugins that can be switched on and
off at runtime. They are meant for development builds and example pages, not
for shipping inside an application.

- **`ProfilerPlugin`**: frame timings (loop tick, WASM update, event handlers,
  render), per-pass CPU / GPU time and draw calls, draw and program counters,
  the engine's memory ledger, worker and job queues, network traffic per
  source, the render-target stack, a picture-in-picture viewer of the
  pipeline's textures (G-buffer attachments, depth copies, any render target),
  and a frame capture that downloads as JSON.

More tools (layer debugger, camera tools) follow the same shape.

## Usage

Add the plugins before `view.init()`. A `DebugPanel` hosts several tools on
one tweakpane with a tab per tool; without it each tool opens its own pane.

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { DebugPanel, ProfilerPlugin } from "@navaramap/three-debug";

const view = new ThreeView();
view.addPlugin(new DefaultPlugin());

const panel = new DebugPanel(); // press ` to show / hide
const profiler = new ProfilerPlugin({ panel });
view.addPlugin(profiler);

await view.init();

profiler.enabled = false; // detaches every listener and pass wrapper
profiler.enabled = true;
```

`@navaramap/three`, `three` and `postprocessing` are peer dependencies.

## What the profiler measures

Every graph's label carries its live value and the graph's top, as
`name value/top`; hovering the graph shows the value under the pointer.


| Section        | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frame          | The view's `frame` event: `fps` counts loop ticks, `renderedFps` the ticks that drew a frame (on-demand rendering skips the rest). `totalMs` is the whole tick; `updateMs` the WASM update; `eventsMs` the frontend job handlers; `renderMs` the pass pipeline.                                                                                                                                                                                                                            |
| Passes         | Each registered pass's `render` is wrapped on its instance. CPU from `performance.now()`, draw calls and triangles from `renderer.info` deltas, GPU from `EXT_disjoint_timer_query_webgl2` (Chrome; "n/a" elsewhere). Queries cannot nest, so the GPU total is the sum of the passes. Nested renders a pass issues (tile drape bakes inside the G-buffer pass) count toward that pass. "other" is the tick minus the passes: feature updates, event handlers, picking, shadow-map viewers. |
| Draws          | This tick's `renderer.info`. `programDelta` is the change in compiled programs per tick; a steady non-zero value means a material recompiles every frame.                                                                                                                                                                                                                                                                                                                                  |
| Memory         | `view.memoryStats()` and `view.workerMemoryStats()` once a second (the WASM ledger documented in `guide/MEMORY_MANAGEMENT.md`), plus the JS heap where the browser reports it.                                                                                                                                                                                                                                                                                                             |
| Scheduler      | In-flight frontend jobs per kind and the worker pool's load (`guide/FRONTEND_JOB_PROTOCOL.md`).                                                                                                                                                                                                                                                                                                                                                                                            |
| Network        | `fetch` is wrapped while the profiler is enabled. Bytes are the response `Content-Length` (compressed), or the resource-timing size where the server sends `Timing-Allow-Origin`. Requests are attributed to the source whose URL template they match.                                                                                                                                                                                                                                     |
| Render targets | Every target of the fixed stack with its owning pass, size, attachments and nominal bytes; "(unallocated)" targets have not been rendered into yet.                                                                                                                                                                                                                                                                                                                                        |
| Content viewer | Draws a chosen texture into a corner of the frame on the GPU. `normal` decodes the octahedral G-buffer normals, `packedDepth` three's RGBA depth packing, `bitmask` the selective-effect ids; `channel` stretches one channel over the range (log depth lives near 1).                                                                                                                                                                                                                     |
| Capture        | Records the next N ticks (frame timings, per-pass rows, draw counts) and downloads them as JSON for A/B comparison.                                                                                                                                                                                                                                                                                                                                                                        |

## License

MIT OR Apache-2.0
