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
   SPECTRAL INDICES & EDGE DETECTION — Funcoes auxiliares para
   classificacao de pixels em imagens aereas/satelite
   ================================================================

   Indices espectrais (ExG, C3 shadow) e deteccao de bordas (Sobel)
   para complementar a classificacao HSL existente. Todas as funcoes
   sao puras e operam em valores RGB 0-255.

   ================================================================ */

// ----------------------------------------------------------------
// VEGETATION INDEX (Excess Green)
// Indice de vegetacao baseado em excesso de verde normalizado
// ----------------------------------------------------------------

/**
 * Compute Excess Green Index for vegetation detection.
 * Mais robusto que matiz HSL para separar vegetacao de sombras.
 * Vegetacao retorna valores positivos; sombras e solo retornam negativos.
 *
 * @param {number} r - Red 0-255
 * @param {number} g - Green 0-255
 * @param {number} b - Blue 0-255
 * @returns {number} ExG value, typically -1 to +1
 */
export function excessGreen(r, g, b) {
    const sum = r + g + b;
    if (sum < 30) return 0; // Pixels muito escuros — sem informacao de cor
    const rn = r / sum;
    const gn = g / sum;
    const bn = b / sum;
    return 2 * gn - rn - bn;
}

// ----------------------------------------------------------------
// SHADOW DETECTION (C3 Index)
// Deteccao de sombras via desvio azul atmosferico (Rayleigh)
// ----------------------------------------------------------------

/**
 * Compute C3 shadow index.
 * Sombras tem desvio azul por espalhamento Rayleigh na atmosfera.
 * Valores altos indicam dominancia de azul relativo a R e G.
 *
 * @param {number} r - Red 0-255
 * @param {number} g - Green 0-255
 * @param {number} b - Blue 0-255
 * @returns {number} C3 value in radians (0 to pi/2)
 */
export function shadowIndex(r, g, b) {
    const maxRG = Math.max(r, g);
    if (maxRG === 0 && b === 0) return 0;
    return Math.atan2(b, maxRG);
}

/**
 * Determine if pixel is likely a shadow.
 * Combina indice C3 com limiar de luminancia baixa.
 *
 * @param {number} r - Red 0-255
 * @param {number} g - Green 0-255
 * @param {number} b - Blue 0-255
 * @returns {boolean} true se provavel sombra
 */
export function isShadow(r, g, b) {
    const c3 = shadowIndex(r, g, b);
    // Luminancia perceptual (BT.601)
    const lum = ((0.299 * r + 0.587 * g + 0.114 * b) / 255) * 100;
    // Sombra: forte desvio azul E luminancia baixa
    return c3 > 0.85 && lum < 40;
}

// ----------------------------------------------------------------
// ADAPTIVE THRESHOLDING (Otsu)
// Limiar otimo automatico por maximizacao de variancia inter-classe
// ----------------------------------------------------------------

/**
 * Find optimal binary threshold using Otsu's method.
 * Maximiza variancia entre as duas classes (foreground/background).
 *
 * @param {Uint32Array|number[]} histogram - 256-bin histogram
 * @param {number} total - Total pixel count
 * @returns {number} Optimal threshold (0-255)
 */
export function otsuThreshold(histogram, total) {
    if (total === 0) return 128;

    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * histogram[i];

    let sumBg = 0;
    let weightBg = 0;
    let bestThreshold = 0;
    let bestVariance = 0;

    for (let t = 0; t < 256; t++) {
        weightBg += histogram[t];
        if (weightBg === 0) continue;

        const weightFg = total - weightBg;
        if (weightFg === 0) break;

        sumBg += t * histogram[t];
        const meanBg = sumBg / weightBg;
        const meanFg = (sumAll - sumBg) / weightFg;
        const diff = meanBg - meanFg;
        const variance = weightBg * weightFg * diff * diff;

        if (variance > bestVariance) {
            bestVariance = variance;
            bestThreshold = t;
        }
    }

    return bestThreshold;
}

// ----------------------------------------------------------------
// GRAYSCALE CONVERSION
// Converte buffer RGBA para buffer de luminancia 8-bit
// ----------------------------------------------------------------

/**
 * Convert RGBA pixel buffer to grayscale Uint8Array.
 * Usa pesos de luminancia perceptual (BT.601).
 *
 * @param {Uint8ClampedArray} pixels - RGBA pixel data (4 bytes per pixel)
 * @param {number} count - Number of pixels
 * @returns {Uint8Array} Grayscale buffer
 */
export function toGrayscale(pixels, count) {
    const gray = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
        const off = i * 4;
        gray[i] = Math.round(0.299 * pixels[off] + 0.587 * pixels[off + 1] + 0.114 * pixels[off + 2]);
    }
    return gray;
}

// ----------------------------------------------------------------
// SOBEL EDGE DETECTION
// Deteccao de bordas via operador Sobel 3x3
// ----------------------------------------------------------------

/**
 * Compute edge magnitude map using 3x3 Sobel operator.
 * Calcula magnitude do gradiente em cada pixel para detectar bordas.
 * Bordas fortes indicam estruturas (edificios); areas lisas indicam
 * sombras, agua ou vegetacao homogenea.
 *
 * @param {Uint8Array} gray - Grayscale image buffer
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @returns {Uint8Array} Edge magnitude map (0-255)
 */
export function computeEdgeMap(gray, w, h) {
    const edges = new Uint8Array(w * h);

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            // Sobel Gx kernel: [-1 0 1; -2 0 2; -1 0 1]
            const gx =
                -gray[(y - 1) * w + (x - 1)] +
                gray[(y - 1) * w + (x + 1)] -
                2 * gray[y * w + (x - 1)] +
                2 * gray[y * w + (x + 1)] -
                gray[(y + 1) * w + (x - 1)] +
                gray[(y + 1) * w + (x + 1)];

            // Sobel Gy kernel: [-1 -2 -1; 0 0 0; 1 2 1]
            const gy =
                -gray[(y - 1) * w + (x - 1)] -
                2 * gray[(y - 1) * w + x] -
                gray[(y - 1) * w + (x + 1)] +
                gray[(y + 1) * w + (x - 1)] +
                2 * gray[(y + 1) * w + x] +
                gray[(y + 1) * w + (x + 1)];

            // Magnitude approximation (fast: |gx| + |gy| instead of sqrt)
            const mag = Math.abs(gx) + Math.abs(gy);
            edges[y * w + x] = Math.min(255, mag >> 2); // Scale down to 0-255
        }
    }

    return edges;
}

/**
 * Compute edge density within a blob's bounding box.
 * Conta pixels de borda fortes dentro do blob para distinguir
 * estruturas (bordas densas) de sombras (bordas esparsas).
 *
 * @param {Uint8Array} edgeMap - Edge magnitude per pixel
 * @param {Uint8Array} grid - Category grid (same dimensions)
 * @param {Object} blob - Blob with minX, maxX, minY, maxY, category, pixels
 * @param {number} w - Image width
 * @param {number} edgeThreshold - Magnitude threshold (default 30)
 * @returns {number} Edge density ratio (0-1)
 */
export function blobEdgeDensity(edgeMap, grid, blob, w, edgeThreshold = 30) {
    if (blob.pixels === 0) return 0;

    let edgeCount = 0;
    for (let y = blob.minY; y <= blob.maxY; y++) {
        for (let x = blob.minX; x <= blob.maxX; x++) {
            const idx = y * w + x;
            // Conta apenas pixels que pertencem ao blob (mesma categoria)
            if (grid[idx] === blob.category && edgeMap[idx] > edgeThreshold) {
                edgeCount++;
            }
        }
    }

    return edgeCount / blob.pixels;
}
