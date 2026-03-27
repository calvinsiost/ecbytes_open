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
   SNAP ENGINE — Grid snapping + axis constraints for editing
   ================================================================

   Fornece snap-to-grid e snap-to-axis para uso no drag controller
   e no gizmo controller.

   Snap-to-grid: arredonda coordenadas XZ para multiplos do grid.
   Snap-to-axis: restringe drag ao eixo mais proximo (Shift).

   Configuracao persistida em localStorage.

   ================================================================ */

import { safeSetItem } from '../storage/storageMonitor.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

const GRID_SIZES = [0.1, 0.25, 0.5, 1, 2, 5, 10];
const DEFAULT_GRID = 1;

let _snapEnabled = localStorage.getItem('ecbyts-snap-enabled') === '1';
let _gridSize = parseFloat(localStorage.getItem('ecbyts-snap-grid')) || DEFAULT_GRID;

// Valida gridSize carregado
if (!GRID_SIZES.includes(_gridSize)) _gridSize = DEFAULT_GRID;

// ----------------------------------------------------------------
// SNAP TO GRID
// ----------------------------------------------------------------

/**
 * Arredonda posicao XZ para o grid. Y nao e alterado (terreno).
 *
 * @param {import('three').Vector3} position - Posicao a snapear (modificada in-place)
 * @param {number} [gridSize] - Override do grid size (usa config se omitido)
 * @returns {import('three').Vector3} A mesma referencia, modificada
 */
export function snapToGrid(position, gridSize) {
    const g = gridSize || _gridSize;
    position.x = Math.round(position.x / g) * g;
    position.z = Math.round(position.z / g) * g;
    return position;
}

// ----------------------------------------------------------------
// SNAP TO AXIS
// ----------------------------------------------------------------

/**
 * Restringe movimento ao eixo dominante (o com maior delta).
 * Usado quando Shift e pressionado durante drag.
 *
 * @param {import('three').Vector3} position - Posicao atual do drag
 * @param {import('three').Vector3} startPos - Posicao inicial do drag
 * @returns {{position: import('three').Vector3, axis: 'x'|'y'|'z'|null}} Posicao restringida + eixo dominante
 */
export function snapToAxis(position, startPos) {
    const dx = Math.abs(position.x - startPos.x);
    const dy = Math.abs(position.y - startPos.y);
    const dz = Math.abs(position.z - startPos.z);

    // Determina eixo dominante
    let axis;
    if (dx >= dy && dx >= dz) {
        axis = 'x';
        position.y = startPos.y;
        position.z = startPos.z;
    } else if (dy >= dx && dy >= dz) {
        axis = 'y';
        position.x = startPos.x;
        position.z = startPos.z;
    } else {
        axis = 'z';
        position.x = startPos.x;
        position.y = startPos.y;
    }

    return { position, axis };
}

// ----------------------------------------------------------------
// CONFIGURACAO
// ----------------------------------------------------------------

/** @returns {boolean} Se snap esta habilitado */
export function isSnapEnabled() {
    return _snapEnabled;
}

/** Alterna snap on/off */
export function toggleSnap() {
    _snapEnabled = !_snapEnabled;
    safeSetItem('ecbyts-snap-enabled', _snapEnabled ? '1' : '0');
    window.dispatchEvent(
        new CustomEvent('ecbt:snapChanged', {
            detail: { enabled: _snapEnabled, gridSize: _gridSize },
        }),
    );
    return _snapEnabled;
}

/** @returns {number} Grid size atual em metros */
export function getGridSize() {
    return _gridSize;
}

/**
 * Define grid size.
 * @param {number} size - Novo grid size (deve estar em GRID_SIZES)
 */
export function setGridSize(size) {
    if (!GRID_SIZES.includes(size)) return;
    _gridSize = size;
    safeSetItem('ecbyts-snap-grid', String(size));
    window.dispatchEvent(
        new CustomEvent('ecbt:snapChanged', {
            detail: { enabled: _snapEnabled, gridSize: _gridSize },
        }),
    );
}

/** @returns {number[]} Lista de grid sizes disponiveis */
export function getAvailableGridSizes() {
    return [...GRID_SIZES];
}
