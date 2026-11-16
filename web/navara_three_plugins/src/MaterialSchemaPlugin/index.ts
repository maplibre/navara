// The package entry (src/index.ts) re-exports only the public names; the
// layer description helpers are shared with the devtools Layers tool.
export {
  MaterialSchemaPlugin,
  type FieldState,
  type LayerStyle,
  type MaterialState,
} from "./MaterialSchemaPlugin";
export { descriptionOf, isPlainObject } from "./layerDescriptions";
