import { describe, expect, it } from "vitest";

import { DEFAULT_BASE_STATE, updateState } from "./state";
import { sdfRadiusFor } from "./types";

describe("sdfTextBaseEnhancer / state", () => {
  describe("updateState", () => {
    it("initializes state from props with defaults", () => {
      const state = updateState({ offsetDepth: false }, DEFAULT_BASE_STATE);
      expect(state.offsetDepth).toBe(false);
      expect(state.center).toEqual([0.5, 0.0]);
      expect(state.sizeInMeters).toBe(true);
    });

    it("preserves immutable fields (useRTE) from currentState", () => {
      const currentState = { ...DEFAULT_BASE_STATE, useRTE: true };
      const state = updateState({ useRTE: false }, currentState);
      expect(state.useRTE).toBe(true);
    });

    it("updates center", () => {
      const state = updateState({ center: [0.0, 0.5] }, DEFAULT_BASE_STATE);
      expect(state.center).toEqual([0.0, 0.5]);
    });

    it("updates sizeInMeters", () => {
      const state = updateState({ sizeInMeters: true }, DEFAULT_BASE_STATE);
      expect(state.sizeInMeters).toBe(true);
    });

    it("updates offsetDepth", () => {
      const state = updateState({ offsetDepth: false }, DEFAULT_BASE_STATE);
      expect(state.offsetDepth).toBe(false);
    });

    it("defaults orientation to the screen-aligned billboard", () => {
      expect(DEFAULT_BASE_STATE.flatFacing).toBe(false);
      expect(DEFAULT_BASE_STATE.rotateWithCamera).toBe(true);
    });

    it("converts rotation from degrees to radians", () => {
      const state = updateState({ rotation: 90 }, DEFAULT_BASE_STATE);
      expect(state.rotation).toBeCloseTo(Math.PI / 2);
      expect(DEFAULT_BASE_STATE.rotation).toBe(0);
    });

    it("updates flatFacing and rotateWithCamera independently", () => {
      const flat = updateState({ flatFacing: true }, DEFAULT_BASE_STATE);
      expect(flat.flatFacing).toBe(true);
      expect(flat.rotateWithCamera).toBe(true);

      const pinned = updateState({ rotateWithCamera: false }, flat);
      expect(pinned.flatFacing).toBe(true);
      expect(pinned.rotateWithCamera).toBe(false);
    });

    it("converts outlineWidth using the current quality's range (SDF default)", () => {
      const state = updateState({ outlineWidth: 2.0 }, DEFAULT_BASE_STATE);
      expect(state.outlineWidth).toBeCloseTo(
        2.0 / sdfRadiusFor(DEFAULT_BASE_STATE.useMsdf),
      );
    });

    it("updates outlineColor from hex", () => {
      const state = updateState({ outlineColor: 0x00ff00 }, DEFAULT_BASE_STATE);
      expect(state.outlineColor.getHex()).toBe(0x00ff00);
    });

    it("updates outlineOpacity", () => {
      const state = updateState({ outlineOpacity: 0.5 }, DEFAULT_BASE_STATE);
      expect(state.outlineOpacity).toBe(0.5);
    });

    it("updates showBackground", () => {
      const state = updateState({ showBackground: true }, DEFAULT_BASE_STATE);
      expect(state.showBackground).toBe(true);
    });

    it("updates backgroundColor from hex", () => {
      const state = updateState(
        { backgroundColor: 0x0000ff },
        DEFAULT_BASE_STATE,
      );
      expect(state.backgroundColor.getHex()).toBe(0x0000ff);
    });

    it("updates backgroundOutlineColor from hex", () => {
      const state = updateState(
        { backgroundOutlineColor: 0xffff00 },
        DEFAULT_BASE_STATE,
      );
      expect(state.backgroundOutlineColor.getHex()).toBe(0xffff00);
    });

    it("updates backgroundOutlineWidth", () => {
      const state = updateState(
        { backgroundOutlineWidth: 0.5 },
        DEFAULT_BASE_STATE,
      );
      expect(state.backgroundOutlineWidth).toBe(0.5);
    });

    it("updates pickable", () => {
      const state = updateState({ pickable: true }, DEFAULT_BASE_STATE);
      expect(state.pickable).toBe(true);
    });

    // Colour, opacity, font size and height moved into the per-label data
    // texture when text became a single batched draw call, so they must not
    // reappear as batch-wide state.
    it("carries no per-label style", () => {
      const state = updateState({}, DEFAULT_BASE_STATE);
      expect(state).not.toHaveProperty("color");
      expect(state).not.toHaveProperty("opacity");
      expect(state).not.toHaveProperty("fontSize");
      expect(state).not.toHaveProperty("addHeight");
    });

    it("updates depthTest", () => {
      const state = updateState({ depthTest: false }, DEFAULT_BASE_STATE);
      expect(state.depthTest).toBe(false);
    });

    it("falls back to currentState for missing props", () => {
      const currentState = {
        ...DEFAULT_BASE_STATE,
        outlineOpacity: 0.25,
        center: [1, 2] as [number, number],
      };
      const state = updateState({}, currentState);
      expect(state.outlineOpacity).toBe(0.25);
      expect(state.center).toEqual([1, 2]);
    });
  });
});
