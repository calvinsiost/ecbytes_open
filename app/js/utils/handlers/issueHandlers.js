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
   ISSUE HANDLERS — window.* functions for Issues 3D
   ================================================================ */

import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { escapeHtml } from '../helpers/html.js';
import {
    createIssue,
    updateIssue,
    resolveIssue,
    deleteIssue,
    getIssues,
    getIssue,
    getIssuesByElement,
    getOpenIssueCount,
    loadIssues,
    exportIssues,
    importIssues,
} from '../../core/issues/manager.js';
import { refreshAllMarkers, removeMarker, updateMarkerAppearance } from '../../core/issues/issueMarker.js';
import { focusOnIssue } from '../ui/issuesPanel.js';

/**
 * Create an issue at a 3D position (called by picker.js Shift+click).
 * Also supports headless mode (pipeline P2) when params._headless is set.
 *
 * @param {Object} positionOrParams - {x,y,z} position OR headless params object
 * @param {string} [elementId] - Optional linked element ID
 */
function handleCreateIssueAtPosition(positionOrParams, elementId) {
    // Headless mode (pipeline P2)
    if (positionOrParams && positionOrParams._headless) {
        const { x, y, z, title, severity, type, description, elementId: elId, flagType } = positionOrParams;
        const issue = createIssue({
            title: title || 'Untitled Issue',
            position: { x: x || 0, y: y || 0, z: z || 0 },
            severity: severity || 'medium',
            type: type || 'nonconformity',
            description: description || '',
            elementId: elId || null,
            flagType: flagType || undefined,
        });
        return issue ? { success: true, issueId: issue.id } : { error: 'creation_failed' };
    }

    // Interactive mode: open mini-form
    const position = positionOrParams || { x: 0, y: 0, z: 0 };
    _openIssueCreateForm(position, elementId);
}

/**
 * Create issues from validation results (batch).
 * Called by handleRunValidationProfile after asyncConfirm.
 *
 * @param {Object[]} candidates - Array of {elementId, parameterId, value, threshold, unit, ruleId}
 */
function handleCreateIssuesFromValidation(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return;

    let created = 0;
    for (const c of candidates) {
        const el = window.getElementById?.(c.elementId);
        const title = `${c.parameterId || 'Parameter'} > ${c.threshold || 'VI'} — ${el?.name || c.elementId}`;

        const issue = createIssue({
            type: 'nonconformity',
            title,
            position: el?.data?.coordinates
                ? { x: el.data.coordinates.easting || 0, y: 0, z: el.data.coordinates.northing || 0 }
                : { x: 0, y: 0, z: 0 },
            elementId: c.elementId,
            parameterId: c.parameterId,
            ruleId: c.ruleId || null,
            measuredValue: c.value ?? null,
            thresholdValue: c.threshold ?? null,
            unit: c.unit || null,
            severity: 'high',
        });
        if (issue) created++;
    }

    if (created > 0) {
        showToast(`${created} issue(s) ${t('issues.created') || 'created'}`, 'success');
        refreshAllMarkers();
    }
}

/**
 * Resolve an issue by ID.
 * @param {string} issueId
 */
function handleResolveIssue(issueId) {
    const issue = getIssue(issueId);
    if (!issue) return;

    const resolution = prompt(t('issues.resolution_prompt') || 'Resolution:');
    if (resolution === null) return;

    resolveIssue(issueId, resolution);
    updateMarkerAppearance(issueId);
    showToast(t('issues.resolved') || 'Issue resolved', 'success');
}

/**
 * Delete an issue by ID.
 * @param {string} issueId
 */
function handleDeleteIssue(issueId) {
    if (!confirm(t('issues.delete_confirm') || 'Delete this issue?')) return;
    removeMarker(issueId);
    deleteIssue(issueId);
    showToast(t('issues.deleted') || 'Issue deleted', 'info');
}

/**
 * Focus camera on an issue.
 * @param {string} issueId
 */
function handleFocusIssue(issueId) {
    focusOnIssue(issueId);
}

/**
 * Open issues panel.
 */
function handleOpenIssuesPanel() {
    // Switch to issues tab in right panel
    if (window.activateTab) {
        window.activateTab('issues');
    }
}

/**
 * Get all issues (for API bridge).
 * @returns {Object[]}
 */
function handleGetIssues() {
    return getIssues();
}

/**
 * Get open issue count (for badges/status).
 * @returns {number}
 */
function handleGetOpenIssueCount() {
    return getOpenIssueCount();
}

// --- Mini-form for interactive issue creation ------------------------

function _openIssueCreateForm(position, elementId) {
    // Check if form already exists
    let form = document.getElementById('issue-create-modal');
    if (form) form.remove();

    form = document.createElement('div');
    form.id = 'issue-create-modal';
    form.className = 'modal active';
    form.style.cssText = 'z-index:9000;';

    const elName = elementId && window.getElementById?.(elementId)?.name;

    const tierMap = { low: 'Bronze (5pt)', medium: 'Silver (15pt)', high: 'Gold (40pt)', critical: 'Platinum (100pt)' };

    form.innerHTML = `
        <div class="modal-content" style="max-width:440px;margin:auto;padding:20px;">
            <h3 style="margin:0 0 12px;">${t('issues.create_title') || 'New Issue'}</h3>
            ${elName ? `<div style="font-size:12px;color:var(--text-muted,#888);margin-bottom:8px;">${escapeHtml(t('issues.linked_to') || 'Linked to')}: ${escapeHtml(elName)}</div>` : ''}
            <div style="margin-bottom:8px;">
                <label style="font-size:12px;display:block;margin-bottom:2px;">${t('issues.title') || 'Title'} *</label>
                <input id="issue-title" type="text" maxlength="120" required
                    style="width:100%;box-sizing:border-box;padding:6px;"
                    placeholder="${t('issues.title_placeholder') || 'Describe the issue...'}">
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <div style="flex:1;">
                    <label style="font-size:12px;display:block;margin-bottom:2px;">${t('issues.severity') || 'Severity'}</label>
                    <select id="issue-severity" style="width:100%;padding:6px;">
                        <option value="low">Low</option>
                        <option value="medium" selected>Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                    </select>
                </div>
                <div style="flex:1;">
                    <label style="font-size:12px;display:block;margin-bottom:2px;">Type</label>
                    <select id="issue-type" style="width:100%;padding:6px;">
                        <option value="nonconformity">Issue</option>
                        <option value="bounty">&#9733; Bounty</option>
                    </select>
                </div>
            </div>
            <div id="issue-bounty-extras" style="display:none;margin-bottom:8px;">
                <label style="font-size:12px;display:block;margin-bottom:2px;">${t('bounty.flag_type') || 'Flag Type'}</label>
                <select id="issue-flag-type" style="width:100%;padding:6px;">
                    <option value="general">General</option>
                    <option value="data_quality">Data Quality</option>
                    <option value="compliance">Compliance</option>
                    <option value="suspicious_reading">Suspicious Reading</option>
                    <option value="equipment">Equipment</option>
                </select>
                <div id="issue-tier-display" style="font-size:11px;color:var(--text-muted,#888);margin-top:4px;padding:4px 8px;border-radius:3px;background:rgba(255,215,0,0.08);">
                    Tier: Silver (15pt)
                </div>
            </div>
            <div style="margin-bottom:12px;">
                <label style="font-size:12px;display:block;margin-bottom:2px;">${t('issues.description') || 'Description'}</label>
                <textarea id="issue-description" rows="3"
                    style="width:100%;box-sizing:border-box;padding:6px;resize:vertical;"
                    placeholder="${t('issues.description_placeholder') || 'Optional details...'}"></textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn-secondary" id="issue-cancel">${t('common.cancel') || 'Cancel'}</button>
                <button class="btn-primary" id="issue-submit" type="submit">${t('issues.create') || 'Create'}</button>
            </div>
        </div>
    `;

    document.body.appendChild(form);

    // Focus title input
    const titleInput = document.getElementById('issue-title');
    setTimeout(() => titleInput?.focus(), 50);

    // Toggle bounty extras visibility
    const typeSelect = document.getElementById('issue-type');
    const bountyExtras = document.getElementById('issue-bounty-extras');
    const sevSelect = document.getElementById('issue-severity');
    const tierDisplay = document.getElementById('issue-tier-display');

    function _updateExtras() {
        const isBounty = typeSelect.value === 'bounty';
        bountyExtras.style.display = isBounty ? '' : 'none';
        if (isBounty) {
            tierDisplay.textContent = `Tier: ${tierMap[sevSelect.value] || tierMap.medium}`;
        }
    }
    typeSelect.addEventListener('change', _updateExtras);
    sevSelect.addEventListener('change', _updateExtras);

    // Submit
    document.getElementById('issue-submit').addEventListener('click', () => {
        const title = titleInput?.value?.trim();
        if (!title) {
            titleInput.style.borderColor = '#e74c3c';
            return;
        }

        const severity = sevSelect.value || 'medium';
        const description = document.getElementById('issue-description')?.value || '';
        const type = typeSelect.value || 'nonconformity';
        const flagType = document.getElementById('issue-flag-type')?.value || 'general';

        const issue = createIssue({
            title,
            severity,
            description,
            position,
            elementId: elementId || null,
            type,
            flagType: type === 'bounty' ? flagType : undefined,
        });

        if (issue) {
            const msg =
                type === 'bounty' ? t('bounty.created') || 'Bounty created' : t('issues.created') || 'Issue created';
            showToast(msg, 'success');
            refreshAllMarkers();
        }
        form.remove();
    });

    // Cancel
    document.getElementById('issue-cancel').addEventListener('click', () => form.remove());

    // Escape key
    form.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') form.remove();
    });
}

// --- Export -----------------------------------------------------------

export const issueHandlers = {
    handleCreateIssueAtPosition,
    handleCreateIssuesFromValidation,
    handleResolveIssue,
    handleDeleteIssue,
    handleFocusIssue,
    handleOpenIssuesPanel,
    handleGetIssues,
    handleGetOpenIssueCount,
};
