import type { TileHandle } from "@navaramap/core";
import {
  type BufferGeometry,
  OrthographicCamera,
  type Material,
  Scene,
  WebGLRenderer,
  Mesh,
  Group,
} from "three";

import type { DrapeBakedMesh } from "./tileTexture/types";

export type Scenes = {
  // Render light in all scenes.
  light: Group;
  // Render general mesh to MRT. The mesh added to this scene needs a normal buffer.
  mrt: Scene;
  // Render only globe.
  globe: Scene;
  // Render only draped mesh on the globe
  draped: Scene;
  // Render this scene at last. This scene should not be handled in MRT.
  opaque: Scene;
  // Render this scene after the atmosphere effect. This scene should not be handled in MRT.
  // It is useful to render a transparent mesh.
  transparent: Scene;
  // Render sky environment map to a cube map for reflections
  skyEnvMap: Scene;
};

export class TileScene extends Scene {
  layerId: string;
  layerIndex: number;
  removed = false;
  revision = 0;
  private transparentRevision = -1;
  private transparent = false;

  constructor(layerId: string, layerIndex: number) {
    super();
    this.layerId = layerId;
    this.layerIndex = layerIndex;
  }

  /**
   * Whether a visible mesh of this scene can draw a translucent texel: it
   * asked for `transparent` (see {@link DrapeBakedMesh}), has a sub-1
   * opacity, or takes per-feature opacity from its batch texture. Every
   * mesh, material, batch or visibility change bumps `revision`, so the
   * meshes are scanned again only after one.
   */
  get hasTransparentMesh(): boolean {
    if (this.transparentRevision !== this.revision) {
      this.transparentRevision = this.revision;
      this.transparent = this.children.some((object) => {
        if (!object.visible) return false;
        const mesh = object as Mesh<BufferGeometry, Material> &
          Partial<DrapeBakedMesh>;
        return (
          !!mesh.drapeTransparent ||
          mesh.material.opacity < 1 ||
          !!mesh.material.userData.defines?.USE_BATCH_SHOW_OPACITY
        );
      });
    }
    return this.transparent;
  }
}

export class SceneGroup extends Group {
  get tileScenes(): TileScene[] {
    return this.children as TileScene[];
  }
}

export class TexturizedSceneByTileCoordinates {
  map = new Map<TileHandle, SceneGroup>();
  renderer: WebGLRenderer;
  camera: OrthographicCamera;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.camera.position.z = 1;
  }

  get(handle: TileHandle) {
    let scene = this.map.get(handle);
    if (!scene) {
      scene = new SceneGroup();
      this.map.set(handle, scene);
    }
    return scene;
  }

  private findTileScene(
    handle: TileHandle,
    layerId: string,
  ): TileScene | undefined {
    return this.map.get(handle)?.tileScenes.find((o) => o.layerId === layerId);
  }

  add(handle: TileHandle, layerId: string, mesh: Mesh, layerIndex: number) {
    const scenes = this.get(handle);
    let scene = this.findTileScene(handle, layerId);
    if (!scene) {
      scene = new TileScene(layerId, layerIndex);
      scenes.add(scene);
      scenes.tileScenes.sort((a, b) => a.layerIndex - b.layerIndex);
    }

    scene.removed = false;

    scene.add(mesh);
    scene.revision++;

    return scene;
  }

  findSceneByLayerId(handle: TileHandle, layerId: string) {
    return this.findTileScene(handle, layerId);
  }

  /**
   * Bump a layer scene's revision without changing its contents. Draped-feature
   * material/visibility changes that don't add or remove a mesh use this so the
   * consuming TileMesh's bake signature (which folds in `revision`) re-bakes.
   */
  markDirty(handle: TileHandle, layerId: string) {
    const scene = this.findTileScene(handle, layerId);
    if (!scene) return;
    scene.revision++;
  }

  /**
   * Remove a single feature mesh from its (tile, layer) scene. Only when the scene's last
   * mesh leaves do we mark it `removed` and prune the empty `TileScene` (and the
   * `SceneGroup` if it too becomes empty). This keeps sibling draped features in the same
   * tile+layer intact — unlike a whole-scene clear, which blanked them all on one removal.
   */
  removeMesh(handle: TileHandle, layerId: string, mesh: Mesh) {
    const scene = this.findTileScene(handle, layerId);
    if (!scene) return;
    scene.remove(mesh);
    scene.revision++;
    if (scene.children.length === 0) {
      scene.removed = true;
      const group = this.map.get(handle);
      group?.remove(scene);
      if (group && group.tileScenes.length === 0) this.delete(handle);
    }
  }

  delete(handle: TileHandle) {
    const sceneGroup = this.map.get(handle);
    if (!sceneGroup) return;

    sceneGroup.clear();

    this.map.delete(handle);
  }
}
