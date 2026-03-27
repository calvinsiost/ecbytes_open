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
   VOXEL HANDLERS — UI action handlers for voxel geology
   Handlers de acoes do usuario para o modulo de voxelizacao

   Todas as funcoes sao expostas via window.* pelo handlers/index.js.
   Chamadas pelos botoes na ribbon e painel de controles.
   ================================================================ */

import {
    createGeologyVolume,
    removeVolume,
    getAllVolumes,
    getVolume,
    setVolumeMode,
    setVolumeResolution,
    setVolumeVisible,
    setVolumeOpacity,
    recomputeVolume,
    getSelectedVolume,
    setSelectedVolume,
} from '../../core/voxel/manager.js';
import { requestRender } from '../scene/setup.js';
import { setSelectedElement } from '../../core/elements/manager.js';
import { setSelectedLayer } from '../../core/interpolation/manager.js';
import { enterVoxelEdit, exitVoxelEdit, isVoxelEditing } from '../../core/voxel/editController.js';
import { showToast } from '../ui/toast.js';

let _updateAllUI = null;

/**
 * Inject updateAllUI dependency.
 * @param {Function} fn
 */
export function setVoxelUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ----------------------------------------------------------------
// HANDLER FUNCTIONS
// ----------------------------------------------------------------

/**
 * Generate geology volume from terrain + water table surfaces.
 * Gera volume geologico (zona vadosa/saturada).
 * @param {Object} [opts] - { resolution?: number }
 */
function handleGenerateGeology(opts) {
    const vol = createGeologyVolume(opts);
    if (vol && _updateAllUI) _updateAllUI();
    _renderVoxelPanel();
}

/**
 * Remove voxel volume.
 * Remove o volume voxelizado.
 * @param {string} [id] - volume ID (first if omitted)
 */
function handleRemoveVoxelVolume(id) {
    removeVolume(id);
    if (_updateAllUI) _updateAllUI();
    _renderVoxelPanel();
}

/**
 * Toggle between solid and voxel display mode.
 * Alterna entre bloco solido e cubos individuais (Minecraft).
 * @param {string} [id] - volume ID (first if omitted)
 */
function handleToggleVoxelMode(id) {
    const vols = getAllVolumes();
    const vol = id ? vols.find((v) => v.id === id) : vols[0];
    if (!vol) return;
    const newMode = vol.mode === 'solid' ? 'voxels' : 'solid';
    setVolumeMode(vol.id, newMode);
    if (_updateAllUI) _updateAllUI();
    _renderVoxelPanel();
}

/**
 * Set voxel resolution.
 * Muda resolucao dos voxels (1, 2, 5, 10 metros).
 * @param {number|Object} resOrOpts - resolution number or {resolution, id?}
 */
function handleSetVoxelResolution(resOrOpts) {
    const vols = getAllVolumes();
    let resolution, id;
    if (typeof resOrOpts === 'object') {
        resolution = resOrOpts.resolution;
        id = resOrOpts.id;
    } else {
        resolution = resOrOpts;
    }
    const vol = id ? vols.find((v) => v.id === id) : vols[0];
    if (!vol || !resolution) return;
    setVolumeResolution(vol.id, Number(resolution));
    if (_updateAllUI) _updateAllUI();
    _renderVoxelPanel();
}

/**
 * Toggle voxel volume visibility.
 * @param {string} [id]
 */
function handleToggleVoxelVisible(id) {
    const vols = getAllVolumes();
    const vol = id ? vols.find((v) => v.id === id) : vols[0];
    if (!vol) return;
    setVolumeVisible(vol.id, !vol.visible);
    _renderVoxelPanel();
}

/**
 * Set voxel opacity from slider.
 * @param {number|string} value - 0–100
 */
function handleSetVoxelOpacity(value) {
    const vols = getAllVolumes();
    const vol = vols[0];
    if (!vol) return;
    setVolumeOpacity(vol.id, Number(value) / 100);
}

/**
 * Recompute voxels after surface changes.
 * Recomputa apos mudancas nas superficies de interpolacao.
 */
function handleRecomputeVoxels() {
    const vols = getAllVolumes();
    for (const vol of vols) {
        recomputeVolume(vol.id);
    }
    if (_updateAllUI) _updateAllUI();
    _renderVoxelPanel();
}

// ----------------------------------------------------------------
// VOXEL CONTROL PANEL — Injected into ribbon area
// ----------------------------------------------------------------

/**
 * Render the voxel control panel (inline in ribbon or floating).
 * Atualiza o painel de controles do voxel.
 */
function _renderVoxelPanel() {
    const panel = document.getElementById('voxel-controls');
    if (!panel) return;

    const vols = getAllVolumes();
    if (vols.length === 0) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = '';
    const vol = vols[0];

    // Mode buttons
    const solidBtn = panel.querySelector('[data-voxel-mode="solid"]');
    const voxelBtn = panel.querySelector('[data-voxel-mode="voxels"]');
    if (solidBtn) solidBtn.classList.toggle('active', vol.mode === 'solid');
    if (voxelBtn) voxelBtn.classList.toggle('active', vol.mode === 'voxels');

    // Resolution display
    const resLabel = panel.querySelector('.voxel-res-label');
    if (resLabel) resLabel.textContent = `${vol.resolution}m`;

    // Opacity slider
    const opSlider = panel.querySelector('.voxel-opacity-slider');
    if (opSlider) opSlider.value = Math.round((vol.opacity || 0.6) * 100);

    // Visibility toggle
    const visBtn = panel.querySelector('.voxel-vis-btn');
    if (visBtn) visBtn.classList.toggle('active', vol.visible !== false);

    // Stats
    const stats = panel.querySelector('.voxel-stats');
    if (stats && vol.dims) {
        const total = vol.dims.nx * vol.dims.ny * vol.dims.nz;
        stats.textContent = `${vol.dims.nx}×${vol.dims.ny}×${vol.dims.nz} = ${total.toLocaleString()} voxels`;
    }
}

// ----------------------------------------------------------------
// SELECAO DE VOLUME (side panel)
// ----------------------------------------------------------------

/**
 * Select a voxel volume (mutual exclusion with element/layer).
 * Seleciona volume no painel lateral — limpa outras selecoes.
 * @param {string} volumeId
 */
function handleSelectVolume(volumeId) {
    // Limpa selecoes de element e layer
    setSelectedElement(null);
    setSelectedLayer(null);

    const prev = getSelectedVolume();
    setSelectedVolume(prev === volumeId ? null : volumeId);
    if (_updateAllUI) _updateAllUI();
}

/**
 * Set volume display mode with explicit ID.
 * Alterna modo de visualizacao (solid/voxels) com ID explicito.
 * @param {string} id
 * @param {'solid'|'voxels'} mode
 */
function handleSetVolumeMode(id, mode) {
    setVolumeMode(id, mode);
    if (_updateAllUI) _updateAllUI();
    _renderVoxelPanel();
}

/**
 * Set volume opacity with explicit ID.
 * Define opacidade de um volume especifico.
 * @param {string} id
 * @param {number|string} value - 0–100
 */
function handleSetVolumeOpacityById(id, value) {
    setVolumeOpacity(id, Number(value) / 100);
}

// ----------------------------------------------------------------
// VOXEL EDIT MODE
// ----------------------------------------------------------------

/**
 * Enter voxel edit mode for a volume.
 * Entra no modo de edicao de voxels individuais.
 * @param {string} [volumeId]
 */
function handleEnterVoxelEdit(volumeId) {
    const container = document.getElementById('canvas-container');
    if (!container) return;

    const vol = volumeId ? getVolume(volumeId) : getAllVolumes()[0];
    if (!vol) {
        showToast('No voxel volume to edit.', 'warning');
        return;
    }

    // Deve estar em modo voxels para editar
    if (vol.mode !== 'voxels') {
        setVolumeMode(vol.id, 'voxels');
    }

    const success = enterVoxelEdit(vol.id, container);
    if (success) {
        showToast('Voxel Edit: Click=Delete | Ctrl+Click=Insert | Esc=Exit', 'info');
        if (_updateAllUI) _updateAllUI();
    }
}

/**
 * Exit voxel edit mode.
 * Sai do modo de edicao de voxels.
 */
function handleExitVoxelEdit() {
    exitVoxelEdit();
    if (_updateAllUI) _updateAllUI();
}

// ----------------------------------------------------------------
// EXPORT
// ----------------------------------------------------------------

export const voxelHandlers = {
    handleGenerateGeology,
    handleRemoveVoxelVolume,
    handleToggleVoxelMode,
    handleSetVoxelResolution,
    handleToggleVoxelVisible,
    handleSetVoxelOpacity,
    handleRecomputeVoxels,
    handleSelectVolume,
    handleSetVolumeMode,
    handleSetVolumeOpacityById,
    handleEnterVoxelEdit,
    handleExitVoxelEdit,
};
