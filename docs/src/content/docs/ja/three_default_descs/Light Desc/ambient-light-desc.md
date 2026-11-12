---
title: AmbientLightDesc
description: Ambient light descriptor for navara_three
sidebar:
  order: 151
---

`AmbientLightDesc`クラスは、シーン全体に均一に光を当てる環境光Descriptorを表します。AmbientLightはすべてのオブジェクトを均等に照らし、影を作りません。

## Common Properties

### visible

**Type:** `boolean | undefined`

**Description:** オブジェクトの表示/非表示を制御します。

**Default:** `true`

**Example:**

```typescript
{
  visible: false,
  ambient: { ... }
}
```

## Ambient Properties

### ambient

**Type:** `object | undefined`

**Description:** 環境光の設定オプション。

#### color

**Type:** `Color | undefined`

**Description:** 環境光の色を`Color`オブジェクトで指定します。

**Default:** `new Color().setHex(0xffffff)`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  ambient: {
    color: new Color().setHex(0xffffff),
  }
}
```

#### intensity

**Type:** `number | undefined`

**Description:** 環境光の強度を指定します。数値が大きいほど明るくなります。拡散シェーディングでは結果がπで除算される（Lambert BRDF）ため、トーンマッピングを使わない場合、強度1では面がアルベドの約32%の明るさでレンダリングされます。その構成では`Math.PI`を使うと、面を本来のアルベドでレンダリングできます。

**Default:** `1`

**Example:**

```typescript
{
  ambient: {
    intensity: 1.0,
  }
}
```

## 使用例

### 基本的な使用例

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { AmbientLightDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// 環境光オブジェクトを追加
const ambientLight = view.addLight<AmbientLightDesc>({
  ambient: {
    color: new Color().setHex(0xffffff),
    intensity: 1.0
  }
});
```

### 環境光の更新

```typescript
// 環境光の色と強度を更新
ambientLight.update({
  ambient: {
    color: new Color().setHex(0xaabbcc),
    intensity: 0.5
  }
});
```

### シンプルな環境光

```typescript
// デフォルト設定で環境光を追加
view.addLight<AmbientLightDesc>({
  ambient: {}
});
```

### 初期非表示で追加

```typescript
// 非表示状態で環境光を追加し、後から表示切り替え
const ambientLightDesc = view.addLight<AmbientLightDesc>({
  visible: false,
  ambient: {
    intensity: 1,
    color: new Color().setHex(0xffffff),
  },
});

// 表示/非表示を切り替え
ambientLightDesc.visible = true;
```

## 注意事項

- 環境光は影を作りません。
- 環境光は全方向から均等にオブジェクトを照らします。
- 他のライトタイプ（SunLightDesc、SkyLightProbeDescなど）と組み合わせて使用することができます。
- 環境光の強度が高すぎると、シーンが平坦に見える可能性があります。
