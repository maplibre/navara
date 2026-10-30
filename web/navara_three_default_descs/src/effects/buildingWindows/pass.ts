import {
  NORMAL_PACKING_SHADER,
  createFullscreenQuad,
  type MRTPassEffectDesc,
} from "@navaramap/three";
import BuildingWindowsFragment from "@shaders/glsl/buildingWindows.frag.glsl?raw";
import SelectiveEffectMaskChunk from "@shaders/glsl/chunks/selective_effect_mask.glsl?raw";
import { depth as DepthChunk } from "@takram/three-geospatial/shaders";
import { Pass as PostProcessingPass } from "postprocessing";
import {
  type DataTexture,
  Matrix3,
  Matrix4,
  Mesh,
  type OrthographicCamera,
  type PerspectiveCamera,
  type PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from "three";

import type { BuildingWindowsEffectDesc } from "../BuildingWindowsEffectDesc";

import {
  CELLS,
  LIT_LEVELS,
  MAX_BRIGHTNESS,
  createWindowTexture,
} from "./atlas";
import { DEFAULT_BUILDING_WINDOWS_OPTIONS } from "./options";
import { WorldAnchor } from "./worldAnchor";

const EARTH_RADIUS = 6371000;

const vertexShader = /* glsl */ `
varying vec2 nvrUv;
void main() {
  nvrUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
#include <packing>
${NORMAL_PACKING_SHADER}
${SelectiveEffectMaskChunk}
${DepthChunk}
${BuildingWindowsFragment}
`;

/**
 * Fullscreen pass that pastes the window atlas on walls, run after the MRT
 * pass so the G-buffer (normal, depth, effect ids) is complete.
 */
export class BuildingWindowsPass extends PostProcessingPass {
  private readonly desc: BuildingWindowsEffectDesc;
  // `camera` is taken by the postprocessing base class.
  private readonly viewCamera: PerspectiveCamera;
  private readonly mrt: MRTPassEffectDesc;
  private readonly material: ShaderMaterial;
  private readonly windowTexture: DataTexture;
  private readonly quadScene = new Scene();
  private readonly quadCamera: OrthographicCamera;
  private readonly quadGeometry: PlaneGeometry;
  private readonly anchor = new WorldAnchor();
  private readonly cameraPosition = new Vector3();

  constructor(
    desc: BuildingWindowsEffectDesc,
    camera: PerspectiveCamera,
    mrt: MRTPassEffectDesc,
  ) {
    super("BuildingWindowsPass");
    this.desc = desc;
    this.viewCamera = camera;
    this.mrt = mrt;

    const quad = createFullscreenQuad();
    this.quadCamera = quad.camera;
    this.quadGeometry = quad.geometry;
    this.windowTexture = createWindowTexture();

    const defaults = DEFAULT_BUILDING_WINDOWS_OPTIONS;
    this.material = new ShaderMaterial({
      defines: {
        NVR_EARTH_RADIUS: EARTH_RADIUS.toFixed(1),
        NVR_CELLS: CELLS.toFixed(1),
        NVR_MAX_BRIGHTNESS: MAX_BRIGHTNESS.toFixed(2),
        NVR_LIT_LEVEL_0: LIT_LEVELS[0].toFixed(2),
        NVR_LIT_LEVEL_1: LIT_LEVELS[1].toFixed(2),
        NVR_LIT_LEVEL_2: LIT_LEVELS[2].toFixed(2),
        NVR_LIT_LEVEL_3: LIT_LEVELS[3].toFixed(2),
      },
      uniforms: {
        nvrDiffuse: { value: null },
        nvrEffectIds: { value: null },
        nvrNormal: { value: null },
        nvrDepth: { value: null },
        nvrWindows: { value: this.windowTexture },
        nvrSlot: { value: 0 },
        nvrCameraNear: { value: 1 },
        nvrCameraFar: { value: 1 },
        nvrInverseProjection: { value: new Matrix4() },
        nvrCameraRotation: { value: new Matrix3() },
        nvrEast: { value: this.anchor.east },
        nvrNorth: { value: this.anchor.north },
        nvrUp: { value: this.anchor.up },
        nvrCameraFromOrigin: { value: this.anchor.cameraFromOrigin },
        nvrLitRatio: { value: defaults.litRatio },
        nvrFloorHeight: { value: defaults.floorHeight },
        nvrColumnWidth: { value: defaults.columnWidth },
        nvrIntensity: { value: defaults.intensity },
        nvrGroundHeight: { value: defaults.groundHeight },
        nvrPixelAngle: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new Mesh(this.quadGeometry, this.material));
  }

  render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget,
    outputBuffer: WebGLRenderTarget,
  ): void {
    const uniforms = this.material.uniforms;
    const camera = this.viewCamera;
    const desc = this.desc;
    const options = desc.options;

    this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    this.anchor.update(this.cameraPosition, () => desc.getCameraHeight());

    uniforms.nvrDiffuse.value = inputBuffer.texture;
    uniforms.nvrEffectIds.value = desc.getEffectIdsBuffer();
    // Re-read every frame: a G-buffer config change rebuilds the attachments.
    uniforms.nvrNormal.value = this.mrt.normalBuffer;
    uniforms.nvrDepth.value = this.mrt.depthBuffer;
    uniforms.nvrCameraNear.value = camera.near;
    uniforms.nvrCameraFar.value = camera.far;
    uniforms.nvrInverseProjection.value.copy(camera.projectionMatrixInverse);
    uniforms.nvrCameraRotation.value.setFromMatrix4(camera.matrixWorld);
    uniforms.nvrLitRatio.value = options.litRatio;
    uniforms.nvrFloorHeight.value = options.floorHeight;
    uniforms.nvrColumnWidth.value = options.columnWidth;
    uniforms.nvrGroundHeight.value = options.groundHeight;
    // Passthrough while the effect has no slot yet, as the other selective
    // effects do.
    const slot = desc.getEffectSlot();
    uniforms.nvrSlot.value = Math.max(0, slot);
    uniforms.nvrIntensity.value = slot < 0 ? 0 : options.intensity;
    uniforms.nvrPixelAngle.value =
      (2 * Math.tan((camera.fov * Math.PI) / 360)) / inputBuffer.height;

    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.quadScene.clear();
    this.quadGeometry.dispose();
    this.windowTexture.dispose();
    this.material.dispose();
  }
}
