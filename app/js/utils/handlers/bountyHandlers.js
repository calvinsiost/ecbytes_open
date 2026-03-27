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
   BOUNTY HANDLERS — window.* functions for Bug Bounty
   ================================================================

   Handlers publicos para o sistema de bounty.
   Registrados em handlers/index.js como window.* functions.

   ================================================================ */

import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { showLastEvidenceForIssue } from '../ui/bountyPanel.js';
import {
    createIssue,
    updateIssue,
    claimIssue,
    resolveIssue,
    addAttachment,
    getIssue,
    verifyResolution,
    getLeaderboard,
    getBountyIssues,
    getOpenBountyCount,
    SERVICE_TYPES,
} from '../../core/issues/manager.js';
import { refreshAllMarkers, getMarkerPosition } from '../../core/issues/issueMarker.js';
import { getRenderer, getScene, getCamera, requestRender } from '../scene/setup.js';
import { getCurrentUser } from '../auth/session.js';
import { escapeHtml } from '../helpers/html.js';

// --- Bounty tier info (kept in sync with manager.js BOUNTY_TIERS) ----

const TIER_MAP = {
    low: { tier: 'Bronze', points: 5 },
    medium: { tier: 'Silver', points: 15 },
    high: { tier: 'Gold', points: 40 },
    critical: { tier: 'Platinum', points: 100 },
};

const FLAG_OPTIONS = [
    { value: 'general', label: 'General' },
    { value: 'data_quality', label: 'Data Quality' },
    { value: 'compliance', label: 'Compliance' },
    { value: 'suspicious_reading', label: 'Suspicious Reading' },
    { value: 'equipment', label: 'Equipment' },
];

// --- Handlers --------------------------------------------------------

/**
 * Open the bounty tab in the side panel layout.
 */
function handleOpenBountyPanel() {
    if (window.activateTab) {
        window.activateTab('bounty');
    }
}

/**
 * Create a new bounty via modal dialog.
 * Called from bounty panel "+" button or ribbon.
 * @param {Object} [params] - Optional preset values {position, elementId}
 */
function handleCreateBounty(params = {}) {
    let form = document.getElementById('bounty-create-modal');
    if (form) form.remove();

    form = document.createElement('div');
    form.id = 'bounty-create-modal';
    form.className = 'modal active';
    form.style.cssText = 'z-index:9000;';

    const user = getCurrentUser();
    const createdBy = user?.email || 'local';

    form.innerHTML = `
        <div class="modal-content" style="max-width:440px;margin:auto;padding:20px;">
            <h3 style="margin:0 0 12px;">&#9733; ${t('bounty.create_title') || 'New Bounty'}</h3>
            <div style="margin-bottom:8px;">
                <label style="font-size:12px;display:block;margin-bottom:2px;">${t('issues.title') || 'Title'} *</label>
                <input id="bounty-title" type="text" maxlength="120" required
                    style="width:100%;box-sizing:border-box;padding:6px;"
                    placeholder="${t('bounty.title_placeholder') || 'Describe the issue to investigate...'}">
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <div style="flex:1;">
                    <label style="font-size:12px;display:block;margin-bottom:2px;">${t('issues.severity') || 'Severity'}</label>
                    <select id="bounty-severity" style="width:100%;padding:6px;">
                        <option value="low">Low</option>
                        <option value="medium" selected>Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                    </select>
                </div>
                <div style="flex:1;">
                    <label style="font-size:12px;display:block;margin-bottom:2px;">${t('bounty.flag_type') || 'Flag Type'}</label>
                    <select id="bounty-flag-type" style="width:100%;padding:6px;">
                        ${FLAG_OPTIONS.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div id="bounty-tier-display" style="font-size:11px;color:var(--text-muted,#888);margin-bottom:8px;padding:4px 8px;border-radius:3px;background:rgba(255,215,0,0.08);">
                Tier: Silver &#8226; 15 pts
            </div>
            <div style="margin-bottom:12px;">
                <label style="font-size:12px;display:block;margin-bottom:2px;">${t('issues.description') || 'Description'}</label>
                <textarea id="bounty-description" rows="3"
                    style="width:100%;box-sizing:border-box;padding:6px;resize:vertical;"
                    placeholder="${t('bounty.description_placeholder') || 'Evidence, context, suspected cause...'}"></textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn-secondary" id="bounty-cancel">${t('common.cancel') || 'Cancel'}</button>
                <button class="btn-primary" id="bounty-submit">${t('bounty.create') || 'Create Bounty'}</button>
            </div>
        </div>
    `;

    document.body.appendChild(form);

    // Dynamic tier display
    const sevSelect = document.getElementById('bounty-severity');
    const tierDisplay = document.getElementById('bounty-tier-display');
    function _updateTierDisplay() {
        const info = TIER_MAP[sevSelect.value] || TIER_MAP.medium;
        tierDisplay.textContent = `Tier: ${info.tier} \u2022 ${info.points} pts`;
    }
    sevSelect.addEventListener('change', _updateTierDisplay);

    // Focus title
    const titleInput = document.getElementById('bounty-title');
    setTimeout(() => titleInput?.focus(), 50);

    // Submit
    document.getElementById('bounty-submit').addEventListener('click', () => {
        const title = titleInput?.value?.trim();
        if (!title) {
            titleInput.style.borderColor = '#e74c3c';
            return;
        }

        const severity = sevSelect.value || 'medium';
        const flagType = document.getElementById('bounty-flag-type')?.value || 'general';
        const description = document.getElementById('bounty-description')?.value || '';

        const issue = createIssue({
            title,
            severity,
            description,
            type: 'bounty',
            flagType,
            position: params.position || { x: 0, y: 0, z: 0 },
            elementId: params.elementId || null,
            createdBy,
        });

        if (issue) {
            showToast(t('bounty.created') || 'Bounty created', 'success');
            refreshAllMarkers();
        }
        form.remove();
    });

    // Cancel + Escape
    document.getElementById('bounty-cancel').addEventListener('click', () => form.remove());
    form.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') form.remove();
    });
}

/**
 * Claim a bounty.
 * @param {string} issueId
 */
function handleClaimBounty(issueId) {
    const user = getCurrentUser();
    if (!user?.email) {
        showToast(t('bounty.sign_in') || 'Sign in to claim bounties', 'warning');
        return;
    }

    const result = claimIssue(issueId, user.email);
    if (result) {
        showToast(t('bounty.claimed_success') || 'Bounty claimed', 'success');
    } else {
        showToast(t('bounty.claim_failed') || 'Cannot claim this bounty', 'error');
    }
}

/**
 * Submit resolution for a bounty.
 * @param {string} issueId
 * @param {string} [resolutionText]
 */
function handleSubmitBountyResolution(issueId, resolutionText) {
    const user = getCurrentUser();
    if (!user?.email) {
        showToast(t('bounty.sign_in') || 'Sign in to resolve', 'warning');
        return;
    }

    const issue = getIssue(issueId);
    const canResolve = issue?.bounty && issue.status === 'in_progress' && issue.bounty.claimedBy === user.email;

    if (!canResolve) {
        showToast(t('bounty.resolve_denied') || 'Only the claimer can resolve an in-progress bounty', 'error');
        return;
    }

    const resolution =
        typeof resolutionText === 'string' ? resolutionText : prompt(t('issues.resolution_prompt') || 'Resolution:');
    if (resolution === null) return;

    const result = resolveIssue(issueId, resolution);
    if (result) {
        showToast(t('bounty.resolved_success') || 'Resolution submitted', 'success');
    } else {
        showToast(t('bounty.resolve_failed') || 'Cannot resolve this bounty', 'error');
    }
}

/**
 * Verify a bounty resolution.
 * @param {string} issueId
 */
function handleVerifyBountyResolution(issueId) {
    const user = getCurrentUser();
    if (!user?.email) {
        showToast(t('bounty.sign_in') || 'Sign in to verify', 'warning');
        return;
    }

    const result = verifyResolution(issueId, user.email);
    if (result) {
        showToast(t('bounty.verified_success') || 'Bounty verified — points awarded', 'success');
    } else {
        showToast(t('bounty.verify_failed') || 'Cannot verify this bounty', 'error');
    }
}

/**
 * Get leaderboard data (for API bridge).
 * @returns {Array}
 */
function handleGetLeaderboard() {
    return getLeaderboard();
}

/**
 * Get open bounty count (for statusbar).
 * @returns {number}
 */
function handleGetOpenBountyCount() {
    return getOpenBountyCount();
}

/**
 * Capture a screenshot of the 3D viewport focused on the bounty marker
 * and save it as an attachment (evidence) on the issue.
 * @param {string} issueId
 */
function handleCaptureBountyScreenshot(issueId) {
    const issue = getIssue(issueId);
    const pos = getMarkerPosition(issueId) || issue?.position || null;
    if (!pos) {
        showToast(t('bounty.no_marker') || 'No marker found for this bounty', 'warning');
        return;
    }

    // Animate camera to marker position
    if (window.animateCameraState) {
        window.animateCameraState({
            target: { x: pos.x, y: pos.y, z: pos.z },
            distance: 15,
        });
    }

    // Wait for animation + render, then capture
    setTimeout(() => {
        const renderer = getRenderer();
        const scene = getScene();
        const camera = getCamera();
        if (!renderer || !scene || !camera) {
            showToast(t('bounty.screenshot_failed') || 'Screenshot failed — scene not ready', 'error');
            return;
        }

        requestRender();
        renderer.render(scene, camera);

        try {
            const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.85);
            const attachment = addAttachment(issueId, {
                type: 'screenshot',
                dataUrl,
                label: `Evidence capture - ${new Date().toLocaleString()}`,
            });

            if (attachment) {
                showToast(t('bounty.screenshot_saved') || 'Screenshot saved as evidence', 'success');
                showLastEvidenceForIssue(issueId); // abrir imediatamente após captura
            } else {
                showToast(t('bounty.screenshot_failed') || 'Screenshot failed - scene not ready', 'error');
            }
        } catch (_) {
            showToast(t('bounty.screenshot_failed') || 'Screenshot failed - scene not ready', 'error');
        }
    }, 800);
}

/**
 * Create a new service request via modal dialog (or headless).
 * @param {Object} [params] - Optional preset values {position, elementId, serviceType, title, _headless}
 */
function handleCreateServiceRequest(params = {}) {
    const user = getCurrentUser();
    const createdBy = user?.email || 'local';

    // Headless path for E2E / API testing
    if (params._headless) {
        return createIssue({
            type: 'service_request',
            status: 'planned',
            title:
                params.title || `[Planejado] ${SERVICE_TYPES[params.serviceType] || params.serviceType || 'Serviço'}`,
            serviceType: params.serviceType || 'well_installation',
            severity: params.severity || 'medium',
            position: params.position || { x: 0, y: 0, z: 0 },
            elementId: params.elementId || null,
            estimatedCost: params.estimatedCost || null,
            currency: params.currency || 'BRL',
            createdBy,
        });
    }

    let form = document.getElementById('service-request-modal');
    if (form) form.remove();

    form = document.createElement('div');
    form.id = 'service-request-modal';
    form.className = 'modal active';
    form.style.cssText = 'z-index:9000;';

    const serviceOptions = Object.entries(SERVICE_TYPES)
        .map(([k, v]) => `<option value="${escapeHtml(k)}">${escapeHtml(v)}</option>`)
        .join('');

    form.innerHTML = `
        <div class="modal-content" style="max-width:440px;margin:auto;padding:20px;">
            <h3 style="margin:0 0 12px;">&#9432; ${t('bounty.service_request_title') || 'Service Request'}</h3>
            <div style="margin-bottom:8px;">
                <label style="font-size:12px;display:block;margin-bottom:2px;">${t('service.type') || 'Service Type'} *</label>
                <select id="sr-service-type" style="width:100%;padding:6px;">${serviceOptions}</select>
            </div>
            <div style="margin-bottom:8px;">
                <label style="font-size:12px;display:block;margin-bottom:2px;">${t('issues.title') || 'Title'}</label>
                <input id="sr-title" type="text" maxlength="120"
                    style="width:100%;box-sizing:border-box;padding:6px;"
                    placeholder="${t('service.title_placeholder') || 'Optional custom title...'}">
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <div style="flex:1;">
                    <label style="font-size:12px;display:block;margin-bottom:2px;">${t('service.estimated_cost') || 'Estimated Cost'}</label>
                    <input id="sr-cost" type="number" min="0" step="100"
                        style="width:100%;box-sizing:border-box;padding:6px;"
                        placeholder="0">
                </div>
                <div style="flex:0 0 80px;">
                    <label style="font-size:12px;display:block;margin-bottom:2px;">${t('common.currency') || 'Currency'}</label>
                    <select id="sr-currency" style="width:100%;padding:6px;">
                        <option value="BRL" selected>BRL</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                    </select>
                </div>
            </div>
            <div style="margin-bottom:12px;">
                <label style="font-size:12px;display:block;margin-bottom:2px;">${t('issues.description') || 'Description'}</label>
                <textarea id="sr-description" rows="3"
                    style="width:100%;box-sizing:border-box;padding:6px;resize:vertical;"
                    placeholder="${t('service.description_placeholder') || 'Location, specifications, urgency...'}"></textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn-secondary" id="sr-cancel">${t('common.cancel') || 'Cancel'}</button>
                <button class="btn-primary" id="sr-submit">${t('bounty.service_request_create') || 'Create Service Request'}</button>
            </div>
        </div>
    `;

    document.body.appendChild(form);
    setTimeout(() => document.getElementById('sr-service-type')?.focus(), 50);

    document.getElementById('sr-submit').addEventListener('click', () => {
        const serviceType = document.getElementById('sr-service-type')?.value || 'well_installation';
        const customTitle = document.getElementById('sr-title')?.value?.trim();
        const title = customTitle || `[Planejado] ${SERVICE_TYPES[serviceType] || serviceType}`;
        const estimatedCost = parseFloat(document.getElementById('sr-cost')?.value) || null;
        const currency = document.getElementById('sr-currency')?.value || 'BRL';
        const description = document.getElementById('sr-description')?.value || '';

        const issue = createIssue({
            type: 'service_request',
            status: 'planned',
            title,
            description,
            serviceType,
            severity: 'medium',
            estimatedCost,
            currency,
            position: params.position || { x: 0, y: 0, z: 0 },
            elementId: params.elementId || null,
            createdBy,
        });

        if (issue) {
            showToast(t('bounty.service_created') || 'Service request created', 'success');
            if (window.handleOpenBountyPanel) window.handleOpenBountyPanel();
        }
        form.remove();
    });

    document.getElementById('sr-cancel').addEventListener('click', () => form.remove());
    form.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') form.remove();
    });
}

/**
 * Publish a planned service request (planned → open).
 * @param {string} issueId
 */
function handlePublishServiceRequest(issueId) {
    const issue = getIssue(issueId);
    if (!issue || issue.type !== 'service_request') return;

    const result = updateIssue(issueId, { status: 'open' });
    if (result) {
        showToast(t('bounty.service_published') || 'Service request published', 'success');
    } else {
        showToast(t('bounty.service_publish_failed') || 'Cannot publish service request', 'error');
    }
}

// --- Export -----------------------------------------------------------

export const bountyHandlers = {
    handleOpenBountyPanel,
    handleCreateBounty,
    handleClaimBounty,
    handleSubmitBountyResolution,
    handleVerifyBountyResolution,
    handleGetLeaderboard,
    handleGetOpenBountyCount,
    handleCaptureBountyScreenshot,
    handleCreateServiceRequest,
    handlePublishServiceRequest,
};
