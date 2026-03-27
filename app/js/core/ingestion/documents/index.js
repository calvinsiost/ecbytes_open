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

/**
 * index.js — Public API for document ingestion module
 * ADR-022: Neuro-Symbolic Document Ingestion
 *
 * Re-exporta as funcoes publicas dos sub-modulos para consumo externo.
 * Ponto unico de entrada: `import { ingestDocument } from 'core/ingestion/documents'`
 *
 * @module core/ingestion/documents
 */

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

// Layer 1: Raw Extraction + Clustering
export {
    reconstructTables,
    parseDocxTables,
    filterByConfidence,
    MIN_CONFIDENCE,
    HIGH_CONFIDENCE,
} from './spatialCluster.js';

// Layer 2: Deterministic Anchoring
export {
    resolveAlias,
    getAliasesForParam,
    getKnownParameterIds,
    getFullLookupMap,
    addUserAlias,
    removeUserAlias,
    resetUserAliases,
    getBuiltinAliases,
} from './paramAliases.js';

export {
    extractCASNumbers,
    extractValue,
    extractUnit,
    resolveDocUnit,
    getDocUnitMap,
    detectDocumentLocale,
} from './regexAnchors.js';

// Layer 3: Semantic Matcher
export {
    matchSemantic,
    matchSemanticBatch,
    setTransformerConsent,
    getTransformerStatus,
    initTransformer,
    getLevenshteinSimilarity,
} from './semanticMatcher.js';

// Layer 4: Staging + Cost
export {
    buildStagingObject,
    processTable,
    classifyCrossRefLayout,
    processCrossRefTable,
    classifyByConfidence,
    getStagingSummary,
    detectFamilyFromContext,
    parseCoordinate,
    detectCRS,
    detectCoordinateTable,
    extractFields,
    extractDocMetadataDeterministic,
} from './staging.js';

// Layer 5: AI Analysis (optional — requires LLM API key)
export {
    isLLMAvailable,
    analyzeDocumentImages,
    classifyTableFamily,
    extractDocumentMetadata,
    aggregateDetectedFamilies,
    analyzeTableContent,
} from './docAIAnalyzer.js';

// Cost Catalog (already implemented — re-export for convenience)
export {
    getCostCatalog,
    getCurrency,
    getEscalationRate,
    getAnalyticalPrice,
    getElementCostDefaults,
    getCampaignCostDefaults,
    getCostCategories,
    buildObservationCost,
    buildElementCostEntry,
    buildCampaignCost,
    saveCostOverrides,
    resetCostCatalog,
    exportCostCatalog,
    importCostCatalog,
} from './costCatalog.js';

// ---------------------------------------------------------------------------
// v0.2: Rich Document Ingestion — New Modules
// ---------------------------------------------------------------------------

// Shared types & constants
export {
    ALL_FAMILIES,
    ASSET_TYPES,
    WELL_PREFIXES,
    WELL_ID_RE,
    PROCESSING_STATUS,
    MARGIN_ZONES,
    buildAssetInput,
    emptyOCRResult,
} from './types.js';

// Well ID canonicalization
export { canonicalizeWellId, matchExistingWell, extractWellIds } from './wellIdCanon.js';

// OCR post-processing
export { postProcessOCR } from './ocrPostProcess.js';

// PII detection (LGPD)
export { detectPII, redactPII } from './piiDetector.js';

// Image OCR (Tesseract.js WASM)
export {
    isOCRSupported,
    isOCRReady,
    initOCR,
    recognizeImage,
    recognizeBatch,
    terminateOCR,
    preFilterImages,
    estimateOCRBudget,
    blobToDataUrl,
} from './imageOCR.js';

// Figure classification
export {
    classifyHeuristic,
    classifyWithLLM,
    classifyHybrid,
    classifyBatch,
    extractCaption,
} from './figureClassifier.js';

// Prose parsing (NER + sections + regulatory)
export { parseProse, extractSections, extractEntities, extractRegulations } from './proseParser.js';

// Cross-reference linking
export { detectCrossRefs, resolveCrossRefs } from './crossRefLinker.js';

// Coordinate extraction
export { extractCoordinates, detectScaleBar, detectNumericScale } from './coordinateExtractor.js';

// Georeferencing
export { buildTransform, pixelToWorld, worldToPixel, validateProximity } from './mapGeoreferencer.js';

// Label detection
export { detectLabels, labelsToElements, suggestOrigin } from './labelDetector.js';

// ---------------------------------------------------------------------------
// Local imports for orchestration (re-exports don't create local bindings)
// ---------------------------------------------------------------------------
import { processTable as _processTable, getStagingSummary as _getStagingSummary } from './staging.js';

// ---------------------------------------------------------------------------
// High-Level Orchestration
// ---------------------------------------------------------------------------

/**
 * Ingests a document file (PDF or DOCX) through the full pipeline.
 * This is the main entry point for document ingestion.
 *
 * Flow:
 * 1. Sends file to Web Worker for extraction (Layer 1) — text + tables + images
 * 2. Receives tables with confidence scores and embedded images
 * 3. Processes each table through staging pipeline (Layers 2-4) with family detection
 * 4. Returns classified results + images for human review
 *
 * AI analysis (Layer 5) is triggered separately by the user via handleDocAnalyzeAI().
 *
 * @param {File} file - PDF or DOCX file object
 * @param {Object} [options]
 * @param {number} [options.minConfidence=0.6] - Minimum table confidence threshold
 * @param {function} [options.onProgress] - Progress callback (percent, message)
 * @returns {Promise<{
 *   fileName: string,
 *   fileType: string,
 *   readings: Object[],
 *   images: Object[],
 *   summary: { total: number, green: number, yellow: number, red: number },
 *   quarantinedTables: Object[],
 *   stats: Object
 * }>}
 */
export async function ingestDocument(file, options = {}) {
    const { minConfidence = 0.6, onProgress } = options;

    if (!file) throw new Error('No file provided');

    const fileName = file.name || 'unknown';
    const ext = fileName.toLowerCase().split('.').pop();

    if (ext !== 'pdf' && ext !== 'docx') {
        throw new Error(`Unsupported file type: .${ext}. Expected .pdf or .docx`);
    }

    // Step 1: Read file as ArrayBuffer
    if (onProgress) onProgress(0, 'Reading file...');
    const buffer = await file.arrayBuffer();

    // BUG-6: Save buffer copy BEFORE Worker (Worker detaches the original via transferable)
    const bufferCopy = buffer.slice(0);
    if (ext === 'pdf' && !_isPlausiblePdfBuffer(buffer)) {
        throw new Error('Invalid PDF structure.');
    }

    // Step 1b: Try pdfplumber BEFORE Worker (buffer will be detached by Worker transfer)
    let pdfplumberResult = null;
    let pdfplumberTables = null;
    let pdfplumberMeta = null;
    if (ext === 'pdf') {
        try {
            pdfplumberResult = await _tryPdfplumber(buffer, fileName, onProgress);
            pdfplumberTables = pdfplumberResult?.tables || null;
            pdfplumberMeta = pdfplumberResult?.meta || null;
        } catch {
            /* fallback to clustering */
        }
    }

    // Step 2: Extract tables + images via Web Worker (also gets rawText, images, pageCount)
    if (onProgress) onProgress(15, 'Starting extraction...');

    const workerResult = await runWorker(buffer, fileName, { minConfidence, onProgress });
    if (ext === 'pdf' && !_hasPdfContentSignals(workerResult, pdfplumberTables)) {
        throw new Error('Invalid PDF structure.');
    }

    // Step 3: Process tables through staging pipeline
    // Priority: pdfplumber tables > Worker accepted tables > fallback quarantined
    if (onProgress) onProgress(75, 'Resolving parameters...');

    const ingestStartTs = Date.now();
    let budgetMode = 'normal';
    let budgetReason = '';
    const budgetWarnings = [];
    let processedTablesCount = 0;
    let fallbackUsed = false;
    let fallbackProcessedTables = 0;

    const allReadings = [];
    const tables = pdfplumberTables || workerResult.tables || [];
    const totalTables = tables.length;
    let tableCap = totalTables;

    if (totalTables > TABLE_HARD_LIMIT) {
        tableCap = TABLE_HARD_LIMIT;
        budgetMode = 'degraded';
        budgetReason = `table-cap-hard:${TABLE_HARD_LIMIT}`;
        budgetWarnings.push(`Table volume capped at ${TABLE_HARD_LIMIT}/${totalTables}`);
        if (onProgress)
            onProgress(76, `Large document detected: limiting to ${TABLE_HARD_LIMIT} tables for stability...`);
    } else if (totalTables > TABLE_SOFT_LIMIT) {
        tableCap = TABLE_SOFT_LIMIT;
        budgetMode = 'degraded';
        budgetReason = `table-cap-soft:${TABLE_SOFT_LIMIT}`;
        budgetWarnings.push(`Table volume capped at ${TABLE_SOFT_LIMIT}/${totalTables}`);
        if (onProgress) onProgress(76, `High table volume: processing first ${TABLE_SOFT_LIMIT} tables...`);
    }

    for (let i = 0; i < tableCap; i++) {
        const elapsed = Date.now() - ingestStartTs;
        if (elapsed > INGEST_HARD_BUDGET_MS) {
            budgetMode = 'hard-stop';
            budgetReason = `timeout-hard:${INGEST_HARD_BUDGET_MS}`;
            budgetWarnings.push(`Hard timeout reached after ${elapsed}ms`);
            if (onProgress) onProgress(93, 'Hard timeout reached: stopping table processing early.');
            break;
        }
        if (elapsed > INGEST_SOFT_BUDGET_MS && i >= Math.max(50, Math.floor(tableCap * 0.6))) {
            if (budgetMode === 'normal') budgetMode = 'degraded';
            if (!budgetReason) budgetReason = `timeout-soft:${INGEST_SOFT_BUDGET_MS}`;
            budgetWarnings.push(`Soft timeout reached after ${elapsed}ms`);
            if (onProgress) onProgress(90, 'Soft timeout reached: entering summarized processing mode.');
            break;
        }

        const t = tables[i];
        if (onProgress)
            onProgress(75 + Math.round((i / Math.max(tableCap, 1)) * 20), `Processing table ${i + 1}/${tableCap}...`);

        const readings = await _processTable({
            table: t.table,
            confidence: t.confidence,
            page: t.page,
            tableIndex: i,
        });
        processedTablesCount += 1;

        // F5b: Also filter accepted tables with 100% RED (no analytical match)
        if (readings.length > 0 && !readings.every((r) => r.confidence === 'red')) {
            allReadings.push(...readings);
        }
    }

    // F5: Fallback - if no accepted table, reprocess best quarantined as YELLOW
    const quarantinedTables = workerResult.quarantined || [];
    const allowFallback = budgetMode !== 'hard-stop' && Date.now() - ingestStartTs < INGEST_SOFT_BUDGET_MS;
    if (allReadings.length === 0 && quarantinedTables.length > 0 && allowFallback) {
        fallbackUsed = true;
        const sorted = [...quarantinedTables].sort((a, b) => b.confidence - a.confidence);
        const fallback = sorted.filter((t) => t.confidence >= 0.2).slice(0, 10);

        for (let i = 0; i < fallback.length; i++) {
            const elapsed = Date.now() - ingestStartTs;
            if (elapsed > INGEST_HARD_BUDGET_MS) {
                budgetMode = 'hard-stop';
                budgetReason = `timeout-hard:${INGEST_HARD_BUDGET_MS}`;
                budgetWarnings.push(`Hard timeout reached during fallback after ${elapsed}ms`);
                if (onProgress) onProgress(94, 'Hard timeout reached during fallback: stopping.');
                break;
            }

            const t = fallback[i];
            if (onProgress)
                onProgress(
                    80 + Math.round((i / fallback.length) * 15),
                    `Fallback: table ${i + 1}/${fallback.length} (conf ${t.confidence})...`,
                );

            const readings = await _processTable({
                table: t.table,
                confidence: t.confidence,
                page: t.page,
                tableIndex: tableCap + i,
                _fallback: true,
            });
            fallbackProcessedTables += 1;

            // F5: discard fallback table if 100% RED (no value added)
            if (readings.length > 0 && !readings.every((r) => r.confidence === 'red')) {
                allReadings.push(...readings);
            }
        }
    } else if (allReadings.length === 0 && quarantinedTables.length > 0 && !allowFallback) {
        budgetWarnings.push('Fallback skipped due to ingestion budget mode');
        if (onProgress) onProgress(92, 'Skipping fallback due to budget mode.');
    }

    // Step 4: Classify and summarize
    if (onProgress) onProgress(95, 'Classifying results...');

    const summary = _getStagingSummary(allReadings);
    const images = workerResult.images || [];

    if (onProgress) onProgress(100, 'Complete');

    return {
        fileName,
        fileType: ext,
        readings: allReadings,
        images,
        summary,
        quarantinedTables: workerResult.quarantined || [],
        rawText: workerResult.rawText || '',
        textItems: workerResult.textItems || null,
        htmlContent: workerResult.htmlContent || null,
        pageCount: workerResult.pageCount || workerResult.stats?.pageCount || 0,
        isScanned: workerResult.isScanned || false,
        stats: {
            ...(workerResult.stats || {}),
            imageCount: images.length,
            budgetMode,
            budgetReason,
            budgetWarnings,
            tableCap,
            totalTables,
            processedTables: processedTablesCount,
            fallbackUsed,
            fallbackProcessedTables,
            extractorPrimary: pdfplumberTables ? 'pdfplumber' : 'worker',
            pdfplumber: {
                attempted: ext === 'pdf',
                used: !!pdfplumberTables,
                cache: pdfplumberMeta?.cache || null,
                durationMs: Number.isFinite(pdfplumberMeta?.duration_ms) ? pdfplumberMeta.duration_ms : null,
                tablesFound: Array.isArray(pdfplumberTables) ? pdfplumberTables.length : 0,
            },
        },
        _bufferCopy: bufferCopy,
    };
}

// ---------------------------------------------------------------------------
// P1: pdfplumber Bridge (Python subprocess — dev/api-server only)
// ---------------------------------------------------------------------------

const PDFPLUMBER_TIMEOUT_MS = 30000;
const INGEST_SOFT_BUDGET_MS = 60000;
const INGEST_HARD_BUDGET_MS = 180000;
const TABLE_SOFT_LIMIT = 220;
const TABLE_HARD_LIMIT = 420;

function _hasPdfContentSignals(workerResult, pdfplumberTables) {
    if (Array.isArray(pdfplumberTables) && pdfplumberTables.length > 0) return true;
    const result = workerResult || {};
    const pageCount = result.pageCount || result.stats?.pageCount || 0;
    const signalCounts = [
        Array.isArray(result.tables) ? result.tables.length : 0,
        Array.isArray(result.quarantined) ? result.quarantined.length : 0,
        Array.isArray(result.images) ? result.images.length : 0,
        Array.isArray(result.textItems) ? result.textItems.length : 0,
    ];
    if (signalCounts.some((c) => c > 0)) return true;
    if (pageCount > 0) return true;
    if (String(result.rawText || '').trim().length > 0) return true;
    return false;
}

function _isPlausiblePdfBuffer(buffer) {
    if (!(buffer instanceof ArrayBuffer)) return false;
    if (buffer.byteLength < 80) return false;

    const head = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
    const signature = String.fromCharCode(...head);
    return signature.startsWith('%PDF-');
}

/**
 * Attempts PDF table extraction via pdfplumber Python script.
 * Sends file to api-server /api/pdfplumber endpoint which runs Python subprocess.
 * Falls back to null if api-server not available or Python not installed.
 *
 * @param {ArrayBuffer} buffer - PDF file contents
 * @param {string} fileName - File name
 * @param {function} [onProgress] - Progress callback
 * @returns {Promise<{tables:Array,meta:Object}|null>} Parsed tables + metadata or null
 */
async function _tryPdfplumber(buffer, fileName, onProgress) {
    try {
        if (onProgress) onProgress(10, 'Extracting tables (pdfplumber)...');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PDFPLUMBER_TIMEOUT_MS);

        // Use bufferCopy for pdfplumber to avoid detaching the original buffer
        // (Worker needs the original buffer for postMessage transfer)
        const pdfCopy = buffer.slice(0);
        const response = await fetch('/api/pdfplumber', {
            method: 'POST',
            headers: { 'Content-Type': 'application/pdf' },
            body: new Uint8Array(pdfCopy),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.info('[ingestion] pdfplumber HTTP', response.status, errText.substring(0, 100));
            return null;
        }

        const parsed = await response.json();
        if (!parsed.success || !parsed.data?.tables?.length) {
            console.info('[ingestion] pdfplumber: no tables or error:', parsed.error || 'empty');
            return null;
        }

        const cacheStatus = parsed.data?.meta?.cache || 'miss';
        if (onProgress) {
            onProgress(
                12,
                cacheStatus === 'hit'
                    ? 'Extracting tables (pdfplumber cache hit)...'
                    : 'Extracting tables (pdfplumber cache miss)...',
            );
        }
        console.info(
            `[ingestion] pdfplumber (${cacheStatus}): ${parsed.data.tables.length} tables in ${parsed.data.meta?.duration_ms}ms`,
        );

        return {
            tables: parsed.data.tables.map((t) => ({
                table: t.data,
                confidence: 0.85,
                page: t.page,
            })),
            meta: parsed.data.meta || {},
        };
    } catch (e) {
        console.info('[ingestion] pdfplumber not available:', e.name, e.message?.substring(0, 80));
        return null;
    }
}

// ---------------------------------------------------------------------------
// Worker Communication
// ---------------------------------------------------------------------------

/**
 * Runs the document extraction Web Worker.
 *
 * @param {ArrayBuffer} buffer - File contents
 * @param {string} fileName - File name
 * @param {Object} options
 * @returns {Promise<Object>} Worker result
 */
function runWorker(buffer, fileName, options = {}) {
    return new Promise((resolve, reject) => {
        let worker;

        try {
            // Create worker from the documentWorker.js file
            const workerUrl = new URL('./documentWorker.js', import.meta.url);
            worker = new Worker(workerUrl);
        } catch (e) {
            // Fallback: inline worker with blob URL
            reject(
                new Error(
                    `Failed to create Web Worker: ${e.message}. Document extraction requires Web Worker support.`,
                ),
            );
            return;
        }

        const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error('Document extraction timed out (60s)'));
        }, 60000);

        worker.onmessage = (e) => {
            const msg = e.data;

            if (msg.type === 'progress' && options.onProgress) {
                // Scale worker progress (0-100) to our range (5-75)
                const scaled = 5 + Math.round(msg.percent * 0.7);
                options.onProgress(scaled, msg.message);
            } else if (msg.type === 'result') {
                clearTimeout(timeout);
                worker.terminate();
                resolve(msg.data);
            } else if (msg.type === 'error') {
                clearTimeout(timeout);
                worker.terminate();
                reject(new Error(msg.message));
            }
        };

        worker.onerror = (e) => {
            clearTimeout(timeout);
            worker.terminate();
            reject(new Error(`Worker error: ${e.message}`));
        };

        // Send file to worker (transfer ArrayBuffer for zero-copy)
        worker.postMessage(
            { type: 'extract', file: buffer, fileName, options: { minConfidence: options.minConfidence } },
            [buffer],
        );
    });
}
