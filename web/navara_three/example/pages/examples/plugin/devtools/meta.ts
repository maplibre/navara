import type { ExampleMeta } from "../../sections";

export default {
  section: "interaction",
  order: 8,
  title: { en: "Devtools", ja: "Devtools" },
  description: {
    en: "Inspect a running map: frame time, memory, downloads, render buffers, and each layer's cost and style.",
    ja: "動作中の地図を調べる。フレーム時間、メモリ、ダウンロード、描画バッファ、各レイヤーのコストとスタイル。",
  },
  docs: "three_plugins/devtoolsplugin",
  since: "0.3.2",
} satisfies ExampleMeta;
