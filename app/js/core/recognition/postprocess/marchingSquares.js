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
   MARCHING SQUARES — Pure-JS contour extraction from binary masks
   ================================================================

   Alternativa pura JS ao cv.findContours para quando OpenCV nao
   esta carregado. Extrai contornos (polylines) de mascaras binarias
   usando o algoritmo Marching Squares com interpolacao sub-pixel.

   Lookup table com 16 casos baseada na configuracao dos 4 cantos
   de cada celula (2x2 pixels). Cada caso define quais arestas da
   celula sao cruzadas pelo contorno.

   Complexidade: O(W * H) para uma varredura completa.
   Performance: < 50ms para mascara 512x512 tipica.

   ================================================================ */

// ----------------------------------------------------------------
// LOOKUP TABLE — 16 cell configurations
// Cada entrada: array de pares [from_edge, to_edge]
// Edges: 0=top, 1=right, 2=bottom, 3=left
// ----------------------------------------------------------------

// Configuracao dos 4 cantos (TL, TR, BR, BL) → bits 0-3
// Case 0 (0000) e Case 15 (1111): sem contorno (todos iguais)
// Cases 5 e 10: ambiguos (saddle points) → resolvidos pela media central
const EDGE_TABLE = [
    [], // 0:  0000 — all outside
    [[3, 2]], // 1:  0001 — BL inside
    [[2, 1]], // 2:  0010 — BR inside
    [[3, 1]], // 3:  0011 — BL+BR inside
    [[1, 0]], // 4:  0100 — TR inside
    [
        [3, 0],
        [1, 2],
    ], // 5:  0101 — BL+TR inside (saddle, default)
    [[2, 0]], // 6:  0010+0100 — BR+TR inside
    [[3, 0]], // 7:  0111 — BL+BR+TR inside
    [[0, 3]], // 8:  1000 — TL inside
    [[0, 2]], // 9:  1001 — TL+BL inside
    [
        [0, 1],
        [2, 3],
    ], // 10: 1010 — TL+BR inside (saddle, default)
    [[0, 1]], // 11: 1011 — TL+BL+BR inside
    [[1, 3]], // 12: 1100 — TL+TR inside
    [[1, 2]], // 13: 1101 — TL+TR+BL inside
    [[2, 3]], // 14: 1110 — TL+TR+BR inside
    [], // 15: 1111 — all inside
];

// ----------------------------------------------------------------
// MAIN FUNCTION — Extract all contours from binary mask
// ----------------------------------------------------------------

/**
 * Extract contour polygons from binary mask using Marching Squares.
 * Varre a mascara celula por celula, extrai segmentos de contorno,
 * e encadeia em polylines fechadas.
 *
 * @param {Uint8Array} mask - Binary mask (0 or 255), row-major
 * @param {number} width - Mask width in pixels
 * @param {number} height - Mask height in pixels
 * @param {number} [threshold=128] - Binary threshold
 * @returns {Array<Array<{x: number, y: number}>>} - Array of closed contour polylines
 */
export function marchingSquares(mask, width, height, threshold = 128) {
    // Grid de celulas: (width-1) x (height-1)
    const cw = width - 1;
    const ch = height - 1;

    // Passo 1: Gerar todos os segmentos de contorno
    // Cada segmento: { x1, y1, x2, y2 } com coordenadas sub-pixel
    const segments = [];

    for (let cy = 0; cy < ch; cy++) {
        for (let cx = 0; cx < cw; cx++) {
            // 4 cantos da celula (TL, TR, BR, BL)
            const tl = mask[cy * width + cx] >= threshold ? 1 : 0;
            const tr = mask[cy * width + cx + 1] >= threshold ? 1 : 0;
            const br = mask[(cy + 1) * width + cx + 1] >= threshold ? 1 : 0;
            const bl = mask[(cy + 1) * width + cx] >= threshold ? 1 : 0;

            const config = (tl << 3) | (tr << 2) | (br << 1) | bl;
            if (config === 0 || config === 15) continue;

            // Resolver saddle points pela media central
            let edges = EDGE_TABLE[config];
            if (config === 5 || config === 10) {
                const center =
                    (mask[cy * width + cx] +
                        mask[cy * width + cx + 1] +
                        mask[(cy + 1) * width + cx + 1] +
                        mask[(cy + 1) * width + cx]) /
                    4;
                if (config === 5 && center >= threshold) {
                    edges = [
                        [3, 2],
                        [1, 0],
                    ]; // Inverter saddle
                } else if (config === 10 && center >= threshold) {
                    edges = [
                        [0, 3],
                        [2, 1],
                    ]; // Inverter saddle
                }
            }

            // Interpolar posicao sub-pixel em cada aresta
            for (const [fromEdge, toEdge] of edges) {
                const p1 = _edgePoint(cx, cy, fromEdge, mask, width, threshold);
                const p2 = _edgePoint(cx, cy, toEdge, mask, width, threshold);
                segments.push(p1.x, p1.y, p2.x, p2.y);
            }
        }
    }

    // Passo 2: Encadear segmentos em polylines fechadas
    return _chainSegments(segments);
}

// ----------------------------------------------------------------
// SINGLE CONTOUR — Trace contour around a specific region
// ----------------------------------------------------------------

/**
 * Trace the outer contour starting from a specific seed point.
 * Util para SAM: dada mascara com um unico objeto, extrai contorno.
 *
 * @param {Uint8Array} mask - Binary mask
 * @param {number} width
 * @param {number} height
 * @param {number} [threshold=128]
 * @returns {Array<{x: number, y: number}>|null} - Largest contour or null
 */
export function largestContour(mask, width, height, threshold = 128) {
    const contours = marchingSquares(mask, width, height, threshold);
    if (contours.length === 0) return null;

    // Retorna o contorno com maior area
    let best = contours[0];
    let bestArea = _polyArea(best);

    for (let i = 1; i < contours.length; i++) {
        const area = _polyArea(contours[i]);
        if (area > bestArea) {
            bestArea = area;
            best = contours[i];
        }
    }

    return best;
}

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

/**
 * Compute sub-pixel point on a cell edge via linear interpolation.
 * Edges: 0=top, 1=right, 2=bottom, 3=left.
 *
 * @param {number} cx - Cell X
 * @param {number} cy - Cell Y
 * @param {number} edge - Edge index (0-3)
 * @param {Uint8Array} mask - Full mask
 * @param {number} w - Mask width
 * @param {number} threshold
 * @returns {{x: number, y: number}}
 */
function _edgePoint(cx, cy, edge, mask, w, threshold) {
    switch (edge) {
        case 0: {
            // Top edge: TL → TR
            const vl = mask[cy * w + cx];
            const vr = mask[cy * w + cx + 1];
            const t = _lerp(vl, vr, threshold);
            return { x: cx + t, y: cy };
        }
        case 1: {
            // Right edge: TR → BR
            const vt = mask[cy * w + cx + 1];
            const vb = mask[(cy + 1) * w + cx + 1];
            const t = _lerp(vt, vb, threshold);
            return { x: cx + 1, y: cy + t };
        }
        case 2: {
            // Bottom edge: BL → BR
            const vl = mask[(cy + 1) * w + cx];
            const vr = mask[(cy + 1) * w + cx + 1];
            const t = _lerp(vl, vr, threshold);
            return { x: cx + t, y: cy + 1 };
        }
        case 3: {
            // Left edge: TL → BL
            const vt = mask[cy * w + cx];
            const vb = mask[(cy + 1) * w + cx];
            const t = _lerp(vt, vb, threshold);
            return { x: cx, y: cy + t };
        }
        default:
            return { x: cx + 0.5, y: cy + 0.5 };
    }
}

/**
 * Linear interpolation parameter for threshold crossing.
 * Retorna t em [0,1] onde o threshold e cruzado entre v1 e v2.
 *
 * @param {number} v1 - Value at start
 * @param {number} v2 - Value at end
 * @param {number} threshold
 * @returns {number} - Interpolation parameter [0, 1]
 */
function _lerp(v1, v2, threshold) {
    const denom = v1 - v2;
    if (Math.abs(denom) < 1e-6) return 0.5;
    return Math.max(0, Math.min(1, (v1 - threshold) / denom));
}

/**
 * Chain loose segments into closed polylines.
 * Segmentos sao armazenados como flat array [x1,y1,x2,y2,...].
 * Usa hash espacial para encontrar segmentos vizinhos rapidamente.
 *
 * @param {Array<number>} segments - Flat array of segment coords
 * @returns {Array<Array<{x: number, y: number}>>}
 */
function _chainSegments(segments) {
    const numSegs = segments.length / 4;
    if (numSegs === 0) return [];

    // Hash espacial: arredonda coordenadas para chave
    // Precisao de 0.01 para agrupar pontos proximos
    const PRECISION = 100; // 1/100 = 0.01 pixel precision
    const key = (x, y) => `${Math.round(x * PRECISION)},${Math.round(y * PRECISION)}`;

    // Construir adjacency: endpoint → list of segment indices
    const adj = new Map();

    const addAdj = (k, segIdx, isEnd2) => {
        if (!adj.has(k)) adj.set(k, []);
        adj.get(k).push({ segIdx, isEnd2 });
    };

    for (let i = 0; i < numSegs; i++) {
        const base = i * 4;
        const k1 = key(segments[base], segments[base + 1]);
        const k2 = key(segments[base + 2], segments[base + 3]);
        addAdj(k1, i, false);
        addAdj(k2, i, true);
    }

    // Encadear segmentos
    const used = new Uint8Array(numSegs);
    const contours = [];

    for (let start = 0; start < numSegs; start++) {
        if (used[start]) continue;

        const chain = [];
        const current = start;
        used[current] = 1;

        // Adicionar primeiro segmento
        let base = current * 4;
        chain.push({ x: segments[base], y: segments[base + 1] }, { x: segments[base + 2], y: segments[base + 3] });

        // Seguir encadeamento do endpoint
        let searching = true;
        while (searching) {
            searching = false;
            const lastPt = chain[chain.length - 1];
            const k = key(lastPt.x, lastPt.y);
            const neighbors = adj.get(k);
            if (!neighbors) break;

            for (const { segIdx, isEnd2 } of neighbors) {
                if (used[segIdx]) continue;
                used[segIdx] = 1;
                searching = true;

                base = segIdx * 4;
                if (isEnd2) {
                    // Endpoint2 coincide → adicionar endpoint1 (reverso)
                    chain.push({ x: segments[base], y: segments[base + 1] });
                } else {
                    // Endpoint1 coincide → adicionar endpoint2
                    chain.push({ x: segments[base + 2], y: segments[base + 3] });
                }
                break;
            }
        }

        // Aceitar apenas contornos com area significativa (> 4 pixels)
        if (chain.length >= 4 && _polyArea(chain) > 4) {
            contours.push(chain);
        }
    }

    return contours;
}

/**
 * Polygon area via Shoelace (absolute value).
 * @param {Array<{x: number, y: number}>} pts
 * @returns {number}
 */
function _polyArea(pts) {
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += pts[i].x * pts[j].y;
        area -= pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2;
}
