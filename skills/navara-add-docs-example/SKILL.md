---
name: navara-add-docs-example
description: >
  Conventions for adding or updating code examples in the Navara documentation
  site (docs/). Use when writing or editing code snippets in docs pages, adding
  a new docs page with examples, or syncing docs code with API changes.
---

# Adding code examples to the Navara docs

**First read [.claude/skills/navara-usage/SKILL.md](../navara-usage/SKILL.md)** (and the reference matching the topic) so the snippet demonstrates correct, idiomatic API usage. The authoritative process docs live in the repo — read them before writing:

- `docs/AGENTS.md` — entry point and key principles
- `docs/guide/WRITING_RULES.md` — terminology and link rules
- `docs/guide/NAVARA_THREE_INSTRUCTIONS.md` — update workflow, package→section map, WASM `.d.ts` handling
- `docs/guide/NAVARA_THREE_UPDATE_CHECKLIST.md` — scenario checklists
- `docs/guide/TRANSLATION_GUIDE.md` — when touching `ja/`

## Non-negotiable principles

1. **The code is the source of truth — match the implementation exactly.** Types, parameter names, return values, and defaults in a snippet must match the TypeScript source (verify by reading the actual exports/JSDoc, never guess). Material/WASM types are documented in their **normalized** shape (plain optional properties via `NormalizeWASMClass`), not the raw WASM class with `free()`/getters — extract from the getters in `web/wasm/**/*.d.ts`.
2. **English first.** Root locale is English and is the source of truth; `ja/` mirrors the structure. Write/update English, then mirror to `ja/` (technical terms and API names stay in English in every locale).
3. **Examples must be complete and runnable** — include imports and required setup (e.g. `await view.init()` before `addLayer`), not fragments that would throw if pasted.
4. **Snippets must respect API invariants** — e.g. never show `addPlugin` after `init()`, never show writes to `camera.raw.fov`, show `Layer.update()` with a full config. See the gotcha list in navara-usage.

## Where docs live

(Copied from `NAVARA_THREE_INSTRUCTIONS.md` — that file wins on conflict.)

| Package | Docs section under `docs/src/content/docs/` |
|---|---|
| `web/navara_three/` | `three/` |
| `web/navara_three_api/` | `three/API/` |
| `web/navara_three_default_descs/` | `three_default_descs/` |
| `web/navara_three_default_plugin/` | `three_default_plugin/` |
| `web/navara_three_plugins/` | `three_plugins/` |
| `web/wasm/` | `engine/` |

## Writing rules that trip people up

- **Terminology:** rendered things are "objects"; classes/config are "**Descriptor**" (never translate this term); resource layers added via `addLayer()` stay "layer" / 「レイヤー」.
- **API/feature names are never transliterated into katakana** in `ja/`: write "Selective Bloom", not 「セレクティブブルーム」. Surround the English term with half-width spaces inside Japanese text.
- **Links must be lowercase** (Starlight lowercases directory slugs): `../../../three/api/feature-evaluator/`, not `.../API/...`; spaces become hyphens (`Resource Layer/` → `resource-layer/`), never `%20`.
- Prefer relative paths for page links, `@assets/` for images, `@components/` for component imports.
- Every code block declares its language; frontmatter needs `title`, `description`, `sidebar.order`.
- Add new examples **alongside** existing ones; don't remove or restructure existing content.

## Quality checklist before finishing

- [ ] Signatures verified against the TypeScript source (not memory, not other docs)
- [ ] Snippet is runnable top-to-bottom and follows the canonical init order
- [ ] English page updated first; `ja/` mirror updated (or explicitly deferred)
- [ ] Links lowercase and unbroken; existing structure preserved
