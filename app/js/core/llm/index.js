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
   MÓDULO LLM - Ponto de Entrada
   ================================================================

   Este arquivo exporta todas as funções do módulo LLM e fornece
   a função principal de processamento de comandos.

   USO:
   import { processCommand, initLLM } from './llm/index.js';

   await initLLM(); // Configura API key
   const result = await processCommand('adicionar benzeno 10 mg/L no ponto 1');

   ================================================================ */

// Exporta do client
export {
    LLMProvider,
    setApiKey,
    getApiKey,
    hasApiKey,
    clearApiKey,
    setProvider,
    getProvider,
    setModel,
    getModel,
    detectProvider,
    sendMessage,
    testConnection,
    validateConfig,
    getConfig,
} from './client.js';

// Exporta do router
export {
    EngineType,
    getEngine,
    setEngine,
    getEngineConfig,
    getEngineDisplayName,
    validateEngineConfig,
    routeMessage,
    routeMessageStream,
    getBrowserModel,
    setBrowserModel,
    getLocalUrl,
    setLocalUrl,
    getLocalModel,
    setLocalModel,
} from './router.js';

// Exporta do promptBuilder
export { buildSystemPrompt, buildLitePrompt, formatUserMessage, getContextSummary } from './promptBuilder.js';

// Exporta do parser
export {
    VALID_ACTIONS,
    parseResponse,
    resolveElementReference,
    resolveCampaignReference,
    resolveParameterReference,
    resolveUnitReference,
    validateActionParams,
} from './parser.js';

// Exporta do commandExecutor
export { executeCommand, getSupportedActions } from './commandExecutor.js';

// Exporta do agentLoop
export { processAgentCommand } from './agentLoop.js';

// Exporta do functions
export { isReadOnlyAction } from './functions.js';

// ================================================================
// FUNÇÃO PRINCIPAL DE PROCESSAMENTO
// ================================================================

import { hasApiKey, getConfig, setModel, getModel, testConnection } from './client.js';
import { routeMessage, validateEngineConfig, getEngine, EngineType } from './router.js';
import { buildSystemPrompt, formatUserMessage } from './promptBuilder.js';
import { parseResponse, validateActionParams } from './parser.js';
import { executeCommand } from './commandExecutor.js';
import { processAgentCommand } from './agentLoop.js';
import { isToolActive } from './chatTools.js';
import { showToast } from '../../utils/ui/toast.js';
import { t } from '../../utils/i18n/translations.js';

/**
 * Estado do chat
 */
let chatHistory = [];
let pendingConfirmation = null;

/**
 * Processa um comando em linguagem natural.
 * Se a engine e cloud e a tool 'workflows' esta ativa,
 * tenta o agent loop multi-turn antes do single-turn.
 *
 * @param {string} userInput - Texto do usuário
 * @param {Object} agentOptions - Opcoes do agent loop (onProgress, maxTurns)
 * @returns {Promise<Object>} - Resultado do processamento
 */
export async function processCommand(userInput, agentOptions = {}) {
    // Verifica configuração da engine ativa
    const engineValidation = validateEngineConfig();
    if (!engineValidation.valid) {
        return {
            success: false,
            needsConfig: true,
            message: engineValidation.message || t('llmNoApiKey') || 'Configure the AI engine first',
        };
    }

    try {
        // --- Agentic mode: tenta multi-turn se engine cloud + tool workflows ativa ---
        if (getEngine() === EngineType.CLOUD && isToolActive('workflows')) {
            const agentResult = await processAgentCommand(userInput, agentOptions);
            if (agentResult) {
                // Adiciona ao historico
                chatHistory.push({
                    role: 'user',
                    content: userInput,
                    timestamp: new Date().toISOString(),
                });

                if (agentResult.type === 'message') {
                    chatHistory.push({
                        role: 'assistant',
                        content: agentResult.content,
                        timestamp: new Date().toISOString(),
                    });
                    return {
                        success: true,
                        understood: false,
                        message: agentResult.content,
                        agentTurns: agentResult.turns,
                    };
                }

                if (agentResult.type === 'action') {
                    pendingConfirmation = {
                        action: agentResult.action,
                        params: agentResult.params,
                        confirmation: agentResult.confirmation,
                    };
                    chatHistory.push({
                        role: 'assistant',
                        content: agentResult.confirmation,
                        timestamp: new Date().toISOString(),
                        pendingAction: true,
                    });
                    return {
                        success: true,
                        understood: true,
                        needsConfirmation: true,
                        action: agentResult.action,
                        params: agentResult.params,
                        confirmation: agentResult.confirmation,
                        agentTurns: agentResult.turns,
                    };
                }

                if (agentResult.type === 'error') {
                    // Fallback para single-turn
                    console.warn('Agent loop failed, falling back to single-turn:', agentResult.message);
                }
            }
        }

        // --- Single-turn mode (default) ---

        // Constrói prompts
        const systemPrompt = buildSystemPrompt();
        const userMessage = formatUserMessage(userInput);

        // Adiciona ao histórico
        chatHistory.push({
            role: 'user',
            content: userInput,
            timestamp: new Date().toISOString(),
        });

        // Chama o LLM via router (cloud, browser ou local)
        const response = await routeMessage(systemPrompt, userMessage);

        // Parse da resposta
        const parsed = parseResponse(response.content);

        if (!parsed.success) {
            // Se o parse falhou mas temos dados parciais com confirmation,
            // mostra como mensagem do assistente em vez de erro
            if (parsed.data?.confirmation) {
                return {
                    success: true,
                    understood: false,
                    message: parsed.data.confirmation,
                };
            }
            return {
                success: true,
                understood: false,
                message: parsed.error || 'Não consegui interpretar a resposta. Tente reformular o comando.',
            };
        }

        const data = parsed.data;

        // Se o LLM não entendeu
        if (!data.understood) {
            chatHistory.push({
                role: 'assistant',
                content: data.confirmation,
                timestamp: new Date().toISOString(),
            });

            return {
                success: true,
                understood: false,
                message: data.confirmation,
                ambiguities: data.ambiguities,
            };
        }

        // Valida parâmetros
        const validation = validateActionParams(data.action, data.params);

        if (!validation.valid) {
            // Mostra como mensagem amigável do assistente, não como erro
            const friendlyMsg = data.confirmation ? data.confirmation : validation.errors.join('; ');

            chatHistory.push({
                role: 'assistant',
                content: friendlyMsg,
                timestamp: new Date().toISOString(),
            });

            return {
                success: true,
                understood: false,
                message: friendlyMsg,
                action: data.action,
                params: data.params,
            };
        }

        // Armazena para confirmação
        pendingConfirmation = {
            action: data.action,
            params: validation.resolvedParams,
            confirmation: data.confirmation,
        };

        chatHistory.push({
            role: 'assistant',
            content: data.confirmation,
            timestamp: new Date().toISOString(),
            pendingAction: true,
        });

        return {
            success: true,
            understood: true,
            needsConfirmation: true,
            action: data.action,
            params: validation.resolvedParams,
            confirmation: data.confirmation,
        };
    } catch (error) {
        console.error('Erro ao processar comando:', error);
        return {
            success: false,
            message: error.message || 'Erro ao processar comando',
        };
    }
}

/**
 * Confirma e executa a ação pendente
 * @returns {Promise<Object>}
 */
export async function confirmAction() {
    if (!pendingConfirmation) {
        return {
            success: false,
            message: 'Nenhuma ação pendente',
        };
    }

    const { action, params } = pendingConfirmation;

    try {
        const result = await executeCommand(action, params);

        // Limpa ação pendente
        pendingConfirmation = null;

        if (result.success) {
            chatHistory.push({
                role: 'system',
                content: result.message,
                timestamp: new Date().toISOString(),
            });

            showToast(result.message, 'success');
        }

        return result;
    } catch (error) {
        pendingConfirmation = null;
        return {
            success: false,
            message: error.message,
        };
    }
}

/**
 * Cancela a ação pendente
 */
export function cancelAction() {
    if (pendingConfirmation) {
        chatHistory.push({
            role: 'system',
            content: 'Ação cancelada',
            timestamp: new Date().toISOString(),
        });
        pendingConfirmation = null;
    }
}

/**
 * Retorna o histórico do chat
 * @returns {Array}
 */
export function getChatHistory() {
    return [...chatHistory];
}

/**
 * Limpa o histórico do chat
 */
export function clearChatHistory() {
    chatHistory = [];
    pendingConfirmation = null;
}

/**
 * Verifica se há ação pendente
 * @returns {boolean}
 */
export function hasPendingAction() {
    return pendingConfirmation !== null;
}

/**
 * Retorna a ação pendente
 * @returns {Object|null}
 */
export function getPendingAction() {
    return pendingConfirmation ? { ...pendingConfirmation } : null;
}

/**
 * Set a pending action from external source (streaming handler).
 * Permite que o handler de streaming armazene acao pendente
 * para posterior confirmacao via confirmAction().
 *
 * @param {Object} actionData - { action, params, confirmation }
 */
export function setPendingAction(actionData) {
    pendingConfirmation = actionData ? { ...actionData } : null;
}
