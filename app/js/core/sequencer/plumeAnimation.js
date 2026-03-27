// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   PLUME ANIMATION — Animacao temporal de plumas de contaminacao
   ================================================================

   Gera animacoes 3D de evolucao temporal de plumas baseadas em
   observacoes agrupadas por campanha. Cada campanha vira um frame
   da animacao.

   FLUXO:
   1. Coleta observacoes do parametro selecionado em todos os pocos
   2. Agrupa por campanha (passo temporal)
   3. Para cada campanha: IDW/Kriging -> grid 2D -> mesh THREE.js
   4. Registra handler de tick no sequencer engine
   5. Na reproducao: alterna visibilidade entre frames

   EXPORTACAO ECO1:
   - Apenas metadados (sem grids brutos nem geometrias THREE.js)
   - Grids sao recalculados ao importar (sob demanda)

   ================================================================ */

import * as THREE from 'three';
import { getAllElements } from '../elements/manager.js';
import { getAllCampaigns } from '../campaigns/manager.js';
import { interpolateGrid } from '../interpolation/engine.js';
import { extractIsosurface } from '../interpolation/isosurface.js';
import { onTick, play } from './engine.js';
import { getElementsGroup, requestRender } from '../../utils/scene/setup.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

/** @type {Map<string, PlumeAnimationState>} */
const _animations = new Map();

/** @type {Map<string, Function>} unsubscribers do onTick */
const _tickUnsubscribers = new Map();

/** @type {Map<string, THREE.Group>} grupos de meshes por animacao */
const _meshGroups = new Map();

let _animCounter = 0;

// ----------------------------------------------------------------
// TIPOS
// ----------------------------------------------------------------

/**
 * @typedef {Object} PlumeAnimationFrame
 * @property {string} campaignId
 * @property {string} campaignName
 * @property {string} date - ISO date da campanha
 * @property {number} pointCount - Numero de pontos usados na interpolacao
 * @property {number} minValue
 * @property {number} maxValue
 */

/**
 * @typedef {Object} PlumeAnimationState
 * @property {string} id
 * @property {string} elementId
 * @property {string} parameterId
 * @property {'idw'|'kriging'} method
 * @property {PlumeAnimationFrame[]} frames
 * @property {number} isoValue - Limiar para extracao da isosuperficie
 * @property {Object} bounds - { minX, maxX, minZ, maxZ }
 * @property {{cols: number, rows: number}} gridSize
 * @property {number} _currentFrameIndex - Estado de runtime (nao exportado)
 */

// ----------------------------------------------------------------
// API PUBLICA
// ----------------------------------------------------------------

/**
 * Gera uma animacao temporal de pluma para um elemento.
 * Coleta observacoes de todos os pocos, agrupa por campanha e interpola.
 *
 * @param {string} elementId - ID do elemento pluma
 * @param {Object} [options]
 * @param {string} [options.parameterId] - Parametro a animar (se omitido, usa o primeiro disponivel)
 * @param {'idw'|'kriging'} [options.method='idw'] - Metodo de interpolacao
 * @param {number} [options.gridCols=24] - Colunas do grid
 * @param {number} [options.gridRows=24] - Linhas do grid
 * @param {number} [options.isoValue] - Limiar para isosuperficie (default: 20% do max)
 * @param {Function} [options.onProgress] - Callback de progresso 0..1
 * @returns {Promise<PlumeAnimationState>} Animacao gerada
 */
export async function generatePlumeAnimation(elementId, options = {}) {
    const element = _getElementById(elementId);
    if (!element) throw new Error(`Elemento nao encontrado: ${elementId}`);

    const { method = 'idw', gridCols = 24, gridRows = 24, onProgress } = options;

    // 1. Determinar parametro
    let { parameterId } = options;
    if (!parameterId) {
        parameterId = _getFirstParameterId(element);
        if (!parameterId) throw new Error('Elemento nao possui observacoes com parametros definidos.');
    }

    // 2. Coletar todas as campanhas com dados
    const campaigns = getAllCampaigns();
    const campaignDataMap = _collectObservationsByCampaign(parameterId, campaigns);

    // Ordenar por data de inicio da campanha
    const sortedCampaigns = [...campaignDataMap.entries()]
        .map(([cid, pts]) => {
            const camp = campaigns.find((c) => c.id === cid);
            return { cid, pts, date: camp?.startDate || '', name: camp?.name || cid };
        })
        .filter((e) => e.pts.length >= 1)
        .sort((a, b) => a.date.localeCompare(b.date));

    if (sortedCampaigns.length < 2) {
        throw new Error('Sao necessarias pelo menos 2 campanhas com dados para gerar animacao.');
    }

    // 3. Calcular bounds do grid (bounding box de todos os pontos + margem)
    const allPoints = sortedCampaigns.flatMap((e) => e.pts);
    const bounds = _computeBounds(allPoints, 0.15);
    const gridSize = { cols: gridCols, rows: gridRows };

    // 4. Gerar frames
    const frames = [];
    const animId = `panim-${++_animCounter}-${Date.now().toString(36)}`;

    for (let i = 0; i < sortedCampaigns.length; i++) {
        const { cid, pts, date, name } = sortedCampaigns[i];
        if (onProgress) onProgress((i / sortedCampaigns.length) * 0.8);

        let result;
        try {
            // Pontos com coordenadas x,z e valor de concentracao
            const interpPoints =
                pts.length === 1 ? [...pts, { x: pts[0].x + 0.001, z: pts[0].z + 0.001, value: pts[0].value }] : pts;

            result = await interpolateGrid(interpPoints, bounds, gridSize, method, {});
        } catch (err) {
            console.warn(`[ecbyts] plumeAnimation: campanha ${cid} ignorada —`, err.message);
            continue;
        }

        frames.push({
            campaignId: cid,
            campaignName: name,
            date,
            pointCount: pts.length,
            minValue: result.stats.min,
            maxValue: result.stats.max,
            _grid: result.grid, // runtime only — nao exportado
        });
    }

    if (onProgress) onProgress(0.9);

    if (frames.length < 2) {
        throw new Error('Dados insuficientes para gerar animacao com multiplos frames.');
    }

    // 5. Calcular isoValue padrao (20% do maximo global)
    const globalMax = Math.max(...frames.map((f) => f.maxValue));
    const isoValue = options.isoValue ?? globalMax * 0.2;

    // 6. Construir meshes THREE.js
    const group = new THREE.Group();
    group.name = `plume-anim-${animId}`;

    for (const frame of frames) {
        if (!frame._grid) continue;

        // Grid 3D minimo: 2 camadas para isosurface funcionar
        const layers = 2;
        const grid3D = new Float32Array(layers * gridRows * gridCols);
        // Camada 0: valores interpolados; Camada 1: zeros (abaixo da superficie)
        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
                const v = frame._grid[r * gridCols + c];
                grid3D[0 * gridRows * gridCols + r * gridCols + c] = v;
                grid3D[1 * gridRows * gridCols + r * gridCols + c] = 0;
            }
        }

        const dims = { cols: gridCols, rows: gridRows, layers };
        // Bounds 3D: Y de -1 a 0 (superficie e no nivel Y=0)
        const bounds3D = { ...bounds, minY: -1, maxY: 0 };

        let geometry;
        try {
            geometry = extractIsosurface(grid3D, dims, bounds3D, isoValue);
        } catch {
            geometry = new THREE.PlaneGeometry(1, 1);
        }

        const material = new THREE.MeshPhongMaterial({
            color: 0xff6600,
            opacity: 0.55,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.visible = false;
        mesh.userData.frameIndex = frames.indexOf(frame);
        mesh.userData.campaignId = frame.campaignId;
        group.add(mesh);

        frame._mesh = mesh; // runtime — nao exportado
        delete frame._grid; // libera memoria do grid
    }

    // Mostrar primeiro frame
    if (frames[0]?._mesh) frames[0]._mesh.visible = true;

    // Adicionar grupo a cena
    const sceneGroup = getElementsGroup?.();
    if (sceneGroup) sceneGroup.add(group);
    _meshGroups.set(animId, group);

    if (onProgress) onProgress(1);

    // 7. Criar objeto de animacao
    /** @type {PlumeAnimationState} */
    const animation = {
        id: animId,
        elementId,
        parameterId,
        method,
        isoValue,
        bounds,
        gridSize,
        frames,
        _currentFrameIndex: 0,
    };

    _animations.set(animId, animation);
    requestRender?.();

    return animation;
}

/**
 * Registra handler de tick do sequencer para uma animacao.
 * Muda o frame visivel conforme a posicao de playback.
 *
 * @param {string} animationId
 */
export function addPlumeAnimationToSequencer(animationId) {
    const anim = _animations.get(animationId);
    if (!anim) return;

    // Remove listener anterior se existir
    const prev = _tickUnsubscribers.get(animationId);
    if (prev) prev();

    const unsubscribe = onTick(({ position }) => {
        _onAnimationTick(animationId, position);
    });

    _tickUnsubscribers.set(animationId, unsubscribe);
}

/**
 * Inicia o playback de uma animacao pluma (integrado ao sequencer engine).
 *
 * @param {string} animationId
 */
export function playPlumeAnimation(animationId) {
    addPlumeAnimationToSequencer(animationId);
    play();
}

/**
 * Remove uma animacao e seus recursos 3D.
 *
 * @param {string} animationId
 */
export function removePlumeAnimation(animationId) {
    const anim = _animations.get(animationId);
    if (!anim) return;

    // Remove tick listener
    const unsub = _tickUnsubscribers.get(animationId);
    if (unsub) {
        unsub();
        _tickUnsubscribers.delete(animationId);
    }

    // Remove meshes da cena
    const group = _meshGroups.get(animationId);
    if (group) {
        group.parent?.remove(group);
        group.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
        _meshGroups.delete(animationId);
    }

    _animations.delete(animationId);
    requestRender?.();
}

/**
 * Retorna todas as animacoes registradas.
 * @returns {PlumeAnimationState[]}
 */
export function getAllPlumeAnimations() {
    return [..._animations.values()];
}

/**
 * Retorna animacao por ID.
 * @param {string} id
 * @returns {PlumeAnimationState|null}
 */
export function getPlumeAnimationById(id) {
    return _animations.get(id) || null;
}

/**
 * Exporta animacoes para ECO1 (sem grids brutos nem geometrias THREE.js).
 * @returns {Object[]}
 */
export function exportPlumeAnimations() {
    return [..._animations.values()].map((anim) => ({
        id: anim.id,
        elementId: anim.elementId,
        parameterId: anim.parameterId,
        method: anim.method,
        isoValue: anim.isoValue,
        bounds: anim.bounds,
        gridSize: anim.gridSize,
        frames: anim.frames.map((f) => ({
            campaignId: f.campaignId,
            campaignName: f.campaignName,
            date: f.date,
            pointCount: f.pointCount,
            minValue: f.minValue,
            maxValue: f.maxValue,
            // _grid e _mesh omitidos intencionalmente
        })),
    }));
}

/**
 * Restaura animacoes a partir de dados ECO1 importados.
 * Meshes e grids sao recriados sob demanda.
 *
 * @param {Object[]} data
 */
export function importPlumeAnimations(data) {
    if (!Array.isArray(data)) return;
    for (const anim of data) {
        if (!anim.id || !anim.elementId) continue;
        // Restaura metadados sem reconstruir meshes
        _animations.set(anim.id, {
            ...anim,
            _currentFrameIndex: 0,
        });
    }
}

/**
 * Remove todas as animacoes de pluma e seus recursos 3D da cena.
 * Limpa o estado interno (animations Map, tick listeners, mesh groups).
 * Chamavel por handleClearModel ou similar para limpeza completa.
 */
export function disposePlumeAnimations() {
    // Unsubscribe all tick listeners
    for (const [, unsub] of _tickUnsubscribers) {
        if (typeof unsub === 'function') unsub();
    }
    _tickUnsubscribers.clear();

    // Remove all mesh groups from scene and dispose GPU resources
    for (const [, group] of _meshGroups) {
        group.parent?.remove(group);
        group.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
    }
    _meshGroups.clear();

    // Clear animation state
    _animations.clear();
    _animCounter = 0;

    requestRender?.();
}

// ----------------------------------------------------------------
// INTERNAL — TICK HANDLER
// ----------------------------------------------------------------

/**
 * Atualiza o frame visivel com base na posicao de playback (0-1).
 *
 * @param {string} animationId
 * @param {number} position - 0.0 a 1.0
 */
function _onAnimationTick(animationId, position) {
    const anim = _animations.get(animationId);
    if (!anim || anim.frames.length === 0) return;

    const frameCount = anim.frames.length;
    const frameIndex = Math.min(Math.floor(position * frameCount), frameCount - 1);

    if (frameIndex === anim._currentFrameIndex) return;
    anim._currentFrameIndex = frameIndex;

    // Alterna visibilidade
    for (let i = 0; i < anim.frames.length; i++) {
        const mesh = anim.frames[i]._mesh;
        if (mesh) mesh.visible = i === frameIndex;
    }

    requestRender?.();
}

// ----------------------------------------------------------------
// INTERNAL — COLETA DE DADOS
// ----------------------------------------------------------------

/**
 * Coleta observacoes de um parametro, agrupadas por campaignId.
 * Usa todos os pocos do modelo para gerar interpolacoes espacialmente significativas.
 *
 * @param {string} parameterId
 * @param {Object[]} campaigns
 * @returns {Map<string, Array<{x: number, z: number, value: number}>>}
 */
function _collectObservationsByCampaign(parameterId, campaigns) {
    const result = new Map();
    const elements = getAllElements();
    const campaignIds = new Set(campaigns.map((c) => c.id));

    for (const el of elements) {
        if (el.family !== 'well') continue;
        const observations = el.data?.observations;
        if (!Array.isArray(observations) || observations.length === 0) continue;

        const x = el.data?.coordinates?.easting ?? el.data?.position?.x ?? 0;
        const z = el.data?.coordinates?.northing ?? el.data?.position?.z ?? 0;

        for (const obs of observations) {
            if (!obs.parameterId || obs.parameterId !== parameterId) continue;
            const val = parseFloat(obs.value);
            if (!Number.isFinite(val)) continue;
            const cid = obs.campaignId;
            if (!cid || !campaignIds.has(cid)) continue;

            if (!result.has(cid)) result.set(cid, []);
            result.get(cid).push({ x, z, value: val });
        }
    }

    // Deduplica pontos co-localizados por campanha
    for (const [cid, pts] of result.entries()) {
        result.set(cid, _deduplicatePoints(pts));
    }

    return result;
}

/**
 * Remove pontos com coordenadas duplicadas (tolerancia 0.01m).
 * @param {Array<{x: number, z: number, value: number}>} pts
 * @returns {Array<{x: number, z: number, value: number}>}
 */
function _deduplicatePoints(pts) {
    const seen = new Map();
    const tol = 0.01;
    for (const pt of pts) {
        const key = `${Math.round(pt.x / tol) * tol}_${Math.round(pt.z / tol) * tol}`;
        if (!seen.has(key)) seen.set(key, pt);
    }
    return [...seen.values()];
}

/**
 * Calcula bounds a partir de uma lista de pontos, com margem percentual.
 * @param {Array<{x: number, z: number}>} points
 * @param {number} margin - Ex: 0.15 = 15% de margem
 * @returns {{minX: number, maxX: number, minZ: number, maxZ: number}}
 */
function _computeBounds(points, margin = 0.15) {
    if (points.length === 0) return { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };

    let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
    }

    // Fallback para ponto unico
    if (minX === maxX) {
        minX -= 10;
        maxX += 10;
    }
    if (minZ === maxZ) {
        minZ -= 10;
        maxZ += 10;
    }

    const dx = (maxX - minX) * margin;
    const dz = (maxZ - minZ) * margin;
    return { minX: minX - dx, maxX: maxX + dx, minZ: minZ - dz, maxZ: maxZ + dz };
}

/**
 * Retorna o primeiro parametro disponivel nas observacoes do elemento.
 * @param {Object} element
 * @returns {string|null}
 */
function _getFirstParameterId(element) {
    const obs = element.data?.observations;
    if (!Array.isArray(obs)) return null;
    for (const o of obs) {
        if (o.parameterId && Number.isFinite(parseFloat(o.value))) return o.parameterId;
    }
    return null;
}

/**
 * Recupera elemento por ID.
 * @param {string} id
 * @returns {Object|null}
 */
function _getElementById(id) {
    return getAllElements().find((e) => e.id === id) || null;
}
