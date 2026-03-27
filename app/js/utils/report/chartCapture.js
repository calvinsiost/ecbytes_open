// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   CHART CAPTURE — Offscreen Chart.js rendering for report export
   Captura de gráficos Chart.js offscreen para inclusão em PDFs/DOCX

   Cria canvas temporário fora da tela, renderiza o gráfico com
   Chart.js sem animação, captura como PNG base64 e destrói tudo.

   Reutiliza configurações dos módulos existentes:
   - costCharts.js (CAPEX/OPEX, família, campanhas, acumulado)
   - handlers/eis.js (radar EIS 6 eixos)
   - evaChart.js (PV/EV/AC por item WBS)
   - violationsTimeline.js (barras empilhadas por mês)
   - histogram.js (distribuição de frequência)
   ================================================================ */

// ----------------------------------------------------------------
// Y9: COLOR PALETTES from shared chartTheme (colorblind-safe)
// ----------------------------------------------------------------
import { DATA_VIZ_PALETTE_EXTENDED, CHART_SEMANTIC } from '../ui/chartTheme.js';

const COST_COLORS = CHART_SEMANTIC;
const FAMILY_PALETTE = DATA_VIZ_PALETTE_EXTENDED;

const VIOLATION_COLORS = {
    intervention: '#ef4444',
    prevention: '#f59e0b',
    reference: '#3b82f6',
};

// ----------------------------------------------------------------
// OFFSCREEN RENDERER (core helper)
// ----------------------------------------------------------------

/**
 * Render a Chart.js chart offscreen and return as base64 PNG.
 * Cria canvas temporário, renderiza Chart.js, captura dataURL e limpa.
 *
 * @param {Object} chartConfig - Chart.js configuration
 * @param {number} [width=600] - Canvas width in pixels
 * @param {number} [height=300] - Canvas height in pixels
 * @returns {string|null} Base64 data URL (image/png) or null if Chart.js unavailable
 */
function _renderOffscreen(chartConfig, width = 600, height = 300) {
    if (typeof Chart === 'undefined') {
        console.warn('[ChartCapture] Chart.js not loaded');
        return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.position = 'absolute';
    canvas.style.left = '-9999px';
    document.body.appendChild(canvas);

    try {
        const chart = new Chart(canvas, {
            ...chartConfig,
            options: {
                ...chartConfig.options,
                responsive: false,
                animation: false,
                devicePixelRatio: 1,
            },
        });

        // JPEG com fundo branco — ~10x menor que PNG para gráficos
        const ctx = canvas.getContext('2d');
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = canvas.width;
        tmpCanvas.height = canvas.height;
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.fillStyle = '#ffffff';
        tmpCtx.fillRect(0, 0, tmpCanvas.width, tmpCanvas.height);
        tmpCtx.drawImage(canvas, 0, 0);

        const dataUrl = tmpCanvas.toDataURL('image/jpeg', 0.85);
        chart.destroy();
        return dataUrl;
    } finally {
        document.body.removeChild(canvas);
    }
}

// ----------------------------------------------------------------
// COST CHARTS
// Configs replicadas de utils/ui/costCharts.js
// ----------------------------------------------------------------

/**
 * CAPEX vs OPEX by fiscal year — stacked bar chart.
 * @param {Array} timeline - From costRollup.timeline
 * @param {number} [w=600] @param {number} [h=300]
 * @returns {string|null} Base64 PNG
 */
export function captureCapexOpexChart(timeline, w = 600, h = 300) {
    if (!timeline || timeline.length === 0) return null;

    return _renderOffscreen(
        {
            type: 'bar',
            data: {
                labels: timeline.map((t) => String(t.fiscalYear)),
                datasets: [
                    {
                        label: 'CAPEX',
                        data: timeline.map((t) => t.capex),
                        backgroundColor: COST_COLORS.capex,
                        borderColor: COST_COLORS.capexBorder,
                        borderWidth: 1,
                    },
                    {
                        label: 'OPEX',
                        data: timeline.map((t) => t.opex),
                        backgroundColor: COST_COLORS.opex,
                        borderColor: COST_COLORS.opexBorder,
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
                scales: {
                    x: { stacked: true, ticks: { font: { size: 10 } } },
                    y: { stacked: true, beginAtZero: true, ticks: { font: { size: 10 } } },
                },
            },
        },
        w,
        h,
    );
}

/**
 * Cost by element family — doughnut chart.
 * @param {Object} byFamily - From costRollup.byFamily
 * @returns {string|null} Base64 PNG
 */
export function captureCostByFamilyChart(byFamily, w = 400, h = 400) {
    if (!byFamily) return null;

    const families = Object.keys(byFamily).filter((f) => byFamily[f].total > 0);
    if (families.length === 0) return null;

    return _renderOffscreen(
        {
            type: 'doughnut',
            data: {
                labels: families.map((f) => f.charAt(0).toUpperCase() + f.slice(1)),
                datasets: [
                    {
                        data: families.map((f) => byFamily[f].total),
                        backgroundColor: families.map((_, i) => FAMILY_PALETTE[i % FAMILY_PALETTE.length]),
                        borderWidth: 1,
                        borderColor: '#ffffff',
                    },
                ],
            },
            options: {
                plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
            },
        },
        w,
        h,
    );
}

/**
 * Campaign costs — horizontal bar chart.
 * @param {Object} byCampaign - From costRollup.byCampaign
 * @returns {string|null} Base64 PNG
 */
export function captureCampaignCostChart(byCampaign, w = 600, h = 300) {
    if (!byCampaign) return null;

    const entries = Object.values(byCampaign).filter((c) => c.total > 0);
    if (entries.length === 0) return null;

    entries.sort((a, b) => b.total - a.total);

    return _renderOffscreen(
        {
            type: 'bar',
            data: {
                labels: entries.map((c) => c.name),
                datasets: [
                    {
                        label: 'Cost',
                        data: entries.map((c) => c.total),
                        backgroundColor: COST_COLORS.total,
                        borderColor: COST_COLORS.totalBorder,
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { font: { size: 10 } } },
                    y: { ticks: { font: { size: 10 } } },
                },
            },
        },
        w,
        h,
    );
}

/**
 * Cumulative cost over time — line chart.
 * @param {Array} timeline - From costRollup.timeline
 * @returns {string|null} Base64 PNG
 */
export function captureCumulativeCostChart(timeline, w = 600, h = 300) {
    if (!timeline || timeline.length === 0) return null;

    return _renderOffscreen(
        {
            type: 'line',
            data: {
                labels: timeline.map((t) => String(t.fiscalYear)),
                datasets: [
                    {
                        label: 'Cumulative',
                        data: timeline.map((t) => t.cumulative),
                        borderColor: COST_COLORS.cumulativeBorder,
                        backgroundColor: COST_COLORS.cumulative,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                    },
                    {
                        label: 'Total / Year',
                        data: timeline.map((t) => t.total),
                        borderColor: COST_COLORS.totalBorder,
                        backgroundColor: 'transparent',
                        borderDash: [5, 3],
                        tension: 0.3,
                        pointRadius: 3,
                    },
                ],
            },
            options: {
                plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
                scales: {
                    y: { beginAtZero: true, ticks: { font: { size: 10 } } },
                    x: { ticks: { font: { size: 10 } } },
                },
            },
        },
        w,
        h,
    );
}

// ----------------------------------------------------------------
// EIS RADAR CHART
// Config replicada de handlers/eis.js (initRadarChart)
// ----------------------------------------------------------------

/**
 * EIS radar chart — 6 axes TCCCA+T.
 * @param {Object} axisScores - { T, A, Cp, Ty, Cs, Cm } (adjusted scores)
 * @param {string[]} [axes] - Axis labels (default: standard 6)
 * @returns {string|null} Base64 PNG
 */
export function captureEISRadarChart(axisScores, axes = ['T', 'A', 'Cp', 'Ty', 'Cs', 'Cm'], w = 400, h = 400) {
    if (!axisScores) return null;

    const data = axes.map((a) => axisScores[a] || 0);
    const avg = data.reduce((s, v) => s + v, 0) / data.length;

    // Cor baseada no veredito
    let color;
    if (avg >= 4.5) color = 'rgb(34, 197, 94)';
    else if (avg >= 3.5) color = 'rgb(234, 179, 8)';
    else color = 'rgb(239, 68, 68)';

    return _renderOffscreen(
        {
            type: 'radar',
            data: {
                labels: axes,
                datasets: [
                    {
                        label: 'EIS',
                        data,
                        backgroundColor: color.replace('rgb', 'rgba').replace(')', ', 0.15)'),
                        borderColor: color,
                        borderWidth: 2,
                        pointBackgroundColor: color,
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1,
                        pointRadius: 4,
                    },
                ],
            },
            options: {
                plugins: { legend: { display: false } },
                scales: {
                    r: {
                        min: 0,
                        max: 5,
                        ticks: { stepSize: 1, font: { size: 10 }, backdropColor: 'transparent' },
                        grid: { color: 'rgba(0,0,0,0.1)' },
                        angleLines: { color: 'rgba(0,0,0,0.1)' },
                        pointLabels: { font: { size: 12, weight: '600' } },
                    },
                },
            },
        },
        w,
        h,
    );
}

// ----------------------------------------------------------------
// EVA CHART
// Config replicada de governance/evaChart.js (renderEVAChart)
// ----------------------------------------------------------------

/**
 * EVA chart — PV/EV/AC by WBS item.
 * @param {Array} itemEvas - [{ itemName, PV, EV, AC }]
 * @returns {string|null} Base64 PNG
 */
export function captureEVAChart(itemEvas, w = 600, h = 300) {
    if (!itemEvas || itemEvas.length === 0) return null;

    return _renderOffscreen(
        {
            type: 'bar',
            data: {
                labels: itemEvas.map((e) => e.itemName || e.itemId),
                datasets: [
                    {
                        label: 'PV (Planned)',
                        data: itemEvas.map((e) => e.PV),
                        backgroundColor: 'rgba(59,107,255,0.6)',
                        borderColor: '#3b6bff',
                        borderWidth: 1,
                    },
                    {
                        label: 'EV (Earned)',
                        data: itemEvas.map((e) => e.EV),
                        backgroundColor: 'rgba(76,175,80,0.6)',
                        borderColor: '#4caf50',
                        borderWidth: 1,
                    },
                    {
                        label: 'AC (Actual)',
                        data: itemEvas.map((e) => e.AC),
                        backgroundColor: 'rgba(255,152,0,0.6)',
                        borderColor: '#ff9800',
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
                scales: { y: { beginAtZero: true, ticks: { font: { size: 10 } } } },
            },
        },
        w,
        h,
    );
}

// ----------------------------------------------------------------
// VIOLATIONS TIMELINE
// Barras empilhadas por severidade e mês
// ----------------------------------------------------------------

/**
 * Violations timeline — stacked bar chart by month.
 * @param {Array} violations - [{ label, intervention, prevention, reference }]
 * @returns {string|null} Base64 PNG
 */
export function captureViolationsChart(violations, w = 600, h = 300) {
    if (!violations || violations.length === 0) return null;

    return _renderOffscreen(
        {
            type: 'bar',
            data: {
                labels: violations.map((v) => v.label),
                datasets: [
                    {
                        label: 'Intervention (VI)',
                        data: violations.map((v) => v.intervention),
                        backgroundColor: VIOLATION_COLORS.intervention,
                        borderWidth: 0,
                    },
                    {
                        label: 'Prevention (VP)',
                        data: violations.map((v) => v.prevention),
                        backgroundColor: VIOLATION_COLORS.prevention,
                        borderWidth: 0,
                    },
                    {
                        label: 'Reference (VR)',
                        data: violations.map((v) => v.reference),
                        backgroundColor: VIOLATION_COLORS.reference,
                        borderWidth: 0,
                    },
                ],
            },
            options: {
                plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
                scales: {
                    x: { stacked: true, ticks: { font: { size: 9 }, maxRotation: 45 } },
                    y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } },
                },
            },
        },
        w,
        h,
    );
}

// ----------------------------------------------------------------
// HISTOGRAM
// Distribuição de frequência de parâmetro
// ----------------------------------------------------------------

/**
 * Parameter histogram — frequency distribution bar chart.
 * @param {Array} values - Array of numeric values
 * @param {number} [binCount=20] - Number of bins
 * @returns {string|null} Base64 PNG
 */
export function captureHistogramChart(values, binCount = 20, w = 600, h = 300) {
    if (!values || values.length === 0) return null;

    const nums = values.filter((v) => typeof v === 'number' && !isNaN(v));
    if (nums.length === 0) return null;

    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const binWidth = (max - min) / binCount || 1;

    // Build bins
    const bins = Array.from({ length: binCount }, (_, i) => ({
        min: min + i * binWidth,
        max: min + (i + 1) * binWidth,
        count: 0,
    }));

    for (const v of nums) {
        let idx = Math.floor((v - min) / binWidth);
        if (idx >= binCount) idx = binCount - 1;
        if (idx < 0) idx = 0;
        bins[idx].count++;
    }

    return _renderOffscreen(
        {
            type: 'bar',
            data: {
                labels: bins.map((b) => b.min.toFixed(1)),
                datasets: [
                    {
                        label: 'Frequency',
                        data: bins.map((b) => b.count),
                        backgroundColor: 'rgba(59, 130, 246, 0.6)',
                        borderColor: 'rgba(59, 130, 246, 1)',
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { font: { size: 9 }, maxRotation: 45 } },
                    y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } },
                },
            },
        },
        w,
        h,
    );
}
