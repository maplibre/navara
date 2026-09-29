---
title: SunLightDesc
description: Sun light descriptor for navara_three
sidebar:
  order: 154
---

`SunLightDesc`クラスは、太陽光をシミュレートする指向性ライトを表します。Cascaded Shadow Maps（CSM）を使用した高品質な影の描画に対応し、大気散乱シミュレーションと連携して自然な太陽光を再現します。

太陽の方向は `view.atmosphere.date` に基づいて自動計算され、影の向きも連動して変化します。

:::tip[関連ドキュメント]
大気システムの詳細については [Atmosphere クラス](../../../three/api/atmosphere/) を参照してください。
:::

## Common Properties

### visible

**Type:** `boolean | undefined`

**Description:** オブジェクトの表示/非表示を制御します。

**Default:** `true`

**Example:**

```typescript
{
  visible: false,
  sun: { ... }
}
```

## Properties

### sun

**Type:** `object | undefined`

**Description:** 太陽光の設定オプション。

#### distance

**Type:** `number | undefined`

**Description:** ターゲット位置から太陽光の距離を指定します。単位はメートルです。

**Default:** `300`

:::note[初期化時のみ設定可能]
このプロパティはDescriptor作成時にのみ設定できます。`update()`メソッドでは変更できません。
:::

**Example:**

```typescript
{
  sun: {
    distance: 300,
  }
}
```

#### color

**Type:** `Color | undefined`

**Description:** 太陽光の色を`Color`オブジェクトで指定します。`applyColor`が`true`の場合に使用されます。

**Default:** `new Color().setHex(0xffffff)`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  sun: {
    color: new Color().setHex(0xffffee),
  }
}
```

#### applyColor

**Type:** `boolean | undefined`

**Description:** 色を直接適用するか、大気散乱計算を使用するかを指定します。`false`の場合、大気テクスチャから動的に色を計算します。

**Default:** `false`

**Example:**

```typescript
{
  sun: {
    applyColor: false,
  }
}
```

#### intensity

**Type:** `number | undefined`

**Description:** 太陽光の強度を指定します。数値が大きいほど明るくなります。

**Default:** `1`

**Example:**

```typescript
{
  sun: {
    intensity: 1.0,
  }
}
```

## Shadow Properties

### castShadow

**Type:** `boolean | undefined`

**Description:** Cascaded Shadow Maps（CSM）を使用して影を投影するかを指定します。

**Default:** `true`

**Example:**

```typescript
{
  sun: {
    castShadow: true,
  }
}
```

### shadowCascadeCount

**Type:** `number | undefined`

**Description:** シャドウカスケードの数を指定します。カスケード数が多いほど影の品質分布が向上しますが、GPU リソースを多く消費します。

**Default:** `4`

**Example:**

```typescript
{
  sun: {
    shadowCascadeCount: 4,
  }
}
```

### shadowMapSize

**Type:** `number | undefined`

**Description:** シャドウマップの解像度（カスケードごと）を指定します。値が大きいほど影の品質が向上しますが、GPU メモリを多く消費します。

**Default:** `2048`

**Example:**

```typescript
{
  sun: {
    shadowMapSize: 2048,
  }
}
```

### shadowFar

**Type:** `number | undefined`

**Description:** カメラからの最大距離で、この距離を超えると影は描画されません。単位はメートルです。

**Default:** `50000`

**Example:**

```typescript
{
  sun: {
    shadowFar: 50000,
  }
}
```

### shadowMode

**Type:** `"uniform" | "logarithmic" | "practical" | undefined`

**Description:** カメラの視錐台の分割スキームを定義します。

- `"uniform"`: 線形分割分布
- `"logarithmic"`: 対数分割分布（大規模シーンに適している）
- `"practical"`: ハイブリッドアプローチで品質とパフォーマンスのバランスを取る（推奨）

**Default:** `"practical"`

**Example:**

```typescript
{
  sun: {
    shadowMode: "practical",
  }
}
```

### shadowLambda

**Type:** `number | undefined`

**Description:** "practical"分割モードのλパラメータ。uniform（0.0）とlogarithmic（1.0）の分割スキーム間のブレンドを制御します。

**Default:** `0.8`

**Example:**

```typescript
{
  sun: {
    shadowLambda: 0.8,
  }
}
```

### shadowMargin

**Type:** `number | undefined`

**Description:** シャドウカメラがカスケード視錐台の後方に配置される距離を定義します。値が大きいほど影のクリッピングを防ぎますが、精度が低下する可能性があります。単位はメートルです。

**Default:** `5000`

**Example:**

```typescript
{
  sun: {
    shadowMargin: 5000,
  }
}
```

### shadowFade

**Type:** `boolean | undefined`

**Description:** シャドウカスケード間のスムーズな遷移を有効にして、目に見える継ぎ目を減らします。

**Default:** `true`

**Example:**

```typescript
{
  sun: {
    shadowFade: true,
  }
}
```

### shadowIntensity

**Type:** `number | undefined`

**Description:** 影の強度を指定します（0 = 影なし、1 = 完全な影）。

**Default:** `1`

**Example:**

```typescript
{
  sun: {
    shadowIntensity: 1.0,
  }
}
```

### shadowBias

**Type:** `number | undefined`

**Description:** シャドウアクネを減らすためのシャドウマップバイアス。THREE.LightShadow.biasに類似しています。

**Default:** `0.0001`

**Example:**

```typescript
{
  sun: {
    shadowBias: 0.0001,
  }
}
```

### shadowNormalBias

**Type:** `number | undefined`

**Description:** 斜めの角度の表面でシャドウアクネを減らすための法線ベースのシャドウバイアス。

**Default:** `0`

**Example:**

```typescript
{
  sun: {
    shadowNormalBias: 0,
  }
}
```

### shadowRadius

**Type:** `number | undefined`

**Description:** シャドウマップのフィルタカーネルの幅を、シャドウマップのテクセル単位で指定します。カーネルのサンプル数は 9 で固定されているため、`4` を超えるとエッジが滑らかにならず個々のサンプルが点として見えます。[AerialPerspectiveEffectDesc](../../../three_default_descs/effect-desc/aerial-perspective-effect-desc/) がこの影を再適用する場面では、代わりにその `shadowSoftness` オプションがスクリーンスペースでエッジを広げます。

**Default:** `1`

**Example:**

```typescript
{
  sun: {
    shadowRadius: 2,
  }
}
```

### debugCSMHelper

**Type:** `boolean | undefined`

**Description:** シャドウカスケードのデバッグビジュアライゼーションを表示するかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  sun: {
    debugCSMHelper: false,
  }
}
```

## 使用例

### 基本的な使用例

```typescript
import ThreeView from "@navaramap/three";
import { SunLightDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView({
  shadow: true  // シャドウを有効化
});
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

// デフォルトのフォトリアルオブジェクトを追加（SunLightDescが含まれる）
const defaultLayers = plugin.addDefaultPhotorealScene();

// 太陽光のDescriptorの設定を更新
defaultLayers.sun.update({
  sun: {
    castShadow: true,
    shadowMapSize: 2048,
    shadowCascadeCount: 4
  }
});
```

### 影の品質調整

```typescript
const sun = view.addLight<SunLightDesc>({
  sun: {
    intensity: 1.0,
    castShadow: true,
    shadowCascadeCount: 4,
    shadowMapSize: 4096,  // 高品質
    shadowFar: 50000,
    shadowMode: "practical",
    shadowLambda: 0.8,
    shadowFade: true,
    shadowIntensity: 1.0,
    shadowBias: 0.0001,
    shadowNormalBias: 0,
    shadowRadius: 1
  }
});
```

### デバッグビジュアライゼーション

```typescript
// CSMカスケードを視覚化してデバッグ
sun.update({
  sun: {
    debugCSMHelper: true
  }
});
```

### 影の動的制御

```typescript
// UIコントロールパネルと連携
const params = {
  castShadow: true,
  shadowIntensity: 1.0,
  shadowMapSize: 2048
};

// 影の有効/無効を切り替え
sun.update({
  sun: {
    castShadow: params.castShadow
  }
});

// 影の強度を調整
sun.update({
  sun: {
    shadowIntensity: params.shadowIntensity
  }
});
```

### カスタムカラーの適用

```typescript
import { Color } from "@navaramap/three";

// 大気計算を無効化してカスタムカラーを使用
const sun = view.addLight<SunLightDesc>({
  sun: {
    applyColor: true,  // カスタムカラーを使用
    color: new Color().setHex(0xffffee),
    intensity: 1.0
  }
});
```

## Cascaded Shadow Maps（CSM）について

Cascaded Shadow Maps は、広範囲のシーンで高品質な影を実現する技術です：

- **複数のシャドウマップ**: カメラからの距離に応じて複数のシャドウマップを使用
- **適応的な解像度**: 近距離は高解像度、遠距離は低解像度
- **カスケード間のフェード**: シームレスな遷移で継ぎ目を隠す

### パフォーマンス最適化のヒント

1. **カスケード数を調整**: 通常3-4で十分、より多くすると品質向上だがコスト増
2. **シャドウマップサイズ**: 2048が標準、4096は高品質だが重い
3. **shadowFar を制限**: 必要な範囲のみに影を描画
4. **shadowMode の選択**: "practical"が通常最適

## 大気システムとの連携

SunLightDescは大気散乱シミュレーションと連携して動作します：

1. **太陽方向の同期**: `view.atmosphere.sunDirection`から取得
2. **透過テクスチャの使用**: 大気による光の減衰を考慮
3. **動的な色計算**: `applyColor`が`false`の場合、大気から色を計算

これにより、時間帯や大気条件に応じた自然な太陽光が実現されます。

## 注意事項

- SunLightDescを使用するには、`ThreeView`の初期化時に`shadow: true`を指定する必要があります。
- CSMは複数のシャドウマップを使用するため、GPU メモリとパフォーマンスに影響します。
- `shadowMapSize`を大きくするとメモリ使用量が増加します（例: 4096 = 16MB/カスケード）。
- 地形やモデルで影を受け取るには、マテリアルで`receiveShadow: true`を設定する必要があります。
- 影を投影するには、オブジェクトで`castShadow: true`を設定する必要があります。
- `debugCSMHelper`は開発時のみ使用し、本番環境では無効化してください。
