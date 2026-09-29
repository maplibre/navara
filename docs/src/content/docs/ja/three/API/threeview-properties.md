---
title: ThreeView Properties
description: API Reference for ThreeView Class Properties and Events
sidebar:
  order: 940
---

このページでは、ThreeView インスタンスで利用可能なすべてのプロパティとイベントを説明します。

## Properties

### camera

**Type:** `ThreeViewCamera`

**Read-only** (getter)

ビューの位置、向き、投影、インタラクティブ操作動作を管理するカメラコントローラー。

**Example:**

```tsx
// カメラの地理座標を取得
const pos = view.camera.positionGeographic;

// カメラの移動イベントをサブスクライブ
view.camera.on("moveend", () => {
  console.log("カメラが停止しました");
});
```

:::tip[関連ドキュメント]
すべてのプロパティ・イベント・操作オプションの詳細は [ThreeViewCamera クラス](../../../three/api/camera/) を参照してください。
:::

### globe

**Type:** `Globe`

**Read-only** (getter)

地形、画像レイヤー、グローブ固有の設定を管理する Globe インスタンス。透明度、ワイヤーフレーム表示、標高ヒートマップのカラーマップなど、地球表示に関するさまざまなプロパティを制御できます。

**Example:**

```tsx
// グローブの透明度を設定
view.globe.transparent = true;
view.globe.opacity = 0.8;

// ワイヤーフレームモードを有効化
view.globe.wireframe = true;

// 標高ヒートマップ用カラーマップを設定
view.globe.elevationColormap = customColorMap;
```

:::tip[関連ドキュメント]
詳細は [Globe クラス](../../../three/api/globe/) を参照してください。
:::

### atmosphere

**Type:** `Atmosphere`

**Read-only** (getter)

大気システムを管理するインスタンス。太陽と月の位置計算、大気散乱テクスチャの管理を行います。`date` プロパティを変更すると、天体暦に基づいて太陽・月の方向が自動的に再計算され、`SunLightDesc` や `SkyMeshDesc` などの関連 Descriptor に反映されます。

**Example:**

```tsx
// 日時を設定して太陽位置を変更
view.atmosphere.date = new Date("2024-06-21T12:00:00");

// 太陽の方向ベクトルを取得
const sunDirection = view.atmosphere.getSunDirection();

// 現在地が夜かどうかを判定
const isNight = view.atmosphere.isAtNight(view.camera.positionECEF);

// 太陽方向の変更を監視
view.atmosphere.on("sunChanged", (sunDirection) => {
  console.log("太陽方向が変更されました:", sunDirection);
});
```

:::tip[関連ドキュメント]
詳細は [Atmosphere クラス](../../../three/api/atmosphere/) を参照してください。
:::

### toneMappingExposure

**Type:** `number`

HDR レンダリングのためのトーンマッピング露出値を取得または設定します。値を大きくすると明るく、小さくすると暗くなります。

**Example:**

```tsx
// 露出を上げて明るくする
view.toneMappingExposure = 1.5;

// 露出を下げて暗くする
view.toneMappingExposure = 0.8;
```

### lit

**Type:** `boolean`

**デフォルト:** `true`

マテリアルの `lit` オプションのシーン既定値を取得または設定します。`false` にすると、`lit` を明示していないすべてのマテリアルが**アルベドのみ**を出力します。カラー出力でライティング計算がスキップされるだけで、lit パイプライン自体は動き続けるため、法線とシャドウ G-buffer は書き込まれたままです。この組み合わせが、ディファードライティングパスが必要とする入力になります。

解決は 3 状態で、より具体的な設定が常に優先されます。

| 設定 | 結果 |
| ---- | ---- |
| マテリアル / メッシュの `lit: true` | `view.lit` が `false` でも lit |
| マテリアル / メッシュの `lit: false` | `view.lit` が `true` でもアルベドのみ |
| `lit` 未設定（`undefined`） | `view.lit` に従う |

このオプションは [`terrain`](../../../three/material/terrain-material/#lit) / [`polygon`](../../../three/material/polygon-material/#lit) / [`polyline`](../../../three/material/polyline-material/#lit) / [`model`](../../../three/material/model-material/#lit) マテリアルと、メッシュ Descriptor の設定のトップレベル（[MeshDesc](../../../three_default_descs/mesh-desc/mesh-desc-base/#lighting-lit) を参照）で使用できます。もともとライティングを行わないマテリアル（`point` / `billboard` / `text`）は影響を受けません。

**Example:**

```tsx
// シーン既定: すべてアルベドのみを出力
view.lit = false;

// …ただしこのメッシュはフォワードライティングのまま
view.addMesh<SphereMeshDesc>({
  sphere: { radius: 100 },
  position,
  lit: true,
});
```

:::note
`lit` の切り替えは、view・マテリアル・メッシュのいずれであっても該当シェーダーを一度再コンパイルします。毎フレーム制御するものではなく、構成の切り替えとして扱ってください。
:::

:::tip[関連ドキュメント]
アルベド出力を法線・シャドウ G-buffer と組み合わせて利用するディファードライティングエフェクトの実例は、[カスタム Descriptor: G-Buffer の読み取り](../../../three/core/custom-desc/#g-buffer-の読み取り) を参照してください。
:::

### buffers

**Type:** `ResolvedGBufferOptions`

**読み取り専用**（getter）

現在確保されているバッファを `{ selectiveEffect, emissive, shadow, globeNormal }` の真偽値として返します。これは設定値ではなく**導出値**です。view はアクティブなエフェクト Descriptor が `static requiredBuffers` または `getRequiredBuffers()` のオーバーライドで宣言するものの和集合を確保し、そのバッファを必要とする最後のエフェクトが削除されるか宣言をやめた時点で解放します。

前 3 つは G-buffer のアタッチメントですが、`globeNormal` だけは地形法線の画面座標コピーであり、アタッチメント枠を消費しません（[カスタム Descriptor: G-Buffer の読み取り](../../../three/core/custom-desc/#g-buffer-の読み取り)を参照）。

**Example:**

```tsx
console.log(view.buffers);
// { selectiveEffect: false, emissive: false, shadow: false, globeNormal: false }
```

:::tip[関連ドキュメント]
`requiredBuffers` や `getRequiredBuffers()` の宣言方法とカスタムエフェクトからの読み取りについては、[カスタム Descriptor: G-Buffer の読み取り](../../../three/core/custom-desc/#g-buffer-の読み取り) を参照してください。
:::

### animation

**Type:** `boolean`

連続アニメーションモードが有効かどうかを取得または設定します。`true` の場合は毎フレームレンダリング、`false` の場合は変更時のみレンダリングします。

**Example:**

```tsx
// 連続レンダリングを有効化
view.animation = true;

// 必要時のみレンダリング（省電力）
view.animation = false;
```

### screenSize

**Type:** `Vector2`

現在のスクリーンサイズをピクセル単位で取得します。

**読み取り専用**

**Example:**

```tsx
const size = view.screenSize;
console.log(`スクリーンサイズ: ${size.x} x ${size.y} ピクセル`);
```

### pixelRatio

**Type:** `number`

現在のデバイスピクセル比率を取得します。

**読み取り専用**

**Example:**

```tsx
const ratio = view.pixelRatio;
console.log(`ピクセル比率: ${ratio}`);
```

### shadowMapViewersEnabled

**Type:** `boolean`

シャドウマップのデバッグビューアが画面に表示されるかどうかを取得または設定します。

**Example:**

```tsx
// シャドウマップのデバッグビューを表示
view.shadowMapViewersEnabled = true;

// デバッグビューを非表示
view.shadowMapViewersEnabled = false;
```

### cacheBytes

**Type:** `number | undefined`

タイルキャッシュのメモリバジェット（バイト単位）を取得または設定します（[`cacheBytes` オプション](../threeview-class#cachebytes)を参照）。ゲッターは解決済みのバジェットを返します（オプション未指定かつ `init()` 前は `undefined`）。実行時に値を下げると、以降の数フレームで保持中のタイルが新しいバジェットまで破棄されます。`undefined` を設定するとバジェット管理が完全に無効化され、ビューから外れたタイルを即座に破棄する元のライフサイクルに戻ります。

**Example:**

```tsx
// 解決済みのバジェットを取得
console.log(`cache budget: ${(view.cacheBytes ?? 0) / 1024 / 1024} MB`);

// 実行時にバジェットを縮小（以降の数フレームでその値まで破棄）
view.cacheBytes = 256 * 1024 * 1024;

// タイルキャッシュのバジェット管理を無効化
view.cacheBytes = undefined;
```

### lodFog

**Type:** getter `LodFogSettings | undefined` / setter `Partial<LodFogSettings>`

LOD fog の設定を取得または設定します（[`lodFog` オプション](../threeview-class#lodfog)を参照）。遠くのタイルを粗いまま保つ、距離ベースの screen-space error 緩和です。ゲッターは解決済みの設定を返します（`init()` 前は `undefined`）。セッターへの部分的な指定は現在の設定にマージされ、次のトラバーサルで新しいカーブによりタイル LOD が再選択されます。

**Example:**

```tsx
// 距離デグレードを強める — 遠くのタイルがより粗くなる
view.lodFog = { density: 2.5e-4, sseFactor: 3.0 };

// 1 フィールドだけ変更。他は現在の値を維持
view.lodFog = { sseFactor: 4.0 };
```

### dynamicSse

**Type:** getter `DynamicSseSettings | undefined` / setter `Partial<DynamicSseSettings>`

Dynamic screen-space error の設定を取得または設定します（[`dynamicSse` オプション](../threeview-class#dynamicsse)を参照）。地表付近で地平線を望むような傾いたビューでは、遠くのタイルに大きな誤差を許容します。ゲッターは解決済みの設定を返します（`init()` 前は `undefined`）。セッターへの部分的な指定は現在の設定にマージされ、次のトラバーサルで新しいカーブによりタイル LOD が再選択されます。

**Example:**

```tsx
// dynamic SSE を無効化
view.dynamicSse = { enabled: false };

// 地平線ビュー向けに緩和の強さを調整
view.dynamicSse = { sseFactor: 16.0, heightFalloff: 0.25 };
```
