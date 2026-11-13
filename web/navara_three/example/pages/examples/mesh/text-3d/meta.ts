import type { ExampleMeta } from "../../sections";

export default {
  section: "3d",
  order: 10,
  title: { en: "Font 3D Object", ja: "フォント 3D オブジェクト" },
  description: {
    en: "3D text objects placed among global buildings.",
    ja: "世界の建物の中に 3D の文字オブジェクトを置く。",
  },
  docs: "three_default_descs/mesh-desc/text-3d-mesh-desc",
  since: "0.3.2",
} satisfies ExampleMeta;
