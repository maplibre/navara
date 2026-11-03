import { Pane, type TabApi, type TabPageApi } from "tweakpane";

export type DebugPanelOptions = {
  /** Panel title. @defaultValue `"Navara debug"` */
  title?: string;
  /** Element the panel is appended to. @defaultValue `document.body` */
  container?: HTMLElement;
  /**
   * Key that shows / hides the panel (`KeyboardEvent.key`), ignored while an
   * input element has focus. `null` disables it. @defaultValue `` "`" ``
   */
  hotkey?: string | null;
  /** Panel width in CSS pixels. @defaultValue `400` */
  width?: number;
  /** Whether the panel starts visible. @defaultValue `true` */
  visible?: boolean;
};

/**
 * One tweakpane `Pane` shared by several debug plugins, each on its own tab.
 * Pass the same instance to every plugin's `panel` option; without it each
 * plugin opens a pane of its own.
 */
export class DebugPanel {
  readonly pane: Pane;
  private tab: TabApi | undefined;
  private readonly hotkey: string | null;
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== this.hotkey || event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    this.toggle();
  };

  constructor(options: DebugPanelOptions = {}) {
    this.pane = new Pane({
      title: options.title ?? "Navara debug",
      container: options.container,
      expanded: true,
    });
    const style = this.pane.element.style;
    style.position = "absolute";
    style.top = "8px";
    style.right = "8px";
    style.width = `${options.width ?? 400}px`;
    style.maxHeight = "calc(100vh - 16px)";
    style.overflow = "auto";
    style.zIndex = "1000";
    style.fontVariantNumeric = "tabular-nums";
    this.hotkey = options.hotkey === undefined ? "`" : options.hotkey;
    if (this.hotkey !== null) {
      window.addEventListener("keydown", this.onKeyDown);
    }
    this.visible = options.visible ?? true;
  }

  /** Adds a tab page; the tab bar appears with the first one. */
  addPage(title: string): TabPageApi {
    if (!this.tab) {
      this.tab = this.pane.addTab({ pages: [{ title }] });
      return this.tab.pages[0];
    }
    return this.tab.addPage({ title });
  }

  get visible(): boolean {
    return this.pane.element.style.display !== "none";
  }

  set visible(value: boolean) {
    this.pane.element.style.display = value ? "" : "none";
  }

  toggle(): void {
    this.visible = !this.visible;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.pane.dispose();
  }
}
