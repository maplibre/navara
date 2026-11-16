import type ThreeView from "@navaramap/three";
import {
  Color,
  Plugin,
  type Layer,
  type LayerDescription,
  type ViewContext,
} from "@navaramap/three";

import {
  cloneDescription,
  descriptionOf,
  isPlainObject,
  trackLayerDescriptions,
} from "./layerDescriptions";
import {
  MATERIAL_SCHEMA,
  type MaterialField,
  type MaterialSchema,
} from "./materialSchema";

/** A material field with the value a layer gives it. */
export type FieldState = MaterialField & {
  /** Whether the layer sets the field. */
  set: boolean;
  /**
   * The layer's value, else the engine default, as JSON; absent when the
   * layer leaves it unset and the engine derives it.
   */
  value?: unknown;
};

/** One material of a layer. */
export type MaterialState = {
  /** The material key in the layer description, e.g. `"polygon"`. */
  key: string;
  /**
   * Whether the description carries the material. A vector layer draws only
   * the materials it carries; the other layer types always draw theirs.
   */
  present: boolean;
  fields: FieldState[];
};

/** A layer's style as plain JSON, ready for a UI to render. */
export type LayerStyle = {
  /** The layer `type`; `""` for a layer added before the plugin started. */
  type: string;
  /** Every material the layer type accepts, in schema order. */
  materials: MaterialState[];
};

/** A description value as JSON: a `Color` as its hex number, typed arrays as arrays. */
function toJson(value: unknown): unknown {
  if (value instanceof Color) return value.toHex();
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as Iterable<number>);
  }
  if (Array.isArray(value)) return value.map(toJson);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, toJson(v)]),
    );
  }
  return value;
}

/**
 * The engine's layer materials as JSON, for building a style UI: which
 * materials each layer type takes, every field with its kind, doc, default,
 * options and when a change applies ({@link MaterialSchemaPlugin.schema}),
 * and each layer's current values ({@link MaterialSchemaPlugin.describeLayer}).
 * Add it before `view.init()`: it records the description of every layer
 * added after it starts, which the engine does not report back.
 */
export class MaterialSchemaPlugin extends Plugin<ThreeView, ViewContext> {
  /** Every layer material, generated from the engine sources. */
  readonly schema: MaterialSchema = MATERIAL_SCHEMA;

  private view: ThreeView | undefined;
  private stopTracking: (() => void) | undefined;
  private disposed = false;
  private readonly onViewDisposed = (): void => this.dispose();

  async init(view: ThreeView): Promise<void> {
    if (this.disposed || this.view === view) return;
    // Added to another view: stop tracking the previous one.
    this.release();
    this.view = view;
    this.stopTracking = trackLayerDescriptions(view);
    view.on("disposed", this.onViewDisposed);
  }

  /**
   * The layer's configuration as the app set it: the description passed to
   * `addLayer` with every `update()` merged on top. Fields never set are
   * absent. Empty for a layer added before the plugin started. A copy:
   * changing it does not change the layer; call `layer.update()` for that.
   */
  description(layer: Layer): LayerDescription {
    return cloneDescription(descriptionOf(layer) as LayerDescription);
  }

  /**
   * The layer's materials with their fields and current values, as JSON.
   * A new object on every call, safe to change.
   */
  describeLayer(layer: Layer): LayerStyle {
    const desc = descriptionOf(layer) as unknown as Record<string, unknown>;
    const type = (desc.type as string | undefined) ?? "";
    const materials = (this.schema.layers[type] ?? []).map((key) => {
      const group = desc[key];
      const values = isPlainObject(group) ? group : {};
      const fields = this.schema.materials[key].map((field): FieldState => {
        // A copy, so a UI that edits `value` or `options` in place cannot
        // change the shared schema.
        const copy = toJson(field) as MaterialField;
        const set = values[field.name] !== undefined;
        const value = set ? toJson(values[field.name]) : copy.default;
        return value === undefined ? { ...copy, set } : { ...copy, set, value };
      });
      return { key, present: isPlainObject(group), fields };
    });
    return { type, materials };
  }

  /** Stops recording layer descriptions. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
  }

  private release(): void {
    this.view?.off("disposed", this.onViewDisposed);
    this.stopTracking?.();
    this.view = undefined;
    this.stopTracking = undefined;
  }
}
