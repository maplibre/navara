import type { ExampleMeta } from "../../sections";

export default {
  section: "lighting-effect",
  order: 36,
  title: { en: "SSAO", ja: "SSAO" },
  description: {
    en: "Shape an white building with ambient occlusion alone.",
    ja: "白い建物をSSAOのみで陰影づけする。",
  },
  docs: "three_default_descs/effect-desc/ssao-effect-desc",
} satisfies ExampleMeta;
