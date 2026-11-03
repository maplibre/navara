import type { EffectComposer, Pass } from "postprocessing";
import {
  FloatType,
  HalfFloatType,
  Material,
  Object3D,
  Texture,
  WebGLRenderTarget,
} from "three";

const DEPTH_BYTES_PER_TEXEL = 4; // DEPTH24_STENCIL8 / DEPTH_COMPONENT32F
const MIPMAP_FACTOR = 1.33;

function bytesPerTexel(type: number): number {
  switch (type) {
    case FloatType:
      return 16; // RGBA32F
    case HalfFloatType:
      return 8; // RGBA16F
    default:
      return 4; // RGBA8 and friends
  }
}

function renderTargetBytes(target: WebGLRenderTarget): number {
  const pixels = target.width * target.height;
  let bytes = 0;
  for (const texture of target.textures) {
    let textureBytes = pixels * bytesPerTexel(texture.type);
    if (texture.generateMipmaps) {
      textureBytes = Math.floor(textureBytes * MIPMAP_FACTOR);
    }
    bytes += textureBytes;
  }
  if (target.depthBuffer || target.depthTexture) {
    bytes += pixels * DEPTH_BYTES_PER_TEXEL;
  }
  if (target.samples > 0) {
    // MSAA renderbuffers exist alongside the resolve textures: one per color
    // attachment, plus a depth renderbuffer whether depth is a plain buffer
    // or a depth texture.
    let msaaBytesPerPixel = 0;
    for (const texture of target.textures) {
      msaaBytesPerPixel += bytesPerTexel(texture.type);
    }
    if (target.depthBuffer || target.depthTexture) {
      msaaBytesPerPixel += DEPTH_BYTES_PER_TEXEL;
    }
    bytes += target.samples * pixels * msaaBytesPerPixel;
  }
  return bytes;
}

function collectRenderTargets(
  value: unknown,
  targets: Set<WebGLRenderTarget>,
  visited: Set<object>,
  depth: number,
): void {
  if (value === null || typeof value !== "object" || visited.has(value)) {
    return;
  }
  visited.add(value);

  if (value instanceof WebGLRenderTarget) {
    targets.add(value);
    return;
  }

  // Prune subtrees that cannot contain render targets: scene graphs,
  // materials, textures, and raw buffers (Object.keys on a large typed array
  // would enumerate every element).
  if (
    depth <= 0 ||
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    value instanceof Object3D ||
    value instanceof Material ||
    value instanceof Texture
  ) {
    return;
  }

  // Shallow property scan, mirroring postprocessing's Pass.dispose() search.
  // Recursion is bounded so nested passes/effects (e.g. CustomRenderPass's
  // copy passes, EffectPass's effects) are covered without walking the scene.
  for (const key of Object.keys(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        collectRenderTargets(item, targets, visited, depth - 1);
      }
    } else {
      collectRenderTargets(child, targets, visited, depth - 1);
    }
  }
}

/**
 * Returns whether the render target has actually been allocated on the GPU.
 * Three.js allocates lazily on first `setRenderTarget`, so targets that a
 * pipeline never renders into (e.g. a `CopyPass` used with `renderToScreen`,
 * the composer's output buffer while no pass swaps, mode-dependent merge
 * targets) hold no GPU memory and must not be charged to the ledger.
 * `renderer.properties` is an internal-but-stable API (postprocessing itself
 * relies on it); when it is unavailable, assume allocated.
 */
function isAllocated(renderer: unknown, target: WebGLRenderTarget): boolean {
  const properties = (
    renderer as {
      properties?: { get(object: object): { __webglFramebuffer?: unknown } };
    } | null
  )?.properties;
  if (!properties) return true;
  return properties.get(target).__webglFramebuffer !== undefined;
}

/** One render target of the fixed stack, as listed by {@link listRenderTargets}. */
export type RenderTargetEntry = {
  /** The pass that owns the target, or `"composer"` for the ping-pong buffers. */
  owner: string;
  target: WebGLRenderTarget;
  /** Nominal bytes once allocated (see {@link estimateFixedGpuBytes}). */
  bytes: number;
  /** Whether the GPU has allocated the target yet (lazily, on first use). */
  allocated: boolean;
};

/**
 * Lists every render target of the fixed (screen-sized, non-tile) stack: the
 * composer's ping-pong and depth buffers plus every render target reachable
 * from the given passes and their effects. A target reachable from several
 * passes is attributed to the first one in order.
 */
export function listRenderTargets(
  composer: EffectComposer,
  passes: Iterable<{ name: string; pass: Pass }>,
): RenderTargetEntry[] {
  const targets = new Set<WebGLRenderTarget>();
  const visited = new Set<object>();
  const owners = new Map<WebGLRenderTarget, string>();

  const collect = (owner: string, value: unknown, depth: number) => {
    collectRenderTargets(value, targets, visited, depth);
    for (const target of targets) {
      if (!owners.has(target)) owners.set(target, owner);
    }
  };

  collect("composer", composer.inputBuffer, 0);
  collect("composer", composer.outputBuffer, 0);
  // Stable-depth target (postprocessing >= 6.39); private, hence the cast.
  collect(
    "composer",
    (composer as unknown as { depthRenderTarget?: WebGLRenderTarget | null })
      .depthRenderTarget,
    0,
  );

  for (const { name, pass } of passes) {
    collect(name, pass, 3);
  }

  const renderer = (
    composer as unknown as { getRenderer?: () => unknown }
  ).getRenderer?.();

  const entries: RenderTargetEntry[] = [];
  for (const target of targets) {
    entries.push({
      owner: owners.get(target) ?? "composer",
      target,
      bytes: renderTargetBytes(target),
      allocated: isAllocated(renderer, target),
    });
  }
  return entries;
}

/**
 * Estimates the resident GPU bytes of the fixed (screen-sized, non-tile)
 * render-target stack: the composer's ping-pong and depth buffers plus every
 * render target reachable from the registered passes and their effects.
 * Targets not yet allocated on the GPU are skipped, so the estimate should be
 * re-taken after rendering (allocations happen lazily during the first frames
 * that exercise a code path).
 *
 * The result is an estimate in the same accuracy class as the ledger's
 * `gpu_bytes_est`: texture formats are mapped to nominal byte sizes and
 * driver padding is ignored.
 */
export function estimateFixedGpuBytes(
  composer: EffectComposer,
  passes: Iterable<{ name: string; pass: Pass }>,
): number {
  let bytes = 0;
  for (const entry of listRenderTargets(composer, passes)) {
    if (entry.allocated) bytes += entry.bytes;
  }
  return bytes;
}
