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
   FILTER PIPELINE — Reusable 2-stage filter + value extraction
   Pipeline reutilizavel de filtros para qualquer modulo analitico

   Extraido de engine.js para permitir reutilizacao por modulos
   standalone (hypothesis test, background analysis, MAC curve)
   sem depender do calculator engine completo.
   ================================================================ */

import { getAllElements } from '../elements/manager.js';
import { findContainedElements } from '../../utils/edges/manager.js';
import { CONFIG } from '../../config.js';
import { convert } from '../units/converter.js';
import { getVariableValue, inferVariablesFromFamily } from './contextResolver.js';

// ----------------------------------------------------------------
// MAIN FILTER PIPELINE
// 2-stage: element filters → observation filters (incl. variable)
// ----------------------------------------------------------------

/**
 * Apply all filters from a config object with filters[] array.
 * Pipeline 2-stage: element-level → observation-level.
 *
 * @param {{ filters: Array }} config - Object with filters array
 * @returns {{ elements: Array, observations: Array }}
 */
export function applyFilters(config) {
    let elements = getAllElements();

    // Stage 1: element-level filters
    const elFilters = (config.filters || []).filter((f) => ['family', 'element', 'area'].includes(f.dimension));
    for (const filter of elFilters) {
        elements = applyElementFilter(elements, filter);
    }

    // Collect observations from filtered elements
    let observations = [];
    for (const el of elements) {
        const obs = el.data?.observations || [];
        observations.push(
            ...obs.map((o) => ({
                ...o,
                _elementId: el.id,
                _elementName: el.name,
                _elementFamily: el.family,
                _variables: o.variables || inferVariablesFromFamily(el.family),
            })),
        );
    }

    // Stage 2: observation-level filters
    const obsFilters = (config.filters || []).filter((f) =>
        ['parameter', 'campaign', 'category', 'variable'].includes(f.dimension),
    );
    for (const filter of obsFilters) {
        observations = applyObservationFilter(observations, filter);
    }

    return { elements, observations };
}

// ----------------------------------------------------------------
// ELEMENT FILTERS
// ----------------------------------------------------------------

/**
 * Apply a single element-level filter.
 * @param {Array} elements
 * @param {Object} filter - { dimension, operator, value }
 * @returns {Array}
 */
export function applyElementFilter(elements, filter) {
    const { dimension, operator, value } = filter;
    if (!value || (Array.isArray(value) && value.length === 0)) return elements;

    if (dimension === 'family') {
        return matchFilter(elements, (el) => el.family, operator, value);
    }
    if (dimension === 'element') {
        return matchFilter(elements, (el) => el.id, operator, value);
    }
    if (dimension === 'area') {
        const areaIds = Array.isArray(value) ? value : [value];
        const containedIds = new Set();
        for (const areaId of areaIds) {
            for (const id of findContainedElements(areaId)) {
                containedIds.add(id);
            }
        }
        if (operator === 'is' || operator === 'in') {
            return elements.filter((el) => containedIds.has(el.id));
        }
        return elements.filter((el) => !containedIds.has(el.id));
    }
    return elements;
}

// ----------------------------------------------------------------
// OBSERVATION FILTERS
// ----------------------------------------------------------------

/**
 * Apply a single observation-level filter.
 * @param {Array} observations
 * @param {Object} filter - { dimension, operator, value, variableId? }
 * @returns {Array}
 */
export function applyObservationFilter(observations, filter) {
    const { dimension, operator, value } = filter;
    if (!value || (Array.isArray(value) && value.length === 0)) return observations;

    if (dimension === 'parameter') {
        return matchFilter(observations, (o) => o.parameterId, operator, value);
    }
    if (dimension === 'campaign') {
        return matchFilter(observations, (o) => o.campaignId, operator, value);
    }
    if (dimension === 'category') {
        return matchFilter(
            observations,
            (o) => {
                const param = CONFIG.PARAMETERS?.find((p) => p.id === o.parameterId);
                return param?.category || '';
            },
            operator,
            value,
        );
    }
    if (dimension === 'variable') {
        const varId = filter.variableId;
        if (!varId) return observations;
        return matchFilter(
            observations,
            (o) => {
                return getVariableValue(o._variables || o.variables, varId);
            },
            operator,
            value,
        );
    }
    return observations;
}

// ----------------------------------------------------------------
// GENERIC FILTER MATCHER
// ----------------------------------------------------------------

/**
 * Generic filter matcher — is/is_not/in/not_in.
 * @param {Array} items
 * @param {Function} accessor - extracts value from item
 * @param {string} operator
 * @param {*} value
 * @returns {Array}
 */
export function matchFilter(items, accessor, operator, value) {
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

// ----------------------------------------------------------------
// VALUE EXTRACTION (with unit conversion)
// ----------------------------------------------------------------

/**
 * Extract numeric values from observations with optional unit conversion.
 * Extrai valores numericos com conversao de unidade.
 *
 * @param {Array} observations
 * @param {string} [targetUnitId] - Target unit for conversion
 * @returns {Array<{ value: number, date: string, campaignId: string }>}
 */
export function extractValues(observations, targetUnitId) {
    const values = [];
    for (const obs of observations) {
        if (obs.value == null || isNaN(obs.value)) continue;
        let v = Number(obs.value);
        if (targetUnitId && obs.unitId && obs.unitId !== targetUnitId) {
            const result = convert(v, obs.unitId, targetUnitId);
            if (result.success) v = result.value;
        }
        values.push({ value: v, date: obs.date, campaignId: obs.campaignId });
    }
    return values;
}

/**
 * Build paired data for two campaigns.
 * Para cada elemento, extrai media de valores na campanha A e campanha B.
 * Usado por testes de hipotese pareados.
 *
 * @param {Array} elements - Filtered elements
 * @param {Array} observations - Filtered observations
 * @param {string} campaignA - Campaign A id
 * @param {string} campaignB - Campaign B id
 * @param {string} [unitId] - Target unit for conversion
 * @returns {Array<{ x: number, y: number, elementId: string, elementName: string }>}
 */
export function buildPairedData(elements, observations, campaignA, campaignB, unitId) {
    const pairs = [];
    for (const el of elements) {
        const elObs = observations.filter((o) => o._elementId === el.id);

        const obsA = elObs.filter((o) => o.campaignId === campaignA);
        const obsB = elObs.filter((o) => o.campaignId === campaignB);

        const valsA = extractValues(obsA, unitId).map((v) => v.value);
        const valsB = extractValues(obsB, unitId).map((v) => v.value);

        if (valsA.length === 0 || valsB.length === 0) continue;

        const meanA = valsA.reduce((a, b) => a + b, 0) / valsA.length;
        const meanB = valsB.reduce((a, b) => a + b, 0) / valsB.length;

        pairs.push({ x: meanA, y: meanB, elementId: el.id, elementName: el.name });
    }
    return pairs;
}
