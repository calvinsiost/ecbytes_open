# ADR: Model Differencing & Merge

**Status**: Accepted
**Date**: 2026-02-27
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT — Environmental & Occupational Core Byte Tools

---

## Context

ECO1 model keys can be shared and imported by different users. When
importing a model into an existing workspace, conflicts arise:

- New elements added by collaborators.
- Modified observations with different values.
- Removed elements that still exist locally.

The platform needs structural comparison and selective merge capabilities
analogous to `git diff` + `git merge` for environmental data models.

---

## Decision

### 1. Section-Based Diffing

Models are compared section by section:

| Section                            | Strategy                       |
| ---------------------------------- | ------------------------------ |
| project, coordinate                | Flat field-by-field comparison |
| elements, edges, campaigns, scenes | ID-indexed collection diffing  |
| families                           | Keyed object comparison        |
| contracts, wbs                     | ID-indexed (governance)        |

### 2. ID-Based Matching

Collections are indexed by `id` field into O(1) lookup Maps.
Comparison is stable across reordering — element position changes
do not produce false diffs.

Change types: `added`, `removed`, `modified`, `unchanged`.

### 3. Decision Map for Merge

Users make per-change decisions:

```javascript
decisions = {
    'elements.el-1': 'A', // Keep local version
    'elements.el-2': 'B', // Accept remote version
    'elements.el-3.data.x': { custom: 42 }, // Custom resolution
};
```

### 4. Delta Log

Every merge produces an immutable delta log with:

- Decision taken (A/B/custom) per path.
- Human-readable change descriptions.
- Summary statistics (added, removed, modified counts).

The delta log enables audit trail for regulatory compliance.

### 5. Dependency Detection

Cross-references between sections are tracked:

- Orphan edges (edges referencing removed elements).
- Orphan observations (obs in campaigns for removed elements).
- Dependency warnings shown to user before merge confirmation.

### 6. File Tree

```
core/diff/
  ADR.md      # This document
  engine.js   # diffModels(), mergeModels(), buildDelta()
  helpers.js  # deepEqual, deepClone, buildIdMap, describePath
```

---

## Consequences

### Positive

- Selective merge prevents data loss during collaborative workflows.
- Delta log provides audit trail for regulatory compliance.
- ID-based matching is robust against collection reordering.
- Pure functions with no side effects — easy to test.

### Negative

- JSON-based deep clone limits to serializable data (no functions, Dates).
- No three-way merge (only pairwise A vs B).
- No automatic conflict resolution strategy (user must decide).

---

## Related ADRs

- **ADR-008** (IO) — ECO1 format structure consumed by diff engine
- **ADR-009** (Blockchain) — Hash chain integrity verified before merge
