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
