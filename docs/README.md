# Navara Developer Documentation

[![Built with Starlight](https://astro.badg.es/v2/built-with-starlight/tiny.svg)](https://starlight.astro.build)

This directory contains the developer documentation site for Navara, a 3D map engine built on Rust + WebAssembly + Three.js. It is published at https://navara.world/docs/.

## 📚 Documentation Structure

The documentation covers six main sections of the Navara ecosystem:

- **engine** - Rust/WASM engine documentation (navara_wasm, navara_wasm_api)
- **guides** - General information, about us, and community resources
- **three** - navara_three, the main 3D rendering library based on Three.js
- **three_default_descs** - Built-in layer documentation (Mesh, Light, Effect descriptors)
- **three_default_plugin** - Default plugin documentation
- **three_plugins** - Official plugins (CesiumIonPlugin, OverlayPlugin, PersonViewPlugin, TileJsonPlugin)

In addition to the documentation, this project also serves the marketing landing page (`src/pages/lp.astro`, rendered by `src/components/LandingPage.astro`).

## 🚀 Project Structure

Inside of this Astro + Starlight project, you'll see the following folders and files:

```
.
├── guide/
│   ├── NAVARA_THREE_INSTRUCTIONS.md
│   ├── NAVARA_THREE_UPDATE_CHECKLIST.md
│   ├── TRANSLATION_GUIDE.md
│   └── WRITING_RULES.md
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   ├── content/
│   │   └── docs/
│   │       ├── engine/
│   │       ├── guides/
│   │       ├── three/
│   │       ├── three_default_descs/
│   │       ├── three_default_plugin/
│   │       ├── three_plugins/
│   │       └── ja/          # Japanese translations (mirrors root structure)
│   ├── content.config.ts
│   ├── data/                # Sidebar sections, showcase entries, landing page copy
│   ├── pages/               # Non-Starlight pages (landing page: lp.astro, ja/lp.astro)
│   ├── styles/
│   └── utils/
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

Starlight looks for `.md` or `.mdx` files in the `src/content/docs/` directory. Each file is exposed as a route based on its file name.

Images can be added to `src/assets/` and embedded in Markdown with a relative link.

Static assets, like favicons, can be placed in the `public/` directory.

## 🛠 Setup

After installing dependencies, run the following command from the repository root to install Playwright's browser binaries for the `docs` workspace. This is required for rehype plugins (e.g., `rehype-mermaid`) that render content using a headless browser during the build.

```bash
pnpm -C docs exec playwright install --with-deps chromium
```

## 🧞 Commands

This project is part of the pnpm workspace at the repository root. All commands are run from the repository root:

| Command                     | Action                                           |
| :-------------------------- | :----------------------------------------------- |
| `pnpm install`              | Installs dependencies for all workspaces         |
| `pnpm dev:docs`             | Starts local dev server at `localhost:4321`      |
| `pnpm build:docs`           | Build the production site to `docs/dist/`        |
| `pnpm preview:docs`         | Preview the build locally, before deploying      |
| `pnpm -C docs astro ...`    | Run CLI commands like `astro add`, `astro check` |

The same scripts are also available inside `docs/` as `pnpm dev`, `pnpm build`, and `pnpm preview`.

## Contribution

Please read [Writing rules](./guide/WRITING_RULES.md) before your contribution.

## 👀 Want to learn more?

Check out [Starlight’s docs](https://starlight.astro.build/), read [the Astro documentation](https://docs.astro.build), or jump into the [Astro Discord server](https://astro.build/chat).
