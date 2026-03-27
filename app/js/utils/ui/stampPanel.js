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
   PAINEL DE ESTAMPAS (STAMP PANEL)
   ================================================================

   UI para visualizar e gerenciar estampas de elementos.
   Exibe estampas por categoria com opcoes de adicionar/remover.

   FUNCIONALIDADES:
   - Listar estampas do elemento selecionado
   - Adicionar novas estampas via modal
   - Remover estampas existentes
   - Filtrar por categoria

   ================================================================ */

import { t } from '../i18n/translations.js';
import { getIcon } from './icons.js';
import { showToast } from './toast.js';
import { openModal, closeModal } from './modals.js';
import { asyncConfirm } from './asyncDialogs.js';
import {
    STAMP_CATEGORIES,
    STAMP_TYPES,
    getStampType,
    getStampTypesByCategory,
    validateStampValue,
} from '../stamps/types.js';
import {
    addStamp,
    removeStamp,
    getStamps,
    getStampSummary,
    hasResponsibleTechnical,
    hasDigitalSignature,
    getApprovalStatus,
} from '../stamps/manager.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

let currentElement = null;
let selectedCategory = null;
let selectedClassification = null; // null = all, 'passive', 'active'

// ----------------------------------------------------------------
// INICIALIZACAO
// ----------------------------------------------------------------

/**
 * Inicializa o painel de estampas.
 * Registra handlers globais.
 */
export function initStampPanel() {
    // Registrar handlers globais
    window.handleAddStampClick = handleAddStampClick;
    window.handleRemoveStamp = handleRemoveStamp;
    window.handleStampCategoryFilter = handleStampCategoryFilter;
    window.handleStampClassificationFilter = handleStampClassificationFilter;
    window.handlePendingClassification = handlePendingClassification;
    window.handleStampTypeSelect = handleStampTypeSelect;
    window.handleSaveStamp = handleSaveStamp;
    window.handleQuickClassification = handleQuickClassification;
    window.closeStampModal = () => closeModal('stamp-modal');
}

// ----------------------------------------------------------------
// RENDERIZACAO DO PAINEL
// ----------------------------------------------------------------

/**
 * Atualiza o painel de estampas para um elemento.
 * @param {Object} element - Elemento selecionado
 */
export function updateStampPanel(element) {
    // Resetar filtros ao trocar de elemento
    if (element !== currentElement) {
        selectedCategory = null;
        selectedClassification = null;
    }
    currentElement = element;

    const container = document.getElementById('stamp-panel-content');
    if (!container) return;

    if (!element) {
        container.innerHTML = `
            <p style="color: var(--neutral-500); font-size: 11px; padding: 12px;">
                Selecione um elemento para ver suas conexões.
            </p>
        `;
        return;
    }

    // Resumo passivo/ativo
    const summary = getStampSummary(element);

    // Renderizar cabecalho com info do elemento
    let html = `
        <div class="stamp-panel-header">
            <span class="stamp-element-name">${element.name}</span>
            <span class="stamp-element-family">${element.family}</span>
        </div>
    `;

    // Resumo de classificacao
    if (summary.passive > 0 || summary.active > 0) {
        html += `
            <div class="stamp-classification-summary">
                <span class="stamp-class-badge passive">${summary.passive} passivo${summary.passive !== 1 ? 's' : ''}</span>
                <span class="stamp-class-badge active">${summary.active} ativo${summary.active !== 1 ? 's' : ''}</span>
            </div>
        `;
    }

    // Verificacoes de governanca
    const hasRT = hasResponsibleTechnical(element);
    const hasSig = hasDigitalSignature(element);
    const approval = getApprovalStatus(element);

    html += `
        <div class="stamp-governance-status">
            <span class="governance-badge ${hasRT ? 'active' : ''}" title="Responsável Técnico">
                ${getIcon('hardhat', { size: '12px' })} RT ${hasRT ? getIcon('check', { size: '10px' }) : getIcon('x', { size: '10px' })}
            </span>
            <span class="governance-badge ${hasSig ? 'active' : ''}" title="Assinatura Digital">
                ${getIcon('pen-sign', { size: '12px' })} Assinado ${hasSig ? getIcon('check', { size: '10px' }) : getIcon('x', { size: '10px' })}
            </span>
            <span class="governance-badge ${approval.approved ? 'active' : ''}" title="Aprovação">
                ${getIcon('check-circle', { size: '12px' })} ${approval.status || 'Pendente'}
            </span>
        </div>
    `;

    // Filtros de classificacao
    html += `
        <div class="stamp-category-filters">
            <button type="button" class="stamp-filter-btn ${!selectedClassification ? 'active' : ''}"
                    onclick="handleStampClassificationFilter(null)">
                Todos
            </button>
            <button type="button" class="stamp-filter-btn stamp-filter-passive ${selectedClassification === 'passive' ? 'active' : ''}"
                    onclick="handleStampClassificationFilter('passive')">
                Passivos
            </button>
            <button type="button" class="stamp-filter-btn stamp-filter-active ${selectedClassification === 'active' ? 'active' : ''}"
                    onclick="handleStampClassificationFilter('active')">
                Ativos
            </button>
            <span class="stamp-filter-divider"></span>
            <button type="button" class="stamp-filter-btn ${!selectedCategory ? 'active' : ''}"
                    onclick="handleStampCategoryFilter(null)">
                Todas
            </button>
            ${Object.values(STAMP_CATEGORIES)
                .map(
                    (cat) => `
                <button type="button" class="stamp-filter-btn ${selectedCategory === cat.id ? 'active' : ''}"
                        onclick="handleStampCategoryFilter('${cat.id}')"
                        style="--cat-color: ${cat.color}">
                    ${getIcon(cat.icon, { size: '12px' })} ${cat.name}
                </button>
            `,
                )
                .join('')}
        </div>
    `;

    // Listar estampas por categoria e classificacao
    let stamps = getStamps(element, selectedCategory ? { category: selectedCategory } : {});
    if (selectedClassification) {
        stamps = stamps.filter((s) => s.classification === selectedClassification);
    }

    if (stamps.length === 0) {
        html += `
            <div class="stamp-empty">
                <p>Nenhuma estampa aplicada.</p>
            </div>
        `;
    } else {
        // Agrupar por categoria
        const grouped = {};
        stamps.forEach((stamp) => {
            if (!grouped[stamp.category]) {
                grouped[stamp.category] = [];
            }
            grouped[stamp.category].push(stamp);
        });

        for (const [category, categoryStamps] of Object.entries(grouped)) {
            const catInfo = STAMP_CATEGORIES[category];
            html += `
                <div class="stamp-category-section">
                    <div class="stamp-category-header" style="--cat-color: ${catInfo?.color || '#666'}">
                        ${getIcon(catInfo?.icon || 'tag', { size: '12px' })} ${catInfo?.name || category}
                    </div>
                    <div class="stamp-list">
                        ${categoryStamps.map((stamp) => renderStampItem(stamp)).join('')}
                    </div>
                </div>
            `;
        }
    }

    // Acoes rapidas: marcar como passivo/ativo
    html += `
        <div class="stamp-quick-actions">
            <button type="button" class="stamp-quick-btn passive" onclick="handleQuickClassification('Passivo Ambiental')">
                ${getIcon('alert-triangle', { size: '14px' })} Marcar Passivo
            </button>
            <button type="button" class="stamp-quick-btn active" onclick="handleQuickClassification('Ativo Ambiental')">
                ${getIcon('check-circle', { size: '14px' })} Marcar Ativo
            </button>
        </div>
    `;

    // Botao adicionar estampa completa
    html += `
        <div class="stamp-actions">
            <button type="button" class="btn btn-secondary" onclick="handleAddStampClick()">
                ${getIcon('plus', { size: '14px' })} Adicionar Outra Estampa
            </button>
        </div>
    `;

    container.innerHTML = html;
}

/**
 * Renderiza um item de estampa.
 * @param {Object} stamp - Estampa
 * @returns {string} HTML
 */
function renderStampItem(stamp) {
    const stampType = getStampType(stamp.type);
    const catInfo = STAMP_CATEGORIES[stamp.category];

    // Formatar valor para exibicao
    const valueDisplay = formatStampValue(stamp.value, stampType);

    const isActive = stamp.classification === 'active';

    return `
        <div class="stamp-item" data-stamp-id="${stamp.id}">
            <div class="stamp-item-header">
                <span class="stamp-icon">${getIcon(stampType?.icon || 'tag', { size: '14px' })}</span>
                <span class="stamp-name">${stampType?.name || stamp.type}</span>
                <span class="stamp-class-badge ${isActive ? 'active' : 'passive'}">${isActive ? 'ATIVO' : 'PASSIVO'}</span>
                <button type="button" class="stamp-remove-btn" onclick="handleRemoveStamp('${stamp.id}')" title="Remover" aria-label="Remove">
                    ${getIcon('x', { size: '12px' })}
                </button>
            </div>
            <div class="stamp-item-value">
                ${valueDisplay}
            </div>
            <div class="stamp-item-meta">
                <span class="stamp-date">${formatDate(stamp.appliedAt)}</span>
                <span class="stamp-author">${stamp.appliedBy}</span>
                ${stamp.signature ? '<span class="stamp-signed">' + getIcon('pen-sign', { size: '10px' }) + '</span>' : ''}
            </div>
        </div>
    `;
}

/**
 * Formata valor de estampa para exibicao.
 * @param {Object} value - Valor da estampa
 * @param {Object} stampType - Tipo da estampa
 * @returns {string}
 */
function formatStampValue(value, stampType) {
    if (!value || typeof value !== 'object') {
        return String(value || '-');
    }

    const schema = stampType?.schema || {};
    const parts = [];

    for (const [key, val] of Object.entries(value)) {
        if (val === undefined || val === null || val === '') continue;

        const fieldSchema = schema[key];
        const label = fieldSchema?.label || key;

        if (fieldSchema?.type === 'enum') {
            parts.push(`<strong>${label}:</strong> ${val}`);
        } else if (fieldSchema?.type === 'date' || fieldSchema?.type === 'datetime') {
            parts.push(`<strong>${label}:</strong> ${formatDate(val)}`);
        } else if (fieldSchema?.type === 'boolean') {
            parts.push(`<strong>${label}:</strong> ${val ? 'Sim' : 'Não'}`);
        } else {
            parts.push(`<strong>${label}:</strong> ${val}`);
        }
    }

    return parts.join('<br>') || '-';
}

/**
 * Formata data para exibicao.
 * @param {string} isoDate - Data ISO8601
 * @returns {string}
 */
function formatDate(isoDate) {
    if (!isoDate) return '-';
    try {
        const date = new Date(isoDate);
        return date.toLocaleDateString('pt-BR');
    } catch {
        return isoDate;
    }
}

// ----------------------------------------------------------------
// HANDLERS
// ----------------------------------------------------------------

/**
 * Handler para filtro de categoria.
 * @param {string|null} category - Categoria ou null para todas
 */
function handleStampCategoryFilter(category) {
    selectedCategory = category;
    updateStampPanel(currentElement);
}

/**
 * Handler para filtro de classificacao (passivo/ativo).
 * @param {string|null} classification - 'passive', 'active', ou null para todos
 */
function handleStampClassificationFilter(classification) {
    selectedClassification = classification;
    updateStampPanel(currentElement);
}

/**
 * Handler para selecao de classificacao no modal (antes de escolher tipo).
 * @param {string} classification - 'passive' ou 'active'
 */
function handlePendingClassification(classification) {
    pendingClassification = classification;
    // Atualizar visual dos botoes no modal
    const btns = document.querySelectorAll('.stamp-class-select-btn');
    btns.forEach((btn) => {
        btn.classList.toggle('selected', btn.dataset.classification === classification);
    });
}

/**
 * Quick-add: marca elemento como Passivo ou Ativo Ambiental com um clique.
 * Cria uma estampa 'environmental_classification' automaticamente.
 * @param {string} classificationType - 'Passivo Ambiental' ou 'Ativo Ambiental'
 */
function handleQuickClassification(classificationType) {
    if (!currentElement) {
        showToast('Selecione um elemento primeiro', 'error');
        return;
    }

    const classification = classificationType === 'Ativo Ambiental' ? 'active' : 'passive';

    const result = addStamp(
        currentElement,
        'environmental_classification',
        {
            type: classificationType,
            description: '',
        },
        {
            appliedBy: 'user',
            classification,
        },
    );

    if (result.success) {
        showToast(`Marcado como ${classificationType}`, 'success');
        updateStampPanel(currentElement);
    } else {
        showToast(result.errors?.join('\n') || 'Erro ao adicionar', 'error');
    }
}

/**
 * Handler para botao adicionar estampa.
 */
function handleAddStampClick() {
    if (!currentElement) {
        showToast('Selecione um elemento primeiro', 'error');
        return;
    }

    // Abrir modal de adicionar estampa
    openAddStampModal();
}

/**
 * Handler para remover estampa.
 * @param {string} stampId - ID da estampa
 */
async function handleRemoveStamp(stampId) {
    if (!currentElement) return;

    if (!(await asyncConfirm('Remover esta estampa?'))) return;

    const result = removeStamp(currentElement, stampId);

    if (result.success) {
        showToast('Estampa removida', 'success');
        updateStampPanel(currentElement);
    } else {
        showToast(result.error || 'Erro ao remover', 'error');
    }
}

// ----------------------------------------------------------------
// MODAL DE ADICIONAR ESTAMPA
// ----------------------------------------------------------------

let selectedStampType = null;
let pendingClassification = 'passive'; // Carried from type selector to form

/**
 * Abre modal para adicionar estampa.
 */
function openAddStampModal() {
    selectedStampType = null;
    pendingClassification = 'passive';

    const modalContent = document.getElementById('stamp-modal-content');
    if (modalContent) {
        modalContent.innerHTML = renderStampTypeSelector();
    }

    openModal('stamp-modal');
}

/**
 * Renderiza seletor de tipo de estampa.
 * @returns {string} HTML
 */
function renderStampTypeSelector() {
    let html = `
        <div class="stamp-modal-header">
            <h3>Adicionar Estampa</h3>
            <p>Selecione o tipo de estampa para <strong>${currentElement?.name}</strong></p>
        </div>
        <div class="stamp-class-selector">
            <label class="stamp-class-selector-label">Classificação:</label>
            <button type="button"
                    class="stamp-class-select-btn ${pendingClassification === 'passive' ? 'selected' : ''} passive"
                    data-classification="passive"
                    onclick="handlePendingClassification('passive')">
                Passivo
            </button>
            <button type="button"
                    class="stamp-class-select-btn ${pendingClassification === 'active' ? 'selected' : ''} active"
                    data-classification="active"
                    onclick="handlePendingClassification('active')">
                Ativo
            </button>
        </div>
        <div class="stamp-type-grid">
    `;

    for (const [catId, catInfo] of Object.entries(STAMP_CATEGORIES)) {
        const types = getStampTypesByCategory(catId);

        html += `
            <div class="stamp-type-category">
                <div class="stamp-type-category-header" style="--cat-color: ${catInfo.color}">
                    ${getIcon(catInfo.icon, { size: '14px' })} ${catInfo.name}
                </div>
                <div class="stamp-type-list">
                    ${types
                        .map(
                            (type) => `
                        <button type="button" class="stamp-type-btn" onclick="handleStampTypeSelect('${type.id}')">
                            <span class="stamp-type-icon">${getIcon(type.icon, { size: '18px' })}</span>
                            <span class="stamp-type-name">${type.name}</span>
                        </button>
                    `,
                        )
                        .join('')}
                </div>
            </div>
        `;
    }

    html += `</div>`;
    return html;
}

/**
 * Handler para selecao de tipo de estampa.
 * @param {string} typeId - ID do tipo
 */
function handleStampTypeSelect(typeId) {
    if (!typeId) {
        selectedStampType = null;
        const modalContent = document.getElementById('stamp-modal-content');
        if (modalContent) {
            modalContent.innerHTML = renderStampTypeSelector();
        }
        return;
    }

    selectedStampType = getStampType(typeId);
    if (!selectedStampType) return;

    const modalContent = document.getElementById('stamp-modal-content');
    if (modalContent) {
        modalContent.innerHTML = renderStampForm(selectedStampType);
    }
}

/**
 * Renderiza formulario para preencher estampa.
 * @param {Object} stampType - Tipo de estampa
 * @returns {string} HTML
 */
function renderStampForm(stampType) {
    const catInfo = STAMP_CATEGORIES[stampType.category];

    let html = `
        <div class="stamp-modal-header">
            <button type="button" class="stamp-back-btn" onclick="handleStampTypeSelect(null)">
                ← Voltar
            </button>
            <h3>${getIcon(stampType.icon, { size: '18px' })} ${stampType.name}</h3>
            <p>${stampType.description}</p>
            <span class="stamp-category-badge" style="--cat-color: ${catInfo?.color}">
                ${getIcon(catInfo?.icon || 'tag', { size: '12px' })} ${catInfo?.name}
            </span>
        </div>
        <form id="stamp-form" class="stamp-form">
    `;

    // Classificacao passivo/ativo (pre-seleciona da escolha no seletor de tipos)
    const isPendingActive = pendingClassification === 'active';
    html += `
        <div class="form-group">
            <label class="form-label">Classificação</label>
            <div class="stamp-classification-toggle">
                <label class="stamp-class-option">
                    <input type="radio" name="stamp-classification" value="passive" ${!isPendingActive ? 'checked' : ''}>
                    <span class="stamp-class-label passive">Passivo</span>
                </label>
                <label class="stamp-class-option">
                    <input type="radio" name="stamp-classification" value="active" ${isPendingActive ? 'checked' : ''}>
                    <span class="stamp-class-label active">Ativo</span>
                </label>
            </div>
        </div>
    `;

    // Renderizar campos do schema
    for (const [fieldId, fieldSchema] of Object.entries(stampType.schema)) {
        html += renderFormField(fieldId, fieldSchema);
    }

    html += `
        </form>
        <div class="stamp-modal-actions">
            <button type="button" class="btn btn-secondary" onclick="closeStampModal()">
                Cancelar
            </button>
            <button type="button" class="btn btn-primary" onclick="handleSaveStamp()">
                Salvar Estampa
            </button>
        </div>
    `;

    return html;
}

/**
 * Renderiza campo de formulario.
 * @param {string} fieldId - ID do campo
 * @param {Object} schema - Schema do campo
 * @returns {string} HTML
 */
function renderFormField(fieldId, schema) {
    const required = schema.required ? 'required' : '';
    const label = schema.label || fieldId;

    let input = '';

    switch (schema.type) {
        case 'string':
            input = `<input type="text" class="form-input" name="${fieldId}" ${required}>`;
            break;

        case 'text':
            input = `<textarea class="form-input" name="${fieldId}" rows="3" ${required}></textarea>`;
            break;

        case 'number':
            const min = schema.min !== undefined ? `min="${schema.min}"` : '';
            const max = schema.max !== undefined ? `max="${schema.max}"` : '';
            input = `<input type="number" class="form-input" name="${fieldId}" ${min} ${max} ${required}>`;
            break;

        case 'boolean':
            input = `
                <select class="form-input" name="${fieldId}" ${required}>
                    <option value="">-- Selecione --</option>
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                </select>
            `;
            break;

        case 'enum':
            const options = schema.options || [];
            input = `
                <select class="form-input" name="${fieldId}" ${required}>
                    <option value="">-- Selecione --</option>
                    ${options.map((opt) => `<option value="${opt}">${opt}</option>`).join('')}
                </select>
            `;
            break;

        case 'date':
            input = `<input type="date" class="form-input" name="${fieldId}" ${required}>`;
            break;

        case 'datetime':
            input = `<input type="datetime-local" class="form-input" name="${fieldId}" ${required}>`;
            break;

        default:
            input = `<input type="text" class="form-input" name="${fieldId}" ${required}>`;
    }

    return `
        <div class="form-group">
            <label class="form-label">
                ${label}
                ${schema.required ? '<span class="required">*</span>' : ''}
            </label>
            ${input}
        </div>
    `;
}

/**
 * Handler para salvar estampa.
 */
function handleSaveStamp() {
    if (!currentElement || !selectedStampType) return;

    const form = document.getElementById('stamp-form');
    if (!form) return;

    // Coletar valores do formulario
    const formData = new FormData(form);
    const value = {};

    for (const [key, val] of formData.entries()) {
        if (val === '' || key === 'stamp-classification') continue;

        // Converter tipos
        const fieldSchema = selectedStampType.schema[key];
        if (fieldSchema?.type === 'number') {
            value[key] = parseFloat(val);
        } else if (fieldSchema?.type === 'boolean') {
            value[key] = val === 'true';
        } else {
            value[key] = val;
        }
    }

    // Validar
    const validation = validateStampValue(selectedStampType.id, value);
    if (!validation.valid) {
        showToast(validation.errors.join('\n'), 'error');
        return;
    }

    // Ler classificacao
    const classRadio = form.querySelector('input[name="stamp-classification"]:checked');
    const classification = classRadio?.value || 'passive';

    // Adicionar estampa
    const result = addStamp(currentElement, selectedStampType.id, value, {
        appliedBy: 'user',
        classification,
    });

    if (result.success) {
        showToast('Estampa adicionada!', 'success');
        closeModal('stamp-modal');
        updateStampPanel(currentElement);
    } else {
        showToast(result.errors?.join('\n') || 'Erro ao adicionar', 'error');
    }
}

// ----------------------------------------------------------------
// ESTILOS (injetados no head)
// ----------------------------------------------------------------

/**
 * Injeta estilos CSS do painel de estampas.
 */
export function injectStampStyles() {
    if (document.getElementById('stamp-panel-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'stamp-panel-styles';
    styles.textContent = `
        /* Painel de estampas */
        .stamp-panel-header {
            padding: 12px;
            border-bottom: 1px solid var(--neutral-200);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .stamp-element-name {
            font-weight: 600;
            font-size: 13px;
        }
        .stamp-element-family {
            font-size: 11px;
            color: var(--neutral-500);
            background: var(--neutral-100);
            padding: 2px 6px;
            border-radius: 4px;
        }

        /* Status de governanca */
        .stamp-governance-status {
            display: flex;
            gap: 8px;
            padding: 8px 12px;
            background: var(--neutral-50);
            border-bottom: 1px solid var(--neutral-200);
        }
        .governance-badge {
            font-size: 10px;
            padding: 4px 8px;
            border-radius: 4px;
            background: var(--neutral-200);
            color: var(--neutral-600);
        }
        .governance-badge.active {
            background: var(--success-bg);
            color: var(--success);
        }

        /* Filtros de categoria */
        .stamp-category-filters {
            display: flex;
            gap: 4px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--neutral-200);
            overflow-x: auto;
        }
        .stamp-filter-btn {
            font-size: 10px;
            padding: 4px 8px;
            border: 1px solid var(--neutral-200);
            border-radius: 4px;
            background: white;
            cursor: pointer;
            white-space: nowrap;
        }
        .stamp-filter-btn:hover {
            background: var(--neutral-100);
        }
        .stamp-filter-btn.active {
            background: var(--cat-color, var(--primary));
            color: white;
            border-color: transparent;
        }

        /* Secao de categoria */
        .stamp-category-section {
            margin: 8px;
        }
        .stamp-category-header {
            font-size: 11px;
            font-weight: 600;
            color: var(--cat-color, var(--neutral-600));
            padding: 4px 0;
            border-bottom: 2px solid var(--cat-color, var(--neutral-300));
            margin-bottom: 8px;
        }

        /* Lista de estampas */
        .stamp-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .stamp-item {
            background: white;
            border: 1px solid var(--neutral-200);
            border-radius: 6px;
            padding: 8px;
        }
        .stamp-item:hover {
            border-color: var(--primary);
        }
        .stamp-item-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;
        }
        .stamp-icon {
            font-size: 14px;
        }
        .stamp-name {
            font-weight: 500;
            font-size: 11px;
            flex: 1;
        }
        .stamp-remove-btn {
            width: 18px;
            height: 18px;
            border: none;
            background: var(--neutral-100);
            color: var(--neutral-500);
            border-radius: 50%;
            cursor: pointer;
            font-size: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .stamp-remove-btn:hover {
            background: var(--danger);
            color: white;
        }
        .stamp-item-value {
            font-size: 10px;
            color: var(--neutral-700);
            line-height: 1.4;
        }
        .stamp-item-meta {
            display: flex;
            gap: 8px;
            margin-top: 6px;
            font-size: 9px;
            color: var(--neutral-500);
        }
        .stamp-signed {
            color: var(--success);
        }

        /* Estado vazio */
        .stamp-empty {
            padding: 24px;
            text-align: center;
            color: var(--neutral-500);
            font-size: 11px;
        }

        /* Acoes */
        .stamp-actions {
            padding: 12px;
            border-top: 1px solid var(--neutral-200);
        }

        /* Modal de estampas */
        .stamp-modal-header {
            padding: 16px;
            border-bottom: 1px solid var(--neutral-200);
        }
        .stamp-modal-header h3 {
            margin: 0 0 4px 0;
            font-size: 16px;
        }
        .stamp-modal-header p {
            margin: 0;
            font-size: 12px;
            color: var(--neutral-600);
        }
        .stamp-back-btn {
            background: none;
            border: none;
            color: var(--primary);
            cursor: pointer;
            font-size: 12px;
            padding: 0;
            margin-bottom: 8px;
        }
        .stamp-category-badge {
            display: inline-block;
            font-size: 10px;
            padding: 2px 8px;
            border-radius: 4px;
            background: var(--cat-color, var(--neutral-200));
            color: white;
            margin-top: 8px;
        }

        /* Grid de tipos */
        .stamp-type-grid {
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            max-height: 400px;
            overflow-y: auto;
        }
        .stamp-type-category-header {
            font-size: 12px;
            font-weight: 600;
            color: var(--cat-color);
            margin-bottom: 8px;
        }
        .stamp-type-list {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
        }
        .stamp-type-btn {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 12px 8px;
            border: 1px solid var(--neutral-200);
            border-radius: 8px;
            background: white;
            cursor: pointer;
        }
        .stamp-type-btn:hover {
            border-color: var(--primary);
            background: var(--neutral-50);
        }
        .stamp-type-icon {
            font-size: 20px;
        }
        .stamp-type-name {
            font-size: 10px;
            text-align: center;
        }

        /* Formulario de estampa */
        .stamp-form {
            padding: 16px;
            max-height: 400px;
            overflow-y: auto;
        }
        .stamp-form .form-group {
            margin-bottom: 12px;
        }
        .stamp-form .form-label {
            font-size: 11px;
            font-weight: 500;
            margin-bottom: 4px;
            display: block;
        }
        .stamp-form .required {
            color: var(--danger);
        }
        .stamp-form .form-input {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--neutral-200);
            border-radius: 4px;
            font-size: 12px;
        }

        /* Acoes do modal */
        .stamp-modal-actions {
            padding: 12px 16px;
            border-top: 1px solid var(--neutral-200);
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }

        /* Classificacao passivo/ativo */
        .stamp-classification-summary {
            display: flex;
            gap: 8px;
            padding: 6px 12px;
            background: var(--neutral-50);
            border-bottom: 1px solid var(--neutral-200);
        }
        .stamp-class-badge {
            font-size: 9px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 3px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .stamp-class-badge.passive {
            background: #fef2f2;
            color: #dc2626;
            border: 1px solid #fecaca;
        }
        .stamp-class-badge.active {
            background: #f0fdf4;
            color: #16a34a;
            border: 1px solid #bbf7d0;
        }
        .stamp-filter-divider {
            width: 1px;
            background: var(--neutral-300);
            margin: 2px 4px;
        }
        .stamp-filter-passive.active {
            background: #dc2626 !important;
            color: white;
            border-color: transparent;
        }
        .stamp-filter-active.active {
            background: #16a34a !important;
            color: white;
            border-color: transparent;
        }

        /* Botoes rapidos passivo/ativo */
        .stamp-quick-actions {
            display: flex;
            gap: 8px;
            padding: 12px;
            border-top: 1px solid var(--neutral-200);
        }
        .stamp-quick-btn {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 10px 12px;
            border-radius: 6px;
            border: 2px solid;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
        }
        .stamp-quick-btn.passive {
            background: #fef2f2;
            border-color: #fecaca;
            color: #dc2626;
        }
        .stamp-quick-btn.passive:hover {
            background: #dc2626;
            color: white;
            border-color: #dc2626;
        }
        .stamp-quick-btn.active {
            background: #f0fdf4;
            border-color: #bbf7d0;
            color: #16a34a;
        }
        .stamp-quick-btn.active:hover {
            background: #16a34a;
            color: white;
            border-color: #16a34a;
        }

        /* Toggle no formulario — radio buttons com visual claro */
        .stamp-classification-toggle {
            display: flex;
            gap: 0;
            border: 2px solid var(--neutral-200);
            border-radius: 6px;
            overflow: hidden;
        }
        .stamp-class-option {
            display: flex;
            align-items: center;
            gap: 0;
            cursor: pointer;
            font-size: 12px;
            flex: 1;
        }
        .stamp-class-option input[type="radio"] {
            position: absolute;
            opacity: 0;
            width: 0;
            height: 0;
        }
        .stamp-class-label {
            display: block;
            width: 100%;
            text-align: center;
            font-size: 12px;
            font-weight: 600;
            padding: 8px 16px;
            transition: all 0.15s;
        }
        .stamp-class-label.passive {
            color: #dc2626;
            background: white;
        }
        .stamp-class-label.active {
            color: #16a34a;
            background: white;
        }
        .stamp-class-option input[type="radio"]:checked + .stamp-class-label.passive {
            background: #dc2626;
            color: white;
        }
        .stamp-class-option input[type="radio"]:checked + .stamp-class-label.active {
            background: #16a34a;
            color: white;
        }

        /* Seletor de classificacao no modal (tela de tipo) */
        .stamp-class-selector {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 16px;
            background: var(--neutral-50);
            border-bottom: 1px solid var(--neutral-200);
        }
        .stamp-class-selector-label {
            font-size: 11px;
            font-weight: 600;
            color: var(--neutral-600);
        }
        .stamp-class-select-btn {
            font-size: 12px;
            font-weight: 600;
            padding: 6px 16px;
            border-radius: 4px;
            border: 2px solid var(--neutral-200);
            background: white;
            cursor: pointer;
            transition: all 0.15s;
        }
        .stamp-class-select-btn.passive {
            color: #dc2626;
        }
        .stamp-class-select-btn.active {
            color: #16a34a;
        }
        .stamp-class-select-btn.passive.selected {
            background: #fef2f2;
            border-color: #dc2626;
        }
        .stamp-class-select-btn.active.selected {
            background: #f0fdf4;
            border-color: #16a34a;
        }
    `;

    document.head.appendChild(styles);
}
