// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   SEQUENCER MANAGER — State management for Storyboard + Timeline
   Gerencia items (clusters + scenes), keyframes e playback state.
   Persistencia via localStorage. Round-trip via ECO1.

   Modelo de dados:
   - items[]: StoryboardItem (cluster ou scene)
   - keyframes[]: Keyframe (pontos na timeline)
   - playback: { playing, position, speed, loop, totalDuration }
   ================================================================ */

import { detectClusters } from './clusters.js';
import { getAllScenes, getSceneById } from '../../utils/scenes/manager.js';
import { getCameraState } from '../../utils/scene/controls.js';
import { isEphemeral } from '../../utils/storage/storageMonitor.js';
import { idbSet, idbGetWithLegacy } from '../../utils/storage/idbStore.js';
import { showToast } from '../../utils/ui/toast.js';

// ----------------------------------------------------------------
// CONSTANTS
// ----------------------------------------------------------------

const STORAGE_KEY = 'ecbyts-storyboard';
const PENDING_RESTORE_KEY = '__ecbyts_pending_storyboard';
const CLUSTER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
const SCENE_COLOR = '#6366f1';
const VALID_EASINGS = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out']);
const VALID_SPEEDS = new Set([0.25, 0.5, 1, 2, 4]);

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

const _state = {
    items: [],
    keyframes: [],
    playback: {
        playing: false,
        position: 0.0,
        speed: 1.0,
        loop: false,
        totalDuration: 10000,
    },
};

let _onChangeCallbacks = [];
let _clusterLegacyIdMap = new Map();

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Inicializa o sequencer: restaura do localStorage e detecta clusters.
 * Chamado no init da aplicacao.
 */
export async function initSequencer() {
    await _restore();
    refreshItems();

    // Import pode ocorrer antes do sequencer existir (boot via URL/cloud).
    // Nesse caso, o import deixa o storyboard pendente no window.
    const { hasPending, data } = _consumePendingRestore();
    if (hasPending) {
        restoreFromSerialized(data, { refreshItems: false });
    }

    // Expoe referencia lazy para export.js (evita import circular)
    if (typeof window !== 'undefined') {
        window.__ecbyts_sequencer = { getSerializableState, restoreFromSerialized };
    }
}

/**
 * Re-detecta clusters e sincroniza com scenes existentes.
 * Chamado apos ingestao de dados ou mudanca de elementos.
 */
export function refreshItems() {
    const clusters = detectClusters();
    const scenes = getAllScenes();
    const previousClusters = _state.items.filter((it) => it.type === 'cluster');

    const newItems = [];
    const clusterLegacyIdMap = new Map();

    // 1. Adicionar clusters (se mais de 1)
    if (clusters.length > 1) {
        clusters.forEach((cluster, i) => {
            const stableId = `sb-${cluster.id}`;
            clusterLegacyIdMap.set(`sb-cluster-${i}`, stableId);
            newItems.push({
                id: stableId,
                type: 'cluster',
                name: cluster.name,
                icon: cluster.dominantFamily || 'map-pin',
                color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
                bounds: cluster.bounds,
                centroid: cluster.centroid,
                elementIds: cluster.elementIds,
                sceneId: null,
                cameraState: cluster.cameraState,
            });
        });
    }

    // 2. Adicionar scenes como items
    scenes.forEach((scene, i) => {
        if (!scene.viewStart) return; // Scene sem camera = nao util
        newItems.push({
            id: `sb-scene-${scene.id}`,
            type: 'scene',
            name: scene.name || `Cena ${i + 1}`,
            icon: 'camera',
            color: SCENE_COLOR,
            bounds: null,
            centroid: null,
            elementIds: null,
            sceneId: scene.id,
            cameraState: scene.viewStart,
        });
    });

    const nextClusters = newItems.filter((it) => it.type === 'cluster');
    const carryOverClusterIdMap = _buildClusterCarryOverMap(previousClusters, nextClusters);

    _state.items = newItems;
    _clusterLegacyIdMap = new Map([...carryOverClusterIdMap, ...clusterLegacyIdMap]);

    // Migra keyframes para aliases atuais:
    // - legado: sb-cluster-<index> -> sb-cluster-hash
    // - carry-over: cluster antigo -> cluster novo mais proximo por overlap de elementos.
    _state.keyframes = _mapLegacyClusterKeyframes(_state.keyframes);

    // Limpar keyframes orfaos (referenciando items que nao existem mais)
    const validIds = new Set(newItems.map((it) => it.id));
    _state.keyframes = _state.keyframes.filter((kf) => validIds.has(kf.itemId));

    _persist();
    _notifyChange();
}

// ----------------------------------------------------------------
// ITEMS — Getters
// ----------------------------------------------------------------

export function getItems() {
    return _state.items;
}
export function getItemById(id) {
    return _state.items.find((it) => it.id === id) || null;
}
export function getItemCount() {
    return _state.items.length;
}

// ----------------------------------------------------------------
// KEYFRAMES — CRUD
// ----------------------------------------------------------------

export function getKeyframes() {
    return _state.keyframes;
}

/**
 * Adiciona um keyframe na timeline.
 * @param {string} itemId - ID do StoryboardItem
 * @param {Object} [options]
 * @param {number} [options.position] - Posicao 0-1 (default: fim)
 * @param {number} [options.duration=3000] - ms de permanencia
 * @param {number} [options.transition=1000] - ms de transicao
 * @param {string} [options.easing='ease-out'] - funcao de easing
 * @returns {Keyframe}
 */
export function addKeyframe(itemId, options = {}) {
    const item = getItemById(itemId);
    if (!item) return null;

    const kf = {
        id: `kf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        itemId,
        position: options.position ?? _nextKeyframePosition(),
        duration: options.duration ?? 3000,
        transition: options.transition ?? 1000,
        easing: options.easing ?? 'ease-out',
        cameraOverride: options.cameraOverride || null,
        campaignIds: options.campaignIds || null,
        elementVisibility: options.elementVisibility || null,
        annotation: options.annotation || null,
    };

    _state.keyframes.push(kf);
    _sortKeyframes();
    _recomputeTotalDuration();
    _persist();
    _notifyChange();
    return kf;
}

/**
 * Remove um keyframe por ID.
 */
export function removeKeyframe(keyframeId) {
    _state.keyframes = _state.keyframes.filter((kf) => kf.id !== keyframeId);
    _recomputeTotalDuration();
    _persist();
    _notifyChange();
}

/**
 * Atualiza propriedades de um keyframe.
 */
export function updateKeyframe(keyframeId, updates) {
    const kf = _state.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return null;
    Object.assign(kf, updates);
    if ('position' in updates) _sortKeyframes();
    if ('duration' in updates || 'transition' in updates) _recomputeTotalDuration();
    _persist();
    _notifyChange();
    return kf;
}

/**
 * Move um keyframe para nova posicao (0-1).
 */
export function moveKeyframe(keyframeId, newPosition) {
    return updateKeyframe(keyframeId, { position: Math.max(0, Math.min(1, newPosition)) });
}

// ----------------------------------------------------------------
// PLAYBACK STATE
// ----------------------------------------------------------------

export function getPlayback() {
    return { ..._state.playback };
}

export function setPlaybackPosition(pos, notify = true) {
    _state.playback.position = Math.max(0, Math.min(1, pos));
    if (notify) _notifyChange();
}

export function setPlaybackSpeed(speed) {
    _state.playback.speed = speed;
    _persist();
}

export function setPlaybackLoop(loop) {
    _state.playback.loop = !!loop;
    _persist();
}

export function setPlaying(playing) {
    _state.playback.playing = !!playing;
    _notifyChange();
}

export function getTotalDuration() {
    return _state.playback.totalDuration;
}

// ----------------------------------------------------------------
// KEYFRAME LOOKUP — Para o engine
// ----------------------------------------------------------------

/**
 * Encontra os keyframes antes e depois de uma posicao na timeline.
 * Retorna { prev, next, t } onde t é a interpolacao 0-1 entre eles.
 *
 * @param {number} position - 0.0 a 1.0
 * @returns {{ prev: Keyframe|null, next: Keyframe|null, t: number }}
 */
export function getKeyframesAtPosition(position) {
    const kfs = _state.keyframes;
    if (kfs.length === 0) return { prev: null, next: null, t: 0 };
    if (kfs.length === 1) return { prev: kfs[0], next: kfs[0], t: 0 };

    // Encontrar par que enquadra a posicao
    let prev = kfs[0];
    let next = kfs[kfs.length - 1];

    for (let i = 0; i < kfs.length - 1; i++) {
        if (position >= kfs[i].position && position <= kfs[i + 1].position) {
            prev = kfs[i];
            next = kfs[i + 1];
            break;
        }
    }

    // Se antes do primeiro keyframe
    if (position <= kfs[0].position) {
        return { prev: kfs[0], next: kfs[0], t: 0 };
    }

    // Se depois do ultimo keyframe
    if (position >= kfs[kfs.length - 1].position) {
        return { prev: kfs[kfs.length - 1], next: kfs[kfs.length - 1], t: 0 };
    }

    // Interpolar t entre prev e next
    const range = next.position - prev.position;
    const t = range > 0 ? (position - prev.position) / range : 0;

    return { prev, next, t };
}

/**
 * Encontra o keyframe ativo (mais proximo) para uma posicao.
 */
export function getActiveKeyframe(position) {
    const { prev, next, t } = getKeyframesAtPosition(position);
    return t <= 0.5 ? prev : next;
}

// ----------------------------------------------------------------
// CHANGE LISTENER
// ----------------------------------------------------------------

export function onChange(callback) {
    _onChangeCallbacks.push(callback);
    return () => {
        _onChangeCallbacks = _onChangeCallbacks.filter((cb) => cb !== callback);
    };
}

// ----------------------------------------------------------------
// SERIALIZATION — Para ECO1 round-trip
// ----------------------------------------------------------------

export function getSerializableState() {
    return {
        keyframes: _state.keyframes,
        playback: {
            speed: _state.playback.speed,
            loop: _state.playback.loop,
        },
    };
}

export function restoreFromSerialized(data, options = {}) {
    if (options.refreshItems !== false) {
        refreshItems();
    }

    // null/undefined em import = limpar estado do storyboard.
    if (!data || typeof data !== 'object') {
        _state.keyframes = [];
        _state.playback.speed = 1.0;
        _state.playback.loop = false;
        _recomputeTotalDuration();
        _persist();
        _notifyChange();
        return;
    }

    const importedKeyframes = Array.isArray(data.keyframes)
        ? data.keyframes.map((kf, i) => _normalizeKeyframe(kf, i)).filter(Boolean)
        : [];

    // Deduplicar IDs de keyframe para evitar colisão pós-import
    const seenKfIds = new Set();
    const deduped = importedKeyframes.map((kf, i) => {
        if (seenKfIds.has(kf.id)) {
            return { ...kf, id: `kf-dedup-${Date.now()}-${i}` };
        }
        seenKfIds.add(kf.id);
        return kf;
    });

    const remappedKeyframes = _mapLegacyClusterKeyframes(deduped);
    const validIds = new Set(_state.items.map((it) => it.id));
    _state.keyframes = remappedKeyframes.filter((kf) => validIds.has(kf.itemId));

    const speed = data.playback?.speed ?? data.speed;
    // Aceita apenas valores de velocidade válidos; fallback para 1.0
    if (VALID_SPEEDS.has(speed)) {
        _state.playback.speed = speed;
    }

    const loop = data.playback?.loop ?? data.loop;
    if (loop != null) {
        _state.playback.loop = !!loop;
    }

    _sortKeyframes();
    _recomputeTotalDuration();
    _persist();
    _notifyChange();
}

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

function _nextKeyframePosition() {
    const kfs = _state.keyframes;
    if (kfs.length === 0) return 0;
    // Posiciona apos o ultimo, distribuindo uniformemente
    const last = kfs[kfs.length - 1].position;
    return Math.min(1, last + 1 / (kfs.length + 1));
}

function _normalizeKeyframe(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.itemId !== 'string' || !raw.itemId) return null;

    const position = Number.isFinite(raw.position) ? Math.max(0, Math.min(1, raw.position)) : 0;
    const duration = Number.isFinite(raw.duration) && raw.duration >= 0 ? raw.duration : 3000;
    const transition = Number.isFinite(raw.transition) && raw.transition >= 0 ? raw.transition : 1000;
    const easing = VALID_EASINGS.has(raw.easing) ? raw.easing : 'ease-out';
    const annotation = typeof raw.annotation === 'string' ? raw.annotation.slice(0, 500) : null;

    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : `kf-import-${Date.now()}-${index}`,
        itemId: raw.itemId,
        position,
        duration,
        transition,
        easing,
        cameraOverride: raw.cameraOverride || null,
        campaignIds: Array.isArray(raw.campaignIds) ? raw.campaignIds : null,
        elementVisibility:
            raw.elementVisibility && typeof raw.elementVisibility === 'object' ? raw.elementVisibility : null,
        annotation,
    };
}

function _mapLegacyClusterKeyframes(keyframes) {
    if (!Array.isArray(keyframes) || _clusterLegacyIdMap.size === 0) return keyframes;
    return keyframes.map((kf) => {
        if (!kf || typeof kf !== 'object') return kf;
        const mappedId = _clusterLegacyIdMap.get(kf.itemId);
        if (!mappedId || mappedId === kf.itemId) return kf;
        return { ...kf, itemId: mappedId };
    });
}

function _buildClusterCarryOverMap(previousClusters, nextClusters) {
    const map = new Map();
    if (!Array.isArray(previousClusters) || !Array.isArray(nextClusters)) return map;
    if (previousClusters.length === 0 || nextClusters.length === 0) return map;

    const nextSets = nextClusters.map((cluster) => ({
        id: cluster.id,
        set: new Set(Array.isArray(cluster.elementIds) ? cluster.elementIds : []),
    }));

    for (const prev of previousClusters) {
        const prevIds = Array.isArray(prev.elementIds) ? prev.elementIds : [];
        if (prevIds.length === 0 || typeof prev.id !== 'string') continue;

        let bestId = null;
        let bestOverlap = 0;
        for (const next of nextSets) {
            let overlap = 0;
            for (const id of prevIds) {
                if (next.set.has(id)) overlap++;
            }
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                bestId = next.id;
            }
        }

        if (bestId && bestOverlap > 0 && bestId !== prev.id) {
            map.set(prev.id, bestId);
        }
    }

    return map;
}

function _sortKeyframes() {
    _state.keyframes.sort((a, b) => a.position - b.position);
}

function _recomputeTotalDuration() {
    const kfs = _state.keyframes;
    if (kfs.length === 0) {
        _state.playback.totalDuration = 0;
        return;
    }
    let total = 0;
    for (const kf of kfs) {
        total += (kf.duration || 3000) + (kf.transition || 1000);
    }
    _state.playback.totalDuration = total;
}

async function _persist() {
    if (isEphemeral()) return;
    const ok = await idbSet(STORAGE_KEY, {
        keyframes: _state.keyframes,
        speed: _state.playback.speed,
        loop: _state.playback.loop,
    });
    if (!ok) showToast('Storage full. Storyboard data may not persist.', 'warning');
}

async function _restore() {
    try {
        const data = await idbGetWithLegacy(STORAGE_KEY);
        if (!data) return;
        if (Array.isArray(data.keyframes)) _state.keyframes = data.keyframes;
        if (data.speed != null) _state.playback.speed = data.speed;
        if (data.loop != null) _state.playback.loop = data.loop;
        _recomputeTotalDuration();
    } catch {
        /* corrupted — ignore */
    }
}

function _consumePendingRestore() {
    if (typeof window === 'undefined') return { hasPending: false, data: null };
    const hasPending = Object.prototype.hasOwnProperty.call(window, PENDING_RESTORE_KEY);
    if (!hasPending) return { hasPending: false, data: null };
    const data = window[PENDING_RESTORE_KEY];
    try {
        delete window[PENDING_RESTORE_KEY];
    } catch {
        window[PENDING_RESTORE_KEY] = undefined;
    }
    return { hasPending: true, data };
}

function _notifyChange() {
    for (const cb of _onChangeCallbacks) {
        try {
            cb(_state);
        } catch {
            /* ignore */
        }
    }
}
