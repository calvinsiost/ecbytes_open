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
   COST CENTER MANAGER — Centro de Custo e Alocacao de Rateio

   Funcionalidades:
   - CRUD de centros de custo (hierarquicos)
   - Orcamento por ano fiscal (capex, opex, total)
   - Alocacao de custos (elemento/campanha/projeto/WBS/contrato → CC)
   ================================================================ */

import { generateId } from '../helpers/id.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

const STORAGE_KEY = 'ecbyts-cost-centers-v1';
const ALLOCATION_KEY = 'ecbyts-cost-allocations-v1';

let _costCenters = [];
let _allocations = [];
let _loaded = false;

// ----------------------------------------------------------------
// PERSISTENCE
// ----------------------------------------------------------------

function _save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_costCenters));
        localStorage.setItem(ALLOCATION_KEY, JSON.stringify(_allocations));
    } catch (e) {
        console.warn('[CostCenterManager] Failed to save:', e.message);
    }
}

function _load() {
    if (_loaded) return;
    try {
        const ccData = localStorage.getItem(STORAGE_KEY);
        const allocData = localStorage.getItem(ALLOCATION_KEY);
        if (ccData) _costCenters = JSON.parse(ccData);
        if (allocData) _allocations = JSON.parse(allocData);
    } catch (e) {
        console.warn('[CostCenterManager] Failed to load:', e.message);
        _costCenters = [];
        _allocations = [];
    }
    _loaded = true;
}

// ----------------------------------------------------------------
// COST CENTER CRUD
// ----------------------------------------------------------------

/**
 * Add a new cost center.
 * @param {Object} data
 * @returns {Object} The created cost center
 */
export function addCostCenter(data = {}) {
    _load();
    const cc = {
        id: data.id || generateId('cc'),
        code: data.code || '',
        name: data.name || 'New Cost Center',
        type: data.type || 'custom',
        parentId: data.parentId || null,
        responsiblePerson: data.responsiblePerson || '',
        active: data.active !== false,
        budgets: data.budgets || [],
        createdAt: data.createdAt || new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
    };
    _costCenters.push(cc);
    _save();
    return cc;
}

/**
 * Get all cost centers.
 * @returns {Array}
 */
export function getCostCenters() {
    _load();
    return [..._costCenters];
}

/**
 * Get a single cost center by ID.
 * @param {string} id
 * @returns {Object|null}
 */
export function getCostCenter(id) {
    _load();
    return _costCenters.find((c) => c.id === id) || null;
}

/**
 * Update a cost center.
 * @param {string} id
 * @param {Object} updates
 * @returns {Object|null}
 */
export function updateCostCenter(id, updates = {}) {
    _load();
    const idx = _costCenters.findIndex((c) => c.id === id);
    if (idx === -1) return null;

    _costCenters[idx] = {
        ..._costCenters[idx],
        ...updates,
        modifiedAt: new Date().toISOString(),
    };
    _save();
    return _costCenters[idx];
}

/**
 * Remove a cost center and reassign children to parent.
 * @param {string} id
 * @returns {boolean}
 */
export function removeCostCenter(id) {
    _load();
    const cc = _costCenters.find((c) => c.id === id);
    if (!cc) return false;

    // Reassign children to parent
    const parentId = cc.parentId;
    for (const c of _costCenters) {
        if (c.parentId === id) {
            c.parentId = parentId;
        }
    }

    // Remove allocations referencing this CC
    _allocations = _allocations.filter((a) => a.costCenterId !== id);

    _costCenters = _costCenters.filter((c) => c.id !== id);
    _save();
    return true;
}

// ----------------------------------------------------------------
// TREE / HIERARCHY
// ----------------------------------------------------------------

/**
 * Build a tree structure from flat cost centers.
 * @returns {Array} Root nodes with children
 */
export function getCostCenterTree() {
    _load();
    const map = new Map();
    const roots = [];

    for (const cc of _costCenters) {
        map.set(cc.id, { ...cc, children: [] });
    }

    for (const cc of _costCenters) {
        const node = map.get(cc.id);
        if (cc.parentId && map.has(cc.parentId)) {
            map.get(cc.parentId).children.push(node);
        } else {
            roots.push(node);
        }
    }

    return roots;
}

// ----------------------------------------------------------------
// BUDGET
// ----------------------------------------------------------------

/**
 * Set budget for a cost center and fiscal year.
 * @param {string} costCenterId
 * @param {number} fiscalYear
 * @param {Object} budget
 * @returns {Object|null}
 */
export function setBudget(costCenterId, fiscalYear, budget = {}) {
    _load();
    const cc = _costCenters.find((c) => c.id === costCenterId);
    if (!cc) return null;

    const existingIdx = cc.budgets.findIndex((b) => b.fiscalYear === fiscalYear);
    const budgetEntry = {
        fiscalYear,
        budgetCapex: budget.budgetCapex || 0,
        budgetOpex: budget.budgetOpex || 0,
        budgetTotal: budget.budgetTotal || (budget.budgetCapex || 0) + (budget.budgetOpex || 0),
        notes: budget.notes || '',
    };

    if (existingIdx >= 0) {
        cc.budgets[existingIdx] = budgetEntry;
    } else {
        cc.budgets.push(budgetEntry);
    }

    cc.modifiedAt = new Date().toISOString();
    _save();
    return budgetEntry;
}

/**
 * Get budget for a cost center and fiscal year.
 * @param {string} costCenterId
 * @param {number} fiscalYear
 * @returns {Object|null}
 */
export function getBudget(costCenterId, fiscalYear) {
    _load();
    const cc = _costCenters.find((c) => c.id === costCenterId);
    if (!cc) return null;
    return cc.budgets.find((b) => b.fiscalYear === fiscalYear) || null;
}

// ----------------------------------------------------------------
// ALLOCATIONS (Rateio)
// ----------------------------------------------------------------

/**
 * Add a cost allocation.
 * @param {Object} data
 * @returns {Object}
 */
export function addAllocation(data = {}) {
    _load();
    const alloc = {
        id: data.id || generateId('ca'),
        sourceType: data.sourceType || '',
        sourceId: data.sourceId || '',
        costCenterId: data.costCenterId || '',
        percentage: Math.max(0, Math.min(100, data.percentage || 0)),
        notes: data.notes || '',
        createdAt: data.createdAt || new Date().toISOString(),
    };
    _allocations.push(alloc);
    _save();
    return alloc;
}

/**
 * Remove an allocation by ID.
 * @param {string} id
 * @returns {boolean}
 */
export function removeAllocation(id) {
    _load();
    const initialLen = _allocations.length;
    _allocations = _allocations.filter((a) => a.id !== id);
    if (_allocations.length !== initialLen) {
        _save();
        return true;
    }
    return false;
}

/**
 * Update an allocation.
 * @param {string} id
 * @param {Object} updates
 * @returns {Object|null}
 */
export function updateAllocation(id, updates = {}) {
    _load();
    const idx = _allocations.findIndex((a) => a.id === id);
    if (idx === -1) return null;

    if (updates.percentage !== undefined) {
        updates.percentage = Math.max(0, Math.min(100, updates.percentage));
    }

    _allocations[idx] = { ..._allocations[idx], ...updates };
    _save();
    return _allocations[idx];
}

/**
 * Get allocations for a specific source.
 * @param {string} sourceType
 * @param {string} sourceId
 * @returns {Array}
 */
export function getAllocationsForSource(sourceType, sourceId) {
    _load();
    return _allocations.filter((a) => a.sourceType === sourceType && a.sourceId === sourceId);
}

/**
 * Get all allocations.
 * @returns {Array}
 */
export function getAllAllocations() {
    _load();
    return [..._allocations];
}

/**
 * Validate that allocations for a source don't exceed 100%.
 * @param {string} sourceType
 * @param {string} sourceId
 * @param {Array} [newAllocs] - Optional new allocations to validate instead of stored
 * @returns {{ valid: boolean, total: number, excess: number }}
 */
export function validateAllocations(sourceType, sourceId, newAllocs = null) {
    const allocs = newAllocs || getAllocationsForSource(sourceType, sourceId);
    const total = allocs.reduce((sum, a) => sum + (a.percentage || 0), 0);
    return {
        valid: total <= 100,
        total,
        excess: Math.max(0, total - 100),
    };
}

// ----------------------------------------------------------------
// IMPORT / EXPORT
// ----------------------------------------------------------------

/**
 * Import cost centers and allocations from JSON.
 * @param {Object} data
 * @param {boolean} [merge=false] - Merge with existing or replace
 */
export function importCostCenters(data = {}, merge = false) {
    _load();
    if (!merge) {
        _costCenters = [];
        _allocations = [];
    }

    if (Array.isArray(data.costCenters)) {
        for (const c of data.costCenters) {
            const existing = _costCenters.find((cc) => cc.id === c.id);
            if (!existing) {
                _costCenters.push({
                    id: c.id || generateId('cc'),
                    code: c.code || '',
                    name: c.name || 'Imported Cost Center',
                    type: c.type || 'custom',
                    parentId: c.parentId || null,
                    responsiblePerson: c.responsiblePerson || '',
                    active: c.active !== false,
                    budgets: c.budgets || [],
                    createdAt: c.createdAt || new Date().toISOString(),
                    modifiedAt: new Date().toISOString(),
                });
            }
        }
    }

    if (Array.isArray(data.allocations)) {
        for (const a of data.allocations) {
            const existing = _allocations.find((al) => al.id === a.id);
            if (!existing) {
                _allocations.push({
                    id: a.id || generateId('ca'),
                    sourceType: a.sourceType || '',
                    sourceId: a.sourceId || '',
                    costCenterId: a.costCenterId || '',
                    percentage: Math.max(0, Math.min(100, a.percentage || 0)),
                    notes: a.notes || '',
                    createdAt: a.createdAt || new Date().toISOString(),
                });
            }
        }
    }

    _save();
}

/**
 * Clear all cost centers and allocations.
 */
export function clearCostCenters() {
    _load();
    _costCenters = [];
    _allocations = [];
    _save();
}

/**
 * Export all cost centers and allocations.
 * @returns {Object}
 */
export function exportCostCenters() {
    _load();
    return {
        costCenters: [..._costCenters],
        allocations: [..._allocations],
        exportedAt: new Date().toISOString(),
    };
}

// ----------------------------------------------------------------
// INIT
// ----------------------------------------------------------------

_load();
