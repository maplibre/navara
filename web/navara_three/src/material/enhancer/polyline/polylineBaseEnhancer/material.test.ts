import { ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";

import { updateMaterialProps } from "./material";
import { DEFAULT_BASE_STATE } from "./state";
import type { PolylineBaseState } from "./types";

const stateWith = (patch: Partial<PolylineBaseState>): PolylineBaseState => ({
  ...DEFAULT_BASE_STATE,
  ...patch,
});

describe("polylineBaseEnhancer/material", () => {
  describe("updateMaterialProps", () => {
    it("should not update depthWrite when props are undefined", () => {
      const material = new ShaderMaterial();
      material.depthWrite = false;

      updateMaterialProps(material, {}, DEFAULT_BASE_STATE);

      expect(material.depthWrite).toBe(false);
    });

    it("should follow the state's transparent", () => {
      const material = new ShaderMaterial();
      material.transparent = false;

      updateMaterialProps(material, {}, stateWith({ transparent: true }));
      expect(material.transparent).toBe(true);
    });

    it("forces alpha blending on texturized materials, overriding transparent", () => {
      // The drape bake's resolve divide assumes premultiplied content, which
      // only holds when the bake renders alpha-blended (see material.ts).
      const material = new ShaderMaterial();
      material.transparent = false;

      updateMaterialProps(
        material,
        {},
        stateWith({ transparent: false, isTexturized: true }),
      );
      expect(material.transparent).toBe(true);
    });

    it("forces alpha blending on a blurred line, overriding transparent", () => {
      const material = new ShaderMaterial();

      updateMaterialProps(material, {}, stateWith({ blur: 2 }));
      expect(material.transparent).toBe(true);

      updateMaterialProps(material, {}, stateWith({ batchBlurEnabled: true }));
      expect(material.transparent).toBe(true);

      updateMaterialProps(material, {}, DEFAULT_BASE_STATE);
      expect(material.transparent).toBe(false);
    });

    it("should update depthWrite when provided", () => {
      const material = new ShaderMaterial();
      material.depthWrite = true;

      updateMaterialProps(material, { depthWrite: false }, DEFAULT_BASE_STATE);
      expect(material.depthWrite).toBe(false);
    });

    it("should update opacity when provided", () => {
      const material = new ShaderMaterial();
      material.opacity = 1.0;
      updateMaterialProps(material, { opacity: 0.5 }, DEFAULT_BASE_STATE);
      expect(material.opacity).toBe(0.5);
    });
  });
});
