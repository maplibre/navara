import { Object3D } from "three";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { FeatureHandler } from "../event/context";

import { FeatureEvaluator, type GeometryType } from "./FeatureEvaluator";

// Mock worker module to avoid os.cpus() error in test environment
vi.mock("@navaramap/worker", () => ({}));

describe("FeatureEvaluator", () => {
  let mockHandler: FeatureHandler;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create mock FeatureHandler with minimal implementation
    mockHandler = {
      readAllBatchedProperties: vi.fn((_, callback) => {
        // Simulate a single batch with empty properties object
        callback(0, 0, {});
      }),
      readFilteredBatchedProperties: vi.fn((_, __, callback) => {
        // Simulate a single batch with empty properties object (not array)
        // Production code expects Record<string, unknown>, not an array
        callback(0, 0, {});
      }),
    } as unknown as FeatureHandler;

    // Spy on console.warn to check for warnings
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("determineGeometryType", () => {
    it("should pass through valid geometry type literals", () => {
      // Test representative types: billboard and text (critical for symbol layers)
      const mockMesh = new Object3D();
      Object.defineProperty(mockMesh, "geometryType", {
        get: () => "billboard",
        configurable: true,
      });

      const evaluator = new FeatureEvaluator(
        mockHandler,
        "test-layer",
        0n,
        mockMesh,
      );

      let capturedGeometryType: GeometryType | undefined;
      evaluator.readFeatureProperties(({ meshGeomType: gt }) => {
        capturedGeometryType = gt;
      });

      expect(capturedGeometryType).toBe("billboard");
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should return undefined and warn once for invalid values", () => {
      const mockMesh = new Object3D();
      Object.defineProperty(mockMesh, "geometryType", {
        get: () => "invalid-type",
        configurable: true,
      });

      const evaluator = new FeatureEvaluator(
        mockHandler,
        "test-layer",
        0n,
        mockMesh,
      );

      // First evaluation - should warn
      let capturedGeometryType: GeometryType | undefined;
      evaluator.readFeatureProperties(({ meshGeomType: gt }) => {
        capturedGeometryType = gt;
      });

      expect(capturedGeometryType).toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Invalid geometry type returned from geometryType getter: "invalid-type"',
        ),
      );

      // Second evaluation - should NOT warn again (same object)
      consoleWarnSpy.mockClear();
      evaluator.readFeatureProperties(({ meshGeomType: gt }) => {
        capturedGeometryType = gt;
      });

      expect(capturedGeometryType).toBeUndefined();
      expect(consoleWarnSpy).not.toHaveBeenCalled(); // No additional warnings
    });

    it("should return undefined without warning when geometryType is not present", () => {
      const mockMesh = new Object3D();
      // No geometryType getter

      const evaluator = new FeatureEvaluator(
        mockHandler,
        "test-layer",
        0n,
        mockMesh,
      );

      let capturedGeometryType: GeometryType | undefined;
      evaluator.readFeatureProperties(({ meshGeomType: gt }) => {
        capturedGeometryType = gt;
      });

      expect(capturedGeometryType).toBeUndefined();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should read geometryType dynamically on each evaluation (critical for symbol layers)", () => {
      const mockMesh = new Object3D();
      let currentType: GeometryType = "billboard";
      Object.defineProperty(mockMesh, "geometryType", {
        get: () => currentType,
        configurable: true,
      });

      const evaluator = new FeatureEvaluator(
        mockHandler,
        "test-layer",
        0n,
        mockMesh,
      );

      // First read - should be "billboard"
      let capturedGeometryType: GeometryType | undefined;
      evaluator.readFeatureProperties(({ meshGeomType: gt }) => {
        capturedGeometryType = gt;
      });
      expect(capturedGeometryType).toBe("billboard");

      // Change the geometry type (simulates symbol layer switching from billboard to text)
      currentType = "text";

      // Second read - should be "text" (not cached)
      evaluator.readFeatureProperties(({ meshGeomType: gt }) => {
        capturedGeometryType = gt;
      });
      expect(capturedGeometryType).toBe("text");
    });
  });

  describe("featureId", () => {
    // Only row 0 has a top-level id; row 1 only has a `$id` property.
    function idHandler() {
      return {
        readAllBatchedProperties: vi.fn(
          (
            _: bigint,
            cb: (
              i: number,
              id: number,
              p?: Record<string, unknown>,
              featureId?: string | number,
            ) => void,
          ) => {
            cb(0, 10, {}, 1);
            cb(1, 11, { $id: "b" }, undefined);
          },
        ),
        readFilteredBatchedProperties: vi.fn(
          (
            _: bigint,
            __: string[],
            cb: (
              i: number,
              id: number,
              f?: unknown[],
              featureId?: string | number,
            ) => void,
          ) => {
            cb(0, 10, [undefined], 1);
            cb(1, 11, ["b"], undefined);
          },
        ),
      } as unknown as FeatureHandler;
    }

    it("pairs each row with its top-level id", () => {
      const evaluator = new FeatureEvaluator(
        idHandler(),
        "test-layer",
        0n,
        new Object3D(),
      );

      const ids: (string | number | undefined)[] = [];
      evaluator.readFeatureProperties(({ featureId }, row) => {
        ids[row] = featureId;
      });

      // A `$id` property is not the feature id.
      expect(ids).toEqual([1, undefined]);
    });

    it("provides ids to filtered reads too", () => {
      const evaluator = new FeatureEvaluator(
        idHandler(),
        "test-layer",
        0n,
        new Object3D(),
      );

      const ids: (string | number | undefined)[] = [];
      evaluator.readFilteredFeatureProperties(["$id"], ({ featureId }, row) => {
        ids[row] = featureId;
      });

      expect(ids).toEqual([1, undefined]);
    });

    it("keeps the ids when replaying cached properties", () => {
      const handler = idHandler();
      const evaluator = new FeatureEvaluator(
        handler,
        "test-layer",
        0n,
        new Object3D(),
      );

      const ids: (string | number | undefined)[] = [];
      const filteredIds: (string | number | undefined)[] = [];
      evaluator.readFeatureProperties(() => {});
      evaluator.readFeatureProperties(({ featureId }, row) => {
        ids[row] = featureId;
      });
      evaluator.readFilteredFeatureProperties(["$id"], () => {});
      evaluator.readFilteredFeatureProperties(["$id"], ({ featureId }, row) => {
        filteredIds[row] = featureId;
      });

      expect(ids).toEqual([1, undefined]);
      expect(filteredIds).toEqual([1, undefined]);
      expect(handler.readAllBatchedProperties).toHaveBeenCalledTimes(1);
      expect(handler.readFilteredBatchedProperties).toHaveBeenCalledTimes(1);
    });
  });
});
