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
   CALCULATOR MANAGER — CRUD, persistence, import/export
   Gerenciador de metricas, regras compostas e ratios

   Segue o mesmo padrao de ticker/manager.js:
   - Estado em closure do modulo
   - Persistencia em localStorage + export/import do modelo
   - Eventos CustomEvent para notificar UI
   ================================================================ */

import { generateId } from '../../utils/helpers/id.js';
import { CONFIG } from '../../config.js';
import { getAllElements } from '../elements/manager.js';
import { getAllCampaigns } from '../campaigns/manager.js';
import { computeCalculatorItem } from './engine.js';
import { isEphemeral, safeSetItem } from '../../utils/storage/storageMonitor.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

const STORAGE_KEY = 'ecbyts-calculator';

let calculatorConfig = {
    items: [],
};

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Initialize calculator from localStorage.
 * Carrega estado salvo ou cria padrao vazio.
 */
export function initCalculator() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            calculatorConfig = { ...calculatorConfig, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.warn('[Calculator] Erro ao carregar localStorage:', e.message);
    }
}

// ----------------------------------------------------------------
// STATE ACCESS
// ----------------------------------------------------------------

/** @returns {Object[]} All calculator items */
export function getCalculatorItems() {
    return calculatorConfig.items;
}

/** @returns {Object|null} Single item by id */
export function getCalculatorItemById(id) {
    return calculatorConfig.items.find((item) => item.id === id) || null;
}

// ----------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------

/**
 * Add a new calculator item with defaults.
 * @param {Object} partial - campos opcionais
 * @returns {Object} novo item
 */
export function addCalculatorItem(partial = {}) {
    const item = {
        id: generateId('calc'),
        label: '',
        suffix: '',
        type: 'metric',
        filters: [],
        calculation: 'average',
        campaignA: null,
        campaignB: null,
        unitId: null,
        precision: 2,
        color: '',
        enabled: true,
        conditions: null,
        ratio: null,
        ...partial,
    };
    calculatorConfig.items.push(item);
    _persist();
    return item;
}

/**
 * Update fields of an existing item.
 * @param {string} id
 * @param {Object} changes
 */
export function updateCalculatorItem(id, changes) {
    const item = calculatorConfig.items.find((i) => i.id === id);
    if (!item) return;
    Object.assign(item, changes);
    _persist();
}

/**
 * Remove item by id.
 * @param {string} id
 */
export function removeCalculatorItem(id) {
    calculatorConfig.items = calculatorConfig.items.filter((i) => i.id !== id);
    _persist();
}

/**
 * Duplicate an item.
 * @param {string} id
 * @returns {Object|null}
 */
export function duplicateCalculatorItem(id) {
    const source = calculatorConfig.items.find((i) => i.id === id);
    if (!source) return null;
    const clone = {
        ...source,
        id: generateId('calc'),
        filters: source.filters.map((f) => ({ ...f })),
        conditions: source.conditions
            ? {
                  ...source.conditions,
                  conditions: source.conditions.conditions?.map((c) => ({ ...c })) || [],
              }
            : null,
        ratio: source.ratio ? { ...source.ratio } : null,
    };
    calculatorConfig.items.push(clone);
    _persist();
    return clone;
}

/**
 * Reorder item up or down.
 * @param {string} id
 * @param {'up'|'down'} direction
 */
export function reorderCalculatorItem(id, direction) {
    const idx = calculatorConfig.items.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= calculatorConfig.items.length) return;
    const tmp = calculatorConfig.items[idx];
    calculatorConfig.items[idx] = calculatorConfig.items[target];
    calculatorConfig.items[target] = tmp;
    _persist();
}

// ----------------------------------------------------------------
// FILTER CRUD (per item)
// ----------------------------------------------------------------

/**
 * Add filter to item.
 * @param {string} itemId
 * @param {Object} filter - { dimension, operator, value, variableId? }
 * @returns {Object|null}
 */
export function addCalculatorFilter(itemId, filter = {}) {
    const item = calculatorConfig.items.find((i) => i.id === itemId);
    if (!item) return null;
    const f = { dimension: 'parameter', operator: 'is', value: '', ...filter };
    item.filters.push(f);
    _persist();
    return f;
}

/**
 * Remove filter from item by index.
 */
export function removeCalculatorFilter(itemId, filterIndex) {
    const item = calculatorConfig.items.find((i) => i.id === itemId);
    if (!item) return;
    item.filters.splice(filterIndex, 1);
    _persist();
}

/**
 * Update a filter field.
 */
export function updateCalculatorFilter(itemId, filterIndex, field, value) {
    const item = calculatorConfig.items.find((i) => i.id === itemId);
    if (!item || !item.filters[filterIndex]) return;
    item.filters[filterIndex][field] = value;
    if (field === 'dimension') {
        item.filters[filterIndex].operator = 'is';
        item.filters[filterIndex].value = '';
        if (value !== 'variable') {
            delete item.filters[filterIndex].variableId;
        }
    }
    _persist();
}

// ----------------------------------------------------------------
// COMPUTE ALL
// ----------------------------------------------------------------

/**
 * Compute all enabled items.
 * @returns {Array<{ id, text, value, color, type, details? }>}
 */
export function computeAllCalculator() {
    return calculatorConfig.items
        .filter((item) => item.enabled)
        .map((item) => {
            const result = computeCalculatorItem(item);
            return {
                id: item.id,
                type: item.type,
                text: result.text,
                value: result.value,
                color: item.color || '',
                details: result.details || null,
                error: result.error || null,
            };
        });
}

// ----------------------------------------------------------------
// TEMPLATE METRICS — Read-only examples for statistical modules
// Metricas-exemplo para guiar o usuario
// ----------------------------------------------------------------

/**
 * Create read-only template metrics that serve as examples.
 * Cria metricas-modelo para o tipo de analise especificado.
 * Templates nao podem ser editados pelo usuario, apenas duplicados ou removidos.
 *
 * @param {'hypothesis'|'background'} analysisType - Tipo de analise
 */
export function createTemplateMetrics(analysisType) {
    const params = CONFIG.PARAMETERS || [];
    const elements = getAllElements();
    const campaigns = getAllCampaigns();
    const contaminant = params.find((p) => p.id === 'benzene') || params[0];
    if (!contaminant) return;

    // Remove templates existentes do mesmo tipo antes de recriar
    calculatorConfig.items = calculatorConfig.items.filter((i) => !(i.readonly && i._templateType === analysisType));

    if (analysisType === 'hypothesis' && campaigns.length >= 2) {
        addCalculatorItem({
            label: `[Template] Avg ${contaminant.name || contaminant.id} — Campaign 1`,
            type: 'metric',
            filters: [
                { dimension: 'family', operator: 'is', value: 'well' },
                { dimension: 'parameter', operator: 'is', value: contaminant.id },
                { dimension: 'campaign', operator: 'is', value: campaigns[0].id },
            ],
            calculation: 'average',
            unitId: contaminant.defaultUnitId || 'ug_L',
            color: '#8e44ad',
            readonly: true,
            _templateType: 'hypothesis',
        });
        addCalculatorItem({
            label: `[Template] Avg ${contaminant.name || contaminant.id} — Campaign ${campaigns.length}`,
            type: 'metric',
            filters: [
                { dimension: 'family', operator: 'is', value: 'well' },
                { dimension: 'parameter', operator: 'is', value: contaminant.id },
                { dimension: 'campaign', operator: 'is', value: campaigns[campaigns.length - 1].id },
            ],
            calculation: 'average',
            unitId: contaminant.defaultUnitId || 'ug_L',
            color: '#8e44ad',
            readonly: true,
            _templateType: 'hypothesis',
        });
    }

    if (analysisType === 'background') {
        const wells = elements.filter((e) => e.family === 'well');
        if (wells.length >= 4) {
            const half = Math.floor(wells.length / 2);
            const bgWellIds = wells.slice(0, half).map((w) => w.id);
            const cpWellIds = wells.slice(half).map((w) => w.id);

            addCalculatorItem({
                label: `[Template] Avg ${contaminant.name || contaminant.id} — Background Wells`,
                type: 'metric',
                filters: [
                    { dimension: 'element', operator: 'in', value: bgWellIds },
                    { dimension: 'parameter', operator: 'is', value: contaminant.id },
                ],
                calculation: 'average',
                unitId: contaminant.defaultUnitId || 'ug_L',
                color: '#16a085',
                readonly: true,
                _templateType: 'background',
            });
            addCalculatorItem({
                label: `[Template] Avg ${contaminant.name || contaminant.id} — Compliance Wells`,
                type: 'metric',
                filters: [
                    { dimension: 'element', operator: 'in', value: cpWellIds },
                    { dimension: 'parameter', operator: 'is', value: contaminant.id },
                ],
                calculation: 'average',
                unitId: contaminant.defaultUnitId || 'ug_L',
                color: '#d35400',
                readonly: true,
                _templateType: 'background',
            });
        }
    }

    _persist();
}

/**
 * Remove all template metrics.
 * Remove todas as metricas-modelo.
 */
export function clearTemplateMetrics() {
    calculatorConfig.items = calculatorConfig.items.filter((i) => !i.readonly);
    _persist();
}

// ----------------------------------------------------------------
// CLEAR / EXPORT / IMPORT
// ----------------------------------------------------------------

/** Remove all items */
export function clearCalculator() {
    calculatorConfig.items = [];
    _persist();
}

/**
 * Export calculator state for model.
 * @returns {Object}
 */
export function exportCalculator() {
    return {
        items: calculatorConfig.items.map((item) => ({
            ...item,
            filters: item.filters.map((f) => ({ ...f })),
            conditions: item.conditions
                ? {
                      ...item.conditions,
                      conditions: item.conditions.conditions?.map((c) => ({ ...c })) || [],
                  }
                : null,
            ratio: item.ratio ? { ...item.ratio } : null,
        })),
    };
}

/**
 * Import calculator state from model.
 * @param {Object} config
 */
export function importCalculator(config) {
    if (!config) return;
    calculatorConfig = {
        items: Array.isArray(config.items) ? config.items : [],
    };
    _persist();
}

// ----------------------------------------------------------------
// RANDOM GENERATION
// ----------------------------------------------------------------

/**
 * Generate random calculator items based on current model.
 * Cria 2-4 itens de exemplo com filtros e calculos variados.
 */
export function generateRandomCalculator() {
    const params = CONFIG.PARAMETERS || [];
    const elements = getAllElements();
    const campaigns = getAllCampaigns();
    if (params.length === 0 || elements.length === 0) return;

    const randChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const colors = ['#2d8a7a', '#e74c3c', '#3498db', '#f39c12', '#9b59b6', '#1abc9c'];

    // Metrica simples: media de benzene em pocos
    const wells = elements.filter((e) => e.family === 'well');
    if (wells.length > 0) {
        const contaminant = params.find((p) => p.id === 'benzene') || params[0];
        addCalculatorItem({
            label: `Avg ${contaminant.name || contaminant.id} `,
            type: 'metric',
            filters: [
                { dimension: 'family', operator: 'is', value: 'well' },
                { dimension: 'parameter', operator: 'is', value: contaminant.id },
                { dimension: 'variable', variableId: 'is_matrix_water', operator: 'is', value: '1' },
            ],
            calculation: 'average',
            unitId: contaminant.defaultUnitId || 'ug_L',
            precision: 2,
            color: randChoice(colors),
        });
    }

    // Regra composta: benzene > 5 AND/OR toluene > 700
    const benzene = params.find((p) => p.id === 'benzene');
    const toluene = params.find((p) => p.id === 'toluene');
    if (benzene && toluene) {
        addCalculatorItem({
            label: 'BTEX Compliance ',
            type: 'rule',
            filters: [{ dimension: 'family', operator: 'is', value: 'well' }],
            conditions: {
                logic: 'AND',
                conditions: [
                    { parameterId: 'benzene', operator: 'gt', threshold: 5, thresholdUnit: 'ug_L' },
                    { parameterId: 'toluene', operator: 'gt', threshold: 700, thresholdUnit: 'ug_L' },
                ],
            },
            color: randChoice(colors),
        });
    }

    // Ratio: benzene/toluene
    if (benzene && toluene) {
        addCalculatorItem({
            label: 'B/T Ratio ',
            type: 'ratio',
            filters: [{ dimension: 'family', operator: 'is', value: 'well' }],
            ratio: {
                numeratorParameterId: 'benzene',
                denominatorParameterId: 'toluene',
                operator: 'gt',
                threshold: 0.02,
            },
            precision: 3,
            color: randChoice(colors),
        });
    }

    // Tendencia: contagem de observacoes por campanha
    if (campaigns.length >= 2) {
        addCalculatorItem({
            label: 'Obs Count ',
            type: 'metric',
            filters: [],
            calculation: 'count',
            color: randChoice(colors),
        });
    }
}

// ----------------------------------------------------------------
// PERSISTENCE
// ----------------------------------------------------------------

function _persist() {
    if (isEphemeral()) return;
    safeSetItem(STORAGE_KEY, JSON.stringify(calculatorConfig));
}
