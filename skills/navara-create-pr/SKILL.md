---
name: navara-create-pr
description: >
  Write the Pull Request description from .github/pull_request_template.md,
  capture and attach screenshots, open the PR as a draft against
  maplibre/navara, and mark it ready after the user approves. Use when asked to
  create, open or write a PR (description) for the current branch.
---

# Creating a Pull Request

## Flow

1. Check the branch is committed and pushed (`git status`, `git ls-remote origin <branch>`). Commit only if the user asks.
2. Write the description in English from `.github/pull_request_template.md` (rules below).
3. Capture the screenshots (see below).
4. Open the PR as a **draft**.
5. Show the user the URL and a summary of the description. Run `gh pr ready <n> --repo maplibre/navara` only after they approve.

## Writing the description

Keep it terse: a reviewer should see what changed at a glance. Leave implementation details to the code.

- **Title:** a Conventional Commit, e.g. `feat: support instanced 3D Tiles`. Use `feat!:` for a breaking change.
- **Overview:** state the problem and how the PR solves it, in two or three sentences. Do not list what was implemented; the next section does that. Put a related issue URL first when there is one.
- **What I've done:** bullets for spec changes, and for public APIs added, changed or removed. Write "No public API change." when that is the case. No implementation details.
- **What I haven't done:** known limitations and out-of-scope items, as bullets. Leave it empty when there are none.
- **How I tested:** name the example pages and datasets, and the unit-test targets.
- **Which point I want you to review particularly:** leave it empty unless the user names something.
- **Screenshots:** images that show the change at a glance.
  - Add a before/after only when "before" shows something. When "before" rendered nothing, say so in one line instead.
  - Lay the images out with a Markdown table and put the captions in the table cells. Do not draw text onto the images.
  - Reference each image by its local path; `--attach` uploads it (see "Attaching images").
- **Checklist:** tick only what holds.
  - Tick "Updated the API documentation" when `docs/` or a guide changed.
  - Tick "Linked related issues" only when one is linked. Search for one with `gh issue list --state all --search ...`.

## Screenshots

Run the example dev server: `pnpm dev` (in `web/navara_three`, which runs `vite -c vite.config.example.ts --host`). Pages are served under `/examples/`, so the dev pages are at `/examples/<dir>-<name>`; for example `/examples/debug-3dtiles?ds=<group>/<name>`.

Capture with Playwright, using the installed Chrome. Its bundled browsers are usually not downloaded.

- Load it with `createRequire("<repo>/web/navara_three/package.json")("playwright")`.
- Launch with `chromium.launch({ channel: "chrome", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] })`.
- Use a 1280×720 viewport.
- Wait about 15 s for tiles before `page.screenshot`.
- For a picking shot, `page.mouse.click(x, y)` and wait 2 s.
- Save the images to the scratchpad. Read them back to check they show what the caption claims.

## Attaching images

A recent `gh` (2.105.0 has it; check `gh pr create --help`) uploads images with `--attach` on `pr create`, `pr edit` and `pr comment`.

- In the body, reference each image by its local path in Markdown syntax, e.g. `![i3dm-pick](./shots/i3dm-pick.png)`. `gh` does not rewrite the `src` of an `<img>` tag: that reference stays broken and the image is appended to the body instead.
- Pass the same file with `--attach`. `gh` uploads it and rewrites the reference to the uploaded asset.
- A path in `--body-file` is relative to that file's directory.
- An attached file that the body does not reference is appended to the end of the body.

## Opening the PR

`origin` is the user's fork, and `gh` resolves the repository to `maplibre/navara`. Pass both the repository and the fork's head explicitly:

```bash
gh pr create --repo maplibre/navara --draft --base main \
  --head <fork-owner>:<branch> --title "<title>" --body-file <body.md> \
  --attach ./shots/a.png --attach ./shots/b.png
```

To change the description later, use `gh pr edit <n> --repo maplibre/navara --body-file <body.md>`, adding `--attach` for any new images.
