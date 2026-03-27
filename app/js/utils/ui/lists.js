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
   ATUALIZACAO DE LISTAS DA INTERFACE
   ================================================================

   Este modulo atualiza as listas visuais da interface:
   - Lista de familias (painel esquerdo)
   - Lista de elementos (aba Elements)
   - Barra de status

   SEPARACAO DE RESPONSABILIDADES:
   - Manager: gerencia dados dos elementos
   - Lists: atualiza representacao visual dos dados

   ================================================================ */

import { t } from '../i18n/translations.js';
import { getIcon, getFamilyIcon, hydrateIcons } from './icons.js';
import { escapeHtml, formatUncertainty } from '../helpers/html.js';
import { getAllFamilies, getEnabledFamilies, getFamilyName } from '../../core/elements/families.js';
import {
    getAllElements,
    countByFamily,
    getElementCount,
    getSelectedElement,
    getElementTree,
    isEffectivelyVisible,
} from '../../core/elements/manager.js';
import { getAllCampaigns, getCampaignCompleteness } from '../../core/campaigns/manager.js';
import { getUserConstantById } from '../../core/constants/manager.js';
import { getAllScenes } from '../scenes/manager.js';
import { CONFIG } from '../../config.js';
import { renderParameterSelect } from './customSelect.js';
import { canEditElement, isObserver, isAccessControlActive } from '../auth/permissions.js';
import {
    getElementGroups,
    getElementGroup,
    isElementUngroupedCollapsed,
    setElementGroup,
    clearElementGroup,
    getFamilyGroups,
    getFamilyGroup,
    isFamilyUngroupedCollapsed,
    setFamilyGroup,
    clearFamilyGroup,
} from '../groups/manager.js';
import { hasStrategy, isEditing, getEditingElementId, getEditMode } from '../editing/editManager.js';
import {
    renderBoundaryControls,
    renderAreaControls,
    renderSensorSummaryControls,
    renderOrgUnitDropdown,
} from './elementControls.js';
import { validateObservationFull } from '../../core/validation/rules.js';
import { EIS_CREDENTIAL_LABELS, EIS_CREDENTIAL_MULTIPLIERS } from '../../core/eis/eisCalculator.js';
import { getAllLayers, getSelectedLayer, GRID_SIZES } from '../../core/interpolation/manager.js';
import { INTERPOLATION_METHODS } from '../../core/interpolation/engine.js';
import { getRampNames } from '../../core/interpolation/colorRamps.js';
import { getAllVolumes, getSelectedVolume } from '../../core/voxel/manager.js';
import { countByZone, VADOSE, SATURATED } from '../../core/voxel/engine.js';
import { isVoxelEditing } from '../../core/voxel/editController.js';
import { hasFamilyModule } from '../../core/elements/familyModuleRegistry.js';
import { getPerElementLabel } from '../labels/manager.js';
import { getProjects } from '../governance/projectManager.js';
import { resolveObservation } from '../../core/bindings/resolver.js';

// ----------------------------------------------------------------
// OBSERVATION LAZY-LOAD STATE
// Paginacao de observacoes por elemento (default: 10 visiveis)
// ----------------------------------------------------------------

const _obsVisibleCounts = {};

/**
 * Incrementa observacoes visiveis para um elemento.
 * Chamada pelo botao "Mostrar mais" no painel de detalhes.
 */
export function showMoreObservations(elementId, increment) {
    _obsVisibleCounts[elementId] = (_obsVisibleCounts[elementId] || 10) + increment;
    updateElementDetails();
}

/**
 * Mostra todas as observacoes de um elemento.
 */
export function showAllObservations(elementId, total) {
    _obsVisibleCounts[elementId] = total;
    updateElementDetails();
}

// ----------------------------------------------------------------
// OBSERVATION CAMPAIGN GROUPING STATE
// ----------------------------------------------------------------

/** Set of expanded campaign keys: "elementId:campaignId" */
const _obsCampaignExpanded = new Set();

/** Currently expanded observation (full card): "elementId" → originalIndex or null */
const _obsExpandedIdx = {};

/**
 * Toggle campaign group expand/collapse.
 * @param {string} elementId
 * @param {string} campaignKey - campaignId or '__none__'
 */
export function toggleObsCampaign(elementId, campaignKey) {
    const key = `${elementId}:${campaignKey}`;
    if (_obsCampaignExpanded.has(key)) _obsCampaignExpanded.delete(key);
    else _obsCampaignExpanded.add(key);
    updateElementDetails();
}

/**
 * Expand a single observation to full card view.
 * @param {string} elementId
 * @param {number} originalIndex - Index in the flat observations array
 */
export function expandObservation(elementId, originalIndex) {
    if (_obsExpandedIdx[elementId] === originalIndex) {
        _obsExpandedIdx[elementId] = null; // toggle off
    } else {
        _obsExpandedIdx[elementId] = originalIndex;
    }
    updateElementDetails();
}

// ----------------------------------------------------------------
// LISTA DE FAMILIAS
// ----------------------------------------------------------------

/**
 * Atualiza lista de familias no painel esquerdo.
 * Agrupa familias em grupos customizaveis com drag-and-drop.
 *
 * @param {Function} onAddElement - Callback quando usuario clica para adicionar
 */
export function updateFamiliesList(onAddElement) {
    const container = document.getElementById('families-list');
    if (!container) return;

    const counts = countByFamily();
    const families = getEnabledFamilies();
    const groups = getFamilyGroups();

    // Particiona familias por grupo
    const grouped = {};
    const ungrouped = [];
    for (const family of families) {
        const gid = getFamilyGroup(family.id);
        if (gid && groups.find((g) => g.id === gid)) {
            (grouped[gid] = grouped[gid] || []).push(family);
        } else {
            ungrouped.push(family);
        }
    }

    let html = '';

    // Grupos com suas familias
    for (const group of groups) {
        const items = grouped[group.id] || [];
        const collapsedClass = group.collapsed ? ' collapsed' : '';
        const chevron = group.collapsed ? '▶' : '▼';

        html += `
            <div class="element-group${collapsedClass}" data-group-id="${group.id}" data-drop-zone="family-group">
                <div class="element-group-header" onclick="window.handleToggleFamilyGroupCollapse('${group.id}')">
                    <span class="element-group-chevron">${chevron}</span>
                    <span class="element-group-color" style="background:${escapeHtml(group.color)};"></span>
                    <span class="element-group-name">${escapeHtml(group.name)}</span>
                    <span class="element-group-count">(${items.length})</span>
                    <button class="element-group-btn" onclick="event.stopPropagation(); window.handleRenameFamilyGroup('${group.id}')" title="${t('editGroup') || 'Edit'}">
                        ${getIcon('edit', { size: '11px' })}
                    </button>
                    <button class="element-group-btn" onclick="event.stopPropagation(); window.handleRemoveFamilyGroup('${group.id}')" title="${t('removeGroup') || 'Remove'}">
                        ${getIcon('x', { size: '11px' })}
                    </button>
                </div>
                <div class="element-group-content">
                    ${items.map((family) => _renderFamilyItem(family, counts)).join('')}
                    ${items.length === 0 ? `<div class="element-group-empty">${t('dropHere') || 'Drag families here'}</div>` : ''}
                </div>
            </div>
        `;
    }

    // Familias sem grupo
    if (groups.length > 0) {
        const ungCollapsed = isFamilyUngroupedCollapsed();
        const collapsedClass = ungCollapsed ? ' collapsed' : '';
        const chevron = ungCollapsed ? '▶' : '▼';

        html += `
            <div class="element-group element-group-ungrouped${collapsedClass}" data-group-id="" data-drop-zone="family-group">
                <div class="element-group-header" onclick="window.handleToggleFamilyUngroupedCollapse()">
                    <span class="element-group-chevron">${chevron}</span>
                    <span class="element-group-name">${t('ungrouped') || 'Ungrouped'}</span>
                    <span class="element-group-count">(${ungrouped.length})</span>
                </div>
                <div class="element-group-content">
                    ${ungrouped.map((family) => _renderFamilyItem(family, counts)).join('')}
                </div>
            </div>
        `;
    } else {
        // Sem grupos — renderiza lista plana (sem wrapper)
        html += ungrouped.map((family) => _renderFamilyItem(family, counts)).join('');
    }

    // Botao para adicionar grupo de familias
    html += `
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top:6px; width:100%;"
                onclick="window.handleAddFamilyGroup()">
            ${getIcon('folder-plus', { size: '14px' })} ${t('addGroup') || 'Add Group'}
        </button>
    `;

    container.innerHTML = html;

    // Instala drag-and-drop nos family items e drop zones
    _installFamilyDnD(container);
}

/** Render a single family item (used in grouped and ungrouped). */
function _renderFamilyItem(family, counts) {
    return `
        <div class="family-item" draggable="true" data-family-id="${family.id}"
             onclick="window.handleAddElement('${family.id}')">
            <div class="icon">${getFamilyIcon(family.id)}</div>
            <div class="info">
                <div class="name">${getFamilyName(family)}</div>
                <div class="count">${counts[family.id] || 0} ${t('elements')}</div>
            </div>
            <div class="actions">
                <button type="button"
                        class="family-action-btn"
                        onclick="event.stopPropagation(); window.handleAddElement('${family.id}')"
                        title="Add">
                    ${getIcon('plus', { size: '14px' })}
                </button>
            </div>
        </div>
    `;
}

/** Install HTML5 drag-and-drop for family items → group zones. */
/**
 * Instala DnD genérico para itens agrupáveis.
 * Reutilizado por famílias e elementos.
 *
 * @param {HTMLElement} container - Container com itens e drop zones
 * @param {Object} opts
 * @param {string} opts.itemSelector - Seletor dos itens arrastáveis
 * @param {string} opts.dataAttr - Atributo dataset do item (ex: 'familyId')
 * @param {string} opts.zoneSelector - Seletor das drop zones
 * @param {Function} opts.onAssign - Callback (id, groupId) ao soltar em grupo
 * @param {Function} opts.onClear - Callback (id) ao soltar em zona sem grupo
 * @param {boolean} [opts.stopPropagation] - Se true, chama stopPropagation no dragstart
 */
function _installDnD(container, { itemSelector, dataAttr, zoneSelector, onAssign, onClear, stopPropagation }) {
    container.querySelectorAll(itemSelector).forEach((item) => {
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', item.dataset[dataAttr]);
            e.dataTransfer.effectAllowed = 'move';
            item.classList.add('dragging');
            if (stopPropagation) e.stopPropagation();
        });
        item.addEventListener('dragend', () => item.classList.remove('dragging'));
    });

    container.querySelectorAll(zoneSelector).forEach((zone) => {
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', (e) => {
            if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
        });
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const id = e.dataTransfer.getData('text/plain');
            const groupId = zone.dataset.groupId;
            if (id) {
                if (groupId) onAssign(id, groupId);
                else onClear(id);
            }
        });
    });
}

function _installFamilyDnD(container) {
    _installDnD(container, {
        itemSelector: '.family-item[draggable]',
        dataAttr: 'familyId',
        zoneSelector: '[data-drop-zone="family-group"]',
        onAssign: setFamilyGroup,
        onClear: clearFamilyGroup,
    });
}

// ----------------------------------------------------------------
// LISTA DE ELEMENTOS
// ----------------------------------------------------------------

/**
 * Atualiza lista de elementos na aba Elements.
 * Agrupa elementos em grupos customizaveis com drag-and-drop.
 *
 * @param {Function} onToggleVisibility - Callback para alternar visibilidade
 * @param {Function} onRemove - Callback para remover elemento
 */
export function updateElementsList(onToggleVisibility, onRemove) {
    const container = document.getElementById('elements-list');
    if (!container) return;

    const elements = getAllElements();
    const families = getAllFamilies();
    const selected = getSelectedElement();
    const groups = getElementGroups();

    // Rescue details section before innerHTML destroys it
    // Pode estar dentro de .element-group-content (descendente), nao filho direto
    const detailsBefore = document.getElementById('element-details')?.closest('.section');
    if (detailsBefore && container.contains(detailsBefore)) {
        const tab = document.getElementById('tab-elements');
        if (tab) tab.appendChild(detailsBefore);
    }

    // Mensagem se nao houver elementos nem layers
    const layers = getAllLayers();
    if (elements.length === 0 && layers.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--neutral-500);">
                <p>No elements yet.</p>
                <p style="font-size: 11px;">Click on a family to add elements.</p>
            </div>
        `;
        return;
    }

    // Modo arvore hierarquica: ativo quando FEATURES.SPATIAL_HIERARCHY e ha containers
    if (CONFIG.FEATURES?.SPATIAL_HIERARCHY && _hasAnyContainer(elements, families)) {
        _renderHierarchyTreeIntoContainer(container, elements, families, selected);
        // Reposiciona details section (mesmo comportamento do modo lista)
        const docked = localStorage.getItem('ecbyts-details-docked') === 'true';
        const detailsSection2 = document.getElementById('element-details')?.closest('.section');
        const tab2 = document.getElementById('tab-elements');
        if (docked) {
            if (tab2) {
                tab2.classList.add('details-docked');
                if (detailsSection2 && detailsSection2.parentElement !== tab2) tab2.appendChild(detailsSection2);
            }
            if (detailsSection2) detailsSection2.style.display = '';
        } else {
            if (tab2) tab2.classList.remove('details-docked');
            if (detailsSection2 && selected) {
                const c2 = container.querySelector('.element-card.selected');
                if (c2) {
                    c2.after(detailsSection2);
                    detailsSection2.style.display = '';
                }
            } else if (detailsSection2 && !selected) {
                if (tab2 && detailsSection2.parentElement !== tab2) tab2.appendChild(detailsSection2);
                detailsSection2.style.display = '';
            }
        }
        return;
    }

    // Particiona elementos por grupo
    const grouped = {};
    const ungrouped = [];
    for (const el of elements) {
        const gid = getElementGroup(el.id);
        if (gid && groups.find((g) => g.id === gid)) {
            (grouped[gid] = grouped[gid] || []).push(el);
        } else {
            ungrouped.push(el);
        }
    }

    let html = '';

    // Grupos com seus elementos
    for (const group of groups) {
        const items = grouped[group.id] || [];
        const collapsedClass = group.collapsed ? ' collapsed' : '';
        const chevron = group.collapsed ? '▶' : '▼';

        html += `
            <div class="element-group${collapsedClass}" data-group-id="${group.id}" data-drop-zone="element-group">
                <div class="element-group-header" onclick="window.handleToggleElementGroupCollapse('${group.id}')">
                    <span class="element-group-chevron">${chevron}</span>
                    <span class="element-group-color" style="background:${escapeHtml(group.color)};"></span>
                    <span class="element-group-name">${escapeHtml(group.name)}</span>
                    <span class="element-group-count">(${items.length})</span>
                    <button class="element-group-btn" onclick="event.stopPropagation(); window.handleRenameElementGroup('${group.id}')" title="${t('editGroup') || 'Edit'}">
                        ${getIcon('edit', { size: '11px' })}
                    </button>
                    <button class="element-group-btn" onclick="event.stopPropagation(); window.handleRemoveElementGroup('${group.id}')" title="${t('removeGroup') || 'Remove'}">
                        ${getIcon('x', { size: '11px' })}
                    </button>
                </div>
                <div class="element-group-content">
                    ${items.map((el) => _renderElementCard(el, families, selected)).join('')}
                    ${items.length === 0 ? `<div class="element-group-empty">${t('dropHere') || 'Drag elements here'}</div>` : ''}
                </div>
            </div>
        `;
    }

    // Elementos sem grupo
    if (groups.length > 0) {
        const ungCollapsed = isElementUngroupedCollapsed();
        const ungCollapsedClass = ungCollapsed ? ' collapsed' : '';
        const ungChevron = ungCollapsed ? '▶' : '▼';

        html += `
            <div class="element-group element-group-ungrouped${ungCollapsedClass}" data-group-id="" data-drop-zone="element-group">
                <div class="element-group-header" onclick="window.handleToggleElementUngroupedCollapse()">
                    <span class="element-group-chevron">${ungChevron}</span>
                    <span class="element-group-name">${t('ungrouped') || 'Ungrouped'}</span>
                    <span class="element-group-count">(${ungrouped.length})</span>
                </div>
                <div class="element-group-content">
                    ${ungrouped.map((el) => _renderElementCard(el, families, selected)).join('')}
                </div>
            </div>
        `;
    } else {
        // Sem grupos — renderiza lista plana (sem wrapper)
        html += ungrouped.map((el) => _renderElementCard(el, families, selected)).join('');
    }

    // Botao para adicionar grupo de elementos
    html += `
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top:6px; width:100%;"
                onclick="window.handleAddElementGroup()">
            ${getIcon('folder-plus', { size: '14px' })} ${t('addGroup') || 'Add Group'}
        </button>
    `;

    // Seção de layers de interpolação (Surfaces)
    if (layers.length > 0) {
        const selLayer = getSelectedLayer();
        html += `
            <div class="element-group" style="margin-top:8px;">
                <div class="element-group-header" style="cursor:default;">
                    <span class="element-group-chevron">▼</span>
                    <span class="element-group-name">${t('surfacesGroup') || 'Surfaces'}</span>
                    <span class="element-group-count">(${layers.length})</span>
                </div>
                <div class="element-group-content">
                    ${layers.map((l) => _renderLayerCard(l, selLayer)).join('')}
                </div>
            </div>
        `;
    }

    // Seção de volumes voxelizados (Geology)
    const volumes = getAllVolumes();
    if (volumes.length > 0) {
        const selVolume = getSelectedVolume();
        html += `
            <div class="element-group" style="margin-top:8px;">
                <div class="element-group-header" style="cursor:default;">
                    <span class="element-group-chevron">▼</span>
                    <span class="element-group-name">${t('geologyGroup') || 'Geology'}</span>
                    <span class="element-group-count">(${volumes.length})</span>
                </div>
                <div class="element-group-content">
                    ${volumes.map((v) => _renderVolumeCard(v, selVolume)).join('')}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;

    // Instala drag-and-drop
    _installElementDnD(container);

    // Move details section: docked (fixed at bottom) or inline (after selected card)
    const docked = localStorage.getItem('ecbyts-details-docked') === 'true';
    const detailsSection = document.getElementById('element-details')?.closest('.section');
    const tab = document.getElementById('tab-elements');

    if (docked) {
        // Docked: details stays at bottom of tab, not moved inline
        if (tab) {
            tab.classList.add('details-docked');
            if (detailsSection && detailsSection.parentElement !== tab) {
                tab.appendChild(detailsSection);
            }
        }
        if (detailsSection) detailsSection.style.display = '';
    } else {
        // Inline: details follows the selected card
        if (tab) tab.classList.remove('details-docked');
        if (detailsSection && selected) {
            const selectedCard = container.querySelector('.element-card.selected');
            if (selectedCard) {
                selectedCard.after(detailsSection);
                detailsSection.style.display = '';
            }
        } else if (detailsSection && !selected) {
            if (tab && detailsSection.parentElement !== tab) {
                tab.appendChild(detailsSection);
            }
            detailsSection.style.display = '';
        }
    }
}

// ----------------------------------------------------------------
// HIERARQUIA ESPACIAL PDPL-U
// Renderiza arvore Project → Area → Zone → Element
// quando FEATURES.SPATIAL_HIERARCHY esta habilitado
// ----------------------------------------------------------------

/**
 * Verifica se o modelo tem algum elemento container.
 * Usado para decidir entre modo arvore e modo lista plana.
 *
 * @param {Object[]} elements - Lista de todos os elementos
 * @param {Object} families - Mapa de familias
 * @returns {boolean}
 */
function _hasAnyContainer(elements, families) {
    return elements.some((el) => families[el.family]?.isContainer);
}

/**
 * Renderiza a arvore hierarquica completa no container.
 * Substitui a logica de lista plana quando SPATIAL_HIERARCHY esta ativo.
 *
 * @param {string} container - Elemento DOM #elements-list
 * @param {Object[]} elements - Todos os elementos
 * @param {Object} families - Mapa de familias
 * @param {Object|null} selected - Elemento selecionado
 */
function _renderHierarchyTreeIntoContainer(container, elements, families, selected) {
    const tree = getElementTree();
    let html = '';

    // Botoes para adicionar containers
    html += `<div class="hierarchy-add-bar">
        <button class="btn btn-secondary btn-xs hierarchy-add-btn"
                onclick="window.handleAddContainer('site_project')"
                title="Adicionar Projeto">
            ${getIcon('folder-plus', { size: '13px' })} Projeto
        </button>
        <button class="btn btn-secondary btn-xs hierarchy-add-btn"
                onclick="window.handleAddContainer('site_area')"
                title="Adicionar Area de Investigacao">
            ${getIcon('map', { size: '13px' })} Area
        </button>
        <button class="btn btn-secondary btn-xs hierarchy-add-btn"
                onclick="window.handleAddContainer('site_zone')"
                title="Adicionar Zona">
            ${getIcon('square', { size: '13px' })} Zona
        </button>
    </div>`;

    // Arvore recursiva
    for (const node of tree) {
        html += _renderHierarchyNode(node, families, selected, 0);
    }

    // Zona de drop para raiz (fora de qualquer container)
    html += `<div class="hierarchy-root-drop" data-parent-id="" title="Soltar aqui para mover para raiz"></div>`;

    container.innerHTML = html;
    _installHierarchyDnD(container);
}

/**
 * Renderiza um no da arvore hierarquica (container ou folha) recursivamente.
 *
 * @param {{element: Object, children: Array}} node - No da arvore
 * @param {Object} families - Mapa de familias
 * @param {Object|null} selected - Elemento selecionado
 * @param {number} depth - Nivel de profundidade (0 = raiz)
 * @returns {string} HTML
 */
function _renderHierarchyNode(node, families, selected, depth) {
    const { element, children } = node;
    const family = families[element.family];
    const isContainer = family?.isContainer === true;
    const indent = depth * 16;
    const collapsed = localStorage.getItem(`ecbyts-container-collapsed-${element.id}`) === '1';
    const effectiveVis = isEffectivelyVisible(element.id);
    const opacityClass = effectiveVis ? '' : 'opacity-50';
    const selectedClass = selected?.id === element.id ? 'selected' : '';

    if (isContainer) {
        const chevron = collapsed ? '&#9654;' : '&#9660;';
        const childCount = children.length;
        const visibilityIcon = element.visible
            ? getIcon('eye', { size: '13px' })
            : getIcon('eye-off', { size: '13px' });

        let html = `
            <div class="hierarchy-container-node ${opacityClass} ${selectedClass}"
                 data-element-id="${element.id}"
                 data-drop-zone="hierarchy-container"
                 style="padding-left:${indent}px"
                 draggable="true">
                <div class="hierarchy-container-header" onclick="window.handleSelectElement('${element.id}')">
                    <span class="hierarchy-chevron"
                          onclick="event.stopPropagation(); window.handleToggleContainerCollapse('${element.id}')">${chevron}</span>
                    <span class="hierarchy-container-icon">${getIcon(family?.icon || 'folder', { size: '13px' })}</span>
                    <span class="hierarchy-container-name">${escapeHtml(element.name)}</span>
                    <span class="hierarchy-child-count">(${childCount})</span>
                    <button class="element-card-toggle"
                            onclick="event.stopPropagation(); window.handleToggleVisibility('${element.id}')"
                            title="${element.visible ? 'Hide' : 'Show'}">${visibilityIcon}</button>
                    <button class="element-card-delete"
                            onclick="event.stopPropagation(); window.handleRemoveElement('${element.id}')"
                            title="Remove">${getIcon('x', { size: '12px' })}</button>
                </div>`;

        if (!collapsed) {
            html += `<div class="hierarchy-children">`;
            for (const child of children) {
                html += _renderHierarchyNode(child, families, selected, depth + 1);
            }
            if (children.length === 0) {
                html += `<div class="hierarchy-empty-drop" data-parent-id="${element.id}"
                               style="padding-left:${(depth + 1) * 16}px">
                            <span class="inspector-muted">Arraste elementos aqui</span>
                         </div>`;
            }
            html += `</div>`;
        }

        html += `</div>`;
        return html;
    }

    // Elemento folha — reutiliza card existente com indentacao
    return `<div style="padding-left:${indent}px" data-hierarchy-leaf="true">${_renderElementCard(element, families, selected)}</div>`;
}

/**
 * Instala drag-and-drop para reparentalizar elementos na arvore hierarquica.
 * Draggable: qualquer elemento; Target: containers e zona raiz.
 *
 * @param {HTMLElement} container - Container #elements-list
 */
function _installHierarchyDnD(container) {
    let draggingId = null;

    container.addEventListener('dragstart', (e) => {
        const card = e.target.closest('[data-element-id]');
        if (!card) return;
        draggingId = card.dataset.elementId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggingId);
        card.classList.add('hierarchy-dragging');
    });

    container.addEventListener('dragend', (e) => {
        draggingId = null;
        container.querySelectorAll('.hierarchy-drag-over').forEach((el) => el.classList.remove('hierarchy-drag-over'));
        container.querySelectorAll('.hierarchy-dragging').forEach((el) => el.classList.remove('hierarchy-dragging'));
    });

    container.addEventListener('dragover', (e) => {
        const target = e.target.closest(
            '[data-drop-zone="hierarchy-container"], .hierarchy-root-drop, .hierarchy-empty-drop',
        );
        if (!target) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.querySelectorAll('.hierarchy-drag-over').forEach((el) => el.classList.remove('hierarchy-drag-over'));
        target.classList.add('hierarchy-drag-over');
    });

    container.addEventListener('dragleave', (e) => {
        // Ignora dragleave disparado por filhos do mesmo target
        const target = e.target.closest(
            '[data-drop-zone="hierarchy-container"], .hierarchy-root-drop, .hierarchy-empty-drop',
        );
        if (target && !target.contains(e.relatedTarget)) {
            target.classList.remove('hierarchy-drag-over');
        }
    });

    container.addEventListener('drop', (e) => {
        const target = e.target.closest(
            '[data-drop-zone="hierarchy-container"], .hierarchy-root-drop, .hierarchy-empty-drop',
        );
        if (!target || !draggingId) return;
        e.preventDefault();
        target.classList.remove('hierarchy-drag-over');
        const parentId = target.dataset.parentId || target.dataset.elementId || null;
        if (parentId !== draggingId) {
            window.handleSetParent(draggingId, parentId || null);
        }
        draggingId = null;
    });
}

/** Render a single element card (used in grouped and ungrouped sections). */
function _renderElementCard(element, families, selected) {
    const family = families[element.family];
    const icon = element.iconClass ? '' : getIcon(family?.icon || 'map-pin', { size: '14px' });
    const effectiveVisible = isEffectivelyVisible(element.id);
    const visibilityIcon = element.visible ? getIcon('eye', { size: '14px' }) : getIcon('eye-off', { size: '14px' });
    const opacityClass = effectiveVisible ? '' : 'opacity-50';
    const selectedClass = selected?.id === element.id ? 'selected' : '';
    const iconClass = element.iconClass ? ` ${element.iconClass}` : '';

    const hasModules = hasFamilyModule(element.family);
    const moduleBtn = hasModules
        ? `
                <button class="element-card-modules"
                        onclick="event.stopPropagation(); window.handleOpenFamilyModulePicker('${element.id}', this)"
                        title="${t('subModules') || 'Sub-modules'}">
                    ${getIcon('layers', { size: '13px' })}
                </button>`
        : '';

    return `
        <div class="element-card ${opacityClass} ${selectedClass}" draggable="true"
             data-element-id="${element.id}"
             onclick="window.handleSelectElement('${element.id}')">
            <div class="element-card-header">
                <span class="element-card-icon${iconClass}">${icon}</span>
                <span class="element-card-name">${escapeHtml(element.name)}</span>
                ${moduleBtn}
                <button class="element-card-toggle"
                        onclick="event.stopPropagation(); window.handleToggleVisibility('${element.id}')"
                        title="${element.visible ? 'Hide' : 'Show'}">
                    ${visibilityIcon}
                </button>
                <button class="element-card-delete"
                        onclick="event.stopPropagation(); window.handleRemoveElement('${element.id}')"
                        title="Remove">
                    ${getIcon('x', { size: '12px' })}
                </button>
            </div>${
                element.description
                    ? `
            <div class="element-card-desc" title="${escapeHtml(element.description)}">${escapeHtml(element.description)}</div>`
                    : ''
            }
        </div>
    `;
}

/** Layer type → icon mapping */
const LAYER_ICONS = {
    terrain: 'mountain',
    water_table: 'droplet',
    contamination: 'alert-triangle',
    custom: 'layers',
};

/** Render a single interpolation layer card with inline controls when selected. */
function _renderLayerCard(layer, selectedLayerId) {
    const icon = getIcon(LAYER_ICONS[layer.type] || 'layers', { size: '14px' });
    const visIcon = layer.visible ? getIcon('eye', { size: '14px' }) : getIcon('eye-off', { size: '14px' });
    const opClass = layer.visible ? '' : 'opacity-50';
    const isSelected = selectedLayerId === layer.id;
    const selClass = isSelected ? 'selected' : '';

    const inlineControls = isSelected ? _renderLayerInlineControls(layer) : '';

    return `
        <div class="element-card ${opClass} ${selClass}"
             data-layer-id="${layer.id}"
             onclick="window.handleSelectLayer('${layer.id}')">
            <div class="element-card-header">
                <span class="element-card-icon">${icon}</span>
                <span class="element-card-name">${escapeHtml(layer.name)}</span>
                <button class="element-card-toggle"
                        onclick="event.stopPropagation(); window.handleToggleLayerVisibility('${layer.id}')"
                        title="${layer.visible ? 'Hide' : 'Show'}">
                    ${visIcon}
                </button>
                <button class="element-card-delete"
                        onclick="event.stopPropagation(); window.handleRemoveInterpolationLayer('${layer.id}')"
                        title="Remove">
                    ${getIcon('x', { size: '12px' })}
                </button>
            </div>
            ${inlineControls}
        </div>
    `;
}

/** Render inline controls for a selected interpolation layer. */
function _renderLayerInlineControls(layer) {
    // Method dropdown
    const methodOptions = Object.values(INTERPOLATION_METHODS)
        .map((m) => `<option value="${m.id}" ${layer.method === m.id ? 'selected' : ''}>${m.name}</option>`)
        .join('');

    // Grid size dropdown
    const gridOptions = GRID_SIZES.map(
        (g) => `<option value="${g.cols}" ${layer.gridSize?.cols === g.cols ? 'selected' : ''}>${g.label}</option>`,
    ).join('');

    // Color ramp dropdown
    const rampNames = getRampNames();
    const rampOptions = rampNames
        .map((name) => `<option value="${name}" ${layer.colorRamp === name ? 'selected' : ''}>${name}</option>`)
        .join('');

    // Stats
    const stats = layer.stats
        ? `<div class="layer-inline-stats">Min: ${layer.stats.min.toFixed(1)} | Max: ${layer.stats.max.toFixed(1)} | Avg: ${layer.stats.mean.toFixed(1)}</div>`
        : '';
    const contourControls = ['water_table', 'terrain', 'contamination'].includes(layer.type)
        ? `
            <div class="layer-control-row">
                <label>${layer.type === 'contamination' ? 'Isolines' : 'Contours'}</label>
                <input type="checkbox"
                       ${layer.showContours ? 'checked' : ''}
                       onchange="window.handleToggleInterpolationContours('${layer.id}')">
            </div>
            <div class="layer-control-row">
                <label>Contour Density</label>
                <select onchange="window.handleChangeInterpolationContourDensity('${layer.id}', this.value)">
                    <option value="low" ${layer.contourDensity === 'low' ? 'selected' : ''}>Low</option>
                    <option value="medium" ${layer.contourDensity !== 'low' && layer.contourDensity !== 'high' ? 'selected' : ''}>Medium</option>
                    <option value="high" ${layer.contourDensity === 'high' ? 'selected' : ''}>High</option>
                </select>
            </div>
            <div class="layer-control-row">
                <label>${layer.type === 'water_table' ? 'Contour Labels' : 'Line Labels'}</label>
                <input type="checkbox"
                       ${layer.showContourLabels ? 'checked' : ''}
                       onchange="window.handleToggleInterpolationContourLabels('${layer.id}')">
            </div>
    `
        : '';

    return `
        <div class="layer-inline-controls" onclick="event.stopPropagation();">
            <div class="layer-control-row">
                <label>${t('interpolationMethod') || 'Method'}</label>
                <select onchange="window.handleChangeInterpolationMethod('${layer.id}', this.value); window.handleRefreshInterpolationLayer('${layer.id}')">
                    ${methodOptions}
                </select>
            </div>
            <div class="layer-control-row">
                <label>${t('interpolationGridSize') || 'Grid'}</label>
                <select onchange="window.handleChangeInterpolationGridSize('${layer.id}', this.value)">
                    ${gridOptions}
                </select>
            </div>
            <div class="layer-control-row">
                <label>${t('interpolationColorRamp') || 'Palette'}</label>
                <select onchange="window.handleChangeInterpolationColorRamp('${layer.id}', this.value)">
                    ${rampOptions}
                </select>
            </div>
            <div class="layer-control-row">
                <label>${t('interpolationOpacity') || 'Opacity'}</label>
                <input type="range" min="0" max="1" step="0.05"
                       value="${layer.opacity ?? 0.85}"
                       oninput="window.handleChangeInterpolationOpacity('${layer.id}', this.value)">
            </div>
            <div class="layer-control-row">
                <button class="btn btn-sm ${layer.wireframe ? 'active' : ''}"
                        onclick="window.handleToggleWireframe('${layer.id}')">
                    ${getIcon('grid', { size: '12px' })} Wireframe
                </button>
                <button class="btn btn-sm"
                        onclick="window.handleRefreshInterpolationLayer('${layer.id}')">
                    ${getIcon('refresh-cw', { size: '12px' })} Refresh
                </button>
            </div>
            ${contourControls}
            ${stats}
        </div>
    `;
}

/** Render a single voxel volume card with inline controls when selected. */
function _renderVolumeCard(volume, selectedVolumeId) {
    const icon = getIcon('box', { size: '14px' });
    const visIcon = volume.visible ? getIcon('eye', { size: '14px' }) : getIcon('eye-off', { size: '14px' });
    const opClass = volume.visible ? '' : 'opacity-50';
    const isSelected = selectedVolumeId === volume.id;
    const selClass = isSelected ? 'selected' : '';
    const modeBadge = volume.mode === 'voxels' ? 'Voxels' : 'Solid';

    let zoneInfo = '';
    if (volume.grid && volume.dims) {
        const vadoseN = countByZone(volume.grid, VADOSE);
        const saturatedN = countByZone(volume.grid, SATURATED);
        zoneInfo = `<span class="volume-card-zones">${(vadoseN + saturatedN).toLocaleString()}</span>`;
    }

    const inlineControls = isSelected ? _renderVolumeInlineControls(volume) : '';

    return `
        <div class="element-card ${opClass} ${selClass}"
             data-volume-id="${volume.id}"
             onclick="window.handleSelectVolume('${volume.id}')">
            <div class="element-card-header">
                <span class="element-card-icon">${icon}</span>
                <span class="element-card-name">${escapeHtml(volume.name)}</span>
                <span class="volume-mode-badge">${modeBadge}</span>
                ${zoneInfo}
                <button class="element-card-toggle"
                        onclick="event.stopPropagation(); window.handleToggleVoxelVisible('${volume.id}')"
                        title="${volume.visible ? 'Hide' : 'Show'}">
                    ${visIcon}
                </button>
                <button class="element-card-delete"
                        onclick="event.stopPropagation(); window.handleRemoveVoxelVolume('${volume.id}')"
                        title="Remove">
                    ${getIcon('x', { size: '12px' })}
                </button>
            </div>
            ${inlineControls}
        </div>
    `;
}

/** Render inline controls for a selected voxel volume. */
function _renderVolumeInlineControls(volume) {
    const editing = isVoxelEditing();
    const modeOptions = ['solid', 'voxels']
        .map(
            (m) =>
                `<button class="volume-mode-btn ${volume.mode === m ? 'active' : ''}"
                 onclick="event.stopPropagation(); window.handleSetVolumeMode('${volume.id}', '${m}')">
            ${m === 'solid' ? t('voxelSolid') || 'Solid' : t('voxelExploded') || 'Voxels'}
        </button>`,
        )
        .join('');

    return `
        <div class="volume-inline-controls" onclick="event.stopPropagation();">
            <div class="volume-control-row">
                <label>Mode</label>
                <div class="volume-mode-group">${modeOptions}</div>
            </div>
            <div class="volume-control-row">
                <label>${t('voxelResolution') || 'Res'}</label>
                <input type="range" min="1" max="10" step="1" value="${volume.resolution}"
                       onchange="window.handleSetVoxelResolution({id:'${volume.id}', resolution: Number(this.value)})">
                <span class="volume-res-label">${volume.resolution}m</span>
            </div>
            <div class="volume-control-row">
                <label>${t('voxelOpacity') || 'Op'}</label>
                <input type="range" min="0" max="100" step="5"
                       value="${Math.round((volume.opacity || 0.6) * 100)}"
                       oninput="window.handleSetVolumeOpacityById('${volume.id}', this.value)">
            </div>
            <div class="volume-control-row">
                <button class="btn btn-sm" onclick="window.handleRecomputeVoxels()">
                    ${getIcon('refresh-cw', { size: '12px' })} ${t('recomputeVoxels') || 'Recompute'}
                </button>
                <button class="btn btn-sm ${editing ? 'active' : ''}"
                        onclick="${editing ? 'window.handleExitVoxelEdit()' : `window.handleEnterVoxelEdit('${volume.id}')`}">
                    ${getIcon('edit', { size: '12px' })} ${editing ? 'Exit Edit' : t('editVoxels') || 'Edit Voxels'}
                </button>
            </div>
        </div>
    `;
}

/**
 * Lightweight selection highlight — swaps CSS class without innerHTML rebuild.
 * Troca a classe .selected entre cards de elemento sem reconstruir a lista.
 * @param {string|null} elementId - ID do elemento a destacar (null para limpar)
 */
export function highlightSelectedElement(elementId) {
    const container = document.getElementById('elements-list');
    if (!container) return;

    // Limpa seleção de layers quando um elemento é selecionado
    const prevLayer = container.querySelector('.element-card[data-layer-id].selected');
    if (prevLayer) prevLayer.classList.remove('selected');

    const prev = container.querySelector('.element-card.selected');
    if (prev) prev.classList.remove('selected');

    if (elementId) {
        const card = container.querySelector(`[data-element-id="${elementId}"]`);
        if (card) {
            card.classList.add('selected');

            // Move details section inline (se nao esta docked)
            const docked = localStorage.getItem('ecbyts-details-docked') === 'true';
            if (!docked) {
                const detailsSection = document.getElementById('element-details')?.closest('.section');
                if (detailsSection) {
                    card.after(detailsSection);
                    detailsSection.style.display = '';
                }
            }
        }
    }
}

/**
 * Lightweight layer selection highlight — swaps CSS class.
 * @param {string|null} layerId - ID da layer (null para limpar)
 */
export function highlightSelectedLayer(layerId) {
    const container = document.getElementById('elements-list');
    if (!container) return;

    // Limpa seleção de elementos quando uma layer é selecionada
    const prevEl = container.querySelector('.element-card[data-element-id].selected');
    if (prevEl) prevEl.classList.remove('selected');

    const prevLayer = container.querySelector('.element-card[data-layer-id].selected');
    if (prevLayer) prevLayer.classList.remove('selected');

    if (layerId) {
        const card = container.querySelector(`[data-layer-id="${layerId}"]`);
        if (card) card.classList.add('selected');
    }
}

/** Install HTML5 drag-and-drop for element cards → group zones. */
function _installElementDnD(container) {
    _installDnD(container, {
        itemSelector: '.element-card[draggable]',
        dataAttr: 'elementId',
        zoneSelector: '[data-drop-zone="element-group"]',
        onAssign: setElementGroup,
        onClear: clearElementGroup,
        stopPropagation: true,
    });
}

// ----------------------------------------------------------------
// CONTROLES DE TRANSFORMACAO 3D
// ----------------------------------------------------------------

/**
 * Renderiza controles de posicao, escala, rotacao e cor.
 * @param {Object} element - Elemento selecionado
 * @returns {string} HTML
 */
function renderTransformControls(element) {
    const pos = element.data?.center || element.data?.position || { x: 0, y: 0, z: 0 };
    const scl = element.data?.scale || { x: 1, y: 1, z: 1 };
    const rot = element.data?.rotation || { x: 0, y: 0, z: 0 };
    const color = element.color || '#3b6bff';
    const id = element.id;

    return `
        <div class="transform-controls">
            <div class="transform-section">
                <label class="transform-label">${getIcon('move', { size: '12px' })} Posição</label>
                <div class="transform-row">
                    <label class="axis-label">X</label>
                    <input type="number" class="transform-input" step="0.1" value="${pos.x || 0}"
                           oninput="window.handleElementTransform('${id}', 'position', {x: parseFloat(this.value)||0, y: parseFloat(this.parentElement.querySelector('.ty').value)||0, z: parseFloat(this.parentElement.querySelector('.tz').value)||0})">
                    <label class="axis-label">Y</label>
                    <input type="number" class="transform-input ty" step="0.1" value="${pos.y || 0}"
                           oninput="window.handleElementTransform('${id}', 'position', {x: parseFloat(this.parentElement.querySelector('input').value)||0, y: parseFloat(this.value)||0, z: parseFloat(this.parentElement.querySelector('.tz').value)||0})">
                    <label class="axis-label">Z</label>
                    <input type="number" class="transform-input tz" step="0.1" value="${pos.z || 0}"
                           oninput="window.handleElementTransform('${id}', 'position', {x: parseFloat(this.parentElement.querySelectorAll('input')[0].value)||0, y: parseFloat(this.parentElement.querySelectorAll('input')[1].value)||0, z: parseFloat(this.value)||0})">
                </div>
            </div>
            <div class="transform-section">
                <label class="transform-label">${getIcon('maximize', { size: '12px' })} Escala</label>
                <div class="transform-row">
                    <label class="axis-label">X</label>
                    <input type="number" class="transform-input" step="0.1" min="0.01" value="${scl.x || 1}"
                           oninput="window.handleElementTransform('${id}', 'scale', {x: parseFloat(this.value)||1, y: parseFloat(this.parentElement.querySelector('.sy').value)||1, z: parseFloat(this.parentElement.querySelector('.sz').value)||1})">
                    <label class="axis-label">Y</label>
                    <input type="number" class="transform-input sy" step="0.1" min="0.01" value="${scl.y || 1}"
                           oninput="window.handleElementTransform('${id}', 'scale', {x: parseFloat(this.parentElement.querySelector('input').value)||1, y: parseFloat(this.value)||1, z: parseFloat(this.parentElement.querySelector('.sz').value)||1})">
                    <label class="axis-label">Z</label>
                    <input type="number" class="transform-input sz" step="0.1" min="0.01" value="${scl.z || 1}"
                           oninput="window.handleElementTransform('${id}', 'scale', {x: parseFloat(this.parentElement.querySelectorAll('input')[0].value)||1, y: parseFloat(this.parentElement.querySelectorAll('input')[1].value)||1, z: parseFloat(this.value)||1})">
                </div>
            </div>
            <div class="transform-section">
                <label class="transform-label">${getIcon('rotate', { size: '12px' })} Rotação (°)</label>
                <div class="transform-row">
                    <label class="axis-label">X</label>
                    <input type="number" class="transform-input" step="1" value="${rot.x || 0}"
                           oninput="window.handleElementTransform('${id}', 'rotation', {x: parseFloat(this.value)||0, y: parseFloat(this.parentElement.querySelector('.ry').value)||0, z: parseFloat(this.parentElement.querySelector('.rz').value)||0})">
                    <label class="axis-label">Y</label>
                    <input type="number" class="transform-input ry" step="1" value="${rot.y || 0}"
                           oninput="window.handleElementTransform('${id}', 'rotation', {x: parseFloat(this.parentElement.querySelector('input').value)||0, y: parseFloat(this.value)||0, z: parseFloat(this.parentElement.querySelector('.rz').value)||0})">
                    <label class="axis-label">Z</label>
                    <input type="number" class="transform-input rz" step="1" value="${rot.z || 0}"
                           oninput="window.handleElementTransform('${id}', 'rotation', {x: parseFloat(this.parentElement.querySelectorAll('input')[0].value)||0, y: parseFloat(this.parentElement.querySelectorAll('input')[1].value)||0, z: parseFloat(this.value)||0})">
                </div>
            </div>
            <div class="transform-section">
                <label class="transform-label">${getIcon('palette', { size: '12px' })} Cor</label>
                <div class="transform-row">
                    <input type="color" class="transform-color" value="${color}"
                           oninput="window.handleElementTransform('${id}', 'color', this.value)">
                    <input type="text" class="transform-input transform-color-hex" value="${color}" placeholder="#3b6bff"
                           oninput="window.handleElementTransform('${id}', 'color', this.value); this.previousElementSibling.value = this.value">
                </div>
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// SHAPE EDIT BUTTON
// Botão para entrar no modo de edição de forma (GIS-like)
// ----------------------------------------------------------------

/**
 * Renderiza botoes de edicao para o elemento selecionado.
 * - Familias com strategy: botao "Edit Shape" (entra em shape edit)
 * - Todas as familias: botao "Transform" (entra em gizmo mode)
 * - Se ja editando: botao "Done" + toggle gizmo/shape edit
 *
 * @param {Object} element
 * @param {boolean} editable
 * @returns {string} HTML
 */
function renderShapeEditButton(element, editable) {
    if (!editable) return '';

    const isCurrentElement = isEditing() && getEditingElementId() === element.id;
    const mode = getEditMode();
    const canShapeEdit = hasStrategy(element.family);

    // Ja editando este elemento — mostra Done + toggle
    if (isCurrentElement) {
        let toggleBtn = '';
        if (canShapeEdit) {
            const toggleLabel = mode === 'gizmo' ? t('editShape') || 'Edit Shape' : t('transform') || 'Transform';
            const toggleIcon = mode === 'gizmo' ? 'edit-3' : 'move';
            toggleBtn = `
                <button type="button" class="btn btn-secondary btn-sm" style="width:100%; margin-bottom: 4px;"
                        onclick="window.handleToggleGizmoShapeEdit()">
                    ${getIcon(toggleIcon, { size: '14px' })}
                    <span>${toggleLabel}</span>
                    <span style="font-size:10px;color:var(--neutral-400);margin-left:4px;">(G)</span>
                </button>`;
        }
        return `
            <div style="margin: 8px 0;">
                ${toggleBtn}
                <button type="button" class="btn btn-secondary btn-sm" style="width:100%; border-color: var(--accent-green);"
                        onclick="window.handleExitShapeEdit()">
                    ${getIcon('check', { size: '14px' })}
                    <span data-i18n="exitEditMode">${t('exitEditMode') || 'Done Editing'}</span>
                </button>
            </div>`;
    }

    // Nao editando — mostra botoes para entrar
    let html = '<div style="margin: 8px 0;">';

    if (canShapeEdit) {
        html += `
            <button type="button" class="btn btn-primary btn-sm" style="width:100%; margin-bottom: 4px;"
                    onclick="window.handleEnterShapeEdit('${element.id}')">
                ${getIcon('edit-3', { size: '14px' })}
                <span data-i18n="editShape">${t('editShape') || 'Edit Shape'}</span>
            </button>`;
    }

    html += `
        <button type="button" class="btn btn-secondary btn-sm" style="width:100%;"
                onclick="window.handleEnterGizmoMode('${element.id}')">
            ${getIcon('move', { size: '14px' })}
            <span>${t('transform') || 'Transform'}</span>
            <span style="font-size:10px;color:var(--neutral-400);margin-left:4px;">(W/E/R)</span>
        </button>`;

    html += '</div>';
    return html;
}

// ----------------------------------------------------------------
// DETALHES DO ELEMENTO
// ----------------------------------------------------------------

/**
 * Atualiza painel de detalhes do elemento selecionado.
 */
export function updateElementDetails() {
    const container = document.getElementById('element-details');
    if (!container) return;

    const element = getSelectedElement();

    if (!element) {
        container.innerHTML = `
            <p style="color: var(--neutral-500); font-size: 11px;">
                <span data-i18n="selectElementPrompt">Select an element to edit its properties.</span>
            </p>
        `;
        return;
    }

    const observations = Array.isArray(element.data?.observations) ? element.data.observations : [];

    // Permissoes: verifica se usuario pode editar este elemento
    const editable = !isAccessControlActive() || canEditElement(element.id);
    const ro = editable ? '' : 'readonly disabled';
    const pendingCount = observations.filter((o) => o._status === 'pending').length;
    const pendingBadge = pendingCount > 0 ? ` <span class="badge badge-pending">${pendingCount} pending</span>` : '';

    container.innerHTML = `
        <div class="form-group">
            <label class="form-label" data-i18n="elementName">Element Name</label>
            <input class="form-input" type="text"
                   value="${escapeHtml(element.name)}" ${ro}
                   oninput="window.handleElementFieldChange('${element.id}', 'name', this.value)">
        </div>
        <div class="form-group">
            <label class="form-label" data-i18n="elementLabel">Label</label>
            <input class="form-input" type="text"
                   value="${escapeHtml(element.label || '')}" ${ro}
                   oninput="window.handleElementFieldChange('${element.id}', 'label', this.value)">
        </div>
        <div class="form-group">
            <label class="form-label" data-i18n="description">Description</label>
            <textarea class="form-input" rows="2"
                      data-i18n-placeholder="descriptionPlaceholder" placeholder="Brief description of the element..." ${ro}
                      oninput="window.handleElementFieldChange('${element.id}', 'description', this.value)"
            >${escapeHtml(element.description || '')}</textarea>
        </div>
        <div class="form-row label-3d-controls" style="gap:12px; margin: 4px 0 8px;">
            <label style="display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer;">
                <input type="checkbox" ${(() => {
                    const p = getPerElementLabel(element.id);
                    return !p || p.nameLabel !== false ? 'checked' : '';
                })()}
                    onchange="window.handleToggleElementLabel('${element.id}', 'nameLabel', this.checked)">
                <span data-i18n="show3dNameLabel">Show 3D Name</span>
            </label>
            <label style="display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer;">
                <input type="checkbox" ${(() => {
                    const p = getPerElementLabel(element.id);
                    return !p || p.obsLabel !== false ? 'checked' : '';
                })()}
                    onchange="window.handleToggleElementLabel('${element.id}', 'obsLabel', this.checked)">
                <span data-i18n="show3dObsLabel">Show 3D Obs</span>
            </label>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label" data-i18n="iconClass">Icon Class</label>
                <input class="form-input" type="text"
                       value="${escapeHtml(element.iconClass || '')}" ${ro}
                       oninput="window.handleElementFieldChange('${element.id}', 'iconClass', this.value)">
            </div>
        </div>
        <div class="section" style="margin-top: 12px;">
            <div class="section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span data-i18n="observations">Observations</span>
                <span style="font-size:10px;color:var(--neutral-400);margin-left:4px;">(${observations.length})</span>
                ${pendingBadge}
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                ${
                    observations.length === 0
                        ? `
                    <p style="color: var(--neutral-500); font-size: 11px;">
                        <span data-i18n="noObservations">No observations added.</span>
                    </p>
                `
                        : (() => {
                              const allCampaignsCache = getAllCampaigns();
                              const campaignMap = new Map();
                              allCampaignsCache.forEach((c) => campaignMap.set(c.id, c));

                              // Group by campaignId, preserving originalIndex
                              const grouped = {};
                              observations.forEach((obs, i) => {
                                  const key = obs.campaignId || '__none__';
                                  (grouped[key] = grouped[key] || []).push({ obs, originalIndex: i });
                              });

                              // Sort: campaigns first (by name), then __none__
                              const keys = Object.keys(grouped).sort((a, b) => {
                                  if (a === '__none__') return 1;
                                  if (b === '__none__') return -1;
                                  const na = campaignMap.get(a)?.name || a;
                                  const nb = campaignMap.get(b)?.name || b;
                                  return na.localeCompare(nb);
                              });

                              const expandedIdx = _obsExpandedIdx[element.id];
                              const parameters = CONFIG.PARAMETERS || [];
                              const units = CONFIG.UNITS || [];

                              return keys
                                  .map((key) => {
                                      const items = grouped[key];
                                      const campaign = campaignMap.get(key);
                                      const campName =
                                          key === '__none__' ? t('noCampaign') || 'No Campaign' : campaign?.name || key;
                                      const isExpanded = _obsCampaignExpanded.has(`${element.id}:${key}`);
                                      const chevron = isExpanded ? '▾' : '▸';

                                      return `
                        <div class="obs-campaign-group" style="margin-bottom:4px;">
                            <div class="obs-campaign-header" style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--neutral-800);border-radius:4px;cursor:pointer;font-size:11px;border-left:3px solid ${campaign?.color ? escapeHtml(campaign.color) : 'var(--neutral-600)'};"
                                 onclick="window.handleToggleObsCampaign('${element.id}','${key}')">
                                <span style="font-size:10px;width:12px;color:var(--neutral-400);">${chevron}</span>
                                <span style="font-weight:600;flex:1;color:var(--neutral-100);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(campName)}</span>
                                <span style="font-size:10px;color:var(--neutral-400);flex-shrink:0;">${items.length} obs</span>
                            </div>
                            ${
                                isExpanded
                                    ? `
                            <div class="obs-campaign-body" style="margin-top:2px;">
                                <table style="width:100%;border-collapse:collapse;font-size:10px;">
                                    <thead>
                                        <tr style="color:var(--neutral-400);border-bottom:1px solid var(--neutral-700);">
                                            <th style="text-align:left;padding:2px 4px;font-weight:500;">#</th>
                                            <th style="text-align:left;padding:2px 4px;font-weight:500;">${t('parameter')}</th>
                                            <th style="text-align:right;padding:2px 4px;font-weight:500;">${t('value')}</th>
                                            <th style="text-align:left;padding:2px 4px;font-weight:500;">${t('unit')}</th>
                                            <th style="text-align:left;padding:2px 4px;font-weight:500;">${t('date')}</th>
                                            <th style="padding:2px;"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${items
                                            .map(({ obs, originalIndex }) => {
                                                const param = parameters.find((p) => p.id === obs.parameterId);
                                                const unit = units.find((u) => u.id === obs.unitId);
                                                const pName = param?.name || obs.parameterId || '—';
                                                const val =
                                                    obs.detect_flag === 'N'
                                                        ? '<LQ'
                                                        : obs.value != null
                                                          ? obs.value
                                                          : '—';
                                                const uSymbol = unit?.symbol || obs.unitId || '';
                                                const date = obs.date ? obs.date.slice(5) : '';
                                                const isExp = expandedIdx === originalIndex;
                                                // Compliance badge inline
                                                let badge = '';
                                                if (obs.parameterId && obs.value != null) {
                                                    const res = validateObservationFull(obs, obs.parameterId);
                                                    if (res.length > 0) {
                                                        const r = res[0];
                                                        if (r.severity === 'intervention')
                                                            badge =
                                                                '<span style="color:var(--accent-red);font-weight:700;" title="VI">⚠</span>';
                                                        else if (r.severity === 'prevention')
                                                            badge =
                                                                '<span style="color:var(--accent-yellow);" title="VP">▲</span>';
                                                    }
                                                }
                                                return `
                                            <tr style="cursor:pointer;border-bottom:1px solid var(--neutral-800);${isExp ? 'background:var(--neutral-750);' : ''}"
                                                onclick="window.handleExpandObservation('${element.id}', ${originalIndex})">
                                                <td style="padding:3px 4px;color:var(--neutral-500);">${originalIndex + 1}</td>
                                                <td style="padding:3px 4px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(pName)}">${escapeHtml(pName)}</td>
                                                <td style="padding:3px 4px;text-align:right;font-variant-numeric:tabular-nums;">${val}</td>
                                                <td style="padding:3px 4px;color:var(--neutral-400);">${escapeHtml(uSymbol)}</td>
                                                <td style="padding:3px 4px;color:var(--neutral-500);">${date}</td>
                                                <td style="padding:3px 2px;">${badge}</td>
                                            </tr>
                                            ${isExp ? `<tr><td colspan="6" style="padding:0;">${observationRow(element.id, obs, originalIndex, editable, allCampaignsCache)}</td></tr>` : ''}`;
                                            })
                                            .join('')}
                                    </tbody>
                                </table>
                            </div>`
                                    : ''
                            }
                        </div>`;
                                  })
                                  .join('');
                          })()
                }
                ${
                    editable
                        ? `
                <button type="button" class="btn btn-secondary" style="margin-top: 8px;"
                        onclick="window.handleAddObservation('${element.id}')">
                    ${getIcon('plus', { size: '14px' })} <span data-i18n="addObservation">Add Observation</span>
                </button>
                `
                        : ''
                }
                ${isObserver() ? renderObserverPanel() : ''}
            </div>
        </div>
        ${renderElementCostsSection(element, editable)}
        <div class="section collapsed" style="margin-top: 12px;">
            <div class="section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span data-i18n="transformAppearance">${t('transformAppearance') || 'Transform & Appearance'}</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                ${renderTransformControls(element)}
                ${renderShapeEditButton(element, editable)}
                ${element.family === 'boundary' ? renderBoundaryControls(element) : ''}
                ${element.family === 'sensor' ? renderSensorSummaryControls(element) : ''}
                ${element.family === 'area' ? renderAreaControls(element) : ''}
                ${renderOrgUnitDropdown(element)}
            </div>
        </div>
    `;
    hydrateIcons(container);
}

/**
 * Render element costs section (L2 Cost Framework).
 * Mostra custos CAPEX/OPEX por fiscal year com totais.
 *
 * @param {Object} element - Element object
 * @param {boolean} editable - Se pode editar
 * @returns {string} HTML string
 */
function renderElementCostsSection(element, editable) {
    const costs = Array.isArray(element?.data?.costs) ? element.data.costs : [];
    const hasCosts = costs.length > 0;

    const yearRows = costs
        .map((entry) => {
            const itemSummary = entry.items
                .map(
                    (it) => `
            <div style="display:flex;justify-content:space-between;font-size:10px;padding:1px 0;">
                <span style="color:var(--neutral-400);text-transform:uppercase;font-size:9px;">${escapeHtml(it.categoryId)}·${escapeHtml(it.itemId)}</span>
                ${
                    editable
                        ? `
                    <input class="form-input form-input-sm" type="number" step="0.01"
                           style="width:80px;text-align:right;font-size:10px;" value="${it.amount}"
                           oninput="window.handleElementCostItemChange('${element.id}', ${entry.fiscalYear}, '${escapeHtml(it.categoryId)}', '${escapeHtml(it.itemId)}', this.value)">
                `
                        : `<span>${it.amount.toFixed(2)}</span>`
                }
            </div>
        `,
                )
                .join('');

            // Basis selector (estimate / budget / actual)
            const basisOptions = ['estimate', 'budget', 'actual'];
            const basisHtml = editable
                ? `
            <select style="font-size:9px;padding:0 2px;border:1px solid var(--neutral-600);border-radius:2px;background:transparent;color:var(--neutral-400);cursor:pointer;"
                    onchange="window.handleChangeCostBasis('${element.id}', ${entry.fiscalYear}, this.value)">
                ${basisOptions.map((b) => `<option value="${b}" ${entry.basis === b ? 'selected' : ''}>${b}</option>`).join('')}
            </select>`
                : `<span style="color:var(--neutral-400);font-size:9px;">${entry.basis || 'estimate'}</span>`;

            return `
            <div style="margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;margin-bottom:2px;">
                    <span>${entry.fiscalYear}</span>
                    <div style="display:flex;align-items:center;gap:4px;">
                        ${basisHtml}
                        ${
                            editable
                                ? `<button class="btn-icon" style="font-size:9px;color:var(--neutral-400);cursor:pointer;border:none;background:none;padding:0 2px;" title="${t('removeCostYear') || 'Remove year'}"
                            onclick="window.handleRemoveCostYear('${element.id}', ${entry.fiscalYear})">&#10005;</button>`
                                : ''
                        }
                    </div>
                </div>
                ${itemSummary}
                <div style="display:flex;justify-content:space-between;font-size:10px;border-top:1px solid var(--neutral-700);margin-top:3px;padding-top:3px;">
                    <span style="color:var(--accent-blue);">CAPEX ${entry.currency || ''} ${(entry.capexTotal || 0).toFixed(2)}</span>
                    <span style="color:var(--accent-green);">OPEX ${entry.currency || ''} ${(entry.opexTotal || 0).toFixed(2)}</span>
                </div>
                <div style="text-align:right;font-size:11px;font-weight:600;">
                    Total: ${entry.currency || 'BRL'} ${(entry.total || 0).toFixed(2)}
                </div>
            </div>
        `;
        })
        .join('');

    // Total geral do elemento (todos os anos)
    const grandTotal = costs.reduce((s, e) => s + (e.total || 0), 0);
    const grandCapex = costs.reduce((s, e) => s + (e.capexTotal || 0), 0);
    const grandOpex = costs.reduce((s, e) => s + (e.opexTotal || 0), 0);
    const currency = costs[0]?.currency || 'BRL';

    // Botão Add Year
    const addYearBtn = editable
        ? `
        <button class="btn btn-xs btn-secondary" style="font-size:10px;padding:2px 6px;margin-top:4px;"
                onclick="window.handleAddCostYear('${element.id}')">
            + ${t('addCostYear') || 'Add Year'}
        </button>`
        : '';

    return `
        <div class="section collapsed" style="margin-top: 12px;">
            <div class="section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span data-i18n="elementCosts">${t('elementCosts') || 'Costs'}</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                ${hasCosts ? yearRows : `<div style="font-size:11px;color:var(--neutral-400);padding:4px 0;">${t('noCostData') || 'No cost data.'}</div>`}
                ${
                    hasCosts
                        ? `
                    <div style="border-top:2px solid var(--neutral-600);margin-top:6px;padding-top:6px;font-size:11px;">
                        <div style="display:flex;justify-content:space-between;font-weight:600;">
                            <span data-i18n="totalAllYears">${t('totalAllYears') || 'Total (all years)'}</span>
                            <span>${currency} ${grandTotal.toFixed(2)}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--neutral-400);">
                            <span>CAPEX: ${currency} ${grandCapex.toFixed(2)}</span>
                            <span>OPEX: ${currency} ${grandOpex.toFixed(2)}</span>
                        </div>
                    </div>
                `
                        : ''
                }
                ${addYearBtn}
            </div>
        </div>
    `;
}

/**
 * Render observer submission panel (for observers only).
 * Painel simplificado para observadores enviarem dados.
 */
function renderObserverPanel() {
    const parameters = CONFIG.PARAMETERS || [];
    const units = CONFIG.UNITS || [];

    return `
        <div class="observer-panel" style="margin-top: 12px; padding: 8px; border: 1px solid var(--neutral-700); border-radius: var(--radius-sm);">
            <div style="font-size: 11px; font-weight: 500; margin-bottom: 6px; color: var(--accent-blue);">
                ${getIcon('eye', { size: '12px' })} Observer — Submit Data
            </div>
            <div class="form-group" style="margin-bottom: 4px;">
                <select class="form-input form-input-sm" id="observer-param">
                    <option value="">Parameter...</option>
                    ${parameters.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </div>
            <div style="display: flex; gap: 4px; margin-bottom: 4px;">
                <input class="form-input form-input-sm" type="number" step="any" id="observer-value"
                       placeholder="Value" style="flex: 1;">
                <select class="form-input form-input-sm" id="observer-unit" style="flex: 1;">
                    <option value="">Unit...</option>
                    ${units.map((u) => `<option value="${u.id}">${escapeHtml(u.symbol || u.id)}</option>`).join('')}
                </select>
            </div>
            <div style="display: flex; gap: 4px; margin-bottom: 6px;">
                <input class="form-input form-input-sm" type="date" id="observer-date"
                       value="${new Date().toISOString().slice(0, 10)}" style="flex: 1;">
            </div>
            <button class="btn btn-sm btn-primary" onclick="window.handleSubmitObserverForm()">
                Submit Observation
            </button>
            <div style="margin-top: 8px;">
                <textarea class="form-input form-input-sm" id="observer-comment" rows="2"
                          placeholder="Add a comment..." style="resize: vertical;"></textarea>
                <button class="btn btn-sm btn-secondary" style="margin-top: 4px;"
                        onclick="window.handleSubmitObserverCommentForm()">
                    Submit Comment
                </button>
            </div>
        </div>`;
}

// ----------------------------------------------------------------
// BINDING UI HELPERS
// Renderizam campos com indicador de vinculacao (chain icon)
// ----------------------------------------------------------------

/**
 * Check if an observation field has an active binding.
 * @param {Object} obs - Observation
 * @param {string} field - Field name
 * @returns {boolean}
 */
function _isFieldBound(obs, field) {
    const b = obs?.bindings?.[field];
    return b && (b.status === 'ok' || b.status === 'stale');
}

/**
 * Get CSS class suffix for a bound field.
 * @param {Object} obs - Observation
 * @param {string} field - Field name
 * @returns {string} CSS class string (empty or ' obs-bound' / ' obs-bound-broken')
 */
function _bindingClass(obs, field) {
    const b = obs?.bindings?.[field];
    if (!b) return '';
    if (b.status === 'ok' || b.status === 'stale') return ' obs-bound';
    if (b.status === 'broken') return ' obs-bound-broken';
    if (b.status === 'circular') return ' obs-bound-broken';
    return '';
}

/**
 * Generate tooltip text for a binding.
 * @param {Object} obs - Observation
 * @param {string} field - Field name
 * @returns {string} Tooltip text
 */
function _bindingTooltip(obs, field) {
    const b = obs?.bindings?.[field];
    if (!b) return t('bindField') || 'Bind field';
    if (b.status === 'broken') return `${t('bindingBroken') || 'Binding broken'}: ${b.targetType}/${b.targetId}`;
    if (b.status === 'circular') return t('bindingCircular') || 'Circular binding detected';
    // ok/stale: mostra origem
    const transform = b.transform !== 'identity' ? ` (${b.transform})` : '';
    return `${t('boundTo') || 'Bound to'}: ${b.targetId} > ${b.targetPath}${transform}`;
}

/**
 * Render a label with optional binding toggle icon.
 * Renderiza label com icone de chain para vincular/desvincular.
 *
 * @param {string} elementId - Element ID
 * @param {number} index - Observation index
 * @param {Object} obs - Observation
 * @param {string} field - Field name
 * @param {string} labelText - Display label
 * @param {boolean} editable - Is the observation editable
 * @returns {string} HTML string
 */
function _bindableFieldLabel(elementId, index, obs, field, labelText, editable) {
    const bound = _isFieldBound(obs, field);
    const binding = obs?.bindings?.[field];
    const isBroken = binding && (binding.status === 'broken' || binding.status === 'circular');
    const hasAnyBinding = !!binding;
    const tooltip = _bindingTooltip(obs, field);

    const iconClass = bound
        ? 'obs-bind-icon obs-bind-active'
        : isBroken
          ? 'obs-bind-icon obs-bind-broken'
          : 'obs-bind-icon';

    // Se qualquer binding existe (ok, broken, circular, stale), clique desvincula.
    // Apenas quando nao ha binding, clique abre o picker.
    const bindBtn = editable
        ? `<button type="button" class="${iconClass}" title="${escapeHtml(tooltip)}"
        onclick="${
            hasAnyBinding
                ? `window.handleUnbindField('${elementId}', ${index}, '${field}')`
                : `window.handleOpenBindingPicker('${elementId}', ${index}, '${field}')`
        }">&#128279;</button>`
        : '';

    return `<label class="form-label">${labelText} ${bindBtn}</label>`;
}

/**
 * Render a bindable number field (label + input + binding indicator).
 * Renderiza campo numerico com toggle de vinculacao.
 *
 * @param {string} elementId - Element ID
 * @param {number} index - Observation index
 * @param {Object} obs - Observation
 * @param {string} field - Field name ('x', 'y', 'z')
 * @param {string} label - Display label
 * @param {boolean} editable - Is editable
 * @returns {string} HTML string
 */
function _bindableNumberField(elementId, index, obs, field, label, editable) {
    const bound = _isFieldBound(obs, field);
    const cssClass = `form-input${_bindingClass(obs, field)}`;

    return `<div class="form-group">
        ${_bindableFieldLabel(elementId, index, obs, field, label, editable)}
        <input class="${cssClass}" type="number" step="0.01" value="${obs[field] ?? 0}"
               ${bound ? 'readonly' : ''}
               oninput="window.handleObservationChange('${elementId}', ${index}, '${field}', this.value)">
    </div>`;
}

function observationRow(elementId, obs, index, editable = true, campaignsCache = null) {
    const parameters = CONFIG.PARAMETERS || [];
    const units = CONFIG.UNITS || [];
    const campaigns = campaignsCache || getAllCampaigns();

    // Lazy resolution: resolve bindings antes de renderizar
    if (obs.bindings && typeof obs.bindings === 'object') {
        const allElements = getAllElements();
        const elementMap = new Map();
        const observationMap = new Map();
        for (const el of allElements) {
            if (el?.id) elementMap.set(el.id, el);
            if (Array.isArray(el?.data?.observations)) {
                for (const o of el.data.observations) {
                    if (o?.id) observationMap.set(o.id, o);
                }
            }
        }
        const campaignMap = new Map();
        for (const c of campaigns) {
            if (c?.id) campaignMap.set(c.id, c);
        }
        resolveObservation(obs, {
            getElementById: (id) => elementMap.get(id),
            getCampaignById: (id) => campaignMap.get(id),
            getObservationById: (id) => observationMap.get(id),
            getCalculatorMetric: () => null,
            getConstantById: (id) => getUserConstantById(id),
        });
    }

    // Leitura principal
    const selectedParam = parameters.find((p) => p.id === obs.parameterId);
    const selectedUnit = units.find((u) => u.id === (obs.unitId || selectedParam?.defaultUnitId));
    const compatibleUnits = selectedUnit ? units.filter((u) => u.dimension === selectedUnit.dimension) : [];
    const paramType = selectedParam?.type || 'custom';
    const typeBadge =
        paramType === 'SI'
            ? '<span class="badge badge-si">SI</span>'
            : '<span class="badge badge-custom">Custom</span>';

    // Leituras adicionais
    const additionalReadings = obs.additionalReadings || [];

    // Observer submission metadata
    const isPending = obs._status === 'pending';
    const isRejected = obs._status === 'rejected';
    const statusBadge = isPending
        ? ' <span class="badge badge-pending">pending</span>'
        : isRejected
          ? ' <span class="badge badge-rejected">rejected</span>'
          : obs._status === 'approved'
            ? ' <span class="badge badge-approved">approved</span>'
            : '';
    const submitterInfo = obs._submittedBy
        ? `<span style="font-size:9px;color:var(--neutral-500);">by ${escapeHtml(obs._submittedBy)}</span>`
        : '';

    // Non-detect badge (<LQ)
    const isNonDetect = obs.detect_flag === 'N';
    const nonDetectBadge = isNonDetect
        ? ` <span class="badge badge-nondetect" title="Nao detectado — LQ: ${obs.detection_limit ?? '?'} ${selectedUnit?.symbol || ''}" style="background:var(--neutral-700);color:var(--neutral-400);font-style:italic;">&lt;LQ</span>`
        : '';

    // Compliance validation badge — multi-tier (VI/VP/VR)
    let complianceBadge = '';
    if (obs.parameterId && obs.value != null) {
        const results = validateObservationFull(obs, obs.parameterId);
        if (results.length > 0) {
            const r = results[0];
            if (r.severity === 'intervention') {
                complianceBadge = ` <span class="badge compliance-intervention" title="${escapeHtml(r.message)}">${getIcon('alert-circle', { size: '10px' })} ${r.exceedance || 'VI'}</span>`;
            } else if (r.severity === 'prevention') {
                complianceBadge = ` <span class="badge compliance-prevention" title="${escapeHtml(r.message)}">${getIcon('alert-triangle', { size: '10px' })} VP</span>`;
            } else if (r.severity === 'reference') {
                complianceBadge = ` <span class="badge compliance-reference" title="${escapeHtml(r.message)}">${getIcon('info', { size: '10px' })} VR</span>`;
            } else if (r.severity === 'intervention_uncertain') {
                complianceBadge = ` <span class="badge compliance-uncertain" title="${escapeHtml(r.message)}">${getIcon('alert-triangle', { size: '10px' })} VI?</span>`;
            } else if (r.severity === 'prevention_uncertain') {
                complianceBadge = ` <span class="badge compliance-uncertain" title="${escapeHtml(r.message)}">${getIcon('alert-triangle', { size: '10px' })} VP?</span>`;
            } else if (r.severity === 'reference_uncertain') {
                complianceBadge = ` <span class="badge compliance-uncertain" title="${escapeHtml(r.message)}">${getIcon('info', { size: '10px' })} VR?</span>`;
            }
        }
    }

    // Credential badge — somente para niveis acima de 'common'
    const credLevel = obs.credentialLevel || 'common';
    const credLabel = EIS_CREDENTIAL_LABELS[credLevel] || '';
    const credMult = EIS_CREDENTIAL_MULTIPLIERS[credLevel] || 1.0;
    const credAuthor = obs.createdBy ? ` — ${escapeHtml(obs.createdBy)}` : '';
    const credBadge =
        credLevel !== 'common'
            ? ` <span class="badge badge-credential badge-credential-${credLevel}" title="${t('eis.credential')}: ${credLabel} (T×${credMult})${credAuthor}">${credLabel}</span>`
            : '';

    const showPlanning = obs.showPlanning || false;

    return `
        <div class="obs-card${isPending ? ' obs-pending' : ''}${isRejected ? ' obs-rejected' : ''}${showPlanning ? ' obs-planning-active' : ''}" data-obs-index="${index}">
            <div class="obs-header">
                <span class="obs-title">${t('observation')} #${index + 1}${statusBadge}${credBadge}${nonDetectBadge}${complianceBadge}</span>
                <div style="display:flex;gap:4px;align-items:center;">
                    ${submitterInfo}
                    ${
                        editable
                            ? `
                    <label class="planning-toggle" title="${t('planningModeTooltip') || 'Toggle planning mode — shows planned fields and registers in campaign'}">
                        <input type="checkbox" ${showPlanning ? 'checked' : ''}
                               onchange="window.handleTogglePlanning('${elementId}', ${index})">
                        <span class="planning-toggle-slider"></span>
                        <span class="planning-toggle-label">${t('planningMode') || 'Plan'}</span>
                    </label>
                    `
                            : ''
                    }
                    ${
                        showPlanning && obs.campaignId
                            ? (() => {
                                  const linkedProj = getProjects().find((p) =>
                                      p.linkedCampaignIds.includes(obs.campaignId),
                                  );
                                  return linkedProj
                                      ? `<span class="gov-badge gov-status-active" style="font-size:0.6rem;cursor:default" title="${t('linkedProject') || 'Linked project'}">${escapeHtml(linkedProj.name)}</span>`
                                      : '';
                              })()
                            : ''
                    }
                    ${
                        editable && isPending
                            ? `
                        <button type="button" class="btn btn-icon" title="Approve"
                                onclick="window.handleApproveObservation('${elementId}', ${index})"
                                style="color:var(--accent-green);">
                            ${getIcon('check', { size: '12px' })}
                        </button>
                        <button type="button" class="btn btn-icon" title="Reject"
                                onclick="window.handleRejectObservation('${elementId}', ${index})"
                                style="color:var(--accent-red);">
                            ${getIcon('x', { size: '12px' })}
                        </button>
                    `
                            : ''
                    }
                    ${
                        editable
                            ? `
                    <button type="button" class="btn btn-icon" title="${t('removeObservation')}"
                            onclick="window.handleRemoveObservation('${elementId}', ${index})">
                        ${getIcon('x', { size: '12px' })}
                    </button>
                    `
                            : ''
                    }
                </div>
            </div>

            <!-- SEÇÃO 1: POSIÇÃO -->
            <div class="obs-section">
                <div class="obs-section-title">${t('position')}</div>
                <div class="obs-position-grid">
                    ${_bindableNumberField(elementId, index, obs, 'x', 'X', editable)}
                    ${_bindableNumberField(elementId, index, obs, 'y', 'Y', editable)}
                    ${_bindableNumberField(elementId, index, obs, 'z', 'Z', editable)}
                </div>
            </div>

            <!-- SEÇÃO 2: TEMPO -->
            <div class="obs-section">
                <div class="obs-section-title">${t('time')}</div>
                <div class="obs-time-grid">
                    <div class="form-group">
                        ${_bindableFieldLabel(elementId, index, obs, 'date', t('date'), editable)}
                        <input class="form-input${_bindingClass(obs, 'date')}" type="date" value="${escapeHtml(obs.date || '')}"
                               ${_isFieldBound(obs, 'date') ? 'readonly' : ''}
                               oninput="window.handleObservationChange('${elementId}', ${index}, 'date', this.value)">
                    </div>
                    <div class="form-group">
                        <label class="form-label" data-i18n="campaign">${t('campaign')}</label>
                        <select class="form-input"
                                onchange="window.handleObservationChange('${elementId}', ${index}, 'campaignId', this.value)">
                            <option value="">${t('selectCampaign')}</option>
                            ${campaigns
                                .map(
                                    (c) => `
                                <option value="${c.id}" ${c.id === obs.campaignId ? 'selected' : ''}>
                                    ${escapeHtml(c.name)}
                                </option>
                            `,
                                )
                                .join('')}
                        </select>
                    </div>
                </div>
            </div>

            <!-- SEÇÃO 3: LEITURA PRINCIPAL -->
            <div class="obs-section">
                <div class="obs-section-title">${t('primaryReading')}</div>
                ${renderReadingRow(elementId, index, 'primary', obs, selectedParam, selectedUnit, compatibleUnits, parameters, units, typeBadge)}
            </div>

            <!-- SEÇÃO 4: DADOS ADICIONAIS -->
            <div class="obs-section">
            <div class="obs-section-title">
                ${t('additionalData')}
                <button type="button" class="btn btn-link btn-sm add-field-btn"
                        onclick="window.handleAddAdditionalReading('${elementId}', ${index})">
                    + ${t('addField')}
                </button>
            </div>
                <div class="obs-additional-readings">
                    ${
                        additionalReadings.length === 0
                            ? `
                        <p class="obs-empty-msg">${t('noAdditionalReadings')}</p>
                    `
                            : additionalReadings
                                  .map((reading, readingIndex) => {
                                      const rParam = parameters.find((p) => p.id === reading.parameterId);
                                      const rUnit = units.find(
                                          (u) => u.id === (reading.unitId || rParam?.defaultUnitId),
                                      );
                                      const rCompatible = rUnit
                                          ? units.filter((u) => u.dimension === rUnit.dimension)
                                          : [];
                                      const rBadge =
                                          rParam?.type === 'SI'
                                              ? '<span class="badge badge-si">SI</span>'
                                              : '<span class="badge badge-custom">Custom</span>';
                                      return renderReadingRow(
                                          elementId,
                                          index,
                                          readingIndex,
                                          reading,
                                          rParam,
                                          rUnit,
                                          rCompatible,
                                          parameters,
                                          units,
                                          rBadge,
                                          true,
                                      );
                                  })
                                  .join('')
                    }
                </div>
            </div>

            <!-- SEÇÃO 5: VARIÁVEIS -->
            ${renderVariablesSection(elementId, obs, index)}

            <!-- SEÇÃO 6: CUSTO (L1) -->
            ${renderObservationCostSection(elementId, obs, index, editable)}
        </div>
    `;
}

/**
 * Render cost section for an observation (L1 Cost Framework).
 * Mostra custo do ensaio analítico + coleta com fonte (catálogo/documento/usuário).
 *
 * @param {string} elementId - Element ID
 * @param {Object} obs - Observation object
 * @param {number} index - Observation index
 * @param {boolean} editable - Se pode editar
 * @returns {string} HTML string
 */
function renderObservationCostSection(elementId, obs, index, editable) {
    const cost = obs.cost;
    if (!cost || !cost.items || cost.items.length === 0) {
        return `
            <div class="obs-section">
                <div class="obs-section-title">${t('cost') || 'Cost'}</div>
                <p class="obs-empty-msg">${t('noCostData') || 'No cost data.'}</p>
            </div>`;
    }

    const sourceBadge =
        cost.source === 'catalog'
            ? '<span class="badge badge-si" style="font-size:9px;">Catalog</span>'
            : cost.source === 'document'
              ? '<span class="badge badge-custom" style="font-size:9px;">Doc</span>'
              : '<span class="badge" style="font-size:9px;background:var(--accent-blue);color:#fff;">User</span>';

    const itemRows = cost.items
        .map(
            (item) => `
        <div class="obs-cost-row" style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:11px;">
            <span style="color:var(--neutral-400);text-transform:uppercase;font-size:9px;">${escapeHtml(item.categoryId)}·${escapeHtml(item.itemId)}</span>
            ${
                editable
                    ? `
                <input class="form-input form-input-sm" type="number" step="0.01"
                       style="width:80px;text-align:right;" value="${item.amount}"
                       oninput="window.handleObservationCostChange('${elementId}', ${index}, '${escapeHtml(item.categoryId)}', '${escapeHtml(item.itemId)}', this.value)">
            `
                    : `<span>${item.amount.toFixed(2)}</span>`
            }
        </div>
    `,
        )
        .join('');

    return `
        <div class="obs-section">
            <div class="obs-section-title">${t('cost') || 'Cost'} ${sourceBadge}</div>
            ${itemRows}
            <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--neutral-700);margin-top:4px;padding-top:4px;font-size:11px;font-weight:600;">
                <span>Total</span>
                <span>${cost.currency || 'BRL'} ${cost.total.toFixed(2)}</span>
            </div>
        </div>`;
}

/**
 * Render the variables section for an observation.
 * Renderiza variaveis como campos simplificados: nome = valor.
 * Cada variavel e uma linha editavel (nome e valor livres).
 *
 * @param {string} elementId - Element ID
 * @param {Object} obs - Observation object
 * @param {number} index - Observation index
 * @returns {string} HTML string
 */
function renderVariablesSection(elementId, obs, index) {
    const variables = obs.variables || {};
    const varEntries = Object.entries(variables);

    return `
        <div class="obs-section">
            <div class="obs-section-title">
                ${t('variables')}
                <button type="button" class="btn btn-link btn-sm add-field-btn"
                        onclick="window.handleAddObservationVariable('${elementId}', ${index})">
                    + ${t('addVariable')}
                </button>
            </div>
            <div class="obs-variables-list">
                ${
                    varEntries.length === 0
                        ? `
                    <p class="obs-empty-msg">${t('noVariables')}</p>
                `
                        : varEntries
                              .map(([varId, raw]) => {
                                  // Suporta formato legado (valor simples) e novo ({ value, unit })
                                  const isObj = typeof raw === 'object' && raw !== null;
                                  const val = isObj ? (raw.value ?? '') : String(raw ?? '');
                                  const unit = isObj ? (raw.unit ?? 'adimensional') : 'adimensional';
                                  return `
                    <div class="obs-var-row">
                        <input class="form-input form-input-sm obs-var-name" type="text"
                               value="${escapeHtml(varId)}"
                               onchange="window.handleRenameObservationVariable('${elementId}', ${index}, '${escapeHtml(varId)}', this.value)">
                        <span class="obs-var-eq">=</span>
                        <input class="form-input form-input-sm obs-var-value" type="text"
                               value="${escapeHtml(String(val))}"
                               onchange="window.handleObservationVariableChange('${elementId}', ${index}, '${escapeHtml(varId)}', 'value', this.value)">
                        <input class="form-input form-input-sm obs-var-unit" type="text"
                               value="${escapeHtml(unit)}"
                               onchange="window.handleObservationVariableChange('${elementId}', ${index}, '${escapeHtml(varId)}', 'unit', this.value)">
                        <button type="button" class="btn btn-icon btn-danger btn-xs"
                                onclick="window.handleRemoveObservationVariable('${elementId}', ${index}, '${escapeHtml(varId)}')"
                                title="${t('removeVariable')}">
                            ${getIcon('x', { size: '10px' })}
                        </button>
                    </div>`;
                              })
                              .join('')
                }
            </div>
        </div>
    `;
}

/**
 * Renderiza uma linha de leitura (principal ou adicional).
 */
function renderReadingRow(
    elementId,
    obsIndex,
    readingIndex,
    reading,
    _selectedParam,
    selectedUnit,
    compatibleUnits,
    parameters,
    _units,
    typeBadge,
    isAdditional = false,
) {
    const autoConvert = reading.autoConvert || false;

    return `
        <div class="reading-row ${isAdditional ? 'reading-row-additional' : ''}" data-reading-index="${readingIndex}">
            <div class="reading-grid">
                <div class="form-group reading-param">
                    <label class="form-label">${t('parameter')}</label>
                    ${renderParameterSelect(elementId, obsIndex, readingIndex, reading.parameterId, isAdditional)}
                </div>
                <div class="form-group reading-value">
                    <label class="form-label">${t('value')}</label>
                    <div class="value-input-wrapper">
                        <span class="value-status" title="${t('custom')}">${typeBadge}</span>
                        <input class="form-input value-input" type="number" step="any"
                               id="value-${elementId}-${obsIndex}-${readingIndex}"
                               value="${reading.value ?? ''}"
                               placeholder="${t('enterValue')}"
                               oninput="window.handleReadingChange('${elementId}', ${obsIndex}, '${readingIndex}', 'value', this.value, ${isAdditional})">
                    </div>
                </div>
                ${
                    reading.uncertainty != null
                        ? `
                <div class="form-group reading-uncertainty">
                    <label class="form-label">&#177; ${t('uncertainty') || 'Uncertainty'}</label>
                    <div class="uncertainty-input-wrapper">
                        <input class="form-input uncertainty-input" type="number" step="any" min="0"
                               id="unc-${elementId}-${obsIndex}-${readingIndex}"
                               value="${reading.uncertainty ?? ''}"
                               placeholder="&#177;"
                               title="${t('uncertaintyTooltip') || ''}"
                               aria-label="${t('uncertainty') || 'Uncertainty'}"
                               oninput="window.handleReadingChange('${elementId}', ${obsIndex}, '${readingIndex}', 'uncertainty', this.value, ${isAdditional})">
                        <select class="form-input uncertainty-type-select"
                                id="unctype-${elementId}-${obsIndex}-${readingIndex}"
                                aria-label="${t('constantUncertaintyType') || 'Type'}"
                                onchange="window.handleReadingChange('${elementId}', ${obsIndex}, '${readingIndex}', 'uncertaintyType', this.value, ${isAdditional})">
                            <option value="" disabled ${!reading.uncertaintyType ? 'selected' : ''}>${t('selectUncertaintyType') || 'Type'}</option>
                            <option value="absolute" ${reading.uncertaintyType === 'absolute' ? 'selected' : ''}>${t('uncertaintyAbsolute') || 'Abs'}</option>
                            <option value="relative" ${reading.uncertaintyType === 'relative' ? 'selected' : ''}>${t('uncertaintyRelative') || 'Rel (%)'}</option>
                        </select>
                        <a href="#" class="constants-k-toggle" onclick="this.nextElementSibling.style.display='inline';this.style.display='none';return false"
                           title="${t('coverageFactorTooltip') || ''}">k=${reading.coverageFactor || 2}</a>
                        <input class="form-input uncertainty-k-input" type="number" step="any" min="0.1"
                               id="unck-${elementId}-${obsIndex}-${readingIndex}"
                               value="${reading.coverageFactor ?? ''}"
                               placeholder="k"
                               title="${t('coverageFactorTooltip') || ''}"
                               aria-label="${t('coverageFactor') || 'k'}"
                               style="display:${reading.coverageFactor != null && reading.coverageFactor !== 2 ? 'inline' : 'none'}"
                               oninput="window.handleReadingChange('${elementId}', ${obsIndex}, '${readingIndex}', 'coverageFactor', this.value, ${isAdditional})">
                    </div>
                </div>
                `
                        : `
                <div class="form-group reading-uncertainty-toggle">
                    <button type="button" class="btn btn-link btn-sm uncertainty-toggle-btn"
                            onclick="window.handleReadingChange('${elementId}', ${obsIndex}, '${readingIndex}', 'uncertainty', '0', ${isAdditional})"
                            title="${t('uncertaintyTooltip') || 'Add measurement uncertainty'}">
                        + &#177; ${t('uncertainty') || 'Uncertainty'}
                    </button>
                </div>
                `
                }
                <div class="form-group reading-unit">
                    <label class="form-label">${t('unit')}</label>
                    <select class="form-input"
                            onchange="window.handleUnitChange('${elementId}', ${obsIndex}, '${readingIndex}', this.value, ${isAdditional})">
                        ${
                            compatibleUnits.length === 0
                                ? `
                            <option value="">${selectedUnit ? escapeHtml(selectedUnit.symbol) : '-'}</option>
                        `
                                : compatibleUnits
                                      .map(
                                          (u) => `
                            <option value="${u.id}" ${u.id === (reading.unitId || selectedUnit?.id) ? 'selected' : ''}>
                                ${escapeHtml(u.symbol)}
                            </option>
                        `,
                                      )
                                      .join('')
                        }
                    </select>
                </div>
                <div class="form-group reading-convert">
                    <label class="form-label">${t('convert')}</label>
                    <label class="checkbox-label checkbox-label-inline">
                        <input type="checkbox"
                               ${autoConvert ? 'checked' : ''}
                               onchange="window.handleReadingChange('${elementId}', ${obsIndex}, '${readingIndex}', 'autoConvert', this.checked, ${isAdditional})">
                        <span class="checkbox-text" title="${t('autoConvertTooltip')}">${t('autoConvert')}</span>
                    </label>
                </div>
                ${
                    isAdditional
                        ? `
                    <div class="form-group reading-remove">
                        <button type="button" class="btn btn-icon btn-danger"
                                onclick="window.handleRemoveAdditionalReading('${elementId}', ${obsIndex}, ${readingIndex})">
                            ${getIcon('x', { size: '12px' })}
                        </button>
                    </div>
                `
                        : ''
                }
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// CAMPANHAS
// ----------------------------------------------------------------

export function updateCampaignsList() {
    const container = document.getElementById('campaigns-list');
    if (!container) return;

    const campaigns = getAllCampaigns();

    if (campaigns.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 16px; color: var(--neutral-500);">
                <span data-i18n="noCampaigns">No campaigns yet.</span>
            </div>
        `;
        return;
    }

    // Coleta elementos e parametros uma vez para todos os cards
    const allElements = getAllElements();
    const parameters = CONFIG.PARAMETERS;

    container.innerHTML = campaigns
        .map((campaign) => {
            const completeness = getCampaignCompleteness(campaign.id, allElements);
            const readings = campaign.plannedReadings || [];
            const pct = completeness.planned > 0 ? Math.round(completeness.ratio * 100) : 0;
            const barColor = pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : 'red';

            return `
        <div class="element-card campaign-card">
            <!-- Header: nome + cor + visibilidade + excluir -->
            <div class="camp-header">
                <input class="camp-color-dot" type="color" value="${escapeHtml(campaign.color || '#3b6bff')}"
                       oninput="window.handleCampaignChange('${campaign.id}', 'color', this.value)"
                       title="${t('color') || 'Color'}">
                <input class="camp-name" type="text" value="${escapeHtml(campaign.name)}"
                       oninput="window.handleCampaignChange('${campaign.id}', 'name', this.value)">
                <label class="camp-vis" title="${t('visible') || 'Visible'}">
                    <input type="checkbox" ${campaign.visible ? 'checked' : ''}
                           onchange="window.handleCampaignVisibility('${campaign.id}', this.checked)">
                </label>
                <button type="button" class="btn btn-icon" onclick="window.handleOpenDataEntryMatrix('${campaign.id}')"
                        title="${t('dataEntryMatrix') || 'Data Entry Matrix'}" style="font-size:11px;padding:2px 5px;margin-right:2px;">&#9638;</button>
                <button type="button" class="camp-delete" onclick="window.handleRemoveCampaign('${campaign.id}')"
                        title="${t('delete')}">&#10005;</button>
            </div>
            <!-- Datas inline -->
            <div class="camp-dates">
                <input type="date" value="${escapeHtml(campaign.startDate || '')}"
                       oninput="window.handleCampaignChange('${campaign.id}', 'startDate', this.value)"
                       title="${t('startDate') || 'Start'}">
                <span class="camp-date-sep">&#8594;</span>
                <input type="date" value="${escapeHtml(campaign.endDate || '')}"
                       oninput="window.handleCampaignChange('${campaign.id}', 'endDate', this.value)"
                       title="${t('endDate') || 'End'}">
            </div>

            <!-- COMPLETUDE — barra integrada -->
            ${
                readings.length > 0
                    ? `
            <div class="campaign-completeness">
                <div class="campaign-completeness-bar" title="${completeness.executed}/${completeness.planned} (${pct}%)">
                    <div class="campaign-completeness-fill ${barColor}" style="width: ${pct}%"></div>
                </div>
            </div>
            `
                    : ''
            }

            <!-- PLANEJADO — compact grouped tags -->
            <div class="campaign-section">
                <div class="campaign-section-title pr-toggle"
                     onclick="this.parentElement.classList.toggle('collapsed')">
                    <span>
                        <span class="pr-chevron">&#9662;</span>
                        <span data-i18n="plannedReadings">${t('plannedReadings') || 'Planned'}</span>
                        ${readings.length > 0 ? `<span class="pr-count-badge">${completeness.executed}/${completeness.planned}</span>` : ''}
                    </span>
                    <button type="button" class="btn-add-reading"
                            onclick="event.stopPropagation(); window.handleAddPlannedReading('${campaign.id}')">
                        +
                    </button>
                </div>
                <div class="pr-body">
                ${
                    readings.length === 0
                        ? `
                    <div class="planned-readings-empty" data-i18n="noPlannedReadings">
                        ${t('noPlannedReadings') || 'No planned readings.'}
                    </div>
                `
                        : (() => {
                              // Agrupa readings por elementId
                              const groups = new Map();
                              readings.forEach((reading, idx) => {
                                  const key = reading.elementId || '__unset__';
                                  if (!groups.has(key)) groups.set(key, []);
                                  groups.get(key).push({ reading, idx, detail: completeness.details[idx] });
                              });
                              return [...groups.entries()]
                                  .map(([elId, items]) => {
                                      const elName =
                                          elId !== '__unset__'
                                              ? allElements.find((e) => e.id === elId)?.name || elId
                                              : t('selectElement') || '—';
                                      const groupDone = items.filter((i) => i.detail?.executed).length;
                                      return `
                        <div class="pr-group">
                            <div class="pr-group-header">
                                <span class="pr-group-name" title="${escapeHtml(elName)}">${escapeHtml(elName)}</span>
                                <span class="pr-group-stats">${groupDone}/${items.length}</span>
                            </div>
                            <div class="pr-tags">
                                ${items
                                    .map(({ reading, idx, detail }) => {
                                        const isExec = detail?.executed || false;
                                        const pName = reading.parameterId
                                            ? parameters.find((p) => p.id === reading.parameterId)?.name ||
                                              reading.parameterId
                                            : '?';
                                        const cls = isExec ? 'done' : 'pending';
                                        const icon = isExec ? '&#10003;' : '';
                                        return `<span class="pr-tag ${cls}"
                                        title="${escapeHtml(pName)} — ${isExec ? t('readingExecuted') || 'Executed' : t('readingPending') || 'Pending'}">
                                        ${icon} ${escapeHtml(pName)}
                                        <button type="button" class="pr-tag-x"
                                                onclick="window.handleRemovePlannedReading('${campaign.id}', ${idx})"
                                                title="${t('delete')}">&#215;</button>
                                    </span>`;
                                    })
                                    .join('')}
                            </div>
                        </div>`;
                                  })
                                  .join('');
                          })()
                }
                </div>
            </div>

            <!-- CUSTOS DA CAMPANHA (L3) -->
            ${renderCampaignCostSection(campaign)}
        </div>`;
        })
        .join('');
}

/**
 * Render campaign cost section (L3 Cost Framework).
 * Mostra custos de mobilização, coleta, logística e analíticos.
 *
 * @param {Object} campaign - Campaign object
 * @returns {string} HTML string
 */
function renderCampaignCostSection(campaign) {
    const cost = campaign.costs;
    if (!cost || !cost.items || cost.items.length === 0) return '';

    const itemRows = cost.items
        .map(
            (item) => `
        <div style="display:flex;justify-content:space-between;font-size:10px;padding:1px 4px;">
            <span style="color:var(--neutral-400);text-transform:uppercase;font-size:9px;">${escapeHtml(item.itemId)}</span>
            <span>${item.amount.toFixed(2)}${item.note ? ` <span style="color:var(--neutral-500);font-size:8px;">(${escapeHtml(item.note)})</span>` : ''}</span>
        </div>
    `,
        )
        .join('');

    return `
        <div class="campaign-section">
            <div class="campaign-section-title pr-toggle"
                 onclick="this.parentElement.classList.toggle('collapsed')">
                <span>
                    <span class="pr-chevron">&#9662;</span>
                    <span data-i18n="campaignCosts">${t('campaignCosts') || 'Costs'}</span>
                </span>
                <span style="font-size:10px;color:var(--neutral-400);">${cost.currency || 'BRL'} ${cost.total.toFixed(2)}</span>
            </div>
            <div class="pr-body">
                ${itemRows}
                <div style="display:flex;justify-content:space-between;border-top:1px solid var(--neutral-700);margin-top:3px;padding:3px 4px 0;font-size:10px;font-weight:600;">
                    <span>Total</span>
                    <span>${cost.currency || 'BRL'} ${cost.total.toFixed(2)}</span>
                </div>
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// CENAS
// ----------------------------------------------------------------

export function updateScenesList() {
    const container = document.getElementById('scenes-list');
    if (!container) return;

    const scenes = getAllScenes();
    const campaigns = getAllCampaigns();
    const elements = getAllElements();

    if (scenes.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 16px; color: var(--neutral-500);">
                <span data-i18n="noScenes">No scenes yet.</span>
            </div>
        `;
        return;
    }

    const campaignOptions = campaigns
        .map(
            (c) => `
        <option value="${c.id}">${escapeHtml(c.name)}</option>
    `,
        )
        .join('');

    container.innerHTML = scenes
        .map(
            (scene) => `
        <div class="element-card">
            <div class="form-group">
                <label class="form-label" data-i18n="sceneName">Scene Name</label>
                <input class="form-input" type="text" value="${escapeHtml(scene.name)}"
                       oninput="window.handleSceneChange('${scene.id}', 'name', this.value)">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" data-i18n="viewStart">View Start</label>
                    <button type="button" class="btn btn-secondary" onclick="window.handleCaptureViewStart('${scene.id}')">
                        ${getIcon('camera', { size: '14px' })} <span data-i18n="capture">Capture</span>
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="window.handleApplyViewStart('${scene.id}')">
                        ▶ <span data-i18n="apply">Apply</span>
                    </button>
                </div>
                <div class="form-group">
                    <label class="form-label" data-i18n="viewEnd">View End</label>
                    <button type="button" class="btn btn-secondary" onclick="window.handleCaptureViewEnd('${scene.id}')">
                        ${getIcon('camera', { size: '14px' })} <span data-i18n="capture">Capture</span>
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="window.handleApplyViewEnd('${scene.id}')">
                        ▶ <span data-i18n="apply">Apply</span>
                    </button>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" data-i18n="campaignsStart">Campaigns Start</label>
                    <select class="form-input" multiple
                            onchange="window.handleSceneCampaigns('${scene.id}', 'campaignsStart', this)">
                        ${campaignOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label" data-i18n="campaignsEnd">Campaigns End</label>
                    <select class="form-input" multiple
                            onchange="window.handleSceneCampaigns('${scene.id}', 'campaignsEnd', this)">
                        ${campaignOptions}
                    </select>
                </div>
            </div>
            <div class="section" style="margin-top: 8px;">
                <div class="section-header">
                    <span data-i18n="elementFilters">Element Filters</span>
                    <span class="chevron">▼</span>
                </div>
                <div class="section-content">
                    <div class="filters-grid">
                        ${elements
                            .map(
                                (element) => `
                            <label class="filter-item">
                                <input type="checkbox"
                                       ${scene.elementVisibility?.[element.id] !== false ? 'checked' : ''}
                                       onchange="window.handleSceneElementFilter('${scene.id}', '${element.id}', this.checked)">
                                <span>${escapeHtml(element.name)}</span>
                            </label>
                        `,
                            )
                            .join('')}
                    </div>
                </div>
            </div>
            <div style="display:flex; gap:4px; margin-top:4px;">
                <button type="button" class="btn btn-secondary" onclick="window.handleScrollToReportAnchor('${scene.id}')"
                        title="Go to Report anchor" style="flex:1;">
                    ${getIcon('file-text', { size: '14px' })} <span data-i18n="reportTab">Report</span>
                </button>
                <button type="button" class="btn btn-secondary" onclick="window.handleRemoveScene('${scene.id}')" style="flex:1;">
                    ${t('delete')}
                </button>
            </div>
        </div>
    `,
        )
        .join('');

    scenes.forEach((scene) => {
        syncMultiSelect(scene.id, 'campaignsStart', scene.campaignsStart || []);
        syncMultiSelect(scene.id, 'campaignsEnd', scene.campaignsEnd || []);
    });
}

function syncMultiSelect(sceneId, field, values) {
    const selector = document.querySelector(`select[onchange*="${sceneId}"][onchange*="${field}"]`);
    if (!selector) return;
    Array.from(selector.options).forEach((option) => {
        option.selected = values.includes(option.value);
    });
}

// ----------------------------------------------------------------
// BARRA DE STATUS
// ----------------------------------------------------------------

/**
 * Atualiza informacoes na barra de status.
 * Mostra contagem de elementos e familias.
 */
export function updateStatusBar() {
    // Atualiza contagem de elementos
    const elementsSpan = document.getElementById('status-elements');
    if (elementsSpan) {
        const count = getElementCount();
        elementsSpan.innerHTML = `${count} <span data-i18n="elements">${t('elements')}</span>`;
    }

    // Atualiza contagem de familias ativas
    const familiesSpan = document.getElementById('status-families');
    if (familiesSpan) {
        const count = getEnabledFamilies().length;
        familiesSpan.innerHTML = `${count} <span data-i18n="families">${t('families')}</span>`;
    }
}

// ----------------------------------------------------------------
// FUNCAO UTILITARIA (escapeHtml importado de utils/html.js)
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// ATUALIZACAO GERAL
// ----------------------------------------------------------------

/**
 * Atualiza todas as listas da interface.
 * Util apos importacao ou mudancas significativas.
 */
export function updateAllLists() {
    updateFamiliesList();
    updateElementsList();
    updateElementDetails();
    updateCampaignsList();
    updateScenesList();
    updateStatusBar();
}
