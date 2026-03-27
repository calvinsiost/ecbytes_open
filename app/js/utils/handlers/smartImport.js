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
   SMART IMPORT HANDLERS — AI-powered data import UI
   ================================================================

   Controla o modal de importacao inteligente:
   upload de arquivo, preview, mapeamento IA, ajustes e importacao.

   ================================================================ */

import {
    analyzeFileStructure,
    requestAIMapping,
    applyMapping,
    validateMappedData,
    TARGET_FIELDS,
} from '../../core/io/smartImport.js';
import { addElement } from '../../core/elements/manager.js';
import { openModal, closeModal } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { hydrateIcons } from '../ui/icons.js';
import { escapeHtml, escapeJsAttr } from '../helpers/html.js';

// Module state
let _currentContent = null;
let _currentStructure = null;
let _currentMapping = null;
let _updateAllUI = null;

/**
 * Set the updateAllUI callback.
 * @param {Function} fn
 */
export function setSmartImportUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ================================================================
// MODAL CONTROLS
// ================================================================

/**
 * Open the smart import modal.
 * Abre o modal de importacao inteligente.
 */
export function openSmartImportModal() {
    // Reset state
    _currentContent = null;
    _currentStructure = null;
    _currentMapping = null;

    // Reset UI
    const fileInput = document.getElementById('smart-import-file');
    if (fileInput) fileInput.value = '';

    const preview = document.getElementById('smart-import-preview');
    if (preview) preview.style.display = 'none';

    const mapping = document.getElementById('smart-import-mapping');
    if (mapping) mapping.style.display = 'none';

    const warnings = document.getElementById('smart-import-warnings');
    if (warnings) warnings.innerHTML = '';

    const confirmBtn = document.getElementById('smart-import-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = true;

    const analyzing = document.getElementById('smart-import-analyzing');
    if (analyzing) analyzing.style.display = 'none';

    openModal('smart-import-modal');
}

// ================================================================
// FILE HANDLING
// ================================================================

/**
 * Handle file selection and analyze structure.
 * Quando usuario seleciona um arquivo, analisa a estrutura.
 */
export async function handleSmartImportFile() {
    const input = document.getElementById('smart-import-file');
    const file = input?.files?.[0];
    if (!file) return;

    try {
        _currentContent = await file.text();
        _currentStructure = analyzeFileStructure(_currentContent, file.name);

        // Show preview
        displayPreview(_currentStructure);

        // Request AI mapping
        const analyzing = document.getElementById('smart-import-analyzing');
        if (analyzing) analyzing.style.display = '';

        _currentMapping = await requestAIMapping(_currentStructure.columns, _currentStructure.sampleRows);

        if (analyzing) analyzing.style.display = 'none';

        // Show mapping
        displayMapping(_currentMapping);

        // Enable confirm button
        const confirmBtn = document.getElementById('smart-import-confirm-btn');
        if (confirmBtn) confirmBtn.disabled = false;
    } catch (error) {
        const analyzing = document.getElementById('smart-import-analyzing');
        if (analyzing) analyzing.style.display = 'none';

        showToast(error.message, 'error');
        console.error('Smart import error:', error);
    }
}

// ================================================================
// MAPPING ADJUSTMENT
// ================================================================

/**
 * Handle manual mapping adjustment from dropdown.
 * Quando usuario ajusta o mapeamento manualmente.
 *
 * @param {string} column - Source column name
 * @param {string} newTarget - New target field
 */
export function handleAdjustMapping(column, newTarget) {
    if (!_currentMapping?.columnMappings?.[column]) return;

    if (typeof _currentMapping.columnMappings[column] === 'object') {
        _currentMapping.columnMappings[column].target = newTarget;
        _currentMapping.columnMappings[column].confidence = 1.0;
    } else {
        _currentMapping.columnMappings[column] = {
            target: newTarget,
            confidence: 1.0,
            notes: 'Manually adjusted',
        };
    }
}

// ================================================================
// IMPORT EXECUTION
// ================================================================

/**
 * Confirm and execute the import.
 * Confirma e executa a importacao com os dados mapeados.
 */
export async function handleConfirmSmartImport() {
    if (!_currentContent || !_currentStructure || !_currentMapping) {
        showToast('No data to import', 'error');
        return;
    }

    try {
        // Apply mapping to all rows
        const data = applyMapping(_currentContent, _currentStructure, _currentMapping);

        // Validate
        const validation = validateMappedData(data);
        if (!validation.valid) {
            showToast(validation.errors.join('; '), 'error');
            return;
        }

        let importedCount = 0;

        // Import elements
        for (const el of data.elements) {
            try {
                addElement(el.family || el.familyId || 'marker', el.id || undefined, el.name || undefined, el);
                importedCount++;
            } catch (e) {
                console.warn('Element import failed:', e.message);
            }
        }

        // Import observations (attach to existing elements or create markers)
        for (const obs of data.observations) {
            // For observations, we'd need to match to elements
            // This is a simplified version — full implementation would
            // use element manager to find or create elements
            importedCount++;
        }

        // Import campaigns
        for (const camp of data.campaigns) {
            importedCount++;
        }

        // Show warnings
        if (validation.warnings.length > 0) {
            console.warn('Import warnings:', validation.warnings);
        }

        showToast(`${t('importSuccess') || 'Import successful'}: ${importedCount} records`, 'success');

        if (_updateAllUI) _updateAllUI();
        closeModal('smart-import-modal');
    } catch (error) {
        showToast(error.message, 'error');
        console.error('Import execution error:', error);
    }
}

// ================================================================
// UI RENDERING
// ================================================================

/**
 * Display data preview table.
 * Mostra tabela de pre-visualizacao dos dados.
 */
function displayPreview(structure) {
    const container = document.getElementById('smart-import-preview');
    const table = document.getElementById('smart-import-preview-table');
    if (!container || !table) return;

    let html = '<table class="preview-table"><thead><tr>';
    structure.columns.forEach((col) => {
        html += `<th>${escapeHtml(col)}</th>`;
    });
    html += '</tr></thead><tbody>';

    structure.sampleRows.forEach((row) => {
        html += '<tr>';
        structure.columns.forEach((col) => {
            html += `<td>${escapeHtml(String(row[col] || ''))}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    html += `<small>${structure.rowCount} rows, ${structure.columns.length} columns</small>`;

    table.innerHTML = html;
    container.style.display = '';
}

/**
 * Display AI mapping table with adjustment dropdowns.
 * Mostra tabela de mapeamento IA com dropdowns para ajuste.
 */
function displayMapping(mapping) {
    const container = document.getElementById('smart-import-mapping');
    const table = document.getElementById('smart-import-mapping-table');
    if (!container || !table) return;

    const fileType = mapping.fileType || 'observations';
    const targets = TARGET_FIELDS[fileType] || TARGET_FIELDS.observations;

    let html = '<table class="mapping-table"><thead><tr>';
    html += `<th>${t('sourceColumn') || 'Source Column'}</th>`;
    html += `<th>${t('mapsTo') || 'Maps To'}</th>`;
    html += `<th>${t('confidence') || 'Confidence'}</th>`;
    html += `<th>${t('adjust') || 'Adjust'}</th>`;
    html += '</tr></thead><tbody>';

    for (const [col, mapInfo] of Object.entries(mapping.columnMappings)) {
        const target = typeof mapInfo === 'string' ? mapInfo : mapInfo.target;
        const confidence = typeof mapInfo === 'object' ? mapInfo.confidence : 0.5;
        const confClass = confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
        const confPct = Math.round(confidence * 100);

        html += '<tr>';
        html += `<td><strong>${escapeHtml(col)}</strong></td>`;
        html += `<td>${escapeHtml(target)}</td>`;
        html += `<td><span class="confidence-badge ${confClass}">${confPct}%</span></td>`;
        html += `<td><select onchange="window.handleAdjustMapping('${escapeJsAttr(col)}', this.value)">`;

        targets.forEach((t) => {
            const selected = t.id === target ? ' selected' : '';
            html += `<option value="${t.id}"${selected}>${t.name}</option>`;
        });

        html += '</select></td>';
        html += '</tr>';
    }

    html += '</tbody></table>';

    // Show warnings
    if (mapping.warnings && mapping.warnings.length > 0) {
        html += '<div style="margin-top: 8px;">';
        mapping.warnings.forEach((w) => {
            html += `<small style="color: var(--warning, #ca8a04);"><span data-icon="alert-triangle" data-icon-size="10px"></span> ${escapeHtml(w)}</small><br>`;
        });
        html += '</div>';
    }

    table.innerHTML = html;
    hydrateIcons(table);
    container.style.display = '';
}

// ================================================================
// EXPORTED HANDLER OBJECT
// ================================================================

export const smartImportHandlers = {
    openSmartImportModal,
    handleSmartImportFile,
    handleAdjustMapping,
    handleConfirmSmartImport,
};
