/**
 * Example-page bootstrap for the curated gallery examples (pages/examples/*).
 *
 * `initializeExample` bundles the plumbing every demo page needs but that is
 * not part of the example's API story, so a single opaque call is all that
 * shows up in the displayed main.ts source.
 *
 * Currently that plumbing is scene-loaded signalling: the detail page
 * (`pages/detail/DetailApp.tsx`) renders the loading overlay over the demo
 * iframe and dismisses it when the demo posts SCENE_LOADED_MESSAGE. The page
 * counts as settled once every passed async-loading mesh has finished loading;
 * pages that pass none settle a short moment after setup. (Waiting for the
 * engine to fall idle is deliberately avoided: some pages drive it every frame
 * — a running `PersonViewPlugin` re-aims the camera each tick — so it would
 * never go idle and the overlay would hang forever.)
 */

import type ThreeView from "@navaramap/three";

/** `type` of the message posted to the embedding window when the scene settles. */
export const SCENE_LOADED_MESSAGE = "navara-example:scene-loaded";

/**
 * Delay before settling a page that passes no async-loading meshes: there is
 * nothing to wait on, so give the first frame a moment to render rather than
 * waiting for the engine to fall idle.
 */
const NO_MESH_SETTLE_MS = 1000;

/**
 * A mesh handle whose data loads asynchronously outside the engine's event
 * stream: its desc emits `load` / `error` events (GLTFModelDesc,
 * SplatMeshDesc, Text3DMeshDesc).
 */
type AsyncLoadedMeshHandle = {
  ref: {
    on(event: "load" | "error", callback: () => void): unknown;
  };
};

/**
 * Hooks the demo page up to the example harness. Call at the end of the
 * page's setup, passing the handles of any async-loading meshes (GLTF
 * models, 3D Gaussian Splats, 3D text): the loading overlay is dismissed once they
 * have all finished loading. With no meshes passed, it settles a short moment
 * after setup instead. Standalone `/demo/...` visits post the scene-loaded
 * message to the page's own window, which tooling (e.g. the screenshot script)
 * can observe.
 */
export const initializeExample = (
  // Kept for call-site symmetry with every other example, and in case future
  // plumbing needs the view again; the settle logic no longer reads it.
  _view: ThreeView,
  loadingMeshes: AsyncLoadedMeshHandle[] = [],
): void => {
  const settle = () =>
    window.parent.postMessage({ type: SCENE_LOADED_MESSAGE }, "*");

  // Nothing async to wait on — settle shortly after setup.
  if (loadingMeshes.length === 0) {
    window.setTimeout(settle, NO_MESH_SETTLE_MS);
    return;
  }

  // Otherwise settle as soon as every passed mesh has finished loading. A
  // failed load also counts as finished, so the overlay never hangs.
  let pendingLoads = loadingMeshes.length;
  for (const mesh of loadingMeshes) {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (--pendingLoads === 0) settle();
    };
    mesh.ref.on("load", finish);
    mesh.ref.on("error", finish);
  }
};
