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
   SIMPLIFY — Adaptive polygon simplification & regularization
   ================================================================

   Funcoes matematicas puras para pos-processamento de contornos
   extraidos pelo OpenCV. Sem dependencias externas (exceto cv para
   esqueletonizacao).

   ESTRATEGIA DE SIMPLIFICACAO POR FAMILIA:
   - Buildings: epsilon alto (3.0) → poucos vertices, linhas retas
   - Vegetation: epsilon baixo (1.0) → muitos vertices, curvas suaves
   - Water: epsilon moderado (1.5) → shorelines organicos
   - Roads: epsilon medio (2.0) → simplificacao moderada

   ================================================================ */

// ----------------------------------------------------------------
// ADAPTIVE EPSILON — RDP epsilon by family/strategy
// Valor de tolerancia para cv.approxPolyDP por tipo de feicao
// ----------------------------------------------------------------

const EPSILON_MAP = {
    building: 3.0,
    vegetation: 1.0,
    water: 1.5,
    roads: 2.0,
    soil: 1.5,
};

/**
 * Return adaptive RDP epsilon for a given strategy key.
 * Edificios usam epsilon alto para linhas retas; vegetacao usa baixo
 * para preservar curvas organicas.
 *
 * @param {string} strategyKey - 'building' | 'vegetation' | 'water' | 'roads' | 'soil'
 * @returns {number} - Epsilon value in pixels
 */
export function adaptiveEpsilon(strategyKey) {
    return EPSILON_MAP[strategyKey] ?? 1.5;
}

// ----------------------------------------------------------------
// MINIMUM AREA — Noise filter threshold by family
// Area minima em pixels para descartar ruido
// ----------------------------------------------------------------

const MIN_AREA_MAP = {
    building: 150,
    vegetation: 200,
    water: 300,
    roads: 100,
    soil: 200,
};

/**
 * Return minimum contour area (in pixels) for a strategy.
 * Contornos menores que este limiar sao descartados como ruido.
 *
 * @param {string} strategyKey
 * @returns {number} - Minimum area in pixels
 */
export function minAreaPx(strategyKey) {
    return MIN_AREA_MAP[strategyKey] ?? 200;
}

// ----------------------------------------------------------------
// REGULARIZE POLYGON — Snap near-90° angles for buildings
// Forca angulos proximos de 90° para exatamente 90°
// ----------------------------------------------------------------

/**
 * Regularize polygon angles to 90-degree increments.
 * Para edificios: snap angulos proximos de 90° para exatamente 90°.
 * Preserva angulos que desviam mais que o threshold.
 *
 * Algoritmo: para cada tripla de vertices consecutivos, calcula o
 * angulo interno. Se esta dentro de snapThreshold graus de 90/180/270,
 * ajusta a posicao do vertice do meio para forcar o angulo exato.
 *
 * @param {Array<{x: number, y: number}>} vertices - Polygon vertices
 * @param {number} [snapThreshold=15] - Degrees within which to snap
 * @returns {Array<{x: number, y: number}>} - Regularized polygon
 */
export function regularizePolygon(vertices, snapThreshold = 15) {
    if (vertices.length < 3) return vertices;

    const result = vertices.map((v) => ({ x: v.x, y: v.y }));
    const n = result.length;

    for (let i = 0; i < n; i++) {
        const prev = result[(i - 1 + n) % n];
        const curr = result[i];
        const next = result[(i + 1) % n];

        // Vectors from current vertex to neighbors
        const dx1 = prev.x - curr.x;
        const dy1 = prev.y - curr.y;
        const dx2 = next.x - curr.x;
        const dy2 = next.y - curr.y;

        // Angle between vectors using atan2
        const angle1 = Math.atan2(dy1, dx1);
        const angle2 = Math.atan2(dy2, dx2);

        let angleDeg = _toDeg(angle2 - angle1);
        // Normalize to [0, 360)
        angleDeg = ((angleDeg % 360) + 360) % 360;

        // Check proximity to 90° increments (90, 180, 270)
        const targets = [90, 180, 270];
        for (const target of targets) {
            const diff = Math.abs(angleDeg - target);
            if (diff < snapThreshold) {
                // Snap: rotate the edge (curr→next) so angle is exactly target°
                const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                if (len2 < 1e-6) continue;

                const targetRad = _toRad(target) + angle1;
                result[(i + 1) % n] = {
                    x: curr.x + Math.cos(targetRad) * len2,
                    y: curr.y + Math.sin(targetRad) * len2,
                };
                break;
            }
        }
    }

    return result;
}

// ----------------------------------------------------------------
// SMOOTH POLYGON — Gaussian vertex smoothing for organic shapes
// Suavizacao para vegetacao e corpos d'agua
// ----------------------------------------------------------------

/**
 * Apply Gaussian smoothing to polygon vertices.
 * Remove escadinha de pixels (aliasing) preservando forma geral.
 * Usado para vegetacao e water onde curvas organicas sao esperadas.
 *
 * @param {Array<{x: number, y: number}>} vertices - Input polygon
 * @param {number} [sigma=1.5] - Gaussian sigma (largura do kernel)
 * @param {number} [windowSize=3] - Kernel half-width (total = 2*w+1)
 * @returns {Array<{x: number, y: number}>} - Smoothed polygon
 */
export function smoothPolygon(vertices, sigma = 1.5, windowSize = 3) {
    if (vertices.length < 5) return vertices;

    const n = vertices.length;
    const result = new Array(n);

    // Pre-compute Gaussian kernel weights
    const kernel = [];
    let weightSum = 0;
    for (let j = -windowSize; j <= windowSize; j++) {
        const w = Math.exp(-(j * j) / (2 * sigma * sigma));
        kernel.push(w);
        weightSum += w;
    }
    // Normalize
    for (let k = 0; k < kernel.length; k++) {
        kernel[k] /= weightSum;
    }

    // Apply convolution with circular wrapping
    for (let i = 0; i < n; i++) {
        let sx = 0,
            sy = 0;
        for (let j = -windowSize; j <= windowSize; j++) {
            const idx = (((i + j) % n) + n) % n;
            const w = kernel[j + windowSize];
            sx += vertices[idx].x * w;
            sy += vertices[idx].y * w;
        }
        result[i] = { x: sx, y: sy };
    }

    return result;
}

// ----------------------------------------------------------------
// MORPHOLOGICAL SKELETON — Iterative erosion thinning
// Fallback para cv.ximgproc.thinning (nao disponivel no CDN)
// ----------------------------------------------------------------

/**
 * Morphological skeletonization via iterative erosion.
 * Produz esqueleto de 1px de largura para extracao de centerlines
 * de estradas/caminhos.
 *
 * ATENCAO MEMORIA: Retorna cv.Mat que o caller DEVE deletar com
 * .delete() em try/finally. Todas as Mats internas sao limpas aqui.
 *
 * Algoritmo classico:
 *   repeat:
 *     opened = morphOpen(img, cross_3x3)
 *     temp = img - opened
 *     skeleton |= temp
 *     img = erode(img, cross_3x3)
 *   until img is empty
 *
 * @param {Object} cv - OpenCV.js instance
 * @param {Object} binaryMat - cv.Mat CV_8UC1 (binary mask, 0/255)
 * @returns {Object} - cv.Mat CV_8UC1 skeleton (CALLER MUST .delete())
 */
export function morphologicalSkeleton(cv, binaryMat) {
    const rows = binaryMat.rows;
    const cols = binaryMat.cols;

    const skel = cv.Mat.zeros(rows, cols, cv.CV_8UC1);
    const temp = new cv.Mat();
    const eroded = new cv.Mat();
    const opened = new cv.Mat();
    // Working copy — we erode this iteratively
    const work = binaryMat.clone();
    const element = cv.getStructuringElement(cv.MORPH_CROSS, new cv.Size(3, 3));

    try {
        let done = false;
        let iterations = 0;
        const MAX_ITER = 500; // Safety cap para imagens 512x512

        while (!done && iterations < MAX_ITER) {
            // opened = morphOpen(work)
            cv.morphologyEx(work, opened, cv.MORPH_OPEN, element);

            // temp = work - opened
            cv.subtract(work, opened, temp);

            // skel |= temp
            cv.bitwise_or(skel, temp, skel);

            // work = erode(work)
            cv.erode(work, eroded, element);
            eroded.copyTo(work);

            // Check if work is empty (all zeros)
            done = cv.countNonZero(work) === 0;
            iterations++;
        }
    } finally {
        // Cleanup ALL temporary Mats — zero leaks
        temp.delete();
        eroded.delete();
        opened.delete();
        work.delete();
        element.delete();
    }

    // Caller is responsible for deleting skel
    return skel;
}

// ----------------------------------------------------------------
// CONTOUR AREA RATIO — L-shaped building trap detection
// Detecta se minAreaRect e adequado para o contorno
// ----------------------------------------------------------------

/**
 * Calculate ratio of contour area to its minimum area bounding rect.
 * Se ratio > 0.85, contorno e retangular → use minAreaRect.
 * Se ratio <= 0.85, contorno e complexo (L, T, U) → use approxPolyDP.
 *
 * @param {number} contourArea - Area do contorno (cv.contourArea)
 * @param {Object} rect - RotatedRect de cv.minAreaRect
 * @returns {number} - Ratio [0, 1] — 1.0 = retangulo perfeito
 */
export function contourRectFillRatio(contourArea, rect) {
    const rectArea = rect.size.width * rect.size.height;
    if (rectArea < 1e-6) return 0;
    return contourArea / rectArea;
}

/**
 * Extract 4 corner points from OpenCV RotatedRect.
 * cv.minAreaRect retorna RotatedRect com center, size, angle.
 * Calcula os 4 cantos via rotacao.
 *
 * @param {Object} rect - { center: {x,y}, size: {width,height}, angle }
 * @returns {Array<{x: number, y: number}>} - 4 corner vertices
 */
export function rotatedRectPoints(rect) {
    const { center, size, angle } = rect;
    const rad = _toRad(angle);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const hw = size.width / 2;
    const hh = size.height / 2;

    // 4 corners relative to center, rotated by angle
    const offsets = [
        { dx: -hw, dy: -hh },
        { dx: hw, dy: -hh },
        { dx: hw, dy: hh },
        { dx: -hw, dy: hh },
    ];

    return offsets.map(({ dx, dy }) => ({
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos,
    }));
}

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

function _toRad(deg) {
    return (deg * Math.PI) / 180;
}
function _toDeg(rad) {
    return (rad * 180) / Math.PI;
}
