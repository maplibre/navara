# Contributing to Navara

Thank you for your interest in contributing! Navara is part of the [MapLibre](https://maplibre.org/) ecosystem, and all kinds of contributions are welcome, including bug reports, documentation, examples, and code.

## Getting in touch

- Open an [issue](https://github.com/reearth/navara/issues) for bugs and feature requests.
- Join the `#maplibre-navara` channel on the [OSM-US Slack](https://slack.openstreetmap.us) for discussions.

## Code of Conduct

This project follows the [MapLibre Code of Conduct](https://github.com/maplibre/maplibre/blob/main/CODE_OF_CONDUCT.md).

## Development setup

Install the required toolchains:

- Rust (stable)
- Node.js (LTS)
- [pnpm](https://pnpm.io/installation)

Install the prerequisites and run the initial setup:

```console
cargo install cargo-make
cargo install cargo-watch
cargo install wasm-bindgen-cli --version 0.2.126
cargo make prepare
```

Then start the dev server with hot reload:

```console
cargo make dev
```

If you are working only on the web side, use `web` instead. It builds the WASM modules in release mode (debug code stripped, so the WASM side runs much faster) while keeping debug web builds:

```console
cargo make web
```

`web` skips wasm-opt to shorten rebuilds. To run the same optimized WASM binaries as the shipped build (e.g. when measuring size or load time), use `web-release` instead:

```console
cargo make web-release
```

See [README.md](README.md) for more details, and the guides under [guide/](guide/) — in particular [guide/ARCHITECTURE.md](guide/ARCHITECTURE.md) — for how the Rust/WASM/TypeScript pieces fit together.

## Before submitting a pull request

Run the full QA suite and make sure it passes:

```console
cargo make build-example  # build examples (Rust + WASM + web)
cargo make format         # format all code (Rust + TypeScript)
cargo make lint           # lint with auto-fix
cargo make test           # all tests (Rust + TypeScript)
```

Note that WASM binaries are consumed by `web/`, so a Rust-only change can still break web builds and tests — always run the web build after Rust changes.

## Pull requests

- Work on a fork and open a pull request against `main`. PRs are squash-merged.
- Fill in the pull request template: a clear description, how you tested, and links to related issues.
- Add tests for behavior changes, and update the documentation when the public API changes.
- If you add or update an example in `web/navara_three/example`, take a screenshot: `pnpm navara_three screenshots {PAGE_NAME}`.

## Licensing

Navara is dual-licensed under Apache-2.0 and MIT. Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
