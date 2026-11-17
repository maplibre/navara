---
name: navara-material-schema-sync
description: >
  Keep the layer material schema (@navaramap/material-schema, web/navara_material_schema/src/materialSchema.json,
  read by MaterialSchemaPlugin and the devtools Layers tool) in sync with the engine.
  Use after adding, renaming or removing a material field, changing a material default or enum,
  adding a material or layer type, or changing when the engine reads a field (on update vs.
  only when the layer is built); also when the "MATERIAL_SCHEMA is up to date" test or
  `pnpm run generate:schema` fails.
---

# Material schema sync

`materialSchema.json` is generated. Never edit it by hand.

```
crates/navara_wasm/src/source_types.rs        *LayerDescription structs → "layers"
crates/navara_wasm_types/src/appearance.rs    JS-facing fields, types, docs   ┐
crates/navara_material/src/appearance.rs      defaults, enum strings, docs    ├→ "materials"
web/navara_material_schema/scripts/material-applies.mjs  RELOAD / NEVER        ┘  (applies, note)
        │  pnpm -C web/navara_material_schema run generate:schema
        ▼
web/navara_material_schema/src/materialSchema.json   @navaramap/material-schema (public, no engine dependency)
        │
        ├─► navara_three_plugins/src/MaterialSchemaPlugin/  describeLayer() (public API)
        └─► navara_three_plugins/src/devtools/layers/*      Layers tool UI
```

`MATERIAL_SCHEMA.version` is not in the JSON: `src/index.ts` imports it from
the package's own `package.json`, which `scripts/set-version.mjs` stamps in
lockstep with `@navaramap/three` before a release build. Keep it an import,
not a build-time define: bundlers that compile the package from `src` (the
workspace examples) know no such define.

## Flow

1. Change the Rust material.
2. Run `pnpm -C web/navara_material_schema run generate:schema`. It fails, naming
   the cause, when a layer struct has a material missing from `MATERIALS`, a
   `MATERIALS` entry is on no layer, a `*LayerDescription` struct is missing
   from `LAYERS`, or `material-applies.mjs` names a field that does not exist
   (a rename or removal: update the table) or is in both `RELOAD` and `NEVER`.
3. Read `git diff` of the JSON. Each changed field should show the `kind`,
   `default` and `options` you intended. See [Parser limits](#parser-limits)
   when one is missing or wrong.
4. Set `applies` for each new or changed field (next section).
5. Update the hand-kept lists ([Hand-kept lists](#hand-kept-lists)).
6. Run `pnpm -C web/navara_material_schema test` and
   `pnpm -C web/navara_three_plugins test`, then check the field in the
   Devtools example (`/examples/demo/plugin/devtools`, Layers tab).

## Deciding `applies`

A field not in `material-applies.mjs` is `"live"`. On `layer.update()` the
engine merges the patch (`merge_material!` in `source_types.rs`) and copies
the whole material onto the layer and its existing features (e.g.
`update_mvt_layer` in `navara_mvt`, `PolygonMaterial::update`). So copying
says nothing. What matters is where the field is read:

| The field is read… | `applies` | Table |
| --- | --- | --- |
| when features, meshes or tiles are drawn or re-synced to the frontend | `"live"` | none |
| only where geometry, placement or tiles are built (mesh generation, tile load, clamping, tiling) | `"reload"` | `RELOAD` |
| nowhere for that layer type (parsed, stored, never used) | `"never"` | `NEVER` |

Find the readers with `grep -rn "<snake_name>" crates/ web/navara_three/src`,
leaving out the struct, `Default`, `merge` and `Into` lines. Never guess:
confirm in the Devtools example. Edit the field and watch the map; `↻` fields
must change only after "Reload layer". A field live on some layers and reload
on others is `"reload"` with a `note` naming where it applies at once (see
`polygon.outlineShow`, `model.height`). A `note` is shown to users as is:
write it as a plain sentence.

## Parser limits

`generate-material-schema.mjs` reads the Rust text with regexes. It reads:

- **Fields**: one line, `pub name: Type,`, with `///` docs and
  `#[serde(rename = "…")]` or `js_name = …` above. Names starting with `_` are
  skipped. A doc missing on the wasm field falls back to the internal one.
- **`kind`**: `Option<Vec<…>>` → `enumList` when the internal type is an enum,
  else `list`. `bool` → `boolean`, `Vec2` → `point`, a `u32` **whose name ends
  in `color`** → `color`, other numbers → `number`, `String` → `enum` when the
  internal type is an enum, else `string`. Anything else → `list`.
- **Enums**: only those with a `fn parse(` matching `"str" => Some(Self::V)`.
  An enum parsed some other way gives a `string` field without `options`.
- **Defaults**: `impl Default for <internal struct>`, one field per line.
  Evaluated: literals, `Some(x)`, consts, `Enum::Variant`, `Vec2::ZERO`,
  `Vec2::new(a, b)`, `[x; n]`, `vec![…]`, `Vec::new()`, `"s".to_string()`.
  Else the doc's `` Defaults to `X` `` or `(default: X)`. Else no `default`
  (the UI shows "decided by the engine").
- **Materials**: the `MATERIALS` map (layer key → wasm struct, internal
  struct). A new material needs an entry there. A new layer type needs one in
  `LAYERS` (`type` string → `*LayerDescription` struct).

Prefer making the Rust fit these forms over adding a parser case. Add a case
only for a form many fields use, and cover it in
`web/navara_material_schema/src/index.test.ts`.

## Hand-kept lists

| Change | Also update |
| --- | --- |
| New `FieldKind` | `FieldKind` in `navara_material_schema/src/index.ts`, a `case` in `StyleEditor.addField` (`layerEditor.ts`, no control otherwise), the kinds in `docs/…/three_plugins/materialschemaplugin.md` (en and ja) |
| New / renamed material or layer type | `COMMON` (and `DISPLAY_FIRST` to show it first) in `navara_three_plugins/src/devtools/layers/layerEditor.ts`; `SHOWABLE`, `ON_TERRAIN`, `BOX_GROUP` in `LayerInspectorPlugin.ts` |
| Renamed / removed field | `COMMON` and `RANGES` in `layerEditor.ts` |
| New number field with a fixed range (0–1 etc.) | `RANGES` in `layerEditor.ts` |

`MATERIAL_KEYS` is built from `MATERIAL_SCHEMA.layers`, so it needs no edit.
`layerEditor.test.ts` fails when a `COMMON` name is not a field or a
`RANGES` name is not a number field. `SHOWABLE`, `ON_TERRAIN`, `BOX_GROUP` and `StyleEditor.addField` have
no test: check them by reading.

Field-level docs on the docs site are not hand-written (the schema is the
reference), so a field change needs no docs edit.
