---
title: About
description: Navara 向け MapLibre Style サポート - 既存の MapLibre スタイルを 3D 地球儀上でレンダリング
sidebar:
  order: 1
---

:::caution[実験的機能]
MapLibre Style プラグインは現在実験的です。API は変更される可能性があり、一部の機能はまだ完全には実装されていません。現在の制限の詳細については [サポートされている機能](../supported-features/) を参照してください。
:::

## maplibre_style とは

`@navaramap/maplibre-style` は `MapLibreStylePlugin` を提供します。これは [MapLibre Style](https://maplibre.org/maplibre-style-spec/) JSON 仕様を解析し、そのソースとレイヤーを Navara のレイヤー操作とフィーチャーごとの評価器に変換します。これにより、既存の MapLibre GL JS スタイルを最小限の変更で Navara の 3D 地球儀上にレンダリングできます。

プラグインが処理するもの：
- **式の評価** - サポートされている MapLibre 式（数学、決定、検索、zoom など）

## インストール

```bash
npm install @navaramap/maplibre-style
```

## クイックスタート

使用例については [MapLibreStylePlugin](../maplibre-style-plugin/) を参照してください。

## 他のパッケージとの関係

```text
@navaramap/three (コア: ThreeView, Plugin, Source, Layer)
  ├── @navaramap/three-default-plugin (DefaultPlugin: descriptor 登録)
  └── @navaramap/maplibre-style (MapLibreStylePlugin: MapLibre Style サポート)
        └── @maplibre/maplibre-gl-style-spec を式評価に使用
```

## 機能と制限

プラグインは MapLibre Style 仕様の実用的なサブセットをサポートしており、一般的なレイヤータイプ（fill、line、circle、symbol など）、複数のソースタイプ（vector、raster、GeoJSON）、およびほとんどの式演算子が含まれます。

サポートされている機能、制限、実装の詳細の完全なリストについては、[サポートされている機能](../supported-features/) ページを参照してください。

## 関連リソース

- [MapLibreStylePlugin](../maplibre-style-plugin/) - 使い方ガイド、API リファレンス、フォント設定
- [サポートされている機能](../supported-features/) - 完全な機能マトリックス
