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
   ENGINE — Universal Vectorization Engine orchestrator
   ================================================================

   Pipeline principal: recebe imagem aerea + mascara de categorias
   do SegFormer/colorAnalysis e produz GeoJSON georreferenciado
   via OpenCV.js com estrategias CV por familia.

   FLUXO:
   1. Carrega OpenCV.js (lazy ~8MB, cached)
   2. Converte categoryGrid → cv.Mat binario por categoria
   3. Despacha para estrategia CV especifica (vegetation/building/roads/water)
   4. Constroi hierarquia pai-filho (RETR_TREE)
   5. Georreferencia contornos pixel → WGS84
   6. Monta FeatureCollection GeoJSON (RFC 7946)

   REGRAS CRITICAS:
   - RULE 1 (Memory): Todo cv.Mat em try/finally com .delete()
   - RULE 2 (UI Yield): await setTimeout(0) entre categorias
   - RULE 3 (Winding): Outer=CCW, Inner=CW, 6 decimais
   - RULE 4 (Topology): Holes → inner rings, Micro → features separadas

   ================================================================ */

import { getOpenCV } from './loader.js';
import { STRATEGIES, CATEGORY_STRATEGY } from './strategies.js';
import { buildHierarchyTree, assignHierarchy } from './hierarchy.js';
import {
    computePixelScale,
    contourToWorld,
    contourToWGS84,
    ensureWinding,
    ensureClosed,
    computeAreaM2,
    computePerimeterM,
    computeLengthM,
} from './georeference.js';
import { getOrigin, getEPSG } from '../../io/geo/coordinates.js';

// Fallback pipeline (existing BFS blob finder)
import { findBlobs, extractContour, morphClose, blobToFeature } from '../colorAnalysis.js';

// ----------------------------------------------------------------
// CONSTANTS
// ----------------------------------------------------------------

const ANALYSIS_SIZE = 512;
const ACTIVE_CATEGORIES = [1, 2, 4, 5, 6]; // water, veg, building, infra, soil
const CATEGORY_NAMES = {
    1: 'water',
    2: 'vegetation',
    4: 'building',
    5: 'infrastructure',
    6: 'soil',
};

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Vectorize semantic mask into georeferenced GeoJSON FeatureCollection.
 * Pipeline principal do Universal Vectorization Engine.
 *
 * @param {Object} params
 * @param {string} params.imageDataUrl - Base64 data URL da imagem original
 * @param {Uint8Array} params.categoryGrid - 512×512 category grid (0-6)
 * @param {Object} params.extent - { minX, maxX, minZ, maxZ } in Three.js world coords
 * @param {Function} [params.onProgress] - Callback: { status, message, progress }
 * @returns {Promise<Object>} - GeoJSON FeatureCollection (RFC 7946, EPSG:4326)
 */
export async function vectorize({ imageDataUrl, categoryGrid, extent, onProgress }) {
    // ── Validation ──────────────────────────────────────
    if (!(categoryGrid instanceof Uint8Array) || categoryGrid.length !== ANALYSIS_SIZE * ANALYSIS_SIZE) {
        throw new Error(`categoryGrid must be Uint8Array(${ANALYSIS_SIZE * ANALYSIS_SIZE})`);
    }
    if (!extent || extent.minX == null || extent.maxX == null || extent.minZ == null || extent.maxZ == null) {
        throw new Error('extent must have minX, maxX, minZ, maxZ');
    }

    // ── Step 1: Check for OpenCV.js ─────────────────────
    // OpenCV.js WASM (~8MB) bloqueia a main thread durante compilacao,
    // causando "Page unresponsive". Usa BFS fallback se nao pre-carregado.
    // OpenCV so e usado se ja estiver em memoria (pre-loaded por outro fluxo).
    let cv;
    try {
        const { isOpenCVLoaded, getCV } = await import('./loader.js');
        if (isOpenCVLoaded()) {
            cv = getCV();
        } else {
            _notify(onProgress, 'fallback', 'Using fast vectorization pipeline...', 5);
            return _fallbackVectorize(categoryGrid, extent, onProgress);
        }
    } catch (err) {
        console.warn('OpenCV.js not available, using fallback pipeline:', err.message);
        return _fallbackVectorize(categoryGrid, extent, onProgress);
    }

    _notify(onProgress, 'processing', 'Preparing image...', 10);

    // ── Step 2: Build OpenCV Mats ───────────────────────
    let baseMat = null;
    let rgbMat = null;

    try {
        // Category grid → CV_8UC1
        baseMat = cv.matFromArray(ANALYSIS_SIZE, ANALYSIS_SIZE, cv.CV_8UC1, categoryGrid);

        // Load original image as CV_8UC3 for watershed/Canny
        // RULE 5: rgbMat MUST be CV_8UC3 (no alpha channel)
        rgbMat = await _loadImageAsMat(cv, imageDataUrl);

        // ── Step 3: Per-category strategy dispatch ──────
        const pixelScale = computePixelScale(extent, ANALYSIS_SIZE, ANALYSIS_SIZE);
        const allFeatures = [];
        let globalFeatureIdx = 0;

        for (let catIdx = 0; catIdx < ACTIVE_CATEGORIES.length; catIdx++) {
            const cat = ACTIVE_CATEGORIES[catIdx];
            const strategyKey = CATEGORY_STRATEGY[cat];
            if (!strategyKey || !STRATEGIES[strategyKey]) continue;

            const catName = CATEGORY_NAMES[cat] || `category_${cat}`;
            const progress = 20 + Math.round((catIdx / ACTIVE_CATEGORIES.length) * 60);
            _notify(onProgress, 'processing', `Vectorizing ${catName}...`, progress);

            // RULE 2: Yield to UI between categories so spinner renders
            await new Promise((r) => setTimeout(r, 0));

            // Extract binary mask for this category
            let binaryMask = null;
            try {
                binaryMask = cv.Mat.zeros(ANALYSIS_SIZE, ANALYSIS_SIZE, cv.CV_8UC1);
                const baseData = baseMat.data;
                const maskData = binaryMask.data;
                for (let i = 0; i < baseData.length; i++) {
                    if (baseData[i] === cat) maskData[i] = 255;
                }

                // Skip empty categories
                if (cv.countNonZero(binaryMask) === 0) continue;

                // Dispatch to family-specific strategy
                const result = STRATEGIES[strategyKey].process(cv, binaryMask, rgbMat, pixelScale);

                // Assign global _vectorId and process hierarchy
                const categoryFeatures = _processStrategyResult(result, globalFeatureIdx, extent, pixelScale);

                allFeatures.push(...categoryFeatures);
                globalFeatureIdx += categoryFeatures.length;
            } finally {
                if (binaryMask) binaryMask.delete();
            }
        }

        // ── Step 4: Assemble GeoJSON ────────────────────
        _notify(onProgress, 'finalizing', 'Building GeoJSON...', 90);

        const fc = _buildFeatureCollection(allFeatures, extent);

        _notify(onProgress, 'done', `Vectorization complete: ${allFeatures.length} features`, 100);

        return fc;
    } finally {
        // RULE 1: Cleanup ALL OpenCV Mats — zero leaks
        if (baseMat) baseMat.delete();
        if (rgbMat) rgbMat.delete();
    }
}

// ----------------------------------------------------------------
// INTERNAL — Process strategy results with hierarchy + georeferencing
// ----------------------------------------------------------------

/**
 * Process features from a single strategy: apply hierarchy, georeference, format.
 *
 * @param {Object} result - { features, hierarchyData, contourCount } from strategy
 * @param {number} startIdx - Global feature index offset
 * @param {Object} extent
 * @param {Object} pixelScale
 * @returns {Array<Object>} - Processed features ready for GeoJSON
 */
function _processStrategyResult(result, startIdx, extent, pixelScale) {
    const { features, hierarchyData, contourCount } = result;
    if (features.length === 0) return [];

    // Assign sequential _vectorId
    for (let i = 0; i < features.length; i++) {
        features[i]._vectorId = `vec_${String(startIdx + i).padStart(3, '0')}`;
    }

    // Apply hierarchy if available (RULE 4: holes vs micro-features)
    let processedFeatures = features;
    let holes = new Map();

    if (hierarchyData && hierarchyData.length >= 4) {
        const hContourCount = hierarchyData.length / 4;
        const tree = buildHierarchyTree(hierarchyData, hContourCount);
        const hResult = assignHierarchy(features, tree);
        processedFeatures = hResult.features;
        holes = hResult.holes;
    } else {
        // No hierarchy data — all features are macro
        for (const f of processedFeatures) {
            f.hierarchy_level = 'macro';
            f.parent_id = null;
        }
    }

    // Georeference and compute metrics
    const output = [];
    for (const f of processedFeatures) {
        const isLine = f.geometryType === 'LineString';

        // Pixel contour → WGS84 coordinates (RULE 3: 6 decimals, Y-inversion)
        let wgs84Ring = contourToWGS84(f.contour, extent, ANALYSIS_SIZE, ANALYSIS_SIZE);

        // World-space contour for area/perimeter computation
        const worldContour = contourToWorld(f.contour, extent, ANALYSIS_SIZE, ANALYSIS_SIZE);

        let geometry;
        if (isLine) {
            // LineString — no winding order needed, no closing
            geometry = {
                type: 'LineString',
                coordinates: wgs84Ring,
            };
        } else {
            // Polygon — RULE 3: ensure CCW winding for exterior ring
            wgs84Ring = ensureWinding(wgs84Ring, false);
            wgs84Ring = ensureClosed(wgs84Ring);

            // Add holes (inner rings) if any — RULE 4
            const contourHoles = holes.get(f._contourIdx);
            const rings = [wgs84Ring];

            if (contourHoles) {
                for (const holeContour of contourHoles) {
                    let holeRing = contourToWGS84(holeContour, extent, ANALYSIS_SIZE, ANALYSIS_SIZE);
                    // RULE 3: Holes must be CW
                    holeRing = ensureWinding(holeRing, true);
                    holeRing = ensureClosed(holeRing);
                    rings.push(holeRing);
                }
            }

            geometry = {
                type: 'Polygon',
                coordinates: rings,
            };
        }

        // Compute measurements
        const area_m2 = isLine ? null : Number(computeAreaM2(worldContour).toFixed(2));
        const perimeter_m = isLine
            ? Number(computeLengthM(worldContour).toFixed(2))
            : Number(computePerimeterM(worldContour).toFixed(2));

        output.push({
            type: 'Feature',
            geometry,
            properties: {
                id: f._vectorId,
                family: f.family,
                hierarchy_level: f.hierarchy_level || 'macro',
                parent_id: f.parent_id || null,
                confidence: Number((f.confidence || 0.5).toFixed(2)),
                area_m2,
                perimeter_m,
                vertex_count: f.contour.length,
                strategy: f.strategy,
                source_method: 'vectorization',
                regularized: f.regularized || false,
                ...(f.markerType ? { marker_type: f.markerType } : {}),
            },
        });
    }

    return output;
}

// ----------------------------------------------------------------
// INTERNAL — Build GeoJSON FeatureCollection
// ----------------------------------------------------------------

function _buildFeatureCollection(features, extent) {
    const origin = getOrigin();
    return {
        type: 'FeatureCollection',
        crs: {
            type: 'name',
            properties: { name: 'urn:ogc:def:crs:EPSG::4326' },
        },
        metadata: {
            exported: new Date().toISOString(),
            source: 'ecbyts Vectorization Engine',
            version: '1.0.0',
            utmOrigin: {
                easting: origin.easting,
                northing: origin.northing,
                elevation: origin.elevation,
                zone: origin.zone,
                hemisphere: origin.hemisphere,
                epsg: getEPSG(origin.zone, origin.hemisphere),
            },
            extent,
            imageSize: [ANALYSIS_SIZE, ANALYSIS_SIZE],
            featureCount: features.length,
        },
        features,
    };
}

// ----------------------------------------------------------------
// INTERNAL — Load image as CV_8UC3 Mat (no alpha)
// ----------------------------------------------------------------

/**
 * Load a base64 image into an OpenCV Mat (CV_8UC3).
 * Remove canal alpha — RULE 5: watershed requer exatamente 3 canais.
 *
 * @param {Object} cv
 * @param {string} dataUrl
 * @returns {Promise<Object>} - cv.Mat CV_8UC3 (CALLER MUST .delete())
 */
function _loadImageAsMat(cv, dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = ANALYSIS_SIZE;
            canvas.height = ANALYSIS_SIZE;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);

            const imageData = ctx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
            const rgba = imageData.data; // Uint8ClampedArray RGBA

            // Convert RGBA → RGB (remove alpha channel)
            const rgb = new Uint8Array(ANALYSIS_SIZE * ANALYSIS_SIZE * 3);
            for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
                rgb[j] = rgba[i]; // R
                rgb[j + 1] = rgba[i + 1]; // G
                rgb[j + 2] = rgba[i + 2]; // B
            }

            const mat = cv.matFromArray(ANALYSIS_SIZE, ANALYSIS_SIZE, cv.CV_8UC3, rgb);
            resolve(mat);
        };
        img.onerror = () => reject(new Error('Failed to load image for vectorization'));
        img.src = dataUrl;
    });
}

// ----------------------------------------------------------------
// INTERNAL — Fallback pipeline (no OpenCV)
// ----------------------------------------------------------------

/**
 * Fallback vectorization using existing BFS blob pipeline.
 * Usado quando OpenCV.js falha ao carregar (CDN down, CORS, etc).
 *
 * @param {Uint8Array} categoryGrid
 * @param {Object} extent
 * @param {Function} onProgress
 * @returns {Object} - GeoJSON FeatureCollection (simplified)
 */
function _fallbackVectorize(categoryGrid, extent, onProgress) {
    _notify(onProgress, 'fallback', 'Using fallback pipeline (no OpenCV)...', 10);

    const darkIdx = 4;
    const buildingSet = new Set([darkIdx]);
    const closedGrid = morphClose(categoryGrid, ANALYSIS_SIZE, ANALYSIS_SIZE, buildingSet);
    const { blobs, blobGrid } = findBlobs(closedGrid, ANALYSIS_SIZE, ANALYSIS_SIZE);
    const totalPixels = ANALYSIS_SIZE * ANALYSIS_SIZE;

    blobs.forEach((blob, i) => {
        blob.contour = extractContour(blobGrid, i + 1, blob, ANALYSIS_SIZE, ANALYSIS_SIZE);
    });

    const features = blobs
        .map((b) => blobToFeature(b, ANALYSIS_SIZE, ANALYSIS_SIZE, extent, totalPixels))
        .filter((f) => f !== null);

    // Convert to minimal GeoJSON features
    const geoFeatures = features.map((f, i) => {
        const wgs84Ring = contourToWGS84(
            (f.contours?.[0] || []).map((p) => ({ x: p.x * ANALYSIS_SIZE, y: p.y * ANALYSIS_SIZE })),
            extent,
            ANALYSIS_SIZE,
            ANALYSIS_SIZE,
        );
        return {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [ensureClosed(ensureWinding(wgs84Ring, false))],
            },
            properties: {
                id: `vec_${String(i).padStart(3, '0')}`,
                family: f.family,
                hierarchy_level: 'macro',
                parent_id: null,
                confidence: f.confidence,
                area_m2: null,
                perimeter_m: null,
                strategy: 'fallback',
                source_method: 'vectorization_fallback',
            },
        };
    });

    _notify(onProgress, 'done', `Fallback complete: ${geoFeatures.length} features`, 100);
    return _buildFeatureCollection(geoFeatures, extent);
}

// ----------------------------------------------------------------
// INTERNAL — Progress notification helper
// ----------------------------------------------------------------

function _notify(cb, status, message, progress) {
    if (typeof cb === 'function') {
        cb({ status, message, progress });
    }
}
