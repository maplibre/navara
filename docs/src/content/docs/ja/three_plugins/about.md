---
title: About
description: three_plugins の概要と特徴について説明します。
sidebar:
  order: 1
---

## three_plugins とは

`three_plugins` は、`navara_three` 向けのユースケース特化型プラグインのコレクションです。コアライブラリが `Plugin` 基底クラスを提供し、`three_default_plugin` が Descriptor の一括登録を担うのに対して、`three_plugins` は特定のユースケースをすぐに解決できる高レベルなプラグインを提供します。

## 他パッケージとの関係

```text
navara_three（コア: ThreeView, Plugin, addPlugin）
  ├── three_default_descs（Descriptor の実装）
  ├── three_default_plugin（DefaultPlugin: Descriptor の一括登録）
  └── three_plugins（ユースケース特化型プラグイン）
        ├── PersonViewPlugin（キーボード操作による一人称 / 三人称ビューコントローラー）
        ├── OverlayPlugin（ワールド座標からスクリーン座標への HTML オーバーレイ投影）
        ├── CesiumIonPlugin（Cesium Ion quantized-mesh 地形）
        ├── TileJsonPlugin（TileJSON 3.0.0 タイルソースの登録）
        └── StreetLightsPlugin（夜の街灯・屋上灯・車）
```

`three_plugins` は `Plugin` 基底クラスとコア API のために `navara_three` に依存し、`DefaultDescriptions` 型のために `three_default_plugin` に依存しています。各プラグインは独立しており、片方だけを使うこともできます。

## インストール

```typescript
import {
  PersonViewPlugin,
  OverlayPlugin,
  CesiumIonPlugin,
  TileJsonPlugin,
  StreetLightsPlugin,
  moveOverlayElement,
} from "@navaramap/three-plugins";
```

## 提供プラグイン

### PersonViewPlugin

キーボード操作の一人称 / 三人称ビューコントローラーです。WASD / 矢印キーで地球上の仮想位置を駆動し、追従カメラ（TPV）または一人称カメラ（FPV）で追います。任意で GLTF キャラクターをアタッチでき、アイドルとダッシュの 2 クリップをクロスフェードします。詳細は [PersonViewPlugin](../personviewplugin/) を参照してください。

### OverlayPlugin

毎フレーム、地理座標（緯度/経度/高度）をスクリーン座標に投影するプラグインです。ワールド座標に追従する HTML オーバーレイ（マーカー、ラベル、ツールチップなど）を実現します。詳細は [OverlayPlugin](../overlayplugin/) を参照してください。

### CesiumIonPlugin

`init()` 時に Cesium Ion のアセットエンドポイントを解決し、`addTerrain()` を通じて quantized-mesh 地形レイヤーとして登録するプラグインです。詳細は [CesiumIonPlugin](../cesiumionplugin/) を参照してください。

### TileJsonPlugin

TileJSON 3.0.0 ドキュメントを取得し、`addSource()` を通じて単一のラスター・ベクトル・raster-DEM（標高）タイルソースとして登録するプラグインです。タイル URL、ズーム範囲、スキーム、アトリビューション、そして raster-DEM では MapLibre 互換の `tileSize` / `encoding` をドキュメントから導出します。詳細は [TileJsonPlugin](../tilejsonplugin/) を参照してください。

### StreetLightsPlugin

OpenMapTiles スキーマのベクトルタイルセットのズーム 14 のタイルを位置の周辺にストリーミングし、道路に沿った街灯、高いビルの屋上の赤い灯、道路の区間を走る車を、`addRoads()` で描いた暗い路面の上に配置するプラグインです。街灯と屋上灯は `start()` に渡した Selective Effect（組み込みの Bloom など）に参加します。詳細は [StreetLightsPlugin](../streetlightsplugin/) を参照してください。

## 使い方

すべてのプラグインは標準的なプラグインのライフサイクルに従います。インスタンスを作成し、`view.init()` の前に `view.addPlugin()` で登録し、初期化後にプラグイン固有のメソッドを使用します。

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { PersonViewPlugin, OverlayPlugin } from "@navaramap/three-plugins";

const view = new ThreeView({ container, animation: true });

const defaultPlugin = new DefaultPlugin();
const personView = new PersonViewPlugin({
  character: {
    modelUrl: "/glTF/bird/scene.gltf",
    animation: {
      idleClip: "Gliding",
      dashClip: "Flapping",
      speed: 1.0,
      crossfadeDuration: 0.3,
    },
  },
});
const overlay = new OverlayPlugin({ maxDistance: 100_000 });

view.addPlugin(defaultPlugin);
view.addPlugin(personView);
view.addPlugin(overlay);

await view.init();

personView.start();
```

## 関連リソース

- [About Plugin](../../three/introduction/about-plugin/): プラグインシステムの概念
- [Plugin API](../../three/core/plugin/): プラグインの実装方法
- [three_default_plugin](../../three_default_plugin/about/): DefaultPlugin の詳細
