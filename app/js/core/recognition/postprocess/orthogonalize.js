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
   ORTHOGONALIZE — Global axis-aligned building regularization
   ================================================================

   Algoritmo de ortogonalizacao global para edificios detectados por
   IA. Diferente do regularizePolygon (simplify.js) que opera
   localmente vertice-a-vertice, este modulo detecta a orientacao
   dominante do poligono e forca TODAS as arestas a se alinharem
   ao eixo dominante ou sua perpendicular.

   Pipeline:
   1. Detecta orientacao dominante (histograma ponderado por comprimento)
   2. Classifica arestas (dominant / perpendicular / oblique)
   3. Snap arestas para angulos exatos
   4. Reconstroi vertices distribuindo erro de fechamento
   5. Valida: area preservada ±15%, sem auto-intersecoes

   Suporta formas L, T, U: se contourRectFillRatio < 0.85, mantém
   poligono multi-aresta ortogonal em vez de colapsar para retangulo.

   ================================================================ */

const TWO_PI = 2 * Math.PI;
const HALF_PI = Math.PI / 2;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ----------------------------------------------------------------
// DOMINANT ORIENTATION — Weighted edge angle histogram
// Histograma de angulos ponderado por comprimento de aresta
// ----------------------------------------------------------------

/**
 * Compute dominant edge orientation of a polygon.
 * Calcula orientacao dominante ponderada por comprimento de aresta.
 * Angulos sao mapeados para [0, PI/2) pois direcoes opostas sao
 * equivalentes para edificios (norte=sul, leste=oeste).
 *
 * @param {Array<{x: number, y: number}>} vertices - Polygon vertices
 * @returns {number} - Dominant angle in radians [0, PI/2)
 */
export function dominantOrientation(vertices) {
    if (vertices.length < 3) return 0;

    const n = vertices.length;
    // Histograma com bins de 1 grau (90 bins para [0, 90))
    const BINS = 90;
    const hist = new Float64Array(BINS);

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dx = vertices[j].x - vertices[i].x;
        const dy = vertices[j].y - vertices[i].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-6) continue;

        // Map angle to [0, PI/2) — direcoes opostas sao equivalentes
        let angle = Math.atan2(dy, dx);
        angle = ((angle % Math.PI) + Math.PI) % Math.PI; // [0, PI)
        if (angle >= HALF_PI) angle -= HALF_PI; // [0, PI/2)

        const bin = Math.min(Math.floor(angle * RAD_TO_DEG), BINS - 1);
        hist[bin] += len; // Peso = comprimento da aresta
    }

    // Encontra o bin com maior peso (peak)
    let peakBin = 0;
    let peakVal = 0;
    for (let b = 0; b < BINS; b++) {
        if (hist[b] > peakVal) {
            peakVal = hist[b];
            peakBin = b;
        }
    }

    // Media ponderada circular ao redor do peak (±5 bins)
    const WINDOW = 5;
    let sumAngle = 0;
    let sumWeight = 0;
    for (let d = -WINDOW; d <= WINDOW; d++) {
        const b = (((peakBin + d) % BINS) + BINS) % BINS;
        const w = hist[b];
        if (w > 0) {
            // Usar offset do peak para evitar descontinuidade circular
            sumAngle += d * w;
            sumWeight += w;
        }
    }

    const refinedBin = peakBin + (sumWeight > 0 ? sumAngle / sumWeight : 0);
    return (((refinedBin % BINS) + BINS) % BINS) * DEG_TO_RAD;
}

// ----------------------------------------------------------------
// MINIMUM BOUNDING RECTANGLE — Rotating calipers
// Retangulo minimo orientado que contem todos os vertices
// ----------------------------------------------------------------

/**
 * Compute convex hull of 2D points using Andrew's monotone chain.
 * Retorna vertices em ordem CCW.
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {Array<{x: number, y: number}>}
 */
function convexHull(points) {
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const n = pts.length;
    if (n <= 2) return pts.slice();

    const lower = [];
    for (let i = 0; i < n; i++) {
        while (lower.length >= 2 && _cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) {
            lower.pop();
        }
        lower.push(pts[i]);
    }

    const upper = [];
    for (let i = n - 1; i >= 0; i--) {
        while (upper.length >= 2 && _cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) {
            upper.pop();
        }
        upper.push(pts[i]);
    }

    // Remove last point of each half (duplicated at junction)
    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

/**
 * Minimum Bounding Rectangle (MBR) via rotating calipers.
 * Retangulo minimo orientado que contem todos os vertices.
 * Testa cada aresta do convex hull como base do retangulo.
 *
 * @param {Array<{x: number, y: number}>} vertices
 * @returns {{ corners: Array<{x: number, y: number}>, angle: number, width: number, height: number }}
 */
export function minimumBoundingRectangle(vertices) {
    if (vertices.length < 3) {
        return { corners: vertices.slice(), angle: 0, width: 0, height: 0 };
    }

    const hull = convexHull(vertices);
    const n = hull.length;
    if (n < 3) {
        return { corners: hull.slice(), angle: 0, width: 0, height: 0 };
    }

    let bestArea = Infinity;
    let bestCorners = null;
    let bestAngle = 0;
    let bestW = 0;
    let bestH = 0;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const edgeDx = hull[j].x - hull[i].x;
        const edgeDy = hull[j].y - hull[i].y;
        const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
        if (edgeLen < 1e-10) continue;

        // Eixo da aresta (unitario)
        const ux = edgeDx / edgeLen;
        const uy = edgeDy / edgeLen;
        // Perpendicular
        const vx = -uy;
        const vy = ux;

        // Projetar todos os pontos do hull nos dois eixos
        let minU = Infinity,
            maxU = -Infinity;
        let minV = Infinity,
            maxV = -Infinity;

        for (let k = 0; k < n; k++) {
            const px = hull[k].x - hull[i].x;
            const py = hull[k].y - hull[i].y;
            const projU = px * ux + py * uy;
            const projV = px * vx + py * vy;
            if (projU < minU) minU = projU;
            if (projU > maxU) maxU = projU;
            if (projV < minV) minV = projV;
            if (projV > maxV) maxV = projV;
        }

        const w = maxU - minU;
        const h = maxV - minV;
        const area = w * h;

        if (area < bestArea) {
            bestArea = area;
            bestW = w;
            bestH = h;
            bestAngle = Math.atan2(uy, ux);

            // 4 cantos do retangulo no espaco original
            const ox = hull[i].x;
            const oy = hull[i].y;
            bestCorners = [
                { x: ox + minU * ux + minV * vx, y: oy + minU * uy + minV * vy },
                { x: ox + maxU * ux + minV * vx, y: oy + maxU * uy + minV * vy },
                { x: ox + maxU * ux + maxV * vx, y: oy + maxU * uy + maxV * vy },
                { x: ox + minU * ux + maxV * vx, y: oy + minU * uy + maxV * vy },
            ];
        }
    }

    return {
        corners: bestCorners || vertices.slice(0, 4),
        angle: bestAngle,
        width: bestW,
        height: bestH,
    };
}

// ----------------------------------------------------------------
// ORTHOGONALIZE — Main algorithm
// Forca todas as arestas para dominant axis ou perpendicular
// ----------------------------------------------------------------

/**
 * Orthogonalize a building polygon to dominant axis + perpendicular.
 * Transforma poligono irregular em geometria com angulos estritamente 90/180.
 *
 * Algoritmo global (diferente do regularizePolygon local):
 * 1. Detecta orientacao dominante do poligono inteiro
 * 2. Classifica cada aresta como dominant/perpendicular/oblique
 * 3. Snap arestas para angulos exatos
 * 4. Reconstroi vertices distribuindo erro de fechamento
 * 5. Valida resultado; fallback para MBR se necessario
 *
 * @param {Array<{x: number, y: number}>} vertices - Input polygon
 * @param {Object} [options={}]
 * @param {number} [options.angleTolerance=20] - Degrees within which to snap
 * @param {number} [options.minEdgeLength=3] - Min edge length to preserve (pixels)
 * @param {boolean} [options.forceRect=false] - If true, always output 4-vertex MBR
 * @returns {Array<{x: number, y: number}>} - Orthogonalized polygon
 */
export function orthogonalize(vertices, options = {}) {
    const { angleTolerance = 20, minEdgeLength = 3, forceRect = false } = options;

    if (vertices.length < 3) return vertices.slice();

    // Calcular area original para validacao posterior
    const originalArea = _polygonArea(vertices);
    if (originalArea < 1) return vertices.slice();

    // Forcar retangulo se solicitado
    if (forceRect) {
        return minimumBoundingRectangle(vertices).corners;
    }

    // Verificar se e retangular simples (fill ratio > 0.85)
    const mbr = minimumBoundingRectangle(vertices);
    const mbrArea = mbr.width * mbr.height;
    const fillRatio = mbrArea > 0 ? originalArea / mbrArea : 0;

    if (fillRatio > 0.85 && vertices.length <= 6) {
        // Poligono quase retangular → colapsar para MBR
        return mbr.corners;
    }

    // --- Algoritmo completo para formas L/T/U ---

    const dominant = dominantOrientation(vertices);
    const tolRad = angleTolerance * DEG_TO_RAD;
    const n = vertices.length;

    // Passo 1: Classificar e snap cada aresta
    const edges = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dx = vertices[j].x - vertices[i].x;
        const dy = vertices[j].y - vertices[i].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        edges.push({ dx, dy, len, angle, from: i, to: j });
    }

    // Remover arestas muito curtas (merging com vizinhas)
    const filtered = edges.filter((e) => e.len >= minEdgeLength);
    if (filtered.length < 3) {
        // Muito poucas arestas apos filtro → MBR
        return mbr.corners;
    }

    // Snap cada aresta para o angulo dominante mais proximo
    const snappedEdges = filtered.map((e) => {
        const snapAngle = _snapToAxis(e.angle, dominant, tolRad);
        return {
            len: e.len,
            angle: snapAngle,
            originalAngle: e.angle,
        };
    });

    // Passo 2: Reconstruir vertices a partir de arestas snapped
    const reconstructed = [{ x: vertices[0].x, y: vertices[0].y }];
    for (let i = 0; i < snappedEdges.length - 1; i++) {
        const e = snappedEdges[i];
        const prev = reconstructed[reconstructed.length - 1];
        reconstructed.push({
            x: prev.x + Math.cos(e.angle) * e.len,
            y: prev.y + Math.sin(e.angle) * e.len,
        });
    }

    // Passo 3: Distribuir erro de fechamento
    // Gap = diferenca entre ultimo vertice reconstruido e primeiro
    const last = reconstructed[reconstructed.length - 1];
    const lastEdge = snappedEdges[snappedEdges.length - 1];
    const expectedEnd = {
        x: last.x + Math.cos(lastEdge.angle) * lastEdge.len,
        y: last.y + Math.sin(lastEdge.angle) * lastEdge.len,
    };

    const gapX = reconstructed[0].x - expectedEnd.x;
    const gapY = reconstructed[0].y - expectedEnd.y;

    // Distribuir gap proporcionalmente
    const totalVerts = reconstructed.length;
    for (let i = 1; i < totalVerts; i++) {
        const t = i / totalVerts;
        reconstructed[i].x += gapX * t;
        reconstructed[i].y += gapY * t;
    }

    // Passo 4: Validacao
    const newArea = _polygonArea(reconstructed);
    const areaRatio = originalArea > 0 ? newArea / originalArea : 0;

    // Area preservada dentro de ±15%?
    if (areaRatio < 0.85 || areaRatio > 1.15) {
        // Ortogonalizacao distorceu demais → fallback MBR
        return mbr.corners;
    }

    // Auto-intersecao?
    if (_hasSelfIntersection(reconstructed)) {
        return mbr.corners;
    }

    return reconstructed;
}

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

/**
 * Snap an angle to the nearest dominant axis direction.
 * Eixos candidatos: dominant, dominant+90, dominant+180, dominant+270.
 *
 * @param {number} angle - Edge angle in radians
 * @param {number} dominant - Dominant axis in radians [0, PI/2)
 * @param {number} tolerance - Snap tolerance in radians
 * @returns {number} - Snapped angle or original if outside tolerance
 */
function _snapToAxis(angle, dominant, tolerance) {
    // 4 direcoes candidatas (cada 90 graus a partir do dominante)
    const candidates = [dominant, dominant + HALF_PI, dominant + Math.PI, dominant + HALF_PI * 3];

    let bestDiff = Infinity;
    let bestCandidate = angle;

    for (const c of candidates) {
        // Diferenca angular normalizada para [-PI, PI]
        let diff = angle - c;
        diff = ((((diff + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
        const absDiff = Math.abs(diff);

        if (absDiff < bestDiff) {
            bestDiff = absDiff;
            bestCandidate = c;
        }
    }

    // Snap somente se dentro da tolerancia
    return bestDiff <= tolerance ? bestCandidate : angle;
}

/**
 * Calculate signed area of polygon (Shoelace formula).
 * Area positiva = CCW, negativa = CW. Retorna valor absoluto.
 *
 * @param {Array<{x: number, y: number}>} verts
 * @returns {number} - Absolute area
 */
function _polygonArea(verts) {
    let area = 0;
    const n = verts.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += verts[i].x * verts[j].y;
        area -= verts[j].x * verts[i].y;
    }
    return Math.abs(area) / 2;
}

/**
 * Check if polygon has self-intersections.
 * Testa todos os pares de arestas nao-adjacentes por intersecao.
 * O(n^2) mas n e pequeno (< 20 vertices tipicamente).
 *
 * @param {Array<{x: number, y: number}>} verts
 * @returns {boolean}
 */
function _hasSelfIntersection(verts) {
    const n = verts.length;
    if (n < 4) return false;

    for (let i = 0; i < n; i++) {
        const i2 = (i + 1) % n;
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue; // Arestas adjacentes (wrap)
            const j2 = (j + 1) % n;
            if (_segmentsIntersect(verts[i], verts[i2], verts[j], verts[j2])) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Test if two line segments intersect (proper intersection only).
 * @param {{x:number,y:number}} a1
 * @param {{x:number,y:number}} a2
 * @param {{x:number,y:number}} b1
 * @param {{x:number,y:number}} b2
 * @returns {boolean}
 */
function _segmentsIntersect(a1, a2, b1, b2) {
    const d1 = _cross(a1, a2, b1);
    const d2 = _cross(a1, a2, b2);
    const d3 = _cross(b1, b2, a1);
    const d4 = _cross(b1, b2, a2);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }
    return false;
}

/**
 * Cross product of vectors (O→A) and (O→B).
 * Positivo = B esta a esquerda de OA (CCW).
 *
 * @param {{x:number,y:number}} o
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {number}
 */
function _cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
