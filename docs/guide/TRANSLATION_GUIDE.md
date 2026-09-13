# Documentation Translation Guide

Instructions for translating documentation to different languages using a coding agent (e.g., Claude Code).

## Overview

This project uses [Astro Starlight's i18n system](https://starlight.astro.build/guides/i18n/). English is the default (root) locale, and translations live in locale subdirectories.

### Locale Configuration

From `astro.config.mjs`:

```javascript
defaultLocale: "root",
locales: {
  root: {
    lang: "en",
    label: "English",
  },
  ja: {
    label: "日本語",
  },
},
```

### Directory Structure

Translations mirror the root directory structure under a locale subdirectory:

```
src/content/docs/
├── section-a/                         # English (root)
│   └── page.md
├── section-b/
│   └── page.md
├── ja/                                # Japanese locale
│   ├── section-a/
│   │   └── page.md                    # Japanese translation
│   └── section-b/
│       └── page.md
└── [locale]/                          # Future locales
    └── ...                            # Same structure as root
```

## Workflow: Adding New Documentation

**Always write in English first.** English is the root locale and the source of truth.

1. **Write the English document** in the root directory
2. **Translate to other languages** by creating the same file in locale directories

## Workflow: Translating with a Coding Agent

### Translating a single file

```
Translate src/content/docs/three/API/atmosphere.md to Japanese and save it to src/content/docs/ja/three/API/atmosphere.md
```

### Translating an entire directory

```
Translate all files under src/content/docs/three/ into Japanese under src/content/docs/ja/three/
```

### Translating the entire documentation to a new locale

```
Translate all documentation under src/content/docs/ (excluding /ja/) into [language] under src/content/docs/[locale]/
```

## Translation Rules

### What to translate

- Prose text (descriptions, explanations, notes, tips, warnings)
- Code comments inside code blocks
- Frontmatter `description` field (for SEO)
- Console output strings in code examples (e.g., `console.log("Hello")`)

### What NOT to translate

- Frontmatter `title` field — keep in English
- Frontmatter `sidebar` configuration — keep as-is
- Code block syntax (variable names, function calls, type annotations)
- Technical terms (e.g., `ECEF`, `Vector3`, `LayerHandle`, `Three.js`)
- API and feature names — never transliterate into katakana (e.g., "Selective Bloom", not 「セレクティブブルーム」)
- Import paths and package names
- URLs and links
- File paths
- Component names and JSX/MDX tags (e.g., `<LinkCard>`, `<SimpleShowcase />`)
- Intentional content in code examples (e.g., `"hello 京都"` as data)

### Frontmatter example

**English (root):**

```yaml
---
title: Atmosphere
description: API reference for the Atmosphere class in navara_three
sidebar:
  order: 10
---
```

**Japanese (ja/):**

```yaml
---
title: Atmosphere
description: navara_three の Atmosphere クラスの API リファレンス
sidebar:
  order: 10
---
```

### Code block example

**English:**

```typescript
// Convert degrees to radians
const latRad = angleToRadian(35.6762); // Latitude of Tokyo
console.log(`Semi-major axis: ${semiMajorAxis} m`);
```

**Japanese:**

```typescript
// 度をラジアンに変換
const latRad = angleToRadian(35.6762); // 東京の緯度
console.log(`長半径: ${semiMajorAxis} m`);
```

## Adding a New Locale

### Step 1: Update `astro.config.mjs`

Add the new locale to the `locales` object and the `localeDirectories` set:

```javascript
const localeDirectories = new Set(["ja", "zh"]);

// ...

locales: {
  root: {
    lang: "en",
    label: "English",
  },
  ja: {
    label: "日本語",
  },
  zh: {
    label: "中文",
  },
},
```

### Step 2: Add sidebar folder translations in `src/data/folderTranslations.json`

Add an entry for the new locale. See existing entries for the full list of folder names to translate:

```json
{
  "zh": {
    "Introduction": "简介",
    "API": "API 参考"
  }
}
```

### Step 3: Add showcase translations in `src/data/showcase.json`

Add the new locale key to each item's `translations` object.

### Step 4: Create the locale directory and translate content

Mirror the root directory structure under the new locale directory. Every `.md` / `.mdx` file in the root should have a corresponding translated file.

### Step 5: Verify

```bash
pnpm build
```

Check that the language switcher appears and all pages render correctly in the new locale.

## Quality Checklist

After translation, verify:

- [ ] All files in the root directory have corresponding files in the locale directory
- [ ] Frontmatter `title` is kept in English
- [ ] Frontmatter `description` is translated
- [ ] `sidebar.order` values match the English source
- [ ] All code blocks are preserved (syntax, imports, types)
- [ ] Code comments are translated
- [ ] Technical terms remain in English
- [ ] Links and URLs are unchanged
- [ ] MDX component imports and usage are unchanged
- [ ] No stray untranslated prose remains (check with `rg "[\p{Latin}]"` for non-Latin locales or `rg "[\p{Hiragana}\p{Katakana}\p{Han}]"` for checking Japanese remnants in English)
