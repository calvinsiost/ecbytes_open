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
   SAM INTERACTIVE — Segment Anything Model (click-to-segment)
   ================================================================

   Motor de segmentacao interativa Zero-Shot usando SlimSAM via
   Transformers.js v3. O usuario clica em um objeto no mapa aereo
   e a IA devolve a mascara exata daquele elemento.

   Modelo: Xenova/slimsam-77-uniform (~50 MB quantizado)
   CDN: Transformers.js v3 (@huggingface/transformers@3)

   API correta do Transformers.js para SAM:
     const inputs = await processor(raw_image, { input_points: [[[x, y]]] });
     const outputs = await model(inputs);
     const masks = await processor.post_process_masks(
         outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes
     );

   Two-phase optimization:
     1. setImage(): processor(image) + model.get_image_embeddings(inputs)
     2. segmentAtPoint(): processor(image, {input_points}) → inject embeddings → model()

   ================================================================ */

import { largestContour } from './postprocess/marchingSquares.js';
import { antiAmebaSingle } from './postprocess/index.js';

// ----------------------------------------------------------------
// CDN & MODEL CONFIGURATION
// ----------------------------------------------------------------

import { importCDN } from '../../utils/helpers/cdnLoader.js';

const TRANSFORMERS_V3_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3';

// Dual-model registry — usuario pode escolher entre SlimSAM (rapido) e SAM 2 (preciso)
const SAM_MODELS = {
    slim: { id: 'Xenova/slimsam-77-uniform', size: '~50 MB', label: 'SlimSAM (fast)' },
    // SAM 2.1 ONNX — disponivel quando Xenova publicar port quantizado
    // sam2: { id: 'Xenova/sam2-hiera-tiny', size: '~150 MB', label: 'SAM 2.1 (precise)' },
};
let _selectedModelKey = 'slim';

// ----------------------------------------------------------------
// MODEL STATE — Singleton with two-phase lifecycle
// ----------------------------------------------------------------

let _transformers = null;
let _model = null;
let _processor = null;
let _loading = false;

// Image state (reused across clicks)
let _imageEmbeddings = null;
let _rawImage = null;
let _currentImageUrl = null;
let _imageWidth = 0;
let _imageHeight = 0;

// ----------------------------------------------------------------
// PUBLIC API — Load Model
// ----------------------------------------------------------------

/**
 * Select which SAM model to use. Forces reload on next loadSAM() if different.
 * @param {string} key - 'slim' or 'sam2' (when available)
 */
export function selectSAMModel(key) {
    if (!SAM_MODELS[key]) {
        console.warn(`[ecbyts] Unknown SAM model key: ${key}. Available:`, Object.keys(SAM_MODELS));
        return;
    }
    if (_selectedModelKey !== key) {
        // Force reload on next call
        _model = null;
        _processor = null;
        _imageEmbeddings = null;
        _rawImage = null;
        _currentImageUrl = null;
        _selectedModelKey = key;
    }
}

/**
 * Get available SAM models for UI rendering.
 * @returns {Array<{key: string, id: string, size: string, label: string, selected: boolean}>}
 */
export function getSAMModels() {
    return Object.entries(SAM_MODELS).map(([key, m]) => ({
        key,
        ...m,
        selected: key === _selectedModelKey,
    }));
}

/**
 * Load SAM model from CDN.
 * Primeiro load faz download (cacheado pelo Cache API).
 * Chamadas subsequentes reutilizam o modelo em memoria.
 *
 * @param {Function} [onProgress] - Callback: { message, progress }
 * @returns {Promise<void>}
 */
export async function loadSAM(onProgress) {
    if (_model && _processor) return; // Ja carregado
    if (_loading) throw new Error('SAM is already loading. Please wait.');

    _loading = true;

    try {
        // Load Transformers.js v3
        if (!_transformers) {
            _notify(onProgress, 'Loading ML engine...', 0);
            _transformers = await importCDN(TRANSFORMERS_V3_CDN, { name: 'Transformers.js v3' });
            if (_transformers.env) _transformers.env.allowLocalModels = false;
        }

        // Load SAM model (selected variant)
        const modelConfig = SAM_MODELS[_selectedModelKey];
        const modelId = modelConfig.id;
        _notify(onProgress, `Downloading ${modelConfig.label} (${modelConfig.size})...`, 5);

        const progressCb = (data) => {
            if (data.status === 'progress' && typeof data.progress === 'number') {
                const pct = Math.round(data.progress);
                _notify(onProgress, `Downloading SAM... ${pct}%`, 5 + pct * 0.85);
            }
        };

        // Load model and processor in parallel
        const [model, processor] = await Promise.all([
            _transformers.SamModel.from_pretrained(modelId, {
                quantized: true,
                progress_callback: progressCb,
            }),
            _transformers.AutoProcessor.from_pretrained(modelId),
        ]);

        _model = model;
        _processor = processor;

        _notify(onProgress, 'SAM ready', 100);
    } catch (err) {
        _model = null;
        _processor = null;
        throw new Error(`Failed to load SAM model: ${err.message}`, { cause: err });
    } finally {
        _loading = false;
    }
}

// ----------------------------------------------------------------
// PUBLIC API — Set Image (encode embeddings)
// ----------------------------------------------------------------

/**
 * Set the image for SAM processing.
 * Deve ser chamado antes de segmentAtPoint. Encode image embeddings
 * (~2-3s na primeira vez). Se a mesma imagem for passada novamente,
 * reutiliza embeddings existentes.
 *
 * @param {string} imageDataUrl - Base64 data URL
 * @param {Function} [onProgress] - Callback
 * @returns {Promise<void>}
 */
export async function setImage(imageDataUrl, onProgress) {
    if (!_model || !_processor) {
        throw new Error('SAM model not loaded. Call loadSAM() first.');
    }

    // Skip re-encoding se imagem e a mesma
    if (_currentImageUrl === imageDataUrl && _imageEmbeddings) {
        _notify(onProgress, 'Image already encoded', 100);
        return;
    }

    _notify(onProgress, 'Encoding image...', 10);

    // Load image via Transformers.js RawImage
    _rawImage = await _transformers.RawImage.read(imageDataUrl);
    _imageWidth = _rawImage.width;
    _imageHeight = _rawImage.height;

    // Process image (resize + normalize) sem pontos
    _notify(onProgress, 'Processing image...', 30);
    const inputs = await _processor(_rawImage);

    // Encode image embeddings (heavy step, ~2-3s)
    _notify(onProgress, 'Computing embeddings...', 50);
    _imageEmbeddings = await _model.get_image_embeddings(inputs);
    _currentImageUrl = imageDataUrl;

    _notify(onProgress, 'Image encoded — click to segment', 100);
}

// ----------------------------------------------------------------
// PUBLIC API — Segment at Point (per-click)
// ----------------------------------------------------------------

/**
 * Segment object at click point.
 * Retorna mascara binaria + contorno para o objeto sob o pixel clicado.
 * Rapido (~200ms) porque reutiliza embeddings pre-computados.
 *
 * API Transformers.js:
 *   const inputs = await processor(raw_image, { input_points: [[[x, y]]] });
 *   const outputs = await model({ ...image_embeddings, ...inputs });
 *
 * @param {number} x - Click X in pixel space (0 to width-1)
 * @param {number} y - Click Y in pixel space (0 to height-1)
 * @param {Object} extent - { minX, maxX, minZ, maxZ }
 * @param {Object} [options={}]
 * @param {string} [options.family='building'] - Classification hint
 * @param {number} [options.maskThreshold=0.0] - Mask threshold
 * @returns {Promise<SAMResult|null>}
 *
 * @typedef {Object} SAMResult
 * @property {Uint8Array} mask - Binary mask (0 or 255), width x height
 * @property {Array<{x: number, y: number}>} contour - Pixel contour
 * @property {Object|null} processed - Anti-Ameba result (worldContour, area_m2, etc.)
 * @property {number} maskWidth
 * @property {number} maskHeight
 */
export async function segmentAtPoint(x, y, extent, options = {}) {
    if (!_model || !_processor || !_imageEmbeddings || !_rawImage) {
        throw new Error('Image not encoded. Call setImage() first.');
    }

    const { family = 'building', maskThreshold = 0.0 } = options;

    // Clamp coordinates
    const px = Math.max(0, Math.min(_imageWidth - 1, Math.round(x)));
    const py = Math.max(0, Math.min(_imageHeight - 1, Math.round(y)));

    // Processar imagem com ponto de entrada (API oficial do Transformers.js)
    // input_points: [[[x, y]]] — batch → image → points
    const inputs = await _processor(_rawImage, {
        input_points: [[[px, py]]],
    });

    // Run model com embeddings pre-computados + inputs processados
    const outputs = await _model({
        ...inputs,
        ..._imageEmbeddings,
    });

    // Post-process: extract masks
    const masks = await _processor.post_process_masks(
        outputs.pred_masks,
        inputs.original_sizes,
        inputs.reshaped_input_sizes,
    );

    // masks[0] = batch 0, contém array de mascaras candidatas
    const maskData = masks[0];
    if (!maskData || maskData.length === 0) {
        _disposeTensors(outputs, masks, inputs);
        return null;
    }

    // Select best mask by IoU score
    let bestMaskIdx = 0;
    if (outputs.iou_scores) {
        const iouData = outputs.iou_scores.data;
        let bestIou = -Infinity;
        for (let i = 0; i < iouData.length; i++) {
            if (iouData[i] > bestIou) {
                bestIou = iouData[i];
                bestMaskIdx = i;
            }
        }
    }

    // Convert mask tensor to binary Uint8Array (0 or 255)
    const maskTensor = maskData[bestMaskIdx];
    const H = _imageHeight;
    const W = _imageWidth;
    const binaryMask = new Uint8Array(W * H);

    const rawData = maskTensor.data;
    for (let i = 0; i < rawData.length && i < binaryMask.length; i++) {
        binaryMask[i] = rawData[i] > maskThreshold ? 255 : 0;
    }

    // Dispose tensors — libera memoria WASM/WebGL imediatamente
    _disposeTensors(outputs, masks, inputs);

    // Extract contour via marching squares
    const contour = largestContour(binaryMask, W, H);
    if (!contour || contour.length < 3) return null;

    // Run Anti-Ameba pipeline
    const processed = antiAmebaSingle(binaryMask, family, extent, W, H);

    return {
        mask: binaryMask,
        contour,
        processed,
        maskWidth: W,
        maskHeight: H,
    };
}

// ----------------------------------------------------------------
// PUBLIC API — Multi-Point (positive + negative prompts)
// ----------------------------------------------------------------

/**
 * Segment with multiple point prompts (positive + negative).
 * Permite refinar a selecao: cliques positivos incluem, negativos excluem.
 *
 * @param {Array<{x: number, y: number, label: number}>} points
 *        label: 1 = include (foreground), 0 = exclude (background)
 * @param {Object} extent
 * @param {Object} [options={}]
 * @returns {Promise<SAMResult|null>}
 */
export async function segmentAtPoints(points, extent, options = {}) {
    if (!_model || !_processor || !_imageEmbeddings || !_rawImage) {
        throw new Error('Image not encoded. Call setImage() first.');
    }
    if (!points || points.length === 0) return null;

    const { family = 'building', maskThreshold = 0.0 } = options;

    // Formatar pontos: [[[x1,y1], [x2,y2], ...]]
    // Labels: [[1, 0, 1, ...]]
    const inputPoints = [
        points.map((p) => [
            Math.max(0, Math.min(_imageWidth - 1, Math.round(p.x))),
            Math.max(0, Math.min(_imageHeight - 1, Math.round(p.y))),
        ]),
    ];
    const inputLabels = [points.map((p) => p.label)];

    const inputs = await _processor(_rawImage, {
        input_points: inputPoints,
        input_labels: inputLabels,
    });

    const outputs = await _model({
        ...inputs,
        ..._imageEmbeddings,
    });

    const masks = await _processor.post_process_masks(
        outputs.pred_masks,
        inputs.original_sizes,
        inputs.reshaped_input_sizes,
    );

    const maskData = masks[0];
    if (!maskData || maskData.length === 0) {
        _disposeTensors(outputs, masks, inputs);
        return null;
    }

    // Select best mask by IoU
    let bestMaskIdx = 0;
    if (outputs.iou_scores) {
        const iouData = outputs.iou_scores.data;
        let bestIou = -Infinity;
        for (let i = 0; i < iouData.length; i++) {
            if (iouData[i] > bestIou) {
                bestIou = iouData[i];
                bestMaskIdx = i;
            }
        }
    }

    const maskTensor = maskData[bestMaskIdx];
    const H = _imageHeight;
    const W = _imageWidth;
    const binaryMask = new Uint8Array(W * H);
    const rawData = maskTensor.data;
    for (let i = 0; i < rawData.length && i < binaryMask.length; i++) {
        binaryMask[i] = rawData[i] > maskThreshold ? 255 : 0;
    }

    _disposeTensors(outputs, masks, inputs);

    const contour = largestContour(binaryMask, W, H);
    if (!contour || contour.length < 3) return null;

    const processed = antiAmebaSingle(binaryMask, family, extent, W, H);

    return { mask: binaryMask, contour, processed, maskWidth: W, maskHeight: H };
}

// ----------------------------------------------------------------
// PUBLIC API — Status
// ----------------------------------------------------------------

/**
 * Check SAM model and image encoding status.
 * @returns {{ modelLoaded: boolean, imageEncoded: boolean, modelSize: string, imageWidth: number, imageHeight: number }}
 */
export function getSAMStatus() {
    return {
        modelLoaded: _model !== null && _processor !== null,
        imageEncoded: _imageEmbeddings !== null,
        modelSize: '~50 MB',
        imageWidth: _imageWidth,
        imageHeight: _imageHeight,
    };
}

/**
 * Get internal model state for shared use by samAutoMask.js.
 * Retorna objeto congelado (read-only) para evitar mutacao acidental.
 * samAutoMask reutiliza o singleton — sem download adicional.
 *
 * @returns {{ model, processor, transformers, imageEmbeddings, rawImage, imageWidth, imageHeight } | null}
 */
export function getModelState() {
    if (!_model || !_processor) return null;
    return Object.freeze({
        model: _model,
        processor: _processor,
        transformers: _transformers,
        imageEmbeddings: _imageEmbeddings,
        rawImage: _rawImage,
        imageWidth: _imageWidth,
        imageHeight: _imageHeight,
    });
}

/**
 * Clear cached image embeddings (free memory).
 * Chamado quando usuario muda de imagem ou fecha o modal.
 */
export function clearImageCache() {
    _imageEmbeddings = null;
    _rawImage = null;
    _currentImageUrl = null;
    _imageWidth = 0;
    _imageHeight = 0;
}

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

function _notify(onProgress, message, progress) {
    onProgress?.({ message, progress });
}

/**
 * Dispose Transformers.js tensors to free WASM/WebGL memory.
 * Chamado apos converter mascaras para Uint8Array — tensores nao sao
 * mais necessarios. Sem dispose, cada segmentAtPoint() vazaria ~1 MB.
 *
 * @param {Object} outputs - model() output (pred_masks, iou_scores)
 * @param {Array} masks - post_process_masks output
 * @param {Object} inputs - processor() output (pixel_values)
 */
function _disposeTensors(outputs, masks, inputs) {
    try {
        outputs?.pred_masks?.dispose?.();
        outputs?.iou_scores?.dispose?.();
        if (masks) {
            for (const maskSet of masks) {
                if (!maskSet) continue;
                for (const m of maskSet) {
                    m?.dispose?.();
                }
            }
        }
        inputs?.pixel_values?.dispose?.();
    } catch {
        /* Some backends may not support dispose — safe to ignore */
    }
}
