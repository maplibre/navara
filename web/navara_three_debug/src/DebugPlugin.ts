import type ThreeView from "@navaramap/three";
import { Plugin, type ViewContext } from "@navaramap/three";
import { Pane, type FolderApi } from "tweakpane";

import type { DebugPanel } from "./DebugPanel";

/** The tweakpane container a debug plugin builds its controls in. */
export type DebugContainer = Pick<
  FolderApi,
  "addBinding" | "addFolder" | "addButton" | "addBlade"
>;

export type DebugPluginOptions = {
  /** Shared panel to add this plugin's tab to; omitted = a pane of its own. */
  panel?: DebugPanel;
  /** Whether the tool starts enabled. @defaultValue `true` */
  enabled?: boolean;
};

/**
 * Base of the debug tools: a `Plugin` whose work can be switched on and off
 * at runtime. `init` stores the view and context, builds the UI container
 * (a tab of the shared panel or an own pane) with an `enabled` toggle, calls
 * `onInit()`, then `onEnable()` when enabled. A disabled tool must hold no
 * listeners, pass wrappers or DOM beyond its controls.
 */
export abstract class DebugPlugin<
  V extends ThreeView = ThreeView,
> extends Plugin<V, ViewContext> {
  /** Tab / pane title. */
  abstract readonly title: string;

  protected view!: V;
  protected ctx!: ViewContext;
  /** The container to add controls to; valid from `onInit()` on. */
  protected ui!: DebugContainer;

  private readonly panel: DebugPanel | undefined;
  private ownPane: Pane | undefined;
  private _enabled: boolean;
  private ready = false;
  private readonly state = { enabled: true };
  private enabledBinding: { refresh(): void } | undefined;

  constructor(options: DebugPluginOptions = {}) {
    super();
    this.panel = options.panel;
    this._enabled = options.enabled ?? true;
  }

  async init(view: V, ctx: ViewContext): Promise<void> {
    this.view = view;
    this.ctx = ctx;
    if (this.panel) {
      this.ui = this.panel.addPage(this.title);
    } else {
      this.ownPane = new Pane({ title: this.title, expanded: true });
      const style = this.ownPane.element.style;
      style.position = "absolute";
      style.top = "8px";
      style.right = "8px";
      style.width = "400px";
      style.maxHeight = "calc(100vh - 16px)";
      style.overflow = "auto";
      style.zIndex = "1000";
      this.ui = this.ownPane;
    }
    this.state.enabled = this._enabled;
    this.enabledBinding = this.ui
      .addBinding(this.state, "enabled")
      .on("change", (ev) => {
        this.enabled = ev.value;
      });
    this.onInit();
    this.ready = true;
    if (this._enabled) this.onEnable();
  }

  /** Whether the tool is doing its work. Toggling before `init` is deferred. */
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    if (value === this._enabled) return;
    this._enabled = value;
    this.state.enabled = value;
    this.enabledBinding?.refresh();
    if (!this.ready) return;
    if (value) this.onEnable();
    else this.onDisable();
  }

  /** Builds the controls. The view is initialized; the tool is not enabled yet. */
  protected abstract onInit(): void;
  /** Attaches listeners, wrappers and DOM. */
  protected abstract onEnable(): void;
  /** Detaches everything `onEnable` attached. */
  protected abstract onDisable(): void;
  /** Releases resources that outlive enable / disable cycles. */
  protected onDispose(): void {}

  dispose(): void {
    if (this.ready && this._enabled) this.onDisable();
    this._enabled = false;
    this.onDispose();
    this.ownPane?.dispose();
    this.ownPane = undefined;
  }
}
