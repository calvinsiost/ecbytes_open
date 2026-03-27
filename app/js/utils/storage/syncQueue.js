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
   SYNC QUEUE - Offline-first IDB -> Supabase
   ================================================================

   Fila persistente de operacoes pendentes para sincronizacao com Supabase.
   - Escrita local imediata (enqueue)
   - Flush assíncrono com retry e backoff exponencial
   - Sem throw no caminho feliz da aplicacao

   ================================================================ */

import { idbGetWithLegacy, idbSet } from './idbStore.js';

const STORAGE_KEY = 'ecbyts-sync-queue';
const MAX_RETRIES = 8;
const BASE_RETRY_MS = 1000;
const MAX_RETRY_MS = 120000;

let _queue = [];
let _loaded = false;
let _flushing = false;

let _clientProvider = null;
let _storageAdapter = null;

/**
 * Enfileira operacao para sincronizacao futura.
 * / Enqueue a pending sync operation.
 *
 * @param {string} table - Nome da tabela Supabase
 * @param {'upsert'|'insert'|'update'|'delete'} operation - Operacao
 * @param {Object|Array} payload - Payload enviado ao Supabase
 * @param {Object} [options] - Metadados opcionais
 * @param {Object} [options.match] - Filtro para update/delete (eq)
 * @returns {Promise<string>} ID do item enfileirado
 */
export async function enqueueSync(table, operation, payload, options = {}) {
    await _ensureLoaded();

    const item = {
        id: _newQueueId(),
        table,
        operation,
        payload,
        match: options.match || null,
        createdAt: new Date().toISOString(),
        attempts: 0,
        nextRetryAt: 0,
        lastError: null,
    };

    _queue.push(item);
    await _persistQueue();
    return item.id;
}

/**
 * Processa fila pendente contra Supabase.
 * / Flush pending queue against Supabase.
 *
 * @param {Object} [options]
 * @param {number} [options.limit=50] - Maximo de itens por flush
 * @returns {Promise<{processed:number,succeeded:number,failed:number,remaining:number,reason?:string}>}
 */
export async function flushSyncQueue(options = {}) {
    await _ensureLoaded();

    if (_flushing) {
        return {
            processed: 0,
            succeeded: 0,
            failed: 0,
            remaining: _queue.length,
            reason: 'flush_in_progress',
        };
    }

    const ctx = await _resolveClientContext();
    if (!ctx?.client || !ctx?.user?.id) {
        return {
            processed: 0,
            succeeded: 0,
            failed: 0,
            remaining: _queue.length,
            reason: 'not_authenticated',
        };
    }

    const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : 50;
    const now = Date.now();
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    _flushing = true;
    try {
        for (const item of [..._queue]) {
            if (processed >= limit) break;
            if (item.nextRetryAt && item.nextRetryAt > now) continue;

            processed++;
            const ok = await _applyQueueItem(ctx.client, item);
            if (ok) {
                succeeded++;
                _removeById(item.id);
                continue;
            }

            failed++;
            item.attempts = (item.attempts || 0) + 1;
            if (item.attempts >= MAX_RETRIES) {
                _removeById(item.id);
                continue;
            }
            const delay = Math.min(BASE_RETRY_MS * 2 ** (item.attempts - 1), MAX_RETRY_MS);
            item.nextRetryAt = Date.now() + delay;
        }
    } finally {
        _flushing = false;
        await _persistQueue();
    }

    return {
        processed,
        succeeded,
        failed,
        remaining: _queue.length,
    };
}

/**
 * Retorna snapshot da fila.
 * / Get queue snapshot.
 *
 * @returns {Promise<Array>}
 */
export async function getSyncQueueItems() {
    await _ensureLoaded();
    return _queue.map((item) => ({ ...item }));
}

/**
 * Retorna quantidade de itens pendentes.
 * / Get pending queue size.
 *
 * @returns {Promise<number>}
 */
export async function getSyncQueueSize() {
    await _ensureLoaded();
    return _queue.length;
}

/**
 * Limpa toda a fila (uso administrativo/testes).
 * / Clear all queue items.
 *
 * @returns {Promise<void>}
 */
export async function clearSyncQueue() {
    _queue = [];
    _loaded = true;
    await _persistQueue();
}

/**
 * Injeta provider de client/session (uso em testes).
 * / Inject client/session provider for tests.
 *
 * @param {Function|null} provider - async () => ({ client, user })
 */
export function setSyncQueueClientProvider(provider) {
    _clientProvider = typeof provider === 'function' ? provider : null;
}

/**
 * Injeta adaptador de storage (uso em testes).
 * / Inject storage adapter for tests.
 *
 * @param {{load: Function, save: Function}|null} adapter
 */
export function setSyncQueueStorageAdapter(adapter) {
    _storageAdapter =
        adapter && typeof adapter.load === 'function' && typeof adapter.save === 'function' ? adapter : null;
}

/**
 * Reset interno para testes.
 * / Internal reset for tests.
 */
export function __resetSyncQueueForTests() {
    _queue = [];
    _loaded = false;
    _flushing = false;
    _clientProvider = null;
    _storageAdapter = null;
}

async function _ensureLoaded() {
    if (_loaded) return;
    const raw = await _loadQueue();
    _queue = Array.isArray(raw) ? raw : [];
    _loaded = true;
}

async function _loadQueue() {
    if (_storageAdapter) {
        return _storageAdapter.load();
    }
    if (typeof indexedDB !== 'undefined') {
        return idbGetWithLegacy(STORAGE_KEY);
    }
    return [];
}

async function _persistQueue() {
    if (_storageAdapter) {
        await _storageAdapter.save(_queue.map((item) => ({ ...item })));
        return;
    }
    if (typeof indexedDB !== 'undefined') {
        await idbSet(STORAGE_KEY, _queue);
    }
}

async function _resolveClientContext() {
    if (_clientProvider) {
        return _clientProvider();
    }
    try {
        const session = await import('../auth/session.js');
        return {
            client: session.getSupabaseClient?.(),
            user: session.getCurrentUser?.(),
        };
    } catch {
        return null;
    }
}

async function _applyQueueItem(client, item) {
    try {
        let query = client.from(item.table);
        if (item.operation === 'upsert') {
            const { error } = await query.upsert(item.payload);
            if (error) throw error;
            return true;
        }
        if (item.operation === 'insert') {
            const { error } = await query.insert(item.payload);
            if (error) throw error;
            return true;
        }
        if (item.operation === 'update') {
            query = query.update(item.payload);
            const filter = item.match || _fallbackMatch(item.payload);
            query = _applyMatch(query, filter);
            const { error } = await query;
            if (error) throw error;
            return true;
        }
        if (item.operation === 'delete') {
            query = query.delete();
            const filter = item.match || _fallbackMatch(item.payload);
            query = _applyMatch(query, filter);
            const { error } = await query;
            if (error) throw error;
            return true;
        }
        throw new Error(`Unsupported sync operation: ${item.operation}`);
    } catch (error) {
        item.lastError = String(error?.message || error || 'unknown_error');
        return false;
    }
}

function _fallbackMatch(payload) {
    if (payload && typeof payload === 'object' && typeof payload.id === 'string') {
        return { id: payload.id };
    }
    return null;
}

function _applyMatch(query, match) {
    if (!match || typeof match !== 'object') {
        return query;
    }
    let next = query;
    for (const [key, value] of Object.entries(match)) {
        next = next.eq(key, value);
    }
    return next;
}

function _removeById(id) {
    const idx = _queue.findIndex((item) => item.id === id);
    if (idx >= 0) {
        _queue.splice(idx, 1);
    }
}

function _newQueueId() {
    const rnd = Math.random().toString(36).slice(2, 10);
    return `sync-${Date.now()}-${rnd}`;
}
