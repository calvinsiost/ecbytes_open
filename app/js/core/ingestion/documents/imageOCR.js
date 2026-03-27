// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// @since v0.2

/**
 * imageOCR.js — Tesseract.js WASM wrapper for document image OCR.
 *
 * Features:
 * - Self-hosted traineddata (Supabase Storage) with jsdelivr CDN fallback
 * - Budget-aware batch processing (stops after time limit)
 * - LIFO cancel-previous queue (second batch aborts first)
 * - Progressive onResult callback for live UI updates
 * - Post-processing for environmental domain (μg/L, well IDs)
 *
 * @module core/ingestion/documents/imageOCR
 */

import { postProcessOCR } from './ocrPostProcess.js';
import { emptyOCRResult } from './types.js';
import { importCDN } from '../../../utils/helpers/cdnLoader.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Traineddata URLs — primary (self-hosted) + fallback (CDN) */
const TRAINEDDATA_CONFIG = {
    primary: {
        // Replace <project-ref> with actual Supabase project reference
        langPath: '/storage/v1/object/public/static-assets/tesseract/',
    },
    fallback: {
        // @5/ resolve para ultimo 5.x.y — aceitavel pois traineddata e backward-compatible
        langPath: 'https://cdn.jsdelivr.net/npm/tesseract.js-data@5/',
    },
};

/** Tesseract.js CDN (ESM) — pinned version, loaded via importCDN() */
const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';

/** Default language configuration */
const DEFAULT_LANG = 'por+eng';

/** Minimum word confidence to include in words[] (Tesseract scale 0-100) */
const DEFAULT_MIN_WORD_CONFIDENCE = 30;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _Tesseract = null;
let _worker = null;
let _ready = false;
let _currentAbortController = null;
let _initPromise = null;

function _isWorkerCloneError(err) {
    const msg = String(err?.message || '');
    return /DataCloneError|could not be cloned|postMessage/i.test(msg);
}

async function _createWorkerCompat(langs, options) {
    const langCodes = Array.isArray(langs) ? langs : [String(langs || DEFAULT_LANG)];
    const langString = langCodes.join('+');
    const calls = [];
    const oem = _Tesseract?.OEM?.LSTM_ONLY;

    if (Number.isFinite(oem)) {
        calls.push(() => _Tesseract.createWorker(langCodes, oem, options));
        calls.push(() => _Tesseract.createWorker(langString, oem, options));
    }
    calls.push(() => _Tesseract.createWorker(langCodes, options));
    calls.push(() => _Tesseract.createWorker(langString, options));

    let lastError = null;
    for (const call of calls) {
        try {
            return await call();
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error('Failed to initialize OCR worker');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if WebAssembly is supported (required for Tesseract.js).
 * @returns {boolean}
 */
export function isOCRSupported() {
    try {
        return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
    } catch {
        return false;
    }
}

/**
 * Check if OCR engine is initialized and ready.
 * @returns {boolean}
 */
export function isOCRReady() {
    return _ready && _worker !== null;
}

/**
 * Initialize Tesseract worker (lazy, singleton).
 * Downloads WASM + traineddata on first call. Caches in IndexedDB.
 * Tries self-hosted traineddata first, falls back to jsdelivr CDN.
 *
 * @param {Object} [options]
 * @param {string} [options.lang='por+eng'] — Tesseract language codes
 * @param {function} [options.onProgress] — (percent: number, message: string) => void
 * @returns {Promise<void>}
 * @throws {Error} if both primary and fallback fail
 */
export async function initOCR(options = {}) {
    if (_ready && _worker) return;
    if (_initPromise) return _initPromise;
    _initPromise = _doInitOCR(options).finally(() => {
        _initPromise = null;
    });
    return _initPromise;
}

/** @private Actual init logic — serialized by _initPromise guard */
async function _doInitOCR(options = {}) {
    if (_ready && _worker) return;

    const { lang = DEFAULT_LANG, onProgress } = options;
    const langs = String(lang || DEFAULT_LANG)
        .split('+')
        .map((s) => s.trim())
        .filter(Boolean);
    const loggerFn =
        typeof onProgress === 'function'
            ? (m) => {
                  if (
                      m.status === 'loading tesseract core' ||
                      m.status === 'loading language traineddata' ||
                      m.status === 'initializing api'
                  ) {
                      onProgress(Math.round((m.progress || 0) * 100), m.status);
                  }
              }
            : null;

    // Lazy-load Tesseract.js via project CDN loader (timeout + cache)
    if (!_Tesseract) {
        try {
            _Tesseract = await importCDN(TESSERACT_CDN, { name: 'Tesseract.js' });
        } catch (e) {
            throw new Error(`Failed to load Tesseract.js: ${e.message}`);
        }
    }

    // Try self-hosted first, then CDN fallback
    let primaryError = null;

    try {
        const primaryOptions = {
            langPath: TRAINEDDATA_CONFIG.primary.langPath,
            cacheMethod: 'write',
        };
        if (loggerFn) primaryOptions.logger = loggerFn;
        _worker = await _createWorkerCompat(langs, primaryOptions);
        _ready = true;
        return;
    } catch (err) {
        // Some worker/runtime combinations cannot clone logger callbacks.
        if (loggerFn && _isWorkerCloneError(err)) {
            console.warn('[imageOCR] Worker logger unsupported, retrying without progress logger');
            try {
                _worker = await _createWorkerCompat(langs, {
                    langPath: TRAINEDDATA_CONFIG.primary.langPath,
                    cacheMethod: 'write',
                });
                _ready = true;
                return;
            } catch (retryErr) {
                primaryError = retryErr;
            }
        } else {
            primaryError = err;
        }
    }

    console.warn('[imageOCR] Self-hosted traineddata failed, trying CDN:', primaryError?.message || 'unknown');

    try {
        const fallbackOptions = {
            langPath: TRAINEDDATA_CONFIG.fallback.langPath,
            cacheMethod: 'write',
        };
        if (loggerFn) fallbackOptions.logger = loggerFn;
        _worker = await _createWorkerCompat(langs, fallbackOptions);
        _ready = true;
    } catch (fallbackErr) {
        if (loggerFn && _isWorkerCloneError(fallbackErr)) {
            try {
                _worker = await _createWorkerCompat(langs, {
                    langPath: TRAINEDDATA_CONFIG.fallback.langPath,
                    cacheMethod: 'write',
                });
                _ready = true;
                return;
            } catch (retryErr) {
                fallbackErr = retryErr;
            }
        }
        _worker = null;
        _ready = false;
        throw new Error(
            `OCR init failed. Primary: ${primaryError?.message || 'unknown'}. ` + `Fallback: ${fallbackErr.message}`,
        );
    }
}

/**
 * Run OCR on a single image.
 *
 * @param {string} dataUrl — base64 data URL (image/jpeg or image/png)
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.minWordConfidence=30]
 * @returns {Promise<import('./types.js').OCRResult>}
 */
export async function recognizeImage(dataUrl, options = {}) {
    if (!_ready || !_worker) {
        throw new Error('OCR not initialized. Call initOCR() first.');
    }

    const { signal, minWordConfidence = DEFAULT_MIN_WORD_CONFIDENCE } = options;
    const startTime = Date.now();

    try {
        if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

        const result = await _worker.recognize(dataUrl);
        const data = result.data;

        if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

        // Extract words with bboxes
        const words = [];
        let totalConf = 0;
        let wordCount = 0;

        for (const block of data.blocks || []) {
            for (const para of block.paragraphs || []) {
                for (const line of para.lines || []) {
                    for (const word of line.words || []) {
                        wordCount++;
                        totalConf += word.confidence;

                        if (word.confidence >= minWordConfidence) {
                            words.push({
                                text: word.text,
                                confidence: Math.round(word.confidence),
                                bbox: {
                                    x: word.bbox.x0,
                                    y: word.bbox.y0,
                                    width: word.bbox.x1 - word.bbox.x0,
                                    height: word.bbox.y1 - word.bbox.y0,
                                },
                            });
                        }
                    }
                }
            }
        }

        const meanConfidence = wordCount > 0 ? Math.round(totalConf / wordCount) : 0;
        const rawText = data.text || '';
        const processedText = postProcessOCR(rawText);
        const lines = processedText.split('\n').filter((l) => l.trim());

        return {
            text: processedText,
            confidence: meanConfidence,
            words,
            lines,
            error: null,
            durationMs: Date.now() - startTime,
        };
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        return {
            text: '',
            confidence: 0,
            words: [],
            lines: [],
            error: err.message || 'OCR failed',
            durationMs: Date.now() - startTime,
        };
    }
}

/**
 * Run OCR on multiple images (sequential — WASM is single-threaded).
 *
 * Budget-aware: stops processing after budgetMs. Remaining images get
 * error='budget_exceeded'.
 *
 * LIFO cancel-previous: if called while a previous batch is running,
 * the previous batch is aborted.
 *
 * @param {Array<{dataUrl: string, index: number}>} images
 * @param {Object} [options]
 * @param {number} [options.budgetMs=Infinity] — max total time
 * @param {function} [options.onProgress] — (index, total, result?) => void
 * @param {function} [options.onResult] — (index, total, result) => void (progressive UI)
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<import('./types.js').OCRResult[]>}
 */
export async function recognizeBatch(images, options = {}) {
    const { budgetMs = Infinity, onProgress, onResult, signal } = options;
    const results = [];
    const startTime = Date.now();

    // LIFO cancel-previous
    if (_currentAbortController) {
        _currentAbortController.abort();
    }
    _currentAbortController = new AbortController();

    const internalSignal = _currentAbortController.signal;

    for (let i = 0; i < images.length; i++) {
        // Check external abort
        if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        if (internalSignal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

        // Budget check
        if (Date.now() - startTime > budgetMs) {
            console.warn(`[imageOCR] Budget exceeded at ${i}/${images.length}. Remaining skipped.`);
            for (let j = i; j < images.length; j++) {
                const skip = emptyOCRResult('budget_exceeded');
                results.push(skip);
                if (onResult) onResult(j, images.length, skip);
            }
            break;
        }

        if (onProgress) onProgress(i, images.length, null);

        try {
            const result = await recognizeImage(images[i].dataUrl, {
                signal: internalSignal,
            });
            results.push(result);
            if (onResult) onResult(i, images.length, result);
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            const errResult = emptyOCRResult(err.message);
            results.push(errResult);
            if (onResult) onResult(i, images.length, errResult);
        }

        if (onProgress) onProgress(i + 1, images.length, results[results.length - 1]);
    }

    return results;
}

/**
 * Terminate Tesseract worker, free WASM memory.
 * @returns {Promise<void>}
 */
export async function terminateOCR() {
    if (_currentAbortController) {
        _currentAbortController.abort();
        _currentAbortController = null;
    }
    if (_worker) {
        try {
            await _worker.terminate();
        } catch {
            /* ignore */
        }
        _worker = null;
    }
    _ready = false;
}

// ---------------------------------------------------------------------------
// Pre-filter (before OCR)
// ---------------------------------------------------------------------------

/**
 * Pre-filter images before OCR. Removes decorations, prioritizes larger images.
 *
 * @param {Array<{width: number, height: number, page: number}>} images
 * @param {number} pageCount
 * @returns {{
 *   queue: Object[],      — images to OCR (priority order: largest first)
 *   skipped: Object[],    — filtered out (too small, extreme ratio)
 *   pageScans: Object[]   — page-sized images (scanned pages)
 * }}
 */
export function preFilterImages(images, pageCount) {
    const queue = [];
    const skipped = [];
    const pageScans = [];

    for (const img of images) {
        const w = img.width || 0;
        const h = img.height || 0;
        const ar = w / Math.max(h, 1);

        // Skip tiny (icons, decorations)
        if (w < 150 || h < 150) {
            skipped.push({ ...img, skipReason: 'too_small' });
            continue;
        }

        // Skip extreme aspect ratios (bars, lines, separators)
        if (ar > 6 || ar < 0.16) {
            skipped.push({ ...img, skipReason: 'extreme_aspect_ratio' });
            continue;
        }

        // Detect page-sized images (scanned page fragments)
        const isPageSize = (w > 800 && h > 1000) || (w > 1000 && h > 800);
        if (isPageSize && images.length > pageCount * 0.8) {
            pageScans.push(img);
            continue;
        }

        queue.push(img);
    }

    // Sort: larger images first (more likely to be maps/figures)
    queue.sort((a, b) => b.width * b.height - a.width * a.height);

    return { queue, skipped, pageScans };
}

/**
 * Estimate OCR time budget based on device capability.
 * Uses hardwareConcurrency as proxy for compute power.
 *
 * @returns {number} — budget in milliseconds
 */
export function estimateOCRBudget() {
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    return cores <= 2 ? 90000 : 45000; // slower devices get more time
}

/**
 * Convert a Blob to a data URL (for Tesseract.js input).
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(/** @type {string} */ (reader.result));
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
    });
}
