---
title: Light Descriptor
description: Light descriptor types for navara_three
sidebar:
  order: 150
---

LightDesc は、3Dシーンの照明を管理するクラス群です。環境光、太陽光、Image-Based Lightingなど、様々な照明手法を提供します。

## ライトが必要になるのはどんなときか

ライティングは**法線を持つ**サーフェスにのみ影響します。法線を持たないサーフェスは一様に（全面が照らされた状態で）シェーディングされ、ライトは一切不要です。一方で、法線を持つサーフェスは、**ライトが1つも存在しないと真っ黒に描画されます**。次のいずれかがシーンに含まれる場合はライトを追加してください:

- 頂点法線を持つメッシュや GLTF モデル
- `requestVertexNormals: true` で読み込んだ `quantized-mesh` 地形
- `hillshade` マテリアルで描画する `raster-dem` 地形

シーン内に法線を持つものが何もない場合は、ライトを完全に省略でき、すべてが一様に照らされて描画されます。

## LightDescriptor Types

navara_three は、様々な照明要件に対応する複数のライトタイプを提供しています：

### [AmbientLightDesc](../../../three_default_descs/light-desc/ambient-light-desc/)

**用途:** シーン全体の環境光
**説明:** すべてのオブジェクトを均等に照らす基本的な環境光。影を作りません。
**主な特徴:**
- シンプルで軽量
- 全方向から均一な照明
- 影なし

**使用例:**
```typescript
import ThreeView, { Color } from "@navaramap/three";
import { AmbientLightDesc } from "@navaramap/three-default-descs";

view.registerLight("ambient", AmbientLightDesc);

view.addLight<AmbientLightDesc>({
  ambient: {
    color: new Color().setHex(0xffffff),
    intensity: 1.0
  }
});
```

### [LightProbeDesc](../../../three_default_descs/light-desc/light-probe-desc/)

**用途:** Image-Based Lighting（IBL）
**説明:** 球面調和関数を使用した事前計算済みの環境照明。リアルな間接照明を実現します。
**主な特徴:**
- 球面調和関数（Spherical Harmonics）による高速計算
- 事前計算されたライティングデータを使用
- 静的な環境照明に最適

**使用例:**
```typescript
import ThreeView from "@navaramap/three";
import { LightProbeDesc } from "@navaramap/three-default-descs";

view.registerLight("lightProbe", LightProbeDesc);

view.addLight<LightProbeDesc>({
  lightProbe: {
    sh: new THREE.SphericalHarmonics3().set(coefficients),
    intensity: 0.05
  }
});
```

### [SkyLightProbeDesc](../../../three_default_descs/light-desc/sky-light-probe-desc/)

**用途:** 動的なスカイライティング
**説明:** 大気散乱シミュレーションと連携した動的な環境照明。太陽の位置に応じて自動更新されます。
**主な特徴:**
- 大気システムと自動連携
- 太陽の位置に追従
- 昼夜で異なる照明を自動計算

**使用例:**
```typescript
import ThreeView from "@navaramap/three";
import { SkyLightProbeDesc } from "@navaramap/three-default-descs";

view.registerLight("skyLightProbe", SkyLightProbeDesc);

view.addLight<SkyLightProbeDesc>({
  skyLightProbe: {
    intensity: 1.0
  }
});
```

### [SunLightDesc](../../../three_default_descs/light-desc/sun-light-desc/)

**用途:** 太陽光と影
**説明:** Cascaded Shadow Maps（CSM）を使用した高品質な太陽光シミュレーション。大気散乱と連携します。
**主な特徴:**
- 高品質なCascaded Shadow Maps
- 大気散乱による動的な色計算
- 詳細な影のパラメータ制御

**使用例:**
```typescript
import ThreeView from "@navaramap/three";
import { SunLightDesc } from "@navaramap/three-default-descs";

view.registerLight("sun", SunLightDesc);

view.addLight<SunLightDesc>({
  sun: {
    intensity: 1.0,
    castShadow: true,
    shadowMapSize: 2048,
    shadowCascadeCount: 4
  }
});
```

## Light Descriptor Types 比較表

| Descriptorタイプ      | 影          | 動的更新 | 大気連携 | 主な用途         | パフォーマンス   |
| --------------------- | ----------- | -------- | -------- | ---------------- | ---------------- |
| **AmbientLightDesc**  | なし        | 手動     | 不要     | 基本的な環境光   | 非常に軽量       |
| **LightProbeDesc**    | なし        | 手動     | 不要     | 静的IBL          | 軽量             |
| **SkyLightProbeDesc** | なし        | 自動     | 必須     | 動的スカイライト | 中程度           |
| **SunLightDesc**      | あり（CSM） | 自動     | デフォルトで必須 | 太陽光と影       | 重い（影使用時） |

## 一般的な使用パターン

### 基本的な照明セットアップ

最もシンプルな照明構成：

```typescript
// AmbientLightDesc が登録済みであること
view.addLight<AmbientLightDesc>({
  ambient: { intensity: 1.0 }
});
```

### 推奨される照明セットアップ

リアルなシーンには、複数のライトを組み合わせます。[three_default_plugin](../../../three_default_plugin/about/) の `DefaultPlugin` を使用すると、すべてのDescriptorが一括登録され、`addDefaultPhotorealScene()` でフォトリアルなシーンを簡単にセットアップできます。

```typescript
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// フォトリアルなシーンを一括セットアップ（SunLight + SkyLightProbe 等を含む）
const layers = plugin.addDefaultPhotorealScene();

// 必要に応じて追加の環境光
view.addLight<AmbientLightDesc>({
  ambient: { intensity: 0.3 }
});
```

### 夜間シーンのセットアップ

夜間シーンには、追加のライトプローブが効果的です：

```typescript
// DefaultPlugin でフォトリアルなシーンをセットアップ
const layers = plugin.addDefaultPhotorealScene();

// 夜間用ライトプローブ（LightProbeDesc は DefaultPlugin で登録済み）
const nightLight = view.addLight<LightProbeDesc>({
  lightProbe: {
    sh: new THREE.SphericalHarmonics3().set(NIGHT_COEFFICIENTS),
    intensity: 0.05
  }
});

// 夜間のみ有効化
view.atmosphere.on("sunChanged", () => {
  const isNight = view.atmosphere.isAtNight(view.camera.positionECEF);
  nightLight.update({ visible: isNight });
});
```

## 注意事項

### パフォーマンス考慮事項

- **AmbientLight**: 最も軽量、常に有効化可能
- **LightProbe/SkyLightProbe**: 中程度、シェーダー計算が追加される
- **SunLight with CSM**: 最も重い、特に高解像度シャドウマップ使用時

### 大気システムとの連携

以下のライトは大気システムと連携します：

- **SkyLightProbeDesc**: 大気の放射照度テクスチャを使用（必須）
- **SunLightDesc**: 大気の透過テクスチャを使用（デフォルトで必須）

デフォルトの`applyColor: false`では、SunLightDescは大気の透過テクスチャから太陽の色を計算します。そのテクスチャが利用できない場合、太陽は黒くレンダリングされます。設定した色をそのまま使う場合は`applyColor: true`を指定してください。

### 大気システムを使わないライティング

SunLightDescは大気システムなしでも動作し、指向性のあるシェーディングとCSMの影を維持します。`applyColor: true`を指定すると設定した色がそのまま使われ、`intensity`に`Math.PI`を指定すると拡散BRDFの1/πの係数が打ち消されます。

```typescript
view.addLight({ sun: { applyColor: true, intensity: Math.PI } });
```

AmbientLightDescとLightProbeDescも大気システムなしで動作します。

## 関連リソース

- [Materials](../../../three/material/about/) - リソースレイヤーの詳細
- [Effect Descriptor Reference](../../../three_default_descs/effect-desc/about/) - エフェクト
- [API Reference](../../../three/api/) - ThreeView API
