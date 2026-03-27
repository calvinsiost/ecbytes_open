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
   AERIAL RECOGNITION HANDLERS — UI for image-based element detection
   ================================================================

   Handlers para o modal de reconhecimento de imagem aerea.
   Permite ao usuario carregar imagem aerea (do limite existente ou
   upload) e detectar feicoes ambientais via IA, algoritmo de cores,
   ou ML (OWL-ViT zero-shot detection via Transformers.js).

   FLUXO:
   1. Selecionar fonte da imagem (overlay do limite ou upload)
   2. Escolher metodo (IA Vision ou Analise de Cores)
   3. Analisar → preview das feicoes detectadas
   4. Confirmar → cria elementos no modelo 3D + grupo automatico

   ================================================================ */

import {
    analyzeWithAI,
    analyzeWithAlgorithm,
    analyzeWithML,
    isMLModelLoaded,
    loadImageAsDataUrl,
    readFileAsDataUrl,
    vectorize,
} from '../../core/recognition/analyzer.js';
import {
    analyzeWithSLIC,
    analyzeWithYOLOS,
    isYOLOSLoaded,
    loadSAM,
    setSAMImage,
    segmentAtPoint,
    getSAMStatus,
    clearSAMCache,
    selectSAMModel,
} from '../../core/recognition/analyzer.js';
import { generateAutoMasks, autoMasksToFeatures } from '../../core/recognition/analyzer.js';
import { segmentByText, getCLIPStatus } from '../../core/recognition/analyzer.js';
import { segmentFromTiles } from '../../core/recognition/analyzer.js';
import { detectInstances, detectInstancesNative, isMaskFormerLoaded } from '../../core/recognition/analyzer.js';
import { detectChanges } from '../../core/recognition/analyzer.js';
import { classifyScene } from '../../core/recognition/analyzer.js';
import { enhanceImage } from '../../core/recognition/analyzer.js';
import { computeVNDVI, computeSAVI, computeWaterIndex, renderIndexOverlay } from '../../core/recognition/analyzer.js';
import {
    computeHandcraftedEmbedding,
    storeTileEmbedding,
    searchSimilarTiles,
    getEmbeddingStats,
} from '../../core/recognition/analyzer.js';
import { DEFAULT_CALIBRATION, autoCalibrate } from '../../core/recognition/calibration.js';
import {
    resetNetwork,
    isNetworkTrained,
    trainNetwork,
    classifyWithUserNN,
    extractTrainingData,
    getClassifierFamilies,
    getFamilyIndex,
    exportClassifier,
    importClassifier,
    persistClassifier,
    loadClassifier,
    setClassifierStrokes,
} from '../../core/recognition/userClassifier.js';
import { getElementsByFamily, addElement } from '../../core/elements/manager.js';
import { generateId } from '../helpers/id.js';
import { getIcon, hydrateIcons } from '../ui/icons.js';
import { openModal, closeModal, buildModalShell } from '../ui/modals.js';
import { wgs84ToUTM, utmToWGS84, getOrigin, setOrigin, hasOrigin } from '../../core/io/geo/coordinates.js';
import { buildTransform, pixelToWorld } from '../../core/ingestion/documents/mapGeoreferencer.js';
import { importCDN, loadScriptCDN } from '../helpers/cdnLoader.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { hasApiKey, sendMessage } from '../../core/llm/client.js';
import { addElementGroup, setElementGroup } from '../groups/manager.js';
import { drawFeatureOutline, roundRect, drawAnnotationMarker } from '../../core/recognition/featureRenderer.js';
import { escapeHtml, escapeAttr } from '../helpers/html.js';
import { CONFIG } from '../../config.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

let _updateAllUI = null;
let _currentImage = null; // Base64 data URL
let _currentExtent = null; // { minX, maxX, minZ, maxZ }
let _detectedFeatures = []; // DetectedFeature[]
let _selectedFeatures = []; // Boolean[] (same length as _detectedFeatures)
let _calibration = null; // CalibrationParams or null for defaults
let _userAnnotations = []; // Array<{ nx, ny, family }> — normalized coords (0-1)
let _annotationMenuEl = null; // Context menu DOM element (created once)
let _pendingAnnotation = null; // { nx, ny } — awaiting family selection

// Concurrency guard — prevents double-click race conditions
let _isAnalyzing = false;

// Vectorization Engine state
let _lastCategoryGrid = null; // Uint8Array(262144) cached from last ML/color analysis
let _lastGeoJSON = null; // GeoJSON FeatureCollection from vectorize()
let _vectorizeOverride = null; // Override for testing — replaces vectorize()

// SAM Auto-Mask / Text Prompt state (segment-geospatial)
let _textPrompt = ''; // Text prompt for CLIP segmentation
let _autoMaskAbort = null; // AbortController for auto-mask cancellation

// Paint mode state (User NN method)
let _paintMode = false; // Whether paint mode is active
let _paintFamily = 'building'; // Currently selected paint family
let _paintBrushSize = 12; // Brush radius in grid pixels (on 512x512 grid)
let _paintStrokes = []; // [{ family, points: [[nx, ny], ...], brushSize }]
let _labelGrid = null; // Uint8Array(512*512) — family index per pixel (0=unlabeled)
let _isPainting = false; // Mouse is currently down and painting
let _currentStroke = null; // Current in-progress stroke

// Change Detection state
let _changeComparisonImage = null; // Base64 data URL of comparison image

/**
 * Inject updateAllUI dependency.
 * @param {Function} fn
 */
export function setAerialUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ----------------------------------------------------------------
// FAMILY ICON MAP & LABELS
// Nomes em portugues para as familias detectadas
// ----------------------------------------------------------------

const FAMILY_ICONS = {
    building: 'building',
    tank: 'tank',
    lake: 'lake',
    river: 'river',
    habitat: 'tree',
    well: 'well',
    marker: 'map-pin',
    plume: 'plume',
};

const FAMILY_LABELS_PT = {
    building: 'Edificacao',
    tank: 'Tanque',
    lake: 'Corpo Hidrico',
    river: 'Curso de Agua',
    habitat: 'Vegetacao',
    marker: 'Solo Exposto',
    well: 'Poco',
};

// ----------------------------------------------------------------
// OPEN MODAL
// ----------------------------------------------------------------

/**
 * Open aerial recognition modal.
 * Verifica se existe boundary com overlay e habilita/desabilita botao.
 */
export function handleOpenAerialModal() {
    // Reset state
    _currentImage = null;
    _currentExtent = null;
    _detectedFeatures = [];
    _selectedFeatures = [];
    _calibration = null;
    _userAnnotations = [];
    _paintMode = false;
    _isPainting = false;
    _currentStroke = null;
    // Preserve paint strokes and label grid if returning to modal
    // (user may want to continue training)

    // Reset UI
    _resetModalUI();

    // Check if boundary with overlay exists
    const boundaries = getElementsByFamily('boundary');
    const boundaryWithOverlay = boundaries.find((b) => b.data?.overlayUrl);
    const boundaryBtn = document.getElementById('aerial-use-boundary-btn');
    if (boundaryBtn) {
        boundaryBtn.disabled = !boundaryWithOverlay;
        if (!boundaryWithOverlay) {
            boundaryBtn.title = t('noBoundaryForAerial');
        } else {
            boundaryBtn.title = '';
        }
    }

    openModal('aerial-recognition-modal');
}

/**
 * Reset all modal UI sections to initial state.
 */
function _resetModalUI() {
    const preview = document.getElementById('aerial-image-preview');
    if (preview) preview.style.display = 'none';

    const methodStep = document.getElementById('aerial-step-method');
    if (methodStep) methodStep.style.display = 'none';

    const extentStep = document.getElementById('aerial-step-extent');
    if (extentStep) extentStep.style.display = 'none';

    const processing = document.getElementById('aerial-processing');
    if (processing) processing.style.display = 'none';

    const results = document.getElementById('aerial-step-results');
    if (results) results.style.display = 'none';

    const confirmBtn = document.getElementById('aerial-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = true;

    // Hide vectorize/export buttons (shown after analysis/vectorization)
    const vecBtn = document.getElementById('aerial-vectorize-btn');
    if (vecBtn) {
        vecBtn.style.display = 'none';
        vecBtn.disabled = true;
    }
    const exportBtn = document.getElementById('aerial-export-geojson-btn');
    if (exportBtn) {
        exportBtn.style.display = 'none';
        exportBtn.disabled = true;
    }

    const fileInput = document.getElementById('aerial-image-file');
    if (fileInput) fileInput.value = '';

    // Reset annotations UI
    const annotSect = document.getElementById('aerial-annotations-section');
    if (annotSect) annotSect.style.display = 'none';
    const annotList = document.getElementById('aerial-annotations-list');
    if (annotList) annotList.innerHTML = '';

    // Reset paint controls
    const paintControls = document.getElementById('aerial-paint-controls');
    if (paintControls) paintControls.style.display = 'none';
    const trainStatus = document.getElementById('aerial-train-status');
    if (trainStatus) trainStatus.style.display = 'none';

    // Reset calibration UI
    const calStep = document.getElementById('aerial-calibration-step');
    if (calStep) calStep.style.display = 'none';

    const calAdv = document.getElementById('aerial-cal-advanced');
    if (calAdv) calAdv.style.display = 'none';

    _syncCalibrationSliders();

    // Cleanup SAM click mode listeners and paint canvas to prevent leaks
    _disableSAMClickMode();
    _paintMode = false;
    _isPainting = false;
}

// ----------------------------------------------------------------
// IMAGE SOURCE — Boundary overlay
// ----------------------------------------------------------------

/**
 * Use existing boundary overlay image.
 * Busca imagem do overlay do limite via fetch, converte para dataURL.
 */
export async function handleAerialUseBoundary() {
    const boundaries = getElementsByFamily('boundary');
    const boundary = boundaries.find((b) => b.data?.overlayUrl);
    if (!boundary) {
        showToast(t('noBoundaryForAerial'), 'error');
        return;
    }

    // Compute extent from boundary vertices
    const vertices = boundary.data.vertices || [];
    if (vertices.length < 3) {
        showToast('Boundary has insufficient vertices', 'error');
        return;
    }

    _currentExtent = _computeExtent(vertices);

    // Show processing
    const processing = document.getElementById('aerial-processing');
    if (processing) processing.style.display = '';

    try {
        _currentImage = await loadImageAsDataUrl(boundary.data.overlayUrl);
        _showImagePreview(_currentImage);
        _showMethodStep();
    } catch (err) {
        showToast(err.message || 'Failed to load boundary image', 'error');
    } finally {
        if (processing) processing.style.display = 'none';
    }
}

// ----------------------------------------------------------------
// IMAGE SOURCE — File upload
// ----------------------------------------------------------------

/**
 * Handle aerial image file upload.
 * Le o arquivo selecionado e mostra preview.
 */
export async function handleAerialImageUpload() {
    const input = document.getElementById('aerial-image-file');
    const file = input?.files?.[0];
    if (!file) return;

    try {
        _currentImage = await readFileAsDataUrl(file);
        _showImagePreview(_currentImage);

        // Check if boundary exists for extent
        const boundaries = getElementsByFamily('boundary');
        const boundary = boundaries.find((b) => b.data?.vertices?.length >= 3);
        if (boundary) {
            _currentExtent = _computeExtent(boundary.data.vertices);
            _showMethodStep();
        } else {
            // No boundary — show extent input fields with default 200x200m
            _currentExtent = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
            _showExtentStep();
            _showMethodStep();
            showToast(t('aerialDefaultExtent') || 'Using default extent 200\u00D7200 m. Adjust if needed.', 'warning');
        }
    } catch (err) {
        showToast(err.message || 'Failed to read image', 'error');
    }
}

// ----------------------------------------------------------------
// EXTENT INPUT (when no boundary exists)
// ----------------------------------------------------------------

/**
 * Update extent from manual input fields.
 */
export function handleAerialSetExtent() {
    const wInput = document.getElementById('aerial-extent-width');
    const hInput = document.getElementById('aerial-extent-height');
    const w = Math.max(1, Math.abs(parseFloat(wInput?.value)) || 200);
    const h = Math.max(1, Math.abs(parseFloat(hInput?.value)) || 200);
    _currentExtent = { minX: -w / 2, maxX: w / 2, minZ: -h / 2, maxZ: h / 2 };
}

// ----------------------------------------------------------------
// ANALYZE
// ----------------------------------------------------------------

/**
 * Run analysis with selected method (AI or algorithm).
 */
export async function handleAerialAnalyze() {
    if (_isAnalyzing) return; // Guard contra double-click
    if (!_currentImage || !_currentExtent) {
        showToast('Select an image first', 'error');
        return;
    }

    // Update extent from manual fields if visible
    const extentStep = document.getElementById('aerial-step-extent');
    if (extentStep && extentStep.style.display !== 'none') {
        handleAerialSetExtent();
    }

    // Validate extent bounds — prevent NaN in georeference pipeline
    if (_currentExtent.minX >= _currentExtent.maxX || _currentExtent.minZ >= _currentExtent.maxZ) {
        showToast(t('aerialInvalidExtent') || 'Invalid extent: width and height must be positive', 'error');
        return;
    }

    // Get selected method
    const methodRadio = document.querySelector('input[name="aerial-method"]:checked');
    const method = methodRadio?.value || 'algorithm';

    // Check prerequisites
    if (method === 'ai' && !hasApiKey()) {
        showToast(t('aerialApiKeyRequired'), 'error');
        return;
    }
    if (method === 'usernn' && !isNetworkTrained()) {
        showToast(t('trainNetworkFirst') || 'Train the network first by painting labels', 'error');
        return;
    }

    // Show processing with reset state
    const processing = document.getElementById('aerial-processing');
    if (processing) processing.style.display = '';
    _updateProgress(t('analyzingImage') || 'Analyzing image...', -1);

    const analyzeBtn = document.getElementById('aerial-analyze-btn');
    if (analyzeBtn) analyzeBtn.disabled = true;
    _isAnalyzing = true;

    try {
        let newFeatures;
        if (method === 'ai') {
            newFeatures = await analyzeWithAI(_currentImage, _currentExtent, _userAnnotations);
        } else if (method === 'ml') {
            // Pede grid para caching (Vectorization Engine)
            const result = await analyzeWithML(
                _currentImage,
                _currentExtent,
                (info) => {
                    _updateProgress(info.message, info.progress);
                },
                _userAnnotations,
                { returnGrid: true },
            );
            // Backward-compat: resultado pode ser array ou { features, grid }
            if (result && result.grid) {
                newFeatures = result.features;
                _lastCategoryGrid = result.grid;
            } else {
                newFeatures = result;
            }
        } else if (method === 'usernn') {
            newFeatures = await classifyWithUserNN(_currentImage, _currentExtent, (info) => {
                _updateProgress(info.message, info.progress);
            });
        } else if (method === 'slic') {
            const slicNum = parseInt(document.getElementById('aerial-slic-num')?.value) || 200;
            const slicCompact = parseInt(document.getElementById('aerial-slic-compact')?.value) || 10;
            const result = await analyzeWithSLIC(
                _currentImage,
                _currentExtent,
                {
                    numSuperpixels: slicNum,
                    compactness: slicCompact,
                    returnGrid: true,
                },
                (info) => {
                    _updateProgress(info.message, info.progress);
                },
                _userAnnotations,
            );
            if (result && result.grid) {
                newFeatures = result.features;
                _lastCategoryGrid = result.grid;
            } else {
                newFeatures = result;
            }
        } else if (method === 'yolos') {
            const yThreshold = (parseInt(document.getElementById('aerial-yolos-threshold')?.value) || 30) / 100;
            const yMaxDet = parseInt(document.getElementById('aerial-yolos-maxdet')?.value) || 50;
            newFeatures = await analyzeWithYOLOS(
                _currentImage,
                _currentExtent,
                (info) => {
                    _updateProgress(info.message, info.progress);
                },
                { threshold: yThreshold, maxDetections: yMaxDet },
            );
        } else if (method === 'sam') {
            // SAM usa modo interativo — nao roda analise batch aqui
            // Carrega modelo e encoda imagem, usuario clica depois
            await loadSAM((info) => _updateProgress(info.message, info.progress));
            await setSAMImage(_currentImage, (info) => _updateProgress(info.message, info.progress));
            _updateProgress(t('clickToSegment') || 'Click on image to segment objects', 100);
            _enableSAMClickMode();
            return; // Nao segue para dedup/results — features vem por clique
        } else if (method === 'samAuto') {
            // SAM Auto-Mask — grid-point automatic segmentation (segment-geospatial)
            const gridVal = parseInt(document.getElementById('aerial-auto-grid')?.value) || 16;
            const minAreaVal = parseInt(document.getElementById('aerial-auto-minarea')?.value) || 100;
            _autoMaskAbort = new AbortController();
            try {
                const masks = await generateAutoMasks(_currentImage, _currentExtent, {
                    pointsPerSide: gridVal,
                    minMaskArea: minAreaVal,
                    signal: _autoMaskAbort.signal,
                    onProgress: (info) => _updateProgress(info.message, info.progress),
                });
                newFeatures = autoMasksToFeatures(masks, _currentExtent, _currentImage);
            } finally {
                _autoMaskAbort = null;
            }
        } else if (method === 'textPrompt') {
            // CLIP + SAM text-prompted segmentation (segment-geospatial LangSAM)
            const prompt = _textPrompt?.trim();
            if (!prompt) {
                showToast(t('textPromptEmpty') || 'Enter a description of what to detect', 'error');
                return;
            }
            _autoMaskAbort = new AbortController();
            try {
                newFeatures = await segmentByText(_currentImage, prompt, _currentExtent, {
                    signal: _autoMaskAbort.signal,
                    onProgress: (info) => _updateProgress(info.message, info.progress),
                });
            } finally {
                _autoMaskAbort = null;
            }
        } else if (method === 'tileMap') {
            // Tile map segmentation — open map picker, fetch tiles, auto-segment
            await handleAerialTileMapSegment();
            return; // Results handled by the tile map handler
        } else if (method === 'instance') {
            // Instance segmentation — per-object masks
            const subMethod = document.querySelector('input[name="aerial-instance-sub"]:checked')?.value || 'hybrid';
            if (subMethod === 'native') {
                newFeatures = await detectInstancesNative(_currentImage, _currentExtent, (info) => {
                    _updateProgress(info.message, info.progress);
                });
            } else {
                newFeatures = await detectInstances(_currentImage, _currentExtent, (info) => {
                    _updateProgress(info.message, info.progress);
                });
            }
        } else if (method === 'changeDetect') {
            // Change Detection — temporal comparison of two images
            if (!_changeComparisonImage) {
                showToast(t('uploadComparisonFirst') || 'Upload a comparison image first', 'error');
                return;
            }
            const result = await detectChanges(_currentImage, _changeComparisonImage, _currentExtent, {
                onProgress: (info) => _updateProgress(info.message, info.progress),
            });
            // Show overlay on canvas
            _showChangeOverlay(result.overlay);
            showToast(
                `${result.stats.changeCount} changes detected (${result.stats.changePercent}% area)`,
                result.stats.changeCount > 0 ? 'success' : 'info',
            );
            newFeatures = []; // Change detection doesn't produce DetectedFeature[]
        } else if (method === 'classify') {
            // Scene Classification — image-level land cover type
            const tier = document.querySelector('input[name="aerial-classify-tier"]:checked')?.value || 'rule';
            const result = await classifyScene(_currentImage, {
                tier,
                onProgress: (info) => _updateProgress(info.message, info.progress),
            });
            // Show classification result
            const resultEl = document.getElementById('aerial-classify-result');
            if (resultEl) {
                resultEl.style.display = '';
                resultEl.innerHTML =
                    `<div style="font-size:13px; font-weight:600;">${escapeHtml(result.class.toUpperCase())}</div>` +
                    `<div style="font-size:11px; color:var(--window-muted);">Confidence: ${Math.round(result.confidence * 100)}%</div>`;
            }
            showToast(`Scene: ${result.class} (${Math.round(result.confidence * 100)}%)`, 'success');
            newFeatures = []; // Classification is image-level, not per-object
        } else if (method === 'spectral') {
            // Spectral Analysis — vNDVI, SAVI, Water Index
            const indexType = document.getElementById('aerial-spectral-index')?.value || 'vndvi';
            const colormap = document.getElementById('aerial-spectral-colormap')?.value || 'RdYlGn';
            let result;
            if (indexType === 'savi') result = await computeSAVI(_currentImage);
            else if (indexType === 'water') result = await computeWaterIndex(_currentImage);
            else result = await computeVNDVI(_currentImage);
            const overlay = renderIndexOverlay(result.grid, result.w, result.h, colormap);
            _showChangeOverlay(overlay);
            showToast(
                `${indexType.toUpperCase()}: mean=${result.stats.mean.toFixed(3)}, range=[${result.stats.min.toFixed(3)}, ${result.stats.max.toFixed(3)}]`,
                'success',
            );
            newFeatures = []; // Spectral is per-pixel overlay, not features
        } else if (method === 'embeddings') {
            // Tile Embeddings — index current image
            const embedding = await computeHandcraftedEmbedding(_currentImage);
            const tileId = `tile-${Date.now()}`;
            await storeTileEmbedding(tileId, embedding, { timestamp: Date.now() });
            const stats = await getEmbeddingStats();
            const resultEl = document.getElementById('aerial-embeddings-result');
            if (resultEl) {
                resultEl.style.display = '';
                resultEl.textContent = `Indexed (${stats.count} tiles total, ${stats.method})`;
            }
            showToast(`Image indexed (${stats.count} tiles)`, 'success');
            newFeatures = []; // Embeddings don't produce features
        } else {
            // Pede grid para caching (Vectorization Engine)
            const result = await analyzeWithAlgorithm(_currentImage, _currentExtent, _calibration, _userAnnotations, {
                returnGrid: true,
            });
            if (result && result.grid) {
                newFeatures = result.features;
                _lastCategoryGrid = result.grid;
            } else {
                newFeatures = result;
            }
        }

        // Deduplicate: skip features too close to existing ones
        // Evita duplicatas quando usuario roda varios metodos em sequencia
        const dedupDist = 5; // meters — features within 5m are considered duplicates
        const unique = newFeatures.filter((nf) => {
            return !_detectedFeatures.some(
                (ef) =>
                    ef.family === nf.family &&
                    Math.abs(ef.position.x - nf.position.x) < dedupDist &&
                    Math.abs(ef.position.z - nf.position.z) < dedupDist,
            );
        });

        // Accumulate: append new results to existing
        _detectedFeatures = _detectedFeatures.concat(unique);

        // Re-assign sequential names across all accumulated features
        _assignSequentialNames(_detectedFeatures);

        // Select all by default (preserve existing selections + select new)
        const prevLen = _selectedFeatures.length;
        _selectedFeatures = _detectedFeatures.map((_, i) => (i < prevLen ? _selectedFeatures[i] : true));

        _showResults();
        _redrawCanvas();

        // Show Vectorize button when category grid is available
        const vecBtn = document.getElementById('aerial-vectorize-btn');
        if (vecBtn && _lastCategoryGrid) {
            vecBtn.style.display = '';
            vecBtn.disabled = false;
        }

        const newCount = unique.length;
        const totalCount = _detectedFeatures.length;
        showToast(`+${newCount} ${t('detectedFeatures').toLowerCase()} (${totalCount} total)`, 'success');
    } catch (err) {
        console.error('Aerial analysis error:', err);
        showToast(err.message || 'Analysis failed', 'error');
    } finally {
        if (processing) processing.style.display = 'none';
        if (analyzeBtn) analyzeBtn.disabled = false;
        _isAnalyzing = false;
    }
}

// ----------------------------------------------------------------
// FEATURE SELECTION
// ----------------------------------------------------------------

/**
 * Toggle selection of a single detected feature.
 * @param {number} index
 */
export function handleAerialToggleFeature(index) {
    if (index >= 0 && index < _selectedFeatures.length) {
        _selectedFeatures[index] = !_selectedFeatures[index];
        // Update row styling
        const rows = document.querySelectorAll('.aerial-feature-row');
        if (rows[index]) {
            const color = FAMILY_COLORS[_detectedFeatures[index]?.family] || '#888';
            rows[index].classList.toggle('selected', _selectedFeatures[index]);
            rows[index].style.borderLeftColor = _selectedFeatures[index] ? color : 'transparent';
        }
        _updateConfirmButton();
        _redrawCanvas();
    }
}

/**
 * Select or deselect all features.
 * @param {boolean} checked
 */
export function handleAerialSelectAll(checked) {
    _selectedFeatures = _selectedFeatures.map(() => checked);
    // Update all checkboxes and row styling
    const rows = document.querySelectorAll('.aerial-feature-row');
    _detectedFeatures.forEach((f, i) => {
        const cb = document.getElementById(`aerial-feature-${i}`);
        if (cb) cb.checked = checked;
        if (rows[i]) {
            const color = FAMILY_COLORS[f.family] || '#888';
            rows[i].classList.toggle('selected', checked);
            rows[i].style.borderLeftColor = checked ? color : 'transparent';
        }
    });
    _updateConfirmButton();
    _redrawCanvas();
}

// ----------------------------------------------------------------
// CONFIRM IMPORT — Create elements + auto-group
// ----------------------------------------------------------------

/**
 * Create elements from selected detected features.
 * Cria elementos no modelo 3D, agrupa-os e atualiza a UI.
 */
export function handleAerialConfirmImport() {
    const selected = _detectedFeatures.filter((_, i) => _selectedFeatures[i]);
    if (selected.length === 0) {
        showToast(t('noFeaturesDetected'), 'error');
        return;
    }

    // Close modal first to avoid interference with UI update
    closeModal('aerial-recognition-modal');

    // Create a group for the imported elements
    const group = addElementGroup({
        name: t('aerialRecognition') || 'Aerial Recognition',
        color: '#4dabf7',
    });

    let created = 0;
    const createdIds = [];

    for (const feature of selected) {
        try {
            const id = generateId(feature.family);
            const name = feature.label || `${FAMILY_LABELS_PT[feature.family] || feature.family} ${created + 1}`;
            const data = _buildElementData(feature);

            addElement(feature.family, id, name, data);
            createdIds.push(id);
            created++;
        } catch (err) {
            console.warn(`Failed to create ${feature.family}:`, err.message);
        }
    }

    // Assign all created elements to the group
    for (const id of createdIds) {
        setElementGroup(id, group.id);
    }

    if (created > 0) {
        showToast(`${created} ${t('featuresAdded')}`, 'success');
    }

    // Force UI update after a microtask to ensure DOM is ready
    // (closeModal may trigger CSS transitions)
    setTimeout(() => {
        if (_updateAllUI) _updateAllUI();
    }, 50);
}

// ----------------------------------------------------------------
// DATA BUILDERS — Convert feature to element data
// Converte DetectedFeature para o formato de dados de cada familia
// ----------------------------------------------------------------

/**
 * Build element data object from detected feature.
 * Inclui rotacao Y quando disponivel no feature.
 * @param {Object} feature - DetectedFeature
 * @returns {Object} - Element data
 */
function _buildElementData(feature) {
    const pos = feature.position;
    const dims = feature.dimensions || {};
    // Convert radians to degrees for the transform system
    const rotYDeg = Math.round((((feature.rotation || 0) * 180) / Math.PI) * 10) / 10;

    switch (feature.family) {
        case 'building':
            return {
                position: { x: pos.x, y: 0, z: pos.z },
                footprint: dims.footprint || { width: 10, length: 10 },
                height: dims.height || 6,
                type: dims.type || 'industrial',
                rotation: { x: 0, y: rotYDeg, z: 0 },
                observations: [],
            };

        case 'tank':
            return {
                position: { x: pos.x, y: 0, z: pos.z },
                dimensions: dims.dimensions || { diameter: 5, length: 5 },
                type: dims.type || 'aboveground',
                contents: 'unknown',
                rotation: { x: 0, y: rotYDeg, z: 0 },
                observations: [],
            };

        case 'lake':
            return {
                position: { x: pos.x, y: 0, z: pos.z },
                shape: dims.shape || { radiusX: 10, radiusY: 8, depth: 3 },
                observations: [],
            };

        case 'river':
            return {
                path: dims.path || [
                    { x: pos.x - 20, y: 0, z: pos.z },
                    { x: pos.x, y: 0, z: pos.z },
                    { x: pos.x + 20, y: 0, z: pos.z },
                ],
                width: dims.width || 3,
                observations: [],
            };

        case 'habitat':
            return {
                position: { x: pos.x, y: 0, z: pos.z },
                habitatType: dims.habitatType || 'forest',
                protectionStatus: dims.protectionStatus || 'none',
                area: Math.min(dims.area || 100, 500),
                footprint: dims.footprint || null,
                observations: [],
            };

        case 'well':
            return {
                coordinates: { easting: pos.x, northing: pos.z, elevation: 0 },
                construction: { totalDepth: 30, diameter: 4, screenTop: 10, screenBottom: 25 },
                observations: [],
            };

        case 'marker':
        default:
            return {
                position: { x: pos.x, y: 0, z: pos.z },
                observations: [],
            };
    }
}

// ----------------------------------------------------------------
// NAMING — Sequential names per family
// Numera feicoes sequencialmente por familia (ex: Edificacao 1, 2...)
// ----------------------------------------------------------------

/**
 * Assign sequential names grouped by family.
 * @param {Array} features - DetectedFeature[]
 */
function _assignSequentialNames(features) {
    const counters = {};
    for (const f of features) {
        counters[f.family] = (counters[f.family] || 0) + 1;
        const baseLabel = FAMILY_LABELS_PT[f.family] || f.family;
        f.label = `${baseLabel} ${counters[f.family]}`;
    }
}

// ----------------------------------------------------------------
// UI HELPERS — Internal functions for modal rendering
// ----------------------------------------------------------------

/**
 * Compute bounding extent from boundary vertices.
 * @param {Array} vertices - [{x, y, z}, ...]
 * @returns {Object} - { minX, maxX, minZ, maxZ }
 */
function _computeExtent(vertices) {
    let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
    for (const v of vertices) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
    }
    return { minX, maxX, minZ, maxZ };
}

/**
 * Show image preview on modal canvas.
 * Canvas preenche a largura do modal para melhor visualizacao.
 * @param {string} dataUrl - Base64 image
 */
function _showImagePreview(dataUrl) {
    const container = document.getElementById('aerial-image-preview');
    if (!container) return;
    container.style.display = '';

    const canvas = document.getElementById('aerial-preview-canvas');
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
        // Scale to fill modal width for better interaction
        // Use container width if available, otherwise fallback to 560px
        const containerW = container.clientWidth;
        const targetW = containerW > 100 ? Math.min(620, containerW) : 560;
        const scale = targetW / img.width;
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Attach click handler for user annotations
        canvas.onclick = null;
        canvas.onclick = (e) => _handleCanvasClick(e, canvas);
    };
    img.src = dataUrl;
}

/**
 * Show method selection step.
 * Habilita/desabilita opcoes conforme disponibilidade.
 */
function _showMethodStep() {
    const methodStep = document.getElementById('aerial-step-method');
    if (methodStep) methodStep.style.display = '';

    // Enable/disable AI radio based on API key availability
    const aiRadio = document.getElementById('aerial-method-ai');
    const algRadio = document.getElementById('aerial-method-algorithm');
    if (aiRadio && !hasApiKey()) {
        aiRadio.disabled = true;
        if (algRadio) algRadio.checked = true;
    } else if (aiRadio) {
        aiRadio.disabled = false;
    }

    // Update ML model status indicator
    const mlStatus = document.getElementById('aerial-ml-status');
    if (mlStatus) {
        mlStatus.textContent = isMLModelLoaded() ? '(cached)' : '(~5 MB)';
    }

    // Show/hide calibration based on selected method
    const selected = document.querySelector('input[name="aerial-method"]:checked');
    _updateCalibrationVisibility(selected?.value || 'ai');
}

/**
 * Update progress indicator text and bar during ML model download.
 * @param {string} message - Status message
 * @param {number} progress - 0-100 or -1 for indeterminate
 */
function _updateProgress(message, progress) {
    const textEl = document.getElementById('aerial-progress-text');
    if (textEl) textEl.textContent = message;

    const barEl = document.getElementById('aerial-progress-bar');
    if (barEl) {
        if (progress >= 0) {
            barEl.style.width = `${Math.min(100, progress)}%`;
            barEl.style.animation = 'none';
        } else {
            // Indeterminate — use CSS animation
            barEl.style.width = '30%';
            barEl.style.animation = '';
        }
    }
}

/**
 * Show extent input step (when no boundary exists).
 */
function _showExtentStep() {
    const step = document.getElementById('aerial-step-extent');
    if (step) step.style.display = '';
}

/**
 * Render detected features table with summary pills.
 * Mostra resumo agrupado por familia + lista de feicoes detectadas.
 */
function _showResults() {
    const container = document.getElementById('aerial-step-results');
    if (!container) return;
    container.style.display = '';

    const countEl = document.getElementById('aerial-feature-count');
    if (countEl) countEl.textContent = `(${_detectedFeatures.length})`;

    // Render family summary pills
    _renderFeatureSummary();

    const table = document.getElementById('aerial-results-table');
    if (!table) return;

    if (_detectedFeatures.length === 0) {
        table.innerHTML = `<p style="color:var(--window-muted);font-size:12px;">${t('noFeaturesDetected')}</p>`;
        return;
    }

    const rows = _detectedFeatures
        .map((f, i) => {
            const iconName = FAMILY_ICONS[f.family] || 'map-pin';
            const icon = getIcon(iconName, { size: '14px' });
            const confPct = Math.round(f.confidence * 100);
            const confClass = confPct >= 70 ? 'high' : confPct >= 40 ? 'medium' : 'low';
            const checked = _selectedFeatures[i] ? 'checked' : '';
            const selectedClass = _selectedFeatures[i] ? ' selected' : '';
            const color = FAMILY_COLORS[f.family] || '#888';
            const posStr = `(${f.position.x.toFixed(0)}, ${f.position.z.toFixed(0)})`;

            return `<div class="aerial-feature-row${selectedClass}" style="border-left-color:${_selectedFeatures[i] ? color : 'transparent'};">
            <input type="checkbox" id="aerial-feature-${i}" ${checked} onchange="handleAerialToggleFeature(${i})">
            <span style="width:16px;height:16px;flex-shrink:0;display:inline-flex;align-items:center;overflow:hidden;">${icon}</span>
            <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeAttr(f.label)} ${posStr}">${escapeHtml(f.label)}</span>
            <span style="font-size:10px;color:var(--neutral-500);min-width:60px;">${posStr}</span>
            <span class="feature-conf ${confClass}">${confPct}%</span>
        </div>`;
        })
        .join('');

    table.innerHTML = rows;
    _updateConfirmButton();
}

/**
 * Render summary pills grouped by family.
 * Pastilhas coloridas mostrando contagem por familia (ex: 15 Edificacoes, 5 Vegetacao).
 */
function _renderFeatureSummary() {
    const summaryEl = document.getElementById('aerial-results-summary');
    if (!summaryEl) return;

    if (_detectedFeatures.length === 0) {
        summaryEl.innerHTML = '';
        return;
    }

    // Count features by family
    const counts = {};
    for (const f of _detectedFeatures) {
        counts[f.family] = (counts[f.family] || 0) + 1;
    }

    // Build pills sorted by count (descending)
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    summaryEl.innerHTML = sorted
        .map(([family, count]) => {
            const color = FAMILY_COLORS[family] || '#888';
            const label = FAMILY_LABELS_PT[family] || family;
            const iconName = FAMILY_ICONS[family] || 'map-pin';
            const icon = getIcon(iconName, { size: '12px' });
            return `<span class="aerial-summary-pill">
            <span class="pill-dot" style="background:${color};"></span>
            ${icon}
            <span>${count}</span>
            <span style="font-weight:400;opacity:0.8;">${label}</span>
        </span>`;
        })
        .join('');
}

/**
 * Update confirm button enabled state.
 */
function _updateConfirmButton() {
    const btn = document.getElementById('aerial-confirm-btn');
    if (btn) {
        const anySelected = _selectedFeatures.some((s) => s);
        btn.disabled = !anySelected;
    }
}

// ----------------------------------------------------------------
// CALIBRATION HANDLERS
// Gerenciam sliders de calibracao e auto-calibracao por histograma
// ----------------------------------------------------------------

/**
 * Show/hide calibration panel based on method selection.
 * Calibracao so aparece para o metodo "Algorithm" (cor).
 * @param {string} method - 'ai' | 'algorithm' | 'ml'
 */
function _updateCalibrationVisibility(method) {
    const calStep = document.getElementById('aerial-calibration-step');
    if (calStep) {
        calStep.style.display = method === 'algorithm' ? '' : 'none';
    }
    const paintControls = document.getElementById('aerial-paint-controls');
    if (paintControls) {
        paintControls.style.display = method === 'usernn' ? '' : 'none';
        if (method === 'usernn') _initPaintControls();
    }
    // SLIC controls
    const slicControls = document.getElementById('aerial-slic-controls');
    if (slicControls) {
        slicControls.style.display = method === 'slic' ? '' : 'none';
        if (method === 'slic') _initSlicControls();
    }
    // YOLOS controls
    const yolosControls = document.getElementById('aerial-yolos-controls');
    if (yolosControls) {
        yolosControls.style.display = method === 'yolos' ? '' : 'none';
    }
    // SAM controls
    const samControls = document.getElementById('aerial-sam-controls');
    if (samControls) {
        samControls.style.display = method === 'sam' ? '' : 'none';
    }
    // SAM Auto-Mask controls (segment-geospatial)
    const samAutoControls = document.getElementById('aerial-samAuto-controls');
    if (samAutoControls) {
        samAutoControls.style.display = method === 'samAuto' ? '' : 'none';
    }
    // Text Prompt controls (CLIP + SAM)
    const textPromptControls = document.getElementById('aerial-textPrompt-controls');
    if (textPromptControls) {
        textPromptControls.style.display = method === 'textPrompt' ? '' : 'none';
    }
    // Tile Map controls
    const tileMapControls = document.getElementById('aerial-tileMap-controls');
    if (tileMapControls) {
        tileMapControls.style.display = method === 'tileMap' ? '' : 'none';
    }
    // Instance Segmentation controls
    const instanceControls = document.getElementById('aerial-instance-controls');
    if (instanceControls) {
        instanceControls.style.display = method === 'instance' ? '' : 'none';
    }
    // Change Detection controls
    const changeControls = document.getElementById('aerial-changeDetect-controls');
    if (changeControls) {
        changeControls.style.display = method === 'changeDetect' ? '' : 'none';
    }
    // Scene Classification controls
    const classifyControls = document.getElementById('aerial-classify-controls');
    if (classifyControls) {
        classifyControls.style.display = method === 'classify' ? '' : 'none';
    }
    // Spectral Analysis controls
    const spectralControls = document.getElementById('aerial-spectral-controls');
    if (spectralControls) {
        spectralControls.style.display = method === 'spectral' ? '' : 'none';
    }
    // Embeddings controls
    const embeddingsControls = document.getElementById('aerial-embeddings-controls');
    if (embeddingsControls) {
        embeddingsControls.style.display = method === 'embeddings' ? '' : 'none';
    }
    // Toggle paint mode for canvas interaction
    _paintMode = method === 'usernn';
    // Disable SAM click mode if switching away
    if (method !== 'sam') _disableSAMClickMode();
    // Cancel any in-flight auto-mask if switching away
    if (method !== 'samAuto' && method !== 'textPrompt' && _autoMaskAbort) {
        _autoMaskAbort.abort();
        _autoMaskAbort = null;
    }
}

/**
 * Handle method radio button change.
 * Mostra/esconde calibracao e reseta estado quando muda metodo.
 * @param {string} method
 */
export function handleAerialMethodChange(method) {
    _updateCalibrationVisibility(method);
}

/**
 * Handle SAM model selection change (SlimSAM vs SAM 2.1).
 * Atualiza o modelo ativo para segmentacao interativa.
 * @param {string} modelKey - 'slim' | 'sam2'
 */
export function handleAerialSAMModelChange(modelKey) {
    const infoEl = document.getElementById('aerial-sam-model-info');
    if (infoEl) {
        if (modelKey === 'slim') {
            infoEl.textContent = 'SlimSAM: optimized for browser, single-object focus';
        } else if (modelKey === 'sam2') {
            infoEl.textContent = 'SAM 2.1: more precise, better multi-object segmentation (coming soon)';
        }
    }
    // Atualiza o modelo no modulo SAM (forca reload se necessario)
    selectSAMModel(modelKey);
    showToast(`SAM model: ${modelKey === 'slim' ? 'SlimSAM' : 'SAM 2.1'}`, 'info');
}

// ----------------------------------------------------------------
// SLIC CONTROLS — Slider initialization and value display
// ----------------------------------------------------------------

function _initSlicControls() {
    const numSlider = document.getElementById('aerial-slic-num');
    const numVal = document.getElementById('aerial-slic-num-val');
    const compactSlider = document.getElementById('aerial-slic-compact');
    const compactVal = document.getElementById('aerial-slic-compact-val');

    if (numSlider && numVal) {
        numSlider.oninput = () => {
            numVal.textContent = numSlider.value;
        };
    }
    if (compactSlider && compactVal) {
        compactSlider.oninput = () => {
            compactVal.textContent = compactSlider.value;
        };
    }
}

// ----------------------------------------------------------------
// SAM INTERACTIVE — Click-to-segment mode on aerial canvas
// ----------------------------------------------------------------

let _samClickHandler = null;

function _enableSAMClickMode() {
    const canvas = document.getElementById('aerial-preview-canvas');
    if (!canvas) return;

    const statusEl = document.getElementById('aerial-sam-status');
    if (statusEl) statusEl.textContent = t('clickToSegment') || 'Click on the image to segment objects';

    // Remove previous handler if any
    _disableSAMClickMode();

    _samClickHandler = async (e) => {
        const rect = canvas.getBoundingClientRect();
        // Canvas pixel coordinates (may be scaled from original image)
        const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
        const canvasY = (e.clientY - rect.top) * (canvas.height / rect.height);

        // Convert canvas coords → original image coords (SAM expects image pixel space)
        const samStatus = getSAMStatus();
        const imgW = samStatus.imageWidth || canvas.width;
        const imgH = samStatus.imageHeight || canvas.height;
        const px = canvasX * (imgW / canvas.width);
        const py = canvasY * (imgH / canvas.height);

        if (statusEl) statusEl.textContent = 'Segmenting...';

        try {
            const result = await segmentAtPoint(px, py, _currentExtent, {
                family: 'building', // Default; user can reclassify later
            });

            if (!result || !result.processed) {
                showToast('No object found at click point', 'info');
                if (statusEl) statusEl.textContent = t('clickToSegment') || 'Click to segment';
                return;
            }

            // Build DetectedFeature from Anti-Ameba result
            const proc = result.processed;
            const cx = proc.worldContour.reduce((s, v) => s + v.x, 0) / proc.worldContour.length;
            const cz = proc.worldContour.reduce((s, v) => s + v.z, 0) / proc.worldContour.length;

            const feature = {
                family: proc.family === 'building' ? 'building' : proc.family,
                confidence: 0.85,
                label: `SAM ${proc.family}`,
                position: { x: Math.round(cx * 10) / 10, z: Math.round(cz * 10) / 10 },
                dimensions: { width: Math.sqrt(proc.area_m2), length: Math.sqrt(proc.area_m2), height: proc.height },
                rotation: 0,
                contours: [proc.worldContour],
                sourceMethod: 'sam',
            };

            _detectedFeatures.push(feature);
            _selectedFeatures.push(true);
            _assignSequentialNames(_detectedFeatures);
            _showResults();
            _redrawCanvas();

            showToast(`+1 ${proc.family} (${proc.area_m2.toFixed(1)} m²)`, 'success');
            if (statusEl) statusEl.textContent = `${_detectedFeatures.length} features — click for more`;
        } catch (err) {
            console.error('SAM segmentation error:', err);
            showToast(err.message || 'SAM failed', 'error');
            if (statusEl) statusEl.textContent = t('clickToSegment') || 'Click to segment';
        }
    };

    canvas.style.cursor = 'crosshair';
    canvas.addEventListener('click', _samClickHandler);
}

function _disableSAMClickMode() {
    const canvas = document.getElementById('aerial-preview-canvas');
    if (canvas && _samClickHandler) {
        canvas.removeEventListener('click', _samClickHandler);
        canvas.style.cursor = '';
    }
    _samClickHandler = null;
}

/**
 * Auto-calibrate sliders from the current loaded image.
 * Carrega imagem no canvas, analisa histogramas, ajusta sliders.
 */
export async function handleAerialAutoCalibrate() {
    if (!_currentImage) {
        showToast('Load an image first', 'error');
        return;
    }

    const btn = document.getElementById('aerial-auto-cal-btn');
    if (btn) btn.disabled = true;

    try {
        // Load image into canvas to get pixel data
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('Failed to load image'));
            i.src = _currentImage;
        });

        const SIZE = 512;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const imageData = ctx.getImageData(0, 0, SIZE, SIZE);

        // Run auto-calibration
        _calibration = autoCalibrate(imageData.data, SIZE, SIZE);

        // Update slider UI
        _syncCalibrationSliders();

        showToast(t('autoCalibrationDone') || 'Auto-calibration applied', 'success');
    } catch (err) {
        console.error('Auto-calibrate error:', err);
        showToast(err.message || 'Auto-calibration failed', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * Handle individual calibration slider change.
 * Atualiza o valor do parametro no estado _calibration.
 * @param {string} param - CalibrationParams key
 * @param {string|number} value - Slider value
 */
export function handleAerialCalibrationChange(param, value) {
    const numVal = parseInt(value, 10);
    if (isNaN(numVal)) return;

    // Initialize calibration from defaults if null
    if (!_calibration) {
        _calibration = { ...DEFAULT_CALIBRATION };
    }

    _calibration[param] = numVal;

    // Update display value
    const SLIDER_MAP = {
        shadowSensitivity: 'shadow',
        vegetationSensitivity: 'vegetation',
        buildingBrightness: 'building',
        waterSensitivity: 'water',
        featureSize: 'featuresize',
        edgeSharpness: 'edgesharpness',
        maxFeatures: 'maxfeatures',
    };
    const slug = SLIDER_MAP[param];
    if (slug) {
        const valEl = document.getElementById(`aerial-cal-${slug}-val`);
        if (valEl) valEl.textContent = numVal;
    }
}

/**
 * Reset calibration to null (use defaults).
 * Remove calibracao customizada — volta aos limiares hardcoded.
 */
export function handleAerialResetCalibration() {
    _calibration = null;
    _syncCalibrationSliders();
    showToast(t('calibrationReset') || 'Calibration reset to defaults', 'info');
}

/**
 * Toggle advanced calibration section visibility.
 */
export function handleAerialToggleAdvanced() {
    const adv = document.getElementById('aerial-cal-advanced');
    if (adv) {
        adv.style.display = adv.style.display === 'none' ? '' : 'none';
    }
}

/**
 * Sync all slider DOM elements with current _calibration state.
 * Usado apos auto-calibracao ou reset.
 */
function _syncCalibrationSliders() {
    const cal = _calibration || DEFAULT_CALIBRATION;
    const SLIDER_MAP = {
        shadowSensitivity: 'shadow',
        vegetationSensitivity: 'vegetation',
        buildingBrightness: 'building',
        waterSensitivity: 'water',
        featureSize: 'featuresize',
        edgeSharpness: 'edgesharpness',
        maxFeatures: 'maxfeatures',
    };

    for (const [param, slug] of Object.entries(SLIDER_MAP)) {
        const slider = document.getElementById(`aerial-cal-${slug}`);
        const valEl = document.getElementById(`aerial-cal-${slug}-val`);
        const val = cal[param] ?? DEFAULT_CALIBRATION[param];
        if (slider) slider.value = val;
        if (valEl) valEl.textContent = val;
    }
}

// ----------------------------------------------------------------
// ANNOTATION SYSTEM — Click on canvas to label features
// Sistema de anotacoes: clique na imagem para rotular feicoes
// que guiam os tres motores de analise.
// ----------------------------------------------------------------

/** Color map for annotation markers on canvas */
const FAMILY_COLORS = {
    building: '#e74c3c',
    tank: '#e67e22',
    lake: '#3498db',
    river: '#2980b9',
    habitat: '#27ae60',
    well: '#8e44ad',
    marker: '#95a5a6',
};

/** Families available for annotation (excludes plume — not visible aerially) */
const ANNOTATION_FAMILIES = ['building', 'tank', 'lake', 'river', 'habitat', 'well', 'marker'];

/**
 * Handle click on aerial preview canvas.
 * Calcula posicao normalizada do clique e abre menu de familias.
 * @param {MouseEvent} e
 * @param {HTMLCanvasElement} canvas
 */
function _handleCanvasClick(e, canvas) {
    // In paint mode, canvas interaction is handled by mousedown/move/up listeners
    if (_paintMode) return;

    // Stop propagation so the document close-handler doesn't
    // immediately hide the menu we are about to show
    e.stopPropagation();

    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;

    // Clamp to valid range
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

    _pendingAnnotation = { nx, ny };
    _showAnnotationFamilyMenu(e.clientX, e.clientY);
}

/**
 * Show family selection context menu for annotation.
 * Mostra menu de familias para que o usuario escolha o tipo da anotacao.
 * @param {number} x - clientX
 * @param {number} y - clientY
 */
function _showAnnotationFamilyMenu(x, y) {
    if (!_annotationMenuEl) {
        _annotationMenuEl = document.createElement('div');
        _annotationMenuEl.className = 'panel-context-menu';
        _annotationMenuEl.id = 'aerial-annotation-menu';
        _annotationMenuEl.style.zIndex = '1100';
        document.body.appendChild(_annotationMenuEl);

        // Close on click outside (bubble phase — canvas stopPropagation prevents race)
        document.addEventListener('click', (e) => {
            if (_annotationMenuEl && !_annotationMenuEl.contains(e.target)) {
                _annotationMenuEl.classList.remove('visible');
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') _annotationMenuEl.classList.remove('visible');
        });
    }

    // Build menu items for annotation families
    let html = `<div class="panel-context-menu-label">${t('selectFamily')}</div>`;
    for (const fam of ANNOTATION_FAMILIES) {
        const iconName = FAMILY_ICONS[fam] || 'map-pin';
        const label = FAMILY_LABELS_PT[fam] || fam;
        html += `<button class="panel-context-menu-item" data-family="${fam}">
            ${getIcon(iconName, { size: '14px' })}
            <span>${label}</span>
        </button>`;
    }
    _annotationMenuEl.innerHTML = html;

    // Click handler for menu items
    _annotationMenuEl.onclick = (e) => {
        const item = e.target.closest('.panel-context-menu-item');
        if (!item) return;
        const family = item.dataset.family;
        if (family && _pendingAnnotation) {
            _addAnnotation(family, _pendingAnnotation.nx, _pendingAnnotation.ny);
            _pendingAnnotation = null;
        }
        _annotationMenuEl.classList.remove('visible');
    };

    // Position and show
    _annotationMenuEl.style.left = `${x}px`;
    _annotationMenuEl.style.top = `${y}px`;
    _annotationMenuEl.classList.add('visible');

    // Reposition if off-screen
    requestAnimationFrame(() => {
        const rect = _annotationMenuEl.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            _annotationMenuEl.style.left = `${window.innerWidth - rect.width - 8}px`;
        }
        if (rect.bottom > window.innerHeight) {
            _annotationMenuEl.style.top = `${window.innerHeight - rect.height - 8}px`;
        }
    });
}

/**
 * Add user annotation and update canvas + list.
 * Salva anotacao, redesenha canvas com icones, atualiza lista.
 * @param {string} family
 * @param {number} nx - Normalized x (0-1)
 * @param {number} ny - Normalized y (0-1)
 */
function _addAnnotation(family, nx, ny) {
    _userAnnotations.push({ nx, ny, family });
    _redrawCanvas();
    _renderAnnotationList();
}

/**
 * Redraw canvas with base image + detected features + annotation markers.
 * Redesenha imagem base, sobrepoe retangulos das feicoes detectadas,
 * e marcadores de anotacao do usuario. Chamada apos analise e anotacoes.
 */
function _redrawCanvas() {
    const canvas = document.getElementById('aerial-preview-canvas');
    if (!canvas || !_currentImage) return;

    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
        const cw = canvas.width;
        const ch = canvas.height;
        ctx.drawImage(img, 0, 0, cw, ch);

        // Draw paint overlay (User NN labels) behind detected features
        if (_paintMode || _paintStrokes.length > 0) {
            _drawPaintOverlay(ctx, cw, ch);
        }

        // Draw detected features (outlines on the image)
        // Unselected first (behind), then selected on top
        const total = _detectedFeatures.length;
        if (total > 0 && _currentExtent) {
            for (let i = 0; i < total; i++) {
                if (!_selectedFeatures[i]) {
                    drawFeatureOutline(
                        ctx,
                        _detectedFeatures[i],
                        _currentExtent,
                        cw,
                        ch,
                        false,
                        total,
                        FAMILY_COLORS,
                        FAMILY_LABELS_PT,
                    );
                }
            }
            for (let i = 0; i < total; i++) {
                if (_selectedFeatures[i]) {
                    drawFeatureOutline(
                        ctx,
                        _detectedFeatures[i],
                        _currentExtent,
                        cw,
                        ch,
                        true,
                        total,
                        FAMILY_COLORS,
                        FAMILY_LABELS_PT,
                    );
                }
            }
        }

        // Draw user annotations on top of everything
        for (let i = 0; i < _userAnnotations.length; i++) {
            const ann = _userAnnotations[i];
            const px = ann.nx * cw;
            const py = ann.ny * ch;
            drawAnnotationMarker(ctx, px, py, ann.family, i + 1, FAMILY_COLORS);
        }

        // Set cursor based on mode
        canvas.style.cursor = _paintMode ? 'crosshair' : 'pointer';
    };
    img.src = _currentImage;
}

// Feature rendering functions moved to recognition/featureRenderer.js
// drawFeatureOutline, roundRect, drawAnnotationMarker imported at top

/**
 * Render annotation list below the canvas.
 * Lista com marcadores coloridos e botao de remover ao hover.
 */
function _renderAnnotationList() {
    const section = document.getElementById('aerial-annotations-section');
    const list = document.getElementById('aerial-annotations-list');
    const countEl = document.getElementById('aerial-annotation-count');
    if (!section || !list) return;

    section.style.display = _userAnnotations.length > 0 ? '' : 'none';
    if (countEl) countEl.textContent = `(${_userAnnotations.length})`;

    list.innerHTML = _userAnnotations
        .map((ann, i) => {
            const iconName = FAMILY_ICONS[ann.family] || 'map-pin';
            const icon = getIcon(iconName, { size: '14px' });
            const label = FAMILY_LABELS_PT[ann.family] || ann.family;
            const color = FAMILY_COLORS[ann.family] || '#888';
            const pctX = Math.round(ann.nx * 100);
            const pctY = Math.round(ann.ny * 100);
            return `<div class="aerial-annotation-row" style="border-left-color:${color};">
            <span class="annot-index" style="background:${color};">${i + 1}</span>
            <span style="width:16px;height:16px;flex-shrink:0;display:inline-flex;align-items:center;">${icon}</span>
            <span style="flex:1;font-size:12px;">${label}</span>
            <span style="font-size:10px;color:var(--window-muted);">(${pctX}%, ${pctY}%)</span>
            <button class="annot-remove" onclick="handleAerialRemoveAnnotation(${i})" title="Remove">
                ${getIcon('x', { size: '14px' })}
            </button>
        </div>`;
        })
        .join('');
}

/**
 * Remove a user annotation by index.
 * @param {number} index
 */
export function handleAerialRemoveAnnotation(index) {
    if (index >= 0 && index < _userAnnotations.length) {
        _userAnnotations.splice(index, 1);
        _redrawCanvas();
        _renderAnnotationList();
    }
}

/**
 * Clear all user annotations.
 * Limpa todas as anotacoes do usuario.
 */
export function handleAerialClearAnnotations() {
    _userAnnotations = [];
    _redrawCanvas();
    _renderAnnotationList();
}

/**
 * Clear all detected features (keep annotations).
 * Limpa resultados de analise mas mantem anotacoes do usuario.
 * Permite ao usuario recomecar a analise com diferentes parametros.
 */
export function handleAerialClearResults() {
    _detectedFeatures = [];
    _selectedFeatures = [];

    const container = document.getElementById('aerial-step-results');
    if (container) container.style.display = 'none';

    const confirmBtn = document.getElementById('aerial-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = true;

    // Hide vectorize/export buttons on clear
    const vecBtn = document.getElementById('aerial-vectorize-btn');
    if (vecBtn) {
        vecBtn.style.display = 'none';
        vecBtn.disabled = true;
    }
    const exportBtn = document.getElementById('aerial-export-geojson-btn');
    if (exportBtn) {
        exportBtn.style.display = 'none';
        exportBtn.disabled = true;
    }

    _redrawCanvas();
    showToast(t('resultsCleared') || 'Results cleared', 'info');
}

// ----------------------------------------------------------------
// PAINT MODE — Interactive labeling for User NN method
// Modo de pintura: usuario clica e arrasta no canvas para rotular
// regioes por familia, usado para treinar a rede neural.
// ----------------------------------------------------------------

/** Paint family color map (same as FAMILY_COLORS) */
const PAINT_COLORS = { ...FAMILY_COLORS };

/**
 * Initialize paint controls — build family selector buttons.
 * Cria botoes coloridos para selecionar a familia a ser pintada.
 */
async function _initPaintControls() {
    const container = document.getElementById('aerial-paint-families');
    if (!container || container.children.length > 0) return; // Already initialized

    const families = getClassifierFamilies();
    container.innerHTML = families
        .map((fam) => {
            const iconName = FAMILY_ICONS[fam] || 'map-pin';
            const label = FAMILY_LABELS_PT[fam] || fam;
            const color = PAINT_COLORS[fam] || '#888';
            const selected = fam === _paintFamily ? ' paint-family-selected' : '';
            return `<button class="btn btn-secondary paint-family-btn${selected}" data-family="${fam}"
                    style="font-size:10px; padding:2px 6px; border-color:${color}; ${selected ? `background:${color};color:#fff;` : ''}"
                    onclick="handleAerialSelectPaintFamily('${fam}')">
            <span data-icon="${iconName}" data-icon-size="12px"></span>
            ${label}
        </button>`;
        })
        .join('');
    hydrateIcons(container);

    // Attach canvas mouse events for painting
    _attachPaintListeners();

    // Enable classify button if network is already trained
    const classifyBtn = document.getElementById('aerial-classify-btn');
    if (classifyBtn) classifyBtn.disabled = !isNetworkTrained();

    // Load persisted classifier state
    if (_paintStrokes.length === 0) {
        const stored = await loadClassifier();
        if (stored.length > 0) {
            _paintStrokes = stored;
            setClassifierStrokes(_paintStrokes);
            _rebuildLabelGrid();
            _redrawCanvas();
        }
    }
}

/**
 * Attach mousedown/mousemove/mouseup listeners to the preview canvas.
 * Listeners are capture-phase to prevent annotation click handler.
 */
function _attachPaintListeners() {
    const canvas = document.getElementById('aerial-preview-canvas');
    if (!canvas || canvas._paintListenersAttached) return;

    canvas.addEventListener(
        'mousedown',
        (e) => {
            if (!_paintMode || !_currentImage) return;
            e.preventDefault();
            e.stopPropagation();
            _isPainting = true;
            _currentStroke = { family: _paintFamily, points: [], brushSize: _paintBrushSize };
            _paintAt(e, canvas);
        },
        true,
    );

    canvas.addEventListener(
        'mousemove',
        (e) => {
            if (!_isPainting || !_paintMode) return;
            e.preventDefault();
            e.stopPropagation();
            _paintAt(e, canvas);
        },
        true,
    );

    const endPaint = (e) => {
        if (!_isPainting) return;
        if (_paintMode) {
            e.preventDefault();
            e.stopPropagation();
        }
        _isPainting = false;
        if (_currentStroke && _currentStroke.points.length > 0) {
            _paintStrokes.push(_currentStroke);
            setClassifierStrokes(_paintStrokes);
        }
        _currentStroke = null;
    };
    canvas.addEventListener('mouseup', endPaint, true);
    canvas.addEventListener('mouseleave', endPaint, true);

    canvas._paintListenersAttached = true;
}

/**
 * Paint at mouse position — stamp brush onto label grid + draw on canvas.
 * @param {MouseEvent} e
 * @param {HTMLCanvasElement} canvas
 */
function _paintAt(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

    // Record normalized point
    if (_currentStroke) _currentStroke.points.push([nx, ny]);

    // Stamp onto label grid (512x512)
    const SIZE = 512;
    if (!_labelGrid) _labelGrid = new Uint8Array(SIZE * SIZE);
    const familyIdx = getFamilyIndex(_paintFamily) + 1; // 1-indexed (0=unlabeled)
    const gx = Math.floor(nx * SIZE);
    const gy = Math.floor(ny * SIZE);
    const r = _paintBrushSize;
    const r2 = r * r;

    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const px = gx + dx;
            const py = gy + dy;
            if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) continue;
            _labelGrid[py * SIZE + px] = familyIdx;
        }
    }

    // Draw brush stroke on canvas directly (fast visual feedback)
    const ctx = canvas.getContext('2d');
    const canvasX = nx * canvas.width;
    const canvasY = ny * canvas.height;
    const canvasR = (r / SIZE) * canvas.width;
    const color = PAINT_COLORS[_paintFamily] || '#888';

    ctx.save();
    ctx.beginPath();
    ctx.arc(canvasX, canvasY, canvasR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.restore();
}

/**
 * Rebuild label grid from paint strokes (after undo or import).
 * Reconstroi o grid de labels reexecutando todos os strokes.
 */
function _rebuildLabelGrid() {
    const SIZE = 512;
    _labelGrid = new Uint8Array(SIZE * SIZE);
    for (const stroke of _paintStrokes) {
        const familyIdx = getFamilyIndex(stroke.family) + 1;
        const r = stroke.brushSize || 12;
        const r2 = r * r;
        for (const [nx, ny] of stroke.points) {
            const gx = Math.floor(nx * SIZE);
            const gy = Math.floor(ny * SIZE);
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (dx * dx + dy * dy > r2) continue;
                    const px = gx + dx;
                    const py = gy + dy;
                    if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) continue;
                    _labelGrid[py * SIZE + px] = familyIdx;
                }
            }
        }
    }
}

/**
 * Draw paint overlay on canvas — replays all strokes as colored circles.
 * Chamada dentro de _redrawCanvas() apos imagem base.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cw - Canvas width
 * @param {number} ch - Canvas height
 */
function _drawPaintOverlay(ctx, cw, ch) {
    if (_paintStrokes.length === 0) return;

    ctx.save();
    ctx.globalAlpha = 0.4;

    for (const stroke of _paintStrokes) {
        const color = PAINT_COLORS[stroke.family] || '#888';
        const r = ((stroke.brushSize || 12) / 512) * cw;
        ctx.fillStyle = color;

        for (const [nx, ny] of stroke.points) {
            ctx.beginPath();
            ctx.arc(nx * cw, ny * ch, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.restore();
}

// ----------------------------------------------------------------
// PAINT MODE HANDLERS — Exported for window.* registration
// ----------------------------------------------------------------

/**
 * Select paint family (which type to paint on the canvas).
 * @param {string} family
 */
export function handleAerialSelectPaintFamily(family) {
    _paintFamily = family;
    // Update button highlighting
    const btns = document.querySelectorAll('.paint-family-btn');
    btns.forEach((btn) => {
        const fam = btn.dataset.family;
        const color = PAINT_COLORS[fam] || '#888';
        const isSelected = fam === family;
        btn.classList.toggle('paint-family-selected', isSelected);
        btn.style.background = isSelected ? color : '';
        btn.style.color = isSelected ? '#fff' : '';
    });
}

/**
 * Change paint brush size.
 * @param {string|number} value
 */
export function handleAerialBrushChange(value) {
    _paintBrushSize = parseInt(value, 10) || 12;
    const valEl = document.getElementById('aerial-paint-brush-val');
    if (valEl) valEl.textContent = _paintBrushSize;
}

/**
 * Train the neural network from painted labels.
 * Extrai dados de treino do grid pintado e treina a rede.
 */
export async function handleAerialTrainNN() {
    if (!_currentImage || !_labelGrid) {
        showToast(t('paintLabelsFirst') || 'Paint some labels on the image first', 'error');
        return;
    }

    // Count labeled pixels
    let labelCount = 0;
    for (let i = 0; i < _labelGrid.length; i++) {
        if (_labelGrid[i] > 0) labelCount++;
    }
    if (labelCount < 50) {
        showToast(t('paintLabelsFirst') || 'Paint more labels (minimum ~50 pixels)', 'error');
        return;
    }

    const trainBtn = document.getElementById('aerial-train-btn');
    const statusEl = document.getElementById('aerial-train-status');
    if (trainBtn) trainBtn.disabled = true;
    if (statusEl) {
        statusEl.style.display = '';
        statusEl.textContent = 'Extracting training data...';
    }

    try {
        // Reset network for fresh training
        resetNetwork();

        // Extract training data from image + label grid
        const data = await extractTrainingData(_currentImage, _labelGrid);
        if (statusEl) statusEl.textContent = `Training on ${data.length} samples...`;

        // Train with progress feedback
        const result = trainNetwork(data, {
            epochs: 100,
            lr: 0.025,
            batchSize: 64,
            onProgress: ({ epoch, loss, accuracy, total }) => {
                if (statusEl) {
                    statusEl.textContent = `Epoch ${epoch + 1}/${total} — loss: ${loss.toFixed(3)}, acc: ${(accuracy * 100).toFixed(1)}%`;
                }
            },
        });

        // Persist classifier
        persistClassifier(_paintStrokes);

        // Update UI
        const classifyBtn = document.getElementById('aerial-classify-btn');
        if (classifyBtn) classifyBtn.disabled = false;
        if (statusEl)
            statusEl.textContent = `Done — loss: ${result.finalLoss.toFixed(3)}, accuracy: ${(result.accuracy * 100).toFixed(1)}%`;
        showToast(`Network trained: ${(result.accuracy * 100).toFixed(0)}% accuracy`, 'success');
    } catch (err) {
        console.error('Train NN error:', err);
        showToast(err.message || 'Training failed', 'error');
        if (statusEl) statusEl.textContent = 'Training failed.';
    } finally {
        if (trainBtn) trainBtn.disabled = false;
    }
}

/**
 * Classify image using the trained neural network.
 * Redireciona para handleAerialAnalyze com metodo 'usernn' selecionado.
 */
export function handleAerialClassifyNN() {
    if (!isNetworkTrained()) {
        showToast(t('trainNetworkFirst') || 'Train the network first', 'error');
        return;
    }
    // Ensure usernn radio is selected
    const radio = document.getElementById('aerial-method-usernn');
    if (radio) radio.checked = true;
    handleAerialAnalyze();
}

/**
 * Clear all painted labels and reset.
 */
export function handleAerialClearPaint() {
    _paintStrokes = [];
    setClassifierStrokes(_paintStrokes);
    _labelGrid = new Uint8Array(512 * 512);
    _currentStroke = null;
    _isPainting = false;
    const statusEl = document.getElementById('aerial-train-status');
    if (statusEl) {
        statusEl.style.display = 'none';
        statusEl.textContent = '';
    }
    _redrawCanvas();
    persistClassifier([]);
    showToast(t('labelsCleared') || 'Labels cleared', 'info');
}

/**
 * Undo the last paint stroke.
 */
export function handleAerialUndoPaint() {
    if (_paintStrokes.length === 0) return;
    _paintStrokes.pop();
    setClassifierStrokes(_paintStrokes);
    _rebuildLabelGrid();
    _redrawCanvas();
}

// ----------------------------------------------------------------
// VECTORIZATION ENGINE — Handlers
// Converte mascara semantica em GeoJSON georreferenciado via OpenCV.js
// ----------------------------------------------------------------

/**
 * Run Universal Vectorization Engine on cached category grid.
 * Requer que uma analise ML ou Color tenha sido executada antes
 * para cachear o _lastCategoryGrid.
 */
export async function handleAerialVectorize() {
    if (!_lastCategoryGrid) {
        showToast('Run ML or Color analysis first to generate a category grid', 'error');
        return;
    }
    if (!_currentImage || !_currentExtent) {
        showToast('No image or extent available', 'error');
        return;
    }

    const processing = document.getElementById('aerial-processing');
    if (processing) processing.style.display = '';
    _updateProgress('Loading vectorization engine...', 0);

    try {
        const _vecFn = _vectorizeOverride || vectorize;
        _lastGeoJSON = await _vecFn({
            imageDataUrl: _currentImage,
            categoryGrid: _lastCategoryGrid,
            extent: _currentExtent,
            onProgress: (info) => _updateProgress(info.message, info.progress),
        });

        const count = _lastGeoJSON.features?.length ?? 0;
        showToast(`Vectorization complete: ${count} GeoJSON features`, 'success');

        // Show Export GeoJSON button after successful vectorization
        const exportBtn = document.getElementById('aerial-export-geojson-btn');
        if (exportBtn && _lastGeoJSON) {
            exportBtn.style.display = '';
            exportBtn.disabled = false;
        }
    } catch (err) {
        console.error('Vectorization error:', err);
        showToast(err.message || 'Vectorization failed', 'error');
    } finally {
        if (processing) processing.style.display = 'none';
    }
}

/**
 * Export last vectorized GeoJSON as downloadable .geojson file.
 * Padrao anchor-click download (mesmo de io/encoder.js).
 */
export function handleAerialExportGeoJSON() {
    if (!_lastGeoJSON) {
        showToast('Run vectorization first', 'error');
        return;
    }

    const json = JSON.stringify(_lastGeoJSON, null, 2);
    const blob = new Blob([json], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'vectorized-features.geojson';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const count = _lastGeoJSON.features?.length ?? 0;
    showToast(`Exported ${count} features as GeoJSON`, 'success');
}

// ----------------------------------------------------------------
// SEGMENT-GEOSPATIAL HANDLERS — samAuto, textPrompt, tileMap
// ----------------------------------------------------------------

/**
 * Handle text prompt input change for CLIP segmentation.
 * Armazena texto para uso quando usuario clicar Analyze.
 * @param {string} text
 */
export function handleAerialTextPromptChange(text) {
    _textPrompt = text || '';
}

/**
 * Handle tile map segmentation — opens map picker, fetches tiles, segments.
 * Pipeline: mapPicker(bounds) → stitchTiles → SAM autoMask → features.
 */
export async function handleAerialTileMapSegment() {
    const processing = document.getElementById('aerial-processing');
    if (processing) processing.style.display = '';
    _updateProgress(t('selectMapRegion') || 'Select a region on the map...', 5);

    try {
        const { openMapPickerModal } = await import('../ui/mapPicker.js');
        const result = await openMapPickerModal({ mode: 'bounds' });

        if (!result || !result.sw) {
            // User cancelled
            if (processing) processing.style.display = 'none';
            return;
        }

        _updateProgress(t('tileMapStitching') || 'Fetching satellite tiles...', 15);

        _autoMaskAbort = new AbortController();

        const tileResult = await segmentFromTiles(result.sw, result.ne, {
            outputSize: 512,
            signal: _autoMaskAbort.signal,
            onProgress: (info) => _updateProgress(info.message, info.progress),
        });

        _autoMaskAbort = null;

        // Set handler state with stitched image
        _currentImage = tileResult.imageDataUrl;
        _currentExtent = tileResult.extent;

        // Load stitched image into preview canvas
        const canvas = document.getElementById('aerial-preview-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            const img = new Image();
            img.onload = () => {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
            };
            img.src = tileResult.imageDataUrl;
        }

        // Process features through standard dedup/display pipeline
        const newFeatures = tileResult.features;
        const dedupDist = 5;
        const unique = newFeatures.filter(
            (nf) =>
                !_detectedFeatures.some(
                    (ef) =>
                        ef.family === nf.family &&
                        Math.abs(ef.position.x - nf.position.x) < dedupDist &&
                        Math.abs(ef.position.z - nf.position.z) < dedupDist,
                ),
        );

        _detectedFeatures = _detectedFeatures.concat(unique);
        _assignSequentialNames(_detectedFeatures);
        const prevLen = _selectedFeatures.length;
        _selectedFeatures = _detectedFeatures.map((_, i) => (i < prevLen ? _selectedFeatures[i] : true));

        _showResults();
        _redrawCanvas();

        showToast(
            t('tileMapComplete', { count: unique.length }) ||
                `${unique.length} features detected from satellite imagery`,
            'success',
        );
    } catch (err) {
        if (err.name === 'AbortError') {
            showToast(t('analysisAborted') || 'Analysis cancelled', 'info');
        } else {
            console.error('[aerial] Tile map segmentation error:', err);
            showToast(err.message || 'Tile map segmentation failed', 'error');
        }
    } finally {
        if (processing) processing.style.display = 'none';
        const analyzeBtn = document.getElementById('aerial-analyze-btn');
        if (analyzeBtn) analyzeBtn.disabled = false;
    }
}

/**
 * Cancel in-flight auto-mask / text-prompt analysis.
 */
export function handleAerialAbortAutoMask() {
    if (_autoMaskAbort) {
        _autoMaskAbort.abort();
        _autoMaskAbort = null;
    }
}

/**
 * Set internal closure state for E2E testing.
 * Permite que testes populem estado sem passar pelo fluxo real.
 * @private — Somente para testes
 */
export function _setTestState(state) {
    if (state.image !== undefined) _currentImage = state.image;
    if (state.extent !== undefined) _currentExtent = state.extent;
    if (state.grid !== undefined) _lastCategoryGrid = state.grid;
    if (state.geojson !== undefined) _lastGeoJSON = state.geojson;
    if (state.vectorizeOverride !== undefined) _vectorizeOverride = state.vectorizeOverride;
    if (state.changeComparisonImage !== undefined) _changeComparisonImage = state.changeComparisonImage;
}

// ----------------------------------------------------------------
// GEOREFERENCE — Interactive GCP-based image registration
// ----------------------------------------------------------------
// Permite ao usuario colocar pontos de controle (GCPs) livremente
// na imagem aerea e depois associar cada ponto a coordenadas WGS84
// clicando no mapa. Usa transformada affine (mapGeoreferencer.js)
// para converter pixel → UTM → vertices do boundary 3D.
// ----------------------------------------------------------------

let _georefImage = null; // Data URL of uploaded image
let _georefImageW = 0; // Natural width of uploaded image
let _georefImageH = 0; // Natural height of uploaded image
let _georefGCPs = []; // Array<{ id, imgX, imgY, lat, lon, label }>
let _georefActiveIdx = -1; // GCP index awaiting map click (-1 = none)
let _georefDragIdx = -1; // GCP index being dragged on image
let _georefMap = null; // MapLibre instance
let _georefMarkers = {}; // Map markers keyed by GCP id
let _georefSatVisible = false; // Satellite layer toggle state
let _georefNextId = 1; // Auto-increment for GCP IDs
let _georefCanvas = null; // Reference to image canvas for redraws
let _georefSearchTimer = null; // Nominatim debounce timer

const MAPLIBRE_CSS_URL = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css';
const MAPLIBRE_JS_URL = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js';
const TURF_CDN = 'https://esm.sh/@turf/turf@7.1.0';
const GEOREF_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const GEOREF_SAT_TILES =
    'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg';
const GEOREF_GCP_RADIUS = 10; // Pixel radius for GCP markers on canvas
const GEOREF_HIT_RADIUS = 18; // Click hit test radius
const GEOREF_INPUT_STYLE =
    'width:90px;padding:3px 6px;background:var(--bg-secondary,#222);border:1px solid var(--border-color,#444);border-radius:3px;color:var(--text-primary,#e0e0e0);font-size:11px;';

/** @type {any|null} */
let _turf = null;

/**
 * Open the georeferencing modal (split-pane: image + map).
 * Construi modal de duas colunas com canvas de imagem a esquerda
 * e mapa interativo (MapLibre) a direita. GCPs interativos.
 */
export async function handleAerialGeoreference() {
    // Reset state
    _georefGCPs = [];
    _georefActiveIdx = -1;
    _georefDragIdx = -1;
    _georefNextId = 1;
    _georefSatVisible = false;
    _georefImage = _currentImage || null;
    _georefImageW = 0;
    _georefImageH = 0;

    const {
        overlay,
        body,
        footer,
        close: closeModal_,
    } = buildModalShell({
        title: t('georeferenceTitle') || 'Georeference Aerial Image',
        width: '960px',
        twoPane: true,
        onClose: _cleanupGeoref,
    });
    let _resizeCleanup = null; // Cleanup for responsive listener

    // ---- LEFT PANE: Image canvas + toolbar ----
    const leftPane = document.createElement('div');
    leftPane.className = 'georef-left-pane';
    leftPane.style.cssText =
        'width:50%;min-width:280px;display:flex;flex-direction:column;padding:12px;border-right:1px solid var(--border-color,#333);';

    // Toolbar: Upload + AI Suggest (Phase 3 placeholder)
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap;';

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'btn btn-secondary';
    uploadBtn.innerHTML = `<span data-icon="upload" data-icon-size="14px"></span> ${escapeHtml(t('georefUploadImage') || 'Upload Image')}`;
    uploadBtn.style.cssText = 'font-size:12px;';
    uploadBtn.onclick = () => _georefUploadImage();
    toolbar.appendChild(uploadBtn);

    // AI Suggest Location button (Phase 3)
    const suggestBtn = document.createElement('button');
    suggestBtn.className = 'btn btn-secondary';
    suggestBtn.innerHTML = `<span data-icon="globe" data-icon-size="14px"></span> ${escapeHtml(t('georefSuggestLocation') || 'Suggest Location')}`;
    suggestBtn.style.cssText = 'font-size:12px;';
    suggestBtn.id = 'georef-suggest-btn';
    if (!hasApiKey()) {
        suggestBtn.disabled = true;
        suggestBtn.title = t('georefSuggestNoKey') || 'Configure AI key to use this feature';
    }
    suggestBtn.onclick = () => _aiSuggestGeoref(suggestBtn);
    toolbar.appendChild(suggestBtn);

    // Hint
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:10px;color:var(--text-secondary,#888);margin-left:auto;';
    hint.textContent = t('georefClickImageFirst') || 'Click image to place GCP';
    hint.id = 'georef-hint';
    toolbar.appendChild(hint);

    leftPane.appendChild(toolbar);

    const imageCanvas = document.createElement('canvas');
    imageCanvas.style.cssText = 'flex:1;width:100%;background:#111;border-radius:4px;cursor:crosshair;';
    imageCanvas.id = 'georef-image-canvas';
    _georefCanvas = imageCanvas;

    // Click: cria ou seleciona GCP
    imageCanvas.addEventListener('click', (e) => _onGeorefImageClick(e, imageCanvas));

    // Drag: mousedown-scoped pattern (per CLAUDE.md event listener rules)
    imageCanvas.addEventListener('mousedown', (e) => {
        const hit = _hitTestGCP(e, imageCanvas);
        if (hit < 0) return;
        _georefDragIdx = hit;
        imageCanvas.style.cursor = 'grabbing';

        const onMove = (me) => {
            const rect = imageCanvas.getBoundingClientRect();
            const scaleX = _georefImageW / imageCanvas.width;
            const scaleY = _georefImageH / imageCanvas.height;
            _georefGCPs[_georefDragIdx].imgX = Math.max(0, Math.min(_georefImageW, (me.clientX - rect.left) * scaleX));
            _georefGCPs[_georefDragIdx].imgY = Math.max(0, Math.min(_georefImageH, (me.clientY - rect.top) * scaleY));
            _renderGeorefImageCanvas(imageCanvas);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            _georefDragIdx = -1;
            imageCanvas.style.cursor = 'crosshair';
            _updateGeorefFooter();
            _updateGeorefPreview();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    leftPane.appendChild(imageCanvas);

    // ---- RIGHT PANE: Map + search + satellite toggle ----
    const rightPane = document.createElement('div');
    rightPane.className = 'georef-right-pane';
    rightPane.style.cssText = 'width:50%;min-width:280px;display:flex;flex-direction:column;';

    // Map toolbar: search + satellite toggle
    const mapToolbar = document.createElement('div');
    mapToolbar.style.cssText =
        'display:flex;gap:6px;padding:6px 8px;align-items:center;border-bottom:1px solid var(--border-color,#333);';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = t('georefSearchPlace') || 'Search location...';
    searchInput.style.cssText =
        'flex:1;padding:4px 8px;background:var(--bg-secondary,#222);border:1px solid var(--border-color,#444);border-radius:3px;color:var(--text-primary,#e0e0e0);font-size:12px;';
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') _georefSearchNominatim(searchInput.value);
    });
    // Debounce em 500ms para rate limiting do Nominatim
    searchInput.addEventListener('input', () => {
        clearTimeout(_georefSearchTimer);
        _georefSearchTimer = setTimeout(() => {
            if (searchInput.value.length >= 3) _georefSearchNominatim(searchInput.value);
        }, 500);
    });
    mapToolbar.appendChild(searchInput);

    const satBtn = document.createElement('button');
    satBtn.className = 'btn btn-secondary';
    satBtn.style.cssText = 'font-size:11px;padding:4px 8px;white-space:nowrap;';
    satBtn.innerHTML = '<span data-icon="satellite" data-icon-size="12px"></span>';
    satBtn.title = t('georefToggleSatellite') || 'Toggle satellite';
    satBtn.onclick = () => _georefToggleSatellite(satBtn);
    mapToolbar.appendChild(satBtn);

    // Preview toggle button — show/hide image overlay on map
    const previewBtn = document.createElement('button');
    previewBtn.className = 'georef-preview-toggle active';
    previewBtn.textContent = t('georefPreview') || 'Preview';
    previewBtn.title = t('georefTogglePreview') || 'Toggle image preview on map';
    previewBtn.id = 'georef-preview-toggle';
    let _previewVisible = true;
    previewBtn.onclick = () => {
        _previewVisible = !_previewVisible;
        previewBtn.classList.toggle('active', _previewVisible);
        if (_previewVisible) {
            _updateGeorefPreview();
        } else {
            _removeGeorefPreview();
        }
    };
    mapToolbar.appendChild(previewBtn);

    rightPane.appendChild(mapToolbar);

    const mapContainer = document.createElement('div');
    mapContainer.id = 'georef-map-container';
    mapContainer.style.cssText = 'flex:1;min-height:250px;';
    rightPane.appendChild(mapContainer);

    body.appendChild(leftPane);
    body.appendChild(rightPane);

    // ---- FOOTER: GCP list + metrics + meta + actions ----
    footer.style.cssText =
        'display:flex;flex-direction:column;gap:6px;padding:10px 16px;border-top:1px solid var(--border-color,#333);max-height:220px;overflow-y:auto;';
    footer.innerHTML = '';

    // GCP list container (dynamic)
    const gcpList = document.createElement('div');
    gcpList.id = 'georef-gcp-list';
    gcpList.style.cssText = 'font-size:11px;';
    footer.appendChild(gcpList);

    // Metrics row
    const metricsRow = document.createElement('div');
    metricsRow.id = 'georef-metrics';
    metricsRow.style.cssText =
        'font-size:11px;color:var(--text-secondary,#888);display:flex;gap:12px;align-items:center;flex-wrap:wrap;';
    metricsRow.innerHTML = `<span>${t('georefGCPCount') || 'GCPs'}: 0/3+</span>`;
    footer.appendChild(metricsRow);

    // Meta row: source, date, opacity, buttons
    const metaRow = document.createElement('div');
    metaRow.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:11px;flex-wrap:wrap;';

    const sourceSelect = document.createElement('select');
    sourceSelect.id = 'georef-source';
    sourceSelect.style.cssText = GEOREF_INPUT_STYLE;
    for (const [val, lbl] of [
        ['drone', 'Drone'],
        ['ortho', 'Ortho'],
        ['scan', 'Scan'],
        ['satellite', 'Satellite'],
        ['other', t('other') || 'Other'],
    ]) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        sourceSelect.appendChild(opt);
    }
    metaRow.appendChild(sourceSelect);

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.id = 'georef-date';
    dateInput.style.cssText = GEOREF_INPUT_STYLE;
    dateInput.value = new Date().toISOString().slice(0, 10);
    metaRow.appendChild(dateInput);

    const opacityLabel = document.createElement('span');
    opacityLabel.textContent = t('georefOverlayOpacity') || 'Opacity:';
    metaRow.appendChild(opacityLabel);

    const savedOpacity = localStorage.getItem('ecbyts-georef-opacity') || '70';
    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range';
    opacitySlider.min = '10';
    opacitySlider.max = '100';
    opacitySlider.value = savedOpacity;
    opacitySlider.id = 'georef-opacity';
    opacitySlider.style.cssText = 'width:70px;';
    opacitySlider.oninput = () => {
        localStorage.setItem('ecbyts-georef-opacity', opacitySlider.value);
        _updateGeorefPreviewOpacity();
    };
    metaRow.appendChild(opacitySlider);

    // Spacer
    const spacer = document.createElement('span');
    spacer.style.cssText = 'flex:1;';
    metaRow.appendChild(spacer);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = t('cancel') || 'Cancel';
    cancelBtn.onclick = () => {
        if (_resizeCleanup) _resizeCleanup();
        closeModal_();
    };
    metaRow.appendChild(cancelBtn);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary';
    applyBtn.textContent = t('applyGeoreference') || 'Apply';
    applyBtn.id = 'georef-apply-btn';
    applyBtn.disabled = true;
    applyBtn.onclick = async () => {
        await _applyGeoreference();
        if (_resizeCleanup) _resizeCleanup();
        closeModal_();
    };
    metaRow.appendChild(applyBtn);

    footer.appendChild(metaRow);

    // ---- Responsive: stacked layout for narrow viewports ----
    const applyResponsive = () => {
        const isNarrow = window.innerWidth < 800;
        leftPane.style.width = isNarrow ? '100%' : '50%';
        rightPane.style.width = isNarrow ? '100%' : '50%';
        body.style.flexDirection = isNarrow ? 'column' : 'row';
        leftPane.style.borderRight = isNarrow ? 'none' : '1px solid var(--border-color,#333)';
        leftPane.style.borderBottom = isNarrow ? '1px solid var(--border-color,#333)' : 'none';
        if (isNarrow) {
            leftPane.style.maxHeight = '45vh';
            rightPane.style.minHeight = '250px';
        } else {
            leftPane.style.maxHeight = '';
        }
    };
    applyResponsive();
    window.addEventListener('resize', applyResponsive);
    _resizeCleanup = () => window.removeEventListener('resize', applyResponsive);

    document.body.appendChild(overlay);
    hydrateIcons(overlay);

    // Init map + render image after DOM is in place
    requestAnimationFrame(async () => {
        if (_georefImage) _renderGeorefImageCanvas(imageCanvas);
        await _initGeorefMap(mapContainer);
    });
}

// ---- Upload handler with size warning + GeoTIFF detection ----
function _georefUploadImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/tiff,.tif,.tiff';
    input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 50 * 1024 * 1024) {
            showToast(t('georefImageTooLarge') || 'Image too large (max 50 MB)', 'error');
            return;
        }
        // Warning de tamanho para ECO1
        if (file.size > 5 * 1024 * 1024) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
            const eco1MB = ((file.size * 1.8) / (1024 * 1024)).toFixed(0);
            showToast(
                t('georefLargeImageWarning') ||
                    `Large image (${sizeMB} MB) — export will be ~${eco1MB} MB. Consider resizing.`,
                'warning',
            );
        }
        // GeoTIFF detection
        if (file.name.match(/\.tiff?$/i)) {
            showToast(
                t('georefGeoTiffNote') ||
                    'GeoTIFF detected — embedded coordinates not extracted. Place control points manually.',
                'info',
            );
        }
        _georefImage = await readFileAsDataUrl(file);

        // Reset stale calibration from previous image.
        for (const marker of Object.values(_georefMarkers)) marker?.remove?.();
        _georefMarkers = {};
        _georefGCPs = [];
        _georefActiveIdx = -1;
        _removeGeorefPreview();
        _updateGeorefPolygon();
        _updateGeorefFooter();

        // Resolve natural dimensions before EXIF-driven GCP placement.
        try {
            const dims = await new Promise((resolve, reject) => {
                const tmpImg = new Image();
                tmpImg.onload = () => resolve({ width: tmpImg.naturalWidth, height: tmpImg.naturalHeight });
                tmpImg.onerror = () => reject(new Error('Invalid image'));
                tmpImg.src = _georefImage;
            });
            _georefImageW = dims.width;
            _georefImageH = dims.height;
        } catch {
            showToast(t('georefImageLoadFailed') || 'Failed to load image', 'error');
            _georefImage = null;
            return;
        }

        const canvas = document.getElementById('georef-image-canvas');
        if (canvas) _renderGeorefImageCanvas(canvas);

        // Try EXIF GPS extraction (Phase 2 — importado dinamicamente)
        try {
            const { extractExifGPS } = await import('../helpers/exifGps.js');
            const gps = await extractExifGPS(file);
            if (gps) {
                showToast(t('georefExifFound') || 'GPS coordinates found in image metadata', 'info');
                if (_georefMap) {
                    _georefMap.flyTo({ center: [gps.lon, gps.lat], zoom: 16 });
                }
                // Auto-criar GCP no centro da imagem com coords EXIF
                _georefGCPs.push({
                    id: _georefNextId++,
                    imgX: _georefImageW / 2,
                    imgY: _georefImageH / 2,
                    lat: gps.lat,
                    lon: gps.lon,
                    label: 'EXIF GPS',
                });
                _georefActiveIdx = -1;
                _updateGeorefFooter();
                _addGCPMapMarker(_georefGCPs.length - 1);
            }
        } catch {
            /* Phase 2 not yet available or no GPS — silencioso */
        }
    };
    input.click();
}

function _cleanupGeoref() {
    if (_georefMap) {
        if (_georefMap.remove) _georefMap.remove();
        _georefMap = null;
    }
    _georefGCPs = [];
    _georefMarkers = {};
    _georefActiveIdx = -1;
    _georefDragIdx = -1;
    _georefCanvas = null;
    _georefSatVisible = false;
    clearTimeout(_georefSearchTimer);
    _georefSearchTimer = null;
}

// ---- Image canvas rendering with GCP markers ----
function _renderGeorefImageCanvas(canvas) {
    if (!_georefImage) return;
    const img = new Image();
    img.onload = () => {
        if (!_georefImageW) {
            _georefImageW = img.naturalWidth;
            _georefImageH = img.naturalHeight;
        }
        const ratio = img.width / img.height;
        canvas.width = canvas.clientWidth || 400;
        canvas.height = Math.round(canvas.width / ratio);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        _drawGeorefGCPs(ctx, canvas.width, canvas.height);
    };
    img.src = _georefImage;
}

/**
 * Draw all GCP markers on the image canvas.
 * Marcadores numerados: vermelho = sem coords, azul = ativo, verde = completo.
 */
function _drawGeorefGCPs(ctx, canvasW, canvasH) {
    if (!_georefImageW) return;
    const scaleX = canvasW / _georefImageW;
    const scaleY = canvasH / _georefImageH;

    for (let i = 0; i < _georefGCPs.length; i++) {
        const gcp = _georefGCPs[i];
        const cx = gcp.imgX * scaleX;
        const cy = gcp.imgY * scaleY;
        const isActive = _georefActiveIdx === i;
        const isComplete = gcp.lat !== null && gcp.lon !== null;
        const r = GEOREF_GCP_RADIUS;

        // Crosshair lines
        ctx.strokeStyle = isComplete ? '#22c55e' : isActive ? '#3b82f6' : '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - r * 1.5, cy);
        ctx.lineTo(cx - r * 0.5, cy);
        ctx.moveTo(cx + r * 0.5, cy);
        ctx.lineTo(cx + r * 1.5, cy);
        ctx.moveTo(cx, cy - r * 1.5);
        ctx.lineTo(cx, cy - r * 0.5);
        ctx.moveTo(cx, cy + r * 0.5);
        ctx.lineTo(cx, cy + r * 1.5);
        ctx.stroke();

        // Circle
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = isComplete ? 'rgba(34,197,94,0.3)' : isActive ? 'rgba(59,130,246,0.3)' : 'rgba(239,68,68,0.3)';
        ctx.fill();
        ctx.strokeStyle = isComplete ? '#22c55e' : isActive ? '#3b82f6' : '#ef4444';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Number label
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(gcp.id), cx, cy);
    }
}

/**
 * Hit test: find GCP near canvas click position.
 * @returns {number} Index of hit GCP or -1
 */
function _hitTestGCP(e, canvas) {
    if (!_georefImageW || _georefGCPs.length === 0) return -1;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const scaleX = canvas.width / _georefImageW;
    const scaleY = canvas.height / _georefImageH;

    let closest = -1;
    let minDist = GEOREF_HIT_RADIUS;
    for (let i = 0; i < _georefGCPs.length; i++) {
        const gcp = _georefGCPs[i];
        const dx = mx - gcp.imgX * scaleX;
        const dy = my - gcp.imgY * scaleY;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist) {
            minDist = d;
            closest = i;
        }
    }
    return closest;
}

/**
 * Image canvas click handler.
 * Cria novo GCP na posicao ou seleciona existente se perto.
 */
function _onGeorefImageClick(e, canvas) {
    if (_georefDragIdx >= 0) return; // Skip during drag
    if (!_georefImage || !_georefImageW) {
        showToast(t('georefUploadFirst') || 'Upload an image first', 'info');
        return;
    }

    const hitIdx = _hitTestGCP(e, canvas);
    if (hitIdx >= 0) {
        // Select existing GCP — next map click sets its coords
        _georefActiveIdx = hitIdx;
        _renderGeorefImageCanvas(canvas);
        _updateGeorefFooter();
        const gcp = _georefGCPs[hitIdx];
        const hint = document.getElementById('georef-hint');
        if (hint) hint.textContent = t('georefClickMapNow') || `Click map to set GCP #${gcp.id} coordinates`;
        showToast(t('georefClickMapNow') || `Click map to set GCP #${gcp.id} coordinates`, 'info');
        return;
    }

    // Create new GCP at click position
    const rect = canvas.getBoundingClientRect();
    const scaleX = _georefImageW / canvas.width;
    const scaleY = _georefImageH / canvas.height;
    const imgX = (e.clientX - rect.left) * scaleX;
    const imgY = (e.clientY - rect.top) * scaleY;

    const newGCP = {
        id: _georefNextId++,
        imgX,
        imgY,
        lat: null,
        lon: null,
        label: `GCP ${_georefGCPs.length + 1}`,
    };
    _georefGCPs.push(newGCP);
    _georefActiveIdx = _georefGCPs.length - 1;

    _renderGeorefImageCanvas(canvas);
    _updateGeorefFooter();

    const hint = document.getElementById('georef-hint');
    if (hint) hint.textContent = t('georefClickMapNow') || `Click map to set GCP #${newGCP.id} coordinates`;
    showToast(t('georefClickMapNow') || `Click map to set GCP #${newGCP.id} coordinates`, 'info');
}

// ---- Map initialization with satellite toggle + search ----
async function _initGeorefMap(container) {
    try {
        if (!window.maplibregl) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = MAPLIBRE_CSS_URL;
            document.head.appendChild(link);
            await loadScriptCDN(MAPLIBRE_JS_URL, 'maplibregl', 15000);
        }

        let center = [-47, -15]; // Default Brazil
        let zoom = 4;
        if (hasOrigin()) {
            try {
                const origin = getOrigin();
                const wgs = utmToWGS84(origin);
                center = [wgs.longitude, wgs.latitude];
                zoom = 15;
            } catch {
                /* use default */
            }
        }

        _georefMap = new window.maplibregl.Map({
            container,
            style: GEOREF_STYLE,
            center,
            zoom,
        });

        // Satellite layer (hidden by default)
        _georefMap.on('load', () => {
            _georefMap.addSource('georef-sat', {
                type: 'raster',
                tiles: [GEOREF_SAT_TILES],
                tileSize: 256,
                attribution: 'Sentinel-2 cloudless by EOX',
            });
            _georefMap.addLayer({
                id: 'georef-sat-layer',
                type: 'raster',
                source: 'georef-sat',
                layout: { visibility: 'none' },
            });
        });

        // Map click → set GCP coordinates
        _georefMap.on('click', (e) => {
            if (_georefActiveIdx < 0 || _georefActiveIdx >= _georefGCPs.length) return;
            const { lat, lng } = e.lngLat;
            _setGCPMapCoord(_georefActiveIdx, lat, lng);
        });
    } catch (err) {
        // Fallback sem mapa — inputs manuais permanecem funcionais
        container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:13px;padding:20px;text-align:center;">${escapeHtml(t('georefMapUnavailable') || 'Map unavailable — enter coordinates manually below')}</div>`;
        showToast(t('georefMapUnavailable') || 'Map unavailable — enter coordinates manually', 'warning');
    }
}

// ---- Satellite layer toggle ----
function _georefToggleSatellite(btn) {
    if (!_georefMap) return;
    _georefSatVisible = !_georefSatVisible;
    try {
        _georefMap.setLayoutProperty('georef-sat-layer', 'visibility', _georefSatVisible ? 'visible' : 'none');
        btn.style.background = _georefSatVisible ? 'var(--accent-color,#3b82f6)' : '';
        btn.style.color = _georefSatVisible ? '#fff' : '';
    } catch {
        /* layer not yet loaded */
    }
}

// ---- Nominatim geocoding search ----
async function _georefSearchNominatim(query) {
    if (!query || query.length < 3 || !_georefMap) return;
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const results = await res.json();
        if (results.length > 0) {
            const { lat, lon, display_name } = results[0];
            _georefMap.flyTo({ center: [parseFloat(lon), parseFloat(lat)], zoom: 16 });
            showToast(display_name.substring(0, 80), 'info');
        } else {
            showToast(t('georefNoResults') || 'No results found', 'warning');
        }
    } catch {
        showToast(t('georefSearchError') || 'Search failed', 'error');
    }
}

// ---- Set GCP map coordinates ----
function _setGCPMapCoord(idx, lat, lon) {
    if (idx < 0 || idx >= _georefGCPs.length) return;
    const gcp = _georefGCPs[idx];
    gcp.lat = lat;
    gcp.lon = lon;

    // Map marker
    _addGCPMapMarker(idx);

    // Auto-advance to next GCP without coords
    const nextIdx = _georefGCPs.findIndex((g, i) => i !== idx && (g.lat === null || g.lon === null));
    _georefActiveIdx = nextIdx >= 0 ? nextIdx : -1;

    // Update UI
    _updateGeorefFooter();
    _updateGeorefPolygon();
    _updateGeorefPreview();
    if (_georefCanvas) _renderGeorefImageCanvas(_georefCanvas);

    const hint = document.getElementById('georef-hint');
    if (_georefActiveIdx >= 0) {
        const next = _georefGCPs[_georefActiveIdx];
        if (hint) hint.textContent = t('georefClickMapNow') || `Click map to set GCP #${next.id} coordinates`;
    } else {
        if (hint) hint.textContent = t('georefClickImageFirst') || 'Click image to place GCP';
    }
}

function _addGCPMapMarker(idx) {
    if (!_georefMap || !window.maplibregl) return;
    const gcp = _georefGCPs[idx];
    if (gcp.lat === null || gcp.lon === null) return;

    // Remove old marker
    if (_georefMarkers[gcp.id]) {
        _georefMarkers[gcp.id].remove();
        delete _georefMarkers[gcp.id];
    }

    const el = document.createElement('div');
    el.style.cssText =
        'width:18px;height:18px;border-radius:50%;background:#22c55e;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:bold;color:#fff;cursor:pointer;';
    el.textContent = String(gcp.id);
    if (gcp.label) el.title = `#${gcp.id}: ${gcp.label}`;
    _georefMarkers[gcp.id] = new window.maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([gcp.lon, gcp.lat])
        .addTo(_georefMap);

    // Draggable marker: update coords on dragend
    _georefMarkers[gcp.id].on('dragend', () => {
        const lngLat = _georefMarkers[gcp.id].getLngLat();
        gcp.lat = lngLat.lat;
        gcp.lon = lngLat.lng;
        _updateGeorefFooter();
        _updateGeorefPolygon();
        _updateGeorefPreview();
    });
}

// ---- GCP deletion ----
function _deleteGCP(idx) {
    if (idx < 0 || idx >= _georefGCPs.length) return;
    const gcp = _georefGCPs[idx];
    // Remove marker
    if (_georefMarkers[gcp.id]) {
        _georefMarkers[gcp.id].remove();
        delete _georefMarkers[gcp.id];
    }
    _georefGCPs.splice(idx, 1);
    if (_georefActiveIdx === idx) _georefActiveIdx = -1;
    else if (_georefActiveIdx > idx) _georefActiveIdx--;
    _updateGeorefFooter();
    _updateGeorefPolygon();
    _updateGeorefPreview();
    if (_georefCanvas) _renderGeorefImageCanvas(_georefCanvas);
}

// ---- Manual coordinate input for a GCP ----
function _onGeorefManualInput(idx) {
    const lat = parseFloat(document.getElementById(`georef-lat-${idx}`)?.value);
    const lon = parseFloat(document.getElementById(`georef-lon-${idx}`)?.value);
    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        _georefGCPs[idx].lat = lat;
        _georefGCPs[idx].lon = lon;
        _addGCPMapMarker(idx);
        _updateGeorefFooter();
        _updateGeorefPolygon();
        _updateGeorefPreview();
    }
}

// ---- Footer: dynamic GCP list + metrics ----
function _updateGeorefFooter() {
    const list = document.getElementById('georef-gcp-list');
    if (!list) return;

    if (_georefGCPs.length === 0) {
        list.innerHTML = `<div style="color:var(--text-secondary,#888);padding:4px 0;">${escapeHtml(t('georefNoGCPs') || 'No control points yet — click on the image to add')}</div>`;
    } else {
        let html = '<div style="display:flex;flex-direction:column;gap:3px;">';
        for (let i = 0; i < _georefGCPs.length; i++) {
            const gcp = _georefGCPs[i];
            const isComplete = gcp.lat !== null && gcp.lon !== null;
            const isActive = _georefActiveIdx === i;
            const stateClass = isComplete ? 'gcp-complete' : 'gcp-incomplete';
            const activeClass = isActive ? 'gcp-active' : '';

            html += `<div class="georef-gcp-row ${stateClass} ${activeClass}">`;
            html += `<span class="gcp-id">#${gcp.id}</span>`;
            if (gcp.label && gcp.label !== `GCP ${i + 1}`) {
                html += `<span class="gcp-label" title="${escapeAttr(gcp.label)}">${escapeHtml(gcp.label)}</span>`;
            }
            html += `<span style="color:var(--text-secondary,#888);min-width:70px;font-size:10px;">(${Math.round(gcp.imgX)}, ${Math.round(gcp.imgY)})</span>`;
            html += `<span style="margin:0 2px;font-size:10px;">&#8594;</span>`;

            // Lat/lon inputs
            html += `<input type="number" step="0.0001" placeholder="lat" id="georef-lat-${i}" value="${isComplete ? gcp.lat.toFixed(6) : ''}" `;
            html += `onchange="window._georefManualInput(${i})" style="${GEOREF_INPUT_STYLE}">`;
            html += `<input type="number" step="0.0001" placeholder="lon" id="georef-lon-${i}" value="${isComplete ? gcp.lon.toFixed(6) : ''}" `;
            html += `onchange="window._georefManualInput(${i})" style="${GEOREF_INPUT_STYLE}">`;

            // Delete button
            html += `<button class="gcp-delete" onclick="window._georefDeleteGCP(${i})" title="${escapeAttr(t('georefDeleteGCP') || 'Delete')}">&#10005;</button>`;
            html += '</div>';
        }
        html += '</div>';
        list.innerHTML = html;
    }

    // Update metrics
    _updateGeorefMetrics();
}

// Register window handlers for inline onclick
window._georefManualInput = _onGeorefManualInput;
window._georefDeleteGCP = _deleteGCP;

// ---- Convex hull polygon on map ----
function _updateGeorefPolygon() {
    if (!_georefMap || !window.maplibregl) return;
    const withCoords = _georefGCPs.filter((g) => g.lat !== null && g.lon !== null);
    const sourceId = 'georef-polygon';

    if (withCoords.length < 3) {
        // Remove polygon if less than 3 points
        if (_georefMap.getSource(sourceId)) {
            _georefMap
                .getSource(sourceId)
                .setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } });
        }
        return;
    }

    // Simple convex hull (Graham scan for small N)
    const pts = withCoords.map((g) => [g.lon, g.lat]);
    const hull = _convexHull(pts);
    hull.push(hull[0]); // Close ring

    if (_georefMap.getSource(sourceId)) {
        _georefMap.getSource(sourceId).setData({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [hull] },
        });
    } else {
        try {
            _georefMap.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [hull] } },
            });
            _georefMap.addLayer({
                id: sourceId + '-fill',
                type: 'fill',
                source: sourceId,
                paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.12 },
            });
            _georefMap.addLayer({
                id: sourceId + '-line',
                type: 'line',
                source: sourceId,
                paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [4, 4] },
            });
        } catch {
            /* source already exists */
        }
    }
}

/**
 * Simple convex hull (Graham scan) for small point sets.
 * @param {Array<[number, number]>} points - [lon, lat] pairs
 * @returns {Array<[number, number]>} Hull points in CCW order
 */
function _convexHull(points) {
    if (points.length <= 3) return [...points];
    const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (const p of sorted.reverse()) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// ---- Metrics: GCP count, RMS residual, resolution ----
function _updateGeorefMetrics() {
    const metrics = document.getElementById('georef-metrics');
    const applyBtn = document.getElementById('georef-apply-btn');
    const complete = _georefGCPs.filter((g) => g.lat !== null && g.lon !== null);
    const total = _georefGCPs.length;

    if (metrics) {
        let html = `<span>${t('georefGCPCount') || 'GCPs'}: ${complete.length}/${total} (min 3)</span>`;
        if (complete.length >= 3) {
            const result = _computeGeorefTransform();
            if (result) {
                html += ` <span>&#8226; ${t('georefResidual') || 'RMS'}: ${result.transform.residual.toFixed(2)} m</span>`;
                html += ` <span>&#8226; ${t('georefResolution') || 'Res'}: ${(1 / result.pxPerMeter).toFixed(2)} m/px</span>`;
                const method =
                    result.transform.method === 'affine'
                        ? 'Affine'
                        : result.transform.method === 'similarity'
                          ? 'Similarity'
                          : 'Scale';
                html += ` <span>&#8226; ${method}</span>`;
                if (result.gcpsRejected.length > 0) {
                    html += ` <span style="color:#ef4444;">&#8226; ${result.gcpsRejected.length} outlier(s)</span>`;
                }
            }
        }
        metrics.innerHTML = html;
    }
    if (applyBtn) applyBtn.disabled = complete.length < 3 || !_georefImage;
}

/**
 * Compute affine transform from current GCPs.
 * Converte GCPs (pixel + WGS84) para formato do mapGeoreferencer.
 * @returns {import('../../core/ingestion/documents/mapGeoreferencer.js').GeoreferencingResult|null}
 */
function _computeGeorefTransform() {
    const complete = _georefGCPs.filter((g) => g.lat !== null && g.lon !== null);
    if (complete.length < 2 || !_georefImageW) return null;

    // Converter WGS84 → UTM para cada GCP
    const gcps = complete.map((g) => {
        const utm = wgs84ToUTM({ latitude: g.lat, longitude: g.lon });
        return { pixel: [g.imgX, g.imgY], coord: [utm.easting, utm.northing] };
    });

    return buildTransform(gcps, {
        crs: 'UTM',
        imageWidth: _georefImageW,
        imageHeight: _georefImageH,
    });
}

// ---- Image preview overlay on map (Phase 4) ----
function _updateGeorefPreview() {
    if (!_georefMap || !_georefImage) return;
    // Respect preview toggle state
    const toggleBtn = document.getElementById('georef-preview-toggle');
    if (toggleBtn && !toggleBtn.classList.contains('active')) return;
    const result = _computeGeorefTransform();
    if (!result) {
        // Remove preview if transform not available
        _removeGeorefPreview();
        return;
    }

    // Compute image corners in UTM, then WGS84
    const corners = [
        pixelToWorld(result.transform, 0, 0), // NW (top-left)
        pixelToWorld(result.transform, _georefImageW, 0), // NE (top-right)
        pixelToWorld(result.transform, _georefImageW, _georefImageH), // SE (bottom-right)
        pixelToWorld(result.transform, 0, _georefImageH), // SW (bottom-left)
    ];

    // UTM zone from first GCP
    const firstComplete = _georefGCPs.find((g) => g.lat !== null);
    if (!firstComplete) return;
    const refUtm = wgs84ToUTM({ latitude: firstComplete.lat, longitude: firstComplete.lon });

    const wgs84Corners = corners.map((c) => {
        const wgs = utmToWGS84({
            easting: c.easting,
            northing: c.northing,
            zone: refUtm.zone,
            hemisphere: refUtm.hemisphere,
        });
        return [wgs.longitude, wgs.latitude];
    });

    // MapLibre image source requires: [NW, NE, SE, SW]
    const previewSourceId = 'georef-preview';
    const opacity = (parseInt(document.getElementById('georef-opacity')?.value) || 70) / 100;

    try {
        if (_georefMap.getLayer(previewSourceId + '-layer')) _georefMap.removeLayer(previewSourceId + '-layer');
        if (_georefMap.getSource(previewSourceId)) _georefMap.removeSource(previewSourceId);

        _georefMap.addSource(previewSourceId, {
            type: 'image',
            url: _georefImage,
            coordinates: wgs84Corners, // [NW, NE, SE, SW]
        });
        const layerDef = {
            id: previewSourceId + '-layer',
            type: 'raster',
            source: previewSourceId,
            paint: { 'raster-opacity': opacity },
        };
        const beforeId = _georefMap.getLayer('georef-polygon-fill') ? 'georef-polygon-fill' : undefined;
        if (beforeId)
            _georefMap.addLayer(layerDef, beforeId); // Insert below polygon if available
        else _georefMap.addLayer(layerDef);
    } catch {
        /* preview layer setup failed — non-critical */
    }
}

function _removeGeorefPreview() {
    if (!_georefMap) return;
    try {
        if (_georefMap.getLayer('georef-preview-layer')) _georefMap.removeLayer('georef-preview-layer');
        if (_georefMap.getSource('georef-preview')) _georefMap.removeSource('georef-preview');
    } catch {
        /* already removed */
    }
}

function _updateGeorefPreviewOpacity() {
    if (!_georefMap) return;
    const opacity = (parseInt(document.getElementById('georef-opacity')?.value) || 70) / 100;
    try {
        _georefMap.setPaintProperty('georef-preview-layer', 'raster-opacity', opacity);
    } catch {
        /* layer not present */
    }
}

/**
 * Lazy-load turf.js for geometry QA in georeferencing flow.
 * @returns {Promise<any|null>}
 */
async function _loadTurf() {
    if (_turf) return _turf;
    try {
        _turf = await importCDN(TURF_CDN, { name: 'turf.js' });
        return _turf;
    } catch {
        _turf = null;
        return null;
    }
}

/**
 * Validate georeferenced polygon geometry before persistence.
 * Performs best-effort checks; if turf is unavailable, keeps flow unblocked.
 *
 * @param {Array<[number, number]>} ring - Closed ring in [lon, lat]
 * @returns {Promise<{ok:boolean, areaM2:number|null, engine:string, message?:string}>}
 */
async function _validateGeorefGeometry(ring) {
    if (!Array.isArray(ring) || ring.length < 4) {
        return {
            ok: false,
            areaM2: null,
            engine: 'none',
            message: t('georefInvalidGeometry') || 'Invalid georeferenced geometry',
        };
    }

    const turf = await _loadTurf();
    if (!turf) return { ok: true, areaM2: null, engine: 'fallback-no-turf' };

    try {
        const feature = turf.polygon([ring]);

        if (typeof turf.booleanValid === 'function' && !turf.booleanValid(feature)) {
            return {
                ok: false,
                areaM2: null,
                engine: 'turf',
                message: t('georefInvalidGeometry') || 'Invalid georeferenced geometry',
            };
        }

        if (typeof turf.kinks === 'function') {
            const kinkResult = turf.kinks(feature);
            if ((kinkResult?.features || []).length > 0) {
                return {
                    ok: false,
                    areaM2: null,
                    engine: 'turf',
                    message: t('georefSelfIntersecting') || 'Self-intersecting geometry - adjust control points',
                };
            }
        }

        const areaM2 = typeof turf.area === 'function' ? Number(turf.area(feature)) : null;
        if (Number.isFinite(areaM2) && areaM2 <= 0) {
            return {
                ok: false,
                areaM2,
                engine: 'turf',
                message: t('georefZeroArea') || 'Georeferenced area is zero',
            };
        }

        return { ok: true, areaM2: Number.isFinite(areaM2) ? areaM2 : null, engine: 'turf' };
    } catch {
        return {
            ok: false,
            areaM2: null,
            engine: 'turf',
            message: t('georefInvalidGeometry') || 'Invalid georeferenced geometry',
        };
    }
}

// ---- AI Suggest Location (Phase 3) ----
/**
 * Send image to LLM vision and auto-populate GCPs from detected landmarks.
 * Envia imagem ao LLM com prompt de georreferenciamento. Parseia resposta
 * JSON e cria GCPs a partir dos landmarks detectados.
 * @param {HTMLButtonElement} btn - Button element (for loading state)
 */
async function _aiSuggestGeoref(btn) {
    if (!_georefImage) {
        showToast(t('georefUploadFirst') || 'Upload an image first', 'info');
        return;
    }
    if (!hasApiKey()) {
        showToast(t('georefSuggestNoKey') || 'Configure AI key to use this feature', 'warning');
        return;
    }

    // Loading state
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="georef-spinner"></span>';

    try {
        const systemPrompt = `You are a geospatial analyst specializing in aerial and satellite image georeferencing. You identify geographic locations from visual features with high precision.`;
        const userPrompt = `Analyze this aerial/satellite image to determine its geographic location. Use all available clues:

VISUAL FEATURES TO ANALYZE:
- Road network patterns, intersections, highway interchanges
- Water bodies: rivers, lakes, canals (shape, width, flow direction)
- Building layouts, institutional campuses, industrial areas
- Sports facilities: running tracks, soccer fields, tennis courts
- Vegetation patterns, parks, forests, agricultural fields
- Bridges, overpasses, railway lines
- Any visible text, signs, logos, or watermarks (e.g., "Google Earth")
- Shadow angles (indicate hemisphere and approximate latitude)
- Urban grid orientation and density

Return ONLY valid JSON (no markdown, no code fences):
{
  "location": "Specific Place, City, State/Region, Country",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of how you identified the location",
  "bounds": { "sw": {"lat": -90..90, "lon": -180..180}, "ne": {"lat": -90..90, "lon": -180..180} },
  "landmarks": [
    { "label": "specific feature description", "imgX_pct": 0-100, "imgY_pct": 0-100, "lat": number, "lon": number }
  ]
}

REQUIREMENTS:
- Identify 3-6 landmarks that are clearly visible and geographically distinctive
- imgX_pct = percentage from LEFT edge, imgY_pct = percentage from TOP edge
- Place landmarks at recognizable points: road intersections, building corners, field edges, bridge endpoints
- Spread landmarks across the image (not clustered in one area)
- bounds should tightly enclose the visible area
- Be as precise as possible with coordinates (6 decimal places)`;

        const response = await sendMessage(systemPrompt, userPrompt, { image: _georefImage });
        const content = response?.content || '';

        // Parse JSON — try to extract from possible markdown wrapping
        let jsonStr = content.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();
        // Also try to find first { ... } block
        const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (braceMatch) jsonStr = braceMatch[0];

        const data = JSON.parse(jsonStr);

        // Validate response
        if (!data || !data.bounds || !data.landmarks) {
            showToast(t('georefSuggestFailed') || 'Could not identify location', 'warning');
            return;
        }

        // Confidence check
        if (data.confidence < 0.3) {
            showToast(t('georefSuggestLowConfidence') || 'Low confidence — verify manually', 'warning');
        }

        // Fly map to suggested bounds
        if (_georefMap && data.bounds.sw && data.bounds.ne) {
            const sw = data.bounds.sw;
            const ne = data.bounds.ne;
            const centerLat = (sw.lat + ne.lat) / 2;
            const centerLon = (sw.lon + ne.lon) / 2;
            _georefMap.flyTo({ center: [centerLon, centerLat], zoom: 16 });
        }

        // Create GCPs from landmarks
        if (Array.isArray(data.landmarks)) {
            for (const lm of data.landmarks) {
                if (!lm || ![lm.imgX_pct, lm.imgY_pct, lm.lat, lm.lon].every(Number.isFinite)) continue;
                // Validate coords
                if (lm.lat < -90 || lm.lat > 90 || lm.lon < -180 || lm.lon > 180) continue;

                const imgX = (lm.imgX_pct / 100) * _georefImageW;
                const imgY = (lm.imgY_pct / 100) * _georefImageH;

                _georefGCPs.push({
                    id: _georefNextId++,
                    imgX: Math.max(0, Math.min(_georefImageW, imgX)),
                    imgY: Math.max(0, Math.min(_georefImageH, imgY)),
                    lat: lm.lat,
                    lon: lm.lon,
                    label: lm.label || `AI #${_georefGCPs.length + 1}`,
                });
                _addGCPMapMarker(_georefGCPs.length - 1);
            }
        }

        _georefActiveIdx = -1;
        _updateGeorefFooter();
        _updateGeorefPolygon();
        _updateGeorefPreview();
        if (_georefCanvas) _renderGeorefImageCanvas(_georefCanvas);

        const loc = data.location || 'Unknown';
        const conf = data.confidence ? `(${Math.round(data.confidence * 100)}%)` : '';
        showToast(`${loc} ${conf}`, 'success');
        if (data.reasoning) {
            console.log('[ecbyts] AI georef reasoning:', data.reasoning);
        }
    } catch (err) {
        console.error('[ecbyts] AI georef suggestion failed:', err);
        showToast(t('georefSuggestFailed') || 'Could not identify location', 'warning');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
    }
}

// ---- Apply: create boundary element with overlay ----
async function _applyGeoreference() {
    const complete = _georefGCPs.filter((g) => g.lat !== null && g.lon !== null);
    if (!_georefImage || complete.length < 3) {
        showToast(t('georefNoCorners') || 'Set at least 3 control points', 'error');
        return;
    }

    // Validate GCPs are not collinear (triangle area must be non-zero)
    if (complete.length >= 3) {
        const [a, b, c] = complete;
        const area = Math.abs((b.lon - a.lon) * (c.lat - a.lat) - (c.lon - a.lon) * (b.lat - a.lat));
        if (area < 1e-10) {
            showToast(t('georefCollinear') || 'Control points are collinear — cannot compute transform', 'error');
            return;
        }
    }

    const result = _computeGeorefTransform();
    if (!result) {
        showToast(t('georefTransformFailed') || 'Failed to compute transform', 'error');
        return;
    }

    // Auto-set UTM origin if needed
    if (!hasOrigin()) {
        const firstGcp = complete[0];
        const utm = wgs84ToUTM({ latitude: firstGcp.lat, longitude: firstGcp.lon });
        setOrigin({ easting: utm.easting, northing: utm.northing, zone: utm.zone, hemisphere: utm.hemisphere });
        showToast(t('georefOriginSet') || 'UTM origin set from first GCP', 'info');
    }

    const origin = getOrigin();

    // Compute image corner vertices in Three.js world coords
    const imgCorners = [
        pixelToWorld(result.transform, 0, _georefImageH), // SW (bottom-left)
        pixelToWorld(result.transform, _georefImageW, _georefImageH), // SE (bottom-right)
        pixelToWorld(result.transform, _georefImageW, 0), // NE (top-right)
        pixelToWorld(result.transform, 0, 0), // NW (top-left)
    ];

    // Geometry QA (Turf.js best-effort): validate polygon in WGS84 before persist.
    const firstGcp = complete[0];
    const refUtm = wgs84ToUTM({ latitude: firstGcp.lat, longitude: firstGcp.lon });
    const ring = imgCorners.map((c) => {
        const wgs = utmToWGS84({
            easting: c.easting,
            northing: c.northing,
            zone: refUtm.zone,
            hemisphere: refUtm.hemisphere,
        });
        return [wgs.longitude, wgs.latitude];
    });
    ring.push([...ring[0]]);

    const geometryCheck = await _validateGeorefGeometry(ring);
    if (!geometryCheck.ok) {
        showToast(geometryCheck.message || t('georefInvalidGeometry') || 'Invalid georeferenced geometry', 'error');
        return;
    }

    const vertices = imgCorners.map((c) => ({
        x: c.easting - origin.easting,
        y: 0,
        z: -(c.northing - origin.northing),
    }));

    const opacity = (parseInt(document.getElementById('georef-opacity')?.value) || 70) / 100;
    const source = document.getElementById('georef-source')?.value || 'other';
    const captureDate = document.getElementById('georef-date')?.value || '';

    const id = generateId('boundary');
    const name = `Aerial: ${source} ${captureDate || new Date().toISOString().slice(0, 10)}`;

    // Store GCPs for provenance
    const gcpData = complete.map((g) => ({
        imgX: Math.round(g.imgX),
        imgY: Math.round(g.imgY),
        lat: g.lat,
        lon: g.lon,
        label: g.label,
    }));

    addElement('boundary', id, name, {
        vertices,
        overlayUrl: _georefImage,
        overlayOpacity: opacity,
        georef: {
            gcps: gcpData,
            transform: {
                method: result.transform.method,
                residual: result.transform.residual,
                matrix: result.transform.matrix,
            },
            resolution: 1 / result.pxPerMeter,
            source,
            captureDate,
            crs: 'WGS84',
            engine: CONFIG?.FEATURES?.ADVANCED_GEOREF_ENGINE ? 'advanced-georef-engine' : 'builtin-affine',
            imageWidth: _georefImageW,
            imageHeight: _georefImageH,
            validation: {
                geometryValid: geometryCheck.ok,
                geometryAreaM2: geometryCheck.areaM2,
                geometryEngine: geometryCheck.engine,
            },
        },
    });

    showToast(t('georefSuccess') || `Georeferenced image added as "${name}"`, 'success');
    if (_updateAllUI) _updateAllUI();
}

// ----------------------------------------------------------------
// GEOAI HANDLERS — Change Detection, Classification, Enhance, Spectral, Embeddings
// ----------------------------------------------------------------

/**
 * Handle comparison image upload for Change Detection.
 */
export async function handleAerialChangeImageUpload() {
    const input = document.getElementById('aerial-change-file');
    const file = input?.files?.[0];
    if (!file) return;
    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff'];
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        showToast(t('unsupportedImageFormat') || 'Unsupported image format. Use JPEG, PNG, WebP, or TIFF.', 'error');
        return;
    }
    try {
        _changeComparisonImage = await readFileAsDataUrl(file);
        showToast(t('comparisonImageLoaded') || 'Comparison image loaded', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to read comparison image', 'error');
    }
}

/**
 * Show change overlay on the preview canvas.
 * @param {string} overlayDataUrl - PNG overlay with transparency
 */
function _showChangeOverlay(overlayDataUrl) {
    const canvas = document.getElementById('aerial-preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = overlayDataUrl;
}

/**
 * Enhance current image using super-resolution.
 */
export async function handleAerialEnhanceImage() {
    if (!_currentImage) {
        showToast('Load an image first', 'error');
        return;
    }
    const btn = document.getElementById('aerial-enhance-btn');
    if (btn) btn.disabled = true;

    try {
        showToast(t('enhancing') || 'Enhancing image...', 'info');
        const enhanced = await enhanceImage(_currentImage, { tier: 'canvas' });
        _currentImage = enhanced;
        _showImagePreview(enhanced);
        showToast(t('enhanceComplete') || 'Image enhanced (2x sharpened)', 'success');
    } catch (err) {
        console.error('Enhance error:', err);
        showToast(err.message || 'Enhancement failed', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * Index current tile embedding.
 */
export async function handleAerialIndexTile() {
    if (!_currentImage) {
        showToast('Load an image first', 'error');
        return;
    }
    try {
        const embedding = await computeHandcraftedEmbedding(_currentImage);
        const tileId = `tile-${Date.now()}`;
        await storeTileEmbedding(tileId, embedding, { timestamp: Date.now() });
        const stats = await getEmbeddingStats();
        const resultEl = document.getElementById('aerial-embeddings-result');
        if (resultEl) {
            resultEl.style.display = '';
            resultEl.textContent = `Indexed (${stats.count} tiles, ${stats.method})`;
        }
        showToast(`Image indexed (${stats.count} tiles total)`, 'success');
    } catch (err) {
        showToast(err.message || 'Indexing failed', 'error');
    }
}

/**
 * Search for similar tiles in the embedding index.
 */
export async function handleAerialSearchSimilar() {
    if (!_currentImage) {
        showToast('Load an image first', 'error');
        return;
    }
    try {
        const embedding = await computeHandcraftedEmbedding(_currentImage);
        const results = await searchSimilarTiles(embedding, { topK: 5 });
        const resultEl = document.getElementById('aerial-embeddings-result');
        if (resultEl) {
            resultEl.style.display = '';
            if (results.length === 0) {
                resultEl.textContent = 'No indexed tiles found. Index images first.';
            } else {
                resultEl.innerHTML = results
                    .map(
                        (r, i) =>
                            `<div>${i + 1}. ${escapeHtml(r.tileId)} — similarity: ${(r.similarity * 100).toFixed(1)}%</div>`,
                    )
                    .join('');
            }
        }
        showToast(`Found ${results.length} similar tiles`, 'info');
    } catch (err) {
        showToast(err.message || 'Search failed', 'error');
    }
}

// ----------------------------------------------------------------
// EXPORT HANDLER OBJECT
// ----------------------------------------------------------------

export const aerialHandlers = {
    handleOpenAerialModal,
    handleAerialImageUpload,
    handleAerialUseBoundary,
    handleAerialAnalyze,
    handleAerialToggleFeature,
    handleAerialSelectAll,
    handleAerialConfirmImport,
    handleAerialSetExtent,
    handleAerialMethodChange,
    handleAerialAutoCalibrate,
    handleAerialCalibrationChange,
    handleAerialResetCalibration,
    handleAerialToggleAdvanced,
    handleAerialRemoveAnnotation,
    handleAerialClearAnnotations,
    handleAerialClearResults,
    handleAerialSelectPaintFamily,
    handleAerialBrushChange,
    handleAerialTrainNN,
    handleAerialClassifyNN,
    handleAerialClearPaint,
    handleAerialUndoPaint,
    handleAerialVectorize,
    handleAerialExportGeoJSON,
    handleAerialTextPromptChange,
    handleAerialTileMapSegment,
    handleAerialAbortAutoMask,
    handleAerialGeoreference,
    handleAerialChangeImageUpload,
    handleAerialEnhanceImage,
    handleAerialIndexTile,
    handleAerialSearchSimilar,
    _setTestState,
};
