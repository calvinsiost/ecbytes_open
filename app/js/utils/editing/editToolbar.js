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
   EDIT TOOLBAR — Ribbon tab + floating indicator for shape editing
   ================================================================

   Quando o shape editor é ativado:
   1. Mostra a aba "Edit" na ribbon e muda para ela
   2. Mostra um indicador flutuante no canvas (nome do elemento + dica)
   3. Atualiza contagem de vértices na ribbon

   A ribbon Edit contém: Add Vertices, Delete Vertex, Reset Shape, Done.
   O indicador flutuante é mínimo (só nome + status).

   ================================================================ */

import { t } from '../i18n/translations.js';
import { switchRibbonTab } from '../ui/ribbon.js';
import { hydrateIcons } from '../ui/icons.js';
import { isSnapEnabled, getGridSize } from './snapEngine.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

let floatingIndicator = null;
let previousRibbonTab = null;
let callbacks = {};

// ----------------------------------------------------------------
// MOSTRAR / ATUALIZAR / ESCONDER
// ----------------------------------------------------------------

/**
 * Mostra a aba Edit na ribbon e o indicador flutuante.
 *
 * @param {Object} opts
 * @param {Function} opts.onDone - Callback ao clicar "Done"
 * @param {Function} opts.onDraw - Callback ao clicar "Draw" (toggle)
 * @param {Function} opts.onDelete - Callback ao clicar "Delete Vertex"
 * @param {number} opts.vertexCount - Contagem de vértices
 * @param {boolean} opts.drawSupported - Se draw mode é suportado
 * @param {string} [opts.elementName] - Nome do elemento sendo editado
 */
export function showEditToolbar(opts = {}) {
    callbacks = opts;
    hideEditToolbar();

    // 1. Salva a aba ribbon ativa atual
    const activeItem = document.querySelector('#menubar .menu-item.active');
    previousRibbonTab = activeItem?.dataset?.ribbon || 'home';

    // 2. Mostra a aba Edit na ribbon
    const editTab = document.getElementById('menu-edit-tab');
    if (editTab) {
        editTab.style.display = '';
    }

    // 3. Muda para a aba Edit
    switchRibbonTab('edit');

    // 4. Atualiza info na ribbon
    _updateRibbonInfo(opts);

    // 5. Cria indicador flutuante mínimo no canvas
    floatingIndicator = document.createElement('div');
    floatingIndicator.className = 'edit-toolbar';
    floatingIndicator.innerHTML = `
        <span class="edit-toolbar-label">${t('editingShape') || 'Editing Shape'}</span>
        <span class="edit-toolbar-count" id="edit-vertex-count">${opts.vertexCount || 0} ${t('vertices') || 'vertices'}</span>
    `;

    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) {
        canvasContainer.appendChild(floatingIndicator);
    }

    // 6. Mostra/oculta grupos de gizmo vs shape edit na ribbon
    _updateModeGroups(opts);

    // 7. Sincroniza estado do snap na ribbon
    _syncSnapUI();

    // 8. Mostra painel de coordenadas em gizmo mode
    const coordsGroup = document.getElementById('edit-ribbon-coords-group');
    if (coordsGroup) {
        coordsGroup.style.display = opts.gizmoMode ? '' : 'none';
    }

    // 9. Hydrate ribbon icons
    hydrateIcons();
}

/**
 * Atualiza toolbar (contagem de vértices, draw mode).
 */
export function updateEditToolbar(opts = {}) {
    // Atualiza indicador flutuante
    if (floatingIndicator) {
        const countEl = floatingIndicator.querySelector('#edit-vertex-count');
        if (countEl && opts.vertexCount !== undefined) {
            countEl.textContent = `${opts.vertexCount} ${t('vertices') || 'vertices'}`;
        }
    }

    // Atualiza ribbon info
    _updateRibbonInfo(opts);
}

/**
 * Esconde tudo: remove indicador flutuante, esconde aba Edit, volta à ribbon anterior.
 */
export function hideEditToolbar() {
    // Remove indicador flutuante
    if (floatingIndicator) {
        floatingIndicator.remove();
        floatingIndicator = null;
    }

    // Esconde aba Edit na ribbon
    const editTab = document.getElementById('menu-edit-tab');
    if (editTab) {
        editTab.style.display = 'none';
    }

    // Volta à ribbon anterior
    if (previousRibbonTab) {
        switchRibbonTab(previousRibbonTab);
        previousRibbonTab = null;
    }

    callbacks = {};
}

// ----------------------------------------------------------------
// HELPERS INTERNOS
// ----------------------------------------------------------------

/**
 * Atualiza informações na ribbon Edit.
 * @private
 */
function _updateRibbonInfo(opts = {}) {
    // Contagem de vértices na ribbon
    const ribbonCount = document.getElementById('edit-ribbon-vertex-count');
    if (ribbonCount && opts.vertexCount !== undefined) {
        ribbonCount.textContent = `${opts.vertexCount} ${t('vertices') || 'vertices'}`;
    }

    // Nome do elemento na ribbon
    const ribbonName = document.getElementById('edit-ribbon-element-name');
    if (ribbonName && opts.elementName) {
        ribbonName.textContent = opts.elementName;
    }

    // Toggle draw button ativo
    const drawBtn = document.getElementById('edit-ribbon-draw-btn');
    if (drawBtn) {
        drawBtn.classList.toggle('active', !!opts.drawActive);

        // Esconde botão se draw não é suportado
        if (opts.drawSupported === false) {
            drawBtn.style.display = 'none';
        } else {
            drawBtn.style.display = '';
        }
    }
}

/**
 * Mostra/oculta grupos na ribbon conforme o modo (gizmo vs shape edit).
 * @private
 */
function _updateModeGroups(opts = {}) {
    const gizmoGroup = document.getElementById('edit-ribbon-gizmo-group');
    const toggleGroup = document.getElementById('edit-ribbon-toggle-group');
    const vertexGroup = document.querySelector('#ribbon-edit .toolbar-group:nth-child(2)'); // Vertices group

    if (opts.gizmoMode) {
        // Modo gizmo: mostra gizmo controls, oculta vertex controls
        if (gizmoGroup) gizmoGroup.style.display = '';
        if (vertexGroup) vertexGroup.style.display = 'none';
        // Highlight translate por default
        const translateBtn = document.getElementById('edit-ribbon-gizmo-translate');
        if (translateBtn) translateBtn.classList.add('active');
    } else {
        // Modo shape edit: oculta gizmo controls, mostra vertex controls
        if (gizmoGroup) gizmoGroup.style.display = 'none';
        if (vertexGroup) vertexGroup.style.display = '';
    }

    // Toggle button (G) — mostra se elemento suporta ambos os modos
    if (toggleGroup) {
        toggleGroup.style.display = opts.canToggleShapeEdit ? '' : 'none';
        const label = document.getElementById('edit-ribbon-toggle-label');
        if (label) label.textContent = opts.gizmoMode ? 'Shape Edit' : 'Gizmo';
    }
}

/**
 * Sincroniza UI de snap com o estado atual do snapEngine.
 * @private
 */
function _syncSnapUI() {
    const snapBtn = document.getElementById('edit-ribbon-snap-btn');
    if (snapBtn) snapBtn.classList.toggle('active', isSnapEnabled());

    const gridSelect = document.getElementById('edit-ribbon-grid-select');
    if (gridSelect) gridSelect.value = String(getGridSize());
}
