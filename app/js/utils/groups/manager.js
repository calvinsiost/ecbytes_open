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
   GROUP MANAGER — Custom element & family grouping
   Gerenciador de grupos customizaveis para elementos e familias

   Dois conjuntos independentes de grupos:
   - elementGroups: organizam elementos no painel Elements
   - familyGroups: organizam familias no painel esquerdo

   Estado mantido em closure do modulo (mesmo padrao de ticker/manager).
   Persistencia via localStorage + export/import do modelo.
   ================================================================ */

import { generateId } from '../helpers/id.js';
import { isEphemeral, safeSetItem } from '../storage/storageMonitor.js';

// ----------------------------------------------------------------
// MODULE STATE
// Estado do modulo — closure privada
// ----------------------------------------------------------------

const STORAGE_KEY = 'ecbyts-groups';

/** @type {Object} */
let groupState = {
    elementGroups: [], // Grupos para elementos
    familyGroups: [], // Grupos para familias
    elementGroupMap: {}, // { elementId: groupId }
    familyGroupMap: {}, // { familyId: groupId }
    elementUngroupedCollapsed: false,
    familyUngroupedCollapsed: false,
};

// ----------------------------------------------------------------
// INITIALIZATION
// Carrega configuracao salva no localStorage
// ----------------------------------------------------------------

/**
 * Initialize groups from localStorage.
 * Carrega configuracao salva ou cria estado padrao.
 */
export function initGroups() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            // Compatibilidade: se tem `groups` antigo, migra para elementGroups
            groupState = {
                elementGroups: Array.isArray(parsed.elementGroups)
                    ? parsed.elementGroups
                    : Array.isArray(parsed.groups)
                      ? parsed.groups
                      : [],
                familyGroups: Array.isArray(parsed.familyGroups) ? parsed.familyGroups : [],
                elementGroupMap: parsed.elementGroupMap || {},
                familyGroupMap: parsed.familyGroupMap || {},
                elementUngroupedCollapsed: !!parsed.elementUngroupedCollapsed,
                familyUngroupedCollapsed: !!parsed.familyUngroupedCollapsed,
            };
        }
    } catch (e) {
        console.warn('[Groups] Erro ao carregar localStorage:', e.message);
    }
}

// ----------------------------------------------------------------
// STATE ACCESS — ELEMENT GROUPS
// ----------------------------------------------------------------

/**
 * Get all element groups sorted by order.
 * @returns {Array}
 */
export function getElementGroups() {
    return [...groupState.elementGroups].sort((a, b) => a.order - b.order);
}

/**
 * Get the group ID assigned to an element.
 * @param {string} elementId
 * @returns {string|null}
 */
export function getElementGroup(elementId) {
    return groupState.elementGroupMap[elementId] || null;
}

/**
 * Check if element ungrouped section is collapsed.
 * @returns {boolean}
 */
export function isElementUngroupedCollapsed() {
    return groupState.elementUngroupedCollapsed;
}

// ----------------------------------------------------------------
// STATE ACCESS — FAMILY GROUPS
// ----------------------------------------------------------------

/**
 * Get all family groups sorted by order.
 * @returns {Array}
 */
export function getFamilyGroups() {
    return [...groupState.familyGroups].sort((a, b) => a.order - b.order);
}

/**
 * Get the group ID assigned to a family.
 * @param {string} familyId
 * @returns {string|null}
 */
export function getFamilyGroup(familyId) {
    return groupState.familyGroupMap[familyId] || null;
}

/**
 * Check if family ungrouped section is collapsed.
 * @returns {boolean}
 */
export function isFamilyUngroupedCollapsed() {
    return groupState.familyUngroupedCollapsed;
}

// ----------------------------------------------------------------
// GENERIC GROUP LOOKUP
// ----------------------------------------------------------------

/**
 * Get a single group by ID (searches both lists).
 * @param {string} id
 * @returns {Object|undefined}
 */
export function getGroupById(id) {
    return groupState.elementGroups.find((g) => g.id === id) || groupState.familyGroups.find((g) => g.id === id);
}

// ----------------------------------------------------------------
// CRUD — ELEMENT GROUPS
// ----------------------------------------------------------------

/**
 * Add a new element group.
 * @param {{ name?: string, color?: string }} partial
 * @returns {Object}
 */
export function addElementGroup(partial = {}) {
    const maxOrder = groupState.elementGroups.reduce((max, g) => Math.max(max, g.order), -1);
    const group = {
        id: generateId('egrp'),
        name: partial.name || 'New Group',
        color: partial.color || _nextColor(groupState.elementGroups),
        collapsed: false,
        order: maxOrder + 1,
    };
    groupState.elementGroups.push(group);
    persist();
    dispatchChange();
    return group;
}

/**
 * Update an element group's properties.
 * @param {string} id
 * @param {Object} changes
 */
export function updateElementGroupProps(id, changes) {
    const group = groupState.elementGroups.find((g) => g.id === id);
    if (!group) return;
    Object.assign(group, changes);
    persist();
    dispatchChange();
}

/**
 * Remove an element group. Elements become ungrouped.
 * @param {string} id
 */
export function removeElementGroup(id) {
    groupState.elementGroups = groupState.elementGroups.filter((g) => g.id !== id);
    for (const [key, val] of Object.entries(groupState.elementGroupMap)) {
        if (val === id) delete groupState.elementGroupMap[key];
    }
    persist();
    dispatchChange();
}

/**
 * Toggle collapse state of an element group.
 * @param {string} id
 */
export function toggleElementGroupCollapsed(id) {
    const group = groupState.elementGroups.find((g) => g.id === id);
    if (group) {
        group.collapsed = !group.collapsed;
        persist();
        dispatchChange();
    }
}

/**
 * Toggle collapse of element ungrouped section.
 */
export function toggleElementUngroupedCollapsed() {
    groupState.elementUngroupedCollapsed = !groupState.elementUngroupedCollapsed;
    persist();
    dispatchChange();
}

// ----------------------------------------------------------------
// CRUD — FAMILY GROUPS
// ----------------------------------------------------------------

/**
 * Add a new family group.
 * @param {{ name?: string, color?: string }} partial
 * @returns {Object}
 */
export function addFamilyGroup(partial = {}) {
    const maxOrder = groupState.familyGroups.reduce((max, g) => Math.max(max, g.order), -1);
    const group = {
        id: generateId('fgrp'),
        name: partial.name || 'New Group',
        color: partial.color || _nextColor(groupState.familyGroups),
        collapsed: false,
        order: maxOrder + 1,
    };
    groupState.familyGroups.push(group);
    persist();
    dispatchChange();
    return group;
}

/**
 * Update a family group's properties.
 * @param {string} id
 * @param {Object} changes
 */
export function updateFamilyGroupProps(id, changes) {
    const group = groupState.familyGroups.find((g) => g.id === id);
    if (!group) return;
    Object.assign(group, changes);
    persist();
    dispatchChange();
}

/**
 * Remove a family group. Families become ungrouped.
 * @param {string} id
 */
export function removeFamilyGroup(id) {
    groupState.familyGroups = groupState.familyGroups.filter((g) => g.id !== id);
    for (const [key, val] of Object.entries(groupState.familyGroupMap)) {
        if (val === id) delete groupState.familyGroupMap[key];
    }
    persist();
    dispatchChange();
}

/**
 * Toggle collapse state of a family group.
 * @param {string} id
 */
export function toggleFamilyGroupCollapsed(id) {
    const group = groupState.familyGroups.find((g) => g.id === id);
    if (group) {
        group.collapsed = !group.collapsed;
        persist();
        dispatchChange();
    }
}

/**
 * Toggle collapse of family ungrouped section.
 */
export function toggleFamilyUngroupedCollapsed() {
    groupState.familyUngroupedCollapsed = !groupState.familyUngroupedCollapsed;
    persist();
    dispatchChange();
}

// ----------------------------------------------------------------
// ELEMENT ASSIGNMENT
// ----------------------------------------------------------------

/**
 * Assign an element to a group.
 * @param {string} elementId
 * @param {string} groupId
 */
export function setElementGroup(elementId, groupId) {
    if (!groupState.elementGroups.find((g) => g.id === groupId)) return;
    groupState.elementGroupMap[elementId] = groupId;
    persist();
    dispatchChange();
}

/**
 * Remove an element from its group.
 * @param {string} elementId
 */
export function clearElementGroup(elementId) {
    delete groupState.elementGroupMap[elementId];
    persist();
    dispatchChange();
}

// ----------------------------------------------------------------
// FAMILY ASSIGNMENT
// ----------------------------------------------------------------

/**
 * Assign a family to a group.
 * @param {string} familyId
 * @param {string} groupId
 */
export function setFamilyGroup(familyId, groupId) {
    if (!groupState.familyGroups.find((g) => g.id === groupId)) return;
    groupState.familyGroupMap[familyId] = groupId;
    persist();
    dispatchChange();
}

/**
 * Remove a family from its group.
 * @param {string} familyId
 */
export function clearFamilyGroup(familyId) {
    delete groupState.familyGroupMap[familyId];
    persist();
    dispatchChange();
}

// ----------------------------------------------------------------
// RANDOM GENERATION
// Gera grupos de exemplo para o modelo random
// ----------------------------------------------------------------

/**
 * Generate random element and family groups.
 * Cria grupos de exemplo e distribui elementos e familias entre eles.
 *
 * @param {Array} elements - All elements from getAllElements()
 * @param {Array} families - Enabled families from getEnabledFamilies()
 */
export function generateRandomGroups(elements, families) {
    // Limpa estado anterior
    groupState.elementGroups = [];
    groupState.familyGroups = [];
    groupState.elementGroupMap = {};
    groupState.familyGroupMap = {};
    groupState.elementUngroupedCollapsed = false;
    groupState.familyUngroupedCollapsed = false;

    // --- Element groups ---
    // Agrupa elementos por familia para criar grupos tematicos
    const ELEMENT_GROUP_DEFS = [
        { name: 'Monitoring Network', families: ['well', 'sensor'], color: '#3b82f6' },
        { name: 'Contamination', families: ['plume', 'waste'], color: '#ef4444' },
        { name: 'Water Bodies', families: ['lake', 'river', 'spring'], color: '#06b6d4' },
        { name: 'Infrastructure', families: ['building', 'tank'], color: '#f59e0b' },
        { name: 'Site Boundaries', families: ['boundary', 'area'], color: '#10b981' },
    ];

    for (const def of ELEMENT_GROUP_DEFS) {
        const matching = elements.filter((el) => def.families.includes(el.family));
        if (matching.length === 0) continue;

        const group = {
            id: generateId('egrp'),
            name: def.name,
            color: def.color,
            collapsed: false,
            order: groupState.elementGroups.length,
        };
        groupState.elementGroups.push(group);

        for (const el of matching) {
            groupState.elementGroupMap[el.id] = group.id;
        }
    }

    // --- Family groups ---
    const FAMILY_GROUP_DEFS = [
        { name: 'Monitoring', families: ['well', 'sensor', 'marker'], color: '#3b82f6' },
        { name: 'Hydrology', families: ['lake', 'river', 'spring', 'plume'], color: '#06b6d4' },
        { name: 'Infrastructure', families: ['building', 'tank', 'waste', 'area'], color: '#f59e0b' },
        { name: 'Spatial', families: ['boundary', 'strata'], color: '#10b981' },
    ];

    const familyIds = families.map((f) => f.id);
    for (const def of FAMILY_GROUP_DEFS) {
        const matching = def.families.filter((fid) => familyIds.includes(fid));
        if (matching.length === 0) continue;

        const group = {
            id: generateId('fgrp'),
            name: def.name,
            color: def.color,
            collapsed: false,
            order: groupState.familyGroups.length,
        };
        groupState.familyGroups.push(group);

        for (const fid of matching) {
            groupState.familyGroupMap[fid] = group.id;
        }
    }

    persist();
    // Sem dispatchChange — chamado antes de updateAllUI no init
}

// ----------------------------------------------------------------
// EXPORT / IMPORT
// ----------------------------------------------------------------

/**
 * Clear all groups and reset to empty state.
 * Limpa todos os grupos e reseta estado.
 */
export function clearGroups() {
    groupState = {
        elementGroups: [],
        familyGroups: [],
        elementGroupMap: {},
        familyGroupMap: {},
        elementUngroupedCollapsed: false,
        familyUngroupedCollapsed: false,
    };
    persist();
    dispatchChange();
}

/**
 * Export groups state for model serialization.
 * @returns {Object}
 */
export function exportGroups() {
    return JSON.parse(JSON.stringify(groupState));
}

/**
 * Import groups state from model.
 * @param {Object} config
 */
export function importGroups(config) {
    if (!config) return;
    groupState = {
        elementGroups: Array.isArray(config.elementGroups)
            ? config.elementGroups
            : Array.isArray(config.groups)
              ? config.groups
              : [],
        familyGroups: Array.isArray(config.familyGroups) ? config.familyGroups : [],
        elementGroupMap: config.elementGroupMap || {},
        familyGroupMap: config.familyGroupMap || {},
        elementUngroupedCollapsed: !!config.elementUngroupedCollapsed,
        familyUngroupedCollapsed: !!config.familyUngroupedCollapsed,
    };
    persist();
    dispatchChange();
}

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

function persist() {
    if (isEphemeral()) return;
    safeSetItem(STORAGE_KEY, JSON.stringify(groupState));
}

function dispatchChange() {
    window.dispatchEvent(new CustomEvent('groupsChanged'));
}

const GROUP_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

function _nextColor(groupList) {
    const usedColors = groupList.map((g) => g.color);
    return GROUP_COLORS.find((c) => !usedColors.includes(c)) || GROUP_COLORS[groupList.length % GROUP_COLORS.length];
}
