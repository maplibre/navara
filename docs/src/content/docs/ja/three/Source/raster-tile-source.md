---
title: Raster Tile Source
description: raster-tile（画像）の Source
sidebar:
  order: 330
---

`raster-tile` Source は、ラスター画像タイル（XYZ または TMS）を記述します。[`raster`](../../../three/layer/raster-layer/) レイヤーで描画します。

## プロパティ

| プロパティ            | 型            | デフォルト    | 説明                                              |
| ------------------- | --------------- | ---------- | ------------------------------------------------------- |
| `type`              | `"raster-tile"` | （必須） | Source のタイプ。                                       |
| `url`               | `string`        | （必須） | タイル URL テンプレート（`{z}/{x}/{y}` を含む）。      |
| `tms`               | `boolean`       | `false`    | タイルスキームが Y 軸方向に反転しているか（TMS）。     |
| `tileSize`          | `number`        | `512`      | タイル 1 枚のピクセルサイズ。ズームは 512 px タイルを基準に定義されるため、`256` を指定すると同じカメラ高度で `512` より 1 レベル細かいタイルが選ばれます。 |
| `minZoom`           | `number`        | `0`        | タイルが提供される最小ズームレベル。                   |
| `maxZoom`           | `number`        | `20`       | 新しいタイルを要求する最大ズームレベル。               |
| `overscaledMaxZoom` | `number`        | `24`       | オーバースケール（親を引き伸ばした）タイルを使用する最大ズーム。 |

`tileSize` を小さくすると、画像の鮮明さを保つために地形がより深く分割されます。WebMercator 地形（デフォルト）では、`256` の Source は地形タイルを 1 レベル細かくし、タイル数は約 4 倍になります。Geographic 地形では、代わりに画像が 1 レベル深く貼り付けられ、地形タイル 1 枚あたりのタイル数の上限がレベルごとに 4 倍に引き上げられます。この調整は最大 2 レベルまで深くする方向に制限されるため、`128` 未満の `tileSize` は `128` と同じ動作になります。`512` を超える値は `512` と同じ動作になります。

## 使用例

```typescript
import ThreeView from "@navaramap/three";

const imagery = view.addSource({
  type: "raster-tile",
  url: "https://example.com/{z}/{x}/{y}.png",
  maxZoom: 19,
});

view.addLayer({ type: "raster", source: imagery });

// ラスター画像は `raster` でスタイリングします。
view.addLayer({ type: "raster", source: imagery, raster: { opacity: 0.8 } });
```

## 関連リソース

- [About Source](../../../three/source/about/)
- [RasterMaterial](../../../three/material/raster-material/): ラスターレイヤーの描画オプション
