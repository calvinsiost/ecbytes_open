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
   SPECTRAL REGRESSION — vNDVI, SAVI, and biomass estimation
   ================================================================

   Estimativa de indices de vegetacao e biomassa a partir de imagens
   RGB (sem banda NIR). Duas estrategias com degradacao graciosa:

   TIER 1 — Synthetic vNDVI from RGB (~5ms, zero modelos):
     Formula comprovada na literatura: vNDVI = (2G - R - B) / (2G + R + B)
     Correlacao ~0.85 com NDVI real para vegetacao visivel.

   TIER 2 — SimpleNN regression (treino in-browser):
     Usuario pinta patches de calibracao com valores conhecidos.
     Rede neural leve (6→16→8→1, modo regressao) treina em ~2s.
     Pesos persistidos em IndexedDB por site.

   Provenance:
   - vNDVI: Zheng et al. 2018 "Estimation of Paddy Rice Nitrogen Content"
     DOI: 10.1016/j.compag.2019.105083
   - SAVI: Huete 1988 "A Soil-Adjusted Vegetation Index (SAVI)"
     DOI: 10.1016/0034-4257(88)90106-X
   - ExG: Woebbecke et al. 1995 "Color Indices for Weed Identification"

   ================================================================ */

import { excessGreen } from './indices.js';

const ANALYSIS_SIZE = 512;

// Colormaps for rendering overlays
const COLORMAPS = {
    viridis: [
        [68, 1, 84],
        [72, 35, 116],
        [64, 67, 135],
        [52, 94, 141],
        [33, 145, 140],
        [53, 183, 121],
        [109, 205, 89],
        [180, 222, 44],
        [253, 231, 37],
    ],
    RdYlGn: [
        [165, 0, 38],
        [215, 48, 39],
        [244, 109, 67],
        [253, 174, 97],
        [255, 255, 191],
        [166, 217, 106],
        [102, 189, 99],
        [26, 152, 80],
        [0, 104, 55],
    ],
    coolwarm: [
        [59, 76, 192],
        [98, 130, 234],
        [141, 176, 254],
        [184, 208, 249],
        [221, 221, 221],
        [245, 196, 173],
        [241, 152, 122],
        [222, 96, 77],
        [180, 4, 38],
    ],
};

// ----------------------------------------------------------------
// TIER 1: SYNTHETIC vNDVI FROM RGB
// ----------------------------------------------------------------

/**
 * Compute visual NDVI (vNDVI) from RGB image.
 * vNDVI = (2*G - R - B) / (2*G + R + B), range [-1, +1].
 *
 * @param {string} imageDataUrl - Base64 image
 * @returns {Promise<{grid: Float32Array, w: number, h: number, stats: {min: number, max: number, mean: number}}>}
 */
export async function computeVNDVI(imageDataUrl) {
    const { pixels, w, h } = await _loadImagePixels(imageDataUrl);
    const count = w * h;
    const grid = new Float32Array(count);

    let min = 1,
        max = -1,
        sum = 0;
    for (let i = 0; i < count; i++) {
        const off = i * 4;
        const r = pixels[off],
            g = pixels[off + 1],
            b = pixels[off + 2];
        const denom = 2 * g + r + b;
        const vndvi = denom > 30 ? (2 * g - r - b) / denom : 0;
        grid[i] = vndvi;
        if (vndvi < min) min = vndvi;
        if (vndvi > max) max = vndvi;
        sum += vndvi;
    }

    return { grid, w, h, stats: { min, max, mean: sum / count } };
}

/**
 * Compute Soil-Adjusted Vegetation Index proxy from RGB.
 * SAVI_proxy = vNDVI * (1 + L), where L = 0.5 (standard).
 *
 * @param {string} imageDataUrl - Base64 image
 * @returns {Promise<{grid: Float32Array, w: number, h: number, stats: Object}>}
 */
export async function computeSAVI(imageDataUrl) {
    const result = await computeVNDVI(imageDataUrl);
    const L = 0.5;
    const count = result.w * result.h;
    for (let i = 0; i < count; i++) {
        result.grid[i] *= 1 + L;
    }
    result.stats.min *= 1 + L;
    result.stats.max *= 1 + L;
    result.stats.mean *= 1 + L;
    return result;
}

/**
 * Compute Water Index proxy from RGB.
 * Uses blue-green ratio as NDWI approximation.
 *
 * @param {string} imageDataUrl - Base64 image
 * @returns {Promise<{grid: Float32Array, w: number, h: number, stats: Object}>}
 */
export async function computeWaterIndex(imageDataUrl) {
    const { pixels, w, h } = await _loadImagePixels(imageDataUrl);
    const count = w * h;
    const grid = new Float32Array(count);

    let min = 1,
        max = -1,
        sum = 0;
    for (let i = 0; i < count; i++) {
        const off = i * 4;
        const r = pixels[off],
            g = pixels[off + 1],
            b = pixels[off + 2];
        // NDWI proxy: (G - NIR_proxy) / (G + NIR_proxy) where NIR_proxy ≈ R
        const denom = g + r;
        const wi = denom > 10 ? (g - r) / denom : 0;
        grid[i] = wi;
        if (wi < min) min = wi;
        if (wi > max) max = wi;
        sum += wi;
    }

    return { grid, w, h, stats: { min, max, mean: sum / count } };
}

// ----------------------------------------------------------------
// TIER 2: SIMPLENN REGRESSION (train-in-browser)
// ----------------------------------------------------------------

/**
 * Train regression model from calibration patches.
 * Cada patch: { pixels: [{r,g,b}], value: number (ex: NDVI 0.72) }.
 *
 * @param {Array<{pixels: Array, value: number}>} calibrationPatches
 * @param {string} siteId - Site identifier for IDB persistence
 * @param {Function} [onProgress] - Progress callback
 * @returns {Promise<{loss: number, epochs: number}>}
 */
export async function trainRegressionModel(calibrationPatches, siteId, onProgress) {
    // Lazy import NN (avoid circular deps)
    const { SimpleNN } = await import('../nn/network.js');
    const { idbSet } = await import('../../utils/storage/idbStore.js');

    // Extract training data: [R, G, B, H, S, L] normalized → target value
    const inputs = [];
    const outputs = [];

    for (const patch of calibrationPatches) {
        for (const px of patch.pixels) {
            const { r, g, b } = px;
            const [h, s, l] = _rgbToHSL(r, g, b);
            inputs.push([r / 255, g / 255, b / 255, h / 360, s / 100, l / 100]);
            outputs.push([patch.value]); // Target NDVI/biomass value
        }
    }

    if (inputs.length < 10) {
        throw new Error('Need at least 10 calibration pixels (paint more patches)');
    }

    onProgress?.({ message: `Training on ${inputs.length} samples...`, progress: 20 });

    const nn = new SimpleNN({
        inputSize: 6,
        hiddenLayerSizes: [16, 8],
        outputSize: 1,
        mode: 'regression',
    });

    const config = { epochs: 200, learningRate: 0.01, batchSize: 32 };
    const result = nn.train(inputs, outputs, config);

    onProgress?.({ message: 'Persisting model...', progress: 90 });

    // Save to IndexedDB
    const key = `ecbyts-spectral-model-${siteId}`;
    await idbSet(key, nn.toJSON());

    onProgress?.({ message: 'Model trained and saved', progress: 100 });

    return { loss: result.loss, epochs: result.epochs };
}

/**
 * Predict index values using trained regression model.
 *
 * @param {string} imageDataUrl - Input image
 * @param {string} siteId - Site ID to load model from IDB
 * @returns {Promise<{grid: Float32Array, w: number, h: number, stats: Object}>}
 */
export async function predictWithModel(imageDataUrl, siteId) {
    const { SimpleNN } = await import('../nn/network.js');
    const { idbGet } = await import('../../utils/storage/idbStore.js');

    const key = `ecbyts-spectral-model-${siteId}`;
    const modelData = await idbGet(key);
    if (!modelData) throw new Error(`No trained model found for site ${siteId}`);

    const nn = SimpleNN.fromJSON(modelData);
    const { pixels, w, h } = await _loadImagePixels(imageDataUrl);
    const count = w * h;
    const grid = new Float32Array(count);

    let min = Infinity,
        max = -Infinity,
        sum = 0;
    for (let i = 0; i < count; i++) {
        const off = i * 4;
        const r = pixels[off],
            g = pixels[off + 1],
            b = pixels[off + 2];
        const [hue, sat, lum] = _rgbToHSL(r, g, b);
        const input = [r / 255, g / 255, b / 255, hue / 360, sat / 100, lum / 100];
        const output = nn.forward(input);
        const value = output[0];
        grid[i] = value;
        if (value < min) min = value;
        if (value > max) max = value;
        sum += value;
    }

    return { grid, w, h, stats: { min, max, mean: sum / count } };
}

// ----------------------------------------------------------------
// OVERLAY RENDERING — Colormap visualization
// ----------------------------------------------------------------

/**
 * Render index grid as colored overlay image.
 *
 * @param {Float32Array} grid - Index values
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {string} [colormapName='RdYlGn'] - Colormap name
 * @param {number} [minVal] - Min value for scaling (auto if omitted)
 * @param {number} [maxVal] - Max value for scaling (auto if omitted)
 * @returns {string} Overlay image dataURL (PNG with transparency)
 */
export function renderIndexOverlay(grid, w, h, colormapName = 'RdYlGn', minVal, maxVal) {
    const cmap = COLORMAPS[colormapName] || COLORMAPS.RdYlGn;
    const count = w * h;

    // Auto-detect range if not provided
    if (minVal === undefined || maxVal === undefined) {
        let mn = Infinity,
            mx = -Infinity;
        for (let i = 0; i < count; i++) {
            if (grid[i] < mn) mn = grid[i];
            if (grid[i] > mx) mx = grid[i];
        }
        if (minVal === undefined) minVal = mn;
        if (maxVal === undefined) maxVal = mx;
    }

    const range = maxVal - minVal || 1;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let i = 0; i < count; i++) {
        const t = Math.max(0, Math.min(1, (grid[i] - minVal) / range));
        const idx = Math.min(cmap.length - 1, Math.floor(t * (cmap.length - 1)));
        const frac = t * (cmap.length - 1) - idx;
        const next = Math.min(cmap.length - 1, idx + 1);

        const off = i * 4;
        data[off] = Math.round(cmap[idx][0] + frac * (cmap[next][0] - cmap[idx][0]));
        data[off + 1] = Math.round(cmap[idx][1] + frac * (cmap[next][1] - cmap[idx][1]));
        data[off + 2] = Math.round(cmap[idx][2] + frac * (cmap[next][2] - cmap[idx][2]));
        data[off + 3] = 180; // Semi-transparent
    }

    ctx.putImageData(imageData, 0, 0);
    const result = canvas.toDataURL('image/png');
    canvas.width = 0;
    canvas.height = 0;
    return result;
}

// ----------------------------------------------------------------
// INTERNALS
// ----------------------------------------------------------------

async function _loadImagePixels(imageDataUrl) {
    const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = imageDataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = ANALYSIS_SIZE;
    canvas.height = ANALYSIS_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
    const imageData = ctx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
    canvas.width = 0;
    canvas.height = 0;
    return { pixels: imageData.data, w: ANALYSIS_SIZE, h: ANALYSIS_SIZE };
}

function _rgbToHSL(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, Math.round(l * 100)];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export { COLORMAPS };
