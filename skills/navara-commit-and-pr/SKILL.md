---
name: navara-commit-and-pr
description: >
  Commit messages and Pull Requests for this repository: write one-line commit
  messages, write the PR description from .github/pull_request_template.md,
  capture and attach screenshots or videos, open the PR as a draft against
  maplibre/navara, and mark it ready after the user approves. Use when asked to
  commit, or to create, open or write a PR (description) for the current branch.
---

# Commits and Pull Requests

## Flow

1. Check the branch is committed and pushed (`git status`, `git ls-remote origin <branch>`). Commit only if the user asks. If `git commit` fails at signing (e.g. `1Password: agent returned an error`), retry once, then ask the user to unlock or approve it; never pass `--no-gpg-sign` or change the signing config.
2. Write the description in English from `.github/pull_request_template.md` (rules below).
3. Capture the screenshots (see below).
4. Open the PR as a **draft**.
5. Show the user the URL and a summary of the description. Run `gh pr ready <n> --repo maplibre/navara` only after they approve.

## Commit messages

Same principle as the description: the subject alone should tell what the commit changes. The code holds the details.

- One line, as a Conventional Commit: `<type>(<scope>)?: <what changed>`, e.g. `feat: support instanced 3D Tiles`, `fix: keep picking on shared geometries`.
- No body unless something cannot be read from the diff, such as a breaking change to call out. Trailers such as `Co-Authored-By` are fine.
- One logical change per commit, so that one line can describe it.

## Writing the description

Keep it terse: a reviewer should see what changed at a glance. Leave implementation details to the code, and say each thing in one section only.

Describe the final diff, not the conversation; the reviewer never saw the chat. A requirement the user added later folds into the item it refines instead of becoming a nested bullet. Leave out who asked for what, code-level trial and error, and bugs introduced and fixed within the branch.

- **Title:** a Conventional Commit, e.g. `feat: support instanced 3D Tiles`. Use `feat!:` for a breaking change.
- **Overview:** state the problem and how the PR solves it, in two or three sentences. Do not list what was implemented; the next section does that. Put a related issue URL first when there is one.
  - For a complex feature or a performance change, add the approaches that were compared and why this one was chosen, with the measurements for a performance change. A future reader needs this to know what was already ruled out.
- **What I've done:** bullets for spec changes, and for public APIs added, changed or removed. Write "No public API change." when that is the case.
  - One sentence per bullet, with any qualification inside it: "Supported I3DM (`.i3dm`) content, including its batch table and glTF referenced by URI (`gltfFormat: 0`)." Nest bullets only to enumerate parallel items.
  - Leave docs updates to the checklist and the pages used for checking to "How I tested".
- **What I haven't done:** known limitations and out-of-scope items, as bullets. Leave it empty when there are none.
- **How I tested:** name the example pages and datasets, and the unit-test targets.
- **Which point I want you to review particularly:** leave it empty unless the user names something.
- **Screenshots:** images or videos that show the change at a glance. They are the reviewer's evidence of what changed and that it works, so a fix gets them as well as a feature.
  - Use a video when the change is about motion or interaction: picking, hover, animation, camera movement, loading over time. Use images for a static result.
  - Add a before/after only when "before" shows something. When "before" rendered nothing, say so in one line instead.
  - A fix too small to see from the page's default view: frame the view where it shows (move the camera close to the error, mark the expected position), or show the page's own readout of the fixed value (a pick result, a value in the debug pane).
  - A fix for a crash or an error: "before" is what the page shows of it (the missing result, the error in the page or console), "after" is the working result.
  - Capture on a page and dataset in the repository, so that the reviewer can reproduce the shot. When the page cannot show the change, add a debug page or a dataset to its list in the same PR.
  - Write "No visual change" only when no page can show the change (build, CI or docs-only changes).
  - Lay the images out with a Markdown table and put the captions in the table cells. Do not draw text onto the images.
  - Reference each image or video by its local path; `--attach` uploads it (see "Attaching images and videos").
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

### Videos

- Record with `browser.newContext({ viewport: size, recordVideo: { dir, size } })`. The WebM file is written when the context closes; get its path from `page.video().path()`.
- Log the seconds elapsed since context creation when the page is ready, then play the interaction. Use `page.mouse.move(x, y, { steps: 10 })` before each click, so the cursor's path is visible, and wait about 1.2 s between steps.
- Cut the loading time and convert to MP4, since Safari does not play WebM:
  ```bash
  ffmpeg -ss <ready> -to <end> -i page@*.webm -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart -an out.mp4
  ```
- Keep it short, around 10 s. Check it with a contact sheet: `ffmpeg -i out.mp4 -vf "fps=1/3,scale=640:-1,tile=2x2" -frames:v 1 contact.png`.

## Attaching images and videos

A recent `gh` (2.105.0 has it; check `gh pr create --help`) uploads images and videos with `--attach` on `pr create`, `pr edit` and `pr comment`.

- In the body, reference each image by its local path in Markdown syntax, e.g. `![i3dm-pick](./shots/i3dm-pick.png)`. `gh` does not rewrite the `src` of an `<img>` tag: that reference stays broken and the image is appended to the body instead.
- Pass the same file with `--attach`. `gh` uploads it and rewrites the reference to the uploaded asset.
- A path in `--body-file` is relative to that file's directory.
- An attached file that the body does not reference is appended to the end of the body.
- A video is referenced the same way, `![name](./video/out.mp4)`. `gh` rewrites it to a bare asset URL on its own line, which GitHub renders as a player, so put the reference on its own line, not in a table cell.

## Opening the PR

`origin` is the user's fork, and `gh` resolves the repository to `maplibre/navara`. Pass both the repository and the fork's head explicitly:

```bash
gh pr create --repo maplibre/navara --draft --base main \
  --head <fork-owner>:<branch> --title "<title>" --body-file <body.md> \
  --attach ./shots/a.png --attach ./shots/b.png
```

To change the description later, use `gh pr edit <n> --repo maplibre/navara --body-file <body.md>`, adding `--attach` for any new images.
