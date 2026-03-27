# ADR-018: Environmental Data Ingestion Pipeline

**Status**: Accepted
**Date**: 2026-02-24
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT -- Environmental & Occupational Core Byte Tools

## Context

Environmental site management begins with importing tabular data from
laboratories, field campaigns, and cadastral surveys. The EPA Electronic Data
Deliverable (EDD) format is the industry standard across US EPA regions (R2, R3,
R5) and has been adapted for Brazilian regulatory workflows (CETESB, CONAMA).

These datasets are complex: a single site may have 40+ monitoring wells, 3+
sampling campaigns, and 500+ analytical results across BTEX/metals/VOCs with
non-detect flags, detection limits, qualifiers, and regulatory compliance checks.

Manual data entry for such datasets requires ~5,000 clicks and 4-6 hours of
error-prone repetitive work. An automated ingestion pipeline with human oversight
reduces this to <10 clicks while preserving data quality.

## Decision

### Three-Layer Intelligence Architecture

The ingestion pipeline operates in three cascading layers:

1. **Deterministic** (rules, 100% offline): For recognized formats (EDD R2/R3/R5,
   EDD-BR, ecbyts CSV), column mapping uses a hardcoded alias table covering
   regional naming variations. No external dependencies.

2. **AI-Assisted** (LLM API or local Gemma): For unrecognized formats, the system
   sends column headers + sample rows to an LLM that suggests mappings with
   confidence scores. Falls back gracefully if no AI is available.

3. **Human-in-the-Loop** (always active): A guided wizard presents the mapping
   proposal, highlights ambiguities, and collects domain decisions that only a
   specialist can make (non-detect treatment, campaign grouping, multilevel well
   strategy, coordinate projection, regulatory standard import).

Human assistance is NOT optional -- it is a core part of the algorithm. Even with
100% deterministic mapping, the human reviews and approves before ingestion.

### Module Structure

```
core/ingestion/
  parser.js     Parse XLSX/CSV, detect EDD format by sheet names + column names
  mapper.js     Deterministic alias table + AI fallback, resolve chemicals/units
  validator.js  Pre-ingestion validation (types, limits, duplicates, outliers)
  wizard.js     State machine for the 5-step human-guided wizard
  ingester.js   Bulk creation of elements, campaigns, and observations
```

### Format Detection Strategy

Detection uses a priority cascade:

1. Sheet names match formal EDD (Location_v1, Sample_v4, TestResultsQC_v4)
2. Sheet names match Brazilian EDD (Locais, Amostras, Testes e Resultados)
3. Column headers contain EDD key fields (sys_loc_code, sys_sample_code)
4. Column headers match ecbyts native CSV (element_id, parameter_id)
5. None match → unknown format → AI layer

### Non-Detect Handling

EPA EDD encodes non-detects as: detect_flag='N', result_value=null,
reporting_detection_limit=<value>. Qualifiers: U (not detected), UJ (estimated
non-detect), J (estimated), < (below limit).

The wizard presents four treatment options to the human:

- Flag with null value (preserves censored data semantics) [recommended]
- Store as half detection limit (common in statistical analysis)
- Store as full detection limit (conservative approach)
- Discard non-detects (loses information)

### Coordinate Projection

EDD data uses geographic coordinates (lat/long in decimal degrees). The app uses
Three.js local coordinates (x, y, z in meters). Projection uses centroid-relative
offset via Haversine formula. The human can override the centroid origin.

## Scientific Rationale

Environmental monitoring data follows a well-defined relational schema:
Location → Sample → Result, with campaigns as temporal grouping. This maps
naturally to ecbyts: Element → Observation, with Campaign as time anchor.

The three-layer approach mirrors how environmental engineers actually work:
automated tools handle the mechanical translation, AI helps with ambiguous cases,
and the engineer makes domain-specific decisions (e.g., how to treat non-detects
depends on the statistical analysis planned downstream).

## Known Environmental Data Formats

The alias table in `mapper.js` covers column names from multiple formats.

### Environmental Formats

| Format           | Source        | Status          | Notes                              |
| ---------------- | ------------- | --------------- | ---------------------------------- |
| EPA EDD R2/R3/R5 | US EPA        | **Implemented** | Multi-sheet, versioned             |
| EDD-BR           | CETESB/CONAMA | **Implemented** | Portuguese sheet/column names      |
| ecbyts CSV       | ecbyts        | **Implemented** | Native export/import               |
| EQuIS Schema     | EarthSoft     | Aliases added   | Similar to EDD, DT\_ prefix tables |
| WQX              | EPA/USGS      | Aliases added   | XML/CSV, verbose column names      |
| SEDD             | EPA           | Covered by EDD  | Simplified EDD subset              |
| ERPIMS           | US Army Corps | Aliases added   | Legacy, short column names         |
| ADaM             | DoD/EDSP      | Aliases added   | CLP-focused variant                |
| ESdat            | ESdat Pty Ltd | Aliases added   | Australian standard                |
| LIMS-Export      | Various labs  | Aliases added   | No single standard                 |
| SDWIS            | EPA           | Future          | Drinking water compliance          |
| OGC SensorThings | OGC           | Future          | IoT/JSON, see sensor.js            |
| WaterML 2.0      | OGC/WMO       | Future          | XML time series                    |
| GeoSciML         | OGC/CGI       | Future          | XML geology, see borehole.js       |

### OHS (Occupational Health & Safety) Formats

| Format              | Source       | Status          | Notes                             |
| ------------------- | ------------ | --------------- | --------------------------------- |
| AIHA Essential Data | AIHA         | **Implemented** | IH exposure data, GHE, TWA-8h     |
| DOEHRS-IH EDD       | US DoD       | **Implemented** | Military exposure, ssn_last4      |
| NR-15 Assessment    | Brasil/MTE   | **Implemented** | Insalubridade, limites NR-15      |
| PPRA/PGR Report     | Brasil/NR-9  | **Implemented** | Riscos, probabilidade, severidade |
| PCMSO Exams         | Brasil/NR-7  | **Implemented** | Exames medicos, aptidao           |
| LIMS Biomonitoring  | Various labs | **Implemented** | BEI/IBMP, matriz biologica        |

The AI layer (mapper.js `mapWithAI`) can handle unlisted formats by inferring
column semantics from headers + sample data.

## OHS Extension

### Fundamental Difference

Environmental data is **location-centric**: Point → Sample → Result.
Occupational data is **person-centric**: Worker/GHE → Exposure → Result.

### OHS → ecbyts Mapping

| OHS Concept                  | ecbyts Model                       |
| ---------------------------- | ---------------------------------- |
| Worker                       | Element (family='individual')      |
| GHE (Similar Exposure Group) | Group (utils/groups/)              |
| Sector/Zone                  | Element (family='area')            |
| Personal exposure            | Observation on 'individual'        |
| Area exposure                | Observation on 'area'              |
| Biomonitoring                | Observation on 'individual'        |
| Incident/Accident            | Element (family='incident')        |
| Measurement campaign         | Campaign                           |
| OEL/TLV limit                | Validation rule (core/validation/) |

### Domain Branching

The wizard detects the data domain and adapts its Step 4 accordingly:

- **Environmental**: Non-detect handling, campaigns, multilevel wells, coordinates, action levels
- **OHS**: GHE grouping, sample type separation, LGPD data protection, OEL source, PCMSO aptitude

### LGPD Compliance

OHS data contains personal information (worker names, IDs, CPF). The wizard
offers three LGPD treatments:

1. **Pseudonymize** (recommended): Hash worker ID, preserve GHE grouping
2. **Keep identified**: Requires documented consent
3. **Anonymize**: Remove worker-data linkage entirely

### OHS Observation Variables

Added to `config.js` OBSERVATION_VARIABLES (group: 'ohs'):

- `exposure_route`: inhalation, dermal, ingestion, noise, radiation, vibration
- `sample_type_ohs`: personal, area, biological, medical
- `biological_matrix`: blood, urine, hair, saliva, exhaled_air
- `ghe_id`, `worker_id`: references to group and individual elements
- `ppe_status`: none, partial, full
- `duration_hours`, `twa_8h`: exposure duration and time-weighted average
- `oel_reference`, `oel_source`: occupational exposure limit value and source

### OHS Validation Rules

- TWA-8h > OEL: flags exposure above occupational limit
- Result > BEI: flags biomonitoring above biological exposure index
- Duration > 12h: flags potentially incorrect exposure duration
- Worker PII detected: LGPD warning for consent verification

## Phase 2 Decisions (D6–D13) — 2026-03-16

Post-MVP additions to the wizard based on full-cycle testing with real EQuIS EDD data (db.xlsx: 42 wells, 126 samples, 504 results, 4 action levels).

**D6 — Duplicate detection on re-import**
Default strategy: `replace` (remove existing element by `sys_loc_code` match, then create new). `removeElement()` is synchronous — no async race. Strategy `skip` preserves existing elements entirely; `append` is the legacy behavior (creates duplicates). Duplicate warning only fires when `clearStrategy='none'`.

**D7 — Post-import validation table**
Tolerance: 0% divergence for Elements, Campaigns, Thresholds; 2% for Observations (QC filters may discard non-detects depending on strategy). Modal stays open until user closes manually — no auto-close.

**D8 — Real sheet names in FORMAT_CONFIRM**
Sheets with fewer than 5 data rows are suppressed from the mapping table (format metadata sheets like "Format Information"). Entity labels are translated: `elements` → "Elements (poços)", `results` → "Observações", etc.

**D9 — Progress callback**
`onProgress(phase, current, total)` fires every 50 iterations in `createObservations()`, plus a `setTimeout(0)` yield to allow UI repaints. Granularity: minimum 1 call for any non-zero total.

**D10 — Rollback on partial failure**
`created = { elements: [], campaigns: [] }` tracker per `ingest()` call. Rollback is synchronous (managers are sync). Guard `isIngesting` prevents concurrent imports. Observations are nested in `element.data` — no separate rollback needed.

**D11 — ECO1 backup before clear**
Download is triggered by explicit user click ("Baixar backup agora") — not automatic — to comply with browser popup policy. Button "Ingerir Dados" is disabled until `_wizardState.backupDownloaded=true`. File named `ecbyts-backup-YYYY-MM-DD.eco1`. Export failure is a soft error (toast warning, import not blocked).

**D12 — Geographic distance warning**
Haversine formula, threshold `50km` (configurable via `CONFIG.IMPORT_DISTANCE_THRESHOLD_KM` if set). Only fires when `clearStrategy='none'` (user is merging datasets). Warning is non-blocking: user chooses to continue, cancel, or switch to `clearStrategy='all'`.

**D13 — QAQC Summary**
Stats computed in `validator.js::validateMappedData()` before `transformed` is discarded, saved to `plan.validation.stats.qaqc`. Top 10 parameters by observation frequency. Means exclude non-detections (censored data); strategy substitution values not included in mean. Outlier threshold: n ≥ 3 per parameter. Exceedances require thresholds to be imported (D5); without them, column shows "N/D".

## Phase 3 — Merge-based Output (D14) — 2026-03-16

**D14 — Wizard output via Diff/Merge**

The wizard no longer injects data directly into the model via managers (`addElement`, `addCampaign`). Instead, `buildVirtualModel(plan)` constructs a side-effect-free model object in memory, compatible with `diffModels()` from `core/diff/engine.js`.

Flow: Wizard parse/validate/transform (unchanged) → `buildVirtualModel()` → close wizard → auto-open Diff/Merge modal with Model A = current state and Model B = imported data → user reviews per-element diff → resolves conflicts → Apply Merge → `applyModel()` + `updateAllUI()`.

Key design decisions:

- **Deterministic IDs**: Elements use `${familyId}-${slugify(name)}` (same as `createElements()`) so re-imports of the same file produce matching IDs in the diff — the engine shows "modified" instead of "added + removed".
- **Subsumes D3/D6/D7**: Clear strategy, duplicate detection, and validation table are replaced by the diff view — the user sees exactly what changes and decides per-element.
- **D11 preserved**: ECO1 backup download still happens in the wizard before entering merge.
- **Legacy pipeline preserved**: `ingest()` remains available for programmatic imports or future API use.
- **Virtual model structure**: Includes only sections relevant to import (`elements`, `campaigns`, `families`, `project`, `coordinate`, `edges:[]`, `scenes:[]`). Sections not included (interpolation, nn, calculator, storyboard, report, etc.) are intentionally omitted — the diff engine ignores absent keys and `mergeModels()` preserves Model A values for those sections.
- **Data quality flags (D15-D16)**: Elements carry provenance tags (`is_depth_available`, `is_coordinates_available`, `is_z_available`) indicating whether data came from the spreadsheet or is a wizard default. Tags survive ECO1 round-trip (validator does not strip `el.data` fields).
- **Boundary (D17)**: Auto-generated via convex hull of well locations with 10% buffer. Convex hull is a known limitation — non-convex site geometries (L-shaped, U-shaped, riverside networks) will include extraneous area. The boundary can be manually edited after import via the element editor.
- **Terrain/aerial (D18-D19)**: Generated post-merge via `createTerrainLayer()`. Not part of the virtual model (requires async tile API). Triggered by `window._postMergeActions` after `handleApplyMerge()`, cleaned up on modal open/apply.

## Consequences

- **Positive**: Reduces 5,000-click manual entry to <10-click guided import
- **Positive**: Supports EPA EDD R2/R3/R5 and Brazilian adaptations out of the box
- **Positive**: Supports OHS formats (AIHA, DOEHRS, NR-15, PPRA, PCMSO, Biomonitoring)
- **Positive**: Human-in-the-loop prevents silent data quality issues
- **Positive**: AI layer handles non-standard formats gracefully
- **Positive**: LGPD-compliant handling of worker personal data
- **Trade-off**: SheetJS CDN dependency for XLSX parsing (~500KB)
- **Trade-off**: Wizard adds 5 steps vs. "just import" -- but prevents errors
- **Trade-off**: Domain branching adds complexity to wizard state machine
- **Risk**: Column alias table requires maintenance as new EDD/OHS versions emerge
