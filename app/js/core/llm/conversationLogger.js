// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Module: conversationLogger — Interceptor de chamadas ao agentLoop
// Status: STUB — logging completo pendente (integração com ecbytsbots)

/* ================================================================
   CONVERSATION LOGGER — Interceptor para rastrear chamadas ao agente
   ================================================================

   Registra cada invocação do processAgentCommand para alimentar
   o dashboard de telemetria em ecbytsbots (localhost:3001).

   Integração futura com ecbytsbots/scripts/agent-conversation-logger.js
   via ECBYTS_PROJECT_ROOT ou API REST.

   ================================================================ */

/**
 * Envolve a função processAgentCommand com logging de telemetria.
 * Stub: passthrough sem logging até integração completa com ecbytsbots.
 *
 * @param {Function} processAgentCommandFn - A função original do agentLoop
 * @returns {Function} Função com mesma assinatura, com logging intercalado
 */
export function interceptProcessAgentCommand(processAgentCommandFn) {
    // Stub: retorna a função original sem modificação.
    // Implementação futura: adicionar logging antes/depois da chamada.
    if (typeof processAgentCommandFn !== 'function') {
        return processAgentCommandFn;
    }
    return processAgentCommandFn;
}
