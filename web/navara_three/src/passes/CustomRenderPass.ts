import { Globe } from "@navaramap/core";
import { DepthCopyPass } from "postprocessing";
import {
  Color,
  DepthStencilFormat,
  DepthTexture,
  RGBADepthPacking,
  Scene,
  UnsignedInt248Type,
  WebGLRenderTarget,
  type Material,
  type Mesh,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from "three";

import { RenderPass } from "../effects";
import { NVR_BLENDED_DEFINE, NVR_UNLIT_SCENE_DEFINE } from "../material";
import {
  GBUFFER_ATTACHMENT_NAMES,
  GBUFFER_DEFINE_NAMES,
  appendOptionalGBufferAttachments,
  computeGBufferDefines,
  computeGBufferTextureIndex,
  createGBufferAttachments,
  resolveGBufferOptions,
  type GBufferTextureIndex,
  type ResolvedGBufferOptions,
} from "../material/gbufferLayout";
import { DrapedMesh, setupMaterialForDrape } from "../mesh/DrapedMesh";
import type { Scenes } from "../scene";

import { AllDepthCopyPass, NormalCopyPass, RenderTargetCopyPass } from ".";

// Scratch color reused when re-asserting the clear color each frame.
const CLEAR_COLOR = new Color();

/**
 * Options for CustomRenderPass
 */
export type CustomRenderPassOptions = {
  debugNormal?: boolean;
  disableShadow?: boolean;
  allowTransparent?: boolean;
  /** G-buffer attachment configuration. Defaults to all optional buffers disabled. */
  buffers?: ResolvedGBufferOptions;
  /**
   * Scene-level default of the `lit` material option (`view.lit`). When
   * `false`, materials without an explicit `lit` output plain albedo.
   * @defaultValue true
   */
  lit?: boolean;
};

export class CustomRenderPass extends RenderPass {
  protected _camera: PerspectiveCamera;
  protected _scenes: Scenes;
  gbufferRenderTarget: WebGLRenderTarget;
  private copyPass: RenderTargetCopyPass;
  globeDepthCopyPass: DepthCopyPass;
  globeNormalCopyPass: NormalCopyPass;
  allDepthCopyPass: AllDepthCopyPass;
  disableShadow: boolean;
  private globe: Globe;
  private combinedScene = new Scene();
  private drapedTempScene = new Scene();

  // Used to render only the shadow map
  private shadowScene = new Scene();
  private dummyShadowRenderTarget = new WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    stencilBuffer: false,
  });

  private debugNormalCopyPass?: NormalCopyPass;
  private readonly gbufferScenes: readonly Scene[];
  // Rendered outside the G-buffer pass, so these must never declare G-buffer
  // outputs the render target has no attachments for.
  private readonly forwardScenes: readonly Scene[];
  private allowTransparent: boolean;
  private buffers: ResolvedGBufferOptions;
  // Scene-level default of the `lit` material option (`view.lit`).
  private sceneLit: boolean;
  // Template for rebuilding the G-buffer render target in setBuffers.
  private inputBufferTemplate: WebGLRenderTarget;
  /**
   * Attachment indices of `gbufferRenderTarget.textures` for this view.
   * Recomputed by {@link setBuffers}.
   */
  textureIndex: GBufferTextureIndex;
  // Defines carrying the enabled optional outputs and their locations,
  // stamped onto every material rendered into the G-buffer.
  private gbufferDefines: Readonly<Record<string, number>>;
  private gbufferDefinesStamped = new WeakSet<Material>();
  // Materials met in a G-buffer scene during the current traversal. Lets the
  // forward traversal tell a material that left the G-buffer scenes (its
  // defines must go) from one shared with them (they must stay).
  private readonly gbufferVisited = new Set<Material>();
  // Separate from the G-buffer set: the two cover different scene sets, and a
  // shared one would skip the G-buffer defines for a material first seen in
  // the opaque scene that later moves to the MRT pass.
  private litStamped = new WeakSet<Material>();
  // Drives the globe-normal copy target, which stays 1x1 until a draped mesh
  // exists. Tracked here because setSize can arrive while it is inactive.
  private globeNormalActive = false;
  private readonly globeNormalUniform: { value: Texture | null };
  private width = 1;
  private height = 1;

  constructor(
    scenes: Scenes,
    camera: PerspectiveCamera,
    inputBuffer: WebGLRenderTarget,
    globe: Globe,
    options?: CustomRenderPassOptions,
  ) {
    super();

    this.needsDepthTexture = true;

    this.clearPass.setClearFlags(true, true, true);

    this._scenes = scenes;
    this._camera = camera;
    this.globe = globe;

    this.gbufferScenes = [scenes.globe, scenes.mrt, scenes.draped];
    this.forwardScenes = [scenes.opaque, scenes.transparent];

    this.buffers = options?.buffers ?? resolveGBufferOptions();
    this.sceneLit = options?.lit ?? true;
    this.textureIndex = computeGBufferTextureIndex(this.buffers);
    this.gbufferDefines = computeGBufferDefines(this.buffers);
    this.inputBufferTemplate = inputBuffer;

    this.gbufferRenderTarget = inputBuffer.clone();
    // Extra G-buffer attachments (normal/effectIds/emissive) – see
    // material/gbufferLayout.ts for the layout definition.
    createGBufferAttachments(this.gbufferRenderTarget, this.buffers);

    // The gbuffer owns its depth texture instead of sharing the composer's one
    // (postprocessing >= 6.39 no longer exposes a writable shared depth
    // texture). Depth is propagated to the composer's input buffer explicitly
    // by the copy pass below. Stencil is required for draped-mesh rendering.
    const gbufferDepthTexture = new DepthTexture(
      this.gbufferRenderTarget.width,
      this.gbufferRenderTarget.height,
      UnsignedInt248Type,
    );
    gbufferDepthTexture.format = DepthStencilFormat;
    this.gbufferRenderTarget.depthTexture = gbufferDepthTexture;

    this.copyPass = new RenderTargetCopyPass(this.gbufferRenderTarget);
    this.copyPass.setDepthTexture(gbufferDepthTexture);

    this.globeDepthCopyPass = new DepthCopyPass({
      depthPacking: RGBADepthPacking,
    });

    this.allDepthCopyPass = new AllDepthCopyPass();

    this.disableShadow = !!options?.disableShadow;
    this.allowTransparent = options?.allowTransparent ?? true;

    this.globeNormalCopyPass = new NormalCopyPass();
    // The copy target keeps its Texture identity across setSize, so draped
    // materials can bind this ref once.
    this.globeNormalUniform = { value: this.globeNormalCopyPass.texture };
    if (options?.debugNormal) {
      this.debugNormalCopyPass = new NormalCopyPass();
      this.debugNormalCopyPass.unpackNormal = true;
    }
    this.bindNormalTexture();
  }

  /**
   * Re-points the copy passes at the normal attachment. The attachment is
   * freshly allocated on every {@link setBuffers}, so the reference cannot be
   * captured once.
   */
  private bindNormalTexture(): void {
    const index = this.textureIndex.normal;
    if (index === undefined) return;
    const texture = this.gbufferRenderTarget.textures[index];
    this.globeNormalCopyPass.setNormalTexture(texture);
    this.debugNormalCopyPass?.setNormalTexture(texture);
  }

  // Render the scene with world scene that includes user setting object like a light.
  protected _renderWithLight(renderer: WebGLRenderer, scene: Scene) {
    if (this.disableShadow) {
      renderer.render(scene, this._camera);
      return;
    }
    scene.add(this._scenes.light);
    renderer.render(scene, this._camera);
    scene.remove(this._scenes.light);
  }

  /**
   * Applies a new derived buffer configuration. Attachment locations may have
   * shifted, so every material is re-stamped and its shader recompiled.
   */
  setBuffers(buffers: ResolvedGBufferOptions): void {
    // Only the attachment-backed names matter here — `globeNormal` is picked
    // up by render() and must not trigger a rebuild on its own.
    const unchanged = GBUFFER_ATTACHMENT_NAMES.every(
      (name) => buffers[name] === this.buffers[name],
    );
    this.buffers = buffers;
    if (unchanged) {
      return;
    }
    this.textureIndex = computeGBufferTextureIndex(buffers);
    this.gbufferDefines = computeGBufferDefines(buffers);
    this.gbufferDefinesStamped = new WeakSet();

    // Must be a fresh target: splicing textures in place leaves the renderer's
    // cached GL state on a stale attachment, so writes land in the framebuffer
    // while samplers read empty storage. Only color and depth keep their
    // Texture identity; every optional attachment is reallocated, which is why
    // consumers must re-fetch each frame rather than capture at creation.
    const old = this.gbufferRenderTarget;
    const rt = this.inputBufferTemplate.clone();
    rt.setSize(old.width, old.height);
    rt.texture = old.texture;
    appendOptionalGBufferAttachments(rt, buffers);
    rt.depthTexture = old.depthTexture;
    // three disposes rt.depthTexture with the target; detach the reused one.
    old.depthTexture = null;
    this.gbufferRenderTarget = rt;
    old.dispose();

    this.copyPass.setRenderTarget(rt);
    this.bindNormalTexture();
  }

  /** Applies a new scene-level `lit` default (`view.lit` changed). */
  setLit(lit: boolean): void {
    if (this.sceneLit === lit) return;
    this.sceneLit = lit;
    this.litStamped = new WeakSet();
  }

  // Materials reach the G-buffer from anywhere (built-ins, enhancers, user
  // ShaderMaterials), so they are stamped here rather than per-desc. `lit` is
  // a lighting define, not a G-buffer one, hence the forward scenes too.
  //
  // Runs every frame. A material can appear without any scene-level signal:
  // added inside a group that is already in the scene (a glTF populating its
  // group after load), swapped in place on a mesh (`mesh.material = ...`), or
  // added in the same frame another mesh was removed. It may also compile to
  // a program that is already cached, so the program count does not change
  // either. An unstamped material declares no G-buffer outputs and renders
  // without normal / effect-id / emissive data. The per-material work is
  // WeakSet-gated, so the per-frame cost is the traversal alone.
  //
  // A mesh can also leave the G-buffer scenes (its last selective effect
  // removed, see MeshDescWithSelectiveEffect.getPassKey); its material must
  // then stop declaring outputs the forward target has no attachments for.
  // G-buffer scenes are traversed first so a material shared by both sets
  // keeps its outputs: the G-buffer needs them, the forward pass discards
  // them.
  private stampGBufferDefines(): void {
    this.gbufferVisited.clear();
    for (const scene of this.gbufferScenes) {
      scene.traverse((object) => {
        this.forEachMaterial(object, (m) => this.stampGBufferDefine(m));
      });
    }
    for (const scene of this.forwardScenes) {
      scene.traverse((object) => {
        this.forEachMaterial(object, (m) => this.stampForwardDefines(m));
      });
    }
    this.gbufferVisited.clear();
    // Drape shading is opted into here rather than per-desc, so a mesh moved
    // into the draped scene picks it up wherever it came from.
    this._scenes.draped.traverse((object) => {
      this.forEachMaterial(object, (m) =>
        setupMaterialForDrape(m, this.globeNormalUniform),
      );
    });
  }

  private forEachMaterial(
    object: unknown,
    visit: (material: Material) => void,
  ): void {
    const material = (object as Partial<Mesh>).material;
    if (!material) return;
    if (Array.isArray(material)) {
      for (const m of material) visit(m);
    } else {
      visit(material);
    }
  }

  private stampGBufferDefine(material: Material): void {
    this.gbufferVisited.add(material);
    material.defines ??= {};
    let changed = false;

    // `material.transparent` toggles at runtime (e.g. `globe.transparent`),
    // so this one is synced on every visit instead of being gated by the set.
    const blended = material.transparent ? 1 : false;
    if ((material.defines[NVR_BLENDED_DEFINE] ?? false) !== blended) {
      material.defines[NVR_BLENDED_DEFINE] = blended;
      changed = true;
    }

    if (!this.gbufferDefinesStamped.has(material)) {
      this.gbufferDefinesStamped.add(material);
      for (const name of GBUFFER_DEFINE_NAMES) {
        // `false` clears a stale define – three's generateDefines skips it.
        const value = this.gbufferDefines[name] ?? false;
        const current = material.defines[name] ?? false;
        if (current !== value) {
          material.defines[name] = value;
          changed = true;
        }
      }
    }

    if (changed) {
      material.needsUpdate = true;
    }

    this.stampLitDefine(material);
  }

  private stampForwardDefines(material: Material): void {
    if (
      this.gbufferDefinesStamped.has(material) &&
      !this.gbufferVisited.has(material)
    ) {
      this.clearGBufferDefines(material);
    }
    this.stampLitDefine(material);
  }

  private clearGBufferDefines(material: Material): void {
    this.gbufferDefinesStamped.delete(material);
    const defines = material.defines;
    if (!defines) return;
    let changed = false;
    for (const name of GBUFFER_DEFINE_NAMES) {
      if (name in defines) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete defines[name];
        changed = true;
      }
    }
    if (NVR_BLENDED_DEFINE in defines) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete defines[NVR_BLENDED_DEFINE];
      changed = true;
    }
    if (changed) {
      material.needsUpdate = true;
    }
  }

  /** Per-material `lit` (NVR_LIT / NVR_UNLIT) wins over this in the shader. */
  private stampLitDefine(material: Material): void {
    if (this.litStamped.has(material)) return;
    this.litStamped.add(material);

    material.defines ??= {};
    const sceneUnlit = this.sceneLit ? false : 1;
    if ((material.defines[NVR_UNLIT_SCENE_DEFINE] ?? false) !== sceneUnlit) {
      material.defines[NVR_UNLIT_SCENE_DEFINE] = sceneUnlit;
      material.needsUpdate = true;
    }
  }

  render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    _outputBuffer: WebGLRenderTarget | null,
  ) {
    this.stampGBufferDefines();

    const shouldDrapeByStencilTest = this._scenes.draped.children.length !== 0;

    const renderTarget = this.gbufferRenderTarget;

    if (this.clearPass.enabled) {
      this.clearPass.render(renderer, inputBuffer, null);
    }

    // Render shadow map
    if (renderer.shadowMap.enabled && !this.disableShadow) {
      renderer.setRenderTarget(this.dummyShadowRenderTarget);
      this.shadowScene.add(this._scenes.globe);
      this.shadowScene.add(this._scenes.mrt);
      this.shadowScene.add(this._scenes.opaque);
      renderer.shadowMap.needsUpdate = true;
      this._renderWithLight(renderer, this.shadowScene);
      this.shadowScene.clear();
    }

    const clearDepth =
      !this.globe.hideUnderground ||
      // If transparent isn't allowed, show the underground. For example, the picking process doesn't need transparency.
      // The underground should be shown when `transparent` is true to pick the underground object.
      (!this.allowTransparent && this.globe.transparent);

    renderer.setRenderTarget(renderTarget);
    renderer.setClearColor(
      renderer.getClearColor(CLEAR_COLOR),
      renderer.getClearAlpha(),
    );
    renderer.clear();

    this._renderWithLight(renderer, this._scenes.globe);

    // Draped meshes read it and draw further down, so the copy still happens
    // before its consumer; effects opt in through `requiredBuffers`.
    const needsGlobeNormal =
      (shouldDrapeByStencilTest || this.buffers.globeNormal) &&
      this.textureIndex.normal !== undefined;
    this.setGlobeNormalActive(needsGlobeNormal);
    if (needsGlobeNormal) {
      this.globeNormalCopyPass.render(renderer, null, null);
    }

    this.globeDepthCopyPass.setDepthTexture(
      renderTarget.depthTexture as DepthTexture,
    );
    this.globeDepthCopyPass.render(renderer, null, null);

    if (clearDepth) {
      // Copy globe depth to the all depth buffer
      this.allDepthCopyPass.setDepthTexture(
        this.globeDepthCopyPass.texture,
        RGBADepthPacking,
      );
      this.allDepthCopyPass.copyDepth(false);
      this.allDepthCopyPass.render(renderer, null, null);
    }

    // Set actual renderTarget again because it's changed in copy passes
    renderer.setRenderTarget(renderTarget);

    if (clearDepth) {
      // Clear depth if hideUnderground is false.
      renderer.clearDepth();
    }

    const shouldBlend =
      !clearDepth &&
      this.allowTransparent &&
      this.globe.transparent &&
      this.globe.hideUnderground;

    if (shouldBlend) {
      // Clear just color for blending.
      // Also avoid to reset depth before draping by stencil buffer.
      renderer.clearColor();
    }

    if (shouldDrapeByStencilTest) {
      this._renderDrapedMesh(renderer);
    }

    if (shouldBlend) {
      // Clear depth as well after stencil buffer draping.
      renderer.clearDepth();
    }

    // If globe can be transparent, need to render all scene in same scene to blend them.
    // Currently, blending is supported only with MRT scene.
    if (shouldBlend) {
      this.combinedScene.clear();
      this.combinedScene.add(this._scenes.globe);
      this.combinedScene.add(this._scenes.mrt);
      this._renderWithLight(renderer, this.combinedScene);
    } else {
      this._renderWithLight(renderer, this._scenes.mrt);
    }

    this.debugNormalCopyPass?.render(renderer, null, null);

    const finalTarget = this.renderToScreen ? null : inputBuffer;

    if (this.debugNormalCopyPass) {
      this.copyPass.setTexture(this.debugNormalCopyPass.texture);
    }
    this.copyPass.render(renderer, finalTarget, null);

    this._renderWithLight(renderer, this._scenes.opaque);

    // Copy all depth (globe + MRT + opaque) to the all depth buffer.
    // The renderTarget's depth texture now contains all rendered depth.
    this.allDepthCopyPass.setDepthTexture(finalTarget?.depthTexture ?? null);
    this.allDepthCopyPass.copyDepth(clearDepth);
    this.allDepthCopyPass.render(renderer, null, null);
  }

  // The composer-provided depth texture is intentionally ignored: the gbuffer
  // owns its depth texture and depth is copied into the input buffer by the
  // copy pass. `needsDepthTexture` stays true so the composer still attaches a
  // depth texture to the input buffer, which `allDepthCopyPass` reads after
  // the opaque scene has been rendered.
  setDepthTexture(): void {}

  setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.gbufferRenderTarget.setSize(width, height);
    this.globeDepthCopyPass.setSize(width, height);
    this.allDepthCopyPass.setSize(width, height);
    if (this.globeNormalActive) {
      this.globeNormalCopyPass.setSize(width, height);
    }
    this.debugNormalCopyPass?.setSize(width, height);
  }

  /**
   * Grows the globe-normal copy target only while something consumes it, and
   * shrinks it back to 1x1 otherwise — at full resolution it is a screen-sized
   * RGBA16F target, the same cost again as the G-buffer's normal attachment.
   */
  private setGlobeNormalActive(active: boolean): void {
    if (this.globeNormalActive === active) return;
    this.globeNormalActive = active;
    this.globeNormalCopyPass.setSize(
      active ? this.width : 1,
      active ? this.height : 1,
    );
  }

  // Drape a feature on the terrain by stencil test.
  // Refs
  // - https://www.isprs.org/proceedings/XXXVII/congress/2_pdf/5_WG-II-5/06.pdf
  // - http://wscg.zcu.cz/WSCG2007/Papers_2007/journal/B17-full.pdf
  protected _renderDrapedMesh(renderer: WebGLRenderer) {
    const drapedScene = this._scenes.draped;
    const children = [...drapedScene.children];

    for (const child of children) {
      if (!(child instanceof DrapedMesh) || !child.enabled()) continue;

      drapedScene.remove(child);
      this.drapedTempScene.add(child);

      child.process(() =>
        this._renderWithLight(renderer, this.drapedTempScene),
      );

      this.drapedTempScene.remove(child);
      drapedScene.add(child);
    }
  }
}
