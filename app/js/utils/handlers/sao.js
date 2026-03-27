// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Architecture: Digital Twin Architecture (Blockchain + ML + LLM)
// Application: EHS & Mining
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   SAO HANDLERS — Protocol Scenario & Matrix Control
   Handlers SAO — Controle de Cenário e Matrizes do Protocolo

   Handlers para selecao de cenario, controle de tier e
   ativacao/desativacao de matrizes ambientais SAO.
   ================================================================ */

import { t } from '../i18n/translations.js';
import { showToast } from '../ui/toast.js';
import {
    activateScenario,
    deactivateScenario,
    getActiveScenario,
    setTier,
    getActiveTier,
    toggleMatrix,
    isMatrixActive,
    getActiveMatrixIds,
    getActiveParameters,
    getParameterCounts,
    isSAOActive,
    loadAllMatrices,
} from '../../core/sao/index.js';
import { SAO_SCENARIOS } from '../../core/sao/scenarios.js';
import { SAO_MATRICES } from '../../core/sao/matrices.js';
import { openModal, closeModal } from '../ui/modals.js';
import { hydrateIcons } from '../ui/icons.js';

let _updateAllUI = null;

/**
 * Inject updateAllUI reference to avoid circular dependency.
 * @param {Function} fn
 */
export function setUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ================================================================
// SCENARIO HANDLERS
// ================================================================

/**
 * Open the SAO scenario selection modal.
 * Abre o modal de selecao de cenario SAO.
 */
export function handleOpenSAOScenarioModal() {
    renderSAOScenarioModal();
    openModal('sao-scenario-modal');
}

/**
 * Activate a SAO scenario by ID.
 * Ativa um cenario SAO por ID.
 * @param {string} scenarioId
 */
export async function handleActivateScenario(scenarioId) {
    try {
        await activateScenario(scenarioId);
        const scenario = SAO_SCENARIOS[scenarioId];
        const name = scenario ? t(scenario.nameKey) : scenarioId;
        showToast(`SAO: ${name} — ${getActiveMatrixIds().length} ${t('saoLoadedMatrices')}`, 'success');
        closeModal('sao-scenario-modal');
        renderSAOStatusBadge();
    } catch (e) {
        showToast(`SAO Error: ${e.message}`, 'error');
    }
}

/**
 * Deactivate the current SAO scenario.
 * Desativa o cenario SAO atual.
 */
export function handleDeactivateScenario() {
    deactivateScenario();
    showToast(t('saoNoScenario'), 'info');
    renderSAOStatusBadge();
}

// ================================================================
// TIER HANDLERS
// ================================================================

/**
 * Set the active tier filter level.
 * @param {string} tier - 'essential' | 'recommended' | 'specialized'
 */
export function handleSetTier(tier) {
    setTier(tier);
    const count = getActiveParameters().length;
    showToast(
        `SAO ${t('saoTier')}: ${t('saoTier' + tier.charAt(0).toUpperCase() + tier.slice(1))} — ${count} ${t('saoActiveParams')}`,
        'info',
    );
    renderSAOStatusBadge();
}

// ================================================================
// MATRIX HANDLERS
// ================================================================

/**
 * Toggle a matrix on/off.
 * @param {string} matrixId
 */
export async function handleToggleMatrix(matrixId) {
    await toggleMatrix(matrixId);
    renderSAOStatusBadge();
}

/**
 * Open the SAO matrix/tier control panel modal.
 * Abre o painel de controle de matrizes e tiers SAO.
 */
export function handleOpenSAOMatrixPanel() {
    renderSAOMatrixPanel();
    openModal('sao-matrix-modal');
}

/**
 * Load all SAO matrices at once.
 */
export async function handleLoadAllMatrices() {
    await loadAllMatrices();
    showToast('SAO: All matrices loaded', 'success');
    renderSAOStatusBadge();
}

// ================================================================
// UI RENDERING
// ================================================================

/**
 * Render the scenario selection modal content.
 * @private
 */
function renderSAOScenarioModal() {
    let modal = document.getElementById('sao-scenario-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'sao-scenario-modal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }

    const activeId = getActiveScenario();

    const scenarioCards = Object.values(SAO_SCENARIOS)
        .map((s) => {
            const isActive = s.id === activeId;
            const primaryNames = s.primaryMatrices
                .map((m) => (SAO_MATRICES[m] ? t(SAO_MATRICES[m].nameKey) : m))
                .join(', ');
            const secondaryNames = s.secondaryMatrices
                .map((m) => (SAO_MATRICES[m] ? t(SAO_MATRICES[m].nameKey) : m))
                .join(', ');

            return `
            <div class="sao-scenario-card ${isActive ? 'sao-scenario-active' : ''}" onclick="window.handleActivateScenario('${s.id}')">
                <div class="sao-scenario-header">
                    <span class="icon" data-icon="${s.icon}"></span>
                    <strong>${t(s.nameKey)}</strong>
                    ${isActive ? '<span class="badge badge-si">Active</span>' : ''}
                </div>
                <p class="sao-scenario-desc">${t(s.descKey)}</p>
                <div class="sao-scenario-matrices">
                    <div><small><strong>${t('saoPrimaryMatrices')}:</strong> ${primaryNames}</small></div>
                    <div><small>${t('saoSecondaryMatrices')}: ${secondaryNames}</small></div>
                </div>
            </div>
        `;
        })
        .join('');

    modal.innerHTML = `
        <div class="modal modal-lg">
            <div class="modal-header">
                <h2 class="modal-title">${t('saoSelectScenario')}</h2>
                <button class="modal-close" onclick="window.closeSAOScenarioModal()" aria-label="Close"><span data-icon="x" data-icon-size="14px"></span></button>
            </div>
            <div class="modal-body">
                <p class="text-muted">${t('saoSelectScenarioDesc')}</p>
                <div class="sao-scenario-grid">
                    ${scenarioCards}
                </div>
                ${
                    activeId
                        ? `
                    <div style="margin-top: 1rem; text-align: center;">
                        <button class="btn btn-secondary" onclick="window.handleDeactivateScenario()">
                            ${t('saoDeactivate')}
                        </button>
                    </div>
                `
                        : ''
                }
            </div>
        </div>
    `;
    hydrateIcons(modal);
}

/**
 * Render the matrix/tier control panel modal content.
 * @private
 */
function renderSAOMatrixPanel() {
    let modal = document.getElementById('sao-matrix-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'sao-matrix-modal';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
    }

    const currentTier = getActiveTier();
    const counts = getParameterCounts();

    const tierButtons = ['essential', 'recommended', 'specialized']
        .map((tier) => {
            const label = t('saoTier' + tier.charAt(0).toUpperCase() + tier.slice(1));
            const isActive = tier === currentTier;
            const tierClass = `sao-tier-btn sao-tier-${tier} ${isActive ? 'sao-tier-active' : ''}`;
            return `<button class="${tierClass}" onclick="window.handleSetTier('${tier}')">${label}</button>`;
        })
        .join('');

    const matrixToggles = Object.values(SAO_MATRICES)
        .map((m) => {
            const active = isMatrixActive(m.id);
            const count = counts[m.id] || { essential: 0, recommended: 0, specialized: 0, total: 0 };
            return `
            <div class="sao-matrix-toggle ${active ? 'sao-matrix-active' : ''}" onclick="window.handleToggleMatrix('${m.id}')">
                <div class="sao-matrix-icon" style="background: ${m.color}20; color: ${m.color};">
                    <span class="icon" data-icon="${m.icon}"></span>
                </div>
                <div class="sao-matrix-info">
                    <strong>${t(m.nameKey)}</strong>
                    <small>${count.essential} / ${count.recommended} / ${count.specialized}</small>
                </div>
                <div class="sao-matrix-switch">
                    <input type="checkbox" ${active ? 'checked' : ''} onclick="event.stopPropagation();" onchange="window.handleToggleMatrix('${m.id}')">
                </div>
            </div>
        `;
        })
        .join('');

    const activeCount = getActiveParameters().length;

    modal.innerHTML = `
        <div class="modal modal-lg">
            <div class="modal-header">
                <h2 class="modal-title">${t('saoMatrices')}</h2>
                <button class="modal-close" onclick="closeModal('sao-matrix-modal')" aria-label="Close"><span data-icon="x" data-icon-size="14px"></span></button>
            </div>
            <div class="modal-body">
                <div class="sao-tier-selector">
                    <label class="form-label">${t('saoTier')}:</label>
                    <div class="sao-tier-group">${tierButtons}</div>
                </div>
                <div class="sao-status-line">
                    <span>${activeCount} ${t('saoActiveParams')}</span>
                    <span class="text-muted">(${getActiveMatrixIds().length} ${t('saoLoadedMatrices')})</span>
                </div>
                <div class="sao-matrix-list">
                    ${matrixToggles}
                </div>
            </div>
        </div>
    `;
    hydrateIcons(modal);
}

/**
 * Render the SAO status badge in the status bar.
 * @private
 */
function renderSAOStatusBadge() {
    const badge = document.getElementById('sao-status-badge');
    if (!badge) return;

    if (isSAOActive()) {
        const scenario = getActiveScenario();
        const scenarioName = scenario && SAO_SCENARIOS[scenario] ? t(SAO_SCENARIOS[scenario].nameKey) : '';
        const count = getActiveParameters().length;
        badge.innerHTML = `SAO: ${scenarioName || t('saoMatrices')} (${count})`;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

/**
 * Close the SAO scenario modal.
 */
export function closeSAOScenarioModal() {
    closeModal('sao-scenario-modal');
}

// ================================================================
// EXPORTS — Handler registry object
// ================================================================

export const saoHandlers = {
    handleOpenSAOScenarioModal,
    handleActivateScenario,
    handleDeactivateScenario,
    handleSetTier,
    handleToggleMatrix,
    handleOpenSAOMatrixPanel,
    handleLoadAllMatrices,
    closeSAOScenarioModal,
};
