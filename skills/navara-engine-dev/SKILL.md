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

Write guides, skills, comments and READMEs concisely: state each fact once,
in the one place it belongs, and link to it elsewhere. Cut sentences that
restate a heading, an earlier section, or another guide; skip rationale the
reader does not need to apply the rule. Write for a reader who was not in
your session: leave out context only it had (an investigation, a measurement
run, a rejected attempt, "now" / "previously"), or state it as a
self-contained present-tense fact a newcomer can verify against the code.

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
- **A shader that branches on `gl_FrontFacing` on a transparent `DoubleSide`
  material needs `forceSinglePass = true`.** Otherwise three draws a `BackSide`
  and a `FrontSide` pass: the winding flips, so `gl_FrontFacing` is true from
  both sides, `DOUBLE_SIDED` is not defined, and `needsUpdate` fires every frame.
- **Frontend job handlers execute; the engine schedules.** JS never queues,
  caps, dedupes or prioritizes engine events; Rust decides admission and
  order (`RequestLimits`, `WorkerLimits`, `Priority`). Async work registers
  a `JobHandler` with `JobDispatcher` (`web/navara_core/src/event/`, see
  `guide/FRONTEND_JOB_PROTOCOL.md`). In a handler:
  - After every `await`, skip `set*` / `mark*` / buffer-store writes once
    `abort.signal.aborted` is set: a late `setU8` resurrects a freed handle.
    Worker-task delegators instead go through `runDelegatedWorkerTask`,
    which always settles them, and pool promises through
    `settleWorkerTask(signal, promise)`.
  - Never `free()` an event (the dispatcher does); read a nested getter
    (`event.task`, `event.feature`) once and free what you do not hand on.
  - Caches keyed by a shared tile handle or URL identity-check on delete:
    another entity's add may land before this one's remove.
  - Pool work outside delegated tasks goes through `queueTask` without JS
    gating (the engine sees it as `WorkerLimits.external_load`). A thread
    outside the pool holds `reserveWorkerCore()` while it works. Outside
    `navara_three`, take these functions as arguments (e.g.
    `FontManager.setWorkerCoreReservation`): each package bundles its own
    `@navaramap/worker`, so an import reaches an uninitialized pool.
- **Initialize a wasm-bindgen module on the main thread through one shared
  promise.** The generated init returns early only after a call has
  finished; a second call while the first is in flight instantiates again
  and swaps the module, leaving objects made from the first instance on
  stale memory. The `@navaramap/engine*` packages stay external, so the page
  has one copy of each, but the TS packages bundle each other
  (`navara_three` carries its own `three-api` and `font`), so a module-level
  memo is not shared between callers. A module initialized from more than
  one package keeps its promise under a `Symbol.for` key on `globalThis`:
  `@navaramap/engine-api` uses `"@navaramap/engine-api/init"`
  (`initNavaraApi`, and `ensureApi` in `navara_font`); a new caller reuses
  that key and its reset-on-failure handling.
- **An asset used only inside a worker must also be referenced from the
  main bundle.** A consuming bundler copies a built worker chunk as an opaque
  file, so a `.wasm` referenced only from worker code is never emitted into
  the app's build — it works in dev and fails in a production build. For a
  wasm-bindgen package, keep a side-effect `import "@navaramap/engine-…"` in
  the main entry: the consumer then emits the same hashed `.wasm` next to the
  worker chunk. For any other asset, import it with `?url&no-inline` on the
  main thread and pass the URL to the worker (`decodeDracoAsync`). Verify
  with the production build of `web/integration-tests/navara-three`.
