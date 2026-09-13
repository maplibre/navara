---
title: PolylineMaterial
description: Polyline material for navara_three
sidebar:
  order: 550
---

`PolylineMaterial`は、ポリラインジオメトリレンダリング用のマテリアルを表します。

## Properties

### castShadow

**Type:** `boolean | undefined`

**Description:** ポリラインが影を投影するかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    castShadow: true
  }
}
```

### clampToGround

**Type:** `boolean`

**Description:** 地面に沿わせるかどうかを指定します。

**Default:** Required

**Example:**

```typescript
{
  polyline: {
    clampToGround: true
  }
}
```

### color

**Type:** `Color`

**Description:** ポリラインの色を`Color`インスタンスで指定します。

**Default:** Required

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polyline: {
    color: new Color().setHex(0x0066cc)
  }
}
```

### depthWrite

**Type:** `boolean | undefined`

**Description:** 深度バッファへの書き込みを有効にします。透明なマテリアルの場合は `false` に設定して、深度ソートの問題を防ぎます。

**Default:** `true`

**Example:**

```typescript
{
  polyline: {
    depthWrite: false
  }
}
```

### effectIds

**Type:** `string[] | undefined`

**Description:** 適用する Selective Effect の ID を指定します（例: "bloom", "outline"）。SelectiveBloomEffectDesc や SelectiveOutlineEffectDesc と連携して使用します。

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    effectIds: ["bloom", "outline"]
  }
}
```

### emissiveColor

**Type:** `Color | undefined`

**Description:** 発光色を`Color`インスタンスで指定します。

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polyline: {
    emissiveColor: new Color().setHex(0xff0000)
  }
}
```

### emissiveIntensity

**Type:** `number | undefined`

**Description:** 発光の強度を指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    emissiveIntensity: 0.5
  }
}
```

### geometryTypes

**Type:** `("line" | "polygon")[] | undefined`

**Description:** このマテリアルが消費するソースジオメトリのカテゴリーです。`"polygon"` を含めると、ポリゴンの境界リング（外周と穴）がリングの基準高度で閉じたポリラインとして描画されます。押し出しの側面エッジは含まれないため、押し出しポリゴンにはポリゴンマテリアルの [`outline`](../polygon-material/#outline) を使用してください。配列を指定するとデフォルトは置き換えられるため、ラインジオメトリも描画し続けたい場合は `"line"` を含めてください。このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` で変更しても読み込み済みのタイルには反映されず、変更後に読み込まれたタイルにのみ適用されます（すべてに反映するにはレイヤーを作り直してください）。

**Default:** `["line"]`

**Example:**

```typescript
{
  polyline: {
    geometryTypes: ["line", "polygon"]
  }
}
```

### height

**Type:** `number | undefined`

**Description:** ポリラインの高さを指定します。単位はメートルです。

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    height: 1
  }
}
```

### lit

**Type:** `boolean | undefined`

**Description:** カラー出力にライティング計算を適用するかどうかを指定します。`false` の場合、ポリラインはアルベドのみで描画されます。lit パイプライン自体は動き続けるため、法線とシャドウ G-buffer は書き込まれたままです。未設定の場合はシーン既定値 [`view.lit`](../../../three/api/threeview-properties/#lit) に従い、明示的に指定するとその既定値をどちらの方向にも上書きします。

**Default:** `undefined`（`view.lit` に従う）

**Example:**

```typescript
{
  polyline: {
    lit: false // アルベドのみを出力（ディファードライティングパス向けなど）
  }
}
```

### maxWidth

**Type:** `number | undefined`

**Description:** ピクセル単位の最大線幅。ズームレベルに関係なくレンダリング幅を制限します。小さい値はフラグメントシェーダーのオーバードローを削減し、パフォーマンスが向上します。

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    maxWidth: 10
  }
}
```

### receiveShadow

**Type:** `boolean | undefined`

**Description:** ポリラインが影を受けるかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    receiveShadow: true
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** ポリラインを表示するかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    show: true
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** 透明度とアルファブレンディングを有効にします。これにより、ポリラインを不透明度付きでレンダリングできます。

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    transparent: true
  }
}
```

:::note
`transparent` を有効にすると、Selective Effect を使用する際に予期しない動作を引き起こす可能性があります。
:::

### tiled

**Type:** `boolean | undefined`

**Description:** データソースがMVTレイヤーでない場合でも、ポリラインをXYZベクトルタイルに分割してレンダリングします。大きなポリラインのパフォーマンスを向上させることができます。`clampToGround`を有効にすると、`tiled`は暗黙的に`true`に強制されます。

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    tiled: true
  }
}
```

### width

**Type:** `number`

**Description:** ポリラインの幅を指定します。単位はピクセルです。

**Default:** Required

**Example:**

```typescript
{
  polyline: {
    width: 3
  }
}
```
