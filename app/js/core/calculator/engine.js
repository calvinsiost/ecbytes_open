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
   CALCULATOR ENGINE — Generic filter + metric + rule pipeline
   Motor de calculo generico para metricas, regras compostas e ratios

   Reutiliza o mesmo pattern do ticker/manager.js (2-stage filter)
   mas adiciona:
   - Dimensao 'variable' para filtrar por OBSERVATION_VARIABLES
   - Regras compostas (AND/OR com thresholds)
   - Ratios entre parametros
   ================================================================ */

import { getAllElements, getElementsByFamily } from '../elements/manager.js';
import { getAllCampaigns } from '../campaigns/manager.js';
import { findContainedElements } from '../../utils/edges/manager.js';
import { CONFIG } from '../../config.js';
import { convert } from '../units/converter.js';
import { descriptiveStats, mannKendall } from '../analytics/statistics.js';
import { getVariableValue, inferVariablesFromFamily } from './contextResolver.js';
import { getUserConstantById } from '../constants/manager.js';

// ----------------------------------------------------------------
// MAIN COMPUTE
// ----------------------------------------------------------------

/**
 * Compute a single calculator item against current model data.
 * Pipeline: element filters → obs filters (incl. variable) → calculation.
 *
 * @param {Object} item - CalculatorItem
 * @returns {{ value: number|null, text: string, details?: Object, error?: string }}
 */
export function computeCalculatorItem(item) {
    try {
        if (item.type === 'rule') return evaluateCompoundRule(item);
        if (item.type === 'ratio') return evaluateRatio(item);
        return evaluateMetric(item);
    } catch (e) {
        return { value: null, text: `${item.label || ''}[error]`, error: e.message };
    }
}

/**
 * Compute a calculator item scoped to a single element.
 * Avalia metrica/regra/ratio restrita a um unico elemento.
 * Usado pelo pipeline de treinamento da rede neural.
 *
 * @param {Object} item - CalculatorItem
 * @param {Object} element - Target element (needs .id)
 * @returns {number|null} Numeric result or null if no data
 */
export function computeCalculatorItemForElement(item, element) {
    // Guard: tipos multi-elemento ou sem observacoes nao suportam escopo per-element
    if (['hypothesis', 'background', 'mac_curve'].includes(item.type)) return null;
    try {
        const scopedItem = {
            ...item,
            filters: [
                { dimension: 'element', operator: 'is', value: element.id },
                ...(item.filters || []).filter((f) =>
                    ['parameter', 'campaign', 'category', 'variable'].includes(f.dimension),
                ),
            ],
        };
        const result = computeCalculatorItem(scopedItem);
        return result.value != null && !isNaN(result.value) ? result.value : null;
    } catch {
        return null;
    }
}

// ----------------------------------------------------------------
// METRIC EVALUATION
// ----------------------------------------------------------------

/**
 * Evaluate a standard metric (filter + calculate).
 */
function evaluateMetric(item) {
    const { observations } = applyFilters(item);

    // Extrai valores numericos com conversao de unidades
    const values = extractValues(observations, item.unitId);

    // Executa calculo
    const result = executeCalculation(item.calculation, values, item);

    // Formata
    const formatted = formatResult(result, item);

    // Aplica pos-processamento por constantes (array de operacoes sequenciais)
    const ppResult = applyPostProcessing(result.value, item.postProcessing, result.uncertainty);

    return {
        value: ppResult.value,
        uncertainty: ppResult.uncertainty,
        text: `${item.label || ''}${formatted}${item.suffix || ''}`,
        count: values.length,
        postProcessingNote: ppResult.note || undefined,
    };
}

// ----------------------------------------------------------------
// COMPOUND RULE EVALUATION
// ----------------------------------------------------------------

/**
 * Evaluate compound rule (AND/OR conditions) per element.
 * Retorna pass/fail por elemento com detalhes.
 *
 * @param {Object} item - CalculatorItem with type='rule' + conditions
 * @returns {{ value: number, text: string, details: Object }}
 */
function evaluateCompoundRule(item) {
    const conditions = item.conditions;
    if (!conditions || !conditions.conditions || conditions.conditions.length === 0) {
        return { value: null, text: `${item.label || ''}[no conditions]` };
    }

    const { elements, observations } = applyFilters(item);
    const logic = conditions.logic || 'AND';

    let passing = 0;
    let failing = 0;
    const elementResults = [];

    for (const el of elements) {
        const elObs = observations.filter((o) => o._elementId === el.id);
        if (elObs.length === 0) continue;

        const condResults = conditions.conditions.map((cond) => {
            const condObs = elObs.filter((o) => o.parameterId === cond.parameterId);
            if (condObs.length === 0) return null; // sem dados para esta condicao

            // Pega ultimo valor (mais recente)
            const sorted = [...condObs].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            let val = Number(sorted[0].value);

            // Converte unidade se necessario
            if (cond.thresholdUnit && sorted[0].unitId && sorted[0].unitId !== cond.thresholdUnit) {
                const cv = convert(val, sorted[0].unitId, cond.thresholdUnit);
                if (cv.success) val = cv.value;
            }

            return compareValue(val, cond.operator, cond.threshold);
        });

        // Remove nulls (sem dados)
        const evaluated = condResults.filter((r) => r !== null);
        if (evaluated.length === 0) continue;

        const pass = logic === 'AND' ? evaluated.every((r) => r) : evaluated.some((r) => r);

        if (pass) passing++;
        else failing++;
        elementResults.push({ elementId: el.id, name: el.name, pass });
    }

    const total = passing + failing;
    const pct = total > 0 ? ((passing / total) * 100).toFixed(1) : '—';

    return {
        value: total > 0 ? passing / total : null,
        text: `${item.label || ''}${passing}/${total} (${pct}%)`,
        details: { passing, failing, total, elementResults },
    };
}

// ----------------------------------------------------------------
// RATIO EVALUATION
// ----------------------------------------------------------------

/**
 * Evaluate parameter ratio (numerator / denominator).
 *
 * @param {Object} item - CalculatorItem with type='ratio' + ratio
 * @returns {{ value: number|null, text: string, details: Object }}
 */
function evaluateRatio(item) {
    const ratio = item.ratio;
    if (!ratio || !ratio.numeratorParameterId || !ratio.denominatorParameterId) {
        return { value: null, text: `${item.label || ''}[no ratio]` };
    }

    const { observations } = applyFilters(item);

    const numObs = observations.filter((o) => o.parameterId === ratio.numeratorParameterId);
    const denObs = observations.filter((o) => o.parameterId === ratio.denominatorParameterId);

    const numVals = numObs.map((o) => Number(o.value)).filter((v) => !isNaN(v));
    const denVals = denObs.map((o) => Number(o.value)).filter((v) => !isNaN(v));

    if (numVals.length === 0 || denVals.length === 0) {
        return { value: null, text: `${item.label || ''}—` };
    }

    const numMean = descriptiveStats(numVals).mean;
    const denMean = descriptiveStats(denVals).mean;

    if (denMean === 0) {
        return { value: null, text: `${item.label || ''}÷0` };
    }

    const ratioValue = numMean / denMean;
    const pass = ratio.threshold != null ? compareValue(ratioValue, ratio.operator || 'gt', ratio.threshold) : null;

    return {
        value: ratioValue,
        text: `${item.label || ''}${ratioValue.toFixed(item.precision || 2)}${item.suffix || ''}`,
        details: { numerator: numMean, denominator: denMean, pass },
    };
}

// ----------------------------------------------------------------
// FILTER PIPELINE
// 2-stage: element filters → observation filters (incl. variable)
// ----------------------------------------------------------------

/**
 * Apply all filters from a calculator item.
 * @returns {{ elements: Array, observations: Array }}
 */
function applyFilters(item) {
    let elements = getAllElements();

    // Stage 1: element-level filters
    const elFilters = (item.filters || []).filter((f) => ['family', 'element', 'area'].includes(f.dimension));
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
    const obsFilters = (item.filters || []).filter((f) =>
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

function applyElementFilter(elements, filter) {
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
// OBSERVATION FILTERS (incl. variable dimension)
// ----------------------------------------------------------------

function applyObservationFilter(observations, filter) {
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
        // Filtro generico por qualquer OBSERVATION_VARIABLE
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
// GENERIC FILTER MATCHER (same as ticker)
// ----------------------------------------------------------------

function matchFilter(items, accessor, operator, value) {
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
// CALCULATION (same calculations as ticker)
// ----------------------------------------------------------------

function executeCalculation(calculation, values, item) {
    const nums = values.map((v) => v.value);
    const uncs = values.map((v) => v.uncertainty);

    if (nums.length === 0 && calculation !== 'count') {
        return { value: null, uncertainty: null, label: '—' };
    }

    // Propagação de incerteza via RSS (Root Sum of Squares) — GUM
    const hasAnyUnc = uncs.some((u) => u != null);

    switch (calculation) {
        case 'sum': {
            const val = nums.reduce((a, b) => a + b, 0);
            // GUM: u_sum = sqrt(sum(u_i^2))
            const unc = hasAnyUnc ? Math.sqrt(uncs.reduce((s, u) => s + (u != null ? u * u : 0), 0)) : null;
            return { value: val, uncertainty: unc };
        }
        case 'average': {
            const stats = descriptiveStats(nums);
            // GUM: u_avg = sqrt(sum(u_i^2)) / n
            const n = nums.length;
            const unc =
                hasAnyUnc && n > 0 ? Math.sqrt(uncs.reduce((s, u) => s + (u != null ? u * u : 0), 0)) / n : null;
            return { value: stats.mean, uncertainty: unc };
        }
        case 'min': {
            const stats = descriptiveStats(nums);
            const minIdx = nums.indexOf(stats.min);
            return { value: stats.min, uncertainty: minIdx >= 0 ? (uncs[minIdx] ?? null) : null };
        }
        case 'max': {
            const stats = descriptiveStats(nums);
            const maxIdx = nums.indexOf(stats.max);
            return { value: stats.max, uncertainty: maxIdx >= 0 ? (uncs[maxIdx] ?? null) : null };
        }
        case 'count':
            return { value: nums.length, uncertainty: null };

        case 'latest': {
            const sorted = [...values].filter((v) => v.date).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            return {
                value: sorted.length > 0 ? sorted[0].value : null,
                uncertainty: sorted.length > 0 ? (sorted[0].uncertainty ?? null) : null,
            };
        }
        case 'change_pct': {
            const valsA = values.filter((v) => v.campaignId === item.campaignA).map((v) => v.value);
            const valsB = values.filter((v) => v.campaignId === item.campaignB).map((v) => v.value);
            if (valsA.length === 0 || valsB.length === 0) return { value: null, uncertainty: null, label: '—' };
            const meanA = descriptiveStats(valsA).mean;
            const meanB = descriptiveStats(valsB).mean;
            if (meanA === 0) return { value: null, uncertainty: null, label: '—' };
            return { value: ((meanB - meanA) / Math.abs(meanA)) * 100, uncertainty: null, isPct: true };
        }
        case 'trend': {
            if (nums.length < 4) return { value: null, uncertainty: null, label: '—' };
            const result = mannKendall(nums);
            const arrows = { increasing: '\u2191', decreasing: '\u2193', stable: '\u2192' };
            return {
                value: result.tau,
                uncertainty: null,
                label: `${arrows[result.trend] || '\u2192'} ${result.trend}`,
                isTrend: true,
            };
        }
        default:
            return { value: null, uncertainty: null, label: '?' };
    }
}

// ----------------------------------------------------------------
// VALUE EXTRACTION
// ----------------------------------------------------------------

function extractValues(observations, targetUnitId) {
    const values = [];
    for (const obs of observations) {
        if (obs.value == null || isNaN(obs.value)) continue;
        let v = Number(obs.value);
        let unc = null;
        if (obs.uncertainty != null && Number.isFinite(obs.uncertainty) && obs.uncertainty >= 0) {
            // Converter incerteza para absoluta na mesma unidade do valor
            unc = obs.uncertaintyType === 'relative' ? (Math.abs(v) * obs.uncertainty) / 100 : obs.uncertainty;
        }
        if (targetUnitId && obs.unitId && obs.unitId !== targetUnitId) {
            const result = convert(v, obs.unitId, targetUnitId);
            if (result.success) {
                // Escalar incerteza pelo mesmo fator de conversão
                if (unc != null) {
                    const factor = v !== 0 ? result.value / v : 1;
                    unc = unc * Math.abs(factor);
                }
                v = result.value;
            }
        }
        values.push({ value: v, date: obs.date, campaignId: obs.campaignId, uncertainty: unc });
    }
    return values;
}

// ----------------------------------------------------------------
// COMPARISON
// ----------------------------------------------------------------

function compareValue(val, operator, threshold) {
    switch (operator) {
        case 'gt':
            return val > threshold;
        case 'gte':
            return val >= threshold;
        case 'lt':
            return val < threshold;
        case 'lte':
            return val <= threshold;
        case 'eq':
            return val === threshold;
        case 'neq':
            return val !== threshold;
        default:
            return false;
    }
}

// ----------------------------------------------------------------
// POST-PROCESSING — apply user-defined constants to metric result
// Pos-processamento: aplica constantes do usuario ao resultado da metrica
// ----------------------------------------------------------------

/**
 * Apply a chain of post-processing operations using user constants.
 * Aplica cadeia de operacoes pos-calculo usando constantes do usuario.
 *
 * Regras:
 * - Execucao sequencial na ordem do array
 * - Divisao por zero: preserva valor anterior, emite console.warn
 * - constantId nao encontrado: step ignorado, emite console.warn
 *
 * @param {number|null} rawValue - Valor calculado pela metrica
 * @param {Array<{op: string, constantId: string}>} postProcessing
 * @returns {{ value: number|null, note: string|null }}
 */
function applyPostProcessing(rawValue, postProcessing, rawUncertainty) {
    if (!Array.isArray(postProcessing) || postProcessing.length === 0 || rawValue == null) {
        return { value: rawValue, uncertainty: rawUncertainty ?? null, note: null };
    }

    let value = rawValue;
    let unc = rawUncertainty ?? null;
    const labels = [];

    for (const step of postProcessing) {
        const c = getUserConstantById(step.constantId);
        if (!c) {
            console.warn(`[ecbyts] postProcessing: constante '${step.constantId}' nao encontrada`);
            continue;
        }
        if (step.op === 'divide' && c.value === 0) {
            console.warn(`[ecbyts] postProcessing: divisao por zero ignorada (${c.symbol})`);
            continue;
        }

        // Incerteza absoluta da constante
        let cUnc = null;
        if (c.uncertainty != null && c.uncertainty > 0) {
            cUnc = c.uncertaintyType === 'relative' ? (Math.abs(c.value) * c.uncertainty) / 100 : c.uncertainty;
        }

        switch (step.op) {
            case 'multiply':
            case 'divide': {
                // GUM: u_rel_result = sqrt(u_rel_value^2 + u_rel_constant^2)
                const prevValue = value;
                value = step.op === 'multiply' ? value * c.value : value / c.value;
                if (unc != null || cUnc != null) {
                    const relV = unc != null && prevValue !== 0 ? unc / Math.abs(prevValue) : 0;
                    const relC = cUnc != null && c.value !== 0 ? cUnc / Math.abs(c.value) : 0;
                    const relCombined = Math.sqrt(relV * relV + relC * relC);
                    unc = relCombined * Math.abs(value);
                }
                break;
            }
            case 'add':
            case 'subtract': {
                // GUM: u_abs_result = sqrt(u_abs_value^2 + u_abs_constant^2)
                value = step.op === 'add' ? value + c.value : value - c.value;
                if (unc != null || cUnc != null) {
                    const uV = unc ?? 0;
                    const uC = cUnc ?? 0;
                    unc = Math.sqrt(uV * uV + uC * uC);
                }
                break;
            }
        }
        labels.push(`${_opSymbol(step.op)}${c.symbol}`);
    }

    return { value, uncertainty: unc, note: labels.length > 0 ? labels.join(' ') : null };
}

function _opSymbol(op) {
    switch (op) {
        case 'multiply':
            return '\u00d7';
        case 'divide':
            return '\u00f7';
        case 'add':
            return '+';
        case 'subtract':
            return '\u2212';
        default:
            return op;
    }
}

// ----------------------------------------------------------------
// FORMATTING
// ----------------------------------------------------------------

function formatResult(calcResult, item) {
    if (calcResult.label && calcResult.value == null) return calcResult.label;
    if (calcResult.isTrend) return calcResult.label;
    if (calcResult.isPct) {
        const sign = calcResult.value > 0 ? '+' : '';
        return `${sign}${calcResult.value.toFixed(item.precision || 2)}%`;
    }
    if (calcResult.value == null) return '—';
    return calcResult.value.toFixed(item.precision || 2);
}
