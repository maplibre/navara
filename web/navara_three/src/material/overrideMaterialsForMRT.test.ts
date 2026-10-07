import { ShaderLib } from "three";
import { describe, expect, it } from "vitest";

import { overrideMaterialsForMRT } from "./overrideMaterialsForMRT";

describe("overrideMaterialsForMRT", () => {
  it("includes <packing> exactly once in every lit ShaderLib fragment", () => {
    overrideMaterialsForMRT();
    overrideMaterialsForMRT();

    const counts = Object.fromEntries(
      (["lambert", "phong", "basic", "standard", "physical"] as const).map(
        (name) => [
          name,
          ShaderLib[name].fragmentShader.split("#include <packing>").length - 1,
        ],
      ),
    );
    expect(counts).toEqual({
      lambert: 1,
      phong: 1,
      basic: 1,
      standard: 1,
      physical: 1,
    });
  });
});
