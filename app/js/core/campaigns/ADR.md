# ADR: Sampling Campaign Management

**Status**: Accepted
**Date**: 2026-02-27
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT — Environmental & Occupational Core Byte Tools

---

## Context

Environmental monitoring follows a campaign-based workflow: field teams
execute planned sampling events at defined locations. Each campaign has:

- A date range (start/end).
- A set of planned readings (element + parameter pairs).
- Execution status (complete, partial, missed).

The platform needs campaign management that tracks planned vs executed
readings to compute investigation completeness (EIS Cp axis).

---

## Decision

### 1. In-Memory State Manager

Campaigns are stored in a module-level closure (array + counter).
No external state store or ORM — pure JavaScript state management.

### 2. Campaign Schema

```javascript
{
  id: 'campaign-1',
  name: 'Q1 2026 Monitoring',
  startDate: '2026-01-15',   // ISO 8601
  endDate: '2026-01-20',
  teamId: null,               // Future: team assignment
  visible: true,              // Display in UI
  notes: '',
  plannedReadings: [
    { elementId: 'el-1', parameterId: 'benzene', value: null },
    { elementId: 'el-2', parameterId: 'toluene', value: 12.5 }
  ]
}
```

### 3. Planned vs Executed Completeness

`getCampaignCompleteness(campaignId, allElements)` returns:

```javascript
{ planned: 10, executed: 7, ratio: 0.7, details: [...] }
```

A reading is "executed" when its value is non-null.
This ratio feeds directly into the EIS Cp (Completeness) axis.

### 4. Visibility Toggle

Campaigns can be hidden from the UI without deletion, enabling
temporal filtering of the observation dataset.

### 5. File Tree

```
core/campaigns/
  ADR.md      # This document
  manager.js  # Campaign CRUD, planned readings, completeness
```

---

## Consequences

### Positive

- Lightweight: no dependencies, no storage overhead.
- Direct integration with EIS Cp axis via completeness ratio.
- Planned readings enable proactive monitoring planning.
- Simple CRUD makes it easy to extend.

### Negative

- No built-in persistence (handled by IO module during export).
- No multi-user support (single-user in-browser model).
- No campaign templates or recurrence patterns.

---

## Related ADRs

- **ADR-020** (EIS) — Cp axis consumes completeness ratio
- **ADR-023** (Optimization) — Campaign cost integration for budget constraints
