---
title: ToneMappingEffectDesc
description: Tone mapping effect descriptor for navara_three
sidebar:
  order: 62
---

`ToneMappingEffectDesc`クラスは、トーンマッピングエフェクトを適用するDescriptorです。HDR(High Dynamic Range)からLDR(Low Dynamic Range)への色調整を行い、画面に表示可能な範囲に変換します。

## Properties

### visible

**Type:** `boolean | undefined`

**Description:** エフェクトの表示/非表示を制御します。

**Default:** `true`

### mode

**Type:** `ToneMappingMode | undefined`

**Description:** トーンマッピングのモードを指定します。利用可能なモードには、AGX、ACES_FILMIC、NEUTRAL、LINEAR、REINHARD、REINHARD2、UNREALなどがあります。AGX と ACES_FILMIC はフィルム調のコントラストカーブになります。NEUTRAL はベースマップ本来の色を保ちハイライトだけを丸めるので、見た目を保ちたい画像タイルに向きます。

**Default:** `ToneMappingMode.AGX`

**Example:**

```typescript
{
  toneMapping: {
    mode: ToneMappingMode.ACES_FILMIC,
  }
}
```

## Usage Examples

### デフォルトエフェクトでトーンマッピングを使用

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// デフォルトのフォトリアルオブジェクトを追加（ToneMappingEffectDescを含む）
const defaultLayers = plugin.addDefaultPhotorealScene();

// 露出を設定
view.toneMappingExposure = 10;
```

### 異なるトーンマッピングモードの使用

```typescript
import ThreeView from "@navaramap/three";
import { ToneMappingEffectDesc, ToneMappingMode } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// AGXモード（デフォルト、バランスの取れた結果）
view.addEffect<ToneMappingEffectDesc>({
  toneMapping: {
    mode: ToneMappingMode.AGX,
  },
});

// または、ACES Filmicモード（映画的な外観）
view.addEffect<ToneMappingEffectDesc>({
  toneMapping: {
    mode: ToneMappingMode.ACES_FILMIC,
  },
});

// Reinhardモード
view.addEffect<ToneMappingEffectDesc>({
  toneMapping: {
    mode: ToneMappingMode.REINHARD,
  },
});
```

### 露出調整と組み合わせた使用

```typescript
import ThreeView from "@navaramap/three";
import { ToneMappingMode } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

const defaultLayers = plugin.addDefaultPhotorealScene();

// トーンマッピングを有効化
defaultLayers.toneMapping.update({
  visible: true,
  toneMapping: {
    mode: ToneMappingMode.AGX,
  },
});

// 露出を調整（明るいシーン）
view.toneMappingExposure = 15;

// 露出を調整（暗いシーン）
view.toneMappingExposure = 5;
```

### 個別にトーンマッピングDescriptorを追加

```typescript
import ThreeView from "@navaramap/three";
import { ToneMappingEffectDesc, SMAAEffectDesc, ToneMappingMode } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

view.toneMappingExposure = 3;

// トーンマッピングエフェクトを追加
view.addEffect<ToneMappingEffectDesc>({
  toneMapping: {
    mode: ToneMappingMode.NEUTRAL,
  },
});

// SMAAエフェクトを追加（トーンマッピングの後に適用）
view.addEffect<SMAAEffectDesc>({
  smaa: {},
});
```

## 露出の選び方

`view.toneMappingExposure` はカーブを適用する前の HDR フレームを倍率で調整するため、適切な値はライティングだけでなくベースマップの明るさに依存します。衛星画像のような暗めのタイルなら `10` 前後、明るい地図スタイルのタイルなら `3` 前後が目安です。その露出を `NEUTRAL` のようなモードと組み合わせると、タイルの明るさが画面全体で均一に保たれ、フィルム調のカーブで暗いタイルが潰れたり明るいタイルが飛んだりせずに綺麗に見えます。

```typescript
const layers = plugin.addDefaultPhotorealScene({ deferredLighting: true });
layers.toneMapping.update({ toneMapping: { mode: ToneMappingMode.NEUTRAL } });
view.toneMappingExposure = 10; // 衛星画像の場合。明るいスタイルなら 3 前後
```

## 備考

適切なトーンマッピングを適用することで、HDRレンダリングの結果を視覚的に魅力的な画像に変換できます。AGXモードはデフォルトで使用され、バランスの取れた結果を提供します。`view.toneMappingExposure`で露出を調整できます。
