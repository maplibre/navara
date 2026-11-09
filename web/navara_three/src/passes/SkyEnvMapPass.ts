import { scaleToGeodeticSurface } from "@navaramap/three-api";
import {
  type Camera,
  CubeCamera,
  HalfFloatType,
  Vector3,
  WebGLCubeRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";

import { RenderPass } from "../effects";
import type { Scenes } from "../scene";

/**
 * Camera travel, as a share of its height above the ellipsoid, after which the
 * faces refreshed one per frame would no longer agree: the whole cube is
 * rendered again from the new position.
 */
const MAX_TRAVEL_PER_HEIGHT = 0.05;
/**
 * Height floor for that travel, in meters, so a camera near the surface does
 * not render the whole cube every few meters.
 */
const MIN_TRAVEL_HEIGHT = 100;

export class SkyEnvMapPass extends RenderPass {
  private _scenes: Scenes;
  private _camera: PerspectiveCamera;
  private cubeCamera: CubeCamera;
  public cubeRenderTarget: WebGLCubeRenderTarget;
  /** Next face to refresh, or `undefined` when the whole cube is due. */
  private nextFace: number | undefined;
  /** Camera position of the last full cube update. */
  private readonly fullUpdatePosition = new Vector3();

  constructor(scenes: Scenes, camera: PerspectiveCamera, resolution = 64) {
    super();

    this._scenes = scenes;
    this._camera = camera;

    this.cubeRenderTarget = new WebGLCubeRenderTarget(resolution, {
      generateMipmaps: true,
      type: HalfFloatType,
    });

    this.cubeCamera = new CubeCamera(0.1, 1000, this.cubeRenderTarget);
  }

  render(
    renderer: WebGLRenderer,
    _inputBuffer: WebGLRenderTarget | null,
    _outputBuffer: WebGLRenderTarget | null,
  ) {
    // Nothing requests the env map (no sky mesh with `envMap` enabled), so skip
    // the expensive 6-face cube render entirely.
    if (this._scenes.skyEnvMap.children.length === 0) {
      this.nextFace = undefined;
      return;
    }

    const position = this._camera.position;
    this.cubeCamera.position.copy(position);

    if (this.nextFace === undefined || this.travelledTooFar(position)) {
      this.cubeCamera.update(renderer, this._scenes.skyEnvMap);
      this.fullUpdatePosition.copy(position);
      this.nextFace = 0;
      return;
    }
    // The sky changes slowly, so one face per frame is enough and spreads the
    // six-face cost over six frames.
    this.renderFace(renderer, this.nextFace);
    this.nextFace = (this.nextFace + 1) % 6;
  }

  /**
   * Renders the whole cube on the next frame, for a sky change that brings
   * only a frame or two (an atmosphere texture arriving).
   */
  invalidate = () => {
    this.nextFace = undefined;
  };

  private travelledTooFar(position: Vector3): boolean {
    const height = scaleToGeodeticSurface(position)?.distanceTo(position) ?? 0;
    return (
      position.distanceTo(this.fullUpdatePosition) >
      MAX_TRAVEL_PER_HEIGHT * Math.max(height, MIN_TRAVEL_HEIGHT)
    );
  }

  /** One face of `CubeCamera.update`; the mipmaps follow the last face. */
  private renderFace(renderer: WebGLRenderer, face: number) {
    const target = this.cubeRenderTarget;
    this.cubeCamera.updateMatrixWorld();
    const currentRenderTarget = renderer.getRenderTarget();
    const currentActiveCubeFace = renderer.getActiveCubeFace();
    const currentActiveMipmapLevel = renderer.getActiveMipmapLevel();
    const generateMipmaps = target.texture.generateMipmaps;
    const lastFace = face === 5;
    target.texture.generateMipmaps = generateMipmaps && lastFace;

    renderer.setRenderTarget(target, face);
    // Each face needs its own depth clear under a reversed depth buffer, as in
    // `CubeCamera.update`.
    if (renderer.state.buffers.depth.getReversed() && !renderer.autoClear) {
      renderer.clearDepth();
    }
    renderer.render(
      this._scenes.skyEnvMap,
      this.cubeCamera.children[face] as Camera,
    );

    target.texture.generateMipmaps = generateMipmaps;
    renderer.setRenderTarget(
      currentRenderTarget,
      currentActiveCubeFace,
      currentActiveMipmapLevel,
    );
    if (lastFace) target.texture.needsPMREMUpdate = true;
  }

  getEnvMapTexture(): WebGLCubeRenderTarget["texture"] | undefined {
    // Don't hand a stale/cleared cube texture to meshes when nothing populates
    // the env map scene; callers fall back to `null`.
    if (this._scenes.skyEnvMap.children.length === 0) return undefined;

    return this.cubeRenderTarget.texture;
  }

  dispose() {
    this.cubeRenderTarget.dispose();
  }
}
