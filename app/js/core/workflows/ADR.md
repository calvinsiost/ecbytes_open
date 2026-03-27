# ADR — Workflow Engine

## Status: Accepted (2026-02-26)

**Atualizado:** 2026-03-26

## Context

ecbyts has powerful modules (validation, interpolation, voxel, EIS, SAO) that
users must orchestrate manually. Environmental engineers need problem-oriented
workflows ("Plume Delineation CONAMA 420") that chain these modules automatically.

## Decisions

### 1. Immutable State Machine (like ingestion/wizard.js)

Workflow state is immutable — every advance returns a new object. This enables
safe back-navigation and crash recovery without rollback logic.

**Alternatives considered**: Mutable state (spatial wizard pattern) — rejected
because workflows have more steps and need reliable undo.

### 2. Data-Driven Step Definitions

Workflows are defined as arrays of step objects, not hardcoded switch/case.
New workflows can be added by creating a definition file — no engine changes.

**Step types**: `info`, `decision`, `execution`, `review`.

### 3. Dynamic Imports in Orchestrator

All imports from other core modules (`validation/`, `interpolation/`, `voxel/`)
use `import()` to avoid circular dependencies and keep the module loadable even
if a dependency fails.

### 4. Registry Pattern

Workflows register in a central `Map<id, definition>`. The UI queries the registry
to build the workflow picker. Third-party workflows could be registered at runtime.

### 5. Agentic LLM Integration

The LLM can trigger workflows via `START_WORKFLOW` action with pre-filled decisions.
Read-only state queries (`QUERY_STATE`, `QUERY_COMPLIANCE`) run without user
confirmation, enabling multi-turn reasoning before suggesting actions.

### 6. Cloud-Only Agentic Mode

Multi-turn agent loops are restricted to cloud LLM engines. Browser/local engines
(2B-7B parameters) stay single-turn with the lite prompt — they lack the context
window and reliability for multi-step function calling.

## Consequences

- Adding a workflow requires only a definition file + registration
- Engine is testable in isolation (pure functions, no DOM)
- Orchestrator depends on stable public APIs of existing modules
- LLM agentic mode adds ~150 tokens to the system prompt per function definition
