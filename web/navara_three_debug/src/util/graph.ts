import type { DebugContainer } from "../DebugPlugin";

/**
 * A graph monitor whose label carries the live value and the graph's top,
 * as `name value/max`: tweakpane's graph shows a value only on hover.
 * Returns the refresher to call at the UI cadence.
 */
export function addGraph<O extends Record<K, number>, K extends string>(
  container: DebugContainer,
  object: O,
  key: K,
  options: { min: number; max: number; digits?: number },
): () => void {
  const api = container.addBinding(object, key, {
    readonly: true,
    view: "graph",
    min: options.min,
    max: options.max,
  });
  const digits = options.digits ?? 1;
  const refresh = () => {
    api.label = `${key} ${object[key].toFixed(digits)}/${options.max}`;
  };
  refresh();
  return refresh;
}
