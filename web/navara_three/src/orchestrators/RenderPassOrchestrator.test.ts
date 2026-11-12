import { Pass } from "postprocessing";
import { Vector2, type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";

import { RenderPassOrchestrator } from "./RenderPassOrchestrator";

const fakeRenderer = () =>
  ({
    getSize: (v: Vector2) => v.set(4, 4),
    getDrawingBufferSize: (v: Vector2) => v.set(4, 4),
    getContext: () => ({ getContextAttributes: () => ({ alpha: false }) }),
    capabilities: { maxSamples: 4 },
  }) as unknown as WebGLRenderer;

describe("RenderPassOrchestrator.dispose", () => {
  it("disposes every pass still in the pipeline", () => {
    const orchestrator = new RenderPassOrchestrator(fakeRenderer(), {});
    const passes = [new Pass("a"), new Pass("b"), new Pass("c")];
    const spies = passes.map((p) => vi.spyOn(p, "dispose"));
    orchestrator.addPass("a", passes[0]);
    orchestrator.addPass("c", passes[2]);
    orchestrator.insertPassAfter("a", "b", passes[1]);

    orchestrator.dispose();

    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    expect(orchestrator.getPassNames()).toEqual([]);
  });

  it("does not dispose a pass removed before", () => {
    const orchestrator = new RenderPassOrchestrator(fakeRenderer(), {});
    const pass = new Pass("a");
    const spy = vi.spyOn(pass, "dispose");
    orchestrator.addPass("a", pass);
    orchestrator.removePass("a");

    orchestrator.dispose();

    expect(spy).not.toHaveBeenCalled();
  });
});
