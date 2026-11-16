// Read from package.json, not a build-time define: bundlers that compile
// this package from `src` (the workspace examples) know no such define.
// scripts/set-version.mjs stamps the version before a release build.
import { version } from "../package.json";

import schemaJson from "./materialSchema.json";

/** The value type of a field, which decides how a UI edits it. */
export type FieldKind =
  | "boolean"
  | "number"
  /** A `Color`; a hex number such as `0xff0000` in JSON. */
  | "color"
  /** One of `options`. */
  | "enum"
  /** A list of `options`. */
  | "enumList"
  | "string"
  /** `{ x, y }`. */
  | "point"
  /** Any other list or structure, as JSON. */
  | "list";

/**
 * When a change of the field takes effect:
 * - `"live"`: as soon as `layer.update()` sets it.
 * - `"reload"`: the engine reads it only when it builds the layer, its tiles
 *   or its meshes. What is already drawn changes after the layer is removed
 *   and added again; MVT and tiled layers also use it for tiles loaded later.
 * - `"never"`: the engine does not read it on a layer.
 */
export type FieldApplies = "live" | "reload" | "never";

/** One field of a layer material. */
export type MaterialField = {
  /** The JS-facing name. */
  name: string;
  kind: FieldKind;
  /** The field's doc comment from the engine source. */
  doc?: string;
  /**
   * The engine's value when the field is not set, as JSON; absent when the
   * engine derives it.
   */
  default?: unknown;
  /** Accepted strings for `enum` and `enumList` fields. */
  options?: string[];
  applies: FieldApplies;
  /** More on when the field applies. */
  note?: string;
};

/**
 * Every layer material the engine accepts, generated from its Rust sources
 * by `scripts/generate-material-schema.mjs`. Plain JSON.
 */
export type MaterialSchema = {
  /**
   * The Navara version this schema describes. Navara packages are released
   * together, so it is also the `@navaramap/three` version it matches.
   */
  version: string;
  /** Layer `type` → the material keys its description carries. */
  layers: Record<string, string[]>;
  /** Material key → its fields, in source order. */
  materials: Record<string, MaterialField[]>;
};

/** Freezes `value` and everything in it. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** Frozen: shared by every caller, so it cannot be changed in place. */
export const MATERIAL_SCHEMA: MaterialSchema = deepFreeze({
  version,
  ...(schemaJson as Omit<MaterialSchema, "version">),
});

/** The field `name` of material `key`. */
export function materialField(
  key: string,
  name: string,
): MaterialField | undefined {
  return MATERIAL_SCHEMA.materials[key]?.find((f) => f.name === name);
}
