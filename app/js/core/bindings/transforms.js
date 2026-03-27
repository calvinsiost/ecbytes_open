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
   BINDING TRANSFORMS — Funcoes de transformacao para bindings
   Aplicam operacoes ao valor resolvido antes de atribuir ao campo.

   Exemplo: profundidade do poco e positiva (20m), mas Three.js usa
   eixo Y negativo para baixo. O transform "negate" inverte o sinal.
   ================================================================ */

/**
 * Registry of transform functions.
 * Registro das funcoes de transformacao disponiveis.
 *
 * Each transform receives:
 * @param {*} value - Primary resolved value from targetPath
 * @param {Object} args - Transform-specific arguments (from transformArgs)
 * @param {Object} context - { targetObj, resolvePath } for secondary lookups
 * @returns {*} Transformed value
 */
const TRANSFORMS = {
    /**
     * Identity — returns value as-is.
     * Sem transformacao: retorna o valor exatamente como esta na fonte.
     */
    identity: (value) => value,

    /**
     * Negate — multiplies numeric value by -1.
     * Inverte o sinal: profundidade positiva → coordenada Z negativa.
     */
    negate: (value) => (typeof value === 'number' ? -value : value),

    /**
     * Midpoint — average of primary value and a second path value.
     * Calcula ponto medio entre dois valores (ex: topo e base da secao filtrante).
     *
     * Requires transformArgs.secondPath (dot-path resolved on same target object).
     */
    midpoint: (value, args, context) => {
        if (typeof value !== 'number' || !args?.secondPath || !context?.targetObj) {
            return value;
        }
        const second = context.resolvePath(context.targetObj, args.secondPath);
        if (typeof second !== 'number') {
            return value;
        }
        return (value + second) / 2;
    },

    /**
     * Offset — adds a fixed offset to the value.
     * Soma um deslocamento fixo (ex: ajuste de elevacao).
     *
     * Requires transformArgs.offset (number).
     */
    offset: (value, args) => {
        if (typeof value !== 'number') return value;
        return value + (args?.offset || 0);
    },
};

/**
 * Apply a named transform to a value.
 * Aplica a transformacao pelo nome. Se o nome nao existe, usa identity.
 *
 * @param {string} transformId - Transform name ('identity', 'negate', 'midpoint', 'offset')
 * @param {*} value - Raw resolved value
 * @param {Object} [args] - Transform arguments (from binding.transformArgs)
 * @param {Object} [context] - Resolution context { targetObj, resolvePath }
 * @returns {*} Transformed value
 */
export function applyTransform(transformId, value, args, context) {
    const fn = TRANSFORMS[transformId || 'identity'];
    if (!fn) {
        console.warn(`[Bindings] Unknown transform: "${transformId}", using identity`);
        return value;
    }
    return fn(value, args || {}, context || {});
}

/**
 * Get list of available transform IDs.
 * Retorna os nomes dos transforms disponiveis para UI/picker.
 *
 * @returns {string[]} Array of transform names
 */
export function getAvailableTransforms() {
    return Object.keys(TRANSFORMS);
}
