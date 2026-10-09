/**
 * The pure numeric placement kernel used by {@link DeclutterManager}.
 *
 * Given a flat list of candidates and the camera, it projects each anchor to a
 * screen-pixel box, sorts by priority (with placement hysteresis), and greedily
 * claims space in a uniform screen-space grid — returning one `hidden` flag
 * (`0` = shown, `1` = hidden) per candidate, in input order.
 *
 * The production implementation is the Rust `declutterPlace` in
 * `navara_wasm_api` (see {@link wasmDeclutterKernel}); the projection, collision
 * grid, and greedy placement all live there. Injecting it keeps the manager free
 * of an import-time WASM dependency, so its orchestration is unit-tested with a
 * stub. Placement correctness itself is covered by the crate's Rust tests.
 */
export type DeclutterKernel = {
  /**
   * @param candidates Packed `f64` data, {@link CANDIDATE_STRIDE} values per
   *   candidate; pass a subarray of exactly `n * CANDIDATE_STRIDE`.
   * @param view Column-major view matrix (inverse of `camera.matrixWorld`), 16.
   * @param proj Column-major projection matrix, 16.
   * @param horizonMinHeight Height (never positive) the ellipsoid is shrunk
   *   by for horizon culling, as the renderer's `nvrHorizonMinHeight`.
   * @returns One `hidden` flag (`0`/`1`) per candidate, in input order.
   */
  place(
    candidates: Float64Array,
    view: Float64Array,
    proj: Float64Array,
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    near: number,
    widthPx: number,
    heightPx: number,
    fovRad: number,
    horizonMinHeight: number,
    paddingPx: number,
    hysteresisPx: number,
  ): Uint8Array;
};

/**
 * Number of `f64` values per candidate in the packed kernel input. Must stay in
 * sync with `CANDIDATE_STRIDE` in `crates/navara_wasm_api/src/declutter.rs`.
 *
 * Layout: `[anchorX, anchorY, anchorZ, addHeight, minX, maxX, minY, maxY,
 * sizeInMeters, priority, isShown]`.
 */
export const CANDIDATE_STRIDE = 11;
