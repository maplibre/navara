# @navaramap/three Integration Test

This project tests `@navaramap/three` from an end user's perspective, using the built library files instead of source files.

## What This Tests

- Library exports work correctly
- TypeScript type definitions are properly generated
- WASM modules load correctly
- Basic functionality (globe rendering, layers, camera) works

## Running

```bash
# Development mode (from repository root)
pnpm dev:integration

# Or from this directory
pnpm dev
```

## Building

```bash
# Production build (from repository root)
pnpm build:integration

# Or from this directory
pnpm build
```

## Example Code

The `src/main.ts` contains a minimal example that:

1. Creates a `ThreeView` instance
2. Initializes the WASM engine
3. Adds atmosphere and effect descriptors
4. Adds terrain and tile layers
5. Adds a 3D Tiles layer (Draco-compressed PLATEAU buildings)
6. Adds a text label (font worker)
7. Sets the camera position

This exercises the core functionality that users would typically use.

## Multi-View Check

`multi-view.html` (`src/multiView.ts`) runs several `ThreeView` instances on one page through their lifecycle: concurrent initialization (the first view's `workerPoolSize` sizes the shared pool), disposing one view, disposing a view while it initializes or while the shared worker pool warms up, disposing every view, and initializing again (the new pool takes the new view's `workerPoolSize`). An inline probe in the HTML counts main-thread WASM instantiations and live workers, and the page reports PASS or FAIL per check (also exposed as `window.__result`).

Open it from the preview server after a production build:

```bash
pnpm build && pnpm preview
# then open http://localhost:4173/multi-view.html
```

The run takes about 30 seconds; keep the tab in the foreground, since a hidden tab pauses rendering and tile streaming.
