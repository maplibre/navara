import type { BaseEventMap } from "@navaramap/core";
import { Mesh, type Object3D } from "three";

import type ThreeView from "../index";
import { arraysEqual } from "../utils";

import {
  MeshDesc,
  type MeshConfig,
  type MeshUpdate,
  type MeshBaseInstance,
  type PassKey,
} from "./MeshDesc";
import type { ViewContext } from "./ViewContext";

export type MeshConfigWithSelectiveEffect = MeshConfig & {
  effectIds?: string[];
};

export type MeshUpdateWithSelectiveEffect = MeshUpdate & {
  effectIds?: string[];
};

export abstract class MeshDescWithSelectiveEffect<
  Config extends MeshConfigWithSelectiveEffect = MeshConfigWithSelectiveEffect,
  UpdateConfig extends MeshUpdateWithSelectiveEffect =
    MeshUpdateWithSelectiveEffect,
  InstanceObj extends Object3D | { raw: Object3D } =
    Object3D | { raw: Object3D },
  CustomEvent extends BaseEventMap = BaseEventMap,
  Instance extends MeshBaseInstance<InstanceObj> =
    MeshBaseInstance<InstanceObj>,
> extends MeshDesc<Config, UpdateConfig, InstanceObj, CustomEvent, Instance> {
  protected _effectIds: string[] = [];
  private _onSlotsChanged = () => {
    this.updateEffectIdsMask();
    // Slot count changes can flip the pass returned by getPassKey()
    // (mrt <-> opaque), so re-evaluate scene placement.
    this.onPassKeyChange();
  };

  private _onGBufferChanged = () => {
    this.onPassKeyChange();
  };

  constructor(view: ThreeView, ctx: ViewContext, config?: Config) {
    const resolvedConfig = config ?? ({} as Config);
    super(view, ctx, resolvedConfig);
    this._effectIds = resolvedConfig.effectIds ?? [];
  }

  protected override getPassKey(): PassKey {
    // When at least one selective effect is registered on this view, all
    // SE-capable meshes must share the MRT depth/color path so the depth
    // ordering between SE participants stays consistent — an empty
    // effectIds list still has to coexist with non-empty siblings, and is
    // expressed by effectIdsMask=0 rather than by falling back to opaque.
    if (this.ctx.selectiveEffectRegistry.slotCount > 0) {
      return "mrt";
    }
    // Likewise while any optional G-buffer is allocated: outside the MRT pass
    // the mesh leaves the G-buffer holding what lies behind it, and effects
    // reading those buffers shade "through" it.
    if (Object.values(this.view.buffers).some(Boolean)) {
      return "mrt";
    }
    if (this.ctx._mrtPassRequired) {
      return "mrt";
    }
    // Otherwise MRT participation is pure overhead.
    return super.getPassKey();
  }

  override onCreate() {
    super.onCreate();

    // Compute and set effectIdsMask on material uniforms
    this.updateEffectIdsMask();

    // Recompute mask when slot assignments change (effect added/removed)
    this.ctx.on("effectSlotsChanged", this._onSlotsChanged);
    // G-buffer allocation changes also flip getPassKey() (mrt <-> opaque).
    this.ctx.on("gbufferChanged", this._onGBufferChanged);
  }

  override onUpdateConfig(updates: UpdateConfig): void {
    // ----------------------------------------------------------------------------
    // SelectiveEffect: effectIds update
    // Sync _effectIds before delegating to super so any downstream handler
    // observing the descriptor sees the new value.
    // ----------------------------------------------------------------------------
    let effectIdsChanged = false;

    if (updates.effectIds !== undefined) {
      const nextEffectIds = updates.effectIds ?? [];

      if (!arraysEqual(this._effectIds, nextEffectIds)) {
        this._effectIds = [...nextEffectIds];
        effectIdsChanged = true;
      }
    }

    super.onUpdateConfig(updates);

    if (effectIdsChanged) {
      // Recompute effectIdsMask for material uniforms.
      this.updateEffectIdsMask();
    }
  }

  /**
   * Compute effectIdsMask and set on the mesh's material.
   * Override this for non-standard mesh structures (e.g., Object3D with child meshes).
   */
  protected updateEffectIdsMask(): void {
    const registry = this.ctx.selectiveEffectRegistry;
    if (!registry) return;

    const mask =
      this._effectIds.length > 0 ? registry.computeMask(this._effectIds) : 0;
    const raw = this.raw;
    if (
      raw instanceof Mesh &&
      !Array.isArray(raw.material) &&
      raw.material?.userData?.uEffectIdsMask
    ) {
      raw.material.userData.uEffectIdsMask.value = mask;
    }
  }

  override onDestroy(): void {
    // ----------------------------------------------------------------------------
    // SelectiveEffect: cleanup
    // ----------------------------------------------------------------------------
    this._effectIds = [];

    // Unsubscribe from slot changes
    this.ctx.off("effectSlotsChanged", this._onSlotsChanged);
    this.ctx.off("gbufferChanged", this._onGBufferChanged);

    super.onDestroy();
  }
}
