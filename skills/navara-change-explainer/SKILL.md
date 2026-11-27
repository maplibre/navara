---
name: navara-change-explainer
description: >
  Explain a change to a person as one page they can read in a few minutes and
  judge: diagrams of how it works, the public API and how to call it, the
  approaches compared, references, and points to evaluate. Use when asked to
  explain a branch, a PR or an API design to a human, to make a change easy to
  understand or review, or to draw how a feature works.
---

# Change explainer

The reader is a person who has to understand a change and decide about it:
the author before a PR, a reviewer, a maintainer. They never saw the session.
The page does the explaining; the chat reply only links to it.

Publish the page as a private Artifact (a plain HTML page; start from
[references/template.html](references/template.html)), written in the
reader's language. Keep republishing the same file as the change moves, so
the link stays the same.

## Gather before writing

- The diff, staged and unstaged: `git status`, `git diff main --stat`,
  `git diff --cached`. Read the public exports (`web/*/src/index.ts`) and the
  docs pages the diff touches: they state the contract the reader evaluates.
- The internals from `guide/`, the design history from the plan files and
  design notes of the work (rejected approaches, prior art, measurements).
- Check every statement against the code and keep its `file:line`. A
  mismatch between docs, types and code is a finding, not something to smooth
  over in the text.

## Page outline

In this order, leaving out a section the change has nothing for:

1. **Header**: what changed and its core idea, in two or three sentences.
2. **Overview**: a `flowchart` of the data or control flow across the layers
   the change touches (app → public API → internals → GPU or events).
3. **One operation end to end**: a `sequenceDiagram` of a typical call, with
   the frame or event in which each step happens.
4. **States**: a `stateDiagram-v2` for each thing with a lifecycle (one
   feature's value, an aggregate event, a playback). See
   [Statecharts](#statecharts).
5. **Rules**: the decisions the reader must know to predict behavior, as a
   decision `flowchart` or short cards.
6. **Public API**: a table of what is added or changed (name, package, role),
   then the key types.
7. **Usage**: one minimal snippet per use case, taken from docs or examples
   that run.
8. **Approaches considered**: a table of option, what it was, why it was not
   taken. Include approaches implemented and then replaced.
9. **References**: the prior art, each with what was taken from it.
10. **Evaluation points**: one card per point with a tag: *Fix* (a fact that
    is wrong), *Decide* (a trade-off for the reader), *Good* (a strength the
    decision rests on). When a point is resolved later, retag it *Fixed* or
    *Separate PR* and say what changed.

## Diagrams

Write Mermaid in `<pre class="mermaid">` blocks: Artifacts render them
without a library.

- **Keyword IDs break parsing.** Keywords match case-insensitively, so
  `participant Loop` is read as `loop`. Avoid `loop`, `end`, `alt`, `opt`,
  `par`, `note`, `state` and `direction` as IDs.
- **Labels**: no `{}` or `;`. Break lines with `<br/>`. Inside HTML, write
  `<<choice>>` as `&lt;&lt;choice&gt;&gt;`.
- **Two edges between the same pair of nodes stack their labels** on top of
  each other. Keep one edge per pair and move the rest to cards under the
  diagram.
- **Self-loops on a composite state** draw across the diagram. Describe them
  under it instead.

## Statecharts

Draw what the reader sees, following the
[statechart skill](https://github.com/cursor/plugins/tree/main/pstack/skills/statechart):

- Name states by what the reader can observe ("Waiting for its delay"), never
  by variable names.
- Label a transition with what happens ("a new value arrives"), and put its
  condition in brackets ("[with a timing]").
- Keep to about 20 arrows. Merge states that behave the same, and list the
  transitions left out under the chart.
- Before drawing a transition, find it in the code. Drawing the chart is a
  review: an edge that cannot be found, or a state that cannot be left, is an
  evaluation point.

## Check before publishing

Render every diagram and look at the result:

```bash
node skills/navara-change-explainer/scripts/render-check.mjs page.html \
  --section "#states" --out shot.png
```

It parses each `pre.mermaid` with Mermaid (Playwright from
`web/navara_three`), prints `ok` or the parse error per diagram, and
screenshots the section. Read the screenshot: a diagram that parses can still
have overlapping labels.

## Hand-off

Reply with the link and the evaluation points that need a decision, one line
each. When the reader decides, update the page in the same file.
