# ADR-002: Spatial Interpolation Engine

**Status**: Accepted
**Date**: 2026-02-22
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT -- Environmental & Occupational Core Byte Tools

## Context

Environmental monitoring produces sparse point observations (wells, springs,
sensors) that must be converted to continuous spatial surfaces for regulatory
analysis, contamination plume delineation, and water table mapping. The engine
must run entirely in the browser, support multiple mathematical methods, and
integrate real-world terrain elevation data.

## Decision

### Three Interpolation Methods

The unified interface `interpolateGrid(points, bounds, gridSize, method)`
returns a `Float32Array` row-major grid with statistics. Method selection:

1. **IDW (Inverse Distance Weighting)** -- Synchronous, zero dependencies.
   Weights known values by `1/d^power` (default power=2). Suitable for quick
   previews and small datasets. Exact interpolator (passes through data points).

2. **RBF (Radial Basis Function)** -- Lazy-loaded from CDN (`rbf@1.1.5`).
   Thin-plate spline kernel produces C1-smooth surfaces. Better for
   visualization where continuity matters more than geostatistical rigor.

3. **Ordinary Kriging** -- Custom implementation (`kriging.js`, zero CDN deps).
   Three semi-variogram models: spherical (Matheron 1963), exponential
   (Journel & Huijbregts 1978), gaussian (Cressie 1993). Variogram fitting
   via Weighted Least Squares with grid search + local refinement. Includes
   cross-validation (LOO) and kriging variance estimation. The gold standard
   in environmental geostatistics (CONAMA, CETESB methodologies).
   Replaces `@sakitam-gis/kriging@0.1.0` (CDN, v0.1.0, unmaintained).

### Terrain Elevation Pipeline

Real-world topography is fetched from **AWS Terrain Tiles** (Terrarium PNG
format). The pipeline: (a) convert scene bounds to WGS84, (b) compute optimal
zoom level from site extent, (c) fetch 256x256 PNG tile, (d) decode via
`height = (R*256 + G + B/256) - 32768`, (e) resample to target grid
resolution, (f) convert to relative elevation (subtract origin altitude).

Point elevations for individual wells use the **Open-Meteo** elevation API
(CORS-native, no API key, batched in groups of 100).

### Satellite Imagery

Terrain surfaces support satellite texture overlay with a fallback chain:
ESRI World Imagery (bbox export) -> Google Maps tiles -> Bing Maps quadkey
tiles. Textures replace vertex colors and toggle via `toggleSurfaceTexture()`.

### Layer Architecture

The manager maintains a `Map<id, Layer>` of interpolation layers, each with
type (`terrain`, `water_table`, `contamination`), method parameters, grid
data, and a reference to its Three.js mesh UUID. Layers persist to
localStorage without grid data (recomputed on restore).

### 3D Surface Construction

`surfaceBuilder.js` converts grids to Three.js meshes: `PlaneGeometry` rotated
to XZ plane, vertex Y deformed by grid values, vertex colors sampled from
domain-specific color ramps (terrain: green-brown-white; contamination:
green-yellow-red; water table: deep blue-cyan). Material: `MeshLambertMaterial`
with transparency and double-sided rendering.

### Web Worker Offloading

Heavy grids (256x256+) can be computed in a dedicated Web Worker. The worker
imports the same engine module and communicates via `postMessage` with
transferable `Float32Array` buffers (zero-copy).

## Scientific Rationale

- IDW is the ISO 15686-5 recommended baseline for sparse environmental data.
- Kriging is required by CONAMA Resolution 420/2009 Annex for contaminated
  site delineation in Brazil.
- Bilinear resampling of terrain tiles preserves elevation accuracy while
  matching the analysis grid resolution.
- The `sampleTerrainElevation()` function enables terrain-following placement
  of all site elements (wells, buildings, plumes).

## Academic References

All interpolation methods implemented in this module are based on published
academic literature. No proprietary algorithms or commercial software code
was used. IDW and Kriging are independent vanilla JS implementations. RBF
uses an open-source CDN library (MIT).

- **IDW**: Shepard, D. (1968). "A two-dimensional interpolation function for
  irregularly-spaced data." ACM National Conference. doi:10.1145/800186.810616
- **RBF (Thin-plate spline)**: Hardy, R.L. (1971). "Multiquadric equations of
  topography and other irregular surfaces." JGR, 76(8), 1905-1915.
- **Ordinary Kriging**: Krige, D.G. (1951). "A statistical approach to some
  basic mine valuation problems." J. Chem. Metal. Mining Soc. South Africa.
  Formalized by Matheron, G. (1963). "Principles of Geostatistics." Economic
  Geology, 58(8), 1246-1266.
- **Variogram models**: Journel, A.G. & Huijbregts, C.J. (1978). "Mining
  Geostatistics." Academic Press. ISBN 0-12-391050-1.
- **Variogram fitting**: Cressie, N.A.C. (1993). "Statistics for Spatial Data."
  Wiley. ISBN 0-471-00255-7. WLS weights per Cressie (1985).
- **Cross-validation**: Webster, R. & Oliver, M.A. (2007). "Geostatistics for
  Environmental Scientists." 2nd ed. Wiley. ISBN 978-0-470-02858-2.

### Geology Layer Colors (D-009, 2026-03-24)

Each geology layer now receives a `fixedColor` (hex) based on its `soilType`,
using the canonical `GEOLOGY_SOIL_COLORS` map in `colorRamps.js`. This map
consolidates the ABGE-standard colors already used in `WellProfileModule` and
`wellProfile3D`, ensuring visual consistency between well profile SVGs, 3D
cylinders, interpolated surfaces, and cross-section fills.

**Why not per-soil-type color ramps?** Ramps are designed for gradient
visualization over a continuous value range. Geology surfaces represent discrete
lithological contacts — a single solid color per layer is the geologically
correct representation (matching ABGE standard borehole log colors). A
degenerate 1-stop ramp would be an anti-pattern.

**Why store `fixedColor` on the layer instead of deriving at render time?**
The layer is the unit of state (export, import, persist). Storing the color
avoids leaking domain knowledge into the generic `buildSurfaceMesh()` and
allows future user color customization without architectural changes.

Migration guard: layers from pre-fixedColor models automatically derive
color from `GEOLOGY_SOIL_COLORS[parameterId]` in `addLayer()`.

## Consequences

- Three methods cover the accuracy-performance spectrum without server calls.
- Kriging is now a local implementation (zero CDN dependency) with documented
  variogram models, WLS fitting, and LOO cross-validation -- suitable for
  academic publication (Escola Politecnica da USP doctoral research).
- Lazy loading of RBF keeps initial bundle size minimal.
- Terrain integration provides real-world context for subsurface models.
- Color ramp definitions are reusable across all visualization modules.
