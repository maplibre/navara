import { Color, type Layer, type LayerDescription } from "@navaramap/three";
import type { BindingParams, FolderApi } from "tweakpane";

import { hint } from "../util/html";

import {
  MATERIAL_SCHEMA,
  type MaterialField,
} from "./materialSchema.generated";

/** Material keys each layer type can carry, in display order. */
const MATERIAL_KEYS: Record<string, string[]> = {
  vector: ["polygon", "polyline", "point", "billboard", "text"],
  raster: ["raster", "hillshade", "elevationHeatmap"],
  terrain: ["terrain"],
  "3d-tiles": ["model"],
};

/** Keys shown even when the description does not carry them. */
const ALWAYS_SHOWN = new Set(["raster", "terrain", "model"]);

/** The fields most edited; the rest go under "More". Unknown names are skipped. */
const COMMON: Record<string, string[]> = {
  point: [
    "show",
    "color",
    "size",
    "sizeInMeters",
    "opacity",
    "height",
    "clampToGround",
    "declutter",
  ],
  billboard: [
    "show",
    "url",
    "color",
    "size",
    "sizeInMeters",
    "opacity",
    "anchor",
    "height",
    "clampToGround",
  ],
  text: [
    "show",
    "text",
    "font",
    "color",
    "size",
    "outlineColor",
    "outlineWidth",
    "backgroundColor",
    "anchor",
    "offset",
    "declutter",
  ],
  polyline: [
    "show",
    "color",
    "width",
    "opacity",
    "clampToGround",
    "height",
    "dashArray",
    "cap",
  ],
  polygon: [
    "show",
    "color",
    "opacity",
    "transparent",
    "height",
    "extrudedHeight",
    "clampToGround",
    "outlineShow",
    "outlineColor",
    "outlineWidth",
    "wireframe",
  ],
  model: [
    "show",
    "color",
    "opacity",
    "transparent",
    "metalness",
    "roughness",
    "castShadow",
    "receiveShadow",
    "showBoundingBox",
  ],
  raster: ["show", "color", "opacity", "showBoundingBox"],
  terrain: [
    "show",
    "exaggeration",
    "exaggerationRelativeHeight",
    "skirt",
    "castShadow",
    "receiveShadow",
    "showBoundingBox",
  ],
  hillshade: ["exaggeration"],
  elevationHeatmap: [
    "minHeight",
    "maxHeight",
    "logarithmic",
    "logBoundary",
    "filter",
  ],
};

/** Slider ranges for fields whose meaning bounds them. */
const RANGES: Record<string, { min: number; max: number; step?: number }> = {
  opacity: { min: 0, max: 1, step: 0.01 },
  outlineOpacity: { min: 0, max: 1, step: 0.01 },
  metalness: { min: 0, max: 1, step: 0.01 },
  roughness: { min: 0, max: 1, step: 0.01 },
  reflectivity: { min: 0, max: 1, step: 0.01 },
  borderWidth: { min: 0, max: 0.5, step: 0.01 },
  cornerRadius: { min: 0, max: 0.5, step: 0.01 },
  rotation: { min: -180, max: 180, step: 1 },
  outlineWidth: { min: 0, max: 20, step: 0.5 },
  outlineBlur: { min: 0, max: 10, step: 0.5 },
  exaggeration: { min: 0, max: 10, step: 0.1 },
  skirtExaggeration: { min: 0, max: 10, step: 0.1 },
  pointSize: { min: 0, max: 10, step: 0.1 },
  waveExaggeration: { min: 0, max: 5, step: 0.1 },
  waveDirection: { min: 0, max: 360, step: 1 },
  emissiveIntensity: { min: 0, max: 20, step: 0.1 },
};

const AUTO = "(auto)";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function toHex(value: unknown): string | undefined {
  if (value instanceof Color) {
    return `#${value.toHex().toString(16).padStart(6, "0")}`;
  }
  if (typeof value === "number") {
    return `#${value.toString(16).padStart(6, "0")}`;
  }
  return undefined;
}

function show(value: unknown): string {
  if (value === undefined) return "decided by the engine";
  const hex = toHex(value);
  if (hex && typeof value !== "boolean") return hex;
  return JSON.stringify(value);
}

/** The material keys an editor shows for a layer. */
export function materialKeys(layer: Layer): string[] {
  const desc = layer.description as unknown as Record<string, unknown>;
  return (MATERIAL_KEYS[desc.type as string] ?? []).filter(
    (key) => isPlainObject(desc[key]) || ALWAYS_SHOWN.has(key),
  );
}

/** Material keys a vector layer could add. */
function missingKeys(layer: Layer): string[] {
  const desc = layer.description as unknown as Record<string, unknown>;
  if (desc.type !== "vector") return [];
  return MATERIAL_KEYS.vector.filter((key) => !isPlainObject(desc[key]));
}

export type StyleEditorOptions = {
  /** Values of fields before this session first changed them, by `key.field`. */
  originals: Map<string, unknown>;
  /** Folder open / closed state, kept across rebuilds. */
  expanded: Map<string, boolean>;
  /** Called after a change that adds a material (the form must be rebuilt). */
  onStructureChange: () => void;
};

type Patch = Record<string, Record<string, unknown>>;

/**
 * A form for a layer's style, generated from the engine's material schema:
 * every field the material accepts, showing the layer's value or, when the
 * layer leaves it unset, the engine's default. A `•` after a name marks a
 * value set on the layer. Changes apply as you edit, merged into at most one
 * `layer.update()` per frame.
 */
export class StyleEditor {
  /** Top-level controls this editor added to the container. */
  private readonly controls: { dispose(): void }[] = [];
  private pending: Patch | undefined;
  private frame: number | undefined;
  private applyingNow = false;
  private undoButton: { title: string; disabled: boolean } & {
    element: HTMLElement;
    dispose(): void;
  };

  constructor(
    private readonly container: FolderApi,
    private readonly layer: Layer,
    private readonly options: StyleEditorOptions,
  ) {
    for (const key of materialKeys(layer)) this.addMaterial(key);
    const missing = missingKeys(layer);
    if (missing.length > 0) {
      const state = { add: "" };
      const add = this.container
        .addBinding(state, "add", {
          label: "add style",
          options: {
            "choose…": "",
            ...Object.fromEntries(missing.map((k) => [k, k])),
          },
        })
        .on("change", (ev) => {
          if (!ev.value) return;
          this.applyNow({ [ev.value]: { show: true } });
          this.options.onStructureChange();
        });
      add.element.title =
        "Draws this layer's data with another style as well, e.g. outlines (polyline) under fills (polygon). Polylines draw polygon edges only with geometryTypes: line + polygon.";
      this.controls.push(add);
    }
    this.undoButton = this.container
      .addButton({ title: "Undo my changes" })
      .on("click", () => this.undo());
    this.undoButton.element.title =
      "Puts back every value this panel changed on this layer. A field that was unset gets its engine default.";
    this.controls.push(this.undoButton);
    this.syncUndo();
  }

  /** True while this editor's own `layer.update()` runs. */
  isApplying(): boolean {
    return this.applyingNow;
  }

  dispose(): void {
    this.flush();
    for (const control of this.controls) control.dispose();
    this.controls.length = 0;
  }

  private addMaterial(key: string): void {
    const fields = MATERIAL_SCHEMA[key];
    if (!fields) return;
    const desc = this.layer.description as unknown as Record<string, unknown>;
    const values = (isPlainObject(desc[key]) ? desc[key] : {}) as Record<
      string,
      unknown
    >;
    const id = `${this.layer.id}:${key}`;
    const folder = this.container.addFolder({
      title: key,
      expanded: this.options.expanded.get(id) ?? true,
    });
    folder.on("fold", (ev) => this.options.expanded.set(id, ev.expanded));
    this.controls.push(folder);

    const common = new Set(COMMON[key] ?? []);
    const commonFields = (COMMON[key] ?? [])
      .map((name) => fields.find((f) => f.name === name))
      .filter((f): f is MaterialField => f !== undefined);
    const otherFields = fields.filter((f) => !common.has(f.name));
    for (const field of commonFields) this.addField(folder, key, field, values);
    if (otherFields.length > 0) {
      const moreId = `${id}:more`;
      const more = folder.addFolder({
        title: `More (${otherFields.length})`,
        expanded: this.options.expanded.get(moreId) ?? false,
      });
      more.on("fold", (ev) => this.options.expanded.set(moreId, ev.expanded));
      for (const field of otherFields) this.addField(more, key, field, values);
    }
  }

  private addField(
    folder: FolderApi,
    key: string,
    field: MaterialField,
    values: Record<string, unknown>,
  ): void {
    const set = field.name in values && values[field.name] !== undefined;
    const value = set ? values[field.name] : field.default;
    const label = `${field.name}${set ? " •" : ""}`;
    const title = [
      field.doc ?? "",
      `Default: ${show(field.default)}.`,
      set
        ? "Set on this layer (•)."
        : "Not set on this layer: the default applies.",
    ]
      .filter(Boolean)
      .join("\n");
    const state: Record<string, unknown> = {};
    const change = (v: unknown, live: boolean) => {
      if (live) this.apply(key, field.name, v, values);
      else this.applyNow(this.patchFor(key, field.name, v, values));
    };

    let api: { element: HTMLElement } | undefined;
    switch (field.kind) {
      case "boolean":
        state.v = value === true;
        api = folder
          .addBinding(state, "v", { label })
          .on("change", (ev) => change(ev.value, false));
        break;
      case "number": {
        state.v = typeof value === "number" ? value : 0;
        const params: BindingParams = { label, ...(RANGES[field.name] ?? {}) };
        api = folder
          .addBinding(state, "v", params)
          .on("change", (ev) => change(ev.value, !ev.last));
        if (value === undefined) {
          (api as { label?: string }).label = `${field.name} ${AUTO}`;
        }
        break;
      }
      case "color":
        state.v = toHex(value) ?? "#ffffff";
        api = folder
          .addBinding(state, "v", {
            label: value === undefined ? `${field.name} ${AUTO}` : label,
          })
          .on("change", (ev) =>
            change(new Color().setStyle(ev.value as string), !ev.last),
          );
        break;
      case "enum": {
        const options = Object.fromEntries(
          (field.options ?? []).map((o) => [o, o]),
        );
        state.v = typeof value === "string" ? value : "";
        api = folder
          .addBinding(state, "v", {
            label,
            options: value === undefined ? { [AUTO]: "", ...options } : options,
          })
          .on("change", (ev) => {
            if (ev.value) change(ev.value, false);
          });
        break;
      }
      case "enumList": {
        const current = new Set(
          Array.isArray(value) ? (value as string[]) : [],
        );
        const sub = folder.addFolder({ title: label, expanded: true });
        for (const option of field.options ?? []) {
          const s = { on: current.has(option) };
          sub.addBinding(s, "on", { label: option }).on("change", (ev) => {
            if (ev.value) current.add(option);
            else current.delete(option);
            change(
              (field.options ?? []).filter((o) => current.has(o)),
              false,
            );
          });
        }
        api = sub;
        break;
      }
      case "point": {
        const p = (value ?? { x: 0, y: 0 }) as { x: number; y: number };
        state.v = { x: p.x, y: p.y };
        api = folder.addBinding(state, "v", { label }).on("change", (ev) => {
          const v = ev.value as { x: number; y: number };
          change({ x: v.x, y: v.y }, !ev.last);
        });
        break;
      }
      case "string":
        state.v = typeof value === "string" ? value : "";
        api = folder.addBinding(state, "v", { label }).on("change", (ev) => {
          if (ev.last) change(ev.value, false);
        });
        break;
      case "list": {
        state.v = value === undefined ? "" : JSON.stringify(listValue(value));
        const binding = folder.addBinding(state, "v", { label });
        binding.on("change", (ev) => {
          if (!ev.last) return;
          const text = String(ev.value).trim();
          try {
            const parsed: unknown = JSON.parse(text);
            if (!Array.isArray(parsed)) throw new Error("not a list");
            binding.label = label;
            change(parsed, false);
          } catch {
            binding.label = `${field.name} ✗`;
          }
        });
        api = binding;
        break;
      }
    }
    if (api) {
      hint(
        api,
        field.kind === "list"
          ? `${title}\nEnter a JSON list, e.g. [1, 2].`
          : title,
      );
    }
  }

  private patchFor(
    key: string,
    name: string,
    value: unknown,
    values: Record<string, unknown>,
  ): Patch {
    const path = `${key}.${name}`;
    if (!this.options.originals.has(path)) {
      this.options.originals.set(path, values[name]);
      this.syncUndo();
    }
    return { [key]: { [name]: value } };
  }

  /** Queues a live change; drags and color picks apply once per frame. */
  private apply(
    key: string,
    name: string,
    value: unknown,
    values: Record<string, unknown>,
  ): void {
    const patch = this.patchFor(key, name, value, values);
    this.pending ??= {};
    this.pending[key] = { ...this.pending[key], ...patch[key] };
    this.frame ??= requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    const patch = this.pending;
    this.pending = undefined;
    if (patch) this.applyNow(patch);
  }

  private applyNow(patch: Patch): void {
    this.applyingNow = true;
    try {
      this.layer.update({
        type: this.layer.description.type,
        ...patch,
      } as unknown as LayerDescription);
    } finally {
      this.applyingNow = false;
    }
  }

  private syncUndo(): void {
    const n = this.options.originals.size;
    this.undoButton.title =
      n > 0 ? `Undo my changes (${n})` : "Undo my changes";
    this.undoButton.disabled = n === 0;
  }

  private undo(): void {
    const patch: Patch = {};
    for (const [path, original] of this.options.originals) {
      const [key, name] = path.split(".");
      const field = MATERIAL_SCHEMA[key]?.find((f) => f.name === name);
      const value = original !== undefined ? original : field?.default;
      if (value === undefined) continue;
      patch[key] = { ...patch[key], [name]: value };
    }
    this.options.originals.clear();
    this.applyNow(patch);
    this.options.onStructureChange();
  }
}

/** Typed arrays as plain arrays, for display. */
function listValue(value: unknown): unknown {
  return ArrayBuffer.isView(value)
    ? Array.from(value as unknown as Iterable<number>)
    : value;
}

/**
 * Source text that re-creates the layer: `Color`s as `setHex`, typed arrays
 * as constructors, the source as its id string.
 */
export function describeLayerAsCode(layer: Layer): string {
  const write = (value: unknown, indent: string): string => {
    if (value instanceof Color) {
      return `new Color().setHex(0x${value.toHex().toString(16).padStart(6, "0")})`;
    }
    if (ArrayBuffer.isView(value)) {
      const array = Array.from(value as unknown as Iterable<number>);
      return `new ${value.constructor.name}([${array.join(", ")}])`;
    }
    if (Array.isArray(value)) {
      return `[${value.map((v) => write(v, indent)).join(", ")}]`;
    }
    if (isPlainObject(value)) {
      const inner = indent + "  ";
      const entries = Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(
          ([k, v]) =>
            `${inner}${/^\w+$/.test(k) ? k : JSON.stringify(k)}: ${write(v, inner)},`,
        );
      return `{\n${entries.join("\n")}\n${indent}}`;
    }
    return JSON.stringify(value);
  };
  return `view.addLayer(${write(layer.description, "")});`;
}
