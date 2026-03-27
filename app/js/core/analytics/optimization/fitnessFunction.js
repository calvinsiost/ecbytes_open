// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Module: Optimization — Fitness Function
// ADR: ADR-023

/* ================================================================
   FITNESS FUNCTION — Avaliacao de candidatos para o GA.

   Hard constraints (violacao = -Infinity):
   - Custo total excede budget
   - Ponto dentro de zona APP (exclusao ambiental)

   Soft objectives (maximizar):
   - w1 * uncertainty_reduction  (reduzir lacunas de monitoramento)
   - w2 * (1 - normalized_cost)  (preferir solucoes economicas)

   Custo calculado via costCatalog:
   - CAPEX = drilling_rate * depth + installation
   - OPEX anual = numReadings * avgAnalyticalCost
   ================================================================ */

import { uncertaintyAtPoint, computeMaxDist } from './uncertaintyProxy.js';

/**
 * @typedef {Object} FitnessConfig
 * @property {Array<{x: number, z: number}>} existingPoints - Pontos de monitoramento atuais
 * @property {Object} bounds - { minX, maxX, minZ, maxZ }
 * @property {number} maxBudget - Orcamento maximo em BRL
 * @property {Object} costDefaults - { drilling, installation, decommission } por metro/unidade
 * @property {number} [avgAnalyticalCost=200] - Custo medio de analise por ponto
 * @property {number} [numReadingsPerYear=4] - Amostragens por ano
 * @property {number} [horizonYears=5] - Horizonte de projecao
 * @property {number} [escalationRate=0.05] - Taxa de escalacao anual
 * @property {Array<{type: string, polygon: number[][]}>} [appZones=[]] - Zonas de exclusao
 * @property {Object} [weights={ uncertainty: 0.7, cost: 0.3 }] - Pesos dos objetivos
 */

/**
 * Cria funcao de fitness para uso no GA.
 * Retorna closure que avalia um cromossomo (array de genes).
 *
 * @param {FitnessConfig} config
 * @returns {Function} - (genes: Gene[]) => number
 */
export function createFitnessFunction(config) {
    const {
        existingPoints,
        bounds,
        maxBudget,
        costDefaults = { drilling: 350, installation: 2500, decommission: 1500 },
        avgAnalyticalCost = 200,
        numReadingsPerYear = 4,
        horizonYears = 5,
        escalationRate = 0.05,
        appZones = [],
        weights = { uncertainty: 0.7, cost: 0.3 },
    } = config;

    const maxDist = computeMaxDist(bounds);

    return function evaluateFitness(genes) {
        // ── HARD CONSTRAINT 1: Custo total ─────────────────────
        let totalCost = 0;
        for (const gene of genes) {
            const capex = costDefaults.drilling * gene.depth + costDefaults.installation;
            let opex = 0;
            for (let y = 1; y <= horizonYears; y++) {
                opex += numReadingsPerYear * avgAnalyticalCost * Math.pow(1 + escalationRate, y - 1);
            }
            totalCost += capex + opex;
        }

        if (totalCost > maxBudget) return -Infinity;

        // ── HARD CONSTRAINT 2: Zona APP ────────────────────────
        for (const gene of genes) {
            if (isPointInAppZone(gene.x, gene.z, appZones)) {
                return -Infinity;
            }
        }

        // ── SOFT OBJECTIVE 1: Reducao de incerteza ─────────────
        // Calcula incerteza media nos pontos candidatos
        // (considerando pontos existentes + candidatos anteriores)
        const allPoints = [...existingPoints];
        let uncertaintySum = 0;
        for (const gene of genes) {
            uncertaintySum += uncertaintyAtPoint(gene.x, gene.z, allPoints, maxDist);
            allPoints.push({ x: gene.x, z: gene.z });
        }
        // Quanto mais incerteza NO LOCAL do candidato, mais util ele e
        // (colocando monitoring onde falta)
        const avgUncertaintyAtCandidates = uncertaintySum / genes.length;

        // ── SOFT OBJECTIVE 2: Eficiencia de custo ──────────────
        const normalizedCost = totalCost / maxBudget; // [0, 1]
        const costEfficiency = 1 - normalizedCost; // Maior = mais economico

        // ── FITNESS = soma ponderada ───────────────────────────
        const fitness = weights.uncertainty * avgUncertaintyAtCandidates + weights.cost * costEfficiency;

        return fitness;
    };
}

/**
 * Calcula custo detalhado de um individuo (para o output final).
 *
 * @param {Gene[]} genes
 * @param {Object} costDefaults
 * @param {number} avgAnalyticalCost
 * @param {number} numReadingsPerYear
 * @param {number} horizonYears
 * @param {number} escalationRate
 * @returns {Object} - { totalCapex, totalOpex, totalCost, perCandidate[] }
 */
export function computeDetailedCost(
    genes,
    costDefaults,
    avgAnalyticalCost = 200,
    numReadingsPerYear = 4,
    horizonYears = 5,
    escalationRate = 0.05,
) {
    let totalCapex = 0;
    let totalOpex = 0;
    const perCandidate = [];

    for (const gene of genes) {
        const capex = costDefaults.drilling * gene.depth + costDefaults.installation;
        let opex = 0;
        for (let y = 1; y <= horizonYears; y++) {
            opex += numReadingsPerYear * avgAnalyticalCost * Math.pow(1 + escalationRate, y - 1);
        }

        totalCapex += capex;
        totalOpex += opex;
        perCandidate.push({
            x: gene.x,
            z: gene.z,
            familyId: gene.familyId,
            depth: gene.depth,
            capex: Math.round(capex),
            opexTotal: Math.round(opex),
            total: Math.round(capex + opex),
        });
    }

    return {
        totalCapex: Math.round(totalCapex),
        totalOpex: Math.round(totalOpex),
        totalCost: Math.round(totalCapex + totalOpex),
        perCandidate,
    };
}

// ----------------------------------------------------------------
// HELPERS — Constraint checking
// ----------------------------------------------------------------

/**
 * Verifica se um ponto esta dentro de uma zona de exclusao APP.
 * Usa ray casting algorithm (point-in-polygon).
 *
 * @param {number} x
 * @param {number} z
 * @param {Array} appZones - Array de { polygon: [[x,z],...] }
 * @returns {boolean}
 */
function isPointInAppZone(x, z, appZones) {
    for (const zone of appZones) {
        if (pointInPolygon(x, z, zone.polygon || [])) {
            return true;
        }
    }
    return false;
}

/**
 * Ray casting algorithm para point-in-polygon.
 *
 * @param {number} x
 * @param {number} y
 * @param {Array<[number, number]>} polygon
 * @returns {boolean}
 */
function pointInPolygon(x, y, polygon) {
    if (polygon.length < 3) return false;

    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0],
            yi = polygon[i][1];
        const xj = polygon[j][0],
            yj = polygon[j][1];

        const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

        if (intersect) inside = !inside;
    }
    return inside;
}
