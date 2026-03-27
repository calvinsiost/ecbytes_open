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
   GIZMO CONTROLLER — TransformControls wrapper for element editing
   ================================================================

   Wrapper sobre THREE.TransformControls que fornece:
   - Translate (W), Rotate (E), Scale (R) com snap
   - Attach/detach ao mesh de elementos selecionados
   - Sincronizacao bidirecional: mesh <-> element.data
   - Toggle world/local space (X)

   TransformControls e um addon built-in do Three.js (MIT).
   Importado via import map em index.html: three/addons/

   ================================================================ */

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { getCamera, getControls, getRenderer, getScene, addRenderHook, wakeRenderLoop } from '../scene/setup.js';
import { getElementById, updateElement } from '../../core/elements/manager.js';
import { pushSnapshot } from '../history/manager.js';
import { isSnapEnabled, getGridSize } from './snapEngine.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

let transformControls = null;
let attachedMesh = null;
let attachedElementId = null;
let _gizmoActive = false;
let _dragging = false;

// Posicao anterior ao drag — para detectar mudancas reais
const _prevPosition = new THREE.Vector3();
const _prevRotation = new THREE.Euler();
const _prevScale = new THREE.Vector3();

// ----------------------------------------------------------------
// INICIALIZACAO
// ----------------------------------------------------------------

/**
 * Inicializa o TransformControls e adiciona a scene.
 * Deve ser chamado apos initScene().
 */
export function initGizmo() {
    const camera = getCamera();
    const renderer = getRenderer();
    const scene = getScene();
    if (!camera || !renderer || !scene) {
        console.warn('[GizmoController] Scene nao inicializada');
        return;
    }

    transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.visible = false;
    transformControls.enabled = false;

    // Evento nativo: controla OrbitControls e persiste ao final do drag
    transformControls.addEventListener('dragging-changed', (event) => {
        const orbitControls = getControls();
        if (orbitControls) orbitControls.enabled = !event.value;

        if (event.value) {
            // Inicio do drag — salva estado anterior
            _dragging = true;
            if (attachedMesh) {
                _prevPosition.copy(attachedMesh.position);
                _prevRotation.copy(attachedMesh.rotation);
                _prevScale.copy(attachedMesh.scale);
            }
        } else if (_dragging) {
            // Fim do drag — persiste no element.data
            _dragging = false;
            _syncMeshToElement();
            pushSnapshot();
        }

        wakeRenderLoop();
    });

    // Re-render a cada frame de drag + atualiza coords UI
    transformControls.addEventListener('change', () => {
        wakeRenderLoop();
        if (attachedMesh && _dragging) {
            _updateCoordsUI(attachedMesh.position);
        }
    });

    // Sincroniza snap do gizmo quando snap engine muda
    window.addEventListener('ecbt:snapChanged', _syncGizmoSnap);
    _syncGizmoSnap();

    // Size dinamico: gizmo ocupa fracao constante do viewport em qualquer zoom.
    // TransformControls calcula: visual = size * (top - bottom) / zoom.
    // Para constante visual: size = FRAC * zoom → visual = FRAC * frustum.
    // FRAC=0.8 com frustum=100 → setas de ~80 world units (~13% de cena 600m).
    const TARGET_FRACTION = 0.8;
    addRenderHook((_s, cam) => {
        if (!transformControls || !transformControls.visible) return;
        transformControls.size = TARGET_FRACTION * (cam.zoom || 1);
    });

    scene.add(transformControls);
}

/**
 * Sincroniza snap do TransformControls com snapEngine.
 * @private
 */
function _syncGizmoSnap() {
    if (!transformControls) return;
    if (isSnapEnabled()) {
        transformControls.translationSnap = getGridSize();
        transformControls.rotationSnap = Math.PI / 12; // 15 graus
    } else {
        transformControls.translationSnap = null;
        transformControls.rotationSnap = null;
    }
}

// ----------------------------------------------------------------
// ATTACH / DETACH
// ----------------------------------------------------------------

/**
 * Vincula o gizmo a um mesh de elemento.
 *
 * @param {string} elementId - ID do elemento
 * @param {THREE.Object3D} mesh - Mesh 3D do elemento
 */
export function attachGizmo(elementId, mesh) {
    if (!transformControls || !mesh) return;

    // Detach anterior se diferente
    if (attachedMesh && attachedMesh !== mesh) {
        detachGizmo();
    }

    attachedElementId = elementId;
    attachedMesh = mesh;

    transformControls.attach(mesh);
    transformControls.visible = true;
    transformControls.enabled = true;
    _gizmoActive = true;

    _syncGizmoSnap();
    _updateCoordsUI(mesh.position);
    wakeRenderLoop();
}

/**
 * Remove o gizmo do mesh atual.
 */
export function detachGizmo() {
    if (!transformControls) return;

    transformControls.detach();
    transformControls.visible = false;
    transformControls.enabled = false;

    attachedMesh = null;
    attachedElementId = null;
    _gizmoActive = false;
    _dragging = false;

    wakeRenderLoop();
}

// ----------------------------------------------------------------
// MODOS
// ----------------------------------------------------------------

/**
 * Define o modo do gizmo.
 * @param {'translate'|'rotate'|'scale'} mode
 */
export function setGizmoMode(mode) {
    if (!transformControls) return;
    if (['translate', 'rotate', 'scale'].includes(mode)) {
        transformControls.setMode(mode);
        wakeRenderLoop();
    }
}

/**
 * Retorna o modo atual do gizmo.
 * @returns {'translate'|'rotate'|'scale'}
 */
export function getGizmoMode() {
    return transformControls?.mode || 'translate';
}

/**
 * Alterna entre world e local space.
 */
export function toggleGizmoSpace() {
    if (!transformControls) return;
    transformControls.setSpace(transformControls.space === 'world' ? 'local' : 'world');
    wakeRenderLoop();
}

/**
 * Retorna o space atual.
 * @returns {'world'|'local'}
 */
export function getGizmoSpace() {
    return transformControls?.space || 'world';
}

// ----------------------------------------------------------------
// SNAP
// ----------------------------------------------------------------

/**
 * Configura snap de translacao no gizmo.
 * @param {number|null} gridSize - Tamanho do grid (null = desabilita snap)
 */
export function setGizmoTranslationSnap(gridSize) {
    if (!transformControls) return;
    transformControls.translationSnap = gridSize;
}

/**
 * Configura snap de rotacao no gizmo.
 * @param {number|null} degrees - Graus (null = desabilita)
 */
export function setGizmoRotationSnap(degrees) {
    if (!transformControls) return;
    transformControls.rotationSnap = degrees ? THREE.MathUtils.degToRad(degrees) : null;
}

// ----------------------------------------------------------------
// POSITION PROGRAMATICA
// ----------------------------------------------------------------

/**
 * Define posicao do mesh via gizmo (para input numerico).
 * @param {THREE.Vector3} position
 */
export function setGizmoPosition(position) {
    if (!attachedMesh) return;
    attachedMesh.position.copy(position);
    _syncMeshToElement();
    pushSnapshot();
    wakeRenderLoop();
}

/**
 * Retorna posicao atual do mesh vinculado.
 * @returns {THREE.Vector3|null}
 */
export function getGizmoPosition() {
    return attachedMesh ? attachedMesh.position.clone() : null;
}

// ----------------------------------------------------------------
// QUERIES
// ----------------------------------------------------------------

/**
 * Retorna true se o gizmo esta ativo (attached a um mesh).
 * Usado pelo dragController para evitar race condition com OrbitControls.
 */
export function isGizmoActive() {
    return _gizmoActive;
}

/**
 * Retorna true se o gizmo esta sendo arrastado.
 */
export function isGizmoDragging() {
    return _dragging;
}

/**
 * Retorna o ID do elemento atualmente vinculado ao gizmo.
 * @returns {string|null}
 */
export function getGizmoElementId() {
    return attachedElementId;
}

// ----------------------------------------------------------------
// SYNC MESH → ELEMENT DATA
// ----------------------------------------------------------------

/**
 * Persiste a posicao/rotacao/escala do mesh de volta no element.data.
 * Trata as diferentes convencoes de armazenamento por familia:
 * - plume: data.center
 * - well, spring, marker, lake, tank, building, waste, boundary, river: data.position
 * @private
 */
function _syncMeshToElement() {
    if (!attachedElementId || !attachedMesh) return;

    const element = getElementById(attachedElementId);
    if (!element) return;

    const pos = attachedMesh.position;
    const rot = attachedMesh.rotation;
    const scl = attachedMesh.scale;

    if (!element.data) element.data = {};

    // Posicao — campo depende da familia
    if (element.family === 'plume') {
        if (!element.data.center) element.data.center = {};
        element.data.center.x = pos.x;
        element.data.center.y = pos.y;
        element.data.center.z = pos.z;
    } else {
        if (!element.data.position) element.data.position = {};
        element.data.position.x = pos.x;
        element.data.position.y = pos.y;
        element.data.position.z = pos.z;
    }

    // Rotacao — armazena em euler (radianos)
    if (rot.x !== 0 || rot.y !== 0 || rot.z !== 0) {
        element.data.rotation = { x: rot.x, y: rot.y, z: rot.z };
    }

    // Escala — so armazena se diferente de 1
    if (scl.x !== 1 || scl.y !== 1 || scl.z !== 1) {
        element.data.scale = { x: scl.x, y: scl.y, z: scl.z };
    }
}

// ----------------------------------------------------------------
// COORDS UI — atualiza inputs X/Y/Z na ribbon
// ----------------------------------------------------------------

/**
 * Atualiza os inputs de coordenadas na ribbon Edit.
 * @param {THREE.Vector3} position
 * @private
 */
function _updateCoordsUI(position) {
    const xInput = document.getElementById('edit-ribbon-coord-x');
    const yInput = document.getElementById('edit-ribbon-coord-y');
    const zInput = document.getElementById('edit-ribbon-coord-z');
    if (xInput && document.activeElement !== xInput) xInput.value = position.x.toFixed(2);
    if (yInput && document.activeElement !== yInput) yInput.value = position.y.toFixed(2);
    if (zInput && document.activeElement !== zInput) zInput.value = position.z.toFixed(2);
}

// ----------------------------------------------------------------
// CLEANUP
// ----------------------------------------------------------------

/**
 * Remove TransformControls da scene e libera recursos.
 */
export function disposeGizmo() {
    if (transformControls) {
        detachGizmo();
        const scene = getScene();
        if (scene) scene.remove(transformControls);
        transformControls.dispose();
        transformControls = null;
    }
}
