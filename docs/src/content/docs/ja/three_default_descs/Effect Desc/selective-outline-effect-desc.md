---
title: SelectiveOutlineEffectDesc
description: Selective outline effect descriptor for navara_three
sidebar:
  order: 62
---

`SelectiveOutlineEffectDesc`クラスは、Selective Outline エフェクトを適用する Descriptor です。マスクベースのフィルタリングを使用して、特定のオブジェクトにのみ Outline を描画できます。Sobelフィルタを使用したエッジ検出により、オブジェクトの輪郭を強調します。

## Properties

### visible

**Type:** `boolean | undefined`

**Description:** エフェクトの表示/非表示を制御します。

**Default:** `true`

### color

**Type:** `Color | undefined`

**Description:** Outline の色を`Color`で指定します。

**Default:** `0xffffff`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  selectiveOutline: {
    color: new Color().setStyle("#ff0000"),
  }
}
```

### thickness

**Type:** `number | undefined`

**Description:** Outline の太さを指定します。

**Default:** `1.0`

**Example:**

```typescript
{
  selectiveOutline: {
    thickness: 2.0,
  }
}
```

### edgeStrength

**Type:** `number | undefined`

**Description:** エッジ検出の強度を指定します。値が大きいほどエッジが強調されます。

**Default:** `1.0`

**Example:**

```typescript
{
  selectiveOutline: {
    edgeStrength: 1.5,
  }
}
```

### resolutionScale

**Type:** `number | undefined`

**Description:** レンダリング解像度のスケール係数を指定します。低い値でパフォーマンスが向上します。

**Default:** `1.0`

**Example:**

```typescript
{
  selectiveOutline: {
    resolutionScale: 0.5,
  }
}
```

## オブジェクトへのエフェクト適用

Selective Outline エフェクトを特定のオブジェクトに適用するには、対象オブジェクトの`effectIds`プロパティに Outline エフェクトのIDを指定します。

### effectIds

対象オブジェクトに適用する Selective Effect の ID の配列です。Outline エフェクトを追加すると一意のIDが割り当てられ、このIDを対象オブジェクトの`effectIds`に指定することでエフェクトが適用されます。

## Usage Examples

### 基本的な Selective Outline の追加

```typescript
import ThreeView, { Color } from "@navaramap/three";
import {
  BoxMeshDesc,
  SelectiveOutlineEffectDesc,
} from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// Selective Outline エフェクトを追加
const outlineDesc = view.addEffect<SelectiveOutlineEffectDesc>({
  selectiveOutline: {
    color: new Color().setHex(0xffffff),
    thickness: 1.0,
    edgeStrength: 1.0,
  },
});

// オブジェクトに Outline エフェクトを適用
const cubeDesc = view.addMesh<BoxMeshDesc>({
  box: {
    width: 100,
    height: 100,
    depth: 100,
    color: new Color().setHex(0x0088ff),
    effectIds: [outlineDesc.id], // Outline エフェクトを適用
  },
  position: { x: 0, y: 0, z: 1000 },
});
```

### カラー Outline の追加

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { SelectiveOutlineEffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// デフォルトのフォトリアルオブジェクトを追加
plugin.addDefaultPhotorealScene();

// 赤色の太い Outline を追加
const outlineDesc = view.addEffect<SelectiveOutlineEffectDesc>({
  selectiveOutline: {
    color: new Color().setHex(0xff0000),
    thickness: 2.5,
    edgeStrength: 1.5,
  },
});
```

### パフォーマンス重視の設定

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { SelectiveOutlineEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// パフォーマンス重視の設定
const outlineDesc = view.addEffect<SelectiveOutlineEffectDesc>({
  selectiveOutline: {
    color: new Color().setHex(0xffffff),
    thickness: 1.0,
    edgeStrength: 1.0,
    resolutionScale: 0.5, // 低解像度でパフォーマンス向上
  },
});
```

### Outline エフェクトの動的更新

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { SelectiveOutlineEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

const outlineDesc = view.addEffect<SelectiveOutlineEffectDesc>({
  selectiveOutline: {
    color: new Color().setHex(0xffffff),
    thickness: 1.0,
  },
});

// 後からパラメータを更新
outlineDesc.update({
  selectiveOutline: {
    color: new Color().setHex(0x00ff00), // 緑
    thickness: 2.0,
  },
});
```

### 3D Tiles への Outline 適用

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { SelectiveOutlineEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

const outlineDesc = view.addEffect<SelectiveOutlineEffectDesc>({
  selectiveOutline: {
    color: new Color().setHex(0xff0000),
    thickness: 2.0,
  },
});

// 3D Tiles の建物に Outline を適用
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
    effectIds: [outlineDesc.id],
  },
});
```

### Bloom と Outline を組み合わせる

```typescript
import ThreeView, { Color } from "@navaramap/three";
import {
  BoxMeshDesc,
  SelectiveBloomEffectDesc,
  SelectiveOutlineEffectDesc,
} from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 1.0,
  },
});

const outlineDesc = view.addEffect<SelectiveOutlineEffectDesc>({
  selectiveOutline: {
    color: new Color().setHex(0xff0000),
    thickness: 2.0,
  },
});

// 両方のエフェクトを適用
const cubeDesc = view.addMesh<BoxMeshDesc>({
  box: {
    width: 100,
    height: 100,
    depth: 100,
    color: new Color().setHex(0xff0000),
    emissiveIntensity: 1.0,
    effectIds: [bloomDesc.id, outlineDesc.id], // 両方を適用
  },
  position: { x: 0, y: 0, z: 1000 },
});
```

## 備考

- Selective Outline エフェクトは、Sobel フィルタを使用したエッジ検出により、オブジェクトの輪郭を描画します。
- 選択したオブジェクトのハイライト表示やフォーカス表示に適しています。
