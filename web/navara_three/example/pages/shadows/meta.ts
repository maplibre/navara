import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three_csm/**",
    "web/navara_three/src/material/shadowDepthMaterial*",
    "web/navara_three/src/ShadowMapViewers*",
    "shaders/glsl/chunks/shadowmap_depth*",
    "web/navara_three_default_descs/src/lights/sunLight.ts",
    "web/navara_three_default_descs/src/lights/SunLightDesc.ts",
  ],
  lookFor:
    "GSI terrain and PLATEAU buildings cast and receive cascaded sun shadows; the pane sets cascade count, mode, lambda, map size, far, margin, bias and intensity, per-layer cast/receive, and shadowMapViewers shows each cascade's depth map. Look for shadow acne, peter-panning, seams between cascades and shadows that swim as the camera moves.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
