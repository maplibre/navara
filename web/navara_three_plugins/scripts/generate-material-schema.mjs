#!/usr/bin/env node
/* global console, process */
// Generates src/devtools/layers/materialSchema.generated.ts: every field a layer
// material accepts, with its kind, description, engine default and options.
//
// Sources (re-run `pnpm run generate:schema` after changing either):
// - crates/navara_wasm_types/src/appearance.rs: the JS-facing material
//   structs (field names, types, doc comments).
// - crates/navara_material/src/appearance.rs: the internal materials, whose
//   `impl Default` holds the defaults and whose enums' `parse` functions hold
//   the accepted strings.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const wasmSrc = readFileSync(
  resolve(root, "crates/navara_wasm_types/src/appearance.rs"),
  "utf8",
);
const internalSrc = readFileSync(
  resolve(root, "crates/navara_material/src/appearance.rs"),
  "utf8",
);
const outFile = resolve(
  here,
  "../src/devtools/layers/materialSchema.generated.ts",
);

/** Layer description key → [wasm struct, internal struct]. */
const MATERIALS = {
  point: ["PointMaterial", "PointMaterial"],
  billboard: ["BillboardMaterial", "BillboardMaterial"],
  text: ["TextMaterial", "TextMaterial"],
  polyline: ["PolylineMaterial", "PolylineMaterial"],
  polygon: ["PolygonMaterial", "PolygonMaterial"],
  model: ["ModelMaterial", "ModelMaterial"],
  raster: ["RasterMaterial", "RasterMaterial"],
  terrain: ["TerrainMaterial", "TerrainMaterial"],
  elevationHeatmap: ["ElevationHeatmapMaterial", "ElevationHeatmapConfig"],
  hillshade: ["HillshadeMaterial", "HillshadeConfig"],
};

/** The `{ ... }` body of `pub struct Name`, or "" when absent. */
function structBody(src, name) {
  const start = src.search(new RegExp(`^pub struct ${name} \\{`, "m"));
  if (start < 0) return "";
  const end = src.indexOf("\n}", start);
  return src.slice(src.indexOf("{", start) + 1, end);
}

/** Fields of a struct body: name, type, doc, attributes. */
function parseFields(body) {
  const fields = [];
  let doc = [];
  let attrs = [];
  /** An attribute spanning several lines, until its closing `]`. */
  let openAttr;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (openAttr !== undefined) {
      openAttr += " " + line;
      if (line.endsWith("]")) {
        attrs.push(openAttr);
        openAttr = undefined;
      }
    } else if (line.startsWith("///")) {
      doc.push(line.replace(/^\/\/\/ ?/, ""));
    } else if (line.startsWith("#[")) {
      if (line.endsWith("]")) attrs.push(line);
      else openAttr = line;
    } else if (line.startsWith("pub ")) {
      const m = /^pub (\w+): (.+),$/.exec(line);
      if (m) fields.push({ name: m[1], type: m[2], doc: doc.join(" "), attrs });
      doc = [];
      attrs = [];
    } else if (line === "" || line.startsWith("//")) {
      // Blank lines and plain comments end nothing; keep doc for the field.
    }
  }
  return fields;
}

/** The name JS passes: serde's rename (what deserializes), else js_name. */
function jsName(field) {
  for (const attr of field.attrs) {
    const m = /serde\([^\]]*\brename = "([^"]+)"/.exec(attr);
    if (m) return m[1];
  }
  for (const attr of field.attrs) {
    const m = /js_name = (\w+)/.exec(attr);
    if (m) return m[1];
  }
  return field.name;
}

/** Enum name → { variant → JS string } from each enum's `parse`. */
function parseEnums(src) {
  const enums = {};
  const implRe = /^impl (\w+) \{/gm;
  let m;
  while ((m = implRe.exec(src))) {
    const name = m[1];
    const body = src.slice(m.index, src.indexOf("\n}", m.index));
    const parse = body.indexOf("fn parse(");
    if (parse < 0) continue;
    const parseBody = body.slice(parse, body.indexOf("\n    }", parse));
    const pairs = [...parseBody.matchAll(/"([\w-]+)" => Some\(Self::(\w+)\)/g)];
    if (pairs.length === 0) continue;
    enums[name] = Object.fromEntries(pairs.map(([, s, v]) => [v, s]));
  }
  return enums;
}

/** `name: expr` pairs of `impl Default for Name`. */
function parseDefaults(src, name) {
  const start = src.indexOf(`impl Default for ${name} {`);
  if (start < 0) return {};
  const body = src.slice(start, src.indexOf("\n}", start));
  const out = {};
  for (const m of body.matchAll(/^\s+(\w+): (.+),\s*$/gm)) out[m[1]] = m[2];
  return out;
}

function parseConsts(src) {
  const out = {};
  for (const m of src.matchAll(/const (\w+): \w+ = ([^;]+);/g))
    out[m[1]] = m[2];
  return out;
}

const enums = parseEnums(internalSrc);
const consts = parseConsts(internalSrc);

function number(text) {
  const t = text
    .trim()
    .replace(/_/g, "")
    .replace(/f(32|64)$/, "");
  if (/^-?0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16);
  if (/^-?\d+\.?\d*(e-?\d+)?$/i.test(t)) return Number(t);
  return undefined;
}

/** A Rust default expression as a JSON value, or undefined when unknown. */
function evalDefault(expr) {
  const e = expr.trim();
  if (e === "true" || e === "false") return e === "true";
  const n = number(e);
  if (n !== undefined) return n;
  if (e === "None") return undefined;
  if (consts[e] !== undefined) return evalDefault(consts[e]);
  let m = /^Some\((.+)\)$/.exec(e);
  if (m) return evalDefault(m[1]);
  m = /^(\w+)::(\w+)$/.exec(e);
  if (m && enums[m[1]]?.[m[2]]) return enums[m[1]][m[2]];
  if (e === "Vec2::ZERO") return { x: 0, y: 0 };
  m = /^Vec2::new\((.+), (.+)\)$/.exec(e);
  if (m) return { x: number(m[1]), y: number(m[2]) };
  m = /^\[(.+); (\d+)\]$/.exec(e);
  if (m) return Array(Number(m[2])).fill(evalDefault(m[1]));
  m = /^vec!\[(.*)\]$/.exec(e);
  if (m) return m[1].trim() ? m[1].split(",").map((v) => evalDefault(v)) : [];
  if (e === "Vec::new()") return [];
  m = /^"(.*)"\.(to_string|to_owned|into)\(\)$/.exec(e);
  if (m) return m[1];
  return undefined;
}

/** `Defaults to `X`` / `(default: X)` in a doc comment, as a fallback. */
function docDefault(doc) {
  const m =
    /[Dd]efaults? to `([^`]+)`/.exec(doc) ?? /\(default: ([^)]+)\)/.exec(doc);
  if (!m) return undefined;
  const v = m[1].replace(/^"|"$/g, "");
  return number(v) ?? (v === "true" ? true : v === "false" ? false : v);
}

/** Enum name wrapped by an internal field type (`Option<Anchor>`, `Vec<X>`). */
function innerType(type) {
  const m = /^(?:Option|Vec)<(.+)>$/.exec(type);
  return m ? innerType(m[1]) : type;
}

function kindOf(name, type, internalType) {
  const inner = innerType(type);
  const enumName = internalType && innerType(internalType);
  if (/^Option<Vec</.test(type) && enums[enumName]) return "enumList";
  if (/^Option<Vec</.test(type)) return "list";
  if (inner === "bool") return "boolean";
  if (inner === "Vec2") return "point";
  if (inner === "u32" && /color$/i.test(name)) return "color";
  if (/^(f32|f64|u8|u16|u32|i32|usize)$/.test(inner)) return "number";
  if (inner === "String") return enums[enumName] ? "enum" : "string";
  return "list";
}

const schema = {};
for (const [key, [wasmName, internalName]] of Object.entries(MATERIALS)) {
  const internalFields = Object.fromEntries(
    parseFields(structBody(internalSrc, internalName)).map((f) => [f.name, f]),
  );
  const defaults = parseDefaults(internalSrc, internalName);
  const fields = [];
  for (const field of parseFields(structBody(wasmSrc, wasmName))) {
    if (field.name.startsWith("_")) continue;
    const internal = internalFields[field.name];
    const kind = kindOf(field.name, field.type, internal?.type);
    const doc = (field.doc || internal?.doc || "").replace(/\s+/g, " ").trim();
    const entry = { name: jsName(field), kind };
    if (doc) entry.doc = doc;
    const def =
      field.name in defaults ? evalDefault(defaults[field.name]) : undefined;
    const value = def !== undefined ? def : docDefault(doc);
    if (value !== undefined) entry.default = value;
    if (kind === "enum" || kind === "enumList") {
      entry.options = Object.values(enums[innerType(internal.type)]);
    }
    fields.push(entry);
  }
  schema[key] = fields;
}

const header = `// Generated by scripts/generate-material-schema.mjs from
// crates/navara_wasm_types/src/appearance.rs and
// crates/navara_material/src/appearance.rs. Do not edit; re-run
// \`pnpm run generate:schema\` after changing a material.

/** How a field is edited. */
export type FieldKind =
  | "boolean"
  | "number"
  | "color"
  | "enum"
  | "enumList"
  | "string"
  | "point"
  | "list";

/** One field of a layer material. */
export type MaterialField = {
  /** The JS-facing name. */
  name: string;
  kind: FieldKind;
  /** The field's doc comment from the engine source. */
  doc?: string;
  /** The engine's value when the field is not set; absent when it is derived. */
  default?: unknown;
  /** Accepted strings for \`enum\` and \`enumList\` fields. */
  options?: string[];
};

/** Material key in a layer description → its fields, in source order. */
export const MATERIAL_SCHEMA: Record<string, MaterialField[]> = `;
const output = await format(header + JSON.stringify(schema, null, 2) + ";\n", {
  ...(await resolveConfig(outFile)),
  filepath: outFile,
});
const count = Object.values(schema).reduce((n, f) => n + f.length, 0);
if (process.argv.includes("--check")) {
  // Used by the unit test: fails when the schema lags the Rust sources.
  if (readFileSync(outFile, "utf8") !== output) {
    console.error(
      `${outFile} is out of date with the Rust materials; run \`pnpm run generate:schema\`.`,
    );
    process.exit(1);
  }
} else {
  writeFileSync(outFile, output);
  console.log(`Wrote ${count} fields to ${outFile}`);
}
