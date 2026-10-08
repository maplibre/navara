import type ThreeView from "@navaramap/three";
import {
  Color,
  assertNoTransformConflict,
  MeshDesc,
  mergeGeodetic,
  PickableMeshWrapper,
  type MeshConfig,
  type MeshUpdate,
  type PassKey,
  type ViewContext,
  createShadowMapDepthEnhancer,
  type ShadowMapDepthSupportedMaterial,
  setupRTEBeforeRender,
  type RTEUserData,
  createReplacer,
  encodePositionRTE,
  composeWorldMatrixForRTE,
  RTE_ONE_UNIFORM,
  createGltfLoader,
} from "@navaramap/three";
import ProjectVertexRteModel from "@shaders/glsl/chunks/project_vertex_rte_model.glsl";
import RteUniformParsVertex from "@shaders/glsl/chunks/rte_uniform_pars_vertex.glsl";
import {
  Group,
  Mesh,
  AnimationMixer,
  AnimationAction,
  AnimationClip,
  LoopRepeat,
  LoopOnce,
  Material,
  Matrix4,
  Quaternion,
  Vector3,
  BufferGeometry,
  type NormalBufferAttributes,
  RGBADepthPacking,
  ShaderChunk,
} from "three";
import type {
  GLTF,
  GLTFLoader,
} from "three/examples/jsm/loaders/GLTFLoader.js";

type Description = {
  gltfModel?: {
    url?: string;
    castShadow?: boolean;
    receiveShadow?: boolean;

    // Declarative animation settings
    animationEnabled?: boolean;
    animationClips?: string[];
    animationActiveClip?: string;
    animationSpeed?: number; // default: 1.0
    animationLoop?: boolean; // default: true
    animationCrossfadeDuration?: number; // default: 0.3
    animationAutoPlay?: boolean; // default: false

    // MRT emissive uniforms — drive additive glow on top of the model's
    // own material emissive (e.g. for picking highlight).
    emissiveColor?: Color;
    emissiveIntensity?: number;
  };
};

export const DEFAULT_GLTF_MODEL_DESCRIPTION: NonNullable<
  Description["gltfModel"]
> = {
  url: "",
  animationSpeed: 1,
  animationLoop: true,
  animationCrossfadeDuration: 0.3,
};

export type GLTFModelConfig = MeshConfig & Description & { pickable?: boolean };

export type GLTFModelUpdate = MeshUpdate & Description;

// Type definition for animation details
export type AnimationDetails = {
  name: string;
  duration: number;
  tracks: number;
  isLooping: boolean;
  timeScale: number;
};

// Type definition for current playback state
export type AnimationState = {
  isPlaying: boolean;
  currentAnimation: string | null;
  isBlendMode: boolean;
  blendAnimations: {
    name: string;
    weight: number;
    isPlaying: boolean;
  }[];
  playbackTime: number;
  progress: number; // 0-1
};

export type GLTFModelEvent = {
  load: () => void;
  error: (error: unknown) => void;
  animationReady: () => void;
  needsUpdate: () => void;
};

export class GLTFModelDesc extends MeshDesc<
  GLTFModelConfig,
  GLTFModelUpdate,
  Group,
  GLTFModelEvent
> {
  private config: GLTFModelConfig;
  private loader: GLTFLoader;

  // Animation related fields
  private gltf: GLTF | null = null;
  private mixer: AnimationMixer | null = null;
  private clips = new Map<string, AnimationClip>();
  private actions = new Map<string, AnimationAction>();
  private currentAction: AnimationAction | null = null;
  private animationSpeed = 1.0;
  private isLooping = true;

  // Multiple animation management
  private activeBlendAnimations = new Map<
    string,
    {
      action: AnimationAction;
      weight: number;
      targetWeight: number;
    }
  >();
  private isBlendMode = false;

  // RTE (Relative-To-Eye) state
  private originalWorldPosition: Vector3 = new Vector3();
  private modelPositionHigh: Vector3 = new Vector3();
  private modelPositionLow: Vector3 = new Vector3();

  // Shared RTE uniforms for all materials in this model
  private rteUserData: RTEUserData = {
    modelViewMatrixRTE: { value: new Matrix4() },
    cameraPositionHigh: { value: new Vector3() },
    cameraPositionLow: { value: new Vector3() },
  };

  private pickWrapper?: PickableMeshWrapper;

  /** The batch ID assigned to this model when picking is enabled (after load). */
  get batchId(): number | undefined {
    return this.pickWrapper?.batchId;
  }

  constructor(view: ThreeView, ctx: ViewContext, config: GLTFModelConfig) {
    super(view, ctx, config);
    this.config = {
      ...config,
      gltfModel: {
        ...DEFAULT_GLTF_MODEL_DESCRIPTION,
        ...config.gltfModel,
      },
    };
    this.loader = createGltfLoader();
  }

  /**
   * Render into the MRT G-buffer rather than the plain opaque pass, so the
   * model contributes its normal/depth to deferred lighting (aerial
   * perspective, irradiance). The opaque pass writes only color into a
   * single-attachment target, which would leave the model wearing the
   * terrain's G-buffer normal. (Matches the descriptor's pre-revert default.)
   */
  protected override getPassKey(): PassKey {
    return "mrt";
  }

  override onCreate() {
    this._instance = this.createMesh();

    if (this.matrixWorld || this.matrix || this.geodetic) {
      // `geodetic` resolves to a world frame the same way `matrixWorld`
      // does (see `resolveGeodeticFrame`), so it shares the RTE
      // decomposition below. Terrain height (`heightReference: "terrain"`)
      // must be sampled before that resolution.
      this.subscribeTerrainHeight();
      // Decompose effective transform into RTE position + rotation/scale matrix
      this.applyRTETransform();
    } else {
      // RTE-only mode: keep raw.position at (0,0,0)
      // The world position is stored in this.position and encoded in RTE uniforms
      if (this.scale) {
        this.raw?.scale.copy(this.scale);
      }

      if (this.rotation) {
        this.raw?.rotation.set(
          this.rotation.x,
          this.rotation.y,
          this.rotation.z,
        );
      }
    }

    this._instance.visible = this.visible;

    this.onPassKeyChange();
  }

  createMesh(): Group {
    const modelConfig = this.config.gltfModel;

    // Create a placeholder group that will be populated async
    const group = new Group();

    if (modelConfig?.url) {
      this.loadModel(modelConfig.url, group)
        .then(() => {
          // Initialize animations if conditions are met
          if (this.shouldInitializeAnimation()) {
            this.initAnimation();
          }
        })
        .catch((error) => {
          console.error("Failed to initialize GLTF model layer:", error);
        });
    }

    return group;
  }

  private async loadModel(url: string, targetGroup: Group): Promise<void> {
    try {
      const gltf = await this.loader.loadAsync(url);

      this.gltf = gltf;

      // Clear any existing children
      while (targetGroup.children.length > 0) {
        targetGroup.remove(targetGroup.children[0]);
      }

      targetGroup.add(gltf.scene);
      this.setupModel(targetGroup);

      if (this.config.pickable) {
        if (!this.pickWrapper) {
          this.pickWrapper = new PickableMeshWrapper(targetGroup, this.ctx);
          this.ctx.registerPickableMesh(this.id, this.pickWrapper);
        } else {
          // Model was reloaded — inject picking into the newly loaded
          // meshes' materials (preserves existing batchId)
          this.pickWrapper.syncMaterials();
        }
      }

      this.emit("needsUpdate");
      this.emit("load");
    } catch (error) {
      console.warn("Failed to load GLTF model:", error);
      this.emit("error", error);
    }
  }

  private setupModel(model: Group): void {
    const modelConfig = this.config.gltfModel;

    if (!modelConfig) return;

    // When matrixWorld/matrix/geodetic is set, applyRTETransform() already
    // encoded the world position. Only encode from this.position when there
    // is no base frame matrix.
    if (!this.matrixWorld && !this.matrix && !this.geodetic && this.position) {
      this.setPositionRTE(
        new Vector3(this.position.x, this.position.y, this.position.z),
      );
    }

    const IDENTITY_MATRIX = new Matrix4();

    // Setup shadows and CSM
    model.traverse((child) => {
      if (child instanceof Mesh) {
        if (modelConfig.castShadow) child.castShadow = true;
        if (modelConfig.receiveShadow) child.receiveShadow = true;

        child.frustumCulled = false;
        this.setupRTEShadersForMesh(child);

        this.initDepthMaterial(child);

        // Refresh the shared RTE uniforms on every child draw. With the
        // callback on a single host mesh, children sorted earlier in the
        // render list would be drawn with the previous frame's camera and
        // visibly lag behind during camera movement.
        const rteCallback = setupRTEBeforeRender(
          child,
          this.rteUserData,
          IDENTITY_MATRIX,
        );
        if (rteCallback) {
          child.onBeforeRender = rteCallback;
          child.onBeforeShadow = rteCallback;
        }

        // Setup CSM for materials if shadows are enabled
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => {
            this.ctx.applyShadowMaterial(mat);
          });
        } else {
          this.ctx.applyShadowMaterial(child.material);
        }
      }
    });

    this.applyEmissive(model);
  }

  /**
   * Drive emissive glow on the loaded model's child materials from the
   * declarative `emissiveColor` / `emissiveIntensity` config. Standard GLTF
   * materials expose an `emissive` color that feeds the emissive MRT slot, so
   * tinting them here matches the behavior of the non-GLTF meshes.
   */
  private applyEmissive(root: Group): void {
    const modelConfig = this.config.gltfModel;
    if (
      modelConfig?.emissiveColor === undefined &&
      modelConfig?.emissiveIntensity === undefined
    ) {
      return;
    }
    root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const m = child.material as Material | Material[];
      const mats = Array.isArray(m) ? m : [m];
      for (const mat of mats) {
        const target = mat as Material & {
          emissive?: { set: (value: unknown) => void };
          emissiveIntensity?: number;
        };
        if (!target.emissive) continue;
        if (modelConfig.emissiveColor !== undefined) {
          target.emissive.set(modelConfig.emissiveColor.raw);
        }
        if (modelConfig.emissiveIntensity !== undefined) {
          target.emissiveIntensity = modelConfig.emissiveIntensity;
        }
      }
    });
  }

  /**
   * Override a material that is used to generate a shadow map.
   * Uses the shadowMapDepthEnhancer to inject shadow map depth shaders.
   */
  private initDepthMaterial(
    mesh: Mesh<BufferGeometry<NormalBufferAttributes>>,
  ) {
    const origMaterial = Array.isArray(mesh.material)
      ? mesh.material[0]
      : mesh.material;
    mesh.customDepthMaterial = origMaterial.clone();
    mesh.customDepthMaterial.needsUpdate = true;

    // Create enhancer for depth material
    const enhancer = createShadowMapDepthEnhancer(
      mesh.customDepthMaterial as ShadowMapDepthSupportedMaterial,
    );

    // Mount the enhancer with RTE uniforms
    enhancer.mount({});

    // Set up custom program cache key
    mesh.customDepthMaterial.customProgramCacheKey = () =>
      enhancer.programCacheKey();

    // Set up onBeforeCompile using the enhancer's transformShader
    mesh.customDepthMaterial.onBeforeCompile = (shader, renderer) => {
      // The original material's state is shared through `origMaterial`.
      origMaterial.onBeforeCompile(shader, renderer);

      enhancer.transformShader(shader);

      shader.defines ??= {};
      Object.assign(shader.defines, origMaterial.userData?.defines || {});
      shader.defines["USE_SHADOWMAP_DEPTH"] = 1;
      shader.defines["DEPTH_PACKING"] = RGBADepthPacking;
    };
  }

  private setPositionRTE(worldPosition: Vector3): void {
    // Store the original world position
    this.originalWorldPosition.set(
      worldPosition.x,
      worldPosition.y,
      worldPosition.z,
    );

    // Encode the world position as high/low components
    encodePositionRTE(
      worldPosition,
      this.modelPositionHigh,
      this.modelPositionLow,
    );
  }

  /**
   * Decomposes the effective world transform (matrixWorld * T*R*S) into:
   * - Translation → encoded as RTE position uniforms
   * - Rotation/Scale → set on raw.matrixWorld for the shader's modelMatrix uniform
   *
   * This allows matrixWorld (e.g. NUE-to-ECEF frame) to work correctly with RTE
   * by keeping the high-precision position in uniforms while the shader's modelMatrix
   * only contains rotation and scale.
   */
  private applyRTETransform(): void {
    if (!this.raw) return;

    // Split the effective placement into an RTE translation (encoded in
    // uniforms) plus a rotation/scale matrix (the shader's modelMatrix), so a
    // far-from-origin position survives f32 precision.
    let position: Vector3;
    let rotationScale: Matrix4;
    if (this.geodetic) {
      // `geodetic`, `matrixWorld` and `matrix` share one placement slot and
      // at most one is ever set (`assertNoTransformConflict`, see
      // `ConflictingTransformError`), so this chain never shadows a
      // configured field. `geodetic` gets the same RTE split as
      // `matrixWorld`: resolve it to a world frame first.
      ({ position, rotationScale } = composeWorldMatrixForRTE(
        this.resolveGeodeticFrame(this.geodetic),
        this.composeLocalTransform(),
      ));
    } else if (this.matrixWorld) {
      // Frame * local: matrixWorld carries the ECEF placement.
      ({ position, rotationScale } = composeWorldMatrixForRTE(
        this.matrixWorld,
        this.composeLocalTransform(),
      ));
    } else if (this.matrix) {
      // Full local placement supplied as a matrix — `composeLocalTransform()`
      // ignores `matrix`, so decompose it directly (mirrors the instanced desc).
      const p = new Vector3();
      const q = new Quaternion();
      const s = new Vector3();
      this.matrix.decompose(p, q, s);
      position = p;
      rotationScale = new Matrix4().compose(new Vector3(0, 0, 0), q, s);
    } else {
      // No base frame matrix; local TRS / position are handled elsewhere.
      return;
    }

    this.setPositionRTE(position);

    this.raw.matrixAutoUpdate = false;
    this.raw.matrixWorldAutoUpdate = false;
    this.raw.matrixWorld.copy(rotationScale);
    this.raw.updateMatrixWorld();
  }

  /**
   * A terrain-height observation (under `geodetic` + `heightReference:
   * "terrain"`) must redo the RTE split, not the base class's direct
   * `matrixWorld` write — the encoded RTE position uniforms would otherwise
   * go stale while `matrixWorld` moved out from under them.
   */
  protected override reapplyGeodeticFrame(): void {
    this.applyRTETransform();
  }

  private setupRTEShadersForMesh(mesh: Mesh): void {
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    // Setup shader modifications BEFORE triggering recompilation
    this.modifyMaterialForRTE(materials);
  }

  private modifyMaterialForRTE(materials: Material[]): void {
    materials.forEach((material) => {
      // A material shared by multiple child meshes must be patched only once;
      // a second wrapper would re-run the replacements on the already-patched
      // shader and throw.
      if (material.userData.nvrRteApplied) return;
      material.userData.nvrRteApplied = true;

      // Store original onBeforeCompile if it exists
      const originalOnBeforeCompile = material.onBeforeCompile;

      material.onBeforeCompile = (shader, renderer) => {
        // Call original onBeforeCompile if it existed
        if (originalOnBeforeCompile) {
          originalOnBeforeCompile.call(material, shader, renderer);
        }

        // Add RTE uniforms to shader
        shader.uniforms.u_cameraPositionHigh = this.rteUserData
          .cameraPositionHigh || { value: new Vector3() };
        shader.uniforms.u_cameraPositionLow = this.rteUserData
          .cameraPositionLow || { value: new Vector3() };
        shader.uniforms.rtePosHigh = { value: this.modelPositionHigh };
        shader.uniforms.rtePosLow = { value: this.modelPositionLow };
        shader.uniforms.modelViewMatrixRTE = this.rteUserData
          .modelViewMatrixRTE || { value: new Matrix4() };
        shader.uniforms.u_rteOne = RTE_ONE_UNIFORM;

        // Modify vertex shader with RTE chunks
        shader.vertexShader = createReplacer(shader.vertexShader)
          .replace(
            "#include <common>",
            `
            #include <common>
            ${RteUniformParsVertex}
            `,
          )
          .replace("#include <project_vertex>", ProjectVertexRteModel)
          .replace(
            "#include <worldpos_vertex>",
            createReplacer(ShaderChunk.worldpos_vertex)
              // Use RTE absolute position.
              .replace(
                "vec4 worldPosition = vec4( transformed, 1.0 );",
                "vec4 worldPosition = vec4( absTransformed, 1.0 );",
              )
              // RTE absolute position don't need modelMatrix multiplication.
              .replace("worldPosition = modelMatrix * worldPosition;", "")
              .source,
          ).source;
      };
    });
  }

  onUpdateConfig(updates: GLTFModelUpdate): void {
    if (updates.gltfModel && this._instance) {
      const modelConfig = updates.gltfModel;

      // Update shadows
      if (
        modelConfig.castShadow !== undefined ||
        modelConfig.receiveShadow !== undefined
      ) {
        this._instance.traverse((child) => {
          if (child instanceof Mesh) {
            if (modelConfig.castShadow !== undefined)
              child.castShadow = modelConfig.castShadow;
            if (modelConfig.receiveShadow !== undefined)
              child.receiveShadow = modelConfig.receiveShadow;
          }
        });
      }

      // Update emissive tint
      if (
        modelConfig.emissiveColor !== undefined ||
        modelConfig.emissiveIntensity !== undefined
      ) {
        if (this.config.gltfModel) {
          if (modelConfig.emissiveColor !== undefined)
            this.config.gltfModel.emissiveColor = modelConfig.emissiveColor;
          if (modelConfig.emissiveIntensity !== undefined)
            this.config.gltfModel.emissiveIntensity =
              modelConfig.emissiveIntensity;
        }
        this.applyEmissive(this._instance);
      }

      // Dynamic animation settings update
      if (this.mixer && this.actions.size > 0) {
        // Speed change
        if (modelConfig.animationSpeed !== undefined) {
          this.setAnimationSpeed(modelConfig.animationSpeed);
        }

        // Loop setting change
        if (modelConfig.animationLoop !== undefined) {
          this.setAnimationLoop(modelConfig.animationLoop);
        }

        // Animation switching
        if (modelConfig.animationActiveClip !== undefined) {
          const duration = modelConfig.animationCrossfadeDuration ?? 0.3;
          if (this.currentAction) {
            this.crossFadeAnimation(
              this.getCurrentAnimationName() ?? "",
              modelConfig.animationActiveClip,
              duration,
            );
          } else {
            this.playAnimation(modelConfig.animationActiveClip);
          }
        }

        // Animation enabled state change
        if (modelConfig.animationEnabled !== undefined) {
          if (modelConfig.animationEnabled) {
            this.resumeAnimation();
          } else {
            this.pauseAnimation();
          }
        }
      }

      // If URL changes, reload the model
      if (modelConfig.url && modelConfig.url !== this.config.gltfModel?.url) {
        this.loadModel(modelConfig.url, this._instance);
        if (this.config.gltfModel) {
          this.config.gltfModel.url = modelConfig.url;
        }
      }

      this.emit("needsUpdate");
    }

    // Handle spatial updates for RTE mode
    const hasSpatialChange =
      updates.matrixWorld !== undefined ||
      updates.matrix !== undefined ||
      updates.geodetic !== undefined ||
      updates.position !== undefined ||
      updates.scale !== undefined ||
      updates.rotation !== undefined;

    if (
      hasSpatialChange &&
      (this.matrixWorld ||
        updates.matrixWorld ||
        this.matrix ||
        updates.matrix ||
        this.geodetic ||
        updates.geodetic)
    ) {
      // Validate the prospective state up front, exactly as MeshDesc does: a
      // throw must not leave a partially-applied update behind. Hand-rolled
      // per-field checks also get `ConflictingTransformError`'s argument
      // order wrong — it reads `(geodeticField, matrixField)` and its
      // message says "use the first for geographic placement", so inverting
      // them prints advice that is backwards.
      const nextGeodetic =
        updates.geodetic !== undefined
          ? mergeGeodetic(this.geodetic, updates.geodetic)
          : this.geodetic;
      const nextMatrix =
        updates.matrix !== undefined ? updates.matrix : this.matrix;
      const nextMatrixWorld =
        updates.matrixWorld !== undefined
          ? updates.matrixWorld
          : this.matrixWorld;
      assertNoTransformConflict(nextGeodetic, nextMatrix, nextMatrixWorld);

      // matrixWorld / matrix / geodetic path: recompute the full RTE decomposition
      if (updates.geodetic !== undefined) {
        const prevGeodetic = this.geodetic;
        this.geodetic = nextGeodetic;

        // Only these three change what's sampled; heading/pitch/roll/scale
        // leave the sampled position and the reference untouched (mirrors
        // the base class's own resubscribe condition).
        const resubscribe =
          nextGeodetic?.lng !== prevGeodetic?.lng ||
          nextGeodetic?.lat !== prevGeodetic?.lat ||
          nextGeodetic?.heightReference !== prevGeodetic?.heightReference;
        if (resubscribe) this.subscribeTerrainHeight();
      }
      if (updates.matrixWorld !== undefined) {
        this.matrixWorld = updates.matrixWorld;
      }
      if (updates.matrix !== undefined) this.matrix = updates.matrix;
      if (updates.position !== undefined) this.position = updates.position;
      if (updates.scale !== undefined) this.scale = updates.scale;
      if (updates.rotation !== undefined) this.rotation = updates.rotation;

      this.applyRTETransform();

      // Strip spatial properties so super doesn't also apply them
      const {
        position,
        matrixWorld,
        matrix,
        geodetic,
        scale,
        rotation,
        ...restUpdates
      } = updates;
      super.onUpdateConfig(restUpdates as GLTFModelUpdate);
    } else if (updates.position !== undefined) {
      // RTE-only path (no frame matrix)
      this.position = updates.position;
      this.setPositionRTE(
        new Vector3(updates.position.x, updates.position.y, updates.position.z),
      );
      const { position, ...restUpdates } = updates;
      super.onUpdateConfig(restUpdates);
    } else {
      super.onUpdateConfig(updates);
    }
  }

  override onDestroy(): void {
    if (this.pickWrapper) {
      this.ctx.unregisterPickableMesh(this.id);
      this.pickWrapper = undefined;
    }
    super.onDestroy();
  }

  protected disposeMesh(): void {
    // Clean up animation-related resources
    this.disposeAnimation();

    if (this._instance) {
      this._instance.traverse((child) => {
        if (child instanceof Mesh) {
          this.ctx.removeShadowMaterial(child.material);

          child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
          // Dispose custom depth material
          if (child.customDepthMaterial) {
            child.customDepthMaterial.dispose();
          }
        }
      });
      this._instance = undefined;
    }
  }

  /**
   * Dispose animation-related resources
   */
  private disposeAnimationResources(): void {
    // Stop current animation
    if (this.currentAction) {
      this.currentAction.stop();
      this.currentAction = null;
    }

    // Clear animation actions
    this.actions.clear();

    // Clear animation clips
    this.clips.clear();

    // Dispose mixer
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }

    // Clear GLTF data
    this.gltf = null;
  }

  private shouldInitializeAnimation(): boolean {
    // Initialize only when GLTF data exists and has animation clips
    return (
      this.gltf !== null &&
      this.gltf.animations &&
      this.gltf.animations.length > 0
    );
  }

  private initAnimation(): void {
    if (
      !this.gltf ||
      !this.gltf.animations ||
      this.gltf.animations.length === 0
    ) {
      console.warn("No animations found in GLTF model");
      return;
    }

    const animConfig = this.config.gltfModel;

    // Create AnimationMixer
    this.mixer = new AnimationMixer(this.gltf.scene);

    // Apply configuration values
    const speed = animConfig?.animationSpeed ?? this.animationSpeed;
    const loop = animConfig?.animationLoop ?? this.isLooping;

    // Register animation clips
    this.gltf.animations.forEach((clip) => {
      this.clips.set(clip.name, clip);
      if (this.mixer) {
        const action = this.mixer.clipAction(clip);
        this.actions.set(clip.name, action);

        // Apply configuration values (align with three.js example semantics)
        action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
        action.setEffectiveTimeScale(speed);
        action.setEffectiveWeight(0);
        action.enabled = true;
      }
    });

    // Reflect configuration values to internal state
    this.animationSpeed = speed;
    this.isLooping = loop;

    // Handle auto-play settings
    if (animConfig?.animationAutoPlay && animConfig?.animationActiveClip) {
      const clipName = animConfig.animationActiveClip;
      if (this.clips.has(clipName)) {
        this.playAnimation(clipName);

        // Set enabled state
        if (animConfig.animationEnabled === false) {
          this.pauseAnimation();
        }
      } else {
        console.warn(`Specified animation "${clipName}" not found in model`);
      }
    }

    // Notify animation initialization completion
    this.emit("animationReady");
  }

  // ========================================
  // Getter APIs (get prefix)
  // ========================================

  /**
   * Get available animation clip names
   */
  getAnimationAvailable(): string[] {
    return Array.from(this.clips.keys());
  }

  /**
   * Get animation details information
   */
  getAnimationDetails(name?: string): AnimationDetails | AnimationDetails[] {
    if (name) {
      // Get details for specific animation
      const clip = this.clips.get(name);
      const action = this.actions.get(name);
      if (!clip || !action) {
        throw new Error(`Animation "${name}" not found`);
      }

      return {
        name: clip.name,
        duration: clip.duration,
        tracks: clip.tracks.length,
        isLooping: action.loop === LoopRepeat,
        timeScale: action.timeScale,
      };
    } else {
      // Get details for all animations
      return Array.from(this.clips.entries()).map(([name, clip]) => {
        const action = this.actions.get(name);
        if (!action) {
          throw new Error(`Animation action "${name}" not found`);
        }
        return {
          name: clip.name,
          duration: clip.duration,
          tracks: clip.tracks.length,
          isLooping: action.loop === LoopRepeat,
          timeScale: action.timeScale,
        };
      });
    }
  }

  /**
   * Get current playback state
   */
  getAnimationCurrentState(): AnimationState {
    const isPlaying = this.currentAction
      ? !this.currentAction.paused && this.currentAction.isRunning()
      : false;
    const currentAnimation = this.getCurrentAnimationName();

    // Get blend animation states
    const blendAnimations = Array.from(
      this.activeBlendAnimations.entries(),
    ).map(([name, blendAnim]) => ({
      name,
      weight: blendAnim.weight,
      isPlaying: !blendAnim.action.paused && blendAnim.action.isRunning(),
    }));

    // Calculate playback time and progress
    let playbackTime = 0;
    let progress = 0;
    if (this.currentAction) {
      playbackTime = this.currentAction.time;
      const clip = this.clips.get(currentAnimation || "");
      if (clip && clip.duration > 0) {
        progress = Math.min(playbackTime / clip.duration, 1);
      }
    }

    return {
      isPlaying,
      currentAnimation,
      isBlendMode: this.isBlendMode,
      blendAnimations,
      playbackTime,
      progress,
    };
  }

  /**
   * Get animation clip directly
   */
  getAnimationClip(name: string): AnimationClip | null {
    return this.clips.get(name) || null;
  }

  /**
   * Get animation action directly
   */
  getAnimationAction(name: string): AnimationAction | null {
    return this.actions.get(name) || null;
  }

  // ========================================
  // Control APIs (verb-based)
  // ========================================

  /**
   * Play specified animation
   */
  playAnimation(name: string): boolean {
    if (!this.mixer || !this.actions.has(name)) {
      console.warn(`Animation clip "${name}" not found`);
      return false;
    }

    // If currently in blend mode, stop all and exit blend mode
    if (this.isBlendMode) {
      this.stopAllAnimations();
      this.isBlendMode = false;
    } else if (this.currentAction) {
      // Stop current single animation
      this.currentAction.stop();
    }

    // Start new animation
    const action = this.actions.get(name);
    if (!action) {
      console.warn(`Animation action "${name}" not found`);
      return false;
    }
    this.ensureAnimationPlaying(action);

    return true;
  }

  /**
   * Cross-fade between animations
   */
  crossFadeAnimation(from: string, to: string, duration: number): boolean {
    if (!this.mixer) {
      console.warn("Animation mixer not initialized");
      return false;
    }

    if (!this.actions.has(from)) {
      console.warn(`Animation clip "${from}" not found`);
      return false;
    }

    if (!this.actions.has(to)) {
      console.warn(`Animation clip "${to}" not found`);
      return false;
    }

    const fromAction = this.actions.get(from);
    const toAction = this.actions.get(to);

    if (!fromAction || !toAction) {
      console.warn("Animation actions not found for crossfade");
      return false;
    }

    // Handle case where same animation is specified
    if (fromAction === toAction) {
      this.ensureAnimationPlaying(toAction);
      return true;
    }

    // If currently in blend mode, stop all and exit blend mode before crossfading
    if (this.isBlendMode) {
      this.stopAllAnimations();
      this.isBlendMode = false;
    }

    // Ensure 'from' animation is the current animation
    this.ensureFromAnimationActive(fromAction);

    // Execute crossfade
    this.executeCrossFade(fromAction, toAction, duration);

    return true;
  }

  /**
   * Ensure the specified animation is playing
   */
  private ensureAnimationPlaying(action: AnimationAction): void {
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(this.animationSpeed);
    action.reset().play();
    this.currentAction = action;
    this.emit("needsUpdate");
  }

  /**
   * Ensure the 'from' animation is currently active
   */
  private ensureFromAnimationActive(fromAction: AnimationAction): void {
    if (this.currentAction !== fromAction) {
      // Ensure the source action is actively contributing before crossfade
      fromAction.enabled = true;
      fromAction.setEffectiveTimeScale(this.animationSpeed);
      fromAction.setEffectiveWeight(1);
      fromAction.reset().play();
      this.currentAction = fromAction;
    }
  }

  /**
   * Execute the actual crossfade between animations
   */
  private executeCrossFade(
    fromAction: AnimationAction,
    toAction: AnimationAction,
    duration: number,
  ): void {
    // Prepare target action following three.js example semantics
    toAction.enabled = true;
    toAction.setEffectiveTimeScale(this.animationSpeed);
    toAction.setEffectiveWeight(1);
    toAction.time = 0; // restart target action
    fromAction.crossFadeTo(toAction, duration, true);
    toAction.play();
    this.currentAction = toAction;
    this.emit("needsUpdate");
  }

  /**
   * Play multiple animations simultaneously with weights
   */
  blendAnimations(animations: { name: string; weight: number }[]): void {
    if (!this.mixer) {
      console.warn("Animation mixer not initialized");
      return;
    }

    // Stop existing animations
    this.stopAllAnimations();

    // Switch to blend mode
    this.isBlendMode = true;
    this.currentAction = null;

    // Configure each animation
    animations.forEach(({ name, weight }) => {
      const action = this.actions.get(name);
      if (!action) {
        console.warn(`Animation "${name}" not found`);
        return;
      }

      // Start animation with effective settings
      action.enabled = true;
      action.setEffectiveTimeScale(this.animationSpeed);
      action.setEffectiveWeight(weight);
      action.play();

      // Register as blend animation
      this.activeBlendAnimations.set(name, {
        action,
        weight,
        targetWeight: weight,
      });
    });

    // Notify rendering update
    this.emit("needsUpdate");
  }

  /**
   * Stop current animation
   */
  stopAnimation(): void {
    if (this.isBlendMode) {
      // Stop all in blend mode
      this.stopAllAnimations();
    } else if (this.currentAction) {
      this.currentAction.stop();
      this.currentAction = null;
    }
  }

  /**
   * Stop all animations
   */
  stopAllAnimations(): void {
    // Stop blend animations
    this.activeBlendAnimations.forEach((blendAnim) => {
      blendAnim.action.stop();
    });
    this.activeBlendAnimations.clear();

    // Stop single animation
    if (this.currentAction) {
      this.currentAction.stop();
      this.currentAction = null;
    }

    // Also reset weights and disable actions
    this.actions.forEach((action) => {
      action.setEffectiveWeight(0);
      action.enabled = false;
    });

    // Exit blend mode
    this.isBlendMode = false;

    this.emit("needsUpdate");
  }

  /**
   * Pause current animation
   */
  pauseAnimation(): void {
    if (this.isBlendMode) {
      this.activeBlendAnimations.forEach((blendAnim) => {
        blendAnim.action.paused = true;
      });
    } else if (this.currentAction) {
      this.currentAction.paused = true;
    }
  }

  /**
   * Resume paused animation
   */
  resumeAnimation(): void {
    if (this.isBlendMode) {
      this.activeBlendAnimations.forEach((blendAnim) => {
        blendAnim.action.paused = false;
      });
    } else if (this.currentAction) {
      this.currentAction.paused = false;
    }
  }

  // stepAnimation removed with UI pausing/stepping controls

  /**
   * Normalize all animation weights (adjust total to 1.0)
   */
  normalizeAnimationWeights(): void {
    if (!this.isBlendMode || this.activeBlendAnimations.size === 0) {
      console.warn("No blend animations to normalize");
      return;
    }

    // Calculate total weight
    const totalWeight = Array.from(this.activeBlendAnimations.values()).reduce(
      (sum, blendAnim) => sum + blendAnim.targetWeight,
      0,
    );

    if (totalWeight === 0) {
      console.warn("Total weight is 0, cannot normalize");
      return;
    }

    // Normalize each animation weight
    this.activeBlendAnimations.forEach((blendAnim) => {
      const normalizedWeight = blendAnim.targetWeight / totalWeight;
      blendAnim.action.weight = normalizedWeight;
      blendAnim.weight = normalizedWeight;
    });

    // Notify rendering update
    this.emit("needsUpdate");
  }

  // ========================================
  // Setter APIs (set prefix)
  // ========================================

  /**
   * Set animation speed
   */
  setAnimationSpeed(speed: number): void {
    this.animationSpeed = speed;
    // Apply to all actions so both single and blend modes are covered
    this.actions.forEach((action) => {
      action.setEffectiveTimeScale(speed);
    });
  }

  /**
   * Change animation loop setting
   */
  setAnimationLoop(loop: boolean): void {
    this.isLooping = loop;
    this.actions.forEach((action) => {
      action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    });
  }

  /**
   * Set weight for specific animation
   */
  setAnimationWeight(name: string, weight: number): void {
    if (!this.mixer) {
      console.warn("Animation mixer not initialized");
      return;
    }

    // Weight adjustment in blend mode
    if (this.isBlendMode && this.activeBlendAnimations.has(name)) {
      const blendAnim = this.activeBlendAnimations.get(name);
      if (!blendAnim) {
        console.warn(`Blend animation "${name}" not found`);
        return;
      }
      blendAnim.action.enabled = weight > 0;
      blendAnim.action.setEffectiveWeight(weight);
      blendAnim.weight = weight;
      blendAnim.targetWeight = weight;
    } else {
      // For single animation, switch to blend mode and set weight
      const action = this.actions.get(name);
      if (!action) {
        console.warn(`Animation "${name}" not found`);
        return;
      }

      // Stop existing animations and switch to blend mode
      if (!this.isBlendMode) {
        this.stopAllAnimations();
        this.isBlendMode = true;
        this.currentAction = null;
      }

      // Start animation and set weight
      action.enabled = true;
      action.setEffectiveTimeScale(this.animationSpeed);
      action.setEffectiveWeight(weight);
      action.play();

      this.activeBlendAnimations.set(name, {
        action,
        weight,
        targetWeight: weight,
      });
    }

    this.emit("needsUpdate");
  }

  // ========================================
  // Internal Processing APIs
  // ========================================

  /**
   * Update animation mixer (needs to be called every frame)
   */
  updateAnimation(deltaTime: number): void {
    this.updateAnimationMixer(deltaTime);
  }

  /**
   * Dispose animation-related resources
   */
  disposeAnimation(): void {
    this.disposeAnimationResources();
  }

  /**
   * Internal method to update animation mixer
   */
  private updateAnimationMixer(deltaTime: number): void {
    if (this.mixer) {
      this.mixer.update(deltaTime);
    }
  }

  // ========================================
  // Framework Integration APIs
  // ========================================

  /**
   * Update method called every frame
   * Automatically called by Three.js framework
   */
  update(time: number): void {
    // Record previous update time and calculate deltaTime
    if (!this.lastUpdateTime) {
      this.lastUpdateTime = time;
      return;
    }

    const deltaTime = (time - this.lastUpdateTime) / 1000; // Convert milliseconds to seconds
    this.lastUpdateTime = time;

    // Update animation mixer
    this.updateAnimationMixer(deltaTime);
  }

  /**
   * Get currently playing animation name
   */
  private getCurrentAnimationName(): string | null {
    if (!this.currentAction) return null;

    for (const [name, action] of this.actions.entries()) {
      if (action === this.currentAction) {
        return name;
      }
    }
    return null;
  }

  getWorldPosition(): Vector3 {
    // Return stored world position (RTE mode)
    return this.originalWorldPosition;
  }

  private lastUpdateTime?: number;
}
