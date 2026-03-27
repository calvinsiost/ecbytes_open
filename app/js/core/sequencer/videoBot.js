// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   VIDEO BOT — AI-powered video generation from timeline
   Captura frames dos keyframes da timeline, constroi prompt
   ambiental contextualizado, e envia para API de geracao de video.

   Pipeline: Capture Frames → Build Prompt → Send to AI → Poll Status

   Providers suportados:
   - OpenAI (Sora)       — via /v1/video/generations
   - Google (Veo)        — via generativelanguage.googleapis.com
   - Runway (Gen-3)      — via api.runwayml.com
   - Replicate (SVD)     — via api.replicate.com
   ================================================================ */

import { getItems, getKeyframes, getPlayback } from './manager.js';
import { seek } from './engine.js';
import { setCameraState } from '../../utils/scene/controls.js';
import { getRenderer, requestRender } from '../../utils/scene/setup.js';
import { getAllElements } from '../elements/manager.js';
import { getAllCampaigns } from '../campaigns/manager.js';
import { hasApiKey, getProvider } from '../llm/client.js';

// ----------------------------------------------------------------
// CONSTANTS
// ----------------------------------------------------------------

const VIDEO_STYLES = ['photorealistic', 'technical', 'artistic'];
const RESOLUTIONS = ['720p', '1080p', '4K'];
const FPS_OPTIONS = [12, 24, 30, 60];
const CAPTURE_DELAY_MS = 100; // Tempo para render estabilizar apos setCameraState

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let _generating = false;
let _progress = { stage: 'idle', percent: 0, message: '' };
let _onProgressCallbacks = [];
let _abortController = null;

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Verifica se o bot pode gerar video (tem keyframes + key de video disponivel).
 * Aceita key do Gemini (para Veo 2) OU key separada do Runway.
 * @returns {{ canGenerate: boolean, reason: string|null }}
 */
export function canGenerateVideo() {
    const keyframes = getKeyframes();
    if (keyframes.length < 2) {
        return { canGenerate: false, reason: 'Minimo 2 keyframes necessarios na timeline' };
    }
    const hasVideoKey = hasApiKey() || !!sessionStorage.getItem('ecbyts_video_key');
    if (!hasVideoKey) {
        return {
            canGenerate: false,
            reason: 'Configure Google (Veo 2) em AI Assistant, ou insira uma Runway key no painel',
        };
    }
    if (_generating) {
        return { canGenerate: false, reason: 'Geracao em andamento' };
    }
    return { canGenerate: true, reason: null };
}

/**
 * Captura frames de todos os keyframes da timeline.
 * Retorna array de { image: dataURL, metadata } para cada keyframe.
 *
 * @param {Object} [options]
 * @param {string} [options.format='image/jpeg'] - MIME type da captura
 * @param {number} [options.quality=0.85] - Qualidade JPEG (0-1)
 * @returns {Promise<Array<CapturedFrame>>}
 */
export async function captureTimelineFrames(options = {}) {
    const format = options.format || 'image/jpeg';
    const quality = options.quality ?? 0.85;
    const keyframes = getKeyframes();
    const items = getItems();
    const renderer = getRenderer();
    const playback = getPlayback();

    if (!renderer || keyframes.length === 0) return [];

    const frames = [];

    if (options.interpolated) {
        // Modo interpolado: 1 frame por segundo, camera interpola entre keyframes
        const totalSec = Math.max(1, Math.round(playback.totalDuration / 1000));
        const frameCount = Math.max(2, totalSec);
        const savedPosition = playback.position;

        for (let i = 0; i < frameCount; i++) {
            const position = i / (frameCount - 1);

            _setProgress('capture', ((i + 1) / frameCount) * 30, `Capturando frame ${i + 1}/${frameCount}...`);

            // Usa seek() para posicionar camera na posicao interpolada
            seek(position);
            requestRender();
            await _delay(CAPTURE_DELAY_MS);

            const dataUrl = renderer.domElement.toDataURL(format, quality);

            // Metadados do keyframe mais proximo
            const nearestKf = keyframes.reduce((best, kf) =>
                Math.abs(kf.position - position) < Math.abs(best.position - position) ? kf : best,
            );
            const item = items.find((it) => it.id === nearestKf.itemId);

            frames.push({
                image: dataUrl,
                index: i,
                keyframeId: nearestKf.id,
                itemId: nearestKf.itemId,
                itemName: item ? item.name : 'Unknown',
                itemType: item ? item.type : 'unknown',
                position,
                duration: nearestKf.duration,
                transition: nearestKf.transition,
                annotation: nearestKf.annotation,
            });
        }

        // Restaurar posicao original
        seek(savedPosition);
    } else {
        // Modo original: 1 frame por keyframe
        for (let i = 0; i < keyframes.length; i++) {
            const kf = keyframes[i];
            const item = items.find((it) => it.id === kf.itemId);
            if (!item) continue;

            _setProgress(
                'capture',
                ((i + 1) / keyframes.length) * 30,
                `Capturando frame ${i + 1}/${keyframes.length}...`,
            );

            const cameraState = kf.cameraOverride || item.cameraState;
            if (cameraState) setCameraState(cameraState);

            requestRender();
            await _delay(CAPTURE_DELAY_MS);

            const dataUrl = renderer.domElement.toDataURL(format, quality);

            frames.push({
                image: dataUrl,
                index: i,
                keyframeId: kf.id,
                itemId: item.id,
                itemName: item.name,
                itemType: item.type,
                position: kf.position,
                duration: kf.duration,
                transition: kf.transition,
                annotation: kf.annotation,
            });
        }
    }

    return frames;
}

/**
 * Constroi prompt ambiental contextualizado a partir dos frames e metadados.
 * O prompt descreve a cena para geracao de video IA.
 *
 * @param {Array<CapturedFrame>} frames - Frames capturados
 * @param {Object} [options]
 * @param {string} [options.style='photorealistic'] - Estilo visual
 * @param {string} [options.language='en'] - Idioma do prompt
 * @returns {string} - Prompt completo para geracao de video
 */
export function buildEnvironmentalPrompt(frames, options = {}) {
    const style = options.style || 'photorealistic';
    const elements = getAllElements();
    const campaigns = getAllCampaigns();
    const playback = getPlayback();

    // Analisa composicao do modelo
    const familyCounts = {};
    for (const el of elements) {
        familyCounts[el.family] = (familyCounts[el.family] || 0) + 1;
    }

    // Determina escala espacial
    const positions = elements.map((el) => el.data?.position).filter(Boolean);
    let extent = 'compact site';
    if (positions.length > 1) {
        const xs = positions.map((p) => p.x || 0);
        const zs = positions.map((p) => p.z || 0);
        const rangeX = Math.max(...xs) - Math.min(...xs);
        const rangeZ = Math.max(...zs) - Math.min(...zs);
        const maxRange = Math.max(rangeX, rangeZ);
        if (maxRange > 5000) extent = 'large-scale regional area spanning several kilometers';
        else if (maxRange > 500) extent = 'medium-scale site covering several hundred meters';
        else extent = 'compact monitoring site';
    }

    // Descreve elementos por familia
    const familyDescriptions = [];
    if (familyCounts.well)
        familyDescriptions.push(`${familyCounts.well} monitoring wells (vertical boreholes with metal casings)`);
    if (familyCounts.plume)
        familyDescriptions.push(`${familyCounts.plume} contamination plume(s) (colored subsurface volumes)`);
    if (familyCounts.lake) familyDescriptions.push(`${familyCounts.lake} lake(s) (surface water body)`);
    if (familyCounts.river) familyDescriptions.push(`${familyCounts.river} river(s) (flowing water)`);
    if (familyCounts.building) familyDescriptions.push(`${familyCounts.building} building(s)`);
    if (familyCounts.tank) familyDescriptions.push(`${familyCounts.tank} storage tank(s)`);
    if (familyCounts.boundary) familyDescriptions.push(`${familyCounts.boundary} site boundary marker(s)`);
    if (familyCounts.spring)
        familyDescriptions.push(`${familyCounts.spring} spring(s) (natural groundwater discharge)`);

    // Descreve transicoes da timeline
    const transitionDescs = frames.map((f, i) => {
        if (i === 0) return `Frame 1: Overview of "${f.itemName}" (${f.itemType})`;
        const prev = frames[i - 1];
        return `Frame ${i + 1}: Transition from "${prev.itemName}" to "${f.itemName}" (${(f.transition / 1000).toFixed(1)}s)`;
    });

    // Estilo visual
    const styleMap = {
        photorealistic: 'Photorealistic aerial drone footage, golden hour lighting, cinematic 4K quality.',
        technical: 'Technical engineering visualization, clean lines, labeled elements, orthographic perspective.',
        artistic: 'Artistic interpretation, painterly style, dramatic lighting, atmospheric haze.',
    };

    const totalDuration = Math.round(playback.totalDuration / 1000);

    return [
        `Generate a ${totalDuration}-second cinematic flyover video of an environmental monitoring site.`,
        '',
        `Scene description: A ${extent} featuring:`,
        ...familyDescriptions.map((d) => `- ${d}`),
        '',
        `Camera sequence (${frames.length} keyframes):`,
        ...transitionDescs.map((d) => `- ${d}`),
        '',
        campaigns.length > 0
            ? `Temporal context: ${campaigns.length} sampling campaign(s). Show seasonal/temporal changes if applicable.`
            : '',
        '',
        `Visual style: ${styleMap[style] || styleMap['photorealistic']}`,
        '',
        'The video should smoothly interpolate between keyframe positions with professional camera movement.',
        'Include subtle environmental details: wind in vegetation, water reflections, dust particles.',
        options.customPrompt ? `\nAdditional user instructions: ${options.customPrompt}` : '',
    ]
        .filter(Boolean)
        .join('\n');
}

/**
 * Gera video a partir da timeline usando AI.
 * Pipeline completo: capture → prompt → send → poll.
 *
 * @param {Object} [options]
 * @param {string} [options.style='photorealistic']
 * @param {string} [options.resolution='1080p']
 * @param {number} [options.fps=24]
 * @param {Function} [options.onProgress] - Callback de progresso
 * @returns {Promise<VideoResult>}
 */
export async function generateTimelineVideo(options = {}) {
    const check = canGenerateVideo();
    if (!check.canGenerate) {
        throw new Error(check.reason);
    }

    _generating = true;
    if (options.onProgress) _onProgressCallbacks.push(options.onProgress);

    try {
        // 1. CAPTURA DE FRAMES
        _setProgress('capture', 0, 'Capturando frames da timeline...');
        const frames = await captureTimelineFrames({
            format: 'image/jpeg',
            quality: 0.85,
            interpolated: !!options.interpolated,
        });

        if (frames.length < 2) {
            throw new Error('Nao foi possivel capturar frames suficientes');
        }

        // 2. CONSTRUCAO DO PROMPT
        _setProgress('prompt', 30, 'Construindo prompt ambiental...');
        const prompt = buildEnvironmentalPrompt(frames, {
            style: options.style || 'photorealistic',
            customPrompt: options.customPrompt || '',
        });

        // 3. GERACAO DE VIDEO via API especializada (Veo 2 ou Runway)
        const providerLabel = options.videoProvider === 'runway' ? 'Runway Gen-3' : 'Google Veo 2';
        _setProgress('generate', 40, `Enviando para ${providerLabel}...`);

        const { generateVideo } = await import('./videoGenerator.js');

        _abortController = new AbortController();
        const videoResult = await generateVideo(prompt, frames, {
            videoProvider: options.videoProvider || 'veo2',
            videoKey: options.videoKey,
            durationSec: Math.round((getPlayback().totalDuration || 8000) / 1000),
            signal: _abortController.signal,
        });

        _setProgress('complete', 100, 'Video gerado!');

        // 4. RESULTADO
        return {
            success: true,
            videoBlob: videoResult.blob,
            videoExt: videoResult.ext,
            prompt,
            frames: frames.map((f) => ({
                image: f.image,
                itemName: f.itemName,
                position: f.position,
            })),
            config: {
                style: options.style || 'photorealistic',
                resolution: options.resolution || '720p',
                fps: options.fps || 12,
                provider: videoResult.provider,
            },
            estimatedCost: _estimateCost(frames.length, options.resolution || '720p'),
        };
    } finally {
        _generating = false;
        _abortController = null;
        if (options.onProgress) {
            _onProgressCallbacks = _onProgressCallbacks.filter((cb) => cb !== options.onProgress);
        }
    }
}

/**
 * Retorna o estado atual do progresso.
 * @returns {{ stage: string, percent: number, message: string }}
 */
export function getProgress() {
    return { ..._progress };
}

/**
 * Registra callback de progresso.
 * @param {Function} callback
 * @returns {Function} unsubscribe
 */
export function onProgress(callback) {
    _onProgressCallbacks.push(callback);
    return () => {
        _onProgressCallbacks = _onProgressCallbacks.filter((cb) => cb !== callback);
    };
}

/**
 * Cancela geracao em andamento.
 */
export function cancelGeneration() {
    _generating = false;
    _setProgress('cancelled', 0, 'Geracao cancelada');
    if (_abortController) {
        _abortController.abort(new DOMException('Cancelado pelo usuário', 'AbortError'));
        _abortController = null;
    }
}

/**
 * Retorna true se esta gerando.
 * @returns {boolean}
 */
export function isGenerating() {
    return _generating;
}

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

function _setProgress(stage, percent, message) {
    _progress = { stage, percent, message };
    for (const cb of _onProgressCallbacks) {
        try {
            cb(_progress);
        } catch {
            /* ignore */
        }
    }
}

function _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function _estimateCost(frameCount, resolution) {
    // Estimativas baseadas nos precos publicados (2025-2026)
    const baseCost = resolution === '4K' ? 0.08 : resolution === '1080p' ? 0.04 : 0.02;
    return {
        perFrame: baseCost,
        total: (baseCost * frameCount).toFixed(2),
        currency: 'USD',
        disclaimer: 'Estimativa. Custo real depende do provider e modelo usado.',
    };
}
