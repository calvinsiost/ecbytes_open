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
   FILTER PRESETS — Subconjuntos reutilizaveis de dados para relatorios
   Gerenciador de filter presets globais ao modelo

   Cada preset define um conjunto de filtros { dimension, operator, value }
   que reutilizam o padrao do Calculator Engine. Presets podem ser
   referenciados por metric anchors nos relatorios para gerar tabelas
   e figuras filtradas no export PDF/DOCX.

   Persistencia via localStorage + export/import do modelo.
   ================================================================ */

import { isEphemeral, safeSetItem } from '../storage/storageMonitor.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

const STORAGE_KEY = 'ecbyts-filter-presets';
const MAX_PRESETS = 30;

/** @type {Array<Object>} */
let presets = [];

/** @type {number} Monotonic counter for preset IDs */
let presetCounter = 0;

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Initialize filter presets from localStorage.
 * Carrega presets salvos ou inicia vazio.
 */
export function initFilterPresets() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            presets = Array.isArray(parsed.presets) ? parsed.presets : [];
            presetCounter = parsed.counter || 0;
        }
    } catch (e) {
        console.error('Failed to load filter presets:', e);
    }
}

// ----------------------------------------------------------------
// PERSISTENCE
// ----------------------------------------------------------------

/** @private */
function _persist() {
    safeSetItem(
        STORAGE_KEY,
        JSON.stringify({
            presets,
            counter: presetCounter,
        }),
    );
    window.dispatchEvent(new CustomEvent('filterPresetsChanged'));
}

// ----------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------

/**
 * Get all presets.
 * @returns {Array}
 */
export function getAllPresets() {
    return [...presets];
}

/**
 * Get preset by ID.
 * @param {string} id
 * @returns {Object|undefined}
 */
export function getPresetById(id) {
    return presets.find((p) => p.id === id);
}

/**
 * Add a new filter preset.
 * @param {Object} data - { name, description?, color?, filters: [{dimension, operator, value}] }
 * @returns {Object|null} Created preset or null if limit reached
 */
export function addPreset(data) {
    if (presets.length >= MAX_PRESETS) return null;

    presetCounter++;
    const preset = {
        id: `fp-${presetCounter}`,
        name: data.name || 'Filter',
        description: data.description || '',
        color: data.color || '#4CAF50',
        filters: Array.isArray(data.filters) ? data.filters : [],
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
    };
    presets.push(preset);
    _persist();
    return preset;
}

/**
 * Update an existing preset.
 * @param {string} id
 * @param {Object} data - Partial update { name?, description?, color?, filters? }
 * @returns {boolean}
 */
export function updatePreset(id, data) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return false;

    if (data.name !== undefined) preset.name = data.name;
    if (data.description !== undefined) preset.description = data.description;
    if (data.color !== undefined) preset.color = data.color;
    if (Array.isArray(data.filters)) preset.filters = data.filters;
    preset.modified = new Date().toISOString();

    _persist();
    return true;
}

/**
 * Remove a preset.
 * @param {string} id
 * @returns {boolean}
 */
export function removePreset(id) {
    const idx = presets.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    presets.splice(idx, 1);
    _persist();
    return true;
}

// ----------------------------------------------------------------
// FILTER APPLICATION
// Aplica os filtros de um preset a um conjunto de elementos/observacoes
// ----------------------------------------------------------------

/**
 * Apply preset filters to elements.
 * Reutiliza o padrao do Calculator Engine: { dimension, operator, value }
 *
 * @param {string} presetId
 * @param {Array} elements - Array of elements [{id, family, familyId, ...}]
 * @returns {Array} Filtered elements
 */
export function applyPresetToElements(presetId, elements) {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset || !preset.filters.length) return elements;

    let filtered = [...elements];
    for (const filter of preset.filters) {
        filtered = _applyElementFilter(filtered, filter);
    }
    return filtered;
}

/**
 * Apply preset filters to observations.
 * @param {string} presetId
 * @param {Array} observations
 * @returns {Array} Filtered observations
 */
export function applyPresetToObservations(presetId, observations) {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset || !preset.filters.length) return observations;

    let filtered = [...observations];
    for (const filter of preset.filters) {
        filtered = _applyObservationFilter(filtered, filter);
    }
    return filtered;
}

/**
 * Count how many elements match a preset.
 * @param {string} presetId
 * @param {Array} elements
 * @returns {number}
 */
export function countPresetMatches(presetId, elements) {
    return applyPresetToElements(presetId, elements).length;
}

// ----------------------------------------------------------------
// INTERNAL FILTER LOGIC
// Espelha Calculator Engine sem dependencia circular
// ----------------------------------------------------------------

/** @private */
function _matchFilter(items, accessor, operator, value) {
    const vals = Array.isArray(value) ? value : [value];
    switch (operator) {
        case 'is':
            return items.filter((item) => vals.includes(accessor(item)));
        case 'is_not':
            return items.filter((item) => !vals.includes(accessor(item)));
        case 'in':
            return items.filter((item) => vals.includes(accessor(item)));
        case 'not_in':
            return items.filter((item) => !vals.includes(accessor(item)));
        default:
            return items;
    }
}

/** @private */
function _applyElementFilter(elements, filter) {
    const { dimension, operator, value } = filter;
    if (!value || (Array.isArray(value) && value.length === 0)) return elements;

    if (dimension === 'family') {
        return _matchFilter(elements, (el) => el.familyId || el.family, operator, value);
    }
    if (dimension === 'element') {
        return _matchFilter(elements, (el) => el.id, operator, value);
    }
    return elements;
}

/** @private */
function _applyObservationFilter(observations, filter) {
    const { dimension, operator, value } = filter;
    if (!value || (Array.isArray(value) && value.length === 0)) return observations;

    if (dimension === 'parameter') {
        return _matchFilter(observations, (o) => o.parameterId, operator, value);
    }
    if (dimension === 'campaign') {
        return _matchFilter(observations, (o) => o.campaignId, operator, value);
    }
    return observations;
}

// ----------------------------------------------------------------
// EXPORT / IMPORT
// ----------------------------------------------------------------

/**
 * Export presets for model serialization.
 * @returns {Object|null}
 */
export function exportPresets() {
    if (presets.length === 0) return null;
    return {
        presets: presets.map((p) => ({ ...p })),
        counter: presetCounter,
    };
}

/**
 * Import presets from model data.
 * @param {Object} data - { presets, counter }
 */
export function importPresets(data) {
    if (!data) return;
    presets = Array.isArray(data.presets) ? data.presets.map((p) => ({ ...p })) : [];
    presetCounter = data.counter || 0;
    _persist();
}

/**
 * Clear all presets.
 */
export function clearPresets() {
    presets = [];
    presetCounter = 0;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        /* ignore */
    }
    window.dispatchEvent(new CustomEvent('filterPresetsChanged'));
}
