---
title: AttributionPlugin
description: navara_three 向けの、非モーダルでズーム連動するアトリビューション（クレジット）UI プラグイン。
sidebar:
  order: 1040
---

## 概要

`AttributionPlugin` は、地図のデータソースに関するアトリビューション（クレジット）UI を表示します。**`ThreeView` がデフォルトで生成し、`view.attribution` として公開します**（自前 UI を作る場合は `defaultAttribution: false` で無効化）。**組み込みの「Navara」クレジットが常に先頭に表示される**ため、ソースを 1 つも追加していなくても UI は表示されます。ポップオーバーはアクティブなソースを一覧し、**デフォルトでは畳まれた状態**です。下部の角（デフォルトでは右下）にある小さな ⓘ ボタンで開閉でき（`hide()` / `show()` も同じ）、非モーダルなので開いたままでも地図は操作可能（パン / ズーム / 回転）です。

UI はビューの canvas を持つ要素（`container` オプション、または `canvas` の親要素）の中に配置され、その下部の角に固定されます。その要素が `position: static` の場合、プラグインは破棄されるまで `position: relative` を設定します。canvas が `<body>` の直下にある場合、UI はビューポートに固定されます。

地図のアトリビューション表示で一般的に必要となる、次の 3 点に対応します。

- **ズーム連動クレジット**: ソースは、特定のズーム範囲でのみ適用される子クレジットを持てます。該当するものだけが表示され、ズームに応じて切り替わります。
- **レイヤー単位の動的クレジット**: レイヤー（3D タイルの copyright など）が供給するクレジットを、表示中のデータに合わせて自動追跡します。`creditLayerId` で結び付けたソースの配下にネスト表示されます。
- **常時表示ロゴ**: 常に表示が必要なロゴ（Google など）は、ポップオーバーの開閉とは独立して左下のロゴフレームに表示されます。

クレジットにはインライン `<a>` リンクを含められます（表示前にサニタイズされます）。色は [`setStyle()`](#setstylestyle) で実行時にテーマ変更できます。

## 使い方

```typescript
import ThreeView from "@navaramap/three";

// アトリビューション UI は ThreeView がデフォルトで生成します。
// view.attribution からアクセスします。
const view = new ThreeView({ container });
await view.init();

// ラスタの基盤地図: 各タイルにクレジット情報を含まないため、静的に宣言します。
const basemap = view.addSource({
  type: "raster-tile",
  url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
  maxZoom: 18,
});
view.addLayer({ type: "raster", source: basemap });

// タイルが自前の copyright を埋め込む 3D タイル（動的に追跡されます）。
const photorealSource = view.addSource({
  type: "3d-tiles",
  url: "https://tile.googleapis.com/v1/3dtiles/root.json?key=YOUR_KEY",
});
const photoreal = view.addLayer({ type: "3d-tiles", source: photorealSource });

// `add` / `remove` で表示するクレジットを管理します。`view.attribution` が
// `undefined` になるのは `defaultAttribution: false` で無効化した場合、または
// worker / DOM なし環境です。
view.attribution?.add([
  {
    attribution: "国土地理院",
    attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
    children: [
      { attribution: "全国最新写真（シームレス）", minZoom: 14, maxZoom: 18 },
      { attribution: "GRUS画像（© Axelspace）", minZoom: 14, maxZoom: 18 },
    ],
  },
  {
    attribution: "Google Maps Photorealistic 3D Tiles",
    logo: "/credits/GoogleMaps.png",
    // `logoUrl` を付けるとロゴがリンク化されます（表示専用マークなら省略）。
    logoUrl: "https://www.google.com/maps",
    // このレイヤーのタイル単位のクレジットをこのソース配下にネスト。
    // レイヤーは id から view 内で解決されるため、別途渡す必要はありません。
    creditLayerId: photoreal.id,
  },
  {
    attributionHtml:
      '<a href="https://s2maps.eu">Sentinel-2 cloudless 2020</a> by <a href="https://eox.at">EOX IT Services GmbH</a>',
  },
]);

// データが地図から外れたら、そのクレジットを取り下げます。一致判定は構造ベースなので、
// add したときと同じ形（ここでは `logo` も含む）で渡します。
view.attribution?.remove([
  {
    attribution: "Google Maps Photorealistic 3D Tiles",
    logo: "/credits/GoogleMaps.png",
    logoUrl: "https://www.google.com/maps",
    creditLayerId: photoreal.id,
  },
]);

// ポップオーバーはデフォルトで畳まれています。show() で開き、hide() で畳みます
// （ⓘ ボタンも同じ状態を切り替えます）。
view.attribution?.hide();
view.attribution?.show();
```

## 有効化とアクセス

`ThreeView` はアトリビューション UI をデフォルトで生成し、readonly getter として公開します。

```typescript
view.attribution; // AttributionPlugin | undefined
```

`defaultAttribution` オプションで設定・無効化できます。

```typescript
new ThreeView({
  // `false` で無効化して自前 UI を作る、またはオブジェクトで初期の色 / 角を指定。
  // デフォルトは `true`。
  defaultAttribution?:
    | boolean
    | { style?: AttributionStyle; position?: "bottom-left" | "bottom-right" };
});
```

`view.attribution` が `undefined` になるのは `defaultAttribution: false` で無効化したとき、または worker / DOM なし環境です（組み込みプラグインは DOM を必要とします）。`position` は ⓘ ボタンとポップオーバーのカードを置く下部の角を選びます（デフォルト `"bottom-right"`）。右下がページ独自の HUD などで埋まっている場合は `"bottom-left"` を使ってください。ロゴフレームはどちらの位置設定でも左下エリアに置かれます。`"bottom-left"` では ⓘ ボタンが左端に置かれ、ロゴフレームはその右に移動します。`style` は初期の色を設定します（[AttributionStyle](#attributionstyle) を参照）。

**上級者向け:** `AttributionPlugin` は `@navaramap/three` からも export されており、手動で生成（`new AttributionPlugin({ style?, position? })`）して `view.init()` の**前に** `view.addPlugin()` で登録することもできます（例: `defaultAttribution: false` で生成した view に付ける場合）。

## メソッド

### add(items)

```typescript
add(items: AttributionItem[]): void
```

クレジットを表示対象に追加します（現在のエントリにマージ）。完全に重複するエントリは除外されるため、同じクレジットを共有する複数のデータソースは 1 行にまとまります。`creditLayerId` を設定したソースは、そのレイヤーから供給されるクレジットが動的に追跡されます。レイヤーは id から view 内で解決されるため、別途渡す必要はありません。

### remove(items)

```typescript
remove(items: AttributionItem[]): void
```

クレジットを表示対象から削除します。エントリは（表示内容による）構造で一致判定されるため、追加時と同じ形のオブジェクトを渡してください。別途 id は不要です。一致しないエントリは無視されます。

静的に `add()` したクレジットを、カメラやアプリの状態に応じて出し入れするケースで使います（例: `children` のズーム帯では表せない範囲でトップレベルのクレジットを出し入れしたいとき、カメラ移動に合わせて `add()` / `remove()` する）。`creditLayerId` で追跡しているクレジットはレイヤー削除時に自動で消えるため、`remove()` は不要です。

### clear()

```typescript
clear(): void
```

ユーザーが追加したクレジットをすべて削除しますが、プラグインは生かしたままにします（ポップオーバー、リスナー、追加済みのスタイルは残るため、あとで `add()` を呼べばクレジットを再び追加できます）。組み込みの「Navara」クレジットと ⓘ ボタンは表示されたまま残り、ロゴフレームは表示するロゴがなければ自動的に隠れます。DOM ごと破棄する場合は `dispose()` を使ってください。

### show()

```typescript
show(): void
```

アトリビューションポップオーバーを開きます。デフォルトでは畳まれているため、開くにはこのメソッドを呼ぶか ⓘ ボタンを使います。ポップオーバーのカードにのみ作用し、常時表示のロゴフレームはそのままです。

### hide()

```typescript
hide(): void
```

アトリビューションポップオーバーを閉じます。ポップオーバーのカードにのみ作用し、追跡中のクレジットと常時表示のロゴフレームには触れません。エントリの削除は `remove()`、全体の破棄は `dispose()` を使ってください。

### dispose()

```typescript
dispose(): void
```

UI を削除し、プラグインが確保したすべてを解放します。`view.attribution` は `view.dispose()` が自動で破棄するため、手動で生成したインスタンスにのみ呼べば十分です。

### setStyle(style)

```typescript
setStyle(style: AttributionStyle): void
```

実行時に UI の色を更新します。指定内容を現在のスタイルにマージし、DOM を再構築せず表示中の UI にそのまま反映するため、ライト / ダークモードの切り替えに適しています。

```typescript
view.attribution?.setStyle({
  backgroundColor: "rgba(20, 24, 28, 0.92)",
  textColor: "#e6e9ee",
  nestedTextColor: "rgba(230, 233, 238, 0.64)",
  linkColor: "#8ab4f8",
});
```

## 型

### AttributionItem

各エントリは、構造化されたソースか、生の HTML クレジットのいずれかです。

```typescript
type AttributionItem = AttributionSource | AttributionHtml;
```

### AttributionSource

| プロパティ            | 型                                 | 説明                                                 |
| ---------------- | --------------------------------- | -------------------------------------------------- |
| `attribution`    | `string`                          | トップレベルのソース／プロバイダ名                                  |
| `attributionUrl` | `string \| undefined`             | ソース名に付ける任意のリンク                                     |
| `logo`           | `string \| undefined`             | 任意のロゴ画像 URL。左下のロゴフレームに常時表示される                        |
| `logoUrl`        | `string \| undefined`             | `logo` の任意のクリック遷移先。設定したときだけロゴがリンク化される              |
| `children`       | `AttributionChild[] \| undefined` | 該当ズーム範囲でのみ表示される任意のクレジット                   |
| `creditLayerId`  | `string \| undefined`             | 任意の `layer.id`。そのレイヤーから供給されるクレジットがこのソース配下にネストされる |

### AttributionHtml

| プロパティ             | 型        | 説明                               |
| ----------------- | -------- | -------------------------------- |
| `attributionHtml` | `string` | インライン `<a>` リンクを含む HTML 形式のクレジット |

### AttributionChild

| プロパティ      | 型                    | 説明                                      |
| --------------- | --------------------- | ----------------------------------------- |
| `attribution`   | `string`              | クレジットテキスト。インライン `<a>` リンクを含めてよい |
| `minZoom`       | `number \| undefined` | このクレジットが適用される最小ズーム（省略で下限なし） |
| `maxZoom`       | `number \| undefined` | このクレジットが適用される最大ズーム（省略で上限なし） |

### AttributionStyle

すべてのフィールドは任意です。未指定のフィールドはデフォルト色を保ちます。色は CSS カスタムプロパティとして適用されるため、`setStyle()` による変更は即座に反映されます。

| プロパティ             | 型                     | 説明                      |
| ----------------- | --------------------- | ----------------------- |
| `titleColor`      | `string \| undefined` | ソースタイトルのテキスト色           |
| `linkColor`       | `string \| undefined` | リンクと info アイコンの色        |
| `listStyleColor`  | `string \| undefined` | 箇条書き（リストマーカー）の色         |
| `textColor`       | `string \| undefined` | 本文テキスト色                 |
| `nestedTextColor` | `string \| undefined` | ネストした子クレジットのテキスト色 |
| `backgroundColor` | `string \| undefined` | ポップオーバーとボタンの背景色        |
| `borderColor`     | `string \| undefined` | ヘッダ区切り線の色（ダークテーマで有用）    |

## 補足

- **ズーム範囲は、自分で宣言するラスタソース向けです。** GSI や OpenStreetMap などのタイルは自前のクレジットを持たないため、ズーム依存のクレジットは `children` で記述します。
- **レイヤー単位のクレジットはタイル由来です。** Google Photorealistic 3D Tiles のように copyright を埋め込むソースだけが `creditLayerId` 経由でクレジットを生成します。それ以外は `children` を使ってください。
- **掲出義務のあるロゴはロゴフレームへ（ポップオーバーではなく）。** 常時表示が必須のマークにのみ `logo` を使い、通常のソースはテキスト表示が適切です。ロゴはデフォルトではリンクのない画像として表示されますが、`logoUrl` を設定するとプロバイダのページへのリンクになります。表示は必須でもリンク化してはいけないマークもあるため、その場合は `logoUrl` を設定しないでください。
- **リンクはスキーム検証されます。** すべてのクレジットリンク（`attributionUrl`、`logoUrl`、`attributionHtml` / `attribution` 内のインライン `<a>`、レイヤーから供給されたクレジットに埋め込まれた `<a>`）は、安全なスキーム（`http` / `https` / `mailto`、または相対 URL）のみ保持され、それ以外（例: `javascript:`）はプレーンテキストに落とされます。これにより、信頼できないタイルメタデータ由来のリンクでも安全に描画できます。
- **生の URL は自動でリンク化されます。** クレジットテキスト内のプレーンな `http(s)` URL は自動でクリック可能なリンクになるため、公式の表記をそのまま貼り付けても URL を手で `<a>` で囲む必要がありません（文言も URL も変更されません）。

## 関連リソース

- [OverlayPlugin](../../../three_plugins/overlayplugin/): ワールド座標からスクリーン座標への HTML オーバーレイ投影
- [About three_plugins](../../../three_plugins/about/): パッケージの概要
