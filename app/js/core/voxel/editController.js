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
   VOXEL EDIT CONTROLLER — Insert/delete individual voxels
   Controlador de edicao de voxels individuais (pintura/apagamento)

   MAQUINA DE ESTADOS:
   IDLE ──[enterVoxelEdit]──► EDITING
     ▲                            │
     └────[exitVoxelEdit]─────────┘

   EM MODO DE EDICAO:
   - Left-click voxel face → delete (set EMPTY)
   - Ctrl+click / Right-click voxel face → insert adjacent voxel
   - Zona auto-detectada pela posicao relativa ao lencol freatico
   - Escape sai do modo de edicao
   ================================================================ */

import * as THREE from 'three';
import { getCamera, getRenderer, getVoxelGroup } from '../../utils/scene/setup.js';
import { requestRender } from '../../utils/scene/setup.js';
import { getVolume, setVoxelCell, rebuildVolumeMeshes } from './manager.js';
import { flatIndexToCoords, coordsToFlatIndex } from './renderer.js';
import { EMPTY, VADOSE, SATURATED } from './engine.js';
import { sampleLayerGrid, getAllLayers } from '../interpolation/manager.js';
import { showToast } from '../../utils/ui/toast.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

let _editing = false;
let _volumeId = null;
let _raycaster = null;
const _mouse = new THREE.Vector2();
let _container = null;
let _indicator = null;

// Debounce para evitar rebuilds excessivos em clicks rapidos
let _rebuildTimer = null;
const REBUILD_DEBOUNCE = 80;

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Enter voxel edit mode for a volume.
 * Entra no modo de edicao: cada click no voxel deleta ou insere.
 *
 * @param {string} volumeId
 * @param {HTMLElement} container - canvas container element
 * @returns {boolean} true if successfully entered edit mode
 */
export function enterVoxelEdit(volumeId, container) {
    const vol = getVolume(volumeId);
    if (!vol || !vol.grid || vol.mode !== 'voxels') {
        showToast('Switch to Voxels mode before editing.', 'warning');
        return false;
    }

    _editing = true;
    _volumeId = volumeId;
    _container = container;
    _raycaster = new THREE.Raycaster();

    // Capture-phase listeners (prioridade sobre picker.js)
    container.addEventListener('mousedown', _onMouseDown, { capture: true });
    container.addEventListener('contextmenu', _onContextMenu, { capture: true });
    window.addEventListener('keydown', _onKeyDown);
    container.style.cursor = 'crosshair';

    // Indicador flutuante no canvas
    _showIndicator(container);

    // Evento para notificar outros modulos
    window.dispatchEvent(
        new CustomEvent('voxelEditChanged', {
            detail: { editing: true, volumeId },
        }),
    );

    return true;
}

/**
 * Exit voxel edit mode.
 * Sai do modo de edicao e restaura estado normal.
 */
export function exitVoxelEdit() {
    if (!_editing) return;

    if (_container) {
        _container.removeEventListener('mousedown', _onMouseDown, { capture: true });
        _container.removeEventListener('contextmenu', _onContextMenu, { capture: true });
        _container.style.cursor = 'default';
    }
    window.removeEventListener('keydown', _onKeyDown);

    _hideIndicator();

    if (_rebuildTimer) {
        clearTimeout(_rebuildTimer);
        _rebuildTimer = null;
    }

    const prevId = _volumeId;
    _editing = false;
    _volumeId = null;
    _container = null;
    _raycaster = null;

    window.dispatchEvent(
        new CustomEvent('voxelEditChanged', {
            detail: { editing: false, volumeId: prevId },
        }),
    );
}

/** @returns {boolean} */
export function isVoxelEditing() {
    return _editing;
}

/** @returns {string|null} */
export function getEditingVolumeId() {
    return _volumeId;
}

// ----------------------------------------------------------------
// MOUSE HANDLERS
// ----------------------------------------------------------------

function _onMouseDown(event) {
    // Apenas botao esquerdo (0) e direito (2)
    if (event.button !== 0 && event.button !== 2) return;

    const camera = getCamera();
    const voxelGroup = getVoxelGroup();
    if (!camera || !voxelGroup) return;

    _updateMouse(event);
    _raycaster.setFromCamera(_mouse, camera);

    // Raycast contra InstancedMeshes do voxelGroup
    const intersects = _raycaster.intersectObjects(voxelGroup.children, false);
    if (intersects.length === 0) return;

    const hit = intersects[0];
    const instMesh = hit.object;

    // Verificar que pertence ao volume sendo editado
    if (instMesh.userData.volumeId !== _volumeId) return;
    if (hit.instanceId === undefined || hit.instanceId === null) return;

    const vol = getVolume(_volumeId);
    if (!vol) return;

    // Resolver coordenadas do grid a partir do instanceId
    const instanceToGrid = instMesh.userData.instanceToGrid;
    if (!instanceToGrid) return;

    const flatIdx = instanceToGrid[hit.instanceId];
    const coords = flatIndexToCoords(flatIdx, vol.dims);

    // Determinar acao: delete (left-click) ou insert (ctrl+click / right-click)
    const isInsert = event.ctrlKey || event.button === 2;

    if (isInsert) {
        _insertAdjacentVoxel(vol, hit, coords.ix, coords.iy, coords.iz);
    } else {
        _deleteVoxel(vol, flatIdx);
    }

    // Bloquear picker e OrbitControls
    event.stopPropagation();
    event.preventDefault();
}

function _onContextMenu(event) {
    // Bloquear menu de contexto do browser em voxel edit mode
    event.preventDefault();
    event.stopPropagation();
}

function _onKeyDown(event) {
    if (event.key === 'Escape') {
        exitVoxelEdit();
    }
}

// ----------------------------------------------------------------
// INSERT / DELETE LOGIC
// ----------------------------------------------------------------

/**
 * Delete a voxel (set to EMPTY).
 * Apaga um voxel — define como vazio no grid.
 */
function _deleteVoxel(vol, flatIdx) {
    setVoxelCell(vol.id, flatIdx, EMPTY);
    _debouncedRebuild(vol.id);
}

/**
 * Insert a voxel on the adjacent face of the hit voxel.
 * Insere voxel na celula adjacente a face clicada.
 * Usa a normal da face para determinar direcao.
 */
function _insertAdjacentVoxel(vol, hit, ix, iy, iz) {
    const normal = hit.face?.normal;
    if (!normal) return;

    // Snap normal para eixo dominante
    // (InstancedMesh usa apenas translacao, sem rotacao — normal local = world)
    const absX = Math.abs(normal.x);
    const absY = Math.abs(normal.y);
    const absZ = Math.abs(normal.z);

    let dx = 0,
        dy = 0,
        dz = 0;
    if (absX >= absY && absX >= absZ) {
        dx = normal.x > 0 ? 1 : -1;
    } else if (absY >= absX && absY >= absZ) {
        dy = normal.y > 0 ? 1 : -1;
    } else {
        dz = normal.z > 0 ? 1 : -1;
    }

    const nix = ix + dx;
    const niy = iy + dy;
    const niz = iz + dz;

    // Bounds check
    if (nix < 0 || nix >= vol.dims.nx) return;
    if (niy < 0 || niy >= vol.dims.ny) return;
    if (niz < 0 || niz >= vol.dims.nz) return;

    const newFlatIdx = coordsToFlatIndex(nix, niy, niz, vol.dims);

    // Apenas inserir em celulas vazias
    if (vol.grid[newFlatIdx] !== EMPTY) return;

    // Determinar zona natural pela posicao relativa ao water table
    const zone = _determineZone(vol, nix, niy, niz);

    setVoxelCell(vol.id, newFlatIdx, zone);
    _debouncedRebuild(vol.id);
}

/**
 * Determine the natural zone for a grid cell.
 * Zona vadosa acima do lencol, saturada abaixo.
 */
function _determineZone(vol, ix, iy, _iz) {
    const halfRes = vol.resolution / 2;
    const worldY = vol.yRange.bottom + iy * vol.resolution + halfRes;
    const worldX = vol.bounds.minX + ix * vol.resolution + halfRes;
    const worldZ = vol.bounds.minZ + _iz * vol.resolution + halfRes;

    // Verifica water table layer
    const hasWT = getAllLayers().some((l) => l.type === 'water_table' && l.grid);
    if (hasWT) {
        const wtY = sampleLayerGrid('water_table', worldX, worldZ);
        return worldY > wtY ? VADOSE : SATURATED;
    }

    // Fallback: abaixo de -5m e saturada
    return worldY > -5 ? VADOSE : SATURATED;
}

// ----------------------------------------------------------------
// DEBOUNCED REBUILD
// ----------------------------------------------------------------

/**
 * Debounce mesh rebuild to handle rapid clicks.
 * Evita rebuilds excessivos em clicks rapidos.
 */
function _debouncedRebuild(volumeId) {
    if (_rebuildTimer) clearTimeout(_rebuildTimer);
    _rebuildTimer = setTimeout(() => {
        rebuildVolumeMeshes(volumeId);
        _rebuildTimer = null;
    }, REBUILD_DEBOUNCE);
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function _updateMouse(event) {
    const renderer = getRenderer();
    if (!renderer) return;
    const rect = renderer.domElement.getBoundingClientRect();
    _mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    _mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

// ----------------------------------------------------------------
// INDICATOR UI
// ----------------------------------------------------------------

function _showIndicator(container) {
    _indicator = document.createElement('div');
    _indicator.className = 'voxel-edit-indicator';
    _indicator.innerHTML = `
        <span class="voxel-edit-label">Voxel Edit Mode</span>
        <span class="voxel-edit-hint">Click=Delete | Ctrl+Click=Insert | Esc=Exit</span>
    `;
    container.appendChild(_indicator);
}

function _hideIndicator() {
    if (_indicator) {
        _indicator.remove();
        _indicator = null;
    }
}
