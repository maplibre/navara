# Documentation Update Checklist

Scenario-based checklists for specific documentation updates. For conventions, see [NAVARA_THREE_INSTRUCTIONS.md](./NAVARA_THREE_INSTRUCTIONS.md).

**Example app location:** `web/navara_three/example/`

---

## Adding New APIs

### New Function

- [ ] Read implementation for exact signature
- [ ] Identify the correct documentation page and section
- [ ] Add documentation in logical order
- [ ] Verify types match exactly
- [ ] Check example apps for references: `navara_three/example`

### New Method on a Class

- [ ] Read implementation for exact signature
- [ ] Identify category (Lifecycle, Layers, Camera, Terrain, etc.)
- [ ] Add to appropriate section
- [ ] Update method summary tables if present
- [ ] Check example apps for references: `navara_three/example`

### New Property

- [ ] Read property definition for type and default
- [ ] Add documentation with Type, Description, Default, Example
- [ ] Note if read-only
- [ ] Mark it with `:since[X.Y.Z]` (see [Unreleased Features](#unreleased-features))

### New Event

- [ ] Read event handler type
- [ ] Add documentation with Handler Type, Description, Example

---

## Adding New Layers

### New Layer (Mesh / Light / Effect)

- [ ] Read implementation for config type
- [ ] Update the corresponding index page
- [ ] Create new file with frontmatter
- [ ] Document all config properties
- [ ] Add basic and advanced examples
- [ ] If it belongs to a plugin package, verify it is registered in the plugin

### New Resource Layer Type

- [ ] Read type definition
- [ ] Update the resource layer index page
- [ ] Create new `*-layer.md` file with all properties
- [ ] Document nested types
- [ ] Add complete usage examples

### New Material Type

- [ ] Read material implementation/type from source or WASM types
- [ ] Update the resource layer index page
- [ ] Create new `*-material.md` file with properties
- [ ] Document styling options
- [ ] Add visual examples if possible

---

## Modifying Existing APIs

### Property Changed (Type or Default)

- [ ] Read updated implementation
- [ ] Update **Type:** if changed
- [ ] Update **Default:** if changed
- [ ] Update examples using old type/default
- [ ] Check related documentation for consistency

### Signature Changed

- [ ] Read new signature from implementation
- [ ] Update code block with new signature
- [ ] Update **Parameters:** section
- [ ] Update **Returns:** section
- [ ] Update all examples
- [ ] Check example apps for usages: `navara_three/example`

### API Removed

- [ ] Verify actually removed (not renamed)
- [ ] Remove documentation section
- [ ] Remove from index tables
- [ ] Check references in other docs
- [ ] Add deprecation notice if applicable
- [ ] Update example apps if affected: `navara_three/example`

---

## Validation

Run after any update:

- [ ] Valid YAML frontmatter
- [ ] No broken markdown formatting
- [ ] All code blocks have language specified
- [ ] Types match implementation exactly
- [ ] Examples are complete and runnable
- [ ] English text is grammatically correct
- [ ] Internal links work
- [ ] Sidebar order numbers don't conflict

---

## Code Pattern Templates

### Imports

```typescript
// Main package
import ThreeView from "@navaramap/three";
import ThreeView, { LayerType } from "@navaramap/three";

// API utilities
import { initNavaraApi, functionName } from "@navaramap/three-api";

// Plugin
import { DefaultPlugin } from "@navaramap/three-default-plugin";
```

### Initialization

```typescript
const view = new ThreeView({ container: element });
view.addPlugin(new DefaultPlugin());
await view.init();
```

### Layer Addition

```typescript
const layer = view.addLayer<LayerType>({
  type: "mesh",
  config: { /* ... */ },
  position: { x: 0, y: 0, z: 0 },
});
```

### Event Handling

```typescript
// Subscribe
const unsubscribe = view.on("eventName", (param) => {
  // handler
});

// Unsubscribe
unsubscribe();
```

---

## Documentation Formats

### Key Rules

- Parameters section: No type annotations (already in Syntax); **omit entirely if no parameters** (do not write "None")
- Returns section: Omit for `void` functions; no type prefix for others
- Examples: Always include imports; show complete, runnable code

### Frontmatter

```yaml
---
title: PageTitle
description: Brief description for SEO
sidebar:
  order: 1  # Lower numbers appear first
since: 0.3.2  # Optional, see "Unreleased Features" below
---
```

### Unreleased Features

`main` is ahead of the latest npm release, so mark a feature that the latest release (`site/released-version.json`) lacks with that version + 0.0.1, e.g. `0.3.2` while `0.3.1` is the latest. Any later release, `0.3.2` or `0.4.0`, ships it. Until then the docs show a **Nightly** badge linking to the nightly install instructions, and once it is released the badge disappears, so the markers need no cleanup.

- A whole new page: `since: 0.3.2` in the frontmatter (badges the title and the sidebar link). Repeat it in every translation.
- A section or sentence in an existing page: `:since[0.3.2]` at the end of the heading or paragraph, e.g. `### shadowSoftness :since[0.3.2]`. It works in `.md` and `.mdx`, and the heading anchor stays the same after the release.
- Write the version as `X.Y.Z` with no `v`. A malformed version fails the build.
- A feature no release is planned to ship yet, such as a package under `web/experimental/` (published only in nightlies), takes `nightly` in place of the version: `since: nightly` or `:since[nightly]`. Its badge stays until the marker is changed to the version of the release that ships it. Being nightly-only is shown by this badge alone, not by an "Experimental" callout or title suffix.

### Callouts

```markdown
:::note
Important information
:::

:::tip[Recommended]
Recommended approach
:::

:::warning
Caveat or limitation
:::
```

---

## Documentation Templates

### Function

```markdown
### functionName()

Description of the function.

**Syntax:**

\`\`\`typescript
functionName(param: Type): ReturnType
\`\`\`

**Parameters:**

- `param`: Description of the parameter

**Returns:**

Description of the return value

**Example:**

\`\`\`typescript
const result = functionName(value);
\`\`\`
```

### Property

```markdown
### propertyName

**Type:** `TypeName`

**Description:** Description of the property

**Default:** `defaultValue`

**Example:**

\`\`\`typescript
view.propertyName = newValue;
\`\`\`
```

### Event

```markdown
### eventName

**Description:** Description of the event

**Handler Type:**

\`\`\`typescript
(param: ParamType) => void
\`\`\`

**Parameters:**

- `param`: Description of the parameter

**Example:**

\`\`\`typescript
view.on("eventName", (param) => {
  // handler
});
\`\`\`
```

### Descriptor Type (Index Entry)

```markdown
| [LayerName](./layer-name) | `ConfigType` | Description of usage |
```
