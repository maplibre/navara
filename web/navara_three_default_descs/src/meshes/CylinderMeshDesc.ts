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
  CylinderGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3DEventMap,
} from "three";

type CylinderMeshEventMap = Object3DEventMap & CustomObject3DEventMap;

type Description = {
  cylinder?: {
    radiusTop?: number;
    radiusBottom?: number;
    height?: number;
    radialSegments?: number;
    heightSegments?: number;
    openEnded?: boolean;
    thetaStart?: number;
    thetaLength?: number;
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

export type CylinderMeshConfig = MeshConfigWithSelectiveEffect & {
  cylinder?: Description["cylinder"] & {
    /**
     * To drape the mesh properly on the terrain,
     * the mesh must cover the terrain. Fixed at creation; remove and re-add
     * the mesh to change it.
     */
    draped?: boolean;
  };
  pickable?: boolean;
};

export type CylinderMeshUpdate = MeshUpdateWithSelectiveEffect & Description;

type CylinderMeshMaterial = MeshLambertMaterial | MeshBasicMaterial;

export class CylinderMeshDesc extends MeshDescWithSelectiveEffect<
  CylinderMeshConfig,
  CylinderMeshUpdate,
  DrapedMesh<CylinderGeometry, CylinderMeshMaterial, CylinderMeshEventMap>
> {
  private config: CylinderMeshConfig;
  private pickWrapper?: PickableMeshWrapper;

  constructor(view: ThreeView, ctx: ViewContext, config: CylinderMeshConfig) {
    // Propagate initial effectIds to base MeshDesc
    if (config.cylinder?.effectIds) {
      config.effectIds = config.cylinder.effectIds;
    }
    super(view, ctx, config);
    this.config = config;
  }

  /** The batch ID assigned to this mesh when picking is enabled. */
  get batchId(): number | undefined {
    return this.pickWrapper?.batchId;
  }

  createMesh() {
    const cfg = this.config.cylinder;
    if (!cfg) {
      throw new Error("Cylinder configuration is required");
    }

    const geometry = new CylinderGeometry(
      cfg.radiusTop ?? 1,
      cfg.radiusBottom ?? 1,
      cfg.height ?? 1,
      cfg.radialSegments ?? 32,
      cfg.heightSegments ?? 1,
      cfg.openEnded ?? false,
      cfg.thetaStart ?? 0,
      cfg.thetaLength ?? Math.PI * 2,
    );

    // Create material from properties
    const material = this.createMaterial(cfg);

    // Set up selective effect uniforms
    if (material instanceof MeshLambertMaterial) {
      setupSelectiveEffectUniforms(material);
    }

    const mesh = new DrapedMesh<
      CylinderGeometry,
      CylinderMeshMaterial,
      CylinderMeshEventMap
    >(geometry, material, cfg.draped ?? false);

    mesh.castShadow = cfg.castShadow ?? false;
    mesh.receiveShadow = cfg.receiveShadow ?? false;

    this.ctx.applyShadowMaterial(material);

    if (this.config.pickable) {
      this.pickWrapper = new PickableMeshWrapper(mesh, this.ctx);
      this.ctx.registerPickableMesh(this.id, this.pickWrapper);
    }

    return mesh;
  }

  private createMaterial(
    cfg: NonNullable<CylinderMeshConfig["cylinder"]>,
  ): CylinderMeshMaterial {
    const colorValue = cfg.color ?? new Color().setStyle("#ffffff");
    const emissiveColorValue = cfg.emissiveColor ? cfg.emissiveColor.raw : 0;
    return new MeshLambertMaterial({
      color: colorValue.raw,
      emissive: emissiveColorValue,
      emissiveIntensity: cfg.emissiveIntensity ?? 0,
      opacity: cfg.opacity ?? 1,
      transparent: cfg.transparent ?? false,
    });
  }

  protected override getPassKey(): PassKey {
    if (this.config.cylinder?.draped) {
      return "draped";
    }
    return super.getPassKey();
  }

  onUpdateConfig(updates: CylinderMeshUpdate): void {
    if (updates.cylinder && this._instance) {
      const cfg = updates.cylinder;
      const origin = this.config.cylinder;

      // Update geometry if dimensions changed
      if (
        cfg.radiusTop !== undefined ||
        cfg.radiusBottom !== undefined ||
        cfg.height !== undefined ||
        cfg.radialSegments !== undefined ||
        cfg.heightSegments !== undefined ||
        cfg.openEnded !== undefined ||
        cfg.thetaStart !== undefined ||
        cfg.thetaLength !== undefined
      ) {
        this._instance.geometry.dispose();
        this._instance.geometry = new CylinderGeometry(
          cfg.radiusTop ?? origin?.radiusTop ?? 1,
          cfg.radiusBottom ?? origin?.radiusBottom ?? 1,
          cfg.height ?? origin?.height ?? 1,
          cfg.radialSegments ?? origin?.radialSegments ?? 32,
          cfg.heightSegments ?? origin?.heightSegments ?? 1,
          cfg.openEnded ?? origin?.openEnded ?? false,
          cfg.thetaStart ?? origin?.thetaStart ?? 0,
          cfg.thetaLength ?? origin?.thetaLength ?? Math.PI * 2,
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
