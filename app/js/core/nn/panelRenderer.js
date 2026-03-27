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
   ML STUDIO — Side Panel Renderer
   Painel lateral direito tipo wizard para pipeline de Machine Learning.

   4 etapas: Dados → Rede → Treino → What-If
   Segue padrao do Inspector (slide-in, resize, theme-aware).
   ================================================================ */

import { getIcon } from '../../utils/ui/icons.js';
import { asyncConfirm } from '../../utils/ui/asyncDialogs.js';
import { t } from '../../utils/i18n/translations.js';
import { escapeHtml } from '../../utils/helpers/html.js';
import { getAllElements } from '../elements/manager.js';
import { getAllCampaigns } from '../campaigns/manager.js';
import {
    listNetworks,
    getNetwork,
    getNetworkMetadata,
    getNetworkMapping,
    registerNetwork,
    persistNetwork,
    removeNetwork,
} from './manager.js';
import { buildVariableCatalog, groupByCategory, getCategoryColor, isGeometricVariable } from './variableCatalog.js';
import { buildTrainingData, trainNetworkFromModel } from './whatIfEngine.js';
import { drawNetworkDiagram } from './networkDiagram.js';
import { showToast } from '../../utils/ui/toast.js';
import { safeSetItem } from '../../utils/storage/storageMonitor.js';
import { closeModal } from '../../utils/ui/modals.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

let _panel = null;
const _state = {
    visible: false,
    width: 380,
    step: 1, // 1=Data, 2=Network, 3=Train, 4=WhatIf
    networkId: null, // Selected/active network
};

const STORAGE_KEY = 'ecbyts-nn-panel';
const STEP_LABELS = ['mlStepData', 'mlStepNetwork', 'mlStepTrain', 'mlStepWhatIf'];

// ----------------------------------------------------------------
// INIT — Create panel DOM, append to #main-area
// ----------------------------------------------------------------

/**
 * Initialize the ML Studio side panel.
 * Cria o DOM do painel e adiciona ao viewport principal.
 */
export function initMLPanel() {
    if (_panel) return;

    // Restore persisted state
    let _savedVisible = false;
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved) {
            _state.width = saved.width || 380;
            _savedVisible = saved.visible === true;
        }
    } catch {
        /* ignore */
    }

    _panel = document.createElement('div');
    _panel.id = 'nn-side-panel';
    _panel.className = 'nn-side-panel' + (_savedVisible ? ' visible' : '');
    _panel.style.width = _state.width + 'px';
    if (!_savedVisible) _panel.style.display = 'none';
    _state.visible = _savedVisible;

    _panel.innerHTML = _buildPanelShell();

    const mainArea = document.getElementById('main-area');
    if (mainArea) mainArea.appendChild(_panel);

    _setupResizeHandle();
    _setupDelegatedEvents();

    // Auto-select first network if exists
    const ids = listNetworks();
    if (ids.length > 0) _state.networkId = ids[0];
}

/**
 * Toggle panel visibility.
 * Abre ou fecha o painel lateral.
 */
export function togglePanel() {
    if (!_panel) initMLPanel();

    _state.visible = !_state.visible;

    if (_state.visible) {
        // Close inspector if open to avoid overlap
        _closeInspectorIfOpen();
        // Close NN modal if open
        closeModal('nn-modal');

        _panel.style.removeProperty('display');
        _panel.classList.add('visible');
        refreshPanel();
    } else {
        _panel.classList.remove('visible');
    }

    _persist();
}

/**
 * Open panel directly (ensure visible).
 */
export function openPanel() {
    if (!_panel) initMLPanel();
    if (!_state.visible) {
        _state.visible = true;
        _closeInspectorIfOpen();
        closeModal('nn-modal');
        _persist();
    }
    // Garante classe visible sincronizada com estado (mesmo apos reload)
    _panel.style.removeProperty('display');
    _panel.classList.add('visible');
    refreshPanel();
}

/**
 * Close the panel.
 */
export function closePanel() {
    if (!_panel) return;
    _state.visible = false;
    _panel.classList.remove('visible');
    _persist();
}

/**
 * Navigate to a specific wizard step.
 * @param {number} step - 1 to 4
 */
export function showStep(step) {
    _state.step = Math.max(1, Math.min(4, step));
    refreshPanel();
}

/**
 * Re-render the current step content.
 */
export function refreshPanel() {
    if (!_panel || !_state.visible) return;

    // Update step navigation
    const stepsEl = _panel.querySelector('.nn-wizard-steps');
    if (stepsEl) stepsEl.innerHTML = _renderWizardSteps();

    // Update body content
    const body = _panel.querySelector('.nn-panel-body');
    if (body) {
        switch (_state.step) {
            case 1:
                body.innerHTML = _renderStepData();
                break;
            case 2:
                body.innerHTML = _renderStepNetwork();
                break;
            case 3:
                body.innerHTML = _renderStepTrain();
                break;
            case 4:
                body.innerHTML = _renderStepWhatIf();
                break;
        }
        // Install DnD for step 2
        if (_state.step === 2) _installDnD(body);

        // Draw network diagram for steps 2 and 3
        if (_state.step === 2 || _state.step === 3) {
            requestAnimationFrame(() => {
                const canvas = document.getElementById('nn-diagram');
                const nn = _state.networkId ? getNetwork(_state.networkId) : null;
                const mapping = _state.networkId ? getNetworkMapping(_state.networkId) : null;
                if (canvas && nn) drawNetworkDiagram(canvas, nn, mapping);
                // Update topology param count if editor is visible
                if (_state.step === 2 && nn && !nn.trained) _updateTopoParamCount(nn);
            });
        }
    }

    // Update footer
    const footer = _panel.querySelector('.nn-panel-footer');
    if (footer) footer.innerHTML = _renderFooter();
}

/**
 * Set active network and refresh.
 * @param {string} id
 */
export function setActiveNetwork(id) {
    _state.networkId = id;
    refreshPanel();
}

// ----------------------------------------------------------------
// PANEL SHELL — Static HTML structure
// ----------------------------------------------------------------

function _buildPanelShell() {
    return `
        <div class="nn-panel-resize-handle"></div>
        <div class="nn-panel-header">
            <div class="nn-panel-title">
                ${getIcon('brain', { size: '16px' })}
                <span>ML Studio</span>
            </div>
            <button class="nn-panel-close" data-action="close-panel">
                ${getIcon('x', { size: '16px' })}
            </button>
        </div>
        <div class="nn-wizard-steps"></div>
        <div class="nn-panel-body"></div>
        <div class="nn-panel-footer"></div>`;
}

// ----------------------------------------------------------------
// WIZARD STEP NAVIGATION
// ----------------------------------------------------------------

function _renderWizardSteps() {
    const meta = _state.networkId ? getNetworkMetadata(_state.networkId) : null;
    const hasMapping = !!(meta?.mapping?.inputs?.length > 0);
    const isTrained = !!meta?.trained;

    const stepStates = [
        true, // step 1: always available
        true, // step 2: always available
        hasMapping, // step 3: needs mapping
        isTrained, // step 4: needs trained
    ];

    let html = '';
    for (let i = 0; i < 4; i++) {
        const num = i + 1;
        const isActive = _state.step === num;
        const isCompleted =
            num === 1 || (num === 2 && hasMapping) || (num === 3 && isTrained) || (num === 4 && isTrained);
        const isEnabled = stepStates[i];

        let cls = 'nn-wizard-step';
        if (isActive) cls += ' active';
        else if (isCompleted) cls += ' completed';
        if (!isEnabled) cls += ' disabled';

        html += `
            <div class="${cls}" data-action="go-step" data-step="${num}" ${isEnabled ? '' : 'style="pointer-events:none;opacity:0.4"'}>
                <span class="nn-wizard-step-num">${isCompleted && !isActive ? '✓' : num}</span>
                ${t(STEP_LABELS[i])}
            </div>`;
    }
    return html;
}

// ----------------------------------------------------------------
// FOOTER — Previous/Next navigation
// ----------------------------------------------------------------

function _renderFooter() {
    const canPrev = _state.step > 1;
    const canNext = _state.step < 4;

    let html = '<div>';
    if (canPrev) {
        html += `<button class="btn btn-sm" data-action="prev-step">
            ${getIcon('arrow-left', { size: '14px' })} ${t('previous') || 'Previous'}
        </button>`;
    }
    html += '</div><div>';
    if (canNext) {
        html += `<button class="btn btn-primary btn-sm" data-action="next-step">
            ${t('next') || 'Next'} ${getIcon('arrow-right', { size: '14px' })}
        </button>`;
    }
    html += '</div>';
    return html;
}

// ================================================================
// STEP 1 — DATA OVERVIEW
// Resumo dos dados disponiveis e preview de training data
// ================================================================

function _renderStepData() {
    const elements = getAllElements();
    const campaigns = getAllCampaigns ? getAllCampaigns() : [];

    // Count elements by family
    const plumes = elements.filter((e) => e.family === 'plume');
    const wells = elements.filter((e) => e.family === 'well');
    const linkedWells = wells.filter((w) => w.data?.linkedPlumeId);
    const plumeWithTimeline = plumes.filter((p) => p.data?.shapeTimeline?.length > 0);

    // Count total observations and parameter stats
    let totalObs = 0;
    const paramCounts = {};
    for (const el of elements) {
        if (!el.data?.observations) continue;
        for (const obs of el.data.observations) {
            totalObs++;
            const key = obs.parameterId;
            paramCounts[key] = (paramCounts[key] || 0) + 1;
        }
    }

    // Sort parameters by count
    const sortedParams = Object.entries(paramCounts).sort((a, b) => b[1] - a[1]);

    // Try to build training data preview if we have a network with mapping
    let previewHtml = '';
    if (_state.networkId) {
        const mapping = getNetworkMapping(_state.networkId);
        if (mapping?.inputs?.length > 0) {
            const samples = buildTrainingData(_state.networkId);
            previewHtml = _renderTrainingPreview(samples, mapping);
        }
    }

    return `
        <div class="nn-data-summary">
            <h5>${getIcon('database', { size: '14px' })} ${t('mlDataAvailable') || 'Available Data'}</h5>
            <div class="nn-data-tree">
                <div class="nn-data-item">
                    ${getIcon('layers', { size: '12px' })}
                    <span class="nn-data-count">${elements.length}</span> ${t('elements') || 'elements'}
                </div>
                <div class="nn-data-item" style="padding-left: 16px">
                    ${getIcon('droplet', { size: '12px' })}
                    <span class="nn-data-count">${plumes.length}</span> ${t('plume') || 'plume'}${plumes.length !== 1 ? 's' : ''}
                    ${plumeWithTimeline.length > 0 ? `<span style="color:var(--accent-green);font-size:10px">(${plumeWithTimeline[0]?.data?.shapeTimeline?.length || 0} snapshots)</span>` : ''}
                </div>
                <div class="nn-data-item" style="padding-left: 16px">
                    ${getIcon('navigation', { size: '12px' })}
                    <span class="nn-data-count">${wells.length}</span> ${t('well') || 'well'}${wells.length !== 1 ? 's' : ''}
                    ${linkedWells.length > 0 ? `<span style="color:var(--accent-blue);font-size:10px">(${linkedWells.length} linked)</span>` : ''}
                </div>
                <div class="nn-data-item" style="padding-left: 16px">
                    ${getIcon('calendar', { size: '12px' })}
                    <span class="nn-data-count">${campaigns.length}</span> ${t('campaigns') || 'campaigns'},
                    <span class="nn-data-count">${totalObs}</span> obs
                </div>
            </div>
        </div>

        <div class="nn-param-list">
            <h5>${getIcon('bar-chart-2', { size: '14px' })} ${t('mlParameters') || 'Parameters'}</h5>
            <div>
                ${
                    sortedParams.length > 0
                        ? sortedParams
                              .map(
                                  ([param, count]) =>
                                      `<span class="nn-param-badge">${escapeHtml(param)} <span class="nn-param-count">${count}</span></span>`,
                              )
                              .join('')
                        : `<span style="color:var(--neutral-400);font-size:12px">${t('nnNoNetworks') || 'No data'}</span>`
                }
            </div>
        </div>

        ${previewHtml}`;
}

function _renderTrainingPreview(samples, mapping) {
    if (!samples || samples.length === 0) {
        return `
            <div class="nn-preview-section">
                <h5>${getIcon('table', { size: '14px' })} ${t('mlTrainingPreview') || 'Training Data Preview'}</h5>
                <div class="nn-preview-empty">
                    ${t('mlNoSamples') || 'No training samples found. Generate a Random Model first.'}
                </div>
            </div>`;
    }

    const inputNames = mapping.inputs.map((m) => m.variableId);
    const outputNames = mapping.outputs.map((m) => m.variableId);
    const maxRows = 8;

    let html = `
        <div class="nn-preview-section">
            <h5>${getIcon('table', { size: '14px' })} ${t('mlTrainingPreview') || 'Training Data Preview'}
                <span style="font-weight:400;color:var(--accent-green);font-size:11px">(${samples.length} samples)</span>
            </h5>
            <div style="overflow-x:auto">
            <table class="nn-preview-table">
                <thead><tr>
                    <th>#</th>
                    ${inputNames.map((n) => `<th>${escapeHtml(n)}</th>`).join('')}
                    <th>→</th>
                    ${outputNames.map((n) => `<th>${escapeHtml(n)}</th>`).join('')}
                </tr></thead>
                <tbody>`;

    for (let i = 0; i < Math.min(samples.length, maxRows); i++) {
        const s = samples[i];
        html += '<tr>';
        html += `<td style="color:var(--neutral-400)">${i + 1}</td>`;
        for (let j = 0; j < s.input.length; j++) {
            const m = mapping.inputs[j];
            const val = m ? s.input[j] * (m.max - m.min) + m.min : s.input[j];
            html += `<td>${val.toFixed(2)}</td>`;
        }
        html += '<td style="color:var(--neutral-400)">→</td>';
        for (let j = 0; j < s.target.length; j++) {
            const m = mapping.outputs[j];
            const val = m ? s.target[j] * (m.max - m.min) + m.min : s.target[j];
            html += `<td>${val.toFixed(1)}</td>`;
        }
        html += '</tr>';
    }

    if (samples.length > maxRows) {
        const cols = 2 + inputNames.length + outputNames.length;
        html += `<tr><td colspan="${cols}" style="text-align:center;color:var(--neutral-400)">... +${samples.length - maxRows} more</td></tr>`;
    }

    html += '</tbody></table></div></div>';
    return html;
}

// ================================================================
// STEP 2 — NETWORK CONFIG + BUILDER (compact vertical)
// Selecao/criacao de rede e mapeamento de variaveis
// ================================================================

function _renderStepNetwork() {
    const ids = listNetworks();

    // Network selector / creator
    let networkHtml = '';
    if (ids.length === 0) {
        networkHtml = _renderCreateNetwork();
    } else {
        networkHtml = `
            <div class="nn-network-select">
                <label style="font-size:12px;font-weight:600;margin-bottom:4px;display:block">${t('nnManager')}</label>
                <div style="display:flex;gap:6px;align-items:center">
                    <select data-action="select-network" style="flex:1;padding:6px 10px;font-size:12px;border-radius:6px;border:1px solid var(--neutral-300);background:var(--neutral-0);color:var(--window-text)">
                        ${ids
                            .map((id) => {
                                const meta = getNetworkMetadata(id);
                                const status = meta?.trained ? '✓' : '○';
                                return `<option value="${id}" ${id === _state.networkId ? 'selected' : ''}>${status} ${escapeHtml(id)}</option>`;
                            })
                            .join('')}
                    </select>
                    <button class="btn btn-sm" data-action="create-network" title="${t('nnCreateNetwork')}">
                        ${getIcon('plus', { size: '14px' })}
                    </button>
                    <button class="btn btn-sm btn-danger" data-action="delete-network" title="${t('remove')}">
                        ${getIcon('trash-2', { size: '14px' })}
                    </button>
                </div>
            </div>`;
    }

    // Topology editor (for untrained networks)
    let topologyHtml = '';
    if (_state.networkId) {
        const nn = getNetwork(_state.networkId);
        if (nn && !nn.trained) {
            topologyHtml = _renderTopologyEditor(nn);
        } else if (nn) {
            // Read-only topology display for trained networks
            const sizes = nn.hiddenLayerSizes || [nn.hiddenSize];
            const arch = [nn.inputSize, ...sizes, nn.outputSize].join(' → ');
            topologyHtml = `
                <div style="margin:10px 0;padding:8px 10px;background:var(--neutral-50);border:1px solid var(--neutral-200);border-radius:6px">
                    <label style="font-size:11px;font-weight:600;color:var(--neutral-500);display:block;margin-bottom:4px">${t('nnTopology')}</label>
                    <span style="font-family:monospace;font-size:12px;color:var(--window-text)">${arch}</span>
                    <span style="font-size:10px;color:var(--neutral-400);margin-left:8px">${nn.totalParams.toLocaleString()} ${t('nnTotalParams')}</span>
                </div>`;
        }
    }

    // Builder section (compact vertical layout)
    let builderHtml = '';
    if (_state.networkId) {
        builderHtml = _renderCompactBuilder();
    }

    // Network diagram canvas
    const diagramHtml = _state.networkId ? '<canvas id="nn-diagram" class="nn-network-diagram"></canvas>' : '';

    return networkHtml + topologyHtml + diagramHtml + builderHtml;
}

/**
 * Render inline topology editor for untrained networks in Step 2.
 * Editor inline de topologia para redes nao-treinadas.
 *
 * @param {Object} nn - SimpleNN instance
 * @returns {string} HTML string
 */
function _renderTopologyEditor(nn) {
    const sizes = nn.hiddenLayerSizes || [nn.hiddenSize];
    const hiddenInputsHtml = sizes
        .map((size, i) => {
            const removeBtn =
                sizes.length > 1
                    ? `<span class="nn-panel-remove-layer" data-action="topo-remove-layer" data-layer-index="${i}">✕</span>`
                    : '';
            const arrow = i > 0 ? '<span class="nn-topo-arrow">→</span>' : '';
            return `${arrow}<input type="number" class="nn-topo-hidden-input" value="${size}" min="1" max="512" data-layer-index="${i}" />${removeBtn}`;
        })
        .join('');

    return `
        <div class="nn-topo-editor" style="margin:10px 0;padding:10px;background:var(--neutral-50);border:1px solid var(--neutral-200);border-radius:6px">
            <label style="font-size:11px;font-weight:600;color:var(--neutral-500);display:block;margin-bottom:6px">${t('nnTopology')}</label>
            <div class="nn-compact-topology" style="margin-bottom:6px">
                <span style="font-family:monospace;font-size:11px;color:var(--neutral-400)">${nn.inputSize} →</span>
                <span id="nn-topo-hidden-layers" style="display:inline-flex;gap:2px;align-items:center;flex-wrap:wrap">
                    ${hiddenInputsHtml}
                </span>
                <span style="font-family:monospace;font-size:11px;color:var(--neutral-400)">→ ${nn.outputSize}</span>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
                <button class="btn btn-sm" data-action="topo-add-layer">
                    ${getIcon('plus', { size: '12px' })} ${t('nnAddHiddenLayer')}
                </button>
                <button class="btn btn-sm btn-primary" data-action="topo-apply">
                    ${getIcon('check', { size: '12px' })} ${t('apply') || 'Apply'}
                </button>
                <span id="nn-topo-param-count" style="font-size:10px;font-family:monospace;color:var(--neutral-400)"></span>
            </div>
        </div>`;
}

/**
 * Update param count in the topology editor.
 * Atualiza contador no editor de topologia inline.
 */
function _updateTopoParamCount(nn) {
    const inputs = document.querySelectorAll('#nn-topo-hidden-layers .nn-topo-hidden-input');
    const hiddenSizes = Array.from(inputs).map((el) => parseInt(el.value) || 16);
    const sizes = [nn?.inputSize || 2, ...hiddenSizes, nn?.outputSize || 2];
    let total = 0;
    for (let i = 0; i < sizes.length - 1; i++) {
        total += sizes[i] * sizes[i + 1] + sizes[i + 1];
    }
    const el = document.getElementById('nn-topo-param-count');
    if (el) {
        el.textContent = `${total.toLocaleString()} ${t('nnTotalParams') || 'params'}`;
        el.style.color = total > 500000 ? 'var(--accent-red)' : 'var(--neutral-400)';
    }
}

/**
 * Update param count in the panel create form.
 * Atualiza contador de parametros no formulario compacto.
 */
function _updatePanelParamCount() {
    const inputs = document.querySelectorAll('#nn-panel-hidden-layers .nn-panel-hidden-input');
    const inputSize = parseInt(document.getElementById('nn-panel-create-input')?.value) || 2;
    const outputSize = parseInt(document.getElementById('nn-panel-create-output')?.value) || 2;
    const hiddenSizes = Array.from(inputs).map((el) => parseInt(el.value) || 16);
    const sizes = [inputSize, ...hiddenSizes, outputSize];
    let total = 0;
    for (let i = 0; i < sizes.length - 1; i++) {
        total += sizes[i] * sizes[i + 1] + sizes[i + 1];
    }
    const el = document.getElementById('nn-panel-param-count');
    if (el) {
        el.textContent = `${total.toLocaleString()} params`;
        el.style.color = total > 500000 ? 'var(--accent-red)' : 'var(--neutral-400)';
    }
}

function _renderCreateNetwork() {
    return `
        <div style="padding:12px 0">
            <h5 style="font-size:13px;margin:0 0 10px">${getIcon('plus', { size: '14px' })} ${t('nnCreateNetwork')}</h5>
            <div style="margin-bottom:8px">
                <label style="font-size:11px;font-weight:500;display:block;margin-bottom:3px">${t('nnNetworkId')}</label>
                <input type="text" id="nn-panel-create-id" class="form-control"
                       placeholder="my-predictor" style="padding:6px 10px;font-size:12px;border-radius:6px" />
            </div>
            <div class="nn-compact-topology" style="margin-bottom:10px">
                <label style="font-size:11px;font-weight:500;margin-right:6px">${t('nnTopology')}:</label>
                <input type="number" id="nn-panel-create-input" value="2" min="1" max="256" />
                <span class="nn-topo-arrow">→</span>
                <span id="nn-panel-hidden-layers">
                    <input type="number" class="nn-panel-hidden-input" value="16" min="1" max="512" />
                </span>
                <span class="nn-topo-arrow">→</span>
                <input type="number" id="nn-panel-create-output" value="2" min="1" max="128" />
            </div>
            <div style="display:flex;gap:4px;align-items:center;margin-bottom:10px">
                <button class="btn btn-sm" data-action="add-hidden-layer">
                    ${getIcon('plus', { size: '12px' })} ${t('nnAddHiddenLayer')}
                </button>
                <span id="nn-panel-param-count" style="font-size:10px;font-family:monospace;color:var(--neutral-400)"></span>
            </div>
            <button class="btn btn-primary btn-sm" data-action="confirm-create">
                ${getIcon('check', { size: '14px' })} ${t('nnCreateNetwork')}
            </button>
        </div>`;
}

function _renderCompactBuilder() {
    const nn = getNetwork(_state.networkId);
    if (!nn) return '';

    const existing = getNetworkMapping(_state.networkId);
    const inputVars = existing?.inputs || [];
    const outputVars = existing?.outputs || [];

    const catalog = buildVariableCatalog();
    const grouped = groupByCategory(catalog);
    const allMapped = new Set([...inputVars.map((v) => v.variableId), ...outputVars.map((v) => v.variableId)]);

    // Compact catalog (all pills in one scrollable area)
    let catalogPills = '';
    for (const [category, vars] of Object.entries(grouped)) {
        const color = getCategoryColor(category);
        for (const v of vars) {
            const disabled = allMapped.has(v.id);
            const calcBadge = v._calcType
                ? `<span class="nn-calc-badge">${v._calcType === 'ratio' ? 'R' : v._calcType[0].toUpperCase()}</span>`
                : '';
            catalogPills += `
                <div class="nn-compact-pill ${disabled ? 'nn-pill-disabled' : ''}"
                     draggable="${disabled ? 'false' : 'true'}"
                     data-variable-id="${v.id}"
                     data-variable-name="${escapeHtml(v.name)}"
                     data-variable-unit="${v.unitId}"
                     data-variable-min="${v.min}"
                     data-variable-max="${v.max}"
                     style="background:${color}20;color:${color};border:1px solid ${color}40">
                    ${calcBadge}${escapeHtml(v.name)}
                </div>`;
        }
    }

    // Mapped vars in each dropzone
    const renderMapped = (vars, side) => {
        if (vars.length === 0)
            return `<div style="font-size:11px;color:var(--neutral-400);padding:4px">${t('nnBuilderHint')}</div>`;
        return `<div class="nn-compact-mapped">${vars
            .map(
                (v) =>
                    `<div class="nn-compact-pill" style="background:var(--accent-primary)15;border:1px solid var(--accent-primary)40;color:var(--window-text)">
                ${escapeHtml(v.variableId)}
                <span class="nn-pill-unit" style="font-size:9px;opacity:0.6">${v.unitId}</span>
                <span class="nn-pill-remove" data-action="unmap-var" data-side="${side}" data-var="${v.variableId}">✕</span>
            </div>`,
            )
            .join('')}</div>`;
    };

    return `
        <div style="margin-top:12px">
            <h5 style="font-size:12px;font-weight:600;margin:0 0 6px;display:flex;align-items:center;gap:6px">
                ${getIcon('book-open', { size: '14px' })} ${t('nnVariableCatalog')}
            </h5>
            <div class="nn-compact-catalog" id="nn-compact-catalog">
                ${catalogPills}
            </div>

            <div style="margin-top:10px">
                <div class="nn-compact-dropzone-label">${getIcon('log-in', { size: '12px' })} ${t('nnInputZone')}</div>
                <div class="nn-compact-dropzone nn-dropzone" id="nn-dropzone-inputs" data-side="inputs">
                    ${renderMapped(inputVars, 'inputs')}
                </div>
            </div>

            <div style="margin-top:8px">
                <div class="nn-compact-dropzone-label">${getIcon('log-out', { size: '12px' })} ${t('nnOutputZone')}</div>
                <div class="nn-compact-dropzone nn-dropzone" id="nn-dropzone-outputs" data-side="outputs">
                    ${renderMapped(outputVars, 'outputs')}
                </div>
            </div>

            <div style="margin-top:8px;text-align:right">
                <button class="btn btn-primary btn-sm" data-action="save-mapping">
                    ${getIcon('save', { size: '14px' })} ${t('nnSaveMapping')}
                </button>
            </div>
        </div>`;
}

// ================================================================
// STEP 3 — TRAINING
// Treina a rede e mostra progresso e metricas
// ================================================================

function _renderStepTrain() {
    const nn = getNetwork(_state.networkId);
    const meta = getNetworkMetadata(_state.networkId);
    const mapping = getNetworkMapping(_state.networkId);

    if (!nn || !mapping?.inputs?.length) {
        return `<div class="nn-preview-empty">${t('nnBuilderHint')}</div>`;
    }

    const samples = buildTrainingData(_state.networkId);
    const trained = nn.trained;

    return `
        <canvas id="nn-diagram" class="nn-network-diagram"></canvas>

        <div class="nn-train-status">
            <h5>${getIcon(trained ? 'check-circle' : 'play', { size: '16px' })}
                ${trained ? t('nnTrained') : t('nnTrainNetwork')}
            </h5>
            <div class="nn-train-samples">
                ${getIcon('database', { size: '12px' })}
                ${samples.length} ${t('mlSamples') || 'samples'} ${t('mlAvailable') || 'available'}
            </div>

            ${
                trained
                    ? `
                <div class="nn-train-metrics">
                    <div class="nn-train-metric">
                        <div class="nn-train-metric-value">${[nn.inputSize, ...(nn.hiddenLayerSizes || [nn.hiddenSize]), nn.outputSize].join('→')}</div>
                        <div class="nn-train-metric-label">${t('nnTopology')}</div>
                    </div>
                </div>
            `
                    : ''
            }

            <div class="nn-train-progress" id="nn-train-progress" style="display:none">
                <div class="nn-train-progress-fill" id="nn-train-progress-fill"></div>
            </div>
            <div id="nn-train-metrics-live" class="nn-train-metrics" style="display:none"></div>

            <div style="margin-top:16px">
                <button class="btn btn-primary" data-action="train-network" ${samples.length < 5 ? 'disabled title="Need ≥ 5 samples"' : ''}>
                    ${getIcon('play', { size: '14px' })}
                    ${trained ? t('mlRetrain') || 'Retrain' : t('nnTrainNetwork')}
                </button>
            </div>

            ${
                samples.length < 5
                    ? `
                <div style="margin-top:8px;font-size:11px;color:var(--accent-orange)">
                    ${t('mlNeedMore') || 'Need ≥ 5 samples. Generate a Random Model first.'}
                </div>
            `
                    : ''
            }
        </div>`;
}

// ================================================================
// STEP 4 — WHAT-IF (delegates to whatIfRenderer)
// Simulador com sliders, renderizado diretamente no painel
// ================================================================

function _renderStepWhatIf() {
    const nn = getNetwork(_state.networkId);
    const mapping = getNetworkMapping(_state.networkId);
    if (!nn || !mapping || !nn.trained) {
        return `<div class="nn-preview-empty">${t('nnWhatIfHint')}</div>`;
    }

    // Delegate to whatIfRenderer — it will render into our body
    // Use setTimeout to let DOM update first, then call renderWhatIf
    setTimeout(() => {
        import('./whatIfRenderer.js').then((mod) => {
            const body = _panel?.querySelector('.nn-panel-body');
            if (body) mod.renderWhatIf(_state.networkId, body);
        });
    }, 0);

    return `<div style="text-align:center;padding:20px;color:var(--neutral-400)">${t('loading') || 'Loading...'}</div>`;
}

// ================================================================
// DRAG & DROP — For Step 2 builder
// ================================================================

function _installDnD(container) {
    container.addEventListener('dragstart', (e) => {
        const pill = e.target.closest('.nn-compact-pill');
        if (!pill || pill.classList.contains('nn-pill-disabled')) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData('text/plain', pill.dataset.variableId);
        e.dataTransfer.effectAllowed = 'copy';
        pill.style.opacity = '0.5';
    });

    container.addEventListener('dragend', (e) => {
        const pill = e.target.closest('.nn-compact-pill');
        if (pill) pill.style.opacity = '1';
    });

    const zones = container.querySelectorAll('.nn-dropzone');
    for (const zone of zones) {
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');

            const variableId = e.dataTransfer.getData('text/plain');
            if (!variableId) return;

            const side = zone.dataset.side;
            _onVariableMapped(variableId, side);
        });
    }
}

function _onVariableMapped(variableId, side) {
    if (!_state.networkId) return;

    const existing = getNetworkMapping(_state.networkId);
    const inputs = existing?.inputs || [];
    const outputs = existing?.outputs || [];
    const all = [...inputs, ...outputs];
    if (all.some((v) => v.variableId === variableId)) return;

    // Get default bounds
    import('./normalization.js').then((mod) => {
        const bounds = mod.getDefaultBounds(variableId);
        const entry = {
            variableId,
            min: bounds?.min ?? 0,
            max: bounds?.max ?? 1,
            unitId: bounds?.unitId ?? '',
        };

        const mapping = {
            inputs: side === 'inputs' ? [...inputs, entry] : inputs,
            outputs: side === 'outputs' ? [...outputs, entry] : outputs,
            targetElementId: existing?.targetElementId || null,
        };

        import('./manager.js').then((mgr) => {
            mgr.updateNetworkMapping(_state.networkId, mapping);
            refreshPanel();
        });
    });
}

// ================================================================
// EVENT HANDLING — Delegated clicks within the panel
// ================================================================

function _setupDelegatedEvents() {
    _panel.addEventListener('click', async (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;

        switch (action) {
            case 'close-panel':
                closePanel();
                break;

            case 'go-step':
                showStep(parseInt(target.dataset.step));
                break;

            case 'prev-step':
                showStep(_state.step - 1);
                break;

            case 'next-step':
                showStep(_state.step + 1);
                break;

            case 'select-network':
                // Handled by change event below
                break;

            case 'create-network':
                _panel.querySelector('.nn-panel-body').innerHTML = _renderCreateNetwork();
                break;

            case 'confirm-create': {
                const id = document.getElementById('nn-panel-create-id')?.value.trim();
                if (!id) {
                    showToast(t('nnEnterNetworkId'), 'error');
                    break;
                }
                if (getNetwork(id)) {
                    showToast(t('nnNetworkExists'), 'error');
                    break;
                }
                const inputSize = parseInt(document.getElementById('nn-panel-create-input')?.value) || 2;
                const hiddenInputs = document.querySelectorAll('#nn-panel-hidden-layers .nn-panel-hidden-input');
                const hiddenLayerSizes = Array.from(hiddenInputs).map((el) => parseInt(el.value) || 16);
                const outputSize = parseInt(document.getElementById('nn-panel-create-output')?.value) || 2;
                registerNetwork(id, { inputSize, hiddenLayerSizes, outputSize }, {});
                persistNetwork(id);
                _state.networkId = id;
                showToast(`${t('nnRegistered')}: ${id}`, 'success');
                refreshPanel();
                break;
            }

            case 'add-hidden-layer': {
                const container = document.getElementById('nn-panel-hidden-layers');
                if (!container) break;
                const count = container.querySelectorAll('.nn-panel-hidden-input').length;
                if (count >= 5) {
                    showToast(t('nnMaxHiddenLayers'), 'error');
                    break;
                }
                const span = document.createElement('span');
                span.style.display = 'inline-flex';
                span.style.alignItems = 'center';
                span.style.gap = '2px';
                span.innerHTML = `<span class="nn-topo-arrow">→</span><input type="number" class="nn-panel-hidden-input" value="16" min="1" max="512" /><span class="nn-panel-remove-layer" data-action="remove-hidden-layer">✕</span>`;
                container.appendChild(span);
                _updatePanelParamCount();
                break;
            }

            case 'remove-hidden-layer': {
                const container = document.getElementById('nn-panel-hidden-layers');
                if (!container) break;
                const inputs = container.querySelectorAll('.nn-panel-hidden-input');
                if (inputs.length <= 1) break;
                const wrapper = target.parentElement;
                if (wrapper) wrapper.remove();
                _updatePanelParamCount();
                break;
            }

            // -- Topology editor actions (Step 2, existing untrained networks) --

            case 'topo-add-layer': {
                const container = document.getElementById('nn-topo-hidden-layers');
                if (!container) break;
                const count = container.querySelectorAll('.nn-topo-hidden-input').length;
                if (count >= 5) {
                    showToast(t('nnMaxHiddenLayers'), 'error');
                    break;
                }
                const span = document.createElement('span');
                span.style.display = 'inline-flex';
                span.style.alignItems = 'center';
                span.style.gap = '2px';
                span.innerHTML = `<span class="nn-topo-arrow">→</span><input type="number" class="nn-topo-hidden-input" value="16" min="1" max="512" /><span class="nn-panel-remove-layer" data-action="topo-remove-layer">✕</span>`;
                container.appendChild(span);
                _updateTopoParamCount(getNetwork(_state.networkId));
                break;
            }

            case 'topo-remove-layer': {
                const container = document.getElementById('nn-topo-hidden-layers');
                if (!container) break;
                const inputs = container.querySelectorAll('.nn-topo-hidden-input');
                if (inputs.length <= 1) break;
                const wrapper = target.parentElement;
                if (wrapper && wrapper !== container) wrapper.remove();
                else target.previousElementSibling?.remove?.(); // remove the input
                _updateTopoParamCount(getNetwork(_state.networkId));
                break;
            }

            case 'topo-apply': {
                if (!_state.networkId) break;
                const nn = getNetwork(_state.networkId);
                if (!nn || nn.trained) break;
                const inputs = document.querySelectorAll('#nn-topo-hidden-layers .nn-topo-hidden-input');
                const hiddenLayerSizes = Array.from(inputs).map((el) => parseInt(el.value) || 16);
                if (hiddenLayerSizes.length === 0 || hiddenLayerSizes.length > 5) break;

                // Save metadata before removing (removeNetwork clears it)
                const existingMeta = getNetworkMetadata(_state.networkId) || {};

                // Rebuild network with new topology
                import('./manager.js').then((mgr) => {
                    mgr.removeNetwork(_state.networkId);
                    mgr.registerNetwork(
                        _state.networkId,
                        {
                            inputSize: nn.inputSize,
                            hiddenLayerSizes,
                            outputSize: nn.outputSize,
                            classNames: nn.classNames,
                            mode: nn.mode,
                        },
                        existingMeta || {},
                    );
                    mgr.persistNetwork(_state.networkId);
                    showToast(
                        `${t('nnTopology')}: ${[nn.inputSize, ...hiddenLayerSizes, nn.outputSize].join(' → ')}`,
                        'success',
                    );
                    refreshPanel();
                });
                break;
            }

            case 'delete-network':
                if (_state.networkId && (await asyncConfirm(`${t('remove')}: ${_state.networkId}?`))) {
                    removeNetwork(_state.networkId);
                    const ids = listNetworks();
                    _state.networkId = ids.length > 0 ? ids[0] : null;
                    refreshPanel();
                }
                break;

            case 'save-mapping':
                _saveMapping();
                break;

            case 'unmap-var': {
                const side = target.dataset.side;
                const varId = target.dataset.var;
                if (_state.networkId && side && varId) {
                    const existing = getNetworkMapping(_state.networkId);
                    if (existing) {
                        existing[side] = existing[side].filter((v) => v.variableId !== varId);
                        import('./manager.js').then((mgr) => {
                            mgr.updateNetworkMapping(_state.networkId, existing);
                            refreshPanel();
                        });
                    }
                }
                break;
            }

            case 'train-network':
                _doTraining();
                break;
        }
    });

    // Change event for network selector
    _panel.addEventListener('change', (e) => {
        if (e.target.matches('[data-action="select-network"]')) {
            _state.networkId = e.target.value;
            refreshPanel();
        }
        // Update param count when topology inputs change
        if (e.target.matches('.nn-topo-hidden-input')) {
            _updateTopoParamCount(getNetwork(_state.networkId));
        }
    });

    // Input event for live param count updates while typing
    _panel.addEventListener('input', (e) => {
        if (e.target.matches('.nn-topo-hidden-input')) {
            _updateTopoParamCount(getNetwork(_state.networkId));
        }
    });
}

// ================================================================
// ACTIONS
// ================================================================

function _saveMapping() {
    if (!_state.networkId) return;

    import('./builderRenderer.js').then((mod) => {
        // Use the existing save logic that handles auto-plume-connect
        // But we need to save from our panel's current mapping
        const mapping = getNetworkMapping(_state.networkId);
        if (!mapping) return;

        // Auto-detect plume connection
        const hasGeoOutputs = mapping.outputs.some((m) => isGeometricVariable(m.variableId));
        if (hasGeoOutputs && !mapping.targetElementId) {
            const plumes = getAllElements().filter((e) => e.family === 'plume');
            if (plumes.length > 0) mapping.targetElementId = plumes[0].id;
        }

        import('./manager.js').then((mgr) => {
            mgr.updateNetworkMapping(_state.networkId, mapping);

            // Auto-resize topology
            const inputSize = mapping.inputs.length || 1;
            const outputSize = mapping.outputs.length || 1;
            mgr.resizeNetwork(_state.networkId, inputSize, outputSize);
            mgr.persistNetwork(_state.networkId);

            showToast(`${t('nnSaveMapping')}: ${_state.networkId}`, 'success');
            refreshPanel();
        });
    });
}

function _doTraining() {
    if (!_state.networkId) return;

    const nn = getNetwork(_state.networkId);
    const mapping = getNetworkMapping(_state.networkId);
    if (!nn || !mapping) return;

    if (nn.mode !== 'regression') nn.mode = 'regression';

    const samples = buildTrainingData(_state.networkId);
    if (samples.length < 5) {
        showToast(`Training: only ${samples.length} samples (need ≥ 5)`, 'error');
        return;
    }

    // Show progress bar
    const progressBar = document.getElementById('nn-train-progress');
    const progressFill = document.getElementById('nn-train-progress-fill');
    const metricsEl = document.getElementById('nn-train-metrics-live');
    if (progressBar) progressBar.style.display = '';
    if (metricsEl) metricsEl.style.display = '';

    showToast(`${t('nnTrainNetwork')}: ${samples.length} samples...`, 'info');

    // Use setTimeout to allow UI to update
    setTimeout(() => {
        nn.train(samples, {
            epochs: 100,
            lr: 0.01,
            batchSize: Math.min(32, Math.floor(samples.length / 2)),
            onProgress: ({ epoch, loss, accuracy, total }) => {
                const pct = ((epoch + 1) / total) * 100;
                if (progressFill) progressFill.style.width = `${pct}%`;
                if (metricsEl) {
                    metricsEl.innerHTML = `
                        <div class="nn-train-metric">
                            <div class="nn-train-metric-value">${loss.toFixed(4)}</div>
                            <div class="nn-train-metric-label">Loss</div>
                        </div>
                        <div class="nn-train-metric">
                            <div class="nn-train-metric-value">${(accuracy * 100).toFixed(1)}%</div>
                            <div class="nn-train-metric-label">Accuracy</div>
                        </div>`;
                }
                if (epoch === total - 1) {
                    showToast(
                        `${t('nnTrained')} — Loss: ${loss.toFixed(4)}, Accuracy: ${(accuracy * 100).toFixed(1)}%`,
                        'success',
                    );
                }
            },
        });

        persistNetwork(_state.networkId);

        // Refresh to update wizard step states
        setTimeout(() => refreshPanel(), 100);
    }, 50);
}

// ================================================================
// RESIZE HANDLE
// ================================================================

function _setupResizeHandle() {
    const handle = _panel.querySelector('.nn-panel-resize-handle');
    if (!handle) return;

    let startX = 0,
        startW = 0;

    const onMouseMove = (e) => {
        const delta = startX - e.clientX;
        const newW = Math.max(300, Math.min(600, startW + delta));
        _state.width = newW;
        _panel.style.width = newW + 'px';
    };

    const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        _persist();
    };

    handle.addEventListener('mousedown', (e) => {
        startX = e.clientX;
        startW = _state.width;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// ================================================================
// UTILITIES
// ================================================================

function _closeInspectorIfOpen() {
    try {
        import('../../utils/inspector/manager.js')
            .then((m) => {
                const config = m.getInspectorConfig();
                if (config.visible) {
                    // Toggle visibility off
                    import('../../utils/handlers/inspector.js')
                        .then((h) => {
                            h.inspectorHandlers.handleToggleInspector();
                        })
                        .catch(() => {});
                }
            })
            .catch(() => {});
    } catch {
        /* ignore */
    }
}

function _persist() {
    if (
        !safeSetItem(
            STORAGE_KEY,
            JSON.stringify({
                width: _state.width,
                visible: _state.visible,
            }),
        )
    ) {
        showToast('Storage full. Panel state may not persist.', 'warning');
    }
}
