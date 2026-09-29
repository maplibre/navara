import { EventHandler } from "@navaramap/core";
import type { Core } from "@navaramap/engine";
import type { ConcurrencyManager } from "@navaramap/worker";
import type { Pass as PostProcessingPass } from "postprocessing";
import type { Material, Object3D, Texture, WebGLRenderer } from "three";
import invariant from "tiny-invariant";

import type { LayersManager } from "../layersManager";
import { type ResolvedGBufferOptions } from "../material/gbufferLayout";
import type { PickableMesh } from "../mesh/pickableMesh";
import type { RenderPassOrchestrator } from "../orchestrators";
import type { CustomRenderPass } from "../passes";
import type { Scenes } from "../scene";
import type { MeshCache } from "../type";

import type { EffectHandle, LightHandle, MeshHandle } from "./BaseHandle";
import type { EffectDesc } from "./EffectDesc";
import type { LightDesc } from "./LightDesc";
import type { MeshDesc } from "./MeshDesc";
import type { Registries } from "./Registries";
import { SelectiveEffectRegistry } from "./SelectiveEffectRegistry";

type ViewContextEvents = {
  /**
   * Emitted when a material is registered for CSM shadow rendering.
   * @experimental This event may change or be removed in future versions.
   */
  shadowApplied: (material: Material) => void;
  /**
   * Emitted when a material is unregistered from CSM shadow rendering.
   * @experimental This event may change or be removed in future versions.
   */
  shadowRemoved: (material: Material) => void;
  /**
   * Emitted when effect slot assignments change in SelectiveEffectRegistry.
   * Listeners should recompute effectIdsMask to stay in sync.
   */
  effectSlotsChanged: () => void;
  /**
   * Emitted when the derived G-buffer configuration changes. Meshes re-evaluate
   * their pass placement: outside the MRT pass they would leave the G-buffer
   * holding whatever lies behind them.
   */
  gbufferChanged: () => void;
  /**
   * Emitted when a mesh moves between render scenes. The view re-derives the
   * buffer configuration from it: draped meshes need the globe normal but,
   * not being effects, cannot declare `requiredBuffers` themselves.
   */
  meshPassKeyChanged: () => void;
  /**
   * Emitted by an effect descriptor whose `getRequiredBuffers()` result
   * changed after creation. The view re-derives the G-buffer configuration.
   */
  gbufferRequirementsChanged: () => void;
};

/**
 * ViewContext is the shared context object passed to every custom descriptor and plugin.
 *
 * The public properties and methods defined here form the **public API surface**
 * exposed to user-authored descriptors and plugins. Any addition, removal, or
 * signature change to a public member is a **breaking change** for consumers.
 *
 * When extending this class, keep the public surface minimal and intentional:
 * - Prefer methods over exposing internal objects directly — this allows the
 *   implementation to change without breaking downstream code.
 * - Mark internal dependencies as `private` so they are not accessible from
 *   descriptor/plugin code.
 */
export class ViewContext extends EventHandler<ViewContextEvents> {
  private _selectiveEffectRegistry: SelectiveEffectRegistry;
  private _renderPass?: CustomRenderPass;
  private _registries?: Registries;

  constructor(
    /** Scene containers for different rendering passes. */
    private _scenes: Scenes,
    private layersManager: LayersManager,
    private renderPassOrchestrator: RenderPassOrchestrator,
    /** Manager for scheduling work on Web Workers. */
    private _concurrencyManager: ConcurrencyManager,
    private _core: Core,
    private _meshes: MeshCache,
  ) {
    super();

    this._selectiveEffectRegistry = new SelectiveEffectRegistry(() =>
      this.emit("effectSlotsChanged"),
    );
  }

  /** Scene containers for different rendering passes. */
  get scenes(): Scenes {
    return this._scenes;
  }

  /** Manager for scheduling work on Web Workers. */
  get concurrencyManager(): ConcurrencyManager {
    return this._concurrencyManager;
  }

  get selectiveEffectRegistry(): SelectiveEffectRegistry {
    return this._selectiveEffectRegistry;
  }

  // --- Pass management ---

  /** Get a post-processing pass by name. */
  getPass(name: string): PostProcessingPass | undefined {
    return this.renderPassOrchestrator.getPass(name);
  }

  /** Add a post-processing pass to the end of the pipeline. */
  addPass(name: string, pass: PostProcessingPass): void {
    this.renderPassOrchestrator.addPass(name, pass);
  }

  /** Insert a post-processing pass before the pass identified by `targetName`. */
  insertPassBefore(
    targetName: string,
    name: string,
    pass: PostProcessingPass,
  ): void {
    this.renderPassOrchestrator.insertPassBefore(targetName, name, pass);
  }

  /** Insert a post-processing pass after the pass identified by `targetName`. */
  insertPassAfter(
    targetName: string,
    name: string,
    pass: PostProcessingPass,
  ): void {
    this.renderPassOrchestrator.insertPassAfter(targetName, name, pass);
  }

  /** Remove a post-processing pass by name. */
  removePass(name: string): void {
    this.renderPassOrchestrator.removePass(name);
  }

  // --- Renderer/buffer access ---

  /** Get the underlying WebGLRenderer instance. */
  getRenderer(): WebGLRenderer {
    return this.renderPassOrchestrator.effectComposer.getRenderer();
  }

  /** Get the input buffer from the effect composer. */
  getInputBuffer() {
    return this.renderPassOrchestrator.effectComposer.inputBuffer;
  }

  /** @internal */
  _setRenderPass(renderPass: CustomRenderPass) {
    this._renderPass = renderPass;
  }

  /** @internal */
  _setRegistries(registries: Registries) {
    this._registries = registries;
  }

  /**
   * @internal
   * No-op until the pass exists — it reads the view's configuration at
   * creation time.
   */
  _setGBufferOptions(buffers: ResolvedGBufferOptions): void {
    this._renderPass?.setBuffers(buffers);
    this.emit("gbufferChanged");
  }

  /** @internal No-op until the pass exists (see {@link _setGBufferOptions}). */
  _setLit(lit: boolean): void {
    this._renderPass?.setLit(lit);
  }

  /**
   * Gets the globe depth texture for post-processing effects.
   */
  getGlobeDepthTexture() {
    invariant(this._renderPass, "CustomRenderPass isn't initialized yet.");
    return this._renderPass.globeDepthCopyPass.texture;
  }

  /**
   * Gets the globe normal texture for post-processing effects.
   */
  getGlobeNormalTexture() {
    invariant(this._renderPass, "CustomRenderPass isn't initialized yet.");
    return this._renderPass.globeNormalCopyPass.texture;
  }

  /**
   * Gets the main render target which includes G-buffer.
   */
  getRenderTarget() {
    invariant(this._renderPass, "CustomRenderPass isn't initialized yet.");
    return this._renderPass.gbufferRenderTarget;
  }

  /**
   * Gets the scene normal texture from the G-buffer.
   */
  getNormalTexture() {
    invariant(this._renderPass, "CustomRenderPass isn't initialized yet.");
    const index = this._renderPass.textureIndex.normal;
    return index === undefined
      ? undefined
      : this._renderPass.gbufferRenderTarget.textures[index];
  }

  /**
   * Gets the effect IDs texture from the G-buffer.
   * `undefined` when the view disabled `buffers.selectiveEffect`.
   */
  getEffectIdsTexture(): Texture | undefined {
    invariant(this._renderPass, "CustomRenderPass isn't initialized yet.");
    const index = this._renderPass.textureIndex.effectIds;
    return index === undefined
      ? undefined
      : this._renderPass.gbufferRenderTarget.textures[index];
  }

  /**
   * Gets the emissive texture from the G-buffer.
   * `undefined` when the view disabled `buffers.emissive`.
   */
  getEmissiveTexture(): Texture | undefined {
    invariant(this._renderPass, "CustomRenderPass isn't initialized yet.");
    const index = this._renderPass.textureIndex.emissive;
    return index === undefined
      ? undefined
      : this._renderPass.gbufferRenderTarget.textures[index];
  }

  /**
   * Gets the shadow texture (R=shadow amount, 0=lit..1=fully shadowed) from
   * the G-buffer. `undefined` unless an active effect requires the `shadow`
   * buffer.
   */
  getShadowTexture(): Texture | undefined {
    invariant(this._renderPass, "CustomRenderPass isn't initialized yet.");
    const index = this._renderPass.textureIndex.shadow;
    return index === undefined
      ? undefined
      : this._renderPass.gbufferRenderTarget.textures[index];
  }

  // --- Descriptor query ---

  /** @internal Iterate over all registered effect descriptors. */
  _getEffects(): Generator<EffectHandle> {
    return this.layersManager.getEffectDescs();
  }

  /** @internal Iterate over all registered light descriptors. */
  _getLights(): Generator<LightHandle> {
    return this.layersManager.getLightDescs();
  }

  /** @internal Iterate over all registered mesh descriptors. */
  _getMeshes(): Generator<MeshHandle> {
    return this.layersManager.getMeshDescs();
  }

  /**
   * Finds an active effect descriptor by its `key` (e.g. `"mrt"`,
   * `"selectiveBloom"`). Returns the first match, or `undefined`.
   */
  findEffect<T extends EffectDesc = EffectDesc>(key: string): T | undefined {
    for (const handle of this._getEffects()) {
      if (handle.ref.getKey() === key) return handle.ref as T;
    }
    return undefined;
  }

  /**
   * Finds the first active light descriptor registered under `key` (e.g.
   * `"sun"`), for inheriting the scene's lighting in a custom effect.
   */
  findLight<T extends LightDesc = LightDesc>(key: string): T | undefined {
    const LightClass = this._registries?.light.getConstructor(key);
    if (!LightClass) return undefined;
    for (const handle of this._getLights()) {
      if (handle.ref instanceof LightClass) return handle.ref as T;
    }
    return undefined;
  }

  /**
   * Finds an active mesh descriptor by its registered key (e.g. `"box"`,
   * `"gltfModel"`). Returns the first match, or `undefined`.
   */
  findMesh<T extends MeshDesc = MeshDesc>(key: string): T | undefined {
    const MeshClass = this._registries?.mesh.getConstructor(key);
    if (!MeshClass) return undefined;
    for (const handle of this._getMeshes()) {
      if (handle.ref instanceof MeshClass) return handle.ref as T;
    }
    return undefined;
  }

  /**
   * Register a material for CSM shadow rendering.
   * @experimental This API may change or be removed in future versions.
   */
  applyShadowMaterial(material: Material): void {
    this.emit("shadowApplied", material);
  }

  /**
   * Unregister a material from CSM shadow rendering.
   * @experimental This API may change or be removed in future versions.
   */
  removeShadowMaterial(material: Material): void {
    this.emit("shadowRemoved", material);
  }

  // --- Picking registration ---

  /**
   * Generate a new unique global batch ID for picking.
   * The returned ID is in the 24-bit RGB color range (1..0xffffff).
   */
  genGlobalBatchId(): number | undefined {
    return this._core?.genGlobalBatchId();
  }

  /**
   * Register a pickable mesh so the picking system can discover it.
   * @param key - Unique key (typically the descriptor ID).
   * @param mesh - Any {@link PickableMesh} implementation. Implementers
   *   must also be an `Object3D` so the pick pass can re-parent the
   *   renderable into its dedicated scene.
   */
  registerPickableMesh(key: string, mesh: PickableMesh & Object3D): void {
    this._meshes?.set(key, mesh);
  }

  /**
   * Unregister a pickable mesh from the picking system.
   * @param key - The key used during registration.
   */
  unregisterPickableMesh(key: string): void {
    this._meshes?.delete(key);
  }
}
