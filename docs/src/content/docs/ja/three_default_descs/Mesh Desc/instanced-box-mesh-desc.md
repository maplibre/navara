---
title: InstancedBoxMeshDesc
description: navara_three 向け GPU インスタンスボックスメッシュ
sidebar:
  order: 103
---

`InstancedBoxMeshDesc` クラスは、GPU インスタンシングを使用して複数のボックスインスタンスをレンダリングするメッシュです。すべてのボックスが1つのジオメトリとマテリアルを共有し、1回の描画コールで高パフォーマンスにレンダリングされます。`InstancedMeshDesc` を継承しています。

以下のプロパティに加えて、基底クラスの共通プロパティ（`position`、`rotation`、`scale`、`matrix`、`matrixWorld`、`geodetic`、`pickable`、`visible`）が利用できます。詳細は [MeshDesc](../mesh-desc-base) を参照してください。

## 共有マテリアルプロパティ

すべてのインスタンスに適用される共有マテリアルプロパティです。`boxes` 設定オブジェクト内で指定します。

### color

**Type:** `Color`

**Description:** すべてのインスタンスの基本色を `Color` インスタンスで指定します。

**Default:** `new Color().setStyle("#ffffff")`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  boxes: {
    color: new Color().setHex(0xff0000),
  }
}
```

### emissiveColor

**Type:** `Color`

**Description:** エミッシブ（自己発光）色を `Color` インスタンスで指定します。

**Default:** `new Color().setHex(0x000000)`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  boxes: {
    emissiveColor: new Color().setHex(0x222222),
  }
}
```

### emissiveIntensity

**Type:** `number`

**Description:** エミッシブの強度を指定します。

**Default:** `0`

**Example:**

```typescript
{
  boxes: {
    emissiveIntensity: 0.5,
  }
}
```

### opacity

**Type:** `number`

**Description:** 不透明度を指定します。0.0（完全に透明）から1.0（完全に不透明）の範囲です。

**Default:** `1`

**Example:**

```typescript
{
  boxes: {
    opacity: 0.5,
  }
}
```

### transparent

**Type:** `boolean`

**Description:** 透明度を有効にするかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  boxes: {
    transparent: true,
  }
}
```

### castShadow

**Type:** `boolean`

**Description:** インスタンスが影を落とすかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  boxes: {
    castShadow: true,
  }
}
```

### receiveShadow

**Type:** `boolean`

**Description:** インスタンスが影を受けるかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  boxes: {
    receiveShadow: true,
  }
}
```

## インスタンスごとのプロパティ (BoxChildConfig)

個々のボックスインスタンスのプロパティです。`children` 配列内で指定します。

### width

**Type:** `number`

**Description:** ボックスの幅（X軸）を指定します。インスタンスマトリックスのスケールとしてエンコードされます。`scale.x` と両方指定された場合は乗算されます。

**Default:** `1`

**Example:**

```typescript
{
  boxes: {
    children: [
      { width: 100 },
    ],
  }
}
```

### height

**Type:** `number`

**Description:** ボックスの高さ（Y軸）を指定します。インスタンスマトリックスのスケールとしてエンコードされます。`scale.y` と両方指定された場合は乗算されます。

**Default:** `1`

**Example:**

```typescript
{
  boxes: {
    children: [
      { height: 100 },
    ],
  }
}
```

### depth

**Type:** `number`

**Description:** ボックスの奥行き（Z軸）を指定します。インスタンスマトリックスのスケールとしてエンコードされます。`scale.z` と両方指定された場合は乗算されます。

**Default:** `1`

**Example:**

```typescript
{
  boxes: {
    children: [
      { depth: 100 },
    ],
  }
}
```

### color

**Type:** `Color | undefined`

**Description:** インスタンスごとの色を `Color` インスタンスで指定します。共有マテリアルの `color` をこのインスタンスに対して上書きします。

**Default:** `undefined`（共有マテリアルの色を使用）

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  boxes: {
    children: [
      { color: new Color().setHex(0xff0000) },
    ],
  }
}
```

### position

**Type:** `{ x: number, y: number, z: number } | undefined`

**Description:** 親グループに対するローカル位置を指定します。

**Default:** `{ x: 0, y: 0, z: 0 }`

**Example:**

```typescript
{
  boxes: {
    children: [
      { position: { x: 100, y: 0, z: 0 } },
    ],
  }
}
```

### rotation

**Type:** `{ x: number, y: number, z: number } | undefined`

**Description:** ローカル回転を指定します（オイラー角、ラジアン）。

**Default:** `undefined`

**Example:**

```typescript
{
  boxes: {
    children: [
      { rotation: { x: 0, y: Math.PI / 4, z: 0 } },
    ],
  }
}
```

### scale

**Type:** `{ x: number, y: number, z: number } | undefined`

**Description:** ローカルスケールを指定します。`width`、`height`、`depth` と乗算されます。

**Default:** `{ x: 1, y: 1, z: 1 }`

**Example:**

```typescript
{
  boxes: {
    children: [
      { scale: { x: 2, y: 2, z: 2 } },
    ],
  }
}
```

### matrix

**Type:** `Matrix4 | undefined`

**Description:** 事前計算されたトランスフォームマトリックスを指定します。設定された場合、`position`、`rotation`、`scale` は無視されます。

**Default:** `undefined`

**Example:**

```typescript
import { Matrix4 } from "three";

{
  boxes: {
    children: [
      { matrix: new Matrix4().makeTranslation(100, 0, 0) },
    ],
  }
}
```

## Config

### effectIds

**Type:** `string[]` (optional)

**Description:** このメッシュに適用する Selective Effect ID の配列を指定します。

**Example:**

```typescript
{
  boxes: {
    effectIds: ["bloom-effect", "outline-effect"],
  }
}
```

## インスタンス管理

動的なインスタンス管理のために [InstancedMeshDesc](../../../three/core/custom-desc/#custom-instanced-mesh-desc) から継承されるメソッド:

### handle.ref.add(config)

新しいインスタンスを追加します。追加されたインスタンスのインデックスを返します。

```typescript
const index = handle.ref.add({
  position: { x: 100, y: 0, z: 0 },
  width: 20,
  height: 20,
  depth: 20,
  color: new Color().setHex(0xffff00),
});
```

### handle.ref.removeAt(index)

インデックスを指定してインスタンスを削除します。swap-with-last による O(1) 削除を使用します。インスタンスの順序は保持されません。

```typescript
handle.ref.removeAt(1);
```

### handle.ref.updateAt(index, config)

指定したインデックスのインスタンスを部分的な設定で更新します。

```typescript
handle.ref.updateAt(0, {
  color: new Color().setHex(0xff00ff),
  height: 50,
});
```

### handle.ref.clear()

すべてのインスタンスを削除します。

```typescript
handle.ref.clear();
```

### handle.ref.replaceAll(configs)

すべてのインスタンスを一括置換します。`clear()` + 複数の `add()` 呼び出しより効率的です。1回の更新通知のみを発行します。

```typescript
handle.ref.replaceAll([
  { position: { x: 0, y: 0, z: 0 }, width: 10, height: 10, depth: 10 },
  { position: { x: 20, y: 0, z: 0 }, width: 10, height: 10, depth: 10 },
]);
```

### handle.ref.count

アクティブなインスタンス数を取得します。

```typescript
console.log("Instance count:", handle.ref.count);
```

## 使用例

### 基本的な使い方

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { InstancedBoxMeshDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
view.registerMesh("boxes", InstancedBoxMeshDesc);
await view.init();

const handle = view.addMesh<InstancedBoxMeshDesc>({
  boxes: {
    color: new Color().setHex(0xffffff),
    castShadow: true,
    children: [
      { position: { x: 0, y: 0, z: 0 }, width: 10, height: 20, depth: 10, color: new Color().setHex(0xff0000) },
      { position: { x: 30, y: 0, z: 0 }, width: 15, height: 10, depth: 15, color: new Color().setHex(0x00ff00) },
      { position: { x: 60, y: 0, z: 0 }, width: 5, height: 40, depth: 5, color: new Color().setHex(0x0000ff) },
    ],
  },
  position: { x: 0, y: 0, z: 6378137 },
});
```

### 動的なインスタンス管理

```typescript
// 新しいインスタンスを追加
const index = handle.ref.add({
  position: { x: 90, y: 0, z: 0 },
  width: 20,
  height: 20,
  depth: 20,
  color: new Color().setHex(0xffff00),
});

// インデックス 0 のインスタンスを更新
handle.ref.updateAt(0, {
  color: new Color().setHex(0xff00ff),
  height: 50,
});

// インデックス 1 のインスタンスを削除
handle.ref.removeAt(1);

// すべてのインスタンスを置換
handle.ref.replaceAll([
  { position: { x: 0, y: 0, z: 0 }, width: 10, height: 10, depth: 10 },
  { position: { x: 20, y: 0, z: 0 }, width: 10, height: 10, depth: 10 },
]);
```

### 共有マテリアルの更新

```typescript
handle.update({
  boxes: {
    color: new Color().setHex(0x333333),
    emissiveColor: new Color().setHex(0xff0000),
    emissiveIntensity: 0.5,
    opacity: 0.8,
    transparent: true,
  },
});
```
