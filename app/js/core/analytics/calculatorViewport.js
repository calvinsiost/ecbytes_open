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
   CALCULATOR VIEWPORT — Analytics viewport with metric cards
   Viewport de analytics mostrando cards com resultados do calculator

   Cada card mostra: tipo (metric/rule/ratio), label, valor calculado,
   cor, detalhes (count, pass/fail, ratio).
   ================================================================ */

import { getCalculatorItems, computeAllCalculator } from '../calculator/manager.js';
import { escapeHtml } from '../../utils/helpers/html.js';
import { t } from '../../utils/i18n/translations.js';

// ----------------------------------------------------------------
// CALCULATOR VIEWPORT CLASS
// ----------------------------------------------------------------

export class CalculatorViewport {
    constructor(container) {
        this.container = container;
        this.tensor = null;
        this._render();
    }

    /**
     * Receive data tensor (for consistency with other viewports).
     * O calculator nao usa tensor diretamente — recomputa do model.
     */
    setTensor(tensor) {
        this.tensor = tensor;
        this._render();
    }

    /**
     * Render calculator cards.
     */
    _render() {
        const el = this.container;
        if (!el) return;

        const items = getCalculatorItems();
        const results = computeAllCalculator();

        if (items.length === 0) {
            el.innerHTML = `<div class="calculator-viewport-empty" style="text-align:center;padding:20px;color:var(--primary-text-muted,#888);font-size:13px;">
                ${t('calculatorEmpty') || 'No calculator metrics. Open Calculator to add.'}
            </div>`;
            return;
        }

        el.innerHTML = `<div class="calculator-viewport-cards">
            ${items
                .filter((i) => i.enabled)
                .map((item) => {
                    const result = results.find((r) => r.id === item.id);
                    if (!result) return '';

                    const typeLabel = item.type === 'rule' ? 'RULE' : item.type === 'ratio' ? 'RATIO' : 'METRIC';
                    const typeClass = `calculator-type-${item.type}`;
                    const value = result.error
                        ? `<span style="color:#dc2626">Error</span>`
                        : escapeHtml(result.text || '—');

                    let detailsHtml = '';
                    if (result.details) {
                        if (item.type === 'rule') {
                            const d = result.details;
                            detailsHtml = `<div class="calculator-viewport-card-details">
                            <span style="color:#22c55e">${d.passing} pass</span> /
                            <span style="color:#dc2626">${d.failing} fail</span>
                            (${d.total} total)
                        </div>`;
                        }
                        if (item.type === 'ratio' && result.details.pass != null) {
                            detailsHtml = `<div class="calculator-viewport-card-details">
                            ${result.details.pass ? '<span style="color:#22c55e">PASS</span>' : '<span style="color:#dc2626">FAIL</span>'}
                        </div>`;
                        }
                    }
                    if (item.type === 'metric' && result.count != null) {
                        detailsHtml = `<div class="calculator-viewport-card-details">${result.count} observations</div>`;
                    }

                    // Badge de pos-processamento (constantes aplicadas)
                    const ppBadge = result.postProcessingNote
                        ? `<div class="calculator-viewport-card-pp" title="${t('postProcessing') || 'Post-processing'}">
                           ${escapeHtml(result.postProcessingNote)}
                       </div>`
                        : '';

                    return `<div class="calculator-viewport-card">
                    <div class="calculator-viewport-card-type ${typeClass}">${typeLabel}</div>
                    <div class="calculator-viewport-card-label">${escapeHtml(item.label || '')}</div>
                    <div class="calculator-viewport-card-value" style="color:${item.color || 'var(--primary-text)'}">${value}</div>
                    ${ppBadge}
                    ${detailsHtml}
                </div>`;
                })
                .join('')}
        </div>`;
    }

    destroy() {
        if (this.container) this.container.innerHTML = '';
    }
}
