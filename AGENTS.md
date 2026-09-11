# AGENTS.md

Navara is a 3D globe map engine prototype: Rust crates (Bevy ECS) compiled to three WASM modules (`navara_wasm` — full engine, `navara_wasm_worker` — background processing, `navara_wasm_api` — lightweight utilities), consumed by TypeScript packages under `web/` (Three.js rendering). Builds are orchestrated with cargo-make.

## Commands

```bash
# First-time setup (requires cargo-make, cargo-watch, wasm-pack, protobuf)
cargo make prepare        # builds WASM modules, then installs web deps — order matters

# After code changes, run all four (concurrently is fine):
cargo make build-example  # build examples (Rust + WASM + web)
cargo make format         # format all code (Rust + TypeScript)
cargo make lint           # lint with auto-fix
cargo make test           # all tests (Rust + TypeScript)
```

If a change touches only `web/`, the pnpm equivalents are faster: `pnpm run build`, `pnpm run build:example`, `pnpm run format`, `pnpm run lint`, `pnpm run test`.

**Never skip the web build after Rust changes.** WASM binaries are consumed by `web/`, so a Rust-only change can still break web builds and tests.

## Docs

- [guide/ARCHITECTURE.md](guide/ARCHITECTURE.md) — system design and Rust/WASM/TypeScript communication patterns
- [guide/RENDERING_PIPELINE.md](guide/RENDERING_PIPELINE.md) — the TS rendering pipeline: pass ordering, the MRT G-buffer (layout, encodings, blending invariants, define stamping), scenes/pass routing, and the `lit` system
- [guide/CRATES.md](guide/CRATES.md) — reference for the 40+ Rust crates
- [guide/WASM_API_POLICY.md](guide/WASM_API_POLICY.md) — read before designing TypeScript APIs that wrap WASM
- [guide/RELEASE.md](guide/RELEASE.md) — release flow (changelog generation, tagging, npm/GitHub Release)
- [docs/AGENTS.md](docs/AGENTS.md) — when working in `docs/` (user-facing documentation site)

## Skills

`skills/` holds distilled best practices for working with Navara: [navara-usage](skills/navara-usage/SKILL.md) (how to use `@navaramap/three` — for application code, examples, and docs snippets), [navara-engine-dev](skills/navara-engine-dev/SKILL.md) (coding rules and design invariants for any code added to this repository), [navara-add-example](skills/navara-add-example/SKILL.md), and [navara-add-docs-example](skills/navara-add-docs-example/SKILL.md), and [navara-lp](skills/navara-lp/SKILL.md) (building and maintaining the marketing landing page; its `references/scene-tiers.md` covers the fixed-camera "API tier" scene stills).

**When to record knowledge in a skill vs. docs:**

- A skill captures the distilled form: API-usage invariants (e.g. init order), gotchas that produce broken code when unknown, decision guides (which API tier to use), and proven recipes (goal → composition). When you uncover such a pattern while working, add it to the relevant skill first — keep entries terse and verified against the implementation, never guessed.
- Knowledge flows **skills → docs**: user-facing content accumulated in skills should then be expanded into the documentation site (`docs/`, published at https://navara.world/docs/) following its writing rules. Docs are the human-facing, exhaustive form; skills stay the LLM-facing, distilled form.
- Do not reduce skills to link indexes into the docs, and do not duplicate exhaustive API listings into skills — for exact property names and signatures, skills point to the docs site and TypeScript definitions instead.
