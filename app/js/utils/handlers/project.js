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
   PROJECT HANDLERS — Project areas and organizational tree
   Handlers para areas do projeto e arvore organizacional

   "Areas" sao as divisoes fisicas ou funcionais de um site ambiental.
   A "arvore" organiza essas areas hierarquicamente.
   Ex: Fabrica > Setor de Manutencao > Almoxarifado
   ================================================================ */

import { t } from '../i18n/translations.js';
import { applyTranslations } from '../i18n/translations.js';
import { getIcon, hydrateIcons } from '../ui/icons.js';
import {
    getModelLinks,
    addInputLink,
    addOutputLink,
    removeInputLink,
    removeOutputLink,
    resetModelIdentity,
    generateModelId,
    getCorporateInputs,
    getCorporateOutputs,
    addCorporateInput,
    addCorporateOutput,
    removeCorporateInput,
    removeCorporateOutput,
    getCorporateTotals,
    INPUT_CATEGORIES,
    OUTPUT_CATEGORIES,
    COMMON_UNITS,
    exportCorporateIO,
    importCorporateIO,
} from '../../core/io/modelLink.js';
import { clearModelData, safeSetItem } from '../storage/storageMonitor.js';
import { escapeHtml, escapeAttr, escapeJsAttr } from '../helpers/html.js';
import { showToast } from '../ui/toast.js';
import { getAllElements, getMeshByElementId, addElement, nextElementCounter } from '../../core/elements/manager.js';
import { getAllCampaigns } from '../../core/campaigns/manager.js';
import { getCurrency } from '../../core/ingestion/documents/costCatalog.js';
import { generateId } from '../helpers/id.js';
import { asyncPrompt, asyncConfirm } from '../ui/asyncDialogs.js';

// ----------------------------------------------------------------
// REGISTRY TYPES — Tipos de cadastro fiscal/corporativo
// Identifica entidades juridicas nos nos da arvore organizacional.
// Brazil-first (CNPJ/CPF), seguido de LATAM e internacional.
// ----------------------------------------------------------------

const REGISTRY_TYPES = [
    { id: 'cnpj', label: 'CNPJ (BR)', placeholder: 'XX.XXX.XXX/XXXX-XX', personal: false },
    { id: 'cpf', label: 'CPF (BR)', placeholder: 'XXX.XXX.XXX-XX', personal: true },
    { id: 'ein', label: 'EIN (US)', placeholder: 'XX-XXXXXXX', personal: false },
    { id: 'vat', label: 'VAT (EU)', placeholder: 'XX000000000', personal: false },
    { id: 'duns', label: 'DUNS', placeholder: '00-000-0000', personal: false },
    { id: 'rfc', label: 'RFC (MX)', placeholder: 'AAAA000000XXX', personal: false },
    { id: 'cuit', label: 'CUIT (AR)', placeholder: 'XX-XXXXXXXX-X', personal: false },
    { id: 'rut', label: 'RUT (CL)', placeholder: 'XXXXXXXX-X', personal: false },
    { id: 'nit', label: 'NIT (CO)', placeholder: 'XXXXXXXXX-X', personal: false },
    { id: 'other', label: 'Other / Custom', placeholder: '', personal: false },
];

// ----------------------------------------------------------------
// DOCUMENT TYPES — Tipos de documento/intangivel vinculaveis aos nos
// Cada no pode ter multiplos documentos comprobarorios (contrato
// social, alvara, licenca ambiental, etc.) com hash SHA-256.
// ----------------------------------------------------------------

const DOCUMENT_TYPES = [
    { id: 'contrato_social', label: 'Contrato Social / Articles of Incorporation' },
    { id: 'alvara', label: 'Alvará de Funcionamento / Business License' },
    { id: 'licenca_previa', label: 'Licença Prévia (LP)' },
    { id: 'licenca_instalacao', label: 'Licença de Instalação (LI)' },
    { id: 'licenca_operacao', label: 'Licença de Operação (LO)' },
    { id: 'certidao_ambiental', label: 'Certidão Ambiental' },
    { id: 'cnd', label: 'CND (Certidão Negativa de Débitos)' },
    { id: 'seguro', label: 'Seguro Ambiental' },
    { id: 'outorga', label: 'Outorga de Uso de Água' },
    { id: 'other', label: 'Outro / Other' },
];

/**
 * Find a tree node by ID (recursive).
 * Busca um no da arvore pelo ID de forma recursiva.
 *
 * @param {string} nodeId
 * @param {Array} tree
 * @returns {Object|null}
 */
function findNodeById(nodeId, tree) {
    for (const node of tree) {
        if (node.id === nodeId) return node;
        if (Array.isArray(node.children)) {
            const found = findNodeById(nodeId, node.children);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Flatten the areas tree into a linear array.
 * Achata a arvore em lista plana (para dropdowns e buscas).
 *
 * @param {Array} nodes
 * @returns {Array}
 */
export function flattenAreasTree(nodes) {
    const result = [];
    function walk(node) {
        result.push(node);
        if (Array.isArray(node.children)) node.children.forEach(walk);
    }
    (nodes || []).forEach(walk);
    return result;
}

/**
 * Apply input mask for a given registry type.
 * Aplica mascara de formatacao ao numero de cadastro conforme o tipo.
 *
 * @param {string} type - Registry type ID
 * @param {string} raw  - Raw user input
 * @returns {string} Formatted string
 */
function applyRegistryMask(type, raw) {
    const d = raw.replace(/\D/g, '');
    switch (type) {
        case 'cnpj': {
            let v = d.slice(0, 14);
            if (v.length > 12)
                v =
                    v.slice(0, 2) +
                    '.' +
                    v.slice(2, 5) +
                    '.' +
                    v.slice(5, 8) +
                    '/' +
                    v.slice(8, 12) +
                    '-' +
                    v.slice(12);
            else if (v.length > 8) v = v.slice(0, 2) + '.' + v.slice(2, 5) + '.' + v.slice(5, 8) + '/' + v.slice(8);
            else if (v.length > 5) v = v.slice(0, 2) + '.' + v.slice(2, 5) + '.' + v.slice(5);
            else if (v.length > 2) v = v.slice(0, 2) + '.' + v.slice(2);
            return v;
        }
        case 'cpf': {
            let v = d.slice(0, 11);
            if (v.length > 9) v = v.slice(0, 3) + '.' + v.slice(3, 6) + '.' + v.slice(6, 9) + '-' + v.slice(9);
            else if (v.length > 6) v = v.slice(0, 3) + '.' + v.slice(3, 6) + '.' + v.slice(6);
            else if (v.length > 3) v = v.slice(0, 3) + '.' + v.slice(3);
            return v;
        }
        case 'ein': {
            let v = d.slice(0, 9);
            if (v.length > 2) v = v.slice(0, 2) + '-' + v.slice(2);
            return v;
        }
        case 'duns': {
            let v = d.slice(0, 9);
            if (v.length > 5) v = v.slice(0, 2) + '-' + v.slice(2, 5) + '-' + v.slice(5);
            else if (v.length > 2) v = v.slice(0, 2) + '-' + v.slice(2);
            return v;
        }
        case 'cuit': {
            let v = d.slice(0, 11);
            if (v.length > 10) v = v.slice(0, 2) + '-' + v.slice(2, 10) + '-' + v.slice(10);
            else if (v.length > 2) v = v.slice(0, 2) + '-' + v.slice(2);
            return v;
        }
        default:
            return raw.slice(0, 30);
    }
}

/**
 * Validate a registry number for the given type.
 * Valida o numero de cadastro conforme as regras do tipo.
 *
 * @param {string} type
 * @param {string} value - Already masked string
 * @returns {{ valid: boolean, message: string }}
 */
function validateRegistry(type, value) {
    const d = value.replace(/\D/g, '');
    if (!d) return { valid: true, message: '' };

    switch (type) {
        case 'cnpj': {
            if (d.length !== 14) return { valid: false, message: 'cnpjLength' };
            if (/^(\d)\1+$/.test(d)) return { valid: false, message: 'cnpjInvalid' };
            const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
            let s = 0;
            for (let i = 0; i < 12; i++) s += parseInt(d[i]) * w1[i];
            let r = s % 11;
            const c1 = r < 2 ? 0 : 11 - r;
            if (parseInt(d[12]) !== c1) return { valid: false, message: 'cnpjInvalid' };
            const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
            s = 0;
            for (let i = 0; i < 13; i++) s += parseInt(d[i]) * w2[i];
            r = s % 11;
            const c2 = r < 2 ? 0 : 11 - r;
            if (parseInt(d[13]) !== c2) return { valid: false, message: 'cnpjInvalid' };
            return { valid: true, message: '' };
        }
        case 'cpf': {
            if (d.length !== 11) return { valid: false, message: 'cpfLength' };
            if (/^(\d)\1+$/.test(d)) return { valid: false, message: 'cpfInvalid' };
            let s = 0;
            for (let i = 0; i < 9; i++) s += parseInt(d[i]) * (10 - i);
            let r = (s * 10) % 11;
            const c1 = r >= 10 ? 0 : r;
            if (parseInt(d[9]) !== c1) return { valid: false, message: 'cpfInvalid' };
            s = 0;
            for (let i = 0; i < 10; i++) s += parseInt(d[i]) * (11 - i);
            r = (s * 10) % 11;
            const c2 = r >= 10 ? 0 : r;
            if (parseInt(d[10]) !== c2) return { valid: false, message: 'cpfInvalid' };
            return { valid: true, message: '' };
        }
        case 'ein':
            return d.length === 9 ? { valid: true, message: '' } : { valid: false, message: 'einLength' };
        default:
            return { valid: true, message: '' };
    }
}

/**
 * Mask personal registry numbers for display in tree.
 * Para CPF: mostra ***.***. ***-XX (ultimos 2 digitos). Demais: completo.
 *
 * @param {string} type - Registry type ID
 * @param {string} number - Full registry number
 * @returns {string} Masked or full display string
 */
function maskPersonalRegistry(type, number) {
    if (!number || !number.trim()) return '';
    const entry = REGISTRY_TYPES.find((r) => r.id === type);
    if (!entry?.personal) return number;
    const d = number.replace(/\D/g, '');
    if (type === 'cpf' && d.length >= 2) {
        return `***.***. ***-${d.slice(-2)}`;
    }
    return '***';
}

/**
 * Count elements linked to a specific tree node via data.areaId.
 * Conta quantos elementos 3D estao vinculados a um no da arvore.
 *
 * @param {string} nodeId
 * @returns {number}
 */
function getLinkedElementCount(nodeId) {
    const elements = getAllElements() || [];
    return elements.filter((el) => el.data?.areaId === nodeId).length;
}

// ----------------------------------------------------------------
// PROJECT AREAS
// Areas e subareas do projeto (divisoes do terreno).
// Ex: Area de Remediacao, Area de Monitoramento, etc.
// ----------------------------------------------------------------

/**
 * Initialize project areas with default data.
 * Inicializa as areas do projeto. Se nao existirem, cria uma vazia.
 */
export function initProjectAreas() {
    if (!Array.isArray(window.projectAreas) || window.projectAreas.length === 0) {
        window.projectAreas = [{ area: '', subarea: '' }];
    }
    renderProjectAreas();
}

/**
 * Render the project areas list in the UI.
 * Desenha a lista de areas na interface.
 * Cada area tem um campo de texto para nome e subarea.
 */
export function renderProjectAreas() {
    const container = document.getElementById('project-areas-list');
    if (!container) return;

    if (!Array.isArray(window.projectAreas) || window.projectAreas.length === 0) {
        window.projectAreas = [{ area: '', subarea: '' }];
    }

    container.innerHTML = window.projectAreas
        .map(
            (entry, index) => `
        <div class="project-area-row" data-project-area-row>
            <div class="form-group">
                <label class="form-label" data-i18n="projectArea">Area</label>
                <input type="text"
                       class="form-input"
                       data-project-area
                       data-i18n-placeholder="projectAreaPlaceholder"
                       placeholder="Project area"
                       value="${entry.area || ''}"
                       oninput="window.handleProjectAreaChange(${index}, 'area', this.value)">
            </div>
            <div class="form-group">
                <label class="form-label" data-i18n="projectSubarea">Subarea</label>
                <input type="text"
                       class="form-input"
                       data-project-subarea
                       data-i18n-placeholder="projectSubareaPlaceholder"
                       placeholder="Project subarea"
                       value="${entry.subarea || ''}"
                       oninput="window.handleProjectAreaChange(${index}, 'subarea', this.value)">
            </div>
            <button type="button"
                    class="btn btn-icon btn-danger project-area-remove"
                    title="${t('delete')}"
                    onclick="window.handleRemoveProjectArea(${index})"
                    aria-label="Remove">
                <span data-icon="x" data-icon-size="12px"></span>
            </button>
        </div>
    `,
        )
        .join('');

    hydrateIcons(container);
    applyTranslations();
}

/**
 * Add a new empty project area.
 * Adiciona uma nova area vazia ao projeto.
 */
export function handleAddProjectArea() {
    if (!Array.isArray(window.projectAreas)) {
        window.projectAreas = [];
    }
    window.projectAreas.push({ area: '', subarea: '' });
    renderProjectAreas();
}

/**
 * Remove a project area by index.
 * Remove uma area do projeto. Mantem pelo menos uma area vazia.
 *
 * @param {number} index - Index of the area to remove
 */
export function handleRemoveProjectArea(index) {
    if (!Array.isArray(window.projectAreas)) return;
    window.projectAreas.splice(index, 1);
    if (window.projectAreas.length === 0) {
        window.projectAreas.push({ area: '', subarea: '' });
    }
    renderProjectAreas();
}

/**
 * Update a field in a project area.
 * Atualiza um campo (area ou subarea) de uma area do projeto.
 *
 * @param {number} index - Area index
 * @param {string} field - 'area' or 'subarea'
 * @param {string} value - New value
 */
export function handleProjectAreaChange(index, field, value) {
    if (!Array.isArray(window.projectAreas) || !window.projectAreas[index]) return;
    window.projectAreas[index] = { ...window.projectAreas[index], [field]: value };
}

/**
 * Set all project areas at once (used by import).
 * Define todas as areas do projeto de uma vez (usado na importacao).
 *
 * @param {Array} areas - Array of { area, subarea } objects
 */
export function setProjectAreas(areas) {
    if (Array.isArray(areas) && areas.length > 0) {
        window.projectAreas = areas.map((entry) => ({
            area: entry?.area || '',
            subarea: entry?.subarea || '',
        }));
    } else {
        window.projectAreas = [{ area: '', subarea: '' }];
    }
    renderProjectAreas();
}

// ----------------------------------------------------------------
// AREAS TREE VIEW
// Arvore hierarquica de areas (visualizacao em arvore).
// Organiza as areas em niveis: controladora > area > subarea.
// ----------------------------------------------------------------

/**
 * Initialize the areas tree with default demo data.
 * Inicializa a arvore de areas. Se nao existir, cria dados de exemplo.
 */
export function initAreasTree() {
    if (!Array.isArray(window.areasTreeData)) {
        window.areasTreeData = [
            {
                id: 'controladora-1',
                name: 'Controladora Central',
                type: 'controller',
                badges: ['Operacional'],
                registryType: 'cnpj',
                registryNumber: '11.222.333/0001-81',
                expanded: true,
                children: [
                    {
                        id: 'manutencao',
                        name: 'Manutencao',
                        type: 'area',
                        badges: ['MRO'],
                        expanded: true,
                        children: [
                            { id: 'almoxarifado', name: 'Almoxarifado', type: 'subarea', badges: ['Operacional'] },
                            { id: 'ferramentaria', name: 'Ferramentaria', type: 'subarea', badges: ['Planejado'] },
                        ],
                    },
                    {
                        id: 'operacoes',
                        name: 'Operacoes',
                        type: 'area',
                        badges: ['Ativo'],
                        children: [
                            {
                                id: 'controle-qualidade',
                                name: 'Controle de Qualidade',
                                type: 'subarea',
                                badges: ['MRO'],
                            },
                        ],
                    },
                ],
            },
        ];
    }

    if (!window.areasTreeExpanded) {
        window.areasTreeExpanded = new Set();
        window.areasTreeData.forEach((node) => {
            if (node.expanded) window.areasTreeExpanded.add(node.id);
        });
    }

    renderAreasTree();
}

/**
 * Render the areas tree in the UI.
 * Desenha a arvore de areas na interface.
 */
export function renderAreasTree() {
    const container = document.getElementById('areas-tree');
    if (!container) return;
    if (!Array.isArray(window.areasTreeData)) return;

    container.innerHTML = window.areasTreeData.map((node) => renderTreeNode(node, 0)).join('');
}

/**
 * Render a single tree node recursively.
 * Desenha um no da arvore e seus filhos (recursivo).
 *
 * @param {Object} node - Tree node data
 * @param {number} level - Nesting depth (for indentation)
 * @returns {string} HTML string
 */
function renderTreeNode(node, level) {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const isExpanded = window.areasTreeExpanded?.has(node.id);
    const isActive = window.activeAreaNodeId === node.id;
    const icon = getAreaNodeIcon(node.type);
    const badges = Array.isArray(node.badges) ? node.badges : [];

    // Registry subtitle (mascarado para CPF, completo para demais)
    const registryDisplay = maskPersonalRegistry(node.registryType, node.registryNumber);
    const registryHtml = registryDisplay
        ? `<span class="areas-tree-registry">${escapeHtml(registryDisplay)}</span>`
        : '';

    // Contagem de elementos vinculados
    const linkedCount = getLinkedElementCount(node.id);
    const linkedBadge =
        linkedCount > 0
            ? `<span class="areas-tree-badge areas-tree-badge--count" title="${linkedCount} ${t('linkedElements') || 'elementos vinculados'}">${linkedCount}</span>`
            : '';

    // Contagem de documentos vinculados
    const docCount = Array.isArray(node.documents) ? node.documents.length : 0;
    const docBadge =
        docCount > 0
            ? `<span class="areas-tree-badge areas-tree-badge--docs" title="${docCount} ${t('documents') || 'documentos'}">${getIcon('file-new', { size: '10px' })}${docCount}</span>`
            : '';

    return `
        <div class="areas-tree-node" style="margin-left: ${level * 14}px">
            <div class="areas-tree-item ${isActive ? 'active' : ''}" data-area-node="${escapeAttr(node.id)}">
                <span class="areas-tree-chevron ${hasChildren && isExpanded ? 'expanded' : ''}"
                      data-area-chevron
                      onclick="window.toggleAreaNode('${escapeJsAttr(node.id)}', event)">
                    ${hasChildren ? '\u25B6' : ''}
                </span>
                <span class="areas-tree-icon">${icon}</span>
                <span class="areas-tree-label-block"
                      onclick="window.selectAreaNode('${escapeJsAttr(node.id)}')">
                    <span class="areas-tree-label">${escapeHtml(node.name)}</span>
                    ${registryHtml}
                </span>
                <span class="areas-tree-badges">
                    ${docBadge}
                    ${linkedBadge}
                    ${badges.map((badge) => `<span class="areas-tree-badge">${escapeHtml(badge)}</span>`).join('')}
                </span>
            </div>
            ${
                hasChildren
                    ? `
                <div class="areas-tree-children ${isExpanded ? '' : 'areas-tree-hidden'}">
                    ${node.children.map((child) => renderTreeNode(child, level + 1)).join('')}
                </div>
            `
                    : ''
            }
        </div>
    `;
}

/**
 * Get the icon for a tree node type.
 * Retorna o icone adequado para cada tipo de no.
 *
 * @param {string} type - Node type ('controller', 'area', 'subarea')
 * @returns {string} Icon character
 */
function getAreaNodeIcon(type) {
    switch (type) {
        case 'controller':
            return getIcon('building', { size: '14px' });
        case 'area':
            return getIcon('layers', { size: '14px' });
        case 'subarea':
        default:
            return getIcon('file-new', { size: '14px' });
    }
}

/**
 * Toggle tree node expansion.
 * Expande ou recolhe um no da arvore.
 *
 * @param {string} nodeId - Node ID
 * @param {Event} event - Click event
 */
export function toggleAreaNode(nodeId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!window.areasTreeExpanded) window.areasTreeExpanded = new Set();

    if (window.areasTreeExpanded.has(nodeId)) {
        window.areasTreeExpanded.delete(nodeId);
    } else {
        window.areasTreeExpanded.add(nodeId);
    }
    renderAreasTree();
}

/**
 * Select a tree node as active.
 * Marca um no como selecionado (ativo) na arvore.
 *
 * @param {string} nodeId - Node ID
 */
export function selectAreaNode(nodeId) {
    // Desselecionar se clicar no mesmo no
    if (window.activeAreaNodeId === nodeId) {
        window.activeAreaNodeId = null;
        renderAreasTree();
        renderAreaNodeDetail(null);
        clearElementHighlights();
        return;
    }
    window.activeAreaNodeId = nodeId;
    renderAreasTree();
    renderAreaNodeDetail(nodeId);
    highlightLinkedElements(nodeId);
}

/**
 * Set entire tree data (used by import).
 * Define toda a arvore de uma vez (usado na importacao).
 *
 * @param {Array} treeData - Array of tree node objects
 */
export function setAreasTree(treeData) {
    window.areasTreeData = Array.isArray(treeData) ? treeData : [];
    window.areasTreeExpanded = new Set();
    window.areasTreeData.forEach((node) => {
        if (node.expanded) window.areasTreeExpanded.add(node.id);
    });
    renderAreasTree();
}

// ----------------------------------------------------------------
// CORPORATE I/O — Registro de compras, vendas e relação com investidores
// Cada transação pode ser vinculada a elementos 3D e campanhas.
// ----------------------------------------------------------------

/** State para controlar seções colapsadas e formulários abertos */
const _cioCollapsed = { inputs: false, outputs: false, ir: false };
const _cioFormOpen = { input: false, output: false };

/**
 * Formata valor monetário.
 * @param {number} value
 * @returns {string}
 */
function _fmtCurrency(value) {
    const cur = getCurrency();
    return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: cur });
}

/**
 * Formata valor compacto (ex: R$ 42.8k).
 * @param {number} value
 * @returns {string}
 */
function _fmtCompact(value) {
    const cur = getCurrency();
    if (Math.abs(value) >= 1_000_000) return `${cur} ${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `${cur} ${(value / 1_000).toFixed(1)}k`;
    return _fmtCurrency(value);
}

/**
 * Render completo do registro corporativo (3 seções).
 * Substitui o antigo renderModelLinks().
 */
export function renderCorporateIO() {
    const container = document.getElementById('corporate-io-container');
    if (!container) return;

    let html = '';
    html += _renderInputsSection();
    html += _renderOutputsSection();
    html += _renderIRSection();

    container.innerHTML = html;
    hydrateIcons(container);
}

// Alias para retrocompatibilidade
export const renderModelLinks = renderCorporateIO;

// ---- SECTION 1: COMPRAS (INPUTS) ----

function _renderInputsSection() {
    const items = getCorporateInputs();
    const collapsed = _cioCollapsed.inputs;
    const total = items.reduce((s, i) => s + (i.totalCost || 0), 0);

    let html = `
        <div class="pio-section">
            <div class="pio-section-header" onclick="window.handleToggleCIOSection('inputs')">
                <span>${t('suppliesAcquired') || 'Compras / Insumos'} (${items.length})</span>
                <span class="pio-chevron">${collapsed ? '\u25B6' : '\u25BC'}</span>
            </div>`;

    if (!collapsed) {
        html += '<div class="pio-section-body">';

        if (items.length === 0) {
            html += `<div class="pio-empty">${t('noInputData') || 'Nenhuma compra registrada.'}</div>`;
        } else {
            for (const item of items) {
                html += _renderTransactionCard(item, 'input');
            }
            html += `
                <div class="pio-summary">
                    <span>${t('totalPurchases') || 'Total Compras'}</span>
                    <strong>${_fmtCurrency(total)}</strong>
                    <span class="pio-count">(${items.length} ${items.length === 1 ? 'item' : 'itens'})</span>
                </div>`;
        }

        // Formulário inline
        if (_cioFormOpen.input) {
            html += _renderTransactionForm('input');
        } else {
            html += `<button class="btn btn-sm btn-secondary pio-add-btn" onclick="window.handleOpenCIOForm('input')">+ ${t('addPurchase') || 'Adicionar Compra'}</button>`;
        }

        html += '</div>';
    }

    html += '</div>';
    return html;
}

// ---- SECTION 2: VENDAS (OUTPUTS) ----

function _renderOutputsSection() {
    const items = getCorporateOutputs();
    const collapsed = _cioCollapsed.outputs;
    const total = items.reduce((s, i) => s + (i.totalCost || 0), 0);

    let html = `
        <div class="pio-section">
            <div class="pio-section-header" onclick="window.handleToggleCIOSection('outputs')">
                <span>${t('servicesDelivered') || 'Vendas / Entregas'} (${items.length})</span>
                <span class="pio-chevron">${collapsed ? '\u25B6' : '\u25BC'}</span>
            </div>`;

    if (!collapsed) {
        html += '<div class="pio-section-body">';

        if (items.length === 0) {
            html += `<div class="pio-empty">${t('noOutputData') || 'Nenhuma venda registrada.'}</div>`;
        } else {
            for (const item of items) {
                html += _renderTransactionCard(item, 'output');
            }
            html += `
                <div class="pio-summary">
                    <span>${t('totalDeliveries') || 'Total Vendas'}</span>
                    <strong>${_fmtCurrency(total)}</strong>
                    <span class="pio-count">(${items.length} ${items.length === 1 ? 'item' : 'itens'})</span>
                </div>`;
        }

        if (_cioFormOpen.output) {
            html += _renderTransactionForm('output');
        } else {
            html += `<button class="btn btn-sm btn-secondary pio-add-btn" onclick="window.handleOpenCIOForm('output')">+ ${t('addDelivery') || 'Adicionar Venda'}</button>`;
        }

        html += '</div>';
    }

    html += '</div>';
    return html;
}

// ---- SECTION 3: RELAÇÃO COM INVESTIDORES ----

function _renderIRSection() {
    const collapsed = _cioCollapsed.ir;
    const totals = getCorporateTotals();

    let html = `
        <div class="pio-section">
            <div class="pio-section-header" onclick="window.handleToggleCIOSection('ir')">
                <span>${t('investorRelations') || 'Relação com Investidores'}</span>
                <span class="pio-chevron">${collapsed ? '\u25B6' : '\u25BC'}</span>
            </div>`;

    if (!collapsed) {
        html += '<div class="pio-section-body">';

        // KPI Cards
        const marginSign = totals.margin >= 0 ? '+' : '';
        html += `
            <div class="pio-kpi-grid">
                <div class="pio-kpi-card">
                    <div class="pio-kpi-value">${_fmtCompact(totals.totalInputs)}</div>
                    <div class="pio-kpi-label">${t('purchases') || 'Compras'}</div>
                </div>
                <div class="pio-kpi-card">
                    <div class="pio-kpi-value">${_fmtCompact(totals.totalOutputs)}</div>
                    <div class="pio-kpi-label">${t('sales') || 'Vendas'}</div>
                </div>
                <div class="pio-kpi-card ${totals.margin >= 0 ? 'pio-kpi-positive' : 'pio-kpi-negative'}">
                    <div class="pio-kpi-value">${marginSign}${totals.marginPct}%</div>
                    <div class="pio-kpi-label">${t('margin') || 'Margem'}</div>
                </div>
            </div>`;

        // Indicadores financeiros
        if (totals.inputCount > 0 || totals.outputCount > 0) {
            const ratio = totals.totalInputs > 0 ? (totals.totalOutputs / totals.totalInputs).toFixed(2) : '—';
            const avgIn = totals.inputCount > 0 ? _fmtCurrency(totals.totalInputs / totals.inputCount) : '—';
            const avgOut = totals.outputCount > 0 ? _fmtCurrency(totals.totalOutputs / totals.outputCount) : '—';

            html += `
                <div class="pio-tree">
                    <div class="pio-tree-title">${t('financialIndicators') || 'Indicadores Financeiros'}</div>
                    <div class="pio-tree-item"><span>${t('revenueCostRatio') || 'Receita / Custo'}</span><span>${ratio}\u00d7</span></div>
                    <div class="pio-tree-item"><span>${t('avgSaleTicket') || 'Ticket Médio Venda'}</span><span>${avgOut}</span></div>
                    <div class="pio-tree-item"><span>${t('avgPurchaseTicket') || 'Ticket Médio Compra'}</span><span>${avgIn}</span></div>
                    <div class="pio-tree-item"><span>${t('itemsRatio') || 'Vendidos / Comprados'}</span><span>${totals.outputCount}/${totals.inputCount}</span></div>
                </div>`;
        }

        // EIS, Compliance, EVA — carregados sob demanda
        html += _renderIRMetrics();

        html += '</div>';
    }

    html += '</div>';
    return html;
}

/**
 * Renderiza métricas Compliance, Contratos e EVA para IR.
 * Acessa módulos diretamente via import estático (graceful degradation via try/catch).
 */
function _renderIRMetrics() {
    let html = '';

    // Compliance — conta violações nas observações
    try {
        const elements = getAllElements() || [];
        let violations = 0,
            preventions = 0,
            compliant = 0;
        for (const el of elements) {
            const obs = el.data?.observations;
            if (!Array.isArray(obs)) continue;
            for (const o of obs) {
                if (o.complianceStatus === 'intervention') violations++;
                else if (o.complianceStatus === 'prevention') preventions++;
                else compliant++;
            }
        }
        if (violations + preventions + compliant > 0) {
            html += `
                <div class="pio-tree">
                    <div class="pio-tree-title">${t('regulatoryCompliance') || 'Conformidade Regulatória'}</div>
                    <div class="pio-tree-item pio-danger"><span>${t('interventionViolations') || 'Violações VI'}</span><span>${violations}</span></div>
                    <div class="pio-tree-item pio-warning"><span>${t('preventionViolations') || 'Violações VP'}</span><span>${preventions}</span></div>
                    <div class="pio-tree-item pio-success"><span>${t('compliantObs') || 'Conformes'}</span><span>${compliant}</span></div>
                </div>`;
        }
    } catch {
        /* compliance not available */
    }

    // Contratos — acessa governance diretamente
    try {
        const { getContracts, getContractFinancialSummary } = window._importedGov || _tryImportGov();
        if (getContracts) {
            const contracts = getContracts();
            const active = contracts.filter((c) => c.status === 'active');
            if (contracts.length > 0) {
                let totalValue = 0,
                    totalPaid = 0;
                for (const c of contracts) {
                    const s = getContractFinancialSummary?.(c.id);
                    if (s) {
                        totalValue += s.totalValue || 0;
                        totalPaid += s.totalPaid || 0;
                    }
                }
                const pct = totalValue > 0 ? ((totalPaid / totalValue) * 100).toFixed(1) : 0;
                html += `
                    <div class="pio-tree">
                        <div class="pio-tree-title">${t('contracts') || 'Contratos'}</div>
                        <div class="pio-tree-item"><span>${t('activeContracts') || 'Ativos'}: ${active.length}</span><span>${_fmtCurrency(totalValue)}</span></div>
                        <div class="pio-tree-item"><span>${t('disbursed') || 'Desembolsado'}</span><span>${_fmtCurrency(totalPaid)} (${pct}%)</span></div>
                    </div>`;
            }
        }
    } catch {
        /* governance not available */
    }

    // EVA
    try {
        const { calculateProjectEVA } = window._importedGov || _tryImportGov();
        if (calculateProjectEVA) {
            const eva = calculateProjectEVA();
            if (eva && eva.BAC > 0) {
                html += `
                    <div class="pio-tree">
                        <div class="pio-tree-title">EVA</div>
                        <div class="pio-tree-item"><span>BAC</span><span>${_fmtCurrency(eva.BAC)}</span></div>
                        <div class="pio-tree-item"><span>EAC</span><span>${_fmtCurrency(eva.EAC)}</span></div>
                        <div class="pio-tree-item"><span>SPI</span><span>${eva.SPI?.toFixed(2) || '—'}</span></div>
                        <div class="pio-tree-item"><span>CPI</span><span>${eva.CPI?.toFixed(2) || '—'}</span></div>
                        <div class="pio-tree-item"><span>VAC</span><span>${_fmtCurrency(eva.VAC)}</span></div>
                    </div>`;
            }
        }
    } catch {
        /* EVA not available */
    }

    return html;
}

/** Cache para módulos de governança carregados sob demanda */
let _govCache = null;
function _tryImportGov() {
    if (_govCache) return _govCache;
    try {
        // Tenta acessar funções já registradas no window (via handlers)
        if (window.handleAddContract) {
            // Governance handlers estão carregados — importar módulos sincronamente não é possível,
            // mas os dados são acessíveis via lazy import no próximo render
            import('../governance/contractManager.js').then((mod) => {
                _govCache = mod;
                window._importedGov = mod;
            });
            import('../governance/wbsManager.js').then((mod) => {
                _govCache = { ..._govCache, ...mod };
                window._importedGov = _govCache;
            });
        }
    } catch {
        /* ignore */
    }
    return {};
}

// ---- TRANSACTION CARD ----

function _renderTransactionCard(item, type) {
    const categories = type === 'input' ? INPUT_CATEGORIES : OUTPUT_CATEGORIES;
    const catDef = categories.find((c) => c.id === item.category) || {};
    const catLabel = t(item.category) || item.category;
    const removeHandler = type === 'input' ? 'handleRemoveCorporateInput' : 'handleRemoveCorporateOutput';
    const statusClass =
        item.status === 'completed'
            ? 'pio-status-done'
            : item.status === 'in_progress'
              ? 'pio-status-wip'
              : 'pio-status-planned';
    const statusLabel = t(item.status) || item.status;

    // Elementos vinculados
    let linkedNames = '';
    if (item.linkedElementIds?.length > 0) {
        const elements = getAllElements() || [];
        const names = item.linkedElementIds
            .map((id) => elements.find((e) => e.id === id))
            .filter(Boolean)
            .map((e) => escapeHtml(e.name || e.id));
        if (names.length > 0) linkedNames = names.join(', ');
    }

    return `
        <div class="pio-card" data-pio-id="${item.id}">
            <div class="pio-card-header">
                <span class="pio-card-icon" data-icon="${catDef.icon || 'box'}" data-icon-size="14px"></span>
                <span class="pio-card-cat">${escapeHtml(catLabel)}</span>
                <div class="pio-card-actions">
                    <button class="btn btn-icon" onclick="window.${removeHandler}('${item.id}')" aria-label="Remove">
                        <span data-icon="x" data-icon-size="12px"></span>
                    </button>
                </div>
            </div>
            <div class="pio-card-desc">${escapeHtml(item.description)}</div>
            <div class="pio-card-calc">
                ${item.quantity} ${escapeHtml(item.unit)} \u00d7 ${_fmtCurrency(item.unitCost)} = <strong>${_fmtCurrency(item.totalCost)}</strong>
            </div>
            <div class="pio-card-meta">
                <span>${escapeHtml(item.supplier)}</span>
                <span>${item.date || ''}</span>
                ${item.invoiceRef ? `<span>NF: ${escapeHtml(item.invoiceRef)}</span>` : ''}
                <span class="pio-status ${statusClass}">\u25CF ${escapeHtml(statusLabel)}</span>
            </div>
            ${linkedNames ? `<div class="pio-card-links" onclick="window.handleSelectElement && window.handleSelectElement('${item.linkedElementIds[0]}')" style="cursor:pointer">\u{1F517} ${linkedNames}</div>` : ''}
        </div>`;
}

// ---- TRANSACTION FORM ----

function _renderTransactionForm(type) {
    const categories = type === 'input' ? INPUT_CATEGORIES : OUTPUT_CATEGORIES;
    const elements = getAllElements() || [];
    const campaigns = getAllCampaigns() || [];
    const submitHandler = type === 'input' ? 'handleSubmitCorporateInput' : 'handleSubmitCorporateOutput';
    const cancelHandler = 'handleCancelCIOForm';

    return `
        <div class="pio-form" id="pio-form-${type}">
            <div class="pio-form-row">
                <select class="form-input pio-form-field" id="pio-${type}-category">
                    ${categories.map((c) => `<option value="${c.id}">${t(c.id) || c.id}</option>`).join('')}
                </select>
            </div>
            <div class="pio-form-row">
                <input class="form-input pio-form-field" id="pio-${type}-description" type="text"
                       placeholder="${t('description') || 'Descrição'}">
            </div>
            <div class="pio-form-row pio-form-row-multi">
                <input class="form-input pio-form-sm" id="pio-${type}-quantity" type="number" min="0" step="any"
                       placeholder="${t('quantity') || 'Qtd'}">
                <select class="form-input pio-form-sm" id="pio-${type}-unit">
                    ${COMMON_UNITS.map((u) => `<option value="${u}">${u}</option>`).join('')}
                </select>
                <input class="form-input pio-form-sm" id="pio-${type}-unitcost" type="number" min="0" step="any"
                       placeholder="${t('unitCost') || 'Custo Un.'}">
            </div>
            <div class="pio-form-row pio-form-row-multi">
                <input class="form-input pio-form-sm" id="pio-${type}-date" type="date">
                <input class="form-input pio-form-sm" id="pio-${type}-supplier" type="text"
                       placeholder="${type === 'input' ? t('supplier') || 'Fornecedor' : t('client') || 'Cliente'}">
            </div>
            <div class="pio-form-row pio-form-row-multi">
                <input class="form-input pio-form-sm" id="pio-${type}-invoice" type="text"
                       placeholder="${t('invoiceRef') || 'Ref. NF'}">
                <select class="form-input pio-form-sm" id="pio-${type}-status">
                    <option value="completed">${t('completed') || 'Concluído'}</option>
                    <option value="in_progress">${t('inProgress') || 'Em Andamento'}</option>
                    <option value="planned">${t('planned') || 'Planejado'}</option>
                </select>
            </div>
            ${
                elements.length > 0
                    ? `
            <div class="pio-form-row">
                <select class="form-input pio-form-field" id="pio-${type}-elements" multiple size="3">
                    ${elements.map((e) => `<option value="${e.id}">${escapeHtml(e.name || e.id)} (${e.family || ''})</option>`).join('')}
                </select>
            </div>`
                    : ''
            }
            ${
                campaigns.length > 0
                    ? `
            <div class="pio-form-row">
                <select class="form-input pio-form-field" id="pio-${type}-campaign">
                    <option value="">${t('noCampaign') || '— Sem campanha —'}</option>
                    ${campaigns.map((c) => `<option value="${c.id}">${escapeHtml(c.name || c.id)}</option>`).join('')}
                </select>
            </div>`
                    : ''
            }
            <div class="pio-form-actions">
                <button class="btn btn-sm btn-primary" onclick="window.${submitHandler}()">${t('save') || 'Salvar'}</button>
                <button class="btn btn-sm btn-secondary" onclick="window.${cancelHandler}('${type}')">${t('cancel') || 'Cancelar'}</button>
            </div>
        </div>`;
}

// ---- HANDLERS ----

export function handleToggleCIOSection(section) {
    _cioCollapsed[section] = !_cioCollapsed[section];
    renderCorporateIO();
}

export function handleOpenCIOForm(type) {
    _cioFormOpen[type] = true;
    renderCorporateIO();
}

export function handleCancelCIOForm(type) {
    _cioFormOpen[type] = false;
    renderCorporateIO();
}

function _readFormData(type) {
    const val = (id) => document.getElementById(`pio-${type}-${id}`)?.value?.trim() || '';
    const num = (id) => parseFloat(document.getElementById(`pio-${type}-${id}`)?.value) || 0;
    const elSelect = document.getElementById(`pio-${type}-elements`);
    const linkedElementIds = elSelect ? Array.from(elSelect.selectedOptions).map((o) => o.value) : [];

    return {
        category: val('category'),
        description: val('description'),
        quantity: num('quantity'),
        unit: val('unit') || 'un',
        unitCost: num('unitcost'),
        currency: getCurrency(),
        date: val('date'),
        supplier: val('supplier'),
        invoiceRef: val('invoice'),
        status: val('status') || 'completed',
        linkedElementIds,
        linkedCampaignId: val('campaign') || null,
        linkedContractId: null,
    };
}

export function handleSubmitCorporateInput() {
    const data = _readFormData('input');
    if (!data.description && !data.category) return;
    addCorporateInput(data);
    _cioFormOpen.input = false;
    renderCorporateIO();
}

export function handleSubmitCorporateOutput() {
    const data = _readFormData('output');
    if (!data.description && !data.category) return;
    addCorporateOutput(data);
    _cioFormOpen.output = false;
    renderCorporateIO();
}

export function handleRemoveCorporateInput(id) {
    removeCorporateInput(id);
    renderCorporateIO();
}

export function handleRemoveCorporateOutput(id) {
    removeCorporateOutput(id);
    renderCorporateIO();
}

// Model links (mantidos para retrocompatibilidade)
export async function handleAddInputLink() {
    const mid = await asyncPrompt('Enter upstream Model ID:');
    if (!mid) return;
    const name = (await asyncPrompt('Name (optional):')) || '';
    addInputLink(mid.trim(), name, '');
    renderCorporateIO();
}

export async function handleAddOutputLink() {
    const mid = await asyncPrompt('Enter downstream Model ID:');
    if (!mid) return;
    const name = (await asyncPrompt('Name (optional):')) || '';
    addOutputLink(mid.trim(), name, '');
    renderCorporateIO();
}

export function handleRemoveInputLink(linkedModelId) {
    removeInputLink(linkedModelId);
    renderCorporateIO();
}

export function handleRemoveOutputLink(linkedModelId) {
    removeOutputLink(linkedModelId);
    renderCorporateIO();
}

// ----------------------------------------------------------------
// SHARED HELPER — Criação de boundary padrão com aerial overlay
// Usado por _initMapPickerMode, _initLastLocationMode e handleOpenMapPicker
// ----------------------------------------------------------------

/**
 * Cria ou atualiza um boundary 200x200m com imagem aérea no local especificado.
 * Reutilizado por todos os modos de inicialização baseados em localização.
 *
 * @param {number} latitude - Latitude WGS84
 * @param {number} longitude - Longitude WGS84
 * @param {Object} [options] - { halfW: 100, halfL: 100, update: false }
 * @returns {Promise<string|null>} - ID do boundary criado/atualizado, ou null
 */
export async function createDefaultBoundary(latitude, longitude, options = {}) {
    const halfW = options.halfW || 100;
    const halfL = options.halfL || 100;

    try {
        const { buildOverlayUrls } = await import('../../core/io/geo/overlayUrls.js');
        const { overlayUrl, overlayFallbackUrls } = await buildOverlayUrls(halfW, halfL);

        // Atualiza boundary existente se solicitado
        if (options.update) {
            const existingBoundary = getAllElements().find((e) => e.family === 'boundary');
            if (existingBoundary) {
                existingBoundary.data.overlayUrl = overlayUrl;
                existingBoundary.data.overlayFallbackUrls = overlayFallbackUrls;
                existingBoundary.data.sourceLat = latitude;
                existingBoundary.data.sourceLon = longitude;

                const mesh = getMeshByElementId(existingBoundary.id);
                if (mesh) {
                    const overlay = mesh.getObjectByName('overlay');
                    if (overlay && overlay.material) {
                        const { loadOverlayTexture } = await import('../../core/elements/meshFactory.js');
                        loadOverlayTexture([overlayUrl, ...overlayFallbackUrls], overlay.material);
                    }
                }
                return existingBoundary.id;
            }
        }

        // Cria novo boundary
        const boundaryId = `boundary-${nextElementCounter()}`;
        addElement('boundary', boundaryId, t('defaultBoundaryName') || 'Area de Estudo', {
            vertices: [
                { x: -halfW, y: 0, z: -halfL },
                { x: halfW, y: 0, z: -halfL },
                { x: halfW, y: 0, z: halfL },
                { x: -halfW, y: 0, z: halfL },
            ],
            type: 'study_area',
            overlayUrl,
            overlayFallbackUrls,
            overlayOpacity: 0.85,
            sourceLat: latitude,
            sourceLon: longitude,
        });
        return boundaryId;
    } catch (err) {
        console.error('[Boundary] Failed to create:', err);
        return null;
    }
}

// ----------------------------------------------------------------
// PROJECT INITIALIZATION OPTIONS
// Controla como o projeto nasce: random completo ou em branco.
// Persistido em localStorage para ser lido no main.js antes de init.
// ----------------------------------------------------------------

const INIT_STORAGE_KEY = 'ecbyts-init-mode';

/**
 * Retorna a configuração de inicialização salva.
 * @returns {{ mode: 'random'|'blank'|'lastProject'|'mapPicker', terrainElevation: boolean, autoTerrain: boolean, resumeOnRandom?: boolean }}
 */
export function getInitConfig() {
    try {
        const raw = localStorage.getItem(INIT_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {
        /* corrupted — use defaults */
    }
    return { mode: 'random', terrainElevation: true, autoTerrain: false };
}

/**
 * Persiste a configuração de inicialização no localStorage.
 */
function _persistInitConfig(config) {
    safeSetItem(INIT_STORAGE_KEY, JSON.stringify(config));
}

/**
 * Handler chamado pelo select #init-mode ao mudar.
 * Exibe/oculta opções conforme o modo.
 */
export function handleInitModeChange() {
    const select = document.getElementById('init-mode');
    const randomOpts = document.getElementById('init-random-options');
    const blankInfo = document.getElementById('init-blank-info');
    const lastProjectInfo = document.getElementById('init-lastproject-info');
    const mapPickerInfo = document.getElementById('init-mappicker-info');
    const lastLocationInfo = document.getElementById('init-lastlocation-info');
    if (!select) return;

    const mode = select.value;
    if (randomOpts) randomOpts.style.display = mode === 'random' ? '' : 'none';
    if (blankInfo) blankInfo.style.display = mode === 'blank' ? '' : 'none';
    if (lastProjectInfo) lastProjectInfo.style.display = mode === 'lastProject' ? '' : 'none';
    if (mapPickerInfo) mapPickerInfo.style.display = mode === 'mapPicker' ? '' : 'none';
    if (lastLocationInfo) lastLocationInfo.style.display = mode === 'lastLocation' ? '' : 'none';

    // Mostra preview das coordenadas salvas no modo lastLocation
    if (mode === 'lastLocation') {
        _updateLastLocationPreview();
    }

    _persistInitConfig(_readInitForm());

    // Acao imediata ao selecionar modo (sem esperar reload)
    _executeInitModeNow(mode);
}

/**
 * Update the preview of saved coordinates in the lastLocation info panel.
 * Mostra as coordenadas salvas no localStorage para o modo "Último Local".
 */
async function _updateLastLocationPreview() {
    const preview = document.getElementById('init-lastlocation-preview');
    if (!preview) return;

    try {
        const { getLastSavedOrigin, utmToWGS84 } = await import('../../core/io/geo/coordinates.js');
        const saved = getLastSavedOrigin();

        if (saved) {
            const wgs = utmToWGS84({
                easting: saved.easting,
                northing: saved.northing,
                zone: saved.zone,
                hemisphere: saved.hemisphere,
            });
            preview.innerHTML = `📍 Zona ${saved.zone}${saved.hemisphere} | ${wgs.latitude.toFixed(4)}°, ${wgs.longitude.toFixed(4)}°`;
            preview.style.color = 'var(--neutral-300)';
        } else {
            preview.innerHTML = `⚠ ${t('initLastLocationEmpty') || 'No saved location found. Use Map Picker first.'}`;
            preview.style.color = 'var(--neutral-500)';
        }
    } catch {
        preview.innerHTML = '';
    }
}

/**
 * Lê os valores do formulário de inicialização.
 */
function _readInitForm() {
    const mode = document.getElementById('init-mode')?.value || 'random';
    const terrainElevation = document.getElementById('init-terrain-elevation')?.checked ?? true;
    const autoTerrain = document.getElementById('init-auto-terrain')?.checked ?? true;
    return { mode, terrainElevation, autoTerrain };
}

/**
 * Restaura o formulário a partir do localStorage.
 * Chamado no init para sincronizar UI ↔ persistência.
 */
export function restoreInitForm() {
    const config = getInitConfig();
    const modeSelect = document.getElementById('init-mode');
    const terrainCheck = document.getElementById('init-terrain-elevation');
    const autoTerrainCheck = document.getElementById('init-auto-terrain');
    const randomOpts = document.getElementById('init-random-options');
    const blankInfo = document.getElementById('init-blank-info');
    const lastProjectInfo = document.getElementById('init-lastproject-info');
    const mapPickerInfo = document.getElementById('init-mappicker-info');
    const lastLocationInfo = document.getElementById('init-lastlocation-info');

    if (modeSelect) modeSelect.value = config.mode;
    if (terrainCheck) terrainCheck.checked = config.terrainElevation;
    if (autoTerrainCheck) autoTerrainCheck.checked = config.autoTerrain;
    if (randomOpts) randomOpts.style.display = config.mode === 'random' ? '' : 'none';
    if (blankInfo) blankInfo.style.display = config.mode === 'blank' ? '' : 'none';
    if (lastProjectInfo) lastProjectInfo.style.display = config.mode === 'lastProject' ? '' : 'none';
    if (mapPickerInfo) mapPickerInfo.style.display = config.mode === 'mapPicker' ? '' : 'none';
    if (lastLocationInfo) lastLocationInfo.style.display = config.mode === 'lastLocation' ? '' : 'none';

    // Mostra preview se o modo atual é lastLocation
    if (config.mode === 'lastLocation') {
        _updateLastLocationPreview();
    }

    // Listeners para persistir ao alterar checkboxes
    if (terrainCheck) terrainCheck.addEventListener('change', () => _persistInitConfig(_readInitForm()));
    if (autoTerrainCheck) autoTerrainCheck.addEventListener('change', () => _persistInitConfig(_readInitForm()));
}

/**
 * Execute the selected init mode immediately (without reload).
 * Executa acao imediata ao selecionar modo no dropdown.
 *
 * @param {string} mode - Modo selecionado
 */
async function _executeInitModeNow(mode) {
    if (mode === 'mapPicker') {
        handleOpenMapPicker();
    }
    // lastProject e random requerem reload completo para funcionar corretamente
    // (geram modelo novo, limpam state, etc.) — nao executam sob demanda
}

/**
 * Open the map picker modal for selecting UTM origin.
 * Abre modal com mapa interativo para selecionar origem UTM.
 */
async function handleOpenMapPicker() {
    try {
        const { openMapPickerModal } = await import('../ui/mapPicker.js');
        const result = await openMapPickerModal();

        if (result) {
            const { wgs84ToUTM, setOrigin } = await import('../../core/io/geo/coordinates.js');
            const { buildOverlayUrls } = await import('../../core/io/geo/overlayUrls.js');
            const utm = wgs84ToUTM({ latitude: result.latitude, longitude: result.longitude });
            const hemisphere = result.latitude < 0 ? 'S' : 'N';

            setOrigin({
                easting: utm.easting,
                northing: utm.northing,
                elevation: 0,
                zone: utm.zone,
                hemisphere,
            });

            // Atualiza campos na UI
            const oeEl = document.getElementById('utm-origin-easting');
            const onEl = document.getElementById('utm-origin-northing');
            const zoneEl = document.getElementById('utm-zone');
            const hemiEl = document.getElementById('utm-hemisphere');
            const latEl = document.getElementById('origin-latitude');
            const lonEl = document.getElementById('origin-longitude');

            if (oeEl) oeEl.value = utm.easting.toFixed(2);
            if (onEl) onEl.value = utm.northing.toFixed(2);
            if (zoneEl) zoneEl.value = utm.zone;
            if (hemiEl) hemiEl.value = hemisphere;
            if (latEl) latEl.value = result.latitude.toFixed(6);
            if (lonEl) lonEl.value = result.longitude.toFixed(6);

            // Cria ou atualiza boundary com imagem aerial do local selecionado
            const halfW = 100;
            const halfL = 100;
            const { overlayUrl, overlayFallbackUrls } = await buildOverlayUrls(halfW, halfL);

            const existingBoundary = getAllElements().find((e) => e.family === 'boundary');
            if (existingBoundary) {
                // Atualiza overlay do boundary existente
                existingBoundary.data.overlayUrl = overlayUrl;
                existingBoundary.data.overlayFallbackUrls = overlayFallbackUrls;
                existingBoundary.data.sourceLat = result.latitude;
                existingBoundary.data.sourceLon = result.longitude;

                // Recarrega textura no mesh 3D
                const mesh = getMeshByElementId(existingBoundary.id);
                if (mesh) {
                    const overlay = mesh.getObjectByName('overlay');
                    if (overlay && overlay.material) {
                        const { loadOverlayTexture } = await import('../../core/elements/meshFactory.js');
                        loadOverlayTexture([overlayUrl, ...overlayFallbackUrls], overlay.material);
                    }
                }
            } else {
                // Cria boundary novo (200x200m)
                const boundaryId = `boundary-${nextElementCounter()}`;
                addElement('boundary', boundaryId, t('defaultBoundaryName') || 'Area de Estudo', {
                    vertices: [
                        { x: -halfW, y: 0, z: -halfL },
                        { x: halfW, y: 0, z: -halfL },
                        { x: halfW, y: 0, z: halfL },
                        { x: -halfW, y: 0, z: halfL },
                    ],
                    type: 'study_area',
                    overlayUrl,
                    overlayFallbackUrls,
                    overlayOpacity: 0.85,
                    sourceLat: result.latitude,
                    sourceLon: result.longitude,
                });
            }

            // Enquadra camera no boundary
            const { fitAllElements } = await import('../scene/controls.js');
            fitAllElements();

            showToast(t('initMapOriginSet'), 'success');
        }
    } catch (err) {
        console.error('[MapPicker] Error:', err);
    }
}

/**
 * Reopen the welcome screen (from settings button).
 * Reabre a tela de boas-vindas sob demanda.
 */
async function handleShowWelcome() {
    try {
        const { resetWelcomePreference, showWelcomeScreen } = await import('../ui/welcomeScreen.js');
        resetWelcomePreference();
        const chosenMode = await showWelcomeScreen();

        if (chosenMode === 'tour') {
            // Inicia tour do produto
            if (window.handleStartTour) window.handleStartTour();
        } else if (chosenMode === 'mapPicker') {
            handleOpenMapPicker();
        } else if (chosenMode) {
            // Persiste modo escolhido e recarrega para aplicar
            const config = _readInitForm();
            config.mode = chosenMode;
            _persistInitConfig(config);
            const modeSelect = document.getElementById('init-mode');
            if (modeSelect) modeSelect.value = chosenMode;
            handleInitModeChange();
        }
    } catch (err) {
        console.error('[Welcome] Error:', err);
    }
}

// ----------------------------------------------------------------
// UTM ↔ LAT/LON CONVERSION
// Conversão bidirecional entre UTM e coordenadas geográficas
// ----------------------------------------------------------------

/**
 * Convert current UTM origin to Lat/Lon and show in the fields.
 * Converte a origem UTM para Lat/Lon decimal.
 */
async function handleConvertToLatLon() {
    const { utmToWGS84 } = await import('../../core/io/geo/coordinates.js');
    const easting = parseFloat(document.getElementById('utm-origin-easting')?.value) || 0;
    const northing = parseFloat(document.getElementById('utm-origin-northing')?.value) || 0;
    const zone = parseInt(document.getElementById('utm-zone')?.value, 10) || 23;
    const hemisphere = document.getElementById('utm-hemisphere')?.value || 'S';

    if (easting === 0 && northing === 0) return;

    const { latitude, longitude } = utmToWGS84({ easting, northing, zone, hemisphere });
    const latEl = document.getElementById('origin-latitude');
    const lonEl = document.getElementById('origin-longitude');
    if (latEl) latEl.value = latitude.toFixed(6);
    if (lonEl) lonEl.value = longitude.toFixed(6);
}

/**
 * Convert Lat/Lon to UTM and fill the origin fields.
 * Converte Lat/Lon decimal para UTM e preenche os campos de origem.
 */
async function handleConvertToUTM() {
    const { wgs84ToUTM, setOrigin } = await import('../../core/io/geo/coordinates.js');
    const latEl = document.getElementById('origin-latitude');
    const lonEl = document.getElementById('origin-longitude');
    let latRaw = (latEl?.value || '').trim();
    let lonRaw = (lonEl?.value || '').trim();

    // Aceita "lat; lon" ou "lat, lon" colados no campo de latitude
    if (latRaw && !lonRaw) {
        const parts = latRaw.split(/[;\s]+/).filter(Boolean);
        if (parts.length >= 2) {
            latRaw = parts[0];
            lonRaw = parts[1];
            if (lonEl) lonEl.value = lonRaw.replace(',', '.');
        }
    }

    // Normaliza vírgula decimal para ponto (formato BR/EU)
    const lat = parseFloat(latRaw.replace(',', '.'));
    const lon = parseFloat(lonRaw.replace(',', '.'));

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    // Atualiza campos com formato normalizado
    if (latEl) latEl.value = lat.toFixed(6);
    if (lonEl) lonEl.value = lon.toFixed(6);

    const utm = wgs84ToUTM({ latitude: lat, longitude: lon });
    const eastingEl = document.getElementById('utm-origin-easting');
    const northingEl = document.getElementById('utm-origin-northing');
    const zoneEl = document.getElementById('utm-zone');
    const hemiEl = document.getElementById('utm-hemisphere');

    if (eastingEl) eastingEl.value = utm.easting.toFixed(2);
    if (northingEl) northingEl.value = utm.northing.toFixed(2);
    if (zoneEl) zoneEl.value = utm.zone;
    if (hemiEl) hemiEl.value = utm.hemisphere;

    setOrigin({
        easting: utm.easting,
        northing: utm.northing,
        zone: utm.zone,
        hemisphere: utm.hemisphere,
    });
}

// ----------------------------------------------------------------
// REGISTRY DETAIL PANEL — Painel de cadastro fiscal do no selecionado
// Renderizado abaixo da arvore quando um no esta ativo.
// ----------------------------------------------------------------

/**
 * Render the documents list for a node.
 * Renderiza a lista de documentos vinculados ao no.
 *
 * @param {string} nodeId
 * @param {Array} docs - Array of DocumentMeta
 * @returns {string} HTML string
 */
function renderDocumentsList(nodeId, docs) {
    if (!docs || docs.length === 0) {
        return `<div class="area-docs-empty" style="font-size:11px; color:var(--neutral-500); margin:4px 0;">${t('noDocuments') || 'No documents yet'}</div>`;
    }

    const today = new Date().toISOString().slice(0, 10);

    return docs
        .map((doc) => {
            const docTypeDef = DOCUMENT_TYPES.find((d) => d.id === doc.docType);
            const typeLabel = docTypeDef ? docTypeDef.label : doc.docType;
            const hashShort = doc.fileHash ? doc.fileHash.slice(0, 12) + '...' : '';
            const sizeKB = doc.fileSize ? (doc.fileSize / 1024).toFixed(0) + ' KB' : '';
            const eid = escapeJsAttr(nodeId);
            const did = escapeJsAttr(doc.id);

            let expiryBadge = '';
            if (doc.expiresAt) {
                if (doc.expiresAt < today) {
                    expiryBadge = `<span class="area-doc-badge area-doc-badge--expired">${t('docExpired') || 'Expired'}</span>`;
                } else {
                    const daysLeft = Math.ceil((new Date(doc.expiresAt) - new Date(today)) / 86400000);
                    if (daysLeft <= 30) {
                        expiryBadge = `<span class="area-doc-badge area-doc-badge--warning">${t('docExpiresSoon') || 'Expires soon'}</span>`;
                    }
                }
            }

            return `
            <div class="area-doc-item">
                <div class="area-doc-header">
                    <span class="area-doc-name">${escapeHtml(doc.name)}</span>
                    ${expiryBadge}
                </div>
                <div class="area-doc-meta">
                    ${escapeHtml(typeLabel)}${doc.issuer ? ' | ' + escapeHtml(doc.issuer) : ''}${doc.issueDate ? ' | ' + doc.issueDate : ''}
                    ${doc.expiresAt ? ' &rarr; ' + doc.expiresAt : ''}
                </div>
                <div class="area-doc-hash">
                    SHA-256: <code>${escapeHtml(hashShort)}</code>${sizeKB ? ' | ' + sizeKB : ''}
                </div>
                <div class="area-doc-actions">
                    <button type="button" class="btn btn-xs btn-outline"
                            onclick="window.handleVerifyDocument('${eid}', '${did}')">
                        ${getIcon('check', { size: '10px' })} ${t('verifyDocument') || 'Verify'}
                    </button>
                    <button type="button" class="btn btn-xs btn-danger"
                            onclick="window.handleRemoveNodeDocument('${eid}', '${did}')">
                        ${getIcon('x', { size: '10px' })}
                    </button>
                </div>
            </div>`;
        })
        .join('');
}

/**
 * Render the add-document form (inline, collapsible).
 * Formulario para adicionar um novo documento ao no.
 *
 * @param {string} nodeId
 * @returns {string} HTML string
 */
function renderDocumentForm(nodeId) {
    const eid = escapeJsAttr(nodeId);
    const docTypeOptions = DOCUMENT_TYPES.map((d) => `<option value="${d.id}">${escapeHtml(d.label)}</option>`).join(
        '',
    );

    return `
        <div class="area-doc-form" id="doc-add-form">
            <div class="form-group" style="margin-bottom:4px;">
                <label class="form-label">${t('type') || 'Type'}</label>
                <select class="form-input" id="doc-type-select">${docTypeOptions}</select>
            </div>
            <div class="form-group" style="margin-bottom:4px;">
                <label class="form-label">${t('name') || 'Name'}</label>
                <input type="text" class="form-input" id="doc-name-input" placeholder="${t('documentName') || 'Document name'}">
            </div>
            <div style="display:flex; gap:6px; margin-bottom:4px;">
                <div class="form-group" style="flex:1; margin-bottom:0;">
                    <label class="form-label">${t('docIssuer') || 'Issuer'}</label>
                    <input type="text" class="form-input" id="doc-issuer-input" placeholder="CETESB, Junta Comercial...">
                </div>
            </div>
            <div style="display:flex; gap:6px; margin-bottom:4px;">
                <div class="form-group" style="flex:1; margin-bottom:0;">
                    <label class="form-label">${t('docIssueDate') || 'Issue date'}</label>
                    <input type="date" class="form-input" id="doc-issuedate-input">
                </div>
                <div class="form-group" style="flex:1; margin-bottom:0;">
                    <label class="form-label">${t('docExpiresAt') || 'Expires at'}</label>
                    <input type="date" class="form-input" id="doc-expires-input">
                </div>
            </div>
            <div class="form-group" style="margin-bottom:4px;">
                <label class="form-label">${t('file') || 'File'} (SHA-256)</label>
                <input type="file" class="form-input" accept="*/*"
                       onchange="window.handleDocFileSelected(event)">
                <span class="area-doc-hash-preview" id="doc-file-hash"></span>
            </div>
            <div class="form-group" style="margin-bottom:6px;">
                <label class="form-label">${t('docNotes') || 'Notes'}</label>
                <textarea class="form-input" id="doc-notes-input" rows="2" style="resize:vertical;"></textarea>
            </div>
            <div style="display:flex; gap:6px;">
                <button type="button" class="btn btn-sm btn-primary"
                        onclick="window.handleSaveNodeDocument('${eid}')">
                    ${t('save') || 'Save'}
                </button>
                <button type="button" class="btn btn-sm btn-outline"
                        onclick="window.handleAddNodeDocument('${eid}')">
                    ${t('cancel') || 'Cancel'}
                </button>
            </div>
        </div>`;
}

/**
 * Render the detail panel for the selected area node.
 * Renderiza o painel de detalhes do no selecionado na arvore.
 * Inclui: nome, tipo, badges, registro fiscal, documentos, acoes CRUD.
 *
 * @param {string|null} nodeId
 */
function renderAreaNodeDetail(nodeId) {
    const panel = document.getElementById('areas-tree-detail');
    if (!panel) return;

    if (!nodeId) {
        panel.innerHTML = '';
        panel.style.display = 'none';
        return;
    }

    const node = findNodeById(nodeId, window.areasTreeData || []);
    if (!node) {
        panel.innerHTML = '';
        panel.style.display = 'none';
        return;
    }

    panel.style.display = '';

    const eid = escapeJsAttr(nodeId);

    // --- Node identity section ---
    const nodeTypeOptions = ['controller', 'area', 'subarea']
        .map(
            (t2) =>
                `<option value="${t2}" ${node.type === t2 ? 'selected' : ''}>${t2.charAt(0).toUpperCase() + t2.slice(1)}</option>`,
        )
        .join('');
    const badgesStr = Array.isArray(node.badges) ? node.badges.join(', ') : '';

    // --- Registry section ---
    const currentRegType = node.registryType || 'cnpj';
    const currentNumber = node.registryNumber || '';
    const typeEntry = REGISTRY_TYPES.find((r) => r.id === currentRegType) || REGISTRY_TYPES[0];
    const isPersonal = typeEntry.personal;

    const regTypeOptions = REGISTRY_TYPES.map(
        (r) => `<option value="${r.id}" ${r.id === currentRegType ? 'selected' : ''}>${escapeHtml(r.label)}</option>`,
    ).join('');

    const lgpdNotice = isPersonal
        ? `
        <div class="area-registry-lgpd-notice">
            \u26A0 ${t('lgpdNotice') || 'CPF \u00e9 dado pessoal protegido pela LGPD. Armazene apenas com consentimento do titular.'}
        </div>`
        : '';

    // --- Documents section ---
    const docs = Array.isArray(node.documents) ? node.documents : [];
    const docsHtml = renderDocumentsList(nodeId, docs);
    const docFormHtml = _docFormOpenForNode === nodeId ? renderDocumentForm(nodeId) : '';

    panel.innerHTML = `
        <div class="area-registry-panel">
            <!-- Node identity -->
            <div class="form-group" style="margin-bottom: 6px;">
                <label class="form-label">${t('name') || 'Name'}</label>
                <input type="text" class="form-input area-detail-name-input"
                       value="${escapeAttr(node.name)}"
                       onchange="window.handleRenameAreaNode('${eid}', this.value)">
            </div>
            <div style="display:flex; gap:8px; margin-bottom:8px;">
                <div class="form-group" style="flex:1; margin-bottom:0;">
                    <label class="form-label">${t('type') || 'Type'}</label>
                    <select class="form-input area-detail-type-select"
                            onchange="window.handleChangeAreaNodeType('${eid}', this.value)">
                        ${nodeTypeOptions}
                    </select>
                </div>
                <div class="form-group" style="flex:1; margin-bottom:0;">
                    <label class="form-label">Badges</label>
                    <input type="text" class="form-input area-detail-badges-input"
                           value="${escapeAttr(badgesStr)}"
                           placeholder="Operacional, MRO..."
                           onchange="window.handleChangeAreaNodeBadges('${eid}', this.value)">
                </div>
            </div>

            <!-- Registry -->
            <div class="form-group" style="margin-bottom: 6px;">
                <label class="form-label">${t('registryType') || 'Registry Type'}</label>
                <select class="form-input"
                        id="area-registry-type-select"
                        onchange="window.handleAreaRegistryTypeChange('${eid}', this.value)">
                    ${regTypeOptions}
                </select>
            </div>
            ${lgpdNotice}
            <div class="form-group" style="margin-bottom: 8px;">
                <label class="form-label">${t('registryNumber') || 'Registry Number'}</label>
                <input type="text"
                       class="form-input"
                       id="area-registry-number-input"
                       placeholder="${escapeAttr(typeEntry.placeholder)}"
                       value="${escapeAttr(currentNumber)}"
                       oninput="window.handleAreaRegistryInput('${eid}', this.value)"
                       autocomplete="off">
                <span class="area-registry-validation" id="area-registry-validation"></span>
            </div>
            <button type="button"
                    class="btn btn-primary btn-sm"
                    onclick="window.handleSaveNodeRegistry('${eid}')">
                ${t('save') || 'Save'}
            </button>

            <!-- Documents / Intangibles -->
            <div class="area-docs-section" style="margin-top: 12px;">
                <div class="section-header" style="margin-bottom:6px;">
                    <span>${getIcon('file-new', { size: '14px' })} ${t('documents') || 'Documents'}</span>
                </div>
                ${docsHtml}
                ${docFormHtml}
                <button type="button" class="btn btn-sm btn-outline" style="margin-top:6px;"
                        onclick="window.handleAddNodeDocument('${eid}')">
                    ${getIcon('plus', { size: '12px' })} ${t('addDocument') || 'Add document'}
                </button>
            </div>

            <!-- CRUD actions -->
            <div class="area-detail-actions" style="margin-top: 12px;">
                <button type="button" class="btn btn-sm btn-outline"
                        onclick="window.handleAddAreaNode('${eid}')">
                    ${getIcon('plus', { size: '12px' })} ${t('addChildNode') || 'Add child'}
                </button>
                <button type="button" class="btn btn-sm btn-outline"
                        onclick="window.handleMoveAreaNode('${eid}', 'up')"
                        title="${t('moveUp') || 'Move up'}">
                    &#9650;
                </button>
                <button type="button" class="btn btn-sm btn-outline"
                        onclick="window.handleMoveAreaNode('${eid}', 'down')"
                        title="${t('moveDown') || 'Move down'}">
                    &#9660;
                </button>
                <button type="button" class="btn btn-sm btn-danger"
                        onclick="window.handleRemoveAreaNode('${eid}')">
                    ${getIcon('x', { size: '12px' })} ${t('removeNode') || 'Remove'}
                </button>
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// REGISTRY HANDLERS — Interacao com o painel de cadastro fiscal
// ----------------------------------------------------------------

/**
 * Handle registry type selection change in the detail panel.
 * Atualiza placeholder e limpa o campo numero ao trocar o tipo.
 *
 * @param {string} nodeId
 * @param {string} newType
 */
export function handleAreaRegistryTypeChange(nodeId, newType) {
    const node = findNodeById(nodeId, window.areasTreeData || []);
    if (!node) return;

    // Atualiza dados do no antes de re-renderizar
    node.registryType = newType;
    node.registryNumber = '';

    renderAreasTree();
    renderAreaNodeDetail(nodeId);
}

/**
 * Live-format registry input with mask and show validation status.
 * Formata em tempo real e exibe validacao.
 *
 * @param {string} nodeId
 * @param {string} rawValue
 */
export function handleAreaRegistryInput(nodeId, rawValue) {
    const typeSelect = document.getElementById('area-registry-type-select');
    const input = document.getElementById('area-registry-number-input');
    const validation = document.getElementById('area-registry-validation');
    if (!typeSelect || !input) return;

    const type = typeSelect.value;
    const masked = applyRegistryMask(type, rawValue);

    if (input.value !== masked) {
        const pos = input.selectionStart;
        const diff = masked.length - input.value.length;
        input.value = masked;
        try {
            input.setSelectionRange(pos + diff, pos + diff);
        } catch (_) {
            /* ignore */
        }
    }

    if (validation) {
        const result = validateRegistry(type, masked);
        validation.textContent = result.valid ? '' : t(result.message) || result.message;
        validation.className = `area-registry-validation ${result.valid ? '' : 'area-registry-validation--error'}`;
    }
}

/**
 * Save registry data to the node in areasTreeData.
 * Salva tipo e numero de registro no no da arvore.
 *
 * @param {string} nodeId
 */
export function handleSaveNodeRegistry(nodeId) {
    const typeSelect = document.getElementById('area-registry-type-select');
    const input = document.getElementById('area-registry-number-input');
    if (!typeSelect || !input) return;

    const type = typeSelect.value;
    const value = input.value.trim();

    const result = validateRegistry(type, value);
    if (!result.valid && value) {
        showToast(t(result.message) || 'Invalid registry number', 'warning');
        return;
    }

    const node = findNodeById(nodeId, window.areasTreeData || []);
    if (!node) return;

    node.registryType = type;
    node.registryNumber = value;

    renderAreasTree();
    renderAreaNodeDetail(nodeId);
    showToast(t('registrySaved') || 'Registry saved', 'success');
}

// ----------------------------------------------------------------
// CRUD — Adicionar, remover, renomear nos da arvore
// ----------------------------------------------------------------

/**
 * Collect IDs of a node and all its descendants.
 * Coleta todos os IDs de um no e seus filhos recursivamente.
 *
 * @param {Object} node
 * @returns {string[]}
 */
function collectDescendantIds(node) {
    const ids = [node.id];
    if (Array.isArray(node.children)) {
        for (const child of node.children) {
            ids.push(...collectDescendantIds(child));
        }
    }
    return ids;
}

/**
 * Remove a node from the tree by ID. Returns removed node IDs.
 * Remove um no da arvore. Retorna lista de IDs removidos.
 *
 * @param {string} nodeId
 * @param {Array} tree - Mutable tree array
 * @returns {string[]} IDs of removed nodes
 */
function removeNodeFromTree(nodeId, tree) {
    for (let i = 0; i < tree.length; i++) {
        if (tree[i].id === nodeId) {
            const removedIds = collectDescendantIds(tree[i]);
            tree.splice(i, 1);
            return removedIds;
        }
        if (Array.isArray(tree[i].children)) {
            const removedIds = removeNodeFromTree(nodeId, tree[i].children);
            if (removedIds.length > 0) return removedIds;
        }
    }
    return [];
}

/**
 * Add a new child node (or root node if parentId is null).
 * Adiciona um no filho ao no selecionado, ou um no raiz.
 *
 * @param {string|null} parentId - Parent node ID, or null for root
 */
export function handleAddAreaNode(parentId) {
    if (!Array.isArray(window.areasTreeData)) {
        window.areasTreeData = [];
    }

    const isRoot = !parentId;
    const newNode = {
        id: generateId('area'),
        name: t('newNodeName') || 'New Node',
        type: isRoot ? 'controller' : 'subarea',
        badges: [],
        expanded: false,
        children: [],
    };

    if (isRoot) {
        window.areasTreeData.push(newNode);
    } else {
        const parent = findNodeById(parentId, window.areasTreeData);
        if (!parent) return;
        if (!Array.isArray(parent.children)) parent.children = [];
        parent.children.push(newNode);
        // Expande o pai para mostrar o novo filho
        if (!window.areasTreeExpanded) window.areasTreeExpanded = new Set();
        window.areasTreeExpanded.add(parentId);
    }

    // Seleciona o novo no
    window.activeAreaNodeId = newNode.id;
    renderAreasTree();
    renderAreaNodeDetail(newNode.id);
    showToast(t('addChildNode') || 'Node added', 'success');
}

/**
 * Remove a node and its descendants from the tree.
 * Remove um no e todos os filhos. Desvincula elementos orfaos.
 *
 * @param {string} nodeId
 */
export async function handleRemoveAreaNode(nodeId) {
    if (!Array.isArray(window.areasTreeData)) return;

    const node = findNodeById(nodeId, window.areasTreeData);
    if (!node) return;

    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const msg = hasChildren
        ? `${t('confirmRemoveNode') || 'Remove this node?'}\n${t('confirmRemoveNodeChildren') || 'Children will also be removed.'}`
        : t('confirmRemoveNode') || 'Remove this node?';

    if (!(await asyncConfirm(msg))) return;

    const removedIds = removeNodeFromTree(nodeId, window.areasTreeData);

    // Desvincula elementos orfaos
    const elements = getAllElements() || [];
    for (const el of elements) {
        if (el.data?.areaId && removedIds.includes(el.data.areaId)) {
            el.data.areaId = '';
        }
    }

    // Limpa selecao se o no removido era o ativo
    if (window.activeAreaNodeId && removedIds.includes(window.activeAreaNodeId)) {
        window.activeAreaNodeId = null;
    }

    renderAreasTree();
    renderAreaNodeDetail(window.activeAreaNodeId);
    clearElementHighlights();
    showToast(t('removeNode') || 'Node removed', 'info');
}

/**
 * Rename a tree node.
 * Renomeia um no da arvore.
 *
 * @param {string} nodeId
 * @param {string} newName
 */
export function handleRenameAreaNode(nodeId, newName) {
    const name = (newName || '').trim();
    if (!name) return;
    const node = findNodeById(nodeId, window.areasTreeData || []);
    if (!node) return;
    node.name = name;
    renderAreasTree();
}

/**
 * Change the type of a tree node (controller/area/subarea).
 * Altera o tipo do no, afetando seu icone na arvore.
 *
 * @param {string} nodeId
 * @param {string} newType
 */
export function handleChangeAreaNodeType(nodeId, newType) {
    const node = findNodeById(nodeId, window.areasTreeData || []);
    if (!node) return;
    node.type = newType;
    renderAreasTree();
}

/**
 * Update badges for a tree node from comma-separated input.
 * Atualiza os badges de um no a partir de entrada separada por virgula.
 *
 * @param {string} nodeId
 * @param {string} badgesStr - Comma-separated badge labels
 */
export function handleChangeAreaNodeBadges(nodeId, badgesStr) {
    const node = findNodeById(nodeId, window.areasTreeData || []);
    if (!node) return;
    node.badges = (badgesStr || '')
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean);
    renderAreasTree();
}

/**
 * Find the parent array that contains a given node, with its index.
 * Encontra o array-pai e o indice de um no na arvore.
 *
 * @param {string} nodeId
 * @param {Array} tree
 * @returns {{ array: Array, index: number }|null}
 */
function findParentArray(nodeId, tree) {
    for (let i = 0; i < tree.length; i++) {
        if (tree[i].id === nodeId) return { array: tree, index: i };
        if (Array.isArray(tree[i].children)) {
            const found = findParentArray(nodeId, tree[i].children);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Move a tree node up or down within its sibling list.
 * Reordena um no da arvore (troca posicao com vizinho).
 *
 * @param {string} nodeId - Node ID to move
 * @param {string} direction - 'up' or 'down'
 */
export function handleMoveAreaNode(nodeId, direction) {
    if (!Array.isArray(window.areasTreeData)) return;

    const loc = findParentArray(nodeId, window.areasTreeData);
    if (!loc) return;

    const { array, index } = loc;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= array.length) return;

    // Swap
    [array[index], array[targetIndex]] = [array[targetIndex], array[index]];

    renderAreasTree();
    renderAreaNodeDetail(nodeId);
}

// ----------------------------------------------------------------
// DOCUMENTS — Documentos/intangiveis vinculados aos nos
// Cada no pode ter documentos comprobatorios (contrato social,
// alvara, licenca ambiental) com hash SHA-256 para integridade.
// ----------------------------------------------------------------

/** @type {string|null} ID do no com formulario de documento aberto */
let _docFormOpenForNode = null;

/**
 * Toggle the add-document form for a node.
 * Abre ou fecha o formulario de adicao de documento.
 *
 * @param {string} nodeId
 */
export function handleAddNodeDocument(nodeId) {
    _docFormOpenForNode = _docFormOpenForNode === nodeId ? null : nodeId;
    renderAreaNodeDetail(nodeId);
}

/**
 * Handle file selection for document hash calculation.
 * Calcula SHA-256 do arquivo selecionado (nao armazena o arquivo).
 *
 * @param {Event} event - Input file change event
 */
export function handleDocFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const hashDisplay = document.getElementById('doc-file-hash');
    const nameInput = document.getElementById('doc-name-input');
    if (hashDisplay) hashDisplay.textContent = '...';

    // Auto-fill nome se vazio
    if (nameInput && !nameInput.value.trim()) {
        nameInput.value = file.name.replace(/\.[^.]+$/, '');
    }

    // Armazena metadados do arquivo no dataset do form
    const form = document.getElementById('doc-add-form');
    if (form) {
        form.dataset.fileName = file.name;
        form.dataset.fileSize = file.size;
    }

    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const buffer = reader.result;
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
            if (hashDisplay) hashDisplay.textContent = hashHex.slice(0, 16) + '...';
            if (form) form.dataset.fileHash = hashHex;
        } catch (err) {
            console.error('[docs] SHA-256 error:', err);
            if (hashDisplay) hashDisplay.textContent = 'Error';
        }
    };
    reader.readAsArrayBuffer(file);
}

/**
 * Save the new document to the node.
 * Salva o documento preenchido no no da arvore.
 *
 * @param {string} nodeId
 */
export function handleSaveNodeDocument(nodeId) {
    const node = findNodeById(nodeId, window.areasTreeData || []);
    if (!node) return;

    const form = document.getElementById('doc-add-form');
    const nameInput = document.getElementById('doc-name-input');
    const typeSelect = document.getElementById('doc-type-select');
    const issuerInput = document.getElementById('doc-issuer-input');
    const issueDateInput = document.getElementById('doc-issuedate-input');
    const expiresInput = document.getElementById('doc-expires-input');
    const notesInput = document.getElementById('doc-notes-input');

    if (!form || !nameInput) return;

    const name = (nameInput.value || '').trim();
    if (!name) {
        showToast(t('docNameRequired') || 'Document name is required', 'warning');
        return;
    }

    const fileHash = form.dataset.fileHash || '';
    if (!fileHash) {
        showToast(t('docFileRequired') || 'Select a file to calculate hash', 'warning');
        return;
    }

    const doc = {
        id: generateId('doc'),
        name,
        docType: typeSelect?.value || 'other',
        issuer: (issuerInput?.value || '').trim(),
        issueDate: issueDateInput?.value || '',
        expiresAt: expiresInput?.value || null,
        fileHash,
        fileName: form.dataset.fileName || '',
        fileSize: parseInt(form.dataset.fileSize) || 0,
        notes: (notesInput?.value || '').trim(),
    };

    if (!Array.isArray(node.documents)) node.documents = [];
    node.documents.push(doc);

    _docFormOpenForNode = null;
    renderAreasTree();
    renderAreaNodeDetail(nodeId);
    showToast(t('addDocument') || 'Document added', 'success');
}

/**
 * Remove a document from a node.
 * Remove um documento do no.
 *
 * @param {string} nodeId
 * @param {string} docId
 */
export function handleRemoveNodeDocument(nodeId, docId) {
    const node = findNodeById(nodeId, window.areasTreeData || []);
    if (!node || !Array.isArray(node.documents)) return;
    node.documents = node.documents.filter((d) => d.id !== docId);
    renderAreasTree();
    renderAreaNodeDetail(nodeId);
    showToast(t('removeDocument') || 'Document removed', 'info');
}

/**
 * Verify document integrity by comparing file hash.
 * Abre file picker, calcula SHA-256, compara com o hash armazenado.
 *
 * @param {string} nodeId
 * @param {string} docId
 */
export function handleVerifyDocument(nodeId, docId) {
    const node = findNodeById(nodeId, window.areasTreeData || []);
    if (!node || !Array.isArray(node.documents)) return;
    const doc = node.documents.find((d) => d.id === docId);
    if (!doc || !doc.fileHash) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';
    input.onchange = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const buffer = await file.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

            if (hashHex === doc.fileHash) {
                showToast(t('hashMatch') || 'File integrity verified', 'success');
            } else {
                showToast(t('hashMismatch') || 'Hash mismatch - file may have been altered', 'error');
            }
        } catch (err) {
            console.error('[docs] Verify error:', err);
            showToast('Verification failed', 'error');
        }
    };
    input.click();
}

// ----------------------------------------------------------------
// 3D HIGHLIGHT — Destaque visual de elementos vinculados ao no
// ----------------------------------------------------------------

/**
 * Highlight elements linked to the selected tree node.
 * Elementos vinculados ficam opacos, demais ficam semitransparentes.
 *
 * @param {string} nodeId
 */
function highlightLinkedElements(nodeId) {
    const elements = getAllElements() || [];
    if (elements.length === 0) return;

    for (const el of elements) {
        const mesh = getMeshByElementId(el.id);
        if (!mesh?.material) continue;

        // Salva opacidade original se ainda nao foi salva
        if (mesh.material._origOpacity === undefined) {
            mesh.material._origOpacity = mesh.material.opacity;
            mesh.material._origTransparent = mesh.material.transparent;
        }

        if (el.data?.areaId === nodeId) {
            mesh.material.opacity = mesh.material._origOpacity;
            mesh.material.transparent = mesh.material._origTransparent;
        } else {
            mesh.material.opacity = 0.15;
            mesh.material.transparent = true;
        }
        mesh.material.needsUpdate = true;
    }
}

/**
 * Clear all element highlights and restore original opacity.
 * Restaura a opacidade original de todos os elementos.
 */
function clearElementHighlights() {
    const elements = getAllElements() || [];
    for (const el of elements) {
        const mesh = getMeshByElementId(el.id);
        if (!mesh?.material) continue;
        if (mesh.material._origOpacity !== undefined) {
            mesh.material.opacity = mesh.material._origOpacity;
            mesh.material.transparent = mesh.material._origTransparent;
            delete mesh.material._origOpacity;
            delete mesh.material._origTransparent;
            mesh.material.needsUpdate = true;
        }
    }
}

/**
 * All project handler functions exposed to HTML via window.
 * Objeto com todas as funcoes de projeto para o HTML.
 */
export const projectHandlers = {
    handleAddProjectArea,
    handleRemoveProjectArea,
    handleProjectAreaChange,
    setProjectAreas,
    toggleAreaNode,
    selectAreaNode,
    setAreasTree,
    handleAreaRegistryTypeChange,
    handleAreaRegistryInput,
    handleSaveNodeRegistry,
    handleAddAreaNode,
    handleRemoveAreaNode,
    handleRenameAreaNode,
    handleChangeAreaNodeType,
    handleChangeAreaNodeBadges,
    handleMoveAreaNode,
    handleAddNodeDocument,
    handleDocFileSelected,
    handleSaveNodeDocument,
    handleRemoveNodeDocument,
    handleVerifyDocument,
    handleAddInputLink,
    handleAddOutputLink,
    handleRemoveInputLink,
    handleRemoveOutputLink,
    handleToggleCIOSection,
    handleOpenCIOForm,
    handleCancelCIOForm,
    handleSubmitCorporateInput,
    handleSubmitCorporateOutput,
    handleRemoveCorporateInput,
    handleRemoveCorporateOutput,
    handleInitModeChange,
    handleOpenMapPicker,
    handleShowWelcome,
    handleConvertToLatLon,
    handleConvertToUTM,
    newProject: async () => {
        // Guard contra chamadas concorrentes
        if (window.__ecbyts_clearing) return;

        const elementCount = getAllElements().length;
        const campaignCount = getAllCampaigns().length;
        const hasData = elementCount > 0 || campaignCount > 0;

        if (!hasData) {
            // Modelo vazio — confirm simples
            if (await asyncConfirm(t('newProjectConfirm') || 'Start a new project?')) {
                window.__ecbyts_clearing = true;
                resetModelIdentity();
                await generateModelId();
                clearModelData();
                location.reload();
            }
            return;
        }

        // Modelo com dados — dialog com opcao de backup
        const msg =
            (
                t('newProjectBackupPrompt') ||
                'Current model has {elements} elements and {campaigns} campaigns. All data will be lost.'
            )
                .replace('{elements}', elementCount)
                .replace('{campaigns}', campaignCount) +
            '\n\n' +
            (t('newProjectBackupHint') || 'You can download a backup before clearing. Continue?');

        if (!(await asyncConfirm(msg))) return;

        // Oferecer backup antes de limpar
        try {
            const { createAutoBackup } = await import('../../core/io/export.js');
            const backupResult = await createAutoBackup('pre-new-project');
            if (backupResult.success) {
                showToast(
                    (t('backupCreated') || 'Backup downloaded: {filename}').replace(
                        '{filename}',
                        backupResult.filename,
                    ),
                    'success',
                    5000,
                );
            }
        } catch (err) {
            console.error('[ecbyts] Backup before new project failed:', err);
            showToast(t('backupFailed') || 'Backup failed. Proceeding without backup.', 'warning');
        }

        window.__ecbyts_clearing = true;
        resetModelIdentity();
        await generateModelId();
        clearModelData();
        location.reload();
    },
};
