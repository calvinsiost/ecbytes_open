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
   SHAPE EDIT CONTEXT MENU — Right-click menu for shape editing
   ================================================================

   Menu de contexto para edição de formas 3D no viewport.
   Aparece ao clicar com botão direito no canvas durante edição.

   Itens mudam conforme o alvo do clique:
   - Vértice: Excluir Vértice, Draw Mode, Resetar, Sair
   - Ponto Médio: Inserir Vértice, Draw Mode, Resetar, Sair
   - Espaço Vazio (edit): Draw Mode, Resetar, Sair
   - Espaço Vazio (draw): Adicionar Vértice Aqui, Sair Draw, Resetar, Sair

   Reutiliza as classes CSS `.panel-context-menu` do panelManager.

   ================================================================ */

import * as THREE from 'three';
import { getCamera, getEditHandlesGroup, getRenderer } from '../scene/setup.js';
import { updateHandleScales } from './handleFactory.js';
import {
    isEditing,
    getEditMode,
    exitEditMode,
    toggleDrawMode,
    deleteSelectedVertex,
    resetShape,
    insertVertexAtMidpoint,
    addVertexAtPosition,
    selectVertexByIndex,
    getSelectedVertexIndex,
} from './editManager.js';
import { isDragActive } from './dragController.js';
import { getIcon } from '../ui/icons.js';
import { t } from '../i18n/translations.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

let menuEl = null;
let container = null;
let raycaster = null;
const mouse = new THREE.Vector2();

// Pooled temporaries — evita alocacao por evento
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _worldPos = new THREE.Vector3();

// Alvo do clique direito (preenchido pelo raycast)
let clickTarget = null;
// { type: 'vertex'|'midpoint'|'empty', handle?, vertexIndex?, afterIndex?, worldPos? }

// ----------------------------------------------------------------
// INICIALIZAÇÃO
// ----------------------------------------------------------------

/**
 * Inicializa o menu de contexto para shape editing.
 * Cria DOM, registra listeners no canvas container.
 *
 * @param {HTMLElement} canvasContainer
 */
export function initContextMenu(canvasContainer) {
    container = canvasContainer;
    raycaster = new THREE.Raycaster();

    // Cria elemento DOM (reusa classes do panel-context-menu)
    menuEl = document.createElement('div');
    menuEl.className = 'panel-context-menu';
    menuEl.id = 'shape-edit-context-menu';
    document.body.appendChild(menuEl);

    // Listener de contexto no canvas (capture para interceptar antes de OrbitControls)
    container.addEventListener('contextmenu', handleContextMenu, { capture: true });

    // Clique no menu → executa ação
    menuEl.addEventListener('click', handleMenuClick);

    // Previne menu nativo sobre o nosso menu
    menuEl.addEventListener('contextmenu', (e) => e.preventDefault());

    // Fechar ao clicar fora
    document.addEventListener('mousedown', handleOutsideClick);

    // Fechar com Escape
    document.addEventListener('keydown', handleEscapeKey);
}

/**
 * Destrói o menu de contexto completamente.
 */
export function destroyContextMenu() {
    if (container) {
        container.removeEventListener('contextmenu', handleContextMenu, { capture: true });
    }
    if (menuEl) {
        menuEl.removeEventListener('click', handleMenuClick);
        menuEl.remove();
        menuEl = null;
    }
    document.removeEventListener('mousedown', handleOutsideClick);
    document.removeEventListener('keydown', handleEscapeKey);
    container = null;
    raycaster = null;
    clickTarget = null;
}

// ----------------------------------------------------------------
// EVENT HANDLERS
// ----------------------------------------------------------------

/**
 * Handler do evento contextmenu no canvas.
 * Determina o alvo via raycast e mostra menu contextual.
 */
function handleContextMenu(event) {
    // Só mostra se está em modo de edição
    if (!isEditing()) return;

    // Não mostra durante arrasto ativo
    if (isDragActive()) return;

    event.preventDefault();
    event.stopPropagation();

    // Raycast contra handles para descobrir o alvo
    clickTarget = resolveTarget(event);

    // Monta e exibe o menu
    buildMenu();
    showMenu(event.clientX, event.clientY);
}

/**
 * Clique em item do menu → executa ação correspondente.
 */
function handleMenuClick(event) {
    const item = event.target.closest('[data-action]');
    if (!item || item.classList.contains('disabled')) return;

    const action = item.dataset.action;
    executeAction(action);
    hideMenu();
}

/**
 * Fechar menu ao clicar fora dele.
 */
function handleOutsideClick(event) {
    if (!menuEl || !menuEl.classList.contains('visible')) return;
    if (menuEl.contains(event.target)) return;
    hideMenu();
}

/**
 * Fechar menu com Escape.
 */
function handleEscapeKey(event) {
    if (event.key === 'Escape' && menuEl?.classList.contains('visible')) {
        event.stopPropagation(); // Não propaga para o exitEditMode do main.js
        hideMenu();
    }
}

// ----------------------------------------------------------------
// RAYCAST — DETERMINAR ALVO
// ----------------------------------------------------------------

/**
 * Faz raycast nos handles de edição para descobrir o que foi clicado.
 * @param {MouseEvent} event
 * @returns {{ type: string, handle?, vertexIndex?, afterIndex?, worldPos? }}
 */
function resolveTarget(event) {
    const handleGroup = getEditHandlesGroup();
    const camera = getCamera();
    if (!handleGroup || !camera) return { type: 'empty' };

    // Atualiza coordenadas normalizadas do mouse
    const renderer = getRenderer();
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Atualiza escala dos handles antes do raycast
    updateHandleScales(handleGroup);

    raycaster.setFromCamera(mouse, camera);

    // Filtra apenas handles (não Lines/outlines)
    const handleMeshes = handleGroup.children.filter((c) => c.userData?.handleType);
    const intersects = raycaster.intersectObjects(handleMeshes, false);

    if (intersects.length > 0) {
        const hit = intersects[0].object;
        const type = hit.userData.handleType;

        if (type === 'vertex') {
            return {
                type: 'vertex',
                handle: hit,
                vertexIndex: hit.userData.vertexIndex,
            };
        }
        if (type === 'midpoint') {
            return {
                type: 'midpoint',
                handle: hit,
                afterIndex: hit.userData.afterIndex,
            };
        }
    }

    // Nenhum handle clicado — calcula posição no plano do chão
    _groundPlane.normal.set(0, 1, 0);
    _groundPlane.constant = 0;
    raycaster.ray.intersectPlane(_groundPlane, _worldPos);

    return { type: 'empty', worldPos: _worldPos.clone() };
}

// ----------------------------------------------------------------
// CONSTRUÇÃO DO MENU
// ----------------------------------------------------------------

/**
 * Constrói o HTML do menu baseado no alvo e modo de edição.
 */
function buildMenu() {
    if (!menuEl || !clickTarget) return;

    const mode = getEditMode();
    const items = [];

    // Ações específicas do alvo
    if (clickTarget.type === 'vertex') {
        items.push(menuItem('delete-vertex', 'trash', t('deleteVertex') || 'Delete Vertex', 'Del'));
    } else if (clickTarget.type === 'midpoint') {
        items.push(menuItem('insert-vertex', 'plus', t('insertVertex') || 'Insert Vertex'));
    } else if (clickTarget.type === 'empty' && mode === 'draw') {
        items.push(menuItem('add-vertex-here', 'plus', t('addVertexHere') || 'Add Vertex Here'));
    }

    // Separador se houve item contextual
    if (items.length > 0) {
        items.push(separator());
    }

    // Draw mode toggle
    if (mode === 'draw') {
        items.push(menuItem('toggle-draw', 'pen-tool', t('exitDrawMode') || 'Exit Draw Mode', 'D', true));
    } else {
        items.push(menuItem('toggle-draw', 'pen-tool', t('enterDrawMode') || 'Enter Draw Mode', 'D'));
    }

    // Reset Shape
    items.push(menuItem('reset-shape', 'rotate-ccw', t('resetShape') || 'Reset Shape', 'R'));

    // Separador + Done
    items.push(separator());
    items.push(menuItem('done', 'check', t('doneEditing') || 'Done', 'Enter'));

    menuEl.innerHTML = items.join('');
}

/**
 * Cria HTML de um item do menu.
 */
function menuItem(action, icon, label, shortcut, active) {
    const iconHtml = getIcon(icon, { size: '14px' });
    const shortcutHtml = shortcut ? `<span class="panel-context-menu-shortcut">${shortcut}</span>` : '';
    const activeClass = active ? ' active' : '';

    return `<button class="panel-context-menu-item${activeClass}" data-action="${action}">
        ${iconHtml}
        <span>${label}</span>
        ${shortcutHtml}
    </button>`;
}

/**
 * Cria HTML de separador.
 */
function separator() {
    return '<div class="panel-context-menu-sep"></div>';
}

// ----------------------------------------------------------------
// MOSTRAR / ESCONDER
// ----------------------------------------------------------------

/**
 * Posiciona e mostra o menu no local do clique.
 */
function showMenu(x, y) {
    if (!menuEl) return;

    // Posiciona temporariamente para medir tamanho
    menuEl.style.left = `${x}px`;
    menuEl.style.top = `${y}px`;
    menuEl.classList.add('visible');

    // Ajusta se ultrapassar a viewport
    const rect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (rect.right > vw) {
        menuEl.style.left = `${Math.max(0, x - rect.width)}px`;
    }
    if (rect.bottom > vh) {
        menuEl.style.top = `${Math.max(0, y - rect.height)}px`;
    }
}

/**
 * Esconde o menu de contexto.
 */
export function hideMenu() {
    if (menuEl) {
        menuEl.classList.remove('visible');
    }
    clickTarget = null;
}

// ----------------------------------------------------------------
// EXECUÇÃO DE AÇÕES
// ----------------------------------------------------------------

/**
 * Executa a ação selecionada no menu.
 * @param {string} action
 */
function executeAction(action) {
    switch (action) {
        case 'delete-vertex':
            // Seleciona o vértice que foi clicado com botão direito, depois deleta
            if (clickTarget?.type === 'vertex' && clickTarget.handle) {
                selectVertexByIndex(clickTarget.vertexIndex, clickTarget.handle);
            }
            deleteSelectedVertex();
            break;

        case 'insert-vertex':
            if (clickTarget?.afterIndex !== undefined) {
                insertVertexAtMidpoint(clickTarget.afterIndex);
            }
            break;

        case 'add-vertex-here':
            if (clickTarget?.worldPos) {
                addVertexAtPosition(clickTarget.worldPos);
            }
            break;

        case 'toggle-draw':
            toggleDrawMode();
            break;

        case 'reset-shape':
            resetShape();
            break;

        case 'done':
            exitEditMode();
            break;
    }
}
