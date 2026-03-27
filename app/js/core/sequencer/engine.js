// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   SEQUENCER ENGINE — Playback motor for timeline animation
   Motor de playback que anima a camera entre keyframes usando
   requestAnimationFrame. Suporta play/pause/seek/speed.

   Interpola camera states entre keyframes com easing configuravel.
   Aplica campanhas e visibilidade por keyframe.
   ================================================================ */

import {
    getKeyframes,
    getKeyframesAtPosition,
    getItemById,
    getPlayback,
    setPlaybackPosition,
    setPlaying,
    getTotalDuration,
} from './manager.js';
import { setCameraState, animateCameraState } from '../../utils/scene/controls.js';

// ----------------------------------------------------------------
// EASING FUNCTIONS
// ----------------------------------------------------------------

const EASINGS = {
    linear: (t) => t,
    'ease-in': (t) => t * t * t,
    'ease-out': (t) => 1 - Math.pow(1 - t, 3),
    'ease-in-out': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

// ----------------------------------------------------------------
// ENGINE STATE
// ----------------------------------------------------------------

let _rafId = null;
let _lastTime = 0;
let _onTickCallbacks = [];

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Inicia o playback da timeline.
 */
export function play() {
    const playback = getPlayback();
    if (playback.playing) return;
    if (getKeyframes().length === 0) return;

    // Se no fim, reinicia
    if (playback.position >= 1.0) {
        setPlaybackPosition(0);
    }

    setPlaying(true);
    _lastTime = performance.now();
    _tick();
}

/**
 * Pausa o playback.
 */
export function pause() {
    setPlaying(false);
    if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
    }
}

/**
 * Para o playback e volta para o inicio.
 */
export function stop() {
    pause();
    setPlaybackPosition(0);
    _applyStateAtPosition(0);
}

/**
 * Seek para posicao especifica (0-1).
 * @param {number} position - 0.0 a 1.0
 */
export function seek(position) {
    setPlaybackPosition(position);
    _applyStateAtPosition(position);
}

/**
 * Navega para um item especifico (anima camera).
 * @param {string} itemId - ID do StoryboardItem
 * @param {number} [durationMs=600] - Duracao da animacao
 * @returns {Promise<void>}
 */
export function flyToItem(itemId, durationMs = 600) {
    const item = getItemById(itemId);
    if (!item || !item.cameraState) return Promise.resolve();
    return animateCameraState(item.cameraState, durationMs);
}

/**
 * Navega para um keyframe especifico.
 * @param {string} keyframeId
 * @param {number} [durationMs=600]
 * @returns {Promise<void>}
 */
export function flyToKeyframe(keyframeId, durationMs = 600) {
    const kf = getKeyframes().find((k) => k.id === keyframeId);
    if (!kf) return Promise.resolve();

    const item = getItemById(kf.itemId);
    const cameraState = kf.cameraOverride || (item ? item.cameraState : null);
    if (!cameraState) return Promise.resolve();

    setPlaybackPosition(kf.position);
    return animateCameraState(cameraState, durationMs);
}

/**
 * Registra callback chamado a cada tick (para atualizar UI).
 * @param {Function} callback - Recebe { position, activeKeyframe, playing }
 * @returns {Function} unsubscribe
 */
export function onTick(callback) {
    _onTickCallbacks.push(callback);
    return () => {
        _onTickCallbacks = _onTickCallbacks.filter((cb) => cb !== callback);
    };
}

// ----------------------------------------------------------------
// INTERPOLATION
// ----------------------------------------------------------------

/**
 * Interpola entre dois camera states.
 * @param {Object} stateA - { camera: {x,y,z,zoom}, target: {x,y,z} }
 * @param {Object} stateB
 * @param {number} t - 0.0 (A) a 1.0 (B)
 * @param {string} [easing='ease-out']
 * @returns {Object} - Camera state interpolado
 */
export function interpolateCamera(stateA, stateB, t, easing = 'ease-out') {
    const easeFn = EASINGS[easing] || EASINGS['ease-out'];
    const e = easeFn(Math.max(0, Math.min(1, t)));

    return {
        camera: {
            x: _lerp(stateA.camera.x, stateB.camera.x, e),
            y: _lerp(stateA.camera.y, stateB.camera.y, e),
            z: _lerp(stateA.camera.z, stateB.camera.z, e),
            zoom: _lerp(stateA.camera.zoom, stateB.camera.zoom, e),
        },
        target: {
            x: _lerp(stateA.target.x, stateB.target.x, e),
            y: _lerp(stateA.target.y, stateB.target.y, e),
            z: _lerp(stateA.target.z, stateB.target.z, e),
        },
    };
}

// ----------------------------------------------------------------
// INTERNAL — RAF LOOP
// ----------------------------------------------------------------

function _tick() {
    const playback = getPlayback();
    if (!playback.playing) return;

    const now = performance.now();
    const deltaMs = now - _lastTime;
    _lastTime = now;

    const totalDuration = getTotalDuration();
    if (totalDuration <= 0) {
        pause();
        return;
    }

    // Avanca posicao
    const deltaPosition = (deltaMs * playback.speed) / totalDuration;
    let newPosition = playback.position + deltaPosition;

    if (newPosition >= 1.0) {
        if (playback.loop) {
            newPosition = newPosition % 1.0;
        } else {
            newPosition = 1.0;
            setPlaybackPosition(1.0, false);
            _applyStateAtPosition(1.0);
            pause(); // pause() triggers full render via setPlaying
            _notifyTick(1.0);
            return;
        }
    }

    setPlaybackPosition(newPosition, false); // silent — tick handles UI
    _applyStateAtPosition(newPosition);
    _notifyTick(newPosition);

    _rafId = requestAnimationFrame(_tick);
}

function _applyStateAtPosition(position) {
    const { prev, next, t } = getKeyframesAtPosition(position);
    if (!prev) return;

    const prevItem = getItemById(prev.itemId);
    const nextItem = next ? getItemById(next.itemId) : prevItem;

    const prevCamera = prev.cameraOverride || (prevItem ? prevItem.cameraState : null);
    const nextCamera = (next ? next.cameraOverride : null) || (nextItem ? nextItem.cameraState : null);

    if (!prevCamera) return;

    if (!nextCamera || prev === next) {
        // Single keyframe — set diretamente
        setCameraState(prevCamera);
    } else {
        // Interpolar entre dois keyframes
        const easing = next ? next.easing : 'ease-out';
        const interpolated = interpolateCamera(prevCamera, nextCamera, t, easing);
        setCameraState(interpolated);
    }
}

function _notifyTick(position) {
    const activeKf = getKeyframes().length > 0 ? getKeyframesAtPosition(position).prev : null;

    const info = {
        position,
        activeKeyframe: activeKf,
        playing: getPlayback().playing,
    };

    for (const cb of _onTickCallbacks) {
        try {
            cb(info);
        } catch {
            /* ignore */
        }
    }
}

// ----------------------------------------------------------------
// VISIBILITY HANDLER — Page hidden = auto-pause
// ----------------------------------------------------------------

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && getPlayback().playing) {
            pause();
        }
    });
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function _lerp(a, b, t) {
    return a + (b - a) * t;
}
