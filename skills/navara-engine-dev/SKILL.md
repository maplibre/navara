---
name: navara-engine-dev
description: >
  Coding rules and design invariants for developing Navara itself. Use when
  adding, modifying, or reviewing any code in this repository — Rust crates,
  WASM modules, shaders/glsl, or the TypeScript packages under web/; for
  application code that merely uses @navaramap/three, use navara-usage
  instead.
---

# Navara engine development

## Read the matching guide first

`guide/` holds a deep-dive per subsystem, named by topic. Before non-trivial
work, list `guide/` and read the file(s) covering the area you touch. When a
change alters behavior a guide documents, update the guide in the same
change.

## Coding rules

- **Reuse the subsystem's existing mechanisms.** Each guide documents the
  sanctioned patterns (e.g. BATCH_TEXTURE.md "Slot mechanisms"); extend the
  nearest one instead of inventing a new mechanism. Keep semantics identical
  across every mesh type sharing a code path.
- **Prefer fixed defaults resolved CPU-side** over plumbing material state
  through layers or adding shader-side fallback macros/sentinels. A sentinel
  is a last resort for attributes where no meaningful constant exists.
- **Comments state only constraints the code cannot express.** Do not bake
  design history or discussion context into them (rejected alternatives,
  contract essays) — that belongs in the PR description or a guide.
- **Delete tests a refactor made vacuous** — e.g. an assertion a
  zero-initialized buffer now satisfies by construction, or a case duplicated
  by a neighboring test.
- **Do not handle logically impossible cases.** No fallbacks, guards, or
  error paths for states the surrounding invariants already rule out — they
  add dead code and obscure the real contract. If an invariant is worth
  enforcing, assert it (e.g. `debug_assert!`/`unreachable!` in Rust, `throw`
  in TS) instead of silently handling it.

## Lightweight skybox

- `SkyBoxMeshDesc` uses premultiplied normal alpha blending. Multiply sky RGB
  by altitude opacity once; the solar disc and halo stay independent of altitude.
  Output alpha combines sky opacity and disc coverage to occlude background stars.
- Keep skybox additions analytic (no LUTs or scattering loops); the full
  atmosphere path supplies physically based scattering. Solar disc edges use
  chord distance and screen derivatives to preserve precision and antialiasing.
- Upstream `StarsMaterial` overrides the `depthWrite` constructor option. Set
  `material.depthWrite = false` after construction so stars cannot depth-occlude
  the far-depth skybox.

## Polar terrain geometry

- WebMercator band-edge tiles append `add_pole_extension` after skirts, even
  when skirts are disabled. Detect `PoleSides` from the scheme and extent.
- Keep cap vertices in separate skirt buffers: their pinned edge UVs cannot
  reconstruct latitude during upsampling. Each child generates its own cap.
- Band-edge raster DEM rows past the dataset's coverage arrive as exact 0 m,
  and the covered row next to them is a blended fraction of the true height.
  `fill_polar_dem_nodata` rewrites the shared DataManager buffer on load (pole
  side only) with the last fully covered row so mesh and hillshade agree; do
  not compensate per consumer, in the mesh, or in the shader.
- Terrain bounds (including height updates and horizon occlusion) use the
  pole-extended extent and include height zero; mesh/texture extents stay in
  the Mercator band.
- Rendered tiles can retain task handles after worker failure/cancellation has
  despawned the task. Consume those handles during cleanup and use
  `Commands::get_entity` + `try_insert(Deleted)` to tolerate both an already
  removed task and a despawn queued earlier in the same frame.
