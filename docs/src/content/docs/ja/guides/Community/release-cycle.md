---
title: Release Cycle
description: Navara のリリースの頻度と、リリース・nightly ビルドが保証すること。
sidebar:
  order: 3
---

## リリースサイクル

Navara はリリースと nightly ビルドの 2 つのチャンネルで npm に公開されます。

### リリース

マイナーリリースは、目安として 2 週間から 1 か月に 1 度行います。マイナーリリースでは、最低限、機能が安定して動作することを保証します。不具合を修正するパッチリリースは、この周期とは別に必要に応じて行います。

リリースは npm の `latest` dist-tag で公開されるため、通常の `npm install` でインストールされます。各リリースの changelog は [GitHub Releases](https://github.com/maplibre/navara/releases) にあります。

### Nightly ビルド

nightly ビルドは、前回の nightly ビルドから `main` ブランチに変更があれば随時公開されます。`main` に入る変更はすべて自動テストと依存関係のセキュリティ監査を通っていますが、nightly ビルドは公開前にそれ以上の確認をしないため、動作は不安定な可能性があります。API も次のリリースまでに変わることがあります。最新の機能を使いたい方や、積極的にフィードバックをしたい方向けです。

nightly ビルドにのみ含まれる機能は、このドキュメントと examples で **Nightly** と表示されます。インストール方法は [Nightly ビルド](../../../three/introduction/install/#nightly-ビルド) を参照してください。気づいたことは [Issues](https://github.com/maplibre/navara/issues) で報告してください。
