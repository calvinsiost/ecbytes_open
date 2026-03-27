# ADR 6: Dimensional Unit Catalog and Conversion Engine

**Project:** Arquitetura Open-Source de Gemeos Digitais Ambientais e Ocupacionais com Blockchain e Automacao via Machine Learning e Grandes Modelos de Linguagem -- Aplicacoes em Mineracao
**Author:** Calvin Stefan Iost, 2026
**Brand:** ecbyts / ECBT (Environmental & Occupational Core Byte Tools)
**Status:** Accepted
**Date:** 2026-02-22
**Atualizado:** 2026-03-26

## Context

Environmental and occupational digital twins must handle measurements across
heterogeneous physical dimensions -- water concentration (mg/L, ug/L),
air concentration (mg/m3), greenhouse gas emissions (tCO2e), noise (dBA),
occupational health rates (OSHA vs ILO bases), temperature, flow, conductivity,
and more. Regulatory frameworks (CONAMA, CETESB, OSHA, NR-15) prescribe
specific units, and field data arrives in varied formats. A type-safe,
extensible unit system is essential for correct comparison, visualization,
and compliance checking.

## Decision

Implement a flat catalog of 55+ unit definitions organized by physical
dimension, with a two-step conversion engine that routes all conversions
through a designated base unit per dimension.

### Unit Catalog Architecture (catalog.js)

Each unit is a record with fixed schema:
`{ id, symbol, name, dimension, toBase, isBase, offset? }`.
Units are grouped into 20+ dimensions: mass, volume, concentration,
concentration_solid, air_concentration, air_concentration_norm,
dimensionless, emission, intensity_emission, intensity_water,
intensity_energy, area, rate_hs, severity, energy, temperature, noise,
count, score, percent, flow, length, conductivity, pH, potential, none.

Base units per dimension (toBase = 1, isBase = true):

- concentration: mg/L (regulatory standard in Brazil)
- air_concentration: mg/m3
- energy: kWh
- mass: kg
- volume: L (not m3, for direct mg/L alignment)
- area: m2
- rate_hs: per 1M man-hours (ILO standard)
- temperature: Celsius

Access functions provide O(n) lookup by dimension, O(1) by ID, compatibility
checks, and formatted output with proper Unicode symbols (um, m2, m3, degC).

### Conversion Engine (converter.js)

The core algorithm is a two-step relay through the base unit:

1. Source value -> base unit: `baseValue = value * fromUnit.toBase`
2. Base unit -> target: `result = baseValue / toUnit.toBase`

Special cases:

- **Temperature**: Dedicated handler with explicit formulas for
  Celsius/Fahrenheit/Kelvin, bypassing the linear toBase model.
- **Offset units**: Support for `offset` field enabling affine transforms
  `(value + offset) * toBase` for non-zero-origin scales.
- **H&S rate conversion**: Direct OSHA (200k hours) to ILO (1M hours)
  with factor 5.
- **GHG equivalents**: AR5 Global Warming Potentials (CO2=1, CH4=28,
  N2O=265, SF6=23500) for tCO2e conversion.

Batch operations: `convertArray` for dataset transforms,
`convertObservation` preserving original values for audit trail,
`autoFormat` selecting human-readable unit scales (1-1000 range preference).

Validation: `validateRange` for regulatory limit checking,
`normalizeToBase` for canonical storage.

## Rationale

- **Two-step via base unit** avoids O(n^2) pairwise conversion factors.
  Adding a new unit requires only one `toBase` factor.
- **Flat catalog** (not hierarchical) keeps lookup simple and avoids
  complex inheritance for a domain with clear dimensional separation.
- **Regulatory alignment**: mg/L as base for water concentration matches
  CONAMA 420/2009 and CETESB reference values directly.
- **Offset support** handles temperature without special-casing the
  catalog schema, though temperature still gets a dedicated handler
  for correctness with the nonlinear Fahrenheit transform.
- **Audit preservation**: `convertObservation` stores both original and
  converted values, critical for regulatory chain-of-custody.

## Consequences

- New units require only a catalog entry; no code changes in converter.
- Cross-dimension conversion is correctly rejected (dimension mismatch error).
- Temperature conversion is exact (not approximate via linear factors).
- The catalog currently has 55+ units covering ESG, H&S, and GRI domains.
- Logarithmic units (dB) share dimension but use linear toBase=1, which is
  a known simplification acceptable for display but not for acoustic summing.
