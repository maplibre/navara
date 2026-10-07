import DrapeDepthClampFragment from "@shaders/glsl/chunks/drape_depth_clamp_fragment.glsl";
import DrapeDepthClampParsFragment from "@shaders/glsl/chunks/drape_depth_clamp_pars_fragment.glsl";
import DrapeDepthClampParsVertex from "@shaders/glsl/chunks/drape_depth_clamp_pars_vertex.glsl";
import DrapeDepthClampVertex from "@shaders/glsl/chunks/drape_depth_clamp_vertex.glsl";
import DrapeGroundFragment from "@shaders/glsl/chunks/drape_ground_fragment.glsl";
import DrapeGroundParsFragment from "@shaders/glsl/chunks/drape_ground_pars_fragment.glsl";
import {
  AlwaysStencilFunc,
  BackSide,
  DecrementWrapStencilOp,
  FrontSide,
  IncrementWrapStencilOp,
  KeepStencilOp,
  Mesh,
  NotEqualStencilFunc,
  ZeroStencilOp,
  type BufferGeometry,
  type Material,
  type NormalBufferAttributes,
  type Object3DEventMap,
  type Texture,
} from "three";

import type { RefThree } from "../uniforms";
import { createReplacer } from "../utils";

const DRAPE_SETUP = Symbol("DRAPE_SETUP");

/**
 * Prepares a material for the draped scene: clamps its depth to the far plane
 * (`chunks/drape_depth_clamp_*`), and shades it at the terrain instead of on
 * its volume. The
 * visible fragments are the back faces of a volume clipped to the ground by
 * {@link DrapedMesh.process}, so the mesh's own normals and positions are
 * arbitrary. The ground point on each fragment's view ray is reconstructed
 * from the globe depth; lighting and directional shadows are evaluated there,
 * with the terrain's normal (`chunks/drape_ground_fragment`).
 *
 * Applies to materials shaped like three's `ShaderLib` ones. The depth clamp
 * needs `<logdepthbuf_vertex>` and `<logdepthbuf_fragment>`. The shading
 * applies to lit materials, whose fragment shader includes
 * `<lights_fragment_begin>`, `<normal_fragment_begin>`,
 * `<logdepthbuf_pars_fragment>`, `<shadowmap_pars_fragment>`, `<packing>`
 * (added by `overrideMaterialsForMRT`) and the `vViewPosition` varying; a
 * material without `<lights_fragment_begin>` is shaded on its volume.
 * Idempotent.
 *
 * TODO: Expose the ground point to user shaders as chunks once shader chunk
 * handling is settled; until then only the anchors above are patched.
 *
 * @param globeNormal - Uniform ref for the globe normal copy.
 * @param globeDepth - Uniform ref for the RGBA-packed globe depth copy.
 */
export function setupMaterialForDrape(
  material: Material,
  globeNormal: RefThree<Texture>,
  globeDepth: RefThree<Texture>,
): void {
  const target = material as Material & { [DRAPE_SETUP]?: boolean };
  if (target[DRAPE_SETUP]) return;
  target[DRAPE_SETUP] = true;

  // Draped and undraped materials must not share a compiled program.
  const previousCacheKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () =>
    `${previousCacheKey ? previousCacheKey.call(material) : ""}_NvrDraped`;

  const previousOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    // Runs BEFORE the previous handler, which may consume these anchors
    // (navara_three_csm swaps `#include <lights_fragment_begin>`).
    shader.vertexShader = createReplacer(shader.vertexShader)
      .replace("void main() {", `${DrapeDepthClampParsVertex}\nvoid main() {`)
      .replace(
        "#include <logdepthbuf_vertex>",
        `#include <logdepthbuf_vertex>\n${DrapeDepthClampVertex}`,
        "A draped material must include logdepthbuf_vertex",
      ).source;
    shader.fragmentShader = createReplacer(shader.fragmentShader)
      .replace("void main() {", `${DrapeDepthClampParsFragment}\nvoid main() {`)
      .replace(
        "#include <logdepthbuf_fragment>",
        `#include <logdepthbuf_fragment>\n${DrapeDepthClampFragment}`,
        "A draped material must include logdepthbuf_fragment",
      ).source;

    if (shader.fragmentShader.includes("#include <lights_fragment_begin>")) {
      shader.uniforms.tGlobeNormal = globeNormal;
      shader.uniforms.tGlobeDepth = globeDepth;
      shader.fragmentShader = createReplacer(shader.fragmentShader)
        .replace("void main() {", `${DrapeGroundParsFragment}\nvoid main() {`)
        .replace(
          "#include <normal_fragment_begin>",
          `#include <normal_fragment_begin>\n${DrapeGroundFragment}`,
          "A lit draped material must include normal_fragment_begin",
        ).source;
    }

    previousOnBeforeCompile?.call(material, shader, renderer);
  };

  material.needsUpdate = true;
}

/**
 * Chooses the normal a draped lit material is shaded with at the ground
 * point: the terrain's (default), or with `useGroundNormals: false` the
 * ellipsoid's. Without the terrain normal, the descriptor need not require
 * `globeNormal`.
 */
export function setDrapeGroundNormals(
  material: Material,
  useGroundNormals: boolean,
): void {
  material.defines ??= {};
  const ellipsoidNormal = "NVR_DRAPE_ELLIPSOID_NORMAL" in material.defines;
  if (ellipsoidNormal !== useGroundNormals) return;
  if (useGroundNormals) {
    delete material.defines.NVR_DRAPE_ELLIPSOID_NORMAL;
  } else {
    material.defines.NVR_DRAPE_ELLIPSOID_NORMAL = 1;
  }
  material.needsUpdate = true;
}

export class DrapedMesh<
  TGeometry extends BufferGeometry = BufferGeometry<NormalBufferAttributes>,
  TMaterial extends Material | Material[] = Material | Material[],
  TEventMap extends Object3DEventMap = Object3DEventMap,
> extends Mesh<TGeometry, TMaterial, TEventMap> {
  drapedEnable: boolean;

  constructor(geometry?: TGeometry, material?: TMaterial, enable = true) {
    super(geometry, material);
    this.drapedEnable = enable;

    // The volume reaches far above and below the ground, so it casts no
    // shadow while draped. Installed as an own accessor because Object3D
    // declares `castShadow` as a plain property, which TypeScript refuses to
    // let a subclass override with a getter/setter (TS2611).
    let castShadow = false;
    Object.defineProperty(this, "castShadow", {
      get: () => (this.drapedEnable ? false : castShadow),
      set: (value: boolean) => {
        castShadow = value;
      },
      configurable: true,
      enumerable: true,
    });
  }

  enabled() {
    return this.drapedEnable && this.visible;
  }

  /**
   * Run the stencil-test draping passes for this mesh.
   * The caller supplies a `render` callback that performs the actual draw call
   * (e.g. `renderer.render(scene, camera)`).
   *
   * The final pass draws back faces with the depth test off. The first one
   * rasterized at a pixel paints it and zeroes its stencil, and which one
   * that is follows the triangle order, so the shading must depend only on
   * the pixel: {@link setupMaterialForDrape} shades at the ground point under
   * the pixel.
   */
  process(render: () => void): void {
    if (!this.enabled()) return;

    const run = (m: Material) => {
      // Save original material state
      const origStencilFunc = m.stencilFunc;
      const origStencilFail = m.stencilFail;
      const origStencilZPass = m.stencilZPass;
      const origStencilZFail = m.stencilZFail;
      const origSide = m.side;
      const origColorWrite = m.colorWrite;
      const origDepthWrite = m.depthWrite;
      const origStencilWrite = m.stencilWrite;
      const origDepthTest = m.depthTest;

      // Back face pass
      m.stencilFunc = AlwaysStencilFunc;
      m.stencilFail = KeepStencilOp;
      m.stencilZPass = KeepStencilOp;
      m.stencilZFail = IncrementWrapStencilOp;
      m.side = BackSide;
      m.colorWrite = false;
      m.depthWrite = false;
      m.stencilWrite = true;
      m.depthTest = true;

      render();

      // Front face pass
      m.side = FrontSide;
      m.stencilZFail = DecrementWrapStencilOp;

      render();

      // Final pass
      m.stencilFunc = NotEqualStencilFunc;
      m.stencilFail = ZeroStencilOp;
      m.stencilZFail = ZeroStencilOp;
      m.stencilZPass = ZeroStencilOp;
      m.side = BackSide;
      m.colorWrite = true;
      m.depthTest = false;

      render();

      // Restore original material state
      m.stencilFunc = origStencilFunc;
      m.stencilFail = origStencilFail;
      m.stencilZPass = origStencilZPass;
      m.stencilZFail = origStencilZFail;
      m.side = origSide;
      m.colorWrite = origColorWrite;
      m.depthWrite = origDepthWrite;
      m.stencilWrite = origStencilWrite;
      m.depthTest = origDepthTest;
    };

    if (Array.isArray(this.material)) {
      this.material.map(run);
    } else {
      run(this.material);
    }
  }
}
