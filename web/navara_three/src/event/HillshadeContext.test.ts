import type { ElevationDecoder } from "@navaramap/engine";
import { describe, it, expect, beforeEach, vi } from "vitest";

import type { TileHandler } from "./context";
import { HillshadeContext } from "./HillshadeContext";
import type { HillshadeConfig } from "./HillshadeContext";

describe("HillshadeContext", () => {
  let context: HillshadeContext;
  const mockConfig: HillshadeConfig = {
    rgbScaler: [1, 1, 1],
    boundary: 0,
    minOffset: 0,
    maxOffset: 0,
    epsilon: 1.0,
    offset: 0,
  };

  beforeEach(() => {
    context = new HillshadeContext();
  });

  describe("getHillshadeConfig", () => {
    // Mapbox Terrain-RGB and Terrarium, as the engine reports them.
    const mapbox = {
      r_scaler: 65536,
      g_scaler: 256,
      b_scaler: 1,
      boundary: 10000,
      min_offset: 0,
      max_offset: 0,
      epsilon: 0.1,
      offset: -10000,
    } as ElevationDecoder;
    const terrarium = {
      r_scaler: 256,
      g_scaler: 1,
      b_scaler: 1 / 256,
      boundary: 0,
      min_offset: 0,
      max_offset: 0,
      epsilon: 1.0,
      offset: -32768,
    } as ElevationDecoder;
    const tileHandler = (terrainDecoder?: ElevationDecoder) =>
      ({
        getTileElevationDecoder: vi.fn(() => terrainDecoder),
      }) as unknown as TileHandler;

    it("uses the hillshade source's decoder over the terrain's", () => {
      const config = context.getHillshadeConfig(
        tileHandler(terrarium),
        1n,
        mapbox,
      );
      expect(config.rgbScaler).toEqual([65536, 256, 1]);
      expect(config.epsilon).toBe(0.1);
      expect(config.offset).toBe(-10000);
    });

    it("decodes with the source's decoder when the terrain has no DEM", () => {
      const config = context.getHillshadeConfig(tileHandler(), 1n, mapbox);
      expect(config.rgbScaler).toEqual([65536, 256, 1]);
    });

    it("falls back to the terrain's decoder without a source decoder", () => {
      const config = context.getHillshadeConfig(tileHandler(terrarium), 1n);
      expect(config.rgbScaler).toEqual([256, 1, 1 / 256]);
      expect(config.offset).toBe(-32768);
    });
  });

  describe("pendingEdges management", () => {
    it("allows multiple edges for same entity", () => {
      const entityId = "tile_1";
      const edge0 = new Uint8Array([1, 2, 3, 4]);
      const edge1 = new Uint8Array([5, 6, 7, 8]);

      const pending = new Map<number, Uint8Array>();
      pending.set(0, edge0);
      pending.set(1, edge1);
      context.pendingEdges.set(entityId, pending);

      const stored = context.pendingEdges.get(entityId);
      expect(stored).toBeDefined();
      expect(stored?.size).toBe(2);
      expect(stored?.get(0)).toBe(edge0);
      expect(stored?.get(1)).toBe(edge1);
    });

    it("overwrites pending edge for same direction", () => {
      const entityId = "tile_1";
      const oldEdge = new Uint8Array([1, 2, 3, 4]);
      const newEdge = new Uint8Array([5, 6, 7, 8]);

      const pending = new Map<number, Uint8Array>();
      pending.set(0, oldEdge);
      context.pendingEdges.set(entityId, pending);

      // Overwrite with new edge
      pending.set(0, newEdge);

      const stored = context.pendingEdges.get(entityId);
      expect(stored).toBeDefined();
      expect(stored?.get(0)).toBe(newEdge);
      expect(stored?.get(0)).not.toBe(oldEdge);
    });
  });

  describe("tempDemTextures lifecycle", () => {
    it("stores and retrieves temp DEM entry", () => {
      const entityId = "tile_1";
      const originalHandle = 42;

      context.storeTempDem(entityId, originalHandle, 6, 1.0, mockConfig);

      const entry = context.getTempDem(entityId);
      expect(entry).toBeDefined();
      expect(entry?.originalHandle).toBe(originalHandle);
      expect(entry?.paddedSize).toBe(6);
      expect(entry?.metersPerTexel).toBe(1.0);
      expect(entry?.receivedEdges.size).toBe(0);
    });

    it("initializes with empty receivedEdges set and receivedEdgeData map", () => {
      const entityId = "tile_1";

      context.storeTempDem(entityId, 1, 6, 1.0, mockConfig);

      const entry = context.getTempDem(entityId);
      expect(entry).toBeDefined();
      expect(entry?.receivedEdges).toBeInstanceOf(Set);
      expect(entry?.receivedEdges.size).toBe(0);
      expect(entry?.receivedEdgeData).toBeInstanceOf(Map);
      expect(entry?.receivedEdgeData.size).toBe(0);
    });

    it("stores edge data via storeEdgeData", () => {
      const entityId = "tile_1";
      context.storeTempDem(entityId, 1, 6, 1.0, mockConfig);

      const edgeBytes = new Uint8Array([1, 2, 3, 4]);
      context.storeEdgeData(entityId, 0, edgeBytes);

      const entry = context.getTempDem(entityId);
      expect(entry?.receivedEdgeData.get(0)).toBe(edgeBytes);
    });

    it("tracks edge reception", () => {
      const entityId = "tile_1";

      context.storeTempDem(entityId, 1, 6, 1.0, mockConfig);

      expect(context.markEdgeReceived(entityId, 0)).toBe(false); // 1/4
      expect(context.markEdgeReceived(entityId, 1)).toBe(false); // 2/4
      expect(context.markEdgeReceived(entityId, 2)).toBe(false); // 3/4
      expect(context.markEdgeReceived(entityId, 3)).toBe(true); // 4/4 - all received

      const entry = context.getTempDem(entityId);
      expect(entry).toBeDefined();
      expect(entry?.receivedEdges.size).toBe(4);
    });

    it("handles duplicate edge reception", () => {
      const entityId = "tile_1";

      context.storeTempDem(entityId, 1, 6, 1.0, mockConfig);

      expect(context.markEdgeReceived(entityId, 0)).toBe(false);
      expect(context.markEdgeReceived(entityId, 0)).toBe(false); // Duplicate
      expect(context.markEdgeReceived(entityId, 0)).toBe(false); // Duplicate

      const entry = context.getTempDem(entityId);
      expect(entry).toBeDefined();
      expect(entry?.receivedEdges.size).toBe(1); // Still only 1 edge
    });

    it("clears temp DEM entry", () => {
      const entityId = "tile_1";

      context.storeTempDem(entityId, 1, 6, 1.0, mockConfig);
      expect(context.getTempDem(entityId)).toBeDefined();

      context.clearTempDem(entityId);

      expect(context.getTempDem(entityId)).toBeUndefined();
    });

    it("replaces existing temp DEM when storing new one", () => {
      const entityId = "tile_1";

      context.storeTempDem(entityId, 10, 6, 1.0, mockConfig);
      context.markEdgeReceived(entityId, 0);

      // Store new DEM (replaces old one)
      context.storeTempDem(entityId, 20, 6, 2.0, mockConfig);

      const entry = context.getTempDem(entityId);
      expect(entry).toBeDefined();
      expect(entry?.originalHandle).toBe(20);
      expect(entry?.metersPerTexel).toBe(2.0);
      expect(entry?.receivedEdges.size).toBe(0); // Reset
    });
  });

  describe("edge-driven lifecycle integration", () => {
    it("scenario: all edges arrive before texture creation", () => {
      const entityId = "tile_1";

      const pending = new Map<number, Uint8Array>();
      pending.set(0, new Uint8Array([1, 2, 3, 4]));
      pending.set(1, new Uint8Array([5, 6, 7, 8]));
      pending.set(2, new Uint8Array([9, 10, 11, 12]));
      pending.set(3, new Uint8Array([13, 14, 15, 16]));
      context.pendingEdges.set(entityId, pending);

      context.storeTempDem(entityId, 1, 6, 1.0, mockConfig);

      context.markEdgeReceived(entityId, 0);
      context.markEdgeReceived(entityId, 1);
      context.markEdgeReceived(entityId, 2);
      const allReceived = context.markEdgeReceived(entityId, 3);

      expect(allReceived).toBe(true);
      const finalEntry = context.getTempDem(entityId);
      expect(finalEntry).toBeDefined();
      expect(finalEntry?.receivedEdges.size).toBe(4);

      context.clearTempDem(entityId);
      expect(context.getTempDem(entityId)).toBeUndefined();
    });

    it("scenario: edges arrive after texture, then all cleared", () => {
      const entityId = "tile_1";

      context.storeTempDem(entityId, 1, 6, 1.0, mockConfig);

      expect(context.markEdgeReceived(entityId, 0)).toBe(false);
      expect(context.markEdgeReceived(entityId, 1)).toBe(false);
      expect(context.markEdgeReceived(entityId, 2)).toBe(false);
      expect(context.markEdgeReceived(entityId, 3)).toBe(true);

      context.clearTempDem(entityId);
      expect(context.getTempDem(entityId)).toBeUndefined();
    });

    it("scenario: late edge arrives after temp DEM cleared", () => {
      const entityId = "tile_1";

      context.storeTempDem(entityId, 1, 6, 1.0, mockConfig);

      context.markEdgeReceived(entityId, 0);
      context.markEdgeReceived(entityId, 1);
      context.markEdgeReceived(entityId, 2);
      context.markEdgeReceived(entityId, 3);

      context.clearTempDem(entityId);

      const result = context.markEdgeReceived(entityId, 0);
      expect(result).toBe(false); // No temp DEM exists
    });

    it("scenario: mixed order (some pending, some after)", () => {
      const entityId = "tile_1";

      const pending = new Map<number, Uint8Array>();
      pending.set(0, new Uint8Array([1, 2, 3, 4]));
      pending.set(2, new Uint8Array([9, 10, 11, 12]));
      context.pendingEdges.set(entityId, pending);

      context.storeTempDem(entityId, 1, 6, 1.0, mockConfig);

      context.markEdgeReceived(entityId, 0);
      context.markEdgeReceived(entityId, 2);

      expect(context.markEdgeReceived(entityId, 1)).toBe(false);
      expect(context.markEdgeReceived(entityId, 3)).toBe(true);

      const mixedEntry = context.getTempDem(entityId);
      expect(mixedEntry).toBeDefined();
      expect(mixedEntry?.receivedEdges.size).toBe(4);
    });
  });
});
