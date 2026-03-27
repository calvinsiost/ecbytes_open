// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   LLM FUNCTION CATALOG — Definicoes de funcoes para o system prompt
   Usado pelo agent loop para descrever capacidades ao LLM.

   NAO usa native function_calling (OpenAI/Anthropic) porque o
   router suporta engines browser/local que nao tem essa feature.
   Em vez disso, as definicoes sao injetadas como texto no prompt.
   ================================================================ */

import { getAllWorkflows } from '../workflows/registry.js';

/**
 * Funcoes read-only — executam SEM confirmacao do usuario.
 * O agent loop chama automaticamente e retorna o resultado ao LLM.
 */
export const READ_ONLY_FUNCTIONS = [
    {
        name: 'QUERY_STATE',
        description: 'Query the current model state. Returns element count, campaigns, compliance summary.',
        parameters: {
            query: {
                type: 'string',
                enum: ['summary', 'elements', 'campaigns', 'compliance', 'exceedances', 'parameters'],
                required: true,
                description: 'Type of query',
            },
            filter: {
                type: 'object',
                description: 'Optional filter: { familyId, parameterId, campaignId }',
                required: false,
            },
        },
    },
    {
        name: 'QUERY_ELEMENT',
        description: 'Get detailed info about a specific element including all observations grouped by parameter.',
        parameters: {
            elementId: {
                type: 'string',
                required: true,
                description: 'Element ID to query',
            },
        },
    },
    {
        name: 'QUERY_COMPLIANCE',
        description:
            'Check regulatory compliance for a specific parameter across all wells. Returns exceedances, compliance rate, and details.',
        parameters: {
            parameterId: {
                type: 'string',
                required: true,
                description: 'Parameter ID (e.g., benzene, lead)',
            },
            regulation: {
                type: 'string',
                enum: ['CONAMA_420', 'CETESB', 'EPA_MCL'],
                required: false,
                description: 'Regulatory framework (default: CONAMA_420)',
            },
        },
    },
];

/**
 * Funcoes mutantes — requerem confirmacao do usuario.
 */
export const MUTATING_FUNCTIONS = [
    {
        name: 'START_WORKFLOW',
        description: 'Launch a guided environmental workflow. Pre-fill decisions from conversation context.',
        parameters: {
            workflowId: {
                type: 'string',
                required: true,
                description: 'Workflow ID to launch',
            },
            prefill: {
                type: 'object',
                required: false,
                description: 'Pre-fill decisions: { parameterId, campaignId, interpolationMethod, ... }',
            },
        },
    },
];

/**
 * Verifica se uma acao e read-only (nao requer confirmacao).
 * @param {string} actionName
 * @returns {boolean}
 */
export function isReadOnlyAction(actionName) {
    return READ_ONLY_FUNCTIONS.some((f) => f.name === actionName);
}

/**
 * Gera texto de definicoes de funcoes para o system prompt.
 * Formato compacto para minimizar tokens.
 *
 * @returns {string}
 */
export function buildFunctionDefinitionsPrompt() {
    let text = '';

    // Read-only functions
    text += '\n═ CONSULTAS DE ESTADO (executam automaticamente, sem confirmação) ═\n';
    for (const fn of READ_ONLY_FUNCTIONS) {
        text += `\n${fn.name} — ${fn.description}\n`;
        text += formatParams(fn.parameters);
    }

    // Mutating functions
    text += '\n═ AÇÕES DE WORKFLOW (requerem confirmação) ═\n';
    for (const fn of MUTATING_FUNCTIONS) {
        text += `\n${fn.name} — ${fn.description}\n`;
        text += formatParams(fn.parameters);
    }

    // Available workflows
    const workflows = getAllWorkflows();
    if (workflows.length > 0) {
        text += '\n═ WORKFLOWS DISPONÍVEIS ═\n';
        for (const wf of workflows) {
            text += `- ${wf.id}: ${wf.regulation || 'N/A'}\n`;
        }
    }

    text += `\nINSTRUÇÕES MULTI-TURN:
Se precisar de mais dados antes de responder, use QUERY_STATE ou QUERY_COMPLIANCE.
O resultado será retornado automaticamente para você continuar raciocinando.
Máximo 5 consultas por mensagem do usuário.
Para ações que modificam o modelo, retorne como sempre no formato JSON com confirmação.\n`;

    return text;
}

/**
 * Formata parametros de uma funcao para o prompt.
 */
function formatParams(params) {
    if (!params) return '';
    const text = '  Params: ';
    const parts = [];
    for (const [key, def] of Object.entries(params)) {
        let s = `${key} (${def.type}`;
        if (def.enum) s += `: ${def.enum.join('|')}`;
        if (def.required) s += ', required';
        s += ')';
        parts.push(s);
    }
    return text + parts.join(', ') + '\n';
}
