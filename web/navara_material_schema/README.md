# @navaramap/material-schema

Every layer material the Navara engine accepts, as plain JSON: the materials
each layer type carries, and every field of each material with its kind,
documentation, engine default, accepted values, and when a change takes
effect. Use it to build a style editor or to check a style without loading
the engine.

It has no dependencies. To read the current style of a layer on a map, use
`MaterialSchemaPlugin` from `@navaramap/three-plugins`, which builds on this
package.

```typescript
import { MATERIAL_SCHEMA, materialField } from "@navaramap/material-schema";

MATERIAL_SCHEMA.version; // the Navara version it describes
MATERIAL_SCHEMA.layers.raster; // ["raster", "hillshade", "elevationHeatmap"]
materialField("polygon", "clampToGround");
// { name: "clampToGround", kind: "boolean", default: false, applies: "reload", … }
```

## Versions

Navara packages are released together with one version number. Use the same
version of this package as of `@navaramap/three`: a field added in a newer
engine is not in an older schema. When `@navaramap/three` is installed too,
the package manager warns if the two versions differ.

## Development

`src/materialSchema.json` is generated from the engine's Rust sources and
`scripts/material-applies.mjs`. Never edit it by hand; run
`pnpm run generate:schema` after changing a material. A test fails when the
JSON is out of date. See the `navara-material-schema-sync` skill in the
repository for the full flow.

## Documentation

https://navara.world/docs/three_plugins/materialschemaplugin/
