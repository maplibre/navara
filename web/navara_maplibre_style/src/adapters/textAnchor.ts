/**
 * MapLibre's variable text anchors (`style_layer/variable_text_anchor.ts` in
 * maplibre-gl-js), in ems rather than its 24 px em.
 */

import type { Anchor, VariableAnchor } from "@navaramap/three";

/**
 * How far MapLibre assumes the glyphs start below the top of a line box, in
 * ems: its `baselineOffset` (7 px) over `ONE_EM` (24 px). A top or bottom
 * anchor's offset counts from the baseline side, so it is moved by this.
 */
const BASELINE_OFFSET_EM = 7 / 24;

/**
 * The offset that puts a label `radial` ems from its anchor point, outward
 * from the side `anchor` names: diagonally for a corner (MapLibre's
 * `text-radial-offset`).
 */
export function fromRadialOffset(
  anchor: Anchor,
  radial: number,
): [number, number] {
  const r = Math.max(0, radial);
  const d = r / Math.SQRT2;
  let x = 0;
  let y = 0;
  switch (anchor) {
    case "top-right":
    case "top-left":
      y = d - BASELINE_OFFSET_EM;
      break;
    case "bottom-right":
    case "bottom-left":
      y = -d + BASELINE_OFFSET_EM;
      break;
    case "bottom":
      y = -r + BASELINE_OFFSET_EM;
      break;
    case "top":
      y = r - BASELINE_OFFSET_EM;
      break;
  }
  switch (anchor) {
    case "top-right":
    case "bottom-right":
      x = -d;
      break;
    case "top-left":
    case "bottom-left":
      x = d;
      break;
    case "left":
      x = r;
      break;
    case "right":
      x = -r;
      break;
  }
  return [x, y];
}

/**
 * The offset `text-offset` gives a variable anchor: its sizes, ignoring
 * their signs, pointed away from the side `anchor` names.
 */
export function fromTextOffset(
  anchor: Anchor,
  offsetX: number,
  offsetY: number,
): [number, number] {
  const ox = Math.abs(offsetX);
  const oy = Math.abs(offsetY);
  let x = 0;
  let y = 0;
  if (anchor.startsWith("top")) y = oy - BASELINE_OFFSET_EM;
  else if (anchor.startsWith("bottom")) y = -oy + BASELINE_OFFSET_EM;
  if (anchor.endsWith("right")) x = -ox;
  else if (anchor.endsWith("left")) x = ox;
  return [x, y];
}

const ANCHORS: ReadonlySet<string> = new Set<Anchor>([
  "center",
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);

export function isAnchor(value: unknown): value is Anchor {
  return typeof value === "string" && ANCHORS.has(value);
}

function isOffset(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

const entry = (anchor: Anchor, [x, y]: [number, number]): VariableAnchor => ({
  anchor,
  offset: { x, y },
});

/**
 * A feature's variable anchors from its evaluated layout, as
 * `getTextVariableAnchorOffset` builds them: `text-variable-anchor-offset`
 * if set, otherwise `text-variable-anchor` with `text-radial-offset` (when
 * the style sets it) or `text-offset`. `undefined` when the layer has
 * neither.
 */
export function resolveVariableAnchors(
  layoutValues: Record<string, unknown>,
): VariableAnchor[] | undefined {
  const collection = layoutValues["text-variable-anchor-offset"];
  // The style-spec evaluator returns a `VariableAnchorOffsetCollection`, a
  // literal style value stays the plain `[anchor, offset, …]` array.
  const pairs = Array.isArray(collection)
    ? collection
    : (collection as { values?: unknown[] } | undefined)?.values;
  if (pairs) {
    const anchors: VariableAnchor[] = [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const [anchor, offset] = [pairs[i], pairs[i + 1]];
      if (!isAnchor(anchor) || !isOffset(offset)) continue;
      const y = anchor.startsWith("top")
        ? offset[1] - BASELINE_OFFSET_EM
        : anchor.startsWith("bottom")
          ? offset[1] + BASELINE_OFFSET_EM
          : offset[1];
      anchors.push(entry(anchor, [offset[0], y]));
    }
    return anchors;
  }

  const variable = layoutValues["text-variable-anchor"];
  if (!Array.isArray(variable)) return undefined;
  // The style spec leaves using both undefined; MapLibre takes the radial one.
  const radial = layoutValues["text-radial-offset"];
  const offset = layoutValues["text-offset"];
  return variable
    .filter(isAnchor)
    .map((anchor) =>
      entry(
        anchor,
        typeof radial === "number"
          ? fromRadialOffset(anchor, radial)
          : isOffset(offset)
            ? fromTextOffset(anchor, offset[0], offset[1])
            : [0, 0],
      ),
    );
}
