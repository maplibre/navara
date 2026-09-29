---
name: navara-supported-status
description: >
  Universal rules for documenting feature support status across all Navara
  documentation. Use when documenting what features are supported, partially
  supported, or not supported in any Navara package or system.
---

# Navara Feature Support Documentation Standard

Rules for documenting feature support status across all Navara documentation.

## Icon Usage Rules

### ✅ Fully supported
- Complete implementation, no limitations
- Format: `{ "status": "✅" }`

### ⚠️ Partial support
- **REQUIRED**: Must include specific issue description
- Format: `{ "status": "⚠️ [specific issue]" }`
- Examples:
  - `"status": "⚠️ Evaluated once at initialization"`
  - `"status": "⚠️ No animation support"`
  - `"status": "⚠️ Performance degrades with >1000 features"`

### ❌ Not supported
- Not implemented
- Format: `{ "status": "❌" }`

## JSON Structure

Basic feature:
```json
{
  "feature-name": { "status": "✅ | ⚠️ [issue] | ❌" }
}
```

Hierarchical feature:
```json
{
  "feature-name": {
    "status": "⚠️ Partial support",
    "properties": {
      "property-name": { "status": "✅ | ⚠️ [issue] | ❌" }
    }
  }
}
```

## Parent/Child Status Rules

- Parent = `⚠️ Partial support` if ANY child is ❌ or ⚠️
- Parent = `✅` only if ALL children are ✅
- Parent = `❌` if entire feature not implemented

## Checklist

- [ ] Every ⚠️ includes specific issue description
- [ ] Parent status reflects child status
- [ ] All features use `{ "status": "..." }` object format (no plain strings)
- [ ] Issue descriptions are specific (< 80 chars)

## Example: MapLibre Style Support

MapLibre support is documented in `docs/src/content/docs/maplibre_style/supported.json` following these rules. See that file for reference structure.
