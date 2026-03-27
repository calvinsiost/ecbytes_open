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
   DIFF HELPERS — Utility functions for structural comparison
   Funcoes auxiliares para comparacao estrutural de modelos

   FUNCOES:
   - deepEqual: Igualdade estrutural profunda
   - deepClone: Copia profunda segura para JSON
   - buildIdMap: Mapa indexado por ID para busca rapida
   - describePath: Descricao legivel de caminhos no modelo
   ================================================================ */

/**
 * Deep structural equality comparison.
 * Compara dois valores recursivamente, ignorando ordem de chaves.
 *
 * @param {*} a - First value
 * @param {*} b - Second value
 * @returns {boolean} - true if structurally equal
 */
export function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;

    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }

    if (typeof a === 'object') {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
            if (!deepEqual(a[key], b[key])) return false;
        }
        return true;
    }

    return false;
}

/**
 * Deep clone via JSON serialization.
 * Copia profunda segura — funciona para qualquer dado serializavel.
 *
 * @param {*} obj - Object to clone
 * @returns {*} - Deep copy
 */
export function deepClone(obj) {
    if (obj == null || typeof obj !== 'object') return obj;
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Build an ID-indexed Map from an array of objects.
 * Cria mapa indexado por ID para busca O(1).
 *
 * @param {Array<Object>} array - Array of objects with `id` property
 * @returns {Map<string, Object>} - Map keyed by id
 */
export function buildIdMap(array) {
    const map = new Map();
    if (!Array.isArray(array)) return map;
    for (const item of array) {
        if (item && item.id) {
            map.set(item.id, item);
        }
    }
    return map;
}

/**
 * Build an ID-indexed Map using a custom key field.
 * Util para elementos que usam campo diferente de 'id'.
 *
 * @param {Array<Object>} array - Array of objects
 * @param {string} keyField - Name of the key field
 * @returns {Map<string, Object>}
 */
export function buildIdMapByField(array, keyField) {
    const map = new Map();
    if (!Array.isArray(array)) return map;
    for (const item of array) {
        if (item && item[keyField] != null) {
            map.set(String(item[keyField]), item);
        }
    }
    return map;
}

/**
 * Describe a diff path in human-readable form.
 * Gera descricao legivel do caminho no modelo.
 *
 * @param {string[]} pathParts - Path segments
 * @returns {string} - Human-readable description
 *
 * @example
 * describePath(['elements', 'PM-01', 'data', 'coordinates', 'easting'])
 * // => "Element PM-01 > Coordinates > easting"
 */
export function describePath(pathParts) {
    if (!pathParts || pathParts.length === 0) return '';

    const labels = {
        project: 'Project',
        coordinate: 'Coordinates',
        families: 'Families',
        elements: 'Elements',
        edges: 'Edges',
        campaigns: 'Campaigns',
        scenes: 'Scenes',
        view: 'View',
        data: 'Data',
        coordinates: 'Position',
        construction: 'Construction',
        observations: 'Observations',
        stamps: 'Connections',
        financial: 'Financial',
        parties: 'Parties',
        disbursements: 'Disbursements',
        bonusMalus: 'Bonus/Malus',
        baseline: 'Baseline',
        planned: 'Planned',
        actual: 'Actual',
    };

    return pathParts.map((p) => labels[p] || p).join(' > ');
}

/**
 * Get the type label for a diff change.
 * Retorna rotulo do tipo de mudanca.
 *
 * @param {string} type - Change type code
 * @returns {string} - Human-readable label
 */
export function changeTypeLabel(type) {
    const labels = {
        added: 'Added',
        removed: 'Removed',
        modified: 'Modified',
        type_mismatch: 'Type Mismatch',
    };
    return labels[type] || type;
}

/**
 * Diff two flat objects and return list of changes.
 * Compara dois objetos simples campo a campo.
 *
 * @param {Object} objA - First object
 * @param {Object} objB - Second object
 * @param {string[]} basePath - Path prefix for context
 * @returns {Array<{path: string[], type: string, valueA: *, valueB: *}>}
 */
export function diffFlatObjects(objA, objB, basePath = []) {
    const changes = [];
    const allKeys = new Set([...Object.keys(objA || {}), ...Object.keys(objB || {})]);

    for (const key of allKeys) {
        const inA = objA != null && Object.prototype.hasOwnProperty.call(objA, key);
        const inB = objB != null && Object.prototype.hasOwnProperty.call(objB, key);
        const path = [...basePath, key];

        if (inA && !inB) {
            changes.push({ path, type: 'removed', valueA: objA[key], valueB: undefined });
        } else if (!inA && inB) {
            changes.push({ path, type: 'added', valueA: undefined, valueB: objB[key] });
        } else if (inA && inB) {
            const vA = objA[key];
            const vB = objB[key];

            if (typeof vA !== typeof vB) {
                changes.push({ path, type: 'type_mismatch', valueA: vA, valueB: vB });
            } else if (typeof vA === 'object' && vA !== null) {
                if (Array.isArray(vA) !== Array.isArray(vB)) {
                    changes.push({ path, type: 'type_mismatch', valueA: vA, valueB: vB });
                } else if (!deepEqual(vA, vB)) {
                    // Recurse into nested objects
                    const nested = diffFlatObjects(vA, vB, path);
                    changes.push(...nested);
                }
            } else if (vA !== vB) {
                changes.push({ path, type: 'modified', valueA: vA, valueB: vB });
            }
        }
    }

    return changes;
}
