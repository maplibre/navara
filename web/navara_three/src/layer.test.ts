import type { Core } from "@navaramap/engine";
import { describe, expect, it, vi } from "vitest";

import type { FeatureEvaluator } from "./evaluations";
import { Layer, type FeatureSetContent } from "./layer";

vi.mock("@navaramap/worker", () => ({}));

const core = { deleteLayer: () => {} } as unknown as Core;
const evaluator = {} as FeatureEvaluator;
const content: FeatureSetContent = { type: "3d-tiles", credit: "C" };

describe("Layer feature sets", () => {
  it("drops registered feature sets on delete", () => {
    // Removal events arrive after `delete()`, when the layer can no longer be
    // looked up, so `delete()` itself must release them.
    const layer = new Layer("L", core);
    layer._registerFeatureEvaluator(1n, evaluator, { content });
    expect(layer.getFeatureSetContent(1n)).toBe(content);

    layer.delete();
    expect(layer.getFeatureSetContent(1n)).toBeUndefined();
    expect(layer._getFeatureEvaluator(1n)).toBeUndefined();
  });
});
