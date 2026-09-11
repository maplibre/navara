---
title: ModelMaterial
description: Model material for navara_three
sidebar:
  order: 520
---

`ModelMaterial` は [`3d-tiles`](../../../three/layer/3d-tiles-layer/) レイヤーのモデルの描画オプションです。`model` キーで指定します。データセットの URL などの取得設定は、参照先の [`3d-tiles`](../../../three/source/3d-tiles-source/) ソース側にあり、ここには含まれません。

## Properties

### animationActiveClip

**Type:** `string | undefined`

**Description:** GLTF に登録されているアニメーションを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    animationActiveClip: "Walk"
  }
}
```

:::tip[フルアニメーション制御]
`animationAutoPlay`、`animationClips`、`animationCrossfadeDuration`、`animationEnabled`、`animationLoop` などの高度なアニメーション機能については、メッシュとしてフルアニメーション制御を提供する [GLTFModelDesc](../../../three_default_descs/mesh-desc/gltf-model-desc/) を使用してください。
:::

### animationSpeed

**Type:** `number | undefined`

**Description:** アニメーションの再生速度を指定します。1.0 が通常速度です。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    animationSpeed: 1.0
  }
}
```

### applyWaterNormal

**Type:** `boolean | undefined`

**Description:** 水の法線マップを適用するかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    applyWaterNormal: true
  }
}
```

### castShadow

**Type:** `boolean | undefined`

**Description:** モデルが影を投影するかどうかを指定します。View で影を有効にして、太陽光レイヤの castShadow を有効にすると動作します。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    castShadow: true
  }
}
```

### color

**Type:** `Color | undefined`

**Description:** モデルの色を`Color`インスタンスで指定します。

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  model: {
    color: new Color().setHex(0xffffff)
  }
}
```

### creaseNormalAngle

**Type:** `number | undefined`

**Description:** [`normals`](#normals) が有効な場合に使用する、クリース角度（ラジアン）を指定します。共有する面の角度がこの閾値を超えるエッジはクリース（ハード）エッジとして維持され、それ以下のエッジはスムージングされます。

**Default:** `Math.PI / 6`（30°。`normals` を有効化し、このプロパティを省略した場合に適用されます）

**Example:**

```typescript
{
  model: {
    normals: true,
    creaseNormalAngle: Math.PI / 3, // 60°
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
  model: {
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
  model: {
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
  model: {
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
  model: {
    emissiveIntensity: 0.5
  }
}
```

### height

**Type:** `number | undefined`

**Description:** モデルの高さを指定します。単位はメートルです。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    height: 50 // 50メートル
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
  model: {
    ior: 1.5 // ガラスの屈折率
  }
}
```

### lit

**Type:** `boolean | undefined`

**Description:** カラー出力にライティング計算を適用するかどうかを指定します。`false` の場合、モデルはアルベドのみで描画されます。lit パイプライン自体は動き続けるため、法線とシャドウ G-buffer は書き込まれたままです。未設定の場合はシーン既定値 [`view.lit`](../../../three/api/threeview-properties/#lit) に従い、明示的に指定するとその既定値をどちらの方向にも上書きします。

**Default:** `undefined`（`view.lit` に従う）

**Example:**

```typescript
{
  model: {
    lit: false // アルベドのみを出力（ディファードライティングパス向けなど）
  }
}
```

### maxSse

**Type:** `number | undefined`

**Description:** 詳細レベル（LOD）の詳細度を決定するために使用される最大値です。値が高いほど、パフォーマンスは向上しますが、視覚的な品質は低下します。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    maxSse: 8
  }
}
```

### metalness

**Type:** `number | undefined`

**Description:** マテリアルの金属度を指定します。0.0 から 1.0 の範囲で指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    metalness: 0.1
  }
}
```

### normals

**Type:** `boolean | undefined`

**Description:** 有効にすると、モデルのロード後に creased-normals アルゴリズムで頂点法線を再計算します。法線情報を持たない、または法線品質の低いタイル glTF アセット（フォトグラメトリのタイルセットなど）でライティングや大気遠近法エフェクトを正しくシェーディングしたい場合に有用です。クリース角度は [`creaseNormalAngle`](#creasenormalangle) で指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    normals: true,
  }
}
```

### opacity

**Type:** `number | undefined`

**Description:** モデルの不透明度を指定します。有効範囲は 0.0（完全に透明）から 1.0（完全に不透明）です。このプロパティは、マテリアルを透明にしてレンダリングする際のアルファ値を制御します。

**Default:** `1.0`

**Example:**

```typescript
{
  model: {
    transparent: true,
    opacity: 0.5 // 50%の不透明度
  }
}
```

### pointSize

**Type:** `number | undefined`

**Description:** ポイントクラウドとしてレンダリングする場合のポイントサイズを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    pointSize: 2.0
  }
}
```

### receiveShadow

**Type:** `boolean | undefined`

**Description:** モデルが影を受けるかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
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
  model: {
    reflectivity: 0.8
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
  model: {
    roughness: 0.1
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
  model: {
    shininess: 30
  }
}
```

### shouldRotateInDefault

**Type:** `boolean | undefined`

**Description:** モデルの向きを楕円体上で正しく配置するために自動的に調整するプロパティです。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    shouldRotateInDefault: true
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** モデルを表示するかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    show: true
  }
}
```

### showBoundingBox

**Type:** `boolean | undefined`

**Description:** バウンディングボックスを表示するかどうかを指定します。デバッグ目的で使用します。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    showBoundingBox: true
  }
}
```

### size

**Type:** `number | undefined`

**Description:** モデルのサイズを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    size: 1.5 // 1.5倍のサイズ
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
  model: {
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
  model: {
    specularStrength: 0.5
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** 透明度とアルファブレンディングを有効にします。有効にすると、モデルのアルファチャンネルに基づいて透明度付きでレンダリングできます。

**Default:** `false`

**Example:**

```typescript
{
  model: {
    transparent: true
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
  model: {
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
  model: {
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
  model: {
    waterSpeed: 0.003
  }
}
```
