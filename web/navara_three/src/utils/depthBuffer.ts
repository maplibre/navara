let reversedDepthSupport: boolean | undefined;

/**
 * Whether this browser can render a reversed depth buffer: WebGL 2 with
 * `EXT_clip_control`, and `EXT_color_buffer_float` for the float render
 * targets the reversed path copies depth into (depth copies, depth picking).
 * Probed once on a throwaway context, so the renderer is created with only
 * the depth mode it will use (three warns when given both).
 */
export function supportsReversedDepthBuffer(): boolean {
  if (reversedDepthSupport !== undefined) return reversedDepthSupport;
  const gl =
    typeof document === "undefined"
      ? null
      : document.createElement("canvas").getContext("webgl2");
  const extensions = gl?.getSupportedExtensions() ?? [];
  reversedDepthSupport =
    extensions.includes("EXT_clip_control") &&
    extensions.includes("EXT_color_buffer_float");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return reversedDepthSupport;
}
