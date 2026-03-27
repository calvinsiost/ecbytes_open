# ADR — Sequencer Module

**Atualizado:** 2026-03-26

## Context

When users import data from distant locations (e.g., 2 contaminated areas in different states),
elements are so far apart in 3D that `fitAllElements()` shows everything tiny. The Sequencer module
provides spatial navigation (action bar with clusters/scenes) and temporal animation (timeline with
keyframes) inspired by RPG action bars and NLE video editors.

## Decisions

### 1. Spatial Clustering: Single-Linkage

**Chosen:** Single-linkage (nearest-neighbor) clustering with configurable threshold (default 500m).
**Rationale:** Simple O(n²), deterministic, no k parameter needed. Environmental sites typically
have clear spatial separation (different cities/states). More sophisticated methods (DBSCAN, k-means)
are overkill for typical 2-5 cluster scenarios.
**Trade-off:** O(n²) acceptable for <10k elements (typical models have 10-200).

### 2. Action Bar: Items = Clusters + Scenes

**Chosen:** StoryboardItem unifies both auto-detected clusters and user-saved Scenes.
**Rationale:** Both represent "places to visit" in 3D space. Clusters are auto-generated from
spatial analysis; Scenes are manual bookmarks. Treating them uniformly simplifies the UI.
**Alternative:** Separate bars for clusters vs scenes — rejected (redundant UI).

### 3. Timeline: Normalized Position (0.0-1.0)

**Chosen:** Keyframes use normalized position (0-1) rather than absolute time.
**Rationale:** Total duration depends on sum of keyframe durations + transitions. Normalized
position allows the engine to compute absolute time dynamically. User sees time display but
internal state is position-based.

### 4. Playback Engine: requestAnimationFrame Loop

**Chosen:** RAF-based tick loop with delta time accumulation.
**Rationale:** Smooth 60fps interpolation between keyframes. Speed multiplier applied to delta.
**Trade-off:** Battery drain during playback — mitigated by auto-pause on document.hidden.

### 5. Camera Interpolation: Direct Lerp + Easing

**Chosen:** Linear interpolation of camera {x,y,z,zoom} and target {x,y,z} with per-keyframe
easing function applied to the t parameter.
**Alternative:** Spherical interpolation (slerp) — rejected because OrbitControls uses Cartesian
position, not spherical. Lerp produces natural-looking camera moves for top-down/isometric views.

### 6. Persistence: localStorage + ECO1

**Chosen:** State persisted to `ecbyts-storyboard` in localStorage. Included in ECO1 export
for cross-device portability. On ECO1 import, clusters are re-computed (may differ if elements
changed), scenes are re-linked by ID.

### 7. Core Placement

**Chosen:** `core/sequencer/` (not `utils/`).
**Rationale:** Spatial clustering algorithm and timeline engine are domain-specific IP.
The renderer generates HTML with domain knowledge (family icons, campaign labels).

## Consequences

### Positive

- Users can navigate multi-site models without manual zooming
- Timeline enables animated presentations for stakeholders
- Clusters auto-adapt when new data is imported
- Scenes from existing scene manager integrate seamlessly

### Trade-offs

- Single-linkage may chain distant clusters if intermediate elements exist
- RAF loop active during playback increases CPU usage
- localStorage adds ~2KB per storyboard state
