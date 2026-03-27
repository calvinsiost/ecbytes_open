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
   GERENCIADOR DE CAMPOS E UNIDADES
   ================================================================

   Modal para gerenciar parâmetros e unidades customizados.
   Permite criar, editar e excluir campos.

   ================================================================ */

import { t } from '../i18n/translations.js';
import { CONFIG } from '../../config.js';
import { showToast } from './toast.js';
import { getParamDisplayName } from '../../core/sao/paramNames.js';
import { hydrateIcons } from './icons.js';
import { escapeHtml } from '../helpers/html.js';
import { asyncConfirm } from './asyncDialogs.js';
import { safeSetItem } from '../storage/storageMonitor.js';

// Armazena campos customizados do usuário (persistidos via localStorage)
let userParameters = [];
let userUnits = [];

const STORAGE_KEY_PARAMS = 'ecbyts_custom_parameters';
const STORAGE_KEY_UNITS = 'ecbyts_custom_units';

// ----------------------------------------------------------------
// INICIALIZAÇÃO
// ----------------------------------------------------------------

/**
 * Carrega dados customizados do localStorage.
 */
export function initFieldManager() {
    try {
        const savedParams = localStorage.getItem(STORAGE_KEY_PARAMS);
        if (savedParams) {
            userParameters = JSON.parse(savedParams);
            // Adiciona ao CONFIG
            userParameters.forEach((p) => {
                if (!CONFIG.PARAMETERS.find((cp) => cp.id === p.id)) {
                    CONFIG.PARAMETERS.push(p);
                }
            });
        }

        const savedUnits = localStorage.getItem(STORAGE_KEY_UNITS);
        if (savedUnits) {
            userUnits = JSON.parse(savedUnits);
            // Adiciona ao CONFIG
            userUnits.forEach((u) => {
                if (!CONFIG.UNITS.find((cu) => cu.id === u.id)) {
                    CONFIG.UNITS.push(u);
                }
            });
        }
    } catch (e) {
        console.warn('Erro ao carregar campos customizados:', e);
    }
}

/**
 * Salva dados customizados no localStorage.
 */
function saveCustomData() {
    safeSetItem(STORAGE_KEY_PARAMS, JSON.stringify(userParameters));
    safeSetItem(STORAGE_KEY_UNITS, JSON.stringify(userUnits));
}

// ----------------------------------------------------------------
// MODAL DE GERENCIAMENTO
// ----------------------------------------------------------------

/**
 * Abre o modal de gerenciamento de campos.
 */
export function openFieldManagerModal() {
    let modal = document.getElementById('field-manager-modal');

    if (!modal) {
        modal = createFieldManagerModal();
        document.body.appendChild(modal);
    }

    modal.classList.add('active');
    renderFieldManagerContent('parameters');
}

/**
 * Fecha o modal de gerenciamento.
 */
export function closeFieldManagerModal() {
    const modal = document.getElementById('field-manager-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

/**
 * Cria a estrutura do modal.
 */
function createFieldManagerModal() {
    const modal = document.createElement('div');
    modal.id = 'field-manager-modal';
    modal.className = 'modal-overlay';

    modal.innerHTML = `
        <div class="modal field-manager-modal">
            <div class="modal-header">
                <h2 class="modal-title">${t('manageFields')}</h2>
                <button class="modal-close" onclick="window.closeFieldManagerModal()" aria-label="Close"><span data-icon="x" data-icon-size="14px"></span></button>
            </div>
            <div class="field-manager-tabs">
                <button class="field-tab active" data-tab="parameters" onclick="window.switchFieldTab('parameters')">
                    ${t('parameters')}
                </button>
                <button class="field-tab" data-tab="units" onclick="window.switchFieldTab('units')">
                    ${t('units')}
                </button>
            </div>
            <div class="modal-body field-manager-body" id="field-manager-content">
                <!-- Conteúdo dinâmico -->
            </div>
        </div>
    `;

    hydrateIcons(modal);

    // Fecha ao clicar fora
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeFieldManagerModal();
        }
    });

    return modal;
}

/**
 * Alterna entre abas do modal.
 */
export function switchFieldTab(tabName) {
    const tabs = document.querySelectorAll('.field-tab');
    tabs.forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    renderFieldManagerContent(tabName);
}

/**
 * Renderiza o conteúdo do modal baseado na aba.
 */
function renderFieldManagerContent(tabName) {
    const container = document.getElementById('field-manager-content');
    if (!container) return;

    if (tabName === 'parameters') {
        renderParametersTab(container);
    } else {
        renderUnitsTab(container);
    }
}

// ----------------------------------------------------------------
// ABA DE PARÂMETROS
// ----------------------------------------------------------------

function renderParametersTab(container) {
    const categories = {
        chemical: t('categoryChemical'),
        physical: t('categoryPhysical'),
        contaminant: t('categoryContaminant'),
        hydrogeology: t('categoryHydrogeology'),
        emission: t('categoryEmission'),
        air_quality: t('categoryAirQuality'),
        waste: t('categoryWaste'),
        effluent: t('categoryEffluent'),
        safety: t('categorySafety'),
        biodiversity: t('categoryBiodiversity'),
        custom: t('categoryCustom'),
    };

    // Agrupa por categoria
    const grouped = {};
    CONFIG.PARAMETERS.forEach((p) => {
        const cat = p.category || 'custom';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(p);
    });

    container.innerHTML = `
        <div class="field-manager-actions">
            <button class="btn btn-primary" onclick="window.openAddParameterForm()">
                + ${t('addParameter')}
            </button>
        </div>
        <div class="field-list" id="parameters-list">
            ${Object.entries(grouped)
                .map(
                    ([cat, params]) => `
                <div class="field-category">
                    <div class="field-category-header">${categories[cat] || cat}</div>
                    ${params.map((p) => renderParameterItem(p)).join('')}
                </div>
            `,
                )
                .join('')}
        </div>
        <div id="parameter-form-container"></div>
    `;
}

function renderParameterItem(param) {
    const unit = CONFIG.UNITS.find((u) => u.id === param.defaultUnitId);
    const isCustom = param.type === 'custom';
    const isUserCustom = userParameters.find((p) => p.id === param.id);

    return `
        <div class="field-item ${isCustom ? 'field-item-custom' : ''}">
            <div class="field-item-info">
                <span class="field-item-name">${escapeHtml(getParamDisplayName(param))}</span>
                <span class="field-item-meta">
                    ${unit ? unit.symbol : '-'}
                    ${isCustom ? `<span class="badge badge-custom">${t('custom')}</span>` : `<span class="badge badge-si">SI</span>`}
                </span>
            </div>
            <div class="field-item-actions">
                ${
                    isUserCustom
                        ? `
                    <button class="btn-icon" onclick="window.editParameter('${param.id}')" title="${t('edit')}"><span data-icon="edit"></span></button>
                    <button class="btn-icon btn-danger" onclick="window.deleteParameter('${param.id}')" title="${t('delete')}"><span data-icon="trash"></span></button>
                `
                        : ''
                }
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// ABA DE UNIDADES
// ----------------------------------------------------------------

function renderUnitsTab(container) {
    const dimensions = {};
    CONFIG.UNITS.forEach((u) => {
        const dim = u.dimension || 'other';
        if (!dimensions[dim]) dimensions[dim] = [];
        dimensions[dim].push(u);
    });

    const dimensionNames = {
        concentration: t('dimConcentration'),
        mass_concentration: t('dimMassConcentration'),
        ratio_ppm: t('dimRatioPpm'),
        length: t('dimLength'),
        temperature: t('dimTemperature'),
        ratio: t('dimRatio'),
        pH: 'pH',
        conductivity: t('dimConductivity'),
        potential: t('dimPotential'),
        flow: t('dimFlow'),
        none: t('dimNone'),
        other: t('dimOther'),
        mass: t('dimMass'),
        volume: t('dimVolume'),
        air_concentration: t('dimAirConcentration'),
        air_concentration_norm: t('dimAirConcentrationNorm'),
        emission: t('dimEmission'),
        intensity_emission: t('dimIntensityEmission'),
        intensity_water: t('dimIntensityWater'),
        area: t('dimArea'),
        rate_hs: t('dimRateHS'),
        severity: t('dimSeverity'),
        energy: t('dimEnergy'),
        noise: t('dimNoise'),
        count: t('dimCount'),
        score: t('dimScore'),
    };

    container.innerHTML = `
        <div class="field-manager-actions">
            <button class="btn btn-primary" onclick="window.openAddUnitForm()">
                + ${t('addUnit')}
            </button>
        </div>
        <div class="field-list" id="units-list">
            ${Object.entries(dimensions)
                .map(
                    ([dim, units]) => `
                <div class="field-category">
                    <div class="field-category-header">${dimensionNames[dim] || dim}</div>
                    ${units.map((u) => renderUnitItem(u)).join('')}
                </div>
            `,
                )
                .join('')}
        </div>
        <div id="unit-form-container"></div>
    `;
}

function renderUnitItem(unit) {
    const isCustom = unit.type === 'custom';
    const isUserCustom = userUnits.find((u) => u.id === unit.id);
    const isBase = unit.isBase;

    return `
        <div class="field-item ${isCustom ? 'field-item-custom' : ''}">
            <div class="field-item-info">
                <span class="field-item-symbol">${escapeHtml(unit.symbol)}</span>
                <span class="field-item-name">${escapeHtml(unit.name)}</span>
                <span class="field-item-meta">
                    ${isBase ? `<span class="badge badge-base">${t('baseUnit')}</span>` : ''}
                    ${isCustom ? `<span class="badge badge-custom">${t('custom')}</span>` : `<span class="badge badge-si">SI</span>`}
                </span>
            </div>
            <div class="field-item-actions">
                ${
                    isUserCustom
                        ? `
                    <button class="btn-icon" onclick="window.editUnit('${unit.id}')" title="${t('edit')}"><span data-icon="edit"></span></button>
                    <button class="btn-icon btn-danger" onclick="window.deleteUnit('${unit.id}')" title="${t('delete')}"><span data-icon="trash"></span></button>
                `
                        : ''
                }
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// FORMULÁRIOS
// ----------------------------------------------------------------

export function openAddParameterForm(editId = null) {
    const container = document.getElementById('parameter-form-container');
    if (!container) return;

    const existing = editId ? CONFIG.PARAMETERS.find((p) => p.id === editId) : null;

    container.innerHTML = `
        <div class="field-form">
            <h3>${editId ? t('editParameter') : t('addParameter')}</h3>
            <div class="form-group">
                <label class="form-label">${t('parameterName')}</label>
                <input class="form-input" type="text" id="new-param-name"
                       value="${existing ? escapeHtml(existing.name) : ''}"
                       placeholder="${t('parameterNamePlaceholder')}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('defaultUnit')}</label>
                <select class="form-input" id="new-param-unit">
                    ${CONFIG.UNITS.map(
                        (u) => `
                        <option value="${u.id}" ${existing?.defaultUnitId === u.id ? 'selected' : ''}>
                            ${escapeHtml(u.symbol)} - ${escapeHtml(u.name)}
                        </option>
                    `,
                    ).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t('category')}</label>
                <select class="form-input" id="new-param-category">
                    <option value="chemical" ${existing?.category === 'chemical' ? 'selected' : ''}>${t('categoryChemical')}</option>
                    <option value="physical" ${existing?.category === 'physical' ? 'selected' : ''}>${t('categoryPhysical')}</option>
                    <option value="contaminant" ${existing?.category === 'contaminant' ? 'selected' : ''}>${t('categoryContaminant')}</option>
                    <option value="hydrogeology" ${existing?.category === 'hydrogeology' ? 'selected' : ''}>${t('categoryHydrogeology')}</option>
                    <option value="emission" ${existing?.category === 'emission' ? 'selected' : ''}>${t('categoryEmission')}</option>
                    <option value="air_quality" ${existing?.category === 'air_quality' ? 'selected' : ''}>${t('categoryAirQuality')}</option>
                    <option value="waste" ${existing?.category === 'waste' ? 'selected' : ''}>${t('categoryWaste')}</option>
                    <option value="effluent" ${existing?.category === 'effluent' ? 'selected' : ''}>${t('categoryEffluent')}</option>
                    <option value="safety" ${existing?.category === 'safety' ? 'selected' : ''}>${t('categorySafety')}</option>
                    <option value="biodiversity" ${existing?.category === 'biodiversity' ? 'selected' : ''}>${t('categoryBiodiversity')}</option>
                    <option value="custom" ${existing?.category === 'custom' || !existing ? 'selected' : ''}>${t('categoryCustom')}</option>
                </select>
            </div>
            <div class="form-actions">
                <button class="btn btn-secondary" onclick="window.closeParameterForm()">${t('cancel')}</button>
                <button class="btn btn-primary" onclick="window.saveParameter('${editId || ''}')">${t('save')}</button>
            </div>
        </div>
    `;
}

export function closeParameterForm() {
    const container = document.getElementById('parameter-form-container');
    if (container) container.innerHTML = '';
}

export function saveParameter(editId) {
    const name = document.getElementById('new-param-name')?.value?.trim();
    const unitId = document.getElementById('new-param-unit')?.value;
    const category = document.getElementById('new-param-category')?.value;

    if (!name) {
        showToast(t('enterParameterName'), 'error');
        return;
    }

    const id = editId || name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now();

    // Verifica duplicata (apenas para novos)
    if (!editId && CONFIG.PARAMETERS.find((p) => p.id === id || p.name.toLowerCase() === name.toLowerCase())) {
        showToast(t('parameterExists'), 'error');
        return;
    }

    const param = {
        id,
        name,
        defaultUnitId: unitId || 'none',
        type: 'custom',
        category: category || 'custom',
        allowedCustomFields: [],
    };

    if (editId) {
        // Atualiza existente
        const idx = CONFIG.PARAMETERS.findIndex((p) => p.id === editId);
        if (idx >= 0) CONFIG.PARAMETERS[idx] = { ...CONFIG.PARAMETERS[idx], ...param, id: editId };
        const userIdx = userParameters.findIndex((p) => p.id === editId);
        if (userIdx >= 0) userParameters[userIdx] = { ...userParameters[userIdx], ...param, id: editId };
    } else {
        // Adiciona novo
        CONFIG.PARAMETERS.push(param);
        userParameters.push(param);
    }

    saveCustomData();
    closeParameterForm();
    renderFieldManagerContent('parameters');
    showToast(editId ? t('parameterUpdated') : t('parameterAdded'), 'success');

    // Dispara evento para atualizar UI
    window.dispatchEvent(new CustomEvent('fieldsChanged'));
}

export function editParameter(id) {
    openAddParameterForm(id);
}

export async function deleteParameter(id) {
    if (!(await asyncConfirm(t('confirmDeleteParameter')))) return;

    const idx = CONFIG.PARAMETERS.findIndex((p) => p.id === id);
    if (idx >= 0) CONFIG.PARAMETERS.splice(idx, 1);

    const userIdx = userParameters.findIndex((p) => p.id === id);
    if (userIdx >= 0) userParameters.splice(userIdx, 1);

    saveCustomData();
    renderFieldManagerContent('parameters');
    showToast(t('parameterDeleted'), 'success');

    window.dispatchEvent(new CustomEvent('fieldsChanged'));
}

// ----------------------------------------------------------------
// FORMULÁRIO DE UNIDADES
// ----------------------------------------------------------------

export function openAddUnitForm(editId = null) {
    const container = document.getElementById('unit-form-container');
    if (!container) return;

    const existing = editId ? CONFIG.UNITS.find((u) => u.id === editId) : null;

    const dimensions = [
        { id: 'concentration', name: t('dimConcentration') },
        { id: 'mass_concentration', name: t('dimMassConcentration') },
        { id: 'ratio_ppm', name: t('dimRatioPpm') },
        { id: 'length', name: t('dimLength') },
        { id: 'temperature', name: t('dimTemperature') },
        { id: 'ratio', name: t('dimRatio') },
        { id: 'pH', name: 'pH' },
        { id: 'conductivity', name: t('dimConductivity') },
        { id: 'potential', name: t('dimPotential') },
        { id: 'flow', name: t('dimFlow') },
        { id: 'mass', name: t('dimMass') },
        { id: 'volume', name: t('dimVolume') },
        { id: 'air_concentration', name: t('dimAirConcentration') },
        { id: 'air_concentration_norm', name: t('dimAirConcentrationNorm') },
        { id: 'emission', name: t('dimEmission') },
        { id: 'intensity_emission', name: t('dimIntensityEmission') },
        { id: 'intensity_water', name: t('dimIntensityWater') },
        { id: 'area', name: t('dimArea') },
        { id: 'rate_hs', name: t('dimRateHS') },
        { id: 'severity', name: t('dimSeverity') },
        { id: 'energy', name: t('dimEnergy') },
        { id: 'noise', name: t('dimNoise') },
        { id: 'count', name: t('dimCount') },
        { id: 'score', name: t('dimScore') },
        { id: 'none', name: t('dimNone') },
    ];

    container.innerHTML = `
        <div class="field-form">
            <h3>${editId ? t('editUnit') : t('addUnit')}</h3>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${t('unitSymbol')}</label>
                    <input class="form-input" type="text" id="new-unit-symbol"
                           value="${existing ? escapeHtml(existing.symbol) : ''}"
                           placeholder="mg/L">
                </div>
                <div class="form-group">
                    <label class="form-label">${t('unitName')}</label>
                    <input class="form-input" type="text" id="new-unit-name"
                           value="${existing ? escapeHtml(existing.name) : ''}"
                           placeholder="${t('unitNamePlaceholder')}">
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">${t('dimension')}</label>
                <select class="form-input" id="new-unit-dimension">
                    ${dimensions
                        .map(
                            (d) => `
                        <option value="${d.id}" ${existing?.dimension === d.id ? 'selected' : ''}>
                            ${escapeHtml(d.name)}
                        </option>
                    `,
                        )
                        .join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t('conversionFactor')}</label>
                <input class="form-input" type="number" step="any" id="new-unit-tobase"
                       value="${existing?.toBase ?? 1}"
                       placeholder="1">
                <small class="form-hint">${t('conversionFactorHint')}</small>
            </div>
            <div class="form-actions">
                <button class="btn btn-secondary" onclick="window.closeUnitForm()">${t('cancel')}</button>
                <button class="btn btn-primary" onclick="window.saveUnit('${editId || ''}')">${t('save')}</button>
            </div>
        </div>
    `;
}

export function closeUnitForm() {
    const container = document.getElementById('unit-form-container');
    if (container) container.innerHTML = '';
}

export function saveUnit(editId) {
    const symbol = document.getElementById('new-unit-symbol')?.value?.trim();
    const name = document.getElementById('new-unit-name')?.value?.trim();
    const dimension = document.getElementById('new-unit-dimension')?.value;
    const toBase = parseFloat(document.getElementById('new-unit-tobase')?.value) || 1;

    if (!symbol || !name) {
        showToast(t('enterUnitDetails'), 'error');
        return;
    }

    const id = editId || symbol.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now();

    // Verifica duplicata
    if (!editId && CONFIG.UNITS.find((u) => u.id === id || u.symbol === symbol)) {
        showToast(t('unitExists'), 'error');
        return;
    }

    const unit = {
        id,
        symbol,
        name,
        type: 'custom',
        dimension: dimension || 'none',
        toBase,
    };

    if (editId) {
        const idx = CONFIG.UNITS.findIndex((u) => u.id === editId);
        if (idx >= 0) CONFIG.UNITS[idx] = { ...CONFIG.UNITS[idx], ...unit, id: editId };
        const userIdx = userUnits.findIndex((u) => u.id === editId);
        if (userIdx >= 0) userUnits[userIdx] = { ...userUnits[userIdx], ...unit, id: editId };
    } else {
        CONFIG.UNITS.push(unit);
        userUnits.push(unit);
    }

    saveCustomData();
    closeUnitForm();
    renderFieldManagerContent('units');
    showToast(editId ? t('unitUpdated') : t('unitAdded'), 'success');

    window.dispatchEvent(new CustomEvent('fieldsChanged'));
}

export function editUnit(id) {
    openAddUnitForm(id);
}

export async function deleteUnit(id) {
    if (!(await asyncConfirm(t('confirmDeleteUnit')))) return;

    const idx = CONFIG.UNITS.findIndex((u) => u.id === id);
    if (idx >= 0) CONFIG.UNITS.splice(idx, 1);

    const userIdx = userUnits.findIndex((u) => u.id === id);
    if (userIdx >= 0) userUnits.splice(userIdx, 1);

    saveCustomData();
    renderFieldManagerContent('units');
    showToast(t('unitDeleted'), 'success');

    window.dispatchEvent(new CustomEvent('fieldsChanged'));
}

// ----------------------------------------------------------------
// EXPOSIÇÃO GLOBAL
// ----------------------------------------------------------------

window.openFieldManagerModal = openFieldManagerModal;
window.closeFieldManagerModal = closeFieldManagerModal;
window.switchFieldTab = switchFieldTab;
window.openAddParameterForm = openAddParameterForm;
window.closeParameterForm = closeParameterForm;
window.saveParameter = saveParameter;
window.editParameter = editParameter;
window.deleteParameter = deleteParameter;
window.openAddUnitForm = openAddUnitForm;
window.closeUnitForm = closeUnitForm;
window.saveUnit = saveUnit;
window.editUnit = editUnit;
window.deleteUnit = deleteUnit;
