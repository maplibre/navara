import type { ExampleMeta } from "../../sections";

export default {
  section: "interaction",
  order: 7,
  title: { en: "Draw polygons", ja: "ポリゴンの作図" },
  description: {
    en: "Draw PolygonMesh and PolylineMesh.",
    ja: "PolygonMesh と PolylineMesh を描く。",
  },
  docs: "three_default_descs/mesh-desc/polygon-mesh-desc",
} satisfies ExampleMeta;
