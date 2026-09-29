import {
  Pass as PostProcessingPass,
  Effect as PostProcessingEffect,
} from "postprocessing";
import invariant from "tiny-invariant";

import { Pass } from "../effects";
import type ThreeView from "../index";
import type { GBufferName } from "../material/gbufferLayout";

import {
  BaseDesc,
  type BaseInstance,
  type BaseDescConfig,
  type BaseDescConfigUpdate,
} from "./BaseDesc";
import type { ViewContext } from "./ViewContext";

type EffectInstance =
  PostProcessingPass | Pass<PostProcessingPass, PostProcessingEffect>;

export type EffectConfig = {
  type?: "effect";
} & BaseDescConfig;

export type EffectUpdate = BaseDescConfigUpdate;

export type EffectBaseInstance<Instance extends object = object> =
  Instance extends EffectInstance
    ? Instance & BaseInstance
    : Instance extends {
          raw: infer Raw extends PostProcessingPass;
        }
      ? Instance & { raw: Raw } & BaseInstance
      : BaseInstance;

/**
 * Abstract base class for creating custom post-processing effect descriptors.
 *
 * Extend this class to integrate custom effects from the `postprocessing` library into
 * Navara's render pipeline. The base class handles pass insertion, ordering, and lifecycle.
 *
 * ## Implementing a Custom Effect Descriptor
 *
 * ### 1. (Optional) Create an Effect wrapper class
 *
 * If your effect has configurable parameters, wrap the `postprocessing` effect in a
 * Navara {@link Effect} class with typed options and reactive setters:
 *
 * ```typescript
 * import { Effect } from "@navaramap/three";
 * import { VignetteEffect } from "postprocessing";
 *
 * type VignetteOptions = {
 *   offset?: number;
 *   darkness?: number;
 * };
 *
 * class Vignette extends Effect<VignetteEffect, VignetteOptions> {
 *   constructor(camera: Camera, options?: VignetteOptions) {
 *     super(camera, new VignetteEffect({ ... }), options);
 *   }
 *
 *   protected onMounted(): void {
 *     this.offset = this.options.offset ?? 0.5;
 *   }
 *
 *   get offset(): number { return this.options.offset ?? 0.5; }
 *   set offset(v: number) {
 *     this.options.offset = v;
 *     if (this.rawEffect) this.rawEffect.offset = v;
 *     this.emit("needsUpdate");
 *   }
 * }
 * ```
 *
 * ### 2. Define configuration types
 *
 * Create a description type for your effect-specific options, then merge it with
 * the base config and update types:
 *
 * ```typescript
 * type VignetteDescription = {
 *   vignette?: { offset?: number; darkness?: number };
 * };
 *
 * type VignetteEffectConfig = EffectConfig & VignetteDescription;
 * type VignetteEffectUpdate = EffectUpdate & VignetteDescription;
 * ```
 *
 * ### 3. Extend `EffectDesc`
 *
 * Implement the {@link createPass} factory method and configure the static properties
 * for pipeline ordering:
 *
 * ```typescript
 * class VignetteEffectDesc extends EffectDesc<
 *   VignetteEffectConfig,
 *   VignetteEffectUpdate,
 *   Vignette
 * > {
 *   // Unique key identifying this effect type in the render pipeline.
 *   static key = "vignette";
 *
 *   // Insert this effect before these passes (tries each in order).
 *   static insertBefore = ["smaa", "fxaa", "final"];
 *
 *   // Set to true if multiple instances of this effect are allowed.
 *   static allowDuplication = true;
 *
 *   private config: VignetteEffectConfig;
 *
 *   constructor(view: ThreeView, ctx: ViewContext, config: VignetteEffectConfig) {
 *     super(view, ctx, config);
 *     this.config = config;
 *   }
 *
 *   createPass() {
 *     return new Vignette(this.view.camera.raw, this.config.vignette);
 *   }
 *
 *   onUpdateConfig(updates: VignetteEffectUpdate): void {
 *     super.onUpdateConfig(updates);
 *     if (updates.vignette && this._instance) {
 *       if (updates.vignette.offset !== undefined) {
 *         this._instance.offset = updates.vignette.offset;
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * ### 4. Register and use the descriptor
 *
 * ```typescript
 * view.registerEffect("vignette", VignetteEffectDesc);
 *
 * const handle = view.addEffect<VignetteEffectDesc>({
 *   vignette: { offset: 0.5, darkness: 0.5 },
 *   visible: true,
 * });
 *
 * // Update dynamically
 * handle.update({ vignette: { offset: 0.7 } });
 *
 * // Remove the descriptor
 * handle.delete();
 * ```
 *
 * ## Static Properties for Pipeline Ordering
 *
 * - {@link key} - **(Required)** Unique string identifier for this effect type.
 * - {@link insertAfter} - Array of effect keys. The pass is inserted after the first
 *   matching key found in the pipeline.
 * - {@link insertBefore} - Array of effect keys. Used as fallback if no `insertAfter`
 *   target is found; inserts before the first matching key.
 * - {@link allowDuplication} - Set to `true` to allow multiple instances of this effect.
 *   Each instance gets a unique internal ID.
 *
 * If neither `insertAfter` nor `insertBefore` matches an existing pass, the effect is
 * appended to the end of the pipeline.
 *
 * ## Lifecycle
 *
 * 1. **Construction** - The descriptor is instantiated with the view context and config.
 * 2. **{@link createPass}** - Called during {@link onCreate} to create the post-processing pass.
 *    The base class inserts it into the render pipeline based on the static ordering properties.
 * 3. **{@link onUpdateConfig}** - Called when `handle.update()` is invoked. The base class
 *    handles `visible`; override to handle your custom properties.
 * 4. **{@link update}** - Optional per-frame callback for animating effect parameters.
 * 5. **{@link onDestroy}** - Called on `handle.delete()`. The base class removes the pass
 *    from the render pipeline.
 *
 * @see The `custom-effect` example page for a complete custom effect descriptor tutorial
 *      implementing a vignette effect.
 *
 * @typeParam Config - Configuration type (extends {@link EffectConfig})
 * @typeParam UpdateConfig - Updatable properties (extends {@link EffectUpdate})
 * @typeParam InstanceObj - The postprocessing Pass type or a wrapper with a `raw` property
 * @typeParam Instance - Resolved instance type (inferred automatically)
 */
export abstract class EffectDesc<
  Config extends EffectConfig = EffectConfig,
  UpdateConfig extends EffectUpdate = EffectUpdate,
  InstanceObj extends EffectInstance | { raw: EffectInstance } =
    EffectInstance | { raw: EffectInstance },
  Instance extends EffectBaseInstance<InstanceObj> =
    EffectBaseInstance<InstanceObj>,
> extends BaseDesc<Config, UpdateConfig, Instance> {
  /** Unique identifier for this effect type in the render pipeline. Must be defined by subclasses. */
  static key: string;
  /** Insert this pass after the first matching key found in the pipeline. */
  static insertAfter?: string[];
  /** Insert this pass before the first matching key found (fallback if no `insertAfter` match). */
  static insertBefore?: string[];
  /** Set to `true` to allow multiple instances of this effect in the pipeline. */
  static allowDuplication?: boolean;
  /**
   * Optional G-buffer attachments this effect reads. The view derives its
   * G-buffer configuration as the union of these across active effects:
   * adding an effect allocates what it needs, removing the last effect that
   * needs a buffer releases it. Changing the configuration reallocates
   * attachments and recompiles shaders, so add effects once and tune them
   * via `update()` instead of re-adding.
   */
  static requiredBuffers?: readonly GBufferName[];

  private instanceId: string;

  constructor(
    view: ThreeView,
    ctx: ViewContext,
    config: Config = {} as Config,
  ) {
    super(view, ctx, config);
    // Generate unique instance ID for layers that allow duplication
    this.instanceId = this.getConstructor().allowDuplication
      ? `${this.getKey()}_${Math.random().toString(36).slice(2, 9)}`
      : this.getKey();
  }

  /**
   * Factory method to create the post-processing pass instance.
   *
   * Override this to return your custom effect. The returned object can be either:
   * - A `postprocessing` `Pass` directly
   * - A Navara {@link Pass} wrapper (extends `postprocessing` Pass with typed options)
   * - A wrapper object with a `raw` property containing the pass
   *
   * The base class calls this during {@link onCreate} and automatically inserts
   * the pass into the render pipeline.
   */
  abstract createPass(): Instance;

  get raw() {
    if (!this._instance) return;

    if (
      this._instance instanceof PostProcessingPass ||
      this._instance instanceof Pass
    ) {
      return this._instance as Instance extends EffectInstance
        ? Instance
        : never;
    }

    if ("raw" in this._instance) {
      return this._instance.raw as Instance;
    }
  }

  getConstructor() {
    return this.constructor as typeof EffectDesc;
  }

  getKey(): string {
    return this.getConstructor().key;
  }

  getInsertAfter() {
    return this.getConstructor().insertAfter;
  }

  getInsertBefore() {
    return this.getConstructor().insertBefore;
  }

  /**
   * The G-buffer attachments this instance currently needs. Defaults to the
   * {@link requiredBuffers} static. An override whose result changes after
   * creation must emit `gbufferRequirementsChanged` on the context.
   */
  getRequiredBuffers(): readonly GBufferName[] {
    return this.getConstructor().requiredBuffers ?? [];
  }

  onCreate() {
    this._instance = this.createPass();

    if (this._instance) {
      this._instance.visible = this.visible;
    }

    // Insert the pass with proper ordering
    if (this.raw) {
      this.insertPass();
    }
  }

  private insertPass(): void {
    if (!this.raw) return;

    // Use instanceId for pass registration to allow duplicates
    const key = this.instanceId;
    const insertAfter = this.getInsertAfter() || [];
    const insertBefore = this.getInsertBefore() || [];

    const raw = this.raw;
    const c =
      raw instanceof Pass
        ? raw.rawPass
        : raw instanceof PostProcessingPass
          ? raw
          : undefined;
    invariant(c);

    // Try insertAfter first
    for (const target of insertAfter) {
      if (this.ctx.getPass(target)) {
        this.ctx.insertPassAfter(target, key, c);
        return;
      }
    }

    // Try insertBefore if no insertAfter worked
    for (const target of insertBefore) {
      if (this.ctx.getPass(target)) {
        this.ctx.insertPassBefore(target, key, c);
        return;
      }
    }

    // Default: add to end
    this.ctx.addPass(key, c);
  }

  onUpdateConfig(updates: UpdateConfig): void {
    super.onUpdateConfig(updates);
  }

  onDestroy(): void {
    if (this.ctx.getPass(this.instanceId)) {
      this.ctx.removePass(this.instanceId);
    }

    super.onDestroy();
  }

  /**
   * Optional per-frame update callback.
   * Override this to animate effect parameters over time.
   * @param time - Render-loop timestamp in milliseconds (same as the `requestAnimationFrame` time).
   */
  update?(time: number): void;

  /**
   * Finds another effect descriptor in the pipeline by its static `key`.
   * Useful for cross-effect communication (e.g. reading another effect's state).
   * @param key - The static `key` of the effect descriptor to find.
   * @returns The effect descriptor instance, or `undefined` if not found.
   */
  find<T extends EffectDesc = EffectDesc>(key: string) {
    for (const handle of this.ctx._getEffects()) {
      const desc = handle.ref;
      if (desc.getKey() !== key) {
        continue;
      }
      return desc as T;
    }
  }
}
