---
title: PolygonMaterial
description: Polygon material for navara_three
sidebar:
  order: 540
---

`PolygonMaterial`は、ポリゴンジオメトリレンダリング用のマテリアルを表します。

## Properties

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

### depthPrePass

**Type:** `boolean | undefined`

**Description:** 透明なメッシュを描画する前にポリゴンの深度を書き込み、`transparent` のポリゴンが最も手前の面だけをブレンドするようにします。無効の場合は手前の面の奥にある面も透けて重なり、押し出したポリゴンの側面など、重なった部分が濃く見えます。隣り合うタイルの両方に含まれる地物など、同じ深度で重なる面は1回だけブレンドされます。書き込んだ深度はポリゴンの奥にある他の透明なメッシュも隠すため、奥にある半透明のレイヤーやパーティクルは透けて見えなくなります。`transparent` が `true` かつ `clampToGround` が `false` のときに有効です。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    transparent: true,
    opacity: 0.8,
    depthPrePass: true
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

**Description:** ポリゴンを指定したメートル数だけ上に押し出します。上面は楕円体から `height + extrudedHeight` の高さに置かれ、[`perPositionHeight`](#perpositionheight) のときは各位置からその高さに置かれます。`perPositionHeight` で [`extrusionBase`](#extrusionbase) が `"ellipsoid"` のときは、上面は各位置からこの値だけ上に置かれ、`height` は加わりません。`clampToGround` が false の場合に機能します。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    extrudedHeight: 50 // 50メートル押し出し
  }
}
```

### extrusionBase :since[0.3.2]

**Type:** `"position" | "ellipsoid" | undefined`

**Description:** [`perPositionHeight`](#perpositionheight) のポリゴンで、下面が何に沿うかを指定します。

- `"position"`: 下面も上面も各位置に沿います。下面は各位置から [`height`](#height) だけ上、上面は `height + extrudedHeight` だけ上に置かれるため、ポリゴンの厚さはどこでも同じです。
- `"ellipsoid"`: 下面は楕円体から `height` の高さに平らに置かれ、上面は各位置から [`extrudedHeight`](#extrudedheight) だけ上に置かれます。ポリゴンはその間を埋めます。CesiumJS が `perPositionHeight` と `extrudedHeight` の両方を持つポリゴンを描く形と同じです。下面が上面より上に来る部分は裏返って描かれるため、`height` は上面の最も低いところより下にしてください。

`perPositionHeight` がない場合、位置は楕円体の上に置かれるため、どちらの値でも同じポリゴンになります。レイヤーを追加するときに指定してください。`layer.update()` では、表示済みのポリゴンは作り直されません。

**Default:** `"position"`

**Example:**

```typescript
{
  polygon: {
    clampToGround: false,
    perPositionHeight: true,
    // 各位置の高さにある水面から楕円体までを埋める
    extrusionBase: "ellipsoid"
  }
}
```

### geodesic :since[0.3.2]

**Type:** `boolean | undefined`

**Description:** GeoJSON ソースのうちタイル分割された描画パス（`clampToGround` または `tiled`）で描かれる辺を測地線に沿わせるかどうかを指定します。`true` の場合、経度が 180° より離れた連続する 2 頂点も、日付変更線をまたぐ近い側の経路で結ばれます。ただし、そうすると閉じなくなるリング（極を囲むリングなど）は指定されたとおりに扱われます。`false` の場合、辺は Web メルカトル上の直線になり、経度は指定されたとおりに扱われます。つまり MapLibre と同じく、経度 190° は 180° の東にあります。タイル分割されない描画パスの辺と、vector tile ソースの辺には影響しません。

このオプションはレイヤー全体に適用されます。タイル分割された `polygon` と `polyline` は 1 つのジオメトリを共有し、両方が `geodesic: false` を指定しない限り、そのジオメトリは測地線に沿います。値はレイヤーのタイルを最初に構築するときに読み取られるため、既存のレイヤーで変更しても効果はありません。

**Default:** `true`

**Example:**

```typescript
{
  polygon: {
    clampToGround: true,
    geodesic: false
  }
}
```

### height

**Type:** `number | undefined`

**Description:** ポリゴンの下面を指定したメートル数だけ上げます。基準は楕円体で、[`perPositionHeight`](#perpositionheight) のときは各位置です。ただし [`extrusionBase`](#extrusionbase) が `"ellipsoid"` のときは楕円体が基準になります。`clampToGround` が false の場合に機能します。

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

**Description:** `specular` ハイライトの Fresnel 項に使う屈折率を指定します。水面には効きません。

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

**Description:** `outlineShow` が `false` の間もアウトラインジオメトリを計算するかどうか。計算しておくと、後から更新で表示できます。アウトラインを表示する場合は常に計算されます。ジオメトリの構築時に読まれるため、読み込み済みのタイルは変わりません。

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

**Description:** アウトラインの色を`Color`で指定します。

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

**Description:** アウトライン（押し出しの底面と上面の縁、および垂直の辺）を表示するかどうかを指定します。GeoJSON とベクタータイルのソースのポリゴンに描画されますが、`clampToGround` または `tiled` が `true` の場合は描画されません。ベクタータイルでは、タイルのクリッピングで加わった辺には描画されないため、タイルの境界をまたぐ建物にその境界に沿った線は引かれません。

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

**Description:** アウトラインの幅を指定します。単位はピクセルです。

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

**Description:** 各位置の高さを使います。`false` の場合、位置は楕円体の上に置かれ、ポリゴンの高さは [`height`](#height) で決まります。このポリゴンの下面の位置は [`extrusionBase`](#extrusionbase) で決まります。レイヤーを追加するときに指定してください。`layer.update()` では、表示済みのポリゴンは作り直されません。

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

**Description:** SSR と aerial perspective の `specular` が読む垂直入射時の反射率（F0）を指定します。水面はこの値によらず `0.02` を使います。`0.01` 未満では両方とも無効になります。環境マップが設定されている場合はその重みにもなります。

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

**Description:** SSR や大気遠近法の鏡面反射項などのポストプロセスで使う粗さを指定します。0.0 から 1.0 の範囲で指定し、0.0 は鏡面です。

**Default:** `0.44`

**Example:**

```typescript
{
  polygon: {
    roughness: 0.2
  }
}
```

### shadeSidesAsSurface

**Type:** `boolean | undefined`

**Description:** 押し出したポリゴンの側面を、側面自身の法線ではなく面の上向きの法線で陰影付けし、上面と同じ明るさにします。押し出しが立体ではなく連続した面を表す場合に使います。たとえばセルごとの水位で、側面が隣り合うセルとの段差を埋める場合です。`clampToGround` が `false` のときに有効です。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    extrudedHeight: 2,
    shadeSidesAsSurface: true
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

**Description:** スペキュラー効果を有効にするかどうかを指定します。有効にすると `shininess` と `specularStrength` の値が使用されます。水面には効きません。

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

**Description:** `specular` ハイライトの強度を指定します。水面には効きません。

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

**Description:** ポリゴンの表面を表示するかどうかを指定します。`outlineShow`が`true`の場合に有効です。

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

**Description:** ポリゴンを水面として描画するかどうかを指定します。波は [`waveStrength`](#wavestrength) と [`waveDirection`](#wavedirection) に従います。波の大きさはメートル単位で一定で、近くでは波として見え、約 2 km より遠くでは太陽のきらめきの下で一様にざらついた平面に見えます。水面は空を Fresnel 項で反射し、太陽を独自のハイライトで反射するため、`reflectivity`、`roughness`、`shininess`、`specularStrength`、`specular`、`ior` は効きません。波はフレームが描画されている間だけ動きます（例えば `ThreeView.animation` を有効にしたとき）。

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
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
  polygon: {
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
  polygon: {
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
  polygon: {
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
  polygon: {
    water: true,
    waveDirection: 225
  }
}
```

### flowSpeed

**Type:** `number | undefined`

**Description:** 波を [`waveDirection`](#wavedirection) の向きに運ぶ流れの速さ（m/s）です。波の大きさや傾きは変わりません。水面全体が同じように動きます。`water` が有効なときだけ使われます。

**Default:** `0`

**Example:**

```typescript
{
  polygon: {
    water: true,
    waveDirection: 90,
    flowSpeed: 2
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
