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
   REGULATORY STANDARDS MODAL
   ================================================================

   Modal para visualizar e gerenciar padroes regulatorios (VR/VP/VI).
   Permite adicionar thresholds customizados (CMA, screening, etc.)
   e exportar/importar configuracoes regulatorias.

   ================================================================ */

import {
    getAllRegulatoryStandards,
    addCustomThreshold,
    removeCustomThreshold,
    getCustomThresholds,
    clearCustomThresholds,
    exportCustomThresholds,
    importCustomThresholds,
    DEFAULT_SEVERITY,
    getSubstanceInfo,
} from '../../core/validation/rules.js';
import { escapeHtml } from '../helpers/html.js';
import { getIcon } from './icons.js';
import { openModal, closeModal } from './modals.js';
import { showToast } from './toast.js';
import { asyncPrompt, asyncConfirm } from './asyncDialogs.js';
import { t } from '../i18n/translations.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let _selectedMatrix = 'groundwater';
let _selectedLandUse = '';

// ----------------------------------------------------------------
// OPEN / CLOSE
// ----------------------------------------------------------------

/**
 * Opens the regulatory standards management modal.
 * Abre modal de gestao de padroes regulatorios.
 */
export function openRegulatoryStandards() {
    openModal('regulatory-standards-modal');
    _renderTable();
}

// ----------------------------------------------------------------
// RENDERING
// ----------------------------------------------------------------

function _renderTable() {
    const container = document.getElementById('regulatory-table-body');
    if (!container) return;

    const standards = getAllRegulatoryStandards();

    // Filtrar por matrix
    const filtered = standards.filter((s) => s.thresholds.some((th) => th.matrix === _selectedMatrix));

    if (filtered.length === 0) {
        container.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--neutral-500);padding:20px;">
            ${t('noData') || 'No standards for this matrix'}
        </td></tr>`;
        return;
    }

    let html = '';
    for (const std of filtered) {
        const matrixThresholds = std.thresholds.filter((th) => th.matrix === _selectedMatrix);
        if (_selectedLandUse) {
            // Solo — filtrar por landUse
            const luFiltered = matrixThresholds.filter(
                (th) => !th.meta?.landUse || th.meta.landUse === _selectedLandUse,
            );
            if (luFiltered.length === 0) continue;
        }

        const vi = matrixThresholds.find((th) => th.type === 'vi' || th.type === 'cma');
        const vp = matrixThresholds.find((th) => th.type === 'vp');
        const vr = matrixThresholds.find((th) => th.type === 'vr');
        const customs = matrixThresholds.filter(
            (th) => !['vi', 'vp', 'vr'].includes(th.type) || getCustomThresholds(std.id).includes(th),
        );
        const isCustom = getCustomThresholds(std.id).length > 0;

        html += `<tr>
            <td class="reg-cell-name">
                <strong>${escapeHtml(std.name)}</strong>
                ${std.formula ? `<span class="reg-formula">${escapeHtml(std.formula)}</span>` : ''}
                ${std.category ? `<span class="reg-category">${escapeHtml(std.category)}</span>` : ''}
            </td>
            <td class="reg-cell-id">${escapeHtml(std.id)}</td>
            <td class="reg-cell-value ${vr ? 'reg-ref' : ''}">${vr ? vr.value : '—'}</td>
            <td class="reg-cell-value ${vp ? 'reg-prev' : ''}">${vp ? vp.value : '—'}</td>
            <td class="reg-cell-value ${vi ? 'reg-interv' : ''}">${vi ? vi.value : '—'}</td>
            <td class="reg-cell-unit">${(vi || vp || vr)?.unit || '—'}</td>
            <td class="reg-cell-source">${escapeHtml((vi || vp || vr)?.source || '—')}</td>
            <td class="reg-cell-actions">
                <button class="btn-icon btn-tiny" onclick="window.handleRegAddThreshold('${escapeHtml(std.id)}')"
                        title="${t('addThreshold') || 'Add threshold'}">
                    ${getIcon('plus', { size: '12px' })}
                </button>
                ${
                    isCustom
                        ? `<button class="btn-icon btn-tiny btn-danger" onclick="window.handleRegRemoveCustom('${escapeHtml(std.id)}')"
                        title="${t('removeCustom') || 'Remove custom'}">
                    ${getIcon('x', { size: '12px' })}
                </button>`
                        : ''
                }
            </td>
        </tr>`;
    }

    container.innerHTML = html;
}

// ----------------------------------------------------------------
// HANDLERS
// ----------------------------------------------------------------

/**
 * Handle matrix selector change.
 * Muda a matriz selecionada e re-renderiza.
 */
export function handleRegMatrixChange(value) {
    _selectedMatrix = value;
    // Mostrar/esconder seletor de uso do solo
    const luSelect = document.getElementById('reg-land-use-select');
    if (luSelect) luSelect.style.display = value === 'soil' ? '' : 'none';
    _renderTable();
}

/**
 * Handle land use selector change.
 */
export function handleRegLandUseChange(value) {
    _selectedLandUse = value;
    _renderTable();
}

/**
 * Add custom threshold via inline form.
 * Adiciona threshold customizado para um CAS/parametro.
 */
export async function handleRegAddThreshold(casOrParamId) {
    const type = await asyncPrompt(t('thresholdType') || 'Threshold type (vi, vp, vr, cma, screening, or custom):');
    if (!type) return;

    const valueStr = await asyncPrompt(t('thresholdValue') || 'Value:');
    if (!valueStr) return;
    const value = parseFloat(valueStr);
    if (isNaN(value)) {
        showToast('Invalid value', 'error');
        return;
    }

    const source = (await asyncPrompt(t('thresholdSource') || 'Source (e.g., CONAMA 420/2009):')) || 'Custom';

    const severity = DEFAULT_SEVERITY[type] || 'info';
    const info = getSubstanceInfo(casOrParamId);
    const unit = info ? _guessUnit(_selectedMatrix) : 'mg_L';

    addCustomThreshold(casOrParamId, {
        type,
        value,
        matrix: _selectedMatrix,
        unit,
        severity,
        source,
        meta: _selectedLandUse ? { landUse: _selectedLandUse } : {},
    });

    showToast(`${type.toUpperCase()} = ${value} added`, 'success');
    _renderTable();
}

/**
 * Remove all custom thresholds for a substance.
 */
export function handleRegRemoveCustom(casOrParamId) {
    const customs = getCustomThresholds(casOrParamId);
    if (customs.length === 0) return;
    for (let i = customs.length - 1; i >= 0; i--) {
        removeCustomThreshold(casOrParamId, i);
    }
    showToast('Custom thresholds removed', 'info');
    _renderTable();
}

/**
 * Export all custom thresholds as JSON.
 */
export function handleRegulatoryExport() {
    const data = exportCustomThresholds();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'regulatory-thresholds.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported', 'success');
}

/**
 * Import custom thresholds from JSON file.
 */
export function handleRegulatoryImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            importCustomThresholds(data);
            showToast(`Imported ${Object.keys(data).length} entries`, 'success');
            _renderTable();
        } catch (err) {
            showToast('Import failed: ' + err.message, 'error');
        }
    };
    input.click();
}

/**
 * Restore all thresholds to defaults (clear custom).
 */
export async function handleRegulatoryRestore() {
    if (!(await asyncConfirm(t('confirmRestoreDefaults') || 'Remove all custom thresholds and restore defaults?')))
        return;
    clearCustomThresholds();
    showToast(t('defaultsRestored') || 'Defaults restored', 'success');
    _renderTable();
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function _guessUnit(matrix) {
    switch (matrix) {
        case 'groundwater':
            return 'ug_L';
        case 'soil':
            return 'mg_kg';
        case 'air':
            return 'ug_m3';
        case 'effluent':
            return 'mg_L';
        case 'occupational':
            return 'dBA';
        default:
            return 'mg_L';
    }
}

// ----------------------------------------------------------------
// GLOBAL COMPLIANCE VIEW
// ----------------------------------------------------------------

let _globalViewActive = false;

/**
 * Toggle global compliance view in regulatory modal.
 * Shows pass/fail matrix per substance per jurisdiction.
 */
export async function handleRegGlobalView() {
    _globalViewActive = !_globalViewActive;

    const btn = document.getElementById('reg-global-btn');
    if (btn) {
        btn.style.background = _globalViewActive ? 'var(--accent-red,#ef4444)' : 'var(--accent-500,#2d8a7a)';
        btn.textContent = _globalViewActive ? t('singleJurisdiction') || 'Single' : t('globalView') || 'Global';
    }

    if (_globalViewActive) {
        await _renderGlobalTable();
    } else {
        _renderTable();
    }
}

async function _renderGlobalTable() {
    const container = document.getElementById('regulatory-table-body');
    const thead = container?.closest('table')?.querySelector('thead tr');
    if (!container || !thead) return;

    let GLOBAL_THRESHOLDS, JURISDICTION_ORDER, JURISDICTIONS, getMostStringentThreshold;
    try {
        const mod = await import('../../core/validation/globalThresholds.js');
        GLOBAL_THRESHOLDS = mod.GLOBAL_THRESHOLDS;
        JURISDICTION_ORDER = mod.JURISDICTION_ORDER;
        JURISDICTIONS = mod.JURISDICTIONS;
        getMostStringentThreshold = mod.getMostStringentThreshold;
    } catch (e) {
        container.innerHTML =
            '<tr><td colspan="8" style="text-align:center;color:var(--neutral-500);padding:20px;">Global thresholds module not available</td></tr>';
        return;
    }

    // Collect current site observations for pass/fail coloring
    const siteValues = {};
    try {
        const { getAllElements } = await import('../../core/elements/manager.js');
        const { CONFIG } = await import('../../config.js');
        for (const el of getAllElements()) {
            for (const obs of el?.data?.observations || []) {
                if (!obs.parameterId || obs.value == null) continue;
                const param = CONFIG.PARAMETERS.find((p) => p.id === obs.parameterId);
                if (!param?.casNumber) continue;
                const v = Number(obs.value);
                if (isNaN(v)) continue;
                if (!siteValues[param.casNumber] || v > siteValues[param.casNumber].value) {
                    siteValues[param.casNumber] = { value: v, unitId: obs.unitId || param.defaultUnitId };
                }
            }
        }
    } catch {
        /* no site data — show thresholds only */
    }

    // Rebuild thead with jurisdiction columns
    const shortLabels = {
        BR_CONAMA: 'BR',
        US_EPA: 'US',
        EU_DWD: 'EU',
        WHO: 'WHO',
        CA_CCME: 'CA',
        AU_ADWG: 'AU',
        JP_EQS: 'JP',
        CN_GB: 'CN',
        IN_BIS: 'IN',
        UK_EQS: 'UK',
    };
    thead.innerHTML = '<th style="text-align:left;padding:6px;">Substance</th>';
    for (const jId of JURISDICTION_ORDER) {
        thead.innerHTML += `<th style="text-align:center;padding:4px;font-size:var(--text-xs,10px);" title="${escapeHtml(JURISDICTIONS[jId]?.name || jId)}">${shortLabels[jId] || jId}</th>`;
    }
    thead.innerHTML += `<th style="text-align:center;padding:4px;font-size:var(--text-xs,10px);color:var(--accent-red,#ef4444);">${t('mostStringentLabel') || 'Strictest'}</th>`;

    // Build rows per CAS substance
    const standards = getAllRegulatoryStandards();
    let html = '';

    for (const cas of Object.keys(GLOBAL_THRESHOLDS)) {
        const entries = GLOBAL_THRESHOLDS[cas];
        const entryMap = {};
        for (const e of entries) entryMap[e.jurisdiction] = e;

        const std = standards.find((s) => s.id === cas);
        const name = std?.name || getSubstanceInfo(cas)?.name || cas;
        const siteVal = siteValues[cas];

        html += `<tr><td style="padding:6px;font-size:11px;font-weight:500;">${escapeHtml(name)}<br><span style="font-size:var(--text-xs,10px);color:var(--neutral-500);">${cas}</span></td>`;

        for (const jId of JURISDICTION_ORDER) {
            const e = entryMap[jId];
            if (!e) {
                html += '<td style="text-align:center;padding:4px;color:var(--neutral-600);">&#8212;</td>';
            } else {
                let cellColor = 'var(--neutral-400)';
                let icon = '';
                if (siteVal) {
                    const pass = siteVal.value <= e.value;
                    cellColor = pass ? 'var(--success,#3d8a5c)' : 'var(--error,#b84444)';
                    icon = pass ? ' &#10003;' : ' &#10007;';
                }
                html += `<td style="text-align:center;padding:4px;font-size:11px;color:${cellColor};" title="${escapeHtml(e.source)}">${e.value}${icon}</td>`;
            }
        }

        // Most stringent column
        const ms = getMostStringentThreshold(cas, 'groundwater');
        if (ms) {
            html += `<td style="text-align:center;padding:4px;font-size:11px;font-weight:600;color:var(--accent-red,#ef4444);">${shortLabels[ms.jurisdiction] || ms.jurisdiction} ${ms.value}</td>`;
        } else {
            html += '<td style="text-align:center;padding:4px;">&#8212;</td>';
        }

        html += '</tr>';
    }

    container.innerHTML = html;
}
