// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Module: Optimization — Public API
// ADR: ADR-023

/* ================================================================
   OPTIMIZATION PUBLIC API — Ponto de entrada para otimizacao GA.

   Orquestra: Web Worker, fitness function, uncertainty proxy,
   e entrega resultado pronto para o handler/UI.

   Uso:
     import { runOptimization, cancelOptimization } from './index.js';
     const handle = runOptimization(config, onProgress);
     // ...
     cancelOptimization(handle.id);
   ================================================================ */

import { createFitnessFunction, computeDetailedCost } from './fitnessFunction.js';
import { uncertaintyReduction, computeMaxDist } from './uncertaintyProxy.js';
import { runGA } from './geneticAlgorithm.js';

// ----------------------------------------------------------------
// STATE — Tracks active optimizations
// ----------------------------------------------------------------

let _nextId = 1;
const _activeRuns = new Map();

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * @typedef {Object} OptimizationConfig
 * @property {Array<{x: number, z: number}>} existingPoints - Pontos de monitoramento atuais
 * @property {Object} bounds - { minX, maxX, minZ, maxZ }
 * @property {number} numCandidates - Quantidade de pontos novos a propor
 * @property {number} maxBudget - Orcamento maximo (BRL)
 * @property {Object} [costDefaults] - { drilling, installation, decommission }
 * @property {number} [avgAnalyticalCost=200] - Custo medio por analise
 * @property {number} [numReadingsPerYear=4]
 * @property {number} [horizonYears=5]
 * @property {number} [escalationRate=0.05]
 * @property {Array} [appZones=[]] - Zonas de exclusao APP
 * @property {Object} [weights={ uncertainty: 0.7, cost: 0.3 }]
 * @property {number} [populationSize=100]
 * @property {number} [generations=500]
 * @property {number} [tournamentSize=3]
 * @property {number} [mutationSigma=5]
 * @property {number} [elitismPercent=5]
 * @property {number} [stagnationLimit=50]
 * @property {number} [seed=42]
 * @property {number[]} [depthRange=[15,80]]
 */

/**
 * @typedef {Object} OptimizationResult
 * @property {Object} best - Melhor individuo { genes[], fitness }
 * @property {Object} costBreakdown - Custos detalhados { totalCapex, totalOpex, totalCost, perCandidate[] }
 * @property {number} uncertaintyReduction - Fracao de reducao de incerteza [0,1]
 * @property {Object} stats - { convergenceMs, generations, stagnatedAt }
 */

/**
 * Executa otimizacao GA no thread principal.
 * Para uso em workers, use runOptimizationAsync().
 *
 * @param {OptimizationConfig} config
 * @param {Function} [onProgress] - (gen, bestFitness, avgFitness) => void
 * @returns {OptimizationResult}
 */
export function runOptimization(config, onProgress = () => {}) {
    const {
        existingPoints = [],
        bounds,
        numCandidates = 3,
        maxBudget = 100000,
        costDefaults = { drilling: 350, installation: 2500, decommission: 1500 },
        avgAnalyticalCost = 200,
        numReadingsPerYear = 4,
        horizonYears = 5,
        escalationRate = 0.05,
        appZones = [],
        weights = { uncertainty: 0.7, cost: 0.3 },
        populationSize = 100,
        generations = 500,
        tournamentSize = 3,
        mutationSigma = 5,
        elitismPercent = 5,
        stagnationLimit = 50,
        seed = 42,
        depthRange = [15, 80],
    } = config;

    const startTime = Date.now();

    // Cria funcao de fitness
    const fitnessFunction = createFitnessFunction({
        existingPoints,
        bounds,
        maxBudget,
        costDefaults,
        avgAnalyticalCost,
        numReadingsPerYear,
        horizonYears,
        escalationRate,
        appZones,
        weights,
    });

    // Executa GA
    const gaResult = runGA({
        numCandidates,
        bounds,
        populationSize,
        generations,
        tournamentSize,
        mutationSigma,
        elitismPercent,
        stagnationLimit,
        seed,
        depthRange,
        fitnessFunction,
        onProgress,
    });

    // Custo detalhado do melhor individuo
    const costBreakdown = computeDetailedCost(
        gaResult.best.genes,
        costDefaults,
        avgAnalyticalCost,
        numReadingsPerYear,
        horizonYears,
        escalationRate,
    );

    // Reducao de incerteza
    const uncReduction = uncertaintyReduction(gaResult.best.genes, existingPoints, bounds);

    return {
        best: gaResult.best,
        costBreakdown,
        uncertaintyReduction: uncReduction,
        stats: {
            convergenceMs: Date.now() - startTime,
            generations: gaResult.stats.generations,
            finalFitness: gaResult.stats.finalFitness,
            stagnatedAt: gaResult.stats.stagnatedAt,
        },
    };
}

/**
 * Executa otimizacao GA em Web Worker (async, non-blocking).
 *
 * @param {OptimizationConfig} config
 * @param {Function} [onProgress] - (gen, bestFitness, avgFitness) => void
 * @returns {Promise<{ id: number, result: OptimizationResult }>}
 */
export function runOptimizationAsync(config, onProgress = () => {}) {
    const id = _nextId++;

    return new Promise((resolve, reject) => {
        let worker;
        try {
            // Worker path relativo ao index.html
            worker = new Worker(new URL('./optimizationWorker.js', import.meta.url), { type: 'module' });
        } catch (_) {
            // Fallback: caminho absoluto para ambientes sem import.meta.url em workers
            try {
                worker = new Worker('./js/core/analytics/optimization/optimizationWorker.js');
            } catch (e2) {
                // Fallback final: roda no main thread
                console.warn('[Optimization] Worker nao disponivel, rodando no main thread');
                try {
                    const result = runOptimization(config, onProgress);
                    resolve({ id, result });
                } catch (e3) {
                    reject(e3);
                }
                return;
            }
        }

        _activeRuns.set(id, worker);

        worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.id !== id) return;

            if (msg.type === 'progress') {
                onProgress(msg.gen, msg.bestFitness, msg.avgFitness);
            } else if (msg.type === 'result') {
                _activeRuns.delete(id);
                worker.terminate();

                // Enriquece com custo detalhado e reducao de incerteza
                const costDefaults = config.costDefaults || { drilling: 350, installation: 2500, decommission: 1500 };
                const costBreakdown = computeDetailedCost(
                    msg.best.genes,
                    costDefaults,
                    config.avgAnalyticalCost || 200,
                    config.numReadingsPerYear || 4,
                    config.horizonYears || 5,
                    config.escalationRate || 0.05,
                );

                const uncReduction = uncertaintyReduction(msg.best.genes, config.existingPoints || [], config.bounds);

                resolve({
                    id,
                    result: {
                        best: msg.best,
                        costBreakdown,
                        uncertaintyReduction: uncReduction,
                        stats: msg.stats,
                    },
                });
            } else if (msg.type === 'error') {
                _activeRuns.delete(id);
                worker.terminate();
                reject(new Error(msg.message));
            }
        };

        worker.onerror = (err) => {
            _activeRuns.delete(id);
            worker.terminate();
            // Fallback ao main thread
            console.warn('[Optimization] Worker erro, fallback ao main thread:', err.message);
            try {
                const result = runOptimization(config, onProgress);
                resolve({ id, result });
            } catch (e) {
                reject(e);
            }
        };

        // Envia config para o worker
        worker.postMessage({ id, action: 'run', config });
    });
}

/**
 * Cancela uma otimizacao em andamento.
 *
 * @param {number} runId - ID retornado por runOptimizationAsync
 * @returns {boolean} - true se cancelou, false se nao encontrado
 */
export function cancelOptimization(runId) {
    const worker = _activeRuns.get(runId);
    if (!worker) return false;

    worker.postMessage({ id: runId, action: 'cancel' });
    // Termina o worker apos dar chance de processar cancel
    setTimeout(() => {
        if (_activeRuns.has(runId)) {
            worker.terminate();
            _activeRuns.delete(runId);
        }
    }, 500);

    return true;
}

/**
 * Verifica se ha otimizacao ativa.
 * @returns {boolean}
 */
export function isOptimizationRunning() {
    return _activeRuns.size > 0;
}
