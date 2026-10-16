export type ResolvedOrientation = {
  flatFacing: boolean;
  rotateWithCamera: boolean;
};

/**
 * Resolve a material's facing and `rotateWithCamera` the way MapLibre
 * resolves `auto` for `*-rotation-alignment` and `*-pitch-alignment`: an
 * unset `rotateWithCamera` follows the camera only for point placement, and
 * an unset facing lies flat exactly when the label is aligned with the map.
 */
export function resolveOrientation(
  facing: string | undefined,
  rotateWithCamera: boolean | undefined,
  placement: string | undefined,
): ResolvedOrientation {
  const follow = rotateWithCamera ?? (placement ?? "point") === "point";
  return {
    flatFacing: facing === undefined ? !follow : facing === "flat",
    rotateWithCamera: follow,
  };
}
