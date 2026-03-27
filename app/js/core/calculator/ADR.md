# ADR: Environmental Metrics Calculator Engine

**Status**: Accepted
**Date**: 2026-02-27
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT — Environmental & Occupational Core Byte Tools

---

## Context

Environmental monitoring produces diverse metrics: average concentrations,
compliance ratios, trend directions, parameter relationships. Each metric
requires filtering by element, parameter, campaign, and geographic scope
before calculation.

A generic, extensible calculation engine is needed that:

1. Supports multiple calculation types (aggregation, rules, ratios).
2. Allows flexible filtering at both element and observation levels.
3. Integrates with the NN module for feature extraction.
4. Persists user-defined calculations across sessions.

---

## Decision

### 1. Six Calculation Types

| Type           | Description                                       | Example                                        |
| -------------- | ------------------------------------------------- | ---------------------------------------------- |
| **Metric**     | Single aggregation over filtered values           | Average benzene concentration in wells         |
| **Rule**       | Compound boolean logic (AND/OR) per element       | Benzene > 5 AND Toluene > 50                   |
| **Ratio**      | Division of two parameter aggregations            | BTEX / TPH ratio with threshold                |
| **Hypothesis** | Paired statistical tests (Wilcoxon, t-test, sign) | Remediation efficacy: campaign A vs B          |
| **Background** | Background vs compliance comparison (EPA)         | Upgradient wells vs downgradient wells         |
| **MAC Curve**  | Marginal Abatement Cost curve (generic)           | Cost-effectiveness of remediation alternatives |

### 2. Two-Stage Filter Pipeline

Filters are applied in two stages for maximum flexibility:

**Stage 1 — Element-level**: family, specific element IDs, geographic area.
**Stage 2 — Observation-level**: parameter, campaign, category, variable name.

Filter operators: `is`, `is_not`, `in`, `not_in`.

### 3. Metric Calculations

Supported operations: `sum`, `average`, `min`, `max`, `count`, `latest`,
`change_pct`, `trend` (Mann-Kendall).

### 4. Context Resolution

`contextResolver.js` infers regulatory context from observation variables
and element family:

- Groundwater context for wells with dissolved metals.
- Soil context for soil samples with hydrocarbons.
- Occupational context for emission sources with exposure variables.

8 context rules with family-based fallbacks.

### 5. Element-Scoped Computation

For NN training, `computeCalculatorItemForElement()` restricts evaluation
to a single element, enabling per-element feature vectors without code
duplication.

### 6. Persistence

- State stored in module closure (in-memory).
- Persisted to `localStorage` via `storageMonitor` compatibility check.
- Import/export as JSON for portability.

### 7. File Tree

```
core/calculator/
  ADR.md              # This document
  contextResolver.js  # Variable-to-context inference
  engine.js           # Metric + rule + ratio evaluators
  filterPipeline.js   # Reusable 2-stage filter + value extraction (shared by standalone modules)
  manager.js          # CRUD, persistence, import/export
```

---

## Consequences

### Positive

- Unified engine eliminates per-metric custom code.
- Two-stage filtering composes naturally (AND semantics between stages).
- NN integration via scoped computation avoids separate feature pipelines.
- Random calculator generation aids demo/testing.

### Negative

- Generic filter system is powerful but complex for simple use cases.
- Unit conversion adds overhead (runs per observation).
- localStorage persistence limits to ~5MB shared budget.

---

## Related ADRs

- **ADR-005** (Analytics) — Statistics functions (descriptiveStats, Mann-Kendall)
- **ADR-004** (Validation) — Regulatory thresholds for rule evaluation
