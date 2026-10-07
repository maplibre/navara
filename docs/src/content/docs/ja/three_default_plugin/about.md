---
title: About
description: three_default_plugin の概要と特徴について説明します。
sidebar:
  order: 1
---

## What is three_default_plugin?

`three_default_plugin` は、`navara_three` の `Plugin` システムを利用して、`three_default_descs` が提供するすべてのDescriptorを `ThreeView` に一括登録するプラグインです。`DefaultPlugin` クラスを `view.addPlugin()` で追加するだけで、メッシュ・エフェクト・ライトの全Descriptorが利用可能になります。

## navara_three / three_default_descs との関係

```
navara_three（コア: ThreeView, Plugin, addPlugin, registerMesh/Effect/Light）
  ├── three_default_descs（Descriptorの実装: 22 メッシュ, 14 エフェクト, 4 ライト）
  └── three_default_plugin（DefaultPlugin: Descriptorの一括登録 + ユーティリティ）
```

`navara_three` はDescriptorの登録・管理の仕組み（`registerMesh`, `registerEffect`, `registerLight`）を提供します。`three_default_descs` は個々のDescriptorクラスの実装を提供します。`three_default_plugin` はこれらを橋渡しし、すべてのデフォルトDescriptorを `ThreeView` に登録します。

## 使い方

### 基本的なセットアップ

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const plugin = new DefaultPlugin();
const view = new ThreeView();

// init() の前にプラグインを追加
view.addPlugin(plugin);
await view.init({ canvas: document.getElementById("canvas") });
```

プラグインの `init()` で以下のDescriptorが自動的に登録されます：

**メッシュ（24 種）:** `rain`, `snow`, `sky`, `skyBox`, `stars`, `box`, `sphere`, `glowGlobe`, `cylinder`, `tube`, `plane`, `gltfModel`, `splat`, `axesHelper`, `arrowHelper`, `arcLines`, `polygon`, `polyline`, `smoothLines`, `boxes`, `spheres`, `planes`, `cylinders`, `gltfModels`

**エフェクト（14 種）:** `aerialPerspective`, `rainDrop`, `selectiveBloom`, `selectiveOutline`, `clouds`, `fogLight`, `lensFlare`, `ssao`, `ssr`, `depthOfField`, `colorGradingLUT`, `toneMapping`, `smaa`, `fxaa`

**ライト（4 種）:** `sun`, `ambient`, `skyLightProbe`, `lightProbe`

### addDefaultPhotorealScene()

`DefaultPlugin` は、フォトリアルな 3D 地図シーンを簡単に構築するための `addDefaultPhotorealScene()` メソッドを提供します。`view.init()` の後に呼び出すことで、空、星、太陽光、大気エフェクトなどが自動的に追加されます。

```typescript
const plugin = new DefaultPlugin();
const view = new ThreeView();
view.addPlugin(plugin);
await view.init({ canvas: document.getElementById("canvas") });

// フォトリアルなシーンを一括セットアップ
const layers = plugin.addDefaultPhotorealScene();
// layers.sky, layers.sun, layers.aerialPerspective, ... が返される
```

追加されるオブジェクト：

| オブジェクト        | 種別   | 説明                                   |
| ------------------- | ------ | -------------------------------------- |
| `sky`               | mesh   | 空の描画                               |
| `stars`             | mesh   | 星の描画                               |
| `skyLightProbe`     | light  | 空に基づく環境光                       |
| `sun`               | light  | 太陽光                                 |
| `aerialPerspective` | effect | 大気遠近法エフェクト                   |
| `lensFlare`         | effect | レンズフレア（デスクトップのみ）       |
| `toneMapping`       | effect | トーンマッピング                       |
| `antialiasing`      | effect | SMAA（デスクトップ）/ FXAA（モバイル） |

モバイル環境では、パフォーマンスのためにレンズフレアがスキップされ、アンチエイリアスに軽量な FXAA が使用されます。

### ディファードライティング

`deferredLighting: true` を渡すと、フォワードパスの代わりに大気がポストプロセスでシーンをライティングします。大気遠近法の [`irradiance`](../../three_default_descs/effect-desc/aerial-perspective-effect-desc/#irradiance) オプションを有効にし、同時に [`view.lit = false`](../../three/api/threeview-properties/#lit) を設定します。そうしないとフォワードパスと大気でライティングが二重に適用されてしまうためです。雲の影にはこの経路が必要です。透明なマテリアルには届かず、`lit: true` を指定したメッシュやマテリアルはフォワードのシェーディングを保ちます。

`shadow: true` と `specular: true` は、大気遠近法の [`shadow`](../../three_default_descs/effect-desc/aerial-perspective-effect-desc/#shadow) と [`specular`](../../three_default_descs/effect-desc/aerial-perspective-effect-desc/#specular) オプションを通して、このライティングでの太陽の影と鏡面ハイライトを有効にします。どちらも `deferredLighting` なしでは何もしません。調整は戻り値の `aerialPerspective` ハンドルから行えます。

```typescript
const layers = plugin.addDefaultPhotorealScene({
  deferredLighting: true,
  shadow: true,
  specular: true,
});
```

このシーンに合う露出はベースマップに依存します。トーンマッピングのページの[露出の選び方](../../three_default_descs/effect-desc/tone-mapping-effect-desc/#露出の選び方)を参照してください。
