import { Group, Light, type Object3D, Scene } from "three";

import {
  EffectDesc,
  type EffectConfig,
  type EffectUpdate,
} from "../../core/EffectDesc";
import { RenderPass } from "../../effects";

type Description = {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  transparent?: {};
};

export type TransparentPassConfig = Description & EffectConfig;

export type TransparentPassUpdate = Description & EffectUpdate;

export class TransparentPassEffectDesc extends EffectDesc<
  TransparentPassConfig,
  TransparentPassUpdate,
  RenderPass
> {
  static key = "transparent";
  static insertBefore = ["final"];

  light = new Group();
  lightsSyncMap = new Map<number, Object3D>();

  createPass(): RenderPass {
    // Create render pass for transparent objects
    const scene = new Scene();
    scene.add(this.light);
    scene.add(this.ctx.scenes.transparent);

    const camera = this.view.camera.raw;

    const pass = new RenderPass(scene, camera);
    pass.clear = false;

    this.ctx.scenes.light.addEventListener("childadded", this.onLightAdded);
    this.ctx.scenes.light.addEventListener("childremoved", this.onLightRemoved);

    return pass;
  }

  private onLightAdded = ({ child }: { child: Object3D }) => {
    const cloned = child.clone(true);
    this.lightsSyncMap.set(child.id, cloned);
    this.light.add(cloned);
  };

  private onLightRemoved = ({ child }: { child: Object3D }) => {
    const cloned = this.lightsSyncMap.get(child.id);
    if (!cloned) return;
    this.light.remove(cloned);
    this.lightsSyncMap.delete(child.id);
    disposeLights(cloned);
  };

  onDestroy(): void {
    this.ctx.scenes.light.removeEventListener("childadded", this.onLightAdded);
    this.ctx.scenes.light.removeEventListener(
      "childremoved",
      this.onLightRemoved,
    );
    for (const cloned of this.lightsSyncMap.values()) disposeLights(cloned);
    this.lightsSyncMap.clear();
    this.light.clear();
    super.onDestroy();
  }

  update(_time: number): void {
    // Sync each clone from its source by id — the children order of
    // scenes.light is not stable (e.g. the CSM lights are kept first for
    // shadow-index ordering), so an index-based pairing would copy across
    // mismatched light types.
    for (const child of this.ctx.scenes.light.children) {
      this.lightsSyncMap.get(child.id)?.copy(child, true);
    }
  }
}

/** A clone rendered with shadows allocates its own shadow map. */
function disposeLights(root: Object3D): void {
  root.traverse((object) => {
    if (object instanceof Light) object.dispose();
  });
}
