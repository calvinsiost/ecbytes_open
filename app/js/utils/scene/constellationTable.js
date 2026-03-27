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
   CONSTELLATION TABLE — PDPLU tabular view of observations
   ================================================================

   Visualizacao tabular de observacoes no formato PDPLU:
   P = Ponto (elemento monitorado)
   D = Data (data da medicao)
   P = Parametro (parametro medido)
   L = Leitura (valor numerico)
   U = Unidade (unidade de medida)

   Mostra observacoes do elemento selecionado no HUD constellation.
   Inclui botao de exportacao CSV no formato PDPLU limpo.
   ================================================================ */

import { CONFIG } from '../../config.js';
import { hydrateIcons } from '../ui/icons.js';

// --- Module state ---
let activeTab = 'graph';

// Restaurar tab salva do localStorage
try {
    const saved = localStorage.getItem('ecbyts-constellation-tab');
    if (saved && ['graph', 'pdplu', 'report', 'storyboard'].includes(saved)) {
        activeTab = saved;
    }
} catch (_) {}

// ================================================================
// TAB SWITCHING
// ================================================================

/**
 * Return active constellation tab id.
 * @returns {'graph'|'pdplu'}
 */
export function getActiveConstellationTab() {
    return activeTab;
}

/**
 * Switch between graph, pdplu, report, and storyboard views.
 * Alterna entre a visualizacao de grafo, tabela PDPLU, relatorio e storyboard.
 * @param {'graph'|'pdplu'|'report'|'storyboard'} tabId
 */
export function switchConstellationTab(tabId) {
    const validTabs = ['graph', 'pdplu', 'report', 'storyboard'];
    if (!validTabs.includes(tabId)) return;
    activeTab = tabId;
    try {
        localStorage.setItem('ecbyts-constellation-tab', tabId);
    } catch (_) {}

    // Hide all views, show active
    for (const id of validTabs) {
        const view = document.getElementById(`constellation-view-${id}`);
        if (view) view.style.display = id === tabId ? 'block' : 'none';
    }

    // Expande painel via custom property quando Report ativo (editor precisa de mais espaco)
    // Se colapsado, nao alterar a altura — manter 24px definido pelo toggleConstellationCollapse
    const isCollapsed = document.getElementById('constellation-hud')?.classList.contains('constellation-collapsed');
    if (!isCollapsed) {
        const mainArea = document.getElementById('main-area');
        if (mainArea) {
            if (tabId === 'report') {
                const expandedH = Math.min(Math.round(window.innerHeight * 0.45), 400);
                mainArea.style.setProperty('--bottom-panel-height', expandedH + 'px');
            } else {
                // Restaurar altura salva ou default
                const savedH = localStorage.getItem('ecbyts-constellation-height');
                const h = savedH ? parseInt(savedH, 10) : 120;
                if (!isNaN(h)) mainArea.style.setProperty('--bottom-panel-height', h + 'px');
            }
        }
    }

    // Toggle active class + ARIA on tab buttons
    const tabs = document.querySelectorAll('.constellation-tab[data-ctab]');
    tabs.forEach((btn) => {
        const isActive = btn.dataset.ctab === tabId;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
}

// ================================================================
// PDPLU TABLE RENDERING
// ================================================================

/**
 * Resolve parameter id to human name.
 * @param {string} parameterId
 * @returns {string}
 */
function resolveParamName(parameterId) {
    if (!parameterId) return '\u2014';
    const param = (CONFIG.PARAMETERS || []).find((p) => p.id === parameterId);
    return param ? param.name : parameterId;
}

/**
 * Resolve unit id to display label.
 * @param {string} unitId
 * @returns {string}
 */
function resolveUnitLabel(unitId) {
    if (!unitId) return '';
    const unit = (CONFIG.UNITS || []).find((u) => u.id === unitId);
    return unit ? unit.symbol || unit.name : unitId;
}

/**
 * Build flat PDPLU rows from element observations.
 * Inclui leituras adicionais (additionalReadings) como linhas extras.
 * @param {Object|null} element
 * @returns {Array<{ponto:string, data:string, parametro:string, leitura:*, unidade:string}>}
 */
function buildPDPLURows(element) {
    const rows = [];
    if (!element) return rows;

    const observations = element.data?.observations || [];
    const elementName = element.name || element.id || '\u2014';

    for (const obs of observations) {
        const vars = obs.variables || {};

        // Primary reading
        rows.push({
            ponto: elementName,
            data: obs.date || '\u2014',
            parametro: resolveParamName(obs.parameterId),
            leitura: obs.value != null ? obs.value : '\u2014',
            unidade: resolveUnitLabel(obs.unitId),
            variables: vars,
        });

        // Additional readings at same point/date
        if (obs.additionalReadings) {
            for (const reading of obs.additionalReadings) {
                rows.push({
                    ponto: elementName,
                    data: obs.date || '\u2014',
                    parametro: resolveParamName(reading.parameterId),
                    leitura: reading.value != null ? reading.value : '\u2014',
                    unidade: resolveUnitLabel(reading.unitId),
                    variables: vars,
                });
            }
        }
    }

    return rows;
}

/**
 * Collect all unique variable IDs across PDPLU rows.
 * Coleta todas as chaves de variaveis presentes nas observacoes.
 * @param {Array} rows - PDPLU rows
 * @returns {string[]} Sorted variable IDs
 */
function collectVariableIds(rows) {
    const ids = new Set();
    for (const r of rows) {
        for (const key of Object.keys(r.variables || {})) {
            ids.add(key);
        }
    }
    return [...ids].sort();
}

/**
 * Extract display value from a variable entry.
 * Suporta formato { value, unit } e valores legados simples.
 * @param {*} entry - Variable value (object or primitive)
 * @returns {string} Display string
 */
function resolveVarValue(entry) {
    if (entry == null) return '';
    if (typeof entry === 'object' && entry !== null) return String(entry.value ?? '');
    return String(entry);
}

/** Escape HTML special chars */
function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Render the PDPLU table for the given element.
 * Renderiza a tabela PDPLU com todas as observacoes do elemento.
 * @param {Object|null} element
 */
export function updatePDPLUTable(element) {
    const container = document.getElementById('pdplu-table-container');
    if (!container) return;

    const rows = buildPDPLURows(element);
    const count = rows.length;

    if (count === 0) {
        container.innerHTML = `
            <div class="pdplu-toolbar">
                <span class="pdplu-toolbar-info">0 leituras</span>
                <button type="button" class="pdplu-export-btn" disabled>
                    <span data-icon="download" data-icon-size="12px"></span>
                    Export CSV
                </button>
            </div>
            <table class="pdplu-table"><tbody>
                <tr><td class="pdplu-empty" colspan="5" data-i18n="pdpluNoData">Selecione um elemento com observações</td></tr>
            </tbody></table>`;
        hydrateIcons(container);
        return;
    }

    const varIds = collectVariableIds(rows);

    container.innerHTML = `
        <div class="pdplu-toolbar">
            <span class="pdplu-toolbar-info">${count} ${count === 1 ? 'leitura' : 'leituras'}</span>
            <button type="button" class="pdplu-export-btn"
                    onclick="window.handleExportPDPLU()">
                <span data-icon="download" data-icon-size="12px"></span>
                Export CSV
            </button>
        </div>
        <table class="pdplu-table">
            <thead>
                <tr>
                    <th>Ponto</th>
                    <th>Data</th>
                    <th>Parâmetro</th>
                    <th class="pdplu-value">Leitura</th>
                    <th>Unidade</th>
                    ${varIds.map((vid) => `<th class="pdplu-var">${esc(vid)}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${rows
                    .map(
                        (r) => `
                    <tr>
                        <td>${esc(r.ponto)}</td>
                        <td>${esc(r.data)}</td>
                        <td>${esc(r.parametro)}</td>
                        <td class="pdplu-value">${esc(String(r.leitura))}</td>
                        <td>${esc(r.unidade)}</td>
                        ${varIds.map((vid) => `<td class="pdplu-var">${esc(resolveVarValue(r.variables?.[vid]))}</td>`).join('')}
                    </tr>
                `,
                    )
                    .join('')}
            </tbody>
        </table>`;
    hydrateIcons(container);
}

// ================================================================
// CSV EXPORT
// ================================================================

/** Escape a CSV field — wrap in quotes if contains separator, quotes, or newlines */
function csvEscape(val, sep) {
    const s = String(val ?? '');
    if (s.includes(sep) || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

/**
 * Export PDPLU table data as CSV and trigger download.
 * Exporta dados PDPLU como CSV com BOM para Excel.
 * @param {Object|null} element
 */
export function exportPDPLUCSV(element) {
    const rows = buildPDPLURows(element);
    if (rows.length === 0) return;

    const varIds = collectVariableIds(rows);
    const sep = ',';
    const headers = ['Ponto', 'Data', 'Parametro', 'Leitura', 'Unidade', ...varIds];
    const lines = [headers.join(sep)];

    for (const r of rows) {
        const base = [
            csvEscape(r.ponto, sep),
            csvEscape(r.data, sep),
            csvEscape(r.parametro, sep),
            r.leitura != null && r.leitura !== '\u2014' ? r.leitura : '',
            csvEscape(r.unidade, sep),
        ];
        for (const vid of varIds) {
            base.push(csvEscape(resolveVarValue(r.variables?.[vid]), sep));
        }
        lines.push(base.join(sep));
    }

    const bom = '\uFEFF';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = (element?.name || 'data').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `pdplu-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
