import type ThreeView from "@navaramap/three";
import { Plugin, type ViewContext } from "@navaramap/three";

import type { DevtoolPlugin } from "./DevtoolPlugin";
import { DevtoolsPanel, type DevtoolsPanelOptions } from "./DevtoolsPanel";
import {
  LayerInspectorPlugin,
  type LayerInspectorPluginOptions,
} from "./layers/LayerInspectorPlugin";
import {
  ProfilerPlugin,
  type ProfilerPluginOptions,
} from "./profiler/ProfilerPlugin";

/** A tool `DevtoolsPlugin` can add, named by its tab. */
export type DevtoolName = "profiler" | "layers";

export type DevtoolsPluginOptions = {
  /**
   * The tools to add, as tabs in this order.
   * @defaultValue `["profiler", "layers"]`
   */
  tools?: DevtoolName[];
  /** Options of the panel that hosts the tools. */
  panel?: DevtoolsPanelOptions;
  /** Options of the `"profiler"` tool. */
  profiler?: Omit<ProfilerPluginOptions, "panel">;
  /** Options of the `"layers"` tool. */
  layers?: Omit<LayerInspectorPluginOptions, "panel" | "profiler">;
};

/**
 * Development tools for a running view on one panel: the profiler (frame
 * time, memory, downloads, render buffers) and the layer inspector (layer
 * costs, visibility, a style editor). Add it before `view.init()`; press
 * `` ` `` to show or hide the panel.
 */
export class DevtoolsPlugin extends Plugin<ThreeView, ViewContext> {
  /** The panel the tools are tabs of. */
  readonly panel: DevtoolsPanel;
  /** The `"profiler"` tool, when added. */
  readonly profiler: ProfilerPlugin | undefined;
  /** The `"layers"` tool, when added. */
  readonly layers: LayerInspectorPlugin | undefined;

  private readonly tools: DevtoolPlugin[] = [];

  constructor(options: DevtoolsPluginOptions = {}) {
    super();
    const names = options.tools ?? ["profiler", "layers"];
    const panel = new DevtoolsPanel(options.panel);
    this.panel = panel;
    // The profiler is created first so the layer inspector can read its
    // downloads, whatever the tab order.
    if (names.includes("profiler")) {
      this.profiler = new ProfilerPlugin({ ...options.profiler, panel });
    }
    if (names.includes("layers")) {
      this.layers = new LayerInspectorPlugin({
        ...options.layers,
        panel,
        profiler: this.profiler,
      });
    }
    for (const name of names) {
      const tool = name === "profiler" ? this.profiler : this.layers;
      if (tool && !this.tools.includes(tool)) this.tools.push(tool);
    }
  }

  async init(view: ThreeView, ctx: ViewContext): Promise<void> {
    // Each tool adds its tab synchronously at the start of `init`, so the
    // tabs follow `tools`.
    await Promise.all(this.tools.map((tool) => tool.init(view, ctx)));
  }

  /** Removes the tools and the panel. */
  dispose(): void {
    for (const tool of this.tools) tool.dispose();
    this.panel.dispose();
  }
}
