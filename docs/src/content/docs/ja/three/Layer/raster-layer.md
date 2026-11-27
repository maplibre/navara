---
title: Raster Layer
description: raster-tile または raster-dem の Source を画像・陰影起伏・標高ヒートマップとして描画する
sidebar:
  order: 420
---

`raster` レイヤーは、[`raster-tile`](../../../three/source/raster-tile-source/) の Source を画像として、または [`raster-dem`](../../../three/source/raster-dem-source/) の Source を陰影起伏や標高ヒートマップとして描画します。[`terrain`](../../../three/layer/terrain-layer/) レイヤーが存在する場合、画像は 3D の地表にドレープ（投影）されます。存在しない場合は平坦なグローブ上に描画されます。

## プロパティ

| プロパティ | 型                 | 説明                                                   |
| -------- | ------------------ | ----------------------------------------------------- |
| `type`   | `"raster"`         | レイヤータイプ（必須）。                                 |
| `source` | `Source \| string` | `raster-tile` または `raster-dem` の Source（必須）。   |

### 描画オプション

| マテリアル                                                                            | 設定キー           | 説明                                                            |
| ------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------- |
| [RasterMaterial](../../../three/material/raster-material/)                       | `raster`           | 画像の見た目（色、不透明度など）。                              |
| [HillshadeMaterial](../../../three/material/hillshade-material/)                 | `hillshade`        | `raster-dem` の Source から生成する陰影起伏。                   |
| [ElevationHeatmapMaterial](../../../three/material/elevation-heatmap-material/)  | `elevationHeatmap` | `raster-dem` の Source から生成する色分けされた標高。           |

:::note
`hillshade` と `elevationHeatmap` は DEM タイルをデコードするため、`raster-dem` の Source が必要です。標高デコーダは Source（`raster-dem` の `elevationDecoder`）から取得され、描画オプションからは取得されません。
:::

## 使用例

### 画像

```typescript
import ThreeView from "@navaramap/three";

const view = new ThreeView(/* options */);
await view.init();

const imagery = view.addSource({
  type: "raster-tile",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  maxZoom: 19,
});

view.addLayer({ type: "raster", source: imagery, raster: { opacity: 1 } });
```

### 陰影起伏

`raster-dem` の Source を参照します。デコーダは Source 側にあります。

```typescript
import ThreeView, { TERRARIUM_ELEVATION_DECODER } from "@navaramap/three";

const dem = view.addSource({
  type: "raster-dem",
  url: "https://example.com/terrarium/{z}/{x}/{y}.png",
  elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
  maxZoom: 17,
  minZoom: 5,
});

view.addLayer({
  type: "raster",
  source: dem,
  hillshade: { exaggeration: 0.5 },
});
```

### 標高ヒートマップ

```typescript
view.addLayer({
  type: "raster",
  source: dem,
  elevationHeatmap: {
    maxHeight: 3000,
    minHeight: 0,
    logarithmic: true,
    logBoundary: 1000,
  },
});
```

## ドレープできるレイヤー数の上限

地形に同時にドレープできるレイヤーの数には上限があり、その数はデバイスによって異なります。`raster: { show: false }` で非表示にした `raster` レイヤーは数に含まれないため、切り替え用のベースマップは追加したまま `show` で切り替えられます。 :since[0.3.2]

収まる数より多くのレイヤーを表示すると、上に重なるレイヤーから描画されなくなり、コンソールに `Too many layers draped on the terrain: …` が出力されます。上限の詳細と今後の改善については [issue #1039](https://github.com/maplibre/navara/issues/1039) を参照してください。

## 関連リソース

- [Raster Tile Source](../../../three/source/raster-tile-source/) / [Raster DEM Source](../../../three/source/raster-dem-source/)
- [RasterMaterial](../../../three/material/raster-material/) / [HillshadeMaterial](../../../three/material/hillshade-material/) / [ElevationHeatmapMaterial](../../../three/material/elevation-heatmap-material/)
- [Terrain Layer](../../../three/layer/terrain-layer/): 3D 地形に画像をドレープする
