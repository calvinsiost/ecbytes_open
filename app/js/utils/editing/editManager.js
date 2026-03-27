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
   EDIT MANAGER — State machine for shape editing + gizmo transform
   ================================================================

   Gerencia o estado do editor de formas:
   - Qual elemento está sendo editado
   - Qual modo está ativo (idle, edit, draw, gizmo)
   - Qual estratégia (polygon, path, ellipsoid, etc.) está em uso

   MÁQUINA DE ESTADOS:
   IDLE ──[enterEditMode]──► EDITING ──[toggleDrawMode]──► DRAWING
     │         ▲                 │                             │
     │         └─────────────────┘◄────[exitEditMode]──────────┘
     │         ▲                 │
     │    [G toggle]        [G toggle]
     │         │                 │
     └──[enterGizmoMode]──► GIZMO ──[exitGizmoMode]──► IDLE

   ================================================================ */

import { getEditHandlesGroup } from '../scene/setup.js';
import { getElementById, getMeshByElementId } from '../../core/elements/manager.js';
import { disposeHandles, selectHandle, deselectHandle } from './handleFactory.js';
import { initDragController, destroyDragController } from './dragController.js';
import { showEditToolbar, hideEditToolbar, updateEditToolbar } from './editToolbar.js';
import { pushSnapshot } from '../history/manager.js';
import {
    attachGizmo,
    detachGizmo,
    isGizmoActive,
    setGizmoMode,
    getGizmoMode,
    toggleGizmoSpace,
    getGizmoPosition,
} from './gizmoController.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

let editingElementId = null;
let editMode = 'idle'; // 'idle' | 'edit' | 'draw' | 'gizmo'
let activeStrategy = null;
let selectedVertexIndex = -1;
let selectedHandle = null;
let container = null;

// Estratégias registradas: familyId → StrategyConstructor
const strategyRegistry = new Map();

// ----------------------------------------------------------------
// REGISTRO DE ESTRATÉGIAS
// ----------------------------------------------------------------

/**
 * Registra uma estratégia de edição para uma família.
 *
 * @param {string} familyId - ID da família (ex: 'boundary', 'river')
 * @param {Function} StrategyClass - Construtor da estratégia
 */
export function registerStrategy(familyId, StrategyClass) {
    strategyRegistry.set(familyId, StrategyClass);
}

/**
 * Verifica se uma família tem estratégia de edição.
 * @param {string} familyId
 * @returns {boolean}
 */
export function hasStrategy(familyId) {
    return strategyRegistry.has(familyId);
}

// ----------------------------------------------------------------
// INICIALIZAÇÃO
// ----------------------------------------------------------------

/**
 * Inicializa o editor de formas.
 * Configura o drag controller e os listeners.
 *
 * @param {HTMLElement} canvasContainer - Container do canvas
 */
export function initEditor(canvasContainer) {
    container = canvasContainer;

    initDragController(canvasContainer, {
        onDragStart: handleDragStart,
        onDragMove: handleDragMove,
        onDragEnd: handleDragEnd,
        onClick: handleHandleClick,
        onCanvasClick: handleCanvasClick,
    });
}

// ----------------------------------------------------------------
// ENTRAR/SAIR DO MODO DE EDIÇÃO
// ----------------------------------------------------------------

/**
 * Entra no modo de edição para um elemento.
 * Cria handles de vértice e mostra toolbar.
 *
 * @param {string} elementId - ID do elemento a editar
 * @returns {boolean} true se entrou com sucesso
 */
export function enterEditMode(elementId) {
    if (!elementId) return false;

    const element = getElementById(elementId);
    if (!element) return false;

    // Verifica se tem estratégia para esta família
    const StrategyClass = strategyRegistry.get(element.family);
    if (!StrategyClass) return false;

    // Sai do modo atual se estiver editando outro
    if (editingElementId && editingElementId !== elementId) {
        exitEditMode();
    }

    const handleGroup = getEditHandlesGroup();
    if (!handleGroup) return false;

    const mesh = getMeshByElementId(elementId);
    if (!mesh) return false;

    // Instancia estratégia
    editingElementId = elementId;
    editMode = 'edit';
    selectedVertexIndex = -1;
    selectedHandle = null;

    activeStrategy = new StrategyClass(element, handleGroup, mesh);
    activeStrategy.createHandles();

    // UI — mostra aba Edit na ribbon + indicador flutuante
    showEditToolbar({
        onDone: () => exitEditMode(),
        onDraw: () => toggleDrawMode(),
        onDelete: () => deleteSelectedVertex(),
        vertexCount: activeStrategy.getVertexCount?.() || 0,
        drawSupported: activeStrategy.supportsDrawMode?.() || false,
        elementName: element.name || element.id,
    });

    if (container) container.style.cursor = 'crosshair';

    window.dispatchEvent(
        new CustomEvent('shapeEditChanged', {
            detail: { editing: true, elementId },
        }),
    );

    return true;
}

/**
 * Sai do modo de edição.
 * Remove handles, esconde toolbar, restaura estado.
 */
export function exitEditMode() {
    if (editMode === 'idle') return;

    const handleGroup = getEditHandlesGroup();
    if (handleGroup) disposeHandles(handleGroup);

    if (activeStrategy) {
        activeStrategy.dispose?.();
        activeStrategy = null;
    }

    const prevId = editingElementId;
    editingElementId = null;
    editMode = 'idle';
    selectedVertexIndex = -1;
    selectedHandle = null;

    hideEditToolbar();
    if (container) container.style.cursor = 'default';

    window.dispatchEvent(
        new CustomEvent('shapeEditChanged', {
            detail: { editing: false, elementId: prevId },
        }),
    );
}

/**
 * Alterna modo de desenho (draw mode).
 * No draw mode, clicar no viewport adiciona vértices.
 */
export function toggleDrawMode() {
    if (editMode === 'idle') return;

    if (editMode === 'draw') {
        editMode = 'edit';
    } else {
        editMode = 'draw';
        // Deseleciona vértice ao entrar em draw mode
        if (selectedHandle) {
            deselectHandle(selectedHandle);
            selectedHandle = null;
            selectedVertexIndex = -1;
        }
    }

    updateEditToolbar({
        drawActive: editMode === 'draw',
        vertexCount: activeStrategy?.getVertexCount?.() || 0,
    });
}

// ----------------------------------------------------------------
// CALLBACKS DO DRAG CONTROLLER
// ----------------------------------------------------------------

function handleDragStart(handle) {
    // Deseleciona handle anterior
    if (selectedHandle && selectedHandle !== handle) {
        deselectHandle(selectedHandle);
    }
    selectedHandle = null;
    selectedVertexIndex = -1;
}

function handleDragMove(handle, newPosition) {
    if (!activeStrategy) return;

    const type = handle.userData.handleType;

    if (type === 'vertex') {
        activeStrategy.onVertexMove(handle.userData.vertexIndex, newPosition);
        handle.position.copy(newPosition);
        // Atualiza midpoints se a estratégia suportar
        activeStrategy.updateMidpoints?.();
    } else if (type === 'axis') {
        activeStrategy.onAxisMove?.(handle.userData.axisName, handle.userData.direction, newPosition);
        handle.position.copy(newPosition);
    } else if (type === 'midpoint') {
        // Midpoints podem ser arrastados para adicionar vértice e mover imediatamente
        const afterIndex = handle.userData.afterIndex;
        activeStrategy.onMidpointDrag?.(afterIndex, newPosition);
    }
}

function handleDragEnd(handle) {
    if (!activeStrategy) return;

    activeStrategy.onEditComplete?.();
    pushSnapshot();

    // Atualiza toolbar com contagem de vértices
    updateEditToolbar({
        vertexCount: activeStrategy.getVertexCount?.() || 0,
        drawActive: editMode === 'draw',
    });
}

function handleHandleClick(handle) {
    if (!activeStrategy) return;

    const type = handle.userData.handleType;

    if (type === 'midpoint') {
        // Clique em midpoint → inserir vértice
        const afterIndex = handle.userData.afterIndex;
        activeStrategy.onMidpointClick(afterIndex);
        pushSnapshot();

        updateEditToolbar({
            vertexCount: activeStrategy.getVertexCount?.() || 0,
            drawActive: editMode === 'draw',
        });
    } else if (type === 'vertex') {
        // Seleciona/deseleciona vértice
        if (selectedHandle) deselectHandle(selectedHandle);

        if (selectedVertexIndex === handle.userData.vertexIndex) {
            // Toggle off
            selectedVertexIndex = -1;
            selectedHandle = null;
        } else {
            selectedVertexIndex = handle.userData.vertexIndex;
            selectedHandle = handle;
            selectHandle(handle);
        }
    }
}

function handleCanvasClick(position) {
    if (editMode !== 'draw' || !activeStrategy) return;

    activeStrategy.onDrawPoint(position);
    pushSnapshot();

    updateEditToolbar({
        vertexCount: activeStrategy.getVertexCount?.() || 0,
        drawActive: true,
    });
}

// ----------------------------------------------------------------
// OPERAÇÕES PÚBLICAS
// ----------------------------------------------------------------

/**
 * Deleta o vértice atualmente selecionado.
 * Chamado pela ribbon Edit e pelo atalho Delete.
 */
export function deleteSelectedVertex() {
    if (selectedVertexIndex < 0 || !activeStrategy) return;

    const deleted = activeStrategy.onVertexDelete(selectedVertexIndex);
    if (deleted) {
        selectedVertexIndex = -1;
        if (selectedHandle) {
            deselectHandle(selectedHandle);
            selectedHandle = null;
        }
        pushSnapshot();

        updateEditToolbar({
            vertexCount: activeStrategy.getVertexCount?.() || 0,
            drawActive: editMode === 'draw',
        });
    }
}

/**
 * Reseta a forma do elemento para o padrão da família.
 * Sai do edit mode e recria o mesh do zero.
 */
export function resetShape() {
    if (!editingElementId || !activeStrategy) return;

    const element = getElementById(editingElementId);
    if (!element) return;

    // Restaura dados padrão baseado na família
    if (element.family === 'boundary') {
        element.data.vertices = [
            { x: -30, z: -30 },
            { x: 30, z: -30 },
            { x: 30, z: 30 },
            { x: -30, z: 30 },
        ];
    } else if (element.family === 'river') {
        element.data.path = [
            { x: -20, y: 0, z: 0 },
            { x: 20, y: 0, z: 0 },
        ];
    } else if (element.family === 'plume') {
        element.data.shape = { radiusX: 10, radiusY: 8, radiusZ: 4 };
    } else if (element.family === 'lake') {
        element.data.shape = { radiusX: 10, radiusY: 8 };
    } else if (element.family === 'building') {
        const pos = element.data.position || { x: 0, y: 0, z: 0 };
        const px = pos.x || 0;
        const pz = pos.z || 0;
        delete element.data.footprint;
        element.data.vertices = [
            { x: px - 5, z: pz - 5 },
            { x: px + 5, z: pz - 5 },
            { x: px + 5, z: pz + 5 },
            { x: px - 5, z: pz + 5 },
        ];
        element.data.height = 5;
    } else if (element.family === 'tank') {
        element.data.dimensions = { diameter: 3, length: 6 };
    }

    // Re-entra no edit mode para recriar handles e mesh
    const id = element.id;
    exitEditMode();
    pushSnapshot();
    enterEditMode(id);
}

// ----------------------------------------------------------------
// GIZMO MODE — translate/rotate/scale do elemento inteiro
// ----------------------------------------------------------------

/**
 * Entra no modo gizmo para um elemento.
 * Vincula TransformControls ao mesh selecionado.
 *
 * @param {string} elementId - ID do elemento
 * @returns {boolean} true se entrou com sucesso
 */
export function enterGizmoMode(elementId) {
    if (!elementId) return false;

    const element = getElementById(elementId);
    if (!element) return false;

    // Sai do modo atual se ativo
    if (editMode !== 'idle') {
        if (editMode === 'gizmo') exitGizmoMode();
        else exitEditMode();
    }

    const mesh = getMeshByElementId(elementId);
    if (!mesh) return false;

    editingElementId = elementId;
    editMode = 'gizmo';

    attachGizmo(elementId, mesh);

    // UI — mostra toolbar de gizmo
    const hasStrategy = strategyRegistry.has(element.family);
    showEditToolbar({
        onDone: () => exitGizmoMode(),
        vertexCount: 0,
        drawSupported: false,
        elementName: element.name || element.id,
        gizmoMode: true,
        canToggleShapeEdit: hasStrategy,
    });

    if (container) container.style.cursor = 'move';

    window.dispatchEvent(
        new CustomEvent('shapeEditChanged', {
            detail: { editing: true, gizmo: true, elementId },
        }),
    );

    return true;
}

/**
 * Sai do modo gizmo.
 */
export function exitGizmoMode() {
    if (editMode !== 'gizmo') return;

    detachGizmo();

    const prevId = editingElementId;
    editingElementId = null;
    editMode = 'idle';

    hideEditToolbar();
    if (container) container.style.cursor = 'default';

    window.dispatchEvent(
        new CustomEvent('shapeEditChanged', {
            detail: { editing: false, gizmo: false, elementId: prevId },
        }),
    );
}

/**
 * Alterna entre gizmo mode e shape edit mode.
 * So funciona se o elemento tem strategy registrada.
 */
export function toggleGizmoShapeEdit() {
    if (!editingElementId) return;

    const element = getElementById(editingElementId);
    if (!element) return;

    if (editMode === 'gizmo') {
        // Gizmo → Shape edit (se tem strategy)
        if (strategyRegistry.has(element.family)) {
            const id = editingElementId;
            exitGizmoMode();
            enterEditMode(id);
        }
    } else if (editMode === 'edit' || editMode === 'draw') {
        // Shape edit → Gizmo
        const id = editingElementId;
        exitEditMode();
        enterGizmoMode(id);
    }
}

// ----------------------------------------------------------------
// GETTERS PÚBLICOS
// ----------------------------------------------------------------

/** @returns {boolean} Se está em modo de edição (qualquer modo) */
export function isEditing() {
    return editMode !== 'idle';
}

/** @returns {string|null} ID do elemento sendo editado */
export function getEditingElementId() {
    return editingElementId;
}

/** @returns {string} Modo atual: 'idle' | 'edit' | 'draw' | 'gizmo' */
export function getEditMode() {
    return editMode;
}

/** @returns {number} Índice do vértice selecionado (-1 se nenhum) */
export function getSelectedVertexIndex() {
    return selectedVertexIndex;
}

/**
 * Retorna posição do handle/vértice selecionado.
 * @returns {{x: number, y: number, z: number}|null}
 */
export function getSelectedHandlePosition() {
    if (editMode === 'gizmo') {
        const pos = getGizmoPosition();
        return pos ? { x: pos.x, y: pos.y, z: pos.z } : null;
    }
    if (selectedHandle) {
        return {
            x: selectedHandle.position.x,
            y: selectedHandle.position.y,
            z: selectedHandle.position.z,
        };
    }
    return null;
}

// ----------------------------------------------------------------
// AÇÕES PARA MENU DE CONTEXTO
// ----------------------------------------------------------------

/**
 * Insere vértice na posição do ponto médio (midpoint).
 * Chamado pelo menu de contexto ao clicar com botão direito num midpoint.
 *
 * @param {number} afterIndex - Índice do vértice anterior
 */
export function insertVertexAtMidpoint(afterIndex) {
    if (!activeStrategy) return;
    activeStrategy.onMidpointClick(afterIndex);
    pushSnapshot();
    updateEditToolbar({
        vertexCount: activeStrategy?.getVertexCount?.() || 0,
        drawActive: editMode === 'draw',
    });
}

/**
 * Adiciona vértice em posição específica no viewport.
 * Chamado pelo menu de contexto no modo draw.
 *
 * @param {THREE.Vector3} position - Posição 3D no mundo
 */
export function addVertexAtPosition(position) {
    if (!activeStrategy) return;
    activeStrategy.onDrawPoint(position);
    pushSnapshot();
    updateEditToolbar({
        vertexCount: activeStrategy?.getVertexCount?.() || 0,
        drawActive: editMode === 'draw',
    });
}

/**
 * Seleciona um vértice por índice e destaca o handle.
 * Chamado pelo menu de contexto ao clicar com botão direito num vértice.
 *
 * @param {number} index - Índice do vértice
 * @param {THREE.Mesh} handle - Mesh do handle a destacar
 */
export function selectVertexByIndex(index, handle) {
    if (selectedHandle) deselectHandle(selectedHandle);
    selectedVertexIndex = index;
    selectedHandle = handle;
    selectHandle(handle);
}

// ----------------------------------------------------------------
// LIMPEZA
// ----------------------------------------------------------------

/**
 * Destrói o editor completamente.
 */
export function destroyEditor() {
    exitEditMode();
    destroyDragController();
    container = null;
    strategyRegistry.clear();
}
