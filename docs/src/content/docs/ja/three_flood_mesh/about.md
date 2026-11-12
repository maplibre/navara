---
title: About
description: 洪水シミュレーションの出力から時系列の洪水の水面を Navara で描画する
sidebar:
  order: 1
since: nightly
---

## three_flood_mesh とは

`@navaramap/three-flood-mesh` は、洪水や津波のシミュレーション結果のように時間とともに変化する水面を、Navara の 3D 地球儀上に描画します。次のものを提供します。

- **`TimeSeriesFloodMeshDesc`**: [Zarr](https://zarr.dev/) ストアから読んだ水面の高さの時系列を再生するメッシュ Descriptor。Navara の水として描くか、浸水深や流速のようなプロパティで色分けします。
- **時系列の関数**: 時系列を読み込む `loadTimeSeriesFlood`、地点の水を読む `sampleTimeSeriesFlood`、時刻とフレームを相互に変換する `timeToFrame` / `frameToTime`。
- **変換関数**: シミュレーションの出力（CSV、netCDF、CZML）から Zarr グループを書き出す `@navaramap/three-flood-mesh/convert` エントリーと `navara-flood-zarr` コマンド。

動作は [サンプル](https://navara.world/navara-three-flood-mesh/) で確認できます。

## インストール

`@navaramap/three-flood-mesh` は [nightly ビルド](../../three/introduction/install/#nightly-ビルド) でのみ公開されています。同じ nightly ビルドの `@navaramap/three` が必要なので、両方を `nightly` dist-tag からインストールします。

```bash
npm install @navaramap/three@nightly @navaramap/three-flood-mesh@nightly
```

## クイックスタート

```typescript
import ThreeView from "@navaramap/three";
import { TimeSeriesFloodMeshDesc } from "@navaramap/three-flood-mesh";

const view = new ThreeView({ animation: true });
await view.init();
view.registerMesh("timeSeriesFlood", TimeSeriesFloodMeshDesc);

const water = view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { url: "https://example.com/flood.zarr", frame: 0 },
});
```

再生、色分け、読み込みのレシピは [使用例](../usage-examples/) を参照してください。

## 他のパッケージとの関係

```text
@navaramap/three (core: ThreeView, MeshDesc)
  └── @navaramap/three-flood-mesh
        ├── TimeSeriesFloodMeshDesc, loadTimeSeriesFlood (browser entry)
        └── convertRasters, convertMesh, convertPolygons (/convert entry, browsers and Node)
```

`/convert` エントリーと `navara-flood-zarr` コマンドは、`three` も `@navaramap/three` も必要ありません。

## AI コーディングエージェントとの開発

このパッケージには、Claude Code などの AI コーディングエージェント向けの [navara-flood-mesh スキル](https://github.com/reearth/navara/tree/main/web/experimental/navara_three_flood_mesh/skills/navara-flood-mesh) が同梱されています。入力の確認、変換関数の選択と設定ファイルの作成、レポートの読み方、Zarr グループの配信、`TimeSeriesFloodMeshDesc` での再生と色分けまで、シミュレーション結果からビューアーまでの手順をエージェントに示します。シーンのそれ以外の部分は `@navaramap/three` の navara-usage スキルに従います（[AI コーディングエージェントとの開発](../../guides/introduction/getting-started/#ai-コーディングエージェントとの開発)を参照）。

pnpm 12.11 以降では、インストール後に `pnpm approve` を実行すると、プロジェクトのエージェント用 skills ディレクトリ（`.claude/skills` など）にスキルがリンクされます。他のパッケージマネージャーでは、`node_modules/@navaramap/three-flood-mesh/skills/navara-flood-mesh` をそこにコピーしてください。

## ページ一覧

- [仕組み](../how-it-works/): 水面が読むデータ形式、プロパティ、波が従う流れ、時系列が使う GPU メモリ
- [使用例](../usage-examples/): シミュレーションの再生、認証が必要なサーバーや Worker での読み込み、シナリオの切り替え
- [データの変換](../converting-data/): コマンドか API による Zarr グループの書き出しと、高さの鉛直基準
- [洪水データの作り方](../preparing-data/): 種類ごとの実際のデータセットの変換手順
- API: [TimeSeriesFloodMeshDesc](../api/time-series-flood-mesh-desc/)、[時系列の関数](../api/series-functions/)、[変換関数](../api/converters/)
