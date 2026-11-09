---
title: ショーケース
description: Navara で作ったプロジェクトをショーケースページに掲載する方法。
sidebar:
  order: 6
---

## ショーケース

ショーケースページでは、Navara で作られた地図やビジュアライゼーションを紹介しています。各プロジェクトはスクリーンショットで表示され、プロジェクトへのリンクとデータの帰属表示が付きます。

**URL**: [https://navara.world/ja/showcases/](https://navara.world/ja/showcases/)

投稿は必ず Issue から始めてください。その後、Navaraチームが追加するか、投稿者自身が Pull Request を作成します。

## 1. Issue を作成する

[ショーケース投稿フォーム](https://github.com/maplibre/navara/issues/new?template=showcase.yml)を埋めてください。

## 2. 自分で Pull Request を作成する

ショーケースページは、データファイル `docs/src/data/showcases.json` と、`docs/src/assets/showcases/` のスクリーンショットから作られます。

### リポジトリをクローンする

[maplibre/navara](https://github.com/maplibre/navara) をフォークしてクローンし、[pnpm](https://pnpm.io/ja/installation) で依存関係をインストールします。

```bash
git clone https://github.com/<your-account>/navara.git
cd navara
pnpm install
```

### スクリーンショットを追加する

プロジェクトのスクリーンショットを `docs/src/assets/showcases/<project-name>.avif` に保存します。1920×1200 ピクセル程度の 16:10 の画像を使ってください。ファイルは AVIF 形式で、300 KB 以下にする必要があります。ほかの形式の画像は、ブラウザで使える [Squoosh](https://squoosh.app/) や、コマンドラインの [libavif](https://github.com/AOMediaCodec/libavif) の `avifenc` といった既存のツールで変換してください。

ページ上のタイルは正方形で、スクリーンショットの中央部分が表示されます。主な被写体は中央に置いてください。パネルやボタン、帰属表示といったページ自身の UI は、できるだけ写らないようにしてください。

### showcases.json に項目を追加する

`docs/src/data/showcases.json` の配列の先頭にオブジェクトを追加します。新しいプロジェクトほど上に表示されます。

```json
{
  "title": "My Navara Project",
  "href": "https://example.com/my-navara-project/",
  "image": "showcases/my-navara-project.avif",
  "attributions": [
    {
      "text": "© OpenStreetMap contributors",
      "href": "https://www.openstreetmap.org/copyright"
    }
  ]
}
```

| フィールド     | 必須   | 説明                                                                                                         |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `title`        | はい   | プロジェクト名。タイルのツールチップと画像の代替テキストに使われます。                                       |
| `href`         | はい   | タイルのリンク先 URL。                                                                                       |
| `image`        | はい   | `docs/src/assets/` からのスクリーンショットのパス。ファイルが存在しないとビルドが失敗します。                |
| `attributions` | いいえ | タイルの情報アイコンから表示されるデータの帰属表示。プロジェクト自身の帰属表示から 1 件ずつ転記します。帰属表示が不要なプロジェクトでは省略します。 |
| `logo`         | いいえ | Google Photorealistic 3D Tiles を使う場合は `"google-maps"` を指定します。利用規約で Google Maps のロゴ表示が必要です。 |

`attributions` の各項目は `text` と、任意の `href` を持ちます。リンクを複数含む帰属表示は、リンクごとに 1 項目に分けます。

### ローカルで確認する

リポジトリのルートでドキュメントサイトを起動します。

```bash
pnpm dev:docs
```

スクリーンショットがサイズの上限内かどうかも確認してください。CI でもすべての Pull Request で同じチェックが実行されます。

```bash
pnpm -C docs showcases:check
```

`http://localhost:4321/docs/showcases/` を開き（コマンドが表示するポートが異なる場合はそちらを使います）、タイルが表示されること、プロジェクトへリンクしていること、情報アイコンに帰属表示が並ぶことを確認してください。

### Pull Request を作成する

スクリーンショットと `showcases.json` の変更をコミットしてフォークにプッシュし、`maplibre/navara` に Pull Request を作成します。説明欄には投稿時の Issue をリンクしてください（例: `Closes #123`）。Issue で行った確認が、その Pull Request にも適用されます。
