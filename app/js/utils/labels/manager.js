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
   LABEL MANAGER — Gerenciador de Labels 3D
   ================================================================

   Cria, atualiza e remove labels CSS2D no modelo 3D.
   Quatro categorias de labels:

   1. elementNames  — nome do elemento (poço MW-01, pluma, etc.)
   2. observations  — valor da última observação (0.052 mg/L)
   3. geology       — nome das camadas geológicas (areia, argila)
   4. modelTitle    — título do modelo (flutuante no topo)

   Cada label e um CSS2DObject (Three.js) — div HTML projetada em
   coordenadas 3D, sempre virada para a camera (billboard).

   Persistencia: localStorage ('ecbyts-label-settings')

   ================================================================ */

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { getScene, requestRender } from '../scene/setup.js';
import { getAllElements, getElementById, getMeshByElementId } from '../../core/elements/manager.js';
import { getFamily, getFamilyName } from '../../core/elements/families.js';
import { getCurrentLanguage } from '../i18n/translations.js';
import { safeSetItem } from '../storage/storageMonitor.js';

// ----------------------------------------------------------------
// CONSTANTS
// ----------------------------------------------------------------

const STORAGE_KEY = 'ecbyts-label-settings';
const SETTINGS_VERSION = 2; // Incrementar ao mudar defaults p/ forcar reset

/**
 * Familias que NAO recebem labels por default.
 * Intangibles ja tem HUD cards; boundary/blueprint/area sao geometria de referencia.
 */
const SKIP_FAMILIES = new Set(['intangible', 'generic', 'boundary', 'blueprint', 'area']);

/** Shortcut para idioma atual, com fallback seguro. */
function _getCurrentLang() {
    try {
        return getCurrentLanguage();
    } catch {
        return 'en';
    }
}

/**
 * Offset Y por familia — posiciona label bem acima do topo do mesh.
 * Offsets maiores criam espaco para leader lines conectando label → elemento.
 */
const FAMILY_OFFSETS = {
    well: { x: 0, y: 2.0, z: 0 },
    plume: { x: 0, y: 2.5, z: 0 },
    lake: { x: 0, y: 2.0, z: 0 },
    river: { x: 0, y: 2.0, z: 0 },
    building: { x: 0, y: 2.5, z: 0 },
    tank: { x: 0, y: 2.0, z: 0 },
    waste: { x: 0, y: 2.0, z: 0 },
    spring: { x: 0, y: 1.8, z: 0 },
    boundary: { x: 0, y: 1.5, z: 0 },
    blueprint: { x: 0, y: 1.5, z: 0 },
    sensor: { x: 0, y: 1.8, z: 0 },
    marker: { x: 0, y: 1.8, z: 0 },
    stratum: { x: 0, y: 1.5, z: 0 },
    area: { x: 0, y: 1.5, z: 0 },
    _default: { x: 0, y: 3.0, z: 0 },
};

/** Default config — clonado para state inicial */
const DEFAULTS = {
    enabled: true,
    categories: {
        elementNames: {
            enabled: true,
            fontSize: 11,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#ffffff',
            background: 'rgba(0,0,0,0.65)',
            maxDistance: 0,
            showFamily: false,
        },
        observations: {
            enabled: false,
            fontSize: 10,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
            color: '#00ff88',
            background: 'rgba(0,0,0,0.55)',
            maxDistance: 0,
            showUnit: true,
            showDate: false,
        },
        geology: {
            enabled: false,
            fontSize: 9,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#ffffff',
            background: 'rgba(0,0,0,0.45)',
            offset: { x: 2.5, y: 0, z: 0 },
            maxDistance: 0,
        },
        modelTitle: {
            enabled: false,
            text: '',
            fontSize: 16,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#ffffff',
            background: 'rgba(0,0,0,0.35)',
            position: { x: 0, y: 30, z: 0 },
        },
    },
    perElement: {},
};

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let state = null;

/**
 * Map de labels por elemento:
 * elementId -> { name: CSS2DObject|null, obs: CSS2DObject|null, geo: CSS2DObject[] }
 */
const labelMap = new Map();

/** Label do titulo do modelo (nao pertence a nenhum elemento) */
let titleLabel = null;

/** Debounce timer para syncLabels */
let _syncTimer = null;

// ----------------------------------------------------------------
// INIT
// ----------------------------------------------------------------

/**
 * Inicializa o label manager: restaura config do localStorage
 * e registra listeners de eventos do element manager.
 */
export function initLabels() {
    // Restaura config — com versionamento para forcar reset ao mudar defaults
    let useDefaults = true;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Se versao antiga ou ausente, descarta e usa defaults
            if (parsed._version === SETTINGS_VERSION) {
                state = _mergeDefaults(parsed, DEFAULTS);
                useDefaults = false;
            }
        } catch {
            /* noop */
        }
    }
    if (useDefaults) {
        state = _cloneDeep(DEFAULTS);
        _persist(); // Salva com versao atual
    }

    // Escuta eventos do element manager (loose-coupled)
    window.addEventListener('ecbt:elementAdded', (e) => onElementAdded(e.detail.id));
    window.addEventListener('ecbt:elementRemoved', (e) => onElementRemoved(e.detail.id));
    window.addEventListener('ecbt:elementUpdated', (e) => onElementUpdated(e.detail.id));
    window.addEventListener('ecbt:elementsCleared', () => clearAllLabels());

    // Reconstroi labels quando idioma muda (traduz nomes de familias)
    window.addEventListener('languageChanged', () => _debouncedSync());

    // Cria labels para elementos ja existentes (import, random model)
    syncLabels();
}

// ----------------------------------------------------------------
// CONFIG API
// ----------------------------------------------------------------

/**
 * Retorna deep clone do estado de configuracao.
 * @returns {Object}
 */
export function getLabelConfig() {
    return _cloneDeep(state);
}

/**
 * Verifica se labels estao habilitadas globalmente.
 * @returns {boolean}
 */
export function isLabelsEnabled() {
    return state?.enabled ?? true;
}

/**
 * Toggle global de labels.
 * @param {boolean} [enabled] - Se omitido, inverte o estado atual
 */
export function setLabelsEnabled(enabled) {
    if (enabled === undefined) enabled = !state.enabled;
    state.enabled = enabled;
    _persist();
    _debouncedSync();
}

/**
 * Toggle de uma categoria de labels.
 * @param {string} category - 'elementNames'|'observations'|'geology'|'modelTitle'
 * @param {boolean} [enabled]
 */
export function setLabelCategoryEnabled(category, enabled) {
    const cat = state.categories[category];
    if (!cat) return;
    if (enabled === undefined) enabled = !cat.enabled;
    cat.enabled = enabled;
    _persist();
    _debouncedSync();
}

/**
 * Altera um setting de uma categoria.
 * @param {string} category
 * @param {string} key
 * @param {*} value
 */
export function setLabelCategorySetting(category, key, value) {
    const cat = state.categories[category];
    if (!cat) return;
    cat[key] = value;
    _persist();
    _debouncedSync();
}

/**
 * Define override de label para um elemento especifico.
 * @param {string} elementId
 * @param {Object} overrides - { nameLabel: bool, obsLabel: bool }
 */
export function setPerElementLabel(elementId, overrides) {
    if (!state.perElement[elementId]) state.perElement[elementId] = {};
    Object.assign(state.perElement[elementId], overrides);
    _persist();
    _rebuildElementLabels(elementId);
}

/**
 * Retorna per-element overrides.
 * @param {string} elementId
 * @returns {Object|null}
 */
export function getPerElementLabel(elementId) {
    return state.perElement[elementId] || null;
}

/**
 * Reseta config para defaults.
 */
export function resetLabelSettings() {
    state = _cloneDeep(DEFAULTS);
    _persist();
    syncLabels();
}

// ----------------------------------------------------------------
// LABEL CREATION
// ----------------------------------------------------------------

/**
 * Resolve o texto do label de nome para um elemento.
 * Cadeia de prioridade:
 *   1. labels[idioma atual] — override customizado por idioma
 *   2. autoLabel — traduz dinamicamente via getFamilyName()
 *   3. labels fallback (en, depois primeiro disponivel)
 *   4. element.label || element.name || element.id
 *
 * @param {Object} element
 * @returns {string}
 */
function _resolveNameLabelText(element) {
    // 1. Override customizado para o idioma atual
    if (element.labels) {
        const lang = _getCurrentLang();
        if (element.labels[lang]) return element.labels[lang];
    }
    // 2. Auto-traducao pela familia
    if (element.autoLabel) {
        const family = getFamily(element.family);
        if (family) {
            const match = element.id.match(/-(\d+)$/);
            const counter = match ? match[1] : null;
            const familyName = getFamilyName(family);
            return counter ? `${familyName} ${counter}` : familyName;
        }
    }
    // 3. Fallback para outro idioma no mapa
    if (element.labels) {
        const fallback = element.labels.en || Object.values(element.labels)[0];
        if (fallback) return fallback;
    }
    // 4. Valor salvo
    return element.label || element.name || element.id;
}

/**
 * Cria label de nome para um elemento.
 * Posiciona acima do bounding box do mesh, com offset por familia.
 */
function _createNameLabel(element, mesh) {
    const config = state.categories.elementNames;
    if (!config.enabled) return null;

    // Pula familias que nao devem ter label (intangibles tem HUD)
    if (SKIP_FAMILIES.has(element.family)) return null;

    // Per-element override
    const perEl = state.perElement[element.id];
    if (perEl?.nameLabel === false) return null;

    const text = _resolveNameLabelText(element);
    const div = _createLabelDiv(text, 'label-3d-name', config, element);

    const labelObj = new CSS2DObject(div);
    // Ancora: centro horizontal, base inferior (label "pendura" acima do ponto)
    labelObj.center.set(0.5, 1);

    // Offset por familia — posiciona acima do topo do mesh
    const familyOffset = FAMILY_OFFSETS[element.family] || FAMILY_OFFSETS._default;
    const topY = _getMeshTopY(mesh);
    const localPos = _toMeshLocalOffset(mesh, familyOffset.x, topY + familyOffset.y, familyOffset.z);
    labelObj.position.set(localPos.x, localPos.y, localPos.z);

    mesh.add(labelObj);
    return labelObj;
}

/**
 * Cria label de observacao (ultimo valor medido).
 */
function _createObsLabel(element, mesh) {
    const config = state.categories.observations;
    if (!config.enabled) return null;

    // Pula familias sem label
    if (SKIP_FAMILIES.has(element.family)) return null;

    // Per-element override
    const perEl = state.perElement[element.id];
    if (perEl?.obsLabel === false) return null;

    const obs = element.data?.observations;
    if (!obs || obs.length === 0) return null;

    // Ultima observacao (mais recente por data)
    const latest = obs.reduce((a, b) => ((a.date || '') > (b.date || '') ? a : b));
    const text = _formatObservation(latest, config);
    if (!text) return null;

    const div = _createLabelDiv(text, 'label-3d-obs', config, element);

    const labelObj = new CSS2DObject(div);
    // Ancora: centro horizontal, topo superior (label fica logo abaixo do ponto)
    labelObj.center.set(0.5, 0);

    // Posiciona no mesmo ponto Y do nome — a ancora faz cair abaixo
    const familyOffset = FAMILY_OFFSETS[element.family] || FAMILY_OFFSETS._default;
    const topY = _getMeshTopY(mesh);
    const localPos = _toMeshLocalOffset(mesh, familyOffset.x, topY + familyOffset.y, familyOffset.z);
    labelObj.position.set(localPos.x, localPos.y, localPos.z);

    mesh.add(labelObj);
    return labelObj;
}

/**
 * Cria labels de camadas geologicas para pocos (wells).
 * Retorna array de CSS2DObjects.
 */
function _createGeoLabels(element, mesh) {
    if (element.family !== 'well') return [];
    const config = state.categories.geology;
    if (!config.enabled) return [];

    // Suporta formato novo (profile.lithologic) e legado (lithology)
    const lithologic = element.data?.profile?.lithologic || element.data?.lithology;
    if (!lithologic || lithologic.length === 0) return [];

    return lithologic.map((layer) => {
        const midY = -(layer.from + layer.to) / 2; // Profundidade -> Y negativo
        const text = layer.description || layer.soilType || '?';

        const div = _createLabelDiv(text, 'label-3d-geo', config, element);

        // Cor da borda esquerda = cor da camada
        if (layer.color) {
            div.style.borderLeftColor = layer.color;
        }

        const labelObj = new CSS2DObject(div);
        // Ancora: esquerda, centro vertical (label ao lado do shaft)
        labelObj.center.set(0, 0.5);
        const localPos = _toMeshLocalOffset(mesh, config.offset.x, midY + (config.offset.y || 0), config.offset.z || 0);
        labelObj.position.set(localPos.x, localPos.y, localPos.z);

        mesh.add(labelObj);
        return labelObj;
    });
}

/**
 * Cria ou atualiza a label de titulo do modelo.
 */
function _createModelTitle() {
    const config = state.categories.modelTitle;
    if (!config.enabled) return null;

    const projectName = document.getElementById('project-name')?.value || '';
    const text = config.text || projectName || '';
    if (!text) return null;

    const div = _createLabelDiv(text, 'label-3d-title', config);

    const labelObj = new CSS2DObject(div);
    const pos = config.position;
    labelObj.position.set(pos.x, pos.y, pos.z);

    const scene = getScene();
    if (scene) scene.add(labelObj);
    return labelObj;
}

// ----------------------------------------------------------------
// SYNC — (re)constroi todas as labels
// ----------------------------------------------------------------

/**
 * Reconstroi todas as labels a partir do estado atual.
 * Chamado no init e quando config muda.
 */
export function syncLabels() {
    // Remove todas as labels existentes
    _disposeAllLabels();

    if (!state?.enabled) return;

    // Labels por elemento
    const elements = getAllElements();
    for (const element of elements) {
        _buildElementLabels(element);
    }

    // Titulo do modelo
    titleLabel = _createModelTitle();

    requestRender();
}

/**
 * Cria labels para um unico elemento.
 */
function _buildElementLabels(element) {
    const mesh = getMeshByElementId(element.id);
    if (!mesh) return;

    const entry = {
        name: _createNameLabel(element, mesh),
        obs: _createObsLabel(element, mesh),
        geo: _createGeoLabels(element, mesh),
    };

    labelMap.set(element.id, entry);
}

/**
 * Reconstroi labels de um elemento especifico.
 */
function _rebuildElementLabels(elementId) {
    _disposeElementLabels(elementId);

    if (!state?.enabled) return;

    const element = getElementById(elementId);
    if (!element) return;

    _buildElementLabels(element);
    requestRender();
}

// ----------------------------------------------------------------
// EVENT HANDLERS — chamados por eventos do element manager
// ----------------------------------------------------------------

function onElementAdded(id) {
    if (!state?.enabled) return;
    const element = getElementById(id);
    if (!element) return;
    _buildElementLabels(element);
    requestRender();
}

function onElementRemoved(id) {
    _disposeElementLabels(id);
    requestRender();
}

function onElementUpdated(id) {
    _rebuildElementLabels(id);
}

/**
 * Remove todas as labels (chamado em clearAllElements).
 */
export function clearAllLabels() {
    _disposeAllLabels();
    requestRender();
}

// ----------------------------------------------------------------
// LEADER LINE DATA — dados para o renderer desenhar curvas
// ----------------------------------------------------------------

/**
 * Retorna dados de cada label visivel para decluttering e leader lines.
 * Inclui name, obs, e geo labels. Leader lines conectam apenas ao name.
 *
 * @returns {Array<{elementId: string, worldPos: THREE.Vector3, labelDiv: HTMLElement, extraDivs: HTMLElement[]}>}
 */
export function getVisibleLabelData() {
    const result = [];
    const _vec = new THREE.Vector3();

    for (const [elementId, entry] of labelMap) {
        if (!entry.name) continue;

        // Obtem posicao world do mesh do elemento (ponto de ancora da leader line)
        const mesh = getMeshByElementId(elementId);
        if (!mesh) continue;

        mesh.getWorldPosition(_vec);
        // Ajusta Y para o topo do mesh
        const topY = _getMeshTopY(mesh);
        const worldPos = new THREE.Vector3(_vec.x, _vec.y + topY, _vec.z);

        // Divs extras (obs, geo) que devem herdar a opacidade do name
        const extraDivs = [];
        if (entry.obs) extraDivs.push(entry.obs.element);
        if (entry.geo) entry.geo.forEach((g) => extraDivs.push(g.element));

        const el = getElementById(elementId);
        result.push({
            elementId,
            familyId: el?.family || 'unknown',
            worldPos,
            labelDiv: entry.name.element,
            extraDivs,
        });
    }

    return result;
}

// ----------------------------------------------------------------
// DISPOSAL
// ----------------------------------------------------------------

function _disposeElementLabels(elementId) {
    const entry = labelMap.get(elementId);
    if (!entry) return;

    if (entry.name) _disposeCss2dObject(entry.name);
    if (entry.obs) _disposeCss2dObject(entry.obs);
    if (entry.geo) entry.geo.forEach((g) => _disposeCss2dObject(g));

    labelMap.delete(elementId);
}

function _disposeAllLabels() {
    for (const [id] of labelMap) {
        _disposeElementLabels(id);
    }
    labelMap.clear();

    if (titleLabel) {
        _disposeCss2dObject(titleLabel);
        titleLabel = null;
    }
}

function _disposeCss2dObject(obj) {
    if (!obj) return;
    if (obj.element && obj.element.parentNode) {
        obj.element.remove();
    }
    if (obj.parent) {
        obj.parent.remove(obj);
    }
}

// ----------------------------------------------------------------
// EXPORT / IMPORT — para serializacao ECO1
// ----------------------------------------------------------------

/**
 * Exporta config de labels para inclusao no modelo.
 * @returns {Object}
 */
export function exportLabels() {
    return _cloneDeep(state);
}

/**
 * Importa config de labels de um modelo.
 * @param {Object} data
 */
export function importLabels(data) {
    if (!data) return;
    state = _mergeDefaults(data, DEFAULTS);
    _persist();
    syncLabels();
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

/**
 * Cria div estilizada para label.
 */
function _createLabelDiv(text, cssClass, config, element) {
    const div = document.createElement('div');
    div.className = `label-3d ${cssClass}`;
    div.textContent = text;

    // Aplica estilos de config
    if (config.fontSize) div.style.fontSize = config.fontSize + 'px';
    if (config.fontFamily) div.style.fontFamily = config.fontFamily;
    if (config.background) div.style.background = config.background;

    // Cor: 'auto' = derivar da cor do elemento
    if (config.color === 'auto' && element?.color) {
        const hex =
            typeof element.color === 'number'
                ? '#' + (element.color & 0xffffff).toString(16).padStart(6, '0')
                : element.color;
        div.style.color = hex;
    } else if (config.color && config.color !== 'auto') {
        div.style.color = config.color;
    }

    return div;
}

/**
 * Calcula o Y do topo do mesh (bounding box).
 * Para meshes sem geometria (sprites), retorna 0.
 */
function _getMeshTopY(mesh) {
    try {
        const box = new THREE.Box3().setFromObject(mesh);
        if (box.isEmpty()) return 0;
        // Retorna em coordenadas locais do mesh
        return box.max.y - mesh.position.y;
    } catch {
        return 0;
    }
}

/**
 * Retorna escala segura por eixo (fallback 1 para zero/NaN).
 */
function _safeScaleAxis(mesh, axis) {
    const raw = Number(mesh?.scale?.[axis]);
    if (!Number.isFinite(raw) || Math.abs(raw) < 1e-6) return 1;
    return raw;
}

/**
 * Converte offsets em unidades visuais para coordenadas locais do mesh,
 * compensando a escala do parent para evitar dupla escala em labels CSS2D.
 */
function _toMeshLocalOffset(mesh, x, y, z) {
    const sx = _safeScaleAxis(mesh, 'x');
    const sy = _safeScaleAxis(mesh, 'y');
    const sz = _safeScaleAxis(mesh, 'z');
    return {
        x: x / sx,
        y: y / sy,
        z: z / sz,
    };
}

/**
 * Formata observacao para texto da label.
 */
function _formatObservation(obs, config) {
    let text = '';
    const val = obs.reading ?? obs.value;
    if (val !== undefined && val !== null) {
        text += typeof val === 'number' ? val.toFixed(3) : String(val);
    } else {
        return '';
    }

    if (config.showUnit) {
        const unit = obs.unit || obs.unitId;
        if (unit) text += ' ' + unit;
    }

    if (config.showDate && obs.date) {
        text += ' (' + obs.date + ')';
    }

    return text;
}

/** Deep clone simples (JSON-safe) */
function _cloneDeep(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Merge valores salvos sobre defaults (preserva keys novos do default).
 */
function _mergeDefaults(saved, defaults) {
    const result = _cloneDeep(defaults);
    if (!saved || typeof saved !== 'object') return result;

    for (const key of Object.keys(result)) {
        if (!(key in saved)) continue;
        if (typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])) {
            result[key] = _mergeDefaults(saved[key], result[key]);
        } else {
            result[key] = saved[key];
        }
    }
    return result;
}

/** Persiste config no localStorage */
function _persist() {
    try {
        const data = { ...state, _version: SETTINGS_VERSION };
        safeSetItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('[Labels] Failed to persist settings:', e.message);
    }
}

/** Debounced sync — evita thrashing em sliders */
function _debouncedSync() {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => syncLabels(), 100);
}
