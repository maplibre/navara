import type { DebugContainer } from "../DebugPlugin";

/**
 * A read-only multiline text block spanning the container's full width, in
 * a monospace font: tweakpane's own label column would squeeze it into the
 * value column. `tp-lblv-nol` is the class tweakpane itself applies to
 * label-less rows.
 */
export function addTable<O extends Record<K, string>, K extends string>(
  container: DebugContainer,
  object: O,
  key: K,
  rows: number,
): void {
  const api = container.addBinding(object, key, {
    readonly: true,
    multiline: true,
    rows,
  });
  api.element.classList.add("tp-lblv-nol");
  const textarea = api.element.querySelector("textarea");
  if (textarea) {
    textarea.style.fontFamily =
      "ui-monospace, Menlo, Consolas, 'Roboto Mono', monospace";
    textarea.style.fontSize = "10px";
    textarea.style.lineHeight = "14px";
    textarea.style.height = `${rows * 14 + 6}px`;
    textarea.style.whiteSpace = "pre";
  }
}
