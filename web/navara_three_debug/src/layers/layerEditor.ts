import { Color, type Layer, type LayerDescription } from "@navaramap/three";
import type { BindingParams, FolderApi } from "tweakpane";

import type { DebugContainer } from "../DebugPlugin";

type Patch = Record<string, unknown>;

/** Ranges for numeric fields whose meaning fixes one. */
const NUMBER_HINTS: Record<
  string,
  { min: number; max: number; step?: number }
> = {
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
  pointSize: { min: 0, max: 10, step: 0.1 },
};

const ENUM_HINTS: Record<string, string[]> = {
  anchor: [
    "center",
    "left",
    "right",
    "top",
    "bottom",
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
  ],
  textFacing: ["upright", "flat"],
  billboardFacing: ["upright", "flat"],
  pointFacing: ["upright", "flat"],
  placement: ["point", "line", "line-center"],
  cap: ["butt", "round", "square"],
  translateAnchor: ["map", "viewport"],
  textAlign: ["auto", "left", "center", "right"],
  heightReference: ["none", "terrain"],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isColorKey(key: string): boolean {
  return /color$/i.test(key) && key !== "colorMap" && key !== "colorStops";
}

function toHexString(value: unknown): string | undefined {
  if (value instanceof Color) {
    return `#${value.toHex().toString(16).padStart(6, "0")}`;
  }
  if (typeof value === "number") {
    return `#${value.toString(16).padStart(6, "0")}`;
  }
  return undefined;
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return (
    isPlainObject(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    Object.keys(value).length === 2
  );
}

/**
 * Controls generated from a layer's mirrored description: one folder per
 * material (any plain-object group), a binding per field by value type, and
 * a "set field" row to add a field the description does not carry yet (the
 * engine default applies until then). Every change is sent as a partial
 * `layer.update()`.
 */
export class LayerEditor {
  private readonly folders: FolderApi[] = [];

  constructor(
    private readonly container: DebugContainer,
    private readonly layer: Layer,
  ) {
    const description = layer.description as unknown as Record<string, unknown>;
    const scalars: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(description)) {
      if (key === "type") continue;
      if (isPlainObject(value) && !isPoint(value)) {
        this.addGroup(key, value);
      } else {
        scalars[key] = value;
      }
    }
    this.addGroup("layer", scalars, true);
  }

  dispose(): void {
    for (const folder of this.folders) folder.dispose();
    this.folders.length = 0;
  }

  private apply(patch: Patch): void {
    this.layer.update({
      type: this.layer.description.type,
      ...patch,
    } as unknown as LayerDescription);
  }

  private addGroup(
    key: string,
    group: Record<string, unknown>,
    topLevel = false,
  ): void {
    const folder = this.container.addFolder({
      title: key,
      expanded: !topLevel,
    });
    this.folders.push(folder);
    const patchFor = (field: string, value: unknown): Patch =>
      topLevel ? { [field]: value } : { [key]: { [field]: value } };
    const state: Record<string, unknown> = {};

    for (const [field, value] of Object.entries(group)) {
      if (topLevel && (field === "source" || field === "id")) {
        state[field] = String(value);
        folder.addBinding(state, field, { readonly: true });
        continue;
      }
      const hex = isColorKey(field) ? toHexString(value) : undefined;
      if (hex !== undefined) {
        state[field] = hex;
        folder.addBinding(state, field).on("change", (ev) => {
          if (!ev.last) return;
          this.apply(patchFor(field, new Color().setStyle(ev.value as string)));
        });
        continue;
      }
      if (typeof value === "boolean") {
        state[field] = value;
        folder.addBinding(state, field).on("change", (ev) => {
          this.apply(patchFor(field, ev.value));
        });
        continue;
      }
      if (typeof value === "number") {
        state[field] = value;
        const params: BindingParams = NUMBER_HINTS[field] ?? {};
        folder.addBinding(state, field, params).on("change", (ev) => {
          if (!ev.last) return;
          this.apply(patchFor(field, ev.value));
        });
        continue;
      }
      if (typeof value === "string") {
        state[field] = value;
        const options = ENUM_HINTS[field];
        const params: BindingParams = options
          ? { options: Object.fromEntries(options.map((o) => [o, o])) }
          : {};
        folder.addBinding(state, field, params).on("change", (ev) => {
          if (!ev.last) return;
          this.apply(patchFor(field, ev.value));
        });
        continue;
      }
      if (isPoint(value)) {
        state[field] = { ...value };
        folder.addBinding(state, field).on("change", (ev) => {
          if (!ev.last) return;
          const point = ev.value as { x: number; y: number };
          this.apply(patchFor(field, { x: point.x, y: point.y }));
        });
        continue;
      }
      // Arrays, typed arrays, nested objects: shown, edited through "set".
      state[field] = describeValue(value);
      folder.addBinding(state, field, { readonly: true });
    }

    const setter = { field: "", value: "" };
    folder.addBinding(setter, "field", { label: "set field" });
    folder.addBinding(setter, "value", { label: "JSON value" });
    folder.addButton({ title: "set" }).on("click", () => {
      const field = setter.field.trim();
      if (!field) return;
      let value: unknown = setter.value;
      try {
        value = JSON.parse(setter.value);
      } catch {
        // Not JSON: a bare string such as a font URL.
      }
      if (isColorKey(field) && typeof value === "string") {
        value = new Color().setStyle(value);
      }
      this.apply(patchFor(field, value));
    });
  }
}

function describeValue(value: unknown): string {
  if (ArrayBuffer.isView(value)) {
    return `${value.constructor.name}(${(value as unknown as { length: number }).length})`;
  }
  try {
    const text = JSON.stringify(value);
    return text.length > 60 ? text.slice(0, 57) + "…" : text;
  } catch {
    return String(value);
  }
}

/**
 * Source text that re-creates the layer: `Color`s as `setHex`, typed arrays
 * as constructors, the source as its id string.
 */
export function describeLayerAsCode(layer: Layer): string {
  const replacer = (value: unknown, indent: string): string => {
    if (value instanceof Color) {
      return `new Color().setHex(0x${value.toHex().toString(16).padStart(6, "0")})`;
    }
    if (ArrayBuffer.isView(value)) {
      const array = Array.from(value as unknown as Iterable<number>);
      return `new ${value.constructor.name}([${array.join(", ")}])`;
    }
    if (Array.isArray(value)) {
      return `[${value.map((v) => replacer(v, indent)).join(", ")}]`;
    }
    if (isPlainObject(value)) {
      const inner = indent + "  ";
      const entries = Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(
          ([k, v]) =>
            `${inner}${/^\w+$/.test(k) ? k : JSON.stringify(k)}: ${replacer(v, inner)},`,
        );
      return `{\n${entries.join("\n")}\n${indent}}`;
    }
    return JSON.stringify(value);
  };
  return `view.addLayer(${replacer(layer.description, "")});`;
}
