import {
  createReplacer,
  calcCameraPosition,
  calcModelMatrixRTE,
  encodePositionRTE,
  RTE_ONE_UNIFORM,
} from "@navaramap/three";
import GBufferParsFragment from "@shaders/glsl/chunks/gbuffer_pars_fragment.glsl";
import RteParsVertex from "@shaders/glsl/chunks/rte_pars_vertex.glsl";
import RteVertex from "@shaders/glsl/chunks/rte_vertex.glsl";
import { packing } from "@takram/three-geospatial/shaders";
import {
  BufferGeometry,
  BufferAttribute,
  Vector3,
  Vector2,
  Camera,
  ShaderMaterial,
  Points,
  Color,
  PerspectiveCamera,
  WebGLRenderer,
  Scene,
  Matrix4,
} from "three";

export type SpherePointOptions = {
  visible?: boolean;
  size?: number;
  color?: number;
};

/**
 * Renders points as spheres using impostor technique with RTE (Relative-To-Eye) support.
 */
export class SpherePoints extends Points {
  public pointOpts: Required<SpherePointOptions>;

  // RTE uniforms shared across renders
  private _rteUniforms = {
    modelViewMatrixRTE: { value: new Matrix4() },
    cameraPositionHigh: { value: new Vector3() },
    cameraPositionLow: { value: new Vector3() },
  };

  // Temporary matrix for RTE calculations (reused to avoid allocations)
  private _identityMatrix = new Matrix4();

  constructor(opts: SpherePointOptions = {}) {
    // Create initial empty geometry and material
    const geometry = new BufferGeometry();
    const material = new ShaderMaterial();

    super(geometry, material);

    this.pointOpts = {
      visible: opts.visible ?? true,
      size: opts.size ?? 1,
      color: opts.color ?? 0xffffff,
    };
  }

  setPoints(points: Vector3[]) {
    this._refreshPoints(points);
  }

  setOptions(patch: Partial<SpherePointOptions>) {
    Object.assign(this.pointOpts, patch || {});
    this._refreshPointsUniforms();
    this.visible = this.pointOpts.visible;
  }

  onBeforeRender(renderer: WebGLRenderer, _scene: Scene, camera: Camera) {
    const mat = this.material as ShaderMaterial;
    if (!mat) return;

    const pixelRatio = renderer.getPixelRatio();
    const width = renderer.getContext().drawingBufferWidth;
    const height = renderer.getContext().drawingBufferHeight;

    if (mat.uniforms?.uProjScaleY)
      mat.uniforms.uProjScaleY.value = camera.projectionMatrix.elements[5];
    if (mat.uniforms?.uNear)
      mat.uniforms.uNear.value = (camera as PerspectiveCamera).near;
    if (mat.uniforms?.uFar)
      mat.uniforms.uFar.value = (camera as PerspectiveCamera).far;

    if (mat.uniforms?.uViewport) {
      mat.uniforms.uViewport.value.set(width, height);
    }

    if (mat.uniforms?.dpr) {
      mat.uniforms.dpr.value = pixelRatio;
    }

    // Update RTE uniforms (reuse class member matrix to avoid allocations)
    calcModelMatrixRTE(
      this._identityMatrix,
      camera.matrixWorldInverse,
      this._rteUniforms.modelViewMatrixRTE.value,
    );

    const result = calcCameraPosition(camera.position, this._identityMatrix);
    this._rteUniforms.cameraPositionHigh.value.copy(result.high);
    this._rteUniforms.cameraPositionLow.value.copy(result.low);
  }

  dispose() {
    this.geometry?.dispose();
    (this.material as ShaderMaterial)?.dispose();
  }

  private _ensurePointsGeometry(pointCount: number) {
    if (this.geometry) {
      this.geometry.dispose();
    }
    const geo = new BufferGeometry();
    geo.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(pointCount * 3), 3),
    );
    // Add RTE attributes
    geo.setAttribute(
      "position_3d_high",
      new BufferAttribute(new Float32Array(pointCount * 3), 3),
    );
    geo.setAttribute(
      "position_3d_low",
      new BufferAttribute(new Float32Array(pointCount * 3), 3),
    );
    this.geometry = geo;
  }

  private _updatePositionsAttr(points: Vector3[]) {
    if (!this.geometry) return;

    const pos = this.geometry.getAttribute("position") as BufferAttribute;
    const posHigh = this.geometry.getAttribute(
      "position_3d_high",
    ) as BufferAttribute;
    const posLow = this.geometry.getAttribute(
      "position_3d_low",
    ) as BufferAttribute;

    const rteHigh = new Vector3();
    const rteLow = new Vector3();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];

      // Encode position to RTE high/low components
      encodePositionRTE(p, rteHigh, rteLow);

      // Set RTE attributes
      posHigh.setXYZ(i, rteHigh.x, rteHigh.y, rteHigh.z);
      posLow.setXYZ(i, rteLow.x, rteLow.y, rteLow.z);

      // Also set standard position (sum of high + low) for bounding calculations
      pos.setXYZ(i, p.x, p.y, p.z);
    }

    pos.needsUpdate = true;
    posHigh.needsUpdate = true;
    posLow.needsUpdate = true;
  }

  private _makePointsMat(): ShaderMaterial {
    const mat = new ShaderMaterial({
      uniforms: {
        dpr: { value: 1 },
        uViewport: { value: new Vector2(0, 0) }, // set in onBeforeRender
        uColor: { value: new Color(this.pointOpts.color) },
        uProjScaleY: { value: 1.0 }, // set in onBeforeRender
        uNear: { value: 0.1 }, // set in onBeforeRender
        uFar: { value: 1000.0 }, // set in onBeforeRender
        uSize: { value: this.pointOpts.size }, // pixel diameter
        // RTE uniforms
        u_cameraPositionHigh: this._rteUniforms.cameraPositionHigh,
        u_cameraPositionLow: this._rteUniforms.cameraPositionLow,
        modelViewMatrixRTE: this._rteUniforms.modelViewMatrixRTE,
        u_rteOne: RTE_ONE_UNIFORM,
      },
      vertexShader: `
        precision highp float;
        uniform float dpr;
        uniform float uSize;

        ${RteParsVertex}

        varying vec3  vCenterView;
        varying float vRadiusPx;

        void main() {
          ${RteVertex}

          vec4 mv = modelViewMatrixRTE * vec4(transformed, 1.0);
          vCenterView = mv.xyz;

          gl_PointSize = uSize * dpr;        // pixel diameter
          vRadiusPx    = 0.5 * uSize * dpr;  // pixel radius for FS

          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        precision highp float;

        uniform vec2  uViewport;
        uniform vec3  uColor;
        uniform float uProjScaleY;
        uniform float uNear, uFar;

        varying vec3  vCenterView;
        varying float vRadiusPx;

        float viewZToDepth(float viewZ, float near, float far){
          #ifdef USE_REVERSED_DEPTH_BUFFER
            return near * (far + viewZ) / (-viewZ * (far - near));
          #endif
          float A = (far + near) / (near - far);
          float B = (2.0 * far * near) / (near - far);
          float ndcZ = (A * viewZ + B) / (-viewZ);
          return 0.5 * ndcZ + 0.5;
        }

        void main() {
          // round cutout
          vec2 corner = gl_PointCoord * 2.0 - 1.0;
          float rr = dot(corner, corner);
          if (rr > 1.0) discard;

          // pixel radius -> view-space radius of sphere
          float Rv = (vRadiusPx * 2.0 / (uProjScaleY * uViewport.y)) * (-vCenterView.z);

          // hemisphere z (unit sphere)
          float zLocal = sqrt(max(0.0, 1.0 - rr));

          // view-space z at hit point (only z is needed for depth)
          float Pz = vCenterView.z + zLocal * Rv;

          // write depth
          #if defined(USE_LOGDEPTHBUF) || defined(USE_LOGARITHMIC_DEPTH_BUFFER)
            if (vIsPerspective == 0.0) {
              gl_FragDepth = gl_FragCoord.z;
            } else {
              float fragDepth = max(1.0 + -Pz, 1e-6);
              gl_FragDepth = log2(fragDepth) * logDepthBufFC * 0.5;
            }
          #else
            gl_FragDepth = viewZToDepth(Pz, uNear, uFar);
          #endif

          // color
          gl_FragColor = vec4(uColor, 1.0);
        }
      `,
      transparent: false,
      depthTest: true,
      depthWrite: true,
    });

    // Add MRT support for sphere points material
    injectGBufferToSpherePointsMaterial(mat);

    return mat;
  }

  private _refreshPoints(points: Vector3[]) {
    if (!points.length) return;

    // ensure geometry matches count
    this._ensurePointsGeometry(points.length);

    // update attributes
    this._updatePositionsAttr(points);

    // dispose old material
    if (this.material) {
      (this.material as ShaderMaterial).dispose();
    }

    // create new material and assign
    const mat = this._makePointsMat();
    this.material = mat;
    this.visible = this.pointOpts.visible;
  }

  private _refreshPointsUniforms() {
    const mat = this.material as ShaderMaterial;
    if (!mat) return;
    if (mat.uniforms?.uColor)
      mat.uniforms.uColor.value.set(this.pointOpts.color);
    if (mat.uniforms?.uSize) mat.uniforms.uSize.value = this.pointOpts.size;
  }
}

function injectGBufferToSpherePointsMaterial(shader: ShaderMaterial) {
  // Vertex shader
  const common = "#include <common>";

  const logdepthParsVert = "#include <logdepthbuf_pars_vertex>";
  const logdepthVert = "#include <logdepthbuf_vertex>";

  shader.vertexShader = /* glsl */ `
    ${shader.vertexShader.includes(common) ? "" : common}
    ${shader.vertexShader.includes(logdepthParsVert) ? "" : logdepthParsVert}

    ${
      createReplacer(shader.vertexShader).replace(
        /}\s*$/, // Assume the last curly brace is of main()
        /* glsl */ `
          ${shader.vertexShader.includes(logdepthVert) ? "" : logdepthVert}
        }
      `,
      ).source
    }
  `;

  // Fragment shader
  const logdepthParsFrag = "#include <logdepthbuf_pars_fragment>";

  shader.fragmentShader = /* glsl */ `
    ${GBufferParsFragment}

    ${packing}

    ${shader.fragmentShader.includes(logdepthParsFrag) ? "" : logdepthParsFrag}

    ${
      createReplacer(shader.fragmentShader)
        .replace(
          "void main() {",
          /* glsl */ `
          void main() {
            // Calculate screen-space normal for Line2 MRT compatibility
            vec3 fdx = dFdx(gl_FragCoord.xyz);
            vec3 fdy = dFdy(gl_FragCoord.xyz);
            vec3 normal = normalize(cross(fdx, fdy));

            // Ensure normal faces camera (positive Z in screen space)
            if (normal.z < 0.0) normal = -normal;
        `,
        )
        .replace(
          /}\s*$/, // Assume the last curly brace is of main()
          /* glsl */ `
          #ifndef USE_SHADOWMAP_DEPTH
            GBUFFER_WRITE_NORMAL(normal, 0.0, 1.0)
            GBUFFER_WRITE_EFFECT_ZERO
            GBUFFER_WRITE_SHADOW_ZERO
          #endif
        }
      `,
        ).source
    }
  `;

  return shader;
}
