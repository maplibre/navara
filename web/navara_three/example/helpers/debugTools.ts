import type ThreeView from "@navaramap/three";
import {
  DebugPanel,
  LayerDebuggerPlugin,
  ProfilerPlugin,
} from "@navaramap/three-debug";

export type DebugTools = {
  panel: DebugPanel;
  profiler: ProfilerPlugin;
  layers: LayerDebuggerPlugin;
};

/**
 * Adds the debug tool plugins to a view, sharing one panel. Call before
 * `view.init()`. With `onlyWithQuery`, nothing is added unless the page URL
 * carries `?debug` (optionally `?debug=profiler,...` to pick tools).
 */
export function installDebugTools(
  view: ThreeView,
  { onlyWithQuery = false }: { onlyWithQuery?: boolean } = {},
): DebugTools | undefined {
  const query = new URLSearchParams(window.location.search).get("debug");
  if (onlyWithQuery && query === null) return undefined;
  const picked = query ? query.split(",").filter(Boolean) : [];
  const wants = (name: string) => picked.length === 0 || picked.includes(name);

  const panel = new DebugPanel();
  const profiler = new ProfilerPlugin({ panel, enabled: wants("profiler") });
  view.addPlugin(profiler);
  const layers = new LayerDebuggerPlugin({
    panel,
    profiler,
    enabled: wants("layers"),
    // Retaining geometry arrays inflates the JS heap the profiler reports;
    // pay for it only when the layer tool was asked for.
    wireframe: wants("layers"),
  });
  view.addPlugin(layers);
  return { panel, profiler, layers };
}
