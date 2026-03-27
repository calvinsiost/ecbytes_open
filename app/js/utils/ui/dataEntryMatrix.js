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
   DATA ENTRY MATRIX — Formulário de entrada de dados em campo/escritório
   Entrada de dados em massa no estilo planilha transposta.

   Matriz transposta: linhas = parâmetros, colunas = pontos de amostragem.
   Mostra valores históricos para comparação lado a lado.
   Dois modos: "office" (tabela completa) e "field" (um elemento por vez).

   Arquitetura:
   - Estado em _state (closure do módulo)
   - renderSetup() → passo 1 (seleção de campanha, parâmetros, elementos)
   - renderEntry() → passo 2 (tabela/field mode)
   - buildHistoricalCache() → busca últimos 2 valores por par (param × elem)
   ================================================================ */

import { CONFIG } from '../../config.js';
import { getAllElements, getElementById, updateElement } from '../../core/elements/manager.js';
import { getAllCampaigns, addCampaign, getCampaignById } from '../../core/campaigns/manager.js';
import { getThresholds } from '../../core/validation/rules.js';
import { escapeHtml } from '../helpers/html.js';
import { hydrateIcons } from './icons.js';
import { openModal, closeModal } from './modals.js';
import { activateTabById } from './tabs.js';
import { showToast } from './toast.js';
import { t } from '../i18n/translations.js';
import { canEditElement, isAccessControlActive } from '../auth/permissions.js';
import { asyncConfirm } from './asyncDialogs.js';
import { getCurrentUser } from '../auth/session.js';

// ----------------------------------------------------------------
// MODULE STATE — Estado local do formulário
// ----------------------------------------------------------------

let _state = null;
let _updateAllUI = null;

/**
 * Inject updateAllUI dependency.
 * @param {Function} fn
 */
export function setDataEntryUpdateAllUI(fn) {
    _updateAllUI = fn;
}

/**
 * Get container element.
 * @returns {HTMLElement|null}
 */
function getContainer() {
    return document.getElementById('data-entry-content');
}

// ----------------------------------------------------------------
// PUBLIC API — Called by handlers
// ----------------------------------------------------------------

/**
 * Open the data entry matrix modal.
 * Abre o modal e inicializa estado.
 * @param {string} [preselectedCampaignId] - Campanha pré-selecionada
 */
export function openDataEntryMatrix(preselectedCampaignId) {
    _state = {
        step: 'setup',
        mode: 'office',
        campaignId: preselectedCampaignId || null,
        campaignDate: new Date().toISOString().slice(0, 10),
        newCampaignName: '',
        noCampaignMode: false,
        selectedParameterIds: [],
        selectedElementIds: [],
        fieldModeIndex: 0,
        cells: {},
        history: {},
        elementDates: {},
        paramUnits: {},
        paramSearch: '',
        elementFamilyFilter: '',
    };

    // Auto-seleciona elementos e parâmetros do plano se campanha tem plannedReadings
    if (preselectedCampaignId) {
        const campaign = getCampaignById(preselectedCampaignId);
        if (campaign) {
            _state.campaignDate = campaign.startDate || _state.campaignDate;
            if (campaign.plannedReadings?.length) {
                _state.selectedParameterIds = [
                    ...new Set(campaign.plannedReadings.map((r) => r.parameterId).filter(Boolean)),
                ];
                _state.selectedElementIds = [
                    ...new Set(campaign.plannedReadings.map((r) => r.elementId).filter(Boolean)),
                ];
            }
        }
    }

    openModal('data-entry-modal');
    render();
}

/**
 * Close the modal (with unsaved check).
 */
export async function closeDataEntryMatrix() {
    if (_state?.step === 'entry' && hasDirtyCells()) {
        if (!(await asyncConfirm(t('unsavedChanges') || 'You have unsaved data. Close anyway?'))) {
            return;
        }
    }
    _state = null;
    closeModal('data-entry-modal');
}

/**
 * Move to step 2 (entry).
 */
export function goToEntry() {
    if (!_state) return;

    // Validações
    if (!_state.noCampaignMode && !_state.campaignId && !_state.newCampaignName.trim()) {
        showToast(t('noCampaignSelected') || 'Select or create a campaign', 'warning');
        return;
    }
    if (!_state.selectedParameterIds.length) {
        showToast(t('noParametersSelected') || 'Select at least one parameter', 'warning');
        return;
    }
    if (!_state.selectedElementIds.length) {
        showToast(t('noElementsSelected') || 'Select at least one sampling point', 'warning');
        return;
    }

    // Cria campanha inline se necessário (skip em noCampaignMode)
    if (!_state.noCampaignMode && !_state.campaignId && _state.newCampaignName.trim()) {
        const campaign = addCampaign({
            name: _state.newCampaignName.trim(),
            startDate: _state.campaignDate,
        });
        _state.campaignId = campaign.id;
    }

    // Inicializa células e cache histórico
    initCells();
    _state.history = buildHistoricalCache(_state.selectedParameterIds, _state.selectedElementIds);
    _state.step = 'entry';
    _state.fieldModeIndex = 0;
    render();
}

/**
 * Go back to setup step.
 */
export function goToSetup() {
    if (!_state) return;
    _state.step = 'setup';
    render();
}

/**
 * Toggle between office and field mode.
 * @param {string} mode - 'office' | 'field'
 */
export function setMode(mode) {
    if (!_state) return;
    _state.mode = mode;
    render();
}

/**
 * Update a cell value.
 * @param {string} paramId
 * @param {string} elemId
 * @param {string} rawValue
 */
export function setCellValue(paramId, elemId, rawValue) {
    if (!_state?.cells[paramId]?.[elemId]) return;

    const cell = _state.cells[paramId][elemId];
    const trimmed = rawValue.trim();

    if (trimmed === '' || trimmed === '-') {
        cell.value = null;
        cell.dirty = trimmed !== '';
        cell.error = null;
        return;
    }

    // Aceita vírgula como decimal (convenção BR)
    const numeric = parseFloat(trimmed.replace(',', '.'));
    if (isNaN(numeric)) {
        cell.value = null;
        cell.error = 'NaN';
        cell.dirty = true;
    } else {
        cell.value = numeric;
        cell.error = null;
        cell.dirty = true;
    }
}

/**
 * Internal save — persists observations, returns counts.
 * Usa elementDates quando noCampaignMode, paramUnits para unitId.
 * @returns {{ saved: number, skipped: number }}
 */
function doSaveAll() {
    const user = getCurrentUser();
    let saved = 0;
    let skipped = 0;

    for (const elemId of _state.selectedElementIds) {
        if (isAccessControlActive() && !canEditElement(elemId)) {
            skipped++;
            continue;
        }

        const element = getElementById(elemId);
        if (!element) continue;

        const observations = Array.isArray(element.data?.observations) ? [...element.data.observations] : [];

        let elementChanged = false;
        const obsDate = _state.noCampaignMode
            ? _state.elementDates[elemId] || _state.campaignDate
            : _state.campaignDate;

        for (const paramId of _state.selectedParameterIds) {
            const cell = _state.cells[paramId]?.[elemId];
            if (!cell || cell.value == null || !cell.dirty) continue;

            const existingIdx = _state.noCampaignMode
                ? observations.findIndex((o) => o.parameterId === paramId && o.date === obsDate && !o.campaignId)
                : observations.findIndex((o) => o.campaignId === _state.campaignId && o.parameterId === paramId);

            const paramDef = CONFIG.PARAMETERS.find((p) => p.id === paramId);
            const unitId = _state.paramUnits[paramId] || paramDef?.defaultUnitId || null;

            if (existingIdx >= 0) {
                observations[existingIdx].value = cell.value;
                observations[existingIdx].date = obsDate;
                observations[existingIdx].unitId = unitId;
            } else {
                observations.push({
                    showPlanning: false,
                    plannedDate: null,
                    plannedParameterId: null,
                    plannedUnitId: null,
                    plannedX: null,
                    plannedY: null,
                    plannedZ: null,
                    expectedValue: null,
                    x: element.position?.x || 0,
                    y: element.position?.y || 0,
                    z: element.position?.z || 0,
                    date: obsDate,
                    campaignId: _state.campaignId,
                    parameterId: paramId,
                    value: cell.value,
                    unitId,
                    autoConvert: false,
                    additionalReadings: [],
                    variables: {},
                    detect_flag: null,
                    qualifier: null,
                    detection_limit: null,
                    cas_number: paramDef?.casNumber || null,
                    lab_name: null,
                    sample_code: null,
                    analytical_method: null,
                    dilution_factor: null,
                    sample_matrix: null,
                    uncertainty: null,
                    uncertaintyType: null,
                    coverageFactor: null,
                    credentialLevel: user?.credentialLevel || 'common',
                    createdBy: user?.email || null,
                });
            }

            saved++;
            cell.dirty = false;
            elementChanged = true;
        }

        if (elementChanged) {
            updateElement(elemId, { data: { ...element.data, observations } });
        }
    }

    if (_updateAllUI) _updateAllUI();
    return { saved, skipped };
}

/**
 * Save all dirty cells as observations.
 */
export function saveAll() {
    if (!_state) return;

    const errors = countErrors();
    if (errors > 0) {
        showToast(t('validationErrors') || 'Some cells have validation errors', 'error');
        return;
    }

    const { saved, skipped } = doSaveAll();

    const msg = `${saved} ${t('observationsSaved') || 'observations saved'}`;
    if (skipped > 0) {
        showToast(`${msg} (${skipped} ${t('elementsSkipped') || 'elements skipped — no permission'})`, 'warning');
    } else {
        showToast(msg, 'success');
    }

    closeModal('data-entry-modal');
    _state = null;
}

/**
 * Copy values from the last campaign.
 */
export function copyLastCampaign() {
    if (!_state) return;

    let filled = 0;
    for (const paramId of _state.selectedParameterIds) {
        for (const elemId of _state.selectedElementIds) {
            const hist = _state.history[paramId]?.[elemId];
            if (hist?.length && _state.cells[paramId]?.[elemId]) {
                const cell = _state.cells[paramId][elemId];
                if (cell.value == null) {
                    cell.value = hist[0].value;
                    cell.dirty = true;
                    filled++;
                }
            }
        }
    }

    showToast(`${filled} ${t('cellsFilled') || 'cells filled'}`, 'info');
    render();
}

/**
 * Clear all cell values.
 */
export async function clearAllCells() {
    if (!_state) return;
    if (!(await asyncConfirm(t('clearConfirm') || 'Clear all entered values?'))) return;

    for (const paramId of _state.selectedParameterIds) {
        for (const elemId of _state.selectedElementIds) {
            if (_state.cells[paramId]?.[elemId]) {
                _state.cells[paramId][elemId] = { value: null, dirty: false, error: null };
            }
        }
    }
    render();
}

/**
 * Navigate to next element in field mode.
 */
export function fieldNext() {
    if (!_state) return;
    _state.fieldModeIndex = (_state.fieldModeIndex + 1) % _state.selectedElementIds.length;
    render();
}

/**
 * Navigate to previous element in field mode.
 */
export function fieldPrev() {
    if (!_state) return;
    const len = _state.selectedElementIds.length;
    _state.fieldModeIndex = (_state.fieldModeIndex - 1 + len) % len;
    render();
}

/**
 * Update parameter search filter.
 * @param {string} query
 */
export function setParamSearch(query) {
    if (!_state) return;
    _state.paramSearch = query;
    renderSetupCheckboxes();
}

/**
 * Filter elements by family.
 * @param {string} familyId - '' for all
 */
export function setElementFilter(familyId) {
    if (!_state) return;
    _state.elementFamilyFilter = familyId;
    renderSetupCheckboxes();
}

/**
 * Toggle parameter selection.
 * @param {string} paramId
 * @param {boolean} checked
 */
export function toggleParam(paramId, checked) {
    if (!_state) return;
    if (checked && !_state.selectedParameterIds.includes(paramId)) {
        _state.selectedParameterIds.push(paramId);
    } else if (!checked) {
        _state.selectedParameterIds = _state.selectedParameterIds.filter((id) => id !== paramId);
    }
}

/**
 * Toggle element selection.
 * @param {string} elemId
 * @param {boolean} checked
 */
export function toggleElement(elemId, checked) {
    if (!_state) return;
    if (checked && !_state.selectedElementIds.includes(elemId)) {
        _state.selectedElementIds.push(elemId);
    } else if (!checked) {
        _state.selectedElementIds = _state.selectedElementIds.filter((id) => id !== elemId);
    }
}

/**
 * Select/deselect all parameters.
 * @param {boolean} all
 */
export function selectAllParams(all) {
    if (!_state) return;
    _state.selectedParameterIds = all ? CONFIG.PARAMETERS.map((p) => p.id) : [];
    renderSetupCheckboxes();
}

/**
 * Select/deselect all elements.
 * @param {boolean} all
 */
export function selectAllElements(all) {
    if (!_state) return;
    _state.selectedElementIds = all ? getAllElements().map((e) => e.id) : [];
    renderSetupCheckboxes();
}

/**
 * Set campaign selection.
 * @param {string} campaignId
 */
export function setCampaign(campaignId) {
    if (!_state) return;

    // "__none__" = modo sem campanha (datas individuais por ponto)
    if (campaignId === '__none__') {
        _state.campaignId = null;
        _state.noCampaignMode = true;
        render();
        return;
    }

    _state.campaignId = campaignId || null;
    _state.noCampaignMode = false;

    // Auto-preenche data da campanha
    if (campaignId) {
        const campaign = getCampaignById(campaignId);
        if (campaign?.startDate) {
            _state.campaignDate = campaign.startDate;
        }
    }
    render();
}

/**
 * Set campaign date.
 * @param {string} date
 */
export function setCampaignDate(date) {
    if (!_state) return;
    _state.campaignDate = date;
}

/**
 * Set new campaign name (inline creation).
 * @param {string} name
 */
export function setNewCampaignName(name) {
    if (!_state) return;
    _state.newCampaignName = name;
}

/**
 * Quick from Plan — auto-select from campaign's plannedReadings.
 */
export function quickFromPlan() {
    if (!_state?.campaignId) return;
    const campaign = getCampaignById(_state.campaignId);
    if (!campaign?.plannedReadings?.length) {
        showToast(t('noPlanData') || 'No planned readings in this campaign', 'info');
        return;
    }

    const paramIds = new Set(campaign.plannedReadings.map((r) => r.parameterId).filter(Boolean));
    const elemIds = new Set(campaign.plannedReadings.map((r) => r.elementId).filter(Boolean));
    _state.selectedParameterIds = [...paramIds];
    _state.selectedElementIds = [...elemIds];
    renderSetupCheckboxes();
    showToast(
        `${paramIds.size} ${t('selectParameters') || 'parameters'}, ${elemIds.size} ${t('selectElements') || 'points'}`,
        'info',
    );
}

/**
 * Set date for a specific element (noCampaignMode).
 * @param {string} elemId
 * @param {string} date - YYYY-MM-DD
 */
export function setElementDate(elemId, date) {
    if (!_state) return;
    _state.elementDates[elemId] = date;
}

/**
 * Set unit override for a parameter row.
 * @param {string} paramId
 * @param {string} unitId
 */
export function setParamUnit(paramId, unitId) {
    if (!_state) return;
    _state.paramUnits[paramId] = unitId;
    render();
}

/**
 * Open Insights — save dirty data, close modal, navigate to analytics.
 */
export function openInsights() {
    if (!_state) return;

    if (hasDirtyCells()) {
        const errors = countErrors();
        if (errors > 0) {
            showToast(t('validationErrors') || 'Fix errors before viewing insights', 'error');
            return;
        }
        doSaveAll();
    }

    _state = null;
    closeModal('data-entry-modal');

    // Navega para o painel Analytics
    setTimeout(() => {
        activateTabById('analytics');
        if (typeof window.toggleAnalyticsFullscreen === 'function') {
            const tabEl = document.getElementById('tab-analytics');
            if (tabEl && !tabEl.classList.contains('analytics-fullscreen')) {
                window.toggleAnalyticsFullscreen();
            }
        }
    }, 200);
}

// ----------------------------------------------------------------
// INTERNAL — Cell initialization & history cache
// ----------------------------------------------------------------

function initCells() {
    _state.cells = {};

    // Inicializa datas por elemento (noCampaignMode)
    for (const elemId of _state.selectedElementIds) {
        if (!_state.elementDates[elemId]) {
            _state.elementDates[elemId] = _state.campaignDate;
        }
    }

    // Inicializa unidades por parâmetro
    for (const paramId of _state.selectedParameterIds) {
        if (!_state.paramUnits[paramId]) {
            const paramDef = CONFIG.PARAMETERS.find((p) => p.id === paramId);
            _state.paramUnits[paramId] = paramDef?.defaultUnitId || null;
        }

        _state.cells[paramId] = {};
        for (const elemId of _state.selectedElementIds) {
            const element = getElementById(elemId);
            const existing = (element?.data?.observations || []).find(
                (o) => o.campaignId === _state.campaignId && o.parameterId === paramId,
            );
            _state.cells[paramId][elemId] = {
                value: existing?.value ?? null,
                dirty: false,
                error: null,
            };
        }
    }
}

function buildHistoricalCache(paramIds, elemIds) {
    const history = {};
    const campaigns = getAllCampaigns();
    const campaignNames = new Map(campaigns.map((c) => [c.id, c.name || c.id]));

    for (const paramId of paramIds) {
        history[paramId] = {};
        for (const elemId of elemIds) {
            const element = getElementById(elemId);
            const obs = (element?.data?.observations || [])
                .filter((o) => o.parameterId === paramId && o.value != null && o.campaignId !== _state.campaignId)
                .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                .slice(0, 2);

            history[paramId][elemId] = obs.map((o) => ({
                value: o.value,
                date: o.date,
                campaignName: campaignNames.get(o.campaignId) || '',
            }));
        }
    }
    return history;
}

// ----------------------------------------------------------------
// INTERNAL — Helpers
// ----------------------------------------------------------------

function hasDirtyCells() {
    if (!_state?.cells) return false;
    for (const paramId of Object.keys(_state.cells)) {
        for (const elemId of Object.keys(_state.cells[paramId])) {
            if (_state.cells[paramId][elemId].dirty) return true;
        }
    }
    return false;
}

function countErrors() {
    let n = 0;
    if (!_state?.cells) return n;
    for (const paramId of Object.keys(_state.cells)) {
        for (const elemId of Object.keys(_state.cells[paramId])) {
            if (_state.cells[paramId][elemId].error) n++;
        }
    }
    return n;
}

function countFilled() {
    let n = 0;
    if (!_state?.cells) return n;
    for (const paramId of Object.keys(_state.cells)) {
        for (const elemId of Object.keys(_state.cells[paramId])) {
            if (_state.cells[paramId][elemId].value != null) n++;
        }
    }
    return n;
}

function countExceeds() {
    let n = 0;
    if (!_state?.cells) return n;
    for (const paramId of Object.keys(_state.cells)) {
        for (const elemId of Object.keys(_state.cells[paramId])) {
            const cell = _state.cells[paramId][elemId];
            if (cell.value != null) {
                const thresholds = getThresholds(paramId);
                const vi = thresholds.find((t) => t.type === 'vi' || t.type === 'cma');
                if (vi && cell.value > vi.value) n++;
            }
        }
    }
    return n;
}

function getParamName(paramId) {
    const p = CONFIG.PARAMETERS.find((x) => x.id === paramId);
    if (!p) return paramId;
    const lang = document.documentElement.lang || 'en';
    return p.names?.[lang] || p.name || paramId;
}

function getUnitLabel(paramId) {
    const unitId = _state?.paramUnits?.[paramId];
    const p = CONFIG.PARAMETERS.find((x) => x.id === paramId);
    const effectiveId = unitId || p?.defaultUnitId;
    if (!effectiveId) return '';
    const u = CONFIG.UNITS.find((x) => x.id === effectiveId);
    return u?.symbol || u?.name || effectiveId;
}

function getCompatibleUnits(paramId) {
    const paramDef = CONFIG.PARAMETERS.find((p) => p.id === paramId);
    const defaultUnit = CONFIG.UNITS.find((u) => u.id === paramDef?.defaultUnitId);
    if (!defaultUnit?.dimension) return [defaultUnit].filter(Boolean);
    return CONFIG.UNITS.filter((u) => u.dimension === defaultUnit.dimension);
}

function getParamCategory(paramId) {
    const p = CONFIG.PARAMETERS.find((x) => x.id === paramId);
    return p?.category || 'other';
}

// ----------------------------------------------------------------
// RENDER — Main dispatch
// ----------------------------------------------------------------

function render() {
    const container = getContainer();
    if (!container || !_state) return;

    if (_state.step === 'setup') {
        renderSetup(container);
    } else {
        renderEntry(container);
    }

    hydrateIcons(container);
}

// ----------------------------------------------------------------
// RENDER — Step 1: Setup
// ----------------------------------------------------------------

function renderSetup(container) {
    const campaigns = getAllCampaigns();
    const elements = getAllElements();
    const families = [...new Set(elements.map((e) => e.family).filter(Boolean))];

    // Agrupa parâmetros por categoria
    const paramsByCategory = {};
    CONFIG.PARAMETERS.forEach((p) => {
        const cat = p.category || 'other';
        if (!paramsByCategory[cat]) paramsByCategory[cat] = [];
        paramsByCategory[cat].push(p);
    });

    container.innerHTML = `
        <div class="dem-wrapper">
            <!-- Steps indicator -->
            <div class="dem-steps">
                <div class="dem-step active">
                    <span class="dem-step-number">1</span>
                    <span>${t('matrixSetup') || 'Setup'}</span>
                </div>
                <span class="dem-step-arrow">&rarr;</span>
                <div class="dem-step">
                    <span class="dem-step-number">2</span>
                    <span>${t('matrixEntry') || 'Data Entry'}</span>
                </div>
            </div>

            <!-- Setup content -->
            <div class="dem-setup">
                <!-- Campaign -->
                <div class="dem-section">
                    <div class="dem-section-title">
                        <span data-icon="clipboard" data-icon-size="14px"></span>
                        ${t('selectCampaign') || 'Campaign'}
                    </div>
                    <div class="dem-campaign-row">
                        <div class="dem-form-group">
                            <label class="dem-form-label">${t('selectCampaign') || 'Existing Campaign'}</label>
                            <select class="dem-form-input" onchange="handleMatrixSetCampaign(this.value)">
                                <option value="">${t('createNewCampaign') || '-- New Campaign --'}</option>
                                <option value="__none__" ${_state.noCampaignMode ? 'selected' : ''}>${t('noCampaign') || '-- No Campaign --'}</option>
                                ${campaigns
                                    .map(
                                        (c) => `
                                    <option value="${c.id}" ${c.id === _state.campaignId ? 'selected' : ''}>
                                        ${escapeHtml(c.name || c.id)}
                                    </option>
                                `,
                                    )
                                    .join('')}
                            </select>
                        </div>
                        ${
                            !_state.campaignId && !_state.noCampaignMode
                                ? `
                        <div class="dem-form-group">
                            <label class="dem-form-label">${t('campaignName') || 'Campaign Name'}</label>
                            <input type="text" class="dem-form-input" placeholder="${t('campaignName') || 'Campaign name...'}"
                                   value="${escapeHtml(_state.newCampaignName)}"
                                   oninput="handleMatrixSetNewCampaignName(this.value)">
                        </div>
                        `
                                : ''
                        }
                        ${
                            _state.noCampaignMode
                                ? `
                        <div class="dem-form-group">
                            <label class="dem-form-label">${t('defaultDate') || 'Default Date'}</label>
                            <input type="date" class="dem-form-input"
                                   value="${_state.campaignDate}"
                                   onchange="handleMatrixSetCampaignDate(this.value)">
                        </div>
                        <div class="dem-hint">${t('datePerPoint') || 'Individual dates per point in Step 2'}</div>
                        `
                                : `
                        <div class="dem-form-group">
                            <label class="dem-form-label">${t('campaignDate') || 'Date'}</label>
                            <input type="date" class="dem-form-input"
                                   value="${_state.campaignDate}"
                                   onchange="handleMatrixSetCampaignDate(this.value)">
                        </div>
                        `
                        }
                        ${
                            _state.campaignId
                                ? `
                        <button class="dem-btn-sm" onclick="handleMatrixQuickFromPlan()" title="${t('quickFromPlan') || 'Auto-select from planned readings'}">
                            <span data-icon="zap" data-icon-size="12px"></span>
                            ${t('quickFromPlan') || 'Quick from Plan'}
                        </button>
                        `
                                : ''
                        }
                    </div>
                </div>

                <!-- Parameters -->
                <div class="dem-section">
                    <div class="dem-section-title">
                        <span data-icon="flask" data-icon-size="14px"></span>
                        ${t('selectParameters') || 'Parameters (rows)'}
                    </div>
                    <div class="dem-section-actions">
                        <input type="text" class="dem-form-input dem-search"
                               placeholder="${t('searchParameters') || 'Search parameters...'}"
                               value="${escapeHtml(_state.paramSearch)}"
                               oninput="handleMatrixParamSearch(this.value)">
                        <button class="dem-btn-sm" onclick="handleMatrixSelectAllParams()">${t('selectAll') || 'Select All'}</button>
                        <button class="dem-btn-sm" onclick="handleMatrixSelectNoneParams()">${t('selectNone') || 'None'}</button>
                    </div>
                    <div class="dem-check-grid" id="dem-param-grid">
                        ${renderParamCheckboxes(paramsByCategory)}
                    </div>
                </div>

                <!-- Elements -->
                <div class="dem-section">
                    <div class="dem-section-title">
                        <span data-icon="map-pin" data-icon-size="14px"></span>
                        ${t('selectElements') || 'Sampling Points (columns)'}
                    </div>
                    <div class="dem-section-actions">
                        <select class="dem-form-input" style="max-width:160px;" onchange="handleMatrixElementFilter(this.value)">
                            <option value="">${t('selectByFamily') || 'All families'}</option>
                            ${families
                                .map(
                                    (f) => `
                                <option value="${f}" ${f === _state.elementFamilyFilter ? 'selected' : ''}>
                                    ${escapeHtml(f)}
                                </option>
                            `,
                                )
                                .join('')}
                        </select>
                        <button class="dem-btn-sm" onclick="handleMatrixSelectAllElements()">${t('selectAll') || 'Select All'}</button>
                        <button class="dem-btn-sm" onclick="handleMatrixSelectNoneElements()">${t('selectNone') || 'None'}</button>
                    </div>
                    ${
                        elements.length === 0
                            ? `
                        <div class="dem-empty">
                            <div class="dem-empty-icon"><span data-icon="alert-triangle" data-icon-size="24px"></span></div>
                            <div class="dem-empty-text">${t('noElementsToShow') || 'Add sampling points first (Insert tab)'}</div>
                        </div>
                    `
                            : `
                    <div class="dem-check-grid" id="dem-elem-grid">
                        ${renderElementCheckboxes(elements)}
                    </div>
                    `
                    }
                </div>

                <!-- Mode -->
                <div class="dem-section">
                    <div class="dem-section-title">${t('dataEntryMode') || 'Mode'}</div>
                    <div class="dem-mode-toggle">
                        <button class="dem-mode-btn ${_state.mode === 'office' ? 'active' : ''}"
                                onclick="handleDataEntryModeChange('office')">
                            ${t('officeMode') || 'Office'}
                        </button>
                        <button class="dem-mode-btn ${_state.mode === 'field' ? 'active' : ''}"
                                onclick="handleDataEntryModeChange('field')">
                            ${t('fieldMode') || 'Field'}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="dem-footer">
                <span class="dem-stats">
                    ${_state.selectedParameterIds.length} ${t('selectParameters') || 'params'}
                    &times;
                    ${_state.selectedElementIds.length} ${t('selectElements') || 'points'}
                    = ${_state.selectedParameterIds.length * _state.selectedElementIds.length} ${t('cellsTotal') || 'cells'}
                </span>
                <span class="dem-footer-spacer"></span>
                <button class="dem-btn" onclick="handleCloseDataEntryMatrix()">
                    ${t('cancel') || 'Cancel'}
                </button>
                <button class="dem-btn dem-btn-primary" onclick="handleDataEntryNext()"
                        ${elements.length === 0 ? 'disabled' : ''}>
                    ${t('enterData') || 'Enter Data'} &rarr;
                </button>
            </div>
        </div>
    `;
}

function renderParamCheckboxes(paramsByCategory) {
    const search = (_state.paramSearch || '').toLowerCase();
    let html = '';

    for (const [category, params] of Object.entries(paramsByCategory)) {
        const filtered = params.filter((p) => {
            if (!search) return true;
            const name = (p.names?.en || p.name || p.id).toLowerCase();
            const namePt = (p.names?.pt || '').toLowerCase();
            return name.includes(search) || namePt.includes(search) || p.id.includes(search);
        });
        if (!filtered.length) continue;

        html += `<div class="dem-category-label">${escapeHtml(category)}</div>`;
        for (const p of filtered) {
            const checked = _state.selectedParameterIds.includes(p.id) ? 'checked' : '';
            const label = getParamName(p.id);
            html += `
                <label class="dem-check-item">
                    <input type="checkbox" ${checked}
                           onchange="handleMatrixToggleParam('${p.id}', this.checked)">
                    ${escapeHtml(label)}
                </label>
            `;
        }
    }

    return html || `<div class="dem-empty-text">${t('noResults') || 'No results'}</div>`;
}

function renderElementCheckboxes(allElements) {
    const filter = _state.elementFamilyFilter;
    const elements = filter ? allElements.filter((e) => e.family === filter) : allElements;

    return elements
        .map((e) => {
            const checked = _state.selectedElementIds.includes(e.id) ? 'checked' : '';
            return `
            <label class="dem-check-item">
                <input type="checkbox" ${checked}
                       onchange="handleMatrixToggleElement('${e.id}', this.checked)">
                ${escapeHtml(e.name || e.id)}
            </label>
        `;
        })
        .join('');
}

/**
 * Re-render only the checkbox areas (for search/filter without full re-render).
 */
function renderSetupCheckboxes() {
    const paramGrid = document.getElementById('dem-param-grid');
    if (paramGrid) {
        const paramsByCategory = {};
        CONFIG.PARAMETERS.forEach((p) => {
            const cat = p.category || 'other';
            if (!paramsByCategory[cat]) paramsByCategory[cat] = [];
            paramsByCategory[cat].push(p);
        });
        paramGrid.innerHTML = renderParamCheckboxes(paramsByCategory);
    }

    const elemGrid = document.getElementById('dem-elem-grid');
    if (elemGrid) {
        elemGrid.innerHTML = renderElementCheckboxes(getAllElements());
    }
}

// ----------------------------------------------------------------
// RENDER — Step 2: Entry
// ----------------------------------------------------------------

function renderEntry(container) {
    const campaign = getCampaignById(_state.campaignId);
    const campaignName = campaign?.name || _state.campaignId || '';
    const filled = countFilled();
    const total = _state.selectedParameterIds.length * _state.selectedElementIds.length;
    const exceeds = countExceeds();
    const isField = _state.mode === 'field';

    container.innerHTML = `
        <div class="dem-wrapper ${isField ? 'dem-mode-field' : ''}">
            <!-- Steps indicator -->
            <div class="dem-steps">
                <div class="dem-step">
                    <span class="dem-step-number">1</span>
                    <span>${t('matrixSetup') || 'Setup'}</span>
                </div>
                <span class="dem-step-arrow">&rarr;</span>
                <div class="dem-step active">
                    <span class="dem-step-number">2</span>
                    <span>${t('matrixEntry') || 'Data Entry'}</span>
                </div>
            </div>

            <!-- Toolbar -->
            <div class="dem-toolbar">
                ${
                    _state.noCampaignMode
                        ? `
                <span class="dem-toolbar-label">${t('noCampaign') || 'No Campaign'}:</span>
                <span class="dem-toolbar-value dem-hint-tag">${t('datePerPoint') || 'Date per point'}</span>
                <div class="dem-toolbar-sep"></div>
                `
                        : `
                <span class="dem-toolbar-label">${t('selectCampaign') || 'Campaign'}:</span>
                <span class="dem-toolbar-value">${escapeHtml(campaignName)}</span>
                <div class="dem-toolbar-sep"></div>
                <span class="dem-toolbar-label">${t('campaignDate') || 'Date'}:</span>
                <span class="dem-toolbar-value">${_state.campaignDate}</span>
                <div class="dem-toolbar-sep"></div>
                `
                }
                <div class="dem-mode-toggle">
                    <button class="dem-mode-btn ${!isField ? 'active' : ''}"
                            onclick="handleDataEntryModeChange('office')">
                        ${t('officeMode') || 'Office'}
                    </button>
                    <button class="dem-mode-btn ${isField ? 'active' : ''}"
                            onclick="handleDataEntryModeChange('field')">
                        ${t('fieldMode') || 'Field'}
                    </button>
                </div>
                <span class="dem-toolbar-spacer"></span>
                <span class="dem-stats">
                    <span class="dem-stats-count">${filled}</span>/${total} ${t('cellsFilled') || 'filled'}
                    ${exceeds > 0 ? `<span class="dem-stats-warn"> | ${exceeds} ${t('exceedsLimit') || 'exceed limits'}</span>` : ''}
                </span>
            </div>

            <!-- Quick-fill bar -->
            <div class="dem-quickfill">
                <button class="dem-btn-sm" onclick="handleDataEntryBack()">
                    &larr; ${t('matrixSetup') || 'Setup'}
                </button>
                <button class="dem-btn-sm" onclick="handleMatrixCopyLastCampaign()">
                    ${t('copyLastCampaign') || 'Copy Last Campaign'}
                </button>
                <button class="dem-btn-sm" onclick="handleMatrixClearAll()">
                    ${t('clearAllCells') || 'Clear All'}
                </button>
                <span class="dem-toolbar-spacer"></span>
                <button class="dem-btn-sm dem-btn-insights" onclick="handleMatrixOpenInsights()">
                    <span data-icon="bar-chart-2" data-icon-size="12px"></span>
                    ${t('insights') || 'Insights'}
                </button>
            </div>

            <!-- Office mode: matrix table -->
            <div class="dem-matrix-scroll">
                ${renderMatrixTable()}
            </div>

            <!-- Field mode: single element card -->
            <div class="dem-field-view">
                ${renderFieldMode()}
            </div>

            <!-- Footer -->
            <div class="dem-footer">
                <span class="dem-stats">
                    <span class="dem-stats-count">${filled}</span>/${total} ${t('cellsFilled') || 'filled'}
                </span>
                <span class="dem-footer-spacer"></span>
                <button class="dem-btn" onclick="handleCloseDataEntryMatrix()">
                    ${t('cancel') || 'Cancel'}
                </button>
                <button class="dem-btn dem-btn-success" onclick="handleMatrixSave()" ${filled === 0 ? 'disabled' : ''}>
                    ${t('saveAllObservations') || 'Save All'} (${filled})
                </button>
            </div>
        </div>
    `;

    // Focus first empty input
    setTimeout(() => {
        const firstEmpty = container.querySelector('.dem-input:not(.dirty), .dem-field-input:not(.dirty)');
        if (firstEmpty) firstEmpty.focus();
    }, 100);
}

// ----------------------------------------------------------------
// RENDER — Office mode table
// ----------------------------------------------------------------

function renderMatrixTable() {
    const elements = _state.selectedElementIds.map((id) => getElementById(id)).filter(Boolean);

    // Header row: param | unit | VO | element1 | element2 | ...
    let html = `<table class="dem-table" role="grid" aria-label="${t('dataEntryMatrix') || 'Data Entry Matrix'}"><thead><tr>`;
    html += `<th>${t('parameter') || 'Parameter'}</th>`;
    html += `<th>${t('unit') || 'Unit'}</th>`;
    html += `<th class="dem-th-vo">${t('referenceValue') || 'VO'}</th>`;
    for (const elem of elements) {
        html += `<th>
            ${escapeHtml(elem.name || elem.id)}
            ${
                _state.noCampaignMode
                    ? `
                <input type="date" class="dem-date-input"
                       value="${_state.elementDates[elem.id] || _state.campaignDate}"
                       onchange="handleMatrixElementDate('${elem.id}', this.value)">
            `
                    : ''
            }
        </th>`;
    }
    html += `</tr></thead><tbody>`;

    // Data rows: one per parameter
    for (const paramId of _state.selectedParameterIds) {
        const thresholds = getThresholds(paramId);
        const viEntry = thresholds.find((t) => t.type === 'vi' || t.type === 'cma');
        const voValue = viEntry?.value != null ? viEntry.value : '';
        const units = getCompatibleUnits(paramId);
        const currentUnitId = _state.paramUnits[paramId];

        html += `<tr>`;
        html += `<td class="dem-row-header">${escapeHtml(getParamName(paramId))}</td>`;

        // Seletor de unidade
        if (units.length > 1) {
            html += `<td class="dem-row-unit">
                <select class="dem-unit-select" onchange="handleMatrixUnitChange('${paramId}', this.value)">
                    ${units
                        .map(
                            (u) => `
                        <option value="${u.id}" ${u.id === currentUnitId ? 'selected' : ''}>
                            ${escapeHtml(u.symbol || u.name)}
                        </option>
                    `,
                        )
                        .join('')}
                </select>
            </td>`;
        } else {
            html += `<td class="dem-row-unit">${escapeHtml(getUnitLabel(paramId))}</td>`;
        }

        // Coluna VO (Valor Orientador / regulatory reference)
        html += `<td class="dem-row-vo">${voValue !== '' ? voValue : '-'}</td>`;

        for (const elem of elements) {
            const cell = _state.cells[paramId]?.[elem.id] || { value: null, dirty: false, error: null };
            const hist = _state.history[paramId]?.[elem.id] || [];

            // CSS classes
            let inputClass = 'dem-input';
            if (cell.dirty) inputClass += ' dirty';
            if (cell.error) inputClass += ' error';
            if (cell.value != null && viEntry && cell.value > viEntry.value) inputClass += ' exceeds';

            // Display value
            const displayValue = cell.value != null ? cell.value : '';

            // Historical text
            let histHtml = '';
            if (hist.length) {
                const parts = hist.map((h) => {
                    const shortDate = h.date ? h.date.slice(5) : '';
                    return `<span class="dem-history-value">${h.value}</span> ${shortDate}`;
                });
                histHtml = `<div class="dem-history">${parts.join(' | ')}</div>`;
            }

            // Limit badge
            let limitBadge = '';
            if (cell.value != null && viEntry) {
                if (cell.value > viEntry.value) {
                    limitBadge = `<span class="dem-limit-badge critical">!</span>`;
                }
            }

            html += `
                <td class="dem-cell">
                    <input type="text" class="${inputClass}" inputmode="decimal"
                           value="${displayValue}" ${limitBadge ? 'title="' + (t('exceedsLimit') || 'Exceeds limit') + '"' : ''}
                           aria-label="${getParamName(paramId)} - ${elem.name || elem.id}"
                           oninput="handleMatrixCellChange('${paramId}', '${elem.id}', this.value)"
                           onblur="handleMatrixCellBlur('${paramId}', '${elem.id}', this)"
                           onkeydown="handleMatrixCellNav(event, this)">
                    ${limitBadge}
                    ${histHtml}
                </td>
            `;
        }
        html += `</tr>`;
    }

    html += `</tbody></table>`;
    return html;
}

// ----------------------------------------------------------------
// RENDER — Field mode (single element card)
// ----------------------------------------------------------------

function renderFieldMode() {
    const elemId = _state.selectedElementIds[_state.fieldModeIndex];
    if (!elemId)
        return `<div class="dem-empty"><div class="dem-empty-text">${t('noElementsSelected') || 'No elements'}</div></div>`;

    const element = getElementById(elemId);
    if (!element) return '';

    const total = _state.selectedElementIds.length;
    const current = _state.fieldModeIndex + 1;

    let html = `
        <div class="dem-field-nav">
            <button class="dem-field-nav-btn" onclick="handleFieldModePrev()" ${total <= 1 ? 'disabled' : ''}>
                &larr;
            </button>
            <div>
                <div class="dem-field-element-name">${escapeHtml(element.name || element.id)}</div>
                <div class="dem-field-progress">${current} ${t('elementOf') || 'of'} ${total}</div>
            </div>
            <button class="dem-field-nav-btn" onclick="handleFieldModeNext()" ${total <= 1 ? 'disabled' : ''}>
                &rarr;
            </button>
        </div>
        ${
            _state.noCampaignMode
                ? `
        <div class="dem-field-date-row">
            <label class="dem-form-label">${t('collectionDate') || 'Collection Date'}</label>
            <input type="date" class="dem-field-date"
                   value="${_state.elementDates[elemId] || _state.campaignDate}"
                   onchange="handleMatrixElementDate('${elemId}', this.value)">
        </div>
        `
                : ''
        }
        <div class="dem-field-rows">
    `;

    for (const paramId of _state.selectedParameterIds) {
        const cell = _state.cells[paramId]?.[elemId] || { value: null, dirty: false, error: null };
        const hist = _state.history[paramId]?.[elemId] || [];
        const fieldThresholds = getThresholds(paramId);
        const fieldVi = fieldThresholds.find((t) => t.type === 'vi' || t.type === 'cma');
        const voValue = fieldVi?.value != null ? fieldVi.value : null;

        let inputClass = 'dem-field-input';
        if (cell.dirty) inputClass += ' dirty';
        if (cell.error) inputClass += ' error';
        if (cell.value != null && fieldVi && cell.value > fieldVi.value) inputClass += ' exceeds';

        const displayValue = cell.value != null ? cell.value : '';

        let histText = '';
        if (hist.length) {
            histText = hist
                .map((h) => {
                    const shortDate = h.date ? h.date.slice(5) : '';
                    return `${h.value} (${shortDate})`;
                })
                .join(', ');
        }

        html += `
            <div class="dem-field-row">
                <div class="dem-field-row-label">
                    <div class="dem-field-row-param">${escapeHtml(getParamName(paramId))}</div>
                    <div class="dem-field-row-unit">
                        ${escapeHtml(getUnitLabel(paramId))}
                        ${voValue != null ? `<span class="dem-field-vo">${t('referenceValue') || 'VO'}: ${voValue}</span>` : ''}
                    </div>
                    ${histText ? `<div class="dem-field-row-history">${t('previous') || 'Prev'}: ${escapeHtml(histText)}</div>` : ''}
                </div>
                <input type="text" class="${inputClass}" inputmode="decimal"
                       value="${displayValue}"
                       oninput="handleMatrixCellChange('${paramId}', '${elemId}', this.value)"
                       onblur="handleMatrixCellBlur('${paramId}', '${elemId}', this)">
            </div>
        `;
    }

    html += `</div>`;
    return html;
}
