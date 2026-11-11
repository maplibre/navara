---
title: Release Cycle
description: How often Navara is released, and what releases and nightly builds guarantee.
sidebar:
  order: 3
---

## Release cycle

Navara is published to npm in two channels: releases and nightly builds.

### Releases

A minor release comes out roughly once every two weeks to a month. At a minimum, a minor release guarantees that its features work stably. Patch releases that fix bugs come out whenever they are needed, outside this cycle.

Releases are published under the npm `latest` dist-tag, which a plain `npm install` picks up. Each release has its changelog on [GitHub Releases](https://github.com/maplibre/navara/releases).

### Nightly builds

A nightly build is published from the `main` branch whenever it has changed since the previous nightly build. Every change on `main` has passed the automated tests and the dependency security audit, but nightly builds get no further checks before they are published, so their features may not work stably. Their API can also change before the next release. They are for people who want to use the newest features or to give feedback early.

Features that are only in nightly builds are marked **Nightly** in this documentation and in the examples. See [Nightly Builds](../../../three/introduction/install/#nightly-builds) to install them. Report what you find in [Issues](https://github.com/maplibre/navara/issues).
