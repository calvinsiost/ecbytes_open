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
   COST ANALYSIS PANEL — Dashboard de Análise de Custos
   ================================================================

   Aba do painel direito com duas sub-visões:
   - Sintético (Resumo): KPIs + gráficos agregados
   - Detalhado: Tabelas por elemento, campanha, ano fiscal, categoria

   Segue padrão do governancePanel.js:
   - renderCostAnalysisTab() gera HTML e injeta no container
   - Gráficos renderizados via requestAnimationFrame pós-DOM
   - CSS injetado dinamicamente
   ================================================================ */

import { buildCostRollup, getCostByElement } from '../../core/analytics/economics/costRollup.js';
import { renderCostCharts, destroyAllCostCharts } from './costCharts.js';
import { formatCurrency } from './governancePanel.js';
import { t, applyTranslations } from '../i18n/translations.js';
import { escapeHtml } from '../helpers/html.js';
import { hydrateIcons } from './icons.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let currentView = 'synthetic'; // 'synthetic' | 'detailed'
const expandedElements = new Set();

// ----------------------------------------------------------------
// MAIN RENDER
// ----------------------------------------------------------------

/**
 * Render the full cost analysis tab.
 * Renderiza toda a aba de análise de custos.
 */
export function renderCostAnalysisTab() {
    const container = document.getElementById('cost-analysis-content');
    if (!container) return;

    injectCostAnalysisStyles();
    destroyAllCostCharts();

    const rollup = buildCostRollup();

    let html = '';
    html += _renderActionBar();
    html += _renderViewToggle();

    if (rollup.grandTotal === 0 && rollup.kpis.elementsWithCost === 0) {
        html += `<div class="ca-empty">${t('noCostData') || 'No cost data. Generate a model or add costs to elements.'}</div>`;
    } else if (currentView === 'synthetic') {
        html += _renderSyntheticView(rollup);
    } else {
        html += _renderDetailedView(rollup);
    }

    container.innerHTML = html;
    hydrateIcons(container);
    applyTranslations(container);

    requestAnimationFrame(() => {
        renderCostCharts(rollup, currentView);
    });
}

/**
 * Switch between synthetic and detailed views.
 * Alterna entre visão sintética e detalhada.
 *
 * @param {string} view - 'synthetic' or 'detailed'
 */
export function setCostAnalysisView(view) {
    currentView = view;
    expandedElements.clear();
    renderCostAnalysisTab();
}

/**
 * Toggle drill-down for an element in detailed view.
 * @param {string} elementId
 */
export function toggleCostElementDetail(elementId) {
    if (expandedElements.has(elementId)) {
        expandedElements.delete(elementId);
    } else {
        expandedElements.add(elementId);
    }
    renderCostAnalysisTab();
}

// ----------------------------------------------------------------
// ACTION BAR + VIEW TOGGLE
// ----------------------------------------------------------------

function _renderActionBar() {
    return `
        <div class="ca-actions">
            <button class="btn btn-sm btn-secondary" onclick="window.handleOpenCostCatalogEditor()" title="${t('editCostCatalog') || 'Edit Cost Catalog'}">
                <span data-icon="settings" data-icon-size="12px"></span>
            </button>
            <button class="btn btn-sm btn-secondary" onclick="window.handleRefreshCostAnalysis()" title="${t('refresh') || 'Refresh'}">
                <span data-icon="refresh-cw" data-icon-size="12px"></span>
            </button>
            <button class="btn btn-sm btn-secondary" onclick="window.handleExportCostPDF()" title="${t('exportCostPDF') || 'Export PDF'}">
                <span data-icon="download" data-icon-size="12px"></span>
                <span>PDF</span>
            </button>
        </div>`;
}

function _renderViewToggle() {
    const synLabel = t('costSynthetic') || 'Summary';
    const detLabel = t('costDetailed') || 'Detailed';
    const synActive = currentView === 'synthetic' ? 'active' : '';
    const detActive = currentView === 'detailed' ? 'active' : '';

    return `
        <div class="ca-view-toggle">
            <button class="ca-view-btn ${synActive}" onclick="window.handleCostAnalysisViewToggle('synthetic')">
                ${synLabel}
            </button>
            <button class="ca-view-btn ${detActive}" onclick="window.handleCostAnalysisViewToggle('detailed')">
                ${detLabel}
            </button>
        </div>`;
}

// ----------------------------------------------------------------
// SYNTHETIC VIEW (RESUMO)
// ----------------------------------------------------------------

function _renderSyntheticView(rollup) {
    let html = '';

    // KPI cards
    html += `
        <div class="ca-kpi-row">
            ${_kpiCard('CAPEX', formatCurrency(rollup.totalCapex), 'capex')}
            ${_kpiCard('OPEX', formatCurrency(rollup.totalOpex), 'opex')}
            ${_kpiCard(t('grandTotal') || 'Total', formatCurrency(rollup.grandTotal), 'total')}
            ${_kpiCard(t('elementsWithCost') || 'Elements', String(rollup.kpis.elementsWithCost), 'count')}
        </div>`;

    // Second row of KPIs
    html += `
        <div class="ca-kpi-row">
            ${_kpiCard(t('campaignsWithCost') || 'Campaigns', String(rollup.kpis.campaignsWithCost), 'count')}
            ${_kpiCard(t('avgCostPerElement') || 'Avg/Element', formatCurrency(rollup.kpis.avgCostPerElement), 'avg')}
        </div>`;

    // CAPEX vs OPEX by Year chart
    if (rollup.timeline.length > 0) {
        html += `
            <div class="ca-section">
                <div class="ca-section-title">${t('costByFiscalYear') || 'CAPEX vs OPEX by Fiscal Year'}</div>
                <div class="ca-chart-container">
                    <canvas id="cost-chart-by-year"></canvas>
                </div>
            </div>`;
    }

    // Two side-by-side charts
    const hasFamilies = Object.keys(rollup.byFamily).some((f) => rollup.byFamily[f].total > 0);
    const hasCampaigns = Object.keys(rollup.byCampaign).length > 0;

    if (hasFamilies || hasCampaigns) {
        html += `<div class="ca-charts-row">`;

        if (hasFamilies) {
            html += `
                <div class="ca-chart-half">
                    <div class="ca-section-title">${t('costByFamily') || 'Cost by Family'}</div>
                    <div class="ca-chart-container ca-chart-sm">
                        <canvas id="cost-chart-by-family"></canvas>
                    </div>
                </div>`;
        }

        if (hasCampaigns) {
            html += `
                <div class="ca-chart-half">
                    <div class="ca-section-title">${t('costByCampaign') || 'Campaign Costs'}</div>
                    <div class="ca-chart-container ca-chart-sm">
                        <canvas id="cost-chart-campaigns"></canvas>
                    </div>
                </div>`;
        }

        html += `</div>`;
    }

    // L4 summary (if WBS data exists)
    if (rollup.l4Summary.itemCount > 0) {
        const l4 = rollup.l4Summary;
        html += `
            <div class="ca-section">
                <div class="ca-section-title">${t('l4ProjectCosts') || 'Project Costs (WBS)'}</div>
                <div class="ca-kpi-row ca-kpi-sm">
                    ${_kpiCard('BAC', formatCurrency(l4.wbsBAC), 'l4')}
                    ${_kpiCard('AC', formatCurrency(l4.wbsAC), 'l4')}
                    ${_kpiCard('EAC', formatCurrency(l4.wbsEAC), 'l4')}
                </div>
            </div>`;
    }

    // Cost Center breakdown
    html += _renderCostCenterSection(rollup);

    // Benchmark comparisons
    if (rollup.benchmarks) {
        html += _renderBenchmarkSection(rollup);
    }

    return html;
}

/**
 * Renderiza seção de benchmarks comparativos com indicadores ▲▼.
 * @param {Object} rollup
 * @returns {string}
 */
function _renderBenchmarkSection(rollup) {
    const bm = rollup.benchmarks;
    const cur = rollup.currency || 'BRL';

    const benchmarkDefs = [
        {
            label: t('benchmark.cost_per_meter') || 'Cost/meter (well)',
            actual: bm.costPerMeter,
            ref: bm.costPerMeterRef,
            unit: `${cur}/m`,
        },
        {
            label: t('benchmark.cost_per_obs') || 'Cost/observation',
            actual: bm.costPerObservation,
            ref: bm.costPerObservationRef,
            unit: `${cur}/obs`,
        },
        {
            label: t('benchmark.cost_per_campaign') || 'Cost/campaign',
            actual: bm.costPerCampaign,
            ref: bm.costPerCampaignRef,
            unit: cur,
        },
        {
            label: t('benchmark.capex_opex_ratio') || 'CAPEX:OPEX ratio',
            actual: bm.capexOpexRatio,
            ref: bm.capexOpexRatioRef,
            unit: '×',
        },
        {
            label: t('benchmark.cost_per_element') || 'Cost/element',
            actual: bm.costPerElement,
            ref: bm.costPerElementRef,
            unit: cur,
        },
        {
            label: t('benchmark.analytical_per_param') || 'Analytical/param',
            actual: bm.analyticalCostPerParam,
            ref: bm.analyticalCostPerParamRef,
            unit: `${cur}/param`,
        },
    ];

    // Filtra apenas benchmarks com dados disponíveis
    const available = benchmarkDefs.filter((b) => b.actual != null);
    if (available.length === 0) return '';

    let html = `
        <div class="ca-section">
            <div class="ca-section-title">${t('benchmark.title') || 'Industry Benchmarks'}</div>
            <div class="ca-benchmark-grid">`;

    for (const b of available) {
        const ratio = b.ref > 0 ? b.actual / b.ref : 1;
        const isBelow = ratio <= 1.0;
        const indicator = isBelow ? '▼' : '▲';
        const colorClass =
            ratio <= 0.8
                ? 'benchmark-excellent'
                : ratio <= 1.0
                  ? 'benchmark-good'
                  : ratio <= 1.2
                    ? 'benchmark-warn'
                    : 'benchmark-over';
        const pct = Math.round(Math.abs(ratio - 1.0) * 100);

        html += `
            <div class="ca-benchmark-card ${colorClass}">
                <div class="ca-benchmark-label">${escapeHtml(b.label)}</div>
                <div class="ca-benchmark-actual">${_fmtNum(b.actual)} ${escapeHtml(b.unit)}</div>
                <div class="ca-benchmark-ref">${t('benchmark.ref') || 'Ref'}: ${_fmtNum(b.ref)} ${escapeHtml(b.unit)}</div>
                <div class="ca-benchmark-indicator ${colorClass}">
                    <span class="ca-benchmark-arrow">${indicator}</span>
                    <span>${pct}% ${isBelow ? t('benchmark.below') || 'below' : t('benchmark.above') || 'above'}</span>
                </div>
            </div>`;
    }

    html += `</div></div>`;
    return html;
}

/** Formata número para exibição compacta */
function _fmtNum(n) {
    if (n == null) return '—';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    return n.toFixed(n < 10 ? 2 : 0);
}

function _kpiCard(label, value, type) {
    return `
        <div class="ca-kpi ca-kpi-${type}">
            <div class="ca-kpi-label">${escapeHtml(label)}</div>
            <div class="ca-kpi-value">${escapeHtml(value)}</div>
        </div>`;
}

// ----------------------------------------------------------------
// DETAILED VIEW (DETALHADO)
// ----------------------------------------------------------------

function _renderDetailedView(rollup) {
    let html = '';

    // By Element
    html += _renderElementsSection(rollup);

    // By Campaign
    html += _renderCampaignsSection(rollup);

    // By Fiscal Year
    html += _renderFiscalYearSection(rollup);

    // By Category
    html += _renderCategorySection(rollup);

    // By Cost Center
    html += _renderCostCenterSection(rollup);

    return html;
}

// --- By Cost Center ---

function _renderCostCenterSection(rollup) {
    const bcc = rollup.byCostCenter;
    if (!bcc || Object.keys(bcc).length === 0) return '';

    const cur = rollup.currency || 'BRL';

    let rows = '';
    const entries = Object.entries(bcc).sort((a, b) => b[1].total - a[1].total);

    for (const [ccId, data] of entries) {
        const varianceClass = data.variance > 0 ? 'ca-benchmark-green' : data.variance < 0 ? 'ca-benchmark-red' : '';
        const varianceSign = data.variance > 0 ? '+' : '';

        rows += `
            <tr>
                <td>${escapeHtml(data.code)}</td>
                <td>${escapeHtml(data.name)}</td>
                <td style="text-align:right">${formatCurrency(data.capex)}</td>
                <td style="text-align:right">${formatCurrency(data.opex)}</td>
                <td style="text-align:right"><strong>${formatCurrency(data.total)}</strong></td>
                <td style="text-align:right">${data.budget > 0 ? formatCurrency(data.budget) : '—'}</td>
                <td style="text-align:right" class="${varianceClass}">
                    ${data.budget > 0 ? `${varianceSign}${formatCurrency(data.variance)} (${data.variancePct.toFixed(1)}%)` : '—'}
                </td>
            </tr>`;
    }

    return `
        <div class="ca-section">
            <div class="ca-section-title">${t('byCostCenter') || 'By Cost Center'}</div>
            <div class="ca-chart-container ca-chart-sm">
                <canvas id="cost-chart-by-cc"></canvas>
            </div>
            <div style="overflow-x:auto">
                <table class="ca-table">
                    <thead>
                        <tr>
                            <th>${t('costCenterCode') || 'Code'}</th>
                            <th>${t('costCenterName') || 'Name'}</th>
                            <th style="text-align:right">CAPEX</th>
                            <th style="text-align:right">OPEX</th>
                            <th style="text-align:right">${t('total') || 'Total'}</th>
                            <th style="text-align:right">${t('costCenterBudget') || 'Budget'}</th>
                            <th style="text-align:right">${t('costCenterVariance') || 'Variance'}</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
}

// --- By Element ---

function _renderElementsSection(rollup) {
    const entries = Object.entries(rollup.byElement);
    if (entries.length === 0) return '';

    // Sort by total descending
    entries.sort((a, b) => b[1].total - a[1].total);

    let rows = '';
    for (const [elId, data] of entries) {
        const expanded = expandedElements.has(elId);
        const chevron = expanded ? '&#9660;' : '&#9654;';

        rows += `
            <tr class="ca-table-row ca-clickable" onclick="window.handleCostElementDrillDown('${elId}')">
                <td><span class="ca-chevron">${chevron}</span> ${escapeHtml(data.name)}</td>
                <td class="ca-td-family">${escapeHtml(data.family)}</td>
                <td class="ca-td-num">${formatCurrency(data.capex)}</td>
                <td class="ca-td-num">${formatCurrency(data.opex)}</td>
                <td class="ca-td-num ca-td-bold">${formatCurrency(data.total)}</td>
            </tr>`;

        if (expanded) {
            rows += _renderElementDrillDown(elId);
        }
    }

    return `
        <div class="section">
            <div class="section-header" onclick="window.toggleSection && window.toggleSection(this)">
                <span>${t('costByElement') || 'By Element'} (${entries.length})</span>
                <span class="section-chevron">&#9660;</span>
            </div>
            <div class="section-content">
                <table class="ca-table">
                    <thead>
                        <tr>
                            <th>${t('name') || 'Name'}</th>
                            <th>${t('family') || 'Family'}</th>
                            <th>CAPEX</th>
                            <th>OPEX</th>
                            <th>${t('grandTotal') || 'Total'}</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
}

function _renderElementDrillDown(elementId) {
    const detail = getCostByElement(elementId);
    if (!detail) return '';

    let html = '<tr class="ca-detail-row"><td colspan="5"><div class="ca-detail">';

    // Add year button
    html += `<div style="display:flex;justify-content:flex-end;margin-bottom:0.3rem;">
        <button class="btn btn-xs btn-secondary" style="font-size:0.65rem;padding:1px 6px;"
                onclick="window.handleAddCostYear('${escapeHtml(elementId)}')">
            + ${t('addCostYear') || 'Add Year'}
        </button>
    </div>`;

    // Costs by year
    if (detail.costsByYear.length > 0) {
        html += `<div class="ca-detail-sub">${t('costByFiscalYear') || 'By Fiscal Year'}:</div>`;
        for (const yr of detail.costsByYear) {
            html += `<div class="ca-detail-line">
                <span class="ca-detail-year">${yr.fiscalYear}</span>
                <select class="ca-basis-select" onchange="window.handleChangeCostBasis('${escapeHtml(elementId)}', ${yr.fiscalYear}, this.value)">
                    <option value="estimate" ${yr.basis === 'estimate' ? 'selected' : ''}>estimate</option>
                    <option value="budget" ${yr.basis === 'budget' ? 'selected' : ''}>budget</option>
                    <option value="actual" ${yr.basis === 'actual' ? 'selected' : ''}>actual</option>
                </select>
                CAPEX ${formatCurrency(yr.capex)} | OPEX ${formatCurrency(yr.opex)}
                = <strong>${formatCurrency(yr.total)}</strong>
                <button class="ca-btn-remove" title="${t('removeCostYear') || 'Remove year'}"
                        onclick="window.handleRemoveCostYear('${escapeHtml(elementId)}', ${yr.fiscalYear})">&#10005;</button>
            </div>`;

            // Item-level breakdown with inline edit
            if (yr.items.length > 0) {
                html += '<div class="ca-detail-items">';
                for (const item of yr.items) {
                    html += `<span class="ca-item">
                        ${item.categoryId}.${item.itemId}:
                        <input class="ca-inline-input" type="number" step="0.01" value="${item.amount}"
                               oninput="window.handleElementCostItemChange('${escapeHtml(elementId)}', ${yr.fiscalYear}, '${escapeHtml(item.categoryId)}', '${escapeHtml(item.itemId)}', this.value)">
                    </span>`;
                }
                html += '</div>';
            }
        }
    }

    // Observation costs
    if (detail.observationCosts.length > 0) {
        html += `<div class="ca-detail-sub">${t('observationCosts') || 'Observation Costs'} (${detail.observationCosts.length}):</div>`;
        for (const oc of detail.observationCosts.slice(0, 10)) {
            html += `<div class="ca-detail-line">
                <span class="ca-detail-param">${escapeHtml(oc.parameter)}</span>
                <span class="ca-detail-badge">${oc.source}</span>
                ${formatCurrency(oc.total)}
            </div>`;
        }
        if (detail.observationCosts.length > 10) {
            html += `<div class="ca-detail-more">+${detail.observationCosts.length - 10} more</div>`;
        }
    }

    html += '</div></td></tr>';
    return html;
}

// --- By Campaign ---

function _renderCampaignsSection(rollup) {
    const entries = Object.entries(rollup.byCampaign);
    if (entries.length === 0) return '';

    entries.sort((a, b) => b[1].total - a[1].total);

    let rows = '';
    for (const [, data] of entries) {
        const dateStr = data.date ? new Date(data.date).toLocaleDateString() : '-';
        rows += `
            <tr class="ca-table-row">
                <td>${escapeHtml(data.name)}</td>
                <td>${dateStr}</td>
                <td class="ca-td-num ca-td-bold">${formatCurrency(data.total)}</td>
            </tr>`;
    }

    return `
        <div class="section">
            <div class="section-header" onclick="window.toggleSection && window.toggleSection(this)">
                <span>${t('costByCampaign') || 'By Campaign'} (${entries.length})</span>
                <span class="section-chevron">&#9660;</span>
            </div>
            <div class="section-content">
                <table class="ca-table">
                    <thead>
                        <tr>
                            <th>${t('campaign') || 'Campaign'}</th>
                            <th>${t('date') || 'Date'}</th>
                            <th>${t('grandTotal') || 'Total'}</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
}

// --- By Fiscal Year ---

function _renderFiscalYearSection(rollup) {
    if (rollup.timeline.length === 0) return '';

    let rows = '';
    for (const yr of rollup.timeline) {
        rows += `
            <tr class="ca-table-row">
                <td>${yr.fiscalYear}</td>
                <td class="ca-td-num">${formatCurrency(yr.capex)}</td>
                <td class="ca-td-num">${formatCurrency(yr.opex)}</td>
                <td class="ca-td-num ca-td-bold">${formatCurrency(yr.total)}</td>
                <td class="ca-td-num">${formatCurrency(yr.cumulative)}</td>
            </tr>`;
    }

    return `
        <div class="section">
            <div class="section-header" onclick="window.toggleSection && window.toggleSection(this)">
                <span>${t('costByFiscalYear') || 'By Fiscal Year'}</span>
                <span class="section-chevron">&#9660;</span>
            </div>
            <div class="section-content">
                <table class="ca-table">
                    <thead>
                        <tr>
                            <th>${t('fiscalYear') || 'Year'}</th>
                            <th>CAPEX</th>
                            <th>OPEX</th>
                            <th>${t('grandTotal') || 'Total'}</th>
                            <th>${t('cumulative') || 'Cumul.'}</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
                <div class="ca-chart-container ca-chart-sm" style="margin-top:0.5rem">
                    <canvas id="cost-chart-cumulative"></canvas>
                </div>
            </div>
        </div>`;
}

// --- By Category ---

function _renderCategorySection(rollup) {
    const cats = rollup.byCategory;
    if (!cats || Object.keys(cats).length === 0) return '';

    let html = '';

    for (const [catId, items] of Object.entries(cats)) {
        const itemEntries = Object.entries(items)
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1]);
        if (itemEntries.length === 0) continue;

        const catLabel = catId === 'capex' ? t('capexItems') || 'CAPEX Items' : t('opexItems') || 'OPEX Items';
        const catTotal = itemEntries.reduce((s, [, v]) => s + v, 0);

        let itemRows = '';
        for (const [itemId, amount] of itemEntries) {
            const pct = catTotal > 0 ? ((amount / catTotal) * 100).toFixed(1) : '0.0';
            itemRows += `
                <tr class="ca-table-row">
                    <td>${escapeHtml(itemId)}</td>
                    <td class="ca-td-num">${formatCurrency(amount)}</td>
                    <td class="ca-td-num">${pct}%</td>
                </tr>`;
        }

        html += `
            <div class="ca-category-block">
                <div class="ca-category-header">${catLabel} — ${formatCurrency(catTotal)}</div>
                <table class="ca-table ca-table-compact">
                    <thead>
                        <tr><th>Item</th><th>${t('amount') || 'Amount'}</th><th>%</th></tr>
                    </thead>
                    <tbody>${itemRows}</tbody>
                </table>
            </div>`;
    }

    if (!html) return '';

    return `
        <div class="section">
            <div class="section-header" onclick="window.toggleSection && window.toggleSection(this)">
                <span>${t('costByCategory') || 'By Category'}</span>
                <span class="section-chevron">&#9660;</span>
            </div>
            <div class="section-content">${html}</div>
        </div>`;
}

// ----------------------------------------------------------------
// STYLES (injected dynamically)
// ----------------------------------------------------------------

function injectCostAnalysisStyles() {
    if (document.getElementById('cost-analysis-styles')) return;

    const style = document.createElement('style');
    style.id = 'cost-analysis-styles';
    style.textContent = `
        /* Action bar */
        .ca-actions {
            display: flex; gap: 0.3rem; justify-content: flex-end;
            padding: 0.3rem 0; margin-bottom: 0.2rem;
        }
        .ca-actions .btn { display: flex; align-items: center; gap: 0.25rem; }

        /* View toggle */
        .ca-view-toggle {
            display: flex; gap: 0; margin-bottom: 0.5rem;
            border: 1px solid var(--border-color, #ddd); border-radius: 4px;
            overflow: hidden;
        }
        .ca-view-btn {
            flex: 1; padding: 0.35rem 0.5rem; border: none; background: transparent;
            font-size: 0.8rem; font-weight: 500; cursor: pointer;
            color: var(--text-secondary); transition: all 0.15s;
        }
        .ca-view-btn:hover { background: var(--neutral-100, #f5f5f5); }
        .ca-view-btn.active {
            background: var(--primary-500, #3b6bff); color: #fff;
        }

        /* KPI cards */
        .ca-kpi-row {
            display: flex; gap: 0.35rem; margin-bottom: 0.5rem; flex-wrap: wrap;
        }
        .ca-kpi {
            flex: 1; min-width: 70px; padding: 0.4rem 0.5rem;
            border: 1px solid var(--border-color, #eee); border-radius: 4px;
            text-align: center; background: var(--bg-secondary, #fafafa);
        }
        .ca-kpi-label { font-size: 0.65rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.3px; }
        .ca-kpi-value { font-size: 0.85rem; font-weight: 600; margin-top: 0.15rem; }

        .ca-kpi-capex .ca-kpi-value { color: var(--primary-600, #2d52c4); }
        .ca-kpi-opex .ca-kpi-value { color: #e67e22; }
        .ca-kpi-total .ca-kpi-value { color: #27ae60; }
        .ca-kpi-sm .ca-kpi { padding: 0.25rem 0.4rem; }
        .ca-kpi-sm .ca-kpi-value { font-size: 0.8rem; }

        /* Sections */
        .ca-section { margin-bottom: 0.5rem; }
        .ca-section-title {
            font-size: 0.75rem; font-weight: 600; color: var(--text-secondary);
            text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 0.3rem;
        }

        /* Chart containers */
        .ca-chart-container { position: relative; height: 180px; margin-bottom: 0.5rem; }
        .ca-chart-sm { height: 150px; }
        .ca-charts-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
        .ca-chart-half { flex: 1; min-width: 0; }

        /* Tables */
        .ca-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
        .ca-table th {
            text-align: left; font-size: 0.7rem; font-weight: 600;
            color: var(--text-secondary); padding: 0.25rem 0.35rem;
            border-bottom: 1px solid var(--border-color, #ddd);
            text-transform: uppercase; letter-spacing: 0.3px;
        }
        .ca-table td { padding: 0.3rem 0.35rem; border-bottom: 1px solid var(--border-color, #f0f0f0); }
        .ca-table-compact th, .ca-table-compact td { padding: 0.2rem 0.3rem; font-size: 0.75rem; }
        .ca-td-num { text-align: right; font-variant-numeric: tabular-nums; }
        .ca-td-bold { font-weight: 600; }
        .ca-td-family { font-style: italic; color: var(--text-secondary); font-size: 0.72rem; }
        .ca-clickable { cursor: pointer; }
        .ca-clickable:hover { background: var(--neutral-50, #fafafa); }
        .ca-chevron { font-size: 0.65rem; color: var(--text-secondary); }

        /* Drill-down detail */
        .ca-detail-row { background: var(--bg-secondary, #fafafa); }
        .ca-detail { padding: 0.4rem 0.5rem 0.4rem 1.2rem; font-size: 0.75rem; }
        .ca-detail-sub { font-weight: 600; margin-top: 0.3rem; margin-bottom: 0.15rem; }
        .ca-detail-line { margin-bottom: 0.15rem; display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
        .ca-detail-year { font-weight: 600; min-width: 35px; }
        .ca-detail-param { font-weight: 500; min-width: 80px; }
        .ca-detail-badge {
            font-size: 0.6rem; padding: 0.05rem 0.3rem; border-radius: 3px;
            background: var(--neutral-200, #e0e0e0); color: var(--text-secondary);
            text-transform: uppercase;
        }
        .ca-detail-items { display: flex; gap: 0.3rem; flex-wrap: wrap; padding-left: 0.5rem; margin-bottom: 0.2rem; }
        .ca-item {
            font-size: 0.68rem; padding: 0.1rem 0.3rem; border-radius: 2px;
            background: var(--neutral-100, #f5f5f5); color: var(--text-secondary);
        }
        .ca-detail-more { font-size: 0.7rem; color: var(--text-secondary); font-style: italic; }

        /* Category blocks */
        .ca-category-block { margin-bottom: 0.5rem; }
        .ca-category-header {
            font-size: 0.75rem; font-weight: 600; padding: 0.2rem 0;
            border-bottom: 1px solid var(--border-color, #ddd); margin-bottom: 0.2rem;
        }

        /* Empty state */
        .ca-empty {
            text-align: center; padding: 2rem 1rem;
            color: var(--text-secondary); font-size: 0.85rem;
        }

        /* Inline edit controls in drill-down */
        .ca-basis-select {
            font-size: 0.6rem; padding: 0 2px; border: 1px solid var(--border-color, #ddd);
            border-radius: 2px; background: transparent; color: var(--text-secondary);
            cursor: pointer;
        }
        .ca-inline-input {
            width: 70px; text-align: right; font-size: 0.68rem;
            padding: 0 3px; border: 1px solid var(--border-color, #ddd);
            border-radius: 2px; background: transparent;
            color: var(--text-primary, #333);
        }
        .ca-inline-input:focus { border-color: var(--primary-500, #3b6bff); outline: none; }
        .ca-btn-remove {
            border: none; background: none; cursor: pointer; font-size: 0.65rem;
            color: var(--text-secondary); padding: 0 2px; line-height: 1;
        }
        .ca-btn-remove:hover { color: var(--danger, #e74c3c); }
    `;
    document.head.appendChild(style);
}
