import { testShaderCompatibility } from "../../test-utils/shaderCompatibility";

import { POLYGON_BASE_SHADER_MARKERS } from "./markers";

import { createPolygonBaseEnhancer, type SupportedMaterial } from ".";

testShaderCompatibility(
  "polygonBaseEnhancer",
  (material) => createPolygonBaseEnhancer(material as SupportedMaterial),
  [
    {
      name: "With RTE",
      props: {
        useRTE: true,
      },
    },
    {
      name: "Without RTE",
      props: {
        useRTE: false,
      },
    },
    {
      name: "Sides shaded as the surface",
      props: {
        useRTE: true,
        shadeSidesAsSurface: true,
      },
    },
  ],
  POLYGON_BASE_SHADER_MARKERS,
);
