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
   SAO SCENARIOS — Disaster & Operations Scenario Profiles
   Cenarios SAO — Perfis de Cenario de Desastre e Operacao

   Define os 7 cenarios operacionais do protocolo SAO.
   Cada cenario determina quais matrizes e parametros sao
   prioritarios para o tipo de evento/empreendimento.
   ================================================================ */

/**
 * SAO Scenario definitions.
 * Each scenario specifies primary and secondary environmental matrices.
 * @type {Object<string, {id: string, nameKey: string, descKey: string, icon: string, primaryMatrices: string[], secondaryMatrices: string[], defaultTier: string}>}
 */
export const SAO_SCENARIOS = {
    tailings_dam: {
        id: 'tailings_dam',
        nameKey: 'scenarioTailingsDam',
        descKey: 'scenarioTailingsDamDesc',
        icon: 'dam',
        primaryMatrices: ['geotecnico', 'agua', 'solo', 'biota'],
        secondaryMatrices: ['ar', 'humana', 'sr'],
        defaultTier: 'essential',
    },

    oil_spill: {
        id: 'oil_spill',
        nameKey: 'scenarioOilSpill',
        descKey: 'scenarioOilSpillDesc',
        icon: 'droplet',
        primaryMatrices: ['agua', 'biota', 'ar'],
        secondaryMatrices: ['humana', 'sr', 'resiliencia'],
        defaultTier: 'essential',
    },

    chemical_accident: {
        id: 'chemical_accident',
        nameKey: 'scenarioChemicalAccident',
        descKey: 'scenarioChemicalAccidentDesc',
        icon: 'alert-triangle',
        primaryMatrices: ['ar', 'humana', 'agua'],
        secondaryMatrices: ['solo', 'biota', 'sr'],
        defaultTier: 'essential',
    },

    nuclear_radiological: {
        id: 'nuclear_radiological',
        nameKey: 'scenarioNuclearRadiological',
        descKey: 'scenarioNuclearRadiologicalDesc',
        icon: 'zap',
        primaryMatrices: ['humana', 'ar', 'agua'],
        secondaryMatrices: ['solo', 'biota', 'sr', 'climatologia'],
        defaultTier: 'essential',
    },

    mining_operations: {
        id: 'mining_operations',
        nameKey: 'scenarioMiningOperations',
        descKey: 'scenarioMiningOperationsDesc',
        icon: 'mountain',
        primaryMatrices: ['geotecnico', 'agua', 'solo', 'ar', 'humana'],
        secondaryMatrices: ['biota', 'sr', 'resiliencia'],
        defaultTier: 'essential',
    },

    deforestation: {
        id: 'deforestation',
        nameKey: 'scenarioDeforestation',
        descKey: 'scenarioDeforestationDesc',
        icon: 'leaf',
        primaryMatrices: ['biota', 'solo', 'agua'],
        secondaryMatrices: ['climatologia', 'sr', 'resiliencia'],
        defaultTier: 'essential',
    },

    routine_monitoring: {
        id: 'routine_monitoring',
        nameKey: 'scenarioRoutineMonitoring',
        descKey: 'scenarioRoutineMonitoringDesc',
        icon: 'clipboard',
        primaryMatrices: ['ar', 'agua', 'humana'],
        secondaryMatrices: ['solo', 'biota', 'resiliencia'],
        defaultTier: 'essential',
    },
};

/**
 * Get scenario definition by ID.
 * @param {string} scenarioId
 * @returns {Object|undefined}
 */
export function getScenario(scenarioId) {
    return SAO_SCENARIOS[scenarioId];
}

/**
 * Get all scenario IDs.
 * @returns {string[]}
 */
export function getAllScenarioIds() {
    return Object.keys(SAO_SCENARIOS);
}

/**
 * Get all matrices (primary + secondary) for a scenario.
 * @param {string} scenarioId
 * @returns {string[]}
 */
export function getScenarioMatrices(scenarioId) {
    const s = SAO_SCENARIOS[scenarioId];
    if (!s) return [];
    return [...s.primaryMatrices, ...s.secondaryMatrices];
}
