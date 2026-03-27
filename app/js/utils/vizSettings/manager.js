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
   VIZ SETTINGS MANAGER — Presets, state, scene application
   ================================================================

   Gerencia configuracoes de visualizacao 3D: fog, background, luzes,
   wireframe, sombras, strata, overlay, exagero vertical e clip planes.

   8 presets built-in + presets customizados do usuario.
   Sincroniza estado com a cena Three.js via applySettingsToScene().

   Clip planes podem ser globais (cortam tudo) ou per-element
   (clonando materiais dos elementos selecionados).

   ================================================================ */

import * as THREE from 'three';
import { getScene, getRenderer, getElementsGroup, requestRender } from '../scene/setup.js';
import { generateId } from '../helpers/id.js';
import { getMeshByElementId } from '../../core/elements/manager.js';
import { safeSetItem } from '../storage/storageMonitor.js';

// ----------------------------------------------------------------
// CONSTANTS
// ----------------------------------------------------------------

const STORAGE_KEY = 'ecbyts-viz-settings';

/**
 * Built-in presets — 8 visuais interessantes para modelos ambientais.
 * Cada preset define todos os parametros de renderizacao da cena.
 */
const BUILTIN_PRESETS = {
    default: {
        name: 'Default',
        icon: 'monitor',
        fog: { enabled: false, near: 150, far: 400 },
        background: '#1a1d23',
        grid: true,
        wireframe: false,
        shadows: true,
        strata: true,
        ambientIntensity: 0.5,
        directionalIntensity: 0.8,
        overlayOpacity: 0.85,
        verticalExaggeration: 1.0,
        clipPlanes: [],
    },
    day: {
        name: 'Day',
        icon: 'sun',
        fog: { enabled: false, near: 300, far: 800 },
        background: '#87CEEB',
        grid: true,
        wireframe: false,
        shadows: true,
        strata: true,
        ambientIntensity: 0.8,
        directionalIntensity: 1.0,
        overlayOpacity: 0.9,
        verticalExaggeration: 1.0,
        clipPlanes: [],
    },
    night: {
        name: 'Night',
        icon: 'moon',
        fog: { enabled: false, near: 80, far: 250 },
        background: '#0a0e14',
        grid: true,
        wireframe: false,
        shadows: true,
        strata: true,
        ambientIntensity: 0.2,
        directionalIntensity: 0.4,
        overlayOpacity: 0.7,
        verticalExaggeration: 1.0,
        clipPlanes: [],
    },
    technical: {
        name: 'Technical',
        icon: 'compass',
        fog: { enabled: false, near: 150, far: 400 },
        background: '#ffffff',
        grid: true,
        wireframe: true,
        shadows: false,
        strata: false,
        ambientIntensity: 1.0,
        directionalIntensity: 0.3,
        overlayOpacity: 0.5,
        verticalExaggeration: 3.0,
        clipPlanes: [],
    },
    presentation: {
        name: 'Presentation',
        icon: 'tv',
        fog: { enabled: false, near: 200, far: 600 },
        background: '#1a2332',
        grid: false,
        wireframe: false,
        shadows: true,
        strata: true,
        ambientIntensity: 0.6,
        directionalIntensity: 0.9,
        overlayOpacity: 0.9,
        verticalExaggeration: 1.5,
        clipPlanes: [],
    },
    xray: {
        name: 'X-Ray',
        icon: 'eye',
        fog: { enabled: false, near: 150, far: 400 },
        background: '#0a0a1a',
        grid: false,
        wireframe: true,
        shadows: false,
        strata: false,
        ambientIntensity: 0.3,
        directionalIntensity: 0.1,
        overlayOpacity: 0.3,
        verticalExaggeration: 1.0,
        clipPlanes: [],
    },
    subsurface: {
        name: 'Subsurface',
        icon: 'layers',
        fog: { enabled: false, near: 100, far: 350 },
        background: '#0d1520',
        grid: true,
        wireframe: false,
        shadows: true,
        strata: true,
        ambientIntensity: 0.4,
        directionalIntensity: 0.6,
        overlayOpacity: 0.6,
        verticalExaggeration: 5.0,
        clipPlanes: [
            {
                id: 'builtin-sub',
                name: 'Subsurface Cut',
                enabled: true,
                height: 0,
                angle: 0,
                flip: false,
                scope: 'all',
                elementIds: [],
            },
        ],
    },
    blueprint: {
        name: 'Blueprint',
        icon: 'file-text',
        fog: { enabled: false, near: 150, far: 400 },
        background: '#1a3a5c',
        grid: true,
        wireframe: true,
        shadows: false,
        strata: false,
        ambientIntensity: 0.9,
        directionalIntensity: 0.2,
        overlayOpacity: 0.4,
        verticalExaggeration: 2.0,
        clipPlanes: [],
    },
};

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

const state = {
    visible: false,
    collapsed: false,
    activePreset: 'default',
    custom: _deepCloneSettings(BUILTIN_PRESETS.default),
    userPresets: [],
};

/**
 * Rastreia materiais clonados para clipping per-element.
 * Map<elementId, Map<childMesh, originalMaterial>>
 */
const _clonedMaterialMap = new Map();

// ----------------------------------------------------------------
// DEEP CLONE HELPERS
// ----------------------------------------------------------------

/**
 * Deep clone de um settings object (preserva fog e clipPlanes).
 * @param {Object} s
 * @returns {Object}
 */
function _deepCloneSettings(s) {
    return {
        ...s,
        fog: { ...s.fog },
        clipPlanes: (s.clipPlanes || []).map((cp) => ({ ...cp, elementIds: [...(cp.elementIds || [])] })),
    };
}

/**
 * Migra formato antigo (clipping:{...}) para novo (clipPlanes:[]).
 * @param {Object} custom - O objeto custom que pode ter formato antigo
 */
function _migrateClipping(custom) {
    if (custom.clipping && !custom.clipPlanes) {
        const old = custom.clipping;
        custom.clipPlanes = old.enabled
            ? [
                  {
                      id: generateId('clip'),
                      name: 'Clip Plane 1',
                      enabled: true,
                      height: old.height || 0,
                      angle: old.angle || 0,
                      flip: !!old.flip,
                      scope: 'all',
                      elementIds: [],
                  },
              ]
            : [];
        delete custom.clipping;
    }
    if (!Array.isArray(custom.clipPlanes)) {
        custom.clipPlanes = [];
    }
}

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Initialize viz settings from localStorage.
 * Restaura estado salvo e aplica a cena.
 */
export function initVizSettings() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                // visible NAO persistido — sempre inicia oculto para evitar confusao UX
                state.visible = false;
                state.collapsed = !!parsed.collapsed;
                state.activePreset = parsed.activePreset || 'default';
                state.userPresets = Array.isArray(parsed.userPresets) ? parsed.userPresets : [];
                if (parsed.custom && typeof parsed.custom === 'object') {
                    state.custom = { ...BUILTIN_PRESETS.default, ...parsed.custom };
                    state.custom.fog = { ...BUILTIN_PRESETS.default.fog, ...(parsed.custom.fog || {}) };
                    _migrateClipping(state.custom);
                    // Deep clone clipPlanes array
                    state.custom.clipPlanes = (state.custom.clipPlanes || []).map((cp) => ({
                        ...cp,
                        elementIds: [...(cp.elementIds || [])],
                    }));
                }
            }
        }
    } catch (e) {
        console.warn('[VizSettings] Failed to restore state:', e.message);
    }
    // Aplica settings a cena no proximo frame (Three.js precisa estar pronto)
    requestAnimationFrame(() => applySettingsToScene());
}

// ----------------------------------------------------------------
// PERSISTENCE
// ----------------------------------------------------------------

function persist() {
    try {
        safeSetItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        // Ignore quota errors
    }
}

// ----------------------------------------------------------------
// GETTERS
// ----------------------------------------------------------------

/**
 * Get current viz settings state.
 * @returns {Object}
 */
export function getVizSettingsConfig() {
    return { ...state, custom: _deepCloneSettings(state.custom) };
}

/**
 * Get current active settings (resolved from preset or custom).
 * @returns {Object}
 */
export function getActiveSettings() {
    return _deepCloneSettings(state.custom);
}

/**
 * Get all builtin presets.
 * @returns {Object}
 */
export function getBuiltinPresets() {
    return BUILTIN_PRESETS;
}

/**
 * Get user presets.
 * @returns {Array}
 */
export function getUserPresets() {
    return [...state.userPresets];
}

// ----------------------------------------------------------------
// MUTATIONS — Viz Settings
// ----------------------------------------------------------------

/**
 * Show or hide the viz settings bar.
 * @param {boolean} visible
 */
export function setVizSettingsVisible(visible) {
    state.visible = !!visible;
    persist();
}

/**
 * Toggle collapsed state of the bar body.
 * @param {boolean} collapsed
 */
export function setVizSettingsCollapsed(collapsed) {
    state.collapsed = !!collapsed;
    persist();
}

/**
 * Apply a preset (builtin or user).
 * Copia todos os parametros do preset para o estado custom.
 * @param {string} presetId
 */
export function applyPreset(presetId) {
    // Tenta builtin primeiro
    const builtin = BUILTIN_PRESETS[presetId];
    if (builtin) {
        state.custom = _deepCloneSettings(builtin);
        state.activePreset = presetId;
        persist();
        applySettingsToScene();
        return true;
    }

    // Tenta user preset
    const userPreset = state.userPresets.find((p) => p.id === presetId);
    if (userPreset) {
        const merged = { ...BUILTIN_PRESETS.default, ...userPreset.settings };
        merged.fog = { ...BUILTIN_PRESETS.default.fog, ...(userPreset.settings.fog || {}) };
        _migrateClipping(merged);
        merged.clipPlanes = (merged.clipPlanes || []).map((cp) => ({ ...cp, elementIds: [...(cp.elementIds || [])] }));
        state.custom = merged;
        state.activePreset = presetId;
        persist();
        applySettingsToScene();
        return true;
    }

    return false;
}

/**
 * Change a single viz setting.
 * Marca activePreset como 'custom' (nao corresponde a nenhum preset).
 * @param {string} key
 * @param {*} value
 */
export function changeSetting(key, value) {
    if (key === 'fog.enabled') {
        state.custom.fog = { ...state.custom.fog, enabled: !!value };
    } else if (key === 'fog.near') {
        state.custom.fog = { ...state.custom.fog, near: Number(value) };
    } else if (key === 'fog.far') {
        state.custom.fog = { ...state.custom.fog, far: Number(value) };
    } else if (key in state.custom) {
        if (typeof state.custom[key] === 'number') {
            state.custom[key] = Number(value);
        } else if (typeof state.custom[key] === 'boolean') {
            state.custom[key] = !!value;
        } else {
            state.custom[key] = value;
        }
    }

    state.activePreset = 'custom';
    persist();
    applySettingsToScene();
}

/**
 * Save current settings as a user preset.
 * @param {string} name
 * @returns {Object} Created preset
 */
export function saveUserPreset(name) {
    const id = 'user-' + Date.now();
    const preset = {
        id,
        name,
        settings: _deepCloneSettings(state.custom),
    };
    state.userPresets.push(preset);
    state.activePreset = id;
    persist();
    return preset;
}

/**
 * Delete a user preset.
 * @param {string} presetId
 */
export function deleteUserPreset(presetId) {
    state.userPresets = state.userPresets.filter((p) => p.id !== presetId);
    if (state.activePreset === presetId) {
        state.activePreset = 'custom';
    }
    persist();
}

/**
 * Reset to default preset.
 */
export function resetToDefault() {
    state.custom = _deepCloneSettings(BUILTIN_PRESETS.default);
    state.activePreset = 'default';
    persist();
    applySettingsToScene();
}

// ----------------------------------------------------------------
// MUTATIONS — Clip Planes CRUD
// ----------------------------------------------------------------

/**
 * Add a new clip plane.
 * @param {Object} partial - Campos opcionais para override
 * @returns {Object} O clip plane criado
 */
export function addClipPlane(partial = {}) {
    const plane = {
        id: generateId('clip'),
        name: `Clip ${state.custom.clipPlanes.length + 1}`,
        enabled: true,
        height: 0,
        angle: 0,
        flip: false,
        scope: 'all',
        elementIds: [],
        ...partial,
    };
    state.custom.clipPlanes.push(plane);
    state.activePreset = 'custom';
    persist();
    applySettingsToScene();
    return plane;
}

/**
 * Update fields on an existing clip plane.
 * @param {string} id
 * @param {Object} changes
 */
export function updateClipPlane(id, changes) {
    const plane = state.custom.clipPlanes.find((p) => p.id === id);
    if (!plane) return;
    Object.assign(plane, changes);
    state.activePreset = 'custom';
    persist();
    applySettingsToScene();
}

/**
 * Remove a clip plane by id.
 * @param {string} id
 */
export function removeClipPlane(id) {
    state.custom.clipPlanes = state.custom.clipPlanes.filter((p) => p.id !== id);
    state.activePreset = 'custom';
    persist();
    applySettingsToScene();
}

/**
 * Duplicate a clip plane.
 * @param {string} id
 * @returns {Object|null} O clone ou null se nao encontrou
 */
export function duplicateClipPlane(id) {
    const src = state.custom.clipPlanes.find((p) => p.id === id);
    if (!src) return null;
    const clone = {
        ...src,
        id: generateId('clip'),
        name: src.name + ' (copy)',
        elementIds: [...src.elementIds],
    };
    state.custom.clipPlanes.push(clone);
    state.activePreset = 'custom';
    persist();
    applySettingsToScene();
    return clone;
}

/**
 * Remove um element ID de todos os clip planes.
 * Chamado quando um elemento e removido do modelo.
 * @param {string} elementId
 */
export function onElementRemoved(elementId) {
    let changed = false;
    for (const plane of state.custom.clipPlanes) {
        const idx = plane.elementIds.indexOf(elementId);
        if (idx !== -1) {
            plane.elementIds.splice(idx, 1);
            changed = true;
        }
    }
    if (changed) {
        persist();
        applySettingsToScene();
    }
}

// ----------------------------------------------------------------
// SCENE APPLICATION
// ----------------------------------------------------------------

/**
 * Converte um clip plane config em THREE.Plane.
 * @param {Object} cp - { height, angle, flip }
 * @returns {THREE.Plane}
 */
function _buildThreePlane(cp) {
    const rad = ((cp.angle || 0) * Math.PI) / 180;
    const nx = Math.sin(rad);
    const nz = -Math.cos(rad);
    const sign = cp.flip ? -1 : 1;
    return new THREE.Plane(new THREE.Vector3(nx * sign, 0, nz * sign), cp.height);
}

/**
 * Restaura materiais originais de todos os elementos com clipping per-element.
 * Dispoe os clones para evitar memory leak.
 */
function _restoreAllClonedMaterials() {
    for (const [, originals] of _clonedMaterialMap) {
        for (const [child, original] of originals) {
            if (Array.isArray(child.material)) {
                child.material.forEach((m) => m.dispose());
            } else if (child.material) {
                child.material.dispose();
            }
            child.material = original;
        }
    }
    _clonedMaterialMap.clear();
}

/**
 * Aplica clipping planes per-element via clone de material.
 * @param {Map<string, THREE.Plane[]>} perElementMap - elementId → [THREE.Plane]
 */
function _applyPerElementClipping(perElementMap) {
    // Restaura todos os clones anteriores
    _restoreAllClonedMaterials();

    for (const [elementId, planes] of perElementMap) {
        const mesh = getMeshByElementId(elementId);
        if (!mesh) continue;

        const originals = new Map();

        mesh.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            if (Array.isArray(child.material)) {
                originals.set(child, [...child.material]);
                child.material = child.material.map((m) => {
                    const c = m.clone();
                    c.clippingPlanes = planes;
                    return c;
                });
            } else {
                originals.set(child, child.material);
                const c = child.material.clone();
                c.clippingPlanes = planes;
                child.material = c;
            }
        });

        _clonedMaterialMap.set(elementId, originals);
    }
}

/**
 * Apply current settings to the Three.js scene.
 * Sincroniza todas as propriedades visuais com o estado atual.
 */
export function applySettingsToScene() {
    const scene = getScene();
    const renderer = getRenderer();
    const elementsGroup = getElementsGroup();
    if (!scene) return;

    const s = state.custom;

    // --- Background ---
    const bgColor = new THREE.Color(s.background);
    scene.background = bgColor;

    // --- Fog ---
    if (s.fog.enabled) {
        scene.fog = new THREE.Fog(bgColor, s.fog.near, s.fog.far);
    } else {
        scene.fog = null;
    }

    // --- Lights ---
    scene.traverse((obj) => {
        if (obj.isLight) {
            if (obj.name === 'ambientLight' || obj.isAmbientLight) {
                obj.intensity = s.ambientIntensity;
            } else if (obj.name === 'mainLight' || (obj.isDirectionalLight && obj.castShadow)) {
                obj.intensity = s.directionalIntensity;
            }
        }
    });

    // --- Shadows ---
    if (renderer) {
        renderer.shadowMap.enabled = s.shadows;
        if (renderer.shadowMap.needsUpdate !== undefined) {
            renderer.shadowMap.needsUpdate = true;
        }
    }

    // --- Grid ---
    scene.traverse((obj) => {
        if (obj.isGridHelper || obj.name === 'grid') {
            obj.visible = s.grid;
        }
    });

    // --- Strata ---
    scene.traverse((obj) => {
        if (obj.name === 'strata' || obj.name === 'strataGroup') {
            obj.visible = s.strata;
        }
    });

    // --- Interpolation surfaces ---
    scene.traverse((obj) => {
        if (obj.name === 'interpolationSurfaces') {
            obj.visible = s.interpolation !== false; // default visible
        }
    });

    // --- Clipping planes ---
    const clipPlanes = s.clipPlanes || [];
    const globalPlanes = [];
    const perElementMap = new Map(); // elementId → [THREE.Plane]

    for (const cp of clipPlanes) {
        if (!cp.enabled) continue;
        const threePlane = _buildThreePlane(cp);

        if (cp.scope === 'all' || !cp.scope) {
            globalPlanes.push(threePlane);
        } else if (cp.scope === 'elements' && cp.elementIds && cp.elementIds.length > 0) {
            for (const elId of cp.elementIds) {
                if (!perElementMap.has(elId)) perElementMap.set(elId, []);
                perElementMap.get(elId).push(threePlane);
            }
        }
    }

    if (renderer) {
        renderer.clippingPlanes = globalPlanes;
    }

    _applyPerElementClipping(perElementMap);

    // --- Wireframe + Overlay opacity ---
    if (elementsGroup) {
        elementsGroup.traverse((obj) => {
            if (obj.isMesh && !obj.isSprite) {
                // Wireframe
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach((mat) => {
                            mat.wireframe = s.wireframe;
                        });
                    } else {
                        obj.material.wireframe = s.wireframe;
                    }
                }

                // Overlay opacity: boundary meshes que tem overlayUrl
                const elId = obj.userData?.elementId || obj.parent?.userData?.elementId;
                if (elId && obj.material && obj.material.map && obj.userData?.isOverlay) {
                    obj.material.opacity = s.overlayOpacity;
                }
            }
        });

        // --- Vertical Exaggeration ---
        elementsGroup.scale.y = s.verticalExaggeration;
    }

    // Dispatch event para outros modulos reagirem
    window.dispatchEvent(new CustomEvent('vizSettingsChanged'));
    requestRender();
}

// ----------------------------------------------------------------
// EXPORT/IMPORT (model persistence)
// ----------------------------------------------------------------

/**
 * Export viz settings state for model save.
 * @returns {Object}
 */
export function exportVizSettings() {
    return {
        activePreset: state.activePreset,
        custom: _deepCloneSettings(state.custom),
        userPresets: state.userPresets.map((p) => ({
            ...p,
            settings: _deepCloneSettings(p.settings),
        })),
    };
}

/**
 * Import viz settings from model load.
 * @param {Object} data
 */
export function importVizSettings(data) {
    if (data && typeof data === 'object') {
        state.activePreset = data.activePreset || 'default';
        if (data.custom) {
            state.custom = { ...BUILTIN_PRESETS.default, ...data.custom };
            state.custom.fog = { ...BUILTIN_PRESETS.default.fog, ...(data.custom.fog || {}) };
            _migrateClipping(state.custom);
            state.custom.clipPlanes = (state.custom.clipPlanes || []).map((cp) => ({
                ...cp,
                elementIds: [...(cp.elementIds || [])],
            }));
        }
        state.userPresets = Array.isArray(data.userPresets) ? data.userPresets : [];
        persist();
        applySettingsToScene();
    }
}

/**
 * Aplica múltiplas configurações em uma única traversal da cena.
 * Usado pelo módulo de simbologia para substituir configurações de cena.
 *
 * @param {Object} changes — propriedades a aplicar
 * @param {Set<string>} [validKeys] — se fornecido, chaves ausentes são ignoradas
 */
export function batchChangeSettings(changes, validKeys) {
    const filtered = validKeys
        ? Object.fromEntries(Object.entries(changes).filter(([k]) => validKeys.has(k)))
        : changes;
    Object.assign(state.custom, filtered);
    state.activePreset = 'custom';
    persist();
    applySettingsToScene();
}
