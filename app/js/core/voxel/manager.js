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
   VOXEL MANAGER — Estado, CRUD e orquestracao de volumes voxel
   Gerenciador generico de volumes 3D voxelizados

   PADRAO: Identico ao interpolation/manager.js
   - Estado em closure (Map de volumes)
   - Persistencia via localStorage + model export/import
   - CustomEvent 'voxelChanged' para UI reativa
   - setVoxelGroup() para injecao do grupo Three.js

   USO INICIAL: Geologia subsuperficial (vadosa/saturada)
   Futuro: qualquer classificacao volumetrica 3D
   ================================================================ */

import { generateId } from '../../utils/helpers/id.js';
import { CONFIG } from '../../config.js';
import { voxelize, countByZone, suggestResolution, VADOSE, SATURATED } from './engine.js';
import { buildVoxelMeshes, disposeVoxelMeshes, setVoxelOpacity, setVoxelVisible } from './renderer.js';
import { GEOLOGY_ZONES } from './colorSchemes.js';
import { sampleTerrainElevation, sampleLayerGrid, hasTerrainGrid, getAllLayers } from '../interpolation/manager.js';
import { getAllElements } from '../elements/manager.js';
import { requestRender } from '../../utils/scene/setup.js';
import { showToast } from '../../utils/ui/toast.js';
import { isEphemeral } from '../../utils/storage/storageMonitor.js';
import { idbSet, idbGetWithLegacy } from '../../utils/storage/idbStore.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

/** @type {Map<string, Object>} */
const _volumes = new Map();

/** @type {import('three').Group|null} */
let _voxelGroup = null;

const LS_KEY = 'ecbyts-voxel';
const MAX_VOXELS = 1_000_000;

// ----------------------------------------------------------------
// LIFECYCLE
// ----------------------------------------------------------------

/**
 * Initialize voxel module — restore from IndexedDB (migra do localStorage se necessário).
 * Restaura volumes salvos (sem grid — recomputa após restore).
 */
export async function initVoxel() {
    try {
        const configs = await idbGetWithLegacy(LS_KEY);
        if (!Array.isArray(configs)) return;
        for (const cfg of configs) {
            // Recria volume sem grid (sera recomputado)
            const vol = {
                ...cfg,
                grid: null,
                dims: null,
            };
            _volumes.set(vol.id, vol);
            // Tenta recomputar (silencioso se faltar superficies)
            _recompute(vol.id, true);
        }
    } catch (e) {
        console.warn('[Voxel] Falha ao restaurar:', e.message);
    }
}

/**
 * Inject Three.js group for voxel meshes.
 * @param {import('three').Group} group
 */
export function setVoxelGroup(group) {
    _voxelGroup = group;
}

// ----------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------

/**
 * Create a geology volume (vadose/saturated classification).
 * Cria volume geologico a partir das superficies de terreno e lencol freatico.
 *
 * @param {Object} [opts]
 * @param {number} [opts.resolution] - voxel size (auto if omitted)
 * @param {string} [opts.name] - volume name
 * @returns {Object|null} created volume or null on failure
 */
export function createGeologyVolume(opts = {}) {
    // Bounds from boundary element
    const bounds = _getBoundaryBounds();
    if (!bounds) {
        showToast('Nenhuma boundary encontrada. Adicione uma area de estudo.', 'warning');
        return null;
    }

    // Vertical range: terrain top → deepest stratum bottom
    const strata = CONFIG.STRATA || [];
    const deepestBottom = strata.length > 0 ? Math.min(...strata.map((s) => s.bottom)) : -50;

    // Estimate terrain top (max elevation across bounds)
    let maxTerrainY = 0;
    if (hasTerrainGrid()) {
        // Sample corners and center to estimate max
        const samplePts = [
            [bounds.minX, bounds.minZ],
            [bounds.maxX, bounds.minZ],
            [bounds.minX, bounds.maxZ],
            [bounds.maxX, bounds.maxZ],
            [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2],
        ];
        for (const [sx, sz] of samplePts) {
            const y = sampleTerrainElevation(sx, sz);
            if (y > maxTerrainY) maxTerrainY = y;
        }
        // Add margin for peaks between samples
        maxTerrainY += 5;
    }

    const yRange = { top: maxTerrainY, bottom: deepestBottom };

    // Resolution (auto or user-specified)
    const resolution = opts.resolution || suggestResolution(bounds, yRange);

    // Check cap
    const nx = Math.ceil((bounds.maxX - bounds.minX) / resolution);
    const ny = Math.ceil((yRange.top - yRange.bottom) / resolution);
    const nz = Math.ceil((bounds.maxZ - bounds.minZ) / resolution);
    const total = nx * ny * nz;
    if (total > MAX_VOXELS) {
        const suggested = suggestResolution(bounds, yRange);
        showToast(
            `Volume excede ${(MAX_VOXELS / 1000).toFixed(0)}K voxels. Use resolucao >= ${suggested}m.`,
            'warning',
        );
        return null;
    }

    // Surface samplers
    const sampleTop = (x, z) => (hasTerrainGrid() ? sampleTerrainElevation(x, z) : 0);
    const hasWT = getAllLayers().some((l) => l.type === 'water_table' && l.grid);
    const sampleDivider = hasWT ? (x, z) => sampleLayerGrid('water_table', x, z) : (_x, _z) => -5; // Fallback: lencol a -5m

    // Voxelize
    const { grid, dims } = voxelize(bounds, yRange, resolution, sampleTop, sampleDivider);

    const volume = {
        id: generateId('voxvol'),
        name: opts.name || 'Geologia Subsuperficial',
        bounds,
        yRange,
        resolution,
        dims,
        grid,
        zones: GEOLOGY_ZONES,
        mode: 'solid',
        visible: true,
        opacity: 0.6,
    };

    _volumes.set(volume.id, volume);

    // Build 3D meshes
    if (_voxelGroup) {
        buildVoxelMeshes(volume, _voxelGroup);
        requestRender();
    }

    _persist();
    _notify();

    const vadoseN = countByZone(grid, VADOSE);
    const saturatedN = countByZone(grid, SATURATED);
    showToast(
        `Geologia: ${(vadoseN + saturatedN).toLocaleString()} voxels (${resolution}m) — ` +
            `Vadosa: ${vadoseN.toLocaleString()}, Saturada: ${saturatedN.toLocaleString()}`,
        'success',
    );

    return volume;
}

/**
 * Remove a volume and dispose its meshes.
 * Remove volume e libera memoria dos meshes.
 *
 * @param {string} [id] - volume ID (removes first if omitted)
 */
export function removeVolume(id) {
    if (!id) {
        // Remove first volume
        const first = _volumes.keys().next().value;
        if (!first) return;
        id = first;
    }
    _volumes.delete(id);
    if (_voxelGroup) {
        // Remove meshes matching this volume
        const toRemove = _voxelGroup.children.filter((c) => c.userData.volumeId === id);
        for (const child of toRemove) {
            _voxelGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (Array.isArray(child.material)) {
                child.material.forEach((m) => m.dispose());
            } else if (child.material) {
                child.material.dispose();
            }
        }
        requestRender();
    }
    _persist();
    _notify();
}

/**
 * Remove all geology volumes.
 * Limpa todos os volumes de voxel (zonas vadosa/saturada).
 */
export function clearAllVolumes() {
    const ids = [..._volumes.keys()];
    ids.forEach((id) => removeVolume(id));
    _selectedVolumeId = null;
}

/**
 * Get all volumes.
 * @returns {Object[]}
 */
export function getAllVolumes() {
    return Array.from(_volumes.values());
}

/**
 * Get a specific volume by ID.
 * @param {string} id
 * @returns {Object|null}
 */
export function getVolume(id) {
    return _volumes.get(id) || null;
}

// ----------------------------------------------------------------
// SELECAO
// ----------------------------------------------------------------

/** @type {string|null} */
let _selectedVolumeId = null;

/** @returns {string|null} */
export function getSelectedVolume() {
    return _selectedVolumeId;
}

/** @param {string|null} id */
export function setSelectedVolume(id) {
    _selectedVolumeId = id;
}

// ----------------------------------------------------------------
// MUTACAO PONTUAL (para insert/delete de voxels individuais)
// ----------------------------------------------------------------

/**
 * Set a single voxel cell in the grid.
 * Modifica uma unica celula do grid (para edicao manual).
 *
 * @param {string} volumeId
 * @param {number} flatIdx - flat grid index
 * @param {number} zoneId - EMPTY (0), VADOSE (1), or SATURATED (2)
 */
export function setVoxelCell(volumeId, flatIdx, zoneId) {
    const vol = _volumes.get(volumeId);
    if (!vol?.grid || flatIdx < 0 || flatIdx >= vol.grid.length) return;
    vol.grid[flatIdx] = zoneId;
}

/**
 * Rebuild meshes for a volume after manual grid edits.
 * Reconstroi meshes apos edicoes manuais no grid.
 *
 * @param {string} volumeId
 */
export function rebuildVolumeMeshes(volumeId) {
    const vol = _volumes.get(volumeId);
    if (!vol || !_voxelGroup) return;
    buildVoxelMeshes(vol, _voxelGroup);
    requestRender();
    _persist();
    _notify();
}

// ----------------------------------------------------------------
// CONTROLES
// ----------------------------------------------------------------

/**
 * Set display mode (solid or voxels).
 * Alterna entre bloco solido e cubos individuais.
 *
 * @param {string} id - volume ID
 * @param {'solid'|'voxels'} mode
 */
export function setVolumeMode(id, mode) {
    const vol = _volumes.get(id);
    if (!vol || !vol.grid) return;
    vol.mode = mode;
    if (_voxelGroup) {
        buildVoxelMeshes(vol, _voxelGroup);
        requestRender();
    }
    _persist();
    _notify();
}

/**
 * Change voxel resolution and recompute.
 * Muda resolucao e reconstroi o grid + meshes.
 *
 * @param {string} id - volume ID
 * @param {number} resolution - new resolution in meters
 */
export function setVolumeResolution(id, resolution) {
    const vol = _volumes.get(id);
    if (!vol) return;
    vol.resolution = resolution;
    _recompute(id);
    _persist();
    _notify();
}

/**
 * Toggle volume visibility.
 * @param {string} id
 * @param {boolean} visible
 */
export function setVolumeVisible(id, visible) {
    const vol = _volumes.get(id);
    if (!vol) return;
    vol.visible = visible;
    if (_voxelGroup) {
        setVoxelVisible(id, visible, _voxelGroup);
        requestRender();
    }
    _persist();
    _notify();
}

/**
 * Set volume opacity.
 * @param {string} id
 * @param {number} opacity - 0.0–1.0
 */
export function setVolumeOpacity(id, opacity) {
    const vol = _volumes.get(id);
    if (!vol) return;
    vol.opacity = opacity;
    if (_voxelGroup) {
        setVoxelOpacity(id, opacity, _voxelGroup);
        requestRender();
    }
    _persist();
}

/**
 * Recompute a volume (when surfaces change).
 * Reclassifica e reconstroi meshes.
 *
 * @param {string} id - volume ID
 */
export function recomputeVolume(id) {
    _recompute(id);
    _persist();
    _notify();
}

// ----------------------------------------------------------------
// PERSISTENCE
// ----------------------------------------------------------------

/**
 * Export volumes for model save (without grid data).
 * Exporta configs sem grid — sera recomputado no import.
 * @returns {Object[]}
 */
export function exportVolumes() {
    return Array.from(_volumes.values()).map((v) => ({
        id: v.id,
        name: v.name,
        resolution: v.resolution,
        mode: v.mode,
        visible: v.visible,
        opacity: v.opacity,
    }));
}

/**
 * Import volumes from model data.
 * Restaura e recomputa cada volume.
 * @param {Object[]} configs
 */
export function importVolumes(configs) {
    // Clear existing
    if (_voxelGroup) disposeVoxelMeshes(_voxelGroup);
    _volumes.clear();

    for (const cfg of configs) {
        const vol = { ...cfg, grid: null, dims: null, zones: GEOLOGY_ZONES, bounds: null, yRange: null };
        _volumes.set(vol.id, vol);
        _recompute(vol.id, true);
    }
    _notify();
}

// ----------------------------------------------------------------
// INTERNALS
// ----------------------------------------------------------------

/**
 * Recompute a volume's grid and rebuild meshes.
 * @param {string} id
 * @param {boolean} [silent=false] suppress toasts
 */
function _recompute(id, silent = false) {
    const vol = _volumes.get(id);
    if (!vol) return;

    const bounds = _getBoundaryBounds();
    if (!bounds) {
        if (!silent) showToast('Nenhuma boundary encontrada.', 'warning');
        return;
    }

    const strata = CONFIG.STRATA || [];
    const deepestBottom = strata.length > 0 ? Math.min(...strata.map((s) => s.bottom)) : -50;

    let maxTerrainY = 0;
    if (hasTerrainGrid()) {
        const pts = [
            [bounds.minX, bounds.minZ],
            [bounds.maxX, bounds.minZ],
            [bounds.minX, bounds.maxZ],
            [bounds.maxX, bounds.maxZ],
            [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2],
        ];
        for (const [sx, sz] of pts) {
            const y = sampleTerrainElevation(sx, sz);
            if (y > maxTerrainY) maxTerrainY = y;
        }
        maxTerrainY += 5;
    }

    vol.bounds = bounds;
    vol.yRange = { top: maxTerrainY, bottom: deepestBottom };

    const res = vol.resolution || suggestResolution(bounds, vol.yRange);
    vol.resolution = res;

    // Check cap
    const nx = Math.ceil((bounds.maxX - bounds.minX) / res);
    const ny = Math.ceil((vol.yRange.top - vol.yRange.bottom) / res);
    const nz = Math.ceil((bounds.maxZ - bounds.minZ) / res);
    if (nx * ny * nz > MAX_VOXELS) {
        vol.resolution = suggestResolution(bounds, vol.yRange);
    }

    const sampleTop = (x, z) => (hasTerrainGrid() ? sampleTerrainElevation(x, z) : 0);
    const hasWT = getAllLayers().some((l) => l.type === 'water_table' && l.grid);
    const sampleDivider = hasWT ? (x, z) => sampleLayerGrid('water_table', x, z) : (_x, _z) => -5;

    const { grid, dims } = voxelize(vol.bounds, vol.yRange, vol.resolution, sampleTop, sampleDivider);
    vol.grid = grid;
    vol.dims = dims;
    vol.zones = GEOLOGY_ZONES;

    if (_voxelGroup) {
        buildVoxelMeshes(vol, _voxelGroup);
        requestRender();
    }
}

/**
 * Get boundary bounds from model elements.
 * Busca bounds da boundary — replicado de interpolation/manager.
 * @returns {{ minX, maxX, minZ, maxZ }|null}
 */
function _getBoundaryBounds() {
    const elements = getAllElements();
    const boundary = elements.find((e) => e.family === 'boundary');
    if (!boundary || !boundary.data?.vertices?.length) return null;

    let minX = Infinity,
        maxX = -Infinity;
    let minZ = Infinity,
        maxZ = -Infinity;

    for (const v of boundary.data.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
    }

    const padX = (maxX - minX) * 0.1;
    const padZ = (maxZ - minZ) * 0.1;

    return {
        minX: minX - padX,
        maxX: maxX + padX,
        minZ: minZ - padZ,
        maxZ: maxZ + padZ,
    };
}

/** Persist to IndexedDB (without grid — fire-and-forget). */
async function _persist() {
    if (isEphemeral()) return;
    const data = Array.from(_volumes.values()).map((v) => ({
        id: v.id,
        name: v.name,
        resolution: v.resolution,
        mode: v.mode,
        visible: v.visible,
        opacity: v.opacity,
    }));
    const ok = await idbSet(LS_KEY, data);
    if (!ok) showToast('Storage full. Voxel data may not persist.', 'warning');
}

/** Dispatch change event. */
function _notify() {
    window.dispatchEvent(new CustomEvent('voxelChanged'));
}
