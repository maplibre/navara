---
title: CloudsEffectDesc
description: Clouds effect descriptor for navara_three
sidebar:
  order: 52
---

`CloudsEffectDesc`クラスは、リアルタイムボリュメトリック雲をレンダリングするエフェクトです。大気散乱、影、ヘイズなど、高度な雲のビジュアル効果を提供します。

このエフェクトは `Atmosphere` クラスが提供する大気テクスチャと太陽方向を使用して、物理的に正確な雲の照明を計算します。

:::tip[関連ドキュメント]
大気システムの詳細については [Atmosphere クラス](../../../three/api/atmosphere/) を参照してください。
:::

## Properties

### visible

**Type:** `boolean | undefined`

**Description:** エフェクトの表示/非表示を制御します。

**Default:** `true`

### qualityPreset

**Type:** `"low" | "medium" | "high" | "ultra" | undefined`

**Description:** 雲のレンダリング品質プリセットを指定します。

**Default:** `"medium"`

**Example:**

```typescript
{
  clouds: {
    qualityPreset: "high",
  }
}
```

### coverage

**Type:** `number | undefined`

**Description:** 雲の被覆率を0.0から1.0の範囲で指定します。

**Default:** `0.25`

**Example:**

```typescript
{
  clouds: {
    coverage: 0.5,
  }
}
```

### resolutionScale

**Type:** `number | undefined`

**Description:** レンダリング解像度のスケール係数を指定します。低い値でパフォーマンスが向上します。

**Default:** `1`

**Example:**

```typescript
{
  clouds: {
    resolutionScale: 0.5,
  }
}
```

### lightShafts

**Type:** `boolean | null | undefined`

**Description:** ライトシャフト(光芒)エフェクトを有効にするかどうかを指定します。

**Default:** `null`

**Example:**

```typescript
{
  clouds: {
    lightShafts: true,
  }
}
```

### shadows

**Type:** `boolean | undefined`

**Description:** すべてのオブジェクトの影を有効にするかどうかを指定します。`Atmosphere.irradiance`も有効にする必要があります。

**Default:** `true`

**Example:**

```typescript
{
  clouds: {
    shadows: true,
  }
}
```

### shadowCascadeCount :since[0.3.2]

**Type:** `number | null | undefined`

**Description:** シャドウマップのカスケード数を指定します。省略した場合は`qualityPreset`の値を使います。後から`qualityPreset`を変更すると、同じ`update()`で指定しない限りプリセットの値に置き換わります。

**Default:** `null`（`low`プリセットでは`2`、それ以外は`3`）

**Example:**

```typescript
{
  clouds: {
    shadowCascadeCount: 4,
  }
}
```

### haze

**Type:** `boolean | undefined`

**Description:** ヘイズ(霧)エフェクトを有効にするかどうかを指定します。

**Default:** `true`

**Example:**

```typescript
{
  clouds: {
    haze: true,
  }
}
```

### hazeDensityScale

**Type:** `number | undefined`

**Description:** ヘイズの密度スケールを指定します。

**Default:** `3e-5`

**Example:**

```typescript
{
  clouds: {
    hazeDensityScale: 5e-5,
  }
}
```

### scatteringCoefficient

**Type:** `number | undefined`

**Description:** 散乱係数を指定します。

**Default:** `1`

**Example:**

```typescript
{
  clouds: {
    scatteringCoefficient: 1.2,
  }
}
```

### absorptionCoefficient

**Type:** `number | undefined`

**Description:** 吸収係数を指定します。

**Default:** `0`

**Example:**

```typescript
{
  clouds: {
    absorptionCoefficient: 0.1,
  }
}
```

### scatterAnisotropy1

**Type:** `number | undefined`

**Description:** 第一の散乱異方性パラメータを指定します。

**Default:** `0.7`

**Example:**

```typescript
{
  clouds: {
    scatterAnisotropy1: 0.8,
  }
}
```

### scatterAnisotropy2

**Type:** `number | undefined`

**Description:** 第二の散乱異方性パラメータを指定します。

**Default:** `-0.2`

**Example:**

```typescript
{
  clouds: {
    scatterAnisotropy2: -0.3,
  }
}
```

### scatterAnisotropyMix

**Type:** `number | undefined`

**Description:** 二つの散乱異方性のミックス比を指定します。

**Default:** `0.5`

**Example:**

```typescript
{
  clouds: {
    scatterAnisotropyMix: 0.6,
  }
}
```

### skyLightScale

**Type:** `number | undefined`

**Description:** 空の光のスケールを指定します。

**Default:** `1`

**Example:**

```typescript
{
  clouds: {
    skyLightScale: 1.5,
  }
}
```

### groundBounceScale

**Type:** `number | undefined`

**Description:** 地面からの反射光のスケールを指定します。

**Default:** `1`

**Example:**

```typescript
{
  clouds: {
    groundBounceScale: 0.8,
  }
}
```

### powderScale

**Type:** `number | undefined`

**Description:** パウダーエフェクト(雲のエッジの明るさ)のスケールを指定します。

**Default:** `0.8`

**Example:**

```typescript
{
  clouds: {
    powderScale: 1.0,
  }
}
```

### powderExponent

**Type:** `number | undefined`

**Description:** パウダーエフェクトの指数を指定します。

**Default:** `150`

**Example:**

```typescript
{
  clouds: {
    powderExponent: 200,
  }
}
```

### localWeatherVelocity

**Type:** `Vector2 | { x: number, y: number } | undefined`

**Description:** 雲の移動速度をVector2で指定します。x成分とy成分がそれぞれ水平方向の移動速度を制御します。アニメーションを有効にした状態で使用すると、雲が流れるエフェクトを実現できます。

**Default:** `Vector2(0, 0)`

**Example:**

```typescript
import { Vector2 } from "three";

{
  clouds: {
    localWeatherVelocity: new Vector2(0.005, 0.001),
  }
}
```

### hazeExponent

**Type:** `number | undefined`

**Description:** ヘイズの指数を指定します。

**Default:** `0.001`

**Example:**

```typescript
{
  clouds: {
    hazeExponent: 0.002,
  }
}
```

### hazeScatteringCoefficient

**Type:** `number | undefined`

**Description:** ヘイズの散乱係数を指定します。

**Default:** `0.9`

**Example:**

```typescript
{
  clouds: {
    hazeScatteringCoefficient: 1.5,
  }
}
```

### hazeAbsorptionCoefficient

**Type:** `number | undefined`

**Description:** ヘイズの吸収係数を指定します。

**Default:** `0.5`

**Example:**

```typescript
{
  clouds: {
    hazeAbsorptionCoefficient: 1.5,
  }
}
```

### maxIterationCount

**Type:** `number | undefined`

**Description:** レイマーチングの最大反復回数を指定します。値が大きいほど品質が向上しますが、パフォーマンスコストも増加します。

**Default:** `64`

**Example:**

```typescript
{
  clouds: {
    maxIterationCount: 128,
  }
}
```

### minStepSize

**Type:** `number | undefined`

**Description:** レイマーチングの最小ステップサイズを指定します。

**Default:** `100`

**Example:**

```typescript
{
  clouds: {
    minStepSize: 50,
  }
}
```

### maxStepSize

**Type:** `number | undefined`

**Description:** レイマーチングの最大ステップサイズを指定します。

**Default:** `1000`

**Example:**

```typescript
{
  clouds: {
    maxStepSize: 2000,
  }
}
```

### shadowFarScale

**Type:** `number | undefined`

**Description:** シャドウのファープレーンスケールを指定します。

**Default:** `0.05`

**Example:**

```typescript
{
  clouds: {
    shadowFarScale: 1.5,
  }
}
```

### shadowMapSize :since[0.3.2]

**Type:** `Vector2 | null | undefined`

**Description:** シャドウマップのサイズを`Vector2`で指定します。省略した場合は`qualityPreset`の値を使います。後から`qualityPreset`を変更すると、同じ`update()`で指定しない限りプリセットの値に置き換わります。

**Default:** `null`（`low`と`medium`プリセットでは`Vector2(256, 256)`、`high`では`Vector2(512, 512)`、`ultra`では`Vector2(1024, 1024)`）

**Example:**

```typescript
import { Vector2 } from "three";

{
  clouds: {
    shadowMapSize: new Vector2(1024, 1024),
  }
}
```

### localWeatherRepeat

**Type:** `Vector2 | undefined`

**Description:** ローカル天候テクスチャのリピート回数を指定します。

**Default:** `Vector2(100, 100)`

**Example:**

```typescript
import { Vector2 } from "three";

{
  clouds: {
    localWeatherRepeat: new Vector2(2, 2),
  }
}
```

### localWeatherOffset

**Type:** `Vector2 | undefined`

**Description:** ローカル天候テクスチャのオフセットを指定します。

**Example:**

```typescript
import { Vector2 } from "three";

{
  clouds: {
    localWeatherOffset: new Vector2(0.5, 0.5),
  }
}
```

### shapeRepeat

**Type:** `Vector3 | undefined`

**Description:** 雲の形状テクスチャのリピート回数を指定します。

**Default:** `Vector3(0.0003, 0.0003, 0.0003)`

**Example:**

```typescript
import { Vector3 } from "three";

{
  clouds: {
    shapeRepeat: new Vector3(0.0005, 0.0005, 0.0005),
  }
}
```

### shapeOffset

**Type:** `Vector3 | undefined`

**Description:** 雲の形状テクスチャのオフセットを指定します。

**Example:**

```typescript
import { Vector3 } from "three";

{
  clouds: {
    shapeOffset: new Vector3(0.1, 0.2, 0.3),
  }
}
```

### shapeDetailRepeat

**Type:** `Vector3 | undefined`

**Description:** 雲の詳細形状テクスチャのリピート回数を指定します。

**Default:** `Vector3(0.006, 0.006, 0.006)`

**Example:**

```typescript
import { Vector3 } from "three";

{
  clouds: {
    shapeDetailRepeat: new Vector3(0.008, 0.008, 0.008),
  }
}
```

### shapeDetailOffset

**Type:** `Vector3 | undefined`

**Description:** 雲の詳細形状テクスチャのオフセットを指定します。

**Example:**

```typescript
import { Vector3 } from "three";

{
  clouds: {
    shapeDetailOffset: new Vector3(0.1, 0.1, 0.1),
  }
}
```

### turbulenceRepeat

**Type:** `Vector2 | undefined`

**Description:** 乱流テクスチャのリピート回数を指定します。

**Default:** `Vector2(20, 20)`

**Example:**

```typescript
import { Vector2 } from "three";

{
  clouds: {
    turbulenceRepeat: new Vector2(30, 30),
  }
}
```

### turbulenceDisplacement

**Type:** `number | undefined`

**Description:** 乱流による変位量を指定します。

**Example:**

```typescript
{
  clouds: {
    turbulenceDisplacement: 0.5,
  }
}
```

## Usage Examples

### 基本的な雲エフェクトの追加

```typescript
import ThreeView from "@navaramap/three";
import { CloudsEffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// デフォルトのフォトリアルオブジェクトを追加（雲のレンダリングに必要）
plugin.addDefaultPhotorealScene();

// 雲エフェクトを追加
const cloudsDesc = view.addEffect<CloudsEffectDesc>({
  clouds: {
    coverage: 0.5,
    qualityPreset: "high",
  },
});
```

### 雲の影を有効にしたシーン

```typescript
import ThreeView from "@navaramap/three";
import { CloudsEffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView({ shadow: true });
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

const defaultLayers = plugin.addDefaultPhotorealScene();

// 太陽光の影を有効にする
defaultLayers.sun.update({
  sun: {
    castShadow: true,
  },
});

// 大気遠近法のirradianceを有効にする（雲の影に必要）
defaultLayers.aerialPerspective.update({
  aerialPerspective: {
    irradiance: true,
  },
});

// 雲エフェクトを追加（影を有効化）
const cloudsDesc = view.addEffect<CloudsEffectDesc>({
  clouds: {
    shadows: true,
    shadowCascadeCount: 3,
  },
});
```

### 霧（フォグ）エフェクトとして使用

```typescript
import ThreeView, { EffectHandle } from "@navaramap/three";
import { CloudsEffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// デフォルトのフォトリアルオブジェクトを追加
plugin.addDefaultPhotorealScene();

// 雲オブジェクトを霧として使用
const cloudsDesc = view.addEffect<CloudsEffectDesc>({
  clouds: {},
});

// 霧の設定を適用
const clouds = cloudsDesc.ref.raw;
if (clouds) {
  clouds.coverage = 0.3;
  // 4番目のクラウドレイヤーを霧として設定
  clouds.cloudLayers[3].altitude = 0;
  clouds.cloudLayers[3].height = 2000;
  clouds.cloudLayers[3].densityScale = 0.05;
  clouds.cloudLayers[3].shapeAmount = 0.2;
  clouds.cloudLayers[3].shapeDetailAmount = 0;
  clouds.cloudLayers[3].constantTerm = 0.01;
}
```

### アニメーション付きの雲

```typescript
import ThreeView from "@navaramap/three";
import { CloudsEffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Vector2 } from "three";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// アニメーションを有効にする
view.animation = true;

// デフォルトのフォトリアルオブジェクトを追加
plugin.addDefaultPhotorealScene();

// 雲の移動速度を設定してDescriptorを追加
const cloudsDesc = view.addEffect<CloudsEffectDesc>({
  clouds: {
    coverage: 0.5,
    localWeatherVelocity: new Vector2(0.005, 0.001),
  },
});
```

### 天気シーンの完全な例

```typescript
import ThreeView from "@navaramap/three";
import { CloudsEffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Vector2 } from "three";

const view = new ThreeView({ animation: true, shadow: true });
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

const defaultLayers = plugin.addDefaultPhotorealScene();

// irradianceを有効にして雲の影を描画
defaultLayers.aerialPerspective.update({
  aerialPerspective: {
    irradiance: true,
  },
});

// 雲Descriptorを追加
const cloudsDesc = view.addEffect<CloudsEffectDesc>({
  clouds: {
    qualityPreset: "high",
    localWeatherVelocity: new Vector2(0.005, 0.001),
    coverage: 0.45,
    absorptionCoefficient: 5,
    lightShafts: true,
    shadows: true,
    haze: true,
    hazeDensityScale: 0.0003,
    hazeExponent: 0.002,
    hazeAbsorptionCoefficient: 1.5,
  },
});
```
