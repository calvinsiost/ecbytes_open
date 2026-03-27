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

/**
 * idbStore.js — Wrapper assíncrono sobre IndexedDB
 *
 * API simétrica ao safeSetItem/localStorage.getItem para facilitar migração
 * dos módulos pesados (interpolation, voxel, nn) que excedem o quota do localStorage.
 *
 * IndexedDB: sem limite fixo (~50%+ do disco), suportado em todos os browsers modernos.
 * Nunca lança — retorna false em qualquer erro para não interromper o fluxo do caller.
 */

const DB_NAME = 'ecbyts-db';
const DB_VERSION = 1;
// Para adicionar stores em versões futuras:
// req.onupgradeneeded: if (e.oldVersion < 2) { db.createObjectStore('nova-store'); }

let _dbPromise = null;

/**
 * Abre (ou reutiliza) a conexão com o IndexedDB.
 * Usa promise singleton para evitar race condition quando múltiplos módulos
 * chamam _openDB() em paralelo antes da primeira conexão resolver.
 * Em erro, reseta _dbPromise = null para permitir nova tentativa.
 * @returns {Promise<IDBDatabase>}
 */
function _openDB() {
    if (!_dbPromise) {
        _dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('keyval')) {
                    db.createObjectStore('keyval');
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => {
                _dbPromise = null;
                reject(e.target.error);
            };
        });
    }
    return _dbPromise;
}

/**
 * Helper interno: abre DB, executa fn(db), reseta _dbPromise em qualquer erro.
 * Centraliza o reset — evita duplicar em cada export.
 * Retorna false em qualquer falha (InvalidStateError por GC, quota, etc.).
 * @param {Function} fn - recebe IDBDatabase, deve retornar Promise<any>
 * @returns {Promise<any>}
 */
async function _withDB(fn) {
    try {
        const db = await _openDB();
        return await fn(db);
    } catch (e) {
        _dbPromise = null; // permite reabrir na próxima tentativa
        console.error('[IDB] operação falhou:', e);
        return false;
    }
}

/**
 * Persiste value no IndexedDB sob a key.
 * Aceita qualquer valor structured-cloneable (objetos, arrays, strings,
 * ArrayBuffer, Blob). NÃO aceita funções, símbolos ou referências circulares.
 * Resolve em tx.oncomplete — garante que o dado foi realmente commitado.
 * Retorna Promise<boolean> — nunca lança.
 *
 * @param {string} key
 * @param {any} value
 * @returns {Promise<boolean>}
 */
export function idbSet(key, value) {
    return _withDB(
        (db) =>
            new Promise((resolve) => {
                const tx = db.transaction('keyval', 'readwrite');
                const req = tx.objectStore('keyval').put(value, key);
                // Resolver em oncomplete (não em req.onsuccess) garante commit real.
                // req.onsuccess dispara antes do commit — se tx abortar depois, seria falso positivo.
                tx.oncomplete = () => resolve(true);
                tx.onabort = () => {
                    console.error('[IDB] transação abortada para key:', key, tx.error);
                    resolve(false);
                };
                req.onerror = () => {
                    // tx.onabort vai disparar automaticamente — não precisa de resolve aqui
                    console.error('[IDB] erro no request para key:', key, req.error);
                };
            }),
    );
}

/**
 * Lê value do IndexedDB para a key.
 * Retorna o value armazenado (objeto, array, string, etc.) ou null se não existir.
 * Nunca lança — retorna null em qualquer erro.
 *
 * @param {string} key
 * @returns {Promise<any|null>}
 */
export function idbGet(key) {
    return _withDB(
        (db) =>
            new Promise((resolve) => {
                const tx = db.transaction('keyval', 'readonly');
                const req = tx.objectStore('keyval').get(key);
                req.onsuccess = () => resolve(req.result ?? null);
                req.onerror = () => {
                    console.error('[IDB] erro ao ler key:', key, req.error);
                    resolve(null);
                };
                tx.onabort = () => {
                    console.error('[IDB] transação de leitura abortada para key:', key, tx.error);
                    resolve(null);
                };
            }),
    );
}

/**
 * Remove a key do IndexedDB.
 * Retorna Promise<boolean> — true em sucesso ou se a key não existia.
 *
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export function idbDelete(key) {
    return _withDB(
        (db) =>
            new Promise((resolve) => {
                const tx = db.transaction('keyval', 'readwrite');
                tx.objectStore('keyval').delete(key);
                tx.oncomplete = () => resolve(true);
                tx.onabort = () => {
                    console.error('[IDB] falha ao deletar key:', key, tx.error);
                    resolve(false);
                };
            }),
    );
}

/**
 * Limpa TODOS os registros do store 'keyval'.
 * Reservado para clearWorkspace() — limpeza total explícita.
 * NÃO usar em clearModelData() para evitar apagar Category B/A futura.
 * Retorna Promise<boolean>.
 *
 * @returns {Promise<boolean>}
 */
export function idbClear() {
    return _withDB(
        (db) =>
            new Promise((resolve) => {
                const tx = db.transaction('keyval', 'readwrite');
                tx.objectStore('keyval').clear();
                tx.oncomplete = () => resolve(true);
                tx.onabort = () => {
                    console.error('[IDB] falha ao limpar store:', tx.error);
                    resolve(false);
                };
            }),
    );
}

/**
 * Lê value do IDB. Se null, tenta migrar dados legados do localStorage.
 *
 * Lógica de migração one-shot (executa apenas uma vez por key):
 *   1. idbGet(key) → se existir, retorna diretamente
 *   2. localStorage.getItem(key) → se existir, parseia e salva no IDB
 *   3. Se idbSet OK → remove do localStorage (migração completa)
 *   4. Se idbSet falhou → mantém no localStorage (dado não se perde)
 *   5. Se parse falhou → remove do localStorage de qualquer forma (dado corrompido)
 *
 * parseLegacy padrão é JSON.parse. Override para tipos custom que não usam JSON.
 *
 * @param {string} key
 * @param {Function} [parseLegacy] - padrão: JSON.parse
 * @returns {Promise<any|null>}
 */
export async function idbGetWithLegacy(key, parseLegacy = JSON.parse) {
    // Tenta IDB primeiro
    let value = await idbGet(key);
    if (value != null) return value;

    // Tenta migrar do localStorage
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    try {
        value = parseLegacy(raw);
        const saved = await idbSet(key, value);
        // Remove do LS APENAS se o IDB confirmou o save (tx.oncomplete)
        // Se idbSet retornou false (quota IDB, IDB indisponível), mantém no LS
        if (saved) {
            localStorage.removeItem(key);
        } else {
            console.warn('[IDB] migração parcial: dado mantido no localStorage para key:', key);
        }
    } catch {
        // Parse falhou — dado no LS está corrompido; remove para não travar futuras tentativas
        value = null;
        localStorage.removeItem(key);
    }

    return value;
}
