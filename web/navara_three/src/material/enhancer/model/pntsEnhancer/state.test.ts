import { describe, expect, it } from "vitest";

import { DEFAULT_PNTS_STATE, updateState } from "./state";
import type { PntsProps, PntsState } from "./types";

/**
 * Helper to create expected state by merging with defaults.
 */
const createExpectedState = (
  overrides: Partial<PntsState> = {},
): PntsState => ({
  ...DEFAULT_PNTS_STATE,
  ...overrides,
});

describe("pntsEnhancer/state", () => {
  describe("updateState", () => {
    type TestCase = {
      name: string;
      props: PntsProps;
      currentState: PntsState;
      expected: PntsState;
    };

    const testCases: TestCase[] = [
      {
        name: "returns default state when given empty props",
        props: {},
        currentState: DEFAULT_PNTS_STATE,
        expected: createExpectedState(),
      },
      {
        name: "applies height only",
        props: { height: 100 },
        currentState: DEFAULT_PNTS_STATE,
        expected: createExpectedState({ height: 100 }),
      },
      {
        name: "applies geodeticNormal only",
        props: { geodeticNormal: { x: 0.5, y: 0.5, z: 0.707 } },
        currentState: DEFAULT_PNTS_STATE,
        expected: createExpectedState({
          geodeticNormal: { x: 0.5, y: 0.5, z: 0.707 },
        }),
      },
      {
        name: "applies all state props",
        props: {
          height: 200,
          geodeticNormal: { x: 1, y: 0, z: 0 },
        },
        currentState: DEFAULT_PNTS_STATE,
        expected: createExpectedState({
          height: 200,
          geodeticNormal: { x: 1, y: 0, z: 0 },
        }),
      },
    ];

    it.each(testCases)("$name", ({ props, currentState, expected }) => {
      const result = updateState(props, currentState);
      expect(result).toEqual(expected);
    });

    it("falls back to currentState for missing props", () => {
      const currentState: PntsState = {
        height: 150,
        geodeticNormal: { x: 0.1, y: 0.2, z: 0.3 },
        srgbVertexColor: false,
      };
      const result = updateState({}, currentState);
      expect(result.height).toBe(150);
      expect(result.geodeticNormal).toEqual({ x: 0.1, y: 0.2, z: 0.3 });
    });

    it("overrides only specified props", () => {
      const currentState: PntsState = {
        height: 150,
        geodeticNormal: { x: 0.1, y: 0.2, z: 0.3 },
        srgbVertexColor: false,
      };
      const result = updateState({ height: 300 }, currentState);
      expect(result.height).toBe(300);
      expect(result.geodeticNormal).toEqual({ x: 0.1, y: 0.2, z: 0.3 });
    });
  });
});
