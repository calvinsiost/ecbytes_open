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
   CONSTANTS MODAL — Tabela de constantes definidas pelo usuario
   Permite criar, editar, remover e filtrar constantes reutilizaveis
   nos calculos (fatores de emissao, incertezas, conversoes, etc.)
   ================================================================ */

import { t } from '../i18n/translations.js';
import { CONFIG } from '../../config.js';
import { hydrateIcons } from './icons.js';
import { formatUncertainty } from '../helpers/html.js';
import {
    getUserConstants,
    addUserConstant,
    updateUserConstant,
    removeUserConstant,
    forceRemoveUserConstant,
    getConstantDependents,
    generateRandomConstants,
    clearDemoConstants,
    validateConstant,
} from '../../core/constants/manager.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

let _searchQuery = '';
let _filterCategory = '';
let _sortColumn = 'name';
let _sortDirection = 'asc';
let _editingId = null; // ID da linha em edição inline
let _updateAllUI = null;

export function setConstantsModalUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ----------------------------------------------------------------
// OPEN / CLOSE
// ----------------------------------------------------------------

/**
 * Open the constants management modal.
 * Abre o modal de gerenciamento de constantes do usuario.
 */
export function openConstantsModal() {
    const overlay = document.getElementById('constants-modal-overlay');
    const modal = document.getElementById('constants-modal');
    if (!overlay || !modal) return;
    _searchQuery = '';
    _filterCategory = '';
    _sortColumn = 'name';
    _sortDirection = 'asc';
    _editingId = null;
    renderConstantsModal();
    overlay.classList.add('active');
    // Focus trap: foca no primeiro elemento focavel
    requestAnimationFrame(() => {
        const first = modal.querySelector('input, button, select');
        if (first) first.focus();
    });
}

/**
 * Close the constants management modal.
 * Fecha o modal de gerenciamento de constantes.
 */
export function closeConstantsModal() {
    const overlay = document.getElementById('constants-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    _editingId = null;
}

// ----------------------------------------------------------------
// RENDER
// ----------------------------------------------------------------

/**
 * Render the constants modal content.
 * Renderiza o conteudo completo do modal de constantes.
 */
export function renderConstantsModal() {
    const content = document.getElementById('constants-modal-content');
    if (!content) return;

    const constants = _getFilteredSorted();
    const categories = CONFIG.CONSTANT_CATEGORIES || [];

    content.innerHTML = `
        <div class="constants-modal-header">
            <h2 id="constants-modal-title" class="constants-modal-title">
                ${t('constantsTitle')}
            </h2>
            <button class="modal-close-btn" onclick="handleCloseConstantsModal()"
                    aria-label="Fechar" title="Fechar (Esc)">&times;</button>
        </div>

        <div class="constants-toolbar">
            <input type="text" class="constants-search-input"
                   id="constants-search"
                   placeholder="${t('searchConstants')}"
                   value="${_escHtml(_searchQuery)}"
                   oninput="handleConstantsSearch(this.value)"
                   aria-label="${t('searchConstants')}">

            <select class="constants-category-filter" id="constants-cat-filter"
                    onchange="handleConstantsFilterCategory(this.value)"
                    aria-label="${t('filterByCategory')}">
                <option value="">${t('filterByCategory')}</option>
                ${categories
                    .map(
                        (cat) => `
                    <option value="${cat.id}" ${_filterCategory === cat.id ? 'selected' : ''}>
                        ${t(cat.labelKey) || cat.id}
                    </option>
                `,
                    )
                    .join('')}
            </select>

            <button class="toolbar-btn constants-add-btn"
                    onclick="handleAddUserConstantRow()"
                    title="${t('addConstant')}">
                <span class="icon" data-icon="plus"></span>
                ${t('addConstant')}
            </button>

            <button class="toolbar-btn constants-demo-btn"
                    onclick="handleGenerateDemoConstants()"
                    title="${t('generateDemoConstants')}">
                <span class="icon" data-icon="shuffle"></span>
                ${t('generateDemoConstants')}
            </button>

            <button class="toolbar-btn constants-clear-demo-btn"
                    onclick="handleClearDemoConstants()"
                    title="${t('clearDemoConstants')}">
                ${t('clearDemoConstants')}
            </button>
        </div>

        <div class="constants-table-wrapper">
            ${_renderTable(constants, categories)}
        </div>

        <div class="constants-footer">
            <span class="constants-count">${constants.length} ${t('userConstants').toLowerCase()}</span>
        </div>
    `;

    // Aplica ícones dinamicamente
    hydrateIcons(content);

    // Registra Escape para fechar
    content.onkeydown = (e) => {
        if (e.key === 'Escape') closeConstantsModal();
    };
}

/**
 * Render the constants table.
 * @param {Object[]} constants
 * @param {Object[]} categories
 * @returns {string} HTML
 */
function _renderTable(constants, categories) {
    const cols = ['name', 'symbol', 'value', 'unit', 'category', 'source', 'actions'];

    const headerCells = cols.map((col) => {
        if (col === 'actions') return `<th class="constants-col-actions">${t('actions') || 'Ações'}</th>`;
        const dir = _sortColumn === col && _sortDirection === 'asc' ? 'desc' : 'asc';
        const arrow = _sortColumn === col ? (_sortDirection === 'asc' ? ' &#9650;' : ' &#9660;') : '';
        return `<th class="constants-col-${col} sortable"
                    onclick="handleConstantsSortBy('${col}')"
                    aria-sort="${_sortColumn === col ? _sortDirection : 'none'}"
                    tabindex="0"
                    onkeydown="if(event.key==='Enter')handleConstantsSortBy('${col}')">
                    ${t('constant' + col.charAt(0).toUpperCase() + col.slice(1)) || col}${arrow}
                </th>`;
    });

    if (constants.length === 0) {
        return `
            <table class="constants-table" role="grid" aria-rowcount="0">
                <thead><tr>${headerCells.join('')}</tr></thead>
                <tbody>
                    <tr><td colspan="${cols.length}" class="constants-empty">
                        ${t('noConstants')}
                    </td></tr>
                </tbody>
            </table>`;
    }

    const rows = constants.map((c, idx) => _renderRow(c, idx + 2, categories));

    return `
        <table class="constants-table" role="grid" aria-rowcount="${constants.length + 1}">
            <thead><tr>${headerCells.join('')}</tr></thead>
            <tbody>${rows.join('')}</tbody>
        </table>`;
}

/**
 * Render a single constant row (or editing row).
 * @param {Object} c - Constant object
 * @param {number} rowIndex - ARIA row index
 * @param {Object[]} categories
 * @returns {string} HTML
 */
function _renderRow(c, rowIndex, categories) {
    const isEditing = _editingId === c.id;
    const demoTag = c.isDemo ? `<span class="constants-demo-badge">${t('demoConstant')}</span>` : '';

    const unitLabel = _getUnitLabel(c.unitId);
    const categoryLabel = _getCategoryLabel(c.category, categories);
    const hasPostProcessing = _hasPostProcessing(c.id);

    if (isEditing) {
        return _renderEditRow(c, rowIndex, categories);
    }

    return `
        <tr role="row" aria-rowindex="${rowIndex}"
            class="constants-row${c.isDemo ? ' constants-row-demo' : ''}">
            <td class="constants-col-name">
                ${_escHtml(c.name)}${demoTag}
                ${c.description ? `<div class="constants-desc">${_escHtml(c.description)}</div>` : ''}
            </td>
            <td class="constants-col-symbol">
                <code>${_escHtml(c.symbol)}</code>
                ${hasPostProcessing ? `<span class="constants-used-badge" title="${t('usedInMetrics')}">&#10010;</span>` : ''}
            </td>
            <td class="constants-col-value">
                ${c.value}${c.uncertainty != null ? `<div class="constants-unc-display">${formatUncertainty(c.uncertainty, c.uncertaintyType, c.coverageFactor)}</div>` : ''}
            </td>
            <td class="constants-col-unit">${_escHtml(unitLabel)}</td>
            <td class="constants-col-category">${_escHtml(categoryLabel)}</td>
            <td class="constants-col-source">
                ${_escHtml(c.source || '—')}
                ${c.validFrom || c.validTo ? `<div class="constants-validity">${_formatValidity(c.validFrom, c.validTo)}</div>` : ''}
            </td>
            <td class="constants-col-actions">
                <button class="constants-btn-edit"
                        onclick="handleEditConstantRow('${c.id}')"
                        title="${t('editConstant')}">
                    <span class="icon" data-icon="edit"></span>
                </button>
                <button class="constants-btn-remove"
                        onclick="handleRemoveUserConstant('${c.id}')"
                        title="${t('removeConstant')}">
                    <span class="icon" data-icon="trash"></span>
                </button>
            </td>
        </tr>`;
}

/**
 * Render an inline editing row for a constant.
 * @param {Object} c
 * @param {number} rowIndex
 * @param {Object[]} categories
 * @returns {string} HTML
 */
function _renderEditRow(c, rowIndex, categories) {
    const unitOptions = (CONFIG.UNITS || [])
        .map((u) => `<option value="${u.id}" ${c.unitId === u.id ? 'selected' : ''}>${u.symbol} — ${u.name}</option>`)
        .join('');

    const catOptions = categories
        .map(
            (cat) =>
                `<option value="${cat.id}" ${c.category === cat.id ? 'selected' : ''}>${t(cat.labelKey) || cat.id}</option>`,
        )
        .join('');

    return `
        <tr role="row" aria-rowindex="${rowIndex}" class="constants-row constants-row-editing"
            id="constants-edit-row-${c.id}">
            <td class="constants-col-name">
                <input type="text" class="constants-input"
                       id="edit-name-${c.id}"
                       value="${_escHtml(c.name)}" maxlength="120"
                       placeholder="${t('constantName')}"
                       aria-label="${t('constantName')}">
                <input type="text" class="constants-input constants-input-desc"
                       id="edit-desc-${c.id}"
                       value="${_escHtml(c.description || '')}" maxlength="500"
                       placeholder="${t('constantDescription')}"
                       aria-label="${t('constantDescription')}">
            </td>
            <td class="constants-col-symbol">
                <input type="text" class="constants-input constants-input-mono"
                       id="edit-symbol-${c.id}"
                       value="${_escHtml(c.symbol)}" maxlength="32"
                       placeholder="EF_CO2"
                       aria-label="${t('constantSymbol')}">
            </td>
            <td class="constants-col-value">
                <input type="number" class="constants-input constants-input-value"
                       id="edit-value-${c.id}"
                       value="${c.value}" step="any"
                       aria-label="${t('constantValue')}">
                ${
                    c.uncertainty != null
                        ? `
                <div class="constants-uncertainty-group">
                    <div class="constants-unc-row">
                        <input type="number" class="constants-input" id="edit-uncertainty-${c.id}"
                               value="${c.uncertainty ?? ''}" step="any" min="0" placeholder="&#177;"
                               title="${t('uncertaintyTooltip')}" aria-label="${t('constantUncertainty')}">
                        <select class="constants-input constants-input-unc-type" id="edit-unctype-${c.id}"
                                aria-label="${t('constantUncertaintyType')}">
                            <option value="" disabled ${!c.uncertaintyType ? 'selected' : ''}>${t('selectUncertaintyType')}</option>
                            <option value="absolute" ${c.uncertaintyType === 'absolute' ? 'selected' : ''}>${t('uncertaintyAbsoluteLabel')}</option>
                            <option value="relative" ${c.uncertaintyType === 'relative' ? 'selected' : ''}>${t('uncertaintyRelativeLabel')}</option>
                        </select>
                        <a href="#" class="constants-k-toggle" onclick="this.nextElementSibling.style.display='inline';this.style.display='none';return false"
                           title="${t('coverageFactorTooltip')}">k=${c.coverageFactor || 2}</a>
                        <input type="number" class="constants-input constants-input-k" id="edit-coveragefactor-${c.id}"
                               value="${c.coverageFactor ?? ''}" step="any" min="0.1" placeholder="k"
                               title="${t('coverageFactorTooltip')}" aria-label="${t('coverageFactor')}"
                               style="display:${c.coverageFactor != null && c.coverageFactor !== 2 ? 'inline' : 'none'}">
                    </div>
                </div>
                `
                        : `
                <button type="button" class="btn btn-link btn-sm uncertainty-toggle-btn"
                        onclick="this.style.display='none';this.nextElementSibling.style.display=''"
                        style="margin-top:4px">+ &#177; ${t('constantUncertainty') || 'Uncertainty'}</button>
                <div class="constants-uncertainty-group" style="display:none">
                    <div class="constants-unc-row">
                        <input type="number" class="constants-input" id="edit-uncertainty-${c.id}"
                               value="" step="any" min="0" placeholder="&#177;"
                               title="${t('uncertaintyTooltip')}" aria-label="${t('constantUncertainty')}">
                        <select class="constants-input constants-input-unc-type" id="edit-unctype-${c.id}"
                                aria-label="${t('constantUncertaintyType')}">
                            <option value="" disabled selected>${t('selectUncertaintyType')}</option>
                            <option value="absolute">${t('uncertaintyAbsoluteLabel')}</option>
                            <option value="relative">${t('uncertaintyRelativeLabel')}</option>
                        </select>
                        <a href="#" class="constants-k-toggle" onclick="this.nextElementSibling.style.display='inline';this.style.display='none';return false"
                           title="${t('coverageFactorTooltip')}">k=2</a>
                        <input type="number" class="constants-input constants-input-k" id="edit-coveragefactor-${c.id}"
                               value="" step="any" min="0.1" placeholder="k"
                               title="${t('coverageFactorTooltip')}" aria-label="${t('coverageFactor')}"
                               style="display:none">
                    </div>
                </div>
                `
                }
            </td>
            <td class="constants-col-unit">
                <select class="constants-input" id="edit-unit-${c.id}"
                        aria-label="${t('constantUnit')}">
                    <option value="">—</option>
                    ${unitOptions}
                </select>
            </td>
            <td class="constants-col-category">
                <select class="constants-input" id="edit-cat-${c.id}"
                        aria-label="${t('constantCategory')}">
                    ${catOptions}
                </select>
            </td>
            <td class="constants-col-source">
                <input type="text" class="constants-input"
                       id="edit-source-${c.id}"
                       value="${_escHtml(c.source || '')}" maxlength="200"
                       placeholder="${t('constantSource')}"
                       aria-label="${t('constantSource')}">
                <div class="constants-validity-inputs">
                    <input type="date" class="constants-input constants-input-date"
                           id="edit-validfrom-${c.id}"
                           value="${c.validFrom || ''}"
                           title="${t('constantValidFrom') || 'Válido a partir de'}"
                           aria-label="${t('constantValidFrom') || 'Válido a partir de'}">
                    <span class="constants-date-sep">&#8594;</span>
                    <input type="date" class="constants-input constants-input-date"
                           id="edit-validto-${c.id}"
                           value="${c.validTo || ''}"
                           title="${t('constantValidTo') || 'Válido até'}"
                           aria-label="${t('constantValidTo') || 'Válido até'}">
                </div>
            </td>
            <td class="constants-col-actions">
                <div id="edit-errors-${c.id}" class="constants-errors" role="alert"></div>
                <button class="constants-btn-save"
                        onclick="handleSaveConstantRow('${c.id}')"
                        title="${t('save') || 'Salvar'}">
                    <span class="icon" data-icon="check"></span>
                </button>
                <button class="constants-btn-cancel"
                        onclick="handleCancelEditConstantRow()"
                        title="${t('cancel') || 'Cancelar'}">
                    <span class="icon" data-icon="x"></span>
                </button>
            </td>
        </tr>`;
}

// ----------------------------------------------------------------
// RENDER NEW ROW (for add)
// ----------------------------------------------------------------

/**
 * Render an empty row for adding a new constant.
 * Renderiza uma linha vazia no topo da tabela para adicionar nova constante.
 */
export function renderNewConstantRow() {
    const categories = CONFIG.CONSTANT_CATEGORIES || [];
    const unitOptions = (CONFIG.UNITS || [])
        .map((u) => `<option value="${u.id}">${u.symbol} — ${u.name}</option>`)
        .join('');

    const catOptions = categories
        .map((cat) => `<option value="${cat.id}">${t(cat.labelKey) || cat.id}</option>`)
        .join('');

    const tbody = document.querySelector('#constants-modal .constants-table tbody');
    if (!tbody) return;

    // Remove linha de "novo" existente, se houver
    const existing = document.getElementById('constants-new-row');
    if (existing) existing.remove();

    const tr = document.createElement('tr');
    tr.id = 'constants-new-row';
    tr.className = 'constants-row constants-row-editing';
    tr.setAttribute('role', 'row');
    tr.innerHTML = `
        <td class="constants-col-name">
            <input type="text" class="constants-input"
                   id="new-name" maxlength="120"
                   placeholder="${t('constantName')}"
                   aria-label="${t('constantName')}">
            <input type="text" class="constants-input constants-input-desc"
                   id="new-desc" maxlength="500"
                   placeholder="${t('constantDescription')}"
                   aria-label="${t('constantDescription')}">
        </td>
        <td class="constants-col-symbol">
            <input type="text" class="constants-input constants-input-mono"
                   id="new-symbol" maxlength="32"
                   placeholder="EF_CO2"
                   aria-label="${t('constantSymbol')}">
        </td>
        <td class="constants-col-value">
            <input type="number" class="constants-input constants-input-value"
                   id="new-value" step="any"
                   placeholder="0"
                   aria-label="${t('constantValue')}">
            <button type="button" class="btn btn-link btn-sm uncertainty-toggle-btn"
                    onclick="this.style.display='none';this.nextElementSibling.style.display=''"
                    style="margin-top:4px">+ &#177; ${t('constantUncertainty') || 'Uncertainty'}</button>
            <div class="constants-uncertainty-group" style="display:none">
                <div class="constants-unc-row">
                    <input type="number" class="constants-input" id="new-uncertainty"
                           step="any" min="0" placeholder="&#177;"
                           title="${t('uncertaintyTooltip')}" aria-label="${t('constantUncertainty')}">
                    <select class="constants-input constants-input-unc-type" id="new-unctype"
                            aria-label="${t('constantUncertaintyType')}">
                        <option value="" disabled selected>${t('selectUncertaintyType')}</option>
                        <option value="absolute">${t('uncertaintyAbsoluteLabel')}</option>
                        <option value="relative">${t('uncertaintyRelativeLabel')}</option>
                    </select>
                    <a href="#" class="constants-k-toggle" onclick="this.nextElementSibling.style.display='inline';this.style.display='none';return false"
                       title="${t('coverageFactorTooltip')}">k=2</a>
                    <input type="number" class="constants-input constants-input-k" id="new-coveragefactor"
                           step="any" min="0.1" placeholder="k"
                           title="${t('coverageFactorTooltip')}" aria-label="${t('coverageFactor')}"
                           style="display:none">
                </div>
            </div>
        </td>
        <td class="constants-col-unit">
            <select class="constants-input" id="new-unit"
                    aria-label="${t('constantUnit')}">
                <option value="">—</option>
                ${unitOptions}
            </select>
        </td>
        <td class="constants-col-category">
            <select class="constants-input" id="new-cat"
                    aria-label="${t('constantCategory')}">
                ${catOptions}
            </select>
        </td>
        <td class="constants-col-source">
            <input type="text" class="constants-input"
                   id="new-source" maxlength="200"
                   placeholder="${t('constantSource')}"
                   aria-label="${t('constantSource')}">
            <div class="constants-validity-inputs">
                <input type="date" class="constants-input constants-input-date"
                       id="new-validfrom"
                       title="${t('constantValidFrom') || 'Válido a partir de'}"
                       aria-label="${t('constantValidFrom') || 'Válido a partir de'}">
                <span class="constants-date-sep">&#8594;</span>
                <input type="date" class="constants-input constants-input-date"
                       id="new-validto"
                       title="${t('constantValidTo') || 'Válido até'}"
                       aria-label="${t('constantValidTo') || 'Válido até'}">
            </div>
        </td>
        <td class="constants-col-actions">
            <div id="new-errors" class="constants-errors" role="alert"></div>
            <button class="constants-btn-save"
                    onclick="handleSaveNewConstantRow()"
                    title="${t('save') || 'Salvar'}">
                <span class="icon" data-icon="check"></span>
            </button>
            <button class="constants-btn-cancel"
                    onclick="handleCancelNewConstantRow()"
                    title="${t('cancel') || 'Cancelar'}">
                <span class="icon" data-icon="x"></span>
            </button>
        </td>
    `;

    tbody.prepend(tr);
    hydrateIcons(tr);
    document.getElementById('new-name')?.focus();
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

/**
 * Format validFrom / validTo for display.
 * Formata o intervalo de validade para exibicao na tabela.
 * @param {string|null} from
 * @param {string|null} to
 * @returns {string}
 */
function _formatValidity(from, to) {
    const f = from || '…';
    const t_ = to || '…';
    return `${f} &#8594; ${t_}`;
}

/**
 * Apply search query and category filter, then sort.
 * Filtra e ordena as constantes conforme estado atual.
 * @returns {Object[]}
 */
function _getFilteredSorted() {
    let list = getUserConstants();

    if (_searchQuery) {
        const q = _searchQuery.toLowerCase();
        list = list.filter(
            (c) =>
                c.name.toLowerCase().includes(q) ||
                c.symbol.toLowerCase().includes(q) ||
                (c.description || '').toLowerCase().includes(q),
        );
    }

    if (_filterCategory) {
        list = list.filter((c) => c.category === _filterCategory);
    }

    list.sort((a, b) => {
        let va = a[_sortColumn] ?? '';
        let vb = b[_sortColumn] ?? '';
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        if (va < vb) return _sortDirection === 'asc' ? -1 : 1;
        if (va > vb) return _sortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    return list;
}

function _getUnitLabel(unitId) {
    if (!unitId) return '—';
    const u = (CONFIG.UNITS || []).find((u) => u.id === unitId);
    return u ? u.symbol : unitId;
}

function _getCategoryLabel(catId, categories) {
    const cat = categories.find((c) => c.id === catId);
    return cat ? t(cat.labelKey) || cat.id : catId || '—';
}

function _hasPostProcessing(id) {
    try {
        const { getCalculatorItems } = window.__ecbyts_calculator || {};
        if (typeof getCalculatorItems !== 'function') return false;
        return getCalculatorItems().some(
            (item) => Array.isArray(item.postProcessing) && item.postProcessing.some((p) => p.constantId === id),
        );
    } catch {
        return false;
    }
}

function _escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ----------------------------------------------------------------
// SETTER — used by handlers
// ----------------------------------------------------------------

export function setConstantsSearch(q) {
    _searchQuery = q;
}
export function setConstantsFilterCategory(cat) {
    _filterCategory = cat;
}
export function setConstantsSortBy(col) {
    if (_sortColumn === col) {
        _sortDirection = _sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        _sortColumn = col;
        _sortDirection = 'asc';
    }
}
export function setConstantsEditingId(id) {
    _editingId = id;
}
export function getConstantsEditingId() {
    return _editingId;
}

/**
 * Show inline validation errors in the editing row.
 * Exibe erros de validacao na linha de edicao.
 *
 * @param {string} rowId - 'new' or constant id
 * @param {string[]} errors - i18n error keys
 */
export function showConstantErrors(rowId, errors) {
    const el = document.getElementById(rowId === 'new' ? 'new-errors' : `edit-errors-${rowId}`);
    if (!el) return;
    el.innerHTML = errors.map((e) => `<span class="constants-error">${t(e) || e}</span>`).join('<br>');
}

/**
 * Show a delete confirmation dialog listing dependent metrics.
 * Exibe dialogo de confirmacao de remocao com lista de dependentes.
 *
 * @param {string} id - Constant ID
 * @param {Array} dependents - [{ id, name }]
 */
export function showRemoveConstantConfirm(id, dependents) {
    const c = getUserConstants().find((c) => c.id === id);
    const name = c ? c.name : id;
    const depList = dependents.map((d) => `<li>${_escHtml(d.name)}</li>`).join('');

    const msg = `${t('confirmRemoveConstant')}: <strong>${_escHtml(name)}</strong><br>
        ${t('constantUsedInMetrics')}:<ul>${depList}</ul>
        ${t('removeConstantAnyway')}?`;

    if (window.asyncConfirm) {
        window.asyncConfirm(msg).then((confirmed) => {
            if (confirmed) {
                forceRemoveUserConstant(id);
                renderConstantsModal();
                if (_updateAllUI) _updateAllUI();
            }
        });
    } else if (confirm(msg.replace(/<[^>]*>/g, ''))) {
        forceRemoveUserConstant(id);
        renderConstantsModal();
        if (_updateAllUI) _updateAllUI();
    }
}
