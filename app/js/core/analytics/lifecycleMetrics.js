// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   LIFECYCLE METRICS - Workflow/Pipeline operational telemetry
   ================================================================ */

import { eventBus, Events } from './eventBus.js';

const STORAGE_KEY = 'ecbyts_lifecycle_metrics_v1';
const MAX_EVENTS = 250;
const RETENTION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

let _initialized = false;
const _starts = {
    workflow: new Map(),
    pipeline: new Map(),
};

let _state = {
    workflow: { started: 0, completed: 0, failed: 0, totalDurationMs: 0 },
    pipeline: { started: 0, completed: 0, failed: 0, totalDurationMs: 0 },
    events: [],
};

function _safeLoad() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        if (parsed.workflow && parsed.pipeline && Array.isArray(parsed.events)) {
            const cutoff = Date.now() - RETENTION_MS;
            _state = {
                workflow: parsed.workflow,
                pipeline: parsed.pipeline,
                events: parsed.events.filter((e) => Number(e.ts) >= cutoff).slice(-MAX_EVENTS),
            };
        }
    } catch (err) {
        console.warn('[analytics/lifecycleMetrics] Failed to load metrics:', err.message);
    }
}

function _safePersist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    } catch (err) {
        console.warn('[analytics/lifecycleMetrics] Failed to persist metrics:', err.message);
    }
}

function _pushEvent(kind, phase, payload = {}, durationMs = null) {
    _state.events.push({
        ts: Date.now(),
        kind,
        phase,
        durationMs,
        runId: payload.runId || null,
        workflowId: payload.workflowId || null,
        pipelineId: payload.pipelineId || null,
        nodeId: payload.nodeId || null,
    });
    if (_state.events.length > MAX_EVENTS) {
        _state.events = _state.events.slice(-MAX_EVENTS);
    }
}

function _onWorkflowStarted(payload = {}) {
    const key = payload.workflowId || 'workflow:unknown';
    _starts.workflow.set(key, Date.now());
    _state.workflow.started += 1;
    _pushEvent('workflow', 'started', payload, null);
    _safePersist();
}

function _onWorkflowCompleted(payload = {}) {
    const key = payload.workflowId || 'workflow:unknown';
    const startTs = _starts.workflow.get(key);
    const duration = Number.isFinite(startTs) ? Math.max(0, Date.now() - startTs) : null;
    if (Number.isFinite(duration)) _state.workflow.totalDurationMs += duration;
    _starts.workflow.delete(key);
    _state.workflow.completed += 1;
    _pushEvent('workflow', 'completed', payload, duration);
    _safePersist();
}

function _onWorkflowFailed(payload = {}) {
    const key = payload.workflowId || 'workflow:unknown';
    const startTs = _starts.workflow.get(key);
    const duration = Number.isFinite(startTs) ? Math.max(0, Date.now() - startTs) : null;
    if (Number.isFinite(duration)) _state.workflow.totalDurationMs += duration;
    _starts.workflow.delete(key);
    _state.workflow.failed += 1;
    _pushEvent('workflow', 'failed', payload, duration);
    _safePersist();
}

function _onPipelineStarted(payload = {}) {
    const key = payload.runId || payload.pipelineId || 'pipeline:unknown';
    _starts.pipeline.set(key, Date.now());
    _state.pipeline.started += 1;
    _pushEvent('pipeline', 'started', payload, null);
    _safePersist();
}

function _onPipelineCompleted(payload = {}) {
    const key = payload.runId || payload.pipelineId || 'pipeline:unknown';
    const startTs = _starts.pipeline.get(key);
    const duration = Number.isFinite(startTs) ? Math.max(0, Date.now() - startTs) : null;
    if (Number.isFinite(duration)) _state.pipeline.totalDurationMs += duration;
    _starts.pipeline.delete(key);
    _state.pipeline.completed += 1;
    _pushEvent('pipeline', 'completed', payload, duration);
    _safePersist();
}

function _onPipelineFailed(payload = {}) {
    const key = payload.runId || payload.pipelineId || 'pipeline:unknown';
    const startTs = _starts.pipeline.get(key);
    const duration = Number.isFinite(startTs) ? Math.max(0, Date.now() - startTs) : null;
    if (Number.isFinite(duration)) _state.pipeline.totalDurationMs += duration;
    _starts.pipeline.delete(key);
    _state.pipeline.failed += 1;
    _pushEvent('pipeline', 'failed', payload, duration);
    _safePersist();
}

export function initLifecycleMetrics() {
    if (_initialized) return;
    _initialized = true;
    _safeLoad();
    eventBus.on(Events.WORKFLOW_STARTED, _onWorkflowStarted);
    eventBus.on(Events.WORKFLOW_COMPLETED, _onWorkflowCompleted);
    eventBus.on(Events.WORKFLOW_FAILED, _onWorkflowFailed);
    eventBus.on(Events.PIPELINE_STARTED, _onPipelineStarted);
    eventBus.on(Events.PIPELINE_COMPLETED, _onPipelineCompleted);
    eventBus.on(Events.PIPELINE_FAILED, _onPipelineFailed);
}

export function getLifecycleMetrics() {
    const workflowAvgMs =
        _state.workflow.completed + _state.workflow.failed > 0
            ? _state.workflow.totalDurationMs / (_state.workflow.completed + _state.workflow.failed)
            : 0;
    const pipelineAvgMs =
        _state.pipeline.completed + _state.pipeline.failed > 0
            ? _state.pipeline.totalDurationMs / (_state.pipeline.completed + _state.pipeline.failed)
            : 0;

    return {
        workflow: {
            ..._state.workflow,
            avgDurationMs: workflowAvgMs,
        },
        pipeline: {
            ..._state.pipeline,
            avgDurationMs: pipelineAvgMs,
        },
        events: [..._state.events],
    };
}
