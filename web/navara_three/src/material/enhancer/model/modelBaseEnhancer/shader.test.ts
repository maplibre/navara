import { testShaderCompatibility } from "../../test-utils/shaderCompatibility";

import { MODEL_BASE_SHADER_MARKERS } from "./markers";

import { createModelBaseEnhancer, type SupportedMaterial } from ".";

testShaderCompatibility(
  "modelBaseEnhancer",
  (material) => createModelBaseEnhancer(material as SupportedMaterial),
  [
    {
      name: "Default props",
      props: {},
    },
  ],
  MODEL_BASE_SHADER_MARKERS,
);
