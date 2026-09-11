---
title: Effect Descriptor
description: Effect descriptor types for navara_three
sidebar:
  order: 50
---

`EffectDesc`は、レンダリングパイプラインにポストプロセッシングエフェクトを適用するためのDescriptorタイプです。アンチエイリアシング、被写界深度、トーンマッピングなど、様々なビジュアルエフェクトを追加できます。

:::note
このページでは `@navaramap/three-default-descs` が提供するエフェクトを扱います。レンダリングパイプラインと密結合した一部のエフェクト（`SkyEnvMapEffectDesc` など）は `@navaramap/three` コアに含まれます。[Effect Descriptor（three コア）](../../../three/effect-desc/about/) を参照してください。
:::

## 利用可能なEffectDescタイプ

navara_threeでは、以下のEffectDescタイプが利用可能です:

| Descriptorタイプ | 説明 |
|------------|------|
| [AerialPerspectiveEffectDesc](../aerial-perspective-effect-desc) | 大気による光の散乱と透過を表現するエフェクト |
| [CloudsEffectDesc](../clouds-effect-desc) | リアルタイムボリュメトリック雲をレンダリングするエフェクト |
| [ColorGradingLUTEffectDesc](../color-grading-lut-effect-desc) | LUTを使用したカラーグレーディングを適用するエフェクト |
| [DepthOfFieldEffectDesc](../depth-of-field-effect-desc) | カメラの焦点面に基づいてボケ効果を適用するエフェクト |
| [FogLightEffectDesc](../fog-light-effect-desc) | ポイントライトからのボリュメトリックフォグを生成するエフェクト |
| [FXAAEffectDesc](../fxaa-effect-desc) | FXAA(Fast Approximate Anti-Aliasing)を適用するエフェクト |
| [LensFlareEffectDesc](../lens-flare-effect-desc) | 太陽や月からのレンズフレアを生成するエフェクト |
| [RainDropEffectDesc](../rain-drop-effect-desc) | 画面に雨粒の屈折効果を適用するエフェクト |
| [SelectiveBloomEffectDesc](../selective-bloom-effect-desc) | Selective Bloom を適用するエフェクト |
| [SelectiveOutlineEffectDesc](../selective-outline-effect-desc) | Selective Outline を適用するエフェクト |
| [SMAAEffectDesc](../smaa-effect-desc) | SMAA(Subpixel Morphological Anti-Aliasing)を適用するエフェクト |
| [SSAOEffectDesc](../ssao-effect-desc) | スクリーンスペースアンビエントオクルージョンを適用するエフェクト |
| [SSREffectDesc](../ssr-effect-desc) | リアルタイムスクリーンスペース反射を生成するエフェクト |
| [ToneMappingEffectDesc](../tone-mapping-effect-desc) | HDRからLDRへの色調整を行うエフェクト |

## 基本的な使い方

EffectDescは、Descriptorクラスを登録した後、`view.addEffect()`メソッドで追加します:

```typescript
import ThreeView from "@navaramap/three";
import { AerialPerspectiveEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();

// Descriptorクラスを登録
view.registerEffect("aerialPerspective", AerialPerspectiveEffectDesc);

await view.init();

const aerialPerspectiveDesc = view.addEffect<AerialPerspectiveEffectDesc>({
  aerialPerspective: {},
});
```

## 共通プロパティ

すべてのEffectDescは、以下の基本設定を持ちます:

- `id`: オブジェクトの一意な識別子
- `visible`: オブジェクトの表示/非表示を切り替え

詳細な使用方法は、各Descriptorタイプのドキュメントを参照してください。
