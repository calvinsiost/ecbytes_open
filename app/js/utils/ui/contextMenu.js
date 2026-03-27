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
   CONTEXT MENU — Menu de contexto (botao direito) nos paineis
   ================================================================

   Menus de contexto para cards de elementos e itens de familia.
   Usa event delegation — um unico listener em cada container.

   PADRAO REUTILIZADO:
   - Mesmas classes CSS de panelManager (.panel-context-menu)
   - Mesmo padrao de show/hide com .visible
   - Mesma logica de reposicionamento se sair da tela

   ================================================================ */

import { getIcon } from './icons.js';
import { t } from '../i18n/translations.js';
import {
    getElementById,
    getSelectedElement,
    setSelectedElement,
    getElementsByFamily,
} from '../../core/elements/manager.js';
import { setElementVisibility } from '../../core/elements/manager.js';
import { getElementGroups, getElementGroup, setElementGroup, clearElementGroup } from '../groups/manager.js';
import { hasStrategy } from '../editing/editManager.js';
import { getFamily } from '../../core/elements/families.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let menuEl = null;
let currentElementId = null;
let currentFamilyId = null;

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Cria o DOM do context menu e registra listeners.
 * Chamado uma vez durante init() em main.js.
 */
export function initElementContextMenu() {
    // Cria elemento DOM compartilhado
    menuEl = document.createElement('div');
    menuEl.className = 'panel-context-menu';
    menuEl.id = 'element-context-menu';
    document.body.appendChild(menuEl);

    // Impedir menu nativo sobre nosso menu
    menuEl.addEventListener('contextmenu', (e) => e.preventDefault());

    // Clique nos itens do menu
    menuEl.addEventListener('click', (e) => {
        const item = e.target.closest('.panel-context-menu-item');
        if (!item || item.classList.contains('disabled')) return;
        executeAction(item.dataset.action);
        hideMenu();
    });

    // Fechar ao clicar fora
    document.addEventListener('click', (e) => {
        if (menuEl && !menuEl.contains(e.target)) hideMenu();
    });

    // Fechar com Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideMenu();
    });

    // Event delegation: botao direito em element cards
    const elementsContainer = document.getElementById('tab-elements');
    if (elementsContainer) {
        elementsContainer.addEventListener('contextmenu', handleElementContextMenu);
    }

    // Event delegation: botao direito em family items
    const familiesContainer = document.getElementById('families-list');
    if (familiesContainer) {
        familiesContainer.addEventListener('contextmenu', handleFamilyContextMenu);
    }
}

// ----------------------------------------------------------------
// EVENT HANDLERS
// ----------------------------------------------------------------

/**
 * Intercepta right-click em element cards.
 * @param {MouseEvent} e
 */
function handleElementContextMenu(e) {
    const card = e.target.closest('.element-card');
    if (!card) return;

    e.preventDefault();
    e.stopPropagation();

    const elementId = card.dataset.elementId;
    if (!elementId) return;

    currentElementId = elementId;
    currentFamilyId = null;
    buildElementMenu(elementId);
    showMenu(e.clientX, e.clientY);
}

/**
 * Intercepta right-click em family items.
 * @param {MouseEvent} e
 */
function handleFamilyContextMenu(e) {
    const item = e.target.closest('.family-item');
    if (!item) return;

    e.preventDefault();
    e.stopPropagation();

    const familyId = item.dataset.familyId;
    if (!familyId) return;

    currentFamilyId = familyId;
    currentElementId = null;
    buildFamilyMenu(familyId);
    showMenu(e.clientX, e.clientY);
}

// ----------------------------------------------------------------
// MENU BUILDERS
// ----------------------------------------------------------------

/**
 * Constroi menu para um element card.
 * @param {string} elementId
 */
function buildElementMenu(elementId) {
    const element = getElementById(elementId);
    if (!element) return;

    const family = getFamily(element.family);
    const isVisible = element.visible;
    const group = getElementGroup(elementId);
    const groups = getElementGroups();
    const canEditShape = hasStrategy(element.family);

    let html = '';

    // Zoom to element
    html += menuItem('zoom-to', 'target', t('zoomToElement'));
    html += menuItem(
        isVisible ? 'hide' : 'show',
        isVisible ? 'eye-off' : 'eye',
        isVisible ? t('hideElement') : t('showElement'),
    );

    html += separator();

    // Copy / Duplicate
    html += menuItem('copy', 'copy', t('copy'));
    html += menuItem('duplicate', 'copy', t('duplicate'));

    html += separator();

    // Edit shape (conditional) + Transform (always available)
    if (canEditShape) {
        html += menuItem('edit-shape', 'edit', t('editShape'));
    }
    html += menuItem('transform', 'move', t('transform') || 'Transform');

    // Move to group (submenu-like: flat list of groups)
    if (groups.length > 0) {
        html += `<div class="panel-context-menu-label">${t('moveToGroup')}</div>`;
        for (const g of groups) {
            const active = group === g.id ? ' active' : '';
            html += `<button class="panel-context-menu-item panel-context-menu-sub${active}" data-action="move-to-group:${g.id}">
                ${getIcon('layers', { size: '14px' })}
                <span>${g.name}</span>
            </button>`;
        }
        if (group) {
            html += menuItem('remove-from-group', 'x', t('removeFromGroup'));
        }
        html += separator();
    }

    // Delete
    html += menuItem('delete', 'trash', t('delete'), 'panel-context-menu-item danger');

    menuEl.innerHTML = html;
}

/**
 * Constroi menu para um family item.
 * @param {string} familyId
 */
function buildFamilyMenu(familyId) {
    const elements = getElementsByFamily(familyId);
    const hasElements = elements.length > 0;

    let html = '';

    // Add element
    html += menuItem('add-element', 'plus', t('addElement'));

    if (hasElements) {
        html += separator();
        html += menuItem('show-all', 'eye', t('showAll'));
        html += menuItem('hide-all', 'eye-off', t('hideAll'));
        html += separator();
        html += menuItem('zoom-to-family', 'target', t('zoomToFamily'));
    }

    menuEl.innerHTML = html;
}

// ----------------------------------------------------------------
// MENU ITEM HELPERS
// ----------------------------------------------------------------

function menuItem(action, icon, label, className = 'panel-context-menu-item') {
    return `<button class="${className}" data-action="${action}">
        ${getIcon(icon, { size: '14px' })}
        <span>${label}</span>
    </button>`;
}

function separator() {
    return '<div class="panel-context-menu-sep"></div>';
}

// ----------------------------------------------------------------
// ACTION EXECUTION
// ----------------------------------------------------------------

/**
 * Executa acao do menu.
 * Chama handlers existentes via window.* ou funcoes diretas.
 *
 * @param {string} action - Identificador da acao
 */
function executeAction(action) {
    // --- Element actions ---
    if (currentElementId) {
        const id = currentElementId;

        switch (action) {
            case 'zoom-to':
                window.handleZoomToElement?.(id);
                break;
            case 'show':
            case 'hide':
                window.handleToggleVisibility?.(id);
                break;
            case 'copy':
                // Seleciona o elemento antes de copiar (handleCopyElement usa getSelectedElement)
                setSelectedElement(id);
                window.handleCopyElement?.();
                break;
            case 'duplicate':
                window.handleDuplicateElement?.(id);
                break;
            case 'edit-shape':
                window.handleEnterShapeEdit?.(id);
                break;
            case 'transform':
                window.handleEnterGizmoMode?.(id);
                break;
            case 'remove-from-group':
                clearElementGroup(id);
                window.handleSelectElement?.(id);
                break;
            case 'delete':
                window.handleRemoveElement?.(id);
                break;
            default:
                // Move to group: action = "move-to-group:groupId"
                if (action.startsWith('move-to-group:')) {
                    const groupId = action.slice('move-to-group:'.length);
                    setElementGroup(id, groupId);
                    window.handleSelectElement?.(id);
                }
                break;
        }
    }

    // --- Family actions ---
    if (currentFamilyId) {
        const fid = currentFamilyId;

        switch (action) {
            case 'add-element':
                window.handleAddElement?.(fid);
                break;
            case 'show-all':
                window.handleShowAllFamily?.(fid);
                break;
            case 'hide-all':
                window.handleHideAllFamily?.(fid);
                break;
            case 'zoom-to-family':
                window.handleZoomToFamily?.(fid);
                break;
        }
    }
}

// ----------------------------------------------------------------
// SHOW / HIDE
// ----------------------------------------------------------------

function showMenu(x, y) {
    if (!menuEl) return;
    menuEl.style.left = `${x}px`;
    menuEl.style.top = `${y}px`;
    menuEl.classList.add('visible');

    // Reposicionar se sair da tela
    requestAnimationFrame(() => {
        const rect = menuEl.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menuEl.style.left = `${window.innerWidth - rect.width - 8}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menuEl.style.top = `${window.innerHeight - rect.height - 8}px`;
        }
    });
}

function hideMenu() {
    if (menuEl) {
        menuEl.classList.remove('visible');
        currentElementId = null;
        currentFamilyId = null;
    }
}
