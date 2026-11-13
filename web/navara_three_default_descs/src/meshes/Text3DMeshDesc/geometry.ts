import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { Font, type FontData } from "three/examples/jsm/loaders/FontLoader.js";
import invariant from "tiny-invariant";

import type { TextFont } from "./font";

export type TextGeometryOptions = {
  /** Text to display. `\n` starts a new line. */
  text: string;
  /**
   * Text size in meters. Capital letters come out roughly this tall.
   * Defaults to 100.
   */
  size?: number;
  /**
   * Distance between the baselines of two lines, as a multiple of `size`.
   * Defaults to the font's own line spacing.
   */
  lineHeight?: number;
  /** Extrusion depth in meters. Defaults to 50. */
  depth?: number;
  /** Number of points on each curve of the outline. Defaults to 12. */
  curveSegments?: number;
  /** Whether the edges are beveled. Defaults to false. */
  bevelEnabled?: boolean;
  /** How deep the bevel goes into the text, in meters. Defaults to 10. */
  bevelThickness?: number;
  /** How far the bevel extends from the outline, in meters. Defaults to 8. */
  bevelSize?: number;
};

/** Options the geometry is built from; changing one rebuilds it. */
export const TEXT_GEOMETRY_KEYS: readonly (keyof TextGeometryOptions)[] = [
  "text",
  "size",
  "lineHeight",
  "depth",
  "curveSegments",
  "bevelEnabled",
  "bevelThickness",
  "bevelSize",
];

/** Overrides the line spacing: three.js spaces lines by the bounding box height plus the underline thickness. */
function withLineHeight(data: FontData, lineHeight: number): FontData {
  return {
    ...data,
    underlineThickness: 0,
    boundingBox: {
      ...data.boundingBox,
      yMin: 0,
      yMax: lineHeight * data.resolution,
    },
  };
}

/** `size` that three.js `Font.generateShapes` falls back to. */
const DEFAULT_SIZE = 100;

/**
 * Builds the three.js `TextGeometry` and anchors it at its bottom center:
 * centered on X and Z, with the font's descender line under the last line on
 * Y = 0, so the anchor does not move with the letters. The text reads along +X
 * and faces +Z. Unset options take the `TextGeometry` defaults.
 */
export function createTextGeometry(
  font: TextFont,
  options: TextGeometryOptions,
): TextGeometry {
  const fontData =
    options.lineHeight === undefined
      ? font.dataFor(options.text)
      : withLineHeight(font.dataFor(options.text), options.lineHeight);
  const geometry = new TextGeometry(options.text, {
    font: new Font(fontData),
    size: options.size,
    depth: options.depth,
    curveSegments: options.curveSegments,
    bevelEnabled: options.bevelEnabled,
    bevelThickness: options.bevelThickness,
    bevelSize: options.bevelSize,
  });

  // Same line spacing as `Font.generateShapes`.
  const { boundingBox, underlineThickness, descender, resolution } = fontData;
  const lineSpacing = boundingBox.yMax - boundingBox.yMin + underlineThickness;
  const lastBaseline = -(options.text.split("\n").length - 1) * lineSpacing;
  const bottom =
    ((lastBaseline + descender) * (options.size ?? DEFAULT_SIZE)) / resolution;

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  invariant(box);
  // Text without any outline (empty, or only spaces) has no extent to center.
  const centered = !box.isEmpty();
  geometry.translate(
    centered ? -(box.min.x + box.max.x) / 2 : 0,
    -bottom,
    centered ? -(box.min.z + box.max.z) / 2 : 0,
  );
  return geometry;
}
