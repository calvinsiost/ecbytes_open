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
   CLIENTE LLM — Multi-provider API abstraction
   ================================================================

   Interface unificada para comunicacao com multiplos provedores LLM.
   Suporta OpenAI, Claude, Google Gemini, DeepSeek e Groq.

   FUNCIONALIDADES:
   - Armazenamento seguro de API key (sessionStorage)
   - Suporte a 5 provedores
   - Selecao de modelo por provedor
   - Teste de conexao
   - Tratamento de erros e rate limiting
   - Suporte a visao/imagem (options.image) para analise multimodal

   ================================================================ */

import {
    LLMProvider,
    PROVIDER_CONFIG,
    getProviderConfig,
    getDefaultModel,
    detectProviderFromKey,
} from './providers.js';

// Re-export LLMProvider for backwards compatibility
// Mantém compatibilidade com imports existentes
export { LLMProvider };

// ================================================================
// STORAGE KEYS
// ================================================================

const STORAGE_KEYS = {
    API_KEY: 'ecbyts_llm_key',
    PROVIDER: 'ecbyts_llm_provider',
    MODEL: 'ecbyts_llm_model',
};

// ================================================================
// API KEY MANAGEMENT
// Gerenciamento de chave de API (armazenada na sessao do navegador)
// ================================================================

/**
 * Save API key to browser session.
 * Salva a API key na sessao do navegador.
 * @param {string} key - A chave de API
 */
export function setApiKey(key) {
    sessionStorage.setItem(STORAGE_KEYS.API_KEY, key);
}

/**
 * Retrieve API key from session.
 * Recupera a API key da sessao.
 * @returns {string|null}
 */
export function getApiKey() {
    return sessionStorage.getItem(STORAGE_KEYS.API_KEY);
}

/**
 * Check if API key is configured.
 * Verifica se ha uma API key configurada.
 * @returns {boolean}
 */
export function hasApiKey() {
    const key = getApiKey();
    return key !== null && key.trim() !== '';
}

/**
 * Remove API key from session.
 * Remove a API key da sessao.
 */
export function clearApiKey() {
    sessionStorage.removeItem(STORAGE_KEYS.API_KEY);
}

// ================================================================
// PROVIDER MANAGEMENT
// Gerenciamento de provedor e modelo selecionado
// ================================================================

/**
 * Set the LLM provider.
 * Define o provedor de LLM.
 * @param {string} provider - Provider ID (openai, claude, google, deepseek, groq)
 */
export function setProvider(provider) {
    if (!PROVIDER_CONFIG[provider]) {
        throw new Error(`Provider inválido: ${provider}`);
    }
    sessionStorage.setItem(STORAGE_KEYS.PROVIDER, provider);
}

/**
 * Get configured provider.
 * Recupera o provedor configurado.
 * @returns {string}
 */
export function getProvider() {
    return sessionStorage.getItem(STORAGE_KEYS.PROVIDER) || LLMProvider.OPENAI;
}

/**
 * Set the model for current provider.
 * Define o modelo para o provedor atual.
 * @param {string} model - Model identifier
 */
export function setModel(model) {
    sessionStorage.setItem(STORAGE_KEYS.MODEL, model);
}

/**
 * Get configured model (falls back to provider default).
 * Recupera o modelo configurado.
 * @returns {string}
 */
export function getModel() {
    return sessionStorage.getItem(STORAGE_KEYS.MODEL) || getDefaultModel(getProvider());
}

/**
 * Detect provider from API key format.
 * Detecta o provedor baseado no formato da API key.
 * @param {string} key - A chave de API
 * @returns {string}
 */
export function detectProvider(key) {
    return detectProviderFromKey(key);
}

// ================================================================
// LLM CLIENT — Send messages to any provider
// Envia mensagens para qualquer provedor de LLM
// ================================================================

const LLM_TIMEOUT_MS = 30_000; // 30 segundos — evita fetch pendurado indefinidamente

/**
 * Fetch com timeout e suporte a AbortSignal externo.
 * Aborta automaticamente após timeoutMs milissegundos.
 * Se options.signal for passado, o fetch respeita ambos (timeout interno + sinal externo).
 *
 * @param {string} url
 * @param {Object} fetchOptions
 * @param {AbortSignal|null} externalSignal
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, fetchOptions, externalSignal, timeoutMs = LLM_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);

    // Se o caller passou um signal externo, encadeia o abort
    if (externalSignal) {
        if (externalSignal.aborted) {
            clearTimeout(timeoutId);
            controller.abort(externalSignal.reason);
        } else {
            externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
        }
    }

    try {
        return await fetch(url, { ...fetchOptions, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Send message to LLM and return response.
 * Envia mensagem para o LLM e retorna a resposta.
 *
 * @param {string} systemPrompt - System prompt with context
 * @param {string} userMessage - User's message
 * @param {Object} options - Additional options (model, temperature, maxTokens, image)
 * @param {string} [options.image] - Base64 data URL for vision (data:image/jpeg;base64,...)
 * @returns {Promise<Object>} - { content, provider, model, usage }
 */
export async function sendMessage(systemPrompt, userMessage, options = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('API key não configurada');
    }

    const provider = getProvider();
    const config = getProviderConfig(provider);
    if (!config) {
        throw new Error(`Provider não suportado: ${provider}`);
    }

    try {
        switch (config.apiFormat) {
            case 'openai':
                return await callOpenAICompatible(config, systemPrompt, userMessage, apiKey, options);
            case 'claude':
                return await callClaude(systemPrompt, userMessage, apiKey, options);
            case 'google':
                return await callGoogle(config, systemPrompt, userMessage, apiKey, options);
            default:
                throw new Error(`Formato de API desconhecido: ${config.apiFormat}`);
        }
    } catch (error) {
        console.error(`Erro na chamada LLM (${provider}):`, error);
        throw error;
    }
}

// ================================================================
// PROVIDER-SPECIFIC API CALLS
// ================================================================

/**
 * Call OpenAI-compatible APIs (OpenAI, DeepSeek, Groq).
 * Chamada para APIs compativeis com o formato OpenAI.
 */
async function callOpenAICompatible(config, systemPrompt, userMessage, apiKey, options = {}) {
    const model = options.model || getModel();

    // Vision support — se options.image presente, envia conteudo multimodal
    const userContent = options.image
        ? [
              { type: 'text', text: userMessage },
              { type: 'image_url', image_url: { url: options.image } },
          ]
        : userMessage;

    const response = await fetchWithTimeout(
        config.endpoint,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent },
                ],
                temperature: options.temperature || 0.3,
                max_tokens: options.maxTokens || 1000,
            }),
        },
        options.signal || null,
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `Erro ${config.name}: ${response.status}`);
    }

    const data = await response.json();
    return {
        content: data.choices[0]?.message?.content || '',
        provider: config.id,
        model: model,
        usage: data.usage,
    };
}

/**
 * Call Anthropic Claude API.
 * Chamada para API da Anthropic (Claude).
 */
async function callClaude(systemPrompt, userMessage, apiKey, options = {}) {
    const model = options.model || getModel();

    // Vision support — se options.image presente, envia conteudo multimodal
    let userContent = userMessage;
    if (options.image) {
        const [header, base64Data] = options.image.split(',');
        const mediaType = (header.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
        userContent = [
            { type: 'text', text: userMessage },
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
        ];
    }

    const response = await fetchWithTimeout(
        PROVIDER_CONFIG[LLMProvider.CLAUDE].endpoint,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model: model,
                max_tokens: options.maxTokens || 1000,
                system: systemPrompt,
                messages: [{ role: 'user', content: userContent }],
            }),
        },
        options.signal || null,
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `Erro Claude: ${response.status}`);
    }

    const data = await response.json();
    return {
        content: data.content[0]?.text || '',
        provider: LLMProvider.CLAUDE,
        model: model,
        usage: data.usage,
    };
}

/**
 * Call Google Gemini API.
 * Chamada para API do Google Gemini (usa query param para autenticacao).
 */
async function callGoogle(config, systemPrompt, userMessage, apiKey, options = {}) {
    const model = options.model || getModel();
    const url = `${config.endpoint}/${model}:generateContent?key=${apiKey}`;

    // Vision support — se options.image presente, adiciona inlineData
    const userParts = [{ text: userMessage }];
    if (options.image) {
        const [header, base64Data] = options.image.split(',');
        const mimeType = (header.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
        userParts.push({ inlineData: { mimeType, data: base64Data } });
    }

    const response = await fetchWithTimeout(
        url,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                system_instruction: {
                    parts: [{ text: systemPrompt }],
                },
                contents: [
                    {
                        role: 'user',
                        parts: userParts,
                    },
                ],
                generationConfig: {
                    temperature: options.temperature || 0.3,
                    maxOutputTokens: options.maxTokens || 1000,
                },
            }),
        },
        options.signal || null,
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `Erro Gemini: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return {
        content: text,
        provider: LLMProvider.GOOGLE,
        model: model,
        usage: data.usageMetadata || {},
    };
}

// ================================================================
// CONNECTION TEST
// Testa a conexao com o provedor usando uma requisicao minima
// ================================================================

/**
 * Test connection to current provider.
 * Testa a conexao com o provedor selecionado.
 *
 * @returns {Promise<Object>} - { success, message, provider, model }
 */
export async function testConnection() {
    const apiKey = getApiKey();
    if (!apiKey) {
        return { success: false, message: 'API key não configurada' };
    }

    try {
        const result = await sendMessage(
            'You are a test assistant. Reply with exactly: OK',
            'Respond with the word OK only.',
            { maxTokens: 10 },
        );

        return {
            success: true,
            message: `Conectado: ${result.provider} (${result.model})`,
            provider: result.provider,
            model: result.model,
        };
    } catch (error) {
        return {
            success: false,
            message: error.message || 'Falha na conexão',
        };
    }
}

// ================================================================
// UTILITIES
// ================================================================

/**
 * Validate configuration completeness.
 * Verifica se a configuracao esta completa.
 * @returns {Object} - { valid: boolean, message: string }
 */
export function validateConfig() {
    if (!hasApiKey()) {
        return { valid: false, message: 'API key não configurada' };
    }
    return { valid: true, message: 'Configuração válida' };
}

/**
 * Get current configuration info.
 * Retorna informacoes sobre a configuracao atual.
 * @returns {Object}
 */
export function getConfig() {
    const provider = getProvider();
    const config = getProviderConfig(provider);
    return {
        hasKey: hasApiKey(),
        provider: provider,
        providerName: config ? config.name : provider,
        model: getModel(),
    };
}

// ================================================================
// SUPABASE PERSISTENCE — API key encrypted cloud sync
// Persistencia de chaves LLM no Supabase, encriptadas com AES-GCM.
// A chave de encriptacao e derivada do userId via PBKDF2 —
// deterministico, sem necessidade de senha adicional.
// Protege contra vazamentos de banco (dump SQL) sem expor o plaintext.
// ================================================================

// F03 — Salt legado (pre-migration). Valor publico (visivel no source) — risco aceito:
// migration on-read move todas as rows ativas para salt per-user na proxima carga.
const _LEGACY_SALT = 'ecbyts-llm-v1';

/**
 * Derive AES-GCM key from userId via PBKDF2.
 * F03 — salt agora e per-user (hex string de 32 bytes).
 * @param {string} userId
 * @param {string} salt - hex string (64 chars) ou salt legado
 * @returns {Promise<CryptoKey>}
 */
async function _deriveEncKey(userId, salt) {
    const enc = new TextEncoder();
    const keyMat = await crypto.subtle.importKey('raw', enc.encode(userId), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100_000, hash: 'SHA-256' },
        keyMat,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

/**
 * F03 — Gera salt criptografico unico (32 bytes -> 64 hex chars).
 * @returns {string}
 */
function _generateSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Encrypt plaintext to base64(iv || ciphertext) using AES-GCM.
 * @param {CryptoKey} key
 * @param {string} plaintext
 * @returns {Promise<string>}
 */
async function _aesEncrypt(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
    const buf = new Uint8Array(12 + cipher.byteLength);
    buf.set(iv, 0);
    buf.set(new Uint8Array(cipher), 12);
    return btoa(String.fromCharCode(...buf));
}

/**
 * Decrypt base64(iv || ciphertext) back to plaintext.
 * @param {CryptoKey} key
 * @param {string} b64
 * @returns {Promise<string>}
 */
async function _aesDecrypt(key, b64) {
    const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const iv = buf.slice(0, 12);
    const cipher = buf.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return new TextDecoder().decode(plain);
}

/**
 * Save API key for a provider to Supabase (AES-GCM encrypted).
 * Salva a API key de um provider no Supabase encriptada.
 *
 * @param {Object} supabase - Supabase client
 * @param {string} userId
 * @param {string} provider - openai | claude | google | deepseek | groq
 * @param {string} apiKey - plaintext API key
 * @param {string} [model] - selected model identifier
 * @returns {Promise<void>}
 */
export async function saveKeyToSupabase(supabase, userId, provider, apiKey, model) {
    // F03 — Buscar salt existente ou gerar novo
    let salt;
    const { data: existing } = await supabase
        .from('user_llm_keys')
        .select('enc_salt')
        .eq('user_id', userId)
        .eq('provider', provider)
        .single();
    salt = existing?.enc_salt || _generateSalt();

    const encKey = await _deriveEncKey(userId, salt);
    const encApiKey = await _aesEncrypt(encKey, apiKey);
    const { error } = await supabase.from('user_llm_keys').upsert(
        {
            user_id: userId,
            provider,
            enc_key: encApiKey,
            enc_salt: salt,
            model: model || null,
            updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
    );
    if (error) throw new Error(error.message);
}

/**
 * Load all saved API keys for a user from Supabase (decrypted).
 * Carrega e decripta todas as API keys salvas do usuario.
 *
 * @param {Object} supabase - Supabase client
 * @param {string} userId
 * @returns {Promise<Object|null>} { provider: { key, model } } ou null se vazio/erro
 */
export async function loadKeysFromSupabase(supabase, userId) {
    const { data, error } = await supabase
        .from('user_llm_keys')
        .select('provider, enc_key, enc_salt, model')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
    if (error || !data?.length) return null;
    const result = {};
    for (const row of data) {
        try {
            let apiKey;
            if (row.enc_salt) {
                // Formato v2: salt per-user
                const encKey = await _deriveEncKey(userId, row.enc_salt);
                apiKey = await _aesDecrypt(encKey, row.enc_key);
            } else {
                // F03 — Legado: salt fixo. Decriptar e re-salvar com salt novo (migration on-read)
                const legacyKey = await _deriveEncKey(userId, _LEGACY_SALT);
                apiKey = await _aesDecrypt(legacyKey, row.enc_key);
                // Re-encrypt com salt per-user (async, nao bloqueia).
                // Inclui model para evitar perda em upsert (PostgREST PATCH preserva, mas explicito e mais seguro)
                const newSalt = _generateSalt();
                const newKey = await _deriveEncKey(userId, newSalt);
                const newEnc = await _aesEncrypt(newKey, apiKey);
                supabase
                    .from('user_llm_keys')
                    .upsert(
                        {
                            user_id: userId,
                            provider: row.provider,
                            enc_key: newEnc,
                            enc_salt: newSalt,
                            model: row.model,
                            updated_at: new Date().toISOString(),
                        },
                        { onConflict: 'user_id,provider' },
                    )
                    .then(({ error: e }) => {
                        if (e) console.warn('[llm] migration salt falhou:', row.provider, e.message);
                    });
            }
            result[row.provider] = { key: apiKey, model: row.model };
        } catch (e) {
            console.warn(`[llm] row corrompida provider=${row.provider}, ignorando:`, e.message);
        }
    }
    return Object.keys(result).length ? result : null;
}
