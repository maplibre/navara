---
title: Terrain Layer
description: raster-dem または quantized-mesh の Source を 3D 地形として描画する
sidebar:
  order: 430
---

`terrain` レイヤーは、[`raster-dem`](../../../three/source/raster-dem-source/) の Source（GPU 上でデコードされる RGB エンコードされた標高タイル）または [`quantized-mesh`](../../../three/source/quantized-mesh-source/) の Source（あらかじめメッシュ化されたタイル、例：Cesium Ion）を、3D グローブの地表として描画します。描画オプションは Source のデータ形式にかかわらず同じで、取得・ジオメトリの設定はすべて Source 側にあります。

## プロパティ

| プロパティ | 型                 | 説明                                                    |
| -------- | ------------------ | ------------------------------------------------------ |
| `type`   | `"terrain"`        | レイヤータイプ（必須）。                                 |
| `source` | `Source \| string` | `raster-dem` または `quantized-mesh` の Source（必須）。 |

### 描画オプション

| マテリアル                                                        | 設定キー   | 説明                                 |
| ---------------------------------------------------------------- | ---------- | ------------------------------------ |
| [TerrainMaterial](../../../three/material/terrain-material/) | `terrain`  | 地形メッシュの見た目（影、スカートなど）。 |

## 使用例

### Raster DEM

```typescript
import ThreeView, { JAPAN_GSI_ELEVATION_DECODER } from "@navaramap/three";

const view = new ThreeView(/* options */);
await view.init();

const dem = view.addSource({
  type: "raster-dem",
  url: "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png",
  elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  maxZoom: 15,
  minZoom: 5,
});

view.addLayer({
  type: "terrain",
  source: dem,
  terrain: { castShadow: true, receiveShadow: true },
});
```

### Quantized-mesh

```typescript
const terrain = view.addSource({
  type: "quantized-mesh",
  url: "https://example.com/{z}/{x}/{y}.terrain",
  requestVertexNormals: true,
  requestWaterMask: true,
  maxZoom: 18,
});

view.addLayer({
  type: "terrain",
  source: terrain,
  terrain: { castShadow: true, receiveShadow: true },
});
```

:::note
Cesium Ion の quantized-mesh アセット（エンドポイント + トークンを実行時に解決）の場合は、`addSource` を直接呼び出すのではなく [`CesiumIonPlugin`](../../../three_plugins/cesiumionplugin/) を使用してください。
:::

### 地形への画像のドレープ

terrain レイヤーは 3D の地表のみを提供します。その上に [`raster`](../../../three/layer/raster-layer/) レイヤーを追加すると、そのタイルがメッシュ上にドレープされます。後から追加したレイヤーが上に描画されるため、高解像度のオーバーレイで広範囲のベースレイヤーを精細化できます。同時にドレープできるレイヤーの数はデバイスによって異なります（[ドレープできるレイヤー数の上限](../../../three/layer/raster-layer/#ドレープできるレイヤー数の上限)を参照）。

```typescript
const terrain = view.addSource({ type: "quantized-mesh", url: "https://example.com/{z}/{x}/{y}.terrain", maxZoom: 18 });
const satellite = view.addSource({ type: "raster-tile", url: "https://example.com/satellite/{z}/{x}/{y}.jpg", maxZoom: 15 });

view.addLayer({ type: "terrain", source: terrain });
view.addLayer({ type: "raster", source: satellite });
```

### 地形へのベクター地物のドレープ

polygon / polyline マテリアルで `clampToGround: true` を指定した [`vector`](../../../three/layer/vector-layer/) レイヤーも、地表に重畳されてメッシュに追従します。これは `raster-dem`（WebMercator）と `quantized-mesh`（geographic / EPSG:4326）のどちらの地形 Source でも機能するため、地形のタイリングスキームに関係なく、clamp-to-ground のベクターは地面に貼り付いたままになります。

```typescript
const terrain = view.addSource({ type: "quantized-mesh", url: "https://example.com/{z}/{x}/{y}.terrain", maxZoom: 18 });
const tiles = view.addSource({ type: "vector-tile", url: "https://example.com/tiles/{z}/{x}/{y}.mvt", maxZoom: 16 });

view.addLayer({ type: "terrain", source: terrain });
view.addLayer({
  type: "vector",
  source: tiles,
  sourceLayers: ["water"],
  polygon: { color: new Color().setStyle("#00aaff"), clampToGround: true },
});
```

## 関連リソース

- [Raster DEM Source](../../../three/source/raster-dem-source/) / [Quantized Mesh Source](../../../three/source/quantized-mesh-source/)
- [TerrainMaterial](../../../three/material/terrain-material/): 地形の詳細設定
- [Raster Layer](../../../three/layer/raster-layer/): 地形の上に画像をドレープ／陰影起伏を追加
- [Vector Layer](../../../three/layer/vector-layer/): clamp-to-ground のベクター地物を地形にドレープ
- [CesiumIonPlugin](../../../three_plugins/cesiumionplugin/): Cesium Ion の quantized-mesh アセット
