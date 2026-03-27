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
   BENCHMARK — Browser capability detection & model recommendation
   ================================================================

   Detecta capacidades do navegador (WebGPU, GPU, VRAM, RAM, tipo
   de dispositivo) e recomenda o melhor modelo de IA local para o
   hardware do usuario.

   ================================================================ */

// ----------------------------------------------------------------
// DEVICE DETECTION
// Deteccao do tipo de dispositivo (mobile vs desktop)
// ----------------------------------------------------------------

/**
 * Detect device type from user-agent.
 * Verifica se o dispositivo e mobile ou desktop.
 * @returns {'mobile'|'desktop'}
 */
function detectDeviceType() {
    const ua = navigator.userAgent;
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return 'mobile';
    return 'desktop';
}

// ----------------------------------------------------------------
// WEBGPU DETECTION
// Verifica suporte a WebGPU e coleta info da GPU
// ----------------------------------------------------------------

/**
 * Probe WebGPU capabilities.
 * Tenta obter adapter WebGPU e informacoes da GPU.
 * @returns {Promise<Object>} - { supported, gpu, vramGB }
 */
async function probeWebGPU() {
    const result = { supported: false, gpu: null, vramGB: null };

    if (!navigator.gpu) return result;

    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return result;

        result.supported = true;

        // Tenta obter info da GPU (Chrome 113+)
        if (adapter.requestAdapterInfo) {
            const info = await adapter.requestAdapterInfo();
            result.gpu = info.description || info.device || info.vendor || 'Unknown GPU';
        }

        // Estima VRAM a partir do maxBufferSize
        const device = await adapter.requestDevice();
        const maxBuffer = device.limits.maxBufferSize;
        if (maxBuffer > 0) {
            result.vramGB = Math.round((maxBuffer / (1024 * 1024 * 1024)) * 10) / 10;
        }
        device.destroy();
    } catch (e) {
        // WebGPU disponivel mas falhou ao iniciar — trata como indisponivel
        console.warn('WebGPU probe failed:', e.message);
    }

    return result;
}

// ----------------------------------------------------------------
// MODEL RECOMMENDATION
// Logica de recomendacao baseada nas capacidades detectadas
// ----------------------------------------------------------------

/** @type {Object.<string, string>} Modelo recomendado por tier */
const MODEL_BY_TIER = {
    micro: 'onnx-community/gemma-3-270m-it-ONNX',
    small: 'LiquidAI/LFM2.5-1.2B-Thinking-ONNX',
    medium: 'onnx-community/Qwen2.5-1.5B-Instruct',
    large: 'onnx-community/Llama-3.2-3B-Instruct',
};

/**
 * Determine best model tier based on hardware capabilities.
 * Seleciona tier (small/medium/large) com base no hardware.
 * @param {Object} caps - { webgpu, deviceType, vramGB, ramGB }
 * @returns {{ modelId: string, tier: string, reason: string }}
 */
function recommendModel(caps) {
    // Muito pouca RAM — modelo micro (self-hosted, ~460 MB)
    if (caps.ramGB && caps.ramGB < 2) {
        return {
            modelId: MODEL_BY_TIER.micro,
            tier: 'micro',
            reason: 'lowRAM',
        };
    }

    // Sem WebGPU — somente WASM, usar modelo menor
    if (!caps.webgpu) {
        return {
            modelId: MODEL_BY_TIER.small,
            tier: 'small',
            reason: 'noWebGPU',
        };
    }

    // Mobile ou pouca RAM — modelo medio
    if (caps.deviceType === 'mobile' || (caps.ramGB && caps.ramGB < 4)) {
        return {
            modelId: MODEL_BY_TIER.medium,
            tier: 'medium',
            reason: 'mobile',
        };
    }

    // Desktop com boa VRAM — modelo grande
    if (caps.vramGB && caps.vramGB >= 3) {
        return {
            modelId: MODEL_BY_TIER.large,
            tier: 'large',
            reason: 'highVRAM',
        };
    }

    // Desktop sem info de VRAM — seguro com medio
    return {
        modelId: MODEL_BY_TIER.medium,
        tier: 'medium',
        reason: 'default',
    };
}

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Run full browser benchmark.
 * Executa deteccao completa de hardware e retorna recomendacao.
 * @returns {Promise<Object>} Benchmark result
 */
export async function runBenchmark() {
    const deviceType = detectDeviceType();
    const ramGB = navigator.deviceMemory || null; // Chrome only
    const webgpuResult = await probeWebGPU();

    const caps = {
        webgpu: webgpuResult.supported,
        deviceType,
        vramGB: webgpuResult.vramGB,
        ramGB,
    };

    const recommendation = recommendModel(caps);

    return {
        webgpu: webgpuResult.supported,
        gpu: webgpuResult.gpu,
        vramGB: webgpuResult.vramGB,
        deviceType,
        ramGB,
        recommended: recommendation.modelId,
        tier: recommendation.tier,
        reason: recommendation.reason,
    };
}

/**
 * Get recommended model ID for current device.
 * Atalho que retorna apenas o ID do modelo recomendado.
 * @returns {Promise<string>} Model ID
 */
export async function getRecommendedModel() {
    const result = await runBenchmark();
    return result.recommended;
}
