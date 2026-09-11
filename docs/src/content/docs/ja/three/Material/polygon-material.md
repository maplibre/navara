---
title: PolygonMaterial
description: Polygon material for navara_three
sidebar:
  order: 540
---

`PolygonMaterial`は、ポリゴンジオメトリレンダリング用のマテリアルを表します。

## Properties

### applyWaterNormal

**Type:** `boolean | undefined`

**Description:** 水の法線マップを適用するかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    applyWaterNormal: false
  }
}
```

### castShadow

**Type:** `boolean | undefined`

**Description:** ポリゴンが影を投影するかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    castShadow: true
  }
}
```

### clampToGround

**Type:** `boolean | undefined`

**Description:** 地面に張り付けるかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    clampToGround: true
  }
}
```

### color

**Type:** `Color`

**Description:** ポリゴンの色を`Color`インスタンスで指定します。

**Default:** Required

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polygon: {
    color: new Color().setHex(0x00cc66)
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
  polygon: {
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
  polygon: {
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
  polygon: {
    emissiveIntensity: 0.5
  }
}
```

### extrudedHeight

**Type:** `number | undefined`

**Description:** 押し出し高さを指定します。`clampToGround`が false の場合に機能します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    extrudedHeight: 50 // 50メートル押し出し
  }
}
```

### height

**Type:** `number | undefined`

**Description:** 高さを指定します。`clampToGround`が false の場合に機能します。単位はメートルです。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    height: 10 // 10メートルの高さ
  }
}
```

### ior

**Type:** `number | undefined`

**Description:** 屈折率（Index of Refraction）を指定します。物質を透過する光の屈折に影響します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    ior: 1.5 // ガラスの屈折率
  }
}
```

### lit

**Type:** `boolean | undefined`

**Description:** カラー出力にライティング計算を適用するかどうかを指定します。`false` の場合、ポリゴンはアルベドのみで描画されます。lit パイプライン自体は動き続けるため、法線とシャドウ G-buffer は書き込まれたままです。未設定の場合はシーン既定値 [`view.lit`](../../../three/api/threeview-properties/#lit) に従い、明示的に指定するとその既定値をどちらの方向にも上書きします。

**Default:** `undefined`（`view.lit` に従う）

**Example:**

```typescript
{
  polygon: {
    lit: false // アルベドのみを出力（ディファードライティングパス向けなど）
  }
}
```

### opacity

**Type:** `number | undefined`

**Description:** ポリゴンの不透明度を指定します。0.0（完全に透明）から 1.0（完全に不透明）の範囲で指定します。`transparent` を有効にする必要があります。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    opacity: 0.5
  }
}
```

### outline

**Type:** `boolean | undefined`

**Description:** アウトラインジオメトリを計算するかどうか。初回読み込み時のみ有効です。未設定の場合、`outlineShow` から推測されます。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    outline: true
  }
}
```

### outlineColor

**Type:** `Color | undefined`

**Description:** アウトラインの色を`Color`で指定します。現在、このプロパティは GeoJSON でのみサポートされています。

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polygon: {
    outlineColor: new Color().setHex(0xff00ff)
  }
}
```

### outlineShow

**Type:** `boolean | undefined`

**Description:** アウトラインを表示するかどうかを指定します。現在、このプロパティは GeoJSON でのみサポートされています。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    outlineShow: false
  }
}
```

### outlineWidth

**Type:** `number | undefined`

**Description:** アウトラインの幅を指定します。現在、このプロパティは GeoJSON でのみサポートされています。単位はピクセルです。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    outlineWidth: 2
  }
}
```

### perPositionHeight

**Type:** `boolean | undefined`

**Description:** 高さをデータから取得するかどうかを指定します。false の場合、高さは定数になります。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    perPositionHeight: true
  }
}
```

### receiveShadow

**Type:** `boolean | undefined`

**Description:** ポリゴンが影を受けるかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    receiveShadow: true
  }
}
```

### reflectivity

**Type:** `number | undefined`

**Description:** ポストプロセスまたは環境マップ用の反射率を指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    reflectivity: 0.5
  }
}
```

### roughness

**Type:** `number | undefined`

**Description:** ポストプロセス用の反射率（粗さ）を指定します。0.0 から 1.0 の範囲で指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    roughness: 0.2
  }
}
```

### shininess

**Type:** `number | undefined`

**Description:** マテリアルの光沢度を指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    shininess: 100
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** ポリゴンを表示するかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    show: true
  }
}
```

### specular

**Type:** `boolean | undefined`

**Description:** スペキュラー効果を有効にするかどうかを指定します。有効にすると `shininess` と `specularStrength` の値が使用されます。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    specular: true
  }
}
```

### specularStrength

**Type:** `number | undefined`

**Description:** スペキュラーハイライトの強度を指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    specularStrength: 2
  }
}
```

### surfaceShow

**Type:** `boolean | undefined`

**Description:** ポリゴンの表面を表示するかどうかを指定します。現在、このプロパティは GeoJSON でのみサポートされています。`outlineShow`が`true`の場合に有効です。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    surfaceShow: true
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** 透過を有効にするかどうかを指定します。`opacity` を使用するには `true` に設定する必要があります。エフェクトを使用する場合に予期しない動作を引き起こす可能性があります。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    transparent: true
  }
}
```

### tiled

**Type:** `boolean | undefined`

**Description:** データソースがMVTレイヤーでない場合でも、ポリゴンをXYZベクトルタイルに分割してレンダリングします。大きなポリゴンのパフォーマンスを向上させることができます。`clampToGround`を有効にすると、`tiled`は暗黙的に`true`に強制されます。`tiled`が有効な場合、アウトラインの描画はサポートされません。

**Default:** `false`

**Example:**

```typescript
{
  polygon: {
    tiled: true
  }
}
```

### water

**Type:** `boolean | undefined`

**Description:** ポリゴンに水面マテリアルを適用するかどうかを指定します。メッシュの読み込みが遅くなる可能性があります。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    water: true
  }
}
```

### waterScaleNormal

**Type:** `number | undefined`

**Description:** 水面法線のスケールを指定します。この値を小さくすると水面が粗くなります。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    waterScaleNormal: 2.0
  }
}
```

### waterSpeed

**Type:** `number | undefined`

**Description:** 水の波の速度を指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    waterSpeed: 0.003
  }
}
```

### wireframe

**Type:** `boolean | undefined`

**Description:** ワイヤーフレーム表示にするかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    wireframe: false
  }
}
```
