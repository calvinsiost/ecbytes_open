// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

import { idbDelete, idbClear } from './idbStore.js';
import { showToast } from '../ui/toast.js';

/* ================================================================
   STORAGE MONITOR — localStorage cleanup, ephemeral mode & quota proativo
   Monitor do localStorage — limpeza de dados de modelo e modo efemero.

   Dados de modelo (Categoria C) sao gerados pelo random init e por
   subsistemas como interpolacao, voxel, NN, etc. Os modulos pesados
   agora usam IndexedDB (via idbStore.js) — localStorage fica para
   dados leves (Category A e B).

   O modo efemero impede que _persist() dos modulos grave no armazenamento
   durante sessoes de demonstracao (random init). Persistencia so e
   reativada quando o usuario faz save explicito (cloud ou export).
   ================================================================ */

// ----------------------------------------------------------------
// MODEL DATA KEYS (Category C — tied to model, not user preferences)
// Chaves de dados de modelo que devem ser limpas em transicoes
// ----------------------------------------------------------------

const MODEL_KEYS = [
    'ecbyts-interpolation',
    'ecbyts-voxel',
    'ecbyts-nn',
    'ecbyts-classifier',
    'ecbyts-sao',
    'ecbyts-groups',
    'ecbyts-ticker',
    'ecbyts-calculator',
    'ecbyts-reports',
    'ecbyts-report',
    'ecbyts-filter-presets',
    'ecbyts-libraries',
];

// Chaves de Category C que foram migradas para IndexedDB.
// Adicionar aqui ao migrar novos módulos. NÃO usar idbClear() — preserva Category B futura.
const IDB_MODEL_KEYS = [
    'ecbyts-interpolation',
    'ecbyts-voxel',
    'ecbyts-nn',
    'ecbyts-classifier',
    'ecbyts-storyboard',
    'ecbyts-sao',
    'ecbyts-reports',
    'ecbyts-issues',
    'ecbyts-validation-domains',
    'ecbyts-validation-domain-active-ids',
];

// User-created content keys (Category B — future Supabase migration)
const USER_CONTENT_KEYS = [
    'ecbyts_custom_parameters',
    'ecbyts_custom_units',
    'ecbyts_user_agents',
    'ecbyts_active_agent',
    'ecbyts-viz-settings',
    // Pipeline automation — definições e logs criados pelo usuário
    'ecbyts-pipelines',
    'ecbyts-pipeline-logs',
    // User-defined constants (emission factors, uncertainties, conversion factors)
    'ecbyts_user_constants',
];

// ----------------------------------------------------------------
// EPHEMERAL MODE
// Modo efemero — quando ativo, _persist() dos modulos vira no-op
// ----------------------------------------------------------------

let _ephemeral = false;

/**
 * Set ephemeral mode on/off.
 * Quando ativo, modulos nao gravam no localStorage.
 * @param {boolean} flag - true para ativar, false para desativar
 */
export function setEphemeral(flag) {
    _ephemeral = !!flag;
}

/**
 * Check if ephemeral mode is active.
 * Modulos devem checar antes de chamar localStorage.setItem.
 * @returns {boolean}
 */
export function isEphemeral() {
    return _ephemeral;
}

// ----------------------------------------------------------------
// CLEANUP FUNCTIONS
// Funcoes de limpeza do localStorage
// ----------------------------------------------------------------

/**
 * Clear all model data keys from localStorage (Category C).
 * Também limpa as keys correspondentes no IndexedDB (fire-and-forget).
 * Limpa dados de modelo sem afetar preferencias de UI.
 */
export function clearModelData() {
    for (const key of MODEL_KEYS) {
        localStorage.removeItem(key);
    }
    // Limpa keys de Category C no IDB — keys específicas, não idbClear total
    // (idbClear apagaria Category B/A se migradas para IDB no futuro)
    Promise.all(IDB_MODEL_KEYS.map((k) => idbDelete(k))).catch((e) =>
        console.error('[Storage] IDB delete failed during clearModelData:', e),
    );
}

/**
 * Clear all model + user content keys (Categories B + C).
 * Preserva apenas preferencias de UI (Category A).
 * Limpa o IndexedDB completamente (idbClear — limpeza total explícita).
 */
export function clearWorkspace() {
    clearModelData();
    for (const key of USER_CONTENT_KEYS) {
        localStorage.removeItem(key);
    }
    // clearWorkspace é limpeza total — pode usar idbClear
    idbClear().catch((e) => console.error('[Storage] IDB clear failed during clearWorkspace:', e));
}

// ----------------------------------------------------------------
// SAFE STORAGE WRAPPER
// Wrapper seguro para localStorage.setItem com quota handling
// ----------------------------------------------------------------

/**
 * Safe localStorage.setItem with quota handling.
 * Tenta gravar; se quota excedida, limpa dados de modelo e retenta.
 *
 * @param {string} key - localStorage key
 * @param {string} value - Value to store
 * @returns {boolean} true if stored successfully
 */
export function safeSetItem(key, value) {
    if (_ephemeral) return false;
    try {
        localStorage.setItem(key, value);
        // Verifica quota do origin inteiro (LS + IDB) após write bem-sucedido
        checkQuotaThreshold().catch(() => {});
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22) {
            console.warn(
                `[Storage] Quota exceeded writing "${key}" (${((value.length * 2) / 1024).toFixed(1)} KB). Cleaning model data...`,
            );
            clearModelData();
            try {
                localStorage.setItem(key, value);
                return true;
            } catch {
                console.error(`[Storage] Still over quota after cleanup. Key "${key}" not saved.`);
                return false;
            }
        }
        console.error(`[Storage] Failed to write "${key}":`, e);
        return false;
    }
}

// ----------------------------------------------------------------
// QUOTA MONITOR PROATIVO
// Verifica uso do origin inteiro (LS + IDB) via Storage API
// ----------------------------------------------------------------

/**
 * Verifica uso de armazenamento do origin inteiro via navigator.storage.estimate().
 * Inclui localStorage + IndexedDB + Cache Storage.
 * Emite toast de aviso em 70% e erro em 90% da quota disponível.
 * Dispara evento 'storage:usage' para atualização do status bar.
 * async — chamar como fire-and-forget: checkQuotaThreshold().catch(() => {})
 *
 * @returns {Promise<void>}
 */
export async function checkQuotaThreshold() {
    if (!navigator.storage?.estimate) return;
    try {
        const { usage, quota } = await navigator.storage.estimate();
        const pct = quota > 0 ? usage / quota : 0;
        if (pct > 0.9) {
            showToast('Armazenamento >90%. Exporte o modelo para não perder dados.', 'error');
        } else if (pct > 0.7) {
            showToast('Armazenamento em 70%. Considere exportar o modelo.', 'warning');
        }
        window.dispatchEvent(new CustomEvent('storage:usage', { detail: { usage, quota, pct } }));
    } catch (e) {
        console.warn('[Storage] estimate() falhou:', e);
    }
}

// ----------------------------------------------------------------
// MONITORING
// Monitoramento de uso do localStorage
// ----------------------------------------------------------------

/**
 * Calculate total localStorage usage in bytes.
 * @returns {number} Total bytes used
 */
export function getStorageUsage() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        // Each character is 2 bytes in UTF-16
        total += (key.length + value.length) * 2;
    }
    return total;
}

/**
 * Get usage breakdown by key, sorted by size descending.
 * @returns {Array<{key: string, bytes: number}>}
 */
export function getStorageBreakdown() {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        entries.push({
            key,
            bytes: (key.length + value.length) * 2,
        });
    }
    return entries.sort((a, b) => b.bytes - a.bytes);
}
