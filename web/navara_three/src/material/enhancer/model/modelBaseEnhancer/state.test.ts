import { describe, expect, it } from "vitest";

import { DEFAULT_BASE_STATE, updateState } from "./state";
import type { ModelBaseProps, ModelBaseState } from "./types";

/**
 * Helper to create expected base state by merging with defaults.
 */
const createExpectedState = (
  overrides: Partial<ModelBaseState> = {},
): ModelBaseState => ({
  ...DEFAULT_BASE_STATE,
  ...overrides,
});

describe("modelBaseEnhancer/state", () => {
  describe("updateState", () => {
    type TestCase = {
      name: string;
      props: ModelBaseProps;
      currentState: ModelBaseState;
      expected: ModelBaseState;
    };

    const testCases: TestCase[] = [
      {
        name: "returns default state when given empty props",
        props: {},
        currentState: DEFAULT_BASE_STATE,
        expected: createExpectedState(),
      },
      {
        name: "applies all props",
        props: {
          pickable: true,
          batchColorEnabled: true,
        },
        currentState: DEFAULT_BASE_STATE,
        expected: createExpectedState({
          pickable: true,
          batchColorEnabled: true,
        }),
      },
      {
        name: "applies pickable only",
        props: {
          pickable: true,
        },
        currentState: DEFAULT_BASE_STATE,
        expected: createExpectedState({
          pickable: true,
        }),
      },
      {
        name: "applies emissive and effectIdsMask",
        props: {
          emissiveColor: 0xff0000,
          emissiveIntensity: 1.5,
          effectIdsMask: 3,
        },
        currentState: DEFAULT_BASE_STATE,
        expected: createExpectedState({
          emissiveColor: 0xff0000,
          emissiveIntensity: 1.5,
          effectIdsMask: 3,
        }),
      },
    ];

    it.each(testCases)("$name", ({ props, currentState, expected }) => {
      const result = updateState(props, currentState);
      expect(result).toEqual(expected);
    });

    it("falls back to currentState for missing props", () => {
      const currentState: ModelBaseState = {
        ...DEFAULT_BASE_STATE,
        pickable: true,
      };
      const result = updateState({ batchColorEnabled: true }, currentState);
      expect(result.pickable).toBe(true);
      expect(result.batchColorEnabled).toBe(true);
    });
  });
});
