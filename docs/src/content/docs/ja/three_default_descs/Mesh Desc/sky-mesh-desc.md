---
title: SkyMeshDesc
description: Sky mesh descriptor for navara_three
sidebar:
  order: 111
---

`SkyMeshDesc`クラスは、大気散乱による空と太陽・月を描画するメッシュです。物理ベースの大気散乱シミュレーションを使用して、リアルな空の表現を提供します。

太陽と月の位置は `view.atmosphere.date` に基づいて自動的に計算され、毎フレーム更新されます。

以下のプロパティに加えて、基底クラスの共通プロパティ（`position`、`rotation`、`scale`、`matrix`、`matrixWorld`、`geodetic`、`visible`）が利用できます。詳細は [MeshDesc](../mesh-desc-base) を参照してください。

:::tip[関連ドキュメント]
大気システムの詳細については [Atmosphere クラス](../../../three/api/atmosphere/) を参照してください。
:::

## Properties

### visible

**Type:** `boolean`

**Description:** スカイメッシュの表示/非表示を切り替えます。

**Example:**

```typescript
{ visible: true }
```

### sun

**Type:** `boolean`

**Description:** 太陽を表示するかどうかを指定します。

**Default:** `true`（`envMap` を指定した場合は `false`）

**Example:**

```typescript
{
  sky: {
    sun: true,
  }
}
```

### moon

**Type:** `boolean`

**Description:** 月を表示するかどうかを指定します。

**Default:** `true`（`envMap` を指定した場合は `false`）

**Example:**

```typescript
{
  sky: {
    moon: true,
  }
}
```

### moonScale

**Type:** `number`

**Description:** 月のスケールを指定します。

**Default:** `1`

**Example:**

```typescript
{
  sky: {
    moonScale: 1.5,
  }
}
```

### moonIntensity

**Type:** `number`

**Description:** 月の明るさを指定します。

**Default:** `1`

**Example:**

```typescript
{
  sky: {
    moonIntensity: 0.8,
  }
}
```

### sunAngularRadius

**Type:** `number`

**Description:** 太陽の視角半径をラジアンで指定します。

**Default:** `0.004675`

**Example:**

```typescript
{
  sky: {
    sunAngularRadius: 0.005,
  }
}
```

### envMap

**Type:** `boolean`

**Description:** 環境マップとしてレンダリングするかどうかを指定します。環境マップには、`sun` や `moon` を指定しない限り太陽と月を含めません。これほど小さい円盤は、なめらかな水面に四角く映るためです。水面に映る太陽は水面側で描画します。

**Default:** `false`

**Example:**

```typescript
{
  sky: {
    envMap: true,
  }
}
```

## Usage Examples

```typescript
import ThreeView from "@navaramap/three";
import { SkyMeshDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
view.registerMesh("sky", SkyMeshDesc);
await view.init();

// SkyMeshDescを追加
const skyDesc = view.addMesh<SkyMeshDesc>({
  sky: {
    visible: true,
    sun: true,
    moon: true,
    moonScale: 1.2,
    moonIntensity: 0.9,
    sunAngularRadius: 0.004675,
  },
});
```

## 技術的詳細

SkyMeshDescは、@takram/three-atmosphereライブラリを使用して実装されており、以下の機能を提供します:

- 物理ベースの大気散乱シミュレーション
- 太陽と月の位置に基づく動的なライティング
- 時刻に応じた空の色の変化
- 大気の影の長さの計算

スカイメッシュは、カメラの向きに応じて自動的に更新され、常にビューポート全体を覆います。