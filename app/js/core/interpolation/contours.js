// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   CONTOURS - Generic isoline extraction from regular grids
   ================================================================

   Generic utility for contour extraction via Marching Squares.
   Domain-agnostic: receives only grid/bounds/levels and returns
   polylines that can be rendered by any layer type.
   ================================================================ */

const KEY_PRECISION = 6;

/**
 * Generate contour levels across grid stats.
 * @param {Float32Array|number[]} grid
 * @param {number} levelCount
 * @returns {number[]}
 */
export function generateContourLevels(grid, levelCount = 10) {
    if (!grid || grid.length === 0) return [];
    const n = Math.max(2, Number(levelCount) || 10);

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < grid.length; i++) {
        const v = Number(grid[i]);
        if (!Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [];

    const levels = [];
    const step = (max - min) / (n + 1);
    for (let i = 1; i <= n; i++) {
        levels.push(min + step * i);
    }
    return levels;
}

/**
 * Build contour polylines from a regular grid.
 * @param {Object} opts
 * @param {Float32Array|number[]} opts.grid
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} opts.bounds
 * @param {{cols:number,rows:number}} opts.gridSize
 * @param {number[]} [opts.levels]
 * @param {number} [opts.levelCount]
 * @returns {Array<{level:number, points:Array<{x:number,z:number}>}>}
 */
export function buildContoursFromGrid(opts) {
    const { grid, bounds, gridSize, levels, levelCount = 10 } = opts || {};
    if (!grid || !bounds || !gridSize) return [];

    const cols = Number(gridSize.cols);
    const rows = Number(gridSize.rows);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) return [];
    if (grid.length !== cols * rows) return [];

    const useLevels =
        Array.isArray(levels) && levels.length > 0
            ? levels.filter(Number.isFinite)
            : generateContourLevels(grid, levelCount);
    if (useLevels.length === 0) return [];

    const dx = (bounds.maxX - bounds.minX) / (cols - 1);
    const dz = (bounds.maxZ - bounds.minZ) / (rows - 1);

    const all = [];
    for (const level of useLevels) {
        const segments = [];
        for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < cols - 1; c++) {
                _extractCellSegments({
                    grid,
                    rows,
                    cols,
                    r,
                    c,
                    level,
                    minX: bounds.minX,
                    minZ: bounds.minZ,
                    dx,
                    dz,
                    segments,
                });
            }
        }
        const polylines = _stitchSegments(segments);
        for (const points of polylines) {
            if (points.length >= 2) all.push({ level, points });
        }
    }

    return all;
}

function _extractCellSegments(ctx) {
    const { grid, cols, r, c, level, minX, minZ, dx, dz, segments } = ctx;
    const idx = r * cols + c;

    const v00 = grid[idx];
    const v10 = grid[idx + 1];
    const v01 = grid[idx + cols];
    const v11 = grid[idx + cols + 1];

    if (![v00, v10, v01, v11].every(Number.isFinite)) return;

    const x0 = minX + c * dx;
    const x1 = x0 + dx;
    const z0 = minZ + r * dz;
    const z1 = z0 + dz;

    const crossings = [];
    _pushCrossing(crossings, v00, v10, level, { x: x0, z: z0 }, { x: x1, z: z0 }); // top
    _pushCrossing(crossings, v10, v11, level, { x: x1, z: z0 }, { x: x1, z: z1 }); // right
    _pushCrossing(crossings, v11, v01, level, { x: x1, z: z1 }, { x: x0, z: z1 }); // bottom
    _pushCrossing(crossings, v01, v00, level, { x: x0, z: z1 }, { x: x0, z: z0 }); // left

    if (crossings.length === 2) {
        segments.push([crossings[0], crossings[1]]);
        return;
    }

    // Ambiguous case (4 crossings): asymptotic-style pairing with center value.
    if (crossings.length === 4) {
        const center = (v00 + v10 + v01 + v11) / 4;
        if (center >= level) {
            segments.push([crossings[0], crossings[1]]);
            segments.push([crossings[2], crossings[3]]);
        } else {
            segments.push([crossings[0], crossings[3]]);
            segments.push([crossings[1], crossings[2]]);
        }
    }
}

function _pushCrossing(out, a, b, level, p0, p1) {
    const crosses = (a < level && b >= level) || (a >= level && b < level);
    if (!crosses) return;
    const t = (level - a) / (b - a);
    out.push({
        x: p0.x + (p1.x - p0.x) * t,
        z: p0.z + (p1.z - p0.z) * t,
    });
}

function _stitchSegments(segments) {
    const unused = segments.slice();
    const lines = [];

    while (unused.length > 0) {
        const [a, b] = unused.pop();
        const line = [a, b];

        let changed = true;
        while (changed) {
            changed = false;
            for (let i = unused.length - 1; i >= 0; i--) {
                const [p0, p1] = unused[i];
                const sKey = _ptKey(line[0]);
                const eKey = _ptKey(line[line.length - 1]);
                const p0Key = _ptKey(p0);
                const p1Key = _ptKey(p1);

                if (eKey === p0Key) {
                    line.push(p1);
                    unused.splice(i, 1);
                    changed = true;
                    continue;
                }
                if (eKey === p1Key) {
                    line.push(p0);
                    unused.splice(i, 1);
                    changed = true;
                    continue;
                }
                if (sKey === p1Key) {
                    line.unshift(p0);
                    unused.splice(i, 1);
                    changed = true;
                    continue;
                }
                if (sKey === p0Key) {
                    line.unshift(p1);
                    unused.splice(i, 1);
                    changed = true;
                }
            }
        }

        lines.push(line);
    }

    return lines;
}

function _ptKey(p) {
    return `${p.x.toFixed(KEY_PRECISION)},${p.z.toFixed(KEY_PRECISION)}`;
}
