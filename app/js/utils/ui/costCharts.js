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
   COST CHARTS — Chart.js renderers for Cost Analysis Panel
   Gráficos de custo para o painel de Análise de Custos

   GRÁFICOS:
   - Stacked bar: CAPEX vs OPEX por ano fiscal
   - Doughnut: custo por família de elementos
   - Horizontal bar: custo por campanha
   - Line: custo acumulado ao longo do tempo
   ================================================================ */

import { formatCurrency } from './governancePanel.js';
import { t } from '../i18n/translations.js';
import { DATA_VIZ_PALETTE_EXTENDED, CHART_SEMANTIC, applyChartAccessibility } from './chartTheme.js';

// Track Chart instances to avoid memory leaks
const _chartInstances = new Map();

// Y9: Use shared colorblind-safe palette instead of duplicated FAMILY_PALETTE
const FAMILY_PALETTE = DATA_VIZ_PALETTE_EXTENDED;

// Y9: Color palette from shared chartTheme (colorblind-safe)
const COLORS = {
    capex: CHART_SEMANTIC.capex,
    capexBorder: CHART_SEMANTIC.capexBorder,
    opex: CHART_SEMANTIC.opex,
    opexBorder: CHART_SEMANTIC.opexBorder,
    total: CHART_SEMANTIC.total,
    totalBorder: CHART_SEMANTIC.totalBorder,
    cumulative: CHART_SEMANTIC.cumulative,
    cumulativeBorder: CHART_SEMANTIC.cumulativeBorder,
};

// ----------------------------------------------------------------
// MAIN DISPATCHER
// ----------------------------------------------------------------

/**
 * Render all cost charts for the active view.
 * Renderiza todos os gráficos de custo para a visão ativa.
 *
 * @param {Object} rollup - CostRollup from buildCostRollup()
 * @param {string} view - 'synthetic' or 'detailed'
 */
export function renderCostCharts(rollup, view) {
    if (typeof Chart === 'undefined') {
        console.warn('[CostCharts] Chart.js not loaded');
        return;
    }

    if (view === 'synthetic') {
        renderCapexOpexByYearChart('cost-chart-by-year', rollup.timeline);
        renderCostByFamilyChart('cost-chart-by-family', rollup.byFamily);
        renderCampaignCostChart('cost-chart-campaigns', rollup.byCampaign);
        renderCostByCostCenterChart('cost-chart-by-cc', rollup.byCostCenter);
    } else {
        renderCumulativeCostChart('cost-chart-cumulative', rollup.timeline);
    }
}

/**
 * Destroy all tracked chart instances.
 * Destroi todas as instâncias de gráfico rastreadas.
 */
export function destroyAllCostCharts() {
    for (const [, chart] of _chartInstances) {
        chart.destroy();
    }
    _chartInstances.clear();
}

// ----------------------------------------------------------------
// STACKED BAR: CAPEX vs OPEX BY FISCAL YEAR
// ----------------------------------------------------------------

function renderCapexOpexByYearChart(containerId, timeline) {
    const canvas = document.getElementById(containerId);
    if (!canvas || timeline.length === 0) return;

    _destroyExisting(containerId);

    applyChartAccessibility(canvas, 'Cost timeline: CAPEX and OPEX by fiscal year');

    const labels = timeline.map((t) => String(t.fiscalYear));
    const capexData = timeline.map((t) => t.capex);
    const opexData = timeline.map((t) => t.opex);

    _chartInstances.set(
        containerId,
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'CAPEX',
                        data: capexData,
                        backgroundColor: COLORS.capex,
                        borderColor: COLORS.capexBorder,
                        borderWidth: 1,
                    },
                    {
                        label: 'OPEX',
                        data: opexData,
                        backgroundColor: COLORS.opex,
                        borderColor: COLORS.opexBorder,
                        borderWidth: 1,
                    },
                ],
            },
            options: _barOptions(true),
        }),
    );
}

// ----------------------------------------------------------------
// DOUGHNUT: COST BY FAMILY
// ----------------------------------------------------------------

function renderCostByFamilyChart(containerId, byFamily) {
    const canvas = document.getElementById(containerId);
    if (!canvas) return;

    const families = Object.keys(byFamily).filter((f) => byFamily[f].total > 0);
    if (families.length === 0) return;

    _destroyExisting(containerId);
    applyChartAccessibility(canvas, 'Cost by family (doughnut chart)');

    const labels = families.map((f) => f.charAt(0).toUpperCase() + f.slice(1));
    const data = families.map((f) => byFamily[f].total);
    const bgColors = families.map((_, i) => FAMILY_PALETTE[i % FAMILY_PALETTE.length]);

    _chartInstances.set(
        containerId,
        new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [
                    {
                        data,
                        backgroundColor: bgColors,
                        borderWidth: 1,
                        borderColor: 'var(--bg-primary, #fff)',
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw)}`,
                        },
                    },
                },
            },
        }),
    );
}

// ----------------------------------------------------------------
// HORIZONTAL BAR: CAMPAIGN COSTS
// ----------------------------------------------------------------

function renderCampaignCostChart(containerId, byCampaign) {
    const canvas = document.getElementById(containerId);
    if (!canvas) return;

    const entries = Object.values(byCampaign).filter((c) => c.total > 0);
    if (entries.length === 0) return;

    _destroyExisting(containerId);
    applyChartAccessibility(canvas, 'Campaign costs (horizontal bar chart)');

    // Sort by total descending
    entries.sort((a, b) => b.total - a.total);

    const labels = entries.map((c) => c.name);
    const data = entries.map((c) => c.total);

    _chartInstances.set(
        containerId,
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: t('campaignCosts') || 'Campaign Costs',
                        data,
                        backgroundColor: COLORS.total,
                        borderColor: COLORS.totalBorder,
                        borderWidth: 1,
                    },
                ],
            },
            options: _barOptions(false, true),
        }),
    );
}

// ----------------------------------------------------------------
// LINE: CUMULATIVE COST OVER TIME
// ----------------------------------------------------------------

function renderCumulativeCostChart(containerId, timeline) {
    const canvas = document.getElementById(containerId);
    if (!canvas || timeline.length === 0) return;

    _destroyExisting(containerId);
    applyChartAccessibility(canvas, 'Cumulative costs over time (line chart)');

    const labels = timeline.map((t) => String(t.fiscalYear));
    const cumulativeData = timeline.map((t) => t.cumulative);
    const totalData = timeline.map((t) => t.total);

    _chartInstances.set(
        containerId,
        new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: t('cumulative') || 'Cumulative',
                        data: cumulativeData,
                        borderColor: COLORS.cumulativeBorder,
                        backgroundColor: COLORS.cumulative,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                    },
                    {
                        label: t('grandTotal') || 'Total / Year',
                        data: totalData,
                        borderColor: COLORS.totalBorder,
                        backgroundColor: 'transparent',
                        borderDash: [5, 3],
                        tension: 0.3,
                        pointRadius: 3,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
                        },
                    },
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { font: { size: 10 }, callback: (v) => _shortCurrency(v) },
                    },
                    x: { ticks: { font: { size: 10 } } },
                },
            },
        }),
    );
}

// ----------------------------------------------------------------
// PIE: COST BY COST CENTER
// ----------------------------------------------------------------

function renderCostByCostCenterChart(containerId, byCostCenter) {
    const canvas = document.getElementById(containerId);
    if (!canvas) return;

    if (!byCostCenter || Object.keys(byCostCenter).length === 0) return;

    const entries = Object.entries(byCostCenter).filter(([, d]) => d.total > 0);
    if (entries.length === 0) return;

    _destroyExisting(containerId);
    applyChartAccessibility(canvas, 'Cost by cost center (pie chart)');

    const labels = entries.map(([, d]) => d.name);
    const data = entries.map(([, d]) => d.total);
    const bgColors = entries.map((_, i) => FAMILY_PALETTE[i % FAMILY_PALETTE.length]);

    _chartInstances.set(
        containerId,
        new Chart(canvas, {
            type: 'pie',
            data: {
                labels,
                datasets: [
                    {
                        data,
                        backgroundColor: bgColors,
                        borderWidth: 1,
                        borderColor: 'var(--bg-primary, #fff)',
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw)}`,
                        },
                    },
                },
            },
        }),
    );
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function _destroyExisting(containerId) {
    if (_chartInstances.has(containerId)) {
        _chartInstances.get(containerId).destroy();
        _chartInstances.delete(containerId);
    }
}

function _barOptions(stacked = false, horizontal = false) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: horizontal ? 'y' : 'x',
        plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } },
            tooltip: {
                callbacks: {
                    label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
                },
            },
        },
        scales: {
            x: {
                stacked,
                ticks: { font: { size: 10 }, callback: horizontal ? (v) => _shortCurrency(v) : undefined },
            },
            y: {
                stacked,
                beginAtZero: true,
                ticks: { font: { size: 10 }, callback: horizontal ? undefined : (v) => _shortCurrency(v) },
            },
        },
    };
}

function _shortCurrency(value) {
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
    return String(value);
}
