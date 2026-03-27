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
   CONVERSOR DE UNIDADES (UNIT CONVERTER)
   ================================================================

   Motor de conversao entre unidades de medida.
   Suporta conversao via unidade base da dimensao.

   ALGORITMO:
   1. Converte valor origem para unidade base
   2. Converte de unidade base para destino

   CASOS ESPECIAIS:
   - Temperatura: usa offset alem de fator
   - Logaritmicas (dB): conversao nao-linear

   ================================================================ */

import { UNITS, getUnitById, areUnitsCompatible, formatWithUnit, getUnitsByDimension } from './catalog.js';

// ----------------------------------------------------------------
// CONVERSAO PRINCIPAL
// ----------------------------------------------------------------

/**
 * Converte valor entre unidades.
 * @param {number} value - Valor a converter
 * @param {string} fromUnitId - ID da unidade origem
 * @param {string} toUnitId - ID da unidade destino
 * @returns {{ value: number, success: boolean, error?: string }}
 */
export function convert(value, fromUnitId, toUnitId) {
    // Mesma unidade - retorna valor original
    if (fromUnitId === toUnitId) {
        return { value, success: true };
    }

    const fromUnit = getUnitById(fromUnitId);
    const toUnit = getUnitById(toUnitId);

    // Validar unidades
    if (!fromUnit) {
        return { value: null, success: false, error: `Unidade origem desconhecida: ${fromUnitId}` };
    }
    if (!toUnit) {
        return { value: null, success: false, error: `Unidade destino desconhecida: ${toUnitId}` };
    }

    // Verificar compatibilidade
    if (!areUnitsCompatible(fromUnitId, toUnitId)) {
        return {
            value: null,
            success: false,
            error: `Unidades incompativeis: ${fromUnit.dimension} -> ${toUnit.dimension}`,
        };
    }

    // Casos especiais
    if (fromUnit.dimension === 'temperature') {
        return convertTemperature(value, fromUnit, toUnit);
    }

    // Conversao padrao via unidade base
    // Passo 1: Converter para base (aplicar offset se existir, depois multiplicar)
    let baseValue = value;
    if (fromUnit.offset !== undefined) {
        baseValue = (value + fromUnit.offset) * fromUnit.toBase;
    } else {
        baseValue = value * fromUnit.toBase;
    }

    // Passo 2: Converter de base para destino
    let result;
    if (toUnit.offset !== undefined) {
        result = baseValue / toUnit.toBase - toUnit.offset;
    } else {
        result = baseValue / toUnit.toBase;
    }

    return { value: result, success: true };
}

/**
 * Converte temperatura entre escalas.
 * @param {number} value - Valor
 * @param {Object} fromUnit - Unidade origem
 * @param {Object} toUnit - Unidade destino
 * @returns {{ value: number, success: boolean }}
 */
function convertTemperature(value, fromUnit, toUnit) {
    // Primeiro converter para Celsius (base)
    let celsius;

    switch (fromUnit.id) {
        case 'celsius':
            celsius = value;
            break;
        case 'fahrenheit':
            celsius = (value - 32) * (5 / 9);
            break;
        case 'kelvin':
            celsius = value - 273.15;
            break;
        default:
            return { value: null, success: false, error: 'Unidade de temperatura desconhecida' };
    }

    // Depois converter de Celsius para destino
    let result;
    switch (toUnit.id) {
        case 'celsius':
            result = celsius;
            break;
        case 'fahrenheit':
            result = (celsius * 9) / 5 + 32;
            break;
        case 'kelvin':
            result = celsius + 273.15;
            break;
        default:
            return { value: null, success: false, error: 'Unidade de temperatura desconhecida' };
    }

    return { value: result, success: true };
}

// ----------------------------------------------------------------
// CONVERSAO EM LOTE
// ----------------------------------------------------------------

/**
 * Converte array de valores.
 * @param {number[]} values - Valores a converter
 * @param {string} fromUnitId - Unidade origem
 * @param {string} toUnitId - Unidade destino
 * @returns {{ values: number[], success: boolean, error?: string }}
 */
export function convertArray(values, fromUnitId, toUnitId) {
    if (fromUnitId === toUnitId) {
        return { values: [...values], success: true };
    }

    const results = [];
    for (const value of values) {
        const result = convert(value, fromUnitId, toUnitId);
        if (!result.success) {
            return { values: null, success: false, error: result.error };
        }
        results.push(result.value);
    }

    return { values: results, success: true };
}

/**
 * Converte objeto de observacoes.
 * @param {Object} observation - Observacao com value e unitId
 * @param {string} toUnitId - Unidade destino
 * @returns {Object} - Observacao convertida
 */
export function convertObservation(observation, toUnitId) {
    if (!observation.value || !observation.unitId) {
        return observation;
    }

    const result = convert(observation.value, observation.unitId, toUnitId);
    if (!result.success) {
        return observation;
    }

    return {
        ...observation,
        value: result.value,
        unitId: toUnitId,
        originalValue: observation.value,
        originalUnitId: observation.unitId,
    };
}

// ----------------------------------------------------------------
// FORMATACAO
// ----------------------------------------------------------------

/**
 * Converte e formata valor.
 * @param {number} value - Valor
 * @param {string} fromUnitId - Unidade origem
 * @param {string} toUnitId - Unidade destino
 * @param {number} precision - Casas decimais
 * @returns {string}
 */
export function convertAndFormat(value, fromUnitId, toUnitId, precision = 2) {
    const result = convert(value, fromUnitId, toUnitId);
    if (!result.success) {
        return formatWithUnit(value, fromUnitId, precision);
    }
    return formatWithUnit(result.value, toUnitId, precision);
}

// ----------------------------------------------------------------
// CONVERSOES ESPECIFICAS
// ----------------------------------------------------------------

/**
 * Converte taxa H&S entre bases (OSHA vs OIT).
 * @param {number} value - Valor
 * @param {string} fromBase - 'osha' (200k) ou 'oit' (1M)
 * @param {string} toBase - 'osha' ou 'oit'
 * @returns {number}
 */
export function convertHSRate(value, fromBase, toBase) {
    if (fromBase === toBase) return value;

    if (fromBase === 'osha' && toBase === 'oit') {
        // 200k -> 1M: multiplicar por 5
        return value * 5;
    } else if (fromBase === 'oit' && toBase === 'osha') {
        // 1M -> 200k: dividir por 5
        return value / 5;
    }

    return value;
}

/**
 * Converte emissoes usando GWP.
 * @param {number} value - Massa do gas
 * @param {string} gas - Tipo do gas (CO2, CH4, N2O)
 * @param {string} toUnitId - Unidade destino (tCO2e ou kgCO2e)
 * @returns {{ value: number, success: boolean }}
 */
export function convertToGHGEquivalent(value, gas, toUnitId = 'tCO2e') {
    // Global Warming Potentials (AR5)
    const GWP = {
        CO2: 1,
        CH4: 28,
        N2O: 265,
        HFCs: 1300, // Media simplificada
        PFCs: 7000, // Media simplificada
        SF6: 23500,
    };

    const gwp = GWP[gas];
    if (!gwp) {
        return { value: null, success: false, error: `Gas desconhecido: ${gas}` };
    }

    // Converter para tCO2e
    const tCO2e = value * gwp;

    // Converter para unidade destino se necessario
    if (toUnitId === 'kgCO2e') {
        return { value: tCO2e * 1000, success: true };
    }

    return { value: tCO2e, success: true };
}

// ----------------------------------------------------------------
// VALIDACAO
// ----------------------------------------------------------------

/**
 * Valida se valor esta dentro de faixa.
 * @param {number} value - Valor
 * @param {number} min - Minimo
 * @param {number} max - Maximo
 * @param {string} unitId - Unidade do valor
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateRange(value, min, max, unitId) {
    const unit = getUnitById(unitId);
    const symbol = unit?.symbol || unitId;

    if (value < min) {
        return {
            valid: false,
            message: `Valor ${value} ${symbol} abaixo do minimo ${min} ${symbol}`,
        };
    }

    if (value > max) {
        return {
            valid: false,
            message: `Valor ${value} ${symbol} acima do maximo ${max} ${symbol}`,
        };
    }

    return { valid: true };
}

/**
 * Normaliza valor para unidade base da dimensao.
 * @param {number} value - Valor
 * @param {string} unitId - Unidade atual
 * @returns {{ value: number, baseUnitId: string, success: boolean }}
 */
export function normalizeToBase(value, unitId) {
    const unit = getUnitById(unitId);
    if (!unit) {
        return { value: null, baseUnitId: null, success: false };
    }

    // Se ja e a unidade base
    if (unit.isBase) {
        return { value, baseUnitId: unitId, success: true };
    }

    // Encontrar unidade base
    const baseUnit = Object.values(UNITS).find((u) => u.dimension === unit.dimension && u.isBase);

    if (!baseUnit) {
        return { value: null, baseUnitId: null, success: false };
    }

    const result = convert(value, unitId, baseUnit.id);
    return {
        value: result.value,
        baseUnitId: baseUnit.id,
        success: result.success,
    };
}

// ----------------------------------------------------------------
// UTILITARIOS
// ----------------------------------------------------------------

/**
 * Calcula fator de conversao direta entre duas unidades.
 * @param {string} fromUnitId - Unidade origem
 * @param {string} toUnitId - Unidade destino
 * @returns {number|null}
 */
export function getConversionFactor(fromUnitId, toUnitId) {
    if (fromUnitId === toUnitId) return 1;

    const fromUnit = getUnitById(fromUnitId);
    const toUnit = getUnitById(toUnitId);

    if (!fromUnit || !toUnit) return null;
    if (!areUnitsCompatible(fromUnitId, toUnitId)) return null;

    // Nao funciona para temperatura (precisa de offset)
    if (fromUnit.dimension === 'temperature') return null;

    return fromUnit.toBase / toUnit.toBase;
}

/**
 * Formata valor com unidade automaticamente escolhida.
 * Escolhe a unidade que resulta em valor mais legivel.
 * @param {number} value - Valor
 * @param {string} unitId - Unidade atual
 * @param {Object} options - Opcoes
 * @returns {string}
 */
export function autoFormat(value, unitId, options = {}) {
    const unit = getUnitById(unitId);
    if (!unit) return `${value}`;

    const compatibleUnits = getUnitsByDimension(unit.dimension);
    if (compatibleUnits.length <= 1) {
        return formatWithUnit(value, unitId, options.precision || 2);
    }

    // Encontrar unidade que resulta em valor entre 1 e 1000
    for (const targetUnit of compatibleUnits) {
        const result = convert(value, unitId, targetUnit.id);
        if (result.success) {
            const absValue = Math.abs(result.value);
            if (absValue >= 1 && absValue < 1000) {
                return formatWithUnit(result.value, targetUnit.id, options.precision || 2);
            }
        }
    }

    // Fallback para unidade original
    return formatWithUnit(value, unitId, options.precision || 2);
}
