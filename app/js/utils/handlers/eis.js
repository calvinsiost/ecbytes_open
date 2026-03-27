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
 * EIS Dashboard Handlers
 * Handlers para o dashboard interativo do EnviroTech Integrity Score.
 *
 * Abre um modal com gauge circular, radar chart (Chart.js) e sliders
 * para cálculo interativo do EIS nos 6 eixos TCCCA+T.
 *
 * O multiplicador de credencial é computado automaticamente a partir
 * das observações do modelo (carimbo por leitura), não por seleção manual.
 */

import {
    EisCalculator,
    EIS_AXES,
    EIS_DEFAULT_WEIGHTS,
    EIS_CREDENTIAL_MULTIPLIERS,
    EIS_CREDENTIAL_LABELS,
    EIS_VERDICTS,
    EIS_CUSTOM_TEMPLATES,
    EIS_COST_BENCHMARKS,
} from '../../core/eis/eisCalculator.js';

import { getAllElements } from '../../core/elements/manager.js';
import { getAllCampaigns, getCampaignCompleteness } from '../../core/campaigns/manager.js';
import { UNITS } from '../../core/units/catalog.js';
import { CONFIG } from '../../config.js';
import { t } from '../i18n/translations.js';
import { safeSetItem } from '../storage/storageMonitor.js';

// ================================================================
// MODULE STATE
// Estado do dashboard — chart instance e calculadora
// ================================================================

/** @type {EisCalculator} */
const calculator = new EisCalculator();

/** @type {import('chart.js').Chart|null} */
let radarChart = null;

/** @type {'geometric'|'veto'|'custom'} */
let currentMode = 'geometric';

/** @type {{ multiplier: number, count: number, breakdown: Object }|null} */
let cachedCredInfo = null;

/** @type {{ score: number, totalPlanned: number, totalExecuted: number, ratio: number }|null} */
let cachedCpResult = null;

/** Resultados de auto-cálculo por eixo (null = indisponível) */
const cachedAutoResults = { T: null, A: null, Cp: null, Ty: null, Cs: null, Cm: null };

/** Global Compliance cached result */
let cachedGcResult = null;

/** Estado do toggle AUTO/MANUAL por eixo (true = auto ativado) */
const autoEnabled = { T: false, A: false, Cp: false, Ty: false, Cs: false, Cm: false };

/** Perfil custom ativo */
let activeCustomProfile = null;

/** Perfis custom salvos (carregados do localStorage) */
let customProfiles = [];

/** Chave localStorage para perfis custom */
const CUSTOM_PROFILES_KEY = 'ecbyts-eis-custom-profiles';

// ================================================================
// AXIS METADATA
// Nomes descritivos dos eixos para exibição no dashboard
// ================================================================

const AXIS_META = {
    T: { key: 'eis.axis_T', fallback: 'Transparency' },
    A: { key: 'eis.axis_A', fallback: 'Accuracy' },
    Cp: { key: 'eis.axis_Cp', fallback: 'Completeness' },
    Ty: { key: 'eis.axis_Ty', fallback: 'Timeliness' },
    Cs: { key: 'eis.axis_Cs', fallback: 'Consistency' },
    Cm: { key: 'eis.axis_Cm', fallback: 'Comparability' },
};

// ================================================================
// COLOR & CANVAS HELPERS
// Gradiente contínuo de cor por score e setup HiDPI para canvas
// ================================================================

/**
 * Converte score EIS (0-5) em cor CSS via gradiente contínuo de 5 stops.
 * Diferente de getVerdictColor() que retorna 3 cores categóricas (verdict).
 * @param {number} score - 0.0 a 5.0
 * @returns {string} CSS rgb() color
 */
function scoreToColor(score) {
    if (!Number.isFinite(score)) return 'rgb(239,68,68)';
    const s = Math.max(0, Math.min(5, score));
    const stops = [
        [0, [239, 68, 68]], // red
        [1.5, [249, 115, 22]], // orange
        [2.5, [234, 179, 8]], // yellow
        [3.5, [34, 197, 94]], // green
        [5, [5, 150, 105]], // teal
    ];
    let lo = stops[0],
        hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
        if (s >= stops[i][0] && s <= stops[i + 1][0]) {
            lo = stops[i];
            hi = stops[i + 1];
            break;
        }
    }
    const t = lo[0] === hi[0] ? 0 : (s - lo[0]) / (hi[0] - lo[0]);
    const r = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * t);
    const g = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * t);
    const b = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * t);
    return `rgb(${r},${g},${b})`;
}

/**
 * Configura canvas para HiDPI (retina). Escala uma única vez.
 * Reutilizável por renderRingChart e updateEisStatusBadge.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ ctx: CanvasRenderingContext2D, W: number, H: number }}
 */
function setupHiDPI(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    if (canvas.dataset.scaled !== '1') {
        canvas.dataset.logicalW = canvas.width;
        canvas.dataset.logicalH = canvas.height;
        canvas.width = canvas.width * dpr;
        canvas.height = canvas.height * dpr;
        canvas.style.width = canvas.dataset.logicalW + 'px';
        canvas.style.height = canvas.dataset.logicalH + 'px';
        ctx.scale(dpr, dpr);
        canvas.dataset.scaled = '1';
    }
    return {
        ctx,
        W: parseInt(canvas.dataset.logicalW),
        H: parseInt(canvas.dataset.logicalH),
    };
}

/** Segmentos do ring chart para hit detection (Batch 2) */
let ringSegments = [];

/** Referência ao marker da scale strip para updates rápidos */
let _scaleStripMarker = null;
let _scaleStripValue = null;
let _scaleStripInitialized = false;

/** F1: Ring interaction state */
let _ringHoverAxis = null;
let _ringListenersAttached = false;

/** F2: Expanded axis detail */
let _expandedAxis = null;

/** Campaign details cache (com details[] para Cp drill-down) */
let cachedCampaignDetails = null;

/** Cached observations enriched with element info */
let cachedAllObs = null;

/** Último resultado do recalculate (para tooltip/detail/improvement) */
let _lastResult = null;
let _lastScores = null;

// ================================================================
// PUBLIC HANDLERS
// ================================================================

/**
 * Open the EIS dashboard modal.
 * Abre o modal, computa credencial agregada das leituras e inicializa UI.
 */
function handleOpenEisDashboard() {
    const modal = document.getElementById('eis-dashboard-modal');
    if (!modal) return;

    modal.classList.add('active');

    // Reset scale strip state for fresh render
    _scaleStripMarker = null;
    _scaleStripValue = null;
    _scaleStripInitialized = false;

    // Coleta dados do modelo uma vez (performance)
    const elements = getAllElements();
    const allObs = collectAllObservations();
    cachedAllObs = allObs;
    const campaigns = getAllCampaigns();

    // Credencial agregada
    cachedCredInfo = EisCalculator.computeAggregateCredential(allObs);

    // Auto-cálculo de todos os eixos
    const campaignStats = campaigns.map((c) => getCampaignCompleteness(c.id, elements));
    cachedCampaignDetails = campaignStats;
    cachedCpResult = EisCalculator.computeCpFromCampaigns(campaignStats);
    cachedAutoResults.Cp = cachedCpResult;
    cachedAutoResults.T = EisCalculator.computeTFromObservations(allObs);
    cachedAutoResults.A = EisCalculator.computeAFromModel(elements, allObs);
    cachedAutoResults.Ty = EisCalculator.computeTyFromObservations(allObs);
    cachedAutoResults.Cs = EisCalculator.computeCsFromObservations(allObs, UNITS);
    cachedAutoResults.Cm = EisCalculator.computeCmFromObservations(allObs, CONFIG.PARAMETERS);

    // Global Compliance (GC) — async computation
    try {
        Promise.all([
            import('../../core/validation/globalCompliance.js'),
            import('../../core/validation/globalThresholds.js'),
        ])
            .then(([{ computeGlobalCompliance }, { JURISDICTIONS }]) => {
                cachedGcResult = computeGlobalCompliance(allObs);
                window.__ecbyts_gc_jurisdictions = { JURISDICTIONS };
                _renderGcSection();
            })
            .catch(() => {
                cachedGcResult = null;
            });
    } catch {
        cachedGcResult = null;
    }

    // Ativa AUTO por default onde dados disponíveis
    for (const axis of EIS_AXES) {
        autoEnabled[axis] = cachedAutoResults[axis] != null;
    }

    // Carrega perfis custom do localStorage
    loadCustomProfiles();

    // Inicializa UI conforme modo
    if (currentMode === 'custom') {
        renderCustomModeUI();
    }
    // Standard sliders are now inline in contribution bars — no separate render needed

    initRingInteraction();
    recalculate();
    _renderGcSection();
}

/**
 * Render the Global Compliance (GC) companion indicator section.
 * Displayed below the 6 standard sliders in the EIS dashboard.
 */
function _renderGcSection() {
    // Find or create GC container
    const slidersContainer = document.getElementById('eis-sliders-container');
    if (!slidersContainer) return;

    let gcEl = document.getElementById('eis-gc-section');
    if (!gcEl) {
        gcEl = document.createElement('div');
        gcEl.id = 'eis-gc-section';
        gcEl.style.cssText =
            'margin-top:12px;padding-top:12px;border-top:1px solid var(--eis-border, rgba(99,102,241,0.2));';
        slidersContainer.parentNode?.insertBefore(gcEl, slidersContainer.nextSibling);
    }

    if (!cachedGcResult) {
        gcEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:var(--eis-muted,rgba(255,255,255,0.5));font-size:11px;">
            <span style="font-weight:600;font-size:12px;">GLOBAL COMPLIANCE</span>
            <span>&#8212; No CAS-mapped observations</span>
        </div>`;
        return;
    }

    const gc = cachedGcResult;
    const scoreColor =
        gc.score >= 4
            ? 'var(--eis-green,#22c55e)'
            : gc.score >= 3
              ? 'var(--eis-yellow,#eab308)'
              : 'var(--eis-red,#ef4444)';
    const dots = Array.from(
        { length: 5 },
        (_, i) =>
            `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${i < gc.score ? scoreColor : 'rgba(255,255,255,0.15)'};margin-right:2px;"></span>`,
    ).join('');

    let detailRows = '';
    const { JURISDICTIONS: jurisdictions } = window.__ecbyts_gc_jurisdictions || {};
    if (gc.jurisdictionResults) {
        for (const [jId, jr] of Object.entries(gc.jurisdictionResults)) {
            if (jr.total === 0) continue;
            const statusIcon = jr.sitePass ? '&#10003;' : '&#10007;';
            const statusColor = jr.sitePass ? 'var(--eis-green,#22c55e)' : 'var(--eis-red,#ef4444)';
            const failedText =
                jr.failedSubstances.length > 0
                    ? jr.failedSubstances
                          .map((cas) => {
                              const sub = gc.substanceResults?.[cas]?.[jId];
                              const param = CONFIG.PARAMETERS.find((p) => p.casNumber === cas);
                              const name = param ? param.name || param.id : cas;
                              return sub ? `${name} (${sub.value.toFixed(1)} > ${sub.threshold} ${sub.unit})` : name;
                          })
                          .join(', ')
                    : '&#8212;';
            const jName = jId.replace('_', ' ');
            detailRows += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:3px 6px;font-size:11px;">${jName}</td>
                <td style="padding:3px 6px;color:${statusColor};font-size:12px;">${statusIcon} ${jr.sitePass ? 'PASS' : 'FAIL'}</td>
                <td style="padding:3px 6px;font-size:11px;color:var(--eis-muted,rgba(255,255,255,0.5));">${failedText}</td>
            </tr>`;
        }
    }

    gcEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-weight:600;font-size:12px;color:var(--eis-text,rgba(255,255,255,0.87));">GLOBAL COMPLIANCE</span>
            <span style="font-size:11px;color:var(--eis-muted);">AUTO</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
            <span>${dots}</span>
            <span style="font-size:14px;font-weight:700;color:${scoreColor};">${gc.score}.0 / 5.0</span>
            <span style="font-size:11px;color:var(--eis-muted);">${gc.passedJurisdictions} / ${gc.totalJurisdictions} jurisdictions pass</span>
        </div>
        <div style="font-size:11px;color:var(--eis-muted);margin-bottom:6px;">${gc.verdict} &#8226; ${gc.assessedSubstances} substance(s) assessed</div>
        <details style="margin-top:4px;">
            <summary style="cursor:pointer;font-size:11px;color:var(--eis-accent,#6366f1);">Details</summary>
            <table style="width:100%;border-collapse:collapse;margin-top:6px;">
                <thead><tr>
                    <th style="text-align:left;padding:3px 6px;font-size:10px;color:var(--eis-muted);">Jurisdiction</th>
                    <th style="text-align:left;padding:3px 6px;font-size:10px;color:var(--eis-muted);">Status</th>
                    <th style="text-align:left;padding:3px 6px;font-size:10px;color:var(--eis-muted);">Failed Substances</th>
                </tr></thead>
                <tbody>${detailRows}</tbody>
            </table>
        </details>
        <div style="margin-top:8px;font-size:10px;color:var(--eis-muted);font-style:italic;">Informational only — not legal advice</div>
    `;
}

/**
 * Close the EIS dashboard modal.
 * Fecha o modal e destroi a instância do Chart.js para evitar leaks.
 */
/**
 * Refresh EIS dashboard data without closing the modal.
 * Recomputa todos os caches e re-renderiza.
 */
function handleRefreshEisDashboard() {
    const elements = getAllElements();
    const allObs = collectAllObservations();
    cachedAllObs = allObs;
    const campaigns = getAllCampaigns();

    cachedCredInfo = EisCalculator.computeAggregateCredential(allObs);

    const campaignStats = campaigns.map((c) => getCampaignCompleteness(c.id, elements));
    cachedCampaignDetails = campaignStats;
    cachedCpResult = EisCalculator.computeCpFromCampaigns(campaignStats);
    cachedAutoResults.Cp = cachedCpResult;
    cachedAutoResults.T = EisCalculator.computeTFromObservations(allObs);
    cachedAutoResults.A = EisCalculator.computeAFromModel(elements, allObs);
    cachedAutoResults.Ty = EisCalculator.computeTyFromObservations(allObs);
    cachedAutoResults.Cs = EisCalculator.computeCsFromObservations(allObs, UNITS);
    cachedAutoResults.Cm = EisCalculator.computeCmFromObservations(allObs, CONFIG.PARAMETERS);

    for (const axis of EIS_AXES) {
        autoEnabled[axis] = cachedAutoResults[axis] != null;
    }

    _barsSliderDragging = false;
    recalculate();
    updateEisStatusBadge();
}

function handleCloseEisDashboard() {
    const modal = document.getElementById('eis-dashboard-modal');
    if (modal) modal.classList.remove('active');
    destroyRadarChart();
    cleanupRingInteraction();
    cachedCredInfo = null;
    cachedCpResult = null;
    _lastResult = null;
    _lastScores = null;
    // Reset scale strip state for full re-render on next open
    _scaleStripMarker = null;
    _scaleStripValue = null;
    _scaleStripInitialized = false;
    for (const axis of EIS_AXES) {
        cachedAutoResults[axis] = null;
    }
}

/**
 * Handle click on modal overlay to close.
 * Fecha se o clique foi no overlay (não no conteúdo do modal).
 * @param {MouseEvent} e
 */
function handleEisOverlayClick(e) {
    if (e.target.id === 'eis-dashboard-modal') {
        handleCloseEisDashboard();
    }
}

/**
 * Handle mode toggle between geometric and veto.
 * Alterna o modo de cálculo e recalcula imediatamente.
 * @param {'geometric'|'veto'} mode
 */
function handleEisModeChange(mode) {
    currentMode = mode;
    const btns = document.querySelectorAll('.eis-mode-btn');
    btns.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Alterna entre UI padrão e custom
    const standardSection = document.getElementById('eis-standard-section');
    const customSection = document.getElementById('eis-custom-section');
    if (mode === 'custom') {
        if (standardSection) standardSection.style.display = 'none';
        if (customSection) customSection.style.display = '';
        renderCustomModeUI();
    } else {
        if (standardSection) standardSection.style.display = '';
        if (customSection) customSection.style.display = 'none';
    }

    recalculate();
    updateEisStatusBadge();
}

/**
 * Handle slider input for any axis.
 * Atualiza o valor exibido e recalcula em tempo real.
 * @param {string} axis - Eixo que mudou (T, A, Cp, Ty, Cs, Cm)
 */
function handleEisSliderInput(axis) {
    const slider = document.getElementById(`eis-slider-${axis}`);
    const valueEl = document.getElementById(`eis-value-${axis}`);
    if (slider && valueEl) {
        valueEl.textContent = slider.value;
    }
    recalculate();
    updateEisStatusBadge();
}

/**
 * Reset all sliders to default value (3).
 * Reseta todos os eixos para 3 e recalcula.
 */
function handleEisResetDefaults() {
    for (const axis of EIS_AXES) {
        // Eixos em AUTO não resetam
        if (autoEnabled[axis] && cachedAutoResults[axis]) continue;
        const slider = document.getElementById(`eis-slider-${axis}`);
        const valueEl = document.getElementById(`eis-value-${axis}`);
        if (slider) slider.value = 3;
        if (valueEl) valueEl.textContent = '3';
    }
    currentMode = 'geometric';

    const btns = document.querySelectorAll('.eis-mode-btn');
    btns.forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === 'geometric'));

    const standardSection = document.getElementById('eis-standard-section');
    const customSection = document.getElementById('eis-custom-section');
    if (standardSection) standardSection.style.display = '';
    if (customSection) customSection.style.display = 'none';

    recalculate();
    updateEisStatusBadge();
}

// ================================================================
// PRIVATE — DATA COLLECTION
// Coleta observações de todos os elementos do modelo
// ================================================================

/**
 * Collect all observations from all elements in the current model.
 * Coleta todas as observações de todos os elementos para cálculo agregado.
 * @returns {Array<Object>}
 */
function collectAllObservations() {
    const elements = getAllElements();
    const allObs = [];
    for (const el of elements) {
        if (Array.isArray(el?.data?.observations)) {
            for (const obs of el.data.observations) {
                allObs.push({ ...obs, _elementId: el.id, _elementName: el.data?.name || el.id });
            }
        }
    }
    return allObs;
}

// ================================================================
// PRIVATE — CALCULATION & UI UPDATE
// Recálculo central que atualiza gauge, radar e veredito
// ================================================================

/**
 * Read slider values, calculate EIS, and update all UI elements.
 * Suporta modos geometric/veto (com AUTO/MANUAL por eixo) e custom.
 */
function recalculate() {
    // ── Modo Custom: cálculo separado ──
    if (currentMode === 'custom') {
        recalculateCustom();
        return;
    }

    // ── Modos geometric/veto ──
    const scores = {};
    for (const axis of EIS_AXES) {
        const autoResult = cachedAutoResults[axis];
        if (autoEnabled[axis] && autoResult) {
            scores[axis] = autoResult.score;
        } else {
            // Read from inline slider bar (primary) or hidden standard slider (fallback)
            const inlineSlider = document.querySelector(`.eis-contrib-slider[data-axis="${axis}"]`);
            const stdSlider = document.getElementById(`eis-slider-${axis}`);
            scores[axis] = inlineSlider
                ? parseInt(inlineSlider.value, 10)
                : stdSlider
                  ? parseInt(stdSlider.value, 10)
                  : 3;
        }
    }

    try {
        const credMultiplier = cachedCredInfo ? cachedCredInfo.multiplier : 1.0;
        const result = calculator.calculate(scores, currentMode, 'common', credMultiplier);
        _lastResult = result;
        _lastScores = { ...scores };
        renderRingChart(
            result.eis,
            result.adjustedScores,
            calculator.weights,
            result.verdict,
            result.vetoed === true,
            EIS_AXES,
        );
        renderContributionBars(result.adjustedScores, calculator.weights, EIS_AXES);
        updateVerdict(result);
        updateCredentialInfo(cachedCredInfo);
        // F2: Update expanded detail card if open
        if (_expandedAxis) renderAxisDetail(_expandedAxis);
        // F3: Update improvement priorities
        renderImprovementList(scores, calculator.weights, credMultiplier, EIS_AXES);
    } catch (err) {
        console.error('[EIS Dashboard]', err.message);
    }
}

/**
 * Aplica badge AUTO no slider de um eixo.
 * @param {string} axis
 * @param {Object} autoResult
 */
function applyAutoBadge(axis, autoResult) {
    const slider = document.getElementById(`eis-slider-${axis}`);
    const valueEl = document.getElementById(`eis-value-${axis}`);
    if (slider) {
        slider.value = Math.round(autoResult.score);
        slider.disabled = true;
    }
    if (valueEl) {
        const tooltip = buildAutoTooltip(axis, autoResult);
        valueEl.innerHTML = `${Math.round(autoResult.score)} <span class="eis-auto-badge" title="${tooltip}">${t('eis.auto') || 'AUTO'}</span>`;
    }
}

/**
 * Remove badge AUTO de um eixo (modo manual).
 * @param {string} axis
 */
function clearAutoBadge(axis) {
    const slider = document.getElementById(`eis-slider-${axis}`);
    const valueEl = document.getElementById(`eis-value-${axis}`);
    if (slider) slider.disabled = false;
    if (valueEl && valueEl.querySelector('.eis-auto-badge')) {
        valueEl.textContent = slider ? slider.value : '3';
    }
}

/**
 * Constrói tooltip descritivo para badge AUTO de cada eixo.
 * @param {string} axis
 * @param {Object} result
 * @returns {string}
 */
function buildAutoTooltip(axis, result) {
    switch (axis) {
        case 'T':
            return `${t('eis.auto') || 'Auto'}: ${result.aggregateMultiplier?.toFixed(2) || '1.00'}× | ${Math.round((result.tracedRatio || 0) * 100)}% ${t('eis.traced') || 'traced'}`;
        case 'A':
            if (result.method === 'sensor') {
                return `${t('eis.auto') || 'Auto'}: ${result.sensorsOperational}/${result.sensorsTotal} ${t('eis.sensors_operational') || 'operational'}`;
            }
            return `${t('eis.auto') || 'Auto'}: ${Math.round((result.validationRatio || 0) * 100)}% ${t('eis.within_limits') || 'within limits'}`;
        case 'Cp':
            return `${t('eis.auto') || 'Auto'}: ${result.totalExecuted || 0}/${result.totalPlanned || 0} (${Math.round((result.ratio || 0) * 100)}%)`;
        case 'Ty':
            return `${t('eis.auto') || 'Auto'}: ${t('eis.median_age') || 'median'} ${result.medianAgeDays?.toFixed(0) || '?'}d`;
        case 'Cs':
            return `${t('eis.auto') || 'Auto'}: ${result.standardCount || 0}/${result.totalCount || 0} (${Math.round((result.ratio || 0) * 100)}%)`;
        case 'Cm':
            return `${t('eis.auto') || 'Auto'}: ${result.mappedCount || 0}/${result.totalCount || 0} ${t('eis.mapped') || 'mapped'}`;
        default:
            return t('eis.auto') || 'Auto';
    }
}

/**
 * Recálculo para modo Custom.
 * Lê sliders dinâmicos dos eixos custom e calcula via calculateCustom().
 */
function recalculateCustom() {
    if (!activeCustomProfile || !activeCustomProfile.axes || activeCustomProfile.axes.length < 2) {
        renderRingChart(0, {}, {}, '', false);
        renderContributionBars({}, {});
        return;
    }

    const axisScores = {};
    const axisWeights = {};
    const axisOrder = [];
    for (const ax of activeCustomProfile.axes) {
        const slider = document.getElementById(`eis-custom-slider-${ax.id}`);
        axisScores[ax.id] = slider ? parseInt(slider.value, 10) : 3;
        axisWeights[ax.id] = ax.weight;
        axisOrder.push(ax.id);
    }

    try {
        const result = calculator.calculateCustom(axisScores, axisWeights);
        renderRingChart(result.eis, axisScores, axisWeights, result.verdict, false, axisOrder);
        renderContributionBars(axisScores, axisWeights, axisOrder);
        updateVerdict(result);
    } catch (err) {
        console.error('[EIS Custom]', err.message);
    }
}

/**
 * Update the verdict badge display.
 * Atualiza o badge de veredito com cor, emoji e descrição.
 * @param {import('../../core/eis/eisCalculator.js').EisResult} result
 */
function updateVerdict(result) {
    const badge = document.getElementById('eis-verdict-badge');
    const desc = document.getElementById('eis-verdict-desc');
    const vetoBadge = document.getElementById('eis-vetoed-badge');

    if (badge) {
        badge.textContent = result.verdict;
        badge.className = 'eis-verdict-badge ' + getVerdictClass(result.eis);
    }

    if (desc) {
        const verdictObj = getVerdictObject(result.eis);
        desc.textContent = verdictObj ? verdictObj.desc : '';
    }

    if (vetoBadge) {
        vetoBadge.classList.toggle('visible', result.vetoed === true);
    }
}

/**
 * Update the credential info display (read-only, computed from data).
 * Renderiza o multiplicador agregado, contagem e breakdown por nível.
 * @param {{ multiplier: number, count: number, breakdown: Object }|null} credInfo
 */
function updateCredentialInfo(credInfo) {
    const container = document.getElementById('eis-credential-info');
    if (!container) return;

    if (!credInfo || credInfo.count === 0) {
        container.innerHTML = `
            <span class="eis-cred-mult">1.00×</span>
            <span class="eis-cred-count">${t('eis.credential_none') || 'No readings'}</span>
        `;
        return;
    }

    // Monta string de breakdown por nível
    const parts = [];
    for (const [level, count] of Object.entries(credInfo.breakdown)) {
        const label = EIS_CREDENTIAL_LABELS[level] || level;
        parts.push(`${count} ${label}`);
    }

    container.innerHTML = `
        <span class="eis-cred-mult">${credInfo.multiplier.toFixed(2)}×</span>
        <span class="eis-cred-count">${credInfo.count} ${t('eis.readings') || 'readings'}</span>
        <span class="eis-cred-breakdown">${parts.join(' · ')}</span>
    `;
}

// ================================================================
// PRIVATE — STANDARD SLIDERS (AUTO/MANUAL TOGGLE)
// Renderiza sliders com toggle por eixo
// ================================================================

/**
 * Renderiza os sliders padrão com botão toggle AUTO/MANUAL por eixo.
 * Substitui o conteúdo do container de sliders.
 */
function renderStandardSliders() {
    const container = document.getElementById('eis-sliders-container');
    if (!container) return;

    let html = '';
    for (const axis of EIS_AXES) {
        const meta = AXIS_META[axis];
        const label = t(meta.key) || meta.fallback;
        const weight = EIS_DEFAULT_WEIGHTS[axis];
        const hasAuto = cachedAutoResults[axis] != null;
        const isAuto = autoEnabled[axis] && hasAuto;

        html += `
        <div class="eis-slider-row" data-axis="${axis}">
            <div class="eis-slider-header">
                <span class="eis-slider-label">${axis} — ${label}</span>
                <span class="eis-slider-weight">${t('eis.weight') || 'w'}=${weight}</span>
                ${hasAuto ? `<button class="eis-auto-toggle ${isAuto ? 'active' : ''}" onclick="window.handleEisAutoToggle('${axis}')" title="${isAuto ? t('eis.switch_manual') || 'Switch to Manual' : t('eis.switch_auto') || 'Switch to Auto'}">${isAuto ? 'AUTO' : 'MANUAL'}</button>` : '<span class="eis-auto-toggle disabled">MANUAL</span>'}
            </div>
            <div class="eis-slider-control">
                <input type="range" id="eis-slider-${axis}" min="1" max="5" step="1" value="3"
                    class="eis-slider" ${isAuto ? 'disabled' : ''}
                    oninput="window.handleEisSliderInput('${axis}')">
                <span class="eis-slider-value" id="eis-value-${axis}">3</span>
            </div>
        </div>`;
    }
    container.innerHTML = html;

    // Aplica valores auto onde ativo
    for (const axis of EIS_AXES) {
        if (autoEnabled[axis] && cachedAutoResults[axis]) {
            applyAutoBadge(axis, cachedAutoResults[axis]);
        }
    }
}

/**
 * Toggle AUTO/MANUAL para um eixo.
 * @param {string} axis
 */
function handleEisAutoToggle(axis) {
    if (!cachedAutoResults[axis]) return;

    autoEnabled[axis] = !autoEnabled[axis];

    const btn = document.querySelector(`.eis-slider-row[data-axis="${axis}"] .eis-auto-toggle`);
    if (btn) {
        btn.classList.toggle('active', autoEnabled[axis]);
        btn.textContent = autoEnabled[axis] ? 'AUTO' : 'MANUAL';
        btn.title = autoEnabled[axis]
            ? t('eis.switch_manual') || 'Switch to Manual'
            : t('eis.switch_auto') || 'Switch to Auto';
    }

    recalculate();
    updateEisStatusBadge();
}

// ================================================================
// PRIVATE — CUSTOM MODE UI
// Perfis custom, editor de eixos, sliders dinâmicos
// ================================================================

/**
 * Carrega perfis custom do localStorage.
 */
function loadCustomProfiles() {
    try {
        const raw = localStorage.getItem(CUSTOM_PROFILES_KEY);
        customProfiles = raw ? JSON.parse(raw) : [];
    } catch {
        customProfiles = [];
    }
}

/**
 * Salva perfis custom no localStorage.
 */
function saveCustomProfiles() {
    safeSetItem(CUSTOM_PROFILES_KEY, JSON.stringify(customProfiles));
}

/**
 * Renderiza a UI completa do modo custom.
 */
function renderCustomModeUI() {
    const section = document.getElementById('eis-custom-section');
    if (!section) return;

    // Todos os perfis disponíveis: templates + salvos pelo usuário
    const allProfiles = [...EIS_CUSTOM_TEMPLATES, ...customProfiles];

    const profileOptions = allProfiles
        .map(
            (p) =>
                `<option value="${p.id}" ${activeCustomProfile?.id === p.id ? 'selected' : ''}>${p.isTemplate ? '📋 ' : ''}${p.name}</option>`,
        )
        .join('');

    const html = `
    <div class="eis-custom-profiles">
        <div class="eis-custom-profile-bar">
            <select id="eis-custom-profile-select" onchange="window.handleEisCustomProfileSelect(this.value)">
                <option value="">${t('eis.select_profile') || '— Select Profile —'}</option>
                ${profileOptions}
            </select>
            <button class="eis-custom-btn" onclick="window.handleEisCustomNewProfile()" title="${t('eis.new_profile') || 'New'}">+</button>
            <button class="eis-custom-btn" onclick="window.handleEisCustomDuplicateProfile()" title="${t('eis.duplicate') || 'Duplicate'}">⧉</button>
            <button class="eis-custom-btn danger" onclick="window.handleEisCustomDeleteProfile()" title="${t('eis.delete') || 'Delete'}">✕</button>
        </div>
    </div>
    <div id="eis-custom-editor"></div>`;

    section.innerHTML = html;

    if (activeCustomProfile) {
        renderCustomEditor();
    }
}

/**
 * Renderiza o editor de eixos do perfil custom ativo.
 */
function renderCustomEditor() {
    const editor = document.getElementById('eis-custom-editor');
    if (!editor || !activeCustomProfile) {
        if (editor)
            editor.innerHTML = `<p class="eis-custom-empty">${t('eis.no_profile') || 'Select or create a profile to begin.'}</p>`;
        return;
    }

    const isTemplate = activeCustomProfile.isTemplate;
    let html = '';

    // Nome do perfil (editável se não template)
    html += `<div class="eis-custom-name-row">
        <input type="text" id="eis-custom-profile-name" value="${activeCustomProfile.name}"
            ${isTemplate ? 'disabled' : ''}
            onchange="window.handleEisCustomRenameProfile(this.value)"
            placeholder="${t('eis.profile_name') || 'Profile name'}">
    </div>`;

    // Eixos
    html += '<div class="eis-custom-axes">';
    for (let i = 0; i < activeCustomProfile.axes.length; i++) {
        const ax = activeCustomProfile.axes[i];
        html += `
        <div class="eis-custom-axis-row" data-index="${i}">
            <div class="eis-custom-axis-header">
                <input type="text" class="eis-custom-axis-name" value="${ax.name}"
                    ${isTemplate ? 'disabled' : ''}
                    onchange="window.handleEisCustomAxisEdit(${i}, 'name', this.value)"
                    placeholder="${t('eis.axis_name') || 'Axis name'}">
                <label class="eis-custom-weight-label">${t('eis.weight') || 'w'}=
                    <input type="number" class="eis-custom-axis-weight" min="1" max="5" value="${ax.weight}"
                        ${isTemplate ? 'disabled' : ''}
                        onchange="window.handleEisCustomAxisEdit(${i}, 'weight', this.value)">
                </label>
                ${!isTemplate ? `<button class="eis-custom-btn danger small" onclick="window.handleEisCustomRemoveAxis(${i})">✕</button>` : ''}
            </div>
            ${ax.description ? `<div class="eis-custom-axis-desc">${ax.description}</div>` : ''}
            ${ax.benchmark ? `<div class="eis-custom-axis-benchmark">${t('eis.benchmark') || 'Ref'}: ${ax.benchmark.reference} ${ax.benchmark.unit} (${ax.benchmark.source})</div>` : ''}
            <div class="eis-slider-control">
                <input type="range" id="eis-custom-slider-${ax.id}" min="1" max="5" step="1" value="3"
                    class="eis-slider" oninput="window.handleEisCustomSliderInput('${ax.id}')">
                <span class="eis-slider-value" id="eis-custom-value-${ax.id}">3</span>
            </div>
        </div>`;
    }
    html += '</div>';

    // Botão adicionar eixo (se não template e < 12 eixos)
    if (!isTemplate && activeCustomProfile.axes.length < 12) {
        html += `<button class="eis-custom-btn add-axis" onclick="window.handleEisCustomAddAxis()">+ ${t('eis.add_axis') || 'Add Axis'}</button>`;
    }

    // Botão salvar (se não template)
    if (!isTemplate) {
        html += `<button class="eis-custom-btn save" onclick="window.handleEisCustomSaveProfile()">💾 ${t('eis.save') || 'Save'}</button>`;
    }

    editor.innerHTML = html;
}

/**
 * Seleciona um perfil custom pelo ID.
 * @param {string} profileId
 */
function handleEisCustomProfileSelect(profileId) {
    if (!profileId) {
        activeCustomProfile = null;
        renderCustomEditor();
        recalculate();
        return;
    }

    const allProfiles = [...EIS_CUSTOM_TEMPLATES, ...customProfiles];
    const profile = allProfiles.find((p) => p.id === profileId);
    if (profile) {
        // Deep clone para não mutar template/original
        activeCustomProfile = JSON.parse(JSON.stringify(profile));
        renderCustomEditor();
        recalculate();
    }
}

/**
 * Cria novo perfil custom vazio com 3 eixos default.
 */
function handleEisCustomNewProfile() {
    const id = 'custom_' + Date.now().toString(36);
    activeCustomProfile = {
        id,
        name: t('eis.new_profile_name') || 'New Profile',
        isTemplate: false,
        axes: [
            { id: id + '_1', name: t('eis.axis_1') || 'Axis 1', weight: 3, description: '' },
            { id: id + '_2', name: t('eis.axis_2') || 'Axis 2', weight: 2, description: '' },
            { id: id + '_3', name: t('eis.axis_3') || 'Axis 3', weight: 1, description: '' },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    customProfiles.push(activeCustomProfile);
    saveCustomProfiles();
    renderCustomModeUI();
    recalculate();
}

/**
 * Duplica o perfil ativo como novo perfil editável.
 */
function handleEisCustomDuplicateProfile() {
    if (!activeCustomProfile) return;

    const id = 'custom_' + Date.now().toString(36);
    const duplicate = JSON.parse(JSON.stringify(activeCustomProfile));
    duplicate.id = id;
    duplicate.name = duplicate.name + ' (copy)';
    duplicate.isTemplate = false;
    duplicate.createdAt = new Date().toISOString();
    duplicate.updatedAt = new Date().toISOString();

    // Regenera IDs dos eixos
    duplicate.axes.forEach((ax, i) => {
        ax.id = id + '_' + i;
    });

    customProfiles.push(duplicate);
    activeCustomProfile = duplicate;
    saveCustomProfiles();
    renderCustomModeUI();
    recalculate();
}

/**
 * Deleta o perfil custom ativo (não permite deletar templates).
 */
function handleEisCustomDeleteProfile() {
    if (!activeCustomProfile || activeCustomProfile.isTemplate) return;

    customProfiles = customProfiles.filter((p) => p.id !== activeCustomProfile.id);
    activeCustomProfile = null;
    saveCustomProfiles();
    renderCustomModeUI();
    recalculate();
}

/**
 * Renomeia o perfil custom ativo.
 * @param {string} name
 */
function handleEisCustomRenameProfile(name) {
    if (!activeCustomProfile || activeCustomProfile.isTemplate) return;
    activeCustomProfile.name = name;
    activeCustomProfile.updatedAt = new Date().toISOString();
}

/**
 * Edita uma propriedade de um eixo custom.
 * @param {number} index
 * @param {string} prop - 'name' ou 'weight'
 * @param {string} value
 */
function handleEisCustomAxisEdit(index, prop, value) {
    if (!activeCustomProfile || activeCustomProfile.isTemplate) return;
    const ax = activeCustomProfile.axes[index];
    if (!ax) return;
    if (prop === 'weight') {
        ax.weight = Math.max(1, Math.min(5, parseInt(value, 10) || 1));
    } else {
        ax[prop] = value;
    }
    activeCustomProfile.updatedAt = new Date().toISOString();
    recalculate();
}

/**
 * Adiciona novo eixo ao perfil custom ativo.
 */
function handleEisCustomAddAxis() {
    if (!activeCustomProfile || activeCustomProfile.isTemplate) return;
    if (activeCustomProfile.axes.length >= 12) return;

    const id = activeCustomProfile.id + '_' + Date.now().toString(36);
    const n = activeCustomProfile.axes.length + 1;
    activeCustomProfile.axes.push({
        id,
        name: `${t('eis.axis') || 'Axis'} ${n}`,
        weight: 1,
        description: '',
    });
    activeCustomProfile.updatedAt = new Date().toISOString();
    renderCustomEditor();
    recalculate();
}

/**
 * Remove um eixo do perfil custom (mín 2).
 * @param {number} index
 */
function handleEisCustomRemoveAxis(index) {
    if (!activeCustomProfile || activeCustomProfile.isTemplate) return;
    if (activeCustomProfile.axes.length <= 2) return;

    activeCustomProfile.axes.splice(index, 1);
    activeCustomProfile.updatedAt = new Date().toISOString();
    renderCustomEditor();
    recalculate();
}

/**
 * Handler de slider custom individual.
 * @param {string} axisId
 */
function handleEisCustomSliderInput(axisId) {
    const slider = document.getElementById(`eis-custom-slider-${axisId}`);
    const valueEl = document.getElementById(`eis-custom-value-${axisId}`);
    if (slider && valueEl) valueEl.textContent = slider.value;
    recalculate();
    updateEisStatusBadge();
}

/**
 * Salva perfil custom ativo no localStorage.
 */
function handleEisCustomSaveProfile() {
    if (!activeCustomProfile || activeCustomProfile.isTemplate) return;

    activeCustomProfile.updatedAt = new Date().toISOString();
    const idx = customProfiles.findIndex((p) => p.id === activeCustomProfile.id);
    if (idx >= 0) {
        customProfiles[idx] = JSON.parse(JSON.stringify(activeCustomProfile));
    } else {
        customProfiles.push(JSON.parse(JSON.stringify(activeCustomProfile)));
    }
    saveCustomProfiles();
}

/**
 * Atualiza radar Chart.js para eixos custom (recria labels).
 * @param {Object} result - Resultado de calculateCustom()
 */
function updateRadarChartCustom(result) {
    if (!radarChart) return;

    const axes = activeCustomProfile?.axes || [];
    const labels = axes.map((ax) => ax.name);
    const data = axes.map((ax) => result.scores[ax.id] || 3);

    radarChart.data.labels = labels;
    radarChart.data.datasets[0].data = data;

    const color = getVerdictColor(result.eis);
    radarChart.data.datasets[0].borderColor = color;
    radarChart.data.datasets[0].backgroundColor = color.replace(')', ', 0.12)').replace('rgb', 'rgba');
    radarChart.data.datasets[0].pointBackgroundColor = color;

    radarChart.update('none');
}

// ================================================================
// PRIVATE — RADAR CHART (Chart.js)
// Gráfico radar com os 6 eixos TCCCA+T
// ================================================================

/**
 * Initialize the Chart.js radar chart.
 * Cria o gráfico radar se Chart.js estiver disponível.
 */
function initRadarChart() {
    if (typeof Chart === 'undefined') {
        console.warn('[EIS] Chart.js not loaded — radar chart disabled.');
        return;
    }

    destroyRadarChart();

    const canvas = document.getElementById('eis-radar-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    radarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: EIS_AXES.map((a) => a),
            datasets: [
                {
                    label: 'EIS',
                    data: EIS_AXES.map(() => 3),
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    borderColor: 'rgba(99, 102, 241, 0.7)',
                    borderWidth: 2,
                    pointBackgroundColor: '#6366f1',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 1,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
            },
            scales: {
                r: {
                    min: 0,
                    max: 5,
                    ticks: {
                        stepSize: 1,
                        color: 'rgba(255,255,255,0.35)',
                        backdropColor: 'transparent',
                        font: { size: 10 },
                    },
                    grid: {
                        color: 'rgba(255,255,255,0.06)',
                    },
                    angleLines: {
                        color: 'rgba(255,255,255,0.08)',
                    },
                    pointLabels: {
                        color: 'rgba(255,255,255,0.7)',
                        font: { size: 12, weight: '600' },
                    },
                },
            },
            animation: {
                duration: 400,
            },
        },
    });
}

/**
 * Update radar chart data with new scores.
 * Atualiza os dados do radar e muda a cor conforme o veredito.
 * @param {Object.<string, number>} adjustedScores
 */
function updateRadarChart(adjustedScores) {
    if (!radarChart) return;

    const data = EIS_AXES.map((axis) => adjustedScores[axis]);
    radarChart.data.datasets[0].data = data;

    const avg = data.reduce((s, v) => s + v, 0) / data.length;
    const color = getVerdictColor(avg);
    radarChart.data.datasets[0].borderColor = color;
    radarChart.data.datasets[0].backgroundColor = color.replace(')', ', 0.12)').replace('rgb', 'rgba');
    radarChart.data.datasets[0].pointBackgroundColor = color;

    radarChart.update('none');
}

/**
 * Destroy the radar chart instance.
 * Limpa a instância para evitar memory leaks.
 */
function destroyRadarChart() {
    if (radarChart) {
        radarChart.destroy();
        radarChart = null;
    }
}

// ================================================================
// PRIVATE — F1: RING HOVER TOOLTIPS
// Tooltip flutuante ao passar mouse sobre segmentos do ring chart
// ================================================================

/**
 * Hit test nos segmentos do ring chart.
 * @param {number} mx - Mouse X relativo ao canvas
 * @param {number} my - Mouse Y relativo ao canvas
 * @returns {{ axis: string, segment: Object }|null}
 */
function ringHitTest(mx, my) {
    for (let i = ringSegments.length - 1; i >= 0; i--) {
        const s = ringSegments[i];
        const dx = mx - s.cx,
            dy = my - s.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < s.innerR || dist > s.outerR) continue;
        let ang = Math.atan2(dy, dx);
        // Normalize angle to segment range
        while (ang < s.startAngle - 0.01) ang += Math.PI * 2;
        while (ang > s.startAngle + Math.PI * 2 + 0.01) ang -= Math.PI * 2;
        if (ang >= s.startAngle - 0.01 && ang <= s.endAngle + 0.01) {
            return { axis: s.axis, segment: s };
        }
    }
    return null;
}

/**
 * Inicializa listeners de interação no canvas do ring chart.
 * Chamado uma vez em handleOpenEisDashboard.
 */
function initRingInteraction() {
    const canvas = document.getElementById('eis-ring-canvas');
    if (!canvas || _ringListenersAttached) return;

    canvas.style.cursor = 'pointer';

    canvas.addEventListener('mousemove', _onRingMouseMove);
    canvas.addEventListener('mouseleave', _onRingMouseLeave);
    canvas.addEventListener('click', _onRingClick);
    _ringListenersAttached = true;

    // Expose for improvement list onclick
    window._eisExpandAxis = (axis) => {
        _expandedAxis = _expandedAxis === axis ? null : axis;
        renderAxisDetail(_expandedAxis);
    };

    // Expose for inline slider bars
    window._eisBarSliderInput = (axis, value) => {
        const v = parseInt(value, 10);
        if (autoEnabled[axis]) return;
        // Update hidden standard slider if it exists
        const stdSlider = document.getElementById(`eis-slider-${axis}`);
        if (stdSlider) stdSlider.value = v;
        recalculate();
        updateEisStatusBadge();
    };
    window._eisBarDragStart = () => {
        _barsSliderDragging = true;
    };
    window._eisBarDragEnd = () => {
        _barsSliderDragging = false;
        recalculate();
    };
    window._eisBarAutoToggle = (axis) => {
        handleEisAutoToggle(axis);
        _barsSliderDragging = false; // Force full rebuild
        recalculate();
    };

    // Drill-down actions: navigate to problematic elements
    window._eisGoToElement = (elementId) => {
        if (!elementId) return;
        // 1. Select element (highlights 3D mesh, updates UI)
        if (typeof window.handleSelectElement === 'function') {
            window.handleSelectElement(elementId);
        }
        // 2. Zoom camera to element
        if (typeof window.handleZoomToElement === 'function') {
            window.handleZoomToElement(elementId);
        }
        // 3. Ensure right panel is visible + switch to elements tab
        if (typeof window.restorePanel === 'function') {
            window.restorePanel('properties', 'elements');
        }
    };

    window._eisOpenDataEntry = (campaignId, elementId) => {
        if (typeof window.handleOpenDataEntryMatrix === 'function') {
            window.handleOpenDataEntryMatrix({ campaignId, elementId });
        }
    };
}

function _onRingMouseMove(e) {
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = parseInt(canvas.dataset.logicalW || canvas.width) / rect.width;
    const scaleY = parseInt(canvas.dataset.logicalH || canvas.height) / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    const hit = ringHitTest(mx, my);
    const tooltip = document.getElementById('eis-ring-tooltip');
    if (!tooltip) return;

    if (hit) {
        const axis = hit.axis;
        if (_ringHoverAxis !== axis) {
            _ringHoverAxis = axis;
            const meta = AXIS_META[axis];
            const label = meta ? t(meta.key) || meta.fallback : axis;
            const score = _lastResult?.adjustedScores?.[axis] ?? _lastScores?.[axis] ?? '?';
            const weight = calculator.weights[axis] ?? '?';
            const totalW = Object.values(calculator.weights).reduce((s, w) => s + w, 0);
            const pct = totalW > 0 ? Math.round((weight / totalW) * 100) : 0;
            const autoResult = cachedAutoResults[axis];
            const isAuto = autoEnabled[axis] && autoResult;
            const source = isAuto ? buildAutoTooltip(axis, autoResult) : t('eis.source_manual') || 'Manual';

            tooltip.innerHTML =
                `<b>${axis} — ${label}</b><br>` +
                `Score: <b style="color:${scoreToColor(score)}">${typeof score === 'number' ? score.toFixed(1) : score}</b> (${source})<br>` +
                `${t('eis.weight') || 'w'}=${weight}/${totalW} (${pct}%)<br>` +
                `<span class="eis-tip-hint">${t('eis.click_details') || 'Click for details'}</span>`;
        }
        tooltip.style.display = 'block';
        tooltip.style.left = e.clientX + 14 + 'px';
        tooltip.style.top = e.clientY - 10 + 'px';
    } else {
        _ringHoverAxis = null;
        tooltip.style.display = 'none';
    }
}

function _onRingMouseLeave() {
    _ringHoverAxis = null;
    const tooltip = document.getElementById('eis-ring-tooltip');
    if (tooltip) tooltip.style.display = 'none';
}

function _onRingClick(e) {
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = parseInt(canvas.dataset.logicalW || canvas.width) / rect.width;
    const scaleY = parseInt(canvas.dataset.logicalH || canvas.height) / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    const hit = ringHitTest(mx, my);
    if (hit) {
        // Toggle: click same axis closes, different opens
        if (_expandedAxis === hit.axis) {
            _expandedAxis = null;
        } else {
            _expandedAxis = hit.axis;
        }
        renderAxisDetail(_expandedAxis);
    }
}

/**
 * Cleanup ring interaction listeners.
 * Chamado em handleCloseEisDashboard.
 */
function cleanupRingInteraction() {
    const canvas = document.getElementById('eis-ring-canvas');
    if (canvas) {
        canvas.removeEventListener('mousemove', _onRingMouseMove);
        canvas.removeEventListener('mouseleave', _onRingMouseLeave);
        canvas.removeEventListener('click', _onRingClick);
    }
    _ringListenersAttached = false;
    _ringHoverAxis = null;
    _expandedAxis = null;
}

// ================================================================
// PRIVATE — F2: AXIS DETAIL CARD
// Card expandível com breakdown do eixo (sub-componentes + what-if)
// ================================================================

/**
 * Render axis detail card. Se axis===null, limpa o container.
 * @param {string|null} axis
 */
function renderAxisDetail(axis) {
    const container = document.getElementById('eis-axis-detail');
    if (!container) return;

    if (!axis || currentMode === 'custom') {
        container.innerHTML = '';
        return;
    }

    const meta = AXIS_META[axis];
    const label = meta ? t(meta.key) || meta.fallback : axis;
    const descKey = `eis.axis_${axis}_desc`;
    const desc = t(descKey) || '';
    const score = _lastResult?.adjustedScores?.[axis] ?? _lastScores?.[axis] ?? 3;
    const weight = calculator.weights[axis] || 1;
    const totalW = Object.values(calculator.weights).reduce((s, w) => s + w, 0);
    const autoResult = cachedAutoResults[axis];
    const isAuto = autoEnabled[axis] && autoResult;
    const scoreCol = scoreToColor(score);

    // Source info
    let sourceHTML = '';
    if (isAuto) {
        sourceHTML = `<span style="color:var(--eis-accent)">${t('eis.source_auto') || 'AUTO'}</span>: ${buildAutoTooltip(axis, autoResult)}`;
    } else {
        sourceHTML = `${t('eis.source_manual') || 'Manual'}: ${typeof score === 'number' ? score.toFixed(1) : score}`;
    }

    // Sub-component icicle bars
    let barsHTML = '';
    if (isAuto && autoResult) {
        const bars = _getAxisSubBars(axis, autoResult);
        for (const bar of bars) {
            const fillPct = Math.min(100, Math.max(0, bar.value * 100));
            const fillCol = scoreToColor(fillPct / 20); // map 0-100% to 0-5
            barsHTML += `
            <div class="eis-axis-detail-bar">
                <span class="eis-axis-detail-bar-label">${bar.label}</span>
                <div class="eis-axis-detail-bar-track">
                    <div class="eis-axis-detail-bar-fill" style="width:${fillPct}%;background:${fillCol}"></div>
                </div>
                <span class="eis-axis-detail-bar-value">${bar.display}</span>
            </div>`;
        }
    }

    // What-if
    let whatIfHTML = '';
    if (_lastScores) {
        const credMult = cachedCredInfo ? cachedCredInfo.multiplier : 1.0;
        const impact = EisCalculator.computeImpactIfImproved(
            _lastScores,
            calculator.weights,
            axis,
            credMult,
            currentMode,
        );
        if (impact.delta > 0) {
            whatIfHTML = `
            <div class="eis-axis-detail-whatif">
                ${t('eis.what_if') || 'If improved to'} <b>${impact.targetScore.toFixed(1)}</b>
                &#8594; ${t('eis.eis_changes') || 'EIS changes to'} <b>${impact.projectedEIS.toFixed(2)}</b>
                (<span class="delta">+${impact.delta.toFixed(2)}</span>)
            </div>`;
        }
    }

    // Data Issues section — drill-down to problematic items
    let problemsHTML = '';
    if (isAuto && cachedAllObs) {
        const elements = getAllElements();
        const { problems, fixCount } = EisCalculator.collectAxisProblems(
            axis,
            cachedAllObs,
            elements,
            cachedCampaignDetails,
            UNITS,
            CONFIG.PARAMETERS,
        );
        if (fixCount > 0) {
            const maxShow = 15;
            const shown = problems.slice(0, maxShow);
            let listHTML = '';
            for (const p of shown) {
                const name = p.elementName || p.elementId || '?';
                const param = p.parameterId ? ` / ${p.parameterId}` : '';
                const fixLabel = t(p.fixKey) || p.fixKey;
                const isCp = axis === 'Cp' && p.campaignId;
                const gotoFn = isCp
                    ? `window._eisOpenDataEntry&&window._eisOpenDataEntry('${p.campaignId}','${p.elementId}')`
                    : `window._eisGoToElement&&window._eisGoToElement('${p.elementId}')`;
                listHTML += `
                <div class="eis-problem-item">
                    <span class="eis-problem-element">${name}${param}</span>
                    <span class="eis-problem-field">${p.current}</span>
                    <span class="eis-problem-fix">${fixLabel}</span>
                    <button class="eis-problem-goto" onclick="${gotoFn}" title="${t('eis.go_to_element') || 'Go'}">&#9654;</button>
                </div>`;
            }
            const showAllBtn =
                fixCount > maxShow
                    ? `<button class="eis-problems-show-all" onclick="this.parentNode.querySelector('.eis-problems-list').style.maxHeight='none';this.remove()">${t('eis.show_all') || 'Show all'} ${fixCount}</button>`
                    : '';
            problemsHTML = `
            <div class="eis-problems-section">
                <div class="eis-problems-header">
                    <span class="eis-problems-count">${fixCount} ${t('eis.issues_count') || 'issues'}</span>
                </div>
                <div class="eis-problems-list">${listHTML}</div>
                ${showAllBtn}
            </div>`;
        }
    } else if (!isAuto) {
        problemsHTML = `<div class="eis-problems-hint">${t('eis.set_auto_hint') || 'Set axis to AUTO to see data issues'}</div>`;
    }

    container.innerHTML = `
    <div class="eis-axis-detail-card">
        <div class="eis-axis-detail-header">
            <span class="eis-axis-detail-abbr">${axis}</span>
            <span class="eis-axis-detail-name">${label}</span>
            <span class="eis-axis-detail-score" style="color:${scoreCol}">${typeof score === 'number' ? score.toFixed(1) : score}</span>
        </div>
        <div class="eis-axis-detail-desc">${desc}</div>
        <div class="eis-axis-detail-source">${sourceHTML}</div>
        ${barsHTML}
        ${whatIfHTML}
        ${problemsHTML}
    </div>`;
}

/**
 * Retorna sub-barras para um eixo baseado nos dados auto.
 * @param {string} axis
 * @param {Object} autoResult
 * @returns {Array<{label:string, value:number, display:string}>}
 */
function _getAxisSubBars(axis, autoResult) {
    switch (axis) {
        case 'T':
            return [
                {
                    label: 'Credential',
                    value: Math.min(1, (autoResult.aggregateMultiplier || 1) / 2),
                    display: `${(autoResult.aggregateMultiplier || 1).toFixed(2)}x`,
                },
                {
                    label: 'Traceability',
                    value: autoResult.tracedRatio || 0,
                    display: `${Math.round((autoResult.tracedRatio || 0) * 100)}%`,
                },
            ];
        case 'A':
            if (autoResult.method === 'sensor') {
                return [
                    {
                        label: 'Operational',
                        value: autoResult.validationRatio || 0,
                        display: `${autoResult.sensorsOperational || 0}/${autoResult.sensorsTotal || 0}`,
                    },
                ];
            }
            return [
                {
                    label: 'Valid obs',
                    value: autoResult.validationRatio || 0,
                    display: `${Math.round((autoResult.validationRatio || 0) * 100)}%`,
                },
            ];
        case 'Cp':
            return [
                {
                    label: 'Exec/Plan',
                    value: autoResult.ratio || 0,
                    display: `${autoResult.totalExecuted || 0}/${autoResult.totalPlanned || 0}`,
                },
            ];
        case 'Ty':
            return [
                {
                    label: 'Median age',
                    value: Math.max(0, 1 - (autoResult.medianAgeDays || 0) / 365),
                    display: `${(autoResult.medianAgeDays || 0).toFixed(0)}d`,
                },
            ];
        case 'Cs':
            return [
                {
                    label: 'SI units',
                    value: autoResult.ratio || 0,
                    display: `${autoResult.standardCount || 0}/${autoResult.totalCount || 0}`,
                },
            ];
        case 'Cm':
            return [
                {
                    label: 'Mapped',
                    value: autoResult.totalCount ? (autoResult.mappedCount || 0) / autoResult.totalCount : 0,
                    display: `${autoResult.mappedCount || 0}/${autoResult.totalCount || 0}`,
                },
            ];
        default:
            return [];
    }
}

// ================================================================
// PRIVATE — F3: IMPROVEMENT PRIORITY LIST
// Top 3 ações ranqueadas por impacto no EIS
// ================================================================

/**
 * Render ranked improvement list showing top 3 most impactful actions.
 * @param {Object.<string, number>} scores
 * @param {Object.<string, number>} weights
 * @param {number} credMult
 * @param {string[]|null} axisOrder
 */
function renderImprovementList(scores, weights, credMult, axisOrder = null) {
    const container = document.getElementById('eis-improve-list');
    if (!container) return;

    if (currentMode === 'custom') {
        container.innerHTML = '';
        return;
    }

    const axes = axisOrder || Object.keys(scores);
    const impacts = [];

    for (const axis of axes) {
        const score = scores[axis] || 3;
        if (score >= 5) continue; // Already max
        const impact = EisCalculator.computeImpactIfImproved(scores, weights, axis, credMult, currentMode);
        if (impact.delta > 0) {
            impacts.push(impact);
        }
    }

    // Sort by delta descending, take top 3
    impacts.sort((a, b) => b.delta - a.delta);
    const top3 = impacts.slice(0, 3);

    if (top3.length === 0) {
        container.innerHTML = '';
        return;
    }

    let html = `<div class="eis-improve-title">${t('eis.improve_title') || 'Priority Improvements'}</div>`;

    for (let i = 0; i < top3.length; i++) {
        const imp = top3[i];
        const meta = AXIS_META[imp.axis];
        const label = meta ? t(meta.key) || meta.fallback : imp.axis;
        const improveKey = `eis.improve_${imp.axis}`;
        const hint = t(improveKey) || '';

        html += `
        <div class="eis-improve-item" onclick="window._eisExpandAxis && window._eisExpandAxis('${imp.axis}')">
            <span class="eis-improve-rank">${i + 1}</span>
            <span class="eis-improve-axis">${imp.axis} — ${label}</span>
            <span class="eis-improve-scores">${imp.currentScore.toFixed(1)} &#9654; ${imp.targetScore.toFixed(1)}</span>
            <span class="eis-improve-delta">+${imp.delta.toFixed(2)}</span>
        </div>`;
        if (hint) {
            html += `<div class="eis-improve-hint">${hint}</div>`;
        }
    }

    container.innerHTML = html;
}

// ================================================================
// PRIVATE — RING CHART
// Donut chart ponderado por eixo, renderizado em Canvas 2D
// ================================================================

/**
 * Render weighted donut ring chart on canvas.
 * Cada segmento = 1 eixo, tamanho proporcional ao peso, cor pelo score.
 * Genérico: funciona com 6 eixos padrão ou N eixos custom.
 * @param {number} eisScore - Score composto (0.00-5.00)
 * @param {Object.<string, number>} scores - Score por eixo
 * @param {Object.<string, number>} weights - Peso por eixo
 * @param {string} verdictLabel - Texto do veredito
 * @param {boolean} vetoed - Se modo veto acionado
 * @param {string[]|null} axisOrder - Ordem dos eixos (null = Object.keys)
 */
function renderRingChart(eisScore, scores, weights, verdictLabel, vetoed, axisOrder = null) {
    const canvas = document.getElementById('eis-ring-canvas');
    if (!canvas) return;

    const { ctx, W, H } = setupHiDPI(canvas);
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;
    const innerR = 75;
    const outerR = 115;
    const refR = 121;
    const PI2 = Math.PI * 2;
    const PIH = Math.PI / 2;
    const startOffset = -PIH; // 12 o'clock

    const axes = axisOrder || Object.keys(scores);
    const totalWeight = axes.reduce((sum, a) => sum + (weights[a] || 1), 0);
    if (!totalWeight || axes.length === 0) return;

    const gapAngle = 0.03;
    const totalGap = gapAngle * axes.length;
    const availableArc = PI2 - totalGap;

    ringSegments = [];
    let angle = startOffset;

    // ── Reference ring (ghost green at max score) ──
    ctx.strokeStyle = 'rgba(5, 150, 105, 0.10)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, refR, 0, PI2);
    ctx.stroke();

    // ── Threshold tick positions (3.50 = 70%, 4.50 = 90% of ring width) ──
    const ringWidth = outerR - innerR;
    const thresh350R = innerR + ringWidth * 0.7;
    const thresh450R = innerR + ringWidth * 0.9;

    // ── Axis segments ──
    for (const axis of axes) {
        const w = weights[axis] || 1;
        const score = scores[axis] || 0;
        const arcSpan = (w / totalWeight) * availableArc;
        const a0 = angle;
        const a1 = angle + arcSpan;
        const midAngle = (a0 + a1) / 2;

        // Segment arc fill
        const color = scoreToColor(score);
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, a0, a1);
        ctx.arc(cx, cy, innerR, a1, a0, true);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Segment border
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Verdict-aligned inner edge
        ctx.beginPath();
        ctx.arc(cx, cy, innerR + 2, a0, a1);
        ctx.strokeStyle = getVerdictColor(score);
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Threshold tick marks (radial lines at 70% and 90% of ring width)
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        for (const tR of [thresh350R, thresh450R]) {
            const tickLen = 4;
            const x1 = cx + Math.cos(midAngle) * (tR - tickLen);
            const y1 = cy + Math.sin(midAngle) * (tR - tickLen);
            const x2 = cx + Math.cos(midAngle) * (tR + tickLen);
            const y2 = cy + Math.sin(midAngle) * (tR + tickLen);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Label (axis abbreviation) outside ring
        const labelR = outerR + 14;
        const lx = cx + Math.cos(midAngle) * labelR;
        const ly = cy + Math.sin(midAngle) * labelR;
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = 'bold 10px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(axis, lx, ly);

        // Score number on arc (text shadow for contrast)
        const arcLen = arcSpan * ((innerR + outerR) / 2);
        if (arcLen > 38) {
            const scoreR = (innerR + outerR) / 2;
            const sx = cx + Math.cos(midAngle) * scoreR;
            const sy = cy + Math.sin(midAngle) * scoreR;
            ctx.font = 'bold 12px "JetBrains Mono", Consolas, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillText(Number.isFinite(score) ? score.toFixed(1) : '—', sx + 1, sy + 1);
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.fillText(Number.isFinite(score) ? score.toFixed(1) : '—', sx, sy);
        }

        ringSegments.push({ axis, startAngle: a0, endAngle: a1, innerR, outerR, cx, cy });
        angle = a1 + gapAngle;
    }

    // ── Center circle ──
    const centerR = innerR - 4;
    ctx.beginPath();
    ctx.arc(cx, cy, centerR, 0, PI2);
    ctx.fillStyle = 'rgba(10, 12, 20, 0.95)';
    ctx.fill();
    const centerColor = vetoed ? 'rgb(239,68,68)' : scoreToColor(eisScore);
    ctx.strokeStyle = centerColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // ── Radar overlay inside center (subtle polygon) ──
    const radarR = centerR - 12;
    if (radarR > 15 && axes.length >= 3) {
        const step = PI2 / axes.length;
        // Grid rings (subtle)
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        for (let ring = 1; ring <= 5; ring++) {
            const r = (ring / 5) * radarR;
            ctx.beginPath();
            for (let i = 0; i <= axes.length; i++) {
                const a = startOffset + i * step;
                const px = cx + Math.cos(a) * r;
                const py = cy + Math.sin(a) * r;
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
        }
        // Data polygon
        ctx.beginPath();
        for (let i = 0; i < axes.length; i++) {
            const a = startOffset + i * step;
            const val = Math.min(scores[axes[i]] || 0, 5);
            const r = (val / 5) * radarR;
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = centerColor.replace('rgb', 'rgba').replace(')', ',0.12)');
        ctx.fill();
        ctx.strokeStyle = centerColor;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.4;
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // ── EIS score (large, over radar) ──
    ctx.fillStyle = centerColor;
    ctx.font = 'bold 26px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Number.isFinite(eisScore) ? eisScore.toFixed(2) : '—', cx, cy - 6);

    // Verdict label
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    const vLabel = verdictLabel || '';
    const cleanVerdict = vLabel.replace(/^[^\w]*/, '').trim();
    ctx.fillText(cleanVerdict.length > 16 ? cleanVerdict.substring(0, 15) + '~' : cleanVerdict, cx, cy + 10);

    // VETOED badge
    if (vetoed) {
        ctx.fillStyle = 'rgba(239,68,68,0.9)';
        ctx.font = 'bold 9px "JetBrains Mono", Consolas, monospace';
        ctx.fillText(t('eis.vetoed_label') || 'VETOED', cx, cy + 22);
    }

    // Dynamic aria-label
    const ariaScore = Number.isFinite(eisScore) ? eisScore.toFixed(2) : '0';
    canvas.setAttribute('aria-label', `EIS Ring Chart: ${ariaScore} ${cleanVerdict}${vetoed ? ' VETOED' : ''}`);
}

// ================================================================
// PRIVATE — SCALE STRIP
// Barra horizontal com gradient, thresholds e marcador de posição
// ================================================================

/**
 * Render horizontal scale strip with gradient, threshold markers, and position indicator.
 * Primeira chamada = innerHTML completo. Subsequentes = update marker only.
 * @param {number} eisScore - Score EIS atual (0.00-5.00)
 */
function renderScaleStrip(eisScore) {
    const container = document.getElementById('eis-scale-strip');
    if (!container) return;

    if (!Number.isFinite(eisScore)) {
        container.style.display = 'none';
        return;
    }
    container.style.display = '';

    const leftPct = Math.min(100, Math.max(0, (eisScore / 5) * 100));
    const markerColor = scoreToColor(eisScore);
    const mgmtPct = (EIS_VERDICTS.MANAGEMENT_READY.min / 5) * 100;
    const auditPct = (EIS_VERDICTS.AUDIT_READY.min / 5) * 100;

    // Fast path: update marker only after first render
    if (_scaleStripInitialized && _scaleStripMarker && _scaleStripValue) {
        _scaleStripMarker.style.left = leftPct + '%';
        _scaleStripMarker.style.color = markerColor;
        _scaleStripValue.textContent = eisScore.toFixed(2);
        _scaleStripValue.style.color = markerColor;
        return;
    }

    container.innerHTML = `
        <div class="eis-scale-track">
            <div class="eis-scale-threshold" style="left:${mgmtPct}%">
                <span class="eis-scale-threshold-line"></span>
                <span class="eis-scale-threshold-label">${EIS_VERDICTS.MANAGEMENT_READY.min}</span>
            </div>
            <div class="eis-scale-threshold" style="left:${auditPct}%">
                <span class="eis-scale-threshold-line"></span>
                <span class="eis-scale-threshold-label">${EIS_VERDICTS.AUDIT_READY.min}</span>
            </div>
            <div class="eis-scale-marker" style="left:${leftPct}%;color:${markerColor}">
                <span class="eis-scale-marker-arrow">&#9650;</span>
                <span class="eis-scale-marker-value" style="color:${markerColor}">${eisScore.toFixed(2)}</span>
            </div>
        </div>
        <div class="eis-scale-labels">
            <span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
        </div>
    `;

    _scaleStripMarker = container.querySelector('.eis-scale-marker');
    _scaleStripValue = container.querySelector('.eis-scale-marker-value');
    _scaleStripInitialized = true;
}

// ================================================================
// PRIVATE — CONTRIBUTION BARS
// Barras horizontais individuais por eixo (score + peso visual)
// ================================================================

/**
 * Render horizontal bars per axis showing individual score with row height proportional to weight.
 * Honesto: mostra score real por eixo sem fabricar soma linear de um cálculo geométrico.
 * @param {Object.<string, number>} scores - Scores ajustados por eixo
 * @param {Object.<string, number>} weights - Pesos por eixo
 * @param {string[]|null} axisOrder - Ordem. Se null, usa Object.keys(scores)
 */
/** Flag to prevent innerHTML rebuild during slider drag */
let _barsSliderDragging = false;

/**
 * Render contribution bars with inline sliders and visual status indicators.
 * Sliders are embedded — no separate slider section needed.
 * During drag, uses update-in-place to avoid losing slider focus.
 */
function renderContributionBars(scores, weights, axisOrder = null) {
    const container = document.getElementById('eis-contribution-bars');
    if (!container) return;

    const axes = axisOrder || Object.keys(scores);
    if (axes.length === 0) {
        container.innerHTML = '';
        return;
    }

    // Update-in-place during drag (don't rebuild innerHTML)
    if (_barsSliderDragging) {
        for (const axis of axes) {
            const score = scores[axis] || 0;
            const fillEl = container.querySelector(`.eis-contrib-fill[data-axis="${axis}"]`);
            const scoreEl = container.querySelector(`.eis-contrib-score[data-axis="${axis}"]`);
            const rowEl = container.querySelector(`.eis-contrib-row[data-axis="${axis}"]`);
            if (fillEl) {
                fillEl.style.width = Math.min(100, Math.max(0, (score / 5) * 100)) + '%';
                fillEl.style.background = scoreToColor(score);
            }
            if (scoreEl) {
                scoreEl.textContent = score.toFixed(1);
                scoreEl.style.color = scoreToColor(score);
            }
            if (rowEl) {
                rowEl.className =
                    'eis-contrib-row' + (score < 3 ? ' eis-contrib-warn' : score >= 4 ? ' eis-contrib-good' : '');
            }
        }
        return;
    }

    const maxWeight = Math.max(...axes.map((a) => weights[a] || 1));

    let html = '';
    for (const axis of axes) {
        const score = scores[axis] || 0;
        const w = weights[axis] || 1;
        const fillPct = Math.min(100, Math.max(0, (score / 5) * 100));
        const color = scoreToColor(score);
        const rowH = Math.round(16 + (w / maxWeight) * 10);
        const autoResult = cachedAutoResults[axis];
        const hasAuto = autoResult != null;
        const isAuto = autoEnabled[axis] && hasAuto;
        const statusCls = score < 3 ? ' eis-contrib-warn' : score >= 4 ? ' eis-contrib-good' : '';
        const statusIcon =
            score < 3
                ? '<span class="eis-contrib-icon warn">!</span>'
                : score >= 4
                  ? '<span class="eis-contrib-icon good">&#10003;</span>'
                  : '';

        html += `
        <div class="eis-contrib-row${statusCls}" data-axis="${axis}" style="height:${rowH}px">
            ${statusIcon}
            <span class="eis-contrib-label">${axis}</span>
            <span class="eis-contrib-weight">w${w}</span>
            <div class="eis-contrib-track-wrap">
                <div class="eis-contrib-track">
                    <div class="eis-contrib-fill" data-axis="${axis}" style="width:${fillPct}%;background:${color}"></div>
                </div>
                <input type="range" class="eis-contrib-slider" data-axis="${axis}"
                    min="1" max="5" step="1" value="${Math.round(score)}"
                    ${isAuto ? 'disabled' : ''}
                    oninput="window._eisBarSliderInput('${axis}', this.value)"
                    onmousedown="window._eisBarDragStart()"
                    onmouseup="window._eisBarDragEnd()"
                    ontouchstart="window._eisBarDragStart()"
                    ontouchend="window._eisBarDragEnd()">
            </div>
            <span class="eis-contrib-score" data-axis="${axis}" style="color:${color}">${score.toFixed(1)}</span>
            ${hasAuto ? `<button class="eis-contrib-auto-btn ${isAuto ? 'on' : ''}" onclick="window._eisBarAutoToggle('${axis}')">${isAuto ? 'A' : 'M'}</button>` : ''}
        </div>`;
    }

    container.innerHTML = html;
}

// ================================================================
// PRIVATE — HELPERS
// Utilitários de cor e classificação do veredito
// ================================================================

/**
 * Get CSS color for a given EIS score.
 * @param {number} eis
 * @returns {string} CSS color string
 */
function getVerdictColor(eis) {
    if (eis >= 4.5) return 'rgb(34, 197, 94)';
    if (eis >= 3.5) return 'rgb(234, 179, 8)';
    return 'rgb(239, 68, 68)';
}

/**
 * Get CSS class name for verdict badge.
 * @param {number} eis
 * @returns {string}
 */
function getVerdictClass(eis) {
    if (eis >= 4.5) return 'green';
    if (eis >= 3.5) return 'yellow';
    return 'red';
}

/**
 * Get verdict object for a score.
 * @param {number} eis
 * @returns {Object|null}
 */
function getVerdictObject(eis) {
    if (eis >= 4.5) return EIS_VERDICTS.AUDIT_READY;
    if (eis >= 3.5) return EIS_VERDICTS.MANAGEMENT_READY;
    return EIS_VERDICTS.CRITICAL_DATA;
}

// ================================================================
// HUD MINI RADAR
// Mini radar hexagonal desenhado em canvas, visível no geo-hud
// ================================================================

/** Últimos scores usados para o mini radar (default 3 para cada eixo) */
let _hudScores = { T: 3, A: 3, Cp: 3, Ty: 3, Cs: 3, Cm: 3 };

/**
 * Update the EIS HUD mini radar canvas.
 * Desenha hexagono radar com score central e cor do veredito.
 * Chamado via updateAllUI após gerar modelo, importar dados, etc.
 */
function updateEisStatusBadge() {
    const canvas = document.getElementById('eis-hud-canvas');
    if (!canvas) return;

    const { ctx, W, H } = setupHiDPI(canvas);
    const cx = W / 2;
    const cy = H / 2;
    const R = 32; // raio máximo do hexágono

    ctx.clearRect(0, 0, W, H);

    // Fundo escuro arredondado para contraste
    ctx.fillStyle = 'rgba(15, 20, 30, 0.85)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 8);
    ctx.fill();

    // Coleta dados do modelo uma vez (performance)
    const elements = getAllElements();
    const allObs = collectAllObservations();
    const credInfo = EisCalculator.computeAggregateCredential(allObs);
    const multiplier = credInfo.multiplier;

    // Se o dashboard esta aberto, respeita sliders/toggles do usuario
    const dashboardModal = document.getElementById('eis-dashboard-modal');
    const isDashboardOpen = dashboardModal && dashboardModal.classList.contains('active');

    const scores = {};

    if (isDashboardOpen) {
        for (const axis of EIS_AXES) {
            const autoResult = cachedAutoResults[axis];
            if (autoEnabled[axis] && autoResult) {
                scores[axis] = autoResult.score;
            } else {
                const slider = document.getElementById(`eis-slider-${axis}`);
                scores[axis] = slider ? parseInt(slider.value, 10) : 3;
            }
        }
    } else {
        // Dashboard fechado: auto-computa todos os 6 eixos do modelo
        const campaigns = getAllCampaigns();
        const campaignStats = campaigns.map((c) => getCampaignCompleteness(c.id, elements));

        const cpAuto = EisCalculator.computeCpFromCampaigns(campaignStats);
        const tAuto = EisCalculator.computeTFromObservations(allObs);
        const aAuto = EisCalculator.computeAFromModel(elements, allObs);
        const tyAuto = EisCalculator.computeTyFromObservations(allObs);
        const csAuto = EisCalculator.computeCsFromObservations(allObs, UNITS);
        const cmAuto = EisCalculator.computeCmFromObservations(allObs, CONFIG.PARAMETERS);

        scores.T = tAuto ? tAuto.score : _hudScores.T;
        scores.A = aAuto ? aAuto.score : _hudScores.A;
        scores.Cp = cpAuto ? cpAuto.score : _hudScores.Cp;
        scores.Ty = tyAuto ? tyAuto.score : _hudScores.Ty;
        scores.Cs = csAuto ? csAuto.score : _hudScores.Cs;
        scores.Cm = cmAuto ? cmAuto.score : _hudScores.Cm;
    }

    _hudScores = { ...scores };

    // Calcula EIS com multiplicador agregado
    let eisScore = 3.0;
    let adjustedScores = scores;
    // Modo custom: usa calculateCustom se perfil ativo; senão fallback geometric
    const effectiveMode = currentMode === 'custom' ? 'geometric' : currentMode;
    try {
        if (
            currentMode === 'custom' &&
            isDashboardOpen &&
            activeCustomProfile &&
            activeCustomProfile.axes?.length >= 2
        ) {
            const axisScores = {};
            const axisWeights = {};
            for (const ax of activeCustomProfile.axes) {
                const slider = document.getElementById(`eis-custom-slider-${ax.id}`);
                axisScores[ax.id] = slider ? parseInt(slider.value, 10) : 3;
                axisWeights[ax.id] = ax.weight;
            }
            const result = calculator.calculateCustom(axisScores, axisWeights);
            eisScore = result.eis;
            // Custom: sem hexagono padrao, usa scores uniformes para visual
            for (const axis of EIS_AXES) adjustedScores[axis] = eisScore;
        } else {
            const result = calculator.calculate(scores, effectiveMode, 'common', multiplier);
            eisScore = result.eis;
            adjustedScores = result.adjustedScores;
        }
    } catch (_) {
        /* ignora erros de validação */
    }

    // Cor do veredito
    const color = getVerdictColor(eisScore);

    // ── Borda colorida do veredito ──
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(1, 1, W - 2, H - 2, 8);
    ctx.stroke();

    // ── Ângulos dos 6 eixos (começando no topo, horário) ──
    const angleOffset = -Math.PI / 2;
    const step = (2 * Math.PI) / 6;
    const axisAngles = EIS_AXES.map((_, i) => angleOffset + i * step);

    // ── Grid hexagonal (linhas de fundo) ──
    for (let ring = 1; ring <= 5; ring++) {
        const r = (ring / 5) * R;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const x = cx + r * Math.cos(axisAngles[i]);
            const y = cy + r * Math.sin(axisAngles[i]);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    }

    // ── Linhas radiais ──
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + R * Math.cos(axisAngles[i]), cy + R * Math.sin(axisAngles[i]));
        ctx.stroke();
    }

    // ── Polígono de dados (scores ajustados) ──
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const val = Math.min(adjustedScores[EIS_AXES[i]] || 3, 5);
        const r = (val / 5) * R;
        const x = cx + r * Math.cos(axisAngles[i]);
        const y = cy + r * Math.sin(axisAngles[i]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = color.replace('rgb', 'rgba').replace(')', ', 0.18)');
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ── Pontos nos vértices ──
    for (let i = 0; i < 6; i++) {
        const val = Math.min(adjustedScores[EIS_AXES[i]] || 3, 5);
        const r = (val / 5) * R;
        const x = cx + r * Math.cos(axisAngles[i]);
        const y = cy + r * Math.sin(axisAngles[i]);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    }

    // ── Labels dos eixos (T, A, Cp, Ty, Cs, Cm) ──
    ctx.font = 'bold 8px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 6; i++) {
        const lr = R + 12;
        const x = cx + lr * Math.cos(axisAngles[i]);
        const y = cy + lr * Math.sin(axisAngles[i]);
        ctx.fillText(EIS_AXES[i], x, y);
    }

    // ── Score central (grande e legível) ──
    ctx.font = 'bold 18px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(eisScore.toFixed(1), cx, cy - 5);

    // ── Label do modo ativo (cor = modo, não veredito) ──
    const modeLabels = { geometric: 'GEO', veto: 'VETO', custom: 'CUST' };
    const modeColors = {
        geometric: 'rgba(130,200,255,0.85)',
        veto: 'rgba(255,80,80,0.9)',
        custom: 'rgba(80,220,180,0.9)',
    };
    const modeLabel = modeLabels[currentMode] || 'GEO';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = modeColors[currentMode] || modeColors.geometric;
    ctx.fillText(modeLabel, cx, cy + 10);
}

// ================================================================
// EXPORTS
// ================================================================

export const eisHandlers = {
    handleOpenEisDashboard,
    handleRefreshEisDashboard,
    handleCloseEisDashboard,
    handleEisOverlayClick,
    handleEisModeChange,
    handleEisSliderInput,
    handleEisResetDefaults,
    handleEisAutoToggle,
    handleEisCustomProfileSelect,
    handleEisCustomNewProfile,
    handleEisCustomDuplicateProfile,
    handleEisCustomDeleteProfile,
    handleEisCustomRenameProfile,
    handleEisCustomAxisEdit,
    handleEisCustomAddAxis,
    handleEisCustomRemoveAxis,
    handleEisCustomSliderInput,
    handleEisCustomSaveProfile,
    updateEisStatusBadge,
};
