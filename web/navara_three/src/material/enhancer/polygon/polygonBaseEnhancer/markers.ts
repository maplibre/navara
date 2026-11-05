import { type ShaderMarkers, createShaderReplacer } from "../../ShaderReplacer";

export const POLYGON_BASE_SHADER_MARKERS = {
  vertex: {},
  fragment: {
    /** Start of polygon uniform declarations. */
    UNIFORM_START: "// NVR_POLYGON_BASE_UNIFORM_START",
    /** End of polygon uniform declarations. */
    UNIFORM_END: "// NVR_POLYGON_BASE_UNIFORM_END",
    /** Start of normal computation block. */
    NORMAL_START: "// NVR_POLYGON_BASE_NORMAL_START",
    /** End of normal computation block. */
    NORMAL_END: "// NVR_POLYGON_BASE_NORMAL_END",
    /** Start of the lit (non clamp-to-ground) outgoing light additions. */
    OUTGOING_LIGHT_START: "// NVR_POLYGON_BASE_OUTGOING_LIGHT_START",
    /** End of the lit outgoing light additions. */
    OUTGOING_LIGHT_END: "// NVR_POLYGON_BASE_OUTGOING_LIGHT_END",
    /** Start of the final normal assignment block (used for MRT output). */
    FINAL_NORMAL_START: "// NVR_POLYGON_BASE_FINAL_NORMAL_START",
    /** End of the final normal assignment block (used for MRT output). */
    FINAL_NORMAL_END: "// NVR_POLYGON_BASE_FINAL_NORMAL_END",
  },
} as const satisfies ShaderMarkers;

export function createPolygonBaseShaderReplacer(source: string) {
  return createShaderReplacer<typeof POLYGON_BASE_SHADER_MARKERS>(source);
}
