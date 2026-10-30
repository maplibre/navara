import type { ExampleMeta } from "../../sections";

export default {
  section: "showcase",
  order: 10,
  title: { en: "Night City", ja: "夜の都市" },
  description: {
    en: "Lit windows, street lamps and moving traffic over OpenStreetMap buildings and roads at night.",
    ja: "OpenStreetMap の建物と道路に、灯る窓・街灯・流れる車を重ねた夜景。",
  },
  docs: "three_default_descs/effect-desc/building-windows-effect-desc",
} satisfies ExampleMeta;
