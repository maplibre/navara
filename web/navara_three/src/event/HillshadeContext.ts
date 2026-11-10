import type { ElevationDecoder } from "@navaramap/engine";
import type { Texture } from "three";
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  RGBFormat,
  UnsignedByteType,
  WebGLRenderTarget,
} from "three";

import type { ViewContext } from "../core";
import { HillshadeNormalMapGenerator } from "../utils/hillshadeNormalMapGenerator";

import type { TileHandler } from "./context";

/**
 * Hillshade decoder configuration from Rust
 */
export type HillshadeConfig = {
  rgbScaler: [number, number, number]; // vec3: [R, G, B] scalers
  boundary: number;
  minOffset: number;
  maxOffset: number;
  epsilon: number;
  offset: number;
};

/**
 * Temporary DEM state while waiting for edge updates.
 * Stores only the WASM buffer handle and received edge strips — NOT the full padded DEM.
 * The padded DEM is reconstructed transiently on each edge arrival, then discarded.
 */
type TempDemEntry = {
  originalHandle: number;
  paddedSize: number;
  receivedEdges: Set<number>;
  receivedEdgeData: Map<number, Uint8Array>;
  metersPerTexel: number;
  hillshadeConfig: HillshadeConfig;
};

/**
 * Context for managing hillshade-related state and resources
 * Centralizes all hillshade processing state to avoid scattered global variables
 */
export class HillshadeContext {
  /** Shared normal map generator for offline rendering */
  private normalMapGenerator: HillshadeNormalMapGenerator | null = null;

  /** Scale factor for normal map RenderTarget dimensions (1.0 = full res, 0.5 = half res for mobile) */
  normalMapScale = 1.0;

  /** Pending edge updates that arrived before the main texture was created */
  readonly pendingEdges = new Map<string, Map<number, Uint8Array>>();

  /**
   * Temporary storage for DEM reconstruction state while waiting for edge updates.
   * entityId → { originalHandle, paddedSize, receivedEdges, receivedEdgeData, ... }
   */
  readonly tempDemTextures = new Map<string, TempDemEntry>();

  /**
   * RenderTarget pool for normal map generation
   * One RenderTarget per entity to avoid GPU→CPU→GPU round-trip
   * Similar to texturizedSceneRenderTargets in tile.ts
   */
  private renderTargets = new Map<string, WebGLRenderTarget>();

  /**
   * Get or create the normal map generator
   * @param viewContext - ViewContext to get the renderer from
   */
  getOrCreateGenerator(viewContext: ViewContext): HillshadeNormalMapGenerator {
    if (!this.normalMapGenerator) {
      const renderer = viewContext.getRenderer();
      this.normalMapGenerator = new HillshadeNormalMapGenerator(renderer);
    }
    return this.normalMapGenerator;
  }

  /**
   * Get hillshade decoder config from tile
   * @param tileHandler - TileHandler to query WASM
   * @param tileHandle - Tile handle to get elevation decoder from
   */
  getHillshadeConfig(
    tileHandler: TileHandler,
    tileHandle: bigint,
    sourceDecoder?: ElevationDecoder,
  ): HillshadeConfig {
    // The hillshade layer's own source decoder, sent with the DEM. The tile's
    // terrain decoder is only a fallback: the terrain may use another source,
    // or have no DEM at all.
    const decoder =
      sourceDecoder ?? tileHandler.getTileElevationDecoder(tileHandle);

    if (decoder) {
      return {
        rgbScaler: [decoder.r_scaler, decoder.g_scaler, decoder.b_scaler],
        boundary: decoder.boundary,
        minOffset: decoder.min_offset,
        maxOffset: decoder.max_offset,
        epsilon: decoder.epsilon,
        offset: decoder.offset,
      };
    } else {
      // Fallback to Terrarium defaults if no decoder found
      return {
        rgbScaler: [256, 1, 1 / 256],
        boundary: 0,
        minOffset: 0,
        maxOffset: 0,
        epsilon: 1.0,
        offset: -32768,
      };
    }
  }

  /**
   * Get or create a RenderTarget for the given entity
   * Reuses existing RenderTarget if size matches, creates new one otherwise
   * @private
   */
  private getOrCreateRenderTarget(
    entityId: string,
    width: number,
    height: number,
  ): WebGLRenderTarget {
    let rt = this.renderTargets.get(entityId);

    // Check if size matches (different zoom levels may have different sizes)
    if (rt && (rt.width !== width || rt.height !== height)) {
      rt.dispose();
      rt = undefined;
    }

    if (!rt) {
      rt = new WebGLRenderTarget(width, height, {
        format: RGBFormat,
        type: UnsignedByteType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        wrapS: ClampToEdgeWrapping,
        wrapT: ClampToEdgeWrapping,
        colorSpace: NoColorSpace,
        generateMipmaps: false,
      });
      this.renderTargets.set(entityId, rt);
    }

    return rt;
  }

  /**
   * Generate normal map texture from DEM data
   * Creates a transient DataTexture for GPU upload, renders to RenderTarget, then frees the DEM texture.
   * @param entityId - Entity ID for RenderTarget lookup/creation
   * @param viewContext - ViewContext to get the renderer from
   * @param demData - Padded DEM pixel data (CPU only, not GPU-resident)
   * @param paddedSize - Width/height of the padded DEM (square)
   * @param metersPerTexel - Meters per texel for normal calculation
   * @param hillshadeConfig - Hillshade decoder configuration
   * @param contentWidth - Content width (without padding)
   * @param contentHeight - Content height (without padding)
   * @returns Normal map texture (references RenderTarget.texture directly)
   */
  generateNormalMap(
    entityId: string,
    viewContext: ViewContext,
    demData: Uint8Array,
    paddedSize: number,
    metersPerTexel: number,
    hillshadeConfig: HillshadeConfig,
    contentWidth: number,
    contentHeight: number,
  ): Texture {
    const renderTarget = this.getOrCreateRenderTarget(
      entityId,
      Math.max(1, Math.round(contentWidth * this.normalMapScale)),
      Math.max(1, Math.round(contentHeight * this.normalMapScale)),
    );

    // Create a transient DataTexture for GPU upload, render, then dispose immediately
    const demTexture = new DataTexture(
      demData,
      paddedSize,
      paddedSize,
      RGBAFormat,
      UnsignedByteType,
    );
    demTexture.colorSpace = NoColorSpace;
    demTexture.minFilter = NearestFilter;
    demTexture.magFilter = NearestFilter;
    demTexture.needsUpdate = true;

    const generator = this.getOrCreateGenerator(viewContext);
    generator.renderToTarget(
      renderTarget,
      demTexture,
      metersPerTexel,
      hillshadeConfig,
    );

    demTexture.dispose();

    return renderTarget.texture;
  }

  /**
   * Clear RenderTarget for the given entity
   */
  clearRenderTarget(entityId: string): void {
    const rt = this.renderTargets.get(entityId);
    if (rt) {
      rt.dispose();
      this.renderTargets.delete(entityId);
    }
  }

  /**
   * Store temporary DEM entry (WASM handle + metadata) for edge updates.
   * Does NOT store the full padded DEM — only the handle needed to re-read on demand.
   */
  storeTempDem(
    entityId: string,
    originalHandle: number,
    paddedSize: number,
    metersPerTexel: number,
    hillshadeConfig: HillshadeConfig,
  ): void {
    this.tempDemTextures.set(entityId, {
      originalHandle,
      paddedSize,
      receivedEdges: new Set(),
      receivedEdgeData: new Map(),
      metersPerTexel,
      hillshadeConfig,
    });
  }

  /**
   * Store an edge pixel strip for later padded DEM reconstruction.
   */
  storeEdgeData(
    entityId: string,
    edgeDirection: number,
    edgeBytes: Uint8Array,
  ): void {
    const entry = this.tempDemTextures.get(entityId);
    if (entry) {
      entry.receivedEdgeData.set(edgeDirection, edgeBytes);
    }
  }

  /**
   * Get temporary DEM texture entry
   */
  getTempDem(entityId: string): TempDemEntry | undefined {
    return this.tempDemTextures.get(entityId);
  }

  /**
   * Mark an edge as received for a temporary DEM
   * @returns true if all 4 edges have been received
   */
  markEdgeReceived(entityId: string, edgeDirection: number): boolean {
    const entry = this.tempDemTextures.get(entityId);
    if (!entry) return false;

    entry.receivedEdges.add(edgeDirection);
    return entry.receivedEdges.size >= 4; // All 4 edges received
  }

  /**
   * Clear temporary DEM data
   */
  clearTempDem(entityId: string): void {
    this.tempDemTextures.delete(entityId);
  }

  /**
   * Cleanup all resources
   * Should be called on view disposal
   */
  dispose(): void {
    this.tempDemTextures.clear();
    this.pendingEdges.clear();

    // Dispose all RenderTargets
    for (const rt of this.renderTargets.values()) {
      rt.dispose();
    }
    this.renderTargets.clear();

    // Dispose generator
    if (this.normalMapGenerator) {
      this.normalMapGenerator.dispose();
      this.normalMapGenerator = null;
    }
  }
}
