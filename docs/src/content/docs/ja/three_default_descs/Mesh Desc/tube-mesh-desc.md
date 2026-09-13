---
title: TubeMeshDesc
description: Tube mesh descriptor for navara_three
sidebar:
  order: 106
---

`TubeMeshDesc`クラスは、チューブ(Tube)ジオメトリを描画するためのメッシュです。カトマル・ロム曲線に沿ったチューブ形状を作成できます。

以下のプロパティに加えて、基底クラスの共通プロパティ（`position`、`rotation`、`scale`、`matrix`、`matrixWorld`、`geodetic`、`pickable`、`visible`）が利用できます。詳細は [MeshDesc](../mesh-desc-base) を参照してください。

## Properties

### points

**Type:** [`XYZ`](../../../three/api/types/#xyz)`[]`

**Description:** チューブの経路を定義する3D座標の配列を指定します。最低2点が必要です。

**Example:**

```typescript
{
  tube: {
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 50, z: 0 },
      { x: 200, y: 0, z: 0 }
    ],
  }
}
```

### tubularSegments

**Type:** `number`

**Description:** チューブの長さ方向のセグメント数を指定します。

**Default:** `64`

**Example:**

```typescript
{
  tube: {
    tubularSegments: 128,
  }
}
```

### radius

**Type:** `number`

**Description:** チューブの半径を指定します。

**Default:** `1`

**Example:**

```typescript
{
  tube: {
    radius: 10,
  }
}
```

### radialSegments

**Type:** `number`

**Description:** チューブの円周方向のセグメント数を指定します。

**Default:** `8`

**Example:**

```typescript
{
  tube: {
    radialSegments: 16,
  }
}
```

### closed

**Type:** `boolean`

**Description:** チューブを閉じた形状にするかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  tube: {
    closed: true,
  }
}
```

### tension

**Type:** `number`

**Description:** カトマル・ロム曲線の張力を指定します。0に近いほど直線的になります。

**Default:** `0.5`

**Example:**

```typescript
{
  tube: {
    tension: 0.8,
  }
}
```

### color

**Type:** `Color`

**Description:** チューブの色を`Color`インスタンスで指定します。`Color`クラスは16進数カラーコードやCSS形式の色指定をサポートします。

**Default:** `new Color().setStyle("#ffffff")`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  tube: {
    color: new Color().setHex(0xff8800),
  }
}
```

### castShadow

**Type:** `boolean | undefined`

**Description:** チューブが影を投影するかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  tube: {
    castShadow: true,
  }
}
```

### receiveShadow

**Type:** `boolean | undefined`

**Description:** チューブが影を受けるかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  tube: {
    receiveShadow: true,
  }
}
```

### emissiveColor

**Type:** `Color`

**Description:** チューブの発光色を`Color`インスタンスで指定します。

**Default:** `new Color().setHex(0x000000)`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  tube: {
    emissiveColor: new Color().setHex(0xff8800),
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
  tube: {
    emissiveIntensity: 1.0,
  }
}
```

### opacity

**Type:** `number`

**Description:** チューブの不透明度を0.0から1.0の範囲で指定します。`transparent`を`true`に設定する必要があります。

**Default:** `1`

**Example:**

```typescript
{
  tube: {
    opacity: 0.5,
    transparent: true,
  }
}
```

### transparent

**Type:** `boolean`

**Description:** チューブを半透明にするかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  tube: {
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
  tube: {
    effectIds: ["bloom-effect", "outline-effect"],
  }
}
```

## Usage Examples

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { TubeMeshDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
view.registerMesh("tube", TubeMeshDesc);
await view.init();

// TubeMeshDescを追加
const tubeDesc = view.addMesh<TubeMeshDesc>({
  tube: {
    points: [
      { x: 0, y: 0, z: 1000 },
      { x: 100, y: 50, z: 1100 },
      { x: 200, y: -50, z: 1000 },
      { x: 300, y: 0, z: 1000 },
    ],
    radius: 10,
    tubularSegments: 128,
    radialSegments: 16,
    color: new Color().setHex(0xff8800),
    tension: 0.5,
  },
});
```
