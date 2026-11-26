/**
 * The feature id MapLibre's `["id"]` / `$id` see for a GeoJSON source feature.
 *
 * maplibre-gl serializes GeoJSON into vector tiles, which only allow integer
 * ids, so it keeps a top-level `id` only when `!isNaN(id)` and then stores
 * `parseInt(id, 10)` (`geojson_wrapper.ts`): `"12"` becomes `12`, `1.5`
 * becomes `1`, and `"abc"` is dropped. The engine keeps the raw id (picks
 * report it unchanged); only the style evaluation applies this rule.
 *
 * An id that parses to `NaN` (e.g. `""`) is treated as absent.
 */
export function toMapLibreGeoJsonId(
  id: string | number | undefined,
): number | undefined {
  if (id === undefined || isNaN(id as number)) return undefined;
  const parsed = parseInt(String(id), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
