---
title: CylinderMeshDesc
description: Cylinder mesh descriptor for navara_three
sidebar:
  order: 103
---

`CylinderMeshDesc`クラスは、円柱(Cylinder)ジオメトリを描画するためのメッシュです。上部半径・下部半径・高さなどを指定して円柱や円錐を作成できます。

以下のプロパティに加えて、基底クラスの共通プロパティ（`position`、`rotation`、`scale`、`matrix`、`matrixWorld`、`geodetic`、`pickable`、`visible`）が利用できます。詳細は [MeshDesc](../mesh-desc-base) を参照してください。

## Properties

### radiusTop

**Type:** `number`

**Description:** 円柱の上部の半径を指定します。

**Default:** `1`

**Example:**

```typescript
{
  cylinder: {
    radiusTop: 50,
  }
}
```

### radiusBottom

**Type:** `number`

**Description:** 円柱の下部の半径を指定します。

**Default:** `1`

**Example:**

```typescript
{
  cylinder: {
    radiusBottom: 50,
  }
}
```

### height

**Type:** `number`

**Description:** 円柱の高さを指定します。

**Default:** `1`

**Example:**

```typescript
{
  cylinder: {
    height: 200,
  }
}
```

### radialSegments

**Type:** `number`

**Description:** 円周方向のセグメント数を指定します。

**Default:** `32`

**Example:**

```typescript
{
  cylinder: {
    radialSegments: 64,
  }
}
```

### heightSegments

**Type:** `number`

**Description:** 高さ方向のセグメント数を指定します。

**Default:** `1`

**Example:**

```typescript
{
  cylinder: {
    heightSegments: 2,
  }
}
```

### openEnded

**Type:** `boolean`

**Description:** 円柱の両端を開いた状態にするかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  cylinder: {
    openEnded: true,
  }
}
```

### thetaStart

**Type:** `number`

**Description:** 円柱の開始角度をラジアンで指定します。

**Default:** `0`

**Example:**

```typescript
{
  cylinder: {
    thetaStart: Math.PI / 4,
  }
}
```

### thetaLength

**Type:** `number`

**Description:** 円柱の中心角をラジアンで指定します。

**Default:** `Math.PI * 2`

**Example:**

```typescript
{
  cylinder: {
    thetaLength: Math.PI,
  }
}
```

### color

**Type:** `Color`

**Description:** 円柱の色を`Color`インスタンスで指定します。`Color`クラスは16進数カラーコードやCSS形式の色指定をサポートします。

**Default:** `new Color().setStyle("#ffffff")`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  cylinder: {
    color: new Color().setHex(0x0088ff),
  }
}
```

### draped

**Type:** `boolean`

**Description:** 立体としてではなく、形状を地形に貼り付けて描画します。ドレープはボリュームと地形の交差をステンシルテストで求めるため、**覆いたい地形を完全に含む大きさ**にする必要があります。

ドレープされた形状は自分自身の法線ではなく**地形の法線**で陰影が付くため、立体ではなく地面に貼られたデカールとして見えます。同じ理由で**影を受けません**。ドレープは深度テスト無しで描画されるので、ワールド座標に依存するシャドウの参照はボリュームの重なった面ごとに食い違い、奥の面が透けて見えてしまいます。`draped` が `true` の間 `receiveShadow` は無視されます（地形自体の影はそのまま残ります）。

**Default:** `false`

**Example:**

```typescript
{
  cylinder: {
    radiusTop: 300,
    radiusBottom: 300,
    height: 2000, // 地形を貫くだけの高さが必要
    draped: true,
  }
}
```

### castShadow

**Type:** `boolean`

**Description:** 円柱が影を投影するかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  cylinder: {
    castShadow: true,
  }
}
```

### receiveShadow

**Type:** `boolean`

**Description:** 円柱が影を受けるかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  cylinder: {
    receiveShadow: true,
  }
}
```

### emissiveColor

**Type:** `Color`

**Description:** 円柱の発光色を`Color`インスタンスで指定します。

**Default:** `new Color().setHex(0x000000)`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  cylinder: {
    emissiveColor: new Color().setHex(0x00ff00),
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
  cylinder: {
    emissiveIntensity: 1.0,
  }
}
```

### opacity

**Type:** `number`

**Description:** 円柱の不透明度を0.0から1.0の範囲で指定します。`transparent`を`true`に設定する必要があります。

**Default:** `1`

**Example:**

```typescript
{
  cylinder: {
    opacity: 0.5,
    transparent: true,
  }
}
```

### transparent

**Type:** `boolean`

**Description:** 円柱を半透明にするかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  cylinder: {
    transparent: true,
    opacity: 0.5,
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
  cylinder: {
    effectIds: ["bloom-effect", "outline-effect"],
  }
}
```

## Usage Examples

### 基本的な円柱

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { CylinderMeshDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
view.registerMesh("cylinder", CylinderMeshDesc);
await view.init();

// CylinderMeshDescを追加
const cylinderDesc = view.addMesh<CylinderMeshDesc>({
  cylinder: {
    radiusTop: 50,
    radiusBottom: 50,
    height: 200,
    color: new Color().setHex(0x0088ff),
  },
  position: { x: 0, y: 0, z: 1000 },
});
```

### 円錐の作成

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { CylinderMeshDesc } from "@navaramap/three-default-descs";

const coneDesc = view.addMesh<CylinderMeshDesc>({
  cylinder: {
    radiusTop: 0,
    radiusBottom: 100,
    height: 200,
    color: new Color().setHex(0xff8800),
  },
});
```
