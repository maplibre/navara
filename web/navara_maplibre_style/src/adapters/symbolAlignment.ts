/**
 * Resolves a symbol layer's placement and alignment layout properties into
 * Navara's text and billboard orientation fields.
 */

import type { StyleEngine } from "../engine/StyleEngine";
import type { StyleLayer, ValueExpression } from "../engine/types";

/**
 * Zoom the layer-level layout properties are evaluated at. Navara bakes them
 * into the layer's material, so like the halo they are evaluated once.
 */
const CONSTRUCTION_ZOOM = 10;

type Placement = "point" | "line" | "line-center";
type Alignment = "map" | "viewport";
type Facing = "upright" | "flat";

export type SymbolOrientation = {
  placement: Placement;
  spacing: number;
  text: {
    textFacing: Facing;
    rotateWithCamera: boolean;
    spreadGlyphs: boolean;
    keepUpright: boolean;
    maxAngle: number;
  };
  icon: {
    billboardFacing: Facing;
    rotateWithCamera: boolean;
    rotateToLine: boolean;
  };
};

/**
 * Resolve MapLibre's `auto` alignments as gl-js does in
 * `SymbolStyleLayer.recalculate`: rotation `auto` is `map` along a line and
 * `viewport` at a point, and pitch `auto` follows the rotation (`map` only
 * when the rotation is `map`).
 *
 * Pitch maps to the facing (`map` lies flat, `viewport` stays on screen) and
 * rotation to `rotateWithCamera` (`map` turns with the map). Along a line,
 * `map` and `viewport-glyph` place each glyph on its own (gl-js
 * `textAlongLine`), while `viewport` draws the label straight.
 */
export function resolveSymbolOrientation(
  styleLayer: StyleLayer,
  engine: StyleEngine,
): SymbolOrientation {
  const value = (key: string): unknown => {
    const spec = engine.getLayoutSpec("symbol", key);
    const expr = styleLayer.layout?.[key as keyof typeof styleLayer.layout];
    if (!spec || expr === undefined || expr === null) return spec?.default;
    try {
      return engine.createValueFn(
        expr as ValueExpression,
        spec,
      )({
        properties: undefined,
        zoom: CONSTRUCTION_ZOOM,
      });
    } catch (err) {
      console.warn(
        `Failed to evaluate ${key} for layer "${styleLayer.id}":`,
        err,
      );
      return spec.default;
    }
  };

  const placement = value("symbol-placement") as Placement;
  const rotationOf = (key: string): string => {
    const v = value(key);
    if (v !== "auto") return v as string;
    return placement === "point" ? "viewport" : "map";
  };

  const textRotation = rotationOf("text-rotation-alignment");
  const textPitchValue = value("text-pitch-alignment");
  const textPitch: Alignment =
    textPitchValue === "auto"
      ? textRotation === "map"
        ? "map"
        : "viewport"
      : (textPitchValue as Alignment);

  const iconRotation = rotationOf("icon-rotation-alignment") as Alignment;
  const iconPitchValue = value("icon-pitch-alignment");
  const iconPitch: Alignment =
    iconPitchValue === "auto" ? iconRotation : (iconPitchValue as Alignment);

  return {
    placement,
    spacing: value("symbol-spacing") as number,
    text: {
      textFacing: textPitch === "map" ? "flat" : "upright",
      rotateWithCamera: textRotation !== "map",
      spreadGlyphs: placement !== "point" && textRotation !== "viewport",
      keepUpright: value("text-keep-upright") as boolean,
      maxAngle: value("text-max-angle") as number,
    },
    icon: {
      billboardFacing: iconPitch === "map" ? "flat" : "upright",
      rotateWithCamera: iconRotation !== "map",
      rotateToLine: iconRotation === "map",
    },
  };
}
