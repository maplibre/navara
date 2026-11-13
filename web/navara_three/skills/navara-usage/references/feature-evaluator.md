# FeatureEvaluator — per-feature (data-driven) styling

Use it when a layer's material config isn't enough: styling each feature from its properties.

Obtained from layer `featureCreated`/`featureUpdated` events. `evaluate()` runs per batch and returns only the properties you want to override (all optional: `color`, `show`, `height`, `extrudedHeight`, `text`, `width`, `size`, `opacity`, `image`, `declutterPriority`, …):

```typescript
import { Color } from "@navaramap/three";

layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(
    ({ properties }) => ({
      extrudedHeight: (properties?.["height"] as number) ?? 0,
      color: new Color().setStyle(
        (properties?.["color"] as string) ?? "#ffffff",
      ),
      show: ((properties?.["height"] as number) ?? 0) >= 30,
    }),
    { filters: ["height", "color"] }, // read only these attributes — important for perf on large data
  );
});
```

- Prefer `filters` (or `readFilteredFeatureProperties`) over reading all properties on large datasets.
- **Return a consistent shape:** once the callback styles an attribute for any feature, style it for every feature. Features you skip fall back to a fixed default, not the material value: `opacity` 1, `color` white, `emissive` off, `height`/`extrudedHeight` 0 (only `size` and `width` fall back to the material). E.g. styling `opacity` (or `show`) for some features renders the unstyled ones fully opaque regardless of the material's `opacity`. The same applies across attributes of one feature: returning only `height` for a non-clamped polygon leaves `extrudedHeight` at 0, so it renders as a column down to the ellipsoid. Return both (`extrudedHeight: height` for a flat face). For a thin slab, extrude upward (`height: h - 1, extrudedHeight: h`): the cap at `extrudedHeight` carries the upward normal, so a slab extruded below `height` shows its downward-facing cap on top, lit dark along every cell edge. A slab's sides are lit as walls; when the extrusion stands for a surface (e.g. per-cell water levels whose sides fill the steps between cells), set the polygon material's `shadeSidesAsSurface: true` so they shade like the top, and with `transparent` add `depthPrePass: true` so overlapping faces don't stack their opacity.
- `readFeatureProperties(cb)` reads attributes without styling (e.g. build a legend).

- Material-specific per-feature values (`facing`, `rotation`, `anchor`, `offset`, outline, `dashArray`, `image`, `declutterPriority`, …) are described with their materials: [vector-styling.md](vector-styling.md), [labels-and-sprites.md](labels-and-sprites.md).
- **`show` hides single features; the material's `show` hides the whole layer's geometry of that kind.** Every material has `show`, so a runtime toggle needs no evaluator: `layer.update({ polygon: { show: false } })` (partial merge).
- **Skipping repeat evaluations is a static-styling optimization only.** `featureUpdated` fires once per feature set (`evaluator.id`, a `bigint`), and again for every evaluator of the layer after `layer.forceUpdate()` or `layer.update()`. Some examples keep a `Set<bigint>` of seen ids and return early; that guard swallows exactly those re-emits, so leave it out of any layer you restyle (or clear the set before `forceUpdate()`).

## Restyling interactively (highlight the picked feature)

Change your own state, then call `layer.forceUpdate()`: the next frame re-emits `featureUpdated` and the callback re-runs. A picked feature (`featureClick` / `featureHover` payload) and the `evaluate()` callback argument have the same shape — `{ batchId, properties, layerId }` — so match them by a stable property of your data (read it in both places; with `filters`, include it):

```typescript
let selectedId: string | undefined;
view.on("featureClick", (info) => {
  const id = info?.properties?.["id"] as string | undefined;
  if (id === selectedId) return; // re-evaluate only on change
  selectedId = id;
  layer.forceUpdate();
});
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(
    ({ properties }) => ({
      // Style every feature, selected or not (consistent shape, see above).
      color: new Color().setHex(
        selectedId === properties?.["id"] ? 0xff0000 : 0xffffff,
      ),
    }),
    { filters: ["id"] },
  );
});
```

Runnable reference: `example/pages/examples/api/picking/main.ts` (Navara repo). Picking events and their cost: [picking-and-events.md](picking-and-events.md).

- Full API: https://navara.world/docs/three/api/feature-evaluator/ — runnable references in the Navara repo: `example/pages/styling/*` (one per geometry × source type).
