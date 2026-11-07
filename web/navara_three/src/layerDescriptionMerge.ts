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
