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

**Description:** Bloom エフェクトの半径(ぼかしの広がり)を指定します。

**Default:** `0.2`

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

Bloom のソースカラーを指定します。設定しない場合、マテリアルの表面色（diffuseColor）が自動的に Bloom のソースとして使用されます。つまり、色を明示的に指定しなくても、`effectIds`と`emissiveIntensity`だけで Bloom を有効にできます。

### emissiveIntensity

Bloom ソースの強度を制御します。高い値ほど明るい Bloom になります。

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
    radius: 0.2,
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

## 備考

- Selective Bloom エフェクトは、マスクベースのフィルタリングを使用して特定のオブジェクトにのみ Bloom を適用します。
- `emissiveColor`が設定されていない場合、マテリアルの表面色（diffuseColor）が自動的に Bloom のソースとして使用されます。これには、InstancedMesh のインスタンスごとの色や、テクスチャ付きマテリアルのテクスチャ色が含まれます。
- Bloom エフェクトを効果的に使用するには、オブジェクトの`emissiveIntensity`を適切に設定することが重要です。
