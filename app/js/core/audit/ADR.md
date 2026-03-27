# ADR: ESG Audit & Greenwashing Detection

**Status**: Accepted
**Date**: 2026-02-27
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT — Environmental & Occupational Core Byte Tools

---

## Context

Environmental reports submitted to regulators (IBAMA, CETESB) and stakeholders
may contain inaccuracies — ranging from unintentional omissions to deliberate
greenwashing. Manual auditing is slow, subjective, and scales poorly.

ECBT needs an automated audit engine that evaluates environmental investigation
reports for statistical anomalies, methodological quality, and narrative
consistency.

---

## Decision

### 1. Three-Layer Audit Architecture

The audit engine uses a progressive verification pipeline:

**Layer 1 — Statistical Analysis (sync)**

- Benford's Law first-digit test on observation values.
- Chi-squared significance test against expected distribution.
- Outlier detection via z-score thresholds.
- Detects fabricated data (uniform or biased digit distributions).

**Layer 2 — Rule-Based Investigation Quality (sync)**

- Domain-specific checks against Brazilian environmental standards:
    - Outdated field methods (manual auger, PID-only, etc.).
    - Hydrostratigraphic integrity (wells crossing multiple units).
    - Spatial coverage density (monitoring point gaps).
    - Temporal coverage (campaign frequency, seasonal representation).
    - Parameter completeness per contamination type (CONAMA 420/2009).
- 5 contamination type profiles: BTEX, PAH, chlorinated, heavy metals, pesticides.

**Layer 3 — LLM Semantic Validation (async, optional)**

- Extracts claims from report text.
- Cross-references against element data and observations.
- Detects vague language patterns (greenwashing indicators).
- Graceful degradation: runs rule-based fallback if LLM unavailable.

### 2. Reliability Index

Findings from all layers are aggregated into a 0-100 reliability score:

```
score = 100 - Σ(penalty × weight)
weights: critical=15, high=10, medium=5, low=2
grades: A(≥80), B(≥65), C(≥50), D(≥35), F(<35)
```

### 3. Finding Schema

Each finding follows a uniform structure:

```javascript
{ severity: 'critical|high|medium|low', category: AuditCategory, finding: String, recommendation: String }
```

12 audit categories defined in `AuditCategories` enum covering data integrity,
methodology, coverage, parameters, temporal gaps, and narrative consistency.

### 4. File Tree

```
core/audit/
  ADR.md                    # This document
  benford.js                # Benford's Law + chi-squared test
  greenwashing.js           # 3-layer orchestrator + reliability index
  investigationQuality.js   # Domain checks (methods, coverage, parameters)
```

---

## Consequences

### Positive

- Automated compliance verification reduces manual review burden.
- Statistical tests are objective and reproducible.
- Graduated severity allows prioritized remediation.
- LLM layer adds semantic understanding without being a hard dependency.

### Negative

- Benford's Law assumes large sample sizes; small datasets may produce
  false positives.
- Rule-based methods reflect Brazilian regulatory context; international
  standards require additional rule sets.
- LLM validation adds latency and cost (API tokens).

---

## Related ADRs

- **ADR-020** (EIS) — Quality scoring axes inform audit criteria
- **ADR-004** (Validation) — Regulatory limits used in parameter checks
