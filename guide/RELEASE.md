# Release

Semi-automated release flow: changelog drafted from conventional commits →
human review → tag push → CI publishes npm packages + GitHub Release. `main` can
also be published as a nightly on demand ([Nightlies](#nightlies-releaseyml-manual-run)).
Mechanism: [`release.yml`](../.github/workflows/release.yml),
[`cliff.toml`](../cliff.toml),
[`scripts/extract-changelog.mjs`](../scripts/extract-changelog.mjs).

## Steps

1. **Draft the changelog** (on up-to-date `main`):

   ```bash
   cargo make changelog v0.2.0
   ```

   git-cliff prepends a `## v0.2.0 - YYYY-MM-DD` section to CHANGELOG.md,
   grouped by commit type (`feat`/`fix`/`perf`/…, breaking = **BREAKING:**).
   The task also writes `0.2.0` to `site/released-version.json`
   ([Nightly badges](#nightly-badges-in-docs-and-examples)).

2. **Review & edit the section**, then commit it to `main` (via PR) together
   with `site/released-version.json`.
   Keep the `## v0.2.0` heading line intact — CI matches on it.

3. **Push the tag:**

   ```bash
   git tag v0.2.0 && git push origin v0.2.0
   ```

4. **Approve the `npm-publish` environment** in the Actions UI.
   CI then publishes to npm and creates the GitHub Release automatically.

5. **Redeploy the site** (`cargo make deploy-web-site`) so the docs and
   examples drop the Nightly badges of the released version.

## What CI does (`release.yml`, on `v*.*.*` tag)

- `publish` job:
  - fail fast if CHANGELOG.md has no `## vX.Y.Z` section for the tag
  - fail fast if `site/released-version.json` is not the tag's version
  - clean WASM release build (no caches), stamp tag version into all packages
    (lockstep — the tag is the only version source)
  - npm publish via trusted publishing (OIDC) + provenance under `latest`,
    gated by the `npm-publish` environment approval; `web/experimental/` is
    left out
- `github-release` job (only after `publish` succeeds):
  - extract the tag's section from CHANGELOG.md
  - `gh release create --verify-tag --notes-file …`

## Nightlies (`release.yml`, manual run)

Run the `Release` workflow on `main` from the Actions UI, then approve the
`npm-publish` environment. CI publishes all packages, `web/experimental/`
included, as `X.Y.(Z+1)-nightly.N.gSHA` under the `nightly` dist-tag
(`vX.Y.Z` = latest release tag reachable from `main`, `N` = commits since
that tag, `SHA` = abbreviated commit), e.g. `0.3.1-nightly.12.gabc1234`. No
changelog, tag or GitHub Release.

- **Same build and environment as a release**: `npm-publish` accepts `v*`
  tags and `main`, and every run waits for reviewer approval.
- **Skipped when `main` has not moved**: the `changes` job compares `main`
  with the commit of the last successful nightly run and skips the build,
  before asking for approval, when they match. A nightly whose publish failed
  does not count, so the next run retries that commit.
- **One nightly at a time, never cancelled**: a run stopped during its publish
  step would leave the packages at mixed versions, and their exact
  `workspace:*` pins would fail to install. A run triggered meanwhile waits.
- **Versions order correctly**: `0.3.0 < 0.3.1-nightly.N.gSHA < 0.3.1`, and
  `N` grows with each commit on `main`, which cannot be force-pushed. The
  `g` keeps the SHA alphanumeric: an all-digit SHA would compare as a number,
  and one with a leading zero is not valid semver.
- **One version per commit**: a re-run publishes the same version, and
  `pnpm publish -r` skips the packages already published, so a failed nightly
  is retried by re-running it.
- **No per-nightly git tag**: the version is derived from the history, and a
  `v0.3.1-nightly.…` tag would match the `v*.*.*` release trigger.

## Nightly badges in docs and examples

The site is built from `main`, so it documents features that only nightlies
ship. Such features carry the latest release + 0.0.1 at the time they land
(`since` in an example's `meta.ts` or a docs page's frontmatter,
`:since[X.Y.Z]` inline in docs). `site/released-version.json` holds the
version under `latest`, and the docs and examples read it at build time: a
feature whose `since` is newer renders a Nightly badge linking to the
nightly install instructions. Any release reaching that version, followed
by a redeploy, removes the badges, so the markers stay in the sources.
`since` = `nightly` marks what no release is planned to ship yet
([experimental packages](#experimental-packages)); its badge stays until the
marker is changed to a version. Mechanism: [`site/release-status.ts`](../site/release-status.ts).
The file is also served at `https://navara.world/released-version.json`.

## Experimental packages

Packages under `web/experimental/` (e.g. `@navaramap/three-flood-mesh`) are
published in nightlies only, at the nightly version.

- **Built with the workspace**: they depend on Navara with `workspace:*`,
  which pnpm replaces with the exact nightly version, so an experimental
  package always runs on the Navara of the same commit.
- **Excluded from `vX.Y.Z`**: `release.yml` publishes releases with
  `--filter "!./web/experimental/**"`.
- **First publish** is by hand (trusted publishing needs the package to
  exist), with `--tag nightly`, then register `release.yml` / `npm-publish`
  as its trusted publisher and turn on "Require two-factor authentication and
  disallow tokens".
- **Docs and examples** mark it `since: nightly` (`:since[nightly]` inline),
  not "Experimental", so it shows the same Nightly badge as other
  nightly-only features.
- **Joining the release**: move the package to `web/`, and change its
  `nightly` markers to the release version. Keeping its name lets users
  upgrade from a nightly to the next release.

## Security design

- **Human review gate** — CI publishes only the committed CHANGELOG.md; commit
  messages (untrusted input) are never auto-published or regenerated in CI
- **No third-party tools in CI** — git-cliff runs locally only; CI uses
  preinstalled Node + `gh` and a dependency-free script
- **Least privilege per job** — `contents: write` only on `github-release`,
  never alongside the npm OIDC permission (`id-token: write`)
- **No shell interpolation** — notes passed to `gh` as a file (`--notes-file`)
- **Fork guard + `--verify-tag`** — nothing is published from forks, and the
  GitHub Release is created only for an existing tag
- **Every publish is approved** — releases and nightlies share the
  `npm-publish` environment and its single npm trusted publisher. npm cannot
  limit a trusted publisher to a dist-tag, so a second one without reviewers
  would let any workflow change merged to `main` publish under `latest`

## Troubleshooting

- **`No "## vX.Y.Z" section in CHANGELOG.md`** — tag pushed without the
  changelog commit. Delete the tag, commit the section, re-tag.
- **Re-run after failure** — re-runnable from the Actions UI; if the release
  already exists, delete it first before re-running `github-release`.
- **First release** — no prior tag reachable from `main`, so the section
  contains the full history; prune during review. (`v0.0.1` is not an
  ancestor of `main` and does not act as a boundary.)
