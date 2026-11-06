---
title: ThreeView Class
description: API Reference for ThreeView Class Overview and Constructor
sidebar:
  order: 910
---

ThreeView は、Three.js と WebGL を使用して 3D マップビジュアライゼーションを作成・管理するためのメインクラスです。レイヤー管理、カメラ制御、レンダリング、イベント処理のための包括的な API を提供します。

## Example

```tsx
import ThreeView, { JAPAN_GSI_ELEVATION_DECODER } from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Vector3 } from "three";

// Create ThreeView instance
const view = new ThreeView({
  shadow: true,
  animation: true,
  backgroundColor: 0x0a0a0f,
  logarithmicDepthBuffer: true,
});
const plugin = new DefaultPlugin();
view.addPlugin(plugin);

// Initialize the view
await view.init();

// Add default photorealistic layers (sky, stars, sun, light probe)
const defaultLayers = plugin.addDefaultPhotorealScene();

// Add terrain layer
const terrainSource = view.addSource({
  type: "raster-dem",
  url: "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png",
  elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  maxZoom: 15,
  minZoom: 5,
});
view.addLayer({
  type: "terrain",
  source: terrainSource,
  terrain: {
    castShadow: true,
    receiveShadow: true,
  },
});

// Add hillshade layer
const hillshadeSource = view.addSource({
  type: "raster-dem",
  // Credit:
  // - Geospatial Information Authority of Japan Tiles - Digital Elevation Map
  //   https://maps.gsi.go.jp/development/ichiran.html
  url: "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png",
  elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  minZoom: 6,
  maxZoom: 15,
});
view.addLayer({
  type: "raster",
  source: hillshadeSource,
  hillshade: {},
});

// Add raster tile layer
const rasterSource = view.addSource({
  type: "raster-tile",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  maxZoom: 23,
});
view.addLayer({
  type: "raster",
  source: rasterSource,
  raster: {
    color: new Color().setHex(0xffffff),
    opacity: 1,
  },
});

// Set camera position
view.setCamera({
  lng: 139.7,
  lat: 35.7,
  height: 1000,
  pitch: -45,
  heading: 0,
  roll: 0,
});
```

## Properties

### container

**Type:** `HTMLElement | undefined`

**Description:** ビューをレンダリングする HTML コンテナ要素。指定された場合、ThreeView はこのコンテナ内に canvas を追加します。

**Example:**

```typescript
const view = new ThreeView({
  container: document.getElementById("map") ?? undefined,
});
```

### canvas

**Type:** `HTMLCanvasElement | OffscreenCanvas | undefined`

**Description:** レンダリングに使用する canvas 要素。指定された場合、この canvas を使用します。指定しない場合は新しい canvas が作成されます。

**Example:**

```typescript
const view = new ThreeView({
  canvas: document.getElementById("canvas") as HTMLCanvasElement,
});
```

### pixelRatio

**Type:** `number | undefined`

**Description:** デバイスピクセル比率のオーバーライド。高 DPI ディスプレイでのレンダリング品質に影響します。指定しない場合はデバイスのデフォルト値を使用します。

**Example:**

```typescript
const view = new ThreeView({
  pixelRatio: 2,
});
```

### disableAutoResize

**Type:** `boolean | undefined`

**Description:** ウィンドウリサイズイベント時の自動リサイズ処理を無効にするかどうか。`true` の場合、ウィンドウサイズの変更時に自動的にリサイズされません。

**Default:** `false`

**Example:**

```typescript
const view = new ThreeView({
  disableAutoResize: true,
});
```

### debug

**Type:** `boolean | undefined`

**Description:** デバッグモードを有効にするかどうか。`true` の場合、パフォーマンス統計オーバーレイなどの追加デバッグ情報が表示されます。

**Default:** `false`

**Example:**

```typescript
const view = new ThreeView({
  debug: true,
});
```

### atmosphere

**Type:** `AtmosphereOptions | undefined`

**Description:** 大気レンダリングの設定オプション。空、太陽、大気散乱効果の設定を行います。`date` プロパティで指定した日時に基づいて太陽と月の位置が自動計算され、`SunLightDesc` などの関連 Descriptor に反映されます。

```typescript
export type AtmosphereOptions = {
  atmosphereAssetsUrl?: string; // 大気アセットファイルの URL
  stbnUrl?: string; // STBNテクスチャの URL
  date?: Date; // 太陽・月の位置計算に使用する日時
};
```

**Example:**

```typescript
const view = new ThreeView({
  atmosphere: {
    atmosphereAssetsUrl: "/assets/atmosphere",
    date: new Date("2024-06-21T12:00:00"),
  },
});

// 初期化後に日時を変更可能
await view.init();
view.atmosphere.date = new Date("2024-12-21T18:00:00");
```

:::tip[関連ドキュメント]
大気システムの詳細については [Atmosphere クラス](../../../three/api/atmosphere/) を参照してください。
:::

### backgroundColor

**Type:** `Color | undefined`

**Description:** シーンの背景色。`Color` クラスのインスタンスを指定します。

**Default:** `0x0a0a0f`（暗い青灰色）

**Example:**

```typescript
import ThreeView, { Color } from "@navaramap/three";

const view = new ThreeView({
  backgroundColor: new Color().setHex(0x1a1a2e),
});
```

:::note
コンストラクタでは数値（16進数カラーコード）を直接渡すことも可能ですが、内部的には `Color` オブジェクトとして処理されます。
:::

### picking

**Type:** `boolean | undefined`

**Description:** 地物ピッキングの設定オプション。有効にすると、地物のクリックまたはタップで `featureClick` イベントが、ポインタのホバーで `featureHover`・`featureEnter`・`featureLeave` イベントが発火します。

**Default:** `true`

**Example:**

```typescript
const view = new ThreeView({
  picking: true,
});

// featureClick イベントを監視
view.on("featureClick", (info) => {
  if (info) {
    console.log("選択された地物:", info.properties);
  }
});
```

### animation

**Type:** `boolean | undefined`

**Description:** メインループを毎フレーム実行するかどうか。`true` の場合、連続的にレンダリングされます。`false` の場合、変更時または `forceUpdate()` が呼び出されたときのみレンダリングされます。

**Default:** `false`

**Example:**

```typescript
const view = new ThreeView({
  animation: true,
});
```

### multisampling

**Type:** `number | undefined`

**Description:** MSAA（マルチサンプル・アンチエイリアシング）のサンプル数。0 の場合は MSAA が無効になります。パフォーマンスへの影響があるため、使用する場合は注意が必要です。

**Default:** `0`

**Example:**

```typescript
const view = new ThreeView({
  multisampling: 4,
});
```

### halfFloat

**Type:** `boolean | undefined`

**Description:** ポストプロセッシングに半精度浮動小数点数（half-float）を使用するかどうか。`true` の場合、レンダリング品質が向上します。

**Default:** `true`

**Example:**

```typescript
const view = new ThreeView({
  halfFloat: true,
});
```

### logarithmicDepthBuffer

**Type:** `boolean | undefined`

**Description:** 対数深度バッファを使用するかどうか。`true` の場合、大規模なスケールでの深度精度が向上します。一部のエフェクトはこれをサポートしていないため、そのような場合は `false` に設定する必要があります。

**Default:** `true`

**Example:**

```typescript
const view = new ThreeView({
  logarithmicDepthBuffer: true,
});
```

### shadow

**Type:** `boolean | undefined`

**Description:** シャドウマッピングを有効にするかどうか。初期化時に指定する必要があり、後から変更することはできません。

**Default:** `false`

**Example:**

```typescript
const view = new ThreeView({
  shadow: true,
});
```

### idleThreshold

**Type:** `number | undefined`

**Description:** `idle` イベントが発火するまでに必要な、データやタイル処理が途絶えた時間（ミリ秒）。常時実行されるアニメーションやエフェクトはアクティビティとして扱われません。値を小さくするとアイドル状態の検出が早くなり、大きくすると長い静止期間が続くまで通知を遅延させます。

**Default:** `100`

**Example:**

```typescript
const view = new ThreeView({
  idleThreshold: 200,
});

view.on("idle", () => {
  console.log("エンジンが 200 ms アイドル状態になりました");
});
```

:::tip[関連ドキュメント]
このイベントが発火するタイミングの詳細は [`idle` イベント](../threeview-events#idle) を参照してください。
:::

### mobileOptimization

**Type:** `boolean | undefined`

**Description:** モバイルデバイス向けの最適化を有効にするかどうか。`true` の場合、低いピクセル比率やエフェクトの軽量化など、モバイルデバイスに適した設定が適用されます。

**Default:** デバイスから自動検出されます（モバイルデバイスは自動的に最適化されます）。検出結果を上書きしたい場合は明示的に指定してください。

**Example:**

```typescript
const view = new ThreeView({
  mobileOptimization: true,
});
```

### cacheBytes

**Type:** `number | undefined`

**Description:** タイルキャッシュ（WASM バッファ + 推定 GPU コスト）のメモリバジェット（バイト単位）。ビューから外れたタイルはバジェットを超えるまで保持され、超過すると最も長く訪問されていないものから順に破棄されます。パンで戻った際は再フェッチなしで再表示され、合計使用量は上限内に保たれます。

**Default:** デバイス依存。デスクトップ: 報告されたデバイスメモリの 1/4（上限 2 GB）、モバイル: 512 MB（デバイスが 4 GB 未満と報告する場合は 256 MB）。`getDefaultCacheBytes()` を参照してください。

**Example:**

```typescript
const view = new ThreeView({
  cacheBytes: 512 * 1024 * 1024, // 512 MB
});
```

:::tip[関連ドキュメント]
実行時にも [`cacheBytes` プロパティ](../threeview-properties#cachebytes)で変更できます。
:::

### lodFog

**Type:** `Partial<LodFogSettings> | undefined`

**Description:** LOD fog: タイルの LOD 選択で使用される、距離ベースの screen-space error 緩和です。遠くのタイルほど大きな誤差が許容されて粗いまま維持され、近くのタイルはフル解像度を保ちます。純粋な LOD 制御であり、視覚的なフォグ描画には一切影響しません。部分的な指定はデバイスデフォルトにマージされます。

```typescript
type LodFogSettings = {
  enabled: boolean;
  // 緩和カーブの距離スケール（2.0e-4 ≈ 5km 地点で強度 63%）
  density: number;
  // 遠距離での最大 SSE 緩和量（ピクセル単位）
  sseFactor: number;
};
```

**Default:** デバイスメモリ依存。デスクトップ: `{ density: 2.0e-4, sseFactor: 2.0 }`。低メモリデバイスではタイルのワーキングセットを小さく保つため、より強いカーブが適用されます。`getDefaultLodFog()` を参照してください。

**Example:**

```typescript
const view = new ThreeView({
  lodFog: { density: 2.5e-4, sseFactor: 3.0 },
});
```

### dynamicSse

**Type:** `Partial<DynamicSseSettings> | undefined`

**Description:** Dynamic screen-space error（CesiumJS の `dynamicScreenSpaceError` 相当）: 地表付近で地平線を望むような傾いたビューでは遠くのタイルに大きな誤差を許容し、過剰に細分化されがちなビューでちょうどタイルのワーキングセットを削減します。真下を見ている場合は効果ゼロで、カメラが `maxHeight` メートルを超えて上昇するにつれてフェードアウトします。部分的な指定はデフォルトにマージされます。

```typescript
type DynamicSseSettings = {
  enabled: boolean;
  // 傾き・高度スケーリング前の緩和カーブの距離スケール
  density: number;
  // 最大傾き・飽和時の最大 SSE 緩和量（ピクセル単位）
  sseFactor: number;
  // 効果がフル強度になる高度バンドの割合
  heightFalloff: number;
  // 効果がフェードするカメラ高度バンド（楕円体上のメートル）
  minHeight: number;
  maxHeight: number;
};
```

**Default:** `{ enabled: true, density: 2.0e-4, sseFactor: 24.0, heightFalloff: 0.25, minHeight: 0, maxHeight: 8000 }`。`getDefaultDynamicSse()` を参照してください。

**Example:**

```typescript
const view = new ThreeView({
  dynamicSse: { sseFactor: 16.0, maxHeight: 4000 },
});
```

### workerPoolSize

**Type:** `number | undefined`

**Description:** タイルのデコードとメッシュ構築を行うバックグラウンドワーカーの数。各ワーカーは JavaScript エンジンのインスタンスと WebAssembly ヒープを個別に持つため、プールを小さくするとメモリ使用量が減りますが、カメラを素早く動かした後のタイル読み込みは遅くなります。値は `1` から `navigator.hardwareConcurrency` の範囲に制限されます。明示的に指定した値は `mobileOptimization` 有効時にも適用されます。`navigator.deviceMemory` を報告するデスクトップブラウザでは、`memoryBudget.maxWorkerHeapBytes` のデフォルトはプールが大きいほど小さくなります。それ以外の環境ではワーカーごとに固定値のため、プールを大きくするとワーカーのピークメモリが増えます。

**Default:** `navigator.hardwareConcurrency`（`mobileOptimization` 有効時は最大 `2`）

**Example:**

```typescript
const view = new ThreeView({
  workerPoolSize: 4,
});
```

### memoryBudget

**Type:** `object | undefined`

**Description:** ワーカー側メモリバジェットとメモリ圧 LOD デグレードの上書き設定。デフォルトはデバイスメモリと `cacheBytes` から導出されます。`getDefaultMemoryBudgets()` を参照してください。

```typescript
type MemoryBudgetOptions = {
  // タイルワーカーごとの WASM ヒープバジェット。超過するとプールがワーカーをリサイクルします
  maxWorkerHeapBytes?: number;
  // フォントワーカーのキャッシュバジェット（フォントデータ + アトラスピクセル。以降の増加を抑制）
  fontBudgetBytes?: number;
  // タイルパイプラインごとの同時フェッチ数上限
  maxPendingRequests?: number;
  // 安静時（ベース）のメモリ圧 SSE 乗数。1 より大きいと圧がなくても遠くのタイルが粗くなります
  sseMultiplierMin?: number;
  // 動的なメモリ圧 SSE デグレードが到達できる上限
  sseMultiplierMax?: number;
};
```

**Example:**

```typescript
const view = new ThreeView({
  memoryBudget: {
    maxWorkerHeapBytes: 128 * 1024 * 1024,
    sseMultiplierMin: 1.0,
    sseMultiplierMax: 8.0,
  },
});
```

:::tip[関連ドキュメント]
SSE 乗数の範囲は実行時にも [`setSseMultiplierRange()`](../threeview-functions#setssemultiplierrange) で変更できます。
:::

### GlobeOptions

**Type:** `GlobeOptions`

**Description:** 地球表示に関する追加オプション。ThreeView のコンストラクタオプションは GlobeOptions を継承しています。

```typescript
type GlobeOptions = {
  maxSse?: number; // LOD 計算のためのスクリーンスペースエラー閾値（初期化時のみ）
  segments?: number; // メッシュテッセレーションのセグメント数（初期化時のみ）
  color?: Color; // 地球表面の基本色
  hideUnderground?: boolean; // 地下のジオメトリを非表示にするかどうか
  shouldComputeNormalFromVertex?: boolean; // 頂点位置から法線を計算するかどうか（初期化時のみ）
  transparent?: boolean; // マテリアルを透明にするかどうか
  opacity?: number; // マテリアルのグローバル不透明度（0.0〜1.0）
  wireframe?: boolean; // ワイヤーフレームモードでレンダリングするかどうか
};
```

:::warning
`hideUnderground` を無効にすると、エフェクトによっては予期しない動作が発生する可能性があります。
:::

:::tip[関連ドキュメント]
各プロパティの詳細と使用例は [Globe クラス](../../../three/api/globe/) を参照してください。
:::

**Example:**

```typescript
import ThreeView, { Color } from "@navaramap/three";

const view = new ThreeView({
  maxSse: 1,
  segments: 10,
  color: new Color().setHex(0x1a1a2e),
  hideUnderground: true,
  wireframe: false,
});
```
