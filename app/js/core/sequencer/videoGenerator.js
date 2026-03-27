// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   VIDEO GENERATOR — Chamadas reais às APIs de geração de vídeo IA
   Suporta Google Veo 2 e Runway Gen-3 Alpha Turbo.

   Pipeline: prompt + frame de referência → API assíncrona → poll
             → blob MP4 → download

   NÃO depende de client.js (que é para chat LLM).
   Cada provider tem sua própria lógica de autenticação e polling.
   ================================================================ */

const VEO2_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning';
const VEO2_POLL_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const RUNWAY_ENDPOINT = 'https://api.runwayml.com/v1/image_to_video';
const RUNWAY_POLL_BASE = 'https://api.runwayml.com/v1/tasks';
const RUNWAY_VERSION = '2024-11-06';

const POLL_INTERVAL_MS = 5_000; // 5s entre cada verificação
const POLL_TIMEOUT_MS = 300_000; // 5 minutos máximo

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Despacha a geração de vídeo para o provider configurado.
 * Retorna um Blob MP4 pronto para download.
 *
 * @param {string} prompt - Prompt ambiental construído pelo videoBot
 * @param {Array} frames  - Array de { image: dataURL, ... } (primeiro frame usado como referência)
 * @param {Object} options
 * @param {string} [options.videoProvider='veo2'] - 'veo2' | 'runway'
 * @param {string} [options.videoKey]  - Key Runway (se provider='runway')
 * @param {number} [options.durationSec=8] - Duração alvo do clipe
 * @param {AbortSignal} [options.signal] - Para cancelamento
 * @returns {Promise<{ blob: Blob, ext: string, provider: string }>}
 */
export async function generateVideo(prompt, frames, options = {}) {
    const provider = options.videoProvider || 'veo2';
    const signal = options.signal || null;
    const refFrame = frames[0]?.image || null;
    const durationSec = Math.min(8, Math.max(5, options.durationSec || 8));

    if (provider === 'runway') {
        const runwayKey = options.videoKey || sessionStorage.getItem('ecbyts_video_key');
        if (!runwayKey) {
            throw new Error('Runway key não configurada. Insira sua key no campo "Runway Key" do painel.');
        }
        const blob = await callRunway(prompt, refFrame, { durationSec }, runwayKey, signal);
        return { blob, ext: 'mp4', provider: 'runway' };
    }

    // Default: Google Veo 2
    const geminiKey = sessionStorage.getItem('ecbyts_llm_key');
    if (!geminiKey) {
        throw new Error('Google API key não configurada. Acesse AI Assistant > Configurações.');
    }
    const blob = await callVeo2(prompt, refFrame, { durationSec }, geminiKey, signal);
    return { blob, ext: 'mp4', provider: 'veo2' };
}

// ----------------------------------------------------------------
// GOOGLE VEO 2
// ----------------------------------------------------------------

/**
 * Envia prompt + frame de referência para o Veo 2 e aguarda o vídeo.
 * Usa long-running operation com polling.
 *
 * @param {string} prompt
 * @param {string|null} referenceFrame - Base64 data URL do primeiro frame
 * @param {Object} config
 * @param {string} apiKey - Google AI API key (mesma do Gemini)
 * @param {AbortSignal|null} signal
 * @returns {Promise<Blob>} - Blob video/mp4
 */
async function callVeo2(prompt, referenceFrame, config, apiKey, signal) {
    // Monta parts: texto + imagem de referência (opcional)
    const parts = [{ text: prompt }];
    if (referenceFrame) {
        const [header, base64Data] = referenceFrame.split(',');
        const mimeType = (header.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
        parts.push({ inlineData: { mimeType, data: base64Data } });
    }

    const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
            responseModalities: ['VIDEO'],
            videoGenerationConfig: {
                durationSeconds: config.durationSec || 8,
                enhancePrompt: true,
                aspectRatio: '16:9',
            },
        },
    };

    const startRes = await _fetchVideo(
        `${VEO2_ENDPOINT}?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
        signal,
        'Veo 2',
        {
            403: 'Acesso ao Veo 2 negado. Ative em: aistudio.google.com/app/apikey (precisa de acesso especial ao modelo).',
            429: 'Limite de requisições Veo 2. Aguarde alguns minutos e tente novamente.',
        },
    );

    const startData = await startRes.json();

    // Extrai o nome da operação
    const operationName = startData.name;
    if (!operationName) {
        throw new Error(`Veo 2: resposta inesperada ao iniciar — ${JSON.stringify(startData).slice(0, 200)}`);
    }

    // Polling
    const result = await pollOperation(
        async () => {
            const pollRes = await _fetchVideo(
                `${VEO2_POLL_BASE}/${operationName}?key=${apiKey}`,
                { method: 'GET' },
                signal,
                'Veo 2 poll',
                {},
            );
            return await pollRes.json();
        },
        (data) => !!data.done,
        signal,
    );

    // Extrai o vídeo do resultado
    if (result.error) {
        throw new Error(`Veo 2 falhou: ${result.error.message || JSON.stringify(result.error)}`);
    }

    const candidates = result.response?.candidates || [];
    const videoPart = candidates[0]?.content?.parts?.find((p) => p.inlineData || p.fileData);

    if (!videoPart) {
        throw new Error('Veo 2: nenhum vídeo no resultado. Resposta: ' + JSON.stringify(result).slice(0, 300));
    }

    if (videoPart.inlineData) {
        // Vídeo embutido como base64
        return _base64ToBlob(videoPart.inlineData.data, videoPart.inlineData.mimeType || 'video/mp4');
    }

    if (videoPart.fileData?.fileUri) {
        // Vídeo em URI externa — faz download
        const videoRes = await fetch(videoPart.fileData.fileUri, { signal });
        if (!videoRes.ok) throw new Error(`Erro ao baixar vídeo Veo 2: ${videoRes.status}`);
        return await videoRes.blob();
    }

    throw new Error('Veo 2: formato de resposta de vídeo desconhecido.');
}

// ----------------------------------------------------------------
// RUNWAY GEN-3 ALPHA TURBO
// ----------------------------------------------------------------

/**
 * Envia frame de referência + prompt para o Runway e aguarda o vídeo.
 *
 * @param {string} prompt
 * @param {string|null} referenceFrame - Base64 data URL do primeiro frame
 * @param {Object} config
 * @param {string} apiKey - Runway API key
 * @param {AbortSignal|null} signal
 * @returns {Promise<Blob>} - Blob video/mp4
 */
async function callRunway(prompt, referenceFrame, config, apiKey, signal) {
    const body = {
        model: 'gen3a_turbo',
        promptText: prompt,
        duration: Math.min(10, Math.max(5, config.durationSec || 8)),
        ratio: '1280:768',
        seed: Math.floor(Math.random() * 4_294_967_295),
    };

    // Runway aceita imagem de referência
    if (referenceFrame) {
        body.promptImage = referenceFrame; // aceita data URL diretamente
    }

    const startRes = await _fetchVideo(
        RUNWAY_ENDPOINT,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'X-Runway-Version': RUNWAY_VERSION,
            },
            body: JSON.stringify(body),
        },
        signal,
        'Runway',
        {
            401: 'Runway key inválida. Verifique em: app.runwayml.com/settings/api-keys',
            402: 'Créditos Runway insuficientes. Recarregue sua conta.',
            429: 'Limite de requisições Runway. Aguarde e tente novamente.',
        },
    );

    const { id: taskId } = await startRes.json();
    if (!taskId) throw new Error('Runway: não retornou task ID.');

    // Polling
    const result = await pollOperation(
        async () => {
            const pollRes = await _fetchVideo(
                `${RUNWAY_POLL_BASE}/${taskId}`,
                {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'X-Runway-Version': RUNWAY_VERSION,
                    },
                },
                signal,
                'Runway poll',
                {},
            );
            return await pollRes.json();
        },
        (data) => data.status === 'SUCCEEDED' || data.status === 'FAILED',
        signal,
    );

    if (result.status === 'FAILED') {
        throw new Error(`Runway falhou: ${result.failure || result.failureCode || 'erro desconhecido'}`);
    }

    const videoUrl = result.output?.[0];
    if (!videoUrl) throw new Error('Runway: nenhuma URL de vídeo no resultado.');

    // Download do vídeo a partir da URL
    const videoRes = await fetch(videoUrl, { signal });
    if (!videoRes.ok) throw new Error(`Erro ao baixar vídeo Runway: ${videoRes.status}`);
    return await videoRes.blob();
}

// ----------------------------------------------------------------
// POLLING HELPER
// ----------------------------------------------------------------

/**
 * Executa polling genérico até que `isDone(data)` retorne true.
 * Respeita AbortSignal e timeout global de 5 minutos.
 *
 * @param {Function} checkFn  - async () => data — executa cada verificação
 * @param {Function} isDone   - (data) => boolean — retorna true quando pronto
 * @param {AbortSignal|null} signal
 * @returns {Promise<any>} - Último valor retornado por checkFn quando isDone = true
 */
async function pollOperation(checkFn, isDone, signal) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (true) {
        if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
        if (Date.now() >= deadline) {
            throw new Error('Geração ultrapassou 5 minutos. Tente um clipe mais curto ou tente mais tarde.');
        }

        const data = await checkFn();

        if (isDone(data)) return data;

        // Aguarda o intervalo antes da próxima verificação
        await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, POLL_INTERVAL_MS);
            signal?.addEventListener(
                'abort',
                () => {
                    clearTimeout(timer);
                    reject(new DOMException('Cancelado', 'AbortError'));
                },
                { once: true },
            );
        });
    }
}

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

/**
 * Fetch com mapeamento de erros HTTP para mensagens amigáveis.
 * @param {string} url
 * @param {Object} fetchOptions
 * @param {AbortSignal|null} signal
 * @param {string} providerLabel - Label para mensagens de erro
 * @param {Object} errorMessages - Mapa { statusCode: mensagem }
 * @returns {Promise<Response>}
 */
async function _fetchVideo(url, fetchOptions, signal, providerLabel, errorMessages) {
    const res = await fetch(url, { ...fetchOptions, signal });

    if (!res.ok) {
        const customMsg = errorMessages[res.status];
        if (customMsg) throw new Error(customMsg);

        let detail = '';
        try {
            const body = await res.json();
            detail = body.error?.message || body.message || JSON.stringify(body).slice(0, 200);
        } catch {
            /* ignore */
        }

        throw new Error(`${providerLabel} erro ${res.status}: ${detail || res.statusText}`);
    }

    return res;
}

/**
 * Converte string base64 em Blob.
 * @param {string} base64 - Dados em base64 (sem prefixo data:...)
 * @param {string} mimeType
 * @returns {Blob}
 */
function _base64ToBlob(base64, mimeType) {
    const byteChars = atob(base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
        bytes[i] = byteChars.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}
