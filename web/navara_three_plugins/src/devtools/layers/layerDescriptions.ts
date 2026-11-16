import type ThreeView from "@navaramap/three";
import type { Layer, LayerDescription } from "@navaramap/three";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Merges a partial layer update onto the current description the way the
 * engine does (`merge_appearance!` / `merge_material!` in
 * `navara_wasm/src/source_types.rs`): plain objects merge recursively, so a
 * material the update omits and a field it leaves out keep their values;
 * arrays, typed arrays, `Color` instances and primitives replace; a key set
 * to `undefined` keeps the current value, since `undefined` never reaches
 * the engine. Returns a new object; neither input is modified.
 */
export function mergeLayerDescription<T extends object>(
  current: T,
  update: object,
): T {
  const result: Record<string, unknown> = {
    ...(current as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    const previous = result[key];
    result[key] =
      isPlainObject(value) && isPlainObject(previous)
        ? mergeLayerDescription(previous, value)
        : value;
  }
  return result as T;
}

/**
 * A description as `Layer.update()` sends it: a `Source` handle as its id,
 * and an explicit `colorMap` / `colorStops: undefined` on an elevation
 * heatmap as a cleared (empty) array, the one place `undefined` is a value.
 */
function normalize(l: LayerDescription): LayerDescription {
  let out = l as unknown as Record<string, unknown>;
  const source = out.source as { id?: unknown } | undefined;
  if (typeof source === "object" && source !== null) {
    out = { ...out, source: source.id };
  }
  const heatmap = out.elevationHeatmap;
  if (out.type === "raster" && isPlainObject(heatmap)) {
    const cleared = ["colorMap", "colorStops"].filter(
      (key) => key in heatmap && heatmap[key] === undefined,
    );
    if (cleared.length) {
      const next = { ...heatmap };
      for (const key of cleared) next[key] = new Float32Array(0);
      out = { ...out, elevationHeatmap: next };
    }
  }
  return out as unknown as LayerDescription;
}

const descriptions = new WeakMap<Layer, LayerDescription>();
const EMPTY = {} as LayerDescription;

/**
 * The configuration of `layer` as the app set it: the description passed to
 * `addLayer` with every `update()` merged on top. A `Source` reference is
 * stored as its id. Fields never set are absent and take the engine's
 * defaults; the engine's own resolved values are not read back. Empty for a
 * layer added while no {@link trackLayerDescriptions} was running.
 */
export function descriptionOf(layer: Layer): Readonly<LayerDescription> {
  return descriptions.get(layer) ?? EMPTY;
}

/**
 * Records the description of every layer `view` adds from now on, and keeps
 * it current through each layer's `updated` event. Call it before any layer
 * is added (a plugin's `init()` runs before the app can add one). Returns
 * the function that stops tracking.
 */
export function trackLayerDescriptions(view: ThreeView): () => void {
  const listeners = new Map<Layer, (l: LayerDescription) => void>();
  const onAdded = (layer: Layer, description: LayerDescription) => {
    descriptions.set(layer, normalize(description));
    const onUpdated = (l: LayerDescription) => {
      descriptions.set(
        layer,
        mergeLayerDescription(descriptionOf(layer), normalize(l)),
      );
    };
    listeners.set(layer, onUpdated);
    layer.on("updated", onUpdated);
  };
  const onRemoved = (layer: Layer) => {
    const onUpdated = listeners.get(layer);
    if (onUpdated) layer.off("updated", onUpdated);
    listeners.delete(layer);
  };
  view.on("layerAdded", onAdded);
  view.on("layerRemoved", onRemoved);
  return () => {
    view.off("layerAdded", onAdded);
    view.off("layerRemoved", onRemoved);
    for (const [layer, onUpdated] of listeners) layer.off("updated", onUpdated);
    listeners.clear();
  };
}
