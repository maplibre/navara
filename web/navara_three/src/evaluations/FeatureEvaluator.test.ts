import { Object3D } from "three";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { FeatureHandler } from "../event/context";

import {
  FeatureEvaluator,
  type FeatureInfo,
  type GeometryType,
} from "./FeatureEvaluator";

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
      readFeatureSummaries: vi.fn(() => undefined),
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

  describe("id and geometry summary", () => {
    // Two features of one MVT layer: a polygon whose id needs all 64 bits,
    // and a line with no id, laid out as navara_wasm's readFeatureSummaries
    // returns them.
    const summaries = new Float64Array([
      0xfedcba98,
      0x76543210,
      2,
      139.7,
      35.6,
      139.8,
      35.7,
      139.75,
      35.65,
      1234.5,
      NaN,
      NaN,
      1,
      139.0,
      35.0,
      139.1,
      35.1,
      139.05,
      35.05,
      500,
    ]);

    const handlerWith = (flat: Float64Array | undefined): FeatureHandler =>
      ({
        readAllBatchedProperties: vi.fn((_, callback) => {
          callback(0, 10, { name: "a" });
          callback(1, 11, { name: "b" });
        }),
        readFilteredBatchedProperties: vi.fn((_, __, callback) => {
          callback(0, 10, ["a"]);
          callback(1, 11, ["b"]);
        }),
        readFeatureSummaries: vi.fn(() => flat),
      }) as unknown as FeatureHandler;

    const expected: Pick<FeatureInfo, "id" | "geometry">[] = [
      {
        id: 0xfedcba9876543210n,
        geometry: {
          type: "Polygon",
          bbox: [139.7, 35.6, 139.8, 35.7],
          centroid: [139.75, 35.65],
          area: 1234.5,
        },
      },
      {
        id: undefined,
        geometry: {
          type: "LineString",
          bbox: [139.0, 35.0, 139.1, 35.1],
          centroid: [139.05, 35.05],
          length: 500,
        },
      },
    ];

    const pick = ({ id, geometry }: FeatureInfo) => ({ id, geometry });

    it("passes each batch its feature's id and summary", () => {
      const evaluator = new FeatureEvaluator(
        handlerWith(summaries),
        "layer",
        0n,
        new Object3D(),
      );
      const all: Pick<FeatureInfo, "id" | "geometry">[] = [];
      evaluator.readFeatureProperties((info) => all.push(pick(info)));
      const filtered: Pick<FeatureInfo, "id" | "geometry">[] = [];
      evaluator.readFilteredFeatureProperties(["name"], (info) =>
        filtered.push(pick(info)),
      );

      expect(all).toEqual(expected);
      expect(filtered).toEqual(expected);
    });

    it("passes the summary to evaluate callbacks on every re-evaluation", () => {
      const evaluator = new FeatureEvaluator(
        handlerWith(summaries),
        "layer",
        0n,
        new Object3D(),
      );
      for (let run = 0; run < 2; run++) {
        const seen: Pick<FeatureInfo, "id" | "geometry">[] = [];
        evaluator.evaluate((info) => {
          seen.push(pick(info));
          return {};
        });
        expect(seen).toEqual(expected);
      }
    });

    it("does not call the engine from inside its property callbacks", () => {
      // The engine is borrowed while it runs a read callback, and a nested
      // call throws ("recursive use of an object").
      let reading = false;
      const guarded = (read: (...args: unknown[]) => void) =>
        vi.fn((...args: unknown[]) => {
          reading = true;
          try {
            read(...args);
          } finally {
            reading = false;
          }
        });
      const base = handlerWith(summaries);
      const handler = {
        readAllBatchedProperties: guarded(
          base.readAllBatchedProperties as (...args: unknown[]) => void,
        ),
        readFilteredBatchedProperties: guarded(
          base.readFilteredBatchedProperties as (...args: unknown[]) => void,
        ),
        readFeatureSummaries: vi.fn(() => {
          if (reading) throw new Error("recursive use of an object");
          return summaries;
        }),
      } as unknown as FeatureHandler;

      const filtered = new FeatureEvaluator(
        handler,
        "layer",
        0n,
        new Object3D(),
      );
      const seen: Pick<FeatureInfo, "id" | "geometry">[] = [];
      filtered.readFilteredFeatureProperties(["name"], (info) =>
        seen.push(pick(info)),
      );
      const all = new FeatureEvaluator(handler, "layer", 0n, new Object3D());
      all.readFeatureProperties((info) => seen.push(pick(info)));
      expect(seen).toEqual([...expected, ...expected]);
    });

    it("leaves id and geometry undefined for sources without summaries", () => {
      const evaluator = new FeatureEvaluator(
        handlerWith(undefined),
        "layer",
        0n,
        new Object3D(),
      );
      const seen: Pick<FeatureInfo, "id" | "geometry">[] = [];
      evaluator.readFeatureProperties((info) => seen.push(pick(info)));
      expect(seen).toEqual([
        { id: undefined, geometry: undefined },
        { id: undefined, geometry: undefined },
      ]);
    });
  });
});
