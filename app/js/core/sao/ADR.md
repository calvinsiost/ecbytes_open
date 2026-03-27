# ADR 12: Environmental, Safety and Occupational Health Framework (SAO)

**Project**: ECBT -- Environmental & Occupational Core Byte Tools
**Title**: 9-Matrix Environmental and Occupational Monitoring Taxonomy with Scenario-Driven Parameter Selection
**Author**: Calvin Stefan Iost
**Date**: 2026
**Atualizado:** 2026-03-26
**Status**: Accepted

## Context

Environmental and occupational monitoring in mining and industrial operations spans
multiple environmental compartments (air, water, soil, biota) and human exposure
pathways (chemical, physical, biological agents). Regulatory frameworks (ISO 14001,
ISO 45001, CONAMA, NR-15, OSHA) demand structured parameter selection aligned with
operational scenarios. A unified taxonomy is needed to organize 300+ monitoring
parameters across compartments while keeping the interface manageable for field engineers.

## Decision

### 1. Nine Environmental and Occupational Matrices (matrices.js)

The SAO protocol defines 9 matrices, each representing an environmental or occupational
compartment with domain-specific subcategories:

| Matrix         | ID             | Subcategories                                                                                                                                                | Domain                          |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Air            | `ar`           | Particulate, criteria gases, meteorology, VOCs, deposition, indices, dispersion                                                                              | Atmospheric monitoring          |
| Water          | `agua`         | Hydrology, physicochemical, metals, organics, microbiology, ecotoxicology, limnology, emerging contaminants, isotopes                                        | Surface/groundwater quality     |
| Soil           | `solo`         | Physical, chemical, contamination, biology, erosion, mineralogy                                                                                              | Pedology and contamination      |
| Biota          | `biota`        | Vegetation structure, phytosociology, fauna survey, dendrometry, fauna methods, plant physiology, remote sensing, ecosystem services, molecular biology      | Ecological assessment           |
| Human          | `humana`       | Chemical exposure, noise/vibration, heat/radiation, biomonitoring, medical surveillance, ergonomics, epidemiology, genotoxicity, endocrine disruption, omics | Occupational health (ISO 45001) |
| Geotechnical   | `geotecnico`   | Piezometry, resistance, inclinometry, tailings, topography, seismicity                                                                                       | Structural safety (mining dams) |
| Remote Sensing | `sr`           | Optical, radar, LiDAR, drones, spectral indices, change detection                                                                                            | Earth observation               |
| Climatology    | `climatologia` | Basic climate, extremes, water balance, climate change                                                                                                       | Long-term climate trends        |
| Resilience     | `resiliencia`  | Compliance, GRI standards, GHG, waste governance, LCA, ecological resilience                                                                                 | ESG and sustainability          |

### 2. Three-Tier Parameter Classification

Each parameter is assigned one of three tiers for progressive disclosure:

- **Essential**: Minimum mandatory parameters for any monitoring program.
- **Recommended**: Parameters for comprehensive investigations.
- **Specialized**: Advanced parameters for specific research scenarios.

Tier filtering is cumulative: selecting "recommended" shows essential + recommended.
This prevents information overload while maintaining access to the full parameter catalog.

### 3. Scenario-Driven Matrix Activation (scenarios.js)

Seven operational scenarios define which matrices are primary vs. secondary:

- **Tailings Dam**: Primary geotechnical, water, soil, biota; secondary air, human, RS.
- **Oil Spill**: Primary water, biota, air; secondary human, RS, resilience.
- **Chemical Accident**: Primary air, human, water; secondary soil, biota, RS.
- **Nuclear/Radiological**: Primary human, air, water; secondary soil, biota, RS, climate.
- **Mining Operations**: Primary geotechnical, water, soil, air, human; secondary biota, RS, resilience.
- **Deforestation**: Primary biota, soil, water; secondary climate, RS, resilience.
- **Routine Monitoring**: Primary air, water, human; secondary soil, biota, resilience.

Activating a scenario loads primary and secondary matrices and sets the default tier,
providing an immediately relevant parameter set for the operational context.

### 4. Lazy-Loading Parameter Architecture (index.js)

Each matrix's parameters are defined in separate files (`params/agua.js`, `params/ar.js`,
etc.) loaded via dynamic `import()`. At startup, `loadAllMatrices()` eagerly loads all
parameter files into `CONFIG.PARAMETERS` so they are available in the Field Manager.
On import, existing parameters receive SAO metadata without duplication; new parameters
are appended. The `loadedMatrices` set prevents redundant file imports.

### 5. Parameter Schema with Regulatory References

Each SAO parameter carries structured metadata:

- `sao.matrix`: Parent matrix identifier.
- `sao.tier`: Classification tier (essential/recommended/specialized).
- `sao.subcategory`: Specific domain within the matrix.
- `sao.regulatoryRefs`: Array of applicable standards (e.g., "CONAMA 357/2005", "ANA").
- `sao.scenarios`: Array of applicable operational scenarios.

This enables regulatory cross-referencing: the LLM agent system (ADR 11) uses SAO
metadata to filter the prompt context, reducing token consumption while maintaining
regulatory accuracy.

### 6. Extended Unit Catalog (units.js)

SAO parameters require 60+ specialized units beyond the base catalog: turbidity (NTU),
radioactivity (Bq, Bq/L), radiation dose (mSv, uSv/h), microbiology (NMP/100mL,
UFC/100mL), geotechnical (blows/30cm SPT), biological density (ind/ha), erosion rate
(t/ha/yr), spectral indices (NDVI), occupational exposure (mg/m3, f/cm3), and trace
concentrations (ng/L, pg/g). All units follow the dimensional analysis pattern with
`toBase` conversion factors for inter-unit conversion.

### 7. ISO 14001 / ISO 45001 Alignment

The matrix structure maps directly to ISO management system requirements:

- **ISO 14001** (Environmental Management): Matrices ar, agua, solo, biota, climatologia,
  resiliencia cover environmental aspects, impacts, and operational controls.
- **ISO 45001** (Occupational Health & Safety): Matrix humana covers hazard identification,
  risk assessment, exposure monitoring, and medical surveillance.
- **Cross-cutting**: Matrices geotecnico and sr support both standards through structural
  safety monitoring and remote change detection.

### 8. State Persistence and Model Integration (index.js)

SAO state (active scenario, tier, matrices) is persisted to localStorage and included
in ECO model export via `getSAOExportState()`. Imported models restore their SAO
configuration via `restoreSAOState()`, ensuring scenario context travels with the data.
The `saoChanged` CustomEvent triggers UI updates across all dependent panels.

## Consequences

- The 9-matrix taxonomy provides a complete ESH monitoring framework applicable to
  mining, industrial, and environmental remediation contexts.
- Scenario-driven activation reduces cognitive load by presenting only relevant parameters.
- Three-tier progressive disclosure prevents field engineers from being overwhelmed
  by 300+ parameters while preserving access for specialists.
- Regulatory reference metadata enables automated compliance checking via LLM agents.
- The lazy-loading architecture keeps initial page load fast despite the large parameter catalog.
