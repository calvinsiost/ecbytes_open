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
   COLOR ANALYSIS — Canvas-based aerial image recognition
   ================================================================

   Algoritmo de analise de cores para detectar feicoes ambientais
   em imagens aereas/satelite sem necessidade de API/LLM.

   METODO:
   1. Desenha imagem em canvas offscreen (512x512)
   2. Pre-processamento: grayscale + Sobel edge map
   3. Classifica cada pixel: shadow → ExG vegetation → HSL categories
   4. Agrupa pixels adjacentes (flood-fill) em blobs
   5. Pos-processamento: edge density filter em building blobs
   6. Estima rotacao via momentos de segunda ordem (PCA)

   ================================================================ */

import { isShadow, excessGreen, shadowIndex, toGrayscale, computeEdgeMap, blobEdgeDensity } from './indices.js';
import { mapToThresholds } from './calibration.js';

// ----------------------------------------------------------------
// HSL CATEGORY DEFINITIONS
// Faixas de cor HSL para classificacao de feicoes aereas
// ----------------------------------------------------------------

const CATEGORIES = {
    water: {
        family: 'lake',
        // Azul — rios, lagoas, reservatorios (inclui tons muito escuros de agua)
        // Calibrado: L>=5 para capturar agua escura em imagens satelite
        match: (h, s, l) => h >= 170 && h <= 260 && s > 10 && l >= 5 && l <= 75,
    },
    vegetation: {
        family: 'habitat',
        // Verde e ciano — vegetacao, areas verdes, sombra de mata
        // Sweep R2: S>7 (melhor diversidade familia vs deteccao veg)
        match: (h, s, l) => h >= 50 && h <= 170 && s > 7 && l >= 3 && l <= 75,
    },
    building_bright: {
        family: 'building',
        // Telhados claros, concreto — alta luminosidade, baixa saturacao
        // Sweep R3: L>70 evita falsos positivos em nuvens/brilho
        match: (h, s, l) => s < 18 && l > 70,
    },
    building_dark: {
        family: 'building',
        // Telhados escuros, estruturas — baixa saturacao, luminosidade media-baixa
        // Sweep R1: L:12-55 captura estruturas mais escuras e levemente mais claras
        match: (h, s, l) => s < 18 && l >= 12 && l <= 55,
    },
    infrastructure: {
        family: 'marker',
        // Asfalto, estradas, estacionamentos — cinza desaturado medio
        // Calibrado: S<15 e L:48-72 para cobrir faixa de transicao
        match: (h, s, l) => s < 15 && l > 48 && l <= 72,
    },
    soil: {
        family: 'marker',
        // Solo exposto, terra — tons marrom/bege, inclui tons claros e escuros
        // Calibrado: S>=10 para solo desaturado, L:15-68 para bege claro ate terra escura
        match: (h, s, l) => h >= 15 && h <= 55 && s >= 10 && s <= 55 && l >= 15 && l <= 68,
    },
};

const CATEGORY_KEYS = Object.keys(CATEGORIES);

// ----------------------------------------------------------------
// RGB TO HSL CONVERSION
// ----------------------------------------------------------------

/**
 * Convert RGB to HSL values.
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {{ h: number, s: number, l: number }} - H(0-360), S(0-100), L(0-100)
 */
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: l * 100 };

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;

    return { h: h * 360, s: s * 100, l: l * 100 };
}

// ----------------------------------------------------------------
// PIXEL CLASSIFICATION
// ----------------------------------------------------------------

/**
 * Classify a single pixel into a category.
 * Prioridade: sombra → vegetacao (ExG) → categorias HSL existentes.
 * Shadow detection evita falsos positivos em building_dark.
 * ExG e mais robusto que HSL hue para vegetacao em imagens satelite.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string|null} - Category key or null if unclassified
 */
function classifyPixel(r, g, b) {
    // 1. Shadow filter — sombras tem desvio azul + baixa luminancia
    // Evita que sombras sejam classificadas como building_dark
    if (isShadow(r, g, b)) return null;

    // 2. Vegetation via Excess Green Index — mais robusto que HSL hue
    // ExG positivo = vegetacao; negativo = nao-vegetacao
    const exg = excessGreen(r, g, b);
    if (exg > 0.08) return 'vegetation';

    // 3. HSL categories (water, building, infrastructure, soil)
    const { h, s, l } = rgbToHsl(r, g, b);
    for (const key of CATEGORY_KEYS) {
        // Skip vegetation — already handled by ExG above
        if (key === 'vegetation') continue;
        if (CATEGORIES[key].match(h, s, l)) return key;
    }
    return null;
}

// ----------------------------------------------------------------
// CALIBRATED PIXEL CLASSIFIER FACTORY
// Retorna funcao de classificacao usando limiares calibrados
// ----------------------------------------------------------------

/**
 * Create a pixel classifier function using calibrated thresholds.
 * Se thresholds=null, usa classifyPixel original (hardcoded).
 * Caso contrario, aplica limiares dinamicos de calibracao.
 *
 * @param {Object|null} thresholds - Output of mapToThresholds(), or null for defaults
 * @returns {Function} (r, g, b) => category key string or null
 */
function makeClassifier(thresholds) {
    if (!thresholds) return classifyPixel;

    const { shadow: sh, vegetation: veg, building: bld, water: wtr } = thresholds;

    return function classifyCalibrated(r, g, b) {
        // 1. Shadow filter — calibrated C3 + luminance thresholds
        const c3 = shadowIndex(r, g, b);
        const lum = ((0.299 * r + 0.587 * g + 0.114 * b) / 255) * 100;
        if (c3 > sh.c3 && lum < sh.lum) return null;

        // 2. Vegetation via ExG — calibrated threshold
        const exg = excessGreen(r, g, b);
        if (exg > veg.exg) return 'vegetation';

        // 3. HSL categories with calibrated thresholds
        const { h, s, l } = rgbToHsl(r, g, b);

        // Water
        if (h >= 170 && h <= 260 && s > wtr.satFloor && l >= 5 && l <= 75) return 'water';

        // Building bright
        if (s < bld.satCap && l > bld.brightLumFloor) return 'building_bright';

        // Building dark
        if (s < bld.satCap && l >= bld.darkLumFloor && l <= bld.darkLumCeil) return 'building_dark';

        // Infrastructure
        if (s < bld.infraSatCap && l > bld.infraLumFloor && l <= bld.infraLumCeil) return 'infrastructure';

        // Soil (unchanged — not calibrated)
        if (h >= 15 && h <= 55 && s >= 10 && s <= 55 && l >= 15 && l <= 68) return 'soil';

        return null;
    };
}

// ----------------------------------------------------------------
// FLOOD-FILL CONNECTED COMPONENTS
// Agrupa pixels adjacentes da mesma categoria em blobs
// Coleta momentos de segunda ordem para estimar rotacao (PCA)
// ----------------------------------------------------------------

/**
 * Find connected components via flood-fill.
 * Coleta sumX, sumY, sumXX, sumYY, sumXY para analise de orientacao.
 * @param {Uint8Array} grid - Category index per pixel (0=unclassified, 1..N=category)
 * @param {number} width
 * @param {number} height
 * @returns {Array<Object>} - Blobs com momentos
 */
export function findBlobs(grid, width, height) {
    const blobGrid = new Uint16Array(width * height);
    const blobs = [];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (blobGrid[idx] || grid[idx] === 0) continue;

            // BFS flood-fill
            const cat = grid[idx];
            const blobId = blobs.length + 1;
            const blob = {
                category: cat,
                pixels: 0,
                minX: x,
                maxX: x,
                minY: y,
                maxY: y,
                sumX: 0,
                sumY: 0,
                sumXX: 0,
                sumYY: 0,
                sumXY: 0,
            };
            const queue = [idx];
            blobGrid[idx] = blobId;

            while (queue.length > 0) {
                const ci = queue.pop();
                const cx = ci % width;
                const cy = (ci - cx) / width;

                blob.pixels++;
                blob.sumX += cx;
                blob.sumY += cy;
                blob.sumXX += cx * cx;
                blob.sumYY += cy * cy;
                blob.sumXY += cx * cy;
                if (cx < blob.minX) blob.minX = cx;
                if (cx > blob.maxX) blob.maxX = cx;
                if (cy < blob.minY) blob.minY = cy;
                if (cy > blob.maxY) blob.maxY = cy;

                // 4-directional neighbors
                const neighbors = [
                    cy > 0 ? ci - width : -1,
                    cy < height - 1 ? ci + width : -1,
                    cx > 0 ? ci - 1 : -1,
                    cx < width - 1 ? ci + 1 : -1,
                ];
                for (const ni of neighbors) {
                    if (ni >= 0 && !blobGrid[ni] && grid[ni] === cat) {
                        blobGrid[ni] = blobId;
                        queue.push(ni);
                    }
                }
            }

            blobs.push(blob);
        }
    }
    return { blobs, blobGrid };
}

// ----------------------------------------------------------------
// CONTOUR EXTRACTION — Row-scan boundary tracing
// Extrai contorno do blob via varredura por linhas (left/right edges)
// Produz poligono fechado para renderizar formas reais dos blobs
// ----------------------------------------------------------------

/**
 * Extract contour polygon from a blob via row scanning.
 * Para cada linha, encontra pixel mais à esquerda e à direita do blob.
 * Resulta em poligono fechado: borda esquerda (cima→baixo) + direita (baixo→cima).
 * Simplificado via Ramer-Douglas-Peucker para reduzir vertices.
 *
 * @param {Uint16Array} blobGrid - Blob ID per pixel (from findBlobs)
 * @param {number} blobId - 1-based blob identifier
 * @param {Object} blob - Blob with minX, maxX, minY, maxY
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @returns {Array<{x: number, y: number}>} Contour in normalized coords (0-1)
 */
export function extractContour(blobGrid, blobId, blob, width, height) {
    const leftEdge = [];
    const rightEdge = [];

    for (let y = blob.minY; y <= blob.maxY; y++) {
        let leftmost = -1,
            rightmost = -1;
        for (let x = blob.minX; x <= blob.maxX; x++) {
            if (blobGrid[y * width + x] === blobId) {
                if (leftmost === -1) leftmost = x;
                rightmost = x;
            }
        }
        if (leftmost >= 0) {
            leftEdge.push({ x: leftmost, y });
            rightEdge.push({ x: rightmost, y });
        }
    }

    if (leftEdge.length < 2) return [];

    // Build closed polygon: left edge top→bottom, right edge bottom→top
    const raw = [];
    for (const pt of leftEdge) raw.push(pt);
    for (let i = rightEdge.length - 1; i >= 0; i--) raw.push(rightEdge[i]);

    // Simplify with Douglas-Peucker (tolerance ~1.5px for 512 grid)
    const simplified = raw.length > 6 ? _simplifyRDP(raw, 1.5) : raw;

    // Normalize to 0-1
    const wMax = width - 1;
    const hMax = height - 1;
    return simplified.map((pt) => ({
        x: pt.x / wMax,
        y: pt.y / hMax,
    }));
}

/**
 * Simplify polyline using iterative Ramer-Douglas-Peucker algorithm.
 * Remove vertices que ficam dentro de 'tolerance' pixels da reta
 * entre pontos mantidos. Preserva forma geral, reduz vertices.
 *
 * @param {Array<{x, y}>} points
 * @param {number} tolerance - Max distance in pixel units
 * @returns {Array<{x, y}>}
 */
function _simplifyRDP(points, tolerance) {
    if (points.length <= 3) return points;

    const tolSq = tolerance * tolerance;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;

    const stack = [[0, points.length - 1]];
    while (stack.length > 0) {
        const [start, end] = stack.pop();
        let maxDistSq = 0,
            maxIdx = start;

        const ax = points[start].x,
            ay = points[start].y;
        const bx = points[end].x,
            by = points[end].y;
        const dx = bx - ax,
            dy = by - ay;
        const lenSq = dx * dx + dy * dy;

        for (let i = start + 1; i < end; i++) {
            let distSq;
            if (lenSq === 0) {
                const px = points[i].x - ax,
                    py = points[i].y - ay;
                distSq = px * px + py * py;
            } else {
                const t = Math.max(0, Math.min(1, ((points[i].x - ax) * dx + (points[i].y - ay) * dy) / lenSq));
                const projX = ax + t * dx - points[i].x;
                const projY = ay + t * dy - points[i].y;
                distSq = projX * projX + projY * projY;
            }
            if (distSq > maxDistSq) {
                maxDistSq = distSq;
                maxIdx = i;
            }
        }

        if (maxDistSq > tolSq) {
            keep[maxIdx] = 1;
            if (maxIdx - start > 1) stack.push([start, maxIdx]);
            if (end - maxIdx > 1) stack.push([maxIdx, end]);
        }
    }

    return points.filter((_, i) => keep[i]);
}

// ----------------------------------------------------------------
// ROTATION ESTIMATION VIA COVARIANCE (PCA)
// Calcula angulo principal do blob usando momentos de segunda ordem
// ----------------------------------------------------------------

/**
 * Estimate rotation angle (radians) of a blob from its covariance matrix.
 * Usa os momentos de segunda ordem para derivar o eixo principal.
 * @param {Object} blob - Blob com sumX, sumY, sumXX, sumYY, sumXY, pixels
 * @returns {number} - Angle in radians (rotation around Y axis in 3D)
 */
export function estimateRotation(blob) {
    const n = blob.pixels;
    if (n < 10) return 0;

    const mx = blob.sumX / n;
    const my = blob.sumY / n;
    const cxx = blob.sumXX / n - mx * mx;
    const cyy = blob.sumYY / n - my * my;
    const cxy = blob.sumXY / n - mx * my;

    // Angulo do eixo principal (eigenvector dominante)
    const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    return theta;
}

/**
 * Compute oriented bounding box dimensions.
 * Rotaciona os limites do blob pelo angulo e calcula largura/comprimento
 * ao longo dos eixos principais.
 * @param {Object} blob
 * @param {number} theta - Rotation angle in radians
 * @returns {{ width: number, length: number }} - In pixel units
 */
export function orientedDimensions(blob, theta) {
    const n = blob.pixels;
    const cx = blob.sumX / n;
    const cy = blob.sumY / n;
    const cos = Math.cos(-theta);
    const sin = Math.sin(-theta);

    // Project bounding box corners into rotated frame
    const corners = [
        { x: blob.minX - cx, y: blob.minY - cy },
        { x: blob.maxX - cx, y: blob.minY - cy },
        { x: blob.maxX - cx, y: blob.maxY - cy },
        { x: blob.minX - cx, y: blob.maxY - cy },
    ];

    let minU = Infinity,
        maxU = -Infinity,
        minV = Infinity,
        maxV = -Infinity;
    for (const c of corners) {
        const u = c.x * cos - c.y * sin;
        const v = c.x * sin + c.y * cos;
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
    }

    return {
        width: maxU - minU,
        length: maxV - minV,
    };
}

// ----------------------------------------------------------------
// BLOB TO FEATURE CONVERSION
// Converte blobs classificados em DetectedFeature[]
// ----------------------------------------------------------------

/**
 * Convert a blob to a DetectedFeature.
 * Calcula posicao, dimensoes, rotacao e confianca para cada blob.
 * @param {Object} blob - Blob from findBlobs
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {Object} extent - { minX, maxX, minZ, maxZ } in world coords
 * @param {number} totalPixels
 * @returns {Object|null} - DetectedFeature or null if too small/invalid
 */
export function blobToFeature(blob, imageWidth, imageHeight, extent, totalPixels, thresholds = null) {
    const catKey = CATEGORY_KEYS[blob.category - 1];
    if (!catKey) return null;

    const catDef = CATEGORIES[catKey];
    const areaRatio = blob.pixels / totalPixels;

    // Per-family minimum area thresholds (ratio of total image pixels)
    // Calibrado para 512x512 grid sobre extents de 200-600m:
    // Benchmark R2: thresholds ligeiramente mais altos que R1 para reduzir FP
    // - building: ~0.25% = ~655px = ~26x26 patch
    // - Multiplier via calibration: >1 = stricter (less features), <1 = looser (more)
    const mult = thresholds?.minAreaMultiplier ?? 1.0;
    const MIN_AREA = { building: 0.0025 * mult, lake: 0.004 * mult, habitat: 0.004 * mult, marker: 0.003 * mult };
    const minThreshold = MIN_AREA[catDef.family] || 0.005 * mult;
    if (areaRatio < minThreshold) return null;

    // Centroid in pixel space
    const cx = blob.sumX / blob.pixels;
    const cy = blob.sumY / blob.pixels;

    // Map to world coordinates
    // Image Y is inverted relative to world Z: pixel Y=0 (top) → maxZ (far edge)
    // because boundary overlay texture maps image top to maxZ (flipY=false + UV normalization)
    const worldWidth = extent.maxX - extent.minX;
    const worldHeight = extent.maxZ - extent.minZ;
    const worldX = extent.minX + (cx / imageWidth) * worldWidth;
    const worldZ = extent.maxZ - (cy / imageHeight) * worldHeight;

    // Axis-aligned blob dimensions in world space
    const blobW = ((blob.maxX - blob.minX + 1) / imageWidth) * worldWidth;
    const blobH = ((blob.maxY - blob.minY + 1) / imageHeight) * worldHeight;

    // Shape metrics
    const bboxArea = (blob.maxX - blob.minX + 1) * (blob.maxY - blob.minY + 1);
    const fillRatio = blob.pixels / bboxArea;
    const pixW = blob.maxX - blob.minX + 1;
    const pixH = blob.maxY - blob.minY + 1;
    const aspectRatio = pixH > 0 ? pixW / pixH : 1;

    // Rotation estimation (PCA)
    const theta = estimateRotation(blob);
    const oriented = orientedDimensions(blob, theta);

    // Oriented dimensions in world space
    const oWidth = (oriented.width / imageWidth) * worldWidth;
    const oLength = (oriented.length / imageHeight) * worldHeight;

    // Confidence: base per-family + fill quality + size + shape bonuses
    // Edificios tem base mais alta (deteccao por cor e confiavel para telhados)
    const canonFamily = catDef.family;
    const baseConf =
        canonFamily === 'building' ? 0.5 : canonFamily === 'lake' ? 0.45 : canonFamily === 'habitat' ? 0.4 : 0.35;
    const fillBonus = Math.min(0.2, fillRatio * 0.25);
    const sizeBonus = Math.min(0.15, areaRatio * 3);
    const shapeBonus =
        canonFamily === 'building' && fillRatio > 0.5 && aspectRatio > 0.4 && aspectRatio < 2.5 ? 0.1 : 0;
    const confidence = Math.min(0.95, baseConf + fillBonus + sizeBonus + shapeBonus);

    // Family-specific data
    let family = canonFamily;
    const dimensions = {};
    let rotation = 0;

    if (canonFamily === 'building') {
        // Very elongated shapes (aspect > 6:1 or < 1:6) → road/path marker
        // Diagnostic: road filtering removed too many features; classify as marker instead
        if (aspectRatio > 6 || aspectRatio < 0.17) {
            return {
                family: 'marker',
                confidence: Math.round(Math.min(0.7, confidence * 0.8) * 100) / 100,
                label: 'marker',
                position: { x: Math.round(worldX * 10) / 10, z: Math.round(worldZ * 10) / 10 },
                dimensions: {},
                rotation: 0,
                contours: blob.contour ? [blob.contour] : [],
                sourceMethod: 'algorithm',
            };
        }

        // Moderately elongated + sparse → road, also marker
        if (fillRatio < 0.3 && (aspectRatio > 4 || aspectRatio < 0.25)) {
            return {
                family: 'marker',
                confidence: Math.round(Math.min(0.65, confidence * 0.7) * 100) / 100,
                label: 'marker',
                position: { x: Math.round(worldX * 10) / 10, z: Math.round(worldZ * 10) / 10 },
                dimensions: {},
                rotation: 0,
                contours: blob.contour ? [blob.contour] : [],
                sourceMethod: 'algorithm',
            };
        }

        // Use oriented dimensions for better size estimation
        const w = Math.max(oWidth, oLength);
        const l = Math.min(oWidth, oLength);

        // Circular small blobs → tank
        if (fillRatio > 0.65 && aspectRatio > 0.65 && aspectRatio < 1.55 && blobW < worldWidth * 0.1) {
            family = 'tank';
            const diameter = Math.min(blobW, blobH);
            dimensions.dimensions = {
                diameter: Math.round(diameter * 10) / 10,
                length: Math.round(diameter * 10) / 10,
            };
            dimensions.type = 'aboveground';
        } else {
            // Building — use oriented width/length and rotation
            dimensions.footprint = {
                width: Math.round(w * 10) / 10,
                length: Math.round(l * 10) / 10,
            };
            dimensions.height = Math.round(4 + Math.random() * 8);
            dimensions.type = w * l > 300 ? 'industrial' : 'commercial';
            rotation = theta;
        }
    } else if (canonFamily === 'lake') {
        // Elongated water → river
        if (aspectRatio > 3.5 || aspectRatio < 0.28) {
            family = 'river';
            // Create a path following the blob's extent
            const nPts = 4;
            const path = [];
            for (let i = 0; i < nPts; i++) {
                const t = i / (nPts - 1);
                const px = blob.minX + t * (blob.maxX - blob.minX);
                const py = blob.minY + t * (blob.maxY - blob.minY);
                path.push({
                    x: Math.round((extent.minX + (px / imageWidth) * worldWidth) * 10) / 10,
                    y: 0,
                    z: Math.round((extent.maxZ - (py / imageHeight) * worldHeight) * 10) / 10,
                });
            }
            dimensions.path = path;
            dimensions.width = Math.max(2, Math.round(Math.min(blobW, blobH) * 10) / 10);
        } else {
            dimensions.shape = {
                radiusX: Math.round((blobW / 2) * 10) / 10,
                radiusY: Math.round((blobH / 2) * 10) / 10,
                depth: 3,
            };
        }
    } else if (canonFamily === 'habitat') {
        const habitatTypes = ['forest', 'grassland', 'wetland', 'riparian'];
        dimensions.habitatType = habitatTypes[Math.floor(Math.random() * habitatTypes.length)];
        dimensions.protectionStatus = 'none';
        // Use actual blob pixel area (not bounding box) for realistic m² estimate
        dimensions.area = Math.min(Math.round(areaRatio * worldWidth * worldHeight), 500);
        // Store actual blob dimensions for rectangular mesh (not just area for circle)
        dimensions.footprint = {
            width: Math.round(Math.max(blobW, 3) * 10) / 10,
            length: Math.round(Math.max(blobH, 3) * 10) / 10,
        };
    }

    return {
        family,
        confidence: Math.round(confidence * 100) / 100,
        label: family, // Placeholder — reassigned by _assignSequentialNames in aerial.js
        position: { x: Math.round(worldX * 10) / 10, z: Math.round(worldZ * 10) / 10 },
        dimensions,
        rotation,
        contours: blob.contour ? [blob.contour] : [],
        sourceMethod: 'algorithm',
    };
}

// ----------------------------------------------------------------
// MORPHOLOGICAL CLOSE (dilate + erode)
// Fecha pequenas lacunas entre pixels da mesma categoria
// Melhora a deteccao de telhados com bordas irregulares
// ----------------------------------------------------------------

/**
 * Apply morphological close (dilate then erode) on the grid.
 * Dilata pixels e depois contrai, fechando gaps de 1 pixel.
 * Apenas dilata categorias especificadas (ex: edificios) para evitar
 * que vegetacao/agua formem super-blobs.
 *
 * @param {Uint8Array} grid
 * @param {number} width
 * @param {number} height
 * @param {Set<number>} dilateCategories - Category indices to dilate (others preserved as-is)
 * @returns {Uint8Array} - Processed grid
 */
export function morphClose(grid, width, height, dilateCategories) {
    const total = width * height;

    // Dilate: fill unclassified pixel if 2+ same-category neighbors (buildings only)
    const dilated = new Uint8Array(total);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (grid[idx] !== 0) {
                dilated[idx] = grid[idx];
                continue;
            }
            // Check 4-neighbors
            const neighbors = [
                y > 0 ? grid[idx - width] : 0,
                y < height - 1 ? grid[idx + width] : 0,
                x > 0 ? grid[idx - 1] : 0,
                x < width - 1 ? grid[idx + 1] : 0,
            ];
            const counts = {};
            let best = 0,
                bestCat = 0;
            for (const n of neighbors) {
                if (n === 0) continue;
                counts[n] = (counts[n] || 0) + 1;
                if (counts[n] > best) {
                    best = counts[n];
                    bestCat = n;
                }
            }
            // Only dilate if majority neighbor is in the allowed set
            dilated[idx] = best >= 2 && dilateCategories.has(bestCat) ? bestCat : 0;
        }
    }

    // Erode: keep pixel if at least 3 of 4 neighbors match
    const eroded = new Uint8Array(total);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const cat = dilated[idx];
            if (cat === 0) continue;
            let matchCount = 0;
            if (y === 0 || dilated[idx - width] === cat) matchCount++;
            if (y === height - 1 || dilated[idx + width] === cat) matchCount++;
            if (x === 0 || dilated[idx - 1] === cat) matchCount++;
            if (x === width - 1 || dilated[idx + 1] === cat) matchCount++;
            eroded[idx] = matchCount >= 3 ? cat : 0;
        }
    }
    return eroded;
}

// ----------------------------------------------------------------
// POST-PROCESSING — Merge nearby same-family features
// Blobs fragmentados da mesma familia sao fundidos quando seus
// centros estao dentro de uma distancia limite (em metros).
// ----------------------------------------------------------------

/**
 * Merge features of the same family that are close together.
 * O feature resultante herda a posicao ponderada por confianca,
 * a maior confianca, e as maiores dimensoes.
 *
 * @param {Array} features - DetectedFeature[]
 * @param {Object} extent - { minX, maxX, minZ, maxZ }
 * @returns {Array} Merged features
 */
function _mergeNearbyFeatures(features, extent) {
    const worldW = extent.maxX - extent.minX;
    // Merge distance: 3% of extent width, capped at 15m
    // Apenas merge blobs muito proximos que sao claramente a mesma feicao
    const mergeDist = Math.min(15, Math.max(5, worldW * 0.03));
    const mergeDistSq = mergeDist * mergeDist;

    // Group by canonical family (building, habitat, marker, lake, river)
    const groups = {};
    for (const f of features) {
        const key = f.family;
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
    }

    const merged = [];
    for (const [family, group] of Object.entries(groups)) {
        // Union-Find merge within each family
        const parent = group.map((_, i) => i);
        function find(i) {
            return parent[i] === i ? i : (parent[i] = find(parent[i]));
        }
        function union(a, b) {
            parent[find(a)] = find(b);
        }

        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const dx = group[i].position.x - group[j].position.x;
                const dz = group[i].position.z - group[j].position.z;
                if (dx * dx + dz * dz < mergeDistSq) {
                    union(i, j);
                }
            }
        }

        // Collect clusters
        const clusters = {};
        for (let i = 0; i < group.length; i++) {
            const root = find(i);
            if (!clusters[root]) clusters[root] = [];
            clusters[root].push(group[i]);
        }

        for (const cluster of Object.values(clusters)) {
            if (cluster.length === 1) {
                merged.push(cluster[0]);
                continue;
            }
            // Merge: weighted average position, max confidence, largest dimensions
            let totalConf = 0,
                wx = 0,
                wz = 0,
                bestConf = 0;
            for (const f of cluster) {
                totalConf += f.confidence;
                wx += f.position.x * f.confidence;
                wz += f.position.z * f.confidence;
                if (f.confidence > bestConf) bestConf = f.confidence;
            }
            // Combine contours from all merged features
            const allContours = [];
            for (const f of cluster) {
                if (f.contours) allContours.push(...f.contours);
            }
            const mergedFeature = {
                ...cluster[0],
                position: {
                    x: Math.round((wx / totalConf) * 10) / 10,
                    z: Math.round((wz / totalConf) * 10) / 10,
                },
                // Boost confidence slightly for merged (multi-blob = more evidence)
                confidence: Math.min(0.95, Math.round((bestConf + 0.05) * 100) / 100),
                contours: allContours,
            };
            merged.push(mergedFeature);
        }
    }
    return merged;
}

// ----------------------------------------------------------------
// MAIN ANALYSIS FUNCTION
// ----------------------------------------------------------------

/**
 * Analyze aerial image by color segmentation.
 * Analisa imagem aerea usando segmentacao por cores no canvas.
 *
 * @param {string} imageDataUrl - Base64 data URL da imagem
 * @param {Object} extent - { minX, maxX, minZ, maxZ } coordenadas do mundo
 * @param {Object|null} [calibration=null] - CalibrationParams (0-100 sliders) ou null para defaults
 * @returns {Promise<Array>} - DetectedFeature[]
 */
export async function analyzeByColor(imageDataUrl, extent, calibration = null, annotations = [], options = {}) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                // Higher resolution for better detail
                const ANALYSIS_SIZE = 512;
                const canvas = document.createElement('canvas');
                canvas.width = ANALYSIS_SIZE;
                canvas.height = ANALYSIS_SIZE;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);

                const imageData = ctx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
                const pixels = imageData.data;
                const totalPixels = ANALYSIS_SIZE * ANALYSIS_SIZE;

                // Calibration: convert 0-100 sliders to raw thresholds
                const thresholds = calibration ? mapToThresholds(calibration) : null;
                const classify = makeClassifier(thresholds);

                // Step 0: Pre-processamento — grayscale + edge map (Sobel)
                // Edge map usado depois para filtrar sombras de edificios
                const gray = toGrayscale(pixels, totalPixels);
                const edgeMap = computeEdgeMap(gray, ANALYSIS_SIZE, ANALYSIS_SIZE);

                // Step 1: Classify each pixel
                // Prioridade: shadow → ExG vegetation → HSL categories
                let grid = new Uint8Array(totalPixels);
                for (let i = 0; i < totalPixels; i++) {
                    const offset = i * 4;
                    const r = pixels[offset],
                        g = pixels[offset + 1],
                        b = pixels[offset + 2];
                    const cat = classify(r, g, b);
                    grid[i] = cat ? CATEGORY_KEYS.indexOf(cat) + 1 : 0;
                }

                // Merge building subcategories in grid (bright → dark)
                const darkIdx = CATEGORY_KEYS.indexOf('building_dark') + 1;
                const brightIdx = CATEGORY_KEYS.indexOf('building_bright') + 1;
                for (let i = 0; i < totalPixels; i++) {
                    if (grid[i] === brightIdx) grid[i] = darkIdx;
                }

                // Step 1a: Stamp user annotations onto grid
                // Injeta anotacoes do usuario como disco de pixels classificados
                stampAnnotations(grid, ANALYSIS_SIZE, annotations);

                // Step 1b: Morphological close — only for buildings
                // Nao dilata vegetacao/agua para evitar super-blobs
                // (vegetacao ja conecta bem via ExG; fechar gaps cria blobs gigantes)
                const buildingSet = new Set([darkIdx]);
                grid = morphClose(grid, ANALYSIS_SIZE, ANALYSIS_SIZE, buildingSet);

                // Step 2: Find connected components
                const { blobs, blobGrid } = findBlobs(grid, ANALYSIS_SIZE, ANALYSIS_SIZE);

                // Step 2a: Extract pixel-accurate contour polygons for each blob
                blobs.forEach((blob, i) => {
                    blob.contour = extractContour(blobGrid, i + 1, blob, ANALYSIS_SIZE, ANALYSIS_SIZE);
                });

                // Step 2b: Edge density filter — remove building blobs that are shadows
                // Edificios reais tem bordas fortes (telhados, paredes); sombras sao lisas
                // Benchmark: discard threshold 0.04 removes more shadow false positives
                const edgeDiscardThr = thresholds?.edgeDensity?.discard ?? 0.04;
                const edgeBoostThr = thresholds?.edgeDensity?.boost ?? 0.15;

                for (const blob of blobs) {
                    if (blob.category !== darkIdx) continue;
                    const edgeDens = blobEdgeDensity(edgeMap, grid, blob, ANALYSIS_SIZE);
                    blob._edgeDensity = edgeDens;
                    // Blob sem bordas em area de building → provavelmente sombra
                    if (edgeDens < edgeDiscardThr) {
                        blob._discarded = true;
                    }
                }

                // Step 3: Convert blobs to features, filter small ones
                let features = blobs
                    .filter((b) => !b._discarded)
                    .map((b) => {
                        const f = blobToFeature(b, ANALYSIS_SIZE, ANALYSIS_SIZE, extent, totalPixels, thresholds);
                        // Bonus de confianca para edificios com alta densidade de bordas
                        if (f && f.family === 'building' && b._edgeDensity > edgeBoostThr) {
                            f.confidence = Math.min(0.95, Math.round((f.confidence + 0.05) * 100) / 100);
                        }
                        return f;
                    })
                    .filter((f) => f !== null);

                // Step 3b: Merge nearby same-family features
                // Reduz fragmentacao — blobs proximos da mesma familia viram um so
                features = _mergeNearbyFeatures(features, extent);

                // Step 3c: Filter very low-confidence features
                // Remove deteccoes espurias com confianca muito baixa
                const confThreshold = 0.25;
                features = features.filter((f) => f.confidence >= confThreshold);

                // Sort by confidence (highest first) for natural priority
                features.sort((a, b) => b.confidence - a.confidence);

                // Limit features to avoid clutter
                const maxFeat = thresholds?.maxFeatures ?? 25;
                const limited = features.slice(0, maxFeat);

                // Vectorization Engine: retorna grid junto com features se pedido
                if (options.returnGrid) {
                    resolve({ features: limited, grid });
                } else {
                    resolve(limited);
                }
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = () => reject(new Error('Failed to load image for analysis'));
        img.src = imageDataUrl;
    });
}

// ----------------------------------------------------------------
// ANNOTATION STAMPING — Inject user labels into pixel grid
// Carimba anotacoes do usuario no grid de categorias para guiar
// a deteccao de blobs nos metodos de cor e ML.
// ----------------------------------------------------------------

/** Map annotation family → grid category index */
const FAMILY_TO_GRID = {
    building: 4, // building_dark (canonical after merge)
    tank: 4, // building_dark (reclassified via shape in blobToFeature)
    lake: 1, // water
    river: 1, // water (reclassified via aspect ratio in blobToFeature)
    habitat: 2, // vegetation
    well: 4, // building_dark (small structure)
    marker: 5, // infrastructure
};

/** Stamp radius on 512×512 grid (~6% of width) */
const ANNOTATION_STAMP_RADIUS = 15;

/**
 * Stamp user annotations onto the category grid.
 * Preenche um disco circular no grid para cada anotacao do usuario.
 * Chamado APOS classificacao de pixels e merge de subcategorias,
 * mas ANTES do morphClose.
 *
 * @param {Uint8Array} grid - Category grid (modified in place)
 * @param {number} gridSize - Grid dimension (512)
 * @param {Array} annotations - [{ nx, ny, family }] normalized coords
 */
export function stampAnnotations(grid, gridSize, annotations) {
    if (!annotations || annotations.length === 0) return;

    const r = ANNOTATION_STAMP_RADIUS;
    const rSq = r * r;

    for (const ann of annotations) {
        const catIdx = FAMILY_TO_GRID[ann.family];
        if (!catIdx) continue;

        const cx = Math.round(ann.nx * (gridSize - 1));
        const cy = Math.round(ann.ny * (gridSize - 1));

        // Stamp a filled circle
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > rSq) continue;
                const gx = cx + dx;
                const gy = cy + dy;
                if (gx < 0 || gx >= gridSize || gy < 0 || gy >= gridSize) continue;
                grid[gy * gridSize + gx] = catIdx;
            }
        }
    }
}
