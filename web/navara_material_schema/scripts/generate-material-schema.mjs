#!/usr/bin/env node
/* global console, process */
// Generates src/materialSchema.json: the materials each
// layer type carries, and every field a material accepts with its kind,
// description, engine default, options and when it takes effect.
//
// Sources (re-run `pnpm run generate:schema` after changing any):
// - crates/navara_wasm/src/source_types.rs: the layer descriptions, whose
//   `Option<XMaterial>` fields name each layer type's materials.
// - crates/navara_wasm_types/src/appearance.rs: the JS-facing material
//   structs (field names, types, doc comments).
// - crates/navara_material/src/appearance.rs: the internal materials, whose
//   `impl Default` holds the defaults and whose enums' `parse` functions hold
//   the accepted strings.
// - scripts/material-applies.mjs: which fields apply only on reload, or never.
// - ENUM_SOURCES: enums the internal materials take from other crates.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

import { NEVER, RELOAD } from "./material-applies.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const layerSrc = read("crates/navara_wasm/src/source_types.rs");
const wasmSrc = read("crates/navara_wasm_types/src/appearance.rs");
const internalSrc = read("crates/navara_material/src/appearance.rs");
/** Files whose enums' `parse` functions the internal materials also use. */
const ENUM_SOURCES = ["crates/navara_geometry/src/polygon/types.rs"];
const outFile = resolve(here, "../src/materialSchema.json");

/** Layer `type` → its description struct in source_types.rs. */
const LAYERS = {
  vector: "VectorLayerDescription",
  raster: "RasterLayerDescription",
  terrain: "TerrainSourceLayerDescription",
  "3d-tiles": "Tiles3dLayerDescription",
};

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
      const m = /^pub (\w+): (.+?),(?:\s*\/\/.*)?$/.exec(line);
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

const enums = Object.assign(
  parseEnums(internalSrc),
  ...ENUM_SOURCES.map((path) => parseEnums(read(path))),
);
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

/** Fails the run: the sources changed in a way this script cannot read. */
function fail(message) {
  console.error(`generate-material-schema: ${message}`);
  process.exit(1);
}

const wasmToKey = Object.fromEntries(
  Object.entries(MATERIALS).map(([key, [wasmName]]) => [wasmName, key]),
);
const known = new Set(Object.values(LAYERS));
for (const [, struct] of layerSrc.matchAll(
  /^pub struct (\w+LayerDescription) \{/gm,
)) {
  if (!known.has(struct)) fail(`${struct} is missing from LAYERS`);
}
const layers = {};
for (const [type, struct] of Object.entries(LAYERS)) {
  const body = structBody(layerSrc, struct);
  if (!body) fail(`no struct ${struct} in source_types.rs`);
  // Every struct-typed field is a material, whatever its name ends with
  // (`Option<ContourConfig>` too); only `String` and lists are not.
  layers[type] = parseFields(body)
    .map((f) => ({ f, name: /^Option<([A-Z]\w*)>$/.exec(f.type)?.[1] }))
    .filter(({ name }) => name !== undefined && name !== "String")
    .map(({ f, name }) => {
      const key = wasmToKey[name];
      if (!key) fail(`${struct} has ${name}, missing from MATERIALS`);
      if (jsName(f) !== key) fail(`${struct}.${f.name} is not named ${key}`);
      return key;
    });
}
const used = new Set(Object.values(layers).flat());
for (const key of Object.keys(MATERIALS)) {
  if (!used.has(key)) fail(`MATERIALS.${key} is on no layer description`);
}

const materials = {};
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
    const name = jsName(field);
    const entry = { name, kind };
    if (doc) entry.doc = doc;
    const def =
      field.name in defaults ? evalDefault(defaults[field.name]) : undefined;
    const value = def !== undefined ? def : docDefault(doc);
    if (value !== undefined) entry.default = value;
    if (kind === "enum" || kind === "enumList") {
      entry.options = Object.values(enums[innerType(internal.type)]);
    }
    const reload = RELOAD[key]?.[name];
    const never = NEVER[key]?.[name];
    entry.applies =
      reload !== undefined ? "reload" : never !== undefined ? "never" : "live";
    if (reload || never) entry.note = reload || never;
    fields.push(entry);
  }
  materials[key] = fields;
}

for (const [key, names] of Object.entries(RELOAD)) {
  for (const name of Object.keys(names)) {
    if (NEVER[key]?.[name] !== undefined) {
      fail(`material-applies.mjs has ${key}.${name} in both RELOAD and NEVER`);
    }
  }
}
for (const [table, entries] of Object.entries({ RELOAD, NEVER })) {
  for (const [key, names] of Object.entries(entries)) {
    for (const name of Object.keys(names)) {
      if (!materials[key]?.some((f) => f.name === name)) {
        fail(`material-applies.mjs ${table}.${key}.${name} is not a field`);
      }
    }
  }
}

const schema = { layers, materials };
const output = await format(JSON.stringify(schema), {
  ...(await resolveConfig(outFile)),
  filepath: outFile,
});
const count = Object.values(materials).reduce((n, f) => n + f.length, 0);
if (process.argv.includes("--check")) {
  // Used by the unit test: fails when the schema lags the sources.
  let current = "";
  try {
    current = readFileSync(outFile, "utf8");
  } catch {
    // A missing file is out of date too.
  }
  if (current !== output) {
    fail(`${outFile} is out of date; run \`pnpm run generate:schema\`.`);
  }
} else {
  writeFileSync(outFile, output);
  console.log(`Wrote ${count} fields to ${outFile}`);
}
