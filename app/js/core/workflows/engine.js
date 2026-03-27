// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   WORKFLOW ENGINE — State machine generica para workflows guiados
   Maquina de estados imutavel para pipelines ambientais.

   Padrão seguido: core/ingestion/wizard.js (imutável, funcoes puras)

   Tipos de step:
   - info      → Informacao, sem input do usuario
   - decision  → Coleta decisoes (radio, dropdown, picker)
   - execution → Operacao async (interpolacao, validacao) com progresso
   - review    → Resultados finais, aceitar ou voltar

   ================================================================ */

// ================================================================
// LIFECYCLE — Criar, avancar, voltar
// ================================================================

/**
 * Cria estado inicial de um workflow.
 *
 * @param {WorkflowDefinition} definition - Definicao do workflow
 * @param {Object} context - Contexto inicial (appState, prefill decisions)
 * @returns {WorkflowState}
 */
export function createWorkflow(definition, context = {}) {
    const steps = definition.steps.filter((step) => {
        if (typeof step.canSkip === 'function') {
            return !step.canSkip(context);
        }
        return true;
    });

    return {
        definitionId: definition.id,
        definition,
        steps,
        stepIndex: 0,
        decisions: { ...context.prefill },
        results: {},
        history: [0],
        status: 'active', // 'active' | 'completed' | 'failed'
        error: null,
        context,
    };
}

/**
 * Avanca o workflow para o proximo step.
 * Aplica a decisao do usuario antes de avancar.
 *
 * @param {WorkflowState} state - Estado atual
 * @param {Object} userDecision - Decisao do step atual (chave-valor)
 * @returns {WorkflowState} Novo estado (imutavel)
 */
export function advanceWorkflow(state, userDecision = {}) {
    if (state.status !== 'active') return state;

    const newDecisions = { ...state.decisions, ...userDecision };
    const nextIndex = state.stepIndex + 1;

    if (nextIndex >= state.steps.length) {
        // Workflow completo
        return {
            ...state,
            decisions: newDecisions,
            status: 'completed',
            history: [...state.history, nextIndex],
        };
    }

    return {
        ...state,
        stepIndex: nextIndex,
        decisions: newDecisions,
        history: [...state.history, nextIndex],
    };
}

/**
 * Volta o workflow para o step anterior.
 *
 * @param {WorkflowState} state
 * @returns {WorkflowState}
 */
export function goBackWorkflow(state) {
    if (state.stepIndex <= 0) return state;

    return {
        ...state,
        stepIndex: state.stepIndex - 1,
        history: [...state.history, state.stepIndex - 1],
    };
}

/**
 * Salva resultado de um step de execucao no estado.
 *
 * @param {WorkflowState} state
 * @param {string} stepId - ID do step que gerou o resultado
 * @param {Object} result - Dados de resultado
 * @returns {WorkflowState}
 */
export function setStepResult(state, stepId, result) {
    return {
        ...state,
        results: {
            ...state.results,
            [stepId]: result,
        },
    };
}

/**
 * Marca o workflow como falho.
 *
 * @param {WorkflowState} state
 * @param {string} errorMessage
 * @returns {WorkflowState}
 */
export function failWorkflow(state, errorMessage) {
    return {
        ...state,
        status: 'failed',
        error: errorMessage,
    };
}

// ================================================================
// QUERIES — Ler informacoes do estado
// ================================================================

/**
 * Retorna info do step atual para renderizacao na UI.
 *
 * @param {WorkflowState} state
 * @returns {StepRenderInfo}
 */
export function getWorkflowStep(state) {
    const step = state.steps[state.stepIndex];
    if (!step) return null;

    return {
        stepId: step.id,
        type: step.type,
        titleKey: step.titleKey,
        descKey: step.descKey,
        stepNumber: state.stepIndex + 1,
        totalSteps: state.steps.length,
        canGoBack: state.stepIndex > 0,
        canGoForward: state.stepIndex < state.steps.length - 1,
        isLastStep: state.stepIndex === state.steps.length - 1,
        options: step.options || null,
        decisions: state.decisions,
        results: state.results,
        status: state.status,
    };
}

/**
 * Retorna progresso do workflow como fracao (0 a 1).
 *
 * @param {WorkflowState} state
 * @returns {number}
 */
export function getWorkflowProgress(state) {
    if (state.steps.length === 0) return 1;
    if (state.status === 'completed') return 1;
    return state.stepIndex / state.steps.length;
}

/**
 * Verifica se o workflow esta completo.
 *
 * @param {WorkflowState} state
 * @returns {boolean}
 */
export function isWorkflowComplete(state) {
    return state.status === 'completed';
}

/**
 * Retorna o step atual (definicao completa).
 *
 * @param {WorkflowState} state
 * @returns {StepDefinition|null}
 */
export function getCurrentStep(state) {
    return state.steps[state.stepIndex] || null;
}

/**
 * Verifica se o step atual requer execucao async.
 *
 * @param {WorkflowState} state
 * @returns {boolean}
 */
export function isExecutionStep(state) {
    const step = getCurrentStep(state);
    return step?.type === 'execution';
}

/**
 * Valida o step atual antes de avancar.
 * Chama a funcao validate() do step se definida.
 *
 * @param {WorkflowState} state
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCurrentStep(state) {
    const step = getCurrentStep(state);
    if (!step || typeof step.validate !== 'function') {
        return { valid: true, errors: [] };
    }
    return step.validate(state);
}
