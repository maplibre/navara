import type { DevtoolContainer } from "../DevtoolPlugin";

const STYLE_ID = "nvr-devtools-styles";

/**
 * Styles for the HTML blocks, in tweakpane's own palette: its CSS variables
 * (`--mo-fg`, `--lbl-fg`, `--bs-ff`, …) are defined on the pane root.
 */
const CSS = `
.nvr-dbg { font-family: var(--bs-ff); font-size: 11px; line-height: 1.5;
  color: var(--mo-fg); padding: 2px 4px 4px; }
.nvr-dbg table { width: 100%; border-collapse: collapse; table-layout: auto; }
.nvr-dbg th { text-align: left; font-weight: 500; color: var(--lbl-fg);
  padding: 1px 4px; border-bottom: 1px solid var(--grv-fg); white-space: nowrap; }
.nvr-dbg td { padding: 1px 4px; white-space: nowrap; }
.nvr-dbg td.name { max-width: 170px; overflow: hidden; text-overflow: ellipsis; }
.nvr-dbg .num { text-align: right; font-variant-numeric: tabular-nums; }
.nvr-dbg .muted { opacity: 0.55; }
.nvr-dbg .warn { color: #f0b54a; }
.nvr-dbg .bad { color: #ff6b6b; }
.nvr-dbg .good { color: #7bd88f; }
.nvr-dbg tr.total td { border-top: 1px solid var(--grv-fg); font-weight: 500; }
.nvr-dbg tr.group td { color: var(--lbl-fg); padding-top: 5px; }
.nvr-dbg tr.click { cursor: pointer; }
.nvr-dbg tr.click:hover { background: var(--in-bg-h); }
.nvr-dbg tr.selected { background: var(--in-bg-a); }
.nvr-dbg .bar { display: inline-block; height: 7px; border-radius: 2px;
  background: #6cb6ff; vertical-align: middle; }
.nvr-dbg .meter { display: inline-block; width: 70px; height: 7px; border-radius: 2px;
  background: var(--in-bg); vertical-align: middle; overflow: hidden; }
.nvr-dbg .meter > span { display: block; height: 100%; background: #6cb6ff; }
.nvr-dbg .meter.warn > span { background: #f0b54a; }
.nvr-dbg .meter.bad > span { background: #ff6b6b; }
.nvr-dbg .kv { display: grid; grid-template-columns: max-content 1fr; gap: 1px 10px; }
.nvr-dbg .kv > .k { color: var(--lbl-fg); }
.nvr-dbg .note { color: var(--lbl-fg); white-space: normal; margin-top: 3px; }
.nvr-dbg input[type="checkbox"] { margin: 0; vertical-align: middle; }
.nvr-dbg .btns { display: flex; flex-wrap: wrap; gap: 4px; }
.nvr-dbg button { background: var(--btn-bg); color: var(--btn-fg); border: 0;
  border-radius: var(--bld-br); font: inherit; font-weight: 600; padding: 2px 8px;
  cursor: pointer; }
.nvr-dbg button:hover { background: var(--btn-bg-h); }
.nvr-dbg button:active { background: var(--btn-bg-a); }
.nvr-dbg button:disabled { opacity: 0.4; cursor: default; }
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** A block of free HTML inside a tweakpane container. */
export type HtmlBlock = {
  element: HTMLDivElement;
  /** Replaces the content (skipped when unchanged, so hover state survives). */
  render(html: string): void;
  dispose(): void;
};

/**
 * Adds a full-width block of plain HTML to a tweakpane container. Tweakpane
 * has no free-content blade, so a separator blade is emptied and used as the
 * host: tweakpane keeps placing and disposing it, the content is ours.
 */
export function addHtmlBlock(container: DevtoolContainer): HtmlBlock {
  injectStyles();
  const blade = container.addBlade({ view: "separator" });
  const host = blade.element;
  host.replaceChildren();
  const element = document.createElement("div");
  element.className = "nvr-dbg";
  host.appendChild(element);
  let last = "";
  return {
    element,
    render(html: string) {
      if (html === last) return;
      last = html;
      element.innerHTML = html;
    },
    dispose() {
      blade.dispose();
    },
  };
}

/** Escapes text for HTML content and attribute values. */
export function esc(text: unknown): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A horizontal bar `fraction` (0..1) of `width` pixels wide. */
export function bar(fraction: number, width = 60, color?: string): string {
  const w = Math.max(0, Math.min(1, fraction)) * width;
  const style = `width:${w.toFixed(1)}px${color ? `;background:${color}` : ""}`;
  return `<span class="bar" style="${style}"></span>`;
}

/** A fill meter for `fraction` of a budget; warns past 85 %, alarms past 100 %. */
export function meter(fraction: number): string {
  const cls = fraction > 1 ? "bad" : fraction > 0.85 ? "warn" : "";
  const w = Math.max(0, Math.min(1, fraction)) * 100;
  return `<span class="meter ${cls}"><span style="width:${w.toFixed(1)}%"></span></span>`;
}

/**
 * Sets the hover hint of a tweakpane binding, button or folder. A folder's
 * hint goes on its title bar only, so it does not cover its contents.
 */
export function hint(api: { element: HTMLElement }, text: string): void {
  const titleBar = api.element.querySelector<HTMLElement>(
    ":scope > .tp-fldv_b",
  );
  (titleBar ?? api.element).title = text;
}
