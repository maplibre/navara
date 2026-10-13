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
