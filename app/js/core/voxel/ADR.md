# ADR-003: 3D Voxel Subsurface Model

**Status**: Accepted
**Date**: 2026-02-22
**Atualizado:** 2026-03-26
**Author**: Calvin Stefan Iost
**Project**: ECBT -- Environmental & Occupational Core Byte Tools

## Context

Environmental site characterization requires a volumetric understanding of the
subsurface: where the vadose (unsaturated) zone transitions to the saturated
zone, and how geological strata are distributed in three dimensions. This
conceptual site model (CSM) is mandated by CONAMA Resolution 420/2009 for
contaminated site management in Brazil and is fundamental to mining
hydrogeology.

## Decision

### Voxel Engine (Pure Computation)

The engine (`engine.js`) is a dependency-free mathematical module. It receives
two surface sampler functions -- `sampleTop(x,z)` for terrain elevation and
`sampleDivider(x,z)` for water table elevation -- and classifies every cell in
a regular 3D grid:

- **EMPTY (0)**: Cell center is above the terrain surface.
- **VADOSE (1)**: Cell center is between terrain and water table (unsaturated zone).
- **SATURATED (2)**: Cell center is below the water table (groundwater zone).

Grid indexing is row-major XYZ: `index = iz * (ny * nx) + iy * nx + ix`, stored
as a flat `Uint8Array` for memory efficiency. World coordinates are recovered
from indices via `worldX = bounds.minX + ix * resolution + resolution/2`.

### Adaptive Resolution

`suggestResolution()` automatically selects a voxel size (1m, 2m, 5m, or 10m)
to keep the total voxel count below 200K for interactive performance, scaling up
to a hard cap of 1M voxels. For a typical 200m x 200m x 50m site, this yields
2-5m resolution -- sufficient for conceptual site models while maintaining
real-time 3D rendering.

### Integration with Interpolation Surfaces

The voxel manager imports `sampleTerrainElevation` and `sampleLayerGrid` from
the interpolation module. The terrain surface defines the top boundary; the
water table interpolation layer defines the vadose/saturated divider. When no
water table data exists, a -5m default fallback is applied.

### InstancedMesh Rendering

The renderer (`renderer.js`) uses Three.js `InstancedMesh` -- the first use of
instanced rendering in the project. This enables thousands of cubes to be drawn
with a single GPU draw call per zone, versus one draw call per cube with
standard `Mesh` objects.

Two display modes:

- **Solid**: A single semi-transparent `BoxGeometry` covering the full volume
  extent, with vadose-colored top face and saturated-colored bottom face.
- **Voxels**: Individual cubes via `InstancedMesh`, scaled to 92% of cell size
  to create visual gaps between cells. One `InstancedMesh` per zone (vadose =
  brown 0xD2691E, saturated = blue 0x1E90FF).

Each instance carries a reverse mapping (`instanceToGrid: Uint32Array`) from
GPU instance ID back to flat grid index, enabling raycasting to resolve which
voxel cell was clicked.

### Interactive Voxel Editing

`editController.js` implements a state machine (IDLE / EDITING) for manual
voxel sculpting:

- Left-click: Delete voxel (set to EMPTY).
- Ctrl+click or right-click: Insert voxel on adjacent face.
- Zone auto-detection: Inserted voxels are classified as vadose or saturated
  based on their Y position relative to the water table surface.
- Debounced mesh rebuilds (80ms) handle rapid clicks efficiently.
- Escape exits edit mode.

### Persistence

Volume configurations (resolution, display mode, opacity) are persisted to
localStorage. Grid data is not persisted -- it is recomputed on restore from
the current terrain and water table surfaces, ensuring consistency.

## Scientific Rationale

- The vadose/saturated classification is the foundation of hydrogeological
  conceptual models (Freeze & Cherry, 1979).
- Voxel-based representation enables volumetric queries (e.g., total saturated
  volume, contamination extent) that surface-only models cannot provide.
- The 3D grid serves as the spatial framework for future contaminant transport
  modeling and neural network predictions.

## Consequences

- Subsurface geology is visualized interactively at up to 1M voxels.
- InstancedMesh keeps draw calls constant regardless of voxel count.
- Manual editing allows geologists to refine the automated classification.
- The engine module is testable independently of Three.js.
