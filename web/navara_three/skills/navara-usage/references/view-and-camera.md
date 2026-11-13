# View setup and camera

Embedding the view in a page, constructor options, asset bundling, and moving/observing the camera. Setup order and init-only options: [SKILL.md](../SKILL.md).

## Embedding and sizing

- **Embedding in a page: pass `container` and give it its own size.** `new ThreeView({ container })` adds an absolutely positioned canvas (a `position: static` container becomes `relative` until dispose), follows the container's size without a window resize, mounts the attribution UI inside it, and removes its canvas on `dispose()`. With `{ canvas }` instead, the view follows the canvas's **parent** and writes that size onto the canvas in px, so in a flex/grid layout the parent needs `min-width: 0; min-height: 0` (or `overflow: hidden`) or it never shrinks. With neither, a `100vw` x `100vh` root is appended to `<body>`. The wheel over the map does not scroll the page while `camera.options.enableZoom` is on. `disableAutoResize: true` hands sizing to you: call `view.resize()`.
- **Several views on one page: one canvas each, and the first `init()` sizes the shared worker pool.** Every `ThreeView` shares one pool of tile workers; the first view to initialize creates it with its pool size (`workerPoolSize`, or the `mobileOptimization` default) and `memoryBudget.maxWorkerHeapBytes`, and a later view's values are ignored (with a console warning) until the last view is disposed. Everything else is per view (WebGL context, `cacheBytes`, the other `memoryBudget` limits, the font worker), so memory grows with the view count; lower `cacheBytes` per view on mobile. `dispose()` is safe while `init()` is pending, and that `init()` then resolves without starting the view, so check that the view is still current after `await view.init()`.

## Constructor options and bundled assets

- **Effect compatibility:** `hideUnderground: false` and `logarithmicDepthBuffer` break some effect descriptors — test, and prefer defaults.
- **Runtime assets (atmosphere/cloud/noise) bundle automatically** — each file is referenced via a static `new URL(..., import.meta.url)`, so Vite/webpack emit them into the app build; no copying or config needed. To self-host instead, pass `atmosphereAssetsUrl` (Atmosphere) / `assetsUrl` (Clouds) pointing at a directory that keeps the **original filenames** (`transmittance.exr`, `local_weather.png`, …); both default to `undefined` = bundled assets. There are no directory URL constants (appending filenames to a directory can't survive bundler hashing) — only per-file constants exist (`ATMOSPHERE_TRANSMITTANCE_URL`, `CLOUD_LOCAL_WEATHER_URL`, `STBN_URL`, `STARS_ASSETS_URL`, …).

## Camera

```typescript
view.setCamera({ lng, lat, height, heading, pitch, roll }); // instant; `distance` option = frame a target; cancels a flight
const ok = await view.flyTo(
  { lng, lat, height },
  { duration, maxHeight, easing: "quinticInOut" },
);
// animated arc; resolves true on completion, false when interrupted by
// another camera operation (a newer flyTo, setCamera, etc.). duration
// defaults to 2–3 s derived from flight distance; easing defaults to
// quinticInOut (cubicOut when descending from high altitude).
view.lookAt(target, offsetENU);
view.camera.on("moveend", () => console.log(view.camera.positionGeographic));
view.camera.fov = 50; // use setters, never camera.raw.fov
view.camera.fov; // degrees; vertical fov
```

- **Camera events: listen to `move`, not `movestart`.** User interaction and the camera movement methods emit events, but instantaneous ones (`setCamera`, `lookAt`, `rotateAroundAxis`, `flyTo` with `duration: 0`) finish inside one frame and emit only `move` + `moveend` — no `movestart`, since there is no movement to open. Continuous movement (gestures, their inertia, an animated `flyTo`) emits the full `movestart` -> `move`... -> `moveend`. Each event fires at most once per frame, but an instantaneous change emits `move` and `moveend` in the _same_ frame, so a handler bound to both runs twice for one `setCamera` — keep it idempotent. **Follow mode emits nothing:** while `cameraFollow`/`cameraFreeLook` is active the camera is repositioned every frame with no status pushed, so poll `positionGeographic` on `preRender` instead of listening for `move`.
- **Never write to `view.camera.raw` frustum fields** (`fov` etc.) — the engine overwrites them and Rust-side culling desyncs. Use the `view.camera.fov/near/far` setters.
