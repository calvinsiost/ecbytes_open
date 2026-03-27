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
   AERIAL DIAGNOSTIC — Verbose analysis for algorithm tuning
   ================================================================

   Modulo diagnostico que executa a analise aerea com coleta de
   metricas intermediarias: classificacao de pixels, blobs brutos,
   filtros aplicados, e comparacao AI vs algoritmo.

   Usado via API bridge para testes automatizados.

   ================================================================ */

import { analyzeByColor } from './colorAnalysis.js';
import { loadImageAsDataUrl, analyzeWithAI } from './analyzer.js';
import { hasApiKey } from '../llm/client.js';
import { getAllElements } from '../elements/manager.js';
import { isShadow, excessGreen, toGrayscale, computeEdgeMap, blobEdgeDensity } from './indices.js';

// ----------------------------------------------------------------
// HSL CATEGORIES (mirror from colorAnalysis for pixel-level stats)
// ----------------------------------------------------------------

const CATEGORIES = {
    water: { family: 'lake', match: (h, s, l) => h >= 170 && h <= 260 && s > 10 && l >= 5 && l <= 75 },
    vegetation: { family: 'habitat', match: (h, s, l) => h >= 50 && h <= 170 && s > 7 && l >= 3 && l <= 75 },
    building_bright: { family: 'building', match: (h, s, l) => s < 18 && l > 70 },
    building_dark: { family: 'building', match: (h, s, l) => s < 18 && l >= 12 && l <= 55 },
    infrastructure: { family: 'marker', match: (h, s, l) => s < 15 && l > 48 && l <= 72 },
    soil: { family: 'marker', match: (h, s, l) => h >= 15 && h <= 55 && s >= 10 && s <= 55 && l >= 15 && l <= 68 },
};
const CAT_KEYS = Object.keys(CATEGORIES);

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
// MAIN DIAGNOSTIC
// ----------------------------------------------------------------

/**
 * Run full diagnostic analysis on boundary overlay.
 * Executa analise completa com metricas detalhadas para tuning.
 * @param {Object} [options]
 * @param {boolean} [options.includeAI=false]
 * @param {number}  [options.resolution=512]
 * @returns {Promise<Object>}
 */
export async function runDiagnostic(options = {}) {
    const { includeAI = false, resolution = 512 } = options;
    const report = {
        timestamp: new Date().toISOString(),
        resolution,
        boundary: null,
        imageStats: null,
        pixelClassification: null,
        blobAnalysis: null,
        algorithmResults: null,
        aiResults: null,
        comparison: null,
        suggestions: [],
    };

    // 1. Find boundary with overlay
    const boundary = getAllElements().find((e) => e.family === 'boundary' && e.data?.overlayUrl);
    if (!boundary) {
        report.error = 'No boundary with overlay URL';
        return report;
    }

    const verts = boundary.data.vertices || [];
    let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
    for (const v of verts) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
    }
    const extent = { minX, maxX, minZ, maxZ };

    report.boundary = {
        id: boundary.id,
        name: boundary.name,
        overlayUrl: boundary.data.overlayUrl,
        extent,
        worldSize: { w: Math.round(maxX - minX), h: Math.round(maxZ - minZ) },
    };

    // 2. Load image
    let dataUrl;
    try {
        dataUrl = await loadImageAsDataUrl(boundary.data.overlayUrl, resolution);
        report.imageStats = { loaded: true };
    } catch (err) {
        report.error = `Image load: ${err.message}`;
        return report;
    }

    // 3. Pixel-level analysis
    const px = await _pixelAnalysis(dataUrl, resolution);
    report.imageStats.originalSize = px.originalSize;
    report.imageStats.analysisSize = px.analysisSize;
    report.pixelClassification = px.classification;
    report.blobAnalysis = px.blobs;

    // 4. Standard algorithm
    const t0 = performance.now();
    try {
        const features = await analyzeByColor(dataUrl, extent);
        report.algorithmResults = {
            durationMs: Math.round(performance.now() - t0),
            count: features.length,
            features: features.map(_simplifyFeature),
            byFamily: _countBy(features, 'family'),
            confidence: _stats(features.map((f) => f.confidence)),
        };
    } catch (err) {
        report.algorithmResults = { error: err.message };
    }

    // 5. AI analysis (optional)
    if (includeAI && hasApiKey()) {
        const t1 = performance.now();
        try {
            const aiF = await analyzeWithAI(dataUrl, extent);
            report.aiResults = {
                durationMs: Math.round(performance.now() - t1),
                count: aiF.length,
                features: aiF.map(_simplifyFeature),
                byFamily: _countBy(aiF, 'family'),
                confidence: _stats(aiF.map((f) => f.confidence)),
            };
            if (report.algorithmResults?.features) {
                report.comparison = _compare(report.algorithmResults.features, report.aiResults.features, extent);
            }
        } catch (err) {
            report.aiResults = { error: err.message };
        }
    } else if (includeAI) {
        report.aiResults = { error: 'No API key' };
    }

    // 6. Suggestions
    report.suggestions = _suggest(report);
    return report;
}

// ----------------------------------------------------------------
// PIXEL ANALYSIS (canvas-based, runs in browser)
// ----------------------------------------------------------------

function _pixelAnalysis(dataUrl, targetSize) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const S = targetSize;
                const canvas = document.createElement('canvas');
                canvas.width = S;
                canvas.height = S;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, S, S);
                const data = ctx.getImageData(0, 0, S, S).data;
                const total = S * S;

                // Counts (includes shadow + ExG-based vegetation)
                const catCount = {};
                for (const k of CAT_KEYS) catCount[k] = 0;
                catCount.unclassified = 0;
                catCount.shadow = 0;
                catCount.exg_vegetation = 0;

                // HSL histograms (10° hue, 5% sat/light)
                const hHist = new Array(36).fill(0);
                const sHist = new Array(20).fill(0);
                const lHist = new Array(20).fill(0);

                // Samples
                const samples = {};
                for (const k of CAT_KEYS) samples[k] = [];

                // Pre-processing: grayscale + edge map for blob analysis
                const gray = toGrayscale(data, total);
                const edgeMap = computeEdgeMap(gray, S, S);

                // Grid for blob detection
                const grid = new Uint8Array(total);
                const darkIdx = CAT_KEYS.indexOf('building_dark') + 1;
                const brightIdx = CAT_KEYS.indexOf('building_bright') + 1;

                for (let i = 0; i < total; i++) {
                    const o = i * 4;
                    const r = data[o],
                        g = data[o + 1],
                        b = data[o + 2];
                    const hsl = rgbToHsl(r, g, b);

                    hHist[Math.min(35, Math.floor(hsl.h / 10))]++;
                    sHist[Math.min(19, Math.floor(hsl.s / 5))]++;
                    lHist[Math.min(19, Math.floor(hsl.l / 5))]++;

                    // Shadow filter (C3 + luminance) — matches classifyPixel priority
                    if (isShadow(r, g, b)) {
                        catCount.shadow++;
                        continue;
                    }

                    // ExG vegetation — more robust than HSL hue for aerial
                    const exg = excessGreen(r, g, b);
                    if (exg > 0.08) {
                        catCount.exg_vegetation++;
                        catCount.vegetation++;
                        grid[i] = CAT_KEYS.indexOf('vegetation') + 1;
                        continue;
                    }

                    let matched = false;
                    for (let k = 0; k < CAT_KEYS.length; k++) {
                        if (CAT_KEYS[k] === 'vegetation') continue; // Handled by ExG
                        if (CATEGORIES[CAT_KEYS[k]].match(hsl.h, hsl.s, hsl.l)) {
                            catCount[CAT_KEYS[k]]++;
                            grid[i] = k + 1;
                            matched = true;
                            if (samples[CAT_KEYS[k]].length < 3) {
                                samples[CAT_KEYS[k]].push({
                                    rgb: [r, g, b],
                                    hsl: { h: Math.round(hsl.h), s: Math.round(hsl.s), l: Math.round(hsl.l) },
                                });
                            }
                            break;
                        }
                    }
                    if (!matched) catCount.unclassified++;
                }

                // Merge bright→dark building
                for (let i = 0; i < total; i++) {
                    if (grid[i] === brightIdx) grid[i] = darkIdx;
                }

                // Morph close
                const closed = _morphClose(grid, S, S);

                // Post-morph counts
                const postCount = {};
                for (const k of CAT_KEYS) postCount[k] = 0;
                postCount.unclassified = 0;
                for (let i = 0; i < total; i++) {
                    const c = closed[i];
                    if (c === 0) postCount.unclassified++;
                    else postCount[CAT_KEYS[c - 1]]++;
                }

                // Blobs
                const blobs = _findBlobs(closed, S, S);
                const significant = blobs.filter((b) => b.pixels / total >= 0.005);

                resolve({
                    originalSize: { w: img.width, h: img.height },
                    analysisSize: { w: S, h: S },
                    classification: {
                        totalPixels: total,
                        preMorph: { counts: catCount, pct: _toPct(catCount, total) },
                        postMorph: { counts: postCount, pct: _toPct(postCount, total) },
                        hslHistogram: {
                            hue: hHist
                                .map((v, i) => ({ deg: `${i * 10}-${i * 10 + 9}`, pct: _p(v, total) }))
                                .filter((h) => h.pct > 0.5),
                            saturation: sHist
                                .map((v, i) => ({ range: `${i * 5}-${i * 5 + 4}%`, pct: _p(v, total) }))
                                .filter((h) => h.pct > 1),
                            lightness: lHist
                                .map((v, i) => ({ range: `${i * 5}-${i * 5 + 4}%`, pct: _p(v, total) }))
                                .filter((h) => h.pct > 1),
                        },
                        samples,
                    },
                    blobs: {
                        total: blobs.length,
                        aboveThreshold: blobs.filter((b) => b.pixels / total >= 0.01).length,
                        belowThreshold: blobs.filter((b) => b.pixels / total < 0.01).length,
                        details: significant
                            .sort((a, b) => b.pixels - a.pixels)
                            .slice(0, 30)
                            .map((b) => {
                                const bboxW = b.maxX - b.minX + 1;
                                const bboxH = b.maxY - b.minY + 1;
                                const fill = b.pixels / (bboxW * bboxH);
                                const aspect = bboxH > 0 ? bboxW / bboxH : 1;
                                const cat = CAT_KEYS[b.category - 1];
                                // Edge density for building blobs — distinguishes structures from shadows
                                const edgeDens =
                                    cat === 'building_dark' || cat === 'building_bright'
                                        ? Math.round(blobEdgeDensity(edgeMap, closed, b, S) * 1000) / 1000
                                        : null;
                                return {
                                    cat,
                                    family: CATEGORIES[cat]?.family,
                                    pixels: b.pixels,
                                    areaPct: _p(b.pixels, total),
                                    bbox: { x: b.minX, y: b.minY, w: bboxW, h: bboxH },
                                    fill: Math.round(fill * 100) / 100,
                                    aspect: Math.round(aspect * 100) / 100,
                                    edgeDensity: edgeDens,
                                    filtered: _wouldFilter(cat, fill, aspect, b.pixels / total, edgeDens),
                                };
                            }),
                    },
                });
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = dataUrl;
    });
}

// ----------------------------------------------------------------
// MORPH CLOSE + BLOB FINDER
// ----------------------------------------------------------------

function _morphClose(grid, w, h) {
    const n = w * h;
    const dil = new Uint8Array(n);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (grid[i]) {
                dil[i] = grid[i];
                continue;
            }
            const nb = [
                y > 0 ? grid[i - w] : 0,
                y < h - 1 ? grid[i + w] : 0,
                x > 0 ? grid[i - 1] : 0,
                x < w - 1 ? grid[i + 1] : 0,
            ];
            const ct = {};
            let best = 0,
                bc = 0;
            for (const v of nb) {
                if (!v) continue;
                ct[v] = (ct[v] || 0) + 1;
                if (ct[v] > best) {
                    best = ct[v];
                    bc = v;
                }
            }
            dil[i] = best >= 2 ? bc : 0;
        }
    const ero = new Uint8Array(n);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const c = dil[i];
            if (!c) continue;
            const ok =
                (y === 0 || dil[i - w] === c) &&
                (y === h - 1 || dil[i + w] === c) &&
                (x === 0 || dil[i - 1] === c) &&
                (x === w - 1 || dil[i + 1] === c);
            ero[i] = ok ? c : 0;
        }
    return ero;
}

function _findBlobs(grid, w, h) {
    const vis = new Uint8Array(w * h);
    const blobs = [];
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (vis[i] || !grid[i]) continue;
            const cat = grid[i];
            const b = {
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
            const q = [i];
            vis[i] = 1;
            while (q.length) {
                const ci = q.pop(),
                    cx = ci % w,
                    cy = (ci - cx) / w;
                b.pixels++;
                b.sumX += cx;
                b.sumY += cy;
                b.sumXX += cx * cx;
                b.sumYY += cy * cy;
                b.sumXY += cx * cy;
                if (cx < b.minX) b.minX = cx;
                if (cx > b.maxX) b.maxX = cx;
                if (cy < b.minY) b.minY = cy;
                if (cy > b.maxY) b.maxY = cy;
                for (const ni of [
                    cy > 0 ? ci - w : -1,
                    cy < h - 1 ? ci + w : -1,
                    cx > 0 ? ci - 1 : -1,
                    cx < w - 1 ? ci + 1 : -1,
                ]) {
                    if (ni >= 0 && !vis[ni] && grid[ni] === cat) {
                        vis[ni] = 1;
                        q.push(ni);
                    }
                }
            }
            blobs.push(b);
        }
    return blobs;
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function _p(v, t) {
    return Math.round((v / t) * 10000) / 100;
}
function _toPct(obj, t) {
    const r = {};
    for (const [k, v] of Object.entries(obj)) r[k] = _p(v, t);
    return r;
}

function _countBy(arr, key) {
    const r = {};
    for (const item of arr) r[item[key]] = (r[item[key]] || 0) + 1;
    return r;
}

function _stats(vals) {
    if (!vals.length) return { min: 0, max: 0, avg: 0 };
    vals.sort((a, b) => a - b);
    return {
        min: vals[0],
        max: vals[vals.length - 1],
        avg: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100,
        median: vals[Math.floor(vals.length / 2)],
    };
}

function _simplifyFeature(f) {
    return {
        family: f.family,
        label: f.label,
        confidence: f.confidence,
        position: f.position,
        dimensions: f.dimensions,
        rotation: f.rotation ? Math.round((f.rotation * 180) / Math.PI) + '°' : null,
        source: f.sourceMethod,
    };
}

function _wouldFilter(cat, fill, aspect, areaRatio, edgeDensity) {
    // Per-family minimum area thresholds (mirrors colorAnalysis.js)
    const family = CATEGORIES[cat]?.family;
    const MIN_AREA = { building: 0.002, lake: 0.004, habitat: 0.004, marker: 0.003 };
    const minTh = MIN_AREA[family] || 0.005;
    if (areaRatio < minTh) return `noise (<${(minTh * 100).toFixed(1)}%)`;
    if (cat === 'building_dark' || cat === 'building_bright') {
        if (edgeDensity !== null && edgeDensity < 0.03) return 'shadow (low edge density)';
        if (aspect > 6 || aspect < 0.17) return 'road→marker';
        if (fill < 0.3 && (aspect > 4 || aspect < 0.25)) return 'road→marker';
    }
    return null;
}

function _compare(algoF, aiF, extent) {
    const thresh = Math.max(extent.maxX - extent.minX, extent.maxZ - extent.minZ) * 0.15;
    const matches = [];
    const algoLeft = [...algoF];

    for (const ai of aiF) {
        let bi = -1,
            bd = Infinity;
        for (let i = 0; i < algoLeft.length; i++) {
            if (algoLeft[i].family !== ai.family) continue;
            const dx = algoLeft[i].position.x - ai.position.x;
            const dz = algoLeft[i].position.z - ai.position.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < thresh && d < bd) {
                bd = d;
                bi = i;
            }
        }
        if (bi >= 0) {
            matches.push({ family: ai.family, aiLabel: ai.label, dist: Math.round(bd * 10) / 10 });
            algoLeft.splice(bi, 1);
        }
    }
    return {
        matched: matches.length,
        aiOnly: aiF.length - matches.length,
        algoOnly: algoLeft.length,
        matchRate: Math.round((matches.length / Math.max(aiF.length, 1)) * 100) + '%',
        matches,
    };
}

function _suggest(r) {
    const s = [];
    const pc = r.pixelClassification;
    const algo = r.algorithmResults;
    if (!pc || !algo) return s;

    const unPct = pc.preMorph?.pct?.unclassified || 0;
    if (unPct > 60) s.push({ severity: 'high', msg: `${unPct}% unclassified — HSL thresholds too narrow` });

    // Shadow analysis
    const shadowPct = pc.preMorph?.pct?.shadow || 0;
    if (shadowPct > 30)
        s.push({
            severity: 'medium',
            msg: `${shadowPct}% shadow pixels — high shadow content, time-of-day or sun angle issue`,
        });
    if (shadowPct > 0) s.push({ severity: 'info', msg: `${shadowPct}% pixels filtered as shadow (C3+luminance)` });

    const blobs = r.blobAnalysis;
    if (blobs && blobs.belowThreshold > 50 && blobs.aboveThreshold < 5)
        s.push({
            severity: 'medium',
            msg: `${blobs.belowThreshold} tiny blobs, only ${blobs.aboveThreshold} significant — image noisy`,
        });

    // Edge density filtering stats
    const edgeFiltered = (blobs?.details || []).filter((b) => b.filtered?.includes('edge density')).length;
    if (edgeFiltered > 0)
        s.push({ severity: 'info', msg: `${edgeFiltered} building blobs discarded by edge density filter (shadows)` });

    const roads = (blobs?.details || []).filter((b) => b.filtered?.includes('road')).length;
    if (roads > 5) s.push({ severity: 'low', msg: `${roads} blobs filtered as roads — detection may be aggressive` });

    if (algo.count < 3)
        s.push({ severity: 'high', msg: `Only ${algo.count} features — lower noise threshold or check image` });

    const avg = algo.confidence?.avg || 0;
    if (avg < 0.45 && algo.count > 0) s.push({ severity: 'medium', msg: `Low avg confidence ${avg}` });

    if (r.comparison?.matchRate && parseInt(r.comparison.matchRate) < 40)
        s.push({ severity: 'high', msg: `AI vs Algo match rate ${r.comparison.matchRate} — significant divergence` });

    return s;
}
