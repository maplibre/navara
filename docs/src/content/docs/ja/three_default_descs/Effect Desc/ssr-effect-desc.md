---
title: SSREffectDesc
description: SSR effect descriptor for navara_three
sidebar:
  order: 60
---

`SSREffectDesc`クラスは、スクリーンスペース反射(SSR)エフェクトを生成するDescriptorです。リアルタイムで画面上のオブジェクトの反射を計算し、水面や光沢のある表面の反射を表現します。

## Properties

### visible

**Type:** `boolean | undefined`

**Description:** エフェクトの表示/非表示を制御します。

**Default:** `true`

### geometryBuffer

**Type:** `Texture | null | undefined`

**Description:** 反射計算に使用するカスタムのジオメトリバッファです。未指定または`null`の場合はエンジンのMRTノーマルバッファが使用され、マテリアルが反射率と`1`未満のroughnessを書き込んだ場所にSSRが適用されます。model と 3D Tiles（glTF の metalness）、`reflectivity`を指定したポリゴンと地形（例: `water: true`のポリゴン）が該当します。独自のスクリーンアラインドテクスチャを渡すことで、SSRを適用する場所をアプリケーション側で完全に制御できます。例えば動的に描画される水たまりなどです。

各テクセルはエンジンのGバッファエンコーディングに従う必要があります:

- `.xy`: octahedralパックされた**ビュー空間**法線（`@takram/three-geospatial/shaders`の`packing`チャンクの`packNormalToVec2`）
- `.z`: 垂直入射時の反射率（F0）。例えば水は`0.02`、その他の誘電体は`0.04`、鏡は`1`です。反射のフレネル強度を決めるため、値が小さいと真上から見たときは弱く、浅い角度から見たときは強く反射します。値が`0.01`未満のピクセルではSSRがスキップされます
- `.w`: roughness。値が`1`のピクセルではSSRがスキップされます。cone tracing有効時（既定）はブラーのコーン角を制御し、cone tracing無効時は`.z`に乗算されてGGXレイジッタのroughness（`.z * .w`）になります

テクスチャは正規化スクリーンUVでサンプリングされるため、描画バッファと同じサイズにしてください（パックされた法線は符号付きの値なので`HalfFloatType`を使用します）。リサイズ時にサイズを追従させるのはアプリケーションの責任です。テクスチャの*内容*の更新（毎フレームのrender-to-texture）は自動的に反映されます。`update()`呼び出しが必要なのはテクスチャ*オブジェクト*を差し替える場合のみです。オプションを`null`に戻すとMRTノーマルバッファにリセットされます:

```typescript
ssrDesc.update({ ssr: { geometryBuffer: null } });
```

シーン自身の法線の上に合成する場合は、SSRディスクリプタのハンドル経由でMRTノーマルバッファを読み取れます:

```typescript
import { type MRTPassEffectDesc } from "@navaramap/three";

const mrtPass = ssrDesc.ref.find<MRTPassEffectDesc>("mrt");
const sceneNormals = mrtPass?.normalBuffer; // Texture | undefined
```

**Default:** `null`（エンジンのMRTノーマルバッファ）

**Example:**

```typescript
{
  ssr: {
    geometryBuffer: myRenderTarget.texture,
  }
}
```

アニメーションする水たまりをカスタムジオメトリバッファに描画する完全な動作例は、NavaraリポジトリのExample `example/pages/ssr-puddle/` にあります。

### resolutionScale

**Type:** `number | undefined`

**Description:** SSRレンダリングの解像度スケール係数を指定します。0-1の範囲で、低い値ほどパフォーマンスが向上します。

**Default:** `0.5`

**Example:**

```typescript
{
  ssr: {
    resolutionScale: 0.75,
  }
}
```

### iterations

**Type:** `number | undefined`

**Description:** 反射の交差を見つけるためのレイマーチング反復の最大数を指定します。

**Default:** `100`

**Example:**

```typescript
{
  ssr: {
    iterations: 150,
  }
}
```

### binarySearchIterations

**Type:** `number | undefined`

**Description:** 反射の精度を向上させるバイナリサーチ改良ステップの数を指定します。

**Default:** `4`

**Example:**

```typescript
{
  ssr: {
    binarySearchIterations: 6,
  }
}
```

### pixelZSize

**Type:** `number | undefined`

**Description:** ピクセル除外のための深度バッファ精度閾値を指定します。

**Default:** `100`

**Example:**

```typescript
{
  ssr: {
    pixelZSize: 150,
  }
}
```

### pixelStride

**Type:** `number | undefined`

**Description:** スクリーンスペースに沿ったレイマーチングのステップサイズをピクセル単位で指定します。ステップにはレンダラーのピクセル比が掛かるため、`iterations` が届く画面上の範囲はディスプレイの解像度密度によらず同じになります。

**Default:** `5`

**Example:**

```typescript
{
  ssr: {
    pixelStride: 8,
  }
}
```

### pixelStrideZCutoff

**Type:** `number | undefined`

**Description:** `pixelStride` が 1 ピクセルまで縮む視距離を指定します。この距離より遠い面から出るレイは 1 ピクセルずつ進むため、届く範囲は最大 `iterations` ピクセルになります。遠い面の反射が途中で切れる場合は大きくしてください。

**Default:** `1000`

**Example:**

```typescript
{
  ssr: {
    pixelStrideZCutoff: 2000,
  }
}
```

### maxRayDistance

**Type:** `number | undefined`

**Description:** 反射レイがワールド単位で移動できる最大距離を指定します。

**Default:** `5000`

**Example:**

```typescript
{
  ssr: {
    maxRayDistance: 10000,
  }
}
```

### screenEdgeFadeStart

**Type:** `number | undefined`

**Description:** アーティファクトを隠すためにエッジフェードが開始される画面位置(0-1)を指定します。

**Default:** `0.75`

**Example:**

```typescript
{
  ssr: {
    screenEdgeFadeStart: 0.8,
  }
}
```

### eyeFadeStart

**Type:** `number | undefined`

**Description:** 視角に基づいて反射をフェードする開始角度(ラジアン)を指定します。

**Default:** `0`

**Example:**

```typescript
{
  ssr: {
    eyeFadeStart: 0.1,
  }
}
```

### eyeFadeEnd

**Type:** `number | undefined`

**Description:** 視角に基づいて反射をフェードする終了角度(ラジアン)を指定します。

**Default:** `1`

**Example:**

```typescript
{
  ssr: {
    eyeFadeEnd: 1.2,
  }
}
```

### jitter

**Type:** `number | undefined`

**Description:** 各レイの開始位置をそのストライド分だけずらし、粗い `pixelStride` によるバンディングをノイズと引き換えに軽減します。そのノイズは resolve が平均化して均します。

**Default:** `1`

意味を持つのは cone tracing 有効時のみです（resolve は cone tracing パスの中にあります）。`useConeTracing: false` ではレイを平均化する処理が無いため、0 以外にすると反射のシルエットが粒状にディザリングされます。その場合は `0` にしてください。

**Example:**

```typescript
{
  ssr: {
    jitter: 0.5,
  }
}
```

### blendMode

**Type:** `BlendMode | undefined`

**Description:** 反射と元のシーンを合成するためのブレンドモードを指定します。

**Default:** `"normal"`

:::note[初期化時のみ設定可能]
このプロパティはDescriptor作成時にのみ設定できます。`update()`メソッドでは変更できません。
:::

**有効な値:** `"normal"`, `"add"`, `"multiply"`, `"screen"`, `"overlay"` など（ColorGradingLUTEffectDescのblendMode参照）

**Example:**

```typescript
{
  ssr: {
    blendMode: "add",
  }
}
```

### useConeTracing

**Type:** `boolean | undefined`

**Description:** 視覚品質を向上させるコーントレーシングを有効にします。コストがかかる可能性があります。

**Default:** `true`

**Example:**

```typescript
{
  ssr: {
    useConeTracing: false,
  }
}
```

### coneTracingFadeStart

**Type:** `number | undefined`

**Description:** 反射のフェードが開始される比率を指定します。

**Default:** `0.9`

**Example:**

```typescript
{
  ssr: {
    coneTracingFadeStart: 0.5,
  }
}
```

### coneTracingFadeEnd

**Type:** `number | undefined`

**Description:** 反射のフェードが終了する比率を指定します。

**Default:** `1.0`

**Example:**

```typescript
{
  ssr: {
    coneTracingFadeEnd: 1.0,
  }
}
```

### coneTracingMaxDistance

**Type:** `number | undefined`

**Description:** 反射が見える最大距離を指定します。

**Default:** `500.0`

**Example:**

```typescript
{
  ssr: {
    coneTracingMaxDistance: 3000,
  }
}
```

### coneTracingIteration

**Type:** `number | undefined`

**Description:** コーントレーシングを蓄積する反復数を指定します。

**Default:** `14`

**Example:**

```typescript
{
  ssr: {
    coneTracingIteration: 8,
  }
}
```

### resolveKernelSize

**Type:** `number | undefined`

**Description:** resolve が集める近傍の幅を、レイバッファのテクセル単位で指定します。奇数のみです。

**Default:** `3`

SSR は 1 ピクセルにつき 1 本のレイを飛ばすため、「反射するかどうか」がピクセル単位の二値判定になります。その結果、反射のシルエットは硬いエッジになり、レイをジッタさせるとブロック状にディザリングされます。resolve は近傍を平均して連続的なカバレッジに変換するので、シルエットがアンチエイリアスされ、ジッタで散ったレイが周囲のピクセルにとって同一ローブの追加サンプルとして働きます。近傍はサーフェス深度の一致度で重み付けされるため、シルエットをまたいで反射が滲むことはありません。

値を大きくすると滑らかになりますが甘くなり、テクセルあたりのテクスチャタップが各方向に 1 つずつ増えます。`useConeTracing` 有効時のみ適用されます。

**Example:**

```typescript
{
  ssr: {
    resolveKernelSize: 5,
  }
}
```

## Usage Examples

### 基本的なSSRエフェクトの追加

```typescript
import ThreeView from "@navaramap/three";
import { SSREffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// SSRエフェクトを追加
const ssrDesc = view.addEffect<SSREffectDesc>({
  ssr: {},
});
```

### 水面反射のためのSSR

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { SSREffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// デフォルトのフォトリアルオブジェクトを追加
plugin.addDefaultPhotorealScene();

// SSRエフェクトを追加
const ssrDesc = view.addEffect<SSREffectDesc>({
  ssr: {
    resolutionScale: 0.5,
    iterations: 100,
    binarySearchIterations: 4,
    maxRayDistance: 5000,
  },
});

// 水面ポリゴンを追加
const waterSource = view.addSource({
  type: "geojson",
  data: {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [139.64, 35.77],
          [139.64, 35.61],
          [139.90, 35.61],
          [139.90, 35.77],
          [139.64, 35.77],
        ],
      ],
    },
  },
});

view.addLayer({
  type: "vector",
  source: waterSource,
  polygon: {
    color: new Color().setHex(0x001e0f),
    reflectivity: 0.02,
    roughness: 0.2,
    water: true,
    specular: true,
  },
});
```

### パフォーマンス重視のSSR設定

```typescript
import ThreeView from "@navaramap/three";
import { SSREffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// パフォーマンス重視の設定
const ssrDesc = view.addEffect<SSREffectDesc>({
  ssr: {
    resolutionScale: 0.25, // 低解像度でパフォーマンス向上
    iterations: 50,        // 反復回数を減らす
    useConeTracing: false, // コーントレーシングを無効化
  },
});
```

### コーントレーシングを使用した高品質SSR

```typescript
import ThreeView from "@navaramap/three";
import { SSREffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// 高品質設定
const ssrDesc = view.addEffect<SSREffectDesc>({
  ssr: {
    resolutionScale: 1.0,
    iterations: 150,
    binarySearchIterations: 6,
    useConeTracing: true,
    coneTracingIteration: 8,
  },
});
```

## 備考

高品質な反射エフェクトを提供しますが、パフォーマンスコストが高いため、必要に応じて解像度スケールやイテレーション数を調整してください。水面や光沢のある表面と組み合わせて使用すると効果的です。
