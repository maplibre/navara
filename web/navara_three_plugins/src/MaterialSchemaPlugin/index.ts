// The package entry (src/index.ts) re-exports only the public names; the
// layer description helpers are shared with the devtools Layers tool.
export {
  MaterialSchemaPlugin,
  type FieldState,
  type LayerStyle,
  type MaterialState,
} from "./MaterialSchemaPlugin";
export {
  MATERIAL_SCHEMA,
  materialField,
  type FieldApplies,
  type FieldKind,
  type MaterialField,
  type MaterialSchema,
} from "./materialSchema";
export { descriptionOf, isPlainObject } from "./layerDescriptions";
