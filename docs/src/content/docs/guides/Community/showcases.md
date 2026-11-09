---
title: Showcases
description: How to add a project built with Navara to the showcases page.
sidebar:
  order: 6
---

## Showcases

The showcases page lists maps and visualizations that people have built with Navara. Each project appears as a screenshot that links to it, with the data credits it carries.

**URL**: [https://navara.world/showcases/](https://navara.world/showcases/)

Every submission starts with an Issue. Then the Navara team adds the project, or you open the Pull Request yourself.

## 1. Open an Issue

Fill in the [showcase submission form](https://github.com/maplibre/navara/issues/new?template=showcase.yml).

## 2. Open the Pull Request yourself

The showcases page is built from one data file, `docs/src/data/showcases.json`, and the screenshots in `docs/src/assets/showcases/`.

### Clone the repository

Fork [maplibre/navara](https://github.com/maplibre/navara), clone your fork, and install the dependencies with [pnpm](https://pnpm.io/installation):

```bash
git clone https://github.com/<your-account>/navara.git
cd navara
pnpm install
```

### Let an AI agent add it

The repository includes an agent skill for this task, [`navara-add-showcase`](https://github.com/maplibre/navara/blob/main/skills/navara-add-showcase/SKILL.md). Claude Code loads it automatically when it runs in your clone. With another agent, point it at `skills/navara-add-showcase/SKILL.md`. Give it your Issue number:

```text
Add the showcase from issue #123 with the navara-add-showcase skill, then open a Pull Request.
```

The agent prepares the screenshot, adds the entry to `showcases.json`, runs the checks and opens a Pull Request linked to the Issue. Look at your image on the local page (see [Check the page locally](#check-the-page-locally)) before you submit.

The rest of this section walks through the same steps by hand, for working without an agent or for checking what it did.

### Add a screenshot

Save a screenshot of the project as `docs/src/assets/showcases/<project-name>.avif`. Use a square image around 1000×1000 pixels. The file must be AVIF and 150 KB or less. Convert other formats with an existing tool, for example [Squoosh](https://squoosh.app/) in the browser or `avifenc` from [libavif](https://github.com/AOMediaCodec/libavif) on the command line.

The tile on the page is square. An image of another aspect ratio is cropped to its center square, so keep the subject in the middle. Leave the page's own UI (panels, buttons and the attribution display) out of the shot where you can.

### Add an entry to showcases.json

Add an object at the top of the array in `docs/src/data/showcases.json`, so the newest project comes first:

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

| Field          | Description                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`        | **Required.** The project name, shown as the tile's tooltip and the image's alternative text.                                                                                                    |
| `href`         | **Required.** The URL the tile links to.                                                                                                                                                         |
| `image`        | **Required.** The screenshot's path under `docs/src/assets/`. The build fails when the file does not exist.                                                                                      |
| `attributions` | **Optional.** The data credits shown from the tile's info icon. Copy them from the project's own attribution display, one credit per item. Omit the field when the project needs no attribution. |
| `logo`         | **Optional.** Set `"google-maps"` when the project uses Google Photorealistic 3D Tiles, whose terms require the Google Maps logo.                                                                |

Each item of `attributions` has a `text` and an optional `href`. A credit that carries several links becomes one item per link.

### Check the page locally

Start the documentation site from the repository root:

```bash
pnpm dev:docs
```

Also check the screenshot against the size limit. CI runs the same check on every Pull Request:

```bash
pnpm -C docs showcases:check
```

Open `http://localhost:4321/docs/showcases/` (use the port the command prints if it differs) and check that your tile appears, that it links to your project, and that its info icon lists the credits.

### Open the Pull Request

Commit the screenshot and the change to `showcases.json`, push them to your fork, and open a Pull Request against `maplibre/navara`. Link the submission Issue in the description (for example `Closes #123`), so the confirmations you made there apply to the Pull Request.
