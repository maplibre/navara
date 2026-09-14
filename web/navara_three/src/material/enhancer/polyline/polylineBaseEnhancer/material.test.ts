import { ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";

import { updateMaterialProps } from "./material";

describe("polylineBaseEnhancer/material", () => {
  describe("updateMaterialProps", () => {
    it("should not update properties when props are undefined", () => {
      const material = new ShaderMaterial();
      material.transparent = true;
      material.depthWrite = false;

      updateMaterialProps(material, {}, false);

      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
    });

    it("should update transparent when provided", () => {
      const material = new ShaderMaterial();
      material.transparent = false;

      updateMaterialProps(material, { transparent: true }, false);
      expect(material.transparent).toBe(true);
    });

    it("forces alpha blending on texturized materials, overriding transparent", () => {
      // The drape bake's resolve divide assumes premultiplied content, which
      // only holds when the bake renders alpha-blended (see material.ts).
      const material = new ShaderMaterial();
      material.transparent = false;

      updateMaterialProps(material, { transparent: false }, true);
      expect(material.transparent).toBe(true);
    });

    it("should update depthWrite when provided", () => {
      const material = new ShaderMaterial();
      material.depthWrite = true;

      updateMaterialProps(material, { depthWrite: false }, false);
      expect(material.depthWrite).toBe(false);
    });

    it("should update opacity when provided", () => {
      const material = new ShaderMaterial();
      material.opacity = 1.0;
      updateMaterialProps(material, { opacity: 0.5 }, false);
      expect(material.opacity).toBe(0.5);
    });
  });
});
