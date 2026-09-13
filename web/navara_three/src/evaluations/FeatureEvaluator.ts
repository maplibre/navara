import {
  type ExtractProperties,
  type FeatureSetId,
  type LayerId,
} from "@navaramap/core";
import type {
  ModelMaterial as NavaraModelMaterial,
  PointMaterial,
  PolygonMaterial,
  PolylineMaterial,
  TextMaterial,
} from "@navaramap/engine";
import { BufferGeometry, Mesh, Object3D } from "three";
import type { NormalBufferAttributes } from "three";

import type { BatchedAttributeName } from "../batchTexture";
import { Color } from "../Color";
import type { FeatureHandler } from "../event/context";
import {
  InstancedMesh,
  isFeatureMesh,
  ModelMesh,
  type ModelMaterial,
  BatchedFeatureMesh,
  type ModelBatchedAttributeName,
  InstancedSpriteMesh,
  BatchedSdfTextMesh,
  type GeometryType,
  VALID_GEOMETRY_TYPES,
} from "../mesh";

type AvailableMaterialProperty = ExtractProperties<
  PointMaterial &
    PolylineMaterial &
    PolygonMaterial &
    NavaraModelMaterial &
    TextMaterial
>;

/**
 * Material properties that can be evaluated and modified per-feature.
 */
export type EvaluatableMaterialProperty = {
  /** Feature color expression from layer configuration. */
  color: AvailableMaterialProperty["color"];
  /** Feature visibility expression from layer configuration. */
  show: AvailableMaterialProperty["show"];
  /** Extruded height expression from layer configuration (for polygons). */
  extrudedHeight: AvailableMaterialProperty["extrudedHeight"];
  /** Height expression from layer configuration. */
  height: AvailableMaterialProperty["height"];
  /** Text content expression from layer configuration (for text). */
  text: AvailableMaterialProperty["text"];
  /** Line width expression from layer configuration (for polylines). */
  width: AvailableMaterialProperty["width"];
  /** Point/text size expression from layer configuration (for points/text). */
  size: AvailableMaterialProperty["size"];
  /** Opacity expression from layer configuration (for polygons/points/text where supported). */
  opacity: AvailableMaterialProperty["opacity"];
  /** Per-feature declutter placement priority (for points/billboards/text);
   *  higher wins an overlap. Overrides the layer's `declutterPriority`. */
  declutterPriority: AvailableMaterialProperty["declutterPriority"];
  /** Image URL for billboards; packed into a shared per-mesh texture atlas. */
  image: string;
  /** Emissive color expression (for polygons/3D Tiles models/points/billboards/text). */
  emissive: AvailableMaterialProperty["emissiveColor"];
  /** Emissive intensity expression (for polygons/3D Tiles models/points/billboards/text). */
  emissiveIntensity: AvailableMaterialProperty["emissiveIntensity"];
};

type EvaluatableMaterialPropertyKey = keyof EvaluatableMaterialProperty;

type EvaluatedMaterialProperty = {
  color: Color;
  show: boolean;
  extrudedHeight: number;
  height: number;
  text: string;
  width: number;
  size: number;
  opacity: number;
  declutterPriority: number;
  image: string | null;
  emissive: Color;
  emissiveIntensity: number;
};

/**
 * The evaluated values that can be returned from the evaluate callback.
 * All properties are optional - only return the ones you want to modify.
 */
export type EvaluatedValue = {
  /** The evaluated color for this feature. */
  [K in EvaluatableMaterialPropertyKey]: EvaluatedMaterialProperty[K];
};

/**
 * Re-export GeometryType from mesh constants for convenience.
 * Geometry type for feature evaluation context.
 * Tells the evaluator which geometry type is being rendered.
 */
export type { GeometryType };

/**
 * Information about a feature batch, passed to evaluation callbacks.
 */
export type FeatureInfo = {
  /**
   * The feature's canonical global batch id (its first instance's id when a
   * feature spans several instances, e.g. MultiPoint). Pick events report the
   * same canonical id, so picks and evaluations correlate through this field.
   */
  batchId: number;
  properties: Record<string, unknown> | undefined;
  layerId: LayerId | undefined;
  /** Mesh geometry type (e.g., "billboard", "text"). Not GeoJSON geometry ("Point", "Polygon"). */
  meshGeomType?: GeometryType;
};

/**
 * Callback function type for feature evaluator operations.
 */
export type FeatureEvaluatorCallback = (
  info: FeatureInfo,
) => Partial<EvaluatedValue>;

/**
 * Provides access to feature data and allows dynamic styling of features based on their properties.
 * Received through the `featureCreated` and `featureUpdated` events on a Layer.
 *
 * Use this class to:
 * - Read feature properties from the data source
 * - Dynamically style features based on their properties
 *
 * @example
 * ```typescript
 * // Style 3D Tiles buildings by height
 * layer.on("featureUpdated", (evaluator) => {
 *   evaluator.evaluate(({ properties }) => {
 *     const measuredHeight = properties?.["height"] as number;
 *
 *     // Color and visibility based on building height
 *     const color = (() => {
 *       if (measuredHeight < 30) return new Color().setStyle("#00ff00");
 *       if (measuredHeight < 60) return new Color().setStyle("#ffff00");
 *       if (measuredHeight < 90) return new Color().setStyle("#ff00ff");
 *       return new Color().setStyle("#ff0000");
 *     })();
 *
 *     return {
 *       color,
 *       show: measuredHeight >= 30, // Hide small buildings
 *     };
 *   });
 * });
 *
 * // Style GeoJSON polygons with extrusion based on properties
 * layer.on("featureUpdated", (evaluator) => {
 *   evaluator.evaluate(({ properties }) => {
 *     const height = (properties?.["height"] as number) ?? 0;
 *     const extrudedHeight = (properties?.["extrudedHeight"] as number) ?? 0;
 *
 *     return {
 *       height,
 *       extrudedHeight,
 *     };
 *   });
 * });
 *
 * // Re-evaluate styles
 * const onChange = () => {
 *   layer.forceUpdate(); // Triggers featureUpdated events
 * };
 * ```
 */
export class FeatureEvaluator {
  private handler: FeatureHandler;
  private layerId: LayerId;
  private featureSetId: FeatureSetId;
  private cachedBatchedProperties?: Map<
    number,
    Record<string, unknown> | undefined
  >;
  private filterCacheKey?: string;
  private cachedFilteredProperties?: Map<
    number,
    Record<string, unknown> | undefined
  >;
  private batchIds: number[] = [];

  /**
   * The underlying Three.js object representing this feature.
   * Can be used for advanced manipulation, but prefer using `evaluate()` for styling.
   */
  // TODO: Need to support TSL if we export it.
  private obj: Object3D;

  constructor(
    handler: FeatureHandler,
    layerId: LayerId,
    featureSetId: FeatureSetId,
    obj: Object3D,
  ) {
    this.handler = handler;
    this.layerId = layerId;
    this.featureSetId = featureSetId;
    this.obj = obj;
  }

  /**
   * Track objects we've already warned about to avoid log spam.
   * Uses WeakSet so objects can be garbage collected.
   */
  private static readonly warnedObjects = new WeakSet<Object3D>();

  /**
   * Type guard to check if an Object3D has a geometryType getter.
   */
  private hasGeometryType(
    obj: Object3D,
  ): obj is Object3D & { geometryType: unknown } {
    return "geometryType" in obj;
  }

  /**
   * Determine geometry type from the mesh object.
   * Reads geometryType getter if available on the mesh.
   * Validates that the returned value is a valid GeometryType literal.
   */
  private determineGeometryType(obj: Object3D): GeometryType | undefined {
    if (this.hasGeometryType(obj)) {
      const value = obj.geometryType;

      // Runtime validation: ensure the returned value is a valid GeometryType
      if (
        typeof value === "string" &&
        VALID_GEOMETRY_TYPES.includes(value as GeometryType)
      ) {
        return value as GeometryType;
      }

      // Invalid value from geometryType - warn once per object to avoid log spam
      if (!FeatureEvaluator.warnedObjects.has(obj)) {
        FeatureEvaluator.warnedObjects.add(obj);
        console.warn(
          `Invalid geometry type returned from geometryType getter: "${value}". Expected one of: ${VALID_GEOMETRY_TYPES.join(", ")}`,
        );
      }
    }
    return undefined;
  }

  /**
   * Gets the unique identifier of this feature set.
   */
  get id() {
    return this.featureSetId;
  }

  /**
   * Reads the properties of this feature from the data source.
   * The callback is invoked for each batch within this feature.
   *
   * @param f - Callback function that receives feature info for each batch
   *
   * @example
   * ```typescript
   * // Log all properties
   * evaluator.readFeatureProperties(({ batchId, properties }) => {
   *   console.log(`Batch ${batchId}:`, properties);
   * });
   *
   * // Access nested JSON attributes (common in MVT/PLATEAU data)
   * evaluator.readFeatureProperties(({ properties }) => {
   *   const attributes = JSON.parse((properties?.["attributes"] as string) ?? "{}");
   *   const minHeight = attributes["minHeight"];
   *   const maxHeight = attributes["maxHeight"];
   * });
   * ```
   */
  readFeatureProperties(f: (info: FeatureInfo, batchIndex: number) => void) {
    // Read geometry type dynamically to handle cases where it changes after evaluator creation
    const meshGeomType = this.determineGeometryType(this.obj);

    if (this.cachedBatchedProperties) {
      for (const [batchIdx, properties] of this.cachedBatchedProperties) {
        f(
          {
            layerId: this.layerId,
            batchId: this.batchIds[batchIdx],
            properties,
            meshGeomType,
          },
          batchIdx,
        );
      }
    } else {
      this.cachedBatchedProperties = new Map();
      this.handler.readAllBatchedProperties(
        this.featureSetId,
        (
          batchIdx: number,
          batchId: number,
          properties: Record<string, unknown> | undefined,
        ) => {
          this.cachedBatchedProperties?.set(batchIdx, properties);
          this.batchIds[batchIdx] = batchId;
          f(
            {
              layerId: this.layerId,
              batchId,
              properties,
              meshGeomType,
            },
            batchIdx,
          );
        },
      );
    }
  }

  /**
   * Reads only the specified root properties of this feature.
   * This is more efficient than `readFeatureProperties` when only a few properties are needed.
   *
   * @param keys - Array of property key names to read
   * @param f - Callback function that receives feature info for each batch
   *
   * @example
   * ```typescript
   * evaluator.readFilteredFeatureProperties(["height", "name"], ({ batchId, properties }) => {
   *   const { height, name } = properties;
   * });
   * ```
   */
  readFilteredFeatureProperties(
    keys: string[],
    f: (info: FeatureInfo, batchIndex: number) => void,
  ) {
    // Read geometry type dynamically to handle cases where it changes after evaluator creation
    const meshGeomType = this.determineGeometryType(this.obj);

    const cacheKey = keys.join("|");
    if (this.filterCacheKey === cacheKey && this.cachedFilteredProperties) {
      for (const [batchIndex, filtered] of this.cachedFilteredProperties) {
        f(
          {
            layerId: this.layerId,
            batchId: this.batchIds[batchIndex],
            properties: filtered,
            meshGeomType,
          },
          batchIndex,
        );
      }
    } else {
      this.cachedFilteredProperties = new Map();
      this.filterCacheKey = cacheKey;

      this.handler.readFilteredBatchedProperties(
        this.featureSetId,
        keys,
        (batchIndex: number, batchId: number, filtered?: unknown[]) => {
          const properties: Record<string, unknown> = {};
          for (let i = 0; i < keys.length; i++) {
            properties[keys[i]] = filtered?.[i];
          }
          this.cachedFilteredProperties?.set(batchIndex, properties);
          this.batchIds[batchIndex] = batchId;
          f(
            {
              layerId: this.layerId,
              batchId,
              properties,
              meshGeomType,
            },
            batchIndex,
          );
        },
      );
    }
  }

  /**
   * Evaluates and applies dynamic styles to features based on their properties.
   * The callback is invoked for each batch (sub-feature) within this feature.
   *
   * Supported style properties:
   * - `color` - Feature color (use `new Color()`)
   * - `show` - Feature visibility (boolean)
   * - `height` - Feature height in meters
   * - `extrudedHeight` - Extrusion height for polygons in meters
   * - `text` - Label text content (for text/label features)
   * - `width` - Line width in pixels (for polylines)
   * - `size` - Feature size in pixels (for points/text)
   * - `opacity` - Feature opacity 0-1
   * - `declutterPriority` - Placement priority for decluttering; higher wins
   *   an overlap (for points/billboards/text with `declutter` enabled)
   * - `image` - Image URL (for billboards); loaded once per distinct URL and
   *   packed into the layer's texture atlas. Return `null` to clear a
   *   previous per-feature image and revert to the material's default `url`;
   *   omit the key to leave it unchanged.
   * - `emissive` - Emissive color (for batched polygons/3D Tiles models/
   *   points/billboards/text; ignored on models without batch/feature ids).
   *   Pairs with `emissiveIntensity` and drives selective bloom. On text only
   *   the glyph fill glows — outline and background stay dark.
   * - `emissiveIntensity` - Emissive intensity multiplier (for batched
   *   polygons/3D Tiles models/points/billboards/text)
   *
   * Note: Evaluated styles override the layer's default styles.
   *
   * @param f Callback function that receives feature info, returns style values
   * @param options.filters - Root property's keys that get only the matched property values.
   *
   * @example
   * ```typescript
   * // Color MVT features based on a category property
   * evaluator.evaluate(({ properties }) => {
   *   const category = properties?.["category"] as string;
   *
   *   const color = (() => {
   *     if (category === "A") return "#0000ff";
   *     if (category === "B") return "#00ff00";
   *     return "#ff0000";
   *   })();
   *
   *   return {
   *     color: new Color().setStyle(color),
   *   };
   * });
   *
   * // Filter and style text labels
   * evaluator.evaluate(({ properties }) => {
   *   const text = properties?.["name"] as string;
   *
   *   return {
   *     text,
   *     show: !!text,
   *   };
   * });
   * ```
   */
  evaluate(
    f: FeatureEvaluatorCallback,
    options?: {
      filters?: string[];
    },
  ) {
    const evaluate = (info: FeatureInfo, batchIndex: number) => {
      const evaluated = f(info);
      this.applyEvaluatedValues(batchIndex, evaluated);
    };

    if (options?.filters) {
      this.readFilteredFeatureProperties(options.filters, evaluate);
    } else {
      this.readFeatureProperties(evaluate);
    }
  }

  private applyEvaluatedValues(
    batchIndex: number,
    evaluated: Partial<EvaluatedValue>,
  ) {
    const obj = this.obj;

    // Sprites apply by batch index: a feature can own several instances
    // (MultiPoint, points derived from line/polygon vertices), so a
    // batch-id keyed lookup would style only one of them.
    if (obj instanceof InstancedSpriteMesh) {
      if (evaluated.color != null) {
        obj.setFeatureColorByBatchIndex(batchIndex, evaluated.color.raw);
      }
      if (evaluated.show != null) {
        obj.setFeatureShowByBatchIndex(batchIndex, evaluated.show);
      }
      if (evaluated.height != null) {
        obj.setFeatureHeightByBatchIndex(batchIndex, evaluated.height);
      }
      if (evaluated.size != null) {
        obj.setFeatureSizeByBatchIndex(batchIndex, evaluated.size);
      }
      if (evaluated.opacity != null) {
        obj.setFeatureOpacityByBatchIndex(batchIndex, evaluated.opacity);
      }
      if (evaluated.declutterPriority != null) {
        obj.setFeatureDeclutterPriorityByBatchIndex(
          batchIndex,
          evaluated.declutterPriority,
        );
      }
      if (evaluated.emissive != null) {
        obj.setFeatureEmissiveByBatchIndex(batchIndex, evaluated.emissive.raw);
      }
      if (evaluated.emissiveIntensity != null) {
        obj.setFeatureEmissiveIntensityByBatchIndex(
          batchIndex,
          evaluated.emissiveIntensity,
        );
      }
      if ("image" in evaluated) {
        // Async by nature (the image may need fetching); the atlas dedupes
        // loads by URL so evaluating many features costs one fetch per image.
        // A nullish url clears the override back to the material default.
        void obj.setFeatureImageByBatchIndex(batchIndex, evaluated.image);
      }
      return;
    }

    if (obj instanceof InstancedMesh) {
      if (evaluated.color != null) {
        obj.setFeatureColorByBatchIndex(batchIndex, evaluated.color.raw);
      }
      if (evaluated.show != null) {
        obj.setFeatureShowByBatchIndex(batchIndex, evaluated.show);
      }
      if (evaluated.height != null) {
        obj.setFeatureHeightByBatchIndex(batchIndex, evaluated.height);
      }
      if (evaluated.text != null && obj instanceof BatchedSdfTextMesh) {
        obj.setTextByBatchIndex(batchIndex, evaluated.text);
      }
      if (evaluated.size != null && obj instanceof BatchedSdfTextMesh) {
        obj.setFeatureSizeByBatchIndex(batchIndex, evaluated.size);
      }
      if (evaluated.opacity != null && obj instanceof BatchedSdfTextMesh) {
        obj.setFeatureOpacityByBatchIndex(batchIndex, evaluated.opacity);
      }
      if (
        evaluated.declutterPriority != null &&
        obj instanceof BatchedSdfTextMesh
      ) {
        obj.setFeatureDeclutterPriorityByBatchIndex(
          batchIndex,
          evaluated.declutterPriority,
        );
      }
      if (evaluated.emissive != null && obj instanceof BatchedSdfTextMesh) {
        obj.setFeatureEmissiveByBatchIndex(batchIndex, evaluated.emissive.raw);
      }
      if (
        evaluated.emissiveIntensity != null &&
        obj instanceof BatchedSdfTextMesh
      ) {
        obj.setFeatureEmissiveIntensityByBatchIndex(
          batchIndex,
          evaluated.emissiveIntensity,
        );
      }
      return;
    }

    if (obj instanceof BatchedFeatureMesh) {
      obj._initBatchDataTexture();
      this.apply(obj, undefined, batchIndex, evaluated);
      return;
    }

    if (obj instanceof ModelMesh) {
      obj.traverse((m) => {
        if (!(m instanceof Mesh)) return;
        obj._initBatchDataTexture(m);
        this.apply(m, obj, batchIndex, evaluated);
      });
    }
  }

  private apply(
    m: Mesh | BatchedFeatureMesh,
    parent: ModelMesh | undefined,
    batchIndex: number,
    evaluated: Partial<EvaluatedValue>,
  ) {
    const batchIdAttr =
      "geometry" in m ? m.geometry.getAttribute("_batchid") : undefined;

    // Non-batched feature mesh path (a mesh without a `_batchid` attribute,
    // e.g. a plain glTF model layer whose meshes carry no feature ids —
    // GeoJSON polygons/polylines are batched). Only the attributes below are
    // applicable here; emissive/emissiveIntensity need the batch texture.
    const featureMesh = (() => {
      if (batchIdAttr) return;
      if (parent) return isFeatureMesh(parent) ? parent : undefined;
      return isFeatureMesh(m) ? m : undefined;
    })();

    if (featureMesh) {
      if (evaluated.color != null) {
        featureMesh._setFeatureColor(
          evaluated.color.raw,
          m.material as ModelMaterial,
        );
      }
      if (evaluated.show != null) {
        featureMesh._setFeatureShow(evaluated.show);
      }
      if (evaluated.height != null) {
        featureMesh._setFeatureHeight(evaluated.height);
      }
      if (evaluated.opacity != null) {
        featureMesh._setFeatureOpacity(evaluated.opacity);
      }
      return;
    }

    // Batched mesh path
    if (!batchIdAttr) return;

    const mesh =
      parent instanceof ModelMesh
        ? parent
        : m instanceof BatchedFeatureMesh
          ? m
          : undefined;
    if (!mesh) return;

    const updateBatchAttribute = (
      attribute: ModelBatchedAttributeName | BatchedAttributeName,
      value: number | number[] | boolean,
    ) => {
      if (mesh instanceof ModelMesh) {
        mesh._updateBatchAttribute(
          m as Mesh<BufferGeometry<NormalBufferAttributes>, ModelMaterial>,
          batchIndex,
          attribute as ModelBatchedAttributeName,
          value,
        );
      } else {
        mesh._updateBatchAttribute(
          batchIndex,
          attribute as BatchedAttributeName,
          value,
        );
      }
    };

    if (evaluated.color != null) {
      updateBatchAttribute("color", evaluated.color.toArray());
    }
    if (evaluated.show != null) {
      updateBatchAttribute("show", evaluated.show);
    }
    if (evaluated.height != null) {
      updateBatchAttribute("height", evaluated.height);
    }
    if (evaluated.extrudedHeight != null) {
      updateBatchAttribute("extrudedHeight", evaluated.extrudedHeight);
    }
    if (evaluated.width != null) {
      updateBatchAttribute("lineWidth", evaluated.width);
    }
    if (evaluated.opacity != null) {
      updateBatchAttribute("opacity", evaluated.opacity);
    }
    if (evaluated.emissive != null) {
      updateBatchAttribute("emissive", evaluated.emissive.toArray());
    }
    if (evaluated.emissiveIntensity != null) {
      updateBatchAttribute("emissiveIntensity", evaluated.emissiveIntensity);
    }

    // size is handled by InstancedSpriteMesh / BatchedSdfTextMesh paths above
  }
}
