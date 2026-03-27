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
   XLSX FORMAT EXPORTER
   ================================================================ */

import { registerFormat } from './registry.js';
import { XLSX_TEMPLATES } from './xlsxTemplates.js';

registerFormat({
    id: 'xlsx',
    name: 'XLSX',
    extensions: ['.xlsx'],
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    canExport: true,
    canImport: false,
    exportScopes: ['full'],
});

/**
 * Export model to XLSX based on template.
 * @param {Object} model
 * @param {Object} [options]
 * @param {string} [options.template='ecbyts'] - 'edd-br' | 'edd-r2' | 'ohs-aiha' | 'ecbyts'
 * @returns {Promise<Blob>}
 */
export async function exportXLSX(model, options = {}) {
    const { template = 'ecbyts' } = options;

    const tpl = XLSX_TEMPLATES[template];
    if (!tpl) throw new Error(`Invalid template: ${template}`);

    if (!window.XLSX) {
        // Load SheetJS if missing (cdnLoader.js pattern)
        const { loadScriptCDN } = await import('../../utils/helpers/cdnLoader.js');
        await loadScriptCDN('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', {
            name: 'SheetJS',
            globalVar: 'XLSX',
        });
    }

    const wb = XLSX.utils.book_new();

    for (const sheet of tpl.sheets) {
        const rows = _buildRows(model, sheet);
        addSheet(wb, sheet.name, rows);
    }

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Build row objects for a sheet definition.
 * Constroi array de objetos com cabecalhos como chaves.
 * @param {Object} model
 * @param {import('./xlsxTemplates.js').TemplateSheet} sheet
 * @returns {Object[]}
 */
function _buildRows(model, sheet) {
    if (!sheet.columns || sheet.columns.length === 0) return [];

    const elements = model.elements || [];
    const campaigns = model.campaigns || [];

    if (sheet.source === 'elements') {
        return elements.map((el) => _rowFromColumns(sheet.columns, el, null));
    }

    if (sheet.source === 'campaigns') {
        return campaigns.map((c) => _rowFromColumns(sheet.columns, c, null));
    }

    if (sheet.source === 'observations') {
        // Flat join: each observation paired with its parent element
        return elements.flatMap((el) =>
            (el.data?.observations || []).map((obs) => _rowFromColumns(sheet.columns, obs, el)),
        );
    }

    return [];
}

/**
 * Map column definitions to a single row object.
 * @param {import('./xlsxTemplates.js').TemplateColumn[]} columns
 * @param {Object} primary - Primary data object (observation or element)
 * @param {Object|null} secondary - Secondary context (element when primary is observation)
 * @returns {Object}
 */
function _rowFromColumns(columns, primary, secondary) {
    const row = {};
    for (const col of columns) {
        row[col.header] = col.value(primary, secondary);
    }
    return row;
}

/**
 * Append a JSON data array as a named sheet to the workbook.
 * @param {Object} wb - SheetJS workbook
 * @param {string} name - Sheet name
 * @param {Object[]} data - Array of row objects
 */
export function addSheet(wb, name, data) {
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, name);
}
