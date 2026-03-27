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
   ECO1 MIGRATION v1 -> v2
   ================================================================

   v2 introduz campos de hierarquia espacial em cada elemento.
   Regras:
   - schemaVersion final = 2
   - cada elemento recebe hierarchy default, se ausente
   - objeto de entrada nao e mutado (runner ja clona)

   ================================================================ */

/**
 * Migra modelo ECO1 do schema v1 para v2.
 * / Migrate ECO1 model schema from v1 to v2.
 *
 * @param {Object} model - Modelo no formato v1
 * @returns {Object} Modelo migrado para v2
 */
export function migrateV1ToV2(model) {
    const next = model || {};
    const sourceElements = Array.isArray(next.elements) ? next.elements : [];

    next.elements = sourceElements.map((element, index) => {
        if (!element || typeof element !== 'object') {
            return element;
        }
        return _withDefaultHierarchy(element, index);
    });

    next.schemaVersion = 2;
    return next;
}

/**
 * Garante hierarchy valida em um elemento.
 * / Ensure valid default hierarchy on element.
 *
 * @param {Object} element - Elemento ECO1
 * @param {number} index - Posicao no array para order default
 * @returns {Object} Elemento com hierarchy normalizada
 */
function _withDefaultHierarchy(element, index) {
    const hierarchy = element.hierarchy && typeof element.hierarchy === 'object' ? element.hierarchy : {};

    return {
        ...element,
        hierarchy: {
            level: typeof hierarchy.level === 'string' ? hierarchy.level : 'element',
            parentId: typeof hierarchy.parentId === 'string' ? hierarchy.parentId : null,
            order: Number.isFinite(hierarchy.order) ? hierarchy.order : index,
        },
    };
}
