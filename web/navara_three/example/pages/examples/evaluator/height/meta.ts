import type { ExampleMeta } from "../../sections";

export default {
  section: "2.5d",
  order: 2,
  title: { en: "Extrude Buildings by Height", ja: "高さ属性で建物を立体化" },
  description: {
    en: "Extrude vector tile building footprints by their height attribute with FeatureEvaluator.",
    ja: "FeatureEvaluator でベクタータイルの建物を高さ属性で押し出す。",
  },
  docs: "three/api/feature-evaluator",
} satisfies ExampleMeta;
