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
   JSON INSPECTOR — State Manager
   Gerenciador de estado do painel inspetor JSON.

   Controla visibilidade, largura, nos expandidos e busca.
   Persiste configuracao no localStorage para manter estado entre reloads.
   ================================================================ */

import { safeSetItem } from '../storage/storageMonitor.js';

const STORAGE_KEY = 'ecbyts-inspector';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

const state = {
    visible: false,
    width: 400,
    searchQuery: '',
    expandedPaths: {},
};

// ----------------------------------------------------------------
// PERSISTENCE
// ----------------------------------------------------------------

function persist() {
    try {
        safeSetItem(
            STORAGE_KEY,
            JSON.stringify({
                visible: state.visible,
                width: state.width,
            }),
        );
    } catch (e) {
        // Ignore quota errors
    }
}

// ----------------------------------------------------------------
// INIT
// ----------------------------------------------------------------

/**
 * Initialize inspector state from localStorage.
 * Restaura estado do inspetor salvo no navegador.
 */
export function initInspector() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (typeof parsed.visible === 'boolean') state.visible = parsed.visible;
            if (typeof parsed.width === 'number') state.width = Math.max(280, Math.min(600, parsed.width));
        }
    } catch (e) {
        console.warn('[Inspector] Failed to restore state:', e.message);
    }
}

// ----------------------------------------------------------------
// GETTERS / SETTERS
// ----------------------------------------------------------------

/**
 * Get current inspector configuration.
 * Retorna configuracao atual do inspetor (visibilidade, largura, busca, nos abertos).
 */
export function getInspectorConfig() {
    return {
        visible: state.visible,
        width: state.width,
        searchQuery: state.searchQuery,
        expandedPaths: state.expandedPaths,
    };
}

/**
 * Toggle or set inspector visibility.
 * Altera visibilidade do painel inspetor.
 */
export function setInspectorVisible(visible) {
    state.visible = !!visible;
    persist();
}

/**
 * Set inspector panel width.
 * Define largura do painel (min 280, max 600).
 */
export function setInspectorWidth(width) {
    state.width = Math.max(280, Math.min(600, width));
    persist();
}

/**
 * Set search query for filtering tree nodes.
 * Define texto de busca para filtrar nos da arvore.
 */
export function setSearchQuery(query) {
    state.searchQuery = query || '';
}

/**
 * Toggle expanded state of a node path.
 * Expande ou colapsa um no da arvore pelo caminho.
 */
export function toggleNodeExpanded(path) {
    if (state.expandedPaths[path]) {
        delete state.expandedPaths[path];
    } else {
        state.expandedPaths[path] = true;
    }
}

/**
 * Set a specific node path as expanded.
 * Marca um caminho como expandido sem alternar.
 */
export function setNodeExpanded(path, expanded) {
    if (expanded) {
        state.expandedPaths[path] = true;
    } else {
        delete state.expandedPaths[path];
    }
}

/**
 * Expand all nodes up to a given depth.
 * Expande todos os nos ate profundidade especificada.
 *
 * @param {Object} data - The data object to expand paths for
 * @param {number} [maxDepth=3] - Maximum depth to expand
 */
export function expandAll(data, maxDepth = 3) {
    state.expandedPaths = {};
    if (!data || typeof data !== 'object') return;
    _collectPaths(data, '', 0, maxDepth);
}

function _collectPaths(obj, prefix, depth, maxDepth) {
    if (depth >= maxDepth) return;
    const entries = Array.isArray(obj) ? obj.map((v, i) => [String(i), v]) : Object.entries(obj);
    for (const [key, value] of entries) {
        if (value && typeof value === 'object') {
            const path = prefix ? `${prefix}.${key}` : key;
            state.expandedPaths[path] = true;
            _collectPaths(value, path, depth + 1, maxDepth);
        }
    }
}

/**
 * Collapse all nodes.
 * Fecha todos os nos da arvore.
 */
export function collapseAll() {
    state.expandedPaths = {};
}

/**
 * Expand all ancestor paths so a given node becomes visible.
 * Expande todos os ancestrais de um caminho para torna-lo visivel.
 *
 * @param {string} path - Dot-separated path (e.g., "model.elements.3")
 */
export function expandPathTo(path) {
    const parts = path.split('.');
    let current = '';
    for (let i = 0; i < parts.length; i++) {
        current = current ? `${current}.${parts[i]}` : parts[i];
        state.expandedPaths[current] = true;
    }
}

// ----------------------------------------------------------------
// EXPORT / IMPORT (for model persistence)
// ----------------------------------------------------------------

export function exportInspector() {
    return {
        visible: state.visible,
        width: state.width,
    };
}

export function importInspector(data) {
    if (data && typeof data === 'object') {
        if (typeof data.visible === 'boolean') state.visible = data.visible;
        if (typeof data.width === 'number') state.width = Math.max(280, Math.min(600, data.width));
        persist();
    }
}
