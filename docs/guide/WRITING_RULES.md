# Writing Rules

Please follow these rules when you modify this repository.

## Prose style: no dash decorations, no semicolons

Do not decorate prose with em dashes, en dashes, or double hyphens (`—`, `–`, `--`), and do not join clauses with semicolons (`;`). Write full sentences instead, using commas, colons, parentheses, "because" / "for example", or by splitting into two sentences. This applies to both locales.

- Definition bullets and table description cells use a colon: `**Label**: description` (not `**Label** — description`).
- Two independent clauses become two sentences: "All fields are optional. An unset field keeps the default color." (not "All fields are optional; an unset field …").
- Property metadata lines are separate paragraphs, never joined on one line:

  ```markdown
  **Type:** `boolean | undefined`

  **Default:** `true`
  ```

- A table cell containing only `—` is a placeholder meaning "no default / not applicable". Keep those as-is.
- Ordinary hyphens in words (built-in, level-of-detail), markdown table separator rows, and code (semicolons included) are unaffected.

## One property, one section

A documented option gets its own `###` section with the four metadata fields in this order, each its own paragraph:

```markdown
### shadowSoftness

**Type:** `number | undefined`

**Description:** Radius of the screen-space blur applied to the shadow edge, in pixels.

**Default:** `1.5`

**Example:**
```

This holds for every flat key of a config object, including the ones that only matter while another option is on (`shadowIntensity` and `shadowSoftness` next to `shadow`). Do not collect them into an ad-hoc "Options" table under the parent property: a table is for the fields of a nested object type, which the page documents as a single property.

A property with preconditions may add a short `Requirements:` bullet list to its Description. The four fields stay in order around it.

## Write only what the reader cannot infer

Cut any sentence that follows from the previous one, from the type, or from the property name. Each of these adds nothing:

- "`0` disables the shadow" after "Scales the shadow".
- "The term does nothing otherwise" after listing that option as a requirement.
- "Ignored while `shadowSoftness` is `0`" on the sample count of that blur.
- "Unlit terrain casts no shadow."

Keep the half a reader cannot derive: how the option differs from the obvious alternative ("unlike switching `shadow` off, `0` does not recompile the shader"), what it does not reach (transparent surfaces), and which other option it depends on. A Description is usually two to four sentences.

## Describe behavior, not implementation

Documentation pages are for people using the API. Leave out G-buffer attachments, shader defines, compile-out conditions, pass ordering, and internal file or class names. Those belong in [`guide/`](../../guide/HOW_TO_WRITE_DOCUMENT.md).

Facts that originate in the implementation stay when the reader acts on them: which options must be enabled together, what a value below a threshold does, which layer or material types are affected.

## State what an option does, not what it restores

An option is described by the result the reader gets, not by the internal state it compensates for. Whether a feature was "lost" on another path and "brought back" is pipeline history the reader never sees.

- Not: "Re-applies the sun's cascaded shadows, which `view.lit = false` drops."
- But: "Enables the sun's shadows in a scene lit by `irradiance`."

## State facts, not impressions

Describe what happens, not how it looks. A visual judgment ("washes out", "looks wrong", "too bright") is subjective and hides the cause the reader needs to act on.

- Not: "Left at its default, the scene washes out."
- But: "Left at its default, lighting is applied twice (forward pass + atmosphere)."

## Terminology

### "Layer" vs "Object" vs "Descriptor"

Mesh, effect, and light APIs were renamed from `*Layer` to `*Desc`. Use the following terms in documentation:

| Context | Term | Example |
|---------|------|---------|
| The rendered thing itself (generic reference) | **object** | "Add a mesh object to the scene" |
| Configuration, class definition, or implementation | **Descriptor** | "Register a Descriptor class", "Can only be set at Descriptor creation time" |
| Resource layers (added via `addLayer()`) | **layer** (unchanged) | "GeoJSON layer", "terrain layer" |

- Do not translate "Descriptor" — use the English term as-is in all locales
- Resource layers retain the term "layer" (or "レイヤー" in Japanese)

### API and feature names stay in English

Write the names of APIs, effects, and features as-is in every locale. Never transliterate them into katakana:

- "Selective Bloom", not 「セレクティブブルーム」
- `FeatureEvaluator`, `SelectiveBloomEffectDesc`, "Bloom", "Outline" stay as-is

Generic prose around the name is still translated (「Selective Bloom を駆動します」). Surround the English term with half-width spaces when it sits inside Japanese text.

## Link paths must be lowercase

Astro/Starlight converts directory names to lowercase slugs when generating URLs (e.g., `API/` becomes `api/`, `Resource Layer/` becomes `resource-layer/`). All link paths in markdown must use lowercase to match the generated URLs.

- `../../../three/api/feature-evaluator/` not `../../../three/API/feature-evaluator/`
- `../../../three/introduction/about-layer/` not `../../../three/Introduction/about-layer/`
- `../../../three/api/navara_three_api` not `../../../three/API/navara_three_api`
- `#elevationdecoder-type` not `#ElevationDecoder-type`

Spaces in directory names become hyphens (e.g., `Resource Layer/` → `resource-layer/`). Do not use `%20` encoding.

## Prefer alias or relative path

- Link to a page: `[Page name](../../../link/to/page)`, not `/link/to/page`.
- Link to a asset: `![Alt](@assets/image.png)`
- Import a component: `import { Button } from "@components/Button"`

### Never use `./` for a sibling page

Every page is served at a directory URL with a trailing slash (`three_default_descs/Mesh Desc/about.md` → `/three_default_descs/mesh-desc/about/`), and Astro emits markdown link hrefs verbatim. The browser therefore resolves `./sibling` *inside* the current page's own URL and 404s:

- `[ArclineMeshDesc](../arcline-mesh-desc)` — resolves to `/three_default_descs/mesh-desc/arcline-mesh-desc`
- `[ArclineMeshDesc](./arcline-mesh-desc)` — resolves to `/three_default_descs/mesh-desc/about/arcline-mesh-desc` (404)

Use `../` to reach a sibling page, `../../` to reach a sibling directory, and so on. This applies to every page, not just `about.md` index pages.

