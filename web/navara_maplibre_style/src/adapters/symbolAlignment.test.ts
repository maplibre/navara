import { describe, expect, it } from "vitest";

import { JsStyleEngine } from "../engine/JsStyleEngine";
import type { StyleLayer } from "../engine/types";

import { resolveSymbolOrientation } from "./symbolAlignment";

const engine = new JsStyleEngine();
const symbol = (layout: StyleLayer["layout"]): StyleLayer =>
  ({ id: "test", type: "symbol", source: "test", layout }) as StyleLayer;

describe("resolveSymbolOrientation", () => {
  it("takes the spec defaults when nothing is set", () => {
    expect(resolveSymbolOrientation(symbol({}), engine)).toEqual({
      placement: "point",
      spacing: 250,
      text: {
        textFacing: "upright",
        rotateWithCamera: true,
        spreadGlyphs: false,
        keepUpright: true,
        maxAngle: 45,
      },
      icon: {
        billboardFacing: "upright",
        rotateWithCamera: true,
        rotateToLine: false,
      },
    });
  });

  // Every placement × text-rotation-alignment × text-pitch-alignment, auto
  // included, resolved as gl-js SymbolStyleLayer.recalculate does.
  const placements = ["point", "line", "line-center"] as const;
  const rotations = ["auto", "map", "viewport", "viewport-glyph"] as const;
  const pitches = ["auto", "map", "viewport"] as const;
  const cases = placements.flatMap((placement) =>
    rotations.flatMap((rotation) =>
      pitches.map((pitch) => [placement, rotation, pitch] as const),
    ),
  );

  it.each(cases)(
    "text: placement %s, rotation %s, pitch %s",
    (placement, rotation, pitch) => {
      const along = placement !== "point";
      const resolvedRotation =
        rotation === "auto" ? (along ? "map" : "viewport") : rotation;
      const resolvedPitch =
        pitch === "auto"
          ? resolvedRotation === "map"
            ? "map"
            : "viewport"
          : pitch;

      const { text } = resolveSymbolOrientation(
        symbol({
          "symbol-placement": placement,
          "text-rotation-alignment": rotation,
          "text-pitch-alignment": pitch,
        }),
        engine,
      );
      expect(text.textFacing).toBe(
        resolvedPitch === "map" ? "flat" : "upright",
      );
      expect(text.rotateWithCamera).toBe(resolvedRotation !== "map");
      // gl-js textAlongLine: bent glyph by glyph unless `viewport`.
      expect(text.spreadGlyphs).toBe(along && resolvedRotation !== "viewport");
    },
  );

  it("resolves icon auto alignments, pitch following rotation", () => {
    const line = resolveSymbolOrientation(
      symbol({ "symbol-placement": "line" }),
      engine,
    ).icon;
    expect(line).toEqual({
      billboardFacing: "flat",
      rotateWithCamera: false,
      rotateToLine: true,
    });

    const mapOnScreen = resolveSymbolOrientation(
      symbol({
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "viewport",
      }),
      engine,
    ).icon;
    expect(mapOnScreen).toEqual({
      billboardFacing: "upright",
      rotateWithCamera: false,
      rotateToLine: true,
    });
  });

  it("evaluates zoom expressions at the construction zoom", () => {
    const resolved = resolveSymbolOrientation(
      symbol({
        "symbol-placement": ["step", ["zoom"], "point", 8, "line"],
        "symbol-spacing": [
          "interpolate",
          ["linear"],
          ["zoom"],
          0,
          100,
          20,
          500,
        ],
        "text-max-angle": 30,
        "text-keep-upright": false,
      }),
      engine,
    );
    expect(resolved.placement).toBe("line");
    expect(resolved.spacing).toBe(300);
    expect(resolved.text.maxAngle).toBe(30);
    expect(resolved.text.keepUpright).toBe(false);
  });
});
