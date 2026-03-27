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
   SHAPE EDIT HANDLERS — User actions for shape editing
   ================================================================

   Handlers para edição interativa de formas no viewport 3D.
   Conecta botões da interface (ribbon Edit + painel lateral) com o editManager.

   ================================================================ */

import { getSelectedElement, getElementById, getAllElements, getMeshByElementId } from '../../core/elements/manager.js';
import {
    enterEditMode,
    enterGizmoMode,
    exitEditMode,
    exitGizmoMode,
    toggleDrawMode,
    toggleGizmoShapeEdit,
    isEditing,
    getEditMode,
    getEditingElementId,
    getSelectedVertexIndex,
    hasStrategy,
    deleteSelectedVertex,
    resetShape,
} from '../editing/editManager.js';
import { setGizmoPosition, setGizmoMode, toggleGizmoSpace, getGizmoSpace } from '../editing/gizmoController.js';
import { toggleSnap, setGridSize, isSnapEnabled, getGridSize } from '../editing/snapEngine.js';
import { rebuildBoundaryGeometry, loadOverlayTexture } from '../../core/elements/meshFactory.js';
import { canEditElement, isAccessControlActive } from '../auth/permissions.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { requestRender } from '../scene/setup.js';
import { relativeToWGS84, hasOrigin } from '../../core/io/geo/coordinates.js';
import { getAllLayers, recomputeLayer } from '../../core/interpolation/manager.js';

/**
 * Enter shape edit mode for the currently selected element.
 * Entra no modo de edição de forma para o elemento selecionado.
 *
 * @param {string} [elementId] - ID do elemento (usa selecionado se omitido)
 */
export function handleEnterShapeEdit(elementId) {
    const id = elementId || getSelectedElement()?.id;
    if (!id) {
        showToast(t('noElementSelected') || 'No element selected', 'warning');
        return;
    }

    const element = getElementById(id) || getSelectedElement();
    if (!element) return;

    if (isAccessControlActive() && !canEditElement(id)) {
        showToast(t('permissionDenied') || 'Permission denied', 'error');
        return;
    }

    if (!hasStrategy(element.family)) {
        // Fallback: familias sem strategy entram em gizmo mode
        const success = enterGizmoMode(id);
        if (success) {
            showToast(t('gizmoModeEntered') || 'Transform mode (W/E/R)', 'info');
        }
        return;
    }

    const success = enterEditMode(id);
    if (success) {
        showToast(t('shapeEditEntered') || 'Shape editing mode', 'info');
    }
}

/**
 * Enter gizmo mode for the currently selected element.
 * Entra no modo gizmo (translate/rotate/scale) para o elemento.
 *
 * @param {string} [elementId] - ID do elemento (usa selecionado se omitido)
 */
export function handleEnterGizmoMode(elementId) {
    const id = elementId || getSelectedElement()?.id;
    if (!id) {
        showToast(t('noElementSelected') || 'No element selected', 'warning');
        return;
    }

    const element = getElementById(id) || getSelectedElement();
    if (!element) return;

    if (isAccessControlActive() && !canEditElement(id)) {
        showToast(t('permissionDenied') || 'Permission denied', 'error');
        return;
    }

    const success = enterGizmoMode(id);
    if (success) {
        showToast(t('gizmoModeEntered') || 'Transform mode (W/E/R)', 'info');
    }
}

/**
 * Exit shape edit mode.
 * Sai do modo de edição de forma.
 */
export function handleExitShapeEdit() {
    if (getEditMode() === 'gizmo') {
        exitGizmoMode();
    } else {
        exitEditMode();
    }
}

/**
 * Toggle draw mode while in shape edit.
 * Alterna modo de desenho (clicar para adicionar pontos).
 */
export function handleToggleDrawMode() {
    if (!isEditing()) return;
    toggleDrawMode();
}

/**
 * Delete the currently selected vertex.
 * Exclui o vértice atualmente selecionado.
 */
export function handleDeleteSelectedVertex() {
    if (!isEditing()) return;
    deleteSelectedVertex();
}

/**
 * Reset the element shape to its default.
 * Redefine a forma do elemento para o padrão da família.
 */
export function handleResetShape() {
    if (!isEditing()) return;
    resetShape();
}

// ----------------------------------------------------------------
// BOUNDARY SCALING — Ampliar / reduzir área de estudo
// ----------------------------------------------------------------

/**
 * Scale boundary vertices uniformly from their centroid.
 * Escala os vértices da boundary a partir do centroide.
 *
 * @param {number} factor - Fator de escala (ex: 1.1 = +10%, 0.9 = -10%)
 */
async function handleScaleBoundary(factor) {
    const boundary = getAllElements().find((e) => e.family === 'boundary');
    if (!boundary) {
        showToast(t('noBoundaryFound') || 'No boundary found', 'warning');
        return;
    }

    const verts = boundary.data.vertices;
    if (!verts || verts.length < 3) return;

    // Centroide
    let cx = 0,
        cz = 0;
    for (const v of verts) {
        cx += v.x;
        cz += v.z;
    }
    cx /= verts.length;
    cz /= verts.length;

    // Escala cada vértice a partir do centroide
    for (const v of verts) {
        v.x = cx + (v.x - cx) * factor;
        v.z = cz + (v.z - cz) * factor;
    }

    // Rebuild boundary outline + overlay geometry
    const mesh = getMeshByElementId(boundary.id);
    if (mesh) {
        rebuildBoundaryGeometry(mesh, verts, boundary.data);
    }

    // Re-fetch satellite image if geo origin is available
    if (hasOrigin() && mesh) {
        _refreshOverlayTexture(boundary, verts, mesh);
    }

    // Recompute interpolation layers (bounds will auto-refresh from boundary)
    const layers = getAllLayers();
    for (const layer of layers) {
        layer.bounds = null;
        await recomputeLayer(layer.id);
    }

    requestRender();
    showToast(t('boundaryScaled') || 'Study area scaled', 'success');
}

/**
 * Rebuild satellite overlay URLs and reload texture.
 * Reconstrói URLs de satélite e recarrega textura no overlay.
 */
async function _refreshOverlayTexture(boundary, verts, group) {
    // Imagem custom (upload do usuario) — não substituir
    if (boundary.data.overlayUrl?.startsWith('data:')) return;

    // Compute bounding box
    let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
    for (const v of verts) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
    }

    // Tile stitching via Sentinel-2 Cloudless
    const sw = relativeToWGS84({ x: minX, y: 0, z: maxZ });
    const ne = relativeToWGS84({ x: maxX, y: 0, z: minZ });
    const extentM = Math.max(maxX - minX, maxZ - minZ);
    const size = Math.min(256, Math.max(128, Math.floor(extentM / 2)));

    const { buildOverlayUrlsFromBbox } = await import('../../core/io/geo/overlayUrls.js');
    const { overlayUrl } = await buildOverlayUrlsFromBbox(sw, ne, size);

    boundary.data.overlayUrl = overlayUrl;
    boundary.data.overlayFallbackUrls = [];

    // Reload texture on overlay mesh
    const overlay = group.getObjectByName('overlay');
    if (overlay && overlay.material) {
        loadOverlayTexture([overlayUrl], overlay.material);
    }
}

/** Expand boundary by 10%. Amplia a boundary em 10%. */
export function handleExpandBoundary() {
    handleScaleBoundary(1.1);
}

/** Reduce boundary by 10%. Reduz a boundary em 10%. */
export function handleReduceBoundary() {
    handleScaleBoundary(0.9);
}

// ----------------------------------------------------------------
// SNAP HANDLERS
// ----------------------------------------------------------------

/**
 * Toggle snap on/off.
 */
export function handleToggleSnap() {
    const enabled = toggleSnap();
    const btn = document.getElementById('edit-ribbon-snap-btn');
    if (btn) btn.classList.toggle('active', enabled);
    showToast(enabled ? 'Snap ON' : 'Snap OFF', 'info');
}

/**
 * Set grid size from ribbon dropdown.
 * @param {number} size
 */
export function handleSetGridSize(size) {
    setGridSize(size);
}

// ----------------------------------------------------------------
// GIZMO HANDLERS
// ----------------------------------------------------------------

/**
 * Set gizmo transform mode.
 * @param {'translate'|'rotate'|'scale'} mode
 */
export function handleSetGizmoMode(mode) {
    setGizmoMode(mode);
    // Highlight active button
    ['translate', 'rotate', 'scale'].forEach((m) => {
        const btn = document.getElementById(`edit-ribbon-gizmo-${m}`);
        if (btn) btn.classList.toggle('active', m === mode);
    });
}

/**
 * Toggle world/local space.
 */
export function handleToggleGizmoSpace() {
    toggleGizmoSpace();
    const label = document.getElementById('edit-ribbon-space-label');
    if (label) label.textContent = getGizmoSpace() === 'world' ? 'World' : 'Local';
}

/**
 * Toggle between gizmo and shape edit modes.
 */
export function handleToggleGizmoShapeEdit() {
    toggleGizmoShapeEdit();
}

/**
 * Set individual coordinate from ribbon input.
 * @param {'x'|'y'|'z'} axis
 * @param {number} value
 */
export function handleSetCoordinate(axis, value) {
    if (!isEditing() || isNaN(value)) return;

    if (getEditMode() === 'gizmo') {
        // Gizmo mode: muda posicao do elemento inteiro
        import('../editing/gizmoController.js').then(({ getGizmoPosition, setGizmoPosition }) => {
            const pos = getGizmoPosition();
            if (!pos) return;
            pos[axis] = value;
            setGizmoPosition(pos);
        });
    }
    // Shape edit mode: TODO — mover vertice selecionado por coordenada
}

/**
 * All shape edit handler functions exposed to the HTML via window.
 */
export const shapeEditHandlers = {
    handleEnterShapeEdit,
    handleEnterGizmoMode,
    handleExitShapeEdit,
    handleToggleDrawMode,
    handleDeleteSelectedVertex,
    handleResetShape,
    handleExpandBoundary,
    handleReduceBoundary,
    handleToggleSnap,
    handleSetGridSize,
    handleSetGizmoMode,
    handleToggleGizmoSpace,
    handleToggleGizmoShapeEdit,
    handleSetCoordinate,
};
