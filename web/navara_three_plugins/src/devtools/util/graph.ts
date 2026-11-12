import type { DevtoolContainer } from "../DevtoolPlugin";

/**
 * A graph monitor whose label carries the live value, as `label value unit`:
 * tweakpane's graph shows a value only on hover. Returns the refresher to
 * call at the UI cadence.
 */
export function addGraph<O extends Record<K, number>, K extends string>(
  container: DevtoolContainer,
  object: O,
  key: K,
  options: {
    min: number;
    max: number;
    digits?: number;
    label?: string;
    unit?: string;
  },
): () => void {
  const api = container.addBinding(object, key, {
    readonly: true,
    view: "graph",
    min: options.min,
    max: options.max,
  });
  const digits = options.digits ?? 1;
  const label = options.label ?? key;
  const unit = options.unit ? ` ${options.unit}` : "";
  const refresh = () => {
    api.label = `${label} ${object[key].toFixed(digits)}${unit}`;
  };
  refresh();
  return refresh;
}
