import type { ExampleMeta } from "../../sections";

export default {
  section: "styling",
  order: 4,
  title: { en: "Emissive by Attribute", ja: "属性で発光" },
  description: {
    en: "Drive per-feature emissive from an attribute and make it glow with selective bloom.",
    ja: "属性値から地物ごとの emissive を決め、selective bloom で発光させる。",
  },
  docs: "three/api/feature-evaluator",
} satisfies ExampleMeta;
