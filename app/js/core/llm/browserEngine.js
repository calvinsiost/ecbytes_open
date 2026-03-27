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
   BROWSER ENGINE — On-device LLM inference via Transformers.js v3
   ================================================================

   Inferencia local de modelos de linguagem no navegador usando
   WebGPU (aceleracao por GPU) ou WASM (fallback CPU).

   Usa Transformers.js v4 (@huggingface/transformers@4) via CDN.
   Modelo carregado sob demanda com singleton — nao recarrega a
   cada mensagem. Pesos do modelo cachados pelo Cache API do browser.

   NOTA: Separado do @xenova/transformers@2 usado pelo recognition/.
   Ambas versoes coexistem sem conflito (CDN paths distintos).

   ================================================================ */

// ----------------------------------------------------------------
// CDN & MODEL CONFIGURATION
// ----------------------------------------------------------------

import { importCDN } from '../../utils/helpers/cdnLoader.js';

const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0-next.3';

/**
 * Available browser models with metadata.
 * Modelos disponiveis para inferencia local, com info de hardware.
 */
const BROWSER_MODELS = [
    {
        id: 'onnx-community/gemma-3-270m-it-ONNX',
        name: 'Gemma 3 270M',
        size: '270M',
        vramGB: 0.4,
        tier: 'micro',
        dtype: 'q4f16',
        selfHosted: true,
        nameKey: 'browserModelGemma270m',
        descKey: 'browserModelGemma270mDesc',
    },
    {
        id: 'onnx-community/Qwen2.5-1.5B-Instruct',
        name: 'Qwen 2.5 1.5B',
        size: '1.5B',
        vramGB: 1.2,
        tier: 'mobile',
        nameKey: 'browserModelQwen',
        descKey: 'browserModelQwenDesc',
    },
    {
        id: 'LiquidAI/LFM2.5-1.2B-Thinking-ONNX',
        name: 'LFM 2.5 1.2B Thinking',
        size: '1.2B',
        vramGB: 0.8,
        tier: 'mobile',
        nameKey: 'browserModelLFM',
        descKey: 'browserModelLFMDesc',
    },
    {
        id: 'onnx-community/Llama-3.2-3B-Instruct',
        name: 'Llama 3.2 3B',
        size: '3B',
        vramGB: 2.0,
        tier: 'desktop',
        nameKey: 'browserModelLlama',
        descKey: 'browserModelLlamaDesc',
    },
];

// ----------------------------------------------------------------
// SINGLETON STATE
// Modelo carregado uma unica vez, reutilizado entre mensagens
// (mesmo padrao de recognition/mlDetector.js:91-93)
// ----------------------------------------------------------------

let _transformers = null;
let _pipeline = null;
let _loading = false;
let _currentModelId = null;
let _currentDevice = null;
let _loadProgress = 0;

// ----------------------------------------------------------------
// OOM TRACKING
// Rastreia modelos que falharam por falta de memoria na sessao atual,
// evitando loops infinitos de fallback (ex: Qwen OOM -> LFM OOM -> Qwen...)
// ----------------------------------------------------------------

/** @type {Set<string>} Model IDs que falharam por OOM nesta sessao */
const _oomFailedModels = new Set();

/** Regex para detectar erros de memoria / out-of-memory do ONNX Runtime */
const _OOM_PATTERN = /bad_alloc|out.of.memory|alloc.*fail|memory.*alloc|ERROR_CODE:\s*6/i;

// ----------------------------------------------------------------
// LIBRARY LOADING
// Carrega Transformers.js v3 do CDN sob demanda
// ----------------------------------------------------------------

/**
 * Lazy-load Transformers.js v3 from CDN.
 * Carrega a biblioteca apenas quando necessario (primeira chamada).
 * @returns {Promise<Object>} Modulo transformers
 */
async function ensureTransformers() {
    if (_transformers) return _transformers;

    _transformers = await importCDN(TRANSFORMERS_CDN, { name: 'Transformers.js v4' });
    if (_transformers.env) {
        _transformers.env.allowLocalModels = true;
        _transformers.env.localModelPath = '/models/';
    }
    return _transformers;
}

// ----------------------------------------------------------------
// PIPELINE MANAGEMENT
// Criacao e gerenciamento do pipeline de text-generation
// ----------------------------------------------------------------

/**
 * Ensure text-generation pipeline is ready.
 * Cria pipeline se necessario ou se o modelo mudou.
 *
 * @param {string} modelId - HuggingFace model ID
 * @param {Function} [onProgress] - Progress callback: { status, message, progress }
 * @returns {Promise<void>}
 */
async function ensurePipeline(modelId, onProgress) {
    // Pipeline ja existe para este modelo
    if (_pipeline && _currentModelId === modelId) return;

    // Evita carregamento duplicado
    if (_loading) {
        throw new Error('Model is already loading. Please wait.');
    }

    _loading = true;
    _loadProgress = 0;

    try {
        const tf = await ensureTransformers();

        // Descarrega modelo anterior se diferente
        if (_pipeline && _currentModelId !== modelId) {
            await _pipeline.dispose?.();
            _pipeline = null;
            _currentModelId = null;
        }

        // Detecta melhor device disponivel
        let device = 'wasm'; // fallback seguro
        let usedFallback = false;

        if (navigator.gpu) {
            try {
                const adapter = await navigator.gpu.requestAdapter();
                if (adapter) {
                    device = 'webgpu';
                }
            } catch {
                usedFallback = true;
            }
        } else {
            usedFallback = true;
        }

        if (usedFallback && onProgress) {
            onProgress({
                status: 'fallback',
                message: 'WebGPU not available. Using CPU (WASM) — slower performance.',
                progress: 0,
            });
        }

        _notify(onProgress, 'loading', `Loading ${modelId}...`, 0);

        // dtype dinamico: cada modelo pode especificar seu formato de quantizacao
        const modelConfig = BROWSER_MODELS.find((m) => m.id === modelId);
        const dtype = modelConfig?.dtype || 'q4';

        _pipeline = await tf.pipeline('text-generation', modelId, {
            device,
            dtype,
            progress_callback: (data) => {
                if (data.status === 'progress' && typeof data.progress === 'number') {
                    _loadProgress = Math.round(data.progress);
                    _notify(onProgress, 'downloading', `Downloading model... ${_loadProgress}%`, _loadProgress);
                } else if (data.status === 'done') {
                    _notify(onProgress, 'downloading', 'Download complete', 100);
                } else if (data.status === 'initiate') {
                    _notify(onProgress, 'downloading', `Loading ${data.file || ''}...`, _loadProgress);
                }
            },
        });

        _currentModelId = modelId;
        _currentDevice = device;
        _notify(onProgress, 'ready', 'Model ready!', 100);
    } catch (err) {
        _pipeline = null;
        _currentModelId = null;

        // --- OOM fallback: tenta modelo menor quando memoria insuficiente ---
        const isOOM = _OOM_PATTERN.test(err.message);
        if (isOOM) {
            _oomFailedModels.add(modelId);
            const smaller = _findSmallerModel(modelId);
            if (smaller) {
                console.warn(`Model ${modelId} OOM. Falling back to smaller model: ${smaller}...`);
                _notify(onProgress, 'fallback', `Not enough memory for ${modelId}. Trying smaller model...`, 0);
                _loading = false;
                return ensurePipeline(smaller, onProgress);
            }
            // Todos os modelos falharam por OOM — mensagem clara para o usuario
            throw new Error(
                `Not enough memory to run any browser AI model. ` +
                    `Try closing other tabs or switch to Cloud or Local engine.`,
            );
        }

        // --- Gated fallback: modelo privado/restrito (401/403) ---
        const isGated = /unauthorized|gated|403|401/i.test(err.message);
        if (isGated) {
            const fallback = _findFallbackModel(modelId);
            if (fallback) {
                console.warn(`Model ${modelId} is gated. Falling back to ${fallback}...`);
                _loading = false;
                return ensurePipeline(fallback, onProgress);
            }
        }

        throw new Error(`Failed to load model ${modelId}: ${err.message}`);
    } finally {
        _loading = false;
    }
}

/**
 * Find next available model as fallback (gating errors only).
 * Busca o proximo modelo na lista quando o atual falha por gating (401/403).
 * Para fallback de OOM, usar _findSmallerModel() que ordena por tamanho.
 * @param {string} failedModelId - Model ID que falhou
 * @returns {string|null} - Proximo model ID ou null se nenhum disponivel
 */
function _findFallbackModel(failedModelId) {
    const idx = BROWSER_MODELS.findIndex((m) => m.id === failedModelId);
    if (idx === -1) return BROWSER_MODELS[0]?.id || null;

    // Tenta o proximo modelo na lista (circular)
    for (let i = 1; i < BROWSER_MODELS.length; i++) {
        const next = BROWSER_MODELS[(idx + i) % BROWSER_MODELS.length];
        if (next.id !== failedModelId) return next.id;
    }
    return null;
}

/**
 * Find a smaller model as OOM fallback.
 * Busca um modelo MENOR (por vramGB) que ainda nao falhou por OOM.
 * Ordena por tamanho e pula modelos maiores ou ja testados.
 * @param {string} failedModelId - Model ID que falhou por OOM
 * @returns {string|null} - Model ID menor ou null se todos falharam
 */
function _findSmallerModel(failedModelId) {
    const failedModel = BROWSER_MODELS.find((m) => m.id === failedModelId);
    const failedVram = failedModel ? failedModel.vramGB : Infinity;

    // Ordena por vramGB ascendente (menor primeiro)
    const sorted = [...BROWSER_MODELS].sort((a, b) => a.vramGB - b.vramGB);

    for (const model of sorted) {
        if (model.id === failedModelId) continue;
        if (_oomFailedModels.has(model.id)) continue;
        if (model.vramGB >= failedVram) continue;
        return model.id;
    }
    return null;
}

/**
 * Notify progress callback.
 * Helper para padronizar notificacoes de progresso.
 * @param {Function|null} cb
 * @param {string} status
 * @param {string} message
 * @param {number} progress
 */
function _notify(cb, status, message, progress) {
    if (cb) cb({ status, message, progress });
}

// ----------------------------------------------------------------
// TEXT GENERATION — SYNCHRONOUS
// Gera resposta completa de uma vez
// ----------------------------------------------------------------

/**
 * Generate response using browser engine (non-streaming).
 * Executa inferencia local e retorna resposta completa.
 *
 * @param {string} modelId - HuggingFace model ID
 * @param {string} systemPrompt - System prompt
 * @param {string} userMessage - User message
 * @param {Object} [options] - temperature, maxTokens, onProgress
 * @returns {Promise<Object>} - { content, provider: 'browser', model, usage }
 */
export async function generateBrowser(modelId, systemPrompt, userMessage, options = {}) {
    await ensurePipeline(modelId, options.onProgress);

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
    ];

    const output = await _pipeline(messages, {
        max_new_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.3,
        do_sample: true,
        return_full_text: false,
    });

    const content = output?.[0]?.generated_text || '';

    return {
        content,
        provider: 'browser',
        model: modelId,
        usage: { device: _currentDevice },
    };
}

// ----------------------------------------------------------------
// TEXT GENERATION — STREAMING
// Yield de tokens incrementais via TextGenerationPipeline
// ----------------------------------------------------------------

/**
 * Generate response using browser engine (streaming).
 * Async generator que yield tokens conforme sao gerados.
 *
 * @param {string} modelId - HuggingFace model ID
 * @param {string} systemPrompt - System prompt
 * @param {string} userMessage - User message
 * @param {Object} [options] - temperature, maxTokens, onProgress
 * @yields {string} Individual tokens
 */
export async function* generateBrowserStream(modelId, systemPrompt, userMessage, options = {}) {
    await ensurePipeline(modelId, options.onProgress);

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
    ];

    // Transformers.js v3 TextGenerationPipeline suporta streamer callback
    const streamer = new _transformers.TextStreamer(_pipeline.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
    });

    // Cria uma queue para bridge entre callback e async generator
    const queue = [];
    let resolve = null;
    let done = false;

    const originalPut = streamer.put.bind(streamer);
    streamer.put = function (tokens) {
        originalPut(tokens);
    };

    // Override on_finalized_text para capturar tokens
    streamer.on_finalized_text = (text, streamEnd) => {
        if (text) {
            queue.push(text);
            if (resolve) {
                resolve();
                resolve = null;
            }
        }
        if (streamEnd) {
            done = true;
            if (resolve) {
                resolve();
                resolve = null;
            }
        }
    };

    // Inicia geracao em background
    const genPromise = _pipeline(messages, {
        max_new_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.3,
        do_sample: true,
        return_full_text: false,
        streamer,
    });

    // Yield tokens da queue conforme chegam
    while (!done) {
        if (queue.length > 0) {
            yield queue.shift();
        } else {
            await new Promise((r) => {
                resolve = r;
            });
        }
    }

    // Flush tokens restantes na queue
    while (queue.length > 0) {
        yield queue.shift();
    }

    // Aguarda finalizacao da geracao
    await genPromise;
}

// ----------------------------------------------------------------
// MODEL MANAGEMENT
// Funcoes de gerenciamento do ciclo de vida do modelo
// ----------------------------------------------------------------

/**
 * Explicitly load a browser model.
 * Carrega modelo sem gerar texto — util para pre-download.
 *
 * @param {string} modelId - HuggingFace model ID
 * @param {Function} [onProgress] - Progress callback
 * @returns {Promise<void>}
 */
export async function loadBrowserModel(modelId, onProgress) {
    await ensurePipeline(modelId, onProgress);
}

/**
 * Unload current model from memory.
 * Libera o modelo e pipeline da memoria.
 */
export async function unloadBrowserModel() {
    if (_pipeline) {
        await _pipeline.dispose?.();
        _pipeline = null;
        _currentModelId = null;
        _currentDevice = null;
    }
}

/**
 * Get available browser models.
 * Retorna lista de modelos disponiveis com metadata.
 * @returns {Array<Object>}
 */
export function getBrowserModels() {
    return [...BROWSER_MODELS];
}

/**
 * Get current model loading status.
 * Retorna estado atual do modelo (carregado, carregando, progresso).
 * @returns {Object} - { loaded, modelId, loading, progress, device }
 */
export function getBrowserModelStatus() {
    return {
        loaded: _pipeline !== null,
        modelId: _currentModelId,
        loading: _loading,
        progress: _loadProgress,
        device: _currentDevice,
    };
}

/**
 * Check browser engine availability.
 * Verifica se WebGPU e/ou WASM estao disponiveis.
 * @returns {{ webgpu: boolean, wasm: boolean }}
 */
export function isBrowserEngineAvailable() {
    return {
        webgpu: !!navigator.gpu,
        wasm: true, // WASM sempre disponivel em browsers modernos
    };
}
