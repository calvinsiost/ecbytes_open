// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Module: Document Ingestion — Shared Types & Constants
// @since v0.2

/**
 * types.js — Shared contract types for document ingestion pipeline.
 *
 * Both imageOCR and figureClassifier depend on these types,
 * not on each other. Eliminates coupling between pipeline stages.
 *
 * @module core/ingestion/documents/types
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** PDPL-U element families */
export const ALL_FAMILIES = Object.freeze([
    'well',
    'plume',
    'lake',
    'river',
    'spring',
    'building',
    'tank',
    'marker',
    'boundary',
    'stratum',
    'sample',
    'area',
    'individual',
    'incident',
    'emission_source',
    'waste_stream',
    'effluent_point',
    'habitat',
    'sensor',
    'intangible',
    'blueprint',
    'generic',
]);

/** Valid asset types for document_assets table */
export const ASSET_TYPES = Object.freeze([
    'table',
    'figure',
    'map',
    'plume_contour',
    'floor_plan',
    'lithologic_profile',
    'cross_section',
    'photo',
    'chart',
    'flow_diagram',
    'unknown',
]);

/** Well ID prefixes (Brazilian environmental monitoring standard) */
export const WELL_PREFIXES = 'PM|MW|PZ|PP|PB|PT|PA|RB|SB|PMA|PMR|PMC|PMG|PI|PC|PE|SS|PF';

/** Well ID regex (non-global, for single .test()/.match()) */
export const WELL_ID_RE = new RegExp(`^(${WELL_PREFIXES})\\s*[-.]?\\s*\\d{1,4}[A-Z]?`, 'i');

/** Processing status values */
export const PROCESSING_STATUS = Object.freeze({
    PENDING: 'pending',
    OCR_DONE: 'ocr_done',
    CLASSIFIED: 'classified',
    DIGITIZED: 'digitized',
    REVIEWED: 'reviewed',
    INGESTED: 'ingested',
    REJECTED: 'rejected',
});

/** Image margin zones as fraction of image dimensions */
export const MARGIN_ZONES = Object.freeze({
    top: { yMin: 0.0, yMax: 0.12 },
    bottom: { yMin: 0.88, yMax: 1.0 },
    left: { xMin: 0.0, xMax: 0.12 },
    right: { xMin: 0.88, xMax: 1.0 },
});

// ---------------------------------------------------------------------------
// Type Definitions (JSDoc — no runtime cost)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} OCRWordBox
 * @property {string} text       — recognized word
 * @property {number} confidence — 0-100 (Tesseract native scale)
 * @property {{ x: number, y: number, width: number, height: number }} bbox
 */

/**
 * @typedef {Object} OCRResult
 * @property {string}       text        — full extracted text (joined lines)
 * @property {number}       confidence  — mean word confidence, 0-100
 * @property {OCRWordBox[]} words       — individual word boxes
 * @property {string[]}     lines       — text split by detected lines
 * @property {string|null}  error       — null if success
 * @property {number}       durationMs  — processing time
 */

/**
 * @typedef {Object} DocumentAssetInput
 * @property {Blob|null}    blob        — Blob reference (for lazy dataUrl conversion)
 * @property {string}       blobUrl     — for <img> rendering
 * @property {number}       width       — image width px
 * @property {number}       height      — image height px
 * @property {number}       page        — page number (1-based)
 * @property {number}       index       — image index within page
 * @property {string}       ocrText     — post-processed OCR text
 * @property {OCRWordBox[]} ocrWords    — word bounding boxes
 * @property {number}       ocrConfidence — mean OCR confidence 0-100
 * @property {string|null}  caption     — extracted caption
 * @property {{ x: number, y: number, width: number, height: number }|null} bbox
 */

/**
 * @typedef {Object} ClassificationResult
 * @property {string}       assetType   — one of ASSET_TYPES
 * @property {string|null}  familyHint  — PDPL-U family or null
 * @property {number}       confidence  — 0.0 to 1.0
 * @property {string}       method      — 'heuristic' | 'llm_vision' | 'hybrid'
 * @property {string}       reasoning
 * @property {Object}       heuristics  — { aspectRatio, ocrKeywordScore, captionScore, dimensionScore }
 * @property {Object|null}  llmResult
 */

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a DocumentAssetInput from Worker image data + OCR result + caption.
 * Central factory — all pipeline stages consume this type.
 *
 * @param {Object} workerImage — { blob, blobUrl, width, height, page, index }
 * @param {OCRResult|null} ocrResult
 * @param {string|null} caption
 * @returns {DocumentAssetInput}
 */
export function buildAssetInput(workerImage, ocrResult, caption) {
    return {
        blob: workerImage.blob || null,
        blobUrl: workerImage.blobUrl || '',
        width: workerImage.width || 0,
        height: workerImage.height || 0,
        page: workerImage.page || 1,
        index: workerImage.index || 0,
        ocrText: ocrResult?.text || '',
        ocrWords: ocrResult?.words || [],
        ocrConfidence: ocrResult?.confidence || 0,
        caption: caption || null,
        bbox: null,
    };
}

/**
 * Create an empty OCR result (for skipped/failed images).
 *
 * @param {string|null} error — error message or null
 * @returns {OCRResult}
 */
export function emptyOCRResult(error = null) {
    return {
        text: '',
        confidence: 0,
        words: [],
        lines: [],
        error,
        durationMs: 0,
    };
}
