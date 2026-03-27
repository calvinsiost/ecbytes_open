// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   AGENT LOOP — Execucao multi-turn para LLM agentic
   Permite que o LLM consulte estado do modelo (read-only)
   antes de responder, encadeando ate 5 turns.

   APENAS para engines cloud. Browser/local usam single-turn.

   Pipeline:
   User → buildAgenticPrompt() → routeMessage() → parseResponse()
     → Se read-only (QUERY_*): executa, adiciona resultado, loop
     → Se mutante: retorna para confirmacao do usuario
     → Se conversacional: retorna texto
   ================================================================ */

import { routeMessage, validateEngineConfig, getEngine, EngineType } from './router.js';
import { buildAgenticPrompt, formatUserMessage } from './promptBuilder.js';
import { parseResponse, validateActionParams } from './parser.js';
import { executeCommand } from './commandExecutor.js';
import { isReadOnlyAction } from './functions.js';
import { eventBus, Events } from '../analytics/eventBus.js';
import { interceptProcessAgentCommand } from './conversationLogger.js';

/**
 * Processa um comando com capacidade agentic multi-turn.
 * O LLM pode chamar QUERY_STATE/QUERY_ELEMENT/QUERY_COMPLIANCE
 * automaticamente (sem confirmacao) para obter dados, e depois
 * responder com uma acao ou mensagem.
 *
 * @param {string} userInput - Texto do usuario
 * @param {Object} options
 * @param {number} options.maxTurns - Maximo de turns (default 5)
 * @param {Function} options.onProgress - Callback ({ turn, action, result })
 * @returns {Promise<AgentResult>}
 */
export async function processAgentCommand(userInput, options = {}) {
    const maxTurns = options.maxTurns || 5;

    // Verifica se engine e cloud (unica que suporta agentic)
    const engine = getEngine();
    if (engine !== EngineType.CLOUD) {
        // Fallback: retorna null para indicar que o caller deve usar single-turn
        return null;
    }

    const engineValidation = validateEngineConfig();
    if (!engineValidation.valid) {
        return {
            type: 'error',
            message: engineValidation.message || 'Configure the AI engine first',
        };
    }

    // Contexto da conversa multi-turn
    const conversationContext = [];
    conversationContext.push({
        role: 'user',
        content: formatUserMessage(userInput),
    });

    const systemPrompt = buildAgenticPrompt();

    for (let turn = 0; turn < maxTurns; turn++) {
        try {
            eventBus.emit(Events.AGENT_THINKING, { turn: turn + 1, maxTurns });

            // Monta mensagem com contexto acumulado
            const fullMessage = conversationContext
                .map((m) => {
                    if (m.role === 'function') {
                        return `[RESULT of ${m.name}]: ${m.content}`;
                    }
                    return m.content;
                })
                .join('\n\n');

            const response = await routeMessage(systemPrompt, fullMessage);
            const parsed = parseResponse(response.content);

            // LLM respondeu conversacionalmente
            if (!parsed.success || !parsed.data.understood) {
                return {
                    type: 'message',
                    content: parsed.data?.confirmation || parsed.error || 'Resposta não interpretada',
                    turns: turn + 1,
                };
            }

            const data = parsed.data;
            const action = data.action;

            // Read-only: executa silenciosamente e continua o loop
            if (action && isReadOnlyAction(action)) {
                const validation = validateActionParams(action, data.params);
                if (!validation.valid) {
                    // Se validacao falhou, retorna erro como mensagem
                    return {
                        type: 'message',
                        content: validation.errors.join('; '),
                        turns: turn + 1,
                    };
                }

                const result = await executeCommand(action, validation.resolvedParams);

                eventBus.emit(Events.AGENT_QUERY, {
                    turn: turn + 1,
                    action,
                    success: result.success,
                });

                // Adiciona ao contexto para o proximo turn
                conversationContext.push({
                    role: 'assistant',
                    content: JSON.stringify(data),
                });
                conversationContext.push({
                    role: 'function',
                    name: action,
                    content: result.success ? JSON.stringify(result.data) : `Error: ${result.message}`,
                });

                // Notifica progresso
                if (options.onProgress) {
                    options.onProgress({
                        turn: turn + 1,
                        action,
                        result: result.data,
                    });
                }

                continue; // Proximo turn
            }

            // Acao mutante: retorna para confirmacao do usuario
            const validation = validateActionParams(action, data.params);
            if (!validation.valid) {
                return {
                    type: 'message',
                    content: data.confirmation || validation.errors.join('; '),
                    turns: turn + 1,
                };
            }

            return {
                type: 'action',
                action: data.action,
                params: validation.resolvedParams,
                confirmation: data.confirmation,
                turns: turn + 1,
                context: conversationContext,
            };
        } catch (error) {
            console.error(`Agent loop turn ${turn + 1} error:`, error);
            return {
                type: 'error',
                message: error.message || 'Erro no agent loop',
                turns: turn + 1,
            };
        }
    }

    return {
        type: 'error',
        message: 'Agent exceeded maximum turns without resolution',
        turns: maxTurns,
    };
}
