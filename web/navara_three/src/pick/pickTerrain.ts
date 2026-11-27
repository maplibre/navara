import type { Nullable } from "@navaramap/core";
import {
  WebGLRenderer,
  WebGLRenderTarget,
  Vector2,
  Vector3,
  Vector4,
  PerspectiveCamera,
  Scene,
  RGBAFormat,
  Texture,
  ShaderMaterial,
  PlaneGeometry,
  Mesh,
  OrthographicCamera,
  FloatType,
  UnsignedByteType,
} from "three";

class DepthPickPass {
  private quad: Mesh;
  private scene: Scene;
  private camera: OrthographicCamera;
  private sampleTarget: WebGLRenderTarget;
  private material: ShaderMaterial;

  /**
   * @param floatDepth - The sampled depth copy holds floats (a reversed
   * depth); the sample is then read back as a float instead of RGBA bytes.
   */
  constructor(private readonly floatDepth: boolean) {
    // Create reusable resources
    this.material = new ShaderMaterial({
      uniforms: {
        tDepth: { value: null },
        samplePos: { value: new Vector2() },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDepth;
        uniform vec2 samplePos;
        varying vec2 vUv;
        
        void main() {
          vec4 depthColor = texture2D(tDepth, samplePos);
          gl_FragColor = depthColor;
        }
      `,
      // A copy: a fresh depth buffer holds 1.0, which a reversed depth test
      // rejects the quad against.
      depthTest: false,
      depthWrite: false,
    });

    const geometry = new PlaneGeometry(2, 2);
    this.quad = new Mesh(geometry, this.material);

    this.scene = new Scene();
    this.scene.add(this.quad);

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.sampleTarget = new WebGLRenderTarget(1, 1, {
      format: RGBAFormat,
      type: floatDepth ? FloatType : UnsignedByteType,
      depthBuffer: false,
    });
  }

  update(depthTexture: Texture, samplePos: Vector2) {
    this.material.uniforms.tDepth.value = depthTexture;
    this.material.uniforms.samplePos.value.copy(samplePos);
  }

  private renderSample(renderer: WebGLRenderer) {
    renderer.setRenderTarget(this.sampleTarget);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
  }

  private createPixels(): Uint8Array | Float32Array {
    return this.floatDepth ? new Float32Array(4) : new Uint8Array(4);
  }

  render(renderer: WebGLRenderer): Uint8Array | Float32Array {
    this.renderSample(renderer);

    const pixels = this.createPixels();
    renderer.readRenderTargetPixels(this.sampleTarget, 0, 0, 1, 1, pixels);

    return pixels;
  }

  /**
   * Same as {@link render} but reads the pixel back through a PBO + fence
   * sync, so the CPU never waits on the GPU. The sample is captured into the
   * PBO before this returns, so later renders into the sample target don't
   * affect the result.
   */
  renderAsync(renderer: WebGLRenderer): Promise<Uint8Array | Float32Array> {
    this.renderSample(renderer);

    const pixels = this.createPixels();
    return renderer.readRenderTargetPixelsAsync(
      this.sampleTarget,
      0,
      0,
      1,
      1,
      pixels,
    ) as Promise<Uint8Array | Float32Array>;
  }

  dispose() {
    this.quad.geometry.dispose();
    this.material.dispose();
    this.sampleTarget.dispose();
  }
}

/** How the renderer's depth buffer encodes depth. */
export type DepthEncoding = "reversed" | "logarithmic" | "standard";

export class TerrainPicker {
  private depthPickPass: DepthPickPass;

  /**
   * @param depthEncoding - The renderer's depth convention. The depth copies
   * of a reversed depth hold floats; the others are RGBA-packed.
   */
  constructor(private readonly depthEncoding: DepthEncoding = "standard") {
    this.depthPickPass = new DepthPickPass(depthEncoding === "reversed");
  }

  /**
   * Reads the depth under a pointer and reconstructs its world position.
   * `clientX`/`clientY` are client coordinates (`MouseEvent.clientX/clientY`);
   * on a canvas without a client rect (an `OffscreenCanvas`) they are taken as
   * canvas-relative.
   */
  pick(
    clientX: number,
    clientY: number,
    renderer: WebGLRenderer,
    depthTexture: Texture,
    camera: PerspectiveCamera,
  ): Nullable<Vector3> {
    if (!depthTexture) {
      return null;
    }
    const [x, y] = this._toCanvas(clientX, clientY, renderer);
    this._prepareSample(x, y, renderer, depthTexture);
    return this._positionFromSample(
      this.depthPickPass.render(renderer),
      x,
      y,
      renderer,
      camera,
    );
  }

  /**
   * Non-blocking variant of {@link pick}: the depth sample is captured now
   * from the current depth texture, but the result resolves once the GPU has
   * finished, typically a frame or two later. The camera pose used for the
   * reconstruction is the one at call time.
   */
  async pickAsync(
    clientX: number,
    clientY: number,
    renderer: WebGLRenderer,
    depthTexture: Texture,
    camera: PerspectiveCamera,
  ): Promise<Nullable<Vector3>> {
    if (!depthTexture) {
      return null;
    }
    const [x, y] = this._toCanvas(clientX, clientY, renderer);
    this._prepareSample(x, y, renderer, depthTexture);
    const pending = this.depthPickPass.renderAsync(renderer);
    // Snapshot the pose before awaiting: the camera keeps moving while the
    // readback is in flight.
    const cameraSnapshot = camera.clone();
    return this._positionFromSample(
      await pending,
      x,
      y,
      renderer,
      cameraSnapshot,
    );
  }

  private _toCanvas(
    clientX: number,
    clientY: number,
    renderer: WebGLRenderer,
  ): [number, number] {
    const canvas: HTMLCanvasElement | OffscreenCanvas = renderer.domElement;
    if (!("getBoundingClientRect" in canvas)) return [clientX, clientY];
    const rect = canvas.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }

  private _positionFromSample(
    sample: Uint8Array | Float32Array,
    x: number,
    y: number,
    renderer: WebGLRenderer,
    camera: PerspectiveCamera,
  ): Nullable<Vector3> {
    // Nothing was drawn at the far plane (nvr_isFarDepth in
    // chunks/depth_convention). Reversed, it is exactly 0. Standard, it is 1
    // less the packed copy's precision: almost every surface is above 0.99
    // there. Logarithmic keeps the margin it always had.
    if (this.depthEncoding === "reversed") {
      if (sample[0] <= 0) return null;
      return this._reconstructWorldPosition(x, y, sample[0], renderer, camera);
    }
    const logDepthOrDepth = this._unpackRGBAToDepth(sample);
    const farDepth =
      this.depthEncoding === "logarithmic" ? 0.99 : 1 - 1 / 8388608;
    if (logDepthOrDepth >= farDepth) {
      return null;
    }

    return this._reconstructWorldPosition(
      x,
      y,
      logDepthOrDepth,
      renderer,
      camera,
    );
  }

  // Ref: https://github.com/mrdoob/three.js/blob/f38421e7bf5bc37aac7d4ebbe66ad0cc15550c39/src/renderers/shaders/ShaderChunk/packing.glsl.js#L56-L58
  private _unpackRGBAToDepth(rgba: Uint8Array | Float32Array): number {
    // Constants
    const UnpackDownscale = 255 / 256; // 0..1 -> fraction (excluding 1)
    const PackFactors = [1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0];

    // Calculate unpack factors
    const UnpackFactors4 = [
      UnpackDownscale / PackFactors[0],
      UnpackDownscale / PackFactors[1],
      UnpackDownscale / PackFactors[2],
      1.0 / PackFactors[3],
    ];

    // readRenderTargetPixels returns bytes 0..255; a GLSL texel channel is byte / 255.
    return (
      (rgba[0] / 255.0) * UnpackFactors4[0] +
      (rgba[1] / 255.0) * UnpackFactors4[1] +
      (rgba[2] / 255.0) * UnpackFactors4[2] +
      (rgba[3] / 255.0) * UnpackFactors4[3]
    );
  }

  // Clamped device-pixel center for a canvas-relative CSS-pixel coordinate.
  // Sampling and ray reconstruction must both use this exact point: the depth
  // copy target is linearly filtered, and any off-center coordinate would
  // blend neighboring packed-RGBA texels into meaningless depth values.
  private _texelCenter(cssCoord: number, size: number, pixelRatio: number) {
    return (
      Math.max(0, Math.min(size - 1, Math.floor(cssCoord * pixelRatio))) + 0.5
    );
  }

  // Points the depth pick pass at the texel under the given canvas-relative
  // position.
  private _prepareSample(
    x: number,
    y: number,
    renderer: WebGLRenderer,
    depthTexture: Texture,
  ) {
    const width = renderer.getContext().drawingBufferWidth;
    const height = renderer.getContext().drawingBufferHeight;
    const pixelRatio = renderer.getPixelRatio();

    const centerX = this._texelCenter(x, width, pixelRatio);
    const centerY = this._texelCenter(y, height, pixelRatio);

    const samplePos = new Vector2(centerX / width, 1.0 - centerY / height); // Flip Y
    this.depthPickPass.update(depthTexture, samplePos);
  }

  dispose() {
    this.depthPickPass.dispose();
  }

  private _reconstructWorldPosition(
    x: number,
    y: number,
    depth: number,
    renderer: WebGLRenderer,
    camera: PerspectiveCamera,
  ): Vector3 {
    const near = camera.near;
    const far = camera.far;

    const width = renderer.getContext().drawingBufferWidth;
    const height = renderer.getContext().drawingBufferHeight;
    const pixelRatio = renderer.getPixelRatio();

    // Convert the sampled texel's center to NDC [-1,1], so the reconstructed
    // ray goes through the exact pixel whose depth was read.
    const screenCoords = new Vector2(
      (this._texelCenter(x, width, pixelRatio) / width) * 2.0 - 1.0,
      -((this._texelCenter(y, height, pixelRatio) / height) * 2.0 - 1.0),
    );

    let clipCoords: Vector4;

    if (this.depthEncoding === "logarithmic") {
      const logDepthBufFC = 2.0 / Math.log2(far + 1.0);

      const linearDepth = Math.pow(2, depth / (logDepthBufFC * 0.5)) - 1.0;
      const depthFromCamera = linearDepth + near;

      clipCoords = new Vector4(
        screenCoords.x,
        screenCoords.y,
        depth * 2.0 - 1.0, // Convert depth [0,1] to NDC [-1,1]
        1.0,
      );

      const eyeCoordinate = clipCoords
        .clone()
        .applyMatrix4(camera.projectionMatrixInverse);

      if (eyeCoordinate.w !== 0) {
        eyeCoordinate.divideScalar(eyeCoordinate.w);
      }

      // For logarithmic depth, we need to scale the eye coordinate by the actual depth
      const eyeZ = -depthFromCamera; // Negative because camera looks down -Z
      const scaleFactor = eyeZ / eyeCoordinate.z;
      eyeCoordinate.x *= scaleFactor;
      eyeCoordinate.y *= scaleFactor;
      eyeCoordinate.z = eyeZ;

      // Transform to world space
      return new Vector3(
        eyeCoordinate.x,
        eyeCoordinate.y,
        eyeCoordinate.z,
      ).applyMatrix4(camera.matrixWorld);
    } else {
      // Standard or reversed depth: NDC z is the depth in [0, 1] when
      // reversed, and spans [-1, 1] otherwise.
      clipCoords = new Vector4(
        screenCoords.x,
        screenCoords.y,
        this.depthEncoding === "reversed" ? depth : depth * 2.0 - 1.0,
        1.0,
      );

      // Transform to eye coordinates
      const eyeCoordinate = clipCoords
        .clone()
        .applyMatrix4(camera.projectionMatrixInverse);
      eyeCoordinate.divideScalar(eyeCoordinate.w);

      // Transform to world space
      return new Vector3(
        eyeCoordinate.x,
        eyeCoordinate.y,
        eyeCoordinate.z,
      ).applyMatrix4(camera.matrixWorld);
    }
  }
}
