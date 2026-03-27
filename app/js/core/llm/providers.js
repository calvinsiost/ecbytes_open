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
   LLM PROVIDERS REGISTRY — Multi-provider configuration
   Registro de provedores LLM com metadados e endpoints

   Cada provedor tem configuracao de endpoint, modelos disponiveis,
   formato de autenticacao e link para obter chave de API.
   ================================================================ */

// ================================================================
// PROVIDER IDS
// ================================================================

export const LLMProvider = {
    OPENAI: 'openai',
    CLAUDE: 'claude',
    GOOGLE: 'google',
    DEEPSEEK: 'deepseek',
    GROQ: 'groq',
};

// ================================================================
// PROVIDER CONFIGURATIONS
// ================================================================

export const PROVIDER_CONFIG = {
    [LLMProvider.OPENAI]: {
        id: LLMProvider.OPENAI,
        name: 'OpenAI',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        defaultModel: 'gpt-4o',
        models: [
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
        ],
        apiKeyUrl: 'https://platform.openai.com/api-keys',
        apiFormat: 'openai',
        keyPrefix: 'sk-',
        keyHint: 'sk-...',
    },

    [LLMProvider.CLAUDE]: {
        id: LLMProvider.CLAUDE,
        name: 'Anthropic Claude',
        endpoint: 'https://api.anthropic.com/v1/messages',
        defaultModel: 'claude-sonnet-4-20250514',
        models: [
            { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
            { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
            { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
        ],
        apiKeyUrl: 'https://console.anthropic.com/settings/keys',
        apiFormat: 'claude',
        keyPrefix: 'sk-ant-',
        keyHint: 'sk-ant-...',
    },

    [LLMProvider.GOOGLE]: {
        id: LLMProvider.GOOGLE,
        name: 'Google Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
        defaultModel: 'gemini-3.1-pro-preview',
        models: [
            { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash-lite-preview-06-17', name: 'Gemini 2.5 Flash Lite' },
        ],
        apiKeyUrl: 'https://aistudio.google.com/apikey',
        apiFormat: 'google',
        keyPrefix: 'AIza',
        keyHint: 'AIza...',
    },

    [LLMProvider.DEEPSEEK]: {
        id: LLMProvider.DEEPSEEK,
        name: 'DeepSeek',
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        defaultModel: 'deepseek-chat',
        models: [
            { id: 'deepseek-chat', name: 'DeepSeek Chat' },
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
        ],
        apiKeyUrl: 'https://platform.deepseek.com/api_keys',
        apiFormat: 'openai',
        keyPrefix: 'sk-',
        keyHint: 'sk-...',
    },

    [LLMProvider.GROQ]: {
        id: LLMProvider.GROQ,
        name: 'Groq',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        defaultModel: 'llama-3.3-70b-versatile',
        models: [
            { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
            { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
            { id: 'gemma2-9b-it', name: 'Gemma 2 9B' },
        ],
        apiKeyUrl: 'https://console.groq.com/keys',
        apiFormat: 'openai',
        keyPrefix: 'gsk_',
        keyHint: 'gsk_...',
    },
};

// ================================================================
// HELPERS
// ================================================================

/**
 * Get provider config by ID.
 * Retorna a configuracao de um provedor pelo seu ID.
 *
 * @param {string} providerId - Provider identifier
 * @returns {Object|null}
 */
export function getProviderConfig(providerId) {
    return PROVIDER_CONFIG[providerId] || null;
}

/**
 * Get all provider IDs.
 * Retorna lista de todos os provedores disponiveis.
 *
 * @returns {string[]}
 */
export function getAllProviderIds() {
    return Object.keys(PROVIDER_CONFIG);
}

/**
 * Get models for a provider.
 * Retorna a lista de modelos disponiveis para um provedor.
 *
 * @param {string} providerId - Provider identifier
 * @returns {Array<{id: string, name: string}>}
 */
export function getProviderModels(providerId) {
    const config = PROVIDER_CONFIG[providerId];
    return config ? config.models : [];
}

/**
 * Get default model for a provider.
 * Retorna o modelo padrao de um provedor.
 *
 * @param {string} providerId - Provider identifier
 * @returns {string}
 */
export function getDefaultModel(providerId) {
    const config = PROVIDER_CONFIG[providerId];
    return config ? config.defaultModel : 'gpt-4o';
}

/**
 * Detect provider from API key format.
 * Detecta o provedor baseado no formato da chave de API.
 *
 * @param {string} key - The API key
 * @returns {string} Provider ID
 */
export function detectProviderFromKey(key) {
    if (!key) return LLMProvider.OPENAI;
    if (key.startsWith('sk-ant-')) return LLMProvider.CLAUDE;
    if (key.startsWith('AIza')) return LLMProvider.GOOGLE;
    if (key.startsWith('gsk_')) return LLMProvider.GROQ;
    // DeepSeek and OpenAI both use sk- prefix, default to OpenAI
    return LLMProvider.OPENAI;
}

/**
 * Get API key URL for a provider.
 * Retorna o link para obter a chave de API de um provedor.
 *
 * @param {string} providerId - Provider identifier
 * @returns {string}
 */
export function getApiKeyUrl(providerId) {
    const config = PROVIDER_CONFIG[providerId];
    return config ? config.apiKeyUrl : '';
}

/**
 * Update the model list for a provider at runtime.
 * Atualiza a lista de modelos de um provedor em tempo de execucao.
 *
 * @param {string} providerId
 * @param {Array<{id: string, name: string}>} models
 */
export function setProviderModels(providerId, models) {
    const config = PROVIDER_CONFIG[providerId];
    if (config && models.length > 0) {
        config.models = models;
    }
}

// ================================================================
// DYNAMIC MODEL FETCHING
// Busca modelos disponiveis diretamente da API do provedor
// ================================================================

/**
 * Fetch available models from a provider's API.
 * Busca a lista de modelos disponiveis direto da API do provedor.
 * Cada provedor tem um endpoint e formato diferente.
 *
 * @param {string} providerId - Provider identifier
 * @param {string} apiKey - API key for authentication
 * @returns {Promise<Array<{id: string, name: string}>>} List of models
 */
export async function fetchProviderModels(providerId, apiKey) {
    if (!apiKey) throw new Error('API key required');

    switch (providerId) {
        case LLMProvider.OPENAI:
            return await fetchOpenAIModels(apiKey, 'https://api.openai.com/v1/models');
        case LLMProvider.CLAUDE:
            return await fetchClaudeModels(apiKey);
        case LLMProvider.GOOGLE:
            return await fetchGoogleModels(apiKey);
        case LLMProvider.DEEPSEEK:
            return await fetchOpenAIModels(apiKey, 'https://api.deepseek.com/v1/models');
        case LLMProvider.GROQ:
            return await fetchOpenAIModels(apiKey, 'https://api.groq.com/openai/v1/models');
        default:
            return [];
    }
}

/**
 * Fetch models from OpenAI-compatible API (OpenAI, DeepSeek, Groq).
 * @param {string} apiKey
 * @param {string} endpoint - Base models endpoint
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function fetchOpenAIModels(apiKey, endpoint) {
    const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const models = (data.data || [])
        .filter((m) => {
            const id = m.id.toLowerCase();
            // Filter for chat-capable models, skip embeddings/tts/whisper/dall-e/moderation
            if (
                id.includes('embed') ||
                id.includes('tts') ||
                id.includes('whisper') ||
                id.includes('dall-e') ||
                id.includes('moderation') ||
                id.includes('realtime') ||
                id.includes('transcri') ||
                id.includes('audio')
            ) {
                return false;
            }
            return true;
        })
        .map((m) => ({
            id: m.id,
            name: formatModelName(m.id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return models;
}

/**
 * Fetch models from Anthropic Claude API.
 * @param {string} apiKey
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function fetchClaudeModels(apiKey) {
    const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
        },
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const models = (data.data || [])
        .map((m) => ({
            id: m.id,
            name: formatModelName(m.id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return models;
}

/**
 * Fetch models from Google Gemini API.
 * @param {string} apiKey
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function fetchGoogleModels(apiKey) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const models = (data.models || [])
        .filter((m) => {
            // Only models that support generateContent
            const methods = m.supportedGenerationMethods || [];
            return methods.includes('generateContent');
        })
        .map((m) => {
            // Google model names are "models/gemini-2.5-flash", strip prefix
            const id = m.name.replace('models/', '');
            return {
                id,
                name: m.displayName || formatModelName(id),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    return models;
}

/**
 * Format a model ID into a readable name.
 * Formata o ID do modelo em um nome legivel.
 *
 * @param {string} modelId
 * @returns {string}
 */
function formatModelName(modelId) {
    return modelId
        .replace(/^models\//, '')
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}
