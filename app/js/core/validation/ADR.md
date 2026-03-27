# ADR-004: Regulatory Validation and Outlier Detection

**Status**: Accepted (updated 2026-02-28)
**Date**: 2026-02-22
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT -- Environmental & Occupational Core Byte Tools

## Context

Environmental monitoring data must be validated against Brazilian regulatory
standards before it can inform remediation decisions. Invalid data (wrong
units, transcription errors, CAS mismatches) can lead to incorrect compliance
assessments. The platform must automate this validation at data entry, covering
both environmental and occupational health domains.

The Brazilian CONAMA 420/2009 framework defines three regulatory tiers:

- **VR** (Valor de Referencia de Qualidade) -- natural background concentration
- **VP** (Valor de Prevencao) -- prevention threshold requiring monitoring
- **VI** (Valor de Intervencao) -- intervention threshold requiring remediation

Site-specific risk assessments may also establish CMA (Concentracao Maxima
Aceitavel) values per campaign. The system must support unlimited threshold
types beyond the fixed VR/VP/VI trio.

## Decision

### CAS Number Validation

Every chemical substance is identified by its CAS Registry Number. The module
validates CAS format (`/^\d{2,7}-\d{2}-\d$/`) and verifies the check digit
using the weighted modulo-10 algorithm. A built-in substance dictionary maps
CAS numbers to names, formulas, and categories (BTEX, metals, PAHs).

### Regulatory Thresholds Database (multi-tier)

**Migration**: `REGULATORY_LIMITS` (flat `{max, unit, source}`) replaced by
`REGULATORY_THRESHOLDS` (array of `ThresholdEntry[]`). Clean break, no backward
compatibility layer. All consumers updated atomically.

Each threshold entry is self-contained:

```js
{
    (type, value, matrix, unit, severity, source, meta);
}
```

**Severity tiers** (derived from threshold type):

| Type        | Default Severity | Meaning                  |
| ----------- | ---------------- | ------------------------ |
| `vi`        | `intervention`   | Remediation required     |
| `cma`       | `intervention`   | Unacceptable risk        |
| `vp`        | `prevention`     | Monitoring required      |
| `vr`        | `reference`      | Above natural background |
| `screening` | `info`           | Informational            |

Built-in standards indexed by CAS number and environmental matrix:

- **CONAMA 420/2009** -- BTEX VI values (Benzene 5 ug/L groundwater, 0.03 mg/kg
  soil residential; Toluene 700 ug/L; Ethylbenzene 300 ug/L; Xylenes 500 ug/L),
  heavy metals (As 10 ug/L, Pb 10 ug/L, Cd 5 ug/L, Cr(VI) 50 ug/L, Hg 1 ug/L)
- **CONAMA 396/2008** -- Groundwater quality standards for metals
- **CONAMA 430/2011** -- Effluent: BOD 60 mg/L, COD 120 mg/L, pH 5-9
- **NR-15** -- Occupational: Benzene 1 ppm TWA-8h, noise 85 dBA/8h
- **WHO 2021** -- Air quality: PM2.5 25 ug/m3, PM10 45 ug/m3

**Custom overrides**: Site-specific thresholds (CMA, screening levels) stored
in localStorage key `ecbyts-custom-regulatory-thresholds`. Merged with built-in
via `getAllThresholds()`. Custom thresholds travel with ECO1 exports in the
`regulatoryOverrides` field.

### Validation Pipeline

`validateObservationFull()` runs a multi-tier check: resolves CAS from CONFIG,
auto-converts units, then iterates all thresholds sorted by value descending.
The first exceeded threshold determines the severity (intervention > prevention

> reference > info). No ad-hoc percentage warning — severity comes directly
> from the threshold entry.

`getThresholds(parameterId, matrix, options)` is the primary lookup function,
replacing the old `getRegulatoryLimit()`. Returns `ThresholdEntry[]` merging
built-in + custom, filtered by matrix and optional `landUse`.

### Outlier Detection

- **Z-score**: `z = (value - mean) / stdDev`, flags |z| > 3. Effective for
  normally distributed parameters.
- **IQR**: Flags values outside `[Q1 - 1.5*IQR, Q3 + 1.5*IQR]`. More robust
  to non-normal distributions typical of environmental contaminant data.

### ESG Benchmarks

Industry benchmarks for safety (frequency/severity rates, LTIR from OSHA/ILO),
emissions (SBTi GHG intensity targets), and waste (EPA recycling rates).
`compareToBenchmark()` classifies performance into quartiles.

### Borehole Data Validation

`borehole.js` validates geological borehole JSON (AGS4-inspired) with fail-fast
semantics: collar (hole_id, x/y/z, total_depth), intervals (sorted, continuous,
no gaps/overlaps, epsilon=1e-6), points (depth in range, ISO-8601 dates with
round-trip validation), and batch duplicate-ID detection.
`normalizeBoreholeToWell()` converts validated data to the well element format.

## Scientific Rationale

- CAS check-digit verification prevents substance misidentification errors.
- CONAMA 420/2009 is mandatory for Brazilian contaminated site investigation;
  hardcoding ensures offline availability.
- Z-score and IQR together cover parametric and non-parametric distributions.
- Borehole topology validation prevents downstream 3D model corruption.

## Domain Validator Engine (v3.1)

### Decision

Added a generic, domain-agnostic validation engine under `engine/` that supports
user-defined domain schemas. No built-in domains — all domains are created by users
via the UI or imported as JSON templates from Libraries.

### Architecture

- **Registry pattern**: `registerDomain(name, config)` — any entity type
- **3-level validation**: Record (field rules) → Batch (PK uniqueness) → Dataset (referential integrity)
- **JSON-driven**: `domainLoader.js` converts JSON definitions into executable rule functions
- **Rule builders**: `required()`, `oneOf()`, `numeric()`, `matchPattern()`, `uniqueKey()`, `ifAvailable()`, `custom()`
- **Validation modes**: `ingest` (lenient), `sign` (warnings → errors), `export` (organ-specific)
- **Temporal rules**: `effective_from`/`effective_until` for regulation versioning

### Coexistence with Existing System

The engine and the existing `profileEngine.js` + `rules.js` serve different purposes:

- **profileEngine**: validates observations against regulatory thresholds (post-import)
- **engine**: validates structured records against domain schemas (pre-import)

Data flow: `EDD → parser → mapper → engine (pre-import) → wizard → ingester → profileEngine (post-import)`

### Storage

- Custom domains: IndexedDB key `ecbyts-validation-domains`
- Active domain IDs: IndexedDB key `ecbyts-validation-domain-active-ids`

### Alternatives Considered

- Built-in GAC/GEE domains in JS code — rejected: engine must be 100% generic
- Flat record validation (v1) — replaced by entity model for referential integrity
- Code-based domain definitions — rejected: users need UI-driven rule creation

## Consequences

- Every observation is validated at entry time against applicable standards.
- The module is pure computation (no DOM) and independently testable.
- Adding new standards requires only extending the limits dictionaries.
- User-defined domain validators extend coverage beyond built-in regulatory thresholds.
