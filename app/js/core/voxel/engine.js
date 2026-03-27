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
   VOXEL ENGINE — 3D grid classification from surfaces
   Motor de voxelizacao — classifica celulas 3D a partir de superficies

   Recebe funcoes de amostragem de superficies (terreno, lencol)
   e preenche um grid 3D (Uint8Array) com IDs de zona.
   O engine e puro (sem Three.js) — so faz calculo.

   INDEXACAO: row-major XYZ
     index = iz * (ny * nx) + iy * nx + ix
     worldX = bounds.minX + ix * resolution + resolution/2
     worldY = yRange.bottom + iy * resolution + resolution/2
     worldZ = bounds.minZ + iz * resolution + resolution/2
   ================================================================ */

// Zone IDs — devem corresponder ao colorSchemes.js
const EMPTY = 0;
const VADOSE = 1;
const SATURATED = 2;

/**
 * Generate a classified 3D voxel grid from surface samplers.
 * Gera grid 3D classificado: cada celula recebe um zone ID
 * baseado na posicao relativa ao terreno e lencol freatico.
 *
 * @param {Object} bounds  - { minX, maxX, minZ, maxZ } horizontal extent
 * @param {Object} yRange  - { top: number, bottom: number } vertical range
 * @param {number} resolution - voxel size in meters (ex: 1, 2, 5, 10)
 * @param {Function} sampleTop - (x, z) => y terrain elevation
 * @param {Function} sampleDivider - (x, z) => y water table elevation
 * @returns {{ grid: Uint8Array, dims: { nx: number, ny: number, nz: number } }}
 */
export function voxelize(bounds, yRange, resolution, sampleTop, sampleDivider) {
    const nx = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / resolution));
    const ny = Math.max(1, Math.ceil((yRange.top - yRange.bottom) / resolution));
    const nz = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / resolution));

    const total = nx * ny * nz;
    const grid = new Uint8Array(total);

    const halfRes = resolution / 2;

    for (let iz = 0; iz < nz; iz++) {
        const worldZ = bounds.minZ + iz * resolution + halfRes;

        for (let ix = 0; ix < nx; ix++) {
            const worldX = bounds.minX + ix * resolution + halfRes;

            // Amosta superficies uma vez por coluna (x,z)
            const terrainY = sampleTop(worldX, worldZ);
            const waterTableY = sampleDivider(worldX, worldZ);

            for (let iy = 0; iy < ny; iy++) {
                const worldY = yRange.bottom + iy * resolution + halfRes;
                const idx = iz * (ny * nx) + iy * nx + ix;

                if (worldY > terrainY) {
                    // Acima do terreno — vazio
                    grid[idx] = EMPTY;
                } else if (worldY > waterTableY) {
                    // Entre terreno e lencol — zona vadosa
                    grid[idx] = VADOSE;
                } else {
                    // Abaixo do lencol — zona saturada
                    grid[idx] = SATURATED;
                }
            }
        }
    }

    return { grid, dims: { nx, ny, nz } };
}

/**
 * Count voxels of a specific zone.
 * Conta quantos voxels pertencem a uma zona.
 *
 * @param {Uint8Array} grid - flat 3D grid
 * @param {number} zoneId - zone ID to count
 * @returns {number}
 */
export function countByZone(grid, zoneId) {
    let count = 0;
    for (let i = 0; i < grid.length; i++) {
        if (grid[i] === zoneId) count++;
    }
    return count;
}

/**
 * Sample the zone at a world position.
 * Retorna o zone ID no ponto (x, y, z) do mundo.
 *
 * @param {Object} volume - VoxelVolume object
 * @param {number} x - world X
 * @param {number} y - world Y
 * @param {number} z - world Z
 * @returns {number} zone ID (0 if out of bounds)
 */
export function getVoxelAt(volume, x, y, z) {
    const { bounds, yRange, resolution, dims, grid } = volume;
    const ix = Math.floor((x - bounds.minX) / resolution);
    const iy = Math.floor((y - yRange.bottom) / resolution);
    const iz = Math.floor((z - bounds.minZ) / resolution);

    if (ix < 0 || ix >= dims.nx) return EMPTY;
    if (iy < 0 || iy >= dims.ny) return EMPTY;
    if (iz < 0 || iz >= dims.nz) return EMPTY;

    return grid[iz * (dims.ny * dims.nx) + iy * dims.nx + ix];
}

/**
 * Estimate a good default resolution based on model area.
 * Escolhe resolucao para manter voxel count abaixo do limite.
 *
 * @param {Object} bounds - { minX, maxX, minZ, maxZ }
 * @param {Object} yRange - { top, bottom }
 * @param {number} [maxVoxels=200000] - target max voxel count
 * @returns {number} resolution in meters (1, 2, 5, or 10)
 */
export function suggestResolution(bounds, yRange, maxVoxels = 200000) {
    const dx = bounds.maxX - bounds.minX;
    const dy = yRange.top - yRange.bottom;
    const dz = bounds.maxZ - bounds.minZ;
    const volume = dx * dy * dz;

    for (const res of [1, 2, 5, 10]) {
        const count = Math.ceil(dx / res) * Math.ceil(dy / res) * Math.ceil(dz / res);
        if (count <= maxVoxels) return res;
    }
    return 10;
}

// Re-export zone constants for external use
export { EMPTY, VADOSE, SATURATED };
