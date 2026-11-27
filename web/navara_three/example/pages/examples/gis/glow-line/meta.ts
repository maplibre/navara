import type { ExampleMeta } from "../../sections";

export default {
  section: "2d",
  order: 2.5,
  title: { en: "Glow line", ja: "光るライン" },
  description: {
    en: "Make lines glow by drawing a wide blurred line under a thin sharp one.",
    ja: "太くぼかしたラインの上に細いラインを重ねて、ラインを光らせる。",
  },
  docs: "three/material/polyline-material#blur",
  since: "0.3.2",
} satisfies ExampleMeta;
