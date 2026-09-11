import type { ExampleMeta } from "../../sections";

export default {
  section: "lighting-effect",
  order: 4,
  title: { en: "Image Based Lighting", ja: "イメージベースドライティング" },
  description: {
    en: "Light white buildings with spherical harmonics for a neon basemap.",
    ja: "球面調和関数で白い建物をネオンベースマップ向けにライティング",
  },
  docs: "three_default_descs/light-desc/light-probe-desc",
} satisfies ExampleMeta;
