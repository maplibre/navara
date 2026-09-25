import { mercatorY, type Core } from "@navaramap/engine";

import type { TileHandler } from "./context";

export type TileHandlerDeps = {
  /** Accessor (not a snapshot) — the Core is created asynchronously after
   * WASM init and can be dropped on dispose. */
  getCore: () => Core | undefined;
  /** Per-frame cached revision snapshots (refreshed once per `_render`), so
   * per-tile `onBeforeRender` gating costs no WASM-boundary call. */
  getVectorRevision: () => number;
  getRasterRevision: () => number;
};

/**
 * Build the {@link TileHandler} context over a WASM `Core`. Extracted from
 * `ThreeView` so tests can assemble the same handler over a shared test engine
 * (`test-utils/engine.ts`) instead of stubbing the Rust-backed functions.
 */
export function createTileHandler(deps: TileHandlerDeps): TileHandler {
  const { getCore } = deps;
  return {
    getMartini: (id) => {
      return getCore()?.getMartini(id);
    },
    getTile: (handle) => {
      return getCore()?.getTile(handle);
    },
    getTileElevationDecoder: (handle) => {
      return getCore()?.getTileElevationDecoder(handle);
    },
    getTerrainDemBytes: (handle) => {
      return getCore()?.getTerrainDemBytes(handle);
    },
    getVectorTileStates: (handle) => {
      return getCore()?.getVectorTileStates(handle);
    },
    vectorRevision: deps.getVectorRevision,
    getRasterTileStates: (handle) => {
      return getCore()?.getRasterTileStates(handle);
    },
    rasterRevision: deps.getRasterRevision,
    reportDrapeGpuBytes: (handle, bytes) => {
      getCore()?.reportTerrainDrapeGpuBytes(handle, bytes);
    },
    calcMetersPerTexel: (tileHandle, textureZoom, textureWidth) => {
      return (
        getCore()?.calcMetersPerTexel(tileHandle, textureZoom, textureWidth) ??
        1.0
      );
    },
    mercatorY,
  };
}
