import { describe, expect, it } from "vitest";

import { DEFAULT_BASE_STATE, updateState } from "./state";
import type { PolylineBaseProps } from "./types";

describe("polylineBaseEnhancer/state", () => {
  describe("updateState", () => {
    it("should initialize state from props with defaults", () => {
      const props: PolylineBaseProps = {
        color: 0xff0000,
        width: 2,
      };

      const state = updateState(props, DEFAULT_BASE_STATE);

      expect(state.width).toBe(2);
      expect(state.useRTE).toBe(false);
      expect(state.pickable).toBe(false);
    });

    it("should update minMaxHeight from props", () => {
      const props: PolylineBaseProps = {
        minMaxHeight: [100, 200],
      };

      const state = updateState(props, DEFAULT_BASE_STATE);

      expect(state.minMaxHeight).toEqual([100, 200]);
    });

    it("should update width from props", () => {
      const props: PolylineBaseProps = {
        width: 5,
      };

      const state = updateState(props, DEFAULT_BASE_STATE);

      expect(state.width).toBe(5);
    });

    it("should never transition batchColorEnabled back to false", () => {
      const enabled = updateState(
        { batchColorEnabled: true },
        DEFAULT_BASE_STATE,
      );
      expect(enabled.batchColorEnabled).toBe(true);

      const stillEnabled = updateState({ batchColorEnabled: false }, enabled);
      expect(stillEnabled.batchColorEnabled).toBe(true);
    });
  });
});
