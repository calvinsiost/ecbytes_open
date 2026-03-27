// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   ISSUES PANEL — Dockable list in right panel
   ================================================================

   Painel de issues 3D como tab no right panel.
   Lista com filtros por severidade/status, foco de camera, resolve inline.

   ================================================================ */

import { t } from '../i18n/translations.js';
import { getIcon } from './icons.js';
import {
    getIssues,
    getIssue,
    getOpenIssueCount,
    updateIssue,
    resolveIssue,
    deleteIssue,
} from '../../core/issues/manager.js';
import { highlightMarker, getMarkerPosition } from '../../core/issues/issueMarker.js';
import { eventBus, Events } from '../../core/analytics/eventBus.js';

// --- State -----------------------------------------------------------

let _container = null;
let _filterSeverity = 'all';
let _filterStatus = 'all';
let _selectedIssueId = null;

// --- Severity display ------------------------------------------------

const SEVERITY_LABELS = {
    low: { label: 'Low', color: '#3498db' },
    medium: { label: 'Medium', color: '#f39c12' },
    high: { label: 'High', color: '#e74c3c' },
    critical: { label: 'Critical', color: '#8e44ad' },
};

const STATUS_LABELS = {
    open: 'Open',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    wontfix: "Won't Fix",
};

// --- Public API ------------------------------------------------------

/**
 * Initialize the issues panel inside a container element.
 * @param {HTMLElement} container
 */
export function initIssuesPanel(container) {
    _container = container;
    _render();

    // Auto-refresh on issue events
    eventBus.on(Events.ISSUE_CREATED, () => _render());
    eventBus.on(Events.ISSUE_UPDATED, () => _render());
    eventBus.on(Events.ISSUE_DELETED, () => _render());
}

/**
 * Get the badge count for the tab.
 * @returns {number}
 */
export function getIssuesBadgeCount() {
    return getOpenIssueCount();
}

/**
 * Focus camera on an issue's 3D position.
 * @param {string} issueId
 */
export function focusOnIssue(issueId) {
    const pos = getMarkerPosition(issueId);
    if (!pos) return;

    // Use animateCameraState if available
    if (window.animateCameraState) {
        window.animateCameraState({
            target: { x: pos.x, y: pos.y, z: pos.z },
            distance: 15,
        });
    }

    eventBus.emit(Events.ISSUE_FOCUSED, { issueId, position: pos });
    highlightMarker(issueId, true);
    setTimeout(() => highlightMarker(issueId, false), 2000);
}

// --- Rendering -------------------------------------------------------

function _render() {
    if (!_container) return;

    const issues = getIssues();
    const filtered = _applyFilters(issues);

    _container.innerHTML = '';

    // Toolbar (filters)
    const toolbar = document.createElement('div');
    toolbar.className = 'issues-toolbar';
    toolbar.style.cssText =
        'display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border-color,#333);align-items:center;flex-wrap:wrap;';

    // Severity filter
    const sevSelect = _createSelect(
        'severity',
        [
            { value: 'all', label: t('issues.all_severities') || 'All' },
            ...Object.entries(SEVERITY_LABELS).map(([k, v]) => ({ value: k, label: v.label })),
        ],
        _filterSeverity,
        (val) => {
            _filterSeverity = val;
            _render();
        },
    );
    sevSelect.style.cssText = 'flex:1;min-width:80px;font-size:11px;';
    toolbar.appendChild(sevSelect);

    // Status filter
    const statSelect = _createSelect(
        'status',
        [
            { value: 'all', label: t('issues.all_statuses') || 'All' },
            ...Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v })),
        ],
        _filterStatus,
        (val) => {
            _filterStatus = val;
            _render();
        },
    );
    statSelect.style.cssText = 'flex:1;min-width:80px;font-size:11px;';
    toolbar.appendChild(statSelect);

    // Count badge
    const badge = document.createElement('span');
    badge.className = 'issues-count';
    badge.style.cssText = 'font-size:11px;color:var(--text-muted,#888);white-space:nowrap;';
    badge.textContent = `${filtered.length}/${issues.length}`;
    toolbar.appendChild(badge);

    _container.appendChild(toolbar);

    // List
    const list = document.createElement('div');
    list.className = 'issues-list';
    list.style.cssText = 'overflow-y:auto;flex:1;';

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:20px;text-align:center;color:var(--text-muted,#888);font-size:12px;';
        empty.textContent = t('issues.no_issues') || 'No issues found';
        list.appendChild(empty);
    } else {
        for (const issue of filtered) {
            list.appendChild(_renderIssueRow(issue));
        }
    }

    _container.appendChild(list);
}

function _renderIssueRow(issue) {
    const row = document.createElement('div');
    row.className = 'issue-row';
    row.dataset.issueId = issue.id;
    row.style.cssText = `
        display:flex;align-items:center;gap:6px;padding:6px 8px;
        border-bottom:1px solid var(--border-color,#222);cursor:pointer;
        font-size:12px;transition:background 0.15s;
    `;

    if (issue.id === _selectedIssueId) {
        row.style.background = 'var(--selection-bg,rgba(52,152,219,0.15))';
    }

    // Severity dot
    const dot = document.createElement('span');
    const sevConfig = SEVERITY_LABELS[issue.severity] || SEVERITY_LABELS.medium;
    dot.style.cssText = `width:10px;height:10px;border-radius:50%;flex-shrink:0;background:${sevConfig.color};`;
    if (issue.status === 'resolved' || issue.status === 'wontfix') {
        dot.style.background = '#95a5a6';
    }
    row.appendChild(dot);

    // Title + element info
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';
    const title = document.createElement('div');
    title.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    title.textContent = issue.title;
    info.appendChild(title);

    if (issue.elementId) {
        const elInfo = document.createElement('div');
        elInfo.style.cssText = 'font-size:10px;color:var(--text-muted,#888);';
        const el = window.getElementById?.(issue.elementId);
        elInfo.textContent = el ? el.name : `(${t('issues.element_removed') || 'elemento removido'})`;
        info.appendChild(elInfo);
    }
    row.appendChild(info);

    // Status chip
    const chip = document.createElement('span');
    chip.style.cssText = `font-size:10px;padding:1px 5px;border-radius:3px;white-space:nowrap;
        background:${issue.status === 'open' ? 'rgba(231,76,60,0.15)' : 'rgba(149,165,166,0.15)'};
        color:${issue.status === 'open' ? '#e74c3c' : '#95a5a6'};`;
    chip.textContent = STATUS_LABELS[issue.status] || issue.status;
    row.appendChild(chip);

    // Click → focus camera
    row.addEventListener('click', () => {
        _selectedIssueId = issue.id;
        focusOnIssue(issue.id);
        _render();
    });

    // Context actions on double-click → resolve
    row.addEventListener('dblclick', () => {
        if (issue.status === 'open' || issue.status === 'in_progress') {
            const resolution = prompt(t('issues.resolution_prompt') || 'Resolution:');
            if (resolution !== null) {
                resolveIssue(issue.id, resolution);
            }
        }
    });

    return row;
}

// --- Helpers ---------------------------------------------------------

function _applyFilters(issues) {
    return issues.filter((i) => {
        if (_filterSeverity !== 'all' && i.severity !== _filterSeverity) return false;
        if (_filterStatus !== 'all' && i.status !== _filterStatus) return false;
        return true;
    });
}

function _createSelect(name, options, value, onChange) {
    const sel = document.createElement('select');
    sel.name = name;
    for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === value) o.selected = true;
        sel.appendChild(o);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
}
