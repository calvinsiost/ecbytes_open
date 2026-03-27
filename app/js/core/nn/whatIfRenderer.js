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
   WHAT-IF RENDERER — Interactive slider-based inference UI
   Renderizador do simulador What-If com sliders em tempo real

   Gera controles deslizantes para cada variavel de entrada e
   barras de resultado para cada saida. A inferencia e disparada
   a cada 50ms (debounced) quando o usuario move um slider.
   ================================================================ */

import { runInference, createDebouncedInference, getDefaultInputValues } from './whatIfEngine.js';
import { getNetwork, getNetworkMapping, getNetworkMetadata, updateNetworkMapping } from './manager.js';
import { getAllElements } from '../elements/manager.js';
import { isGeometricVariable } from './variableCatalog.js';
import { showToast } from '../../utils/ui/toast.js';
import { t } from '../../utils/i18n/translations.js';
import { getIcon } from '../../utils/ui/icons.js';
import { escapeHtml } from '../../utils/helpers/html.js';

// ----------------------------------------------------------------
// MODULE STATE — Current simulator session
// ----------------------------------------------------------------

let _currentNetworkId = null;
let _currentInputValues = {};
let _debouncedInfer = null;
let _plumeConnector = null; // Lazy-loaded in Phase 4

// ----------------------------------------------------------------
// MAIN RENDER — Simulator layout with sliders and output bars
// ----------------------------------------------------------------

/**
 * Render the What-If simulator for a trained+mapped network.
 * @param {string} networkId
 * @param {HTMLElement} [container] - Target container (defaults to #nn-modal-body)
 */
export function renderWhatIf(networkId, container) {
    const body = container || document.getElementById('nn-modal-body');
    if (!body) return;

    const nn = getNetwork(networkId);
    const mapping = getNetworkMapping(networkId);
    if (!nn || !mapping || !nn.trained) return;

    _currentNetworkId = networkId;
    _currentInputValues = getDefaultInputValues(networkId);

    // Setup debounced inference with 50ms delay
    _debouncedInfer = createDebouncedInference(
        networkId,
        (result) => {
            _updateOutputDisplay(result);
            _tryUpdatePlume(result);
        },
        50,
    );

    // Auto-connect to plume if outputs have geometric variables and no plume connected yet
    const plumes = getAllElements().filter((e) => e.family === 'plume');
    const hasGeoOutputs = mapping.outputs.some((m) => isGeometricVariable(m.variableId));
    if (hasGeoOutputs && !mapping.targetElementId && plumes.length > 0) {
        // Auto-connect to first plume
        mapping.targetElementId = plumes[0].id;
        updateNetworkMapping(networkId, mapping);
    }

    const targetId = mapping.targetElementId;

    // Se renderizado no painel lateral, omitir header (wizard cuida da navegacao)
    const isInPanel = body.closest('.nn-side-panel') != null;

    body.innerHTML = `
        ${
            !isInPanel
                ? `
        <div class="nn-whatif-header">
            <button class="btn btn-sm" onclick="handleNNWhatIfBack()">
                ${getIcon('arrow-left', { size: '14px' })} ${t('nnBackToList')}
            </button>
            <h4>${getIcon('activity', { size: '16px' })} ${t('nnWhatIf')}: <span class="nn-card-id">${escapeHtml(networkId)}</span></h4>
        </div>`
                : ''
        }
        <p class="nn-whatif-hint">${t('nnSliderHint')}</p>

        <div class="nn-whatif-panel">
            <div class="nn-whatif-inputs">
                <div class="nn-whatif-section-label">${getIcon('log-in', { size: '14px' })} ${t('nnInputZone')}</div>
                ${_renderInputSliders(mapping)}
            </div>
            <div class="nn-whatif-outputs">
                <div class="nn-whatif-section-label">${getIcon('log-out', { size: '14px' })} ${t('nnOutputZone')}</div>
                <div id="nn-whatif-output-bars">
                    ${_renderOutputBars(null, mapping)}
                </div>
                <div class="nn-whatif-confidence-row">
                    <span class="nn-whatif-confidence-label">${t('nnConfidence')}</span>
                    <div class="nn-whatif-confidence-bar">
                        <div class="nn-whatif-confidence-fill" id="nn-whatif-confidence-fill" style="width: 0%"></div>
                    </div>
                    <span class="nn-whatif-confidence-value" id="nn-whatif-confidence-value">—</span>
                </div>
            </div>
        </div>

        <div class="nn-whatif-footer">
            ${
                plumes.length > 0
                    ? `
            <div class="nn-whatif-plume-connect">
                <label>${getIcon('box', { size: '14px' })} ${t('nnConnectPlume')}</label>
                <select id="nn-whatif-plume-select" onchange="handleWhatIfConnectPlume('${escapeHtml(networkId)}', this.value)">
                    <option value="">— ${t('nnDisconnect')} —</option>
                    ${plumes.map((p) => `<option value="${p.id}" ${p.id === targetId ? 'selected' : ''}>${escapeHtml(p.name || p.id)}</option>`).join('')}
                </select>
            </div>`
                    : ''
            }
            <div class="nn-whatif-actions">
                <button class="btn btn-sm" onclick="handleWhatIfReset('${escapeHtml(networkId)}')" title="Reset sliders">
                    ${getIcon('rotate-ccw', { size: '14px' })} Reset
                </button>
            </div>
        </div>`;

    // Run initial inference with default midpoint values
    const initial = runInference(networkId, _currentInputValues);
    if (initial) {
        _updateOutputDisplay(initial);
        // Also update plume 3D on first render if connected
        _tryUpdatePlume(initial);
    }
}

// ----------------------------------------------------------------
// INPUT SLIDERS — Range inputs for each mapped variable
// ----------------------------------------------------------------

function _renderInputSliders(mapping) {
    let html = '';
    for (const m of mapping.inputs) {
        const value = _currentInputValues[m.variableId] ?? (m.min + m.max) / 2;
        const step = _getStep(m.min, m.max);
        html += `
            <div class="nn-whatif-slider-group">
                <div class="nn-whatif-slider-header">
                    <span class="nn-whatif-slider-name">${escapeHtml(m.variableId)}</span>
                    <span class="nn-whatif-slider-value" id="nn-slider-val-${m.variableId}">${_formatValue(value, m.unitId)}</span>
                </div>
                <input type="range" class="nn-whatif-slider"
                    min="${m.min}" max="${m.max}" step="${step}" value="${value}"
                    oninput="handleWhatIfSliderChange('${escapeHtml(_currentNetworkId)}', '${m.variableId}', this.value)" />
                <div class="nn-whatif-slider-range">
                    <span>${m.min}</span>
                    <span>${m.unitId}</span>
                    <span>${m.max}</span>
                </div>
            </div>`;
    }
    return html;
}

// ----------------------------------------------------------------
// OUTPUT BARS — Horizontal bar visualization for each output
// ----------------------------------------------------------------

function _renderOutputBars(result, mapping) {
    if (!mapping) mapping = getNetworkMapping(_currentNetworkId);
    if (!mapping) return '';

    let html = '';
    for (const m of mapping.outputs) {
        const value = result ? result.outputs[m.variableId] : null;
        const pct = value != null ? ((value - m.min) / (m.max - m.min)) * 100 : 0;
        const displayVal = value != null ? _formatValue(value, m.unitId) : '—';
        const isGeo = isGeometricVariable(m.variableId);
        const barClass = isGeo ? 'nn-whatif-bar-geo' : 'nn-whatif-bar-env';

        html += `
            <div class="nn-whatif-output-row">
                <span class="nn-whatif-output-name">${escapeHtml(m.variableId)}</span>
                <div class="nn-whatif-output-bar-wrap">
                    <div class="nn-whatif-output-bar ${barClass}" id="nn-out-bar-${m.variableId}" style="width: ${pct}%"></div>
                </div>
                <span class="nn-whatif-output-value" id="nn-out-val-${m.variableId}">${displayVal}</span>
            </div>`;
    }
    return html;
}

// ----------------------------------------------------------------
// LIVE UPDATE — Refresh output display on slider change
// ----------------------------------------------------------------

function _updateOutputDisplay(result) {
    const mapping = getNetworkMapping(_currentNetworkId);
    if (!mapping) return;

    for (const m of mapping.outputs) {
        const value = result.outputs[m.variableId];
        const pct = ((value - m.min) / (m.max - m.min)) * 100;

        const bar = document.getElementById(`nn-out-bar-${m.variableId}`);
        if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;

        const valEl = document.getElementById(`nn-out-val-${m.variableId}`);
        if (valEl) valEl.textContent = _formatValue(value, m.unitId);
    }

    // Update confidence bar
    const confFill = document.getElementById('nn-whatif-confidence-fill');
    const confVal = document.getElementById('nn-whatif-confidence-value');
    if (confFill) confFill.style.width = `${(result.confidence * 100).toFixed(0)}%`;
    if (confVal) confVal.textContent = `${(result.confidence * 100).toFixed(0)}%`;
}

// ----------------------------------------------------------------
// SLIDER CHANGE HANDLER — Called from oninput
// ----------------------------------------------------------------

/**
 * Handle slider value change.
 * @param {string} networkId
 * @param {string} variableId
 * @param {string} value
 */
export function onSliderChange(networkId, variableId, value) {
    if (networkId !== _currentNetworkId) return;

    const numVal = parseFloat(value);
    _currentInputValues[variableId] = numVal;

    // Update value display
    const mapping = getNetworkMapping(networkId);
    const m = mapping?.inputs.find((i) => i.variableId === variableId);
    const valEl = document.getElementById(`nn-slider-val-${variableId}`);
    if (valEl && m) valEl.textContent = _formatValue(numVal, m.unitId);

    // Trigger debounced inference
    if (_debouncedInfer) _debouncedInfer(_currentInputValues);
}

/**
 * Reset all sliders to midpoint values.
 * @param {string} networkId
 */
export function resetSliders(networkId) {
    if (networkId !== _currentNetworkId) return;
    _currentInputValues = getDefaultInputValues(networkId);
    renderWhatIf(networkId); // Re-render with default values
}

/**
 * Connect the What-If simulator to a plume element.
 * @param {string} networkId
 * @param {string} elementId
 */
export function connectPlume(networkId, elementId) {
    const mapping = getNetworkMapping(networkId);
    if (!mapping) return;

    mapping.targetElementId = elementId || null;
    updateNetworkMapping(networkId, mapping);

    if (elementId) {
        showToast(`${t('nnConnectPlume')}: ${elementId}`, 'success');
    } else {
        // Disconnect: reset plume to original
        _tryResetPlume();
        showToast(t('nnDisconnect'), 'info');
    }
}

/**
 * Go back to network list from What-If view.
 * Verifica se esta no painel lateral ou no modal.
 */
export function backToList() {
    _currentNetworkId = null;
    _currentInputValues = {};
    _debouncedInfer = null;

    // Se o painel lateral estiver aberto, navega de volta nele
    const sidePanel = document.getElementById('nn-side-panel');
    if (sidePanel?.classList.contains('visible')) {
        import('./panelRenderer.js').then((mod) => {
            mod.showStep(3); // volta para step de treino
        });
    } else {
        import('../../utils/handlers/nn.js').then((mod) => {
            mod.nnHandlers.handleOpenNNManager();
        });
    }
}

// ----------------------------------------------------------------
// PLUME INTEGRATION — Forward results to plumeConnector (Phase 4)
// ----------------------------------------------------------------

function _tryUpdatePlume(result) {
    const mapping = getNetworkMapping(_currentNetworkId);
    if (!mapping?.targetElementId) return;

    // Lazy-load plumeConnector to avoid circular deps
    if (!_plumeConnector) {
        import('./plumeConnector.js')
            .then((mod) => {
                _plumeConnector = mod;
                _plumeConnector.applyPredictionToPlume(mapping.targetElementId, result.outputs, result.confidence);
            })
            .catch(() => {
                // Phase 4 not yet implemented — silently skip
            });
    } else {
        _plumeConnector.applyPredictionToPlume(mapping.targetElementId, result.outputs, result.confidence);
    }
}

function _tryResetPlume() {
    const mapping = getNetworkMapping(_currentNetworkId);
    if (!mapping?.targetElementId || !_plumeConnector) return;
    _plumeConnector.resetPlumeToOriginal(mapping.targetElementId);
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function _getStep(min, max) {
    const range = max - min;
    if (range <= 1) return 0.01;
    if (range <= 10) return 0.1;
    if (range <= 100) return 1;
    if (range <= 1000) return 10;
    return 100;
}

function _formatValue(value, unitId) {
    if (value == null) return '—';
    const decimals = Math.abs(value) < 1 ? 3 : Math.abs(value) < 100 ? 1 : 0;
    return `${value.toFixed(decimals)} ${unitId}`;
}
