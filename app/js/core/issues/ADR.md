# ADR — Issues 3D / BCF-like (core/issues/)

## Status: Accepted (2026-03-15)

**Atualizado:** 2026-03-26

## Context

Environmental monitoring sites need non-conformity tracking tied to 3D spatial
positions. Issues are audit-grade records (CONAMA 420, CETESB DD-256) that must
survive export/import cycles and eventually sync to Supabase.

## Decisions

### 1. Closure-based state with Map indices

Issues stored in module-level `_issues[]` array. Three Map indices provide O(1)
lookup by element, severity, and status. Follows existing pattern (elements,
campaigns, scenes managers).

### 2. IDB + syncQueue dual persistence

- Runtime: `_issues[]` in memory
- Write: `idbSet('ecbyts-issues', exportIssues())` fire-and-forget
- Sync: `enqueueSync('issues', 'upsert', issue)` for Supabase offline-first
- ECO1 export: `model.issues = exportIssues()`
- ECO1 import: three-way merge by `issue.id` + `updatedAt` (Gap #1 resolution)

### 3. Three-way merge on ECO1 import

Import does NOT replace local issues. Merge strategy:

- Match by `issue.id`
- Import wins if `importedUpdatedAt >= localUpdatedAt`
- Local wins if `localUpdatedAt > importedUpdatedAt`
- Unmatched local issues preserved (created after export)
- Rationale: Issues are regulatory audit records — silent data loss is unacceptable

### 4. Shift+click gesture for creation (desktop)

- `event.shiftKey` detected in `picker.js` `onCanvasMouseUp`
- Priority guard: `isVoxelEditing() || isEditMode()` checked first (RED-C1)
- Mobile alternative: long-press 500ms via `touchstart` timer
- Shift+click is now a reserved gesture — documented here

### 5. Severity-driven 3D markers

| Severity | Geometry           | Color   | Radius     |
| -------- | ------------------ | ------- | ---------- |
| low      | Sphere             | #3498db | 0.3        |
| medium   | Cylinder           | #f39c12 | 0.3, h=0.8 |
| high     | Inverted Cone      | #e74c3c | 0.4, h=1.0 |
| critical | Octahedron + pulse | #8e44ad | 0.5        |

Markers use `userData.type = 'issue-marker'` and `userData.issueId` for picker.
Maximum 500 visible markers (open + visible only) to protect frame rate.

### 6. Issues panel as right-panel tab

Panel registered as `issues` tab in right panel (alongside Properties, Inspector).
Tab visible only when `FEATURES.ISSUES_3D === true`. Badge shows open issue count.

### 7. Feature flag

`CONFIG.FEATURES.ISSUES_3D` (default `true`). Read once at init. When false:

- Shift+click no-op
- Issues panel tab hidden
- Markers not rendered
- Manager functions return null/empty (no throw)

### 8. XSS sanitization at import boundary

`title`, `description`, `resolution`, `comments[].text` sanitized via
`escapeHtml()` from `utils/helpers/html.js` during ECO1 import in `validator.js`.

### 9. Bug Bounty extension (reputation-based rewards)

Issues with `type: 'bounty'` carry a `bounty` sub-object with tier, reward points,
flag type, and claim/verify tracking. Tier is derived from severity:

| Severity | Tier     | Points |
| -------- | -------- | ------ |
| low      | bronze   | 5      |
| medium   | silver   | 15     |
| high     | gold     | 40     |
| critical | platinum | 100    |

Workflow: Create (open) → Claim (in_progress) → Resolve → Verify (points awarded).
Leaderboard is computed on-the-fly from `_issues[]` — no separate state or IDB key.
Points only credited when a bounty is both resolved AND verified by a different user
than the claimer. Users cannot claim their own bounties.

Flag types classify the environmental issue: `data_quality`, `compliance`,
`suspicious_reading`, `equipment`, `general`.

Rationale: Encourages collaborative data quality improvement in environmental
monitoring. Reputation-based (not monetary) to avoid regulatory complications.

## Alternatives Considered

- **Redux-like global store**: Rejected — breaks module encapsulation pattern
- **Issues as element property**: Rejected — issues can exist without element link
- **BCF XML format**: Rejected — overkill for client-only MVP; interop deferred
- **depthTest: false on markers**: Rejected — causes z-order artifacts with other meshes

## Consequences

- New IDB key `ecbyts-issues` must be in `IDB_MODEL_KEYS` for `clearModelData()`
- `encoder.js` and `decoder.js` get new `model.issues` section
- `picker.js` gains Shift-click dispatch (must not break existing selection)
- syncQueue table `issues` will need Supabase schema when online sync is enabled
