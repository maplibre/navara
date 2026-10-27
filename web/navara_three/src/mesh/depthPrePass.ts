import {
  AlwaysStencilFunc,
  type BufferGeometry,
  KeepStencilOp,
  type Material,
  Mesh,
  type MeshLambertMaterial,
  NotEqualStencilFunc,
  ReplaceStencilOp,
} from "three";

import { NVR_BLENDED_DEFINE } from "../material";
import { DEPTH_PRE_PASS_RENDER_ORDER } from "../renderOrder";

/**
 * Stencil value the blended pass writes where it draws. One value serves
 * every pre-passed mesh: their depth is all written before any of them
 * blends, so only fragments at the nearest pre-passed depth pass the depth
 * test, and the stencil only breaks ties between those. The `CustomRenderPass`
 * clears the stencil to 0 before the MRT scene, so it must not be 0.
 */
const DEPTH_PRE_PASS_STENCIL_REF = 1;

/**
 * Depth-only twin of a blended mesh, added as its child. It draws in the
 * opaque list before any blended mesh, so the blended pass keeps only the
 * nearest surface of the owner instead of stacking its overlapping faces.
 * Faces at that same depth (a feature duplicated in neighboring tiles, or
 * two coplanar features) would still all pass, so while the twin exists the
 * owner also draws through the stencil, once per pixel.
 *
 * The material is a clone of the owner's, re-synced before every draw: the
 * shared compile hooks read the owner's enhancer state and uniforms, so only
 * `wireframe` and the defines need copying.
 */
export class DepthPrePassMesh extends Mesh<
  BufferGeometry,
  MeshLambertMaterial
> {
  private syncedVersion: number;

  /** Rebuild it when the owner's geometry or material is replaced. */
  constructor(
    private readonly owner: Mesh<BufferGeometry, MeshLambertMaterial>,
  ) {
    super(owner.geometry, cloneMaterial(owner.material));
    this.syncedVersion = owner.material.version;
    this.renderOrder = DEPTH_PRE_PASS_RENDER_ORDER;
    this.frustumCulled = owner.frustumCulled;
    setDrawOncePerPixel(owner.material, true);
  }

  onBeforeRender(...args: Parameters<Mesh["onBeforeRender"]>) {
    const source = this.owner.material;
    const material = this.material;
    material.wireframe = source.wireframe;

    // Batch attributes and `lit` add defines to the source after creation.
    if (this.syncedVersion !== source.version) {
      this.syncedVersion = source.version;
      material.defines = { ...source.defines, [NVR_BLENDED_DEFINE]: false };
      material.needsUpdate = true;
    }
    this.owner.onBeforeRender(...args);
  }

  dispose() {
    setDrawOncePerPixel(this.owner.material, false);
    this.material.dispose();
  }
}

const cloneMaterial = (source: MeshLambertMaterial): MeshLambertMaterial => {
  const material = source.clone();
  // `clone()` drops the compile hooks.
  material.onBeforeCompile = source.onBeforeCompile;
  material.customProgramCacheKey = source.customProgramCacheKey;
  material.transparent = false;
  material.colorWrite = false;
  // Marking the stencil here would fail the owner everywhere it draws.
  material.stencilWrite = false;
  return material;
};

/** Toggles the stencil test that lets only the first fragment of a pixel draw. */
const setDrawOncePerPixel = (material: Material, enabled: boolean) => {
  material.stencilWrite = enabled;
  material.stencilFunc = enabled ? NotEqualStencilFunc : AlwaysStencilFunc;
  material.stencilRef = enabled ? DEPTH_PRE_PASS_STENCIL_REF : 0;
  material.stencilFuncMask = 0xff;
  material.stencilWriteMask = 0xff;
  material.stencilFail = KeepStencilOp;
  material.stencilZFail = KeepStencilOp;
  material.stencilZPass = enabled ? ReplaceStencilOp : KeepStencilOp;
};
