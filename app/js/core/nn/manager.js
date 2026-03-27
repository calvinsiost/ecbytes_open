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
   NEURAL NETWORK MANAGER — Registry of named NN instances
   ================================================================

   Gerenciador central de redes neurais do sistema. Permite que
   qualquer modulo registre, treine e persista suas proprias
   redes neurais com identificadores unicos.

   Padroes seguidos:
   - Closure de estado (como ticker/manager.js)
   - CustomEvent para notificacao (nnChanged)
   - localStorage para persistencia local
   - Export/import no modelo ECO

   ================================================================ */

import { SimpleNN } from './network.js';
import { isEphemeral } from '../../utils/storage/storageMonitor.js';
import { idbSet, idbGetWithLegacy } from '../../utils/storage/idbStore.js';
import { showToast } from '../../utils/ui/toast.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

const STORAGE_KEY = 'ecbyts-nn';

/** @type {Map<string, { nn: SimpleNN, metadata: Object }>} */
const _instances = new Map();

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

/**
 * Dispatch change event for UI updates.
 * Notifica o sistema que redes neurais mudaram.
 */
function _dispatchChange() {
    window.dispatchEvent(new CustomEvent('nnChanged'));
}

/**
 * Build config object from a SimpleNN instance.
 * Constroi objeto de configuracao para persistencia.
 *
 * @param {SimpleNN} nn
 * @returns {Object}
 */
function _buildConfig(nn) {
    return {
        inputSize: nn.inputSize,
        hiddenLayerSizes: nn.hiddenLayerSizes,
        hiddenSize: nn.hiddenLayerSizes[0], // backward compat
        outputSize: nn.outputSize,
        classNames: nn.classNames,
        mode: nn.mode || 'classification',
    };
}

/**
 * Persist all networks to IndexedDB (fire-and-forget).
 * Salva estado de todas as redes no IndexedDB.
 */
async function _persistAll() {
    if (isEphemeral()) return;
    const data = {};
    for (const [id, entry] of _instances) {
        data[id] = {
            config: _buildConfig(entry.nn),
            metadata: entry.metadata,
            state: entry.nn.toJSON(),
        };
    }
    const ok = await idbSet(STORAGE_KEY, data);
    if (!ok) showToast('Storage full. Neural network data may not persist.', 'warning');
}

/**
 * Migrate old config format to new format.
 * Se config tem hiddenSize mas nao hiddenLayerSizes, cria array.
 *
 * @param {Object} config
 * @returns {Object}
 */
function _migrateConfig(config) {
    if (!config.hiddenLayerSizes && config.hiddenSize) {
        config.hiddenLayerSizes = [config.hiddenSize];
    }
    return config;
}

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Initialize NN manager from IndexedDB (migra do localStorage se necessário).
 * Restaura redes neurais salvas e recria instancias SimpleNN.
 */
export async function initNN() {
    try {
        const data = await idbGetWithLegacy(STORAGE_KEY);
        if (!data || typeof data !== 'object') return;

        for (const [id, entry] of Object.entries(data)) {
            if (!entry.config) continue;
            const config = _migrateConfig(entry.config);
            const nn = new SimpleNN(config);
            if (entry.state) nn.fromJSON(entry.state);
            _instances.set(id, {
                nn,
                metadata: entry.metadata || {},
            });
        }
    } catch (err) {
        console.error('NN manager: failed to load from IDB', err);
    }
}

// ----------------------------------------------------------------
// CRUD — Create, read, delete network instances
// Gerencia ciclo de vida das redes neurais registradas
// ----------------------------------------------------------------

/**
 * Register a new named NN instance.
 * Cria uma nova rede neural com identificador unico.
 *
 * @param {string} id - Unique instance name (e.g., 'aerial-classifier')
 * @param {Object} config - { inputSize, hiddenSize|hiddenLayerSizes, outputSize, classNames }
 * @param {Object} [metadata] - Additional metadata (description, createdAt, etc.)
 * @returns {SimpleNN} The created network instance
 */
export function registerNetwork(id, config, metadata = {}) {
    const nn = new SimpleNN(_migrateConfig(config));
    _instances.set(id, {
        nn,
        metadata: {
            createdAt: new Date().toISOString(),
            ...metadata,
        },
    });
    return nn;
}

/**
 * Get a named NN instance.
 * @param {string} id
 * @returns {SimpleNN|null}
 */
export function getNetwork(id) {
    const entry = _instances.get(id);
    return entry ? entry.nn : null;
}

/**
 * Remove a named NN instance.
 * @param {string} id
 * @returns {boolean} true if removed
 */
export function removeNetwork(id) {
    const removed = _instances.delete(id);
    if (removed) {
        _persistAll();
        _dispatchChange();
    }
    return removed;
}

/**
 * List all registered network IDs.
 * @returns {string[]}
 */
export function listNetworks() {
    return Array.from(_instances.keys());
}

/**
 * Get metadata for a named network.
 * @param {string} id
 * @returns {Object|null}
 */
export function getNetworkMetadata(id) {
    const entry = _instances.get(id);
    if (!entry) return null;
    return {
        ...entry.metadata,
        trained: entry.nn.trained,
        inputSize: entry.nn.inputSize,
        hiddenLayerSizes: entry.nn.hiddenLayerSizes,
        hiddenSize: entry.nn.hiddenSize, // backward compat
        outputSize: entry.nn.outputSize,
        classNames: entry.nn.classNames,
    };
}

// ----------------------------------------------------------------
// MAPPING — Variable mapping for builder/what-if
// Mapeamento de variaveis para construtor e simulador
// ----------------------------------------------------------------

/**
 * Get the variable mapping for a network.
 * @param {string} id
 * @returns {{ inputs: Array, outputs: Array, targetElementId: string|null }|null}
 */
export function getNetworkMapping(id) {
    const entry = _instances.get(id);
    return entry?.metadata?.mapping || null;
}

/**
 * Update the variable mapping for a network.
 * Atualiza mapeamento e persiste no localStorage.
 *
 * @param {string} id
 * @param {{ inputs: Array, outputs: Array, targetElementId?: string }} mapping
 */
export function updateNetworkMapping(id, mapping) {
    const entry = _instances.get(id);
    if (!entry) return;
    entry.metadata.mapping = mapping;
    _persistAll();
    _dispatchChange();
}

/**
 * Resize network topology to match mapping dimensions.
 * Recria a rede com novos tamanhos de entrada/saida, preservando hidden layers.
 *
 * @param {string} id
 * @param {number} inputSize
 * @param {number} outputSize
 */
export function resizeNetwork(id, inputSize, outputSize) {
    const entry = _instances.get(id);
    if (!entry) return;

    const nn = entry.nn;
    if (nn.inputSize === inputSize && nn.outputSize === outputSize) return;

    // Recreate with new dimensions, keeping hidden topology and mode
    const config = {
        inputSize,
        hiddenLayerSizes: nn.hiddenLayerSizes,
        outputSize,
        classNames: null,
        mode: nn.mode || 'classification',
    };
    const newNN = new SimpleNN(config);
    entry.nn = newNN;
    _persistAll();
    _dispatchChange();
}

// ----------------------------------------------------------------
// PERSISTENCE — localStorage and model export/import
// ----------------------------------------------------------------

/**
 * Persist a single network to localStorage.
 * Salva rede individual (atualiza o storage completo).
 * @param {string} id
 */
export function persistNetwork(id) {
    if (!_instances.has(id)) return;
    _persistAll();
}

/**
 * Export all networks for model persistence.
 * Exporta todas as redes para inclusao no modelo ECO.
 *
 * @returns {Object|null} { [id]: { config, metadata, state } } or null if empty
 */
export function exportAllNetworks() {
    if (_instances.size === 0) return null;

    const data = {};
    for (const [id, entry] of _instances) {
        data[id] = {
            config: _buildConfig(entry.nn),
            metadata: entry.metadata,
            state: entry.nn.toJSON(),
        };
    }
    return data;
}

/**
 * Import networks from model data.
 * Importa redes do modelo ECO, recria instancias SimpleNN.
 *
 * @param {Object} data - { [id]: { config, metadata, state } }
 */
export function importAllNetworks(data) {
    if (!data || typeof data !== 'object') return;

    // Clear existing instances
    _instances.clear();

    for (const [id, entry] of Object.entries(data)) {
        if (!entry.config) continue;
        const config = _migrateConfig(entry.config);
        const nn = new SimpleNN(config);
        if (entry.state) nn.fromJSON(entry.state);
        _instances.set(id, {
            nn,
            metadata: entry.metadata || {},
        });
    }

    _persistAll();
}
