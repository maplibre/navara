/**
 * Creates the WebGL 2 context the view renders with, on its own canvas (an
 * `HTMLCanvasElement`, or an `OffscreenCanvas` in a worker), with the
 * attributes three would request itself. The renderer is handed this
 * context, so {@link supportsReversedDepthBuffer} checks the very context it
 * renders with, and no second context is created to probe it.
 *
 * When the canvas already holds a WebGL 2 context, the browser returns that
 * one and ignores the attributes. `null` when WebGL 2 is unavailable; three
 * then creates the context and reports the error as before.
 */
export function createWebGL2Context(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  { antialias, stencil }: { antialias: boolean; stencil: boolean },
): WebGL2RenderingContext | null {
  // WebGLRenderer's own request (three r187).
  return canvas.getContext("webgl2", {
    alpha: true,
    depth: true,
    stencil,
    antialias,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "default",
    failIfMajorPerformanceCaveat: false,
  }) as WebGL2RenderingContext | null;
}

/**
 * Whether `gl` can render a reversed depth buffer: `EXT_clip_control`, and
 * `EXT_color_buffer_float` for the float render targets the reversed path
 * copies depth into (depth copies, depth picking). Decided before the
 * renderer is created, so it gets only the depth mode it will use (three
 * warns when given both).
 */
export function supportsReversedDepthBuffer(
  gl: WebGL2RenderingContext,
): boolean {
  const extensions = gl.getSupportedExtensions() ?? [];
  return (
    extensions.includes("EXT_clip_control") &&
    extensions.includes("EXT_color_buffer_float")
  );
}
