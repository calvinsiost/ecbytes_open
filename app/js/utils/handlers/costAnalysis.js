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
   COST ANALYSIS HANDLERS — Window-level functions for cost tab
   Handlers globais para a aba de análise de custos
   ================================================================ */

import { renderCostAnalysisTab, setCostAnalysisView, toggleCostElementDetail } from '../ui/costAnalysisPanel.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { escapeHtml } from '../helpers/html.js';
import {
    getCostCatalog,
    getCostCategories,
    getCurrency,
    getEscalationRate,
    saveCostOverrides,
    resetCostCatalog,
    exportCostCatalog,
    importCostCatalog,
} from '../../core/ingestion/documents/costCatalog.js';
import { hydrateIcons } from '../ui/icons.js';

let updateAllUIRef = null;

/**
 * Inject updateAllUI reference.
 * @param {Function} fn
 */
export function setCostAnalysisUpdateAllUI(fn) {
    updateAllUIRef = fn;
}

/**
 * Open the cost analysis tab in the side panel layout.
 * Abre a aba de análise de custos no layout lateral.
 */
function handleOpenCostAnalysis() {
    // Activate the tab (tabs module handles display toggling)
    const tabBtn = document.querySelector('[data-tab="cost-analysis"]');
    if (tabBtn) tabBtn.click();
}

/**
 * Toggle between synthetic/detailed views.
 * @param {string} view - 'synthetic' or 'detailed'
 */
function handleCostAnalysisViewToggle(view) {
    setCostAnalysisView(view);
}

/**
 * Refresh the cost analysis panel.
 */
function handleRefreshCostAnalysis() {
    renderCostAnalysisTab();
    showToast(t('costAnalysisRefreshed') || 'Cost data refreshed', 'success');
}

/**
 * Export cost analysis as PDF.
 * Exporta análise de custos em PDF.
 */
function handleExportCostPDF() {
    import('../ui/costPdfExport.js')
        .then((mod) => {
            mod.exportCostAnalysisPDF();
        })
        .catch((err) => {
            console.error('[CostAnalysis] PDF export failed:', err);
            showToast('PDF export failed', 'error');
        });
}

/**
 * Drill-down into element cost details.
 * @param {string} elementId
 */
function handleCostElementDrillDown(elementId) {
    toggleCostElementDetail(elementId);
}

// ----------------------------------------------------------------
// COST CATALOG EDITOR — Modal para editar preços de referência
// ----------------------------------------------------------------

/**
 * Open the cost catalog editor modal.
 * Abre modal para editar catálogo de custos de referência.
 */
function handleOpenCostCatalogEditor() {
    _renderCostCatalogModal();
}

/**
 * Close the cost catalog editor modal.
 */
function handleCloseCostCatalogEditor() {
    const modal = document.getElementById('cost-catalog-modal');
    if (modal) modal.remove();
}

/**
 * Save cost catalog overrides from the modal form.
 * Salva alterações do catálogo a partir do formulário.
 */
function handleSaveCostCatalog() {
    const modal = document.getElementById('cost-catalog-modal');
    if (!modal) return;

    const overrides = {};

    // Currency
    const currencyInput = modal.querySelector('[data-field="currency"]');
    if (currencyInput) overrides.currency = currencyInput.value.trim().toUpperCase() || 'BRL';

    // Escalation rate
    const escInput = modal.querySelector('[data-field="escalationRate"]');
    if (escInput) overrides.escalationRate = parseFloat(escInput.value) / 100 || 0;

    // Element costs (per family)
    const elCostInputs = modal.querySelectorAll('[data-el-cost]');
    if (elCostInputs.length > 0) {
        overrides.elementCosts = {};
        for (const input of elCostInputs) {
            const [family, field] = input.dataset.elCost.split('.');
            if (!overrides.elementCosts[family]) overrides.elementCosts[family] = {};
            overrides.elementCosts[family][field] = parseFloat(input.value) || 0;
        }
    }

    // Analytical prices
    const anPriceInputs = modal.querySelectorAll('[data-an-price]');
    if (anPriceInputs.length > 0) {
        overrides.analyticalPrices = {};
        for (const input of anPriceInputs) {
            const [param, field] = input.dataset.anPrice.split('.');
            if (!overrides.analyticalPrices[param]) overrides.analyticalPrices[param] = {};
            overrides.analyticalPrices[param][field] = parseFloat(input.value) || 0;
        }
    }

    saveCostOverrides(overrides);
    handleCloseCostCatalogEditor();
    renderCostAnalysisTab();
    showToast(t('costCatalogSaved') || 'Cost catalog saved', 'success');
}

/**
 * Reset cost catalog to defaults.
 */
function handleResetCostCatalog() {
    resetCostCatalog();
    handleCloseCostCatalogEditor();
    renderCostAnalysisTab();
    showToast(t('costCatalogReset') || 'Cost catalog reset to defaults', 'info');
}

/**
 * Export cost catalog as JSON file.
 */
function handleExportCostCatalog() {
    const data = exportCostCatalog();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ecbyts-cost-catalog.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast(t('costCatalogExported') || 'Cost catalog exported', 'success');
}

/**
 * Import cost catalog from JSON file.
 */
function handleImportCostCatalog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                importCostCatalog(data);
                handleCloseCostCatalogEditor();
                _renderCostCatalogModal(); // Re-open with imported data
                renderCostAnalysisTab();
                showToast(t('costCatalogImported') || 'Cost catalog imported', 'success');
            } catch (err) {
                showToast('Invalid JSON file', 'error');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/**
 * Render the cost catalog editor modal.
 * Renderiza o modal de edição do catálogo de custos.
 */
function _renderCostCatalogModal() {
    // Remove existing
    const existing = document.getElementById('cost-catalog-modal');
    if (existing) existing.remove();

    const catalog = getCostCatalog();
    const currency = getCurrency();
    const escRate = (getEscalationRate() * 100).toFixed(1);

    // Element costs section
    let elCostsHtml = '';
    for (const [family, costs] of Object.entries(catalog.elementCosts)) {
        elCostsHtml += `
            <div class="cce-row">
                <span class="cce-label">${escapeHtml(family)}</span>
                <input class="cce-input" type="number" step="1" value="${costs.drilling}" data-el-cost="${family}.drilling" title="Drilling (${currency}/m)">
                <input class="cce-input" type="number" step="1" value="${costs.installation}" data-el-cost="${family}.installation" title="Installation (${currency})">
                <input class="cce-input" type="number" step="1" value="${costs.decommission}" data-el-cost="${family}.decommission" title="Decommission (${currency})">
            </div>`;
    }

    // Analytical prices section (top 20 most common)
    const commonParams = Object.entries(catalog.analyticalPrices)
        .filter(([, v]) => v.price > 0)
        .sort((a, b) => b[1].price - a[1].price)
        .slice(0, 20);

    let anPricesHtml = '';
    for (const [param, info] of commonParams) {
        anPricesHtml += `
            <div class="cce-row">
                <span class="cce-label">${escapeHtml(param)}</span>
                <input class="cce-input" type="number" step="1" value="${info.price}" data-an-price="${param}.price" title="Price (${currency})">
                <input class="cce-input" type="number" step="1" value="${info.samplingCost}" data-an-price="${param}.samplingCost" title="Sampling (${currency})">
                <span class="cce-method">${escapeHtml(info.method)}</span>
            </div>`;
    }

    const modal = document.createElement('div');
    modal.id = 'cost-catalog-modal';
    modal.className = 'async-dialog-overlay';
    modal.innerHTML = `
        <div class="async-dialog" style="max-width:560px;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;">
            <div class="async-dialog-header">
                <h3 style="margin:0;font-size:0.9rem;">${t('editCostCatalog') || 'Cost Catalog Editor'}</h3>
                <button class="async-dialog-close" onclick="window.handleCloseCostCatalogEditor()">&#10005;</button>
            </div>
            <div style="overflow-y:auto;flex:1;padding:0.8rem;">
                <!-- General settings -->
                <div class="cce-section">
                    <div class="cce-section-title">${t('generalSettings') || 'General'}</div>
                    <div class="cce-row">
                        <span class="cce-label">${t('currency') || 'Currency'}</span>
                        <input class="cce-input" type="text" value="${escapeHtml(currency)}" data-field="currency" style="width:60px;">
                    </div>
                    <div class="cce-row">
                        <span class="cce-label">${t('escalationRate') || 'Escalation (%/yr)'}</span>
                        <input class="cce-input" type="number" step="0.1" value="${escRate}" data-field="escalationRate" style="width:60px;">
                    </div>
                </div>

                <!-- Element costs -->
                <div class="cce-section">
                    <div class="cce-section-title">${t('elementInstallCosts') || 'Element Install Costs'}</div>
                    <div class="cce-header-row">
                        <span class="cce-label">${t('family') || 'Family'}</span>
                        <span class="cce-col-header">Drilling/m</span>
                        <span class="cce-col-header">Install</span>
                        <span class="cce-col-header">Decomm.</span>
                    </div>
                    ${elCostsHtml}
                </div>

                <!-- Analytical prices -->
                <div class="cce-section">
                    <div class="cce-section-title">${t('analyticalPrices') || 'Analytical Prices'}</div>
                    <div class="cce-header-row">
                        <span class="cce-label">${t('parameter') || 'Parameter'}</span>
                        <span class="cce-col-header">Price</span>
                        <span class="cce-col-header">Sampling</span>
                        <span class="cce-col-header">Method</span>
                    </div>
                    ${anPricesHtml}
                </div>
            </div>
            <div class="async-dialog-footer" style="display:flex;gap:0.3rem;justify-content:space-between;padding:0.5rem 0.8rem;border-top:1px solid var(--border-color,#ddd);">
                <div style="display:flex;gap:0.3rem;">
                    <button class="btn btn-sm btn-secondary" onclick="window.handleImportCostCatalog()">Import</button>
                    <button class="btn btn-sm btn-secondary" onclick="window.handleExportCostCatalog()">Export</button>
                    <button class="btn btn-sm btn-secondary" onclick="window.handleResetCostCatalog()">Reset</button>
                </div>
                <div style="display:flex;gap:0.3rem;">
                    <button class="btn btn-sm btn-secondary" onclick="window.handleCloseCostCatalogEditor()">${t('cancel') || 'Cancel'}</button>
                    <button class="btn btn-sm btn-primary" onclick="window.handleSaveCostCatalog()">${t('save') || 'Save'}</button>
                </div>
            </div>
        </div>`;

    // Inject styles if not present
    if (!document.getElementById('cost-catalog-editor-styles')) {
        const style = document.createElement('style');
        style.id = 'cost-catalog-editor-styles';
        style.textContent = `
            .cce-section { margin-bottom: 0.8rem; }
            .cce-section-title {
                font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
                letter-spacing: 0.3px; color: var(--text-secondary); margin-bottom: 0.3rem;
                padding-bottom: 0.2rem; border-bottom: 1px solid var(--border-color, #ddd);
            }
            .cce-header-row, .cce-row {
                display: flex; align-items: center; gap: 0.3rem; padding: 0.15rem 0;
            }
            .cce-header-row { font-size: 0.65rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; }
            .cce-label { flex: 1; font-size: 0.75rem; min-width: 80px; }
            .cce-col-header { width: 70px; text-align: right; font-size: 0.6rem; }
            .cce-input {
                width: 70px; text-align: right; font-size: 0.75rem;
                padding: 2px 4px; border: 1px solid var(--border-color, #ddd);
                border-radius: 3px; background: var(--bg-secondary, #fafafa);
            }
            .cce-input:focus { border-color: var(--primary-500, #3b6bff); outline: none; }
            .cce-method { font-size: 0.65rem; color: var(--text-secondary); width: 80px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(modal);
    hydrateIcons(modal);
}

export const costAnalysisHandlers = {
    handleOpenCostAnalysis,
    handleCostAnalysisViewToggle,
    handleRefreshCostAnalysis,
    handleExportCostPDF,
    handleCostElementDrillDown,
    handleOpenCostCatalogEditor,
    handleCloseCostCatalogEditor,
    handleSaveCostCatalog,
    handleResetCostCatalog,
    handleExportCostCatalog,
    handleImportCostCatalog,
};
