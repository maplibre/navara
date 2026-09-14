import { MeshLambertMaterial } from "three";
import { describe, expect, it } from "vitest";

import { updateMaterialProps } from "./material";

describe("polygonBaseEnhancer/material", () => {
  describe("updateMaterialProps", () => {
    it("should not update properties when props are undefined", () => {
      const material = new MeshLambertMaterial();
      material.color.set(0xff0000);
      material.opacity = 0.5;

      // Empty props should not change anything
      updateMaterialProps(material, {}, false);
      expect(material.color.getHex()).toBe(0xff0000);
      expect(material.opacity).toBe(0.5);
    });

    it("forces alpha blending on texturized materials, overriding transparent", () => {
      // The drape bake's resolve divide assumes premultiplied content, which
      // only holds when the bake renders alpha-blended (see material.ts).
      const material = new MeshLambertMaterial();
      material.transparent = false;

      updateMaterialProps(material, { transparent: false }, true);
      expect(material.transparent).toBe(true);
    });
  });
});
