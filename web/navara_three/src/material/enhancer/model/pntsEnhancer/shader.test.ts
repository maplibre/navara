import { testShaderCompatibility } from "../../test-utils/shaderCompatibility";

import { PNTS_SHADER_MARKERS } from "./markers";

import { createPntsEnhancer, type SupportedMaterial } from ".";

testShaderCompatibility(
  "pntsEnhancer",
  (material) => createPntsEnhancer(material as SupportedMaterial),
  [
    {
      name: "Default props",
      props: {},
    },
    {
      name: "With all props",
      props: {
        color: 0xff0000,
        pointSize: 5,
        height: 100,
        geodeticNormal: { x: 0.1, y: 0.2, z: 0.97 },
      },
    },
    {
      name: "With srgbVertexColor",
      props: {
        srgbVertexColor: true,
      },
    },
  ],
  PNTS_SHADER_MARKERS,
);
