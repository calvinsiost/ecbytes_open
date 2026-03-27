# ADR: IoT Sensor Hydration Pipeline

**Status**: Accepted
**Date**: 2026-02-27
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT — Environmental & Occupational Core Byte Tools

---

## Context

Sensor elements represent IoT monitoring devices (level sensors, flow
meters, multiparameter probes). Unlike manual observations, sensor data
must be fetched from external APIs, transformed, and linked to element
state — a process called "hydration."

The module must:

1. Fetch from heterogeneous APIs with different schemas.
2. Handle partial failures gracefully (some APIs down).
3. Anonymize real-world identifiers for demo/testing safety.
4. Generate deterministic identity keys for audit trail.

---

## Decision

### 1. Three-Stage Resilient Pipeline

```
Stage 1 (Identity)    → JSONPlaceholder: owner, location
Stage 2 (Metadata)    → FakerAPI: UUID, serial, extended info
Stage 2B (Readings)   → FakerAPI: multiparameter scaled readings
Stage 3 (Weather)     → OpenWeatherMap: environmental context
```

Stages 2B and 3 run in parallel via `Promise.allSettled`.
Each stage returns `{ _status: 'ok'|'error'|'skipped', _error? }`.

### 2. Fault Isolation

- Each fetch wrapped in `AbortController` with 5-second timeout.
- Failed stages do not break the pipeline — remaining data proceeds.
- If FakerAPI fails, readings are generated locally with same range scaling.
- Each stage is independently retryable.

### 3. Parameter Range Scaling

22 environmental parameters defined with realistic ranges:

```javascript
PARAM_RANGES = {
    ph: { unit: '-', min: 4.5, max: 9.5 },
    dissolved_oxygen: { unit: 'mg/L', min: 0, max: 14 },
    conductivity: { unit: 'μS/cm', min: 50, max: 2000 },
    // ... 19 more
};
```

API values (0-1 float) are scaled to parameter-specific ranges.

### 4. Anonymization by Design

Real names from JSONPlaceholder are replaced with deterministic tags:

- `"Leanne Graham"` → `"Owner-42"`
- Based on SHA-256 hash of original string → 2-digit tag.
- Prevents accidental exposure of real-world identifiers in demos.

### 5. Identity Evaluation

Each hydration produces a deterministic triplet for audit:

```javascript
{
  modelId: 'sensor-PM-01-1709394000',
  quantitative: 7,    // Sum of readings count
  key: 'sha256(modelId|quantitative|timestamp)',
  timestamp: ISO8601
}
```

### 6. Open-Meteo as Default Weather Source

**Decision**: Replace OpenWeatherMap as default Stage 3 with Open-Meteo.

**Rationale**:

- Free, no API key required — zero configuration barrier
- Open-source backend (GitHub: open-meteo/open-meteo)
- Real-time weather data that varies continuously (~15 min granularity)
- Already used in the codebase for elevation data (`interpolation/fetcher.js`)
- CORS confirmed, CSP `connect-src` already includes `api.open-meteo.com`

**Backward compatibility**: OpenWeatherMap remains available via `connectorKey` (API key).
If sensor has `geoCoordinates` → Open-Meteo (default). If sensor has `connectorKey` → OWM.

**Weather-to-Readings Injection**: Open-Meteo values are injected directly into
`latestReadings` for matching parameters (temperature, humidity, pressure, wind_speed,
precipitation), preventing contradictions between `weather` panel and readings table.

### 7. Random Walk for Non-Weather Parameters

**Decision**: Use clamped random walk instead of full random generation for
subsequent readings of environmental parameters.

**Rationale**: Full random generation produces physically impossible jumps
(e.g., pH from 5.5 to 8.5 between consecutive readings). Random walk with
parameter-specific `MAX_STEP` values produces plausible time series.

**Implementation**: `randomWalkValue(paramId, prevValue)` applies
`newValue = prevValue + delta` where `|delta| <= MAX_STEP[paramId]`,
clamped to `PARAM_RANGES[paramId].min/max`. First reading uses full random.

### 8. Auto-Refresh Polling Architecture

**Decision**: Per-sensor configurable polling with exponential backoff.

**Key design choices**:

- **Minimum interval: 5 min** — Open-Meteo updates every ~15 min; faster polling wastes requests
- **Default interval: 15 min** — matches data source granularity
- **Tab visibility**: Skip fetch when `document.hidden === true` (battery/network savings)
- **Backoff**: On consecutive failures, interval doubles up to 10 min max. After 5 failures, polling pauses with user notification
- **Ephemeral state**: Polling does not persist across page reloads (same as sequencer playback)
- **Silent fetch**: Auto-refresh uses `handleFetchSensorDataSilent` (targeted DOM update, not full `updateAllUI()`) to avoid render thrash
- **Observations NOT auto-created**: `latestReadings` are volatile display values; observations require deliberate user action via `handleSensorToObservation`

**Cleanup**: `stopAutoRefresh(elementId)` on element deletion; `stopAllAutoRefresh()` on model clear/import.

### 9. File Tree

```
core/sensor/
  ADR.md           # This document
  index.js         # Orchestrator: getAppData(element)
  fetcher.js       # 3-stage API pipeline + PARAM_RANGES + random walk
  transformer.js   # Profile builder, anonymization, identity evaluation
  autoRefresh.js   # Per-sensor polling with backoff + tab visibility
```

---

## Consequences

### Positive

- Resilient to partial API failures — sensor cards always render.
- Anonymization makes demos safe for public presentations.
- Deterministic identity keys enable data provenance tracking.
- Configurable endpoints allow custom IoT connector integration.
- Open-Meteo provides real weather data with zero configuration.
- Random walk produces plausible environmental time series.
- Auto-refresh with backoff handles unstable field networks gracefully.

### Negative

- Depends on external APIs (JSONPlaceholder, FakerAPI) for demo data.
- Open-Meteo rate limit: 10,000 req/day (mitigated by 5 min minimum interval).
- No persistent caching — re-fetches on every hydration call.
- Anonymization loses original identity information permanently.
- Auto-refresh state is ephemeral — lost on page reload.

---

## Related ADRs

- **ADR-020** (EIS) — Sensor data freshness contributes to Timeliness axis
