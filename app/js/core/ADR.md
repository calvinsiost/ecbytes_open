# ADR-001: ECBT Core Architecture

**Status**: Accepted
**Date**: 2026-02-22
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: Arquitetura Open-Source de Gemeos Digitais Ambientais e Ocupacionais com Blockchain e Automacao via Machine Learning e Grandes Modelos de Linguagem -- Aplicacoes em Mineracao (2026)
**Brand**: ecbyts (product) / ECBT -- Environmental & Occupational Core Byte Tools (formal IP)

## Context

ECBT is a browser-native platform for environmental and occupational digital
twins. It must operate without server-side computation, execute scientific
algorithms in real time, and produce tamper-evident audit trails -- all in
vanilla JavaScript with zero build step.

## Decision

The architecture is organized around four pillars, each realized by dedicated
core modules:

| Pillar       | Description                                      | Core Modules                            |
| ------------ | ------------------------------------------------ | --------------------------------------- |
| Digital Twin | 3D spatial model of monitoring sites             | elements, interpolation, voxel, io, sao |
| Blockchain   | Tamper-evident data chain with Merkle proofs     | crypto                                  |
| ML / NN      | Neural network builder and inference engine      | nn, recognition                         |
| LLM          | Natural language interface and autonomous agents | llm                                     |

Supporting modules provide statistical analysis (analytics, validation),
domain calculations (calculator, units), data management (campaigns, diff,
sensor), and audit intelligence (audit).

## Core Modules (17)

| Module          | Purpose                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| `analytics`     | Statistical analysis, DataTensor, scatter/histogram, trend prediction, spatial coverage |
| `audit`         | Benford's law analysis, greenwashing detection, investigation quality scoring           |
| `calculator`    | Domain-specific calculations with context resolution (remediation, emissions)           |
| `campaigns`     | Sampling campaign lifecycle management (CRUD, scheduling, team assignment)              |
| `crypto`        | SHA-256 hash chain, Merkle tree proofs, ECDSA signing, key management                   |
| `diff`          | Structural diff engine for model versioning and change detection                        |
| `elements`      | Element CRUD, family registry, 3D mesh factory, random model generation                 |
| `interpolation` | IDW, RBF, Kriging spatial interpolation; AWS terrain tiles; surface mesh builder        |
| `io`            | Binary encoder/decoder (ECO1), georeferencing, smart import, model sharing              |
| `llm`           | Multi-provider LLM client, natural language parser, command executor, autonomous agents |
| `nn`            | Neural network definition, training, inference via Web Workers, What-If engine          |
| `recognition`   | Aerial/satellite image analysis, spectral indices, ML-based feature detection           |
| `sao`           | Occupational health matrices (NR-15, NR-09), exposure scenarios, SAO parameters         |
| `sensor`        | IoT sensor data fetching, transformation, and real-time integration                     |
| `units`         | Unit catalog (90+ units across 15 dimensions) and bidirectional converter               |
| `validation`    | Regulatory compliance (CONAMA, CETESB, NR-15), CAS validation, outlier detection        |
| `voxel`         | 3D voxel engine for subsurface classification (vadose/saturated zones)                  |

## core/ vs utils/ Separation Rationale

The codebase enforces a strict two-tier separation:

**`core/`** -- Scientific algorithms and domain-specific intellectual property.
These modules implement published methods (Kriging variograms, Mann-Kendall
tests, Merkle tree proofs, neural network backpropagation) and encode
regulatory knowledge (CONAMA 420, NR-15 exposure limits). They are pure
computational modules with no direct DOM or Three.js dependencies in their
engine files.

**`utils/`** -- Generic infrastructure and UI plumbing. Handlers, scene setup,
internationalization, editing tools, theme management, and UI components. These
are replaceable without affecting the scientific correctness of the platform.

This separation ensures that (a) IP-critical algorithms are isolated and
auditable, (b) the scientific layer can be tested independently of the UI, and
(c) future refactoring of the presentation layer does not risk breaking
validated computational methods.

## Related ADRs

- [ADR-002: Interpolation](interpolation/ADR.md) -- IDW, RBF, Kriging, terrain elevation
- [ADR-003: Voxel](voxel/ADR.md) -- Subsurface 3D classification
- [ADR-004: Validation](validation/ADR.md) -- Regulatory compliance and outlier detection
- [ADR-005: Analytics](analytics/ADR.md) -- Statistical analysis and prediction

## Consequences

- All scientific computation runs client-side; no server dependency.
- Module boundaries enforce separation of concerns and enable independent testing.
- The core/ layer constitutes the registrable intellectual property of the ECBT platform.
- New domain algorithms are added to core/; new UI features to utils/.
