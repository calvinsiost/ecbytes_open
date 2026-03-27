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
   BOREHOLE HANDLERS — Import and validate borehole data
   Handlers para importacao e validacao de dados de sondagem

   Sondagens (boreholes) sao furos feitos no terreno para investigacao
   ambiental. Os dados incluem: localizacao do furo (collar), camadas
   do solo (intervalos litologicos) e medicoes (nivel d'agua, etc).

   Os dados validados sao adicionados como elementos 'well' com
   os campos opcionais `lithology` e `waterLevels` no objeto data.
   ================================================================ */

import { validateBorehole, validateBoreholes, normalizeBoreholeToWell } from '../../core/validation/borehole.js';
import { addElement } from '../../core/elements/manager.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';

let _updateAllUI = null;

/**
 * Inject updateAllUI dependency.
 * @param {Function} fn
 */
export function setBoreholeUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

/**
 * Detect input format and normalize to array of borehole objects.
 * Detecta se o JSON contem um unico furo ou batch, e normaliza.
 *
 * @param {Object} json - Parsed JSON input
 * @returns {{ items: Array, isBatch: boolean }}
 */
function _normalizeInput(json) {
    // Single borehole: { borehole: { ... } }
    if (json.borehole && typeof json.borehole === 'object') {
        return { items: [json], isBatch: false };
    }
    // Batch: { boreholes: [ { borehole: ... }, ... ] }
    if (Array.isArray(json.boreholes)) {
        return { items: json.boreholes, isBatch: true };
    }
    // Root-level array: [ { borehole: ... }, ... ]
    if (Array.isArray(json)) {
        return { items: json, isBatch: true };
    }
    return { items: [], isBatch: false };
}

/**
 * Process validated boreholes into well elements.
 * Cria elementos 'well' a partir de dados validados de sondagem.
 *
 * @param {Array} validResults - Array of validated borehole data objects
 * @returns {number} Number of elements created
 */
function _createWellElements(validResults) {
    let created = 0;
    for (const data of validResults) {
        const wellData = normalizeBoreholeToWell(data);
        const name = data.collar.hole_id;
        addElement('well', null, name, wellData);
        created++;
    }
    return created;
}

// ----------------------------------------------------------------
// HANDLER FUNCTIONS
// ----------------------------------------------------------------

/**
 * Import borehole data from JSON file.
 * Abre file picker, valida e cria elementos well com litologia.
 */
function handleImportBorehole() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const json = JSON.parse(text);
            const { items, isBatch } = _normalizeInput(json);

            if (items.length === 0) {
                showToast(t('boreholeInvalid') + ': JSON format not recognized', 'error');
                return;
            }

            if (isBatch) {
                const batch = validateBoreholes(items);
                if (!batch.valid) {
                    // Show first error from batch
                    const firstErr =
                        batch.errors?.[0] || batch.results.find((r) => !r.valid)?.errors?.[0] || t('boreholeInvalid');
                    showToast(firstErr, 'error');
                    return;
                }
                const validData = batch.results.map((r) => r.data);
                const count = _createWellElements(validData);
                if (_updateAllUI) _updateAllUI();
                showToast(`${count} ${t('boreholesImported')}`, 'success');
            } else {
                const result = validateBorehole(items[0]);
                if (!result.valid) {
                    showToast(result.errors[0], 'error');
                    return;
                }
                _createWellElements([result.data]);
                if (_updateAllUI) _updateAllUI();
                showToast(t('boreholeImported'), 'success');
            }
        } catch (err) {
            console.error('Borehole import error:', err);
            showToast(`${t('importFailed')}: ${err.message}`, 'error');
        }
    };
    input.click();
}

/**
 * Validate borehole JSON file without creating elements (dry-run).
 * Apenas valida e mostra resultado — nao cria elementos.
 */
function handleValidateBorehole() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const json = JSON.parse(text);
            const { items, isBatch } = _normalizeInput(json);

            if (items.length === 0) {
                showToast(t('boreholeInvalid') + ': JSON format not recognized', 'error');
                return;
            }

            if (isBatch) {
                const batch = validateBoreholes(items);
                if (batch.valid) {
                    showToast(`${t('boreholeValid')} (${items.length} boreholes)`, 'success');
                } else {
                    const firstErr =
                        batch.errors?.[0] || batch.results.find((r) => !r.valid)?.errors?.[0] || t('boreholeInvalid');
                    showToast(firstErr, 'error');
                }
            } else {
                const result = validateBorehole(items[0]);
                if (result.valid) {
                    showToast(t('boreholeValid'), 'success');
                } else {
                    showToast(result.errors[0], 'error');
                }
            }
        } catch (err) {
            console.error('Borehole validation error:', err);
            showToast(`${t('boreholeInvalid')}: ${err.message}`, 'error');
        }
    };
    input.click();
}

/**
 * Import borehole data from JSON text (programmatic / API).
 * Usado pelo bridge de automacao e integracao LLM.
 *
 * @param {string} jsonText - Raw JSON string
 * @returns {{ success: boolean, created?: number, errors?: string[] }}
 */
function handleImportBoreholeFromText(jsonText) {
    try {
        const json = JSON.parse(jsonText);
        const { items, isBatch } = _normalizeInput(json);

        if (items.length === 0) {
            return { success: false, errors: ['JSON format not recognized'] };
        }

        if (isBatch) {
            const batch = validateBoreholes(items);
            if (!batch.valid) {
                const errors = batch.errors || batch.results.filter((r) => !r.valid).flatMap((r) => r.errors);
                return { success: false, errors };
            }
            const validData = batch.results.map((r) => r.data);
            const count = _createWellElements(validData);
            if (_updateAllUI) _updateAllUI();
            return { success: true, created: count };
        } else {
            const result = validateBorehole(items[0]);
            if (!result.valid) {
                return { success: false, errors: result.errors };
            }
            _createWellElements([result.data]);
            if (_updateAllUI) _updateAllUI();
            return { success: true, created: 1 };
        }
    } catch (err) {
        return { success: false, errors: [err.message] };
    }
}

// ----------------------------------------------------------------
// EXPORTS
// ----------------------------------------------------------------

export const boreholeHandlers = {
    handleImportBorehole,
    handleValidateBorehole,
    handleImportBoreholeFromText,
};
