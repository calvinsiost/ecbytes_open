// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   WORKFLOW REGISTRY — Registro central de workflows disponiveis
   ================================================================ */

const _workflows = new Map();

/**
 * Registra uma definicao de workflow.
 * @param {WorkflowDefinition} definition
 */
export function registerWorkflow(definition) {
    if (!definition?.id) {
        throw new Error('Workflow definition must have an id');
    }
    _workflows.set(definition.id, definition);
}

/**
 * Retorna uma definicao de workflow por ID.
 * @param {string} id
 * @returns {WorkflowDefinition|undefined}
 */
export function getWorkflow(id) {
    return _workflows.get(id);
}

/**
 * Retorna todas as definicoes de workflow.
 * @returns {WorkflowDefinition[]}
 */
export function getAllWorkflows() {
    return [..._workflows.values()];
}

/**
 * Retorna workflows filtrados por regulacao.
 * @param {string} regulation - Ex: 'CONAMA 420/2009'
 * @returns {WorkflowDefinition[]}
 */
export function getWorkflowsByRegulation(regulation) {
    return getAllWorkflows().filter((w) => w.regulation && w.regulation.includes(regulation));
}

/**
 * Verifica pre-requisitos de um workflow contra o estado do app.
 * @param {string} workflowId
 * @param {Object} appState - { elements, campaigns }
 * @returns {{ met: boolean, missing: string[] }}
 */
export function checkPrerequisites(workflowId, appState) {
    const def = _workflows.get(workflowId);
    if (!def) return { met: false, missing: ['workflow.prereq.notFound'] };
    if (typeof def.prerequisites !== 'function') return { met: true, missing: [] };
    return def.prerequisites(appState);
}
