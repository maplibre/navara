import type ThreeView from "@navaramap/three";
import {
  Color,
  MeshDesc,
  type MeshConfig,
  type ViewContext,
  type MeshUpdate,
} from "@navaramap/three";
import SkyBoxFS from "@shaders/glsl/skyBox.frag.glsl";
import SkyBoxVS from "@shaders/glsl/skyBox.vert.glsl";
import {
  BufferGeometry,
  BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector3,
  Vector4,
} from "three";

type Description = {
  skyBox?: {
    dayColor?: Color;
    nightColor?: Color;
    sunColor?: Color;
  };
};

export type SkyBoxMeshConfig = MeshConfig & Description;

export type SkyBoxMeshUpdate = MeshUpdate & Description;

export const DEFAULT_SKY_BOX_OPTIONS: Required<
  NonNullable<Description["skyBox"]>
> = {
  dayColor: new Color().setHex(0x92c1ff), // light blue
  nightColor: new Color().setHex(0x000033), // dark blue
  sunColor: new Color().setHex(0xffddae), // light orange
};

export class SkyBoxMeshDesc extends MeshDesc<
  SkyBoxMeshConfig,
  SkyBoxMeshUpdate,
  Mesh<BufferGeometry, ShaderMaterial>
> {
  private config: SkyBoxMeshConfig;
  constructor(view: ThreeView, ctx: ViewContext, config: SkyBoxMeshConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  createMesh() {
    const cfg = { ...DEFAULT_SKY_BOX_OPTIONS, ...this.config.skyBox };

    // Create geometry from parameters
    const geometry = new BufferGeometry();

    // vector positions for a single large triangle filling clip space
    const vertices = new Float32Array([
      -1.0,
      -1.0,
      1.0, // v0
      3.0,
      -1.0,
      1.0, // v1
      -1.0,
      3.0,
      1.0, // v2
    ]);

    geometry.setAttribute("position", new BufferAttribute(vertices, 3));

    // Create material from properties
    const material = new ShaderMaterial();
    material.vertexShader = SkyBoxVS;
    material.fragmentShader = SkyBoxFS;
    material.transparent = true;
    material.premultipliedAlpha = true;

    const dayColor = cfg.dayColor.toArray();
    const nightColor = cfg.nightColor.toArray();
    const sunColor = cfg.sunColor.toArray();
    const sunDirection = this.view.atmosphere.sunDirection;
    const sunDirView = new Vector4(
      sunDirection.x,
      sunDirection.y,
      sunDirection.z,
      0,
    ).applyMatrix4(this.view.camera.raw.matrixWorldInverse);

    material.uniforms = {
      uDayColor: {
        value: new Vector3(dayColor[0], dayColor[1], dayColor[2]),
      },
      uNightColor: {
        value: new Vector3(nightColor[0], nightColor[1], nightColor[2]),
      },
      uSunColor: {
        value: new Vector3(sunColor[0], sunColor[1], sunColor[2]),
      },
      uSunDirection: {
        value: sunDirection,
      },
      uSunDirView: {
        value: new Vector3(sunDirView.x, sunDirView.y, sunDirView.z),
      },
    };

    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  onUpdateConfig(updates: SkyBoxMeshUpdate): void {
    if (updates.skyBox && this._instance) {
      const cfg = updates.skyBox;
      const origin = this.config.skyBox;

      const material = this._instance.material as ShaderMaterial;
      if (cfg.dayColor !== undefined) {
        const dayColorArray = cfg.dayColor.toArray();
        material.uniforms["uDayColor"].value = new Vector3(
          dayColorArray[0],
          dayColorArray[1],
          dayColorArray[2],
        );
      }

      if (cfg.nightColor !== undefined) {
        const nightColorArray = cfg.nightColor.toArray();
        material.uniforms["uNightColor"].value = new Vector3(
          nightColorArray[0],
          nightColorArray[1],
          nightColorArray[2],
        );
      }

      if (cfg.sunColor !== undefined) {
        const sunColorArray = cfg.sunColor.toArray();
        material.uniforms["uSunColor"].value = new Vector3(
          sunColorArray[0],
          sunColorArray[1],
          sunColorArray[2],
        );
      }

      // Update the stored config with the new values
      if (origin) {
        Object.assign(origin, cfg);
      }

      this.emit("needsUpdate");
    }

    super.onUpdateConfig(updates);
  }

  update(_time: number): void {
    if (!this._instance) return;

    // Update sun direction uniform
    const material = this._instance.material as ShaderMaterial;
    const v = new Vector4(
      this.view.atmosphere.sunDirection.x,
      this.view.atmosphere.sunDirection.y,
      this.view.atmosphere.sunDirection.z,
      0,
    ).applyMatrix4(this.view.camera.raw.matrixWorldInverse);

    material.uniforms["uSunDirView"].value = new Vector3(v.x, v.y, v.z);

    this.emit("needsUpdate");
  }

  protected disposeMesh(): void {
    if (this._instance) {
      this._instance.geometry.dispose();
      this._instance.material.dispose();

      this._instance = undefined;
    }
  }
}
