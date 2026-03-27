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
   CONTEXT RESOLVER — Generic variable-to-regulatory-context mapper
   Resolucao generica de variaveis de observacao para contexto regulatorio

   Nao hardcoda nenhum dominio — usa tabela de regras extensivel.
   Cada regra mapeia combinacao de variaveis + familia → chave regulatoria
   que e usada por validateObservationFull() em validation/rules.js.
   ================================================================ */

import { FAMILY_VARIABLES } from '../elements/randomModel.js';

// ----------------------------------------------------------------
// CONTEXT RULES — Tabela de mapeamento generica
// Cada regra: { match: { varId: valor }, context | familyMap }
// familyMap permite refinar por familia de elemento
// ----------------------------------------------------------------

const CONTEXT_RULES = [
    {
        match: { is_matrix_water: '1' },
        familyMap: {
            well: 'groundwater',
            spring: 'groundwater',
            sensor: 'groundwater',
            sample: 'groundwater',
            lake: 'surface_water',
            river: 'surface_water',
            effluent_point: 'surface_water',
            _default: 'groundwater',
        },
    },
    { match: { is_matrix_soil: '1' }, context: 'soil' },
    { match: { is_matrix_air: '1' }, context: 'air' },
    { match: { is_matrix_biota: '1' }, context: 'biota' },
    {
        match: { is_matrix_human: '1' },
        familyMap: {
            area: 'occupational',
            individual: 'occupational',
            _default: 'occupational',
        },
    },
    { match: { is_matrix_geotechnical: '1' }, context: 'geotechnical' },
    { match: { is_matrix_remote_sensing: '1' }, context: 'remote_sensing' },
    { match: { is_matrix_climatology: '1' }, context: 'climatology' },
    { match: { is_matrix_resilience: '1' }, context: 'resilience' },
];

// ----------------------------------------------------------------
// RESOLVE REGULATORY CONTEXT
// Dadas variaveis de observacao + familia, retorna chave regulatoria
// ----------------------------------------------------------------

/**
 * Resolve observation variables to a regulatory context string.
 * Itera regras em ordem, retorna primeiro match.
 * Fallback: infere de FAMILY_VARIABLES se obs nao tem variaveis.
 *
 * @param {Object} variables - obs.variables { is_matrix_water: { value: '1' }, ... }
 * @param {string} family - familia do elemento (well, lake, etc)
 * @returns {string} contexto regulatorio ('groundwater', 'soil', 'occupational', etc)
 */
export function resolveRegulatoryContext(variables, family) {
    const vars = normalizeVariables(variables);

    for (const rule of CONTEXT_RULES) {
        if (matchesRule(vars, rule.match)) {
            if (rule.context) return rule.context;
            if (rule.familyMap) {
                return rule.familyMap[family] || rule.familyMap._default || 'groundwater';
            }
        }
    }

    // Fallback: infere variaveis da familia e tenta novamente
    if (family && FAMILY_VARIABLES[family]) {
        const inferred = normalizeVariables(FAMILY_VARIABLES[family]);
        for (const rule of CONTEXT_RULES) {
            if (matchesRule(inferred, rule.match)) {
                if (rule.context) return rule.context;
                if (rule.familyMap) {
                    return rule.familyMap[family] || rule.familyMap._default || 'groundwater';
                }
            }
        }
    }

    return 'groundwater'; // ultimo recurso
}

/**
 * Infer default variables from element family.
 * Retorna variaveis padrao para uma familia (do randomModel FAMILY_VARIABLES).
 *
 * @param {string} family - familia do elemento
 * @returns {Object} variaveis { is_matrix_water: { value: '1', unit: 'adimensional' }, ... }
 */
export function inferVariablesFromFamily(family) {
    return FAMILY_VARIABLES[family] || {};
}

/**
 * Get the variable value from obs.variables.
 * Extrai valor de uma variavel, aceitando formato { value, unit } ou string simples.
 *
 * @param {Object} variables - obs.variables
 * @param {string} variableId - ex: 'is_matrix_water'
 * @returns {string} valor como string ('1', 'dissolved', etc) ou ''
 */
export function getVariableValue(variables, variableId) {
    if (!variables) return '';
    const v = variables[variableId];
    if (v == null) return '';
    if (typeof v === 'object') return String(v.value || '');
    return String(v);
}

// ----------------------------------------------------------------
// INTERNALS
// ----------------------------------------------------------------

/**
 * Normalize variables to flat { id: value_string } for matching.
 */
function normalizeVariables(variables) {
    if (!variables) return {};
    const flat = {};
    for (const [key, val] of Object.entries(variables)) {
        if (val == null) continue;
        flat[key] = typeof val === 'object' ? String(val.value || '') : String(val);
    }
    return flat;
}

/**
 * Check if flat variables match a rule's match criteria.
 */
function matchesRule(flatVars, matchCriteria) {
    for (const [key, expected] of Object.entries(matchCriteria)) {
        if (flatVars[key] !== expected) return false;
    }
    return true;
}
