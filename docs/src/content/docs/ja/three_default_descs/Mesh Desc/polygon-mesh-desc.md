---
title: PolygonMeshDesc
description: Standalone polygon mesh descriptor for navara_three
sidebar:
  order: 117
---

`PolygonMeshDesc` クラスは、ソースやレイヤーを使わずに、座標列から単一のポリゴンを描画します。[`vector`](../../../three/layer/vector-layer/) レイヤーの [`polygon`](../../../three/material/polygon-material/) と同じジオメトリとマテリアルを使い、`update()` で新しい座標から作り直します。描画中・編集中のポリゴンのように頻繁に変わる形状に向いています。形状が確定したら、[`toGeoJSON()`](#togeojson) で `geojson` ソースに渡せます。

既定では地表にクランプされ、地形に貼り付けて描画されます。地形タイルが読み込まれると、それに追従します。`clampToGround: false` にすると `height` の高さに描画され、押し出しもできます。

基底クラスの変換プロパティ（`geodetic`、`matrix`、`matrixWorld`、`position`、`rotation`、`scale`）は、ほかのメッシュと同じく座標をメッシュのローカル座標系からワールドへ移します。地理座標は先に ECEF へ変換されるので、変換を指定しなければその場所に描画されます。変換はジオメトリを作るときに適用されるため、`update()` で変換を変えるとポリゴンを作り直します。`visible`、`lit`、`pickable` は利用できます。詳細は [MeshDesc](../mesh-desc-base) を参照してください。

たとえば `geodetic` を指定すると、直交座標の `points` を、地理座標に置いた西・上・北のフレームで配置します。

```typescript
{
  polygon: {
    // 原点を中心とする 200 m 四方（西・上・北のメートル）
    points: [
      { x: -100, y: 0, z: -100 },
      { x: 100, y: 0, z: -100 },
      { x: 100, y: 0, z: 100 },
      { x: -100, y: 0, z: 100 },
      { x: -100, y: 0, z: -100 },
    ],
  },
  geodetic: { lng: 139.76, lat: 35.68, height: 0 },
}
```

## 座標の指定

`positions`、`points`、`geojson` のいずれか 1 つだけを指定します。`update()` でどれかを指定すると、ほかの 2 つはクリアされます。同じ配列を渡し直してもポリゴンは作り直されるので、その場で書き換えた配列をそのまま渡せます。

### positions

**Type:** `LatLngHeight[] | LatLngHeight[][]`

**Description:** 地理座標です。`lng` と `lat` は度、`height` はメートルです。配列 1 つなら外周リング、配列の配列なら外周リングに続けて穴を指定します。高さは `perPositionHeight` が `true` のときだけ使われます。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    positions: [
      { lng: 139.76, lat: 35.68, height: 0 },
      { lng: 139.77, lat: 35.68, height: 0 },
      { lng: 139.77, lat: 35.69, height: 0 },
      { lng: 139.76, lat: 35.68, height: 0 },
    ],
  }
}
```

### points

**Type:** `XYZ[] | XYZ[][]`

**Description:** メッシュのローカル座標系での直交座標です。単位はメートルで、変換を指定しなければ ECEF です。配列 1 つなら外周リング、配列の配列なら外周リングに続けて穴を指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    points: [
      { x: -3959000, y: 3352000, z: 3697000 },
      { x: -3959900, y: 3351000, z: 3697000 },
      { x: -3959900, y: 3351000, z: 3698000 },
      { x: -3959000, y: 3352000, z: 3697000 },
    ],
  }
}
```

### geojson

**Type:** `Polygon | LineString`（GeoJSON ジオメトリ）

**Description:** GeoJSON の `Polygon` です。座標は `[lng, lat, height?]`（度とメートル）です。最初のリングが外周、残りが穴になります。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    geojson: {
      type: "Polygon",
      coordinates: [
        [
          [139.76, 35.68],
          [139.77, 35.68],
          [139.77, 35.69],
          [139.76, 35.68],
        ],
      ],
    },
  }
}
```

## Properties

### clampToGround

**Type:** `boolean`

**Description:** ポリゴンを地形に貼り付け、各ピクセルの下の地表で陰影を付けます。陰影に使う法線は [`useGroundNormals`](#usegroundnormals) で選びます。

**Default:** `true`

**Example:**

```typescript
{
  polygon: {
    clampToGround: false,
  }
}
```

### useGroundNormals

**Type:** `boolean`

**Description:** クランプしたポリゴンにピクセルごとの地形の法線で陰影を付け、地形の明暗を反映します。`false` にすると楕円体の法線で陰影が付き、地形の法線を全画面コピーする処理が不要になります。地形の法線は、地形自体が法線を持つ場合（`requestVertexNormals` を指定した `quantized-mesh`、または `hillshade` レイヤーを重ねた `raster-dem` の地形）に書き込まれます。それ以外の地形で `true` にすると、不定な法線で陰影が付きます。

**Default:** `true`

**Example:**

```typescript
{
  polygon: {
    clampToGround: true,
    useGroundNormals: false,
  }
}
```

### height

**Type:** `number`

**Description:** 楕円体からのポリゴンの高さ（メートル）です。`clampToGround` が `false` のときに有効です。

**Default:** `0`

**Example:**

```typescript
{
  polygon: {
    clampToGround: false,
    height: 50,
  }
}
```

### extrudedHeight

**Type:** `number`

**Description:** ポリゴンをこのメートル数だけ上方向に押し出します。上面は `height + extrudedHeight` の高さになります。`clampToGround` が `false` のときに有効です。

**Default:** `0`

**Example:**

```typescript
{
  polygon: {
    clampToGround: false,
    height: 0,
    extrudedHeight: 120,
  }
}
```

### perPositionHeight

**Type:** `boolean`

**Description:** 一定の `height` の代わりに、各座標の高さを使います。`clampToGround` が `false` のときに有効です。

**Default:** `false`

**Example:**

```typescript
{
  polygon: {
    clampToGround: false,
    perPositionHeight: true,
  }
}
```

### color

**Type:** `Color`

**Description:** ポリゴンの色を `Color` インスタンスで指定します。

**Default:** 黒（`0x000000`）

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polygon: {
    color: new Color().setHex(0x0091ff),
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
  polygon: {
    transparent: true,
    opacity: 0.6,
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
  polygon: {
    transparent: true,
  }
}
```

### castShadow

**Type:** `boolean`

**Description:** ポリゴンが影を落とすかどうかを指定します。クランプしたポリゴンは影を落としません。

**Default:** `false`

**Example:**

```typescript
{
  polygon: {
    clampToGround: false,
    extrudedHeight: 120,
    castShadow: true,
  }
}
```

### receiveShadow

**Type:** `boolean`

**Description:** ポリゴンが影を受けるかどうかを指定します。クランプしたポリゴンは、各ピクセルの下の地表で平行光源の影を受けます。

**Default:** `false`

**Example:**

```typescript
{
  polygon: {
    receiveShadow: true,
  }
}
```

### effectIds

**Type:** `string[]`

**Description:** このポリゴンに適用する Selective Effect の Descriptor ID の配列を指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    effectIds: ["bloom-effect"],
  }
}
```

### その他のマテリアルオプション

[`PolygonMaterial`](../../../three/material/polygon-material/) の次の見た目のオプションは、そちらの説明どおりに使えます: `wireframe`、`emissiveColor`、`emissiveIntensity`、`reflectivity`、`roughness`、`water`、`waterScaleNormal`、`waterSpeed`、`applyWaterNormal`、`specular`、`shininess`、`specularStrength`、`ior`。

レイヤー専用のオプション `tiled`、`show`、`surfaceShow`、`outline`、`outlineShow`、`outlineColor`、`outlineWidth`、`lit` は使えません。`show` と `lit` の代わりにメッシュ設定の `visible` と `lit` を使い、輪郭線は同じリングに [`PolylineMeshDesc`](../polyline-mesh-desc) を重ねて描画してください。

## メソッドとアクセサ

### toGeoJSON()

ポリゴンを GeoJSON の `Polygon` として返します。編集を終えたポリゴンを `geojson` ソースに追加するときなどに使います。

**Syntax:**

```typescript
toGeoJSON(): Polygon
```

**Returns:**

座標が `[lng, lat, height]` の GeoJSON `Polygon`。座標は変換を適用した、描画どおりの位置です。

**Example:**

```typescript
// 編集したメッシュを vector レイヤーのフィーチャーに置き換える
const source = view.addSource({
  type: "geojson",
  data: polygon.ref.toGeoJSON(),
});
view.addLayer({
  type: "vector",
  source,
  polygon: { color: new Color().setHex(0x0091ff), clampToGround: true },
});
polygon.delete();
```

### batchId

**Type:** `number | undefined`

**Description:** `pickable` が `true` のときに割り当てられるバッチ ID です。ピックされたフィーチャーと比較して、どのポリゴンがクリックされたかを判定します。[ピッキング](../mesh-desc-base#ピッキング)を参照してください。

## Usage Examples

### 地表にクランプしたポリゴン

```typescript
import ThreeView, { Color } from "@navaramap/three";
import type { PolygonMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>();
view.addPlugin(new DefaultPlugin());
await view.init();

// 地表に貼ったポリゴンにも陰影が付くので、ライトが必要
view.addLight({ ambient: { intensity: 1 } });

const polygon = view.addMesh<PolygonMeshDesc>({
  polygon: {
    positions: [
      { lng: 138.72, lat: 35.36, height: 0 },
      { lng: 138.75, lat: 35.36, height: 0 },
      { lng: 138.75, lat: 35.38, height: 0 },
      { lng: 138.72, lat: 35.36, height: 0 },
    ],
    color: new Color().setHex(0x0091ff),
    transparent: true,
    opacity: 0.6,
  },
  pickable: true,
});

// 頂点を動かす。ポリゴンは新しい座標から作り直される
polygon.update({
  polygon: {
    positions: [
      { lng: 138.72, lat: 35.36, height: 0 },
      { lng: 138.76, lat: 35.36, height: 0 },
      { lng: 138.75, lat: 35.38, height: 0 },
      { lng: 138.72, lat: 35.36, height: 0 },
    ],
  },
});
```

### 押し出したポリゴン

```typescript
import ThreeView, { Color } from "@navaramap/three";
import type { PolygonMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>({ shadow: true });
view.addPlugin(new DefaultPlugin());
await view.init();

view.addLight({ ambient: { intensity: 0.6 } });
view.addLight({ sun: { intensity: 1.8, castShadow: true } });

view.addMesh<PolygonMeshDesc>({
  polygon: {
    positions: [
      { lng: 139.765, lat: 35.68, height: 0 },
      { lng: 139.767, lat: 35.68, height: 0 },
      { lng: 139.767, lat: 35.682, height: 0 },
      { lng: 139.765, lat: 35.68, height: 0 },
    ],
    clampToGround: false,
    height: 0,
    extrudedHeight: 150,
    color: new Color().setHex(0xff8844),
    castShadow: true,
    receiveShadow: true,
  },
});
```
