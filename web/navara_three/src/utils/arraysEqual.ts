/** Element-wise `===` equality of two arrays or typed arrays. */
export function arraysEqual<T>(
  a: ArrayLike<T> | undefined,
  b: ArrayLike<T> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
