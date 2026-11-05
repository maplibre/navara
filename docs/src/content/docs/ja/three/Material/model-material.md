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

**Description:** `specular` ハイライトの Fresnel 項に使う屈折率を指定します。水面には効きません。

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

**Description:** マテリアルの金属度を指定します。0.0 から 1.0 の範囲で指定します。SSR と aerial perspective の `specular` はこの値をそのまま垂直入射時の反射率として読みます。`0` は反射せず、`1` は鏡のように反射します。

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

**Description:** `specular` ハイライトの光沢度を指定します。水面には効きません。

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

**Description:** スペキュラー効果を有効にするかどうかを指定します。有効にすると `shininess` と `specularStrength` の値が使用されます。水面には効きません。

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

**Description:** `specular` ハイライトの強度を指定します。水面には効きません。

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

**Description:** モデルを水面として描画するかどうかを指定します。波は [`waveStrength`](#wavestrength) と [`waveDirection`](#wavedirection) に従います。波の大きさはメートル単位で一定で、近くでは波として見え、約 2 km より遠くでは太陽のきらめきの下で一様にざらついた平面に見えます。水面は空を Fresnel 項で反射し、太陽を独自のハイライトで反射するため、`reflectivity`、`roughness`、`shininess`、`specularStrength`、`specular`、`ior` は効きません。波はフレームが描画されている間だけ動きます（例えば `ThreeView.animation` を有効にしたとき）。

**Default:** `undefined`

**Example:**

```typescript
{
  model: {
    water: true
  }
}
```

### waveExaggeration

**Type:** `number | undefined`

**Description:** 波の大きさと速さを保ったまま、傾きを拡大縮小します。`0` では静かな鏡のような水面になります。`water` が有効なときだけ使われます。

**Default:** `1`

**Example:**

```typescript
{
  model: {
    water: true,
    waveExaggeration: 0.5
  }
}
```

### waterScale

**Type:** `"ocean" | "large" | "medium" | "small" | undefined`

**Description:** 水域の広さです。波は開けた水面が長いほど大きく育つため、同じ `waveStrength` でも狭い水域ほど波が短く細かくなります。`"ocean"` は `waveStrength` が許す大きさまで波を育てます。`"large"` は湾や大きな湖のような約 20 km、`"medium"` は湖や大河のような約 2 km、`"small"` は川や池のような約 200 m の水面を想定します。波の傾きは広さによらず `waveStrength` で決まります。`water` が有効なときだけ使われます。

**Default:** `"ocean"`

**Example:**

```typescript
{
  model: {
    water: true,
    waterScale: "small"
  }
}
```

### waveStrength

**Type:** `number | undefined`

**Description:** 波の大きさ、急さ、速さを決めます。`1` 程度で穏やかなさざ波、`5` で標準、`20` で荒天になります。高さだけを変えるには [`waveExaggeration`](#waveexaggeration) を使います。`water` が有効なときだけ使われます。

**Default:** `5`

**Example:**

```typescript
{
  model: {
    water: true,
    waveStrength: 12
  }
}
```

### waveDirection

**Type:** `number | undefined`

**Description:** 波が進む方向で、北から時計回りの角度（度）です。`water` が有効なときだけ使われます。

**Default:** `0`

**Example:**

```typescript
{
  model: {
    water: true,
    waveDirection: 225
  }
}
```
