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
   DRAG CONTROLLER — Mouse interaction for vertex handle dragging
   ================================================================

   Intercepta eventos de mouse no canvas para arrastar handles.
   Usa capture-phase listeners para ter prioridade sobre o picker.

   FLUXO:
   1. mousedown: raycast contra handles → se acertou, inicia drag
   2. mousemove: projeta mouse no plano de drag → move handle
   3. mouseup: finaliza drag, reabilita OrbitControls

   O plano de drag é perpendicular à direção da câmera,
   passando pela posição original do handle. Isso permite
   arrastar em 3D de forma intuitiva.

   ================================================================ */

import * as THREE from 'three';
import { getCamera, getControls, getRenderer } from '../scene/setup.js';
import { getEditHandlesGroup } from '../scene/setup.js';
import { setCursorEnabled } from '../scene/cursorProjector.js';
import { updateHandleScales } from './handleFactory.js';
import { isGizmoActive } from './gizmoController.js';
import { isSnapEnabled, snapToGrid, snapToAxis } from './snapEngine.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

let container = null;
let raycaster = null;
const mouse = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const intersection = new THREE.Vector3();

let isDragging = false;
let activeHandle = null;
const dragStartPos = new THREE.Vector3();
const mouseDownScreenPos = { x: 0, y: 0 };

// Pooled temporaries — evita alocacao por frame
const _cameraDir = new THREE.Vector3();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _tempVec3 = new THREE.Vector3();

// Callbacks
let onDragStart = null; // (handle) => void
let onDragMove = null; // (handle, newPosition: Vector3) => void
let onDragEnd = null; // (handle) => void
let onClick = null; // (handle) => void
let onCanvasClick = null; // (position: Vector3) => void — click on empty space (draw mode)

// Throttle
let lastMoveTime = 0;
const MOVE_INTERVAL = 16; // ~60fps
const DRAG_THRESHOLD = 5; // px — distinguir clique de arrasto

// ----------------------------------------------------------------
// INICIALIZAÇÃO
// ----------------------------------------------------------------

/**
 * Inicializa o drag controller.
 * Registra listeners de capture-phase no canvas.
 *
 * @param {HTMLElement} canvasContainer - Container do canvas (#canvas-container)
 * @param {Object} callbacks
 * @param {Function} callbacks.onDragStart - Chamado ao iniciar arrasto de handle
 * @param {Function} callbacks.onDragMove - Chamado a cada mousemove durante arrasto
 * @param {Function} callbacks.onDragEnd - Chamado ao finalizar arrasto
 * @param {Function} callbacks.onClick - Chamado ao clicar (sem arrastar) em handle
 * @param {Function} callbacks.onCanvasClick - Chamado ao clicar no vazio (draw mode)
 */
export function initDragController(canvasContainer, callbacks = {}) {
    container = canvasContainer;
    raycaster = new THREE.Raycaster();

    onDragStart = callbacks.onDragStart || null;
    onDragMove = callbacks.onDragMove || null;
    onDragEnd = callbacks.onDragEnd || null;
    onClick = callbacks.onClick || null;
    onCanvasClick = callbacks.onCanvasClick || null;

    // Capture phase: executa ANTES dos listeners normais (picker.js)
    container.addEventListener('mousedown', handleMouseDown, { capture: true });
    container.addEventListener('mousemove', handleMouseMove, { capture: true });
    container.addEventListener('mouseup', handleMouseUp, { capture: true });
}

// ----------------------------------------------------------------
// HANDLERS
// ----------------------------------------------------------------

/**
 * mousedown: testa se clicou em handle.
 * Se sim, inicia drag e bloqueia OrbitControls.
 */
function handleMouseDown(event) {
    // Só botão esquerdo (0) inicia arrasto — ignora direito (2) e meio (1)
    if (event.button !== 0) return;

    // Gizmo ativo: TransformControls gerencia seus proprios eventos
    if (isGizmoActive()) return;

    const handleGroup = getEditHandlesGroup();
    if (!handleGroup || handleGroup.children.length === 0) return;

    updateMouseCoords(event);
    mouseDownScreenPos.x = event.clientX;
    mouseDownScreenPos.y = event.clientY;

    const camera = getCamera();
    if (!camera) return;

    raycaster.setFromCamera(mouse, camera);

    // Atualiza escala dos handles antes do raycast
    updateHandleScales(handleGroup);

    const intersects = raycaster.intersectObjects(handleGroup.children, false);

    if (intersects.length > 0) {
        activeHandle = intersects[0].object;
        dragStartPos.copy(activeHandle.position);

        // Cria plano de drag perpendicular à câmera, na posição do handle
        camera.getWorldDirection(_cameraDir);
        dragPlane.setFromNormalAndCoplanarPoint(_cameraDir.negate(), activeHandle.position);

        isDragging = false; // Será true no primeiro mousemove com threshold

        // Bloqueia OrbitControls e propagação
        const controls = getControls();
        if (controls) controls.enabled = false;

        event.stopPropagation();
        event.preventDefault();
    }
}

/**
 * mousemove: se arrastando handle, projeta nova posição.
 */
function handleMouseMove(event) {
    if (isGizmoActive()) return;
    if (!activeHandle) return;

    // Throttle para 60fps
    const now = Date.now();
    if (now - lastMoveTime < MOVE_INTERVAL) return;
    lastMoveTime = now;

    // Verifica threshold para distinguir clique de arrasto
    const dx = Math.abs(event.clientX - mouseDownScreenPos.x);
    const dy = Math.abs(event.clientY - mouseDownScreenPos.y);

    if (!isDragging && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
        isDragging = true;
        setCursorEnabled(false);
        if (onDragStart) onDragStart(activeHandle);
    }

    if (!isDragging) return;

    updateMouseCoords(event);
    const camera = getCamera();
    if (!camera) return;

    raycaster.setFromCamera(mouse, camera);

    // Projeta raio no plano de drag
    if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
        // Snap-to-axis (Shift) e snap-to-grid
        if (event.shiftKey) {
            snapToAxis(intersection, dragStartPos);
        }
        if (isSnapEnabled()) {
            snapToGrid(intersection);
        }
        if (onDragMove) onDragMove(activeHandle, intersection);
    }

    event.stopPropagation();
    event.preventDefault();
}

/**
 * mouseup: finaliza drag ou processa clique.
 */
function handleMouseUp(event) {
    if (event.button !== 0) return;
    if (isGizmoActive()) return;

    if (!activeHandle) {
        // Verifica se foi clique no vazio (para draw mode)
        if (onCanvasClick) {
            const dx = Math.abs(event.clientX - mouseDownScreenPos.x);
            const dy = Math.abs(event.clientY - mouseDownScreenPos.y);
            if (dx <= DRAG_THRESHOLD && dy <= DRAG_THRESHOLD) {
                const camera = getCamera();
                if (camera) {
                    updateMouseCoords(event);
                    raycaster.setFromCamera(mouse, camera);

                    // Projeta no plano XZ (y=0) por padrão
                    _groundPlane.set(_groundPlane.normal.set(0, 1, 0), 0);
                    if (raycaster.ray.intersectPlane(_groundPlane, _tempVec3)) {
                        onCanvasClick(_tempVec3.clone());
                    }
                }
            }
        }
        return;
    }

    // Reabilita OrbitControls
    const controls = getControls();
    if (controls) controls.enabled = true;

    if (isDragging) {
        // Fim de arrasto
        if (onDragEnd) onDragEnd(activeHandle);
        event.stopPropagation();
        event.preventDefault();
    } else {
        // Foi clique (sem arrastar) — seleciona/deseleciona handle
        if (onClick) onClick(activeHandle);
        event.stopPropagation();
        event.preventDefault();
    }

    if (isDragging) setCursorEnabled(true);
    isDragging = false;
    activeHandle = null;
}

// ----------------------------------------------------------------
// COORDENADAS
// ----------------------------------------------------------------

/**
 * Converte posição do mouse para coordenadas NDC (-1 a 1).
 */
function updateMouseCoords(event) {
    const renderer = getRenderer();
    if (!renderer) return;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

// ----------------------------------------------------------------
// ESTADO PÚBLICO
// ----------------------------------------------------------------

/**
 * @returns {boolean} Se está arrastando um handle
 */
export function isDragActive() {
    return isDragging;
}

// ----------------------------------------------------------------
// LIMPEZA
// ----------------------------------------------------------------

/**
 * Remove listeners e limpa estado.
 */
export function destroyDragController() {
    if (container) {
        container.removeEventListener('mousedown', handleMouseDown, { capture: true });
        container.removeEventListener('mousemove', handleMouseMove, { capture: true });
        container.removeEventListener('mouseup', handleMouseUp, { capture: true });
    }

    isDragging = false;
    activeHandle = null;
    container = null;
    raycaster = null;
    onDragStart = null;
    onDragMove = null;
    onDragEnd = null;
    onClick = null;
    onCanvasClick = null;
}
