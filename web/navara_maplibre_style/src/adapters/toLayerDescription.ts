/**
 * Converts MapLibre Style layer to Navara layer description.
 */

import {
  type LayerDescription,
  type Overlap,
  type Source,
  type SourceGeometryType,
  type VectorLayer,
} from "@navaramap/three";

import type { StyleEngine } from "../engine/StyleEngine";
import { type StyleLayer, type ValueExpression } from "../engine/types";
import {
  expressionUsesGeometryType,
  expressionUsesZoom,
} from "../utils/expressionHelpers";

import { CONSTRUCTION_ZOOM, resolveSymbolOrientation } from "./symbolAlignment";
import { toNavaraColor } from "./toEvaluatedValue";

type TextDescription = NonNullable<VectorLayer["text"]>;
type BillboardDescription = NonNullable<VectorLayer["billboard"]>;

/**
 * Symbol properties evaluated for the whole layer that `layer.update()`
 * applies to labels already shown, so they can follow zoom. The rest of the
 * layer-level properties (placement, spacing, geometry types) are baked into
 * tile geometry and stay at {@link CONSTRUCTION_ZOOM}.
 */
const ZOOM_FOLLOWING_SYMBOL_PROPERTIES = {
  layout: [
    "text-rotation-alignment",
    "text-pitch-alignment",
    "icon-rotation-alignment",
    "icon-pitch-alignment",
    "text-keep-upright",
    "text-max-angle",
    "text-max-width",
    "text-justify",
    "icon-anchor",
    "text-allow-overlap",
    "icon-allow-overlap",
    "text-overlap",
    "icon-overlap",
    "text-ignore-placement",
    "icon-ignore-placement",
    "text-padding",
    "icon-padding",
  ],
  paint: ["text-halo-color", "text-halo-width"],
} as const;

/**
 * Whether a symbol layer sets a layer-level property with a zoom expression,
 * so its description must be rebuilt as the zoom changes.
 */
export function symbolLayerFollowsZoom(styleLayer: StyleLayer): boolean {
  if (styleLayer.type !== "symbol") return false;
  return (["layout", "paint"] as const).some((kind) => {
    const values = styleLayer[kind] as Record<string, unknown> | undefined;
    return ZOOM_FOLLOWING_SYMBOL_PROPERTIES[kind].some((key) =>
      expressionUsesZoom(values?.[key]),
    );
  });
}

/**
 * Evaluate a layout/paint property for the whole layer at `zoom`, falling
 * back to the spec default when the style omits it. Returns `undefined` only
 * for properties with no spec default that the style leaves unset.
 */
function evaluateLayerProperty(
  engine: StyleEngine,
  styleLayer: StyleLayer,
  kind: "layout" | "paint",
  key: string,
  zoom = CONSTRUCTION_ZOOM,
): unknown {
  const spec =
    kind === "layout"
      ? engine.getLayoutSpec(styleLayer.type, key)
      : engine.getPaintSpec(styleLayer.type, key);
  if (!spec) return undefined;

  const values = styleLayer[kind] as
    Record<string, ValueExpression | undefined> | undefined;
  const expr = values?.[key] ?? (spec.default as ValueExpression | undefined);
  if (expr === undefined) return undefined;

  try {
    return engine.createValueFn(
      expr,
      spec,
    )({
      properties: undefined,
      zoom,
    });
  } catch (err) {
    console.warn(
      `Failed to evaluate ${key} for layer "${styleLayer.id}":`,
      err,
    );
    return spec.default;
  }
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export type SymbolPlacement = "point" | "line" | "line-center";

/**
 * Resolve a symbol layer's `symbol-placement`. Without an engine (or for
 * non-symbol layers) this is always `"point"`.
 */
export function getSymbolPlacement(
  styleLayer: StyleLayer,
  engine?: StyleEngine,
): SymbolPlacement {
  if (!engine || styleLayer.type !== "symbol") return "point";
  const value = evaluateLayerProperty(
    engine,
    styleLayer,
    "layout",
    "symbol-placement",
  );
  return value === "line" || value === "line-center" ? value : "point";
}

/**
 * Source geometry a symbol layer consumes. Along-line placement takes lines
 * only. Point placement labels every geometry, as MapLibre does: a line once
 * at its first vertex, a polygon at its pole of inaccessibility. The plugin
 * evaluates a symbol layer's filter as a single geometry type, though, so a
 * filter that tests it (`$type`, `["geometry-type"]`) would pass lines and
 * polygons as points; such layers keep the native point geometry only.
 */
function getSymbolGeometryTypes(
  styleLayer: StyleLayer,
  placement: SymbolPlacement,
): SourceGeometryType[] | undefined {
  if (placement !== "point") return ["line"];
  const filter = "filter" in styleLayer ? styleLayer.filter : undefined;
  return expressionUsesGeometryType(filter)
    ? undefined
    : ["point", "line", "polygon"];
}

/**
 * Resolve `*-overlap` — falling back to `*-allow-overlap` when it is unset,
 * as MapLibre does — and `*-ignore-placement`.
 */
function resolveOverlap(
  engine: StyleEngine,
  styleLayer: StyleLayer,
  prefix: "text" | "icon",
  zoom: number,
): { overlap: Overlap; ignorePlacement: boolean } {
  const evaluate = (key: string) =>
    evaluateLayerProperty(
      engine,
      styleLayer,
      "layout",
      `${prefix}-${key}`,
      zoom,
    );
  const overlap = evaluate("overlap");
  return {
    overlap:
      typeof overlap === "string"
        ? (overlap as Overlap)
        : evaluate("allow-overlap") === true
          ? "always"
          : "never",
    ignorePlacement: evaluate("ignore-placement") === true,
  };
}

/**
 * Resolve `*-padding` as the one to four CSS-ordered values the material's
 * `declutterPadding` takes. `text-padding` is a single number, `icon-padding`
 * either form.
 */
function resolvePadding(
  engine: StyleEngine,
  styleLayer: StyleLayer,
  prefix: "text" | "icon",
  zoom: number,
): number[] {
  const value = evaluateLayerProperty(
    engine,
    styleLayer,
    "layout",
    `${prefix}-padding`,
    zoom,
  );
  return typeof value === "number" ? [value] : (value as number[]);
}

/**
 * MapLibre `icon-anchor` → Navara sprite `center`: the anchor's position
 * within the sprite, x right and y up, in [-0.5, 0.5].
 */
const ICON_ANCHOR_CENTERS: Record<string, { x: number; y: number }> = {
  center: { x: 0, y: 0 },
  left: { x: -0.5, y: 0 },
  right: { x: 0.5, y: 0 },
  top: { x: 0, y: 0.5 },
  bottom: { x: 0, y: -0.5 },
  "top-left": { x: -0.5, y: 0.5 },
  "top-right": { x: 0.5, y: 0.5 },
  "bottom-left": { x: -0.5, y: -0.5 },
  "bottom-right": { x: 0.5, y: -0.5 },
};

/**
 * Helper to extract sourceLayers from MapLibre's source-layer property.
 * Returns an object with optional sourceLayers array.
 *
 * MapLibre uses singular "source-layer" (string) to specify which layer from a vector tile source to render.
 * Navara uses "sourceLayers" (array) to support multiple source layers in the future.
 */
function getSourceLayersField(styleLayer: StyleLayer): {
  sourceLayers?: string[];
} {
  if ("source-layer" in styleLayer && styleLayer["source-layer"]) {
    return { sourceLayers: [styleLayer["source-layer"]] };
  }
  return {};
}

/**
 * Create layer description for fill layer.
 */
function createFillLayer(
  source: Source,
  styleLayer: StyleLayer,
): LayerDescription {
  return {
    type: "vector",
    source,
    ...getSourceLayersField(styleLayer),
    polygon: {
      clampToGround: true,
    },
  };
}

/**
 * Create layer description for fill-extrusion layer.
 */
function createFillExtrusionLayer(
  source: Source,
  styleLayer: StyleLayer,
): LayerDescription {
  return {
    type: "vector",
    source,
    ...getSourceLayersField(styleLayer),
    polygon: {
      clampToGround: false,
    },
  };
}

/**
 * Create layer description for line layer.
 * Supports both LineString and Polygon sources (polygon boundaries).
 */
function createLineLayer(
  source: Source,
  styleLayer: StyleLayer,
): LayerDescription {
  return {
    type: "vector",
    source,
    ...getSourceLayersField(styleLayer),
    polyline: {
      clampToGround: true,
      // Support deriving polylines from both line and polygon geometries
      // This allows line layers to render polygon boundaries (e.g., country borders)
      geometryTypes: ["line", "polygon"],
    },
  };
}

/**
 * Create layer description for circle layer.
 */
function createCircleLayer(
  source: Source,
  styleLayer: StyleLayer,
): LayerDescription {
  return {
    type: "vector",
    source,
    ...getSourceLayersField(styleLayer),
    point: {
      clampToGround: true,
      center: { x: 0, y: -0.5 },
    },
  };
}

/**
 * Create layer description for raster layer.
 */
function createRasterLayer(source: Source): LayerDescription {
  return {
    type: "raster",
    source,
  };
}

/**
 * Create layer description for hillshade layer.
 */
function createHillshadeLayer(source: Source): LayerDescription {
  return {
    type: "raster",
    source,
    hillshade: {},
  };
}

/**
 * Lazy-initialized transparent placeholder image for expression-based icon-image.
 * Uses canvas.toDataURL() to create a minimal transparent PNG programmatically.
 *
 * Note: While this still produces a data: URL, it's created at runtime via Canvas
 * rather than hardcoded. In strict CSP environments where data: URLs are blocked,
 * consider using constant icon-image values instead of expressions, or configure
 * CSP to allow 'data:' for img-src.
 */
let transparentPlaceholder: string | null = null;

/**
 * Create a minimal transparent image using Canvas API.
 * Returns a data URL, but created programmatically to minimize size.
 * Falls back to SVG data URL in non-browser environments (SSR/Node).
 */
function getTransparentPlaceholder(): string {
  if (transparentPlaceholder) return transparentPlaceholder;

  try {
    // Create a 1x1 transparent canvas
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    // Canvas is already transparent by default
    transparentPlaceholder = canvas.toDataURL("image/png");
    return transparentPlaceholder;
  } catch {
    // Fallback to minimal SVG data URL if Canvas creation fails - cache it
    transparentPlaceholder =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
    return transparentPlaceholder;
  }
}

/**
 * Get icon URL from layout.
 * For constant strings, returns the URL directly.
 * For expressions, returns a transparent placeholder - the actual image will be set
 * dynamically via the `image` property during feature evaluation.
 */
function getIconUrl(iconImage: unknown): string {
  // If icon-image is a constant string, use it directly
  // If it's an expression, use transparent placeholder (will be overridden via feature.image)
  return typeof iconImage === "string" && iconImage
    ? iconImage
    : getTransparentPlaceholder();
}

/**
 * Create layer description for symbol layer.
 * Returns null if the layer is misconfigured (no icon-image or text-field).
 */
function createSymbolLayer(
  source: Source,
  styleLayer: StyleLayer,
  fontFamily?: string,
  engine?: StyleEngine,
  zoom = CONSTRUCTION_ZOOM,
  rank = 0,
): LayerDescription | null {
  const layout = styleLayer.layout;

  // Check what this symbol layer should render based on layout properties
  const hasIconImage = layout?.["icon-image"] !== undefined;
  const hasTextField = layout?.["text-field"] !== undefined;

  if (!hasIconImage && !hasTextField) {
    // Warn but don't throw - allows loading styles with misconfigured symbol layers
    console.warn(
      `Symbol layer "${styleLayer.id}" has no icon-image or text-field configured. Skipping layer.`,
    );
    return null;
  }

  // Warn if text is configured but no font provided
  if (hasTextField && !fontFamily) {
    console.warn(
      `Symbol layer "${styleLayer.id}" has text-field but no font was provided. ` +
        `Text rendering will be skipped. ` +
        `Provide fonts via style overrides: new MapLibreStylePlugin(style, { overrides: await fetchFontStyleOverrides('Open Sans', 'https://fonts.googleapis.com/...') })`,
    );
    // If there's no icon either, this layer can't render anything - skip it
    if (!hasIconImage) {
      return null;
    }
  }

  // Build layer description based on what's configured
  const layerDesc: LayerDescription = {
    type: "vector",
    source,
    ...getSourceLayersField(styleLayer),
  };

  const placement = getSymbolPlacement(styleLayer, engine);
  const alongLine = placement !== "point";
  const geometryTypes = getSymbolGeometryTypes(styleLayer, placement);
  const orientation = engine
    ? resolveSymbolOrientation(styleLayer, engine, zoom)
    : undefined;

  if (hasIconImage) {
    const iconAnchor =
      engine && layout?.["icon-anchor"] !== undefined
        ? evaluateLayerProperty(
            engine,
            styleLayer,
            "layout",
            "icon-anchor",
            zoom,
          )
        : undefined;

    layerDesc.billboard = {
      size: 1.0,
      height: 1,
      sizeInMeters: false,
      clampToGround: true,
      depthTest: true,
      url: getIconUrl(layout?.["icon-image"]),
      offsetDepth: true,
      transparent: true,
      center:
        (typeof iconAnchor === "string" && ICON_ANCHOR_CENTERS[iconAnchor]) ||
        (hasTextField ? { x: 1.0, y: -0.5 } : { x: 0.5, y: -0.5 }),
    };

    if (engine && orientation) {
      Object.assign(layerDesc.billboard, {
        placement,
        ...orientation.icon,
        declutter: true,
        declutterRank: rank,
        declutterPadding: resolvePadding(engine, styleLayer, "icon", zoom),
        ...resolveOverlap(engine, styleLayer, "icon", zoom),
        ...(geometryTypes && { geometryTypes }),
        ...(alongLine && { spacing: orientation.spacing }),
      } satisfies Partial<BillboardDescription>);
    }
  }

  if (hasTextField && fontFamily) {
    layerDesc.text = {
      clampToGround: true,
      font: fontFamily, // Use the font family name registered via addFontFamily
      text: "",
      size: 1.0,
      sizeInMeters: false,
      center: hasIconImage ? { x: 0.0, y: 0.0 } : { x: 0.5, y: 0.0 },
      depthTest: true,
      offsetDepth: true,
      declutter: true, // Enable declutter to hide duplicate/overlapping labels
    };

    // Apply text-halo properties (outlineColor/outlineWidth/outlineOpacity)
    // TODO: Text halo is currently a layer-level property, evaluated at the layer's zoom with
    // properties=undefined. This means text-halo expressions cannot use feature properties.
    // To fix this, Navara's EvaluatedValue should support outlineColor/outlineWidth fields so
    // they can be evaluated per-feature.
    if (engine && orientation && styleLayer.type === "symbol") {
      const justify = evaluateLayerProperty(
        engine,
        styleLayer,
        "layout",
        "text-justify",
        zoom,
      );

      Object.assign(layerDesc.text, {
        placement,
        ...orientation.text,
        declutterRank: rank,
        declutterPadding: resolvePadding(engine, styleLayer, "text", zoom),
        ...resolveOverlap(engine, styleLayer, "text", zoom),
        // MapLibre never wraps or justifies labels placed along a line.
        maxWidth: alongLine
          ? 0
          : finiteOr(
              evaluateLayerProperty(
                engine,
                styleLayer,
                "layout",
                "text-max-width",
                zoom,
              ),
              10,
            ),
        // `auto` aligns towards the anchor; `text-anchor` is not mapped, so
        // it falls back to centered like the other unknown values.
        textAlign:
          !alongLine && (justify === "left" || justify === "right")
            ? justify
            : "center",
        ...(geometryTypes && { geometryTypes }),
        ...(alongLine && { spacing: orientation.spacing }),
      } satisfies Partial<TextDescription>);

      // Track color alpha separately to combine with explicit opacity at the end
      let haloColorAlpha = 1.0;

      if (styleLayer.paint?.["text-halo-color"] !== undefined) {
        // Convert to Navara Color and extract alpha (don't set opacity yet)
        const colorResult = toNavaraColor(
          evaluateLayerProperty(
            engine,
            styleLayer,
            "paint",
            "text-halo-color",
            zoom,
          ),
        );
        if (colorResult) {
          layerDesc.text.outlineColor = colorResult.color;
          haloColorAlpha = colorResult.alpha;
        }
      }

      if (styleLayer.paint?.["text-halo-width"] !== undefined) {
        const widthValue = evaluateLayerProperty(
          engine,
          styleLayer,
          "paint",
          "text-halo-width",
          zoom,
        );
        if (typeof widthValue === "number" && Number.isFinite(widthValue)) {
          // MapLibre text-halo-width is in screen pixels
          // Navara outlineWidth is in texels at 64px/em reference density
          // For now, use the value directly (may need adjustment based on text-size)
          layerDesc.text.outlineWidth = widthValue;
        }
      }

      // Combine color alpha with explicit opacity (if text-halo-opacity is evaluated in future)
      // Only set opacity if a halo color was configured (avoid forcing default when no halo)
      if (layerDesc.text.outlineColor !== undefined) {
        const explicitOpacity = layerDesc.text.outlineOpacity;
        // Only set opacity if there's an explicit value or the color has alpha < 1
        // This preserves undefined behavior when haloColorAlpha === 1.0 (engine default)
        if (explicitOpacity !== undefined || haloColorAlpha !== 1.0) {
          const finalOpacity =
            explicitOpacity !== undefined
              ? haloColorAlpha * explicitOpacity
              : haloColorAlpha;
          // Validate finalOpacity is finite, fall back to 1.0 if NaN/Infinity
          const validOpacity = Number.isFinite(finalOpacity)
            ? finalOpacity
            : 1.0;
          // Clamp to [0, 1] to handle invalid input or multiplication overflow
          layerDesc.text.outlineOpacity = Math.max(
            0,
            Math.min(1, validOpacity),
          );
        }
      }
    }
  }

  return layerDesc;
}

/**
 * Convert MapLibre Style layer to Navara layer description.
 *
 * @param source - Navara source object
 * @param styleLayer - MapLibre layer specification
 * @param fontFamily - Optional font family name for text rendering (ignores style's text-font)
 * @param engine - Optional style engine for evaluating expressions (e.g., text-halo properties)
 * @param zoom - Zoom to evaluate the layer-level symbol properties that can
 *   follow it at (see {@link symbolLayerFollowsZoom}); defaults to
 *   {@link CONSTRUCTION_ZOOM}
 * @param rank - Symbol placement rank: the layer's index in the style, as
 *   MapLibre places symbols from the top-most layer down
 * @returns Navara layer description, or null if the layer cannot be processed
 *
 * Note: Returns null for unsupported/misconfigured layers instead of throwing,
 * allowing the plugin to continue loading other layers from third-party styles.
 * Reasons for returning null:
 * - Unsupported layer type (e.g., "background", "sky")
 * - Misconfigured symbol layer (no icon-image or text-field)
 */
export function toLayerDescription(
  source: Source,
  styleLayer: StyleLayer,
  fontFamily?: string,
  engine?: StyleEngine,
  zoom?: number,
  rank?: number,
): LayerDescription | null {
  switch (styleLayer.type) {
    case "fill":
      return createFillLayer(source, styleLayer);
    case "fill-extrusion":
      return createFillExtrusionLayer(source, styleLayer);
    case "line":
      return createLineLayer(source, styleLayer);
    case "circle":
      return createCircleLayer(source, styleLayer);
    case "raster":
      return createRasterLayer(source);
    case "hillshade":
      return createHillshadeLayer(source);
    case "symbol":
      return createSymbolLayer(
        source,
        styleLayer,
        fontFamily,
        engine,
        zoom,
        rank,
      );
    default:
      // Warn but don't throw - allows loading third-party styles with unsupported layers
      // TypeScript exhaustively narrows styleLayer to never, but we handle unknown types at runtime
      console.warn(
        `Layer "${(styleLayer as StyleLayer).id}": Unsupported layer type "${(styleLayer as StyleLayer).type}". Skipping layer.`,
      );
      return null;
  }
}
