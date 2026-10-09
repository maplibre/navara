---
title: TerrainMaterial
description: terrain レイヤーの地形メッシュ描画オプション
sidebar:
  order: 560
---

`TerrainMaterial` は、[`terrain`](../../../three/layer/terrain-layer/) レイヤーのメッシュの描画オプションを保持します。`terrain` キーで設定し、Source のデータ形式（[`raster-dem`](../../../three/source/raster-dem-source/)（RGB エンコードされた標高）または [`quantized-mesh`](../../../three/source/quantized-mesh-source/)）にかかわらず適用されます。取得・ジオメトリの設定（ズーム範囲、タイリングスキーム、標高デコーダ、拡張、トークン）はすべて、参照する Source 側にあり、ここにはありません。

## プロパティ

### show

**型:** `boolean | undefined`

**デフォルト:** `true`

**説明:** 地形を表示するかどうか。

```typescript
{ terrain: { show: true } }
```

### castShadow

**型:** `boolean | undefined`

**デフォルト:** `false`

**説明:** 地形が影を落とすかどうか。

```typescript
{ terrain: { castShadow: true } }
```

### receiveShadow

**型:** `boolean | undefined`

**デフォルト:** `false`

**説明:** 地形が影を受けるかどうか。

```typescript
{ terrain: { receiveShadow: true } }
```

### lit

**型:** `boolean | undefined`

**デフォルト:** `undefined`（`view.lit` に従う）

**説明:** カラー出力にライティング計算を適用するかどうか。`false` の場合、地形はアルベドのみで描画されます。lit パイプライン自体は動き続けるため、法線とシャドウ G-buffer は書き込まれたままです。未設定の場合はシーン既定値 [`view.lit`](../../../three/api/threeview-properties/#lit) に従い、明示的に指定するとその既定値をどちらの方向にも上書きします。

```typescript
{ terrain: { lit: false } }
```

:::note
地形が lit パスを通るのはタイルに法線がある場合のみです。[`quantized-mesh`](../../../three/source/quantized-mesh-source/) ソースで `requestVertexNormals: true` を指定するか、hillshade レイヤーを併用してください。法線がない場合、タイルはもともとライティングされないため `lit` を変更しても何も変わりません。
:::

### showBoundingBox

**型:** `boolean | undefined`

**デフォルト:** `false`

**説明:** タイルごとのバウンディングボックスを表示するかどうか。デバッグ用です。

```typescript
{ terrain: { showBoundingBox: true } }
```

### skirt

**型:** `boolean | undefined`

**デフォルト:** `true`

**説明:** 異なる LOD の隣接するタイル間の隙間を隠すために、タイル境界に沿ってスカートを描画するかどうか。地下のモデルを可視化したい場合は無効にします。

```typescript
{ terrain: { skirt: true } }
```

### skirtExaggeration

**型:** `number | undefined`

**デフォルト:** `1.0`

**説明:** 自動計算されたスカートの高さに適用する乗数。`1.0` はデフォルトの計算された高さを使用します。

```typescript
{ terrain: { skirtExaggeration: 1.5 } }
```

### exaggeration

**型:** `number | undefined`

**デフォルト:** `1`

**説明:** 地形の高さ方向の誇張率です。地形の高さは [`exaggerationRelativeHeight`](#exaggerationrelativeheight) を基準にこの倍率で拡大され、詳細度の選択とカリングも拡大後の地表に従います。`sampleTerrainHeight`、`observeTerrainHeightAt`、`sampleTerrainHeightRange`、`observeTerrainHeightRange`、`sampleTerrainMostDetailed` は拡大後の高さを返すため、地表に固定したフィーチャーや `heightReference: "terrain"` のメッシュは地表に乗ったままになります。3D Tiles と glTF モデルは引き伸ばされず、標高ヒートマップとヒルシェードは元の標高を使います。負の値は `0` として扱われ、地形は `exaggerationRelativeHeight` の高さで平らになります。`layer.update()` で実行時に変更でき、地形レイヤーを削除すると誇張は解除されます。

```typescript
const terrainLayer = view.addLayer({
  type: "terrain",
  source: terrain,
  terrain: { exaggeration: 2 },
});

// 実行時に変更する
terrainLayer.update({ terrain: { exaggeration: 3 } });
```

### exaggerationRelativeHeight

**型:** `number | undefined`

**デフォルト:** `0`

**説明:** 地形を誇張するときに動かない基準の高さ（メートル）です。カメラや地表からの相対値ではなく、地形の高さと同じ基準（WGS84 楕円体からの高さ。`raster-dem` ソースではデコードした標高値そのもの）で測った絶対値です。地形の高さ `h` は `(h - exaggerationRelativeHeight) * exaggeration + exaggerationRelativeHeight` の高さに描画されます。既定の `0` では標高の高い地域ほど地表全体が持ち上がるため、見ている地面の標高（高原の谷底や、誇張されない 3D Tiles・モデルが建つ地面など）に設定すると、その地面を動かさずに周囲の起伏だけを強調できます。海岸から山地までを見渡す場合は、海面が動かないよう `0` のままにします。

```typescript
// 標高 1000 m の盆地の底を動かさずに周囲の起伏を強調する
terrainLayer.update({
  terrain: { exaggeration: 2, exaggerationRelativeHeight: 1000 },
});
```

## 他のレイヤーとの組み合わせ

terrain レイヤーは 3D の地表のみを提供します。[`raster`](../../../three/layer/raster-layer/) レイヤーでその上に画像や陰影起伏をドレープします。

| 地形の上に            | 対応       | 備考                                                                            |
| ----------------------- | --------- | -------------------------------------------------------------------------------- |
| `raster`（画像）        | ✅ 可能    | ラスター画像が再投影され、メッシュ上にドレープされます。複数を重ねられます。       |
| `raster`（陰影起伏）    | ✅ 可能    | DEM タイルから計算された陰影起伏を 3D の地表に描画します。                        |
| `vector`（ベクタータイル） | ❌ 未対応 | 現在、ベクタータイルは quantized-mesh 地形にドレープできません。                 |

## 関連リソース

- [Terrain Layer](../../../three/layer/terrain-layer/): このマテリアルの使い方
- [Raster DEM Source](../../../three/source/raster-dem-source/) / [Quantized Mesh Source](../../../three/source/quantized-mesh-source/): 地形データの Source
- [CesiumIonPlugin](../../../three_plugins/cesiumionplugin/): Cesium Ion の quantized-mesh アセット
