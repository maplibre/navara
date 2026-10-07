---
title: PolylineMeshDesc
description: Standalone polyline mesh descriptor for navara_three
sidebar:
  order: 118
---

`PolylineMeshDesc` クラスは、ソースやレイヤーを使わずに、座標列から単一のポリラインを描画します。[`vector`](../../../three/layer/vector-layer/) レイヤーの [`polyline`](../../../three/material/polyline-material/) と同じジオメトリとマテリアルを使い、`update()` で新しい座標から作り直します。描画中・編集中のルートのように頻繁に変わる線に向いています。線が確定したら、[`toGeoJSON()`](#togeojson) で `geojson` ソースに渡せます。

既定では地表にクランプされ、下にある地形に沿って描画されます。地面より手前にあるジオメトリには隠されます。`clampToGround: false` にすると `height` の高さに描画されます。

線にはライティングが適用されるため、シーンにライトがないと黒く描画されます。ライトを追加するか、メッシュ設定で `lit: false` を指定するとそのままの色で描画されます。

基底クラスの変換プロパティ（`geodetic`、`matrix`、`matrixWorld`、`position`、`rotation`、`scale`）は、ほかのメッシュと同じく座標をメッシュのローカル座標系からワールドへ移します。地理座標は先に ECEF へ変換されるので、変換を指定しなければその場所に描画されます。変換はジオメトリを作るときに適用されるため、`update()` で変換を変えると線を作り直します。`visible`、`lit`、`pickable` は利用できます。詳細は [MeshDesc](../mesh-desc-base) を参照してください。

たとえば `geodetic` を指定すると、直交座標の `points` を、地理座標に置いた西・上・北のフレームで配置します。

```typescript
{
  polyline: {
    // 北へ 500 m（西・上・北のメートル）
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 500 },
    ],
  },
  geodetic: { lng: 139.76, lat: 35.68, height: 0 },
}
```

## 座標の指定

`positions`、`points`、`geojson` のいずれか 1 つだけを指定します。`update()` でどれかを指定すると、ほかの 2 つはクリアされます。同じ配列を渡し直しても線は作り直されるので、その場で書き換えた配列をそのまま渡せます。

1 つのメッシュは 1 本の線を描画します。マルチラインは部分ごとにメッシュを追加してください。

### positions

**Type:** `LatLngHeight[]`

**Description:** 地理座標です。`lng` と `lat` は度、`height` はメートルです。重複しない座標が 2 つ以上必要です。

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    positions: [
      { lng: 139.76, lat: 35.68, height: 0 },
      { lng: 139.77, lat: 35.685, height: 0 },
      { lng: 139.78, lat: 35.68, height: 0 },
    ],
  }
}
```

### points

**Type:** `XYZ[]`

**Description:** メッシュのローカル座標系での直交座標です。単位はメートルで、変換を指定しなければ ECEF です。重複しない座標が 2 つ以上必要です。

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    points: [
      { x: -3959000, y: 3352000, z: 3697000 },
      { x: -3960000, y: 3351000, z: 3697000 },
    ],
  }
}
```

### geojson

**Type:** `LineString | Polygon`（GeoJSON ジオメトリ）

**Description:** GeoJSON の `LineString` です。座標は `[lng, lat, height?]`（度とメートル）です。

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    geojson: {
      type: "LineString",
      coordinates: [
        [139.76, 35.68],
        [139.78, 35.68],
      ],
    },
  }
}
```

### ring

**Type:** `boolean`

**Description:** 最初の座標の繰り返しを、2 つの端の代わりに継ぎ目としてつなぎます。閉じた輪郭線に始点が見えなくなります。線を閉じるには、座標列の最後に最初の座標を繰り返してください。

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    positions: ring, // 最後に最初の座標を繰り返した座標列
    ring: true,
  }
}
```

## Properties

### clampToGround

**Type:** `boolean`

**Description:** 線を下にある地形の上に描画し、地形タイルが読み込まれるとそれに追従します。クランプした線は `height` を無視します。

**Default:** `true`

**Example:**

```typescript
{
  polyline: {
    clampToGround: false,
  }
}
```

### useGroundNormals

**Type:** `boolean`

**Description:** クランプした線に、自身の法線の代わりに地形の法線で陰影を付けます。線が地形と同じ明暗になります。毎フレーム、地形の法線を画面全体ぶんコピーするコストがかかります。地形が法線を書き込む場合（`requestVertexNormals` を指定した `quantized-mesh`、または `hillshade` レイヤーを重ねた `raster-dem` の地形）にだけ有効にしてください。それ以外では不定の法線で陰影が付きます。

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    clampToGround: true,
    useGroundNormals: true,
  }
}
```

### height

**Type:** `number`

**Description:** 楕円体からの線の高さ（メートル）です。`clampToGround` が `false` のときに有効です。

**Default:** `0`

**Example:**

```typescript
{
  polyline: {
    clampToGround: false,
    height: 100,
  }
}
```

### width

**Type:** `number`

**Description:** 線の幅（ピクセル）です。

**Default:** `1`

**Example:**

```typescript
{
  polyline: {
    width: 4,
  }
}
```

### maxWidth

**Type:** `number`

**Description:** 描画される幅の上限（メートル）です。遠くから見ると 1 ピクセルが何メートルにもなるため、既定の上限では高高度で線が `width` より細くなります。遠くからでも `width` ピクセルの太さを保つには値を大きくしてください。

**Default:** `1000`

**Example:**

```typescript
{
  polyline: {
    width: 3,
    maxWidth: 100000,
  }
}
```

### color

**Type:** `Color`

**Description:** 線の色を `Color` インスタンスで指定します。

**Default:** 白（`0xffffff`）

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polyline: {
    color: new Color().setHex(0xff6b2c),
  }
}
```

### opacity

**Type:** `number`

**Description:** 不透明度を 0.0（完全に透明）から 1.0（完全に不透明）で指定します。`transparent` を `true` にする必要があります。

**Default:** `1`

**Example:**

```typescript
{
  polyline: {
    transparent: true,
    opacity: 0.5,
  }
}
```

### transparent

**Type:** `boolean`

**Description:** `opacity` に必要なアルファブレンドを有効にします。

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    transparent: true,
  }
}
```

### depthWrite

**Type:** `boolean`

**Description:** 深度バッファへの書き込みを有効にします。半透明の線では、深度ソートによる描画の乱れを避けるため `false` にしてください。

**Default:** `true`

**Example:**

```typescript
{
  polyline: {
    depthWrite: false,
  }
}
```

### castShadow

**Type:** `boolean`

**Description:** 線が影を落とすかどうかを指定します。クランプした線は影を落としません。

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    clampToGround: false,
    castShadow: true,
  }
}
```

### receiveShadow

**Type:** `boolean`

**Description:** 線が影を受けるかどうかを指定します。クランプした線は、各ピクセルの下の地表で平行光源の影を受けます。

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    receiveShadow: true,
  }
}
```

### emissiveColor

**Type:** `Color`

**Description:** 発光色を `Color` インスタンスで指定します。`emissiveIntensity` と組み合わせて使います。

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polyline: {
    emissiveColor: new Color().setHex(0xffaa00),
    emissiveIntensity: 1,
  }
}
```

### emissiveIntensity

**Type:** `number`

**Description:** 発光の強度を指定します。

**Default:** `0`

**Example:**

```typescript
{
  polyline: {
    emissiveIntensity: 1,
  }
}
```

### effectIds

**Type:** `string[]`

**Description:** この線に適用する Selective Effect の Descriptor ID の配列を指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    effectIds: ["bloom-effect"],
  }
}
```

[`PolylineMaterial`](../../../three/material/polyline-material/) のレイヤー専用オプション `tiled`、`geometryTypes`、`show`、`lit` は使えません。`show` と `lit` の代わりにメッシュ設定の `visible` と `lit` を使ってください。

## メソッドとアクセサ

### toGeoJSON()

線を GeoJSON の `LineString` として返します。編集を終えた線を `geojson` ソースに追加するときなどに使います。

**Syntax:**

```typescript
toGeoJSON(): LineString
```

**Returns:**

座標が `[lng, lat, height]` の GeoJSON `LineString`。座標は変換を適用した、描画どおりの位置です。

**Example:**

```typescript
// 編集したメッシュを vector レイヤーのフィーチャーに置き換える
const source = view.addSource({
  type: "geojson",
  data: line.ref.toGeoJSON(),
});
view.addLayer({
  type: "vector",
  source,
  polyline: { color: new Color().setHex(0xff6b2c), width: 4, clampToGround: true },
});
line.delete();
```

### batchId

**Type:** `number | undefined`

**Description:** `pickable` が `true` のときに割り当てられるバッチ ID です。ピックされたフィーチャーと比較して、どの線がクリックされたかを判定します。[ピッキング](../mesh-desc-base#ピッキング)を参照してください。

## Usage Examples

### 地表にクランプした線

```typescript
import ThreeView, { Color } from "@navaramap/three";
import type { PolylineMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>();
view.addPlugin(new DefaultPlugin());
await view.init();

const line = view.addMesh<PolylineMeshDesc>({
  polyline: {
    positions: [
      { lng: 138.72, lat: 35.36, height: 0 },
      { lng: 138.74, lat: 35.37, height: 0 },
      { lng: 138.76, lat: 35.36, height: 0 },
    ],
    color: new Color().setHex(0xff6b2c),
    width: 4,
  },
  // シーンにライトがなくてもそのままの色で描画する
  lit: false,
  pickable: true,
});

// 点を追加する。線は新しい座標から作り直される
line.update({
  polyline: {
    positions: [
      { lng: 138.72, lat: 35.36, height: 0 },
      { lng: 138.74, lat: 35.37, height: 0 },
      { lng: 138.76, lat: 35.36, height: 0 },
      { lng: 138.78, lat: 35.37, height: 0 },
    ],
  },
});
```

### ポリゴンの閉じた輪郭線

```typescript
import ThreeView, { Color, type LatLngHeight } from "@navaramap/three";
import type {
  PolygonMeshDesc,
  PolylineMeshDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>();
view.addPlugin(new DefaultPlugin());
await view.init();

view.addLight({ ambient: { intensity: 1 } });

const ring: LatLngHeight[] = [
  { lng: 138.72, lat: 35.36, height: 0 },
  { lng: 138.75, lat: 35.36, height: 0 },
  { lng: 138.75, lat: 35.38, height: 0 },
  { lng: 138.72, lat: 35.36, height: 0 },
];

view.addMesh<PolygonMeshDesc>({
  polygon: {
    positions: ring,
    color: new Color().setHex(0x0091ff),
    transparent: true,
    opacity: 0.5,
  },
});
view.addMesh<PolylineMeshDesc>({
  polyline: {
    positions: ring,
    ring: true,
    color: new Color().setHex(0xffffff),
    width: 3,
  },
});
```
