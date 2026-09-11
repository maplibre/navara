---
title: PlaneMeshDesc
description: Plane mesh descriptor for navara_three
sidebar:
  order: 105
---

`PlaneMeshDesc`クラスは、平面(Plane)ジオメトリを描画するためのメッシュです。幅・高さを指定して平面を作成できます。

以下のプロパティに加えて、基底クラスの共通プロパティ（`position`、`rotation`、`scale`、`matrix`、`matrixWorld`、`geodetic`、`pickable`、`visible`）が利用できます。詳細は [MeshDesc](../mesh-desc-base) を参照してください。

## Properties

### width

**Type:** `number`

**Description:** 平面の幅を指定します。

**Default:** `1`

**Example:**

```typescript
{
  plane: {
    width: 1000,
  }
}
```

### height

**Type:** `number`

**Description:** 平面の高さを指定します。

**Default:** `1`

**Example:**

```typescript
{
  plane: {
    height: 1000,
  }
}
```

### widthSegments

**Type:** `number`

**Description:** 幅方向のセグメント数を指定します。

**Default:** `1`

**Example:**

```typescript
{
  plane: {
    widthSegments: 10,
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
  plane: {
    heightSegments: 10,
  }
}
```

### color

**Type:** `Color`

**Description:** 平面の色を`Color`インスタンスで指定します。`Color`クラスは16進数カラーコードやCSS形式の色指定をサポートします。

**Default:** `new Color().setStyle("#ffffff")`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  plane: {
    color: new Color().setHex(0x00aa00),
  }
}
```

### castShadow

**Type:** `boolean`

**Description:** 平面が影を投影するかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  plane: {
    castShadow: true,
  }
}
```

### receiveShadow

**Type:** `boolean`

**Description:** 平面が影を受けるかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  plane: {
    receiveShadow: true,
  }
}
```

### emissiveColor

**Type:** `Color`

**Description:** 平面の発光色を`Color`インスタンスで指定します。

**Default:** `new Color().setHex(0x000000)`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  plane: {
    emissiveColor: new Color().setHex(0x0000ff),
  }
}
```

### emissiveIntensity

**Type:** `number`

**Description:** 発光の強度を指定します。

**Default:** `1`

**Example:**

```typescript
{
  plane: {
    emissiveIntensity: 1.0,
  }
}
```

### opacity

**Type:** `number`

**Description:** 平面の不透明度を0.0から1.0の範囲で指定します。`transparent`を`true`に設定する必要があります。

**Default:** `1`

**Example:**

```typescript
{
  plane: {
    opacity: 0.5,
    transparent: true,
  }
}
```

### transparent

**Type:** `boolean`

**Description:** 平面を半透明にするかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  plane: {
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
  plane: {
    effectIds: ["bloom-effect", "outline-effect"],
  }
}
```

## Usage Examples

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { PlaneMeshDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
view.registerMesh("plane", PlaneMeshDesc);
await view.init();

const planeDesc = view.addMesh<PlaneMeshDesc>({
  plane: {
    width: 1000,
    height: 1000,
    color: new Color().setHex(0x00aa00),
    receiveShadow: true,
  },
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: -Math.PI / 2, y: 0, z: 0 },
});
```
