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
   CANVAS CONTEXT MENU — Right-click on empty 3D viewport space
   ================================================================

   Menu de contexto para clique direito no espaco vazio do canvas 3D.
   Aparece quando o usuario clica com botao direito fora de qualquer
   elemento ou handle de edicao.

   Itens:
   - Add Element (submenu por familia habilitada)
   - Paste (se clipboard tem conteudo)
   - Separator
   - Fit All, Isometric, Top, Front views
   - Separator
   - Generate Random Model

   Reutiliza classes CSS `.panel-context-menu` do panelManager.

   ================================================================ */

import * as THREE from 'three';
import { getCamera, getRenderer, getElementsGroup } from './setup.js';
import { getEnabledFamilies, getFamilyName } from '../../core/elements/families.js';
import { hasClipboard } from '../handlers/elements.js';
import { isEditing } from '../editing/editManager.js';
import { getIcon } from '../ui/icons.js';
import { t } from '../i18n/translations.js';
import { escapeHtml } from '../helpers/html.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let menuEl = null;
let submenuEl = null;
let container = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Posição 3D e elemento do último clique direito (para criação de issues/serviços)
let _lastMenuPos = { x: 0, y: 0, z: 0 };
let _lastMenuElementId = null;

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Inicializa o menu de contexto do canvas.
 * Cria DOM, registra listener de contextmenu no container do canvas.
 *
 * @param {HTMLElement} canvasContainer
 */
export function initCanvasContextMenu(canvasContainer) {
    container = canvasContainer;

    // Menu principal
    menuEl = document.createElement('div');
    menuEl.className = 'panel-context-menu';
    menuEl.id = 'canvas-context-menu';
    document.body.appendChild(menuEl);

    // Submenu para familias
    submenuEl = document.createElement('div');
    submenuEl.className = 'panel-context-menu';
    submenuEl.id = 'canvas-context-submenu';
    document.body.appendChild(submenuEl);

    // Listener no canvas — bubble phase (editing context menu usa capture)
    container.addEventListener('contextmenu', handleContextMenu);

    // Clique nos itens
    menuEl.addEventListener('click', handleMenuClick);
    submenuEl.addEventListener('click', handleSubmenuClick);

    // Previne menu nativo sobre nossos menus
    menuEl.addEventListener('contextmenu', (e) => e.preventDefault());
    submenuEl.addEventListener('contextmenu', (e) => e.preventDefault());

    // Fechar ao clicar fora
    document.addEventListener('mousedown', handleOutsideClick);

    // Fechar com Escape
    document.addEventListener('keydown', handleEscapeKey);
}

// ----------------------------------------------------------------
// EVENT HANDLERS
// ----------------------------------------------------------------

/**
 * Handler do contextmenu no canvas.
 * Captura posição 3D antes de exibir o menu (para criação de issues/serviços).
 */
function handleContextMenu(event) {
    // Nao mostra durante edicao de formas (editing contextMenu cuida disso)
    if (isEditing()) return;

    event.preventDefault();
    event.stopPropagation();

    // Captura hit e posição 3D independente de ter clicado em elemento
    const hit = hitTest(event);
    _lastMenuElementId = hit?.elementId || null;
    _lastMenuPos = hit?.point || _projectCursorToGround(event);

    buildMenu();
    showMenu(event.clientX, event.clientY);
}

/**
 * Testa se o clique atinge algum elemento 3D.
 * Retorna { point, elementId } se atingiu, ou null.
 */
function hitTest(event) {
    const camera = getCamera();
    const renderer = getRenderer();
    const elementsGroup = getElementsGroup();
    if (!camera || !renderer || !elementsGroup) return null;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(elementsGroup.children, true);
    if (intersects.length === 0) return null;

    const hit = intersects[0];
    let elementId = null;
    let obj = hit.object;
    while (obj) {
        if (obj.userData?.id) {
            elementId = obj.userData.id;
            break;
        }
        obj = obj.parent;
    }
    return { point: { x: hit.point.x, y: hit.point.y, z: hit.point.z }, elementId };
}

/**
 * Projeta o cursor sobre o plano Y=0 (solo) quando não há hit em geometria.
 * @param {MouseEvent} event
 * @returns {{x:number, y:number, z:number}}
 */
function _projectCursorToGround(event) {
    const camera = getCamera();
    const renderer = getRenderer();
    if (!camera || !renderer) return { x: 0, y: 0, z: 0 };

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(ground, target);
    return { x: target.x, y: 0, z: target.z };
}

/**
 * Clique em item do menu principal.
 */
function handleMenuClick(event) {
    const item = event.target.closest('[data-action]');
    if (!item || item.classList.contains('disabled')) return;

    const action = item.dataset.action;

    // Add Element abre submenu de famílias
    if (action === 'add-element') {
        showFamilySubmenu(item);
        return;
    }

    // Service menu abre submenu de tipos de serviço
    if (action === 'service-menu') {
        showServiceSubmenu(item);
        return;
    }

    executeAction(action);
    hideMenu();
}

/**
 * Clique em item do submenu (famílias ou tipos de serviço).
 */
function handleSubmenuClick(event) {
    const item = event.target.closest('[data-action]');
    if (!item) return;

    const action = item.dataset.action;
    if (action.startsWith('add:')) {
        const familyId = action.slice(4);
        window.handleAddElement?.(familyId);
    } else if (action.startsWith('service:')) {
        const serviceType = action.slice(8);
        window.handleCreateServiceRequest?.({
            serviceType,
            position: _lastMenuPos,
            elementId: _lastMenuElementId,
        });
    }

    hideMenu();
}

/**
 * Fechar menus ao clicar fora.
 */
function handleOutsideClick(event) {
    if (!menuEl?.classList.contains('visible')) return;
    if (menuEl.contains(event.target)) return;
    if (submenuEl?.contains(event.target)) return;
    hideMenu();
}

/**
 * Fechar com Escape.
 */
function handleEscapeKey(event) {
    if (event.key === 'Escape' && menuEl?.classList.contains('visible')) {
        hideMenu();
    }
}

// ----------------------------------------------------------------
// MENU BUILDER
// ----------------------------------------------------------------

/**
 * Constroi o HTML do menu principal.
 */
function buildMenu() {
    if (!menuEl) return;

    const items = [];

    // Add Element (abre submenu)
    items.push(menuItem('add-element', 'plus', t('addElement'), '', true));

    // Paste
    const canPaste = hasClipboard();
    items.push(menuItem('paste', 'clipboard', t('paste'), 'Ctrl+V', false, !canPaste));

    items.push(separator());

    // View presets
    items.push(menuItem('fit-all', 'maximize', t('fitAll') || 'Fit All'));
    items.push(menuItem('isometric', 'box', t('isometric') || 'Isometric'));
    items.push(menuItem('top-view', 'arrow-down', t('topView') || 'Top'));
    items.push(menuItem('front-view', 'arrow-right', t('frontView') || 'Front'));
    items.push(menuItem('reset-view', 'rotate-ccw', t('resetView')));

    items.push(separator());

    // Issue / Service Request
    items.push(menuItem('create-issue', 'alert-circle', t('context_menu.create_issue') || 'Create Issue Here'));
    items.push(
        menuItem('service-menu', 'tool', t('context_menu.request_service') || 'Request Service \u25B6', '', true),
    );

    items.push(separator());

    // Generate random
    items.push(menuItem('random', 'shuffle', t('generateRandom') || 'Random Model'));

    menuEl.innerHTML = items.join('');
}

/**
 * Cria HTML de um item do menu.
 */
function menuItem(action, icon, label, shortcut, hasSubmenu, disabled) {
    const iconHtml = getIcon(icon, { size: '14px' });
    let rightHtml = '';
    if (hasSubmenu) {
        rightHtml = `<span class="panel-context-menu-shortcut">${getIcon('chevron-right', { size: '12px' })}</span>`;
    } else if (shortcut) {
        rightHtml = `<span class="panel-context-menu-shortcut">${shortcut}</span>`;
    }
    const cls = disabled ? ' disabled' : '';

    return `<button class="panel-context-menu-item${cls}" data-action="${action}">
        ${iconHtml}
        <span>${label}</span>
        ${rightHtml}
    </button>`;
}

/**
 * Cria HTML de separador.
 */
function separator() {
    return '<div class="panel-context-menu-sep"></div>';
}

// ----------------------------------------------------------------
// FAMILY SUBMENU
// ----------------------------------------------------------------

/**
 * Mostra submenu de familias ao lado do item "Add Element".
 * @param {HTMLElement} triggerItem
 */
function showFamilySubmenu(triggerItem) {
    if (!submenuEl) return;

    const families = getEnabledFamilies();
    let html = '';
    for (const f of families) {
        const iconHtml = getIcon(f.icon || 'circle', { size: '14px' });
        const name = getFamilyName(f);
        html += `<button class="panel-context-menu-item" data-action="add:${f.id}">
            ${iconHtml}
            <span>${name}</span>
        </button>`;
    }

    submenuEl.innerHTML = html;

    // Posiciona ao lado direito do item trigger
    const triggerRect = triggerItem.getBoundingClientRect();
    submenuEl.style.left = `${triggerRect.right + 2}px`;
    submenuEl.style.top = `${triggerRect.top}px`;
    submenuEl.classList.add('visible');

    // Ajusta se sair da viewport
    requestAnimationFrame(() => {
        const rect = submenuEl.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (rect.right > vw) {
            // Mostra do lado esquerdo do trigger
            submenuEl.style.left = `${triggerRect.left - rect.width - 2}px`;
        }
        if (rect.bottom > vh) {
            submenuEl.style.top = `${Math.max(0, vh - rect.height - 8)}px`;
        }
    });
}

// ----------------------------------------------------------------
// SERVICE SUBMENU
// ----------------------------------------------------------------

/**
 * Mostra submenu de tipos de serviço ao lado do item "Request Service".
 * @param {HTMLElement} triggerItem
 */
async function showServiceSubmenu(triggerItem) {
    if (!submenuEl) return;

    // Import dinâmico para evitar dependência circular no load
    let SERVICE_TYPES = {};
    try {
        const mod = await import('../../core/issues/manager.js');
        SERVICE_TYPES = mod.SERVICE_TYPES || {};
    } catch (_) {}

    let html = '';
    for (const [key, label] of Object.entries(SERVICE_TYPES)) {
        html += `<button class="panel-context-menu-item" data-action="service:${key}">
            <span>${escapeHtml(label)}</span>
        </button>`;
    }

    if (!html) {
        html = `<button class="panel-context-menu-item disabled">No services available</button>`;
    }

    submenuEl.innerHTML = html;

    // Posiciona ao lado direito do item trigger
    const triggerRect = triggerItem.getBoundingClientRect();
    submenuEl.style.left = `${triggerRect.right + 2}px`;
    submenuEl.style.top = `${triggerRect.top}px`;
    submenuEl.classList.add('visible');

    requestAnimationFrame(() => {
        const rect = submenuEl.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (rect.right > vw) {
            submenuEl.style.left = `${triggerRect.left - rect.width - 2}px`;
        }
        if (rect.bottom > vh) {
            submenuEl.style.top = `${Math.max(0, vh - rect.height - 8)}px`;
        }
    });
}

// ----------------------------------------------------------------
// SHOW / HIDE
// ----------------------------------------------------------------

/**
 * Posiciona e mostra o menu principal.
 */
function showMenu(x, y) {
    if (!menuEl) return;

    // Esconde submenu anterior
    hideSubmenu();

    menuEl.style.left = `${x}px`;
    menuEl.style.top = `${y}px`;
    menuEl.classList.add('visible');

    // Ajusta se ultrapassar a viewport
    requestAnimationFrame(() => {
        const rect = menuEl.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (rect.right > vw) {
            menuEl.style.left = `${Math.max(0, x - rect.width)}px`;
        }
        if (rect.bottom > vh) {
            menuEl.style.top = `${Math.max(0, y - rect.height)}px`;
        }
    });
}

/**
 * Esconde ambos os menus.
 */
function hideMenu() {
    menuEl?.classList.remove('visible');
    hideSubmenu();
}

/**
 * Esconde apenas o submenu.
 */
function hideSubmenu() {
    submenuEl?.classList.remove('visible');
}

// ----------------------------------------------------------------
// ACTION EXECUTION
// ----------------------------------------------------------------

/**
 * Executa a acao selecionada.
 * @param {string} action
 */
function executeAction(action) {
    switch (action) {
        case 'paste':
            window.handlePasteElement?.();
            break;
        case 'fit-all':
            window.fitAllElements?.();
            break;
        case 'isometric':
            window.setIsometricView?.();
            break;
        case 'top-view':
            window.setTopView?.();
            break;
        case 'front-view':
            window.setFrontView?.();
            break;
        case 'reset-view':
            window.resetView?.();
            break;
        case 'random':
            window.generateRandomModel?.();
            break;
        case 'create-issue':
            window.handleCreateIssueAtPosition?.(_lastMenuPos, _lastMenuElementId);
            break;
    }
}
