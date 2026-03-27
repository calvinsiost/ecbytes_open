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
   PIPELINES / REGISTRY — CRUD de pipelines + log de execuções
   Gerencia persistência de pipeline definitions e run logs.

   Categoria localStorage: USER_CONTENT_KEYS (sobrevive clearWorkspace).
   Keys:
     'ecbyts-pipelines'     → { [id]: { name, xml, updatedAt } }
     'ecbyts-pipeline-logs' → { [runId]: PipelineRunLog } (últimos 50)

   Modelo de segurança: apenas leitura/escrita de JSON estruturado.
   Nenhum código é executado a partir do storage.
   ================================================================ */

import { safeSetItem } from '../../utils/storage/storageMonitor.js';
import { createPipelineId } from './schema.js';

// ----------------------------------------------------------------
// CHAVES localStorage
// ----------------------------------------------------------------

const PIPELINES_KEY = 'ecbyts-pipelines';
const LOGS_KEY = 'ecbyts-pipeline-logs';
const MAX_LOGS = 50;

// ----------------------------------------------------------------
// STATE (module-level Map — padrão do projeto)
// ----------------------------------------------------------------

/** @type {Map<string, {id: string, name: string, xml: string, updatedAt: string}>} */
const _pipelines = new Map();

/** @type {Map<string, Object>} runId → PipelineRunLog */
const _logs = new Map();

// ----------------------------------------------------------------
// INICIALIZAÇÃO
// ----------------------------------------------------------------

/**
 * Carrega pipelines e logs do localStorage.
 * Deve ser chamado uma vez no init (index.js do módulo).
 */
export function loadFromStorage() {
    try {
        const raw = localStorage.getItem(PIPELINES_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            for (const [id, entry] of Object.entries(data)) {
                if (id && entry && entry.xml) {
                    _pipelines.set(id, entry);
                }
            }
        }
    } catch (e) {
        console.error('[pipelines/registry] Falha ao carregar pipelines:', e);
    }

    try {
        const rawLogs = localStorage.getItem(LOGS_KEY);
        if (rawLogs) {
            const data = JSON.parse(rawLogs);
            for (const [runId, log] of Object.entries(data)) {
                if (runId && log) _logs.set(runId, log);
            }
        }
    } catch (e) {
        console.error('[pipelines/registry] Falha ao carregar logs:', e);
    }
}

// ----------------------------------------------------------------
// PERSISTÊNCIA INTERNA
// ----------------------------------------------------------------

function _persistPipelines() {
    // Pipelines são conteúdo do usuário (categoria USER_CONTENT_KEYS) — persistem
    // mesmo em modo efêmero (que se aplica apenas aos dados do modelo 3D).
    try {
        localStorage.setItem(PIPELINES_KEY, JSON.stringify(Object.fromEntries(_pipelines)));
        return true;
    } catch (e) {
        // Fallback: tentar safeSetItem apenas se localStorage direto falhar (quota)
        const ok = safeSetItem(PIPELINES_KEY, JSON.stringify(Object.fromEntries(_pipelines)));
        if (!ok) console.warn('[pipelines/registry] Falha ao persistir pipelines (quota?)');
        return ok;
    }
}

function _persistLogs() {
    try {
        localStorage.setItem(LOGS_KEY, JSON.stringify(Object.fromEntries(_logs)));
    } catch {
        safeSetItem(LOGS_KEY, JSON.stringify(Object.fromEntries(_logs)));
    }
}

// ----------------------------------------------------------------
// API PÚBLICA — PIPELINES
// ----------------------------------------------------------------

/**
 * Salva (cria ou atualiza) um pipeline.
 * Se sem ID, gera um novo. Retorna a definição salva.
 *
 * @param {{ id?: string, name: string, xml: string }} entry
 * @returns {{ id: string, name: string, xml: string, updatedAt: string }}
 */
export function savePipeline(entry) {
    const id = entry.id || createPipelineId();
    const record = {
        id,
        name: String(entry.name || 'Pipeline').slice(0, 200),
        xml: String(entry.xml || ''),
        updatedAt: new Date().toISOString(),
    };
    _pipelines.set(id, record);
    _persistPipelines();
    return record;
}

/**
 * Busca um pipeline pelo ID.
 * @param {string} id
 * @returns {{ id: string, name: string, xml: string, updatedAt: string } | undefined}
 */
export function getPipeline(id) {
    return _pipelines.get(id);
}

/**
 * Retorna todos os pipelines ordenados por updatedAt desc.
 * @returns {Array<{id: string, name: string, xml: string, updatedAt: string}>}
 */
export function getAllPipelines() {
    return [..._pipelines.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

/**
 * Remove um pipeline pelo ID.
 * @param {string} id
 * @returns {boolean} true se removido
 */
export function deletePipeline(id) {
    const existed = _pipelines.has(id);
    if (existed) {
        _pipelines.delete(id);
        _persistPipelines();
    }
    return existed;
}

// ----------------------------------------------------------------
// API PÚBLICA — RUN LOGS
// ----------------------------------------------------------------

/**
 * Persiste log de uma execução finalizada.
 * Mantém no máximo MAX_LOGS entradas (FIFO).
 *
 * @param {Object} run - PipelineRun finalizado (status completed/failed/aborted)
 */
export function saveRunLog(run) {
    if (!run || !run.runId) return;

    _logs.set(run.runId, {
        runId: run.runId,
        pipelineId: run.pipelineId,
        status: run.status,
        log: run.log || [],
        error: run.error || null,
        startedAt: run.startedAt,
        endedAt: run.endedAt || Date.now(),
    });

    // Limitar a MAX_LOGS entradas (remover as mais antigas)
    if (_logs.size > MAX_LOGS) {
        const sorted = [..._logs.entries()].sort((a, b) => (a[1].startedAt || 0) - (b[1].startedAt || 0));
        for (let i = 0; i < _logs.size - MAX_LOGS; i++) {
            _logs.delete(sorted[i][0]);
        }
    }

    _persistLogs();
}

/**
 * Retorna logs de execução, opcionalmente filtrados por pipeline.
 * Ordenados por startedAt desc.
 *
 * @param {string} [pipelineId] - Filtrar por pipeline (opcional)
 * @returns {Array<Object>}
 */
export function getRunLogs(pipelineId) {
    let entries = [..._logs.values()];
    if (pipelineId) {
        entries = entries.filter((e) => e.pipelineId === pipelineId);
    }
    return entries.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}
