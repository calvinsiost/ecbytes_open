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
   HIERARCHY HANDLERS — Acoes de hierarquia espacial PDPL-U
   ================================================================

   Handlers para Project → Area → Zone → Element.
   Containers nao possuem mesh 3D — apenas organizam elementos.

   Padrao: chama funcao do manager + updateAllUI().
   ================================================================ */

import { addNewElement, setParent, getElementById } from '../../core/elements/manager.js';
import { CONFIG } from '../../config.js';

/** Funcao de atualizacao de UI — injetada por registerAllHandlers */
let _updateAllUI = () => {};

/**
 * Injeta a funcao de atualizacao de UI.
 * @param {Function} fn
 */
export function setHierarchyUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ----------------------------------------------------------------
// HANDLERS
// ----------------------------------------------------------------

/**
 * Move um elemento para um novo pai na hierarquia.
 * Chamado pelo drag-and-drop na lista de elementos.
 *
 * @param {string} elementId - ID do elemento a mover
 * @param {string|null} parentId - ID do novo pai, ou null para raiz
 */
function handleSetParent(elementId, parentId) {
    if (!CONFIG.FEATURES?.SPATIAL_HIERARCHY) return;
    const ok = setParent(elementId, parentId ?? null);
    if (ok) _updateAllUI();
}

/**
 * Adiciona um elemento container (site_project, site_area, site_zone).
 * Containers nao possuem mesh 3D e servem apenas para agrupar.
 *
 * @param {string} familyId - 'site_project' | 'site_area' | 'site_zone'
 */
function handleAddContainer(familyId) {
    if (!CONFIG.FEATURES?.SPATIAL_HIERARCHY) return;
    const allowed = ['site_project', 'site_area', 'site_zone'];
    if (!allowed.includes(familyId)) {
        console.warn(`[hierarchy] familyId inválido para container: ${familyId}`);
        return;
    }
    addNewElement(familyId);
    _updateAllUI();
}

/**
 * Alterna colapso visual de um container na lista de elementos.
 * Persiste estado em localStorage por ID do container.
 *
 * @param {string} containerId - ID do elemento container
 */
function handleToggleContainerCollapse(containerId) {
    const key = `ecbyts-container-collapsed-${containerId}`;
    const current = localStorage.getItem(key) === '1';
    if (current) {
        localStorage.removeItem(key);
    } else {
        localStorage.setItem(key, '1');
    }
    _updateAllUI();
}

export const hierarchyHandlers = {
    handleSetParent,
    handleAddContainer,
    handleToggleContainerCollapse,
};
