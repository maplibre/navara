import type ThreeView from "@navaramap/three";
import {
  Color,
  DrapedMesh,
  MeshDescWithSelectiveEffect,
  PickableMeshWrapper,
  type MeshConfigWithSelectiveEffect,
  type MeshUpdateWithSelectiveEffect,
  type ViewContext,
  type CustomObject3DEventMap,
  type PassKey,
  setupSelectiveEffectUniforms,
} from "@navaramap/three";
import {
  BoxGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3DEventMap,
} from "three";

type BoxMeshEventMap = Object3DEventMap & CustomObject3DEventMap;

type Description = {
  box?: {
    width?: number;
    height?: number;
    depth?: number;
    widthSegments?: number;
    heightSegments?: number;
    depthSegments?: number;
    color?: Color;
    emissiveColor?: Color;
    emissiveIntensity?: number;
    opacity?: number;
    transparent?: boolean;
    castShadow?: boolean;
    receiveShadow?: boolean;
    effectIds?: string[];
  };
};

export type BoxMeshConfig = MeshConfigWithSelectiveEffect & {
  box?: Description["box"] & {
    /**
     * To drape the mesh properly on the terrain,
     * the mesh must cover the terrain. Fixed at creation; remove and re-add
     * the mesh to change it.
     */
    draped?: boolean;
  };
  pickable?: boolean;
};

export type BoxMeshUpdate = MeshUpdateWithSelectiveEffect & Description;

type BoxMeshMaterial = MeshLambertMaterial | MeshBasicMaterial;

export class BoxMeshDesc extends MeshDescWithSelectiveEffect<
  BoxMeshConfig,
  BoxMeshUpdate,
  DrapedMesh<BoxGeometry, BoxMeshMaterial, BoxMeshEventMap>
> {
  private config: BoxMeshConfig;
  private pickWrapper?: PickableMeshWrapper;

  constructor(view: ThreeView, ctx: ViewContext, config: BoxMeshConfig) {
    // Propagate initial effectIds to base MeshDesc
    if (config.box?.effectIds) {
      config.effectIds = config.box.effectIds;
    }
    super(view, ctx, config);
    this.config = config;
  }

  /** The batch ID assigned to this mesh when picking is enabled. */
  get batchId(): number | undefined {
    return this.pickWrapper?.batchId;
  }

  createMesh() {
    const cfg = this.config.box;
    if (!cfg) {
      throw new Error("BoxMesh configuration is required");
    }

    // Create geometry from parameters
    const geometry = new BoxGeometry(
      cfg.width ?? 1,
      cfg.height ?? 1,
      cfg.depth ?? 1,
      cfg.widthSegments ?? 1,
      cfg.heightSegments ?? 1,
      cfg.depthSegments ?? 1,
    );

    // Create material from properties
    const material = this.createMaterial(cfg);

    // Set up selective effect uniforms and emissive properties
    if (material instanceof MeshLambertMaterial) {
      material.emissive.set(cfg.emissiveColor?.raw ?? 0x000000);
      material.emissiveIntensity = cfg.emissiveIntensity ?? 0;
      setupSelectiveEffectUniforms(material);
    }

    const mesh = new DrapedMesh<BoxGeometry, BoxMeshMaterial, BoxMeshEventMap>(
      geometry,
      material,
      cfg.draped ?? false,
    );

    mesh.castShadow = cfg.castShadow ?? false;
    mesh.receiveShadow = cfg.receiveShadow ?? false;

    // Emit CSM event for shadow map integration
    this.ctx.applyShadowMaterial(material);

    if (this.config.pickable) {
      this.pickWrapper = new PickableMeshWrapper(mesh, this.ctx);
      this.ctx.registerPickableMesh(this.id, this.pickWrapper);
    }

    return mesh;
  }

  private createMaterial(
    cfg: NonNullable<BoxMeshConfig["box"]>,
  ): BoxMeshMaterial {
    const colorValue = cfg.color ?? new Color().setStyle("#ffffff");
    return new MeshLambertMaterial({
      color: colorValue.raw,
      opacity: cfg.opacity ?? 1,
      transparent: cfg.transparent ?? false,
    });
  }

  protected override getPassKey(): PassKey {
    if (this.config.box?.draped) {
      return "draped";
    }
    return super.getPassKey();
  }

  onUpdateConfig(updates: BoxMeshUpdate): void {
    if (updates.box && this._instance) {
      const cfg = updates.box;
      const origin = this.config.box;

      // Update geometry if dimensions changed
      if (
        cfg.width !== undefined ||
        cfg.height !== undefined ||
        cfg.depth !== undefined ||
        cfg.widthSegments !== undefined ||
        cfg.heightSegments !== undefined ||
        cfg.depthSegments !== undefined
      ) {
        this._instance.geometry.dispose();
        this._instance.geometry = new BoxGeometry(
          cfg.width ?? origin?.width ?? 1,
          cfg.height ?? origin?.height ?? 1,
          cfg.depth ?? origin?.depth ?? 1,
          cfg.widthSegments ?? origin?.widthSegments ?? 1,
          cfg.heightSegments ?? origin?.heightSegments ?? 1,
          cfg.depthSegments ?? origin?.depthSegments ?? 1,
        );

        // Update the stored config with the new values
        if (origin) {
          Object.assign(origin, cfg);
        }
      }

      // Update material if material properties changed
      if (
        cfg.color !== undefined ||
        cfg.emissiveColor !== undefined ||
        cfg.emissiveIntensity !== undefined ||
        cfg.opacity !== undefined ||
        cfg.transparent !== undefined
      ) {
        const material = this._instance.material;
        if (cfg.color !== undefined) {
          material.color.set(cfg.color.raw);
        }
        if (cfg.opacity !== undefined) material.opacity = cfg.opacity;
        if (cfg.transparent !== undefined)
          material.transparent = cfg.transparent;
        if (material instanceof MeshLambertMaterial) {
          if (cfg.emissiveColor !== undefined) {
            material.emissive.set(cfg.emissiveColor.raw);
          }
          if (cfg.emissiveIntensity !== undefined) {
            material.emissiveIntensity = cfg.emissiveIntensity;
          }
        }
        material.needsUpdate = true;
      }

      if (cfg.castShadow !== undefined) {
        this._instance.castShadow = cfg.castShadow;
      }

      if (cfg.receiveShadow !== undefined) {
        this._instance.receiveShadow = cfg.receiveShadow;
      }

      // Propagate effectIds to base MeshDesc
      if (cfg.effectIds !== undefined) {
        updates.effectIds = cfg.effectIds;
      }
      this.emit("needsUpdate");
    }

    super.onUpdateConfig(updates);
  }

  protected disposeMesh(): void {
    if (this._instance) {
      // Emit CSM event for shadow map cleanup
      this.ctx.removeShadowMaterial(this._instance.material);

      this._instance.geometry.dispose();
      this._instance.material.dispose();

      this._instance = undefined;
    }
  }

  override onDestroy(): void {
    if (this.pickWrapper) {
      this.ctx.unregisterPickableMesh(this.id);
      this.pickWrapper = undefined;
    }
    super.onDestroy();
  }
}
