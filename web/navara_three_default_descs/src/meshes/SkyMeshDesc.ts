import type ThreeView from "@navaramap/three";
import {
  MeshDesc,
  type MeshConfig,
  type ViewContext,
  type MeshUpdate,
} from "@navaramap/three";

import { SkyMesh, type SkyMeshOptions } from "./skyMesh";

type Description = {
  sky?: Partial<SkyMeshOptions>;
};

export type SkyMeshConfig = MeshConfig & Description;

export type SkyMeshUpdate = MeshUpdate & Description;

export class SkyMeshDesc extends MeshDesc<
  SkyMeshConfig,
  SkyMeshUpdate,
  SkyMesh
> {
  private config: SkyMeshConfig;
  private _skyMesh: SkyMesh | null = null;

  constructor(view: ThreeView, ctx: ViewContext, config: SkyMeshConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  getPassKey(): "opaque" | "skyEnvMap" {
    if (this.config.sky?.envMap) {
      return "skyEnvMap";
    }
    return "opaque";
  }

  createMesh() {
    const skyOptions: SkyMeshOptions = this.config.sky ?? {};

    const skyMesh = new SkyMesh(skyOptions);
    skyMesh.raw.material.ellipsoid = this.view.atmosphere.ellipsoid;
    this._skyMesh = skyMesh;

    // Set up atmosphere integration. The sky shader samples the irradiance
    // texture only when a ground albedo is set, which SkyMesh never does.
    this.view.atmosphere.onTexturesReady((t) => skyMesh.setTextures(t), {
      transmittance: true,
      scattering: true,
      higherOrderScattering: true,
    });
    skyMesh.setShadowLengthHandler(this.view.atmosphere.shadowLength);

    skyMesh.on("needsUpdate", () => this.emit("needsUpdate"));

    return skyMesh;
  }

  onUpdateConfig(updates: SkyMeshUpdate): void {
    super.onUpdateConfig(updates);

    if (this.config.sky && updates.sky && this._skyMesh) {
      Object.assign(this.config.sky, updates.sky);

      if (updates.sky.envMap !== undefined) {
        this.config.sky.envMap = updates.sky.envMap;
        this.onPassKeyChange();
        this._skyMesh.sun = this.config.sky.sun ?? !updates.sky.envMap;
        this._skyMesh.moon = this.config.sky.moon ?? !updates.sky.envMap;
      }

      // Update individual properties
      if (updates.sky.sun !== undefined) {
        this._skyMesh.sun = updates.sky.sun;
      }
      if (updates.sky.moon !== undefined) {
        this._skyMesh.moon = updates.sky.moon;
      }
      if (updates.sky.moonScale !== undefined) {
        this._skyMesh.moonScale = updates.sky.moonScale;
      }
      if (updates.sky.moonIntensity !== undefined) {
        this._skyMesh.moonIntensity = updates.sky.moonIntensity;
      }
      if (updates.sky.sunAngularRadius !== undefined) {
        this._skyMesh.sunAngularRadius = updates.sky.sunAngularRadius;
      }
    }
  }

  update(_time: number): void {
    if (this._skyMesh) {
      // Update sun and moon directions from atmosphere
      this._skyMesh.updateSunDirection(this.view.atmosphere.getSunDirection());
      this._skyMesh.updateMoonDirection(
        this.view.atmosphere.getMoonDirection(),
      );
    }
  }

  protected disposeMesh(): void {
    if (this._skyMesh) {
      this._skyMesh.dispose();
      this._skyMesh = null;
    }
    if (this._instance) {
      this._instance = undefined;
    }
  }

  getSkyMesh(): SkyMesh | null {
    return this._skyMesh;
  }
}
