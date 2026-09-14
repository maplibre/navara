import { MeshBasicMaterial, type WebGLRenderer } from "three";
import { vi } from "vitest";

import { initBatchedMaterial } from "./material";
import type { BatchTextureConfig } from "./types";

/**
 * Helper: create a Material and initialize it for batch styling. Uses the
 * polygon capability list (height + extrudedHeight) unless overridden.
 * No texture exists until the first attribute write.
 */
export function setupBatchMaterial(
  batchLength: number,
  scalars: BatchTextureConfig["scalars"] = ["height", "extrudedHeight"],
  vec3s?: BatchTextureConfig["vec3s"],
): {
  material: MeshBasicMaterial;
  config: BatchTextureConfig;
} {
  const config: BatchTextureConfig = { scalars, vec3s, batchLength };
  const material = new MeshBasicMaterial();
  initBatchedMaterial(material, { scalars, vec3s, batchLength: 0 });
  initBatchedMaterial(material, config);
  return { material, config };
}

export function mockRenderer(): WebGLRenderer {
  return { initTexture: vi.fn() } as unknown as WebGLRenderer;
}
