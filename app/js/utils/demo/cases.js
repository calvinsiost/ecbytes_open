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
   DEMO CASES — 50 pre-defined environmental monitoring scenarios
   50 cenarios pre-definidos para demonstracao interativa

   Distribuicao: ~13 por vertical, cobrindo 3 modulos cada.
   Cada caso define elementos iniciais, camera states e steps.

   VERTICAIS: mining, forestry, contamination, occupational_health
   MODULOS: neural_net, ai_bot, satellite
   ================================================================ */

// ----------------------------------------------------------------
// HELPERS — Geradores de dados reutilizaveis
// ----------------------------------------------------------------

let caseCounter = 0;

function uid() {
    return `demo-el-${++caseCounter}`;
}

/**
 * Create camera target state.
 * @param {number} x @param {number} y @param {number} z
 * @param {number} zoom @param {number} tx @param {number} ty @param {number} tz
 */
function cam(x, y, z, zoom = 1, tx = 0, ty = -20, tz = 0) {
    return { camera: { x, y, z, zoom }, target: { x: tx, y: ty, z: tz } };
}

/** Create a well element definition */
function well(id, name, x, z, depth = 50) {
    return {
        family: 'well',
        id,
        name,
        data: {
            coordinates: { easting: x, northing: z, elevation: 0 },
            construction: { totalDepth: depth, diameter: 4 },
        },
    };
}

/** Create a plume element definition */
function plume(id, name, x, z, rx = 10, ry = 8, rz = 4) {
    return {
        family: 'plume',
        id,
        name,
        data: {
            depth: { level: 'shallow', top: 0, bottom: -15 },
            shape: { radiusX: rx, radiusY: ry, radiusZ: rz },
            center: { x, y: -7.5, z },
        },
    };
}

/** Create a sensor element definition */
function sensor(id, name, x, z) {
    return {
        family: 'sensor',
        id,
        name,
        data: { position: { x, y: 0, z } },
    };
}

/** Create a building element definition */
function building(id, name, x, z, w = 8, h = 5, d = 6) {
    return {
        family: 'building',
        id,
        name,
        data: {
            position: { x, y: 0, z },
            dimensions: { width: w, height: h, depth: d },
        },
    };
}

/** Create a boundary element definition */
function boundary(id, name, points) {
    return {
        family: 'boundary',
        id,
        name,
        data: { vertices: points },
    };
}

/** Create a lake element definition */
function lake(id, name, x, z) {
    return {
        family: 'lake',
        id,
        name,
        data: {
            position: { x, y: -1, z },
            dimensions: { width: 20, depth: 3 },
        },
    };
}

/** Create a tank element definition */
function tank(id, name, x, z) {
    return {
        family: 'tank',
        id,
        name,
        data: {
            position: { x, y: 0, z },
            dimensions: { radius: 3, height: 5 },
        },
    };
}

/** Create a waste element definition */
function waste(id, name, x, z) {
    return {
        family: 'waste',
        id,
        name,
        data: { position: { x, y: 0, z } },
    };
}

/** Create a marker element definition */
function marker(id, name, x, z) {
    return {
        family: 'marker',
        id,
        name,
        data: { position: { x, y: 0, z } },
    };
}

// ----------------------------------------------------------------
// TICKER LOG TEMPLATES
// ----------------------------------------------------------------

const NEURAL_NET_LOGS = [
    '[NEURAL_NET] Initializing model architecture...',
    '[NEURAL_NET] Loading training data (1,247 samples)...',
    '[TRAINING] Epoch 1/50 — Loss: 0.8934 | Acc: 0.42',
    '[TRAINING] Epoch 15/50 — Loss: 0.3201 | Acc: 0.78',
    '[TRAINING] Epoch 35/50 — Loss: 0.0891 | Acc: 0.94',
    '[TRAINING] Epoch 50/50 — Loss: 0.0234 | Acc: 0.97',
    '[NEURAL_NET] Model converged. R² = 0.96',
    '[PREDICTION] Generating forecast for next 30 days...',
    '[OK] Prediction complete — confidence: 94.2%',
];

const AI_BOT_LOGS = [
    '[LLM_AGENT] Initializing environmental knowledge base...',
    '[KNOWLEDGE_BASE] Loading CONAMA 420/2009 standards...',
    '[KNOWLEDGE_BASE] Loading CETESB reference values...',
    '[LLM_AGENT] Analyzing contamination vectors...',
    '[LLM_AGENT] Cross-referencing with regulatory thresholds...',
    '[LLM_AGENT] Evaluating remediation alternatives...',
    '[LLM_AGENT] Generating technical recommendations...',
    '[OK] Analysis complete — 3 critical findings',
];

const SATELLITE_LOGS = [
    '[SAT_RECOG] Fetching Sentinel-2 imagery (10m resolution)...',
    '[SAT_RECOG] Radiometric correction applied',
    '[SAT_RECOG] Cloud coverage: 8% — GOOD',
    '[NDVI] Computing vegetation index...',
    '[NDVI] Vegetation index: 0.72 ± 0.04',
    '[SAT_RECOG] Running land use classifier (RandomForest)...',
    '[SAT_RECOG] Detected: forest 62%, water 15%, urban 12%, bare 11%',
    '[OK] Classification complete — 4 land use classes mapped',
];

const MINING_NN_LOGS = [
    '[NEURAL_NET] Loading piezometric time-series (48 wells)...',
    '[NEURAL_NET] Feature engineering: lag, rolling mean, season...',
    '[TRAINING] Epoch 1/80 — Loss: 1.2340 | MAE: 2.1m',
    '[TRAINING] Epoch 40/80 — Loss: 0.1456 | MAE: 0.4m',
    '[TRAINING] Epoch 80/80 — Loss: 0.0312 | MAE: 0.15m',
    '[PREDICTION] Forecasting water table for 90 days...',
    '[ALERT] Well MW-12: predicted drawdown exceeds 5m threshold',
    '[OK] Prediction map generated — 3 risk zones identified',
];

const HEALTH_LOGS = [
    '[VOC_MONITOR] Reading PID sensors (23 stations)...',
    '[VOC_MONITOR] Benzene: 0.8 ppm | Toluene: 2.1 ppm | Xylene: 1.5 ppm',
    '[NR-15] Threshold check: Benzene > 0.5 ppm — WARNING',
    '[EXPOSURE] Calculating TWA (Time Weighted Average)...',
    '[EXPOSURE] Worker Route A: TWA = 1.2 ppm (LIMIT: 1.0)',
    '[ALERT] Route A exceeds NR-15 occupational limit!',
    '[HEATMAP] Generating VOC concentration surface...',
    '[OK] Heatmap generated — 2 exposure hotspots identified',
];

// ----------------------------------------------------------------
// STEP BUILDER HELPERS
// ----------------------------------------------------------------

function stepCamera(title, desc, target, duration = 800) {
    return { title, description: desc, action: 'camera', params: { target, duration } };
}

function stepToast(title, desc, msg, type = 'info', duration = 4000) {
    return { title, description: '', action: 'showToast', params: { message: msg, type, duration } };
}

function stepAI(title, desc, logs, duration = 4000, glowTarget) {
    return { title, description: desc, action: 'simulateAI', params: { logs, duration, glowTarget } };
}

function stepAddElements(title, desc, elements) {
    return { title, description: desc, action: 'addElements', params: { elements } };
}

function stepHeatmap(title, desc, grid, opts = {}) {
    return {
        title,
        description: desc,
        action: 'heatmap',
        params: { grid, routes: opts.routes || null, ...opts },
    };
}

function stepHighlight(title, desc, elementId, duration = 2000) {
    return { title, description: desc, action: 'highlight', params: { elementId, duration } };
}

function stepTicker(title, desc, logs) {
    return { title, description: desc, action: 'tickerLog', params: { logs } };
}

/** Generate a random heatmap grid */
function randomHeatmapGrid(rows = 15, cols = 15, hotspots = []) {
    const grid = [];
    for (let r = 0; r < rows; r++) {
        grid[r] = [];
        for (let c = 0; c < cols; c++) {
            let val = Math.random() * 0.2; // Base low risk
            // Add hotspot influence
            for (const hs of hotspots) {
                const dist = Math.sqrt((r - hs.r) ** 2 + (c - hs.c) ** 2);
                val += hs.intensity * Math.exp((-dist * dist) / (2 * hs.spread * hs.spread));
            }
            grid[r][c] = Math.min(1, val);
        }
    }
    return grid;
}

// ================================================================
// SUPABASE FETCH — Busca cases do banco de dados
// ================================================================

/**
 * Fetch demo cases from Supabase.
 * Busca os 50 cases do Supabase com cache em sessionStorage.
 * Se falhar (offline/erro), usa fallback local de 5 cases.
 *
 * @returns {Promise<Array<Object>>} Array of CaseMetadata
 */
export async function fetchDemoCases() {
    // Check sessionStorage cache first
    const cached = sessionStorage.getItem('ecbyts-demo-cases');
    if (cached) {
        try {
            return JSON.parse(cached);
        } catch {
            /* fallthrough */
        }
    }

    // Try Supabase
    try {
        const { getSupabaseClient } = await import('../auth/session.js');
        const client = getSupabaseClient();

        if (client) {
            const { data, error } = await client.from('demo_cases').select('*').eq('active', true).order('sort_order');

            if (!error && data && data.length > 0) {
                const cases = data.map((row) => ({
                    id: row.id,
                    vertical: row.vertical,
                    module: row.module,
                    title: row.title,
                    description: row.description || '',
                    riskLevel: row.risk_level || 'med',
                    ...row.case_data,
                }));
                sessionStorage.setItem('ecbyts-demo-cases', JSON.stringify(cases));
                console.log(`[Demo] Loaded ${cases.length} cases from Supabase`);
                return cases;
            }
        }
    } catch (e) {
        console.warn('[Demo] Supabase fetch failed, using fallback:', e.message);
    }

    // Fallback: 5 representative local cases
    console.log('[Demo] Using fallback cases (offline mode)');
    return generateFallbackCases();
}

/**
 * Backward-compatible sync version.
 * Retorna fallback imediato; chamadores devem migrar para fetchDemoCases().
 * @returns {Array<Object>}
 */
export function generateMockCases() {
    caseCounter = 0;
    return generateFallbackCases();
}

// ================================================================
// FALLBACK CASES — 5 cases representativos para modo offline
// ================================================================

function generateFallbackCases() {
    caseCounter = 0;
    return [
        // ============================================================
        // MINING — Mineração (13 cases)
        // ============================================================
        {
            id: 'mining-001',
            vertical: 'mining',
            module: 'neural_net',
            title: 'Pit Dewatering Prediction',
            description: 'Neural network predicts water table drawdown around an open-pit mine over 90 days.',
            riskLevel: 'high',
            initialCamera: cam(60, 80, 60, 1.2, 0, -15, 0),
            elements: [
                well(uid(), 'MW-01', -20, -15, 80),
                well(uid(), 'MW-02', 15, -20, 75),
                well(uid(), 'MW-03', 25, 10, 65),
                well(uid(), 'MW-04', -10, 20, 70),
                well(uid(), 'MW-05', 0, -30, 85),
                boundary(uid(), 'Pit Boundary', [
                    { x: -30, z: -25 },
                    { x: 30, z: -25 },
                    { x: 35, z: 20 },
                    { x: -25, z: 20 },
                ]),
            ],
            steps: [
                stepCamera(
                    'Overview',
                    'Isometric view of the open-pit mine with 5 monitoring wells.',
                    cam(60, 80, 60, 1.2, 0, -15, 0),
                ),
                stepToast(
                    'Problem',
                    '',
                    'Challenge: Predict water table behavior during pit expansion to prevent slope instability.',
                    'warning',
                    5000,
                ),
                stepAI(
                    'Neural Network Training',
                    'Training LSTM model on 2 years of piezometric data from 5 wells.',
                    MINING_NN_LOGS,
                    5000,
                ),
                stepCamera(
                    'Risk Zone',
                    'Zooming to the critical drawdown area near MW-05.',
                    cam(20, 40, -20, 2, 0, -15, -30),
                ),
                stepToast(
                    'Result',
                    '',
                    'Prediction: MW-05 will reach critical level (-5m) in 47 days. Recommended: install additional dewatering well.',
                    'success',
                    6000,
                ),
            ],
        },
    ];
}

// 49 additional cases migrated to Supabase table `demo_cases`.
// Para adicionar/editar cases, use o Supabase Dashboard.
