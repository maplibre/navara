# Documentation Update Guide

Instructions for updating documentation to match the latest API implementation.

## Update Workflow

### Step 1: Identify Changes

Compare the TypeScript implementation against the existing documentation. The source of truth is always the code — read the actual exports, types, and JSDoc comments.

### Step 2: Find the Corresponding Documentation

Each web package maps to a documentation section under `docs/src/content/docs/`:

| Package | Docs Section |
|---------|-------------|
| `web/navara_three/` | `three/` |
| `web/navara_three_api/` | `three/API/` |
| `web/navara_three_default_descs/` | `three_default_descs/` |
| `web/navara_three_default_plugin/` | `three_default_plugin/` |
| `web/navara_three_plugins/` | `three_plugins/` |
| `web/navara_material_schema/` | `three_plugins/materialschemaplugin.md` (documented with the plugin that reads it) |
| `web/wasm/` | `engine/` |

Navigate the docs directory to find the matching page, or create a new one following the existing structure.

### Step 3: Update Documentation

1. Read implementation file for exact API
2. Read existing documentation for format
3. Make minimal, targeted edits
4. Maintain existing structure and style

### Step 4: Verify Quality

- [ ] Valid YAML frontmatter with `title`, `description`, `sidebar.order`
- [ ] All code blocks specify language
- [ ] Signatures match implementation exactly
- [ ] Examples are complete and runnable
- [ ] English descriptions, English technical terms
- [ ] No broken links or trailing whitespace

---

## Conventions

### Language

- **Default locale (root):** English
- **Translations:** Locale subdirectories (e.g., `ja/` for Japanese). See [TRANSLATION_GUIDE.md](./TRANSLATION_GUIDE.md)
- **Technical terms:** Always English (`ECEF`, `Vector3`, `LayerHandle`)

### Do

- Verify types from TypeScript source
- Add new examples alongside existing ones
- Follow existing document organization
- Keep API names and types in English
- Only document public APIs

### Don't

- Guess parameter types
- Remove existing examples
- Change overall structure
- Translate technical terms
- Document private/internal APIs
- Break existing links

---

## Referencing Types from WASM `.d.ts`

Material types and other WASM-generated types are defined in `.d.ts` files under `web/wasm/`. These are the source of truth for documenting material properties.

### How WASM types are structured

WASM-generated classes have `free()`, `Symbol.dispose`, and getter/setter pairs:

```typescript
// web/wasm/navara_engine/navara_wasm.d.ts
export class BillboardMaterial {
  free(): void;
  [Symbol.dispose](): void;
  get color(): number | undefined;
  set color(value: number | null | undefined);
  /**
   * Emissive glow intensity (default: 0.3 when Bloom enabled)
   */
  get emissiveIntensity(): number | undefined;
  set emissiveIntensity(value: number | null | undefined);
}
```

### How WASM types are consumed in TypeScript

WASM classes are **never exposed directly** in public APIs. Instead, the codebase uses `NormalizeWASMClass<T>` (from `@navaramap/core`) to strip WASM-isms (`free()`, `Symbol.dispose`, getter/setter methods) and produce plain TypeScript types:

```typescript
type NormalizeWASMClass<C> = ExtractProperties<RemoveFreeRecursively<C>>;
```

When documenting a material, the documented type should reflect the **normalized** shape (plain object with optional properties), not the raw WASM class.

### Extracting documentation from `.d.ts`

1. **Focus on getters** — Ignore setters; extract property names, types, and JSDoc comments from getter definitions

2. **Convert JSDoc to documentation format:**
   ```typescript
   /**
    * Avoid overlapping with the globe surface.
    */
   get offsetDepth(): boolean | undefined;
   ```
   Becomes:
   ```markdown
   **Description:** Avoids overlapping with the globe surface.
   ```

3. **JSDoc patterns to capture:**
   - Default values: `"default: 0.3 when Bloom enabled"`
   - Experimental warnings: `"**Experimental*:"`
   - Dependencies: `"Need to enable \`transparent\`"`

4. **Missing JSDoc** — Infer description from property name and type

---

## Related Documents

- [NAVARA_THREE_UPDATE_CHECKLIST.md](./NAVARA_THREE_UPDATE_CHECKLIST.md) - Scenario-based checklists for specific update types
