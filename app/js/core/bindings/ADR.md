# ADR 8: Field Binding / Reference System

**Project:** Arquitetura Open-Source de Gemeos Digitais Ambientais e Ocupacionais com Blockchain e Automacao via Machine Learning e Grandes Modelos de Linguagem -- Aplicacoes em Mineracao
**Author:** Calvin Stefan Iost, 2026
**Brand:** ecbyts / ECBT (Environmental & Occupational Core Byte Tools)
**Status:** Accepted
**Date:** 2026-03-04
**Atualizado:** 2026-03-26

## Context

Environmental digital twins contain deeply interrelated entities: monitoring
wells have constructive profiles (screens, pre-filters) with depth intervals;
observations sample at specific depths that often correspond to those
construction elements; campaign dates define when observations were taken.

Previously, each observation stored its own fixed values for position (x, y, z),
date, parameter, and other fields. Users had to manually keep these values
synchronized with the source entities -- for example, typing the screen midpoint
depth as the observation Z coordinate. This was error-prone and fragile.

## Decision

### Generic Field Binding System

Any CRUD field in the model can operate in two modes:

1. **Manual** (default): User enters the value directly. Current behavior.
2. **Bound**: Field references another entity's property via a `BindingRef`.
   The value is resolved lazily at read time from the source entity.

### BindingRef Schema

```js
{
    targetType: "element" | "campaign" | "calculator" | "observation",
    targetId: string,           // ID of the target entity
    targetPath: string,         // Dot-path with selector support
    transform: string,          // "identity" | "negate" | "midpoint" | "offset"
    transformArgs: object,      // Transform-specific arguments
    resolvedValue: any,         // Cached last-good value (fallback)
    resolvedAt: string,         // ISO timestamp of last resolution
    status: "ok" | "broken" | "stale" | "circular"
}
```

### Path Navigation

`targetPath` supports three segment types:

- Property access: `data.position.z`
- Numeric index: `elements[4]`
- Selector: `elements[type=screen]` (finds first match by property value)

Selectors are preferred over numeric indices because they survive array
reordering (e.g., well construction elements being rearranged).

### Lazy Resolution

Bindings resolve at **read time**, not write time:

- When the UI renders a bound field, it calls `resolveObservation()`
- When export builds the model, it calls `resolveAllBindings()`
- When import loads a model, it calls `resolveAllBindings()` after all
  entities are loaded

This eliminates the need to intercept every mutation in the codebase.
The resolved value is cached in `resolvedValue` for performance and as
a fallback when the binding target is deleted.

### Cycle Detection

The resolver maintains a visited set during resolution chains. If a
binding targets another bound field, and that chain leads back to the
original field, the status is set to `"circular"` and resolution stops.
Maximum depth: 10 levels of indirection.

### Observation IDs

Each observation receives a stable `id` (generated via `generateId('obs')`).
Previously, observations were identified by array index, which changed on
delete/reorder. Stable IDs are required for observations to be binding
targets (`targetType: "observation"`).

## Rationale

- **Lazy over eager resolution**: Vanilla JS has no reactive framework.
  Intercepting all mutation points (handlers, LLM executor, import,
  drag-and-drop, ingestion wizard) is fragile and maintenance-heavy.
  Lazy resolution centralizes the logic in the read path.
- **String paths over object references**: Paths serialize naturally in
  JSON/ECO keys without circular reference issues. They are human-readable
  for debugging.
- **Selector syntax over indices**: `[type=screen]` is stable across
  profile edits. `[4]` breaks when construction elements are reordered.
- **Transform functions**: Well depths are positive-downward but Three.js
  Z is negative-downward. The `negate` transform handles this without
  special-casing in the resolver.
- **Generic over observation-specific**: The same engine works for any
  entity (elements, campaigns) binding any field. This avoids parallel
  implementations and enables future use cases (element positions bound
  to GIS coordinates, campaign dates bound to contracts, etc.).

## Consequences

- All CRUD fields can be manually entered or bound to model entities.
- Users can bind observation depth to well screen midpoint, date to
  campaign, value to calculator metric, etc.
- Bound fields auto-update when source data changes (on next read).
- Broken bindings (deleted targets) preserve last-known values.
- Circular bindings are detected and flagged, not infinite-looped.
- The system is backward-compatible: observations without `bindings`
  work exactly as before.
- ECO1/ECO4 export/import requires no encoder/decoder changes -- bindings
  serialize as part of the normal JSON payload.

## Files

- `resolver.js` -- Path navigation, binding resolution, model-wide sweep
- `transforms.js` -- Transform function registry (identity, negate, midpoint, offset)
- `ADR.md` -- This document
