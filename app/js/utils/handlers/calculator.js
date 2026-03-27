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
   CALCULATOR HANDLERS — Modal UI + filter builder
   Handlers para o modulo de calculadora: metricas, regras, ratios

   Padrao: exporta calculatorHandlers + setCalculatorUpdateAllUI
   ================================================================ */

import {
    getCalculatorItems,
    getCalculatorItemById,
    addCalculatorItem,
    updateCalculatorItem,
    removeCalculatorItem,
    duplicateCalculatorItem,
    reorderCalculatorItem,
    addCalculatorFilter,
    removeCalculatorFilter,
    updateCalculatorFilter,
    computeAllCalculator,
    clearCalculator,
} from '../../core/calculator/manager.js';
import { getUserConstants } from '../../core/constants/manager.js';
import { CONFIG } from '../../config.js';
import { getAllElements } from '../../core/elements/manager.js';
import { getAllFamilies } from '../../core/elements/families.js';
import { getAllCampaigns } from '../../core/campaigns/manager.js';
import { escapeHtml } from '../helpers/html.js';
import { getIcon } from '../ui/icons.js';
import { t } from '../i18n/translations.js';
import { showToast } from '../ui/toast.js';

let _updateAllUI = null;

export function setCalculatorUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ----------------------------------------------------------------
// MODAL OPEN/CLOSE
// ----------------------------------------------------------------

function handleOpenCalculator() {
    const modal = document.getElementById('calculator-modal');
    if (!modal) return;
    modal.classList.add('visible');
    _renderCalculatorModal();
}

function handleCloseCalculator() {
    const modal = document.getElementById('calculator-modal');
    if (modal) modal.classList.remove('visible');
}

// ----------------------------------------------------------------
// ITEM CRUD
// ----------------------------------------------------------------

function handleAddCalculatorMetric() {
    addCalculatorItem({ type: 'metric', label: t('calculatorNewMetric') || 'New Metric ' });
    _renderCalculatorModal();
    _fireChanged();
}

function handleAddCalculatorRule() {
    addCalculatorItem({
        type: 'rule',
        label: t('calculatorNewRule') || 'New Rule ',
        conditions: { logic: 'AND', conditions: [] },
    });
    _renderCalculatorModal();
    _fireChanged();
}

function handleAddCalculatorRatio() {
    addCalculatorItem({
        type: 'ratio',
        label: t('calculatorNewRatio') || 'New Ratio ',
        ratio: { numeratorParameterId: '', denominatorParameterId: '', operator: 'gt', threshold: 1 },
    });
    _renderCalculatorModal();
    _fireChanged();
}

function handleRemoveCalculatorItem(id) {
    removeCalculatorItem(id);
    _renderCalculatorModal();
    _fireChanged();
}

function handleDuplicateCalculatorItem(id) {
    duplicateCalculatorItem(id);
    _renderCalculatorModal();
    _fireChanged();
}

function handleReorderCalculatorItem(id, direction) {
    reorderCalculatorItem(id, direction);
    _renderCalculatorModal();
    _fireChanged();
}

function handleToggleCalculatorItem(id) {
    const item = getCalculatorItemById(id);
    if (item) {
        updateCalculatorItem(id, { enabled: !item.enabled });
        _renderCalculatorModal();
        _fireChanged();
    }
}

function handleUpdateCalculatorField(id, field, value) {
    updateCalculatorItem(id, { [field]: value });
    _renderCalculatorModal();
    _fireChanged();
}

// ----------------------------------------------------------------
// FILTER CRUD
// ----------------------------------------------------------------

function handleAddCalculatorFilter(itemId) {
    addCalculatorFilter(itemId);
    _renderCalculatorModal();
    _fireChanged();
}

function handleRemoveCalculatorFilter(itemId, filterIndex) {
    removeCalculatorFilter(itemId, filterIndex);
    _renderCalculatorModal();
    _fireChanged();
}

function handleUpdateCalculatorFilter(itemId, filterIndex, field, value) {
    updateCalculatorFilter(itemId, filterIndex, field, value);
    _renderCalculatorModal();
    _fireChanged();
}

// ----------------------------------------------------------------
// CONDITION CRUD (for compound rules)
// ----------------------------------------------------------------

function handleAddCalculatorCondition(itemId) {
    const item = getCalculatorItemById(itemId);
    if (!item || item.type !== 'rule') return;
    const conditions = item.conditions || { logic: 'AND', conditions: [] };
    conditions.conditions.push({
        parameterId: '',
        operator: 'gt',
        threshold: 0,
        thresholdUnit: '',
    });
    updateCalculatorItem(itemId, { conditions });
    _renderCalculatorModal();
    _fireChanged();
}

function handleRemoveCalculatorCondition(itemId, condIndex) {
    const item = getCalculatorItemById(itemId);
    if (!item || !item.conditions) return;
    item.conditions.conditions.splice(condIndex, 1);
    updateCalculatorItem(itemId, { conditions: item.conditions });
    _renderCalculatorModal();
    _fireChanged();
}

function handleUpdateCalculatorCondition(itemId, condIndex, field, value) {
    const item = getCalculatorItemById(itemId);
    if (!item || !item.conditions?.conditions?.[condIndex]) return;
    item.conditions.conditions[condIndex][field] = field === 'threshold' ? parseFloat(value) || 0 : value;
    updateCalculatorItem(itemId, { conditions: item.conditions });
    _renderCalculatorModal();
    _fireChanged();
}

function handleUpdateCalculatorLogic(itemId, logic) {
    const item = getCalculatorItemById(itemId);
    if (!item || !item.conditions) return;
    item.conditions.logic = logic;
    updateCalculatorItem(itemId, { conditions: item.conditions });
    _renderCalculatorModal();
    _fireChanged();
}

// ----------------------------------------------------------------
// RATIO FIELDS
// ----------------------------------------------------------------

function handleUpdateCalculatorRatio(itemId, field, value) {
    const item = getCalculatorItemById(itemId);
    if (!item || !item.ratio) return;
    item.ratio[field] = field === 'threshold' ? parseFloat(value) || 0 : value;
    updateCalculatorItem(itemId, { ratio: item.ratio });
    _renderCalculatorModal();
    _fireChanged();
}

// ----------------------------------------------------------------
// PUSH TO TICKER
// ----------------------------------------------------------------

function handlePushCalculatorToTicker(id) {
    const item = getCalculatorItemById(id);
    if (!item) return;
    // Usa ticker manager para criar item equivalente
    import('../ticker/manager.js').then(({ addTickerItem }) => {
        addTickerItem({
            label: item.label,
            suffix: item.suffix,
            filters: item.filters.map((f) => ({ ...f })),
            calculation: item.calculation || 'count',
            unitId: item.unitId,
            precision: item.precision,
            color: item.color,
            enabled: true,
        });
        window.dispatchEvent(new CustomEvent('tickerChanged'));
        showToast(t('calculatorPushedToTicker') || 'Pushed to ticker', 'success');
    });
}

// ----------------------------------------------------------------
// MODAL RENDERING
// ----------------------------------------------------------------

function _renderCalculatorModal() {
    const body = document.getElementById('calculator-modal-body');
    if (!body) return;

    const items = getCalculatorItems();
    const results = computeAllCalculator();

    if (items.length === 0) {
        body.innerHTML = `<div class="calculator-empty">
            <p>${t('calculatorEmpty') || 'No metrics configured. Add a metric, rule, or ratio.'}</p>
        </div>`;
        return;
    }

    body.innerHTML = items
        .map((item, idx) => {
            const result = results.find((r) => r.id === item.id);
            const typeIcon = item.type === 'rule' ? 'shield' : item.type === 'ratio' ? 'percent' : 'activity';
            const typeLabel = item.type === 'rule' ? 'Rule' : item.type === 'ratio' ? 'Ratio' : 'Metric';

            const isReadonly = item.readonly === true;
            const readonlyBadge = isReadonly ? '<span class="calculator-template-badge">TEMPLATE</span>' : '';
            const labelInput = isReadonly
                ? `<span class="calculator-label-readonly">${escapeHtml(item.label || '')}</span>`
                : `<input type="text" class="calculator-label-input" value="${escapeHtml(item.label || '')}"
                    onchange="window.handleUpdateCalculatorField('${item.id}','label',this.value)"
                    placeholder="${t('calculatorLabelPlaceholder') || 'Label...'}">`;

            return `<div class="calculator-item ${item.enabled ? '' : 'calculator-item-disabled'} ${isReadonly ? 'calculator-item-template' : ''}" data-id="${item.id}">
            <div class="calculator-item-header">
                <span class="calculator-type-badge calculator-type-${item.type}">${getIcon(typeIcon, 12)} ${typeLabel}</span>
                ${readonlyBadge}
                ${labelInput}
                <span class="calculator-result" style="color:${item.color || 'var(--primary-text)'}">
                    ${result ? escapeHtml(result.text) : '—'}
                    ${result?.postProcessingNote ? `<span class="calculator-pp-badge" title="${t('postProcessing') || 'Post-processing'}: ${escapeHtml(result.postProcessingNote)}">${escapeHtml(result.postProcessingNote)}</span>` : ''}
                </span>
                <div class="calculator-actions">
                    ${isReadonly ? '' : `<button onclick="window.handleToggleCalculatorItem('${item.id}')" title="Toggle">${getIcon(item.enabled ? 'eye' : 'eye-off', 14)}</button>`}
                    <button onclick="window.handleDuplicateCalculatorItem('${item.id}')" title="${isReadonly ? 'Use as template' : 'Duplicate'}">${getIcon('copy', 14)}</button>
                    ${isReadonly ? '' : `<button onclick="window.handlePushCalculatorToTicker('${item.id}')" title="Push to Ticker">${getIcon('bar-chart-2', 14)}</button>`}
                    ${isReadonly ? '' : `<button onclick="window.handleReorderCalculatorItem('${item.id}','up')" title="Up">${getIcon('chevron-up', 14)}</button>`}
                    ${isReadonly ? '' : `<button onclick="window.handleReorderCalculatorItem('${item.id}','down')" title="Down">${getIcon('chevron-down', 14)}</button>`}
                    <button onclick="window.handleRemoveCalculatorItem('${item.id}')" title="${isReadonly ? 'Remove template' : 'Remove'}" class="btn-danger">${getIcon('trash-2', 14)}</button>
                </div>
            </div>
            <div class="calculator-item-body">
                ${_renderFilters(item)}
                ${item.type === 'metric' ? _renderMetricConfig(item) : ''}
                ${item.type === 'rule' ? _renderRuleConfig(item) : ''}
                ${item.type === 'ratio' ? _renderRatioConfig(item) : ''}
            </div>
        </div>`;
        })
        .join('');
}

// ----------------------------------------------------------------
// FILTER RENDERING
// ----------------------------------------------------------------

function _renderFilters(item) {
    const dims = [
        { id: 'parameter', label: 'Parameter' },
        { id: 'family', label: 'Family' },
        { id: 'element', label: 'Element' },
        { id: 'area', label: 'Area' },
        { id: 'campaign', label: 'Campaign' },
        { id: 'category', label: 'Category' },
        { id: 'variable', label: 'Variable' },
    ];
    const operators = [
        { id: 'is', label: 'is' },
        { id: 'is_not', label: 'is not' },
        { id: 'in', label: 'in' },
        { id: 'not_in', label: 'not in' },
    ];

    const filtersHtml = (item.filters || [])
        .map((f, fi) => {
            const dimOpts = dims
                .map((d) => `<option value="${d.id}" ${f.dimension === d.id ? 'selected' : ''}>${d.label}</option>`)
                .join('');
            const opOpts = operators
                .map((o) => `<option value="${o.id}" ${f.operator === o.id ? 'selected' : ''}>${o.label}</option>`)
                .join('');

            // Variavel sub-selector (se dimensao=variable)
            let variableSelector = '';
            if (f.dimension === 'variable') {
                const obsVars = CONFIG.OBSERVATION_VARIABLES || [];
                const varOpts = obsVars
                    .map(
                        (v) =>
                            `<option value="${v.id}" ${f.variableId === v.id ? 'selected' : ''}>${v.name} (${v.group})</option>`,
                    )
                    .join('');
                variableSelector = `<select class="calculator-filter-variable"
                onchange="window.handleUpdateCalculatorFilter('${item.id}',${fi},'variableId',this.value)">
                <option value="">—</option>${varOpts}</select>`;
            }

            // Value dropdown (depende da dimensao)
            const valueHtml = _renderFilterValueInput(item.id, fi, f);

            return `<div class="calculator-filter-row">
            <select onchange="window.handleUpdateCalculatorFilter('${item.id}',${fi},'dimension',this.value)">${dimOpts}</select>
            ${variableSelector}
            <select onchange="window.handleUpdateCalculatorFilter('${item.id}',${fi},'operator',this.value)">${opOpts}</select>
            ${valueHtml}
            <button onclick="window.handleRemoveCalculatorFilter('${item.id}',${fi})" class="btn-sm">${getIcon('x', 12)}</button>
        </div>`;
        })
        .join('');

    return `<div class="calculator-filters">
        <div class="calculator-filters-label">${t('calculatorFilters') || 'Filters'}
            <button onclick="window.handleAddCalculatorFilter('${item.id}')" class="btn-sm">${getIcon('plus', 12)} Add</button>
        </div>
        ${filtersHtml}
    </div>`;
}

function _renderFilterValueInput(itemId, fi, filter) {
    if (filter.dimension === 'variable' && filter.variableId) {
        // Busca tipo da variavel
        const varDef = (CONFIG.OBSERVATION_VARIABLES || []).find((v) => v.id === filter.variableId);
        if (varDef?.type === 'boolean') {
            return `<select onchange="window.handleUpdateCalculatorFilter('${itemId}',${fi},'value',this.value)">
                <option value="1" ${filter.value === '1' ? 'selected' : ''}>Yes (1)</option>
                <option value="0" ${filter.value === '0' ? 'selected' : ''}>No (0)</option>
            </select>`;
        }
        if (varDef?.type === 'select' && varDef.options) {
            const opts = varDef.options
                .map((o) => `<option value="${o}" ${filter.value === o ? 'selected' : ''}>${o}</option>`)
                .join('');
            return `<select onchange="window.handleUpdateCalculatorFilter('${itemId}',${fi},'value',this.value)">
                <option value="">—</option>${opts}</select>`;
        }
    }

    // Para dimension standard: usa getDimensionOptions do ticker
    if (['parameter', 'family', 'element', 'area', 'campaign', 'category'].includes(filter.dimension)) {
        const options = _getDimensionOptions(filter.dimension);
        const opts = options
            .map(
                (o) =>
                    `<option value="${o.id}" ${filter.value === o.id ? 'selected' : ''}>${escapeHtml(o.label)}</option>`,
            )
            .join('');
        return `<select onchange="window.handleUpdateCalculatorFilter('${itemId}',${fi},'value',this.value)">
            <option value="">—</option>${opts}</select>`;
    }

    // Fallback: texto livre
    return `<input type="text" value="${escapeHtml(filter.value || '')}"
        onchange="window.handleUpdateCalculatorFilter('${itemId}',${fi},'value',this.value)" placeholder="Value">`;
}

function _getDimensionOptions(dimension) {
    switch (dimension) {
        case 'parameter':
            return (CONFIG.PARAMETERS || []).map((p) => ({ id: p.id, label: p.name }));
        case 'family':
            return Object.values(getAllFamilies() || {}).map((f) => ({ id: f.id, label: f.nameKey || f.name || f.id }));
        case 'element':
            return getAllElements().map((el) => ({ id: el.id, label: el.name || el.id }));
        case 'area':
            return getAllElements()
                .filter((e) => e.family === 'boundary' || e.family === 'area')
                .map((el) => ({ id: el.id, label: el.name || el.id }));
        case 'campaign':
            return getAllCampaigns().map((c) => ({ id: c.id, label: c.name || c.id }));
        case 'category': {
            const cats = new Set();
            (CONFIG.PARAMETERS || []).forEach((p) => {
                if (p.category) cats.add(p.category);
            });
            return [...cats].sort().map((c) => ({ id: c, label: c }));
        }
        default:
            return [];
    }
}

// ----------------------------------------------------------------
// METRIC CONFIG
// ----------------------------------------------------------------

function _renderMetricConfig(item) {
    const calcs = ['sum', 'average', 'min', 'max', 'count', 'latest', 'change_pct', 'trend'];
    const calcOpts = calcs
        .map((c) => `<option value="${c}" ${item.calculation === c ? 'selected' : ''}>${c}</option>`)
        .join('');

    return `<div class="calculator-config-row">
        <label>Calculation</label>
        <select onchange="window.handleUpdateCalculatorField('${item.id}','calculation',this.value)">${calcOpts}</select>
        <label>Unit</label>
        <input type="text" value="${escapeHtml(item.unitId || '')}" placeholder="ug_L"
            onchange="window.handleUpdateCalculatorField('${item.id}','unitId',this.value)">
        <label>Precision</label>
        <input type="number" value="${item.precision}" min="0" max="6" style="width:50px"
            onchange="window.handleUpdateCalculatorField('${item.id}','precision',parseInt(this.value))">
        <label>Color</label>
        <input type="color" value="${item.color || '#2d8a7a'}"
            onchange="window.handleUpdateCalculatorField('${item.id}','color',this.value)">
    </div>
    ${_renderPostProcessing(item)}`;
}

// ----------------------------------------------------------------
// POST-PROCESSING RENDERING
// ----------------------------------------------------------------

/**
 * Render the postProcessing chain editor for a metric item.
 * Renderiza o editor de cadeia de pos-processamento por constantes.
 *
 * @param {Object} item - CalculatorItem
 * @returns {string} HTML
 */
function _renderPostProcessing(item) {
    const steps = Array.isArray(item.postProcessing) ? item.postProcessing : [];
    const constants = getUserConstants();

    // Operadores com símbolo matemático + label curto
    const ops = [
        { id: 'multiply', sym: '×', label: 'Multiplicar' },
        { id: 'divide', sym: '÷', label: 'Dividir' },
        { id: 'add', sym: '+', label: 'Somar' },
        { id: 'subtract', sym: '−', label: 'Subtrair' },
    ];

    const stepsHtml = steps
        .map((s, si) => {
            const opOpts = ops
                .map((o) => `<option value="${o.id}" ${s.op === o.id ? 'selected' : ''}>${o.sym} ${o.label}</option>`)
                .join('');

            const constOpts = constants
                .map(
                    (c) =>
                        `<option value="${c.id}" ${s.constantId === c.id ? 'selected' : ''}>${escapeHtml(c.symbol)} — ${escapeHtml(c.name.length > 30 ? c.name.slice(0, 30) + '…' : c.name)} (${c.value})</option>`,
                )
                .join('');

            const selectedConst = constants.find((c) => c.id === s.constantId);
            const constLabel = selectedConst
                ? `<code class="calculator-pp-const-label">${escapeHtml(selectedConst.symbol)}</code>`
                : '';

            return `
        <div class="calculator-pp-row">
            <select class="calculator-pp-op"
                    title="${t('postProcessing') || 'Operação'}"
                    onchange="window.handleUpdateCalculatorPostProcessing('${item.id}',${si},'op',this.value)">
                ${opOpts}
            </select>
            <select class="calculator-pp-const"
                    title="${t('applyConstant') || 'Constante'}"
                    onchange="window.handleUpdateCalculatorPostProcessing('${item.id}',${si},'constantId',this.value)">
                <option value="">— ${t('selectConstant') || 'selecionar constante'} —</option>
                ${constOpts}
            </select>
            ${constLabel}
            <button class="calculator-pp-remove"
                    onclick="window.handleRemoveCalculatorPostProcessing('${item.id}',${si})"
                    title="${t('removeConstant') || 'Remover'}">
                ${getIcon('x', 12)}
            </button>
        </div>`;
        })
        .join('');

    const noConstantsHint =
        constants.length === 0
            ? `<div class="calculator-pp-hint">
               ${t('noConstants') || 'Nenhuma constante definida.'}
               <a href="#" onclick="handleOpenConstantsModal();return false;">${t('addConstant') || 'Criar constante'}</a>
           </div>`
            : '';

    const addBtn = `
        <button class="calculator-pp-add-btn"
                onclick="window.handleAddCalculatorPostProcessing('${item.id}')"
                title="${t('applyConstant') || 'Aplicar constante'}">
            ${getIcon('plus', 12)} ${t('applyConstant') || 'Aplicar constante'}
        </button>`;

    return `
    <div class="calculator-postprocessing">
        <div class="calculator-pp-header">
            <span class="calculator-section-label">POST-PROCESSING</span>
            ${addBtn}
        </div>
        ${noConstantsHint}
        ${stepsHtml}
    </div>`;
}

// ----------------------------------------------------------------
// RULE CONFIG (compound conditions)
// ----------------------------------------------------------------

function _renderRuleConfig(item) {
    const conds = item.conditions?.conditions || [];
    const logic = item.conditions?.logic || 'AND';
    const params = CONFIG.PARAMETERS || [];
    const compOps = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'];

    const condsHtml = conds
        .map((c, ci) => {
            const paramOpts = params
                .map((p) => `<option value="${p.id}" ${c.parameterId === p.id ? 'selected' : ''}>${p.name}</option>`)
                .join('');
            const opOpts = compOps
                .map((o) => `<option value="${o}" ${c.operator === o ? 'selected' : ''}>${o}</option>`)
                .join('');

            return `<div class="calculator-condition-row">
            <select onchange="window.handleUpdateCalculatorCondition('${item.id}',${ci},'parameterId',this.value)">
                <option value="">—</option>${paramOpts}</select>
            <select onchange="window.handleUpdateCalculatorCondition('${item.id}',${ci},'operator',this.value)">${opOpts}</select>
            <input type="number" value="${c.threshold}" step="any"
                onchange="window.handleUpdateCalculatorCondition('${item.id}',${ci},'threshold',this.value)">
            <input type="text" value="${escapeHtml(c.thresholdUnit || '')}" placeholder="unit" style="width:60px"
                onchange="window.handleUpdateCalculatorCondition('${item.id}',${ci},'thresholdUnit',this.value)">
            <button onclick="window.handleRemoveCalculatorCondition('${item.id}',${ci})" class="btn-sm">${getIcon('x', 12)}</button>
        </div>`;
        })
        .join('');

    return `<div class="calculator-rule-config">
        <div class="calculator-rule-header">
            <label>Logic</label>
            <select onchange="window.handleUpdateCalculatorLogic('${item.id}',this.value)">
                <option value="AND" ${logic === 'AND' ? 'selected' : ''}>AND</option>
                <option value="OR" ${logic === 'OR' ? 'selected' : ''}>OR</option>
            </select>
            <button onclick="window.handleAddCalculatorCondition('${item.id}')" class="btn-sm">${getIcon('plus', 12)} Condition</button>
        </div>
        ${condsHtml}
        <div class="calculator-config-row">
            <label>Color</label>
            <input type="color" value="${item.color || '#e74c3c'}"
                onchange="window.handleUpdateCalculatorField('${item.id}','color',this.value)">
        </div>
    </div>`;
}

// ----------------------------------------------------------------
// RATIO CONFIG
// ----------------------------------------------------------------

function _renderRatioConfig(item) {
    const params = CONFIG.PARAMETERS || [];
    const ratio = item.ratio || {};
    const compOps = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'];

    const numOpts = params
        .map(
            (p) =>
                `<option value="${p.id}" ${ratio.numeratorParameterId === p.id ? 'selected' : ''}>${p.name}</option>`,
        )
        .join('');
    const denOpts = params
        .map(
            (p) =>
                `<option value="${p.id}" ${ratio.denominatorParameterId === p.id ? 'selected' : ''}>${p.name}</option>`,
        )
        .join('');
    const opOpts = compOps
        .map((o) => `<option value="${o}" ${ratio.operator === o ? 'selected' : ''}>${o}</option>`)
        .join('');

    return `<div class="calculator-ratio-config">
        <div class="calculator-config-row">
            <label>Numerator</label>
            <select onchange="window.handleUpdateCalculatorRatio('${item.id}','numeratorParameterId',this.value)">
                <option value="">—</option>${numOpts}</select>
            <label>÷ Denominator</label>
            <select onchange="window.handleUpdateCalculatorRatio('${item.id}','denominatorParameterId',this.value)">
                <option value="">—</option>${denOpts}</select>
        </div>
        <div class="calculator-config-row">
            <label>Threshold</label>
            <select onchange="window.handleUpdateCalculatorRatio('${item.id}','operator',this.value)">${opOpts}</select>
            <input type="number" value="${ratio.threshold || 0}" step="any"
                onchange="window.handleUpdateCalculatorRatio('${item.id}','threshold',this.value)">
            <label>Precision</label>
            <input type="number" value="${item.precision || 2}" min="0" max="6" style="width:50px"
                onchange="window.handleUpdateCalculatorField('${item.id}','precision',parseInt(this.value))">
            <label>Color</label>
            <input type="color" value="${item.color || '#3498db'}"
                onchange="window.handleUpdateCalculatorField('${item.id}','color',this.value)">
        </div>
    </div>`;
}

// ----------------------------------------------------------------
// POST-PROCESSING CRUD (constantes do usuario aplicadas ao resultado)
// ----------------------------------------------------------------

function handleAddCalculatorPostProcessing(itemId) {
    const item = getCalculatorItemById(itemId);
    if (!item) return;
    const pp = Array.isArray(item.postProcessing) ? [...item.postProcessing] : [];
    pp.push({ op: 'multiply', constantId: '' });
    updateCalculatorItem(itemId, { postProcessing: pp });
    _renderCalculatorModal();
    _fireChanged();
}

function handleRemoveCalculatorPostProcessing(itemId, stepIdx) {
    const item = getCalculatorItemById(itemId);
    if (!item || !Array.isArray(item.postProcessing)) return;
    const pp = [...item.postProcessing];
    pp.splice(stepIdx, 1);
    updateCalculatorItem(itemId, { postProcessing: pp });
    _renderCalculatorModal();
    _fireChanged();
}

function handleUpdateCalculatorPostProcessing(itemId, stepIdx, field, value) {
    const item = getCalculatorItemById(itemId);
    if (!item || !Array.isArray(item.postProcessing)) return;
    const pp = [...item.postProcessing];
    if (!pp[stepIdx]) return;
    pp[stepIdx] = { ...pp[stepIdx], [field]: value };
    updateCalculatorItem(itemId, { postProcessing: pp });
    _renderCalculatorModal();
    _fireChanged();
}

// ----------------------------------------------------------------
// CLEAR ALL
// ----------------------------------------------------------------

function handleClearCalculator() {
    clearCalculator();
    _renderCalculatorModal();
    _fireChanged();
}

// ----------------------------------------------------------------
// INTERNAL
// ----------------------------------------------------------------

function _fireChanged() {
    window.dispatchEvent(new CustomEvent('calculatorChanged'));
    if (_updateAllUI) _updateAllUI();
}

// ----------------------------------------------------------------
// EXPORTS
// ----------------------------------------------------------------

export const calculatorHandlers = {
    handleOpenCalculator,
    handleCloseCalculator,
    handleAddCalculatorMetric,
    handleAddCalculatorRule,
    handleAddCalculatorRatio,
    handleRemoveCalculatorItem,
    handleDuplicateCalculatorItem,
    handleReorderCalculatorItem,
    handleToggleCalculatorItem,
    handleUpdateCalculatorField,
    handleAddCalculatorFilter,
    handleRemoveCalculatorFilter,
    handleUpdateCalculatorFilter,
    handleAddCalculatorCondition,
    handleRemoveCalculatorCondition,
    handleUpdateCalculatorCondition,
    handleUpdateCalculatorLogic,
    handleUpdateCalculatorRatio,
    handlePushCalculatorToTicker,
    handleClearCalculator,
    handleAddCalculatorPostProcessing,
    handleRemoveCalculatorPostProcessing,
    handleUpdateCalculatorPostProcessing,
};
