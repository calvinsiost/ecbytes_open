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
   CONSTANTS MANAGER — User-defined constants registry
   Registro de constantes definidas pelo usuario (fatores de emissao,
   incertezas, precisao de equipamentos, fatores de conversao, etc.)

   Segue o mesmo padrao de calculator/manager.js:
   - Estado em closure do modulo
   - Persistencia em localStorage (Category B)
   - export/import integrado ao ECO1
   ================================================================ */

import { generateId } from '../../utils/helpers/id.js';
import { isEphemeral, safeSetItem } from '../../utils/storage/storageMonitor.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

const STORAGE_KEY = 'ecbyts_user_constants';
const SCHEMA_VERSION = 2;
const SYMBOL_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

let state = {
    constants: [],
};

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Initialize constants from localStorage.
 * Carrega estado salvo ou cria estado vazio.
 */
export function initConstants() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            let constants = Array.isArray(parsed.constants) ? parsed.constants : [];
            // Migration v1 → v2: adiciona campos de incerteza
            if (!parsed.version || parsed.version < 2) {
                constants = constants.map((c) => ({
                    ...c,
                    mutable: c.mutable !== false,
                    uncertainty: c.uncertainty ?? null,
                    uncertaintyType: c.uncertaintyType ?? null,
                    coverageFactor: c.coverageFactor ?? null,
                }));
            }
            state = { constants };
        }
    } catch (e) {
        console.warn('[Constants] Erro ao carregar localStorage:', e.message);
        state = { constants: [] };
    }
}

// ----------------------------------------------------------------
// PERSISTENCE
// ----------------------------------------------------------------

function _persist() {
    if (isEphemeral()) return;
    safeSetItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, constants: state.constants }));
}

// ----------------------------------------------------------------
// VALIDATION
// ----------------------------------------------------------------

/**
 * Validate a constant object before saving.
 * Valida campos obrigatorios, formato de symbol e unicidade.
 *
 * @param {Object} partial - Campos a validar
 * @param {string|null} existingId - ID atual (para validacao de unicidade em update)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateConstant(partial, existingId = null) {
    const errors = [];

    const name = (partial.name || '').trim();
    if (!name) errors.push('constantNameRequired');
    else if (name.length > 120) errors.push('constantNameTooLong');

    const symbol = (partial.symbol || '').trim();
    if (!symbol) errors.push('constantSymbolRequired');
    else if (!SYMBOL_REGEX.test(symbol)) errors.push('constantSymbolInvalid');
    else if (symbol.length > 32) errors.push('constantSymbolTooLong');
    else {
        // Unicidade case-sensitive — simbolos cientificos sao case-sensitive (CO2 != co2)
        const dup = state.constants.find((c) => c.symbol === symbol && c.id !== existingId);
        if (dup) errors.push('constantSymbolDuplicate');
    }

    const val = partial.value;
    if (val === undefined || val === null || val === '') {
        errors.push('constantValueRequired');
    } else if (!Number.isFinite(Number(val))) {
        errors.push('constantValueInvalid');
    }

    // Incerteza (opcional — se preenchido, type obrigatorio)
    const unc = partial.uncertainty;
    if (unc != null && unc !== '') {
        if (!Number.isFinite(Number(unc))) {
            errors.push('constantUncertaintyInvalid');
        } else if (Number(unc) < 0) {
            errors.push('constantUncertaintyNegative');
        }
        if (!partial.uncertaintyType || !['absolute', 'relative'].includes(partial.uncertaintyType)) {
            errors.push('constantUncertaintyTypeMissing');
        }
    }

    // Coverage factor (opcional — se preenchido, > 0)
    const cf = partial.coverageFactor;
    if (cf != null && cf !== '') {
        if (!Number.isFinite(Number(cf)) || Number(cf) <= 0) {
            errors.push('constantCoverageFactorInvalid');
        } else if (Number(cf) > 3) {
            console.warn('[Constants] Coverage factor k=%s is unusual (typical: 1-3). Saving anyway.', cf);
        }
    }

    return { valid: errors.length === 0, errors };
}

// ----------------------------------------------------------------
// SANITIZATION
// ----------------------------------------------------------------

/**
 * Sanitize a constant object — trim strings, cast types.
 * @param {Object} c
 * @returns {Object}
 */
function _sanitizeDate(val) {
    if (!val) return null;
    const s = String(val).trim();
    // Aceita YYYY-MM-DD ou ISO completo; retorna apenas a data (YYYY-MM-DD)
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
}

function _sanitize(c) {
    return {
        id: String(c.id || '').trim(),
        name: String(c.name || '')
            .trim()
            .slice(0, 120),
        symbol: String(c.symbol || '')
            .trim()
            .slice(0, 32),
        value: Number(c.value),
        unitId: String(c.unitId || '').trim(),
        category: String(c.category || 'custom').trim(),
        description: String(c.description || '')
            .trim()
            .slice(0, 500),
        source: String(c.source || '')
            .trim()
            .slice(0, 200),
        mutable: c.mutable !== false,
        validFrom: _sanitizeDate(c.validFrom),
        validTo: _sanitizeDate(c.validTo),
        uncertainty: c.uncertainty != null && Number.isFinite(Number(c.uncertainty)) ? Number(c.uncertainty) : null,
        uncertaintyType: ['absolute', 'relative'].includes(c.uncertaintyType) ? c.uncertaintyType : null,
        coverageFactor:
            c.coverageFactor != null && Number.isFinite(Number(c.coverageFactor)) && Number(c.coverageFactor) > 0
                ? Number(c.coverageFactor)
                : null,
        isDemo: Boolean(c.isDemo),
        createdAt: c.createdAt || new Date().toISOString(),
        updatedAt: c.updatedAt || new Date().toISOString(),
    };
}

// ----------------------------------------------------------------
// READ
// ----------------------------------------------------------------

/**
 * Get all user constants.
 * @returns {Object[]}
 */
export function getUserConstants() {
    return [...state.constants];
}

/**
 * Get a constant by its ID.
 * @param {string} id
 * @returns {Object|null}
 */
export function getUserConstantById(id) {
    return state.constants.find((c) => c.id === id) || null;
}

/**
 * Get a constant by its symbol (case-sensitive).
 * @param {string} symbol
 * @returns {Object|null}
 */
export function getUserConstantBySymbol(symbol) {
    return state.constants.find((c) => c.symbol === symbol) || null;
}

// ----------------------------------------------------------------
// CREATE
// ----------------------------------------------------------------

/**
 * Add a new user constant.
 * Adiciona uma nova constante apos validacao.
 *
 * @param {Object} partial - Campos da constante
 * @returns {{ constant: Object|null, errors: string[] }}
 */
export function addUserConstant(partial) {
    const { valid, errors } = validateConstant(partial);
    if (!valid) return { constant: null, errors };

    const now = new Date().toISOString();
    const constant = _sanitize({
        ...partial,
        id: generateId(),
        isDemo: Boolean(partial.isDemo),
        createdAt: now,
        updatedAt: now,
    });

    state.constants.push(constant);
    _persist();
    return { constant, errors: [] };
}

// ----------------------------------------------------------------
// UPDATE
// ----------------------------------------------------------------

/**
 * Update an existing user constant.
 * Atualiza campos de uma constante existente apos validacao.
 *
 * @param {string} id
 * @param {Object} changes
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function updateUserConstant(id, changes) {
    const idx = state.constants.findIndex((c) => c.id === id);
    if (idx === -1) return { ok: false, errors: ['notFound'] };

    const merged = { ...state.constants[idx], ...changes };
    const { valid, errors } = validateConstant(merged, id);
    if (!valid) return { ok: false, errors };

    state.constants[idx] = _sanitize({ ...merged, updatedAt: new Date().toISOString() });
    _persist();
    return { ok: true, errors: [] };
}

// ----------------------------------------------------------------
// DELETE
// ----------------------------------------------------------------

/**
 * Check which calculator metrics reference this constant.
 * Verifica dependencias da constante antes de remover.
 *
 * @param {string} id
 * @returns {Array<{ id: string, name: string }>}
 */
export function getConstantDependents(id) {
    try {
        // Import lazy para evitar dependencia circular
        const { getCalculatorItems } = window.__ecbyts_calculator || {};
        if (typeof getCalculatorItems !== 'function') return [];
        return getCalculatorItems()
            .filter(
                (item) => Array.isArray(item.postProcessing) && item.postProcessing.some((p) => p.constantId === id),
            )
            .map((item) => ({ id: item.id, name: item.label || item.type || item.id }));
    } catch {
        return [];
    }
}

/**
 * Remove a constant (only if no calculator dependents).
 * Remove uma constante se ela nao tiver dependencias ativas.
 *
 * @param {string} id
 * @returns {{ removed: boolean, dependents: Array }}
 */
export function removeUserConstant(id) {
    const dependents = getConstantDependents(id);
    if (dependents.length > 0) {
        return { removed: false, dependents };
    }
    state.constants = state.constants.filter((c) => c.id !== id);
    _persist();
    return { removed: true, dependents: [] };
}

/**
 * Remove a constant regardless of dependents (after user confirmation).
 * Remove uma constante mesmo com dependencias (apos confirmacao do usuario).
 *
 * @param {string} id
 */
export function forceRemoveUserConstant(id) {
    state.constants = state.constants.filter((c) => c.id !== id);
    _persist();
}

// ----------------------------------------------------------------
// DEMO HELPERS
// ----------------------------------------------------------------

/**
 * Generate 3 example constants with isDemo: true for demo mode.
 * Gera exemplos de constantes para demonstracao.
 */
export function generateRandomConstants() {
    const demos = [
        {
            name: 'Fator de Emissão CO2 - Energia Elétrica (Grid BR)',
            symbol: 'EF_CO2_grid_br',
            value: 0.0817,
            unitId: 'kg_kWh',
            category: 'emission',
            description: 'Fator de emissão médio para eletricidade da rede elétrica brasileira.',
            source: 'MCTI/SEPED 2023 — Fator de Emissão de CO2 da Rede Elétrica',
            uncertainty: 0.005,
            uncertaintyType: 'absolute',
            coverageFactor: 2,
            isDemo: true,
        },
        {
            name: 'Incerteza de Medição — Condutividade Elétrica (WTW Cond 3110)',
            symbol: 'U_cond_wtw3110',
            value: 0.5,
            unitId: 'pct',
            category: 'uncertainty',
            description: 'Incerteza expandida (k=2, 95%) do equipamento de condutividade WTW 3110.',
            source: 'Certificado de Calibração LABOCE 2024-0872',
            uncertainty: 10,
            uncertaintyType: 'relative',
            coverageFactor: 2,
            isDemo: true,
        },
        {
            name: 'Fator de Conversão Benzeno — mg/L para μg/L',
            symbol: 'FC_mgL_ugL',
            value: 1000,
            unitId: '',
            category: 'conversion',
            description: 'Fator de conversão de miligramas por litro para microgramas por litro (adimensional).',
            source: 'SI — Sistema Internacional de Unidades',
            isDemo: true,
        },
    ];

    for (const demo of demos) {
        // Apenas adiciona se symbol ainda nao existe
        if (!getUserConstantBySymbol(demo.symbol)) {
            addUserConstant(demo);
        }
    }
}

/**
 * Remove all demo constants (isDemo: true).
 * Remove todas as constantes marcadas como demo.
 */
export function clearDemoConstants() {
    state.constants = state.constants.filter((c) => !c.isDemo);
    _persist();
}

// ----------------------------------------------------------------
// EXPORT / IMPORT (ECO1 integration)
// ----------------------------------------------------------------

/**
 * Export constants for ECO1 serialization.
 * @returns {{ version: number, constants: Object[] }}
 */
export function exportConstants() {
    return { version: SCHEMA_VERSION, constants: [...state.constants] };
}

/**
 * Import constants from ECO1 model (defensive — validates each entry).
 * Importa constantes do modelo ECO1 com validacao defensiva.
 *
 * @param {Object} data - { version, constants }
 */
export function importConstants(data) {
    if (!data || !Array.isArray(data.constants)) {
        state = { constants: [] };
        return;
    }

    const valid = [];
    const rejected = [];

    for (const c of data.constants) {
        // Exige id e passa por validacao estrutural
        if (!c || typeof c.id !== 'string' || !c.id.trim()) {
            rejected.push({ symbol: c?.symbol, errors: ['missingId'] });
            continue;
        }
        const r = validateConstant(c, c.id);
        if (r.valid) {
            valid.push(_sanitize(c));
        } else {
            rejected.push({ symbol: c.symbol, errors: r.errors });
        }
    }

    if (rejected.length > 0) {
        console.warn('[ecbyts] constants import: itens rejeitados', rejected);
    }

    state = { constants: valid };
    _persist();
}
