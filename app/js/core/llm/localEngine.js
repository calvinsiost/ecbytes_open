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
   LOCAL ENGINE — OpenAI-compatible local server client
   ================================================================

   Cliente para servidores locais como Ollama, LM Studio e llama.cpp.
   Usa formato OpenAI-compativel (POST /v1/chat/completions).
   Suporta modo sincrono e streaming (SSE).

   ================================================================ */

const LOCAL_TIMEOUT_MS = 120_000; // 2 minutos — modelos locais sao mais lentos

// ----------------------------------------------------------------
// SYNCHRONOUS GENERATION
// Chamada sincrona (stream: false) — retorna resposta completa
// ----------------------------------------------------------------

/**
 * Generate response from local server (non-streaming).
 * Envia mensagem para servidor local e aguarda resposta completa.
 *
 * @param {string} url - Server endpoint (ex: http://localhost:11434/v1/chat/completions)
 * @param {string} model - Model name (ex: llama3.2:3b)
 * @param {string} systemPrompt - System prompt
 * @param {string} userMessage - User message
 * @param {Object} [options] - temperature, maxTokens, signal
 * @returns {Promise<Object>} - { content, provider: 'local', model, usage }
 */
export async function generateLocal(url, model, systemPrompt, userMessage, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), LOCAL_TIMEOUT_MS);

    // Encadeia signal externo se fornecido
    if (options.signal) {
        if (options.signal.aborted) {
            clearTimeout(timeoutId);
            throw new DOMException('Aborted', 'AbortError');
        }
        options.signal.addEventListener('abort', () => controller.abort(options.signal.reason), { once: true });
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage },
                ],
                temperature: options.temperature ?? 0.3,
                max_tokens: options.maxTokens ?? 1000,
                stream: false,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `Local server error: ${response.status}`);
        }

        const data = await response.json();
        return {
            content: data.choices?.[0]?.message?.content || '',
            provider: 'local',
            model,
            usage: data.usage || {},
        };
    } catch (err) {
        throw wrapLocalError(err, url);
    } finally {
        clearTimeout(timeoutId);
    }
}

// ----------------------------------------------------------------
// STREAMING GENERATION
// Usa SSE (Server-Sent Events) para yield de tokens incrementais
// ----------------------------------------------------------------

/**
 * Generate response from local server (streaming).
 * Async generator que yield tokens conforme chegam via SSE.
 *
 * @param {string} url - Server endpoint
 * @param {string} model - Model name
 * @param {string} systemPrompt - System prompt
 * @param {string} userMessage - User message
 * @param {Object} [options] - temperature, maxTokens, signal
 * @yields {string} Individual tokens
 */
export async function* generateLocalStream(url, model, systemPrompt, userMessage, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), LOCAL_TIMEOUT_MS);

    if (options.signal) {
        if (options.signal.aborted) {
            clearTimeout(timeoutId);
            throw new DOMException('Aborted', 'AbortError');
        }
        options.signal.addEventListener('abort', () => controller.abort(options.signal.reason), { once: true });
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage },
                ],
                temperature: options.temperature ?? 0.3,
                max_tokens: options.maxTokens ?? 1000,
                stream: true,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `Local server error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // Ultimo elemento pode ser incompleto — preserva no buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;

                const payload = trimmed.slice(5).trim();
                if (payload === '[DONE]') return;

                try {
                    const chunk = JSON.parse(payload);
                    const token = chunk.choices?.[0]?.delta?.content;
                    if (token) yield token;
                } catch {
                    // Linha SSE malformada — ignora silenciosamente
                }
            }
        }
    } catch (err) {
        throw wrapLocalError(err, url);
    } finally {
        clearTimeout(timeoutId);
    }
}

// ----------------------------------------------------------------
// CONNECTION TEST
// Testa conectividade com o servidor local
// ----------------------------------------------------------------

/**
 * Test connection to local server.
 * Envia prompt minimo para verificar se o servidor responde.
 *
 * @param {string} url - Server endpoint
 * @param {string} model - Model name
 * @returns {Promise<Object>} - { success, message, models? }
 */
export async function testLocalConnection(url, model) {
    try {
        const result = await generateLocal(url, model, 'Reply with OK only.', 'Say OK.', { maxTokens: 10 });
        return {
            success: true,
            message: `Connected: ${model} @ ${new URL(url).host}`,
        };
    } catch (err) {
        return {
            success: false,
            message: err.message,
        };
    }
}

// ----------------------------------------------------------------
// MODEL DISCOVERY
// Busca lista de modelos disponiveis no servidor local
// ----------------------------------------------------------------

/**
 * Fetch available models from local server.
 * Chama GET /v1/models (padrao OpenAI) para listar modelos.
 *
 * @param {string} baseUrl - Server base URL (ex: http://localhost:11434)
 * @returns {Promise<Array<string>>} - Lista de model IDs
 */
export async function fetchLocalModels(baseUrl) {
    // Deriva URL de models a partir do endpoint de completions
    const modelsUrl = baseUrl.replace(/\/v1\/chat\/completions\/?$/, '/v1/models');

    try {
        const response = await fetch(modelsUrl, {
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const data = await response.json();
        return (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
    } catch (err) {
        throw wrapLocalError(err, modelsUrl);
    }
}

// ----------------------------------------------------------------
// ERROR WRAPPER
// Traduz erros de rede em mensagens uteis para o usuario
// ----------------------------------------------------------------

/**
 * Wrap network errors with helpful guidance.
 * Transforma erros genericos em mensagens com orientacao de CORS.
 *
 * @param {Error} err - Erro original
 * @param {string} url - URL tentada
 * @returns {Error} Erro com mensagem amigavel
 */
function wrapLocalError(err, url) {
    // CORS ou servidor indisponivel — TypeError: Failed to fetch
    if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        return new Error(
            `Cannot reach local server at ${url}.\n` +
                'Check:\n' +
                '1. Server is running (ollama serve / lm-studio)\n' +
                '2. CORS is enabled (Ollama: OLLAMA_ORIGINS=* ollama serve)\n' +
                '3. URL is correct',
        );
    }

    // Timeout
    if (err.name === 'TimeoutError') {
        return new Error(
            `Local server timed out after ${LOCAL_TIMEOUT_MS / 1000}s.\n` +
                'The model may be too large or the server overloaded.',
        );
    }

    // AbortError — usuario cancelou
    if (err.name === 'AbortError') {
        return new Error('Request cancelled.');
    }

    return err;
}
