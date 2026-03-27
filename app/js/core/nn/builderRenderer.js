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
   BUILDER RENDERER — 3-panel drag & drop variable mapping UI
   Renderizador do construtor de mapeamento de variaveis

   Layout em 3 paineis: Catalogo (esquerda), Mapeamento (centro),
   Normalizacao (direita). O usuario arrasta pills de variaveis do
   catalogo para as zonas de Input/Output no painel central.
   ================================================================ */

import {
    buildVariableCatalog,
    groupByCategory,
    getCategoryLabel,
    getCategoryColor,
    isGeometricVariable,
} from './variableCatalog.js';
import { getDefaultBounds } from './normalization.js';
import { getNetwork, getNetworkMapping, updateNetworkMapping, resizeNetwork, persistNetwork } from './manager.js';
import { getAllElements } from '../elements/manager.js';
import { showToast } from '../../utils/ui/toast.js';
import { t } from '../../utils/i18n/translations.js';
import { getIcon } from '../../utils/ui/icons.js';
import { escapeHtml } from '../../utils/helpers/html.js';

// ----------------------------------------------------------------
// MODULE STATE — Current builder session
// Estado temporario da sessao de construcao
// ----------------------------------------------------------------

let _currentNetworkId = null;
let _currentMapping = { inputs: [], outputs: [] };

// ----------------------------------------------------------------
// MAIN RENDER — 3-panel builder layout
// Renderiza o layout principal do construtor
// ----------------------------------------------------------------

/**
 * Render the variable mapping builder for a network.
 * Substitui o conteudo do nn-modal-body com o construtor 3 paineis.
 *
 * @param {string} networkId
 */
export function renderBuilder(networkId) {
    const body = document.getElementById('nn-modal-body');
    if (!body) return;

    const nn = getNetwork(networkId);
    if (!nn) return;

    _currentNetworkId = networkId;

    // Load existing mapping or start fresh
    const existing = getNetworkMapping(networkId);
    _currentMapping = existing
        ? { inputs: [...existing.inputs], outputs: [...existing.outputs] }
        : { inputs: [], outputs: [] };

    const catalog = buildVariableCatalog();
    const grouped = groupByCategory(catalog);

    body.innerHTML = `
        <div class="nn-builder-header">
            <button class="btn btn-sm" onclick="handleNNBuilderBack()">
                ${getIcon('arrow-left', { size: '14px' })} ${t('nnBackToList')}
            </button>
            <h4>${getIcon('sliders', { size: '16px' })} ${t('nnBuilder')}: <span class="nn-card-id">${escapeHtml(networkId)}</span></h4>
        </div>
        <div class="nn-builder">
            <div class="nn-catalog-panel" id="nn-catalog-panel">
                ${_renderCatalogPanel(grouped)}
            </div>
            <div class="nn-mapping-panel">
                <div class="nn-mapping-section">
                    <div class="nn-mapping-label">${getIcon('log-in', { size: '14px' })} ${t('nnInputZone')}</div>
                    <div class="nn-dropzone" id="nn-dropzone-inputs" data-side="inputs">
                        ${_renderMappedVars(_currentMapping.inputs, 'inputs')}
                    </div>
                </div>
                <div class="nn-mapping-divider">${getIcon('chevrons-down', { size: '16px' })}</div>
                <div class="nn-mapping-section">
                    <div class="nn-mapping-label">${getIcon('log-out', { size: '14px' })} ${t('nnOutputZone')}</div>
                    <div class="nn-dropzone" id="nn-dropzone-outputs" data-side="outputs">
                        ${_renderMappedVars(_currentMapping.outputs, 'outputs')}
                    </div>
                </div>
            </div>
            <div class="nn-norm-panel" id="nn-norm-panel">
                ${_renderNormPanel()}
            </div>
        </div>
        <div class="nn-builder-footer">
            <button class="btn btn-primary btn-sm" onclick="handleNNSaveBuilder('${escapeHtml(networkId)}')">
                ${getIcon('save', { size: '14px' })} ${t('nnSaveMapping')}
            </button>
        </div>`;

    _installDnD(body);
}

// ----------------------------------------------------------------
// CATALOG PANEL — Draggable variable pills
// Painel esquerdo com pills arrastaveis agrupadas por categoria
// ----------------------------------------------------------------

function _renderCatalogPanel(grouped) {
    let html = `<div class="nn-catalog-title">${getIcon('book-open', { size: '14px' })} ${t('nnVariableCatalog')}</div>`;

    const allMapped = new Set([
        ..._currentMapping.inputs.map((v) => v.variableId),
        ..._currentMapping.outputs.map((v) => v.variableId),
    ]);

    for (const [category, vars] of Object.entries(grouped)) {
        const color = getCategoryColor(category);
        html += `
            <div class="nn-catalog-category">
                <div class="nn-catalog-category-header" style="border-left: 3px solid ${color}">
                    ${getCategoryLabel(category)}
                </div>`;

        for (const v of vars) {
            const disabled = allMapped.has(v.id) ? ' nn-pill-disabled' : '';
            const calcBadge = v._calcType
                ? `<span class="nn-calc-badge">${v._calcType === 'ratio' ? 'R' : v._calcType[0].toUpperCase()}</span>`
                : '';
            html += `
                <div class="nn-variable-pill${disabled}"
                     draggable="${allMapped.has(v.id) ? 'false' : 'true'}"
                     data-variable-id="${v.id}"
                     data-variable-name="${escapeHtml(v.name)}"
                     data-variable-unit="${v.unitId}"
                     data-variable-min="${v.min}"
                     data-variable-max="${v.max}"
                     style="--pill-color: ${color}">
                    <span class="nn-pill-dot" style="background: ${color}"></span>
                    ${calcBadge}${escapeHtml(v.name)}
                    <span class="nn-pill-unit">${v.unitId}</span>
                </div>`;
        }

        html += '</div>';
    }
    return html;
}

// ----------------------------------------------------------------
// MAPPING PANEL — Rendered mapped variables in dropzones
// Painel central com variaveis mapeadas nas zonas
// ----------------------------------------------------------------

function _renderMappedVars(mappedVars, side) {
    if (mappedVars.length === 0) {
        return `<div class="nn-dropzone-hint">${t('nnBuilderHint')}</div>`;
    }

    let html = '';
    for (const v of mappedVars) {
        html += `
            <div class="nn-mapped-var">
                <span class="nn-mapped-name">${escapeHtml(v.variableId)}</span>
                <span class="nn-mapped-unit">${v.unitId}</span>
                <button class="nn-mapped-remove" onclick="handleNNUnmapVariable('${escapeHtml(_currentNetworkId)}', '${side}', '${v.variableId}')" title="${t('remove')}">×</button>
            </div>`;
    }
    return html;
}

// ----------------------------------------------------------------
// NORMALIZATION PANEL — MIN/MAX fields per mapped variable
// Painel direito com campos de limites de normalizacao
// ----------------------------------------------------------------

function _renderNormPanel() {
    const allMapped = [..._currentMapping.inputs, ..._currentMapping.outputs];

    if (allMapped.length === 0) {
        return `<div class="nn-norm-empty">${t('nnNormalization')}</div>`;
    }

    let html = `<div class="nn-norm-title">${getIcon('settings', { size: '14px' })} ${t('nnNormalization')}</div>`;

    for (const v of allMapped) {
        const side = _currentMapping.inputs.includes(v) ? 'input' : 'output';
        const sideIcon = side === 'input' ? 'log-in' : 'log-out';
        html += `
            <div class="nn-norm-card">
                <div class="nn-norm-card-header">
                    ${getIcon(sideIcon, { size: '12px' })}
                    <strong>${escapeHtml(v.variableId)}</strong>
                    <span class="nn-pill-unit">${v.unitId}</span>
                </div>
                <div class="nn-norm-card-body">
                    <div class="nn-norm-field">
                        <label>${t('nnNormMin')}</label>
                        <input type="number" class="form-control" value="${v.min}"
                               onchange="handleNNUpdateNorm('${escapeHtml(_currentNetworkId)}', '${v.variableId}', 'min', this.value)" />
                    </div>
                    <div class="nn-norm-field">
                        <label>${t('nnNormMax')}</label>
                        <input type="number" class="form-control" value="${v.max}"
                               onchange="handleNNUpdateNorm('${escapeHtml(_currentNetworkId)}', '${v.variableId}', 'max', this.value)" />
                    </div>
                </div>
            </div>`;
    }
    return html;
}

// ----------------------------------------------------------------
// DRAG & DROP — HTML5 native DnD for variable pills → dropzones
// Sistema de arrastar e soltar nativo para pills nas zonas
// ----------------------------------------------------------------

function _installDnD(container) {
    // Drag start — set variable data on the dragged pill
    container.addEventListener('dragstart', (e) => {
        const pill = e.target.closest('.nn-variable-pill');
        if (!pill || pill.classList.contains('nn-pill-disabled')) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData('text/plain', pill.dataset.variableId);
        e.dataTransfer.effectAllowed = 'copy';
        pill.classList.add('nn-pill-dragging');
    });

    container.addEventListener('dragend', (e) => {
        const pill = e.target.closest('.nn-variable-pill');
        if (pill) pill.classList.remove('nn-pill-dragging');
    });

    // Drop zones — accept dragged pills
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

// ----------------------------------------------------------------
// MAPPING CALLBACKS — Add/remove variables to mapping
// Callbacks para adicionar/remover variaveis do mapeamento
// ----------------------------------------------------------------

function _onVariableMapped(variableId, side) {
    // Prevent duplicate mapping
    const existing = [..._currentMapping.inputs, ..._currentMapping.outputs];
    if (existing.some((v) => v.variableId === variableId)) return;

    const bounds = getDefaultBounds(variableId);
    const entry = {
        variableId,
        min: bounds?.min ?? 0,
        max: bounds?.max ?? 1,
        unitId: bounds?.unitId ?? '',
    };

    _currentMapping[side].push(entry);
    _refreshBuilder();
}

/**
 * Remove a variable from the mapping.
 * @param {string} networkId
 * @param {string} side - 'inputs' or 'outputs'
 * @param {string} variableId
 */
export function unmapVariable(networkId, side, variableId) {
    if (networkId !== _currentNetworkId) return;
    _currentMapping[side] = _currentMapping[side].filter((v) => v.variableId !== variableId);
    _refreshBuilder();
}

/**
 * Update normalization bounds for a mapped variable.
 * @param {string} networkId
 * @param {string} variableId
 * @param {string} field - 'min' or 'max'
 * @param {string} value
 */
export function updateNorm(networkId, variableId, field, value) {
    if (networkId !== _currentNetworkId) return;

    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;

    for (const side of ['inputs', 'outputs']) {
        const entry = _currentMapping[side].find((v) => v.variableId === variableId);
        if (entry) {
            entry[field] = numVal;
            break;
        }
    }
}

/**
 * Save the current mapping to the network and resize topology.
 * Salva mapeamento, auto-ajusta topologia e persiste.
 *
 * @param {string} networkId
 */
export function saveBuilder(networkId) {
    if (networkId !== _currentNetworkId) return;

    // Auto-detect plume connection if outputs include geometric variables
    let targetElementId = getNetworkMapping(networkId)?.targetElementId || null;
    const hasGeoOutputs = _currentMapping.outputs.some((m) => isGeometricVariable(m.variableId));
    if (hasGeoOutputs && !targetElementId) {
        const plumes = getAllElements().filter((e) => e.family === 'plume');
        if (plumes.length > 0) targetElementId = plumes[0].id;
    }

    const mapping = {
        inputs: [..._currentMapping.inputs],
        outputs: [..._currentMapping.outputs],
        targetElementId,
    };

    updateNetworkMapping(networkId, mapping);

    // Auto-resize network topology to match mapping
    const inputSize = mapping.inputs.length || 1;
    const outputSize = mapping.outputs.length || 1;
    resizeNetwork(networkId, inputSize, outputSize);
    persistNetwork(networkId);

    showToast(`${t('nnSaveMapping')}: ${networkId}`, 'success');
}

/**
 * Go back to the network list view.
 * Volta para a lista de redes.
 */
export function backToList() {
    _currentNetworkId = null;
    _currentMapping = { inputs: [], outputs: [] };

    // Re-import handler to re-render modal
    import('../../utils/handlers/nn.js').then((mod) => {
        mod.nnHandlers.handleOpenNNManager();
    });
}

// ----------------------------------------------------------------
// INTERNAL — Re-render builder without full rebuild
// ----------------------------------------------------------------

function _refreshBuilder() {
    if (!_currentNetworkId) return;

    const catalog = buildVariableCatalog();
    const grouped = groupByCategory(catalog);

    // Re-render catalog with updated disabled states
    const catalogPanel = document.getElementById('nn-catalog-panel');
    if (catalogPanel) catalogPanel.innerHTML = _renderCatalogPanel(grouped);

    // Re-render dropzones
    const inputZone = document.getElementById('nn-dropzone-inputs');
    if (inputZone) inputZone.innerHTML = _renderMappedVars(_currentMapping.inputs, 'inputs');

    const outputZone = document.getElementById('nn-dropzone-outputs');
    if (outputZone) outputZone.innerHTML = _renderMappedVars(_currentMapping.outputs, 'outputs');

    // Re-render normalization panel
    const normPanel = document.getElementById('nn-norm-panel');
    if (normPanel) normPanel.innerHTML = _renderNormPanel();

    // Re-install DnD on updated content
    const body = document.getElementById('nn-modal-body') || document.querySelector('.nn-panel-body');
    if (body) _installDnD(body);
}
