# ADR-005: Statistical Analytics and Prediction Engine

**Status**: Accepted
**Date**: 2026-02-22
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT -- Environmental & Occupational Core Byte Tools

## Context

Environmental compliance monitoring generates time series at multiple spatial
locations. Regulators require trend analysis to determine whether contamination
is increasing, stable, or decreasing. The platform must provide robust
statistical methods, interactive visualization, spatial gap analysis, and
optional LLM-augmented interpretation -- all client-side.

## Decision

### Statistical Methods (statistics.js)

1. **Linear Regression (OLS)**: Least-squares fit with R-squared for parametric
   trend estimation.
2. **Mann-Kendall Trend Test**: Non-parametric monotonic trend test. Computes S
   statistic from pairwise sign comparisons, applies tie-group variance
   correction, derives Z via continuity correction. P-value via Abramowitz &
   Stegun normal CDF approximation (max error 7.5e-8). Alpha=0.05.
3. **Sen's Slope Estimator**: Median of all pairwise slopes -- more resistant
   to outliers than OLS. Includes 95% confidence interval bounds.
4. **Order of Magnitude Analysis**: Flags anomalies where log10(observed/expected)
   exceeds 1 (10x deviation), detecting laboratory or transcription errors.

### Prediction Engine (prediction.js)

`analyzeTimeSeries()` runs all three trend methods, returning unified results
with OLS slope/R-squared, Mann-Kendall significance, Sen's slope with CI, and
descriptive statistics. Consensus trend uses Mann-Kendall (non-parametric).

`projectTrend()` forecasts via Sen's slope at 30-day intervals with confidence
bands. `getAllTrends()` batch-analyzes all element-parameter pairs, sorted by
significance. `interpretTrend()` optionally sends results to LLM for narrative
interpretation with urgency classification.

### Spatial Analysis (spatial.js)

1. **Coverage Analysis**: Grid-based coverage estimation using circular buffers
   (50m) around monitoring points as fraction of bounding box area.
2. **Gap Detection**: Identifies grid cells where nearest monitoring point
   exceeds threshold distance (80m default).
3. **Optimal Point Suggestion**: Greedy coverage-maximization selecting largest
   gaps first with minimum separation constraint (30m). Visualizable as
   translucent 3D spheres in the scene.

### DataTensor (dataTensor.js)

Multidimensional data structure indexed along four dimensions: element, time,
parameter, and space. Each DataPoint carries value, unit, position, campaign,
and qualitative fields. Hash-map indices (`byElement`, `byTime`, `byParameter`,
`byFamily`, `byCampaign`) provide O(1) lookups.

### Visualization and Event Architecture

- **ScatterPlot**: Temporal evolution with regulatory limit lines and trend lines.
- **DynamicHistogram**: Chart.js distribution analysis with interactive bin
  selection and cross-filtering.
- **SlicePlane**: 3D cross-section planes. **ViolationsTimeline**: Exceedances.

All components communicate via `AnalyticsEventBus` with typed events
(`DATA_UPDATED`, `SLICE_MOVED`, `HISTOGRAM_FILTER`, `ELEMENT_SELECTED`).
`SyncManager` bridges analytics with the 3D scene bidirectionally.

## Scientific Rationale

- Mann-Kendall is the EPA-recommended standard for environmental trend detection
  (Statistical Analysis of Groundwater Monitoring Data, 2009).
- Sen's slope is preferred for environmental time series affected by outliers.
- The greedy spatial optimization approximates the NP-hard set cover problem.
- The DataTensor mirrors the 4D nature of monitoring data (who, when, what, where).

## Consequences

- Statistical analysis runs entirely client-side with no server dependency.
- Three complementary trend methods prevent false conclusions from single-method
  limitations.
- Spatial gap analysis provides actionable campaign planning guidance.
- The event bus allows adding visualization types without modifying existing
  components. LLM interpretation degrades gracefully without an API key.
