import { Color, PointsMaterial } from "three";
import { describe, expect, it } from "vitest";

import { updateMaterialProps } from "./material";
import { DEFAULT_PNTS_STATE } from "./state";

describe("pntsEnhancer/material", () => {
  describe("updateMaterialProps", () => {
    it("should not update properties when props are undefined", () => {
      const material = new PointsMaterial();
      material.color.set(0xff0000);
      material.size = 5;

      updateMaterialProps(material, {}, DEFAULT_PNTS_STATE);
      expect(material.color.getHex()).toBe(0xff0000);
      expect(material.size).toBe(5);
    });

    it("should update color when provided", () => {
      const material = new PointsMaterial();
      updateMaterialProps(material, { color: 0x00ff00 }, DEFAULT_PNTS_STATE);
      expect(material.color.getHex()).toBe(0x00ff00);
    });

    it("should update pointSize when provided", () => {
      const material = new PointsMaterial();
      updateMaterialProps(material, { pointSize: 3 }, DEFAULT_PNTS_STATE);
      expect(material.size).toBe(3);
    });

    it("should update both color and pointSize when provided", () => {
      const material = new PointsMaterial();
      updateMaterialProps(
        material,
        { color: 0x0000ff, pointSize: 7 },
        DEFAULT_PNTS_STATE,
      );
      expect(material.color.getHex()).toBe(0x0000ff);
      expect(material.size).toBe(7);
    });

    it("should tint color and opacity with the base color", () => {
      const material = new PointsMaterial();
      updateMaterialProps(
        material,
        { color: 0xffffff, opacity: 0.5 },
        {
          ...DEFAULT_PNTS_STATE,
          baseColor: new Color(0xffff00),
          baseOpacity: 0.2,
        },
      );
      expect(material.color.getHex()).toBe(0xffff00);
      expect(material.opacity).toBeCloseTo(0.1);
    });

    it("should stay opaque for a translucent base color unless the layer is transparent", () => {
      const state = { ...DEFAULT_PNTS_STATE, baseOpacity: 0.5 };
      const material = new PointsMaterial();
      updateMaterialProps(
        material,
        { transparent: false, depthWrite: true },
        state,
      );
      expect(material.transparent).toBe(false);
      expect(material.depthWrite).toBe(true);

      const version = material.version;
      updateMaterialProps(
        material,
        { transparent: true, depthWrite: true },
        state,
      );
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(true);
      expect(material.version).toBeGreaterThan(version);
    });
  });
});
