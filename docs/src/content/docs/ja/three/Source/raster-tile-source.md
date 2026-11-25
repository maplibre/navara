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
| `minZoom`           | `number`        | `0`        | タイルが提供される最小ズームレベル。                   |
| `maxZoom`           | `number`        | `20`       | 新しいタイルを要求する最大ズームレベル。               |
| `overscaledMaxZoom` | `number`        | `24`       | オーバースケール（親を引き伸ばした）タイルを使用する最大ズーム。 |

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
