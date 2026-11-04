import type ThreeView from "@navaramap/three";
import {
  MeshDesc,
  type MeshConfig,
  type MeshUpdate,
  type ViewContext,
} from "@navaramap/three";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
} from "three";

/** Per-car segments, as ECEF offsets from a shared origin. */
export type StreetTrafficData = {
  start: Float32Array;
  end: Float32Array;
  phase: Float32Array;
  speed: Float32Array;
};

export type StreetTrafficOptions = {
  /**
   * Multiplier on every car's speed.
   * @defaultValue 1
   */
  speed?: number;
  /**
   * Diameter of a car's light in meters.
   * @defaultValue 2.5
   */
  size?: number;
};

type StreetTrafficDescription = {
  data: StreetTrafficData;
} & StreetTrafficOptions;

type Description = {
  streetTraffic?: StreetTrafficDescription;
};

export type StreetTrafficMeshConfig = MeshConfig & Description;

export type StreetTrafficMeshUpdate = MeshUpdate & {
  streetTraffic?: StreetTrafficOptions;
};

/** Descriptions `StreetLightsPlugin` registers; add to the view's type parameter. */
export type StreetTrafficDescriptions = { mesh: StreetTrafficMeshConfig };

const DEFAULTS: Required<StreetTrafficOptions> = {
  speed: 1,
  size: 2.5,
};

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 nvrEnd;
attribute float nvrPhase;
attribute float nvrSpeed;

uniform float nvrTime;
uniform float nvrSpeedScale;
uniform float nvrSize;
uniform vec3 nvrViewport;
uniform float nvrTanHalfFov;

varying vec3 nvrColor;
varying float nvrFade;

const vec3 NVR_HEADLIGHT = vec3(1.0, 0.97, 0.9);
const vec3 NVR_TAILLIGHT = vec3(1.0, 0.15, 0.08);

void main() {
  vec3 along = nvrEnd - position;
  float segmentLength = max(length(along), 0.001);
  float t = fract(nvrPhase + nvrTime * nvrSpeed * nvrSpeedScale / segmentLength);
  // modelViewMatrix is built on the CPU, so the kilometers-scale offsets of
  // the origin never meet float32 here.
  vec4 mvPosition = modelViewMatrix * vec4(position + along * t, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Headlights toward the camera, taillights away from it.
  vec3 directionView = normalize((modelViewMatrix * vec4(along, 0.0)).xyz);
  float facing = dot(directionView, normalize(-mvPosition.xyz));
  nvrColor = mix(NVR_TAILLIGHT, NVR_HEADLIGHT, smoothstep(-0.15, 0.15, facing));

  // Ease in and out at the segment ends instead of popping.
  nvrFade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.92, 1.0, t));

  float pixelsPerMeter = (nvrViewport.y * nvrViewport.z * 0.5) / (nvrTanHalfFov * -mvPosition.z);
  float sizePx = nvrSize * pixelsPerMeter;
  gl_PointSize = clamp(sizePx, 1.0, 24.0);
  // Sub-pixel cars dim out instead of piling up as fixed-size dots.
  nvrFade *= smoothstep(0.3, 2.0, sizePx);

  #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <logdepthbuf_pars_fragment>

varying vec3 nvrColor;
varying float nvrFade;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float soft = 1.0 - smoothstep(0.5, 1.0, d);
  gl_FragColor = vec4(nvrColor * soft * nvrFade, 1.0);
  #include <logdepthbuf_fragment>
}
`;

/**
 * Street traffic: one point per car, each driving its road segment on the GPU
 * and wrapping around. Headlights face the camera white, taillights red.
 * Registered by `StreetLightsPlugin`, which also builds the car data.
 */
export class StreetTrafficMeshDesc extends MeshDesc<
  StreetTrafficMeshConfig,
  StreetTrafficMeshUpdate,
  Points<BufferGeometry, ShaderMaterial>
> {
  static key = "streetTraffic";

  private readonly traffic: StreetTrafficDescription;

  constructor(
    view: ThreeView,
    ctx: ViewContext,
    config: StreetTrafficMeshConfig,
  ) {
    if (!config.streetTraffic) {
      throw new Error("StreetTrafficMesh configuration is required");
    }
    super(view, ctx, config);
    this.traffic = config.streetTraffic;
  }

  private get options(): Required<StreetTrafficOptions> {
    const { speed, size } = this.traffic;
    return { speed: speed ?? DEFAULTS.speed, size: size ?? DEFAULTS.size };
  }

  createMesh() {
    const { data } = this.traffic;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(data.start, 3));
    geometry.setAttribute("nvrEnd", new BufferAttribute(data.end, 3));
    geometry.setAttribute("nvrPhase", new BufferAttribute(data.phase, 1));
    geometry.setAttribute("nvrSpeed", new BufferAttribute(data.speed, 1));

    // Stays in the default opaque pass, which is forward-rendered after the
    // G-buffer copy: the lights need no normals or effect ids, so the
    // material does not opt in to MRT.
    const material = new ShaderMaterial({
      uniforms: {
        nvrTime: { value: 0 },
        nvrSpeedScale: { value: this.options.speed },
        nvrSize: { value: this.options.size },
        nvrViewport: this.ctx.getViewportAndPixelRatioUniform(),
        nvrTanHalfFov: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      // Additive so the soft edges add light instead of cutting dark discs.
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });

    const points = new Points(geometry, material);
    // Cars cover kilometers; the set as a whole is always partly in view.
    points.frustumCulled = false;
    return points;
  }

  update(time: number): void {
    if (!this._instance) return;
    const uniforms = this._instance.material.uniforms;
    uniforms.nvrTime.value = time / 1000;
    uniforms.nvrTanHalfFov.value = Math.tan(
      (this.view.camera.raw.fov * Math.PI) / 360,
    );
  }

  onUpdateConfig(updates: StreetTrafficMeshUpdate): void {
    super.onUpdateConfig(updates);
    Object.assign(this.traffic, updates.streetTraffic);
    if (!this._instance) return;
    const uniforms = this._instance.material.uniforms;
    uniforms.nvrSpeedScale.value = this.options.speed;
    uniforms.nvrSize.value = this.options.size;
  }

  override onDestroy(): void {
    // Must run before `super.onDestroy()`, which clears `_instance`. The
    // viewport uniform is the view's and stays alive.
    if (this._instance) {
      this._instance.geometry.dispose();
      this._instance.material.dispose();
    }
    super.onDestroy();
  }
}
