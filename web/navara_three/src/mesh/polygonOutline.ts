import {
  PolygonMesh as NavaraPolygonMesh,
  PolygonMaterial,
} from "@navaramap/engine";
import { RTE_ONE_UNIFORM } from "@navaramap/three-api";
import BatchTextureParsVertex from "@shaders/glsl/chunks/batch_texture_pars_vertex.glsl";
import BatchTextureVertex from "@shaders/glsl/chunks/batch_texture_vertex.glsl";
import BranchFreeTernary from "@shaders/glsl/chunks/branchFreeTernary.glsl";
import ExtrudedHeightParsVertex from "@shaders/glsl/chunks/extruded_height_pars_vertex.glsl";
import ExtrudedHeightVertex from "@shaders/glsl/chunks/extruded_height_vertex.glsl";
import HeightParsVertex from "@shaders/glsl/chunks/height_pars_vertex.glsl";
import HeightVertex from "@shaders/glsl/chunks/height_vertex.glsl";
import ShowFragment from "@shaders/glsl/chunks/show_fragment.glsl";
import ShowParsFragment from "@shaders/glsl/chunks/show_pars_fragment.glsl";
import ShowParsVertex from "@shaders/glsl/chunks/show_pars_vertex.glsl";
import {
  type Material,
  InstancedBufferAttribute,
  type Intersection,
  Matrix4,
  type Object3D,
  type Raycaster,
  Vector3,
  Vector4,
} from "three";
import { Line2, LineGeometry, LineMaterial } from "three-stdlib";

import {
  attachBatchedMaterial,
  enableDefine,
  getBatchTextureUniform,
} from "../batchTexture";
import type { EventContext } from "../event/context";
import { setupMaterialForMRT } from "../material";
import { createReplacer } from "../utils/replacer";

import { NvLineGeometry } from "./nvLineGeometry";
import { setupRTECallback } from "./rtcRteHelper";

export class PolygonOutlineMesh extends Line2 {
  readonly ctx: EventContext;
  private resizeEventUnsubscribe?: () => void;
  /** True when the geometry carries RTE high/low positions (GeoJSON path). */
  private useRTE = false;

  constructor(ctx: EventContext, mesh: NavaraPolygonMesh) {
    super(new NvLineGeometry(), new LineMaterial());
    this.ctx = ctx;
    this.initGeometry(mesh);
    this.initMaterial(mesh);
  }

  raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    // RTE geometry carries no instanceStart/End attributes, which
    // LineSegments2.raycast requires — picking is GPU-based, so skip.
    if (this.useRTE) return;
    super.raycast(raycaster, intersects);
  }

  private initGeometry(mesh: NavaraPolygonMesh) {
    const g = mesh.outline_geometry;
    if (!g || !g.position) {
      return;
    }
    const position = this.ctx.buf.removeF32(g.position.data);
    if (!position) {
      return;
    }

    const position3dHigh =
      g.position_3d_high && g.position_3d_high.size > 0
        ? this.ctx.buf.removeF32(g.position_3d_high.data)
        : undefined;
    const position3dLow =
      g.position_3d_low && g.position_3d_low.size > 0
        ? this.ctx.buf.removeF32(g.position_3d_low.data)
        : undefined;

    const scale_normal_and_cap = g.scale_normal_and_cap
      ? this.ctx.buf.removeF32(g.scale_normal_and_cap.data)
      : undefined;

    const skipIdx = g.skip_indices
      ? (this.ctx.buf.removeU32(g.skip_indices) ?? undefined)
      : undefined;

    const batchIndex = g.batch_index
      ? this.ctx.buf.removeF32(g.batch_index.data)
      : undefined;

    // Convert position buffer to Line2 format
    const lineGeometry = this.geometry as NvLineGeometry;

    if (position3dHigh && position3dLow) {
      // RTE mode: upload only the high/low pairs — the RTE shader never
      // reads instanceStart/End, so calling setPositions would leave an
      // unused buffer resident on the GPU. setPositionsHighLow also sets
      // the bounds that setPositions would have computed.
      lineGeometry.setPositionsHighLow(position3dHigh, position3dLow, skipIdx);
      this.useRTE = true;
    } else {
      lineGeometry.setPositions(position, skipIdx);
    }

    // Add scale_normal_and_cap attributes if available
    if (g.scale_normal_and_cap && scale_normal_and_cap) {
      const size = g.scale_normal_and_cap.size;
      this.initScaleNormalCapAttributes(
        scale_normal_and_cap,
        skipIdx,
        size,
        lineGeometry,
      );
    }

    // Add per-segment batch index attribute for batch texture lookups
    if (batchIndex) {
      const segmentBatchIds: number[] = [];
      const skipSet = new Set(skipIdx ?? []);
      for (let i = 0; i < batchIndex.length - 1; i++) {
        if (skipSet.has(i)) continue;
        segmentBatchIds.push(batchIndex[i]);
      }
      lineGeometry.setAttribute(
        "_batchid",
        new InstancedBufferAttribute(new Float32Array(segmentBatchIds), 1),
      );
    }
  }

  private initScaleNormalCapAttributes(
    scale_normal_and_cap: Float32Array<ArrayBufferLike>,
    skipIdx: Uint32Array<ArrayBufferLike> | undefined,
    size: number,
    lineGeometry: LineGeometry,
  ) {
    // Create separate arrays for start and end points of line segments
    const scaleDataStart: number[] = [];
    const scaleDataEnd: number[] = [];
    const skipSet = new Set(skipIdx ?? []);

    for (let i = 0; i < scale_normal_and_cap.length / size - 1; i++) {
      if (skipSet.has(i)) {
        continue;
      }

      // For each line segment, add start and end scale normal data
      const startIdx = i * size;
      const endIdx = (i + 1) * size;

      // Start point data
      for (let j = 0; j < size; j++) {
        scaleDataStart.push(scale_normal_and_cap[startIdx + j]);
      }

      // End point data
      for (let j = 0; j < size; j++) {
        scaleDataEnd.push(scale_normal_and_cap[endIdx + j]);
      }
    }

    lineGeometry.setAttribute(
      "scaleNormalAndCapStart",
      new InstancedBufferAttribute(new Float32Array(scaleDataStart), size),
    );
    lineGeometry.setAttribute(
      "scaleNormalAndCapEnd",
      new InstancedBufferAttribute(new Float32Array(scaleDataEnd), size),
    );
  }

  private initMaterial(mesh: NavaraPolygonMesh) {
    const meshMaterial = mesh.material;
    const material = this.material;

    // Set basic material properties
    material.color.set(meshMaterial.outlineColor ?? 0xffffff);
    material.linewidth = meshMaterial.outlineWidth ?? 1;

    const resizeHandler = (w: number, h: number) => {
      material.resolution.set(w, h);
    };

    this.ctx.viewEvents.on("resize", resizeHandler);
    this.resizeEventUnsubscribe = () =>
      this.ctx.viewEvents.off("resize", resizeHandler);

    // Set up height adjustment uniforms
    const uMinMaxHeights = meshMaterial.__internal__?.minMaxHeights;
    material.userData.uMinMaxHeight = {
      value: uMinMaxHeights,
    };
    material.userData.uAddExtrudedHeight = {
      value: 0.0,
    };
    material.userData.uAddHeight = {
      value: 0.0,
    };

    // Batch texture state (layout defines, shared uniform) is attached later
    // by PolygonMesh via initBatchTexture — the batch data texture is shared.

    if (this.useRTE) {
      material.userData.defines ??= {};
      material.userData.defines.USE_RTE = true;
      material.userData.modelViewMatrixRTE = { value: new Matrix4() };
      material.userData.uCameraPositionHigh = { value: new Vector3() };
      material.userData.uCameraPositionLow = { value: new Vector3() };

      // The outline mesh sits directly in the scene with an identity
      // matrixWorld (positions are absolute ECEF), so pass identity matrices
      // like PolylineMesh does.
      const rteCallback = setupRTECallback(
        this,
        (modelViewMatrixRTE, cameraPositionHigh, cameraPositionLow) => {
          material.userData.modelViewMatrixRTE.value.copy(modelViewMatrixRTE);
          material.userData.uCameraPositionHigh.value.copy(cameraPositionHigh);
          material.userData.uCameraPositionLow.value.copy(cameraPositionLow);
        },
        new Matrix4(),
        new Matrix4(),
      );
      // LineSegments2.prototype.onBeforeRender refreshes the `resolution`
      // uniform from the viewport every frame; assigning our own callback
      // shadows it, so replicate that update here — otherwise resolution
      // stays at the (1,1) default and line widths blow up to viewport size.
      const updateRTE: Object3D["onBeforeRender"] = rteCallback;
      const viewport = new Vector4();
      this.onBeforeRender = (renderer, scene, camera, geometry, mat, group) => {
        renderer.getViewport(viewport);
        material.resolution.set(viewport.z, viewport.w);
        updateRTE(renderer, scene, camera, geometry, mat, group);
      };
      this.onBeforeShadow = rteCallback;
    }

    // The defines are stamped in onBeforeCompile (not via material.defines),
    // so they must be part of the program cache key — otherwise RTE and
    // non-RTE outlines (or different batch-define sets) would share one
    // compiled program.
    material.customProgramCacheKey = () =>
      `nvr-polygon-outline:${JSON.stringify(material.userData.defines ?? {})}`;

    material.onBeforeCompile = (shader) => {
      // Merge user-defined defines (batch texture, color/show, height, etc.)
      shader.defines ??= {};
      Object.assign(shader.defines, material.userData.defines || {});

      shader.uniforms.uMinMaxHeight = material.userData.uMinMaxHeight;
      shader.uniforms.uAddExtrudedHeight = material.userData.uAddExtrudedHeight;
      shader.uniforms.uAddHeight = material.userData.uAddHeight;

      // Batch texture uniform (shared from parent PolygonMesh)
      const batchUniform = getBatchTextureUniform(material);
      if (batchUniform) {
        shader.uniforms.batchDataTexture = batchUniform;
      }

      // RTE uniforms (updated per-frame via setupRTECallback)
      if (material.userData.defines?.USE_RTE) {
        shader.uniforms.modelViewMatrixRTE =
          material.userData.modelViewMatrixRTE;
        shader.uniforms.u_cameraPositionHigh =
          material.userData.uCameraPositionHigh;
        shader.uniforms.u_cameraPositionLow =
          material.userData.uCameraPositionLow;
        shader.uniforms.u_rteOne = RTE_ONE_UNIFORM;
      }

      shader.vertexShader = createReplacer(shader.vertexShader)
        .replace(
          "attribute vec3 instanceEnd;",
          `
        attribute vec3 instanceEnd;
        attribute vec4 scaleNormalAndCapStart;
        attribute vec4 scaleNormalAndCapEnd;
        uniform vec2 uMinMaxHeight;
        #ifdef USE_RTE
          attribute vec3 instanceStartHigh;
          attribute vec3 instanceStartLow;
          attribute vec3 instanceEndHigh;
          attribute vec3 instanceEndLow;
          uniform vec3 u_cameraPositionHigh;
          uniform vec3 u_cameraPositionLow;
          uniform float u_rteOne;
          uniform mat4 modelViewMatrixRTE;
        #endif
        ${ShowParsVertex}
        ${ExtrudedHeightParsVertex}
        ${HeightParsVertex}
        ${BranchFreeTernary}
        ${BatchTextureParsVertex}
        `,
        )
        .replace(
          "vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );",
          `
        ${ExtrudedHeightVertex}
        ${HeightVertex}

        ${BatchTextureVertex}

        vec3 nvr_heightOffsetStart = scaleNormalAndCapStart.xyz * nvr_branchFreeTernary(
          scaleNormalAndCapStart.w == 0.0,
          uMinMaxHeight.x + addHeight,
          uMinMaxHeight.y + addExtrudedHeight
        );
        #ifdef USE_RTE
          // Reconstruct the camera-relative position from high/low pairs to
          // avoid f32 jitter at globe scale. u_rteOne (always 1.0) blocks
          // fast-math reassociation of the high-difference term.
          vec3 nvr_startHighDiff = (instanceStartHigh - u_cameraPositionHigh) * u_rteOne;
          vec3 nvr_startLowDiff = instanceStartLow - u_cameraPositionLow;
          vec4 start = modelViewMatrixRTE * vec4( nvr_startHighDiff + nvr_startLowDiff + nvr_heightOffsetStart, 1.0 );
        #else
          vec3 adjustedInstanceStart = instanceStart + nvr_heightOffsetStart;
          vec4 start = modelViewMatrix * vec4( adjustedInstanceStart, 1.0 );
        #endif
        `,
        )
        .replace(
          "vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );",
          `
        vec3 nvr_heightOffsetEnd = scaleNormalAndCapEnd.xyz * nvr_branchFreeTernary(
          scaleNormalAndCapEnd.w == 0.0,
          uMinMaxHeight.x + addHeight,
          uMinMaxHeight.y + addExtrudedHeight
        );
        #ifdef USE_RTE
          vec3 nvr_endHighDiff = (instanceEndHigh - u_cameraPositionHigh) * u_rteOne;
          vec3 nvr_endLowDiff = instanceEndLow - u_cameraPositionLow;
          vec4 end = modelViewMatrixRTE * vec4( nvr_endHighDiff + nvr_endLowDiff + nvr_heightOffsetEnd, 1.0 );
        #else
          vec3 adjustedInstanceEnd = instanceEnd + nvr_heightOffsetEnd;
          vec4 end = modelViewMatrix * vec4( adjustedInstanceEnd, 1.0 );
        #endif
        `,
        ).source;

      shader.fragmentShader = createReplacer(shader.fragmentShader)
        .replace(
          "void main() {",
          `
        ${ShowParsFragment}
        void main() {
          ${ShowFragment}
        `,
        )
        .replace(
          "vec4 diffuseColor = vec4( diffuse, alpha );",
          `
        vec4 diffuseColor = vec4( diffuse, alpha );
        #ifdef USE_BATCH_SHOW_OPACITY
          diffuseColor.a *= nvr_vOpacity;
        #endif
        `,
        ).source;
    };

    // Apply MRT compatibility
    setupMaterialForMRT(material);

    // Update based on initial state
    this._update(meshMaterial, mesh.active);
  }

  _update(material: PolygonMaterial, active: boolean) {
    if (!this.userData.prev) {
      this.userData.prev = {};
    }
    const prev = this.userData.prev;
    const lineMaterial = this.material;

    // Update color
    if (prev.color !== material.outlineColor) {
      const nextColor = material.outlineColor ?? 0xffffff;
      lineMaterial.color.set(nextColor);
      prev.color = nextColor;
    }

    // Update visibility
    const nextVisible =
      (material.show ?? true) && (material.outlineShow ?? true) && active;
    if (prev.visible !== nextVisible) {
      this.visible = nextVisible;
      prev.visible = nextVisible;
    }

    // Update line width
    if (prev.width !== material.outlineWidth) {
      const nextWidth = material.outlineWidth ?? 1;
      lineMaterial.linewidth = nextWidth;
      prev.width = nextWidth;
    }

    // Update height values for shader-based adjustment
    const [min, max] = material.__internal__?.minMaxHeights ?? [];
    if (prev.min !== min || prev.max !== max) {
      lineMaterial.userData.uMinMaxHeight.value = [min, max];
      prev.min = min;
      prev.max = max;
    }
  }

  // Utility method to update resolution (should be called when renderer size changes)
  updateResolution(width: number, height: number): void {
    this.material.resolution.set(width, height);
  }

  initBatchTexture(source: Material) {
    // Join the polygon mesh's batch texture state: the shared uniform becomes
    // reachable via getBatchTextureUniform and every allocation stamps the
    // layout defines (incl. USE_BATCH_TEXTURE) onto this material from then on.
    attachBatchedMaterial(source, this.material);
  }

  // enableDefine bumps needsUpdate only when the define actually changes, so
  // the per-feature calls from PolygonMesh._updateBatchAttribute don't force
  // a program re-acquisition per write.
  enableBatchShowOpacity() {
    enableDefine(this.material, "USE_BATCH_SHOW_OPACITY");
  }

  enableBatchHeight() {
    enableDefine(this.material, "USE_BATCH_HEIGHT");
  }

  enableBatchExtrudedHeight() {
    enableDefine(this.material, "USE_BATCH_EXTRUDED_HEIGHT");
  }

  // Clean up event listeners when the object is destroyed
  dispose(): void {
    this.resizeEventUnsubscribe?.();
    this.resizeEventUnsubscribe = undefined;
  }
}
