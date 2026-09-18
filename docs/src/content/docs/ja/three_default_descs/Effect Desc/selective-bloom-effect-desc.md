---
title: SelectiveBloomEffectDesc
description: Selective bloom effect descriptor for navara_three
sidebar:
  order: 61
---

`SelectiveBloomEffectDesc`クラスは、Selective Bloom エフェクトを適用する Descriptor です。マスクベースのフィルタリングを使用して、特定のオブジェクトにのみ Bloom エフェクトを適用できます。

## Properties

### visible

**Type:** `boolean | undefined`

**Description:** エフェクトの表示/非表示を制御します。

**Default:** `true`

### strength

**Type:** `number | undefined`

**Description:** Bloom エフェクトの強度を指定します。

**Default:** `0.8`

**Example:**

```typescript
{
  selectiveBloom: {
    strength: 1.2,
  }
}
```

### radius

**Type:** `number | undefined`

**Description:** Bloom のブラーがアップサンプルする際に、より低解像度のミップをどれだけ混ぜるかを`0`(最もシャープ)〜`1`(最も広い)で指定します。値が大きいほど広く柔らかく滲みます。

**Default:** `0.85`

**Example:**

```typescript
{
  selectiveBloom: {
    radius: 0.4,
  }
}
```

### threshold

**Type:** `number | undefined`

**Description:** Bloom エフェクトの閾値を指定します。この値より明るいピクセルにのみ Bloom が適用されます。

**Default:** `0.0`

**Example:**

```typescript
{
  selectiveBloom: {
    threshold: 0.5,
  }
}
```

### smoothing

**Type:** `number | undefined`

**Description:** 閾値の立ち上がり幅を指定します。`0`に近いほど閾値の境界がピクセル単位で硬くなり、閾値付近の要素が明滅する原因になります。値を大きくすると、輝度が閾値を跨ぐ際に滑らかに滲み始めます。

**Default:** `0.1`

**Example:**

```typescript
{
  selectiveBloom: {
    threshold: 0.2,
    smoothing: 0.2,
  }
}
```

### levels

**Type:** `number | undefined`

**Description:** Bloom のブラーが使用するミップの段数を指定します。1段増えるごとに滲みの広がりがおおよそ倍になります。値は整数に丸められ、`1` 未満は `1` に切り上げられます。

**Default:** `8`

**Example:**

```typescript
{
  selectiveBloom: {
    levels: 6,
  }
}
```

### resolutionScale

**Type:** `number | undefined`

**Description:** レンダリング解像度のスケール係数を指定します。低い値でパフォーマンスが向上します。

**Default:** `0.5`

**Example:**

```typescript
{
  selectiveBloom: {
    resolutionScale: 0.5,
  }
}
```

## オブジェクトへのエフェクト適用

Selective Bloom エフェクトを特定のオブジェクトに適用するには、対象オブジェクトの`effectIds`プロパティに Bloom エフェクトのIDを指定します。

### effectIds

対象オブジェクトに適用する Selective Effect の ID の配列です。Bloom エフェクトを追加すると一意のIDが割り当てられ、このIDを対象オブジェクトの`effectIds`に指定することでエフェクトが適用されます。

### emissiveColor（オプション）

光に足す色です。設定しない場合は、オブジェクトの表面色がそのまま光ります。設定すると表面色にこの色が足されて光るので、光の色味を寄せたり明るくしたりできます（表面色が置き換わるわけではありません）。

### emissiveIntensity

光の強さです。高いほど明るく光ります。`0` にすると、`effectIds` を設定していても光りません。

### フィーチャー単位の emissive

[FeatureEvaluator](../../../three/api/feature-evaluator/) で地物ごとに `emissive` と `emissiveIntensity` を返すと、その地物はマテリアルの設定ではなく、返した値で光ります。地物側で `emissiveIntensity: 0` を返せば、その地物だけ光らせないこともできます。

## Usage Examples

### 基本的な Selective Bloom の追加

```typescript
import ThreeView, { Color } from "@navaramap/three";
import {
  BoxMeshDesc,
  SelectiveBloomEffectDesc,
} from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// Selective Bloom エフェクトを追加
const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 0.8,
    radius: 0.85,
    threshold: 0.0,
  },
});

// オブジェクトに Bloom エフェクトを適用
// emissiveColor を設定しない場合、マテリアルの色が Bloom のソースとして使用されます
const cubeDesc = view.addMesh<BoxMeshDesc>({
  box: {
    width: 100,
    height: 100,
    depth: 100,
    color: new Color().setHex(0xff0000),
    emissiveIntensity: 1.0, // Bloom の明るさを制御
    effectIds: [bloomDesc.id],
  },
  position: { x: 0, y: 0, z: 1000 },
});
```

### 強い Bloom エフェクト

```typescript
import ThreeView from "@navaramap/three";
import { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// デフォルトのフォトリアルオブジェクトを追加
plugin.addDefaultPhotorealScene();

// 強い Bloom エフェクトを追加
const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 1.5,
    radius: 0.5,
    threshold: 0.2,
  },
});
```

### パフォーマンス重視の設定

```typescript
import ThreeView from "@navaramap/three";
import { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// パフォーマンス重視の設定
const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 0.6,
    radius: 0.2,
    threshold: 0.0,
    resolutionScale: 0.5, // 低解像度でパフォーマンス向上
  },
});
```

### Bloom エフェクトの動的更新

```typescript
import ThreeView from "@navaramap/three";
import { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 0.8,
  },
});

// 後からパラメータを更新
bloomDesc.update({
  selectiveBloom: {
    strength: 1.2,
    radius: 0.3,
  },
});
```

### 3D Tiles への Bloom 適用

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 1.0,
    radius: 0.5,
  },
});

// 3D Tiles の建物に Bloom を適用
const buildingsSource = view.addSource({
  type: "3d-tiles",
  url: "https://example.com/tileset.json",
});

const buildingsLayer = view.addLayer({
  type: "3d-tiles",
  source: buildingsSource,
  model: {
    show: true,
    color: new Color().setHex(0xffffff),
    effectIds: [bloomDesc.id],
    emissiveIntensity: 0.3,
  },
});
```

### GeoJSON モデルへの Bloom 適用

```typescript
import ThreeView from "@navaramap/three";
import { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 1.2,
  },
});

// GeoJSON レイヤーのモデルに Bloom を適用
// emissiveColor はオプション — 省略するとモデル自身の色が使用されます
const modelSource = view.addSource({
  type: "geojson",
  data: featureCollection,
});

const modelLayer = view.addLayer({
  type: "vector",
  source: modelSource,
  model: {
    show: true,
    size: 100,
    url: "model.glb",
    effectIds: [bloomDesc.id],
    emissiveIntensity: 0.5,
  },
});
```

### エフェクトの動的な切り替え

```typescript
// 初期状態ではエフェクトなし
const cubeDesc = view.addMesh<BoxMeshDesc>({
  box: {
    width: 100,
    height: 100,
    depth: 100,
    color: new Color().setHex(0xff0000),
    effectIds: [],
  },
  position: { x: 0, y: 0, z: 1000 },
});

// 後から Bloom エフェクトを追加
cubeDesc.update({
  box: {
    effectIds: [bloomDesc.id],
    emissiveIntensity: 1.0,
  },
});

// エフェクトを無効化
cubeDesc.update({
  box: {
    effectIds: [],
  },
});
```

## パラメータの関係とチューニング

このエフェクトは 3 段階で動きます。抽出では、`effectIds` が一致し、かつ明るさが `threshold` を超えるピクセルだけを残します(`smoothing` で境目をなだらかにします)。次にブラーがその光をミップチェーンで広げます(`radius`、`levels`、`resolutionScale`)。最後に合成で `strength × (抽出結果 + ブラー結果)` をフレームに加算します。ぼかしていない抽出結果はオブジェクト自体を自発光しているように見せ、ぼかした結果がその周りのハローになります。

ブラーはエネルギーを保存します。ハローが持つ光の総量は発光源が出した量(面積 × emissive × `strength`)と同じなので、広く広げるほど 1 ピクセルあたりは暗くなります。面積の大きい発光面が `strength: 1` で光って見える一方、小さな点や細い線のハローを見えるようにするには `strength` 2〜4(またはそのレイヤーの `emissiveIntensity` を上げる)が必要になるのはこのためです。

| したいこと | 調整するもの |
|---|---|
| 全体をもっと明るく | `strength`: 自発光する本体とハローの両方に掛かります |
| ハローを広く柔らかく | `radius` を `1` 側へ(既定の `0.85` はすでに広め、`0.3`〜`0.5` は締まった見え方)。もっと遠くまで届かせたい時だけ `levels` を上げます |
| 小さな点や細い線がほとんど光らない | `strength` 2〜4、またはそのレイヤーの `emissiveIntensity` を上げる(`strength` はエフェクトを使う全レイヤーに掛かるのに対し、こちらはレイヤー単位です) |
| 数千の小さな発光源で地図全体が白く霞む | `threshold`(と `smoothing`)で明るい発光源だけを対象にし、`levels` を減らして裾を短くします |
| 細い線が太い帯になる | `radius` は既定のまま `resolutionScale: 1.0` にします。`radius` を下げると最も細かい段に光が集まりますが、その段自体がぼけているので線は太くなるだけです。フル解像度は Bloom のピクセル数とメモリが約 4 倍になります |
| 地図そのものが光って見える | Bloom ではありません。`strength: 0` で確認したうえで、トーンマッピングの露出とタイルのライティングを確認してください |

## 備考

- Selective Bloom エフェクトは、マスクベースのフィルタリングを使用して特定のオブジェクトにのみ Bloom を適用します。
- 光る色は `(表面色 + emissiveColor) × emissiveIntensity` です。表面色には、InstancedMesh のインスタンスごとの色や、テクスチャ付きマテリアルのテクスチャ色も含まれます。`FeatureEvaluator` で地物ごとに `emissive` を返した地物は、その値で光ります。
- Bloom エフェクトを効果的に使用するには、オブジェクトの`emissiveIntensity`を適切に設定することが重要です。
