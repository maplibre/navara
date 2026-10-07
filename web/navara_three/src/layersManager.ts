import {
  EffectDesc,
  BaseHandle,
  EffectHandle,
  LightDesc,
  LightHandle,
  MeshDesc,
  MeshHandle,
} from "./core";
import { Layer, type LayerEvent } from "./layer";

export class LayersManager {
  private layers = new Map<string, Layer | BaseHandle>();

  add(l: Layer | BaseHandle) {
    this.layers.set(l.id, l);
    const deleteLayer = () => {
      this.layers.delete(l.id);
    };
    if (l instanceof BaseHandle) {
      l.on("deleted", deleteLayer);
    } else {
      l.on("deleted", deleteLayer);
    }
  }

  get(id: string) {
    return this.layers.get(id);
  }

  emitById<K extends keyof LayerEvent>(
    k: K,
    id: string,
    ...args: Parameters<LayerEvent[K]>
  ) {
    const l = this.layers.get(id);
    if (!l) return;
    if (l instanceof Layer) {
      l.emit(k, ...args);
    }
  }

  emitAll<K extends keyof LayerEvent>(
    k: K,
    ...args: Parameters<LayerEvent[K]>
  ) {
    for (const l of this.layers.values()) {
      if (l instanceof Layer) {
        l.emit(k, ...args);
      }
    }
  }

  *getResourceLayers() {
    for (const l of this.layers.values()) {
      if (!(l instanceof Layer)) continue;
      yield l;
    }
  }

  *getHandles(): Generator<BaseHandle> {
    for (const handle of this.layers.values()) {
      if (handle instanceof BaseHandle) yield handle;
    }
  }

  *getEffectDescs(): Generator<EffectHandle> {
    for (const handle of this.layers.values()) {
      if (!(handle instanceof BaseHandle)) continue;

      const desc = handle.ref;
      if (!(desc instanceof EffectDesc)) continue;

      yield handle as EffectHandle;
    }
  }

  *getLightDescs(): Generator<LightHandle> {
    for (const handle of this.layers.values()) {
      if (!(handle instanceof BaseHandle)) continue;

      const desc = handle.ref;
      if (!(desc instanceof LightDesc)) continue;

      yield handle as LightHandle;
    }
  }

  *getMeshDescs(): Generator<MeshHandle> {
    for (const handle of this.layers.values()) {
      if (!(handle instanceof BaseHandle)) continue;

      const desc = handle.ref;
      // Covers instanced meshes too — InstancedMeshDesc extends MeshDesc.
      if (!(desc instanceof MeshDesc)) continue;

      yield handle as MeshHandle;
    }
  }
}
