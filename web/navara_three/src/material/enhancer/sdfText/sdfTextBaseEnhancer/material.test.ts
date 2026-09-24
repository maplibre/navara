import { DoubleSide, FrontSide, ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";

import { updateMaterialProps } from "./material";

describe("sdfTextBaseEnhancer/material", () => {
  describe("updateMaterialProps", () => {
    it("should not update properties when props are undefined", () => {
      const material = new ShaderMaterial();
      material.depthTest = false;
      material.transparent = true;

      updateMaterialProps(material, {});

      expect(material.depthTest).toBe(false);
      expect(material.transparent).toBe(true);
    });

    it("should update depthTest when provided", () => {
      const material = new ShaderMaterial();
      material.depthTest = true;

      updateMaterialProps(material, { depthTest: false });
      expect(material.depthTest).toBe(false);
    });

    it("should update transparent when provided", () => {
      const material = new ShaderMaterial();
      material.transparent = false;

      updateMaterialProps(material, { transparent: true });
      expect(material.transparent).toBe(true);
    });

    it("maps backfaceCulling to the material side", () => {
      const material = new ShaderMaterial();

      updateMaterialProps(material, { backfaceCulling: true });
      expect(material.side).toBe(FrontSide);

      updateMaterialProps(material, { backfaceCulling: false });
      expect(material.side).toBe(DoubleSide);

      // Absent leaves it alone.
      updateMaterialProps(material, {});
      expect(material.side).toBe(DoubleSide);
    });
  });
});
