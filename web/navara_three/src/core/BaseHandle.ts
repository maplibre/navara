import { EventHandler } from "@navaramap/core";

import { BaseDesc, type BaseDescConfigUpdate } from "./BaseDesc";
import type { EffectDesc } from "./EffectDesc";
import type { LightDesc } from "./LightDesc";
import type { MeshDesc } from "./MeshDesc";

/** The mesh descriptor hierarchy. */
export type AnyMeshDesc = MeshDesc;

/**
 * Events emitted by handles.
 */
export type HandleEvent = {
  /** Emitted when the descriptor is deleted. */
  deleted: () => void;
};

/**
 * Abstract base handle to control a descriptor after it has been added to the scene.
 *
 * Use the typed subclasses instead:
 * - {@link MeshHandle} - returned by `ThreeView.addMesh()`
 * - {@link LightHandle} - returned by `ThreeView.addLight()`
 * - {@link EffectHandle} - returned by `ThreeView.addEffect()`
 *
 * @typeParam T - The specific descriptor type
 */
export class BaseHandle<
  T extends BaseDesc = BaseDesc,
> extends EventHandler<HandleEvent> {
  constructor(private desc: T) {
    super();
  }

  /**
   * Updates the descriptor configuration with partial updates.
   * Only the specified properties will be changed; others remain unchanged.
   * @param updates - Partial configuration object with properties to update
   */
  update(
    updates: T extends BaseDesc<infer _A, infer B> ? B : BaseDescConfigUpdate,
  ): void {
    this.desc.onUpdateConfig(updates);
  }

  /**
   * Gets direct access to the underlying descriptor instance.
   * Use this to access descriptor-specific methods and properties not exposed through the handle.
   */
  get ref(): T {
    return this.desc;
  }

  /**
   * Removes the descriptor from the scene and disposes its resources.
   * After calling this, the handle should no longer be used.
   */
  delete(): void {
    if (this._deleted) return;
    this._deleted = true;
    try {
      this.desc.onDestroy();
    } finally {
      this.emit("deleted");
    }
  }

  private _deleted = false;

  /**
   * Gets the unique identifier.
   */
  get id(): string {
    return this.desc.id;
  }

  /**
   * Gets whether the descriptor is currently visible in the scene.
   */
  get visible(): boolean {
    return this.desc.visible;
  }

  /**
   * Sets whether the descriptor should be visible in the scene.
   * @param visible - True to show, false to hide
   */
  set visible(visible: boolean) {
    this.desc.visible = visible;
  }
}

/**
 * A handle to control a mesh descriptor after it has been added to the scene.
 * Returned by `ThreeView.addMesh()`.
 *
 * @typeParam T - The specific mesh descriptor type (e.g., BoxMeshDesc)
 *
 * @example
 * ```typescript
 * const handle = view.addMesh<BoxMeshDesc>({ box: { width: 100 } });
 * handle.update({ box: { width: 200 } });
 * handle.delete();
 * ```
 */
export class MeshHandle<
  T extends AnyMeshDesc = AnyMeshDesc,
> extends BaseHandle<T> {}

/**
 * A handle to control a light descriptor after it has been added to the scene.
 * Returned by `ThreeView.addLight()`.
 *
 * @typeParam T - The specific light descriptor type (e.g., SunLightDesc)
 */
export class LightHandle<
  T extends LightDesc = LightDesc,
> extends BaseHandle<T> {}

/**
 * A handle to control an effect descriptor after it has been added to the scene.
 * Returned by `ThreeView.addEffect()`.
 *
 * @typeParam T - The specific effect descriptor type (e.g., SSAOEffectDesc)
 */
export class EffectHandle<
  T extends EffectDesc = EffectDesc,
> extends BaseHandle<T> {}
