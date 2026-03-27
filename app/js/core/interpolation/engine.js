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
   INTERPOLATION ENGINE — Algoritmos de interpolação espacial
   ================================================================

   Motor matemático puro para interpolação de dados pontuais em
   grids regulares. Três métodos disponíveis:

   1. IDW (Inverse Distance Weighting) — rápido, zero dependências
   2. RBF (Radial Basis Function) — superfícies suaves, thin-plate
   3. Kriging — padrão-ouro em geoestatística ambiental

   INTERFACE UNIFICADA:
   interpolateGrid(points, bounds, gridSize, method, params) → Float32Array

   Cada método recebe pontos {x, z, value} e retorna grid row-major.
   RBF e Kriging são lazy-loaded via dynamic import (CDN).

   ================================================================ */

// ----------------------------------------------------------------
// IDW — Inverse Distance Weighting
// ----------------------------------------------------------------

/**
 * Interpolação IDW para um ponto de consulta.
 * Pondera valores conhecidos pelo inverso da distância elevado a 'power'.
 *
 * @param {Array<{x: number, z: number, value: number}>} points - dados conhecidos
 * @param {number} qx - coordenada X de consulta
 * @param {number} qz - coordenada Z de consulta
 * @param {number} power - expoente de distância (default 2)
 * @returns {number} valor interpolado
 */
function idwPoint(points, qx, qz, power = 2) {
    let numerator = 0;
    let denominator = 0;
    for (const p of points) {
        const d = Math.hypot(p.x - qx, p.z - qz);
        if (d < 1e-10) return p.value; // ponto exato
        const w = 1 / Math.pow(d, power);
        numerator += w * p.value;
        denominator += w;
    }
    return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Gera grid IDW completo.
 * @param {Array} points
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds
 * @param {{cols: number, rows: number}} gridSize
 * @param {{power?: number}} params
 * @param {Function} [onProgress] - callback(pct) com 0..1
 * @returns {Float32Array} grid row-major [rows * cols]
 */
function idwGrid(points, bounds, gridSize, params = {}, onProgress) {
    const { power = 2 } = params;
    const { cols, rows } = gridSize;
    const grid = new Float32Array(rows * cols);
    const dx = (bounds.maxX - bounds.minX) / (cols - 1);
    const dz = (bounds.maxZ - bounds.minZ) / (rows - 1);

    for (let r = 0; r < rows; r++) {
        const qz = bounds.minZ + r * dz;
        for (let c = 0; c < cols; c++) {
            const qx = bounds.minX + c * dx;
            grid[r * cols + c] = idwPoint(points, qx, qz, power);
        }
        if (onProgress && r % 8 === 0) onProgress(r / rows);
    }
    return grid;
}

// ----------------------------------------------------------------
// RBF — Radial Basis Function (lazy-loaded)
// ----------------------------------------------------------------

import { importCDN } from '../../utils/helpers/cdnLoader.js';

/** @type {Function|null} cache do módulo RBF */
let _rbfModule = null;

/**
 * Carrega módulo RBF sob demanda (thin-plate spline).
 * @returns {Promise<Function>}
 */
async function loadRBF() {
    if (_rbfModule) return _rbfModule;
    _rbfModule = await importCDN('https://esm.sh/rbf@1.1.5', { name: 'RBF' });
    return _rbfModule;
}

/**
 * Gera grid RBF.
 * @param {Array} points
 * @param {Object} bounds
 * @param {Object} gridSize
 * @param {{kernel?: string}} params - kernel: 'thin-plate' | 'gaussian' | 'multiquadric'
 * @param {Function} [onProgress]
 * @returns {Promise<Float32Array>}
 */
async function rbfGrid(points, bounds, gridSize, params = {}, onProgress) {
    const rbf = await loadRBF();
    const { kernel = 'thin-plate' } = params;
    const { cols, rows } = gridSize;

    // Prepara dados para rbf(points, values, kernel)
    const coords = points.map((p) => [p.x, p.z]);
    const values = points.map((p) => p.value);
    const interpolate = rbf(coords, values, kernel);

    const grid = new Float32Array(rows * cols);
    const dx = (bounds.maxX - bounds.minX) / (cols - 1);
    const dz = (bounds.maxZ - bounds.minZ) / (rows - 1);

    for (let r = 0; r < rows; r++) {
        const qz = bounds.minZ + r * dz;
        for (let c = 0; c < cols; c++) {
            const qx = bounds.minX + c * dx;
            grid[r * cols + c] = interpolate([qx, qz]);
        }
        if (onProgress && r % 8 === 0) onProgress(r / rows);
    }
    return grid;
}

// ----------------------------------------------------------------
// KRIGING — Ordinary Kriging (implementacao propria)
// ----------------------------------------------------------------

import { train as krigingTrain, predict as krigingPredict } from './kriging.js';

/**
 * Gera grid Kriging.
 * Usa implementacao propria com semi-variogramas documentados
 * (esferico/exponencial/gaussiano). Sem dependencia CDN.
 *
 * @param {Array} points
 * @param {Object} bounds
 * @param {Object} gridSize
 * @param {{model?: string, sigma2?: number, alpha?: number}} params
 * @param {Function} [onProgress]
 * @returns {Promise<Float32Array>}
 */
async function krigingGrid(points, bounds, gridSize, params = {}, onProgress) {
    const { model = 'spherical', sigma2 = 0, alpha = 100 } = params;
    const { cols, rows } = gridSize;

    // Treina variograma
    const t = points.map((p) => p.value);
    const x = points.map((p) => p.x);
    const y = points.map((p) => p.z);
    const variogram = krigingTrain(t, x, y, model, sigma2, alpha);

    const grid = new Float32Array(rows * cols);
    const dx = (bounds.maxX - bounds.minX) / (cols - 1);
    const dz = (bounds.maxZ - bounds.minZ) / (rows - 1);

    for (let r = 0; r < rows; r++) {
        const qz = bounds.minZ + r * dz;
        for (let c = 0; c < cols; c++) {
            const qx = bounds.minX + c * dx;
            grid[r * cols + c] = krigingPredict(qx, qz, variogram);
        }
        if (onProgress && r % 8 === 0) onProgress(r / rows);
    }
    return grid;
}

// ----------------------------------------------------------------
// INTERFACE UNIFICADA
// ----------------------------------------------------------------

/**
 * Interpola pontos dispersos em um grid regular.
 *
 * @param {Array<{x: number, z: number, value: number}>} points - dados de entrada
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds - limites do grid
 * @param {{cols: number, rows: number}} gridSize - resolução do grid
 * @param {'idw'|'rbf'|'kriging'} method - algoritmo
 * @param {Object} [params] - parâmetros específicos do método
 * @param {Function} [onProgress] - callback(pct) 0..1
 * @returns {Promise<{grid: Float32Array, stats: {min: number, max: number, mean: number}}>}
 */
export async function interpolateGrid(points, bounds, gridSize, method = 'idw', params = {}, onProgress) {
    if (!points || points.length === 0) {
        throw new Error('Nenhum ponto de dados para interpolação');
    }
    if (points.length === 1) {
        // Caso especial: apenas um ponto — grid constante
        const grid = new Float32Array(gridSize.rows * gridSize.cols);
        grid.fill(points[0].value);
        return { grid, stats: { min: points[0].value, max: points[0].value, mean: points[0].value } };
    }

    let grid;
    switch (method) {
        case 'rbf':
            grid = await rbfGrid(points, bounds, gridSize, params, onProgress);
            break;
        case 'kriging':
            grid = await krigingGrid(points, bounds, gridSize, params, onProgress);
            break;
        case 'idw':
        default:
            grid = idwGrid(points, bounds, gridSize, params, onProgress);
            break;
    }
    _assertRegularGrid(grid, gridSize, method);

    // Calcula estatísticas
    let min = Infinity,
        max = -Infinity,
        sum = 0;
    for (let i = 0; i < grid.length; i++) {
        const v = grid[i];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
    }
    const mean = sum / grid.length;
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(mean)) {
        throw new Error(`Interpolacao ${method} retornou estatisticas invalidas`);
    }

    if (onProgress) onProgress(1);

    return { grid, stats: { min, max, mean } };
}

/**
 * Métodos disponíveis com metadados.
 */
export const INTERPOLATION_METHODS = {
    idw: { id: 'idw', name: 'IDW', description: 'Inverse Distance Weighting', async: false },
    rbf: { id: 'rbf', name: 'RBF', description: 'Radial Basis Function', async: true },
    kriging: { id: 'kriging', name: 'Kriging', description: 'Ordinary Kriging (sem CDN)', async: false },
};

function _assertRegularGrid(grid, gridSize, method) {
    const expected = (gridSize?.rows || 0) * (gridSize?.cols || 0);
    if (!grid || typeof grid.length !== 'number') {
        throw new Error(`Interpolacao ${method} retornou grid vazio`);
    }
    if (grid.length !== expected) {
        throw new Error(`Interpolacao ${method} retornou grid irregular (${grid.length} != ${expected})`);
    }
    for (let i = 0; i < grid.length; i++) {
        if (!Number.isFinite(grid[i])) {
            throw new Error(`Interpolacao ${method} retornou valor invalido no indice ${i}`);
        }
    }
}
