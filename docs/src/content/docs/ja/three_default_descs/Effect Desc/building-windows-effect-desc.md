---
title: BuildingWindowsEffectDesc
description: navara_three_default_descs の Building windows エフェクト Descriptor
sidebar:
  order: 63
---

`BuildingWindowsEffectDesc`クラスは、建物の壁面に灯りのともった窓を描く Descriptor です。`effectIds` にこのエフェクトを指定したオブジェクトの壁面に、ワールドに固定された窓のグリッド(壁に沿って `columnWidth` メートルごとに 1 列、高さ方向に `floorHeight` メートルごとに 1 段)を描きます。屋根と床には窓は描かれず、点灯している窓の割合は地面からの高さとともに増えます。押し出しポリゴンや 3D Tiles など、シーン内のあらゆるジオメトリに適用できます。

## Properties

### visible

**Type:** `boolean | undefined`

**Description:** エフェクトの表示/非表示を制御します。

**Default:** `true`

### litRatio

**Type:** `number | undefined`

**Description:** 最も高い建物で点灯している窓の割合を `0` 〜 `1` で指定します。地面に近い壁ほど点灯する窓は少なくなります。割合は地面でこの値の 70% から始まり、地面から 35 m の高さでこの値に達します。

**Default:** `0.55`

**Example:**

```typescript
{
  buildingWindows: {
    litRatio: 0.7,
  }
}
```

### floorHeight

**Type:** `number | undefined`

**Description:** 窓の段の高さ方向のピッチをメートルで指定します。階は `groundHeight` から上に数えます。

**Default:** `3.5`

**Example:**

```typescript
{
  buildingWindows: {
    floorHeight: 4,
  }
}
```

### columnWidth

**Type:** `number | undefined`

**Description:** 壁に沿った窓のピッチをメートルで指定します。

**Default:** `3`

**Example:**

```typescript
{
  buildingWindows: {
    columnWidth: 2.5,
  }
}
```

### intensity

**Type:** `number | undefined`

**Description:** 点灯している窓の明るさの倍率です。時間に応じて変化させると、夕暮れに窓の灯りをフェードインさせられます。

**Default:** `1`

**Example:**

```typescript
{
  buildingWindows: {
    intensity: 1.5,
  }
}
```

### groundHeight

**Type:** `number | undefined`

**Description:** 地面の楕円体高をメートルで指定します。階はここから上に数え、これより下の壁には窓が描かれません。地形の上に立つ建物では、ビューの下の地形の高さを指定する必要があります。

**Default:** `0`

**Example:**

```typescript
{
  buildingWindows: {
    groundHeight: 40,
  }
}
```

## オブジェクトへのエフェクト適用

特定のオブジェクトに窓を描くには、対象オブジェクトの`effectIds`プロパティにエフェクト Descriptor の ID を指定します。

### effectIds

対象オブジェクトに適用する Selective Effect の ID の配列です。Building windows エフェクトを追加すると一意の ID が割り当てられ、この ID を対象オブジェクトの`effectIds`に指定することでエフェクトが適用されます。窓は壁面にのみ描かれ、屋根と床には描かれません。

## Usage Examples

### 押し出した建物への窓の追加

```typescript
import ThreeView, { Color } from "@navaramap/three";
import {
  BuildingWindowsEffectDesc,
  SelectiveBloomEffectDesc,
} from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
view.addPlugin(new DefaultPlugin());
await view.init();

// selectiveBloom は buildingWindows より先に追加する(Notes を参照)
view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {},
});

// Building windows エフェクトの Descriptor を追加
const windowsDesc = view.addEffect<BuildingWindowsEffectDesc>({
  buildingWindows: {
    litRatio: 0.55,
    floorHeight: 3.5,
    columnWidth: 3,
  },
});

// 建物の footprint を押し出し、その壁面に窓を描く
const tiles = view.addSource({
  type: "vector-tile",
  url: "https://example.com/tiles/{z}/{x}/{y}.mvt",
  maxZoom: 16,
});

view.addLayer({
  type: "vector",
  source: tiles,
  sourceLayers: ["building"],
  polygon: {
    color: new Color().setStyle("#d9d0c9"),
    clampToGround: false,
    extrudedHeight: 30,
    effectIds: [windowsDesc.id],
  },
});

// 後からパラメータを更新
windowsDesc.update({
  buildingWindows: {
    litRatio: 0.7,
  },
});
```

### 3D Tiles への窓の適用

```typescript
import ThreeView from "@navaramap/three";
import { BuildingWindowsEffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
view.addPlugin(new DefaultPlugin());
await view.init();

const windowsDesc = view.addEffect<BuildingWindowsEffectDesc>({
  buildingWindows: {},
});

// 3D Tiles の建物に窓を適用
const buildingsSource = view.addSource({
  type: "3d-tiles",
  url: "https://example.com/tileset.json",
});

view.addLayer({
  type: "3d-tiles",
  source: buildingsSource,
  model: {
    show: true,
    effectIds: [windowsDesc.id],
  },
});
```

## Notes

- `selectiveBloom` を先に、`buildingWindows` を後に追加してください。この順序で、Bloom が合成される前に窓が描かれます。
- `selectiveBloom` は窓の灯りを滲ませません。Bloom はオブジェクトの emissive の色を光らせるもので、窓は表面色の上に灯りを足すだけです。
- ビューの `useNormal` は不要です。エフェクトは必要なデータを自身で宣言します。
- 窓はカメラからの距離に応じて暗くなり、6 km でおよそ 3 分の 1 の明るさになります。
