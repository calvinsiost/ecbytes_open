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
   SELETOR 3D (SCENE PICKER)
   ================================================================

   Permite clicar em objetos 3D na cena para seleciona-los.
   Usa raycasting — um "raio" invisivel que sai da camera ate o
   ponto clicado na tela e detecta quais objetos 3D cruza.

   FUNCIONALIDADES:
   - Clicar em elemento 3D seleciona no painel lateral
   - Destaque visual (brilho azul) no elemento selecionado
   - Cursor muda para "pointer" ao passar sobre elementos
   - Clicar no vazio deseleciona o elemento atual

   ================================================================ */

import * as THREE from 'three';
import { getCamera, getElementsGroup, getRenderer, getVoxelGroup, getIssuesGroup, requestRender } from './setup.js';
import { getInterpolationGroup } from '../../core/interpolation/manager.js';
import { isVoxelEditing } from '../../core/voxel/editController.js';
import { isEditing, getEditMode } from '../editing/editManager.js';
import { getMeshByElementId } from '../../core/elements/manager.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

let raycaster = null;
const mouse = new THREE.Vector2();
let container = null;
let onSelectCallback = null;
let onDeselectCallback = null;
let onSelectLayerCallback = null;

// Highlight state
let highlightedMesh = null;
let originalEmissive = null;
let originalEmissiveIntensity = 0;

// Hover highlight (separado da selecao)
let _hoveredElementId = null;
let _selectedHighlightMesh = null;

// Drag detection — evita selecionar ao orbitar
const mouseDownPos = { x: 0, y: 0 };
let isDrag = false;
const DRAG_THRESHOLD = 5; // px

// Hover throttle
let lastHoverTime = 0;
const HOVER_INTERVAL = 50; // ms

// ----------------------------------------------------------------
// INICIALIZACAO
// ----------------------------------------------------------------

/**
 * Inicializa o seletor 3D.
 * Adiciona listeners de clique e movimento no container do canvas.
 *
 * @param {HTMLElement} canvasContainer - Container do canvas Three.js (#canvas-container)
 * @param {Object} callbacks - Callbacks de selecao
 * @param {Function} callbacks.onSelect - Chamado com elementId ao selecionar
 * @param {Function} callbacks.onDeselect - Chamado ao deselecionar
 */
export function initPicker(canvasContainer, callbacks = {}) {
    if (!canvasContainer) {
        console.warn('[Picker] Canvas container not found');
        return;
    }

    container = canvasContainer;
    raycaster = new THREE.Raycaster();
    onSelectCallback = callbacks.onSelect || null;
    onDeselectCallback = callbacks.onDeselect || null;
    onSelectLayerCallback = callbacks.onSelectLayer || null;

    container.addEventListener('mousedown', onCanvasMouseDown);
    container.addEventListener('mouseup', onCanvasMouseUp);
    container.addEventListener('mousemove', onCanvasHover);
}

// ----------------------------------------------------------------
// HANDLERS
// ----------------------------------------------------------------

/**
 * Registra posicao do mousedown para detectar drag.
 */
function onCanvasMouseDown(event) {
    if (event.button !== 0) return;
    mouseDownPos.x = event.clientX;
    mouseDownPos.y = event.clientY;
    isDrag = false;
}

/**
 * Handler de mouseup no canvas.
 * So seleciona se o mouse nao se moveu muito (nao foi drag/orbit).
 */
function onCanvasMouseUp(event) {
    if (event.button !== 0) return;
    // Voxel edit mode intercepta clicks via capture-phase
    if (isVoxelEditing()) return;
    // RED-C1: Shape editing (edit/draw) takes priority — but gizmo mode allows re-selection
    if (isEditing() && getEditMode() !== 'gizmo') return;
    // Detectar se foi drag
    const dx = Math.abs(event.clientX - mouseDownPos.x);
    const dy = Math.abs(event.clientY - mouseDownPos.y);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) return;

    const camera = getCamera();
    const elementsGroup = getElementsGroup();
    if (!camera || !elementsGroup) return;

    updateMouseCoords(event);

    raycaster.setFromCamera(mouse, camera);

    // Shift+click: issue creation gesture (ADR issues #4)
    if (event.shiftKey) {
        const issuesGroup = getIssuesGroup();
        const targets = [...elementsGroup.children];
        // Raycast against elements + ground (y=0 plane)
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersects = raycaster.intersectObjects(targets, true);
        let point,
            elementId = null;
        if (intersects.length > 0) {
            point = intersects[0].point;
            elementId = findElementId(intersects[0].object);
        } else {
            // Fallback: intersect ground plane
            point = new THREE.Vector3();
            raycaster.ray.intersectPlane(groundPlane, point);
        }
        if (point && window.handleCreateIssueAtPosition) {
            window.handleCreateIssueAtPosition({ x: point.x, y: point.y, z: point.z }, elementId);
        }
        return; // Consume event — no element selection
    }

    const intersects = raycaster.intersectObjects(elementsGroup.children, true);

    if (intersects.length > 0) {
        // Encontrar elemento pai com userData.elementId
        const elementId = findElementId(intersects[0].object);
        if (elementId) {
            // Aplica highlight de selecao e preserva referencia
            const mesh = getMeshByElementId(elementId);
            if (mesh) highlightMesh(mesh);
            _selectedHighlightMesh = highlightedMesh;
            if (onSelectCallback) {
                onSelectCallback(elementId);
            }
            return;
        }
    }

    // Tenta layers de interpolação
    const interpGroup = getInterpolationGroup();
    if (interpGroup && interpGroup.children.length > 0) {
        const layerHits = raycaster.intersectObjects(interpGroup.children, true);
        if (layerHits.length > 0) {
            const layerId = findLayerId(layerHits[0].object);
            if (layerId && onSelectLayerCallback) {
                onSelectLayerCallback(layerId);
                return;
            }
        }
    }

    // Tenta volumes voxelizados
    const voxelGroup = getVoxelGroup();
    if (voxelGroup && voxelGroup.children.length > 0) {
        const voxelHits = raycaster.intersectObjects(voxelGroup.children, false);
        if (voxelHits.length > 0) {
            const volumeId = voxelHits[0].object.userData?.volumeId;
            if (volumeId && window.handleSelectVolume) {
                window.handleSelectVolume(volumeId);
                return;
            }
        }
    }

    // Clicou no vazio — deselecionar
    if (onDeselectCallback) {
        onDeselectCallback();
    }
    _selectedHighlightMesh = null;
    _hoveredElementId = null;
    clearHighlight();
}

/**
 * Handler de hover no canvas.
 * Muda cursor para "pointer" ao passar sobre elemento.
 * Throttled para performance.
 */
function onCanvasHover(event) {
    if (isVoxelEditing()) return;
    const now = Date.now();
    if (now - lastHoverTime < HOVER_INTERVAL) return;
    lastHoverTime = now;

    const camera = getCamera();
    const elementsGroup = getElementsGroup();
    if (!camera || !elementsGroup || !container) return;

    updateMouseCoords(event);
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(elementsGroup.children, true);

    if (intersects.length > 0) {
        const elementId = findElementId(intersects[0].object);
        container.style.cursor = elementId ? 'pointer' : 'default';

        // Hover highlight — evidencia o elemento sob o cursor
        if (elementId && elementId !== _hoveredElementId) {
            // Limpa hover anterior (preserva selecao)
            if (_hoveredElementId && highlightedMesh && highlightedMesh !== _selectedHighlightMesh) {
                clearHighlight();
            }
            _hoveredElementId = elementId;
            if (!_selectedHighlightMesh || highlightedMesh !== _selectedHighlightMesh) {
                const mesh = getMeshByElementId(elementId);
                if (mesh) highlightMesh(mesh);
            }
        }
    } else {
        // Mouse saiu de elemento — limpa hover (preserva selecao)
        if (_hoveredElementId) {
            _hoveredElementId = null;
            if (highlightedMesh && highlightedMesh !== _selectedHighlightMesh) {
                clearHighlight();
            }
        }

        // Verifica layers de interpolação
        const interpGroup = getInterpolationGroup();
        if (interpGroup && interpGroup.children.length > 0) {
            const layerHits = raycaster.intersectObjects(interpGroup.children, true);
            container.style.cursor = layerHits.length > 0 && findLayerId(layerHits[0].object) ? 'pointer' : 'default';
        } else {
            container.style.cursor = 'default';
        }
    }
}

// ----------------------------------------------------------------
// COORDENADAS
// ----------------------------------------------------------------

/**
 * Converte posicao do mouse para coordenadas normalizadas (-1 a 1).
 * Three.js usa sistema de coordenadas normalizado (NDC).
 *
 * @param {MouseEvent} event - Evento do mouse
 */
function updateMouseCoords(event) {
    const renderer = getRenderer();
    if (!renderer) return;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

// ----------------------------------------------------------------
// BUSCA DE ELEMENTO
// ----------------------------------------------------------------

/**
 * Busca o elementId subindo na hierarquia do objeto 3D.
 * Meshes podem ser filhos de grupos, entao subimos ate encontrar userData.elementId.
 *
 * @param {THREE.Object3D} object - Objeto 3D interseccionado
 * @returns {string|null} - ID do elemento ou null
 */
function findElementId(object) {
    let current = object;
    while (current) {
        if (current.userData && current.userData.elementId) {
            return current.userData.elementId;
        }
        current = current.parent;
        // Parar no grupo de elementos (nao subir alem)
        const elementsGroup = getElementsGroup();
        if (current === elementsGroup) break;
    }
    return null;
}

/**
 * Busca o layerId subindo na hierarquia do objeto 3D.
 * @param {THREE.Object3D} object
 * @returns {string|null}
 */
function findLayerId(object) {
    let current = object;
    const interpGroup = getInterpolationGroup();
    while (current) {
        if (current.userData && current.userData.layerId) {
            return current.userData.layerId;
        }
        current = current.parent;
        if (current === interpGroup) break;
    }
    return null;
}

// ----------------------------------------------------------------
// HIGHLIGHT (DESTAQUE VISUAL)
// ----------------------------------------------------------------

/**
 * Aplica destaque visual (brilho azul) em um mesh.
 * Armazena emissive original para restaurar depois.
 *
 * @param {THREE.Mesh} mesh - Mesh a destacar
 */
export function highlightMesh(mesh) {
    clearHighlight();
    if (!mesh) return;

    // Sprite billboard: mudar cor do material diretamente (sem emissive)
    if (mesh.isSprite) {
        highlightedMesh = mesh;
        originalEmissive = mesh.material.color.clone();
        originalEmissiveIntensity = -1; // sentinel para identificar Sprite no restore
        mesh.material.color.set(0x88bbff);
        requestRender();
        return;
    }

    // Buscar material — pode ser mesh direto ou grupo
    const targetMesh = findMeshWithMaterial(mesh);
    if (!targetMesh?.material) return;

    const mat = targetMesh.material;
    if (mat.emissive) {
        originalEmissive = mat.emissive.clone();
        originalEmissiveIntensity = mat.emissiveIntensity || 0;
        mat.emissive.set(0x4488ff);
        mat.emissiveIntensity = 0.3;
    }
    highlightedMesh = targetMesh;
    requestRender();
}

/**
 * Remove destaque visual do mesh atual.
 * Restaura emissive original.
 */
export function clearHighlight() {
    if (highlightedMesh?.material && originalEmissive) {
        // Sprite restore: cor direta (sentinel = -1)
        if (originalEmissiveIntensity === -1 && highlightedMesh.isSprite) {
            highlightedMesh.material.color.copy(originalEmissive);
        }
        // Regular mesh restore: emissive
        else if (highlightedMesh.material.emissive) {
            highlightedMesh.material.emissive.copy(originalEmissive);
            highlightedMesh.material.emissiveIntensity = originalEmissiveIntensity;
        }
    }
    highlightedMesh = null;
    originalEmissive = null;
    originalEmissiveIntensity = 0;
    requestRender();
}

/**
 * Busca primeiro filho que tem material (para grupos).
 *
 * @param {THREE.Object3D} object - Objeto 3D
 * @returns {THREE.Mesh|null}
 */
function findMeshWithMaterial(object) {
    if (object.material) return object;
    // Buscar nos filhos
    for (const child of object.children) {
        const found = findMeshWithMaterial(child);
        if (found) return found;
    }
    return null;
}

/**
 * Retorna o mesh atualmente destacado.
 * @returns {THREE.Mesh|null}
 */
export function getHighlightedMesh() {
    return highlightedMesh;
}

// ----------------------------------------------------------------
// CLEANUP
// ----------------------------------------------------------------

/**
 * Remove listeners e limpa estado.
 */
export function destroyPicker() {
    if (container) {
        container.removeEventListener('mousedown', onCanvasMouseDown);
        container.removeEventListener('mouseup', onCanvasMouseUp);
        container.removeEventListener('mousemove', onCanvasHover);
    }
    clearHighlight();
    container = null;
    raycaster = null;
    onSelectCallback = null;
    onDeselectCallback = null;
}
