/**
 * Makes a statically positioned element the containing block of its
 * absolutely positioned children.
 * @returns A function that restores the element's own `position`.
 */
export function positionIfStatic(element: HTMLElement): () => void {
  if (getComputedStyle(element).position !== "static") return () => {};

  const position = element.style.position;
  element.style.position = "relative";
  return () => {
    element.style.position = position;
  };
}
