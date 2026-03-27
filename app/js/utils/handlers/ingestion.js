// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   INGESTION HANDLERS — Wizard modal for spreadsheet & document import
   Handlers para o modal wizard de ingestao de dados ambientais.

   Conecta a UI do modal com o pipeline core/ingestion/:
   Spreadsheets: parser → mapper → validator → wizard → ingester
   Documents:    documentWorker → staging → human review → ingester
   ================================================================ */

import { parseFile, detectFormat } from '../../core/ingestion/parser.js';
import { mapDeterministic, mapWithAI, COLUMN_ALIASES } from '../../core/ingestion/mapper.js';
import { validateMappedData, transformData } from '../../core/ingestion/validator.js';
import {
    createWizard,
    advanceWizard,
    goBackWizard,
    getWizardStep,
    isWizardComplete,
    buildIngestionPlan,
    isQuickImportEligible,
} from '../../core/ingestion/wizard.js';
import { ingest, buildVirtualModel } from '../../core/ingestion/ingester.js';
import { buildModel } from '../../core/io/export.js';
import {
    ingestDocument,
    classifyByConfidence,
    getStagingSummary,
    setTransformerConsent,
    getTransformerStatus,
    initTransformer,
    isLLMAvailable,
    analyzeDocumentImages,
    classifyTableFamily,
    aggregateDetectedFamilies,
    // v0.2: Rich Document Ingestion (track logic in documentTracks.js)
    isOCRSupported,
    isOCRReady,
    initOCR,
    terminateOCR,
    detectPII,
    redactPII,
    detectDocumentLocale,
} from '../../core/ingestion/documents/index.js';
import { validateBbox } from '../helpers/bboxValidator.js';
import {
    processTrackB,
    processTrackC,
    processTrackD,
    processScannedPages,
    convertImagesToBlobUrls,
    cleanupBlobUrls,
} from './documentTracks.js';
import { DEFAULT_FAMILIES } from '../../config.js';
import { getAllElements, getElementById, addElement, updateElement } from '../../core/elements/manager.js';
import { getAllCampaigns } from '../../core/campaigns/manager.js';
import { showToast } from '../ui/toast.js';
import { showLoading, hideLoading, setLoadingMessage } from '../ui/loadingOverlay.js';
import { escapeHtml } from '../helpers/html.js';
import { computeDocHighlightRect } from '../helpers/docHighlight.js';
import {
    buildDocMatrixKey,
    buildWellProfilePatch,
    collectDocMatrixBuckets,
    isDocMatrixAmbiguous,
    mergeWellProfileByStrategy,
    normalizeDocMatrixValue,
} from '../helpers/docDecisions.js';
import { showMoreObservations, showAllObservations, toggleObsCampaign, expandObservation } from '../ui/lists.js';
import { registerFromIngestion } from '../files/fileManager.js';
import { getFileRegisterMode } from '../files/fileConstants.js';
import { mergeHandlers } from './merge.js';
import { importCDN } from '../helpers/cdnLoader.js';

let updateAllUI = null;
let _wizardState = null;

/** State for document ingestion (PDF/DOCX) — separate from spreadsheet wizard */
let _docState = null;

// CSS reutilizado nos cards do wizard
// --neutral-100: bg leve sobre modal (funciona em light E dark)
// --neutral-800: texto principal em modais (invertido no dark theme)
// --neutral-500: texto secundario
const S_CARD =
    'background:var(--neutral-100);padding:10px;border-radius:6px;margin-bottom:8px;color:var(--neutral-800);';
const S_LABEL = 'display:block;margin:3px 0;cursor:pointer;color:var(--neutral-800);';
const S_TITLE = 'margin:0 0 6px;font-weight:600;color:var(--neutral-800);';
const S_MUTED = 'color:var(--neutral-500);';
const S_TABLE_HEADER = 'font-size:10px;color:var(--neutral-500);border-bottom:1px solid var(--neutral-200);';
const S_TABLE_ROW = 'border-bottom:1px solid var(--neutral-100);';
const S_SAMPLE =
    'font-family:monospace;font-size:10px;color:var(--neutral-500);background:var(--neutral-50);padding:2px 6px;border-radius:3px;';
const DOC_PROFILE_STRATEGIES = ['replace', 'append', 'skip'];
const DOC_VISUAL_TYPES = new Set([
    'map',
    'plume_contour',
    'floor_plan',
    'lithologic_profile',
    'cross_section',
    'photo',
    'chart',
]);
const DOC_VISUAL_FAMILIES = ['plume', 'blueprint', 'building', 'stratum', 'generic'];

function _buildDefaultDocDecisions() {
    return {
        matrixAmbiguityScope: 'page_table',
        matrixOverrides: {},
        lgpdStrategy: 'pseudonymize',
        profileConflictStrategy: 'append',
        saveInFiles: true,
        visualWizardEnabled: true,
        visualActions: {},
        // Legacy decision fields kept for backward-compatible state reads.
        nonDetectStrategy: 'flag_null',
        campaignFromDates: 'auto_campaigns',
        legislationPriority: 'all',
    };
}

function _ensureDocDecisions() {
    if (!_docState) return _buildDefaultDocDecisions();
    const defaults = _buildDefaultDocDecisions();
    const current = _docState._decisions && typeof _docState._decisions === 'object' ? _docState._decisions : {};
    const merged = {
        ...defaults,
        ...current,
        matrixOverrides: { ...(defaults.matrixOverrides || {}), ...(current.matrixOverrides || {}) },
        visualActions: { ...(defaults.visualActions || {}), ...(current.visualActions || {}) },
    };
    if (!DOC_PROFILE_STRATEGIES.includes(merged.profileConflictStrategy)) {
        merged.profileConflictStrategy = defaults.profileConflictStrategy;
    }
    _docState._decisions = merged;
    return merged;
}

function _getDocSuggestedFamilyFromAssetType(assetType) {
    const t = String(assetType || '').toLowerCase();
    if (t === 'plume_contour') return 'plume';
    if (t === 'floor_plan' || t === 'map') return 'blueprint';
    if (t === 'lithologic_profile' || t === 'cross_section') return 'stratum';
    if (t === 'chart') return 'generic';
    if (t === 'photo') return 'building';
    return 'generic';
}

function _getDocVisualAssetLabel(assetType) {
    const t = String(assetType || '').toLowerCase();
    if (t === 'plume_contour') return 'Pluma';
    if (t === 'floor_plan') return 'Planta';
    if (t === 'lithologic_profile') return 'Perfil litologico';
    if (t === 'cross_section') return 'Secao';
    if (t === 'map') return 'Mapa';
    if (t === 'photo') return 'Foto';
    if (t === 'chart') return 'Grafico';
    return t || 'Asset';
}

function _collectDocVisualAssets() {
    if (!_docState) return [];
    const assets = Array.isArray(_docState.documentAssets) ? _docState.documentAssets : [];
    const cls = Array.isArray(_docState.assetClassifications) ? _docState.assetClassifications : [];
    const decisions = _ensureDocDecisions();
    const visualActions = decisions.visualActions || {};
    const out = [];

    for (let i = 0; i < Math.max(assets.length, cls.length); i++) {
        const asset = assets[i] || {};
        const c = cls[i] || {};
        const assetType = String(c.assetType || 'unknown').toLowerCase();
        if (!DOC_VISUAL_TYPES.has(assetType)) continue;

        const assetKey = `asset-${i}`;
        const suggestedFamily = DOC_VISUAL_FAMILIES.includes(c.familyHint)
            ? c.familyHint
            : _getDocSuggestedFamilyFromAssetType(assetType);
        const current = visualActions[assetKey] || {};
        if (!visualActions[assetKey]) {
            visualActions[assetKey] = {
                createAsset: false,
                download: false,
                targetFamily: suggestedFamily,
            };
        } else if (!current.targetFamily) {
            current.targetFamily = suggestedFamily;
            visualActions[assetKey] = current;
        }

        out.push({
            assetKey,
            index: i,
            asset,
            classification: c,
            assetType,
            page: asset.page || 0,
            suggestedFamily,
            action: visualActions[assetKey],
        });
    }

    decisions.visualActions = visualActions;
    return out;
}

function _redactDocReadingSource(reading, piiDetection) {
    const redactLoose = (value) => {
        if (typeof value === 'string') return redactPII(value, piiDetection);
        if (Array.isArray(value)) return value.map(redactLoose);
        if (value && typeof value === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(value)) out[k] = redactLoose(v);
            return out;
        }
        return value;
    };
    const source = redactLoose(reading.source || {});
    return { ...reading, source };
}

/**
 * Injeta referencia ao updateAllUI (chamado pelo registerAllHandlers).
 */
export function setUpdateAllUI(fn) {
    updateAllUI = fn;
}

// ----------------------------------------------------------------
// MODAL OPEN/CLOSE
// ----------------------------------------------------------------

/**
 * Abre o modal de ingestao de planilha.
 * Reseta o estado do wizard.
 */
export function handleOpenIngestionModal() {
    _wizardState = null;
    _docState = null;
    const modal = document.getElementById('ingestion-modal');
    if (modal) {
        modal.classList.add('active');
        renderIngestionStep();
    }
}

/**
 * Fecha o modal de ingestao.
 */
export function handleCloseIngestionModal() {
    const modal = document.getElementById('ingestion-modal');
    if (modal) {
        modal.classList.remove('active');
        // Reset fullscreen styles from split view
        modal.style.cssText = modal.style.cssText.replace(
            /position:fixed[^;]*;|inset:[^;]*;|z-index:[^;]*;|width:100vw[^;]*;|height:100vh[^;]*;|max-width:[^;]*;|max-height:[^;]*;|border-radius:0[^;]*;/g,
            '',
        );
    }
    // Cleanup PDF preview
    if (_pdfDoc) {
        try {
            _pdfDoc.destroy();
        } catch {}
        _pdfDoc = null;
    }
    _pageCache.clear();
    _pageRenderJobs.clear();
    _wizardState = null;
    _cleanupDocState();
}

// ----------------------------------------------------------------
// FILE UPLOAD
// ----------------------------------------------------------------

/**
 * Handler do file input — faz parse e inicia o wizard.
 */
export async function handleIngestionFileUpload(input) {
    const file = input?.files?.[0];
    if (!file) return;
    await handleIngestionDirectFile(file);
}

export async function handleIngestionDirectFile(file) {
    if (!(file instanceof File)) return;
    _wizardState = null;
    _docState = null;
    await _startIngestionForFile(file);
}

async function _startIngestionForFile(file) {
    const ext = file.name.toLowerCase().split('.').pop();
    const isDocument = ext === 'pdf' || ext === 'docx';
    const isShapefile = ext === 'shp' || ext === 'zip';

    const container = document.getElementById('ingestion-content');
    if (container) {
        container.innerHTML = `<p style="color:var(--neutral-500);font-size:12px;padding:20px;text-align:center;">Analisando arquivo...</p>`;
    }

    // Route: Shapefile (.shp, .zip) → shapefile import
    if (isShapefile) {
        try {
            showLoading('Importing shapefile...');
            const { importShapefile } = await import('../../core/io/formats/shapefile.js');
            const result = await importShapefile(file);
            let added = 0;
            for (const el of result.elements) {
                try {
                    addElement(el.family, el.id, el.name, el.data, {
                        iconClass: `icon-${el.family}`,
                        color: el.color || '',
                        label: el.name,
                    });
                    added++;
                } catch (e) {
                    console.warn(`[Shapefile] ${el.name}: ${e.message}`);
                }
            }
            showToast(`Shapefile: ${added} elementos importados`, 'success');
            if (result.warnings.length > 0) {
                console.warn('[Shapefile] Warnings:', result.warnings);
            }
            handleCloseIngestionModal();
            if (typeof window.updateAllUI === 'function') window.updateAllUI();
        } catch (err) {
            showToast(`Shapefile: ${err.message}`, 'error');
            if (container) container.innerHTML = renderUploadForm();
        } finally {
            hideLoading();
        }
        return;
    }

    // Route: PDF/DOCX → document ingestion pipeline v0.2
    if (isDocument) {
        showLoading('Processing document...');
        try {
            _docState = {
                step: 'extracting',
                fileName: file.name,
                fileType: ext,
                _sourceFile: file,
                _processing: {
                    startedAt: Date.now(),
                    phase: 'prepare',
                    percent: 0,
                    message: 'Iniciando...',
                    history: [],
                },
            };
            _renderDocProgress(0, 'Iniciando...');

            // ── Pre-init OCR in background (SP-2) ──
            if (isOCRSupported() && !isOCRReady()) {
                initOCR({ onProgress: (pct, msg) => _renderDocProgress(pct * 0.05, msg) }).catch((err) =>
                    console.warn('[ingestion] OCR pre-init failed:', err.message),
                );
            }

            // ── Worker extraction ──
            const result = await ingestDocument(file, {
                minConfidence: 0.6,
                onProgress: (pct, msg) => {
                    _renderDocProgress(pct * 0.6, msg); // Worker gets 0-60% of progress bar
                    setLoadingMessage(msg || 'Processing document...');
                },
            });

            const { readings, images, rawText, textItems, htmlContent, pageCount, isScanned } = result;

            // ── Convert images to Blob URLs (SP-31: memory optimization) ──
            const blobImages = _convertImagesToBlobUrls(images || []);

            // ── Scanned PDF: full-page OCR → assemble rawText ──
            let scannedRawText = rawText || '';
            let scannedTextItems = textItems;
            let scannedTables = result.tables || [];

            if (isScanned && result.pageImages && result.pageImages.length > 0) {
                _renderDocProgress(62, 'OCR em páginas escaneadas...');
                const pageOcrResult = await _processScannedPages(result.pageImages);
                scannedRawText = pageOcrResult.rawText;
                scannedTextItems = pageOcrResult.textItems;
                scannedTables = pageOcrResult.tables;
            }

            // ── Track A: Tables → staging (existing pipeline) ── (already done in ingestDocument)

            // ── Track B: Images → OCR → classify → document_assets ──
            let documentAssets = [];
            let assetClassifications = [];

            if (blobImages.length > 0 && isOCRSupported()) {
                const trackBResult = await _processTrackB(blobImages, scannedTextItems, pageCount);
                documentAssets = trackBResult.assets;
                assetClassifications = trackBResult.classifications;
            }

            // ── Track C: Prose → NER → cross-references ──
            let proseResult = null;
            let crossRefs = null;

            if (scannedRawText && scannedRawText.length > 20) {
                _renderDocProgress(92, 'Analisando texto...');
                const trackCResult = await _processTrackC(
                    scannedRawText,
                    documentAssets,
                    assetClassifications,
                    result.tables || scannedTables,
                );
                proseResult = trackCResult.proseResult;
                crossRefs = trackCResult.crossRefs;
            }

            // ── Track D: Georeferencing (maps only) ──
            let mapResults = [];
            let suggestedOriginCoord = null;

            const mapAssets = documentAssets.filter((_, i) => assetClassifications[i]?.assetType === 'map');
            if (mapAssets.length > 0) {
                _renderDocProgress(95, 'Georeferenciando mapas...');
                const trackDResult = await _processTrackD(mapAssets, assetClassifications, documentAssets);
                mapResults = trackDResult.mapResults;
                suggestedOriginCoord = trackDResult.suggestedOrigin;
            }

            // ── PII detection (SP-32) ──
            let piiDetection = null;
            if (scannedRawText) {
                piiDetection = detectPII(scannedRawText);
                if (piiDetection.detected) {
                    console.info('[ingestion] PII detected:', piiDetection.types);
                }
            }

            // ── F1e: Detect document locale from raw text ──
            const detectedLocale = scannedRawText ? detectDocumentLocale(scannedRawText) : null;

            // ── Merge into _docState ──
            const processingState = _docState?._processing || null;
            _docState = {
                step: 'review',
                fileName: result.fileName,
                fileType: result.fileType,
                _detectedLocale: detectedLocale,
                // Track A (existing)
                readings: readings || [],
                images: blobImages,
                imageAnalysis: null,
                summary: result.summary || getStagingSummary(readings || []),
                quarantinedTables: result.quarantinedTables || [],
                stats: result.stats || {},
                selected: new Set(),
                disclaimerVisible: false,
                // Track B (v0.2)
                documentAssets,
                assetClassifications,
                // Track C (v0.2)
                rawText: scannedRawText,
                textItems: scannedTextItems,
                htmlContent,
                pageCount: pageCount || 0,
                proseResult,
                crossRefs,
                // Track D (v0.2)
                mapResults,
                suggestedOrigin: suggestedOriginCoord,
                // PII (v0.2)
                _piiDetection: piiDetection,
                _piiConsentGiven: false,
                _decisions: _buildDefaultDocDecisions(),
                // Scanned info
                isScanned: !!isScanned,
                // BUG-6: Buffer copy for PDF preview in split view
                _bufferCopy: result._bufferCopy || null,
                _postImportVisualAssets: null,
                _importSummary: null,
                _processing: processingState
                    ? {
                          ...processingState,
                          finishedAt: Date.now(),
                          percent: 100,
                          phase: 'complete',
                          message: 'Concluido',
                      }
                    : null,
            };

            _renderDocReview();
        } catch (err) {
            console.error('[ingestion] Document pipeline error:', err);
            _cleanupDocState(); // Bug fix: revoke Blob URLs before nulling state
            showToast(`Erro ao processar documento: ${err.message}`, 'error');
            renderIngestionStep();
        } finally {
            hideLoading();
            // Release OCR engine WASM memory
            terminateOCR().catch(() => {});
        }
        return;
    }

    // Route: Spreadsheet → existing pipeline
    showLoading('Analyzing spreadsheet...');
    try {
        // 1. Parse
        const parsed = await parseFile(file);
        if (!parsed.sheets.length) {
            showToast('Arquivo vazio ou formato nao suportado', 'error');
            return;
        }

        // 2. Detecta formato
        const format = detectFormat(parsed);

        // 3. Mapeia colunas (deterministico — IA e opcao do usuario no proximo step)
        const mapping = mapDeterministic(parsed, format);

        // 4. Transforma e valida
        const transformed = transformData(parsed, mapping);
        const validation = validateMappedData(transformed, mapping);

        // 5. Cria wizard
        _wizardState = createWizard(parsed, format, mapping, validation);

        // Injeta dados transformados no state para preview "de → para"
        _wizardState._transformed = transformed;
        _wizardState._sourceFile = file;

        renderIngestionStep();
    } catch (err) {
        console.error('Ingestion parse error:', err);
        showToast(`Erro ao analisar arquivo: ${err.message}`, 'error');
    } finally {
        hideLoading();
    }
}

// ----------------------------------------------------------------
// WIZARD NAVIGATION
// ----------------------------------------------------------------

/**
 * Avanca para o proximo step do wizard.
 * Coleta decisoes do step atual e avanca.
 */
export function handleIngestionNext() {
    if (!_wizardState) return;

    const decisions = collectCurrentDecisions();
    const prev = _wizardState;
    _wizardState = advanceWizard(_wizardState, decisions);
    // Preserva dados internos
    _wizardState._transformed = prev._transformed;
    renderIngestionStep();
}

/**
 * Volta para o step anterior.
 */
export function handleIngestionBack() {
    if (!_wizardState) return;
    const prev = _wizardState;
    _wizardState = goBackWizard(_wizardState);
    _wizardState._transformed = prev._transformed;
    renderIngestionStep();
}

/**
 * Executa a ingestao final.
 * Constroi modelo virtual e abre o Diff/Merge para revisao do usuario.
 */
let _isExecuting = false;

export async function handleIngestionExecute() {
    if (!_wizardState || _isExecuting) return;
    _isExecuting = true;
    try {
        await _executeIngestion();
    } finally {
        _isExecuting = false;
    }
}

async function _executeIngestion() {
    const decisions = collectCurrentDecisions();
    _wizardState = { ..._wizardState, decisions: { ..._wizardState.decisions, ...decisions, formatConfirmed: true } };

    const plan = buildIngestionPlan(_wizardState);

    // OHS domain: merge-based flow nao suportado ainda — usa pipeline direto
    if (plan.domain === 'ohs') {
        _renderIngestionProgressBar();
        try {
            const report = await ingest(plan);
            if (report.success) {
                showToast(
                    `Ingestao OHS concluida: ${report.created.elements} elementos, ${report.created.observations} obs (${report.duration}ms)`,
                    'success',
                );
                handleCloseIngestionModal();
                if (updateAllUI) updateAllUI();
            } else {
                showToast(`Erro na ingestao OHS: ${report.errors.join('; ')}`, 'error');
            }
        } catch (err) {
            showToast(`Erro OHS: ${err.message}`, 'error');
        }
        return;
    }

    // Domain validator engine: run active domain validators on mapped data
    try {
        const { runActiveDomainValidation } = await import('../../core/validation/engine/ecbtAdapter.js');
        const domainResult = await runActiveDomainValidation(plan.records || []);
        if (domainResult.totalViolations > 0) {
            const errorCount = domainResult.domainResults.reduce(
                (sum, r) => sum + r.violations.filter((v) => v.severity === 'error').length,
                0,
            );
            if (errorCount > 0) {
                const proceed = confirm(
                    `Domain validation found ${errorCount} error(s) and ${domainResult.totalViolations - errorCount} warning(s). Proceed with ingestion?`,
                );
                if (!proceed) {
                    _isExecuting = false;
                    return;
                }
            }
            console.warn('[ecbyts] Domain validation:', domainResult);
        }
    } catch (e) {
        // Domain validation is optional — never block ingestion
        console.warn('[ecbyts] Domain validation skipped:', e.message);
    }

    // D9: renderiza overlay de progresso durante construcao do modelo virtual
    let progress = null;
    try {
        const { showProgressOverlay } = await import('../ui/progressOverlay.js');
        progress = showProgressOverlay(t('ingesting') || 'Ingerindo dados...');
    } catch {
        // Fallback: barra inline se overlay nao carregar
        _renderIngestionProgressBar();
    }

    // D11: exportar backup ECO1 antes de limpar (se solicitado)
    if (plan.decisions.exportBeforeClear && plan.decisions.clearStrategy !== 'none') {
        if (progress) progress.addInfo(t('creatingBackup') || 'Creating backup...');
        await handleDownloadECO1Backup();
    }

    let result;
    try {
        // Constroi modelo virtual (side-effect free) em vez de injetar diretamente
        result = await buildVirtualModel(plan, {
            onProgress: (phase, current, total) => {
                if (progress) {
                    progress.update(phase, current, total);
                } else {
                    const progressBar = document.querySelector('.ingestion-progress-bar');
                    if (progressBar) {
                        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
                        progressBar.style.width = `${pct}%`;
                        progressBar.textContent = `${phase}: ${current}/${total}`;
                    }
                }
            },
        });

        // Surfacea warnings no overlay (antes escondidos no console)
        if (result.warnings.length > 0) {
            console.warn('[ecbyts] buildVirtualModel warnings:', result.warnings);
            for (const w of result.warnings) {
                if (progress) progress.addWarning(w);
            }
        }
    } catch (err) {
        if (progress) {
            progress.addError(err.message);
            progress.finish({ errors: 1 });
        }
        showToast(`Erro na construcao do modelo: ${err.message}`, 'error');
        console.error('[ecbyts] buildVirtualModel error:', err);
        handleCloseIngestionModal();
        return;
    }

    // Dismiss overlay — merge modal assume daqui
    if (progress) {
        progress.finish({
            elements: result.stats.elements,
            campaigns: result.stats.campaigns,
            observations: result.stats.observations,
            warnings: result.warnings.length,
        });
        // Auto-dismiss apos 2s para nao bloquear merge modal
        setTimeout(() => {
            if (progress) progress.dismiss();
        }, 2000);
    }

    // Registra arquivo no file manager — fire-and-forget, NUNCA bloqueia o fluxo
    try {
        const sourceFile = _wizardState?._sourceFile;
        if (sourceFile) {
            const mode = getFileRegisterMode();
            registerFromIngestion(sourceFile, { mode, source: 'import' }).catch((regErr) => {
                console.warn('[ecbyts] File register failed (non-blocking):', regErr.message);
            });
        }
    } catch (_) {
        /* silencioso — registro de arquivo e secundario */
    }

    // Captura modelo atual ANTES de fechar o wizard
    const currentModel = buildModel();

    // Gap 3: salvar virtual model para retry se merge for cancelado
    window._lastVirtualModel = result.model;
    window._lastCurrentModel = currentModel;

    // Fecha wizard e abre merge modal com modelos pre-carregados
    handleCloseIngestionModal();

    showToast(
        `Modelo virtual construido: ${result.stats.elements} elementos, ${result.stats.campaigns} campanhas, ${result.stats.observations} observacoes. Revise no painel Diff/Merge.`,
        'info',
    );

    // Abre merge modal e pre-carrega modelos (handleOpenMergeModal reseta state e limpa _postMergeActions)
    mergeHandlers.handleOpenMergeModal();

    // D18/D19: salvar decisoes pos-merge APOS handleOpenMergeModal (que faz delete window._postMergeActions)
    if (plan.decisions.generateTerrain) {
        window._postMergeActions = {
            generateTerrain: true,
            generateAerial: plan.decisions.generateAerial !== false,
        };
    }

    mergeHandlers.preloadMergeModels(currentModel, result.model);
}

/**
 * D11: Baixa backup ECO1 do modelo atual antes de limpar.
 * Gera chave ECO1 e faz download automatico como arquivo .eco1
 */
export async function handleDownloadECO1Backup() {
    try {
        const { generateKeySimple } = await import('../../core/io/export.js');
        const key = await generateKeySimple();
        // D11: marcar backup como baixado para habilitar o botao "Ingerir Dados"
        if (_wizardState) _wizardState.backupDownloaded = true;
        const blob = new Blob([key], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ecbyts-backup-${new Date().toISOString().slice(0, 10)}.eco1`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Backup ECO1 baixado com sucesso', 'success');
        // Re-renderiza o step para habilitar o botao "Ingerir Dados"
        renderIngestionStep();
    } catch (err) {
        console.error('[ecbyts] ECO1 backup error:', err);
        showToast(`Erro ao gerar backup: ${err.message}`, 'error');
    }
}

/**
 * Atualiza override de mapeamento de coluna.
 */
export function handleIngestionColumnOverride(sheetName, sourceColumn, targetField) {
    if (!_wizardState) return;
    const key = `${sheetName}:${sourceColumn}`;
    _wizardState.decisions.columnOverrides[key] = targetField;
}

/**
 * Resolve ambiguidade.
 */
export function handleIngestionResolveAmbiguity(ambiguityKey, resolution) {
    if (!_wizardState) return;
    _wizardState.decisions.ambiguityResolutions[ambiguityKey] = resolution;
}

/**
 * Chama o mapeamento por IA para as colunas ainda nao mapeadas.
 * So executado quando o usuario clica explicitamente no botao "Mapear com IA".
 */
export async function handleIngestionMapWithAI() {
    if (!_wizardState) return;

    const btn = document.querySelector('[data-action="map-with-ai"]');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Mapeando...';
    }

    try {
        const { hasApiKey, sendMessage } = await import('../../core/llm/client.js');
        if (!hasApiKey()) {
            showToast('API key nao configurada. Configure em AI Assistant.', 'warning');
            return;
        }

        showToast('Enviando colunas para a IA...', 'info');
        const aiClient = { sendMessage: (prompt) => sendMessage('', prompt) };
        const aiMapping = await mapWithAI(_wizardState.parsed, aiClient);

        // Merge: IA preenche gaps onde deterministico falhou
        const mapping = _wizardState.mapping;
        let applied = 0;
        for (const aiCol of aiMapping.columns || []) {
            const existing = (mapping.columns || []).find(
                (c) => c.sourceSheet === aiCol.sourceSheet && c.sourceColumn === aiCol.sourceColumn,
            );
            if (existing && !existing.targetField && aiCol.targetField) {
                existing.targetField = aiCol.targetField;
                existing.confidence = aiCol.confidence;
                existing.method = 'ai';
                existing.needsHumanReview = aiCol.confidence < 0.8;
                applied++;
            }
        }
        if ((mapping.sheetMappings || []).length === 0 && (aiMapping.sheetMappings || []).length > 0) {
            mapping.sheetMappings = aiMapping.sheetMappings;
        }

        // Atualiza wizard state e re-renderiza
        _wizardState = { ..._wizardState, mapping };
        renderIngestionStep();
        showToast(`IA mapeou ${applied} coluna(s) adicionais`, applied > 0 ? 'success' : 'warning');
    } catch (err) {
        console.error('[Ingestion] AI mapping error:', err);
        showToast(`Erro no mapeamento IA: ${err.message}`, 'error');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Mapear com IA';
        }
    }
}

/**
 * Handlers de lazy-load de observacoes (chamados do lists.js).
 */
export function handleShowMoreObservations(elementId, increment) {
    showMoreObservations(elementId, increment);
}

export function handleShowAllObservations(elementId, total) {
    showAllObservations(elementId, total);
}

/**
 * Toggle campanha colapsavel na lista hierarquica de observacoes.
 */
export function handleToggleObsCampaign(elementId, campaignId) {
    toggleObsCampaign(elementId, campaignId);
}

/**
 * Expande/colapsa detalhes de uma observacao individual.
 */
export function handleExpandObservation(elementId, obsIndex) {
    expandObservation(elementId, obsIndex);
}

// ----------------------------------------------------------------
// RENDER WIZARD STEPS
// ----------------------------------------------------------------

/**
 * Renderiza o step atual do wizard no modal.
 */
function renderIngestionStep() {
    const container = document.getElementById('ingestion-content');
    if (!container) return;

    if (!_wizardState) {
        container.innerHTML = renderUploadForm();
        return;
    }

    const step = getWizardStep(_wizardState);

    // Step progress bar
    const pct = Math.round((step.stepNumber / step.totalSteps) * 100);
    let html = `
        <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:10px;${S_MUTED}">Etapa ${step.stepNumber} de ${step.totalSteps}</span>
                <span style="font-size:10px;${S_MUTED}">${pct}%</span>
            </div>
            <div style="height:3px;background:var(--neutral-200);border-radius:2px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:var(--accent-500);border-radius:2px;transition:width .3s;"></div>
            </div>
            <h3 style="margin:8px 0 2px;font-size:14px;color:var(--neutral-800);">${escapeHtml(step.title)}</h3>
            <p style="font-size:11px;${S_MUTED}margin:0;">${escapeHtml(step.subtitle)}</p>
        </div>
    `;

    // Aviso se modelo ja tem elementos
    if (step.stepNumber === 1) {
        const existing = getAllElements();
        if (existing.length > 0) {
            html += `
                <div style="background:var(--warning-50);border:1px solid var(--warning-300);border-radius:6px;padding:8px;margin-bottom:10px;font-size:11px;color:var(--neutral-800);">
                    <strong>Modelo existente:</strong> ${existing.length} elementos ja carregados.
                    Os dados importados serao adicionados ao modelo atual.
                    Se as coordenadas forem distantes, use <em>View &gt; Fit All</em> apos a ingestao.
                </div>
            `;
        }
    }

    switch (step.stepId) {
        case 'FORMAT_CONFIRM':
            html += renderFormatConfirm(step);
            break;
        case 'COLUMN_MAPPING':
            html += renderColumnMapping(step);
            break;
        case 'AMBIGUITY_RESOLUTION':
            html += renderAmbiguityResolution(step);
            break;
        case 'DOMAIN_DECISIONS':
            html += renderDomainDecisions(step);
            break;
        case 'REVIEW_AND_CONFIRM':
            html += renderReviewConfirm(step);
            break;
    }

    // Navigation buttons
    html += `
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;border-top:1px solid var(--neutral-200);padding-top:12px;">
            ${step.canGoBack ? '<button class="btn btn-secondary" onclick="window.handleIngestionBack()">Voltar</button>' : ''}
            ${
                step.isLastStep
                    ? (() => {
                          // D11: se exportBeforeClear=true e backup nao foi baixado ainda, desabilitar botao
                          const needsBackup =
                              _wizardState?.decisions?.exportBeforeClear &&
                              _wizardState?.decisions?.clearStrategy !== 'none' &&
                              !_wizardState?.backupDownloaded;
                          return needsBackup
                              ? '<button class="btn btn-primary" disabled title="Baixe o backup ECO1 antes de continuar" style="opacity:0.5;cursor:not-allowed;">Ingerir Dados</button>'
                              : '<button class="btn btn-primary" onclick="window.handleIngestionExecute()">Ingerir Dados</button>';
                      })()
                    : '<button class="btn btn-primary" onclick="window.handleIngestionNext()">Proximo</button>'
            }
        </div>
    `;

    container.innerHTML = html;
}

function _templateLinks(group) {
    const S_LINK = 'color:var(--accent-500);text-decoration:none;cursor:pointer;';
    return Object.entries(TEMPLATES)
        .filter(([, t]) => t.group === group)
        .map(
            ([id, t]) =>
                `<a href="#" onclick="window.handleDownloadTemplate('${id}');return false" style="${S_LINK}" title="${escapeHtml(t.filename)}">${escapeHtml(t.label)}</a>`,
        )
        .join(' &middot; ');
}

function renderUploadForm() {
    return `
        <div style="text-align:center;padding:24px;">
            <div style="border:2px dashed var(--neutral-300);border-radius:8px;padding:28px;margin-bottom:16px;">
                <p style="font-size:13px;color:var(--neutral-800);margin:0 0 12px;font-weight:500;">
                    Importar Dados
                </p>
                <p style="font-size:11px;${S_MUTED}margin:0 0 12px;">
                    Planilha (.xlsx, .csv), relatorio PDF/DOCX, ou shapefile (.shp, .zip)
                </p>
                <input type="file" accept=".xlsx,.xls,.csv,.tsv,.pdf,.docx,.shp,.zip"
                       onchange="window.handleIngestionFileUpload(this)"
                       style="font-size:11px;color:var(--neutral-800);">
            </div>
            <div style="font-size:10px;text-align:left;display:inline-block;line-height:1.7;margin-bottom:8px;">
                <div style="margin-bottom:4px;">
                    <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--primary-100);margin-right:4px;vertical-align:middle;"></span>
                    <strong>Planilha</strong> <span style="${S_MUTED}">(.xlsx, .csv) &#8594; wizard 5 etapas com mapeamento</span>
                </div>
                <div style="margin-bottom:4px;">
                    <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--warning-100);margin-right:4px;vertical-align:middle;"></span>
                    <strong>Relatorio</strong> <span style="${S_MUTED}">(.pdf, .docx) &#8594; extracao automatica de tabelas com revisao</span>
                </div>
                <div style="margin-bottom:4px;">
                    <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--success-100);margin-right:4px;vertical-align:middle;"></span>
                    <strong>Shapefile</strong> <span style="${S_MUTED}">(.shp, .zip) &#8594; importa geometrias como elementos</span>
                </div>
            </div>
            <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">Baixar modelo de exemplo (planilha):</p>
            <div style="font-size:10px;text-align:left;display:inline-block;line-height:1.7;">
                <div><span style="${S_MUTED}">Ambiental:</span> ${_templateLinks('env')}</div>
                <div><span style="${S_MUTED}">Ocupacional:</span> ${_templateLinks('ohs')}</div>
                <div><span style="${S_MUTED}">Referencia:</span> ${_templateLinks('ref')}</div>
                <div><span style="${S_MUTED}">GHG/ESG:</span> ${_templateLinks('ghg')}</div>
            </div>
        </div>
    `;
}

function renderFormatConfirm(step) {
    const f = step.format;
    const s = step.stats;

    // Nome amigavel do formato
    const formatLabels = {
        'edd-r2': 'EPA Region 2 EDD',
        'edd-r3': 'EPA Region 3 EDD',
        'edd-r5': 'EPA Region 5 EDD',
        'edd-br': 'EDD Brasileiro',
        'ecbyts-csv': 'CSV ecbyts nativo',
        'ohs-aiha': 'AIHA IH Data (exposicao ocupacional)',
        'ohs-doehrs': 'DOEHRS-IH EDD (exposicao militar)',
        'ohs-nr15': 'NR-15 Assessment (insalubridade)',
        'ohs-ppra': 'PPRA/PGR (riscos ocupacionais)',
        'ohs-pcmso': 'PCMSO (exames medicos)',
        'ohs-bio': 'LIMS Biomonitoring (bioindicadores)',
        'ohs-generic': 'OHS generico (ocupacional)',
        unknown: 'Formato desconhecido',
    };
    const formatName = formatLabels[f.type] || f.type;

    let html = `
        <div style="${S_CARD}">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <p style="${S_TITLE}font-size:13px;">${escapeHtml(formatName)} ${f.version ? `<span style="${S_MUTED}font-weight:400;">v${f.version}</span>` : ''}</p>
                </div>
                <span style="font-size:12px;font-weight:600;color:${f.confidence >= 0.8 ? 'var(--success)' : f.confidence >= 0.5 ? 'var(--warning)' : 'var(--error)'};">
                    ${Math.round(f.confidence * 100)}%
                </span>
            </div>
        </div>

        <div style="${S_CARD}">
            <p style="${S_TITLE}font-size:11px;">Abas encontradas</p>
            <ul style="margin:0;padding-left:16px;font-size:11px;color:var(--neutral-800);">
                ${step.sheetsFound.map((s) => `<li>${escapeHtml(s.name)} <span style="${S_MUTED}">(${s.rowCount} linhas)</span></li>`).join('')}
            </ul>
        </div>
    `;

    if (s) {
        html += `
        <div style="${S_CARD}">
            <p style="${S_TITLE}font-size:11px;">Resumo dos dados</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;">
                <div><strong>${s.locations}</strong> locais</div>
                <div><strong>${s.samples}</strong> amostras</div>
                <div><strong>${s.results}</strong> resultados</div>
                <div><strong>${s.campaigns}</strong> campanha(s)</div>
                <div style="color:var(--success);"><strong>${s.detected}</strong> detectados</div>
                <div style="${S_MUTED}"><strong>${s.nonDetect}</strong> &lt;LQ (nao detectados)</div>
            </div>
            ${
                s.chemicals.length > 0
                    ? `
            <p style="margin:6px 0 0;font-size:10px;${S_MUTED}">
                Parametros: ${escapeHtml(s.chemicals.slice(0, 8).join(', '))}${s.chemicals.length > 8 ? ` (+${s.chemicals.length - 8})` : ''}
            </p>`
                    : ''
            }
            ${
                s.dateRange.min
                    ? `
            <p style="margin:4px 0 0;font-size:10px;${S_MUTED}">
                Periodo: ${s.dateRange.min} a ${s.dateRange.max}
            </p>`
                    : ''
            }
        </div>
        `;

        // Preview de dados: primeiras linhas de cada entidade
        if (_wizardState?._transformed) {
            const t = _wizardState._transformed;
            html += renderDataPreview(t);
        }
    }

    // D8: tabela de abas com mapeamento para entidades
    if (step.sheetMappingInfo?.length > 0) {
        html += `
        <div style="${S_CARD}">
            <p style="${S_TITLE}font-size:11px;">Mapeamento de abas</p>
            <table style="width:100%;font-size:10px;border-collapse:collapse;color:var(--neutral-800);">
                <thead>
                    <tr style="${S_TABLE_HEADER}">
                        <th style="text-align:left;padding:3px 6px;">Aba</th>
                        <th style="text-align:left;padding:3px 6px;">Entidade</th>
                        <th style="text-align:right;padding:3px 6px;">Registros</th>
                    </tr>
                </thead>
                <tbody>
                    ${step.sheetMappingInfo
                        .map(
                            (si) => `
                    <tr data-testid="sheet-mapping-row" style="${S_TABLE_ROW}">
                        <td style="padding:3px 6px;font-weight:500;">${escapeHtml(si.name)}</td>
                        <td style="padding:3px 6px;${S_MUTED}">${si.entity ? escapeHtml(si.entity) : '—'}</td>
                        <td style="padding:3px 6px;text-align:right;">${si.count}</td>
                    </tr>`,
                        )
                        .join('')}
                </tbody>
            </table>
        </div>`;
    }

    // D3: aviso e opcao de limpeza se modelo ja tem elementos
    if (step.existingModelWarning) {
        const { count, families } = step.existingModelWarning;
        html += `
        <div style="${S_CARD}border:1px solid var(--warning-300);">
            <p style="${S_TITLE}font-size:11px;color:var(--warning-700);">Modelo existente: ${count} elementos (${escapeHtml(families.join(', '))})</p>
            <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">Como tratar elementos existentes?</p>
            <label style="${S_LABEL}">
                <input type="radio" name="clearstrat" value="none" ${(_wizardState?.decisions?.clearStrategy || 'none') === 'none' ? 'checked' : ''}
                       onchange="window._ingestionDecision('clearStrategy','none')">
                Manter tudo — adicionar ao modelo existente <span style="${S_MUTED}">(padrao)</span>
            </label>
            <label style="${S_LABEL}">
                <input type="radio" name="clearstrat" value="all" ${_wizardState?.decisions?.clearStrategy === 'all' ? 'checked' : ''}
                       onchange="window._ingestionDecision('clearStrategy','all')">
                Substituir — limpar modelo inteiro antes de importar
            </label>
            ${
                families.includes('well')
                    ? `
            <label style="${S_LABEL}">
                <input type="radio" name="clearstrat" value="family:well" ${_wizardState?.decisions?.clearStrategy === 'family:well' ? 'checked' : ''}
                       onchange="window._ingestionDecision('clearStrategy','family:well')">
                Limpar apenas pocos de monitoramento
            </label>`
                    : ''
            }
            ${
                step.showExportBeforeClear
                    ? `
            <div style="margin-top:6px;padding:6px;background:var(--neutral-50);border-radius:4px;">
                <label style="${S_LABEL}">
                    <input type="checkbox" id="export-before-clear"
                           ${_wizardState?.decisions?.exportBeforeClear ? 'checked' : ''}
                           onchange="window._ingestionDecision('exportBeforeClear',this.checked)">
                    Exportar backup ECO1 antes de limpar
                </label>
                <button class="btn btn-secondary btn-sm" style="margin-top:4px;font-size:10px;"
                        onclick="window.handleDownloadECO1Backup()">
                    Baixar backup agora
                </button>
            </div>`
                    : ''
            }
        </div>`;
    }

    // D2: aplicar origem geografica como ponto zero do mapa
    if (step.suggestedOrigin) {
        const o = step.suggestedOrigin;
        const applyChecked = (_wizardState?.decisions?.applyOrigin ?? step.applyOriginDefault) ? 'checked' : '';
        html += `
        <div style="${S_CARD}">
            <p style="${S_TITLE}font-size:11px;">Origem do mapa (coordenadas)</p>
            <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">
                Centroide de ${o.count} locais: ${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}
            </p>
            <label style="${S_LABEL}">
                <input type="checkbox" ${applyChecked}
                       onchange="window._ingestionDecision('applyOrigin',this.checked);window._ingestionDecision('suggestedOrigin',${JSON.stringify(o)})">
                Definir centroide como origem do mapa (aplica coordenadas UTM)
            </label>
        </div>`;
        // Garante que suggestedOrigin esta na decision
        if (_wizardState) _wizardState.decisions.suggestedOrigin = o;
    }

    // D12: aviso de coordenadas distantes
    if (step.distanceWarning) {
        const dw = step.distanceWarning;
        html += `
        <div style="${S_CARD}border:1px solid var(--error);background:rgba(184,68,68,0.05);">
            <p style="${S_TITLE}font-size:11px;color:var(--error);">Aviso: coordenadas distantes (${dw.km} km)</p>
            <p style="font-size:10px;${S_MUTED}margin:0;">
                Modelo existente centrado em ${dw.existingCentroid.lat.toFixed(3)}, ${dw.existingCentroid.lon.toFixed(3)}.
                Dados importados centrados em ${dw.newCentroid.lat.toFixed(3)}, ${dw.newCentroid.lon.toFixed(3)}.
                Considere usar "Substituir" ou "Limpar familia" acima.
            </p>
        </div>`;
    }

    if (f.evidence.length > 0) {
        html += `
        <details style="margin-top:4px;font-size:10px;${S_MUTED}">
            <summary style="cursor:pointer;">Evidencias de deteccao</summary>
            <ul style="padding-left:16px;margin:4px 0;">
                ${f.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}
            </ul>
        </details>`;
    }

    // D8: Quick Import — banner quando elegivel
    if (step.quickImportEligible) {
        const isOn = _wizardState?.decisions?.quickImport || false;
        html += `
        <div style="${S_CARD}border:1px solid var(--success-300, #86efac);background:var(--success-50, #f0fdf4);">
            <div style="display:flex;align-items:center;gap:8px;">
                <label style="${S_LABEL}font-weight:500;color:var(--success-700, #15803d);flex:1;">
                    <input type="checkbox" ${isOn ? 'checked' : ''}
                           onchange="window._ingestionDecision('quickImport',this.checked)">
                    Quick Import (pular configuracao)
                </label>
            </div>
            <p style="font-size:10px;color:var(--neutral-600);margin:4px 0 0;padding-left:22px;">
                Formato reconhecido com ${Math.round(f.confidence * 100)}% de confianca.
                Mapeamento automatico aplicado. Avanca direto para revisao final.
            </p>
        </div>`;
    }

    return html;
}

/**
 * Renderiza preview "de → para" dos dados transformados.
 * Mostra primeiras 2 linhas de locations, samples e results.
 */
function renderDataPreview(transformed) {
    let html = `<div style="${S_CARD}">
        <p style="${S_TITLE}font-size:11px;">Preview de dados (primeiras linhas)</p>`;

    if (transformed.locations.length > 0) {
        const loc = transformed.locations[0];
        html += `
        <div style="margin-bottom:6px;">
            <span style="font-size:10px;font-weight:600;color:var(--neutral-800);">Local:</span>
            <div style="${S_SAMPLE}margin-top:2px;">
                ${loc.elementName ? `<strong>${escapeHtml(String(loc.elementName))}</strong>` : '—'}
                ${loc.latitude != null ? ` | lat: ${loc.latitude}` : ''}
                ${loc.longitude != null ? ` | long: ${loc.longitude}` : ''}
                ${loc.locType ? ` | tipo: ${escapeHtml(String(loc.locType))}` : ''}
            </div>
        </div>`;
    }

    if (transformed.samples.length > 0) {
        const sam = transformed.samples[0];
        html += `
        <div style="margin-bottom:6px;">
            <span style="font-size:10px;font-weight:600;color:var(--neutral-800);">Amostra:</span>
            <div style="${S_SAMPLE}margin-top:2px;">
                ${sam.sampleCode ? `<strong>${escapeHtml(String(sam.sampleCode))}</strong>` : '—'}
                ${sam.elementName ? ` | local: ${escapeHtml(String(sam.elementName))}` : ''}
                ${sam.sampleDate ? ` | data: ${sam.sampleDate}` : ''}
                ${sam.matrix ? ` | matriz: ${escapeHtml(String(sam.matrix))}` : ''}
            </div>
        </div>`;
    }

    if (transformed.results.length > 0) {
        const res = transformed.results[0];
        html += `
        <div>
            <span style="font-size:10px;font-weight:600;color:var(--neutral-800);">Resultado:</span>
            <div style="${S_SAMPLE}margin-top:2px;">
                ${res.chemicalName ? `<strong>${escapeHtml(String(res.chemicalName))}</strong>` : '—'}
                ${res.resultValue != null ? ` = ${res.resultValue}` : ''}
                ${res.resultUnit ? ` ${escapeHtml(String(res.resultUnit))}` : ''}
                ${res.detectFlag ? ` | flag: ${escapeHtml(String(res.detectFlag))}` : ''}
                ${res.casNumber ? ` | CAS: ${escapeHtml(String(res.casNumber))}` : ''}
            </div>
        </div>`;
    }

    html += '</div>';
    return html;
}

function renderColumnMapping(step) {
    const targetLabels = {
        elementName: 'Local (ID)',
        latitude: 'Latitude',
        longitude: 'Longitude',
        datum: 'Datum',
        locType: 'Tipo de local',
        elevation: 'Elevacao',
        sampleCode: 'Codigo amostra',
        sampleDate: 'Data coleta',
        matrix: 'Matriz',
        chemicalName: 'Parametro quimico',
        casNumber: 'CAS Number',
        resultValue: 'Valor resultado',
        resultUnit: 'Unidade',
        detectFlag: 'Flag deteccao',
        detectionLimit: 'Limite deteccao',
        qualifier: 'Qualificador',
        labName: 'Laboratorio',
        method: 'Metodo analitico',
        taskCode: 'Codigo campanha',
        sampleType: 'Tipo amostra',
        fraction: 'Fracao',
        dilution: 'Diluicao',
        samplingMethod: 'Metodo coleta',
        locDescription: 'Descricao local',
        observationDate: 'Data observacao',
        building: 'Edificacao',
        // OHS fields
        workerId: 'Trabalhador ID',
        workerName: 'Nome trabalhador',
        gheId: 'GHE (grupo)',
        jobTitle: 'Cargo/funcao',
        department: 'Setor/departamento',
        exposureAgent: 'Agente de exposicao',
        exposureRoute: 'Via de exposicao',
        sampleTypeOHS: 'Tipo amostra OHS',
        twa8h: 'TWA-8h',
        stel: 'STEL',
        ceilingValue: 'Valor teto',
        oel: 'OEL/TLV/LT',
        bei: 'BEI/IBMP',
        specimen: 'Matriz biologica',
        ppeStatus: 'Status EPI',
        incidentType: 'Tipo acidente',
        severity: 'Severidade',
        probability: 'Probabilidade',
        daysLost: 'Dias perdidos',
        aptitude: 'Aptidao/ASO',
        examType: 'Tipo exame',
        naicsCode: 'CNAE/NAICS',
        durationHours: 'Duracao (h)',
        insalubrityGrade: 'Grau insalubridade',
        riskLevel: 'Nivel de risco',
    };

    const targetOptions = Object.keys(COLUMN_ALIASES)
        .map((k) => `<option value="${k}">${escapeHtml(targetLabels[k] || k)}</option>`)
        .join('');

    // Agrupar por sheet para melhor visualizacao
    const colsBySheet = {};
    for (const col of step.columns) {
        if (!col.sourceColumn) continue;
        const sheet = col.sourceSheet || '?';
        if (!colsBySheet[sheet]) colsBySheet[sheet] = [];
        colsBySheet[sheet].push(col);
    }

    // Preview de valores para cada coluna — pegar da parsed data
    const sampleValues = {};
    if (_wizardState?.parsed?.sheets) {
        for (const sheet of _wizardState.parsed.sheets) {
            for (const row of sheet.rows.slice(0, 3)) {
                for (const [col, val] of Object.entries(row)) {
                    const key = `${sheet.name}:${col}`;
                    if (!sampleValues[key] && val != null && String(val).trim()) {
                        sampleValues[key] = String(val).slice(0, 25);
                    }
                }
            }
        }
    }

    // Conta colunas nao mapeadas no total
    const allCols = Object.values(colsBySheet).flat();
    const totalUnmapped = allCols.filter((c) => !c.targetField).length;

    let html = '';
    for (const [sheetName, cols] of Object.entries(colsBySheet)) {
        const mapped = cols.filter((c) => c.targetField);
        html += `
        <div style="margin-bottom:10px;">
            <p style="font-size:10px;font-weight:600;color:var(--neutral-800);margin:0 0 4px;">
                ${escapeHtml(sheetName)} <span style="${S_MUTED}font-weight:400;">(${mapped.length}/${cols.length} mapeadas)</span>
            </p>
            <div style="max-height:200px;overflow-y:auto;border:1px solid var(--neutral-200);border-radius:4px;">
                <table style="width:100%;font-size:11px;border-collapse:collapse;color:var(--neutral-800);">
                    <thead>
                        <tr style="${S_TABLE_HEADER}">
                            <th style="text-align:left;padding:4px 6px;">Coluna</th>
                            <th style="text-align:left;padding:4px 6px;">Exemplo</th>
                            <th style="text-align:left;padding:4px 6px;">Campo ecbyts</th>
                            <th style="text-align:center;padding:4px 6px;width:40px;">Conf.</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cols
                            .map((col) => {
                                const key = `${sheetName}:${col.sourceColumn}`;
                                const sample = sampleValues[key] || '';
                                const bg =
                                    col.confidence >= 0.8
                                        ? ''
                                        : col.confidence > 0
                                          ? 'background:var(--warning-50);'
                                          : '';
                                return `
                            <tr style="${bg}${S_TABLE_ROW}">
                                <td style="padding:3px 6px;font-weight:500;">${escapeHtml(col.sourceColumn)}</td>
                                <td style="padding:3px 6px;"><span style="${S_SAMPLE}">${escapeHtml(sample)}</span></td>
                                <td style="padding:3px 6px;">
                                    <select class="form-input form-input-sm" style="font-size:10px;"
                                            onchange="window.handleIngestionColumnOverride('${escapeHtml(sheetName)}','${escapeHtml(col.sourceColumn)}',this.value)">
                                        <option value="">-- ignorar --</option>
                                        ${targetOptions.replace(
                                            `value="${col.targetField}"`,
                                            `value="${col.targetField}" selected`,
                                        )}
                                    </select>
                                </td>
                                <td style="text-align:center;padding:3px 6px;font-size:10px;font-weight:600;color:${col.confidence >= 0.8 ? 'var(--success)' : col.confidence > 0 ? 'var(--warning)' : 'var(--error)'};">
                                    ${Math.round(col.confidence * 100)}%
                                </td>
                            </tr>`;
                            })
                            .join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    // Botao IA — aparece so se houver colunas nao mapeadas
    if (totalUnmapped > 0) {
        html += `
        <div style="margin-top:8px;padding:8px;background:var(--neutral-50);border:1px solid var(--neutral-200);border-radius:6px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span style="font-size:11px;color:var(--neutral-500);">
                ${totalUnmapped} coluna(s) sem mapeamento automatico.
            </span>
            <button class="btn btn-secondary btn-sm" data-action="map-with-ai"
                    onclick="window.handleIngestionMapWithAI()"
                    style="font-size:11px;white-space:nowrap;">
                Mapear com IA
            </button>
        </div>`;
    }

    return html;
}

function renderAmbiguityResolution(step) {
    return `
        <div style="margin-top:4px;">
            ${step.ambiguities
                .map(
                    (amb, i) => `
                <div style="${S_CARD}">
                    <p style="font-size:11px;margin:0 0 4px;color:var(--neutral-800);">
                        <strong>${escapeHtml(amb.type)}:</strong> '${escapeHtml(amb.sourceValue)}'
                    </p>
                    <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">
                        ${escapeHtml(amb.context)}
                    </p>
                    <div style="display:flex;gap:6px;align-items:center;">
                        ${
                            amb.suggestedTarget
                                ? `
                            <button class="btn btn-sm btn-primary"
                                    onclick="window.handleIngestionResolveAmbiguity('${amb.type}:${escapeHtml(amb.sourceValue)}','${escapeHtml(amb.suggestedTarget)}')">
                                ${escapeHtml(amb.suggestedTarget)}
                            </button>`
                                : ''
                        }
                        <input type="text" class="form-input form-input-sm" placeholder="Outro..."
                               style="width:120px;font-size:10px;"
                               onchange="window.handleIngestionResolveAmbiguity('${amb.type}:${escapeHtml(amb.sourceValue)}',this.value)">
                    </div>
                </div>
            `,
                )
                .join('')}
        </div>
    `;
}

function renderDomainDecisions(step) {
    if (step.domain === 'ohs') return renderOHSDomainDecisions(step);
    return renderEnvironmentalDomainDecisions(step);
}

function renderOHSDomainDecisions(step) {
    const d = step.decisions;
    let html = '<div style="margin-top:4px;font-size:11px;">';

    // 4a. GHE
    if (step.hasGHE?.has) {
        html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">GHE — ${step.hasGHE.count} grupo(s) homogeneo(s)</p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">
                    Grupos: ${escapeHtml(step.hasGHE.groups.slice(0, 6).join(', '))}${step.hasGHE.groups.length > 6 ? ' ...' : ''}
                </p>
                <label style="${S_LABEL}">
                    <input type="radio" name="ghe" value="create_groups" ${d.gheStrategy === 'create_groups' ? 'checked' : ''}
                           onchange="window._ingestionDecision('gheStrategy','create_groups')">
                    Criar como Groups no ecbyts <span style="${S_MUTED}">(recomendado)</span>
                </label>
                <label style="${S_LABEL}">
                    <input type="radio" name="ghe" value="ignore" ${d.gheStrategy === 'ignore' ? 'checked' : ''}
                           onchange="window._ingestionDecision('gheStrategy','ignore')">
                    Ignorar agrupamento
                </label>
            </div>`;
    }

    // 4b. Tipo de amostra: area vs personal
    if (step.hasMixedSampleTypes?.has) {
        html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">Tipo de amostra</p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">
                    Dados contem amostras 'area' e 'personal'. Como tratar?
                </p>
                <label style="${S_LABEL}">
                    <input type="radio" name="sampletype" value="separate" ${d.sampleTypeStrategy === 'separate' ? 'checked' : ''}
                           onchange="window._ingestionDecision('sampleTypeStrategy','separate')">
                    Separar: area → Element 'area', pessoal → Element 'individual' <span style="${S_MUTED}">(recomendado)</span>
                </label>
                <label style="${S_LABEL}">
                    <input type="radio" name="sampletype" value="all_worker" ${d.sampleTypeStrategy === 'all_worker' ? 'checked' : ''}
                           onchange="window._ingestionDecision('sampleTypeStrategy','all_worker')">
                    Todas como observacoes no trabalhador
                </label>
            </div>`;
    }

    // 4c. LGPD — dados pessoais
    if (step.hasWorkerPII?.has) {
        html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">Dados pessoais (LGPD)</p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">
                    Dados contem ${step.hasWorkerPII.hasCPF ? 'CPF/' : ''}matricula/nome de trabalhadores.
                </p>
                <label style="${S_LABEL}">
                    <input type="radio" name="lgpd" value="pseudonymize" ${d.lgpdStrategy === 'pseudonymize' ? 'checked' : ''}
                           onchange="window._ingestionDecision('lgpdStrategy','pseudonymize')">
                    Pseudonimizar (hash do nome, preservar GHE) <span style="${S_MUTED}">(recomendado)</span>
                </label>
                <label style="${S_LABEL}">
                    <input type="radio" name="lgpd" value="keep_identified" ${d.lgpdStrategy === 'keep_identified' ? 'checked' : ''}
                           onchange="window._ingestionDecision('lgpdStrategy','keep_identified')">
                    Manter dados identificados <span style="${S_MUTED}">(requer consentimento)</span>
                </label>
                <label style="${S_LABEL}">
                    <input type="radio" name="lgpd" value="anonymize" ${d.lgpdStrategy === 'anonymize' ? 'checked' : ''}
                           onchange="window._ingestionDecision('lgpdStrategy','anonymize')">
                    Anonimizar (remover vinculo com trabalhador)
                </label>
            </div>`;
    }

    // 4d. Limites ocupacionais
    html += `
        <div style="${S_CARD}">
            <p style="${S_TITLE}">Limites ocupacionais</p>
            <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">Referencia para validacao de exposicao</p>
            <label style="${S_LABEL}">
                <input type="radio" name="oel" value="ACGIH" ${d.oelSource === 'ACGIH' ? 'checked' : ''}
                       onchange="window._ingestionDecision('oelSource','ACGIH')">
                ACGIH TLV (internacional) <span style="${S_MUTED}">(recomendado)</span>
            </label>
            <label style="${S_LABEL}">
                <input type="radio" name="oel" value="NR-15" ${d.oelSource === 'NR-15' ? 'checked' : ''}
                       onchange="window._ingestionDecision('oelSource','NR-15')">
                NR-15 (Brasil)
            </label>
            <label style="${S_LABEL}">
                <input type="radio" name="oel" value="NIOSH" ${d.oelSource === 'NIOSH' ? 'checked' : ''}
                       onchange="window._ingestionDecision('oelSource','NIOSH')">
                NIOSH REL (EUA)
            </label>
            <label style="${S_LABEL}">
                <input type="radio" name="oel" value="custom" ${d.oelSource === 'custom' ? 'checked' : ''}
                       onchange="window._ingestionDecision('oelSource','custom')">
                Personalizado
            </label>
        </div>`;

    // 4e. PCMSO — aptidao
    if (step.hasPCMSO) {
        html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">Dados PCMSO</p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">Exames medicos detectados. Importar status de aptidao?</p>
                <label style="${S_LABEL}">
                    <input type="checkbox" ${d.importAptitude ? 'checked' : ''}
                           onchange="window._ingestionDecision('importAptitude',this.checked)">
                    Importar aptidao (apto/inapto) como observacao
                </label>
            </div>`;
    }

    // Campanhas (compartilhado)
    if (step.hasMultipleCampaigns) {
        html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">${step.stats.campaigns} campanhas de medicao</p>
                <label style="${S_LABEL}">
                    <input type="radio" name="campaign" value="auto" ${d.campaignStrategy === 'auto' ? 'checked' : ''}
                           onchange="window._ingestionDecision('campaignStrategy','auto')">
                    Criar automaticamente <span style="${S_MUTED}">(recomendado)</span>
                </label>
                <label style="${S_LABEL}">
                    <input type="radio" name="campaign" value="single" ${d.campaignStrategy === 'single' ? 'checked' : ''}
                           onchange="window._ingestionDecision('campaignStrategy','single')">
                    Campanha unica
                </label>
            </div>`;
    }

    html += '</div>';
    return html;
}

function renderEnvironmentalDomainDecisions(step) {
    const d = step.decisions;
    let html = '<div style="margin-top:4px;font-size:11px;">';

    if (step.hasNonDetects) {
        html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">${step.stats.nonDetect} resultados nao detectados (${Math.round((step.stats.nonDetect / Math.max(step.stats.results, 1)) * 100)}%)</p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">
                    Valores abaixo do Limite de Quantificacao (LQ) do laboratorio.
                    A escolha afeta estatisticas (media, tendencia Mann-Kendall) e mapas de contaminacao.
                </p>
                <label style="${S_LABEL}" title="Preserva o dado original sem alterar. O valor fica nulo e a flag detect_flag=N identifica o nao-detectado. Recomendado para manter rastreabilidade completa.">
                    <input type="radio" name="nondetect" value="flag_null" ${d.nonDetectStrategy === 'flag_null' ? 'checked' : ''}
                           onchange="window._ingestionDecision('nonDetectStrategy','flag_null')">
                    Flag com valor nulo <span style="${S_MUTED}">(recomendado — rastreabilidade total)</span>
                </label>
                <label style="${S_LABEL}" title="Substitui pelo valor LQ/2. Padrao EPA para analises estatisticas (ProUCL). Permite calcular medias e tendencias, porem introduz um vies conservador.">
                    <input type="radio" name="nondetect" value="half_lq" ${d.nonDetectStrategy === 'half_lq' ? 'checked' : ''}
                           onchange="window._ingestionDecision('nonDetectStrategy','half_lq')">
                    Metade do LQ <span style="${S_MUTED}">(padrao EPA/ProUCL — para estatisticas)</span>
                </label>
                <label style="${S_LABEL}" title="Substitui pelo valor do LQ inteiro. Abordagem conservadora para avaliacao de risco — assume que a concentracao esta no limite de deteccao.">
                    <input type="radio" name="nondetect" value="full_lq" ${d.nonDetectStrategy === 'full_lq' ? 'checked' : ''}
                           onchange="window._ingestionDecision('nonDetectStrategy','full_lq')">
                    Valor do LQ <span style="${S_MUTED}">(conservador — avaliacao de risco)</span>
                </label>
                <label style="${S_LABEL}" title="Remove completamente os resultados nao-detectados. Cuidado: reduz o tamanho da amostra e pode distorcer medias para cima.">
                    <input type="radio" name="nondetect" value="discard" ${d.nonDetectStrategy === 'discard' ? 'checked' : ''}
                           onchange="window._ingestionDecision('nonDetectStrategy','discard')">
                    Descartar <span style="${S_MUTED}">(remove nao-detectados — reduz amostra)</span>
                </label>
            </div>`;
    }

    if (step.hasMultipleCampaigns) {
        html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">${step.stats.campaigns} campanhas detectadas</p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">Agrupadas por prefixo de data no codigo de amostra</p>
                <label style="${S_LABEL}">
                    <input type="radio" name="campaign" value="auto" ${d.campaignStrategy === 'auto' ? 'checked' : ''}
                           onchange="window._ingestionDecision('campaignStrategy','auto')">
                    Criar ${step.stats.campaigns} campanhas automaticamente <span style="${S_MUTED}">(recomendado)</span>
                </label>
                <label style="${S_LABEL}">
                    <input type="radio" name="campaign" value="single" ${d.campaignStrategy === 'single' ? 'checked' : ''}
                           onchange="window._ingestionDecision('campaignStrategy','single')">
                    Campanha unica
                </label>
            </div>`;
    }

    if (step.hasMultilevelWells?.has) {
        html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">${step.hasMultilevelWells.count} pocos multinivel</p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">
                    Ex: ${step.hasMultilevelWells.examples.slice(0, 4).join(', ')}
                </p>
                <label style="${S_LABEL}">
                    <input type="radio" name="multilevel" value="separate" ${d.multilevelStrategy === 'separate' ? 'checked' : ''}
                           onchange="window._ingestionDecision('multilevelStrategy','separate')">
                    Elementos separados <span style="${S_MUTED}">(recomendado)</span>
                </label>
                <label style="${S_LABEL}">
                    <input type="radio" name="multilevel" value="merged" ${d.multilevelStrategy === 'merged' ? 'checked' : ''}
                           onchange="window._ingestionDecision('multilevelStrategy','merged')">
                    Um poco com observacoes em profundidades
                </label>
            </div>`;
    }

    if (step.hasCoordinates?.has) {
        html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">Coordenadas geograficas</p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">
                    ${step.hasCoordinates.count || ''} locais com lat/long — serao projetados para coordenadas 3D locais
                </p>
                <label style="${S_LABEL}">
                    <input type="radio" name="coords" value="auto" ${d.coordinateOrigin === 'auto' ? 'checked' : ''}
                           onchange="window._ingestionDecision('coordinateOrigin','auto')">
                    Projetar automaticamente (centroide) <span style="${S_MUTED}">(recomendado)</span>
                </label>
            </div>`;
    }

    // D5: CRS / Datum info + selector
    if (step.dataQuality) {
        const dq = step.dataQuality;
        const datumOk = dq.detectedDatum && !dq.datumWarning;
        const datumColor = datumOk
            ? 'var(--success-700,#15803d)'
            : dq.datumWarning
              ? 'var(--warning-700,#a16207)'
              : 'var(--neutral-500)';
        html += `
            <div style="${S_CARD}${dq.datumWarning ? 'border:1px solid var(--warning-300);' : ''}">
                <p style="${S_TITLE}">Sistema de referencia (CRS)</p>
                <p style="font-size:10px;margin:0 0 6px;">
                    Datum detectado: <strong style="color:${datumColor};">${dq.detectedDatum ? escapeHtml(dq.detectedDatum) : 'nao informado'}</strong>
                    ${dq.datumWarning ? `<br><span style="color:var(--warning-700);">Datum nao reconhecido — verifique se as coordenadas estao em WGS84 ou SIRGAS 2000</span>` : ''}
                    ${!dq.detectedDatum ? `<br><span style="${S_MUTED}">Assumindo WGS84 (EPSG:4326). Se os dados usam outro datum (SAD 69, Corrego Alegre), as coordenadas podem estar deslocadas ate 100m.</span>` : ''}
                </p>
                <p style="font-size:10px;${S_MUTED}margin:0;">
                    ${dq.withCoordinates}/${dq.totalLocations} locais com coordenadas
                    ${dq.withElevation > 0 ? ` | ${dq.withElevation} com cota` : ''}
                </p>
                <div style="margin-top:6px;">
                    <label style="${S_LABEL}font-size:10px;">
                        Formato de data:
                        <select style="font-size:10px;padding:2px 4px;margin-left:4px;"
                                onchange="window._ingestionDecision('dateLocale',this.value)">
                            <option value="dd/mm" ${(d.dateLocale || 'dd/mm') === 'dd/mm' ? 'selected' : ''}>DD/MM/AAAA (Brasil)</option>
                            <option value="mm/dd" ${d.dateLocale === 'mm/dd' ? 'selected' : ''}>MM/DD/AAAA (EUA)</option>
                        </select>
                        ${step.detectedDateLocale ? `<span style="${S_MUTED}margin-left:4px;">(detectado: ${step.detectedDateLocale})</span>` : ''}
                    </label>
                </div>
            </div>`;
    }

    if (step.hasActionLevels?.has) {
        // D5: exibir badge com informacoes da aba de thresholds detectada
        const tsi = step.thresholdSheetInfo;
        const thresholdBadge = tsi?.detected
            ? `<span style="font-size:10px;background:var(--accent-100);color:var(--accent-700);padding:1px 6px;border-radius:10px;margin-left:6px;">${tsi.count} itens — ${escapeHtml(tsi.sheetName)}</span>`
            : '';
        html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">Limites de referencia${thresholdBadge}</p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">
                    ${step.hasActionLevels.count || ''} limites encontrados na planilha
                </p>
                <label style="${S_LABEL}">
                    <input type="checkbox" ${d.importActionLevels ? 'checked' : ''}
                           onchange="window._ingestionDecision('importActionLevels',this.checked)">
                    Importar como referencia de conformidade
                </label>
            </div>`;
    }

    // D4: preview de nao-deteccoes por estrategia
    if (step.hasNonDetects && step.stats?.nonDetect > 0) {
        const ndCount = step.stats.nonDetect;
        const total = step.stats.results;
        const pct = total > 0 ? Math.round((ndCount / total) * 100) : 0;
        // Valores aproximados por estrategia (se mdlAvg disponivel)
        const mdl = step.mdlAvg;
        const u = step.mdlUnit ? ` ${step.mdlUnit}` : '';
        const halfMdlStr =
            mdl != null ? ` <span style="color:var(--neutral-500);">(&#8776; ${(mdl / 2).toFixed(2)}${u})</span>` : '';
        const fullMdlStr =
            mdl != null ? ` <span style="color:var(--neutral-500);">(&#8776; ${mdl.toFixed(2)}${u})</span>` : '';
        html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">Preview: estrategias de nao-deteccao</p>
                <p style="font-size:10px;color:var(--neutral-800);margin:0 0 6px;">
                    ${ndCount} de ${total} resultados sao nao-deteccoes (${pct}%).
                </p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 4px;">Cada estrategia produz:</p>
                <ul style="font-size:10px;color:var(--neutral-700);margin:0;padding-left:16px;line-height:1.8;">
                    <li><strong>Valor null</strong> — ${ndCount} obs. com valor null</li>
                    <li><strong>&#189; &times; MDL</strong> — ${ndCount} obs. com metade do limite de deteccao${halfMdlStr}</li>
                    <li><strong>MDL completo</strong> — ${ndCount} obs. com limite de deteccao completo${fullMdlStr}</li>
                    <li><strong>Descartar</strong> — ${total - ndCount} obs. no total (${ndCount} descartadas)</li>
                </ul>
            </div>`;
    }

    // G4: warning de datum
    if (step.dataQuality?.datumWarning) {
        html += `
        <div style="${S_CARD}border:1px solid var(--warning-300);background:var(--warning-50,#fffbeb);">
            <p style="${S_TITLE}color:var(--warning-700,#92400e);">&#9888; Datum: ${escapeHtml(step.dataQuality.detectedDatum || 'desconhecido')}</p>
            <p style="font-size:10px;color:var(--warning-600,#d97706);margin:0;">
                Coordenadas podem ter offset significativo vs WGS84 (ex: SAD69 &#8776; 60m).
                Recomendacao: converter para SIRGAS2000/WGS84 antes de importar.
            </p>
        </div>`;
    }

    // D15: profundidade e diametro default
    if (step.dataQuality) {
        const dq = step.dataQuality;
        const missingDepth = dq.totalLocations - dq.withDepth;
        const missingDiam = dq.totalLocations - dq.withDiameter;
        if (missingDepth > 0 || missingDiam > 0) {
            html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">Dados construtivos dos pocos</p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">
                    ${missingDepth > 0 ? `${missingDepth} de ${dq.totalLocations} locais sem dado de profundidade. ` : ''}
                    ${missingDiam > 0 ? `${missingDiam} sem dado de diametro.` : ''}
                </p>
                ${
                    missingDepth > 0
                        ? `
                <label style="${S_LABEL}">Profundidade padrao (m):
                    <input type="number" value="${d.defaultWellDepth ?? 50}" min="1" max="500" step="1"
                           style="width:70px;margin-left:6px;padding:2px 4px;border:1px solid var(--border-color);border-radius:3px;"
                           onchange="window._ingestionDecision('defaultWellDepth',Number(this.value))">
                </label>`
                        : ''
                }
                ${
                    missingDiam > 0
                        ? `
                <label style="${S_LABEL}">Diametro padrao (pol):
                    <input type="number" value="${d.defaultWellDiameter ?? 4}" min="1" max="24" step="0.5"
                           style="width:70px;margin-left:6px;padding:2px 4px;border:1px solid var(--border-color);border-radius:3px;"
                           onchange="window._ingestionDecision('defaultWellDiameter',Number(this.value))">
                </label>`
                        : ''
                }
                <p style="font-size:9px;${S_MUTED}margin:4px 0 0;">Pontos sem dados recebem tag <code>is_depth_available: no</code></p>
            </div>`;
        }
    }

    // D16: pontos sem coordenadas
    if (step.dataQuality) {
        const dq = step.dataQuality;
        const missingCoords = dq.totalLocations - dq.withCoordinates;
        if (missingCoords > 0) {
            html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">${missingCoords} de ${dq.totalLocations} locais sem coordenadas</p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">Como posicionar no modelo 3D?</p>
                <label style="${S_LABEL}">
                    <input type="radio" name="missingcoords" value="origin" ${d.missingCoordsStrategy === 'origin' ? 'checked' : ''}
                           onchange="window._ingestionDecision('missingCoordsStrategy','origin')">
                    Empilhar na origem (0, 0, 0)
                </label>
                <label style="${S_LABEL}">
                    <input type="radio" name="missingcoords" value="grid" ${d.missingCoordsStrategy === 'grid' ? 'checked' : ''}
                           onchange="window._ingestionDecision('missingCoordsStrategy','grid')">
                    Distribuir em grade ao redor do centroide
                </label>
                <label style="${S_LABEL}">
                    <input type="radio" name="missingcoords" value="exclude" ${d.missingCoordsStrategy === 'exclude' ? 'checked' : ''}
                           onchange="window._ingestionDecision('missingCoordsStrategy','exclude')">
                    Excluir do modelo (nao importar)
                </label>
                <p style="font-size:9px;${S_MUTED}margin:4px 0 0;">Pontos importados recebem tag <code>is_coordinates_available: no</code></p>
            </div>`;
        }
    }

    // D20: cota default
    if (step.dataQuality) {
        const dq = step.dataQuality;
        const missingElev = dq.totalLocations - dq.withElevation;
        if (missingElev > 0) {
            html += `
            <div style="${S_CARD}">
                <p style="${S_TITLE}">${missingElev} de ${dq.totalLocations} locais sem cota topografica</p>
                <label style="${S_LABEL}">Cota padrao (m):
                    <input type="number" value="${d.defaultElevation ?? 0}" step="1"
                           style="width:80px;margin-left:6px;padding:2px 4px;border:1px solid var(--border-color);border-radius:3px;"
                           onchange="window._ingestionDecision('defaultElevation',Number(this.value))">
                    <span style="${S_MUTED}">usar 0 se desconhecido</span>
                </label>
                <p style="font-size:9px;${S_MUTED}margin:4px 0 0;">Pontos sem cota recebem tag <code>is_z_available: no</code></p>
            </div>`;
        }
    }

    // D17: boundary automatica
    if (step.dataQuality && step.dataQuality.withCoordinates >= 3) {
        html += `
        <div style="${S_CARD}">
            <p style="${S_TITLE}">Limite da area de estudo</p>
            <label style="${S_LABEL}">
                <input type="checkbox" ${d.generateBoundary ? 'checked' : ''}
                       onchange="window._ingestionDecision('generateBoundary',this.checked)">
                Gerar contorno automaticamente (convex hull dos pocos)
            </label>
        </div>`;
    }

    // D18: terreno automatico
    if (step.dataQuality && step.dataQuality.withCoordinates >= 3) {
        html += `
        <div style="${S_CARD}">
            <p style="${S_TITLE}">Superficie do terreno</p>
            <label style="${S_LABEL}">
                <input type="checkbox" ${d.generateTerrain ? 'checked' : ''}
                       onchange="window._ingestionDecision('generateTerrain',this.checked);renderIngestionStep()">
                Gerar terreno automaticamente (elevacao SRTM)
            </label>
            ${
                d.generateTerrain
                    ? `
            <label style="${S_LABEL};margin-left:20px;">
                <input type="checkbox" ${d.generateAerial ? 'checked' : ''}
                       onchange="window._ingestionDecision('generateAerial',this.checked)">
                Aplicar imagem de satelite ao terreno (Sentinel-2)
            </label>`
                    : ''
            }
        </div>`;
    }

    html += '</div>';
    return html;
}

function renderReviewConfirm(step) {
    const d = step.decisions || {};
    // D6: selecao de estrategia de duplicatas
    const dupBlock = step.duplicateWarning
        ? `
        <div style="${S_CARD}border:1px solid var(--warning-300);">
            <p style="${S_TITLE}font-size:11px;color:var(--warning-700);">
                ${step.duplicateWarning.count} elementos ja existem no modelo
                <span style="${S_MUTED}font-weight:400;"> (ex: ${step.duplicateWarning.examples.map(escapeHtml).join(', ')})</span>
            </p>
            <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">Como tratar duplicatas?</p>
            <label style="${S_LABEL}">
                <input type="radio" name="dupstrat" value="replace" ${(d.duplicateStrategy || 'replace') === 'replace' ? 'checked' : ''}
                       onchange="window._ingestionDecision('duplicateStrategy','replace')">
                Substituir elementos existentes pelos importados <span style="${S_MUTED}">(recomendado)</span>
            </label>
            <label style="${S_LABEL}">
                <input type="radio" name="dupstrat" value="append" ${d.duplicateStrategy === 'append' ? 'checked' : ''}
                       onchange="window._ingestionDecision('duplicateStrategy','append')">
                Adicionar mesmo se duplicado
            </label>
            <label style="${S_LABEL}">
                <input type="radio" name="dupstrat" value="skip" ${d.duplicateStrategy === 'skip' ? 'checked' : ''}
                       onchange="window._ingestionDecision('duplicateStrategy','skip')">
                Ignorar elementos duplicados
            </label>
        </div>`
        : '';

    return `
        <div style="margin-top:4px;">
            ${dupBlock}
            <div style="${S_CARD}font-size:11px;line-height:1.6;">
                ${step.summary.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}
            </div>
            ${
                step.warnings.length > 0
                    ? `
            <details style="margin-top:6px;">
                <summary style="font-size:11px;color:var(--warning);cursor:pointer;font-weight:500;">
                    ${step.warnings.length} warning(s)
                </summary>
                <ul style="font-size:10px;${S_MUTED}padding-left:16px;max-height:150px;overflow-y:auto;">
                    ${step.warnings
                        .slice(0, 20)
                        .map((w) => `<li>${escapeHtml(w.message)}</li>`)
                        .join('')}
                    ${step.warnings.length > 20 ? `<li>... e mais ${step.warnings.length - 20}</li>` : ''}
                </ul>
            </details>`
                    : ''
            }
            ${
                step.errors.length > 0
                    ? `
            <div style="margin-top:6px;padding:8px;background:rgba(184,68,68,0.1);border:1px solid var(--error);border-radius:6px;">
                <p style="font-size:11px;color:var(--error);margin:0;font-weight:500;">${step.errors.length} erro(s) — corrigir antes de ingerir</p>
                <ul style="font-size:10px;${S_MUTED}padding-left:16px;">
                    ${step.errors
                        .slice(0, 10)
                        .map((e) => `<li>${escapeHtml(e.message)}</li>`)
                        .join('')}
                </ul>
            </div>`
                    : ''
            }
        </div>
    `;
}

// ----------------------------------------------------------------
// D9: PROGRESS BAR
// ----------------------------------------------------------------

/**
 * D9: Renderiza barra de progresso de ingestao no modal.
 * Exibe feedback visual durante processamento de grandes datasets.
 */
function _renderIngestionProgressBar() {
    const container = document.getElementById('ingestion-content');
    if (!container) return;
    container.innerHTML = `
        <div style="padding:24px;text-align:center;">
            <p style="font-size:13px;color:var(--neutral-800);margin:0 0 12px;font-weight:500;">Ingerindo dados...</p>
            <div style="height:12px;background:var(--neutral-200);border-radius:6px;overflow:hidden;margin-bottom:8px;">
                <div class="ingestion-progress-bar"
                     style="height:100%;width:0%;background:var(--accent-500);border-radius:6px;transition:width .2s;font-size:10px;color:#fff;display:flex;align-items:center;justify-content:center;min-width:30px;">
                    0%
                </div>
            </div>
            <p style="font-size:10px;color:var(--neutral-500);">Aguarde...</p>
        </div>
    `;
}

// ----------------------------------------------------------------
// D7/D13: VALIDATION TABLE + QAQC
// ----------------------------------------------------------------

/**
 * D7: Renderiza tabela de validacao pos-importacao no modal.
 * Compara contagens esperadas (parser) com contagens reais pos-import.
 * D13: Renderiza aba QAQC com estatisticas por parametro.
 *
 * @param {{ rows: Array, qaqcRows: Array }} data
 */
function renderIngestionValidationTable(data) {
    const container = document.getElementById('ingestion-content');
    if (!container) return;

    // Calcula status geral
    let allMatch = true;
    const rowsHtml = data.rows
        .map((row) => {
            const exp = row.expected;
            const imp = row.imported;
            let match = false;
            if (exp === '?' || (exp === 0 && imp === 0)) {
                match = true;
            } else if (typeof exp === 'number' && typeof imp === 'number') {
                // Tolerance de 2% para observacoes
                const tol = row.entity === 'Observations' ? 0.02 : 0;
                match = Math.abs(imp - exp) <= Math.max(1, Math.ceil(exp * tol));
            } else {
                match = String(imp) === String(exp);
            }
            if (!match && exp !== '?' && !(exp === 0 && imp === 0)) allMatch = false;
            const icon = match ? '&#10003;' : '&#10007;';
            const color = match ? 'var(--success)' : 'var(--error)';
            return `<tr style="${S_TABLE_ROW}">
            <td style="padding:4px 6px;font-weight:500;">${escapeHtml(row.entity)}</td>
            <td style="padding:4px 6px;${S_MUTED}">${escapeHtml(row.sheet)}</td>
            <td style="padding:4px 6px;text-align:right;">${row.expected}</td>
            <td style="padding:4px 6px;text-align:right;">${row.imported}</td>
            <td style="padding:4px 6px;text-align:center;font-weight:700;color:${color};">${icon}</td>
        </tr>`;
        })
        .join('');

    const statusColor = allMatch ? 'var(--success)' : 'var(--error)';
    const statusText = allMatch ? 'OK — todos os registros importados' : 'Divergencia detectada — verifique os dados';

    // D13: tabela QAQC
    let qaqcHtml = '';
    if (data.qaqcRows && data.qaqcRows.length > 0) {
        qaqcHtml = `
        <details style="margin-top:8px;" open>
            <summary data-testid="qaqc-tab" style="font-size:11px;font-weight:600;color:var(--neutral-800);cursor:pointer;padding:4px 0;">
                QAQC por parametro (top ${data.qaqcRows.length})
            </summary>
            <div style="overflow-x:auto;margin-top:4px;">
            <table style="width:100%;font-size:10px;border-collapse:collapse;color:var(--neutral-800);">
                <thead>
                    <tr style="${S_TABLE_HEADER}">
                        <th style="text-align:left;padding:3px 6px;">Parametro</th>
                        <th style="text-align:right;padding:3px 6px;">N obs</th>
                        <th style="text-align:right;padding:3px 6px;">N &lt;LQ (%)</th>
                        <th style="text-align:right;padding:3px 6px;">Media det.</th>
                        <th style="text-align:right;padding:3px 6px;">Maximo</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.qaqcRows
                        .map(
                            (r) => `
                    <tr data-testid="qaqc-param-row" style="${S_TABLE_ROW}">
                        <td style="padding:3px 6px;" title="${escapeHtml(r.parameterId)}">${escapeHtml(r.parameterName.slice(0, 22))}</td>
                        <td style="padding:3px 6px;text-align:right;">${r.nObs}</td>
                        <td style="padding:3px 6px;text-align:right;">${r.nND} (${r.pctND}%)</td>
                        <td style="padding:3px 6px;text-align:right;">${r.meanDet != null ? r.meanDet.toFixed(2) : '—'}</td>
                        <td style="padding:3px 6px;text-align:right;">${r.maxDet != null ? r.maxDet.toFixed(2) : '—'}</td>
                    </tr>`,
                        )
                        .join('')}
                </tbody>
            </table>
            </div>
        </details>`;
    }

    container.innerHTML = `
        <div style="padding:12px 4px;">
            <div style="padding:8px 10px;border-radius:6px;background:${allMatch ? 'rgba(45,168,78,0.1)' : 'rgba(184,68,68,0.1)'};border:1px solid ${statusColor};margin-bottom:10px;">
                <span style="font-size:12px;font-weight:700;color:${statusColor};">${statusText}</span>
            </div>
            <div data-testid="ingestion-validation-table" style="${S_CARD}">
                <p style="${S_TITLE}font-size:11px;">Contagens de importacao</p>
                <table style="width:100%;font-size:11px;border-collapse:collapse;color:var(--neutral-800);">
                    <thead>
                        <tr style="${S_TABLE_HEADER}">
                            <th style="text-align:left;padding:4px 6px;">Entidade</th>
                            <th style="text-align:left;padding:4px 6px;">Origem</th>
                            <th style="text-align:right;padding:4px 6px;">Esperado</th>
                            <th style="text-align:right;padding:4px 6px;">Importado</th>
                            <th style="text-align:center;padding:4px 6px;">Status</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
            ${qaqcHtml}
            <div style="display:flex;justify-content:flex-end;margin-top:12px;padding-top:10px;border-top:1px solid var(--neutral-200);">
                <button class="btn btn-primary" onclick="window.handleCloseIngestionModal(); if(window.updateAllUI) window.updateAllUI();">Fechar</button>
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function collectCurrentDecisions() {
    return { ..._wizardState?.decisions };
}

/**
 * Helper global para radio/checkbox decisions no wizard.
 * Whitelist de campos validos para prevenir injecao via window._ingestionDecision.
 * IMPORTANTE: ao adicionar novo campo de decisao ao wizard, incluir aqui tambem.
 */
const VALID_DECISIONS = new Set([
    // Environmental
    'nonDetectStrategy',
    'campaignStrategy',
    'campaignNames',
    'multilevelStrategy',
    'coordinateOrigin',
    'importActionLevels',
    'importThresholds',
    'clearStrategy',
    'exportBeforeClear',
    'applyOrigin',
    'suggestedOrigin',
    'duplicateStrategy',
    'defaultWellDepth',
    'defaultWellDiameter',
    'missingCoordsStrategy',
    'generateBoundary',
    'generateTerrain',
    'generateAerial',
    'defaultElevation',
    // OHS
    'gheStrategy',
    'sampleTypeStrategy',
    'lgpdStrategy',
    'oelSource',
    'importAptitude',
    // Shared
    'formatConfirmed',
    'columnOverrides',
    'ambiguityResolutions',
    'domain',
]);

export function _ingestionDecision(field, value) {
    if (!_wizardState) return;
    if (!VALID_DECISIONS.has(field)) {
        console.warn('[ecbyts] Rejected invalid decision field:', field);
        return;
    }
    _wizardState.decisions[field] = value;
}

// ----------------------------------------------------------------
// TEMPLATE DOWNLOAD
// ----------------------------------------------------------------

const TEMPLATES = {
    // ================================================================
    // AMBIENTAL — Environmental data formats
    // ================================================================
    'edd-r2': {
        group: 'env',
        filename: 'template_epa_edd_r2.csv',
        label: 'EDD R2',
        csv: [
            'sys_loc_code,x_coord,y_coord,loc_type,sys_sample_code,sample_date,sample_matrix_code,chemical_name,cas_rn,result_value,result_unit,detect_flag,analytical_method,reporting_detection_limit',
            'MW-01,583960,4507230,MW,MW-01-20250115,01/15/2025,WG,Benzene,71-43-2,5.2,ug/L,Y,SW846 8260B,1.0',
            'MW-02,583985,4507245,MW,MW-02-20250115,01/15/2025,WG,Benzene,71-43-2,12.8,ug/L,Y,SW846 8260B,1.0',
        ],
    },
    'edd-r3': {
        group: 'env',
        filename: 'template_epa_edd_r3.csv',
        label: 'EDD R3',
        csv: [
            'sys_loc_code,latitude,longitude,loc_type,sys_sample_code,sample_date,matrix,chemical_name,cas_rn,result_value,result_unit,detect_flag,method_name,reporting_limit,task_code',
            'MW-01,39.9526,-75.1652,MW,MW-01-20250115,2025-01-15,WG,Benzene,71-43-2,5.2,ug/L,Y,EPA 8260,1.0,GWMON',
            'MW-02,39.9530,-75.1660,MW,MW-02-20250115,2025-01-15,WG,Lead,7439-92-1,18.5,ug/L,Y,EPA 6010,5.0,GWMON',
        ],
    },
    'edd-r5': {
        group: 'env',
        filename: 'template_epa_edd_r5.csv',
        label: 'EDD R5',
        csv: [
            'sys_loc_code,latitude,longitude,loc_type_code,sys_sample_code,sample_date,matrix_code,param_name,cas_rn,report_result_value,result_unit,detect_flag,analysis_method,method_detection_limit,lab_name',
            'MW-01,41.8781,-87.6298,MW,MW-01-20250115,2025-01-15,WG,Benzene,71-43-2,5.2,ug/L,Y,8260B,0.5,TestLab Inc',
            'MW-02,41.8785,-87.6305,MW,MW-02-20250115,2025-01-15,SO,Arsenic,7440-38-2,22.3,mg/kg,Y,6010B,2.0,TestLab Inc',
        ],
    },
    sedd: {
        group: 'env',
        filename: 'template_sedd.csv',
        label: 'SEDD',
        csv: [
            'sys_loc_code,latitude,longitude,loc_type_code,sys_sample_code,sample_date,matrix_code,analyte_name,cas_rn,result_value,result_unit,detect_flag,analysis_method,mdl,pql,lab_sample_id,lab_name,stage',
            'MW-01,40.7128,-74.0060,MW,MW-01-20250115,2025-01-15,WG,Benzene,71-43-2,5.2,ug/L,Y,EPA 8260,0.3,1.0,LS-001,EnviroLab,Final',
            'MW-02,40.7135,-74.0070,MW,MW-02-20250115,2025-01-15,WG,Toluene,108-88-3,,ug/L,N,EPA 8260,0.5,1.0,LS-002,EnviroLab,Final',
        ],
    },
    'edd-br': {
        group: 'env',
        filename: 'template_edd_br.csv',
        label: 'EDD-BR',
        csv: [
            'cod_ponto,latitude,longitude,tipo_ponto,cod_amostra,data_coleta,matriz,parametro,cas,resultado,unidade,detectado,metodo,limite_quantificacao',
            'PM-01,-23.5505,-46.6333,PM,PM-01-20250115,2025-01-15,AS,Benzeno,71-43-2,5.2,ug/L,S,EPA 8260,1.0',
            'PM-02,-23.5510,-46.6340,PM,PM-02-20250115,2025-01-15,AS,Benzeno,71-43-2,12.8,ug/L,S,EPA 8260,1.0',
        ],
    },
    wqx: {
        group: 'env',
        filename: 'template_wqx.csv',
        label: 'WQX',
        csv: [
            'OrganizationIdentifier,MonitoringLocationIdentifier,MonitoringLocationName,MonitoringLocationTypeName,LatitudeMeasure,LongitudeMeasure,ActivityIdentifier,ActivityStartDate,ActivityMediaName,CharacteristicName,ResultMeasureValue,ResultMeasure/MeasureUnitCode,ResultDetectionConditionText,AnalyticalMethodIdentifier',
            'TESTORG,SITE-01,River Upstream,River/Stream,-23.5505,-46.6333,ACT-001,2025-01-15,Water,Dissolved oxygen (DO),7.2,mg/L,,EPA 360.1',
            'TESTORG,SITE-02,Lake Center,Lake,-23.5510,-46.6340,ACT-002,2025-01-15,Water,pH,6.8,None,,EPA 150.1',
        ],
    },
    sdwis: {
        group: 'env',
        filename: 'template_sdwis.csv',
        label: 'SDWIS',
        csv: [
            'PWS_ID,PWS_Name,Facility_ID,Sample_Point_ID,Sample_ID,Collection_Date,Analyte_Code,Analyte_Name,Concentration,Unit,MCL,Method,Compliance_Status',
            'TX1234567,City Water Supply,FAC-01,SP-01,S-20250115,2025-01-15,1005,Arsenic,8.5,ug/L,10,EPA 200.8,Compliant',
            'TX1234567,City Water Supply,FAC-01,SP-02,S-20250116,2025-01-16,2987,Lead,12.3,ug/L,15,EPA 200.8,Compliant',
        ],
    },
    equis: {
        group: 'env',
        filename: 'template_equis.csv',
        label: 'EQuIS',
        csv: [
            'sys_loc_code,loc_name,loc_type,latitude,longitude,sys_sample_code,sample_name,sample_date,start_depth,end_depth,matrix_code,analytic_method,chemical_name,cas_rn,result_value,result_unit,detect_flag,reporting_detection_limit,lab_qualifiers,lab_name_code',
            'MW-01,Monitor Well 1,MW,39.9526,-75.1652,MW01-20250115,MW-01 GW,2025-01-15,3.0,3.5,WG,SW8260B,Benzene,71-43-2,5.2,ug/L,Y,1.0,,TestLab',
            'SB-01,Soil Boring 1,SB,39.9530,-75.1660,SB01-20250115,SB-01 5ft,2025-01-15,1.0,2.0,SO,SW8260B,Toluene,108-88-3,0.85,mg/kg,Y,0.1,,TestLab',
        ],
    },
    esdat: {
        group: 'env',
        filename: 'template_esdat.csv',
        label: 'ESdat',
        csv: [
            'Location_ID,Location_Name,Location_Type,Easting,Northing,Coord_System,Sample_ID,Sample_Date,Matrix,Depth_From,Depth_To,ChemName,CAS_Number,Result,Result_Unit,LOR,Method_Type,Total_or_Filtered,Lab_Name',
            'BH-01,Borehole 1,Bore,321450,6248900,MGA56,BH01-20250115,2025-01-15,Soil,0.5,1.0,Benzene,71-43-2,0.45,mg/kg,0.05,8260B,Total,ALS',
            'MW-01,Monitor Well 1,Well,321455,6248910,MGA56,MW01-20250115,2025-01-15,Water,3.0,3.5,Benzene,71-43-2,8.3,ug/L,1.0,8260B,Total,ALS',
        ],
    },
    erpims: {
        group: 'env',
        filename: 'template_erpims.csv',
        label: 'ERPIMS',
        csv: [
            'installation_name,operable_unit,site_name,location_id,location_type,latitude,longitude,sample_id,sample_date,matrix,depth_top,depth_bottom,analyte_name,cas_number,result,units,detect_flag,method,mdl,pql',
            'Fort Example,OU-1,Landfill Area,MW-01,MW,35.1234,-79.5678,MW01-20250115,2025-01-15,WG,3.0,3.5,TCE,79-01-6,45.2,ug/L,Y,8260B,0.5,1.0',
            'Fort Example,OU-1,Landfill Area,MW-02,MW,35.1240,-79.5685,MW02-20250115,2025-01-15,WG,3.0,3.5,PCE,127-18-4,,ug/L,N,8260B,0.5,1.0',
        ],
    },
    adam: {
        group: 'env',
        filename: 'template_adam.csv',
        label: 'ADaM',
        csv: [
            'project_code,site_id,location_id,sample_id,sample_date,matrix,fraction,prep_method,analytical_method,cas_number,analyte,result_value,result_qualifier,result_unit,mdl,rl,dilution_factor,lab_id,batch_id',
            'PROJ-001,SITE-A,MW-01,MW01-20250115,2025-01-15,Water,Dissolved,3510C,8260B,71-43-2,Benzene,5.2,,ug/L,0.3,1.0,1,LAB-001,B-2025-001',
            'PROJ-001,SITE-A,MW-01,MW01-20250115,2025-01-15,Water,Dissolved,3510C,8260B,108-88-3,Toluene,,U,ug/L,0.5,1.0,1,LAB-001,B-2025-001',
        ],
    },
    lims: {
        group: 'env',
        filename: 'template_lims_export.csv',
        label: 'LIMS',
        csv: [
            'lab_sample_id,client_sample_id,client_name,project_id,sample_date,received_date,matrix,prep_method,analytical_method,analyte,cas_number,result,qualifier,units,mdl,rl,dilution,batch_id,analyst,analysis_date',
            'LS-20250115-001,MW-01-GW,EnviroCo,PROJ-001,2025-01-15,2025-01-17,Water,3510C,SW8260B,Benzene,71-43-2,5.2,,ug/L,0.3,1.0,1,BATCH-001,JSmith,2025-01-20',
            'LS-20250115-001,MW-01-GW,EnviroCo,PROJ-001,2025-01-15,2025-01-17,Water,3510C,SW8260B,Toluene,108-88-3,,U,ug/L,0.5,1.0,1,BATCH-001,JSmith,2025-01-20',
        ],
    },
    sensorthings: {
        group: 'env',
        filename: 'template_ogc_sensorthings.csv',
        label: 'SensorThings',
        csv: [
            'Thing_name,Thing_description,Location_name,Location_latitude,Location_longitude,Datastream_name,ObservedProperty_name,ObservedProperty_definition,Sensor_name,phenomenonTime,result,resultQuality,unitOfMeasurement_name,unitOfMeasurement_symbol',
            'Station-01,Groundwater monitoring well,Site Alpha,-23.5505,-46.6333,GW Level,Water Table Elevation,http://vocabulary.odm2.org/variable/waterTableElevation,Pressure Transducer,2025-01-15T10:00:00Z,523.45,good,m,m',
            'Station-01,Groundwater monitoring well,Site Alpha,-23.5505,-46.6333,GW Temp,Water Temperature,http://vocabulary.odm2.org/variable/temperature,Thermistor,2025-01-15T10:00:00Z,22.3,good,Celsius,degC',
        ],
    },
    waterml: {
        group: 'env',
        filename: 'template_waterml.csv',
        label: 'WaterML',
        csv: [
            'site_code,site_name,latitude,longitude,variable_code,variable_name,unit_name,unit_abbreviation,sample_medium,value_type,date_time,value,quality_control_level,method_description,source_organization',
            'USGS-01234567,Rio Tiete Upstream,-23.5505,-46.6333,00060,Streamflow,cubic feet per second,cfs,Surface Water,Derived Value,2025-01-15T12:00:00,125.3,Quality controlled,Acoustic Doppler,USGS',
            'USGS-01234567,Rio Tiete Upstream,-23.5505,-46.6333,00010,Temperature,degrees Celsius,degC,Surface Water,Field Observation,2025-01-15T12:00:00,22.1,Quality controlled,YSI EXO2 Sonde,USGS',
        ],
    },
    geosciml: {
        group: 'env',
        filename: 'template_geosciml.csv',
        label: 'GeoSciML',
        csv: [
            'borehole_id,borehole_name,latitude,longitude,elevation_m,total_depth_m,interval_top_m,interval_bottom_m,lithology_code,lithology_description,geological_unit,age_era,color,grain_size,moisture,weathering_grade',
            'BH-01,Borehole Alpha,-23.5505,-46.6333,750.2,30.0,0.0,2.0,FILL,Anthropic fill,Quaternary deposits,Quaternary,Brown,Mixed,Moist,W5',
            'BH-01,Borehole Alpha,-23.5505,-46.6333,750.2,30.0,2.0,8.5,CLAY,Stiff brown clay,Sao Paulo Formation,Tertiary,Reddish brown,Clay,Moist,W3',
        ],
    },
    ecbyts: {
        group: 'env',
        filename: 'template_ecbyts.csv',
        label: 'ecbyts',
        csv: [
            'elementName,family,latitude,longitude,sampleCode,sampleDate,chemicalName,casNumber,resultValue,resultUnit,detectFlag',
            'MW-01,well,-23.5505,-46.6333,MW-01-20250115,2025-01-15,Benzene,71-43-2,5.2,ug/L,Y',
            'MW-02,well,-23.5510,-46.6340,MW-02-20250115,2025-01-15,Benzene,71-43-2,12.8,ug/L,Y',
        ],
    },
    // ================================================================
    // OCUPACIONAL — OHS data formats
    // ================================================================
    'ohs-aiha': {
        group: 'ohs',
        filename: 'template_ohs_aiha.csv',
        label: 'AIHA',
        csv: [
            'worker_id,worker_name,ghe,job_title,department,agent_name,cas_rn,twa_8h,stel,oel,sample_type,exposure_route,ppe_status,sample_date',
            'W001,Joao Silva,GHE-01,Operador,Producao,Benzene,71-43-2,2.5,,1.0,personal,inhalation,full,2025-01-15',
            'A001,,GHE-02,,Manutencao,Noise,,92,,85,area,noise,,2025-01-15',
        ],
    },
    'ohs-doehrs': {
        group: 'ohs',
        filename: 'template_ohs_doehrs.csv',
        label: 'DOEHRS',
        csv: [
            'ssn_last4,ghe_code,agent_name,cas_rn,result,result_unit,oel,sample_type,exposure_route,duration_hours,sample_date,installation',
            '1234,GHE-A01,Benzene,71-43-2,0.8,ppm,1.0,personal,inhalation,8,2025-01-15,Fort Bragg',
            '9012,GHE-B02,Noise,,88,dBA,85,area,noise,8,2025-01-15,Fort Bragg',
        ],
    },
    'ohs-oel': {
        group: 'ohs',
        filename: 'template_oel_edd.csv',
        label: 'OEL-EDD',
        csv: [
            'cas_rn,agent_name,tlv_twa,tlv_stel,tlv_ceiling,tlv_unit,pel_twa,pel_unit,rel_twa,rel_stel,rel_unit,oeb_band,source,year,notation',
            '71-43-2,Benzene,0.5,2.5,,ppm,1.0,ppm,0.1,,ppm,4,ACGIH/OSHA/NIOSH,2024,A1 Skin',
            '108-88-3,Toluene,20,,,,200,ppm,100,150,ppm,2,ACGIH/OSHA/NIOSH,2024,',
            '7440-38-2,Arsenic,0.01,,,mg/m3,0.01,mg/m3,0.002,,mg/m3,5,ACGIH/OSHA/NIOSH,2024,A1',
        ],
    },
    'ohs-sds': {
        group: 'ohs',
        filename: 'template_sds_ghs.csv',
        label: 'SDS/GHS',
        csv: [
            'product_name,cas_rn,supplier,ghs_classification,hazard_statements,precautionary_statements,signal_word,pictograms,oel_twa,oel_stel,oel_unit,flash_point_c,boiling_point_c,ld50_oral_mg_kg,lc50_inhalation_mg_L,first_aid_inhalation,ppe_required',
            'Benzene,71-43-2,LabChem Inc,Flam. Liq. 2; Carc. 1A; Muta. 1B,H225 H350 H340,P201 P210 P280,Danger,GHS02 GHS08,0.5,,ppm,−11,80.1,930,13.7,Move to fresh air,Gloves + respiratory protection',
            'Toluene,108-88-3,SigmaAldrich,Flam. Liq. 2; Repr. 2,H225 H361d,P210 P280,Danger,GHS02 GHS08,20,,ppm,4,111,636,12.5,Move to fresh air,Chemical splash goggles + gloves',
        ],
    },
    'ohs-oeb': {
        group: 'ohs',
        filename: 'template_oeb.csv',
        label: 'OEB',
        csv: [
            'compound_name,cas_rn,oeb_band,oel_range_low,oel_range_high,oel_unit,basis,toxicity_endpoints,containment_required,ppe_minimum,source',
            'Compound A,12345-67-8,1,1000,,ug/m3,Low acute toxicity,LD50 > 2000 mg/kg,Standard ventilation,Safety glasses,Internal assessment',
            'Compound B,98765-43-2,4,1,10,ug/m3,Reproductive toxicant,NOAEL 0.5 mg/kg/day,Isolator or closed system,Full suit + SCBA,Internal assessment',
            'Compound C,11111-22-3,5,,1,ug/m3,Potent carcinogen,Genotoxic,Negative pressure isolator,Full containment,Internal assessment',
        ],
    },
    'ohs-nr15': {
        group: 'ohs',
        filename: 'template_ohs_nr15.csv',
        label: 'NR-15',
        csv: [
            'matricula,nome_funcionario,cargo,setor,agente,nivel,limite_tolerancia,grau_insalubridade,epi,data_medicao',
            '12345,Joao Silva,Operador,Producao,Ruido Continuo,92 dBA,85 dBA,medio,protetor auricular,2025-01-15',
            '12346,Maria Santos,Tecnico,Laboratorio,Benzeno,2.5 mg/m3,1.0 mg/m3,maximo,mascara PFF2,2025-01-15',
        ],
    },
    'ohs-ppra': {
        group: 'ohs',
        filename: 'template_ohs_ppra_pgr.csv',
        label: 'PPRA/PGR',
        csv: [
            'setor,ghe,risco,agente,fonte,probabilidade,severidade,nivel_risco,medida_controle,responsavel',
            'Producao,GHE-01,Quimico,Benzeno,Tanque armazenamento,3,4,12,Ventilacao + EPI,Eng. Seguranca',
            'Manutencao,GHE-02,Fisico,Ruido,Compressor,4,3,12,Protetor auricular,Eng. Seguranca',
        ],
    },
    'ohs-pcmso': {
        group: 'ohs',
        filename: 'template_ohs_pcmso.csv',
        label: 'PCMSO',
        csv: [
            'matricula,nome_funcionario,cargo,setor,tipo_exame,data_exame,resultado,apto,observacao',
            '12345,Joao Silva,Operador,Producao,admissional,2025-01-10,normal,sim,',
            '12346,Maria Santos,Tecnico,Laboratorio,periodico,2025-01-15,alterado,sim,Acompanhar hemograma',
        ],
    },
    'ohs-bio': {
        group: 'ohs',
        filename: 'template_ohs_bei.csv',
        label: 'BEI/IBMP',
        csv: [
            'patient_id,patient_name,specimen,analyte,cas_rn,result,result_unit,bei,method,sample_date,ghe',
            'W001,Joao Silva,urine,Hippuric Acid,,1.2,g/g creat.,1.6,HPLC,2025-01-15,GHE-01',
            'W001,Joao Silva,blood,Lead,7439-92-1,18,ug/dL,30,AAS,2025-01-15,GHE-01',
        ],
    },
    'ohs-icd': {
        group: 'ohs',
        filename: 'template_icd10_icd11.csv',
        label: 'ICD-10/11',
        csv: [
            'patient_id,patient_name,icd_version,icd_code,diagnosis_description,diagnosis_date,diagnosis_type,severity,body_system,occupational_related,causal_agent,department,physician',
            'W001,Joao Silva,ICD-10,J68.0,Chemical bronchitis due to fumes,2025-01-15,Primary,Moderate,Respiratory,Yes,Chlorine gas,Producao,Dr. Santos',
            'W002,Maria Santos,ICD-10,H83.3,Noise-induced hearing loss,2025-02-10,Primary,Mild,Ear,Yes,Occupational noise >85dBA,Manutencao,Dr. Oliveira',
        ],
    },
    'ohs-chad': {
        group: 'ohs',
        filename: 'template_chad.csv',
        label: 'CHAD',
        csv: [
            'person_id,age,sex,activity_code,activity_description,location_code,location_description,start_time,duration_minutes,microenvironment,ventilation,temperature_c,relative_humidity_pct,co_exposure_ppm,pm25_ug_m3',
            'P001,35,M,12100,Work - Manufacturing,31000,Industrial building,08:00,480,Indoor-industrial,Mechanical,25,60,2.1,45.3',
            'P002,42,F,12200,Work - Office,32000,Commercial building,09:00,480,Indoor-office,HVAC,23,45,0.5,12.1',
        ],
    },
    // ================================================================
    // CLASSIFICACAO — Reference/lookup tables
    // ================================================================
    'ref-soc': {
        group: 'ref',
        filename: 'template_soc_codes.csv',
        label: 'SOC',
        csv: [
            'soc_code,soc_title,major_group,minor_group,broad_occupation,detailed_occupation,cbo_equivalent,typical_exposure_agents,typical_oeb',
            '51-9011,Chemical Equipment Operators,51-0000 Production,51-9000 Other Production,51-9010 Chemical Processing,51-9011 Chemical Equipment Operators and Tenders,8116-05,Solvents/Acids/Bases,2-3',
            '47-2152,Plumbers,47-0000 Construction,47-2000 Construction Trades,47-2150 Pipelayers and Plumbers,47-2152 Plumbers Pipefitters and Steamfitters,7241-05,Lead/Asbestos/Solvents,2-4',
        ],
    },
    'ref-naics': {
        group: 'ref',
        filename: 'template_naics_sic.csv',
        label: 'NAICS/SIC',
        csv: [
            'naics_code,naics_title,sic_code,sic_title,cnae_code,cnae_title,risk_level,typical_hazards,osha_recordable_rate,fatality_rate_per_100k',
            '324110,Petroleum Refineries,2911,Petroleum Refining,19210,Fabricacao de produtos do refino de petroleo,High,Fire/Explosion/H2S/Benzene/VOC,2.1,3.5',
            '327310,Cement Manufacturing,3241,Cement Hydraulic,23427,Fabricacao de cimento,High,Silica/Noise/Heat/Dust,3.8,2.1',
        ],
    },
    'ref-tlv': {
        group: 'ref',
        filename: 'template_tlv_pel_rel.csv',
        label: 'TLV/PEL/REL',
        csv: [
            'cas_rn,substance,acgih_tlv_twa,acgih_tlv_stel,acgih_tlv_unit,acgih_notation,osha_pel_twa,osha_pel_unit,niosh_rel_twa,niosh_rel_stel,niosh_rel_unit,niosh_idlh,nr15_lt,nr15_unit,nr15_grau',
            '71-43-2,Benzene,0.5,2.5,ppm,A1 Skin,1,ppm,0.1,,ppm,500,1.0,ppm,maximo',
            '7439-92-1,Lead,0.05,,mg/m3,A3,0.05,mg/m3,0.05,,mg/m3,100,0.1,mg/m3,medio',
            '14808-60-7,Silica (quartz),0.025,,mg/m3,A2,0.05,mg/m3,0.05,,mg/m3,25,0.05,mg/m3,maximo',
        ],
    },
    // ================================================================
    // GHG / ESG — Greenhouse Gas & Sustainability
    // ================================================================
    'ghg-protocol': {
        group: 'ghg',
        filename: 'template_ghg_protocol.csv',
        label: 'GHG Protocol',
        csv: [
            'ano,organizacao,setor,escopo,categoria,fonte_emissao,combustivel_atividade,quantidade,unidade,fator_emissao_co2,fator_emissao_ch4,fator_emissao_n2o,emissao_co2_t,emissao_ch4_t,emissao_n2o_t,emissao_co2e_t,metodo_calculo,fonte_fe',
            '2025,Empresa ABC,Industria,Escopo 1,Combustao Estacionaria,Caldeira,Gas Natural,150000,m3,2.1482,0.0001,0.0001,322.23,0.015,0.015,327.01,IPCC 2006,MCT Brasil',
            '2025,Empresa ABC,Industria,Escopo 1,Combustao Movel,Frota Diesel,Oleo Diesel,80000,litros,2.6030,0.0001,0.0001,208.24,0.008,0.008,211.42,IPCC 2006,MCT Brasil',
            '2025,Empresa ABC,Industria,Escopo 2,Energia Eletrica,Grid Nacional,Eletricidade,500000,kWh,0.0578,,,28.90,,,28.90,Localizacao,SIN 2024',
            '2025,Empresa ABC,Industria,Escopo 3,Viagens a Negocios,Aereo,Voo Domestico,25000,km,,,,,,,,DEFRA 2024,DEFRA',
        ],
    },
};

/**
 * Baixa um template CSV de exemplo para o formato selecionado.
 * @param {string} templateId - ID do template (ex: 'edd', 'ohs-aiha')
 */
export function handleDownloadTemplate(templateId) {
    const tmpl = TEMPLATES[templateId];
    if (!tmpl) return;

    const csv = tmpl.csv.join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = tmpl.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ----------------------------------------------------------------
// DOCUMENT INGESTION (PDF/DOCX) — Rendering + Handlers
// ----------------------------------------------------------------

const CONF_COLORS = {
    green: { bg: 'var(--success-50,#ecfdf5)', border: 'var(--success-300,#86efac)', dot: '#22c55e', label: 'Auto' },
    yellow: { bg: 'var(--warning-50,#fffbeb)', border: 'var(--warning-300,#fcd34d)', dot: '#eab308', label: 'Revisar' },
    red: { bg: 'var(--error-50,#fef2f2)', border: 'var(--error-300,#fca5a5)', dot: '#ef4444', label: 'Quarentena' },
};

// ---------------------------------------------------------------------------
// v0.2: Track Helper Functions (delegated to documentTracks.js — Fix B2)
// ---------------------------------------------------------------------------

/** @see documentTracks.js — convertImagesToBlobUrls */
function _convertImagesToBlobUrls(images) {
    return convertImagesToBlobUrls(images);
}

/** Cleanup: revoke all Blob URLs in _docState on modal close. */
function _cleanupDocState() {
    if (_docState?.observer) {
        try {
            _docState.observer.disconnect();
        } catch {
            /* ignore */
        }
    }
    if (_docState?._keyHandler) {
        document.removeEventListener('keydown', _docState._keyHandler);
    }
    if (_docState?.images) {
        cleanupBlobUrls(_docState.images);
    }
    _pageRenderJobs.clear();
    _docState = null;
}

/** @see documentTracks.js — processScannedPages */
async function _processScannedPages(pageImages) {
    return processScannedPages(pageImages, _renderDocProgress);
}

/** @see documentTracks.js — processTrackB */
async function _processTrackB(blobImages, textItems, pageCount) {
    return processTrackB(blobImages, textItems, pageCount, _renderDocProgress);
}

/** @see documentTracks.js — processTrackC */
async function _processTrackC(rawText, documentAssets, assetClassifications, tables) {
    return processTrackC(rawText, documentAssets, assetClassifications, tables);
}

/** @see documentTracks.js — processTrackD */
async function _processTrackD(mapAssets, allClassifications, allAssets) {
    return processTrackD(mapAssets, allClassifications, allAssets);
}

/**
 * Renderiza barra de progresso durante extracao de documento.
 */
const DOC_PROCESS_PHASES = [
    { key: 'prepare', label: 'Preparar arquivo' },
    { key: 'extract', label: 'Extrair tabelas' },
    { key: 'enrich', label: 'Enriquecer dados' },
    { key: 'finalize', label: 'Finalizar revisao' },
];

function _detectDocProcessPhase(pct, msg) {
    const text = String(msg || '').toLowerCase();
    if (text.includes('ocr') || text.includes('analisando') || text.includes('georefer')) return 'enrich';
    if (text.includes('classifying') || text.includes('classific') || pct >= 95) return 'finalize';
    if (text.includes('extract') || text.includes('table') || text.includes('pdfplumber') || pct >= 15)
        return 'extract';
    return 'prepare';
}

function _formatDocElapsed(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '0s';
    if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/**
 * Renderiza barra de progresso durante extracao de documento.
 */
function _renderDocProgress(pct, msg) {
    const container = document.getElementById('ingestion-content');
    if (!container) return;

    const safePct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    const phase = _detectDocProcessPhase(safePct, msg);
    const now = Date.now();

    if (_docState) {
        if (!_docState._processing) {
            _docState._processing = { startedAt: now, history: [] };
        }
        const st = _docState._processing;
        st.percent = safePct;
        st.phase = phase;
        st.message = msg || '';
        st.lastUpdateAt = now;
        if (!Array.isArray(st.history)) st.history = [];
        const last = st.history[st.history.length - 1];
        if (!last || last.msg !== (msg || '') || last.phase !== phase) {
            st.history.push({ at: now, phase, msg: msg || '' });
            if (st.history.length > 5) st.history.shift();
        }
    }

    const st = _docState?._processing || { startedAt: now, history: [], phase, percent: safePct, message: msg || '' };
    const elapsed = _formatDocElapsed(now - (st.startedAt || now));
    const activeIndex = Math.max(
        0,
        DOC_PROCESS_PHASES.findIndex((p) => p.key === phase),
    );
    const nextHint =
        phase === 'prepare'
            ? 'Proximo: extracao de tabelas.'
            : phase === 'extract'
              ? 'Proximo: enriquecimento e validacao.'
              : phase === 'enrich'
                ? 'Proximo: consolidar resumo para revisao.'
                : 'Finalizando para abrir a tela de revisao.';

    container.innerHTML = `
        <div style="padding:22px 20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
                <p style="font-size:13px;color:var(--neutral-800);margin:0;font-weight:600;">
                    Processando documento
                </p>
                <span style="font-size:10px;color:var(--neutral-600);background:var(--neutral-100);border:1px solid var(--neutral-200);padding:2px 8px;border-radius:999px;">
                    Tempo: ${elapsed}
                </span>
            </div>
            <div style="height:6px;background:var(--neutral-200);border-radius:3px;overflow:hidden;margin-bottom:6px;">
                <div style="height:100%;width:${safePct}%;background:linear-gradient(90deg,var(--accent-500),var(--accent-400));border-radius:3px;transition:width .25s ease;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px;">
                <p style="font-size:11px;color:var(--neutral-700);margin:0;font-weight:500;">${escapeHtml(msg || 'Aguardando atualizacao...')}</p>
                <span style="font-size:10px;color:var(--neutral-600);">${safePct}%</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));gap:6px;margin-bottom:10px;">
                ${DOC_PROCESS_PHASES.map((p, idx) => {
                    const done = idx < activeIndex || safePct >= 100;
                    const active = idx === activeIndex && safePct < 100;
                    const bg = done
                        ? 'var(--success-50,#ecfdf5)'
                        : active
                          ? 'var(--accent-50,#eff6ff)'
                          : 'var(--neutral-50)';
                    const border = done
                        ? 'var(--success-300,#86efac)'
                        : active
                          ? 'var(--accent-300,#93c5fd)'
                          : 'var(--neutral-200)';
                    const color = done
                        ? 'var(--success-700,#166534)'
                        : active
                          ? 'var(--accent-700,#1d4ed8)'
                          : 'var(--neutral-600)';
                    const marker = done ? '&#10003;' : active ? '&#9679;' : '&#9675;';
                    return `<div style="border:1px solid ${border};background:${bg};border-radius:6px;padding:6px 8px;font-size:10px;color:${color};">
                        <span style="margin-right:6px;">${marker}</span>${escapeHtml(p.label)}
                    </div>`;
                }).join('')}
            </div>
            <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">${escapeHtml(nextHint)}</p>
            <p style="font-size:10px;${S_MUTED}margin:0;">${(st.history || []).map((h) => escapeHtml(`${_formatDocElapsed(now - h.at)}: ${h.msg || h.phase}`)).join(' | ')}</p>
        </div>
    `;
}

/**
 * Renderiza a tela de revisao humana com classificacao por cores.
 */
function _renderDocReview() {
    const container = document.getElementById('ingestion-content');
    if (!container || !_docState || _docState.step !== 'review') return;

    const { readings, images, imageAnalysis, summary, quarantinedTables, fileName, selected, disclaimerVisible } =
        _docState;
    const hideRed = _docState._hideRed || false;

    // P3: Sort readings by page first, then by confidence within each page
    const CONF_ORDER = { green: 0, yellow: 1, red: 2 };
    const sortedIndices = readings
        .map((_, i) => i)
        .sort((a, b) => {
            const pageA = readings[a].source?.page || 0;
            const pageB = readings[b].source?.page || 0;
            if (pageA !== pageB) return pageA - pageB;
            return (CONF_ORDER[readings[a].confidence] ?? 2) - (CONF_ORDER[readings[b].confidence] ?? 2);
        });

    // Build family options HTML for dropdowns
    const familyKeys = Object.keys(DEFAULT_FAMILIES);
    const familyOpts = familyKeys.map((f) => `<option value="${f}">${escapeHtml(f)}</option>`).join('');

    // Unique wells detected
    const uniqueWells = [...new Set(readings.map((r) => r.elementName).filter(Boolean))];

    // F1e: Locale detection chip
    const docLocale = _docState._detectedLocale || null;
    const localeLabel = docLocale
        ? { 'pt-BR': 'BR', 'en-US': 'US', 'generic-EU': 'EU' }[docLocale.locale] || 'Auto'
        : 'Auto';
    const localeSignal = docLocale?.signals?.[0] || '';
    const browserLang = (navigator.language || 'en-US').substring(0, 5);
    const localeMismatch = docLocale && docLocale.locale !== browserLang && docLocale.confidence > 0.3;
    const processingStats = _docState.stats || {};
    const processingState = _docState._processing || null;
    const processingDurationMs = processingState?.startedAt
        ? (processingState.finishedAt || Date.now()) - processingState.startedAt
        : null;
    const extractorPrimary =
        processingStats.extractorPrimary || (_docState.fileType === 'pdf' ? 'pdfplumber' : 'worker');
    const extractorCache = processingStats.pdfplumber?.cache || null;
    const budgetMode = processingStats.budgetMode || 'normal';
    const decisions = _ensureDocDecisions();
    const matrixBuckets = collectDocMatrixBuckets(readings);
    const visualAssets = _collectDocVisualAssets();
    const piiDetected = !!_docState?._piiDetection?.detected;
    const selectedCount = selected.size;
    const selectedAmbiguousKeys = new Set();
    for (const idx of selected) {
        const row = readings[idx];
        if (!isDocMatrixAmbiguous(row)) continue;
        selectedAmbiguousKeys.add(buildDocMatrixKey(row));
    }
    const unresolvedMatrixKeys = [...selectedAmbiguousKeys].filter(
        (key) => !normalizeDocMatrixValue(decisions.matrixOverrides?.[key]),
    );
    const unresolvedMatrixSelected = unresolvedMatrixKeys.length;
    const isLgpdBlocked = piiDetected && decisions.lgpdStrategy === 'block' && selectedCount > 0;
    const isConfirmBlocked = selectedCount === 0 || unresolvedMatrixSelected > 0 || isLgpdBlocked;

    // FA: Fullscreen + Split View
    const modal = document.getElementById('ingestion-modal');
    if (modal) {
        modal.style.cssText +=
            ';position:fixed;inset:0;z-index:8900;width:100vw;height:100vh;max-width:100vw;max-height:100vh;border-radius:0;';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Revisao de documento extraido');
    }
    const hasPdfPreview = _docState._bufferCopy && _docState.fileType === 'pdf';
    const currentPage = _docState._currentPage || 1;

    let html = '';

    // Split view container
    if (hasPdfPreview) {
        const totalPages = _docState.pageCount || 1;
        html += `<div style="display:grid;grid-template-columns:2fr 3fr;gap:12px;height:calc(100vh - 140px);overflow:hidden;">`;
        // Left panel: Continuous scroll PDF preview
        html += `<div id="doc-pdf-scroll" style="overflow-y:auto;background:var(--neutral-100);border-radius:6px;padding:8px;">`;
        // Render a placeholder for each page
        for (let p = 1; p <= totalPages; p++) {
            const pageReadings = readings.filter((r) => (r.source?.page || 0) === p);
            const borderColor = pageReadings.some((r) => r.confidence === 'green')
                ? '#10b981'
                : pageReadings.some((r) => r.confidence === 'yellow')
                  ? '#f59e0b'
                  : pageReadings.length > 0
                    ? '#ef4444'
                    : 'var(--neutral-200)';
            html += `<div class="doc-page-wrapper" data-page="${p}" style="position:relative;margin-bottom:8px;border:2px solid ${borderColor};border-radius:4px;min-height:200px;background:var(--neutral-50);display:flex;align-items:center;justify-content:center;">
                <canvas data-page-canvas="${p}" style="max-width:100%;display:none;"></canvas>
                <span class="doc-page-placeholder" style="font-size:12px;color:var(--neutral-400);">Pagina ${p}</span>
            </div>`;
        }
        html += `</div>`;
        // Right panel: readings
        html += `<div style="overflow-y:auto;">`;
    }

    html += `
        <div style="margin-bottom:12px;">
            <div style="display:flex;align-items:center;gap:8px;">
                <h3 style="margin:0;font-size:14px;color:var(--neutral-800);">Resultados da Extracao</h3>
                <span style="font-size:9px;padding:2px 6px;border-radius:8px;background:var(--neutral-100);border:1px solid var(--neutral-200);color:var(--neutral-600);"
                      title="Formato numerico detectado${localeSignal ? ': ' + escapeHtml(localeSignal) : ''}">
                    Formato: ${escapeHtml(localeLabel)}
                </span>
            </div>
            <p style="font-size:11px;${S_MUTED}margin:2px 0 0;">${escapeHtml(fileName)}${images.length > 0 ? ` &#8212; ${images.length} imagem(ns)` : ''}${uniqueWells.length > 0 ? ` &#8212; ${uniqueWells.length} ponto(s)` : ''}</p>
            ${localeMismatch ? `<p style="font-size:10px;color:var(--warning-600);margin:4px 0 0;">Formato do documento (${escapeHtml(localeLabel)}) difere do browser (${escapeHtml(browserLang)})</p>` : ''}
        </div>
    `;

    const budgetChip =
        budgetMode === 'hard-stop'
            ? `<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:var(--error-50);border:1px solid var(--error-300);color:var(--error-700);">Budget: hard-stop</span>`
            : budgetMode === 'degraded'
              ? `<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:var(--warning-50);border:1px solid var(--warning-300);color:var(--warning-700);">Budget: degradado</span>`
              : `<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:var(--success-50);border:1px solid var(--success-300);color:var(--success-700);">Budget: normal</span>`;
    const extractorChip =
        extractorPrimary === 'pdfplumber'
            ? `<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:var(--accent-50,#eff6ff);border:1px solid var(--accent-300,#93c5fd);color:var(--accent-700,#1d4ed8);">Extrator: pdfplumber${extractorCache ? ` (${escapeHtml(extractorCache)})` : ''}</span>`
            : `<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:var(--neutral-100);border:1px solid var(--neutral-200);color:var(--neutral-700);">Extrator: worker</span>`;
    const timingLabel = processingDurationMs != null ? _formatDocElapsed(processingDurationMs) : '-';
    html += `
        <div style="background:var(--neutral-50);border:1px solid var(--neutral-200);border-radius:6px;padding:8px 10px;margin-bottom:10px;">
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;">
                <strong style="font-size:11px;color:var(--neutral-800);">Estado do processamento</strong>
                ${extractorChip}
                ${budgetChip}
                <span style="font-size:10px;padding:2px 8px;border-radius:999px;background:var(--neutral-100);border:1px solid var(--neutral-200);color:var(--neutral-700);">
                    Tabelas: ${processingStats.processedTables || 0}/${processingStats.totalTables || 0}
                </span>
                <span style="font-size:10px;padding:2px 8px;border-radius:999px;background:var(--neutral-100);border:1px solid var(--neutral-200);color:var(--neutral-700);">
                    Duracao: ${escapeHtml(timingLabel)}
                </span>
            </div>
            ${
                processingStats.budgetWarnings?.length
                    ? `<p style="font-size:10px;color:var(--warning-700);margin:0;">${escapeHtml(processingStats.budgetWarnings[0])}</p>`
                    : `<p style="font-size:10px;${S_MUTED}margin:0;">Fluxo concluido. Revise as leituras antes de confirmar.</p>`
            }
        </div>
    `;

    // P3: Resumo executivo (gerado dos readings matched + locale)
    const matchedParams = [...new Set(readings.filter((r) => r.parameterId).map((r) => r.parameterId))];
    const docType = docLocale?.signals?.some((s) => /conama|cetesb/i.test(s))
        ? 'Investigacao Ambiental (CONAMA 420)'
        : 'Relatorio Tecnico';
    if (matchedParams.length > 0 || uniqueWells.length > 0) {
        html += `
            <div style="background:var(--neutral-50);border:1px solid var(--neutral-200);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:10px;color:var(--neutral-600);">
                <strong style="color:var(--neutral-800);font-size:11px;">${escapeHtml(docType)}</strong>
                <span style="margin-left:8px;">Formato: ${escapeHtml(localeLabel)}</span>
                <span style="margin-left:8px;">${_docState.pageCount || '?'} pagina(s)</span>
                ${matchedParams.length > 0 ? `<br>Parametros: <strong>${matchedParams.map((p) => escapeHtml(p)).join(', ')}</strong>` : ''}
                ${
                    uniqueWells.length > 0
                        ? `<br>Pontos: <strong>${uniqueWells
                              .slice(0, 10)
                              .map((w) => escapeHtml(w))
                              .join(', ')}${uniqueWells.length > 10 ? ` (+${uniqueWells.length - 10})` : ''}</strong>`
                        : ''
                }
                <br><span style="font-style:italic;">Extraido automaticamente &#8212; verificar</span>
            </div>
        `;
    }

    // Summary counters (explicit descriptive text)
    html += `<p style="font-size:11px;color:var(--neutral-600);margin:0 0 8px;">
        ${summary.total} leitura(s) extraida(s): <strong style="color:#10b981;">${summary.green} confirmada(s)</strong>,
        <strong style="color:#f59e0b;">${summary.yellow} para revisao</strong>,
        <strong style="color:#ef4444;">${summary.red} sem match</strong>
    </p>`;

    // P3: Legenda expandida com tooltips descritivos
    const CONF_TOOLTIPS = {
        green: 'Parametro reconhecido automaticamente via dicionario (alias match)',
        yellow: 'Reconhecido por similaridade semantica — revisar nome e valor',
        red: 'Nao reconhecido no dicionario — verificar manualmente ou ignorar',
    };
    html += `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">`;
    for (const [color, count] of [
        ['green', summary.green],
        ['yellow', summary.yellow],
        ['red', summary.red],
    ]) {
        const c = CONF_COLORS[color];
        html += `<span style="font-size:11px;padding:3px 10px;border-radius:12px;background:${c.bg};border:1px solid ${c.border};color:var(--neutral-800);cursor:help;"
                       title="${CONF_TOOLTIPS[color]}">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.dot};margin-right:4px;vertical-align:middle;"></span>
            ${c.label}: ${count}
        </span>`;
    }
    html += `<span style="font-size:11px;padding:3px 10px;border-radius:12px;background:var(--neutral-100);color:var(--neutral-800);">Total: ${summary.total}</span>`;
    html += `</div>`;

    // Image gallery (thumbnails)
    if (images.length > 0) {
        html += `
            <details style="margin-bottom:10px;" ${imageAnalysis ? 'open' : ''}>
                <summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--neutral-800);">
                    Imagens Encontradas (${images.length})
                </summary>
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;max-height:200px;overflow-y:auto;">
        `;
        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            const analysis = imageAnalysis?.[i];
            const tooltip = analysis ? escapeHtml(`${analysis.type}: ${analysis.description}`) : '';
            html += `
                <div style="width:80px;text-align:center;" ${tooltip ? `title="${tooltip}"` : ''}>
                    <img src="${img.blobUrl || img.dataUrl || ''}" style="width:80px;height:60px;object-fit:cover;border-radius:4px;border:1px solid var(--neutral-200);">
                    <div style="font-size:9px;${S_MUTED}margin-top:2px;">
                        ${img.page ? `p.${img.page}` : `#${i + 1}`}
                        ${analysis ? `<br>${escapeHtml(analysis.type || '')}` : ''}
                    </div>
                    ${analysis?.families?.length ? `<div style="font-size:8px;color:var(--primary-600);">${escapeHtml(analysis.families.join(', '))}</div>` : ''}
                </div>
            `;
        }
        html += `</div></details>`;
    }

    // AI Analysis — inline controls (non-blocking)
    if (images.length > 0 || readings.length > 0) {
        const aiAvailable = isLLMAvailable();
        const aiRunning = _docState._aiRunning;
        html += `
            <div style="margin-bottom:10px;display:flex;gap:8px;align-items:center;">
                <button class="btn btn-secondary" onclick="window.handleDocAnalyzeAI()"
                        ${aiRunning ? 'disabled' : ''}
                        style="font-size:11px;padding:4px 12px;">
                    ${aiRunning ? 'IA analisando...' : 'Analisar com IA'}
                </button>
                <button class="btn btn-secondary" onclick="window.handleDocAnalyzePages()"
                        ${_docState._aiPagesRunning ? 'disabled' : ''}
                        style="font-size:11px;padding:4px 12px;">
                    ${_docState._aiPagesRunning ? 'Analisando paginas...' : 'Analisar Paginas'}
                </button>
                <span id="doc-ai-status"></span>
                <span id="doc-pages-status" style="font-size:10px;${S_MUTED}"></span>
                ${!aiAvailable ? `<span style="font-size:10px;${S_MUTED}">Clique para configurar API key</span>` : ''}
            </div>
        `;
    }

    // Quarantined tables warning
    if (quarantinedTables.length > 0) {
        html += `
            <div style="background:var(--warning-50);border:1px solid var(--warning-300);border-radius:6px;padding:8px;margin-bottom:10px;font-size:11px;color:var(--neutral-800);">
                <strong>${quarantinedTables.length} tabela(s)</strong> com confianca baixa foram ignoradas (threshold &lt; 0.6).
            </div>
        `;
    }

    // Disclaimer (shown when "Selecionar Sugeridos" is clicked)
    if (disclaimerVisible) {
        html += `
            <div style="background:var(--warning-50);border:1px solid var(--warning-300);border-radius:6px;padding:8px;margin-bottom:10px;font-size:11px;color:var(--neutral-800);">
                Selecionados automaticamente com base em confianca >= YELLOW.
                <strong>Revise cada item antes de confirmar.</strong> Itens RED nao sao selecionados.
            </div>
        `;
    }

    // FD: Bulk actions bar
    if (readings.length > 0) {
        html += `<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">`;
        if (summary.green > 0) {
            html += `<button class="btn btn-secondary" onclick="window.handleDocSelectGreen()" style="font-size:10px;padding:3px 10px;color:#10b981;border-color:#10b981;">
                &#10003; Aceitar ${summary.green} confirmado${summary.green > 1 ? 's' : ''}
            </button>`;
        }
        if (summary.red > 0) {
            html += `<label style="font-size:10px;color:var(--neutral-500);cursor:pointer;display:flex;align-items:center;gap:4px;margin-left:auto;">
                <input type="checkbox" ${hideRed ? 'checked' : ''} onchange="window.handleDocToggleHideRed(this.checked)">
                Ocultar ${summary.red} sem match
            </label>`;
        }
        html += `</div>`;
    }

    // Readings table
    if (readings.length > 0) {
        html += `
            <div style="${hasPdfPreview ? '' : 'max-height:350px;'}overflow-y:auto;border:1px solid var(--neutral-200);border-radius:6px;">
                <table style="width:100%;border-collapse:collapse;font-size:11px;" aria-label="Leituras extraidas do documento">
                    <thead>
                        <tr style="${S_TABLE_HEADER}position:sticky;top:0;z-index:2;">
                            <th style="padding:6px 4px;text-align:left;width:24px;">
                                <input type="checkbox" ${selected.size > 0 && selected.size === readings.filter((r) => r.confidence !== 'red').length ? 'checked' : ''}
                                       onchange="window.handleDocToggleAll(this.checked)">
                            </th>
                            <th style="padding:6px 6px;text-align:left;">Parametro</th>
                            <th style="padding:6px 6px;text-align:left;">Valor</th>
                            <th style="padding:6px 6px;text-align:left;">Unidade</th>
                            <th style="padding:6px 4px;text-align:center;width:60px;">Conf.</th>
                            <th style="padding:6px 6px;text-align:left;width:90px;">Familia</th>
                            <th style="padding:6px 6px;text-align:left;width:90px;">Elemento</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        let lastPage = null;
        for (const i of sortedIndices) {
            const r = readings[i];
            if (hideRed && r.confidence === 'red') continue;

            // P3: Page divider
            const curPage = r.source?.page || 0;
            if (curPage !== lastPage && curPage > 0) {
                const pageReadings = readings.filter((rd) => (rd.source?.page || 0) === curPage);
                const pg = pageReadings.filter((rd) => rd.confidence === 'green').length;
                const py = pageReadings.filter((rd) => rd.confidence === 'yellow').length;
                const pr = pageReadings.filter((rd) => rd.confidence === 'red').length;
                const matrixBadge = r.matrix
                    ? ` &#8212; ${escapeHtml(r.matrix === 'soil' ? 'Solo' : r.matrix === 'groundwater' ? 'Agua' : r.matrix === 'air' ? 'Ar' : r.matrix)}`
                    : '';
                html += `<tr><td colspan="7" style="padding:6px 8px;background:var(--neutral-100);font-size:10px;font-weight:600;color:var(--neutral-600);border-top:2px solid var(--neutral-200);">
                    Pagina ${curPage}${matrixBadge}
                    <span style="font-weight:400;margin-left:8px;">${pg > 0 ? `<span style="color:#10b981;">${pg}&#10003;</span> ` : ''}${py > 0 ? `<span style="color:#f59e0b;">${py}&#9888;</span> ` : ''}${pr > 0 ? `<span style="color:#ef4444;">${pr}&#10007;</span>` : ''}</span>
                </td></tr>`;
                lastPage = curPage;
            }

            const c = CONF_COLORS[r.confidence] || CONF_COLORS.red;
            const isChecked = selected.has(i);
            const isActiveRow = _docState.activeRow === i;
            const paramDisplay = r.parameterId || r.parameterName || '?';
            const valueDisplay = r.operator && r.operator !== '=' ? `${r.operator} ${r.value ?? ''}` : (r.value ?? '');
            const matchInfo = r.matchMethod
                ? `${r.matchMethod} ${r.matchScore ? `(${(r.matchScore * 100).toFixed(0)}%)` : ''}`
                : '';
            const warningsText = (r.warnings || []).join('; ');

            const rowPage = r.source?.page || 0;
            const rowBbox = r.source?.bbox || null;
            const hasBbox = !!(
                rowBbox &&
                Number.isFinite(rowBbox.x0) &&
                Number.isFinite(rowBbox.y0) &&
                Number.isFinite(rowBbox.x1) &&
                Number.isFinite(rowBbox.y1) &&
                rowBbox.x1 > rowBbox.x0 &&
                rowBbox.y1 > rowBbox.y0
            );
            const canShowSource = rowPage > 0 && hasBbox;
            const sourceInfo = `Pagina ${rowPage}${r.matchMethod ? ' | Match: ' + r.matchMethod : ''}${r.elementName ? ' | Poco: ' + r.elementName : ''}`;
            const bboxJson = r.source?.bbox ? JSON.stringify(r.source.bbox).replace(/"/g, '&quot;') : 'null';
            const noSourceHint = 'Sem origem precisa (bbox ausente) — selecione a linha para revisar dados.';
            const baseRowInfo = warningsText || matchInfo || '';
            const rowTitle = canShowSource ? baseRowInfo : [baseRowInfo, noSourceHint].filter(Boolean).join(' | ');
            html += `
                <tr data-idx="${i}" data-has-bbox="${canShowSource ? '1' : '0'}"
                    class="${isActiveRow ? 'doc-row-active' : ''}${canShowSource ? '' : ' doc-row-no-source'}"
                    role="button" tabindex="0" aria-selected="${isActiveRow ? 'true' : 'false'}" aria-disabled="${canShowSource ? 'false' : 'true'}"
                    style="${S_TABLE_ROW}${!isChecked ? 'opacity:0.5;' : ''}cursor:${canShowSource ? 'pointer' : 'not-allowed'};${isActiveRow ? 'background:rgba(250, 204, 21, 0.15);outline:2px solid #f59e0b;' : ''}"
                    title="${escapeHtml(rowTitle)}"
                    onclick="${
                        canShowSource
                            ? `window._docSelectRow(this, ${rowPage}, '${escapeHtml(paramDisplay)}', '${escapeHtml(sourceInfo)}', ${bboxJson})`
                            : 'window._docSetActiveRow(this)'
                    }">
                    <td style="padding:4px;">
                        <input type="checkbox" ${isChecked ? 'checked' : ''}
                               onchange="window.handleDocToggleReading(${i}, this.checked)">
                    </td>
                    <td style="padding:4px 6px;color:var(--neutral-800);">
                        <strong style="font-size:11px;">${escapeHtml(paramDisplay)}</strong>
                        ${r.parameterName !== r.parameterId && r.parameterName ? `<br><span style="${S_MUTED}font-size:9px;">${escapeHtml(r.parameterName)}</span>` : ''}
                    </td>
                    <td style="padding:4px 6px;font-family:monospace;font-size:10px;color:var(--neutral-800);">${escapeHtml(String(valueDisplay))}</td>
                    <td style="padding:4px 6px;font-size:10px;color:var(--neutral-800);">${escapeHtml(r.unitId || r.unit || '')}</td>
                    <td style="padding:4px;text-align:center;">
                        <span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:9px;background:${c.bg};border:1px solid ${c.border};color:var(--neutral-800);">
                            <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${c.dot};margin-right:2px;vertical-align:middle;"></span>
                            ${c.label}
                        </span>
                    </td>
                    <td style="padding:4px 6px;">
                        <select style="font-size:10px;padding:2px 4px;border:1px solid ${r._aiSuggested ? 'var(--primary-400)' : 'var(--neutral-200)'};border-radius:4px;background:var(--neutral-50);color:var(--neutral-800);max-width:85px;"
                                onchange="window.handleDocChangeFamily(${i}, this.value)"
                                ${r._aiSuggested ? 'title="Sugestao da IA"' : ''}>
                            ${familyKeys.map((f) => `<option value="${f}" ${r.family === f ? 'selected' : ''}>${f}</option>`).join('')}
                        </select>${r._aiSuggested ? '<span style="color:var(--primary-500);font-size:8px;vertical-align:super;" title="IA">&#9670;</span>' : ''}
                    </td>
                    <td style="padding:4px 6px;">
                        <input type="text" value="${escapeHtml(r.elementName || '')}"
                               placeholder="auto"
                               style="font-size:10px;padding:2px 4px;border:1px solid var(--neutral-200);border-radius:4px;width:80px;background:var(--neutral-50);color:var(--neutral-800);"
                               onchange="window.handleDocChangeElementName(${i}, this.value)">
                    </td>
                </tr>
            `;
        }

        html += `</tbody></table></div>`;
    } else {
        html += `<p style="font-size:12px;${S_MUTED}text-align:center;padding:20px;">Nenhum dado extraido do documento.</p>`;
    }

    // Warnings
    const allWarnings = readings.flatMap((r) => r.warnings || []);
    if (allWarnings.length > 0) {
        html += `
            <details style="margin-top:10px;font-size:10px;color:var(--neutral-500);">
                <summary style="cursor:pointer;">Avisos (${allWarnings.length})</summary>
                <ul style="margin:4px 0;padding-left:16px;">
                    ${allWarnings
                        .slice(0, 20)
                        .map((w) => `<li>${escapeHtml(w)}</li>`)
                        .join('')}
                    ${allWarnings.length > 20 ? `<li>... e mais ${allWarnings.length - 20}</li>` : ''}
                </ul>
            </details>
        `;
    }

    // Decisoes Tecnicas -- obrigatorias para matriz ambigua e condicionais para LGPD.
    if (readings.length > 0) {
        html += `<details style="margin-top:10px;margin-bottom:8px;border:1px solid var(--neutral-200);border-radius:6px;padding:8px;" open>
            <summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--neutral-800);">Decisoes Tecnicas</summary>
            <div style="margin-top:8px;display:flex;flex-direction:column;gap:10px;">`;

        if (matrixBuckets.length > 0) {
            html += `<div style="background:var(--neutral-50);padding:8px;border-radius:4px;">
                <p style="font-size:11px;font-weight:600;margin:0 0 4px;color:var(--neutral-800);">
                    Matriz ambigua por pagina/tabela (${matrixBuckets.length})
                </p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">
                    Selecione a matriz para cada tabela ambigua com leituras selecionadas.
                </p>`;

            for (const bucket of matrixBuckets) {
                const selectedInBucket = [...selected].filter(
                    (idx) => buildDocMatrixKey(readings[idx]) === bucket.key && isDocMatrixAmbiguous(readings[idx]),
                ).length;
                const overrideValue = normalizeDocMatrixValue(decisions.matrixOverrides?.[bucket.key]) || '';
                const isRequired = selectedInBucket > 0;
                const isMissing = isRequired && !overrideValue;
                const sampleText =
                    bucket.sampleParams.length > 0
                        ? ` (${bucket.sampleParams.map((p) => escapeHtml(p)).join(', ')})`
                        : '';

                html += `
                    <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;margin:6px 0;padding:6px;border:1px solid ${isMissing ? 'var(--warning-300,#fcd34d)' : 'var(--neutral-200)'};border-radius:4px;background:${isMissing ? 'var(--warning-50,#fffbeb)' : 'var(--neutral-0,#fff)'};">
                        <div style="font-size:10px;color:var(--neutral-700);">
                            <strong>Pagina ${bucket.page}, tabela ${bucket.tableIndex + 1}</strong>
                            <span style="${S_MUTED}"> -- ${bucket.count} leitura(s) ambigua(s)${sampleText}</span>
                            ${isRequired ? `<span style="margin-left:6px;color:${isMissing ? 'var(--warning-700,#a16207)' : 'var(--success-700,#166534)'};">${isMissing ? 'obrigatorio' : 'ok'}</span>` : '<span style="margin-left:6px;opacity:.7;">opcional</span>'}
                        </div>
                        <select style="font-size:10px;padding:2px 4px;border:1px solid ${isMissing ? 'var(--warning-400,#f59e0b)' : 'var(--neutral-200)'};border-radius:4px;background:var(--neutral-50);color:var(--neutral-800);min-width:150px;"
                                onchange="window._docSetMatrixOverride('${escapeHtml(bucket.key)}', this.value)">
                            <option value="">Selecionar matriz...</option>
                            <option value="soil" ${overrideValue === 'soil' ? 'selected' : ''}>Solo</option>
                            <option value="groundwater" ${overrideValue === 'groundwater' ? 'selected' : ''}>Agua subterranea</option>
                            <option value="surface_water" ${overrideValue === 'surface_water' ? 'selected' : ''}>Agua superficial</option>
                            <option value="air" ${overrideValue === 'air' ? 'selected' : ''}>Ar</option>
                        </select>
                    </div>
                `;
            }

            if (unresolvedMatrixSelected > 0) {
                html += `<p style="font-size:10px;color:var(--warning-700,#a16207);margin:4px 0 0;">
                    Faltam ${unresolvedMatrixSelected} decisao(oes) obrigatoria(s) para leituras selecionadas.
                </p>`;
            }
            html += `</div>`;
        }

        if (piiDetected) {
            html += `<div style="background:var(--neutral-50);padding:8px;border-radius:4px;">
                <p style="font-size:11px;font-weight:600;margin:0 0 4px;color:var(--neutral-800);">Dados pessoais (LGPD)</p>
                <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">PII detectada no documento. Escolha a estrategia antes de importar.</p>
                <label style="display:block;font-size:10px;margin-bottom:3px;cursor:pointer;color:var(--neutral-700);">
                    <input type="radio" name="doc-lgpd" value="pseudonymize" ${decisions.lgpdStrategy === 'pseudonymize' ? 'checked' : ''}
                           onchange="window._docDecision('lgpdStrategy','pseudonymize')">
                    Pseudonimizar campos sensiveis (recomendado)
                </label>
                <label style="display:block;font-size:10px;margin-bottom:3px;cursor:pointer;color:var(--neutral-700);">
                    <input type="radio" name="doc-lgpd" value="keep_identified" ${decisions.lgpdStrategy === 'keep_identified' ? 'checked' : ''}
                           onchange="window._docDecision('lgpdStrategy','keep_identified')">
                    Manter identificadores
                </label>
                <label style="display:block;font-size:10px;cursor:pointer;color:var(--neutral-700);">
                    <input type="radio" name="doc-lgpd" value="block" ${decisions.lgpdStrategy === 'block' ? 'checked' : ''}
                           onchange="window._docDecision('lgpdStrategy','block')">
                    Bloquear importacao com PII
                </label>
                ${isLgpdBlocked ? '<p style="font-size:10px;color:var(--warning-700,#a16207);margin:4px 0 0;">Importacao bloqueada enquanto "Bloquear importacao" estiver selecionado.</p>' : ''}
            </div>`;
        }

        html += `<div style="background:var(--neutral-50);padding:8px;border-radius:4px;">
            <p style="font-size:11px;font-weight:600;margin:0 0 4px;color:var(--neutral-800);">Perfil de poco (nivel/litologia/construtivo)</p>
            <p style="font-size:10px;${S_MUTED}margin:0 0 6px;">Como aplicar os dados de perfil em pocos vinculados.</p>
            <label style="display:block;font-size:10px;margin-bottom:3px;cursor:pointer;color:var(--neutral-700);">
                <input type="radio" name="doc-profile-strategy" value="append" ${decisions.profileConflictStrategy === 'append' ? 'checked' : ''}
                       onchange="window._docDecision('profileConflictStrategy','append')">
                Append (recomendado)
            </label>
            <label style="display:block;font-size:10px;margin-bottom:3px;cursor:pointer;color:var(--neutral-700);">
                <input type="radio" name="doc-profile-strategy" value="replace" ${decisions.profileConflictStrategy === 'replace' ? 'checked' : ''}
                       onchange="window._docDecision('profileConflictStrategy','replace')">
                Replace
            </label>
            <label style="display:block;font-size:10px;cursor:pointer;color:var(--neutral-700);">
                <input type="radio" name="doc-profile-strategy" value="skip" ${decisions.profileConflictStrategy === 'skip' ? 'checked' : ''}
                       onchange="window._docDecision('profileConflictStrategy','skip')">
                Skip
            </label>
        </div>`;

        html += `<div style="background:var(--neutral-50);padding:8px;border-radius:4px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--neutral-800);cursor:pointer;">
                <input type="checkbox" ${decisions.saveInFiles ? 'checked' : ''}
                       onchange="window._docDecision('saveInFiles', this.checked)">
                Salvar arquivo no Files
            </label>
            <p style="font-size:10px;${S_MUTED}margin:6px 0 0;">Falha no registro gera aviso e nao bloqueia a importacao.</p>
        </div>`;

        html += `<div style="background:var(--neutral-50);padding:8px;border-radius:4px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--neutral-800);cursor:pointer;">
                <input type="checkbox" ${decisions.visualWizardEnabled ? 'checked' : ''}
                       onchange="window._docDecision('visualWizardEnabled', this.checked)">
                Abrir wizard visual pos-import
            </label>
            <p style="font-size:10px;${S_MUTED}margin:6px 0 0;">
                Assets elegiveis detectados: ${visualAssets.length}. Nenhuma acao pre-selecionada.
            </p>
        </div>`;

        html += `</div></details>`;
    }

    // Action buttons
    html += `
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:space-between;border-top:1px solid var(--neutral-200);padding-top:12px;">
            <button class="btn btn-secondary" onclick="window.handleDocSelectSuggested()" style="font-size:11px;">
                Selecionar Sugeridos
            </button>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-secondary" onclick="window.handleDocCancel()">Cancelar</button>
                <button class="btn btn-primary" onclick="window.handleDocIngest()" ${isConfirmBlocked ? 'disabled' : ''}>
                    Confirmar e Importar ${selectedCount} leitura${selectedCount !== 1 ? 's' : ''}
                </button>
            </div>
        </div>
        ${
            isConfirmBlocked
                ? `<p style="font-size:10px;color:var(--warning-700,#a16207);margin:6px 0 0;text-align:right;">
            ${selectedCount === 0 ? 'Selecione ao menos uma leitura.' : ''}
            ${unresolvedMatrixSelected > 0 ? `${selectedCount === 0 ? ' ' : ''}Resolva ${unresolvedMatrixSelected} matriz(zes) ambigua(s).` : ''}
            ${isLgpdBlocked ? `${selectedCount === 0 || unresolvedMatrixSelected > 0 ? ' ' : ''}LGPD em modo bloqueio.` : ''}
        </p>`
                : ''
        }
    `;

    // Close split view containers
    if (hasPdfPreview) {
        html += `</div></div>`; // close doc-split-right + doc-split
    }

    container.innerHTML = html;

    // FA: Setup lazy rendering for continuous scroll PDF
    if (hasPdfPreview) {
        setTimeout(() => _setupPdfLazyRender(), 50);
    }

    // UX-5: Keyboard navigation for reading rows
    _setupDocKeyboardNav();

    // Restore AI status indicator if already running (user triggered manually)
    if (_docState._aiRunning) {
        setTimeout(() => _updateAIStatusIndicator(), 50);
    }
}

/**
 * Toggle all checkboxes in document review
 */
export function handleDocToggleAll(checked) {
    if (!_docState || !_docState.readings) return;
    _docState.selected = new Set();
    if (checked) {
        _docState.readings.forEach((r, i) => {
            if (r.confidence !== 'red') _docState.selected.add(i);
        });
    }
    _renderDocReview();
}

/**
 * Toggle single reading checkbox
 */
export function handleDocToggleReading(index, checked) {
    if (!_docState) return;
    if (checked) _docState.selected.add(index);
    else _docState.selected.delete(index);
    _renderDocReview();
}

/**
 * Update a domain decision for document ingestion.
 * @param {string} field - Decision field name
 * @param {string} value - Decision value
 */
export function _docDecision(field, value) {
    if (!_docState) return;
    const decisions = _ensureDocDecisions();
    if (field === 'saveInFiles' || field === 'visualWizardEnabled') {
        decisions[field] = value === true || value === 'true' || value === 1;
    } else {
        decisions[field] = value;
    }
    _docState._decisions = decisions;
    _renderDocReview();
}

/**
 * Set matrix override by page/table key.
 * @param {string} key
 * @param {string} matrix
 */
export function _docSetMatrixOverride(key, matrix) {
    if (!_docState || !key) return;
    const decisions = _ensureDocDecisions();
    const normalized = normalizeDocMatrixValue(matrix);
    if (!decisions.matrixOverrides || typeof decisions.matrixOverrides !== 'object') {
        decisions.matrixOverrides = {};
    }
    if (normalized) decisions.matrixOverrides[key] = normalized;
    else delete decisions.matrixOverrides[key];
    _docState._decisions = decisions;
    _renderDocReview();
}

/**
 * Toggle hiding RED readings in review table.
 */
export function handleDocToggleHideRed(hide) {
    if (!_docState) return;
    _docState._hideRed = !!hide;
    _renderDocReview();
}

// ---------------------------------------------------------------------------
// FA: PDF Preview rendering + navigation
// ---------------------------------------------------------------------------

let _pdfDoc = null; // Cached pdf.js document instance
const _pageCache = new Map(); // Map<pageNum, ImageBitmap|HTMLCanvasElement>
const _pageRenderJobs = new Map(); // Map<pageNum, Promise<void>> to avoid concurrent canvas renders

const PDF_SCALE = 1.2;
const _renderedPages = new Set();

/**
 * UX-5: Keyboard navigation for document review reading rows.
 * Arrow Up/Down navigates rows, Space toggles checkbox, Escape closes.
 */
function _setupDocKeyboardNav() {
    // Remove previous listener if any
    if (_docState?._keyHandler) {
        document.removeEventListener('keydown', _docState._keyHandler);
    }

    const handler = (e) => {
        if (!_docState?.readings) return;
        // Only handle when not typing in an input/select
        const tag = (e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

        const rows = document.querySelectorAll('tr[data-idx]');
        if (!rows.length) return;

        const idxList = Array.from(rows).map((r) => parseInt(r.dataset.idx, 10));
        let currentPos = _docState.activeRow != null ? idxList.indexOf(_docState.activeRow) : -1;
        if (currentPos < 0) {
            const focusedRow = document.activeElement?.closest?.('tr[data-idx]');
            if (focusedRow?.dataset?.idx != null) {
                currentPos = idxList.indexOf(parseInt(focusedRow.dataset.idx, 10));
            }
        }

        if (e.key === 'ArrowDown' || e.key === 'j') {
            e.preventDefault();
            const nextPos = Math.min(currentPos + 1, idxList.length - 1);
            const nextRow = rows[nextPos];
            if (nextRow) {
                nextRow.click();
                nextRow.focus();
            }
        } else if (e.key === 'ArrowUp' || e.key === 'k') {
            e.preventDefault();
            const prevPos = Math.max(currentPos - 1, 0);
            const prevRow = rows[prevPos];
            if (prevRow) {
                prevRow.click();
                prevRow.focus();
            }
        } else if (e.key === 'Enter' && currentPos >= 0) {
            e.preventDefault();
            const row = rows[currentPos];
            if (row) {
                row.click();
                row.focus();
            }
        } else if (e.key === ' ' && currentPos >= 0) {
            e.preventDefault();
            const idx = idxList[currentPos];
            const isSelected = _docState.selected.has(idx);
            handleDocToggleReading(idx, !isSelected);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleDocCancel();
        }
    };

    document.addEventListener('keydown', handler);
    if (_docState) _docState._keyHandler = handler;
}

/**
 * Setup IntersectionObserver for lazy PDF page rendering.
 * Each page renders when it becomes visible in the scroll container.
 */
async function _setupPdfLazyRender() {
    if (!_docState?._bufferCopy) return;

    try {
        // Lazy load pdf.js
        if (!_pdfDoc) {
            const pdfjsLib = await importCDN('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs', {
                name: 'pdfjs-dist',
            });
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
            _pdfDoc = await pdfjsLib.getDocument({ data: _docState._bufferCopy.slice(0) }).promise;
        }
    } catch (e) {
        console.warn('[ingestion] pdf.js load failed:', e.message);
        return;
    }

    _renderedPages.clear();

    const scrollContainer = document.getElementById('doc-pdf-scroll');
    if (!scrollContainer) return;

    // Disconnect previous observer if any (prevents leak on re-open)
    if (_docState?.observer) {
        try {
            _docState.observer.disconnect();
        } catch {
            /* ignore */
        }
    }

    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const pageNum = parseInt(entry.target.dataset.page);
                    if (!_renderedPages.has(pageNum)) {
                        _renderPdfPage(pageNum);
                    }
                }
            }
        },
        { root: scrollContainer, rootMargin: '300px' },
    );

    // Store observer for cleanup on modal close
    if (_docState) _docState.observer = observer;

    scrollContainer.querySelectorAll('.doc-page-wrapper').forEach((el) => observer.observe(el));
}

/**
 * Render a specific PDF page into its canvas within the scroll container.
 */
async function _renderPdfPage(pageNum) {
    if (!_pdfDoc || _renderedPages.has(pageNum)) return;
    if (_pageRenderJobs.has(pageNum)) return _pageRenderJobs.get(pageNum);

    const renderJob = (async () => {
        const wrapper = document.querySelector(`.doc-page-wrapper[data-page="${pageNum}"]`);
        const canvas = document.querySelector(`canvas[data-page-canvas="${pageNum}"]`);
        if (!wrapper || !canvas) return;

        try {
            const page = await _pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: PDF_SCALE });

            canvas.width = viewport.width;
            canvas.height = viewport.height;

            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;

            canvas.style.display = 'block';
            const placeholder = wrapper.querySelector('.doc-page-placeholder');
            if (placeholder) placeholder.style.display = 'none';
            wrapper.style.minHeight = 'auto';

            _renderedPages.add(pageNum);
        } catch (e) {
            console.warn(`[ingestion] Page ${pageNum} render error:`, e.message);
        } finally {
            _pageRenderJobs.delete(pageNum);
        }
    })();

    _pageRenderJobs.set(pageNum, renderJob);
    return renderJob;
}

/** FD: Select all GREEN readings in one click */
export function handleDocSelectGreen() {
    if (!_docState?.readings) return;
    _docState.readings.forEach((r, i) => {
        if (r.confidence === 'green') _docState.selected.add(i);
    });
    _renderDocReview();
}

export function _docPrevPage() {
    if (!_docState) return;
    const p = Math.max(1, (_docState._currentPage || 1) - 1);
    _renderPdfPage(p);
}

export function _docNextPage() {
    if (!_docState) return;
    const p = Math.min(_docState.pageCount || 1, (_docState._currentPage || 1) + 1);
    _renderPdfPage(p);
}

export function _docGoToPage(pageNum) {
    if (!_docState) return;
    const wrapper = document.querySelector(`.doc-page-wrapper[data-page="${pageNum}"]`);
    if (wrapper) {
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/**
 * Navigate to source page + show highlight overlay on PDF canvas at exact position.
 * Called when user clicks a reading row.
 *
 * @param {number} pageNum - Page number to navigate to
 * @param {string} paramName - Parameter display name
 * @param {string} sourceInfo - Source description text
 * @param {Object|null} bbox - Bounding box in PDF points { x0, y0, x1, y1 } or null
 */
export async function _docShowSource(pageNum, paramName, sourceInfo, bbox) {
    if (!_docState) return;

    // On fast interactions the lazy setup may still be in-flight.
    // Ensure pdf.js doc is available before trying to render/calc highlight.
    if (!_pdfDoc) {
        await _setupPdfLazyRender();
    }
    if (!_pdfDoc) {
        showToast('Preview PDF indisponivel para highlight de origem.', 'warning');
        return;
    }

    // Scroll to the page wrapper in continuous scroll
    const wrapper = document.querySelector(`.doc-page-wrapper[data-page="${pageNum}"]`);
    if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Ensure page is rendered
    await _renderPdfPage(pageNum);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Remove ALL previous highlights and info boxes
    document.querySelectorAll('.doc-highlight, #doc-source-box').forEach((el) => el.remove());

    if (bbox && bbox.x0 != null && wrapper) {
        const canvas = wrapper.querySelector('canvas[data-page-canvas]');
        if (canvas) {
            const rect = computeDocHighlightRect({
                bbox,
                pdfScale: PDF_SCALE,
                canvasWidth: canvas.width,
                canvasHeight: canvas.height,
                canvasRect: canvas.getBoundingClientRect(),
                wrapperRect: wrapper.getBoundingClientRect(),
                padX: 8,
                padY: 4,
            });
            if (rect) {
                const hl = document.createElement('div');
                hl.className = 'doc-highlight';
                hl.style.cssText = `position:absolute;
                    left:${rect.left}px;
                    top:${rect.top}px;
                    width:${rect.width}px;
                    height:${rect.height}px;
                    background:rgba(250, 204, 21, 0.4);
                    border:3px solid #f59e0b;
                    border-radius:4px;
                    pointer-events:none;
                    z-index:10;
                    box-shadow:0 0 8px rgba(245, 158, 11, 0.5);`;
                wrapper.appendChild(hl);
            }
        }
    }

    // Glow on wrapper
    if (wrapper) {
        wrapper.style.boxShadow = '0 0 12px var(--accent-300)';
        setTimeout(() => {
            wrapper.style.boxShadow = 'none';
        }, 2000);
    }

    // Info box inside wrapper
    if (wrapper) {
        const box = document.createElement('div');
        box.id = 'doc-source-box';
        box.style.cssText =
            'position:absolute;bottom:4px;left:4px;right:4px;padding:4px 8px;background:rgba(30,58,95,0.95);color:#fff;border-radius:4px;font-size:10px;z-index:11;pointer-events:none;';
        box.innerHTML = `<strong>${paramName}</strong> <span style="opacity:0.7;">&#8212; ${sourceInfo}</span>`;
        wrapper.appendChild(box);
    }
}

function _hasSourceBbox(bbox) {
    return !!(
        bbox &&
        Number.isFinite(bbox.x0) &&
        Number.isFinite(bbox.y0) &&
        Number.isFinite(bbox.x1) &&
        Number.isFinite(bbox.y1) &&
        bbox.x1 > bbox.x0 &&
        bbox.y1 > bbox.y0
    );
}

/**
 * Sets active visual state for a review row without forcing source navigation.
 *
 * @param {HTMLElement|null} trEl
 */
export function _docSetActiveRow(trEl) {
    document.querySelectorAll('tr.doc-row-active').forEach((el) => {
        el.classList.remove('doc-row-active');
        el.style.background = '';
        el.style.outline = '';
        el.setAttribute('aria-selected', 'false');
    });
    if (!trEl) return;
    trEl.classList.add('doc-row-active');
    trEl.style.background = 'rgba(250, 204, 21, 0.15)';
    trEl.style.outline = '2px solid #f59e0b';
    trEl.setAttribute('aria-selected', 'true');
    trEl.focus();
    if (trEl.getAttribute('aria-disabled') === 'true') {
        document.querySelectorAll('.doc-highlight, #doc-source-box').forEach((el) => el.remove());
    }
    if (_docState && trEl?.dataset?.idx != null) {
        _docState.activeRow = parseInt(trEl.dataset.idx, 10);
    }
}

/**
 * Row click handler — highlights the active row and shows PDF source.
 * Wraps _docShowSource with visual row feedback (UX-4).
 */
export async function _docSelectRow(trEl, pageNum, paramName, sourceInfo, bbox) {
    _docSetActiveRow(trEl);
    if (!_hasSourceBbox(bbox) || !pageNum) {
        showToast('Sem origem precisa para highlight nesta linha.', 'warning');
        return;
    }
    await _docShowSource(pageNum, paramName, sourceInfo, bbox);
}

/**
 * Cancel document ingestion — return to upload form
 */
export function handleDocCancel() {
    // Cleanup PDF doc
    if (_pdfDoc) {
        try {
            _pdfDoc.destroy();
        } catch {}
        _pdfDoc = null;
    }
    _pageCache.clear();
    _pageRenderJobs.clear();
    // Reset modal fullscreen
    const modal = document.getElementById('ingestion-modal');
    if (modal)
        modal.style.cssText = modal.style.cssText.replace(
            /position:fixed[^;]*;|inset:[^;]*;|z-index:[^;]*;|width:100vw[^;]*;|height:100vh[^;]*;|max-width:[^;]*;|max-height:[^;]*;|border-radius:0[^;]*;/g,
            '',
        );
    _cleanupDocState();
    renderIngestionStep();
}

/**
 * Change the family of a reading (via dropdown in review table).
 * @param {number} index - Reading index
 * @param {string} family - New family ID
 */
export function handleDocChangeFamily(index, family) {
    if (!_docState || !_docState.readings || !_docState.readings[index]) return;
    _docState.readings[index].family = family;
    // No re-render needed — dropdown already shows new value
}

/**
 * Change the element name of a reading (via input in review table).
 * @param {number} index - Reading index
 * @param {string} name - New element name
 */
export function handleDocChangeElementName(index, name) {
    if (!_docState || !_docState.readings || !_docState.readings[index]) return;
    _docState.readings[index].elementName = (name || '').trim() || null;
}

/**
 * Select suggested readings (GREEN + YELLOW) with risk disclaimer.
 * Marks all GREEN and YELLOW readings as selected; RED stays unselected.
 * Shows a visible disclaimer warning the user to review before confirming.
 */
export function handleDocSelectSuggested() {
    if (!_docState || !_docState.readings) return;
    _docState.selected = new Set();
    _docState.readings.forEach((r, i) => {
        if (r.confidence === 'green' || r.confidence === 'yellow') {
            _docState.selected.add(i);
        }
    });
    _docState.disclaimerVisible = true;
    _renderDocReview();
}

/**
 * Run AI analysis in BACKGROUND — no loading overlay.
 * User continues reviewing/classifying manually while AI suggests progressively.
 * Each classification updates the table in-place without re-rendering the whole view.
 * Requires LLM API key to be configured (sessionStorage).
 */
export async function handleDocAnalyzeAI() {
    if (!_docState) return;
    if (!isLLMAvailable()) {
        // F6: Auto-abrir modal de configuracao LLM
        showToast('Configure uma API key para habilitar analise por IA', 'warning');
        if (typeof window.openLLMConfig === 'function') {
            window.openLLMConfig();
        }
        return;
    }
    if (_docState._aiRunning) return; // prevent double-start

    const { readings, images } = _docState;
    _docState._aiRunning = true;
    _docState._aiProgress = { done: 0, total: 0, phase: 'starting' };
    _updateAIStatusIndicator();

    try {
        // Phase 1: Analyze images (if any)
        if (images && images.length > 0) {
            _docState._aiProgress.phase = 'images';
            _docState._aiProgress.total = images.length;
            _updateAIStatusIndicator();

            const imageResults = await analyzeDocumentImages(images, {
                onProgress: (idx, total) => {
                    _docState._aiProgress.done = idx + 1;
                    _docState._aiProgress.total = total;
                    _updateAIStatusIndicator();
                },
            });
            _docState.imageAnalysis = imageResults;

            const familyAgg = aggregateDetectedFamilies(imageResults);
            if (familyAgg.length > 0) {
                console.log('[DocAI] Families detected in images:', familyAgg);
            }
            // Re-render to show image analysis results
            _renderDocReview();
        }

        // Phase 2: Classify tables progressively
        if (readings && readings.length > 0) {
            const pageGroups = new Map();
            for (const r of readings) {
                const page = r.source?.page || 0;
                if (!pageGroups.has(page)) pageGroups.set(page, []);
                pageGroups.get(page).push(r);
            }

            _docState._aiProgress.phase = 'tables';
            _docState._aiProgress.done = 0;
            _docState._aiProgress.total = pageGroups.size;
            _updateAIStatusIndicator();

            let groupIdx = 0;
            for (const [page, group] of pageGroups) {
                if (!_docState || !_docState._aiRunning) break; // cancelled

                const headers = [...new Set(group.map((r) => r.parameterName).filter(Boolean))].slice(0, 5);
                const sampleRows = group
                    .slice(0, 3)
                    .map((r) => [r.parameterName || '', String(r.value ?? ''), r.unit || '']);

                try {
                    const classification = await classifyTableFamily(headers, sampleRows);
                    if (classification.family !== 'generic' && classification.confidence > 0.5) {
                        let updated = 0;
                        for (const r of group) {
                            if (r.family === 'generic') {
                                r.family = classification.family;
                                r._aiSuggested = true;
                                updated++;
                            }
                        }
                        if (updated > 0) {
                            console.log(
                                `[DocAI] Page ${page}: ${updated} readings → "${classification.family}" (${(classification.confidence * 100).toFixed(0)}%)`,
                            );
                            // Progressive update — re-render to show AI suggestion
                            _renderDocReview();
                        }
                    }
                } catch (e) {
                    console.warn(`[DocAI] Classification failed for page ${page}:`, e.message);
                }

                groupIdx++;
                _docState._aiProgress.done = groupIdx;
                _updateAIStatusIndicator();
            }
        }

        if (_docState) {
            _docState._aiRunning = false;
            _docState._aiProgress = { done: 0, total: 0, phase: 'done' };
            _updateAIStatusIndicator();
            showToast('Analise com IA concluida', 'success');
        }
    } catch (err) {
        console.error('[DocAI] AI analysis error:', err);
        if (_docState) {
            _docState._aiRunning = false;
            _docState._aiProgress = null;
        }
        showToast(`Erro na analise AI: ${err.message}`, 'error');
    }
}

/**
 * Update the AI status indicator in the review table (inline, no overlay).
 * Uses DOM patching to avoid full re-render (user might be mid-edit).
 */
function _updateAIStatusIndicator() {
    const indicator = document.getElementById('doc-ai-status');
    if (!indicator || !_docState) return;

    const p = _docState._aiProgress;
    if (!p || p.phase === 'done') {
        indicator.innerHTML = _docState.imageAnalysis
            ? '<span style="color:var(--success-600);font-size:10px;">&#10003; IA concluida</span>'
            : '';
        return;
    }

    const phase = p.phase === 'images' ? 'Imagens' : 'Tabelas';
    const progress = p.total > 0 ? ` (${p.done}/${p.total})` : '';
    indicator.innerHTML = `
        <span style="font-size:10px;color:var(--primary-500);display:inline-flex;align-items:center;gap:4px;">
            <span style="width:10px;height:10px;border:2px solid rgba(94,234,212,0.3);border-top-color:#5eead4;border-radius:50%;animation:ecbt-spin 0.8s linear infinite;display:inline-block;"></span>
            ${phase}${progress}
        </span>`;
}

/**
 * Auto-match well IDs from document to existing elements by name.
 * Normalizes names for fuzzy matching (PM-01 = pm01 = PM 01).
 */
function _autoMatchWells(wellIds) {
    const normalize = (name) =>
        (name || '')
            .trim()
            .toLowerCase()
            .replace(/[\s\-_.]+/g, '');
    const existing = getAllElements();
    const existingMap = new Map();
    for (const el of existing) {
        existingMap.set(normalize(el.name), el);
    }

    const matches = new Map();
    for (const wellId of wellIds) {
        const norm = normalize(wellId);
        const match = existingMap.get(norm) || null;
        matches.set(wellId, {
            action: match ? 'link' : 'create',
            existingElement: match,
            elementId: match?.id || null,
        });
    }
    return matches;
}

/**
 * Scatter position for new elements (circular layout).
 */
function _getScatterPosition(index, total) {
    const radius = 5;
    const angle = (2 * Math.PI * index) / Math.max(total, 1);
    return { x: radius * Math.cos(angle), z: radius * Math.sin(angle) };
}

/**
 * Render mapping modal inside ingestion content.
 * Shows each unique well ID with action dropdown (link/create/ignore).
 */
function _renderMappingModal() {
    const container = document.getElementById('ingestion-content');
    if (!container || !_docState || !_docState._mapping) return;

    const { _mapping, _extractedFields } = _docState;
    const wellIds = [..._mapping.keys()];
    const existing = getAllElements();

    let html = `
        <div style="margin-bottom:12px;">
            <h3 style="margin:0 0 4px;font-size:14px;color:var(--neutral-800);">Mapeamento de Elementos</h3>
            <p style="font-size:11px;${S_MUTED}margin:0;">${wellIds.length} ponto(s) encontrado(s) no documento</p>
        </div>
    `;

    // Mapping table
    html += `<div style="max-height:250px;overflow-y:auto;border:1px solid var(--neutral-200);border-radius:6px;margin-bottom:10px;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead><tr style="${S_TABLE_HEADER}">
                <th style="padding:6px;text-align:left;">Documento</th>
                <th style="padding:6px;text-align:left;width:120px;">Acao</th>
                <th style="padding:6px;text-align:left;">Destino</th>
            </tr></thead><tbody>`;

    for (const wellId of wellIds) {
        const m = _mapping.get(wellId);
        const hasMatch = !!m.existingElement;
        const rowBg = hasMatch ? 'background:rgba(16,185,129,0.05);' : '';

        // Build existing elements dropdown
        const existingOpts = existing
            .map(
                (el) =>
                    `<option value="${el.id}" ${m.elementId === el.id ? 'selected' : ''}>${escapeHtml(el.name)} (${el.family})</option>`,
            )
            .join('');

        html += `<tr style="${S_TABLE_ROW}${rowBg}">
            <td style="padding:4px 6px;font-weight:600;color:var(--neutral-800);">${escapeHtml(wellId)}</td>
            <td style="padding:4px 6px;">
                <select style="font-size:10px;padding:2px;border:1px solid var(--neutral-200);border-radius:4px;width:110px;background:var(--neutral-50);color:var(--neutral-800);"
                        onchange="window._docMappingAction('${escapeHtml(wellId)}', this.value)">
                    <option value="link" ${m.action === 'link' ? 'selected' : ''}>Vincular</option>
                    <option value="create" ${m.action === 'create' ? 'selected' : ''}>Criar novo</option>
                    <option value="ignore" ${m.action === 'ignore' ? 'selected' : ''}>Ignorar</option>
                </select>
            </td>
            <td style="padding:4px 6px;font-size:10px;color:var(--neutral-600);">
                ${
                    m.action === 'link'
                        ? `<select style="font-size:10px;padding:2px;border:1px solid var(--neutral-200);border-radius:4px;max-width:150px;background:var(--neutral-50);color:var(--neutral-800);"
                    onchange="window._docMappingTarget('${escapeHtml(wellId)}', this.value)">
                    ${existingOpts}
                </select>${hasMatch ? ' <span style="color:#10b981;">&#10003;</span>' : ''}`
                        : ''
                }
                ${m.action === 'create' ? '<span style="color:var(--neutral-400);">(novo elemento)</span>' : ''}
                ${m.action === 'ignore' ? '<span style="color:var(--neutral-400);">--</span>' : ''}
            </td>
        </tr>`;
    }

    html += `</tbody></table></div>`;

    // Extracted fields preview (before/after)
    if (_extractedFields && _extractedFields.length > 0) {
        html += `<details style="margin-bottom:10px;border:1px solid var(--neutral-200);border-radius:6px;padding:8px;">
            <summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--neutral-800);">
                Campos Detectados (${_extractedFields.length})
            </summary>
            <table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:6px;">
                <thead><tr style="background:var(--neutral-50);">
                    <th style="padding:4px 6px;text-align:left;">Campo</th>
                    <th style="padding:4px 6px;text-align:left;">Valor no Documento</th>
                    <th style="padding:4px 6px;text-align:center;width:50px;">Importar</th>
                </tr></thead><tbody>`;

        for (let fi = 0; fi < _extractedFields.length; fi++) {
            const f = _extractedFields[fi];
            const checked = f._import !== false;
            html += `<tr style="${S_TABLE_ROW}">
                <td style="padding:3px 6px;color:var(--neutral-600);">${escapeHtml(f.field.split('.').pop())}</td>
                <td style="padding:3px 6px;font-family:monospace;color:var(--neutral-800);">${escapeHtml(String(f.value))}</td>
                <td style="padding:3px 6px;text-align:center;">
                    <input type="checkbox" ${checked ? 'checked' : ''}
                           onchange="window._docFieldToggle(${fi}, this.checked)">
                </td>
            </tr>`;
        }

        html += `</tbody></table></details>`;
    }

    // Counters
    const linkCount = wellIds.filter((w) => _mapping.get(w).action === 'link').length;
    const createCount = wellIds.filter((w) => _mapping.get(w).action === 'create').length;
    const ignoreCount = wellIds.filter((w) => _mapping.get(w).action === 'ignore').length;

    html += `<p style="font-size:10px;${S_MUTED}margin:4px 0 8px;">${linkCount} vincular, ${createCount} criar, ${ignoreCount} ignorar</p>`;

    // Action buttons
    html += `<div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--neutral-200);padding-top:12px;">
        <button class="btn btn-secondary" onclick="window._docMappingBack()">Voltar</button>
        <button class="btn btn-primary" onclick="window._docMappingConfirm()">Confirmar Importacao</button>
    </div>`;

    container.innerHTML = html;
}

/**
 * Ingest selected document readings — shows mapping modal first.
 * 100% human-in-the-loop — user maps each well before import.
 */
export async function handleDocIngest() {
    if (!_docState || !_docState.readings) return;

    const { readings, selected } = _docState;
    const decisions = _ensureDocDecisions();
    const selectedReadings = readings.filter((_, i) => selected.has(i));

    if (selectedReadings.length === 0) {
        showToast('Nenhuma leitura selecionada', 'error');
        return;
    }

    const unresolvedKeys = new Set();
    for (const row of selectedReadings) {
        if (!isDocMatrixAmbiguous(row)) continue;
        const key = buildDocMatrixKey(row);
        if (!normalizeDocMatrixValue(decisions.matrixOverrides?.[key])) {
            unresolvedKeys.add(key);
        }
    }
    if (unresolvedKeys.size > 0) {
        showToast(`Defina a matriz para ${unresolvedKeys.size} tabela(s) ambigua(s) antes de confirmar`, 'warning');
        _renderDocReview();
        return;
    }

    if (_docState?._piiDetection?.detected && decisions.lgpdStrategy === 'block') {
        showToast('Importacao bloqueada pela decisao LGPD atual', 'warning');
        _renderDocReview();
        return;
    }

    // Collect unique well IDs
    const wellIds = [...new Set(selectedReadings.map((r) => r.elementName).filter(Boolean))];

    if (wellIds.length === 0) {
        // No well IDs - skip mapping, go straight to import
        _docState._mapping = new Map([['_default', { action: 'create', existingElement: null, elementId: null }]]);
        _docState._selectedReadings = selectedReadings;
        _docMappingConfirm();
        return;
    }

    // Auto-match and show mapping modal
    _docState._mapping = _autoMatchWells(wellIds);
    _docState._selectedReadings = selectedReadings;

    // Extract fields from document text (if available)
    try {
        const { extractFields } = await import('../../core/ingestion/documents/index.js');
        const fullText =
            String(_docState.rawText || '') ||
            selectedReadings
                .map((r) => [r.source?.text || '', r.parameterName || '', r.elementName || ''].join(' '))
                .join(' ');
        _docState._extractedFields = extractFields(fullText);
    } catch (_) {
        _docState._extractedFields = [];
    }

    _renderMappingModal();
}

/**
 * P2: Analyze PDF pages as images with LLM Vision.
 * Renders each page as image, sends to LLM for classification.
 * Results stored in _docState._pageAnalysis.
 */
export async function handleDocAnalyzePages() {
    const state = _docState;
    if (!state) return;
    if (!isLLMAvailable()) {
        showToast('Configure uma API key para analisar paginas', 'warning');
        if (typeof window.openLLMConfig === 'function') window.openLLMConfig();
        return;
    }
    if (state._aiPagesRunning) return;

    const MAX_PAGES = 20;
    const pageCount = state.pageCount || 0;
    if (pageCount === 0) {
        showToast('Nenhuma pagina disponivel para analise', 'error');
        return;
    }

    const pagesToAnalyze = Math.min(pageCount, MAX_PAGES);
    state._aiPagesRunning = true;
    state._pageAnalysis = new Map();
    const runToken = Symbol('doc-pages-analysis');
    state._aiPagesRunToken = runToken;

    // Update UI with progress
    const updateStatus = (msg) => {
        const statusEl = document.getElementById('doc-pages-status');
        if (statusEl) statusEl.textContent = msg;
    };
    updateStatus(`Analisando paginas... 0/${pagesToAnalyze}`);

    try {
        for (let p = 1; p <= pagesToAnalyze; p++) {
            // Abort safely if modal/state was reset mid-run.
            if (!_docState || _docState !== state || state._aiPagesRunToken !== runToken) break;
            updateStatus(`Pagina ${p}/${pagesToAnalyze}`);

            try {
                // Use existing analyzeDocumentImages with a page-rendered image
                // For now, analyze using raw text per page (no rendering needed)
                const pageText = _extractPageText(state.rawText, p, pageCount);
                if (pageText && pageText.length > 20) {
                    const { extractDocumentMetadata } = await import('../../core/ingestion/documents/index.js');
                    const meta = await extractDocumentMetadata(pageText);
                    if (!_docState || _docState !== state || state._aiPagesRunToken !== runToken) break;
                    state._pageAnalysis.set(p, {
                        type: meta.reportType || 'unknown',
                        hasTable: /composto|parametro|resultado|concentra/i.test(pageText),
                        hasMap: /mapa|figura|fig\./i.test(pageText),
                        summary: pageText.substring(0, 100),
                    });
                }
            } catch (e) {
                console.warn(`[ingestion] Page ${p} analysis failed:`, e.message);
            }
        }

        if (!_docState || _docState !== state || state._aiPagesRunToken !== runToken) return;
        const analyzed = state._pageAnalysis?.size || 0;
        updateStatus(`${analyzed} paginas analisadas`);
        showToast(`${analyzed} paginas analisadas pela IA`, 'success');
    } catch (err) {
        console.error('[ingestion] Page analysis error:', err);
        if (_docState === state) {
            showToast('Erro na analise de paginas', 'error');
        }
    } finally {
        if (_docState === state && state._aiPagesRunToken === runToken) {
            state._aiPagesRunning = false;
            state._aiPagesRunToken = null;
        }
    }
}

/**
 * Extract approximate text for a specific page from rawText.
 * Simple heuristic: split by "Página N" markers.
 */
function _extractPageText(rawText, pageNum, totalPages) {
    if (!rawText) return '';
    const marker = `Página ${pageNum}`;
    const nextMarker = `Página ${pageNum + 1}`;
    const start = rawText.indexOf(marker);
    if (start === -1) return '';
    const end = rawText.indexOf(nextMarker, start);
    return rawText.substring(start, end === -1 ? start + 2000 : end);
}

// Mapping modal handlers
export function _docMappingAction(wellId, action) {
    if (!_docState?._mapping) return;
    const m = _docState._mapping.get(wellId);
    if (m) m.action = action;
    _renderMappingModal();
}

export function _docMappingTarget(wellId, elementId) {
    if (!_docState?._mapping) return;
    const m = _docState._mapping.get(wellId);
    if (m) m.elementId = elementId;
}

export function _docMappingBack() {
    if (!_docState) return;
    _docState._mapping = null;
    _renderDocReview();
}

export function _docFieldToggle(index, checked) {
    if (!_docState?._extractedFields?.[index]) return;
    _docState._extractedFields[index]._import = checked;
}

/**
 * E2E test hook: force document ingestion state and render corresponding screen.
 * Keeps production logic untouched while enabling deterministic Playwright scenarios.
 *
 * @param {Object|null} nextState
 */
export function __setDocStateForTesting(nextState) {
    if (!nextState) {
        _docState = null;
        renderIngestionStep();
        return;
    }
    _docState = { ...nextState };
    if (!(_docState.selected instanceof Set)) {
        const incoming = Array.isArray(_docState.selected) ? _docState.selected : [];
        _docState.selected = new Set(incoming);
    }
    if (!_docState.step) _docState.step = 'review';
    _ensureDocDecisions();
    if (_docState.step === 'post_visual') {
        _renderDocVisualWizard();
    } else {
        _docState.step = 'review';
        _renderDocReview();
    }
}

/**
 * E2E test hook: read current in-memory doc ingestion state.
 * @returns {Object|null}
 */
export function __getDocStateForTesting() {
    return _docState;
}

function _downloadDocAsset(item) {
    const asset = item?.asset || {};
    let href = asset.blobUrl || asset.dataUrl || '';
    let shouldRevoke = false;

    if (!href && asset.blob) {
        href = URL.createObjectURL(asset.blob);
        shouldRevoke = true;
    }
    if (!href) return false;

    const rawLabel = _getDocVisualAssetLabel(item.assetType || 'asset').toLowerCase();
    const safeLabel = rawLabel.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
    const pageSuffix = item?.page ? `p${item.page}` : `idx${item?.index ?? 0}`;
    const mime = asset.blob?.type || asset.mimeType || '';
    const ext = /png/i.test(mime) ? 'png' : /jpe?g/i.test(mime) ? 'jpg' : 'bin';

    const a = document.createElement('a');
    a.href = href;
    a.download = `doc-${safeLabel}-${pageSuffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (shouldRevoke) {
        setTimeout(() => {
            try {
                URL.revokeObjectURL(href);
            } catch {
                /* noop */
            }
        }, 1200);
    }
    return true;
}

function _renderDocVisualWizard() {
    const container = document.getElementById('ingestion-content');
    if (!container || !_docState) return;

    const decisions = _ensureDocDecisions();
    const assets = Array.isArray(_docState._postImportVisualAssets)
        ? _docState._postImportVisualAssets
        : _collectDocVisualAssets();
    if (!assets.length) {
        _docVisualFinish();
        return;
    }

    const summary = _docState._importSummary || {};
    let selectedActions = 0;
    for (const item of assets) {
        const action = decisions.visualActions?.[item.assetKey] || {};
        if (action.createAsset || action.download) selectedActions++;
    }

    let html = `
        <div style="margin-bottom:12px;">
            <h3 style="margin:0 0 4px;font-size:14px;color:var(--neutral-800);">Wizard Visual Pos-Import</h3>
            <p style="font-size:11px;${S_MUTED}margin:0;">
                Importacao principal concluida: ${summary.totalReadings || 0} leitura(s), ${summary.elementsLinked || 0} vinculo(s), ${summary.elementsCreated || 0} elemento(s) criado(s).
            </p>
        </div>
    `;

    html += `<div style="max-height:320px;overflow-y:auto;border:1px solid var(--neutral-200);border-radius:6px;margin-bottom:10px;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead><tr style="${S_TABLE_HEADER}">
                <th style="padding:6px;text-align:left;">Asset</th>
                <th style="padding:6px;text-align:center;width:70px;">Criar</th>
                <th style="padding:6px;text-align:center;width:80px;">Download</th>
                <th style="padding:6px;text-align:left;width:120px;">Familia</th>
            </tr></thead><tbody>`;

    for (const item of assets) {
        const action = decisions.visualActions?.[item.assetKey] || {};
        const createChecked = action.createAsset === true;
        const downloadChecked = action.download === true;
        const selectedFamily = DOC_VISUAL_FAMILIES.includes(action.targetFamily)
            ? action.targetFamily
            : DOC_VISUAL_FAMILIES.includes(item.suggestedFamily)
              ? item.suggestedFamily
              : 'generic';
        const assetLabel = `${_getDocVisualAssetLabel(item.assetType)}${item.page ? ` p.${item.page}` : ''}`;
        const thumb = item.asset?.blobUrl
            ? `<img src="${item.asset.blobUrl}" alt="${escapeHtml(assetLabel)}" style="width:42px;height:32px;object-fit:cover;border-radius:4px;border:1px solid var(--neutral-200);margin-right:6px;">`
            : `<span style="display:inline-flex;align-items:center;justify-content:center;width:42px;height:32px;border:1px dashed var(--neutral-300);border-radius:4px;margin-right:6px;font-size:9px;${S_MUTED}">N/A</span>`;

        html += `<tr style="${S_TABLE_ROW}">
            <td style="padding:4px 6px;color:var(--neutral-800);">
                <div style="display:flex;align-items:center;">
                    ${thumb}
                    <div>
                        <strong>${escapeHtml(assetLabel)}</strong>
                        <div style="font-size:9px;${S_MUTED}">${escapeHtml(item.classification?.method || 'heuristic')}</div>
                    </div>
                </div>
            </td>
            <td style="padding:4px 6px;text-align:center;">
                <input type="checkbox" ${createChecked ? 'checked' : ''}
                       onchange="window._docVisualActionSet('${escapeHtml(item.assetKey)}', 'createAsset', this.checked)">
            </td>
            <td style="padding:4px 6px;text-align:center;">
                <input type="checkbox" ${downloadChecked ? 'checked' : ''}
                       onchange="window._docVisualActionSet('${escapeHtml(item.assetKey)}', 'download', this.checked)">
            </td>
            <td style="padding:4px 6px;">
                <select style="font-size:10px;padding:2px 4px;border:1px solid var(--neutral-200);border-radius:4px;background:var(--neutral-50);color:var(--neutral-800);"
                        onchange="window._docVisualActionFamily('${escapeHtml(item.assetKey)}', this.value)">
                    ${DOC_VISUAL_FAMILIES.map((f) => `<option value="${f}" ${selectedFamily === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
                </select>
            </td>
        </tr>`;
    }

    html += `</tbody></table></div>`;
    html += `<p style="font-size:10px;${S_MUTED}margin:4px 0 8px;">${selectedActions} item(ns) com acao selecionada.</p>`;
    html += `<div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--neutral-200);padding-top:12px;">
        <button class="btn btn-secondary" onclick="window._docVisualFinish()">Concluir</button>
        <button class="btn btn-primary" onclick="window._docVisualApplySelected()" ${selectedActions === 0 ? 'disabled' : ''}>Aplicar Acoes</button>
    </div>`;

    container.innerHTML = html;
}

export function _docVisualActionSet(assetKey, field, value) {
    if (!_docState || !assetKey) return;
    const decisions = _ensureDocDecisions();
    if (!decisions.visualActions || typeof decisions.visualActions !== 'object') {
        decisions.visualActions = {};
    }
    const current = { ...(decisions.visualActions[assetKey] || {}) };
    current[field] = value === true || value === 'true' || value === 1;
    if (!current.targetFamily) current.targetFamily = 'generic';
    decisions.visualActions[assetKey] = current;
    _docState._decisions = decisions;
    _renderDocVisualWizard();
}

export function _docVisualActionFamily(assetKey, family) {
    if (!_docState || !assetKey) return;
    const decisions = _ensureDocDecisions();
    if (!decisions.visualActions || typeof decisions.visualActions !== 'object') {
        decisions.visualActions = {};
    }
    const current = { ...(decisions.visualActions[assetKey] || {}) };
    current.targetFamily = DOC_VISUAL_FAMILIES.includes(family) ? family : 'generic';
    decisions.visualActions[assetKey] = current;
    _docState._decisions = decisions;
    _renderDocVisualWizard();
}

export function _docVisualFinish() {
    handleCloseIngestionModal();
    if (updateAllUI) updateAllUI();
}

export function _docVisualApplySelected() {
    if (!_docState) return;
    const decisions = _ensureDocDecisions();
    const assets = Array.isArray(_docState._postImportVisualAssets) ? _docState._postImportVisualAssets : [];

    if (assets.length === 0) {
        _docVisualFinish();
        return;
    }

    let created = 0;
    let downloaded = 0;
    let failures = 0;
    const ts = Date.now();
    let scatterIdx = 0;

    for (const item of assets) {
        const action = decisions.visualActions?.[item.assetKey] || {};
        if (!action.createAsset && !action.download) continue;

        if (action.createAsset) {
            try {
                const family = DOC_VISUAL_FAMILIES.includes(action.targetFamily)
                    ? action.targetFamily
                    : DOC_VISUAL_FAMILIES.includes(item.suggestedFamily)
                      ? item.suggestedFamily
                      : 'generic';
                const pos = _getScatterPosition(scatterIdx++, Math.max(assets.length, 1));
                const id = `doc-visual-${family}-${ts}-${created}`;
                const label = `${_getDocVisualAssetLabel(item.assetType)}${item.page ? ` p.${item.page}` : ''}`;

                const data = {
                    x: pos.x,
                    y: 0,
                    z: pos.z,
                    source: 'document_ingestion',
                    assetType: item.assetType,
                    page: item.page || null,
                    ingestionFile: _docState.fileName || null,
                    previewUrl: item.asset?.blobUrl || item.asset?.dataUrl || null,
                    classification: item.classification || null,
                };

                if (family === 'plume') {
                    data.depth = { level: 'shallow', top: 0, bottom: -5 };
                    data.shape = { radiusX: 6, radiusY: 4, radiusZ: 2 };
                    data.center = { x: pos.x, y: -2, z: pos.z };
                }

                addElement(family, id, label, data);
                created++;
            } catch (err) {
                failures++;
                console.warn('[ingestion] Visual create failed:', err.message);
            }
        }

        if (action.download) {
            const ok = _downloadDocAsset(item);
            if (ok) downloaded++;
            else failures++;
        }
    }

    const parts = [];
    if (created > 0) parts.push(`${created} ativo(s) visual(is)`);
    if (downloaded > 0) parts.push(`${downloaded} download(s)`);
    if (failures > 0) parts.push(`${failures} falha(s)`);
    if (parts.length > 0) {
        showToast(`Wizard visual concluido: ${parts.join(', ')}`, failures > 0 ? 'warning' : 'success');
    }

    _docVisualFinish();
}

/**
 * Confirm mapping and execute import.
 */
export async function _docMappingConfirm() {
    if (!_docState || !_docState._mapping) return;

    const { fileName, _mapping } = _docState;
    const decisions = _ensureDocDecisions();
    const selectedReadings = Array.isArray(_docState._selectedReadings)
        ? _docState._selectedReadings
        : (_docState.readings || []).filter((_, i) => _docState.selected?.has(i));

    if (selectedReadings.length === 0) {
        showToast('Nenhuma leitura selecionada', 'error');
        return;
    }

    if (_docState?._piiDetection?.detected && decisions.lgpdStrategy === 'block') {
        showToast('Importacao bloqueada pela decisao LGPD atual', 'warning');
        return;
    }

    const unresolved = new Set();
    for (const row of selectedReadings) {
        if (!isDocMatrixAmbiguous(row)) continue;
        const key = buildDocMatrixKey(row);
        if (!normalizeDocMatrixValue(decisions.matrixOverrides?.[key])) {
            unresolved.add(key);
        }
    }
    if (unresolved.size > 0) {
        showToast(`Resolva ${unresolved.size} matriz(zes) ambigua(s) antes de confirmar`, 'warning');
        return;
    }

    try {
        let elementsCreated = 0;
        let elementsLinked = 0;
        let totalReadings = 0;
        const ts = Date.now();
        let createIndex = 0;

        const piiDetection = _docState._piiDetection || null;
        const fallbackDate = selectedReadings.find((r) => r.dateLabel)?.dateLabel || new Date().toISOString();
        const profilePatch = buildWellProfilePatch(_docState._extractedFields || [], fallbackDate);

        const preparedReadings = selectedReadings.map((reading) => {
            let next = { ...reading, source: { ...(reading.source || {}) } };
            const matrixKey = buildDocMatrixKey(reading);
            const matrixOverride = normalizeDocMatrixValue(decisions.matrixOverrides?.[matrixKey]);
            if (matrixOverride) next.matrix = matrixOverride;
            if (piiDetection?.detected && decisions.lgpdStrategy === 'pseudonymize') {
                next = _redactDocReadingSource(next, piiDetection);
            }
            return next;
        });

        // Group readings by wellId
        const wellGroups = new Map();
        for (const r of preparedReadings) {
            const key = r.elementName || '_default';
            if (!wellGroups.has(key)) wellGroups.set(key, []);
            wellGroups.get(key).push(r);
        }

        for (const [wellId, group] of wellGroups) {
            const mapping = _mapping.get(wellId) || { action: 'create' };
            if (mapping.action === 'ignore') continue;

            const observations = group.map((r) => ({
                parameterId: r.parameterId,
                value: r.value,
                unit: r.unitId || r.unit || '',
                operator: r.operator || '=',
                date: r.dateLabel || fallbackDate,
                timestamp: new Date().toISOString(),
                cost: r.cost || null,
                matrix: r.matrix || null,
                sample_matrix: r.matrix || null,
                source: r.source || null,
            }));

            if (mapping.action === 'link' && mapping.elementId) {
                const el = getElementById(mapping.elementId);
                if (!el) continue;

                const data = { ...(el.data || {}) };
                const existingObs = Array.isArray(data.observations) ? data.observations : [];
                data.observations = [...existingObs, ...observations];

                if (el.family === 'well' && profilePatch && decisions.profileConflictStrategy !== 'skip') {
                    data.profile = mergeWellProfileByStrategy(
                        data.profile || null,
                        profilePatch,
                        decisions.profileConflictStrategy,
                    );
                }

                updateElement(el.id, { data });
                elementsLinked++;
            } else {
                const inferredFamily = wellId !== '_default' ? 'well' : group[0]?.family || 'well';
                const familyId = DEFAULT_FAMILIES[inferredFamily] ? inferredFamily : 'well';
                const elName = wellId !== '_default' ? wellId : `Import: ${fileName} #${elementsCreated + 1}`;
                const elId = `doc-${familyId}-${ts}-${elementsCreated}`;
                const pos = _getScatterPosition(createIndex++, Math.max(wellGroups.size, 1));

                const data = {
                    x: pos.x,
                    y: 0,
                    z: pos.z,
                    observations,
                };

                if (familyId === 'well') {
                    data.coordinates = {
                        easting: pos.x,
                        northing: -pos.z,
                        elevation: 0,
                    };
                    if (profilePatch && decisions.profileConflictStrategy !== 'skip') {
                        data.profile = mergeWellProfileByStrategy(
                            null,
                            profilePatch,
                            decisions.profileConflictStrategy,
                        );
                    }
                }

                addElement(familyId, elId, elName, data);
                elementsCreated++;
            }

            totalReadings += group.length;
        }

        const msg = [];
        if (elementsLinked > 0) msg.push(`${elementsLinked} vinculado(s)`);
        if (elementsCreated > 0) msg.push(`${elementsCreated} criado(s)`);
        showToast(`${totalReadings} leitura(s) importada(s) -- ${msg.join(', ') || 'sem alteracoes'}`, 'success');

        // Register source file in Files panel when enabled by decision.
        if (decisions.saveInFiles) {
            const sourceFile = _docState?._sourceFile;
            if (sourceFile) {
                try {
                    const mode = getFileRegisterMode();
                    const reg = await registerFromIngestion(sourceFile, { mode, source: 'document' });
                    if (!reg?.ok) {
                        console.warn('[ingestion] File register failed:', reg?.error || 'unknown error');
                        showToast('Falha ao salvar arquivo no Files. Importacao principal mantida.', 'warning');
                    }
                } catch (regErr) {
                    console.warn('[ingestion] File register failed:', regErr.message);
                    showToast('Falha ao salvar arquivo no Files. Importacao principal mantida.', 'warning');
                }
            }
        }

        _docState._importSummary = {
            totalReadings,
            elementsCreated,
            elementsLinked,
        };

        const visualAssets = decisions.visualWizardEnabled ? _collectDocVisualAssets() : [];
        if (decisions.visualWizardEnabled && visualAssets.length > 0) {
            _docState.step = 'post_visual';
            _docState._postImportVisualAssets = visualAssets;
            _docState._mapping = null;
            _docState._selectedReadings = null;
            _renderDocVisualWizard();
            return;
        }

        handleCloseIngestionModal();
        if (updateAllUI) updateAllUI();
    } catch (err) {
        console.error('Document ingest error:', err);
        showToast(`Erro na importacao: ${err.message}`, 'error');
    }
}

// ----------------------------------------------------------------
// EXPORTS
// ----------------------------------------------------------------

export const ingestionHandlers = {
    handleOpenIngestionModal,
    handleCloseIngestionModal,
    handleIngestionFileUpload,
    handleIngestionDirectFile,
    handleIngestionNext,
    handleIngestionBack,
    handleIngestionExecute,
    handleIngestionColumnOverride,
    handleIngestionResolveAmbiguity,
    handleIngestionMapWithAI,
    handleShowMoreObservations,
    handleShowAllObservations,
    handleToggleObsCampaign,
    handleExpandObservation,
    _ingestionDecision,
    handleDownloadECO1Backup,
    handleDownloadTemplate,
    handleDocToggleAll,
    handleDocToggleReading,
    handleDocToggleHideRed,
    _docDecision,
    _docSetMatrixOverride,
    handleDocCancel,
    handleDocIngest,
    handleDocChangeFamily,
    handleDocChangeElementName,
    handleDocSelectSuggested,
    handleDocAnalyzeAI,
    handleDocAnalyzePages,
    handleDocSelectGreen,
    _docShowSource,
    _docSetActiveRow,
    _docSelectRow,
    _docPrevPage,
    _docNextPage,
    _docGoToPage,
    _docMappingAction,
    _docMappingTarget,
    _docMappingBack,
    _docMappingConfirm,
    _docFieldToggle,
    _docVisualActionSet,
    _docVisualActionFamily,
    _docVisualApplySelected,
    _docVisualFinish,
    __setDocStateForTesting,
    __getDocStateForTesting,
};
