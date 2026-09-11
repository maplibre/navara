---
title: SphereMeshDesc
description: Sphere mesh descriptor for navara_three
sidebar:
  order: 104
---

`SphereMeshDesc`クラスは、球体(Sphere)ジオメトリを描画するためのメッシュです。半径や分割数などを指定して球体を作成できます。

以下のプロパティに加えて、基底クラスの共通プロパティ（`position`、`rotation`、`scale`、`matrix`、`matrixWorld`、`geodetic`、`pickable`、`visible`）が利用できます。詳細は [MeshDesc](../mesh-desc-base) を参照してください。

## Properties

### radius

**Type:** `number`

**Description:** 球体の半径を指定します。

**Default:** `1`

**Example:**

```typescript
{
  sphere: {
    radius: 100,
  }
}
```

### widthSegments

**Type:** `number`

**Description:** 横方向(水平)のセグメント数を指定します。

**Default:** `32`

**Example:**

```typescript
{
  sphere: {
    widthSegments: 64,
  }
}
```

### heightSegments

**Type:** `number`

**Description:** 縦方向(垂直)のセグメント数を指定します。

**Default:** `16`

**Example:**

```typescript
{
  sphere: {
    heightSegments: 32,
  }
}
```

### phiStart

**Type:** `number`

**Description:** 水平方向の開始角度をラジアンで指定します。

**Default:** `0`

**Example:**

```typescript
{
  sphere: {
    phiStart: Math.PI / 4,
  }
}
```

### phiLength

**Type:** `number`

**Description:** 水平方向の中心角をラジアンで指定します。

**Default:** `Math.PI * 2`

**Example:**

```typescript
{
  sphere: {
    phiLength: Math.PI,
  }
}
```

### thetaStart

**Type:** `number`

**Description:** 垂直方向の開始角度をラジアンで指定します。

**Default:** `0`

**Example:**

```typescript
{
  sphere: {
    thetaStart: Math.PI / 6,
  }
}
```

### thetaLength

**Type:** `number`

**Description:** 垂直方向の中心角をラジアンで指定します。

**Default:** `Math.PI`

**Example:**

```typescript
{
  sphere: {
    thetaLength: Math.PI / 2,
  }
}
```

### color

**Type:** `Color`

**Description:** 球体の色を`Color`インスタンスで指定します。`Color`クラスは16進数カラーコードやCSS形式の色指定をサポートします。

**Default:** `new Color().setStyle("#ffffff")`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  sphere: {
    color: new Color().setHex(0xff0000),
  }
}
```

### castShadow

**Type:** `boolean`

**Description:** 球体が影を投影するかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  sphere: {
    castShadow: true,
  }
}
```

### receiveShadow

**Type:** `boolean`

**Description:** 球体が影を受けるかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  sphere: {
    receiveShadow: true,
  }
}
```

### emissiveColor

**Type:** `Color`

**Description:** 球体の発光色を`Color`インスタンスで指定します。

**Default:** `new Color().setHex(0x000000)`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  sphere: {
    emissiveColor: new Color().setHex(0xff0000),
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
  sphere: {
    emissiveIntensity: 1.0,
  }
}
```

### opacity

**Type:** `number`

**Description:** 球体の不透明度を0.0から1.0の範囲で指定します。`transparent`を`true`に設定する必要があります。

**Default:** `1`

**Example:**

```typescript
{
  sphere: {
    opacity: 0.5,
    transparent: true,
  }
}
```

### transparent

**Type:** `boolean`

**Description:** 球体を半透明にするかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  sphere: {
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
  sphere: {
    effectIds: ["bloom-effect", "outline-effect"],
  }
}
```

## Usage Examples

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { SphereMeshDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
view.registerMesh("sphere", SphereMeshDesc);
await view.init();

// SphereMeshDescを追加
const sphereDesc = view.addMesh<SphereMeshDesc>({
  sphere: {
    radius: 100,
    widthSegments: 32,
    heightSegments: 16,
    color: new Color().setHex(0xff0000),
    castShadow: true,
  },
  position: { x: 0, y: 0, z: 1000 },
});
```
