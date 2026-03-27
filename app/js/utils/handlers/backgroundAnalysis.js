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
   BACKGROUND ANALYSIS HANDLERS — EPA background vs compliance modal
   Comparacao estatistica entre background (montante) e compliance
   (jusante) usando o metodo EPA de excedencia do P95.

   Padrao: exporta backgroundAnalysisHandlers
   ================================================================ */

import { applyFilters, extractValues } from '../../core/calculator/filterPipeline.js';
import { backgroundComparison } from '../../core/analytics/statistics.js';
import { getAllElements } from '../../core/elements/manager.js';
import { CONFIG } from '../../config.js';
import { escapeHtml } from '../helpers/html.js';
import { getIcon } from '../ui/icons.js';
import { t } from '../i18n/translations.js';
import { showToast } from '../ui/toast.js';
import { createTemplateMetrics } from '../../core/calculator/manager.js';

// ----------------------------------------------------------------
// MODULE STATE
// Estado do modulo: configuracoes e selecoes do usuario
// ----------------------------------------------------------------

const _state = {
    alpha: 0.05,
    backgroundElements: [], // element IDs (upgradient / montante)
    complianceElements: [], // element IDs (downgradient / jusante)
    filters: [], // parameter, campaign, etc.
    unitId: null,
    lastResult: null,
};

// ----------------------------------------------------------------
// MODAL OPEN / CLOSE
// ----------------------------------------------------------------

/**
 * Open the background analysis modal and render contents.
 * Abre o modal de analise de background e renderiza.
 */
function handleOpenBackgroundAnalysis() {
    const modal = document.getElementById('background-analysis-modal');
    if (!modal) return;
    modal.classList.add('visible');
    _render();
}

/**
 * Close the background analysis modal.
 * Fecha o modal de analise de background.
 */
function handleCloseBackgroundAnalysis() {
    const modal = document.getElementById('background-analysis-modal');
    if (modal) modal.classList.remove('visible');
}

// ----------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------

/**
 * Set the significance level (alpha) for the test.
 * Define o nivel de significancia (alfa) para o teste.
 *
 * @param {number} alpha - Significance level (e.g. 0.01, 0.05, 0.10)
 */
function handleSetBackgroundAlpha(alpha) {
    _state.alpha = parseFloat(alpha) || 0.05;
    _state.lastResult = null;
    _render();
}

/**
 * Set the target unit for value extraction / conversion.
 * Define a unidade-alvo para extracao e conversao de valores.
 *
 * @param {string} unitId - Unit identifier (e.g. 'ug_L')
 */
function handleSetBackgroundUnit(unitId) {
    _state.unitId = unitId || null;
    _state.lastResult = null;
    _render();
}

// ----------------------------------------------------------------
// ELEMENT SELECTION — Background (upgradient)
// ----------------------------------------------------------------

/**
 * Toggle an element in the background (upgradient) group.
 * Marca/desmarca um elemento no grupo de background (montante).
 *
 * @param {string} elId - Element ID
 * @param {boolean} checked - Whether to include
 */
function handleToggleBackgroundElement(elId, checked) {
    const set = new Set(_state.backgroundElements);
    if (checked) {
        set.add(elId);
        // Remove from compliance if present (elemento nao pode estar nos dois)
        _state.complianceElements = _state.complianceElements.filter((id) => id !== elId);
    } else {
        set.delete(elId);
    }
    _state.backgroundElements = [...set];
    _state.lastResult = null;
    _render();
}

// ----------------------------------------------------------------
// ELEMENT SELECTION — Compliance (downgradient)
// ----------------------------------------------------------------

/**
 * Toggle an element in the compliance (downgradient) group.
 * Marca/desmarca um elemento no grupo de compliance (jusante).
 *
 * @param {string} elId - Element ID
 * @param {boolean} checked - Whether to include
 */
function handleToggleComplianceElement(elId, checked) {
    const set = new Set(_state.complianceElements);
    if (checked) {
        set.add(elId);
        // Remove from background if present
        _state.backgroundElements = _state.backgroundElements.filter((id) => id !== elId);
    } else {
        set.delete(elId);
    }
    _state.complianceElements = [...set];
    _state.lastResult = null;
    _render();
}

// ----------------------------------------------------------------
// FILTER CRUD
// Gerenciamento de filtros (parametro, campanha, etc.)
// ----------------------------------------------------------------

/**
 * Add a new empty filter row.
 * Adiciona uma linha de filtro vazia.
 */
function handleAddBackgroundFilter() {
    _state.filters.push({ dimension: 'parameter', operator: 'is', value: '' });
    _state.lastResult = null;
    _render();
}

/**
 * Remove a filter by index.
 * Remove um filtro pelo indice.
 *
 * @param {number} index - Filter index
 */
function handleRemoveBackgroundFilter(index) {
    _state.filters.splice(index, 1);
    _state.lastResult = null;
    _render();
}

/**
 * Update a filter field by index.
 * Atualiza um campo do filtro pelo indice.
 *
 * @param {number} index - Filter index
 * @param {string} field - Field name (dimension, operator, value)
 * @param {string} value - New value
 */
function handleUpdateBackgroundFilter(index, field, value) {
    if (!_state.filters[index]) return;
    _state.filters[index][field] = value;
    _state.lastResult = null;
    _render();
}

// ----------------------------------------------------------------
// RUN ANALYSIS
// Executa a comparacao estatistica EPA background vs compliance
// ----------------------------------------------------------------

/**
 * Execute background comparison test.
 * Roda o teste de comparacao background vs compliance (excedencia P95).
 */
function handleRunBackgroundAnalysis() {
    if (_state.backgroundElements.length === 0 || _state.complianceElements.length === 0) {
        showToast(t('bgSelectBoth') || 'Select background and compliance elements', 'warning');
        return;
    }

    const { observations } = applyFilters(_state);
    const bgSet = new Set(_state.backgroundElements);
    const cpSet = new Set(_state.complianceElements);

    const bgObs = observations.filter((o) => bgSet.has(o._elementId));
    const cpObs = observations.filter((o) => cpSet.has(o._elementId));

    const bgValues = extractValues(bgObs, _state.unitId).map((v) => v.value);
    const cpValues = extractValues(cpObs, _state.unitId).map((v) => v.value);

    if (bgValues.length < 4) {
        showToast(t('bgNeedBackground') || 'Need >= 4 background values', 'warning');
        return;
    }
    if (cpValues.length < 1) {
        showToast(t('bgNeedCompliance') || 'Need >= 1 compliance value', 'warning');
        return;
    }

    _state.lastResult = backgroundComparison(cpValues, bgValues, _state.alpha);
    _render();
}

// ----------------------------------------------------------------
// RENDER — Main modal body
// Renderiza o corpo do modal de analise de background
// ----------------------------------------------------------------

/**
 * Render the modal body contents.
 * Renderiza todo o conteudo do corpo do modal.
 */
function _render() {
    const body = document.getElementById('background-analysis-body');
    if (!body) return;

    body.innerHTML = [
        _renderDisclaimer(),
        _renderConfigRow(),
        _renderElementColumns(),
        _renderFilters(),
        _renderRunButton(),
        _renderResults(),
    ].join('');
}

// ----------------------------------------------------------------
// RENDER — Disclaimer
// ----------------------------------------------------------------

function _renderDisclaimer() {
    return `<div class="stats-disclaimer">
        <span class="stats-disclaimer-icon">!</span>
        <div>
            <p><strong>${t('backgroundAnalysis') || 'Background Analysis'}</strong> &#8212;
            ${t('backgroundDisclaimer') || 'Compares compliance point data (downgradient) against background reference data (upgradient) to determine if observed concentrations exceed natural levels. Based on EPA Unified Guidance methodology: calculates the 95th percentile of background data and counts how many compliance values exceed it. A statistically significant number of exceedances indicates evidence of contamination.'}</p>
            <p style="margin-top:6px"><button class="btn-sm" onclick="window.handleCreateBackgroundTemplates()">${getIcon('copy', 10)} ${t('viewTemplates') || 'View example metrics in Calculator'}</button></p>
        </div>
    </div>`;
}

// ----------------------------------------------------------------
// RENDER — Config row (alpha + unit)
// ----------------------------------------------------------------

/**
 * Render alpha dropdown and unit input row.
 * Renderiza controles de alfa e unidade.
 *
 * @returns {string} HTML string
 */
function _renderConfigRow() {
    const alphas = [0.01, 0.05, 0.1];
    const alphaOpts = alphas
        .map((a) => `<option value="${a}" ${_state.alpha === a ? 'selected' : ''}>${a}</option>`)
        .join('');

    return `<div class="bg-analysis-config-row">
        <label>${t('bgAlpha') || 'Significance (&alpha;)'}</label>
        <select onchange="window.handleSetBackgroundAlpha(this.value)">
            ${alphaOpts}
        </select>
        <label>${t('bgUnit') || 'Unit'}</label>
        <input type="text" value="${escapeHtml(_state.unitId || '')}"
            placeholder="ug_L"
            onchange="window.handleSetBackgroundUnit(this.value)">
    </div>`;
}

// ----------------------------------------------------------------
// RENDER — Element columns (background / compliance)
// ----------------------------------------------------------------

/**
 * Render the two-column element selection panel.
 * Renderiza as duas colunas de selecao de elementos (montante/jusante).
 *
 * @returns {string} HTML string
 */
function _renderElementColumns() {
    const eligible = _getEligibleElements();
    const bgSet = new Set(_state.backgroundElements);
    const cpSet = new Set(_state.complianceElements);

    const bgList = _renderCheckboxList(eligible, bgSet, 'handleToggleBackgroundElement');
    const cpList = _renderCheckboxList(eligible, cpSet, 'handleToggleComplianceElement');

    return `<div class="bg-analysis-columns">
        <div class="bg-analysis-column">
            <div class="bg-analysis-column-header">
                ${getIcon('arrow-up-left', 14)}
                ${t('bgBackground') || 'Background (upgradient)'}
            </div>
            <div class="bg-analysis-column-body">${bgList}</div>
        </div>
        <div class="bg-analysis-column">
            <div class="bg-analysis-column-header">
                ${getIcon('arrow-down-right', 14)}
                ${t('bgCompliance') || 'Compliance (downgradient)'}
            </div>
            <div class="bg-analysis-column-body">${cpList}</div>
        </div>
    </div>`;
}

/**
 * Get elements eligible for background/compliance selection.
 * Retorna elementos elegiveis: wells, springs, sensors, samples.
 *
 * @returns {Object[]} Filtered elements
 */
function _getEligibleElements() {
    const eligible = new Set(['well', 'spring', 'sensor', 'sample']);
    return getAllElements().filter((el) => eligible.has(el.family));
}

/**
 * Render a checkbox list for a set of elements.
 * Renderiza lista de checkboxes para um conjunto de elementos.
 *
 * @param {Object[]} elements - Eligible elements
 * @param {Set} selected - Set of selected IDs
 * @param {string} handlerName - Window handler to call on toggle
 * @returns {string} HTML string
 */
function _renderCheckboxList(elements, selected, handlerName) {
    if (elements.length === 0) {
        return `<div class="bg-analysis-empty">
            ${t('bgNoElements') || 'No wells, springs, sensors, or samples in model.'}
        </div>`;
    }

    return elements
        .map((el) => {
            const checked = selected.has(el.id) ? 'checked' : '';
            const name = escapeHtml(el.name || el.id);
            const family = escapeHtml(el.family);
            return `<label class="bg-analysis-checkbox">
            <input type="checkbox" ${checked}
                onchange="window.${handlerName}('${el.id}', this.checked)">
            <span class="bg-analysis-el-name">${name}</span>
            <span class="bg-analysis-el-family">${family}</span>
        </label>`;
        })
        .join('');
}

// ----------------------------------------------------------------
// RENDER — Filters
// ----------------------------------------------------------------

/**
 * Render the filter section.
 * Renderiza a secao de filtros (parametro, campanha, etc.).
 *
 * @returns {string} HTML string
 */
function _renderFilters() {
    const dims = [
        { id: 'parameter', label: 'Parameter' },
        { id: 'campaign', label: 'Campaign' },
        { id: 'category', label: 'Category' },
    ];
    const operators = [
        { id: 'is', label: 'is' },
        { id: 'is_not', label: 'is not' },
        { id: 'in', label: 'in' },
        { id: 'not_in', label: 'not in' },
    ];

    const rows = (_state.filters || [])
        .map((f, fi) => {
            return _renderFilterRow(f, fi, dims, operators);
        })
        .join('');

    return `<div class="bg-analysis-filters">
        <div class="bg-analysis-filters-label">
            ${t('bgFilters') || 'Filters'}
            <button onclick="window.handleAddBackgroundFilter()" class="btn-sm">
                ${getIcon('plus', 12)} ${t('bgAddFilter') || 'Add'}
            </button>
        </div>
        ${rows}
    </div>`;
}

/**
 * Render a single filter row.
 * Renderiza uma linha de filtro individual.
 *
 * @param {Object} f - Filter object
 * @param {number} fi - Filter index
 * @param {Object[]} dims - Dimension options
 * @param {Object[]} operators - Operator options
 * @returns {string} HTML string
 */
function _renderFilterRow(f, fi, dims, operators) {
    const dimOpts = dims
        .map((d) => `<option value="${d.id}" ${f.dimension === d.id ? 'selected' : ''}>${d.label}</option>`)
        .join('');
    const opOpts = operators
        .map((o) => `<option value="${o.id}" ${f.operator === o.id ? 'selected' : ''}>${o.label}</option>`)
        .join('');
    const valueHtml = _renderFilterValue(fi, f);

    return `<div class="bg-analysis-filter-row">
        <select onchange="window.handleUpdateBackgroundFilter(${fi},'dimension',this.value)">
            ${dimOpts}
        </select>
        <select onchange="window.handleUpdateBackgroundFilter(${fi},'operator',this.value)">
            ${opOpts}
        </select>
        ${valueHtml}
        <button onclick="window.handleRemoveBackgroundFilter(${fi})" class="btn-sm">
            ${getIcon('x', 12)}
        </button>
    </div>`;
}

/**
 * Render the value input for a filter (dropdown or text).
 * Renderiza o campo de valor para um filtro.
 *
 * @param {number} fi - Filter index
 * @param {Object} filter - Filter object
 * @returns {string} HTML string
 */
function _renderFilterValue(fi, filter) {
    const options = _getDimensionOptions(filter.dimension);
    if (options.length > 0) {
        const opts = options
            .map(
                (o) =>
                    `<option value="${o.id}" ${filter.value === o.id ? 'selected' : ''}>${escapeHtml(o.label)}</option>`,
            )
            .join('');
        return `<select onchange="window.handleUpdateBackgroundFilter(${fi},'value',this.value)">
            <option value="">--</option>${opts}
        </select>`;
    }
    return `<input type="text" value="${escapeHtml(filter.value || '')}"
        onchange="window.handleUpdateBackgroundFilter(${fi},'value',this.value)"
        placeholder="Value">`;
}

/**
 * Get available options for a filter dimension.
 * Retorna opcoes disponiveis para uma dimensao de filtro.
 *
 * @param {string} dimension - Filter dimension
 * @returns {Array<{ id: string, label: string }>}
 */
function _getDimensionOptions(dimension) {
    switch (dimension) {
        case 'parameter':
            return (CONFIG.PARAMETERS || []).map((p) => ({ id: p.id, label: p.name }));
        case 'campaign': {
            // Coleta campanhas de todos os elementos
            const campaigns = new Map();
            for (const el of getAllElements()) {
                for (const obs of el.data?.observations || []) {
                    if (obs.campaignId && !campaigns.has(obs.campaignId)) {
                        campaigns.set(obs.campaignId, obs.campaignId);
                    }
                }
            }
            return [...campaigns.keys()].sort().map((c) => ({ id: c, label: c }));
        }
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
// RENDER — Run button
// ----------------------------------------------------------------

/**
 * Render the run button.
 * Renderiza o botao de execucao do teste.
 *
 * @returns {string} HTML string
 */
function _renderRunButton() {
    const bgCount = _state.backgroundElements.length;
    const cpCount = _state.complianceElements.length;
    const disabled = bgCount === 0 || cpCount === 0 ? 'disabled' : '';

    return `<div class="bg-analysis-run">
        <button class="btn-primary" onclick="window.handleRunBackgroundAnalysis()" ${disabled}>
            ${getIcon('play', 14)}
            ${t('bgRun') || 'Run Comparison'}
        </button>
        <span class="bg-analysis-counts">
            ${bgCount} ${t('bgBgCount') || 'background'} / ${cpCount} ${t('bgCpCount') || 'compliance'}
        </span>
    </div>`;
}

// ----------------------------------------------------------------
// RENDER — Results
// Renderiza resultados em linguagem acessivel para nao-estatisticos
// ----------------------------------------------------------------

/**
 * Render the results section (banner + interpretation + technical details).
 * Renderiza a secao de resultados com linguagem acessivel:
 * banner claro, interpretacao em bullets, e detalhes tecnicos em colapsavel.
 *
 * @returns {string} HTML string
 */
function _renderResults() {
    const r = _state.lastResult;
    if (!r) return '';

    const banner = _renderBanner(r);
    const interpretation = _renderInterpretation(r);
    const details = _renderTechnicalDetails(r);
    return `<div class="bg-analysis-results">${banner}${interpretation}${details}</div>`;
}

/**
 * Render the conclusion banner with clear, non-technical language.
 * Renderiza o banner de conclusao com linguagem clara para leigos.
 *
 * @param {Object} r - Result from backgroundComparison
 * @returns {string} HTML string
 */
function _renderBanner(r) {
    if (r.conclusion === 'insufficient_data') {
        return `<div class="bg-analysis-banner bg-analysis-banner-warn">
            ${getIcon('alert-triangle', 16)}
            ${t('bgInsufficient') || 'Insufficient data for comparison.'}
        </div>`;
    }

    if (r.reject) {
        return `<div class="bg-analysis-banner bg-analysis-banner-contaminated">
            <span class="bg-analysis-banner-icon">&#9679;</span>
            <span class="bg-analysis-banner-text">${t('bgBannerContaminated') || 'As concentracoes excedem significativamente os niveis naturais.'}</span>
            <span class="bg-analysis-pval">p = ${r.pValue.toFixed(4)}</span>
        </div>`;
    }

    return `<div class="bg-analysis-banner bg-analysis-banner-clean">
        <span class="bg-analysis-banner-icon">&#9675;</span>
        <span class="bg-analysis-banner-text">${t('bgBannerClean') || 'As concentracoes sao compativeis com niveis naturais de background.'}</span>
        <span class="bg-analysis-pval">p = ${r.pValue.toFixed(4)}</span>
    </div>`;
}

/**
 * Render the plain-language interpretation section.
 * Renderiza a interpretacao em linguagem acessivel com bullets explicativos.
 *
 * @param {Object} r - Result from backgroundComparison
 * @returns {string} HTML string
 */
function _renderInterpretation(r) {
    if (r.conclusion === 'insufficient_data') return '';

    const pFormatted = r.pValue.toFixed(4);
    const exceedances = r.exceedances;
    const total = r.n_c;
    const expectedVal = r.expected.toFixed(1);

    if (!r.reject) {
        // Clean — concentracoes compativeis com background
        return `<div class="bg-analysis-interpretation">
            <strong>&#9654; ${t('bgWhatMeans') || 'O que isso significa?'}</strong>
            <ul>
                <li>${t('bgCleanBullet1') || 'Os valores nos pontos de compliance estao dentro do esperado para a area'}</li>
                <li>${escapeHtml(String(exceedances))} ${t('bgCleanBullet2Of') || 'de'} ${escapeHtml(String(total))} ${t('bgCleanBullet2') || 'amostras excederam o limiar de referencia, o que e compativel com variacao natural'}</li>
                <li>${t('bgCleanBullet3') || 'Nao ha evidencia estatistica de contaminacao'} (p = ${escapeHtml(pFormatted)})</li>
            </ul>
        </div>`;
    }

    // Contaminated — concentracoes excedem background
    return `<div class="bg-analysis-interpretation">
        <strong>&#9654; ${t('bgWhatMeans') || 'O que isso significa?'}</strong>
        <ul>
            <li>${escapeHtml(String(exceedances))} ${t('bgContamBullet1Of') || 'de'} ${escapeHtml(String(total))} ${t('bgContamBullet1') || 'amostras excederam o percentil 95 do background'}</li>
            <li>${t('bgContamBullet2') || 'Isso e mais do que o esperado por acaso'} (${t('bgContamExpected') || 'esperado'}: ${escapeHtml(expectedVal)}, ${t('bgContamObserved') || 'observado'}: ${escapeHtml(String(exceedances))})</li>
            <li>${t('bgContamBullet3') || 'Ha evidencia estatistica de que esta area esta impactada'} (p = ${escapeHtml(pFormatted)})</li>
        </ul>
    </div>`;
}

/**
 * Render technical details in a collapsible section.
 * Renderiza detalhes tecnicos em secao colapsavel para especialistas.
 *
 * @param {Object} r - Result from backgroundComparison
 * @returns {string} HTML string
 */
function _renderTechnicalDetails(r) {
    if (r.conclusion === 'insufficient_data') return '';

    return `<details class="bg-analysis-stats">
        <summary>${t('bgTechnicalDetails') || 'Detalhes tecnicos'}</summary>
        <table class="bg-analysis-stats-table">
            <tr>
                <td class="stat-label">${t('bgExceedances') || 'Exceedances'}</td>
                <td class="stat-value">${r.exceedances} / ${r.n_c}</td>
            </tr>
            <tr>
                <td class="stat-label">${t('bgExpected') || 'Expected'}</td>
                <td class="stat-value">${r.expected.toFixed(2)}</td>
            </tr>
            <tr>
                <td class="stat-label">${t('bgThreshold') || 'P95 Threshold'}</td>
                <td class="stat-value">${r.threshold.toFixed(4)}</td>
            </tr>
            <tr>
                <td class="stat-label">${t('bgZStat') || 'z-statistic'}</td>
                <td class="stat-value">${r.zStat.toFixed(4)}</td>
            </tr>
            <tr>
                <td class="stat-label">${t('bgPValue') || 'p-value'}</td>
                <td class="stat-value">${r.pValue.toFixed(4)}</td>
            </tr>
            <tr>
                <td class="stat-label">${t('bgAlphaLabel') || 'Alpha'}</td>
                <td class="stat-value">${_state.alpha}</td>
            </tr>
            <tr>
                <td class="stat-label">${t('bgBgSamples') || 'Background samples'}</td>
                <td class="stat-value">${r.n_b}</td>
            </tr>
            <tr>
                <td class="stat-label">${t('bgCpSamples') || 'Compliance samples'}</td>
                <td class="stat-value">${r.n_c}</td>
            </tr>
        </table>
    </details>`;
}

// ----------------------------------------------------------------
// EXPORTS
// ----------------------------------------------------------------

/**
 * Create template metrics in Calculator for background analysis.
 * Cria metricas-exemplo no Calculator para analise de background.
 */
function handleCreateBackgroundTemplates() {
    createTemplateMetrics('background');
    showToast(t('templatesCreated') || 'Template metrics created in Calculator', 'success');
}

export const backgroundAnalysisHandlers = {
    handleOpenBackgroundAnalysis,
    handleCloseBackgroundAnalysis,
    handleRunBackgroundAnalysis,
    handleSetBackgroundAlpha,
    handleSetBackgroundUnit,
    handleToggleBackgroundElement,
    handleToggleComplianceElement,
    handleAddBackgroundFilter,
    handleRemoveBackgroundFilter,
    handleUpdateBackgroundFilter,
    handleCreateBackgroundTemplates,
};
