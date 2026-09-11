import {
  PolylineMesh as NavaraPolylineMesh,
  PolylineMaterial,
} from "@navaramap/engine";
import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  ShaderMaterial,
  Vector2,
} from "three";
import invariant from "tiny-invariant";

import {
  registerBatchedMaterial,
  POLYLINE_BATCH_SUPPORT,
  type BatchedAttributeName,
  type BatchTextureSupport,
  type DefaultBatchAttributeValues,
} from "../batchTexture";
import type { EventContext } from "../event/context";
import { applyLitOption } from "../material";
import { createPolylineMaterialEnhancer } from "../material/enhancer";

import {
  BatchedFeatureMesh,
  type BatchedFeatureAttributes,
} from "./batchedFeature";
import { GEOMETRY_TYPES } from "./constants";
import { releaseGeometryArraysAfterUpload } from "./releaseGeometryArrays";
import { setupRTECallback } from "./rtcRteHelper";

// Sentinel value for picking coordinate when not picking (reused to avoid allocations)
const PICKING_COORD_SENTINEL = new Vector2(-1, -1);

/**
 * Minimum stroke width used while rendering the pick pass. A hairline stroke
 * covers too few pick-buffer texels to click reliably — on the draped path the
 * 512px tile atlas resolves a thin line to scattered partial texels, so the
 * decoded batch id is background almost everywhere the line is visible.
 * Fattening the stroke only for the pick render gives lines the same "click
 * tolerance" pointing devices get elsewhere; the visible width is untouched.
 */
const MIN_PICK_WIDTH = 10;

type Attributes = BatchedFeatureAttributes<{
  position: BufferAttribute;
  // RTE mode attributes (only present when useRTE=true)
  position_3d_high?: BufferAttribute;
  position_3d_low?: BufferAttribute;
  start_3d_high?: BufferAttribute;
  start_3d_low?: BufferAttribute;
  end_3d_high?: BufferAttribute;
  end_3d_low?: BufferAttribute;
  // Non-RTE mode attributes (only present when useRTE=false)
  start?: BufferAttribute;
  forward_offset?: BufferAttribute;
  // Common attributes (present for non-flat polylines)
  start_normal?: BufferAttribute;
  end_normal_and_texture_coordinate_normalization_x?: BufferAttribute;
  // Always present
  right_normal_and_texture_coordinate_normalization_y: BufferAttribute;
  attrBatchId: BufferAttribute;
}>;

export class PolylineMesh extends BatchedFeatureMesh<
  BufferGeometry<Attributes>,
  ShaderMaterial
> {
  readonly ctx: EventContext;
  /** Material enhancer for managing shader state */
  private _enhancedMaterial?: ReturnType<typeof createPolylineMaterialEnhancer>;
  /** Flag indicating geometry initialization failed - mesh should never be visible */
  private _geometryInitFailed = false;

  constructor(ctx: EventContext) {
    super(new BufferGeometry<Attributes>(), new ShaderMaterial());
    this.ctx = ctx;
  }

  /**
   * Geometry type of this mesh.
   */
  readonly geometryType = GEOMETRY_TYPES.Polyline;

  init(mesh: NavaraPolylineMesh) {
    this.batchLength = mesh.batch_length;
    const geometryResult = this.initGeometry(mesh);

    // If geometry init failed (missing required buffers), mark as permanently invisible
    if (!geometryResult.success) {
      console.warn(
        "PolylineMesh: Failed to initialize geometry due to missing required buffers. Mesh will be permanently invisible.",
      );
      this._geometryInitFailed = true;
      this.visible = false;
    }

    this.initMaterial(mesh, geometryResult.useRTE);

    this.addEventListener("removedFromWorld", () => {
      this.dispose();
    });

    return this;
  }

  private initGeometry(
    mesh: NavaraPolylineMesh,
  ): { success: true; useRTE: boolean } | { success: false; useRTE: false } {
    const { buf } = this.ctx;
    const g = mesh.geometry;
    const position = buf.removeF32(g.position.data);
    const position_high = g.position_high
      ? buf.removeF32(g.position_high.data)
      : null;
    const position_low = g.position_low
      ? buf.removeF32(g.position_low.data)
      : null;
    const start_high = g.start_high ? buf.removeF32(g.start_high.data) : null;
    const start_low = g.start_low ? buf.removeF32(g.start_low.data) : null;
    const end_high = g.end_high ? buf.removeF32(g.end_high.data) : null;
    const end_low = g.end_low ? buf.removeF32(g.end_low.data) : null;
    const start_normals = g.start_normals
      ? buf.removeF32(g.start_normals.data)
      : null;
    const end_normal_and_texture_coordinate_normalization_x =
      g.end_normal_and_texture_coordinate_normalization_x
        ? buf.removeF32(
            g.end_normal_and_texture_coordinate_normalization_x.data,
          )
        : null;
    const right_normal_and_texture_coordinate_normalization_y = buf.removeF32(
      g.right_normal_and_texture_coordinate_normalization_y.data,
    );
    const indices = buf.removeU32(g.indices);
    const batchIds = g.batch_ids ? buf.removeF32(g.batch_ids.data) : undefined;
    const batchIdSize = g.batch_ids ? g.batch_ids.size : 0;
    const batchIndex = g.batch_index
      ? buf.removeU32(g.batch_index.data)
      : undefined;
    const batchIndexSize = g.batch_index ? g.batch_index.size : 0;

    if (
      !position ||
      !right_normal_and_texture_coordinate_normalization_y ||
      !indices
    ) {
      return { success: false, useRTE: false };
    }

    const geometry = this.geometry;
    const useRTE = !!(
      position_high &&
      position_low &&
      start_high &&
      start_low &&
      end_high &&
      end_low
    );

    geometry.setAttribute(
      "position",
      new BufferAttribute(position, g.position.size),
    );

    if (useRTE) {
      // RTE attributes
      if (position_high && position_low) {
        geometry.setAttribute(
          "position_3d_high",
          new BufferAttribute(position_high, 3),
        );
        geometry.setAttribute(
          "position_3d_low",
          new BufferAttribute(position_low, 3),
        );
      }
      if (start_high && start_low) {
        geometry.setAttribute(
          "start_3d_high",
          new BufferAttribute(start_high, 3),
        );
        geometry.setAttribute(
          "start_3d_low",
          new BufferAttribute(start_low, 3),
        );
      }
      if (end_high && end_low) {
        geometry.setAttribute("end_3d_high", new BufferAttribute(end_high, 3));
        geometry.setAttribute("end_3d_low", new BufferAttribute(end_low, 3));
      }
    } else if (g.start && g.forward_offset) {
      const start = buf.removeF32(g.start.data);
      const forward_offset = buf.removeF32(g.forward_offset.data);

      if (!start || !forward_offset) {
        return { success: false, useRTE: false };
      }

      // Non-RTE mode: use regular start attribute
      geometry.setAttribute("start", new BufferAttribute(start, g.start.size));

      geometry.setAttribute(
        "forward_offset",
        new BufferAttribute(forward_offset, g.forward_offset.size),
      );
    }

    if (start_normals && g.start_normals) {
      geometry.setAttribute(
        "start_normal",
        new BufferAttribute(start_normals, g.start_normals.size),
      );
    }
    if (
      end_normal_and_texture_coordinate_normalization_x &&
      g.end_normal_and_texture_coordinate_normalization_x
    ) {
      geometry.setAttribute(
        "end_normal_and_texture_coordinate_normalization_x",
        new BufferAttribute(
          end_normal_and_texture_coordinate_normalization_x,
          g.end_normal_and_texture_coordinate_normalization_x.size,
        ),
      );
    }
    geometry.setAttribute(
      "right_normal_and_texture_coordinate_normalization_y",
      new BufferAttribute(
        right_normal_and_texture_coordinate_normalization_y,
        g.right_normal_and_texture_coordinate_normalization_y.size,
      ),
    );

    if (batchIds) {
      geometry.setAttribute(
        "attrBatchId",
        new BufferAttribute(batchIds, batchIdSize),
      );
    }

    if (batchIndex) {
      this._setBatchIndex(Float32Array.from(batchIndex), batchIndexSize);
    }

    geometry.setIndex(new BufferAttribute(indices, 1));
    // geometry.computeVertexNormals();

    // The renderer lazily calls computeBoundingSphere(), which reads
    // position.array, for every polyline: non-RTE ones through frustum culling
    // (RTE disables it below), and ALL of them through depth sorting —
    // renderer.sortObjects reads geometry.boundingSphere even when
    // frustumCulled is false. Compute it eagerly so that read happens before
    // we drop the CPU arrays. In RTE mode `position` still holds the f32
    // world-space coordinates, so the resulting sphere is valid.
    geometry.computeBoundingSphere();

    // With the bounding sphere resolved and batch-id data consumed on the GPU,
    // no CPU read survives the first upload. Drop the JS-heap copies to keep a
    // single resident (GPU) copy — see releaseGeometryArraysAfterUpload for the
    // context-loss trade-off.
    releaseGeometryArraysAfterUpload(geometry);

    return { success: true, useRTE };
  }

  private initMaterial(mesh: NavaraPolylineMesh, useRTE: boolean) {
    const { uniforms } = this.ctx;
    const meshMaterial = mesh.material;

    const [minHeight, maxHeight] = meshMaterial.__internal__?.minMaxHeights ?? [
      0, 0,
    ];

    this.castShadow = !!meshMaterial.castShadow;
    this.receiveShadow = !!meshMaterial.receiveShadow;
    applyLitOption(this.material, meshMaterial.lit);

    const isTexturized = mesh.should_be_texturized;

    // Shader selection is handled by enhancer's transformShader
    this.material.depthTest = false;

    // Disable lighting for texturized rendering - the texture will be applied to the lit tile
    this.material.lights = !isTexturized;
    this.material.vertexColors = false;

    // Ignored if it is cloned.
    if (!this._enhancedMaterial) {
      // Create enhanced material with encapsulated state
      const enhancer = createPolylineMaterialEnhancer(this.material);
      this._enhancedMaterial = enhancer;
    }
    const enhancer = this._enhancedMaterial;

    enhancer.mount({
      base: {
        color: meshMaterial.color,
        minMaxHeight: [minHeight, maxHeight],
        addHeight: meshMaterial.height ?? 0,
        width: meshMaterial.width,
        maxWidth: meshMaterial.maxWidth,
        isTexturized,
        pickable: false,
        useRTE,
        transparent: meshMaterial.transparent,
        opacity: meshMaterial.opacity,
        depthWrite: meshMaterial.depthWrite,
        // External shared uniforms from CommonUniforms
        viewportAndPixelRatio: uniforms.viewportAndPixelRatio,
        frustumNearFar: uniforms.frustumNearFar,
        frustumRatio: uniforms.frustumRatio,
      },
    });

    // Initialize enhancer uniforms early so they're available before onBeforeCompile
    const mutates = enhancer.mutates();
    mutates.updateUniforms(this.material.uniforms, enhancer.states());

    // Set up RTE callback if needed
    const state = enhancer.states();
    if (state.useRTE) {
      const mutates = enhancer.mutates();
      const callback = setupRTECallback(
        this,
        (modelViewMatrixRTE, cameraPositionHigh, cameraPositionLow) =>
          mutates.updateRteUniforms(
            modelViewMatrixRTE,
            cameraPositionHigh,
            cameraPositionLow,
            state,
          ),
        new Matrix4(),
        new Matrix4(),
      );
      this.onBeforeRender = callback;
      this.onBeforeShadow = callback;

      // Disable frustum culling for RTE mode
      this.frustumCulled = false;
    }

    // Set up custom program cache key based on config flags that affect shader defines
    this.material.customProgramCacheKey = enhancer.programCacheKey;

    // Set onBeforeCompile to use enhancer
    this.material.onBeforeCompile = enhancer.transformShader;

    this.ctx.viewContext.applyShadowMaterial(this.material);

    this._initBatchedMaterial();

    this._update(meshMaterial, mesh.active);
  }

  _getBatchTextureSupport(): BatchTextureSupport {
    return POLYLINE_BATCH_SUPPORT;
  }

  _initBatchDataTexture(): void {
    invariant(this.batchLength != null);
    // Register batchLength; the texture itself is created lazily on the
    // first attribute write.
    const uniform = registerBatchedMaterial(
      this.material,
      { ...this._getBatchTextureSupport(), batchLength: this.batchLength },
      this.ctx.viewContext.getRenderer(),
    );
    this.getEnhancer().update({ base: { batchDataTexture: uniform } });
  }

  _updateBatchAttribute(
    batchId: number,
    attribute: BatchedAttributeName,
    value: number | number[] | boolean,
  ): boolean {
    // Write the texture first: it validates the value and captures the
    // backfill defaults before the enhancer resets material.color to white,
    // and a rejected write must not stamp any define — the shaders have no
    // safety net for an unwritten receiver.
    if (!super._updateBatchAttribute(batchId, attribute, value)) return false;

    if (attribute === "color") {
      // When batch color is first used, set material.color to white
      // (multiplier identity: white * batch color = batch color).
      if (!this.getEnhancer().states().batchColorEnabled) {
        this.getEnhancer().update({
          base: { batchColorEnabled: true, color: 0xffffff },
        });
      }
    }
    return true;
  }

  _update(material: PolylineMaterial, active: boolean) {
    // If geometry initialization failed, keep mesh permanently invisible
    // to prevent WebGL errors from missing attributes/buffers
    if (this._geometryInitFailed) {
      this.visible = false;
      return;
    }

    const enhancer = this.getEnhancer();

    // Update mesh properties (not handled by enhancer).
    // Draped polylines render only through the offscreen bake, never the main
    // scene, and the Rust drape resolve — not this LOD `active` flag — decides
    // which baked tile is composited per terrain region. Tying bake visibility
    // to `active` makes the drape flicker on every LOD swap (the tile goes
    // invisible → bakes empty before its replacement is ready). Keep a draped
    // mesh bakeable whenever its material is shown, so every built tile stays a
    // stable drape source — the vector twin of a loaded raster texture.
    const shown = material.show ?? true;
    this.visible = enhancer.states().isTexturized ? shown : shown && active;
    this.castShadow = !!material.castShadow;
    this.receiveShadow = !!material.receiveShadow;
    applyLitOption(this.material, material.lit);

    const base = enhancer.states();

    // Build update props from material
    const minMaxHeights = material.__internal__?.minMaxHeights;
    enhancer.update({
      base: {
        // `material.color` is used only when `batchColorEnabled` is `false`.
        // Otherwise the color comes from the batch data texture.
        color: base.batchColorEnabled ? undefined : material.color,
        minMaxHeight:
          minMaxHeights !== undefined
            ? [minMaxHeights[0], minMaxHeights[1]]
            : undefined,
        addHeight: material.height,
        width: material.width,
        maxWidth: material.maxWidth,
        transparent: material.transparent,
        opacity: material.opacity,
        depthWrite: material.depthWrite,
        effectIdsMask:
          this.ctx.viewContext.selectiveEffectRegistry?.computeMask(
            material.effectIds ?? [],
          ) ?? 0,
        emissiveColor: material.emissiveColor ?? 0,
        emissiveIntensity: material.emissiveIntensity ?? 0,
      },
    });

    // Update material.lights flag based on isTexturized state
    // (lighting should be disabled for texturized/draped polylines)
    this.material.lights = !base.isTexturized;
  }

  /**
   * Get the enhancer, throwing if not initialized.
   * @throws Error if enhancer is not initialized
   */
  private getEnhancer(): NonNullable<typeof this._enhancedMaterial> {
    if (!this._enhancedMaterial) {
      throw new Error(
        "PolylineMesh material enhancer is not initialized. This usually indicates a failure during construction or geometry/material setup.",
      );
    }
    return this._enhancedMaterial;
  }

  get color() {
    return this.material.uniforms.color.value;
  }

  get draped(): boolean {
    return this.getEnhancer().states().isTexturized;
  }

  get emissiveColor(): number {
    return this.getEnhancer().states().emissiveColor;
  }
  get emissiveIntensity(): number {
    return this.getEnhancer().states().emissiveIntensity;
  }
  get effectIdsMask(): number {
    return this.getEnhancer().states().effectIdsMask;
  }

  /** Visible stroke width to restore after a pick-pass width bump. */
  private _pickSavedWidth?: number;

  onBeforePicking(pickingCoord?: Vector2) {
    const enhancer = this.getEnhancer();
    const width = enhancer.states().width;
    if (width < MIN_PICK_WIDTH) {
      this._pickSavedWidth = width;
      enhancer.update({ base: { pickable: true, width: MIN_PICK_WIDTH } });
    } else {
      enhancer.update({ base: { pickable: true } });
    }
    this.needsUpdate();

    const mutates = enhancer.mutates();
    if (pickingCoord) {
      mutates.setPickingCoord(pickingCoord);
    } else {
      mutates.setPickingCoord(PICKING_COORD_SENTINEL);
    }
  }

  onAfterPicking() {
    const enhancer = this.getEnhancer();
    if (this._pickSavedWidth !== undefined) {
      enhancer.update({
        base: { pickable: false, width: this._pickSavedWidth },
      });
      this._pickSavedWidth = undefined;
    } else {
      enhancer.update({ base: { pickable: false } });
    }
    this.needsUpdate();
    enhancer.mutates().setPickingCoord(PICKING_COORD_SENTINEL);
  }

  _getDefaultBatchAttributeValues(): DefaultBatchAttributeValues {
    return {
      color: this.color,
      height: this.getEnhancer().states().addHeight,
    };
  }

  clone() {
    const cloned = new PolylineMesh(this.ctx) as this;
    cloned.geometry = this.geometry;
    cloned.material = this.material;
    cloned._enhancedMaterial = this._enhancedMaterial;
    return cloned;
  }

  dispose() {
    this.ctx.viewContext.removeShadowMaterial(this.material);
  }
}
