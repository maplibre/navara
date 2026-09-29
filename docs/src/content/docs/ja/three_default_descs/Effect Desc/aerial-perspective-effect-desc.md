---
title: AerialPerspectiveEffectDesc
description: Aerial perspective effect descriptor for navara_three
sidebar:
  order: 51
---

`AerialPerspectiveEffectDesc`クラスは、大気遠近法エフェクトを表現するDescriptorです。大気による光の散乱(inscatter)と透過(transmittance)を計算し、遠くのオブジェクトほど青みがかって見える効果を実現します。

このエフェクトは `Atmosphere` クラスが提供する事前計算済みテクスチャと太陽・月の方向を使用して、物理的に正確な大気散乱を再現します。

:::tip[関連ドキュメント]
大気システムの詳細については [Atmosphere クラス](../../../three/api/atmosphere/) を参照してください。
:::

## Properties

### visible

**Type:** `boolean | undefined`

**Description:** エフェクトの表示/非表示を制御します。

**Default:** `true`

**Example:**

```typescript
{
  visible: true,
}
```

### inscatter

**Type:** `boolean | undefined`

**Description:** 大気中の光の散乱効果を有効にするかどうかを指定します。遠くのオブジェクトが明るく霞んで見える効果です。

**Default:** `true`

**Example:**

```typescript
{
  aerialPerspective: {
    inscatter: true,
  }
}
```

### transmittance

**Type:** `boolean | undefined`

**Description:** 大気による光の透過効果を有効にするかどうかを指定します。遠くのオブジェクトが暗く見える効果です。

**Default:** `true`

**Example:**

```typescript
{
  aerialPerspective: {
    transmittance: true,
  }
}
```

### irradiance

**Type:** `boolean | undefined`

**Description:** フォワードライティングの代わりに、事前計算した太陽と空の放射照度で G-buffer の法線を使ってポストプロセスでシーンをライティングします。[`view.lit = false`](../../../three/api/threeview-properties/#lit) と対にしてください。そうしないとフォワードパスとこのオプションでライティングが二重に適用されてしまいます。このライティングは拡散のみで、太陽の影と鏡面ハイライトは [`shadow`](#shadow) と [`specular`](#specular) で追加します。雲の影にはこのオプションが必要です。透明なマテリアルは再ライティングされません。`DefaultPlugin.addDefaultPhotorealScene({ deferredLighting: true })` は両方をまとめて設定します。

**Default:** `false`

**Example:**

```typescript
{
  aerialPerspective: {
    irradiance: true,
  }
}
```

### sky

**Type:** `boolean | undefined`

**Description:** 空の色を大気エフェクトに適用するかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  aerialPerspective: {
    sky: false,
  }
}
```

### sun

**Type:** `boolean | undefined`

**Description:** 太陽の方向を大気エフェクトに適用するかどうかを指定します。

**Default:** `true`

**Example:**

```typescript
{
  aerialPerspective: {
    sun: true,
  }
}
```

### moon

**Type:** `boolean | undefined`

**Description:** 月の方向を大気エフェクトに適用するかどうかを指定します。

**Default:** `true`

**Example:**

```typescript
{
  aerialPerspective: {
    moon: true,
  }
}
```

### useNormalBuffer

**Type:** `boolean | undefined`

**Description:** エフェクトに法線バッファをバインドするかどうかを指定します。これは、このパスでマテリアルに対する deferred lighting（irradiance の適用）を行うかどうかの切り替えとして機能します。`false` の場合、法線バッファはエフェクトに渡されず、マテリアルにポストプロセスのライティングは適用されません（大気の in-scatter と transmittance の計算自体は引き続き行われますが、このパスによってマテリアルがライティングし直されることはありません）。シーンのジオメトリが信頼できる法線バッファを出力しない場合（例: 法線情報を持たないタイル glTF アセットなど）に無効化し、マテリアルのライティングをそのまま保ちたいときに使用します。

**Default:** `true`

**Example:**

```typescript
{
  aerialPerspective: {
    useNormalBuffer: false,
  }
}
```

### albedoScale

**Type:** `number | undefined`

**Description:** 内部の `AerialPerspectiveEffect` に渡される `albedoScale` uniform の値を指定します。irradiance パスで diffuse 項を計算する際に、シーンカラーへ乗算されるスケール係数として使用されます。

**Default:** `2 / Math.PI`

**Example:**

```typescript
{
  aerialPerspective: {
    albedoScale: 2 / Math.PI,
  }
}
```

### shadow

**Type:** `boolean | undefined`

**Description:** [`irradiance`](#irradiance) でライティングされるシーンで太陽の影を有効にします。影のピクセルは太陽の光を失い天空光は保つため、晴れた日中の影は明るく、夕方に向かって深くなります。雲が落とす影については clouds エフェクトの `shadows` オプションを参照してください。

必要な設定:

- この Descriptor の `irradiance: true` と [`useNormalBuffer`](#usenormalbuffer) が有効であること。
- `ThreeView` のコンストラクタでの `shadow: true` と、太陽光の `castShadow: true`。
- 地形には頂点法線（`quantized-mesh` ソースの `requestVertexNormals: true`）か hillshade マテリアルが必要です。

`lit: true` のオブジェクトはフォワードシェーディングを保ち、透明な面は対象外です。以下の `shadowIntensity`、`shadowSoftness`、`shadowSamples` がこの項を調整し、項が無効な間も保持されます。

**Default:** `false`

**Example:**

```typescript
{
  aerialPerspective: {
    irradiance: true,
    shadow: true,
  }
}
```

### shadowIntensity

**Type:** `number | undefined`

**Description:** [`shadow`](#shadow) の項の強さをスケールします。`shadow` を無効にする場合と違い、`0` ではシェーダが再コンパイルされません。

**Default:** `1`

**Example:**

```typescript
{
  aerialPerspective: {
    shadowIntensity: 0.6,
  }
}
```

### shadowSoftness

**Type:** `number | undefined`

**Description:** 影の輪郭に適用するスクリーンスペースブラーの半径をピクセル単位で指定します。

**Default:** `1.5`

**Example:**

```typescript
{
  aerialPerspective: {
    shadowSoftness: 3,
  }
}
```

### shadowSamples

**Type:** `number | undefined`

**Description:** [`shadowSoftness`](#shadowsoftness) のブラーのタップ数です。

**Default:** `12`

**Example:**

```typescript
{
  aerialPerspective: {
    shadowSamples: 16,
  }
}
```

### specular

**Type:** `boolean | undefined`

**Description:** 太陽の鏡面反射を GGX のマイクロファセットローブで加算します。[`irradiance`](#irradiance) のライティングパスは拡散光だけなので、このオプションが無いと反射的なマテリアルもつや消しのままになります。ハイライトは [`shadow`](#shadow) の項が弱めるのと同じ太陽光で照らされるため、影の中や雲の影の下では消えます。

面がどれだけ反射するかはエフェクトのオプションではなくマテリアルの性質です。model と 3D Tiles では glTF の metalness、それ以外では material の reflectivity が使われ、roughness がハイライトの広がりを決めます。反射率が `0.01` 未満の面は計算されないため、地形、polyline、sprite、text はマテリアルが指定しない限りつや消しのままです。

[`shadow`](#shadow) と同様に `irradiance: true` と [`useNormalBuffer`](#usenormalbuffer) が必要です。[`albedoScale`](#albedoscale) は反射と拡散光を一緒に暗くします。

[SSR エフェクト](../ssr-effect-desc/) とは役割が重なりません。SSR は画面に映っているものを反射し、空はミスとして扱うため、太陽そのもののハイライトは作れません。

**Default:** `false`

**Example:**

```typescript
{
  aerialPerspective: {
    irradiance: true,
    specular: true,
  }
}
```

### specularIntensity

**Type:** `number | undefined`

**Description:** [`specular`](#specular) の反射の強さをスケールします。`specular` を無効にする場合と違い、`0` ではシェーダが再コンパイルされません。

**Default:** `1`

**Example:**

```typescript
{
  aerialPerspective: {
    specularIntensity: 0.5,
  }
}
```

## Usage Examples

### デフォルトエフェクトで大気遠近法を有効にする

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// デフォルトのフォトリアルオブジェクトを追加（AerialPerspectiveEffectDescを含む）
const defaultLayers = plugin.addDefaultPhotorealScene();

// 大気遠近法エフェクトの設定を更新
defaultLayers.aerialPerspective.update({
  aerialPerspective: {
    inscatter: true,
    transmittance: true,
    sky: false,
  },
});
```

### 雲の影と組み合わせた大気遠近法

```typescript
import ThreeView from "@navaramap/three";
import { CloudsEffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

const defaultLayers = plugin.addDefaultPhotorealScene();

// 雲の影を有効にする場合、irradianceを有効にする
defaultLayers.aerialPerspective.update({
  aerialPerspective: {
    inscatter: true,
    transmittance: true,
    irradiance: true,
  },
});

// 雲エフェクトを追加
view.addEffect<CloudsEffectDesc>({
  clouds: {
    shadows: true,
  },
});
```

### カスケードシャドウ付きの deferred ライティング

```typescript
import ThreeView from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

// シャドウマップを描画する。コンストラクタでのみ設定できる
const view = new ThreeView<DefaultDescriptions>({ shadow: true });
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// 大気がシーンをライティングし（irradiance + view.lit = false）、
// 太陽の影を有効にする
const layers = plugin.addDefaultPhotorealScene({
  deferredLighting: true,
  shadow: true,
});
layers.sun.update({ sun: { castShadow: true } });
view.toneMappingExposure = 3;

// 地形が shadow バッファに書き込むには頂点法線が必要
const terrainSource = view.addSource({
  type: "quantized-mesh",
  url: "https://example.com/terrain",
  requestVertexNormals: true,
});
view.addLayer({
  type: "terrain",
  source: terrainSource,
  terrain: { castShadow: true, receiveShadow: true },
});
```

## See Also

- [Color クラス](../../../three/api/color/) - 色の設定方法
