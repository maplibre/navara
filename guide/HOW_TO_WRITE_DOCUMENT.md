# How to Write Documentation

For detailed instructions, see the guides in [`docs/`](../docs/).

## Where a piece of knowledge goes

Each layer has one audience, and a fact belongs to exactly one of them.

| Layer     | Audience                     | Contents                                                                                                                  |
| --------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `guide/`  | people working on the engine | implementation detail: pass ordering, G-buffer layout, shader anchors, define stamping, invariants a change must preserve |
| `docs/`   | people using the API         | behavior, options, requirements, worked examples. No internals. See [WRITING_RULES.md](../docs/guide/WRITING_RULES.md)    |
| `skills/` | coding agents                | the distilled form, per [AGENTS.md](../AGENTS.md): usage invariants, gotchas, decision guides, recipes. Not a link index  |

Do not restate one layer in another. When an internal explains a user-facing
rule, the rule goes in `docs/` and the internal stays in `guide/`. When a
`guide/` page starts explaining how to call the API, that paragraph belongs in
`docs/`.

Write each layer tersely. A fact a reader can infer from the one before it, or
from a type signature, is not worth a sentence anywhere.

## Steps

1. **Add doc comments to source code** — JSDoc (`/** ... */`) for TypeScript, doc comments (`///`) for Rust public APIs.
2. **Write a documentation page** — Add a `.md` file under the matching section in `docs/src/content/docs/`. Follow the format of existing pages in that section.
3. **Add translations** — Add the same content for all supported languages (e.g., `ja/`). A coding agent will automatically translate.
