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
   INTERPOLATION MANAGER — Estado, CRUD e orquestração
   ================================================================

   Gerencia layers de interpolação: terreno, nível d'água, geologia,
   contaminação. Orquestra fetcher → engine/worker → surfaceBuilder.

   PADRÃO:
   - Estado em closure (Map de layers)
   - Persistência via localStorage + model export/import
   - CustomEvent 'interpolationChanged' para UI reativa
   - setInterpolationUpdateAllUI() para injeção de dependência

   ================================================================ */

import { generateId } from '../../utils/helpers/id.js';
import { t } from '../../utils/i18n/translations.js';
import * as THREE from 'three';
import {
    fetchTerrainGrid,
    fetchPointElevations,
    toRelativeElevation,
    resampleGrid,
    buildSatelliteUrls,
} from './fetcher.js';
import { interpolateGrid } from './engine.js';
import { buildContoursFromGrid } from './contours.js';
import {
    buildSurfaceMesh,
    updateSurfaceElevations,
    disposeSurface,
    setSurfaceWireframe,
    setSurfaceOpacity,
    applySatelliteTexture,
    toggleSurfaceTexture,
} from './surfaceBuilder.js';
import { DEFAULT_RAMPS, GEOLOGY_SOIL_COLORS } from './colorRamps.js';
import { requestRender, getElementsGroup } from '../../utils/scene/setup.js';
import { getAllElements, getMeshByElementId } from '../elements/manager.js';
import { hasOrigin, getOrigin, setOrigin } from '../io/geo/coordinates.js';
import { showToast } from '../../utils/ui/toast.js';
import { isEphemeral } from '../../utils/storage/storageMonitor.js';
import { idbSet, idbGetWithLegacy } from '../../utils/storage/idbStore.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

/** @type {Map<string, Object>} */
const _layers = new Map();

/** @type {THREE.Group|null} grupo na cena para superfícies */
let _interpolationGroup = null;

/** @type {Worker|null} */
const _worker = null;

/** @type {Function|null} */
let _updateAllUI = null;

/** @type {Map<string, {resolve, reject}>} */
const _pendingWorker = new Map();

const STORAGE_KEY = 'ecbyts-interpolation';

/** @type {string|null} layer atualmente selecionada */
let _selectedLayerId = null;

// ----------------------------------------------------------------
// GRID SIZES disponíveis para o usuário
// ----------------------------------------------------------------

export const GRID_SIZES = [
    { label: '32×32', cols: 32, rows: 32 },
    { label: '64×64', cols: 64, rows: 64 },
    { label: '128×128', cols: 128, rows: 128 },
    { label: '256×256', cols: 256, rows: 256 },
];

const DEFAULT_GRID = { cols: 64, rows: 64 };
const CONTOUR_Z_OFFSET = 0.06;
const CONTOUR_LABEL_Z_OFFSET = 0.18;
const CONTOUR_DENSITY_LEVELS = { low: 6, medium: 10, high: 14 };
const MAX_CONTOUR_LABELS = 80;
const CONTOUR_FEATURE_FLAGS = Object.freeze({
    water_table: true,
    terrain: true,
    contamination: true,
    geology: false,
    custom: false,
});

// ----------------------------------------------------------------
// INICIALIZAÇÃO
// ----------------------------------------------------------------

/**
 * Inicializa o módulo de interpolação.
 * Cria o grupo na cena e restaura layers do localStorage.
 */
export async function initInterpolation() {
    // O grupo Three.js é injetado externamente via setInterpolationGroup()
    // antes desta chamada (em main.js: setInterpolationGroup(getInterpolationGroup()))
    await _restoreFromStorage();
}

/**
 * Injeta o grupo Three.js (chamado por setup.js).
 * @param {THREE.Group} group
 */
export function setInterpolationGroup(group) {
    _interpolationGroup = group;
}

/**
 * Injeta updateAllUI (chamado por handlers/index.js).
 * @param {Function} fn
 */
export function setInterpolationUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ----------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------

/**
 * Adiciona uma layer de interpolação.
 * @param {Object} config - configuração parcial da layer
 * @returns {Object} layer criada
 */
export function addLayer(config) {
    const layer = {
        id: config.id || generateId(config.type || 'layer'),
        type: config.type || 'custom',
        name: config.name || 'Nova Camada',
        method: config.method || 'idw',
        methodParams: config.methodParams || { power: 2 },
        dataSource: config.dataSource || 'auto',
        parameterId: config.parameterId || null,
        matrix: config.matrix || null,
        campaignId: config.campaignId || null,
        geologyContact: config.geologyContact || null,
        points: config.points || [],
        grid: null,
        gridSize: config.gridSize || { ...DEFAULT_GRID },
        bounds: config.bounds || null,
        colorRamp: config.colorRamp || DEFAULT_RAMPS[config.type] || 'generic',
        opacity: config.opacity ?? 0.85,
        visible: config.visible ?? true,
        wireframe: config.wireframe ?? false,
        showContours: config.showContours ?? _defaultShowContoursForType(config.type),
        showContourLabels: config.showContourLabels ?? _defaultShowContourLabelsForType(config.type),
        contourDensity: config.contourDensity || 'medium',
        contourObjectIds: Array.isArray(config.contourObjectIds) ? [...config.contourObjectIds] : [],
        contourLabelObjectIds: Array.isArray(config.contourLabelObjectIds) ? [...config.contourLabelObjectIds] : [],
        fixedColor: config.fixedColor || null,
        meshId: null,
        stats: null,
    };

    // Migration: geology layers de modelos antigos (sem fixedColor) derivam cor do soilType
    if (!layer.fixedColor && layer.type === 'geology' && layer.parameterId) {
        layer.fixedColor = GEOLOGY_SOIL_COLORS[layer.parameterId] || '#888888';
    }

    _layers.set(layer.id, layer);
    _persist();
    _notify();
    return layer;
}

/**
 * Remove uma layer.
 * @param {string} id
 */
export function removeLayer(id) {
    const layer = _layers.get(id);
    if (!layer) return;
    _clearLayerContours(layer);

    // Remove mesh da cena
    if (layer.meshId && _interpolationGroup) {
        const mesh = _interpolationGroup.getObjectByProperty('uuid', layer.meshId);
        if (mesh) disposeSurface(mesh);
    }

    // Restaura overlay da boundary se terreno com satélite foi removido
    if (layer.type === 'terrain' && layer.textureMode === 'satellite') {
        _setBoundaryOverlayVisible(true);
    }

    _layers.delete(id);
    _persist();
    _notify();
    requestRender();
}

/**
 * Remove all interpolation layers.
 * Limpa todas as superficies (terreno, water table, etc.).
 */
export function clearAllLayers() {
    const ids = [..._layers.keys()];
    ids.forEach((id) => removeLayer(id));
    _selectedLayerId = null;
}

/**
 * Atualiza propriedades de uma layer.
 * @param {string} id
 * @param {Object} changes
 */
export function updateLayer(id, changes) {
    const layer = _layers.get(id);
    if (!layer) return;
    Object.assign(layer, changes);

    // Aplica mudanças visuais imediatas
    const mesh = _getMesh(layer);
    if (mesh) {
        if ('opacity' in changes) setSurfaceOpacity(mesh, layer.opacity);
        if ('wireframe' in changes) setSurfaceWireframe(mesh, layer.wireframe);
        if ('visible' in changes) mesh.visible = layer.visible;
        if ('textureMode' in changes) {
            toggleSurfaceTexture(mesh, layer.textureMode === 'satellite');
            _setBoundaryOverlayVisible(layer.textureMode !== 'satellite');
        }
    }
    _applyContourVisibility(layer);
    if (('showContours' in changes || 'showContourLabels' in changes || 'contourDensity' in changes) && layer.grid) {
        _rebuildLayerContours(layer);
    }

    _persist();
    _notify();
    requestRender();
}

/**
 * Retorna layer por ID.
 * @param {string} id
 * @returns {Object|undefined}
 */
export function getLayer(id) {
    return _layers.get(id);
}

/**
 * Retorna todas as layers.
 * @returns {Object[]}
 */
export function getAllLayers() {
    return Array.from(_layers.values());
}

/**
 * Retorna a mesh 3D de uma layer.
 * @param {string} id
 * @returns {THREE.Mesh|null}
 */
export function getLayerMesh(id) {
    const layer = _layers.get(id);
    return layer ? _getMesh(layer) : null;
}

/**
 * Retorna o grupo Three.js das superfícies de interpolação.
 * @returns {THREE.Group|null}
 */
export function getInterpolationGroup() {
    return _interpolationGroup;
}

/**
 * Retorna o ID da layer selecionada.
 * @returns {string|null}
 */
export function getSelectedLayer() {
    return _selectedLayerId;
}

/**
 * Define a layer selecionada.
 * @param {string|null} id
 */
export function setSelectedLayer(id) {
    _selectedLayerId = id;
}

// ----------------------------------------------------------------
// ATALHOS — Criação de layers por tipo
// ----------------------------------------------------------------

/**
 * Cria camada de superfície topográfica.
 * Busca elevação do AWS Terrain Tiles e constrói mesh.
 *
 * @param {Object} [opts]
 * @param {{ cols: number, rows: number }} [opts.gridSize]
 * @returns {Promise<Object>} layer criada
 */
export async function createTerrainLayer(opts = {}) {
    // Guard: ensure interpolation group is available
    if (!_interpolationGroup) {
        showToast('Interpolation system not ready. Please try again.', 'warning');
        throw new Error('Interpolation group not available');
    }

    // Obtém bounds da boundary
    const bounds = _getBoundaryBounds();
    if (!bounds) {
        showToast(t('interpolation.noBoundaryFound'), 'warning');
        throw new Error('No boundary found');
    }

    if (!hasOrigin()) {
        showToast(t('interpolation.geoOriginNotConfigured'), 'warning');
        throw new Error('No origin set');
    }

    const gridSize = opts.gridSize || { ...DEFAULT_GRID };

    const layer = addLayer({
        type: 'terrain',
        name: t('interpolation.topoSurfaceName'),
        method: 'idw',
        dataSource: 'auto',
        gridSize,
        bounds,
        colorRamp: 'terrain',
    });

    try {
        await _recomputeTerrainLayer(layer);
        showToast(t('interpolation.topoSurfaceCreated'), 'success');
        return layer;
    } catch (err) {
        removeLayer(layer.id);
        console.error('[Interpolation] Terrain fetch failed:', err);
        showToast(t('interpolation.terrainError', { message: err.message }), 'error');
        throw err;
    }
}

/**
 * Busca tiles, decodifica elevação, constrói mesh e textura para uma layer de terreno.
 * Reutilizado tanto na criação quanto na restauração de layers persistidas.
 * @param {Object} layer - layer já adicionada via addLayer()
 */
async function _recomputeTerrainLayer(layer) {
    console.log('[Terrain] Recomputing layer:', layer.id, 'type:', layer.type, 'hasGrid:', !!layer.grid);

    // Guard: ensure interpolation group is available
    if (!_interpolationGroup) {
        console.warn('[Terrain] Cannot recompute: interpolation group not available. Skipping.');
        return;
    }

    const bounds = layer.bounds || _getBoundaryBounds();
    if (!bounds) throw new Error('No boundary found');
    if (!hasOrigin()) throw new Error('No origin set');

    layer.bounds = bounds;
    const gridSize = layer.gridSize || { ...DEFAULT_GRID };

    showToast(t('interpolation.fetchingElevation'), 'info');

    // Fetch terrain tile
    const tileData = await fetchTerrainGrid(bounds);

    // Reamostra para a resolução do grid
    const rawGrid = resampleGrid(tileData.heights, tileData.tileBounds, bounds, gridSize);

    // Auto-calibra elevação da origem a partir do terreno real
    // Sempre aplica na criação de terreno — garante que origin.elevation
    // reflita a elevação real do site, mesmo que o random model tenha definido um valor fictício
    const centerIdx = Math.floor(rawGrid.length / 2);
    const centerElev = rawGrid[centerIdx];
    if (Number.isFinite(centerElev) && Math.abs(centerElev) > 1) {
        setOrigin({ elevation: centerElev });
        const elevEl = document.getElementById('utm-origin-elevation');
        if (elevEl) elevEl.value = centerElev.toFixed(1);
        console.log('[Terrain] Auto-calibrated origin elevation:', centerElev.toFixed(1), 'm');
    }

    // Converte para elevação relativa (subtrai origin.elevation)
    const grid = toRelativeElevation(rawGrid);

    // Estatísticas
    let min = Infinity,
        max = -Infinity,
        sum = 0;
    for (let i = 0; i < grid.length; i++) {
        if (grid[i] < min) min = grid[i];
        if (grid[i] > max) max = grid[i];
        sum += grid[i];
    }
    const stats = { min, max, mean: sum / grid.length };

    // Remove mesh anterior se existir (restore após reload)
    const oldMesh = _getMesh(layer);
    if (oldMesh) disposeSurface(oldMesh);

    // Constrói mesh
    const mesh = buildSurfaceMesh(grid, bounds, gridSize, 'terrain', stats, {
        opacity: layer.opacity,
        wireframe: layer.wireframe,
    });
    console.log('[Terrain] Mesh created:', mesh.uuid, 'at', mesh.position, 'visible:', layer.visible);

    if (_interpolationGroup) {
        _interpolationGroup.add(mesh);
        console.log('[Terrain] Mesh added to scene, group children:', _interpolationGroup.children.length);
    } else {
        console.warn('[Terrain] No interpolation group available!');
    }

    // Aplica textura de satélite
    const satUrls = await buildSatelliteUrls(tileData.zoom, tileData.tileX, tileData.tileY, bounds);
    applySatelliteTexture(mesh, satUrls);
    layer.satelliteUrls = satUrls;
    layer.textureMode = 'satellite';

    // Oculta overlay plano da boundary apenas se mesh foi criado com sucesso
    if (layer.meshId && _interpolationGroup?.getObjectByProperty('uuid', layer.meshId)) {
        _setBoundaryOverlayVisible(false);
    }

    // Atualiza layer
    layer.grid = grid;
    layer.stats = stats;
    layer.meshId = mesh.uuid;
    mesh.userData.layerId = layer.id;
    console.log('[Terrain] Layer updated:', layer.id, 'stats:', stats, 'meshId:', mesh.uuid);
    _persist();
    _notify();
    requestRender();
    console.log('[Terrain] Render requested');
}

/**
 * Cria camada de nível d'água a partir de observações dos poços.
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
export async function createWaterTableLayer(opts = {}) {
    const bounds = _getBoundaryBounds();
    if (!bounds) {
        showToast(t('interpolation.noBoundary'), 'warning');
        throw new Error('No boundary found');
    }

    // Coleta poços com water_level observations
    const points = _collectObservationPoints('water_level');
    if (points.length < 2) {
        showToast(t('interpolation.minWellsRequired'), 'warning');
        throw new Error('Insufficient water level data');
    }

    const gridSize = opts.gridSize || { ...DEFAULT_GRID };
    const method = opts.method || 'idw';

    const layer = addLayer({
        type: 'water_table',
        name: t('interpolation.waterLevelName'),
        method,
        dataSource: 'observations',
        parameterId: 'water_level',
        gridSize,
        bounds,
        points,
        colorRamp: 'water_table',
        showContours: opts.showContours ?? true,
        showContourLabels: opts.showContourLabels ?? true,
        contourDensity: opts.contourDensity || 'medium',
    });

    await recomputeLayer(layer.id);
    return layer;
}

/**
 * Cria camada de contaminação para um parâmetro específico.
 * @param {string} parameterId - ex: 'benzene', 'toluene'
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
export async function createContaminationLayer(parameterIdOrOpts, opts = {}) {
    let parameterId = parameterIdOrOpts;
    let resolvedOpts = opts;

    // Compatibilidade temporaria: assinatura legada createContaminationLayer({ parameterId, ... })
    if (parameterIdOrOpts && typeof parameterIdOrOpts === 'object' && !Array.isArray(parameterIdOrOpts)) {
        parameterId = parameterIdOrOpts.parameterId;
        resolvedOpts = { ...parameterIdOrOpts, ...opts };
        console.warn(
            '[Interpolation] createContaminationLayer({ ... }) is deprecated; use createContaminationLayer(parameterId, opts).',
        );
    }

    if (!parameterId || typeof parameterId !== 'string') {
        throw new Error('Missing parameterId for contamination layer');
    }
    const bounds = _getBoundaryBounds();
    if (!bounds) {
        showToast(t('interpolation.noBoundary'), 'warning');
        throw new Error('No boundary found');
    }

    const matrixFilter = resolvedOpts?.matrix || null;
    const manualPoints = _normalizeManualPoints(resolvedOpts?.dataPoints);
    const points =
        manualPoints.length >= 2
            ? manualPoints
            : _collectObservationPoints(parameterId, {
                  campaignId: resolvedOpts?.campaignId || null,
                  matrix: matrixFilter,
              });
    if (points.length < 2) {
        showToast(t('interpolation.minPointsRequired', { parameterId }), 'warning');
        throw new Error('Insufficient observation data');
    }

    const gridSize = _normalizeGridSize(resolvedOpts?.gridSize);
    const method = resolvedOpts?.method || 'idw';

    const layer = addLayer({
        type: 'contamination',
        name: t('interpolation.interpolationName', { parameterId }),
        method,
        dataSource: manualPoints.length >= 2 ? 'manual' : 'observations',
        parameterId,
        matrix: matrixFilter,
        gridSize,
        bounds,
        points,
        colorRamp: 'contamination',
    });

    await recomputeLayer(layer.id);
    return layer;
}

// ----------------------------------------------------------------
// GEOLOGY LAYERS — Superfícies geológicas de perfis litológicos
// ----------------------------------------------------------------

/**
 * Cria camada de superfície geológica a partir de contatos litológicos.
 * Interpola o topo ou base de uma camada de solo específica entre poços.
 *
 * @param {string} soilType - tipo de solo (clay, sand, rock, etc.)
 * @param {Object} [opts]
 * @param {'top'|'bottom'} [opts.contactType='top'] - topo ou base
 * @param {'idw'|'rbf'|'kriging'} [opts.method='idw']
 * @param {{ cols: number, rows: number }} [opts.gridSize]
 * @returns {Promise<Object>}
 */
export async function createGeologyLayer(soilType, opts = {}) {
    if (!soilType || typeof soilType !== 'string') {
        throw new Error('Missing soilType for geology layer');
    }

    const contactType = opts.contactType || 'top';
    const points = _collectGeologyContactPoints(soilType, contactType);

    if (points.length < 3) {
        const label = GEOLOGY_SOIL_LABELS[soilType] || soilType;
        showToast(
            t('interpolation.minWellsGeology', { soilType: label }) || `Minimo 3 pocos com "${label}" necessarios.`,
            'warning',
        );
        throw new Error(`Insufficient geology data: ${points.length} wells with ${soilType}`);
    }

    const bounds = _getBoundaryBounds() || _computeBoundsFromPoints(points, 0.1);
    const gridSize = _normalizeGridSize(opts.gridSize);
    const method = opts.method || 'idw';
    const contactLabel = contactType === 'top' ? 'Topo' : 'Base';
    const soilLabel = GEOLOGY_SOIL_LABELS[soilType] || soilType;

    const layer = addLayer({
        type: 'geology',
        name: `Geologia: ${contactLabel} de ${soilLabel}`,
        method,
        dataSource: 'geology_profile',
        parameterId: soilType,
        geologyContact: contactType,
        gridSize,
        bounds,
        points,
        colorRamp: 'geology',
        fixedColor: GEOLOGY_SOIL_COLORS[soilType] || '#888888',
        showContours: false,
        opacity: 0.92,
        wireframe: false,
    });

    await recomputeLayer(layer.id);
    return layer;
}

// ----------------------------------------------------------------
// GeoML MAPS — Potentiometric + Plume from Campaign (Phase 1)
// ----------------------------------------------------------------

/**
 * Create a potentiometric map from water_level observations.
 * Uses Kriging by default (CONAMA/CETESB mandate).
 * Gap #5: water_level values are absolute MSL — no terrain subtraction.
 *
 * @param {Object} [opts]
 * @param {'idw'|'rbf'|'kriging'} [opts.method='kriging']
 * @param {{ cols: number, rows: number }} [opts.gridSize]
 * @param {string} [opts.campaignId] - Filter observations by campaign
 * @param {string} [opts.parameterId='water_level']
 * @returns {Promise<Object|null>} Layer or null if insufficient data
 */
export async function createPotentiometricMap(opts = {}) {
    const { method = 'kriging', gridSize = { cols: 64, rows: 64 }, campaignId, parameterId = 'water_level' } = opts;

    const points = _collectObservationPoints(parameterId, { campaignId });
    if (points.length < 3) {
        showToast('Minimo 3 pontos de observacao necessarios para mapa potenciometrico.', 'warning');
        return null;
    }

    const bounds = _computeBoundsFromPoints(points, 0.1);

    // CDN loading toast for RBF (kriging is now local, no CDN needed)
    let effectiveMethod = method;
    if (method === 'rbf') {
        showToast(`Carregando modulo de ${method}...`, 'info');
        try {
            const { importCDN } = await import('../../utils/helpers/cdnLoader.js');
            await importCDN('https://esm.sh/rbf@1.1.5', { name: 'RBF' });
        } catch (err) {
            console.warn(`[ecbyts] CDN timeout for ${method}, falling back to IDW`);
            showToast(`${method} indisponivel — usando IDW como fallback`, 'warning');
            effectiveMethod = 'idw';
        }
    }

    const layer = addLayer({
        type: 'potentiometric',
        name: 'Mapa Potenciometrico',
        method: effectiveMethod,
        dataSource: 'observations',
        parameterId,
        gridSize,
        bounds,
        points,
        colorRamp: 'potentiometric',
        showContours: true,
        showContourLabels: true,
        contourDensity: 'medium',
    });

    await recomputeLayer(layer.id);
    return layer;
}

/**
 * Create a contamination plume from campaign observations.
 * Generates 2D surface; 3D isosurface optional (if depth data + threshold).
 *
 * @param {Object} opts
 * @param {string} opts.parameterId - e.g., 'benzene'
 * @param {string} [opts.campaignId] - Filter by campaign
 * @param {number} [opts.thresholdValue] - Isosurface level (default: null = 2D only)
 * @param {'idw'|'rbf'|'kriging'} [opts.method='kriging']
 * @param {{ cols: number, rows: number }} [opts.gridSize]
 * @returns {Promise<{ layer: Object, plumeMesh: THREE.Mesh|null }|null>}
 */
export async function createPlumeFromCampaign(opts = {}) {
    const { parameterId, campaignId, thresholdValue, method = 'kriging', gridSize = { cols: 64, rows: 64 } } = opts;

    if (!parameterId) {
        showToast('Parametro de contaminacao nao especificado.', 'warning');
        return null;
    }

    const points = _collectObservationPoints(parameterId, { campaignId });
    if (points.length < 3) {
        showToast('Minimo 3 pontos com dados necessarios para pluma.', 'warning');
        return null;
    }

    const bounds = _computeBoundsFromPoints(points, 0.1);

    // CDN loading for RBF only (kriging is now local, no CDN needed)
    let effectiveMethod = method;
    if (method === 'rbf') {
        try {
            const { importCDN } = await import('../../utils/helpers/cdnLoader.js');
            await importCDN('https://esm.sh/rbf@1.1.5', { name: 'RBF' });
        } catch {
            effectiveMethod = 'idw';
            showToast(`${method} indisponivel — usando IDW`, 'warning');
        }
    }

    const layer = addLayer({
        type: 'contamination',
        name: `Pluma: ${parameterId}`,
        method: effectiveMethod,
        dataSource: 'observations',
        parameterId,
        gridSize,
        bounds,
        points,
        colorRamp: 'contamination',
        showContours: true,
        contourDensity: 'medium',
    });

    await recomputeLayer(layer.id);

    // TODO Phase 2: 3D isosurface generation if thresholdValue + depth data
    const plumeMesh = null;

    return { layer, plumeMesh };
}

/**
 * Compute bounds from observation points with padding.
 * @param {Array<{x: number, z: number}>} points
 * @param {number} padding - Fraction (0.10 = 10%)
 * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number }}
 */
function _computeBoundsFromPoints(points, padding = 0.1) {
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
    const dx = (maxX - minX) * padding || 1;
    const dz = (maxZ - minZ) * padding || 1;
    return { minX: minX - dx, maxX: maxX + dx, minZ: minZ - dz, maxZ: maxZ + dz };
}

// ----------------------------------------------------------------
// RECOMPUTE — Recalcula interpolação de uma layer
// ----------------------------------------------------------------

/**
 * Recalcula interpolação e reconstrói mesh.
 * @param {string} id - layer ID
 * @returns {Promise<void>}
 */
export async function recomputeLayer(id) {
    const layer = _layers.get(id);
    if (!layer) return;

    // Para layers baseadas em observações, recoleta os pontos
    if (layer.dataSource === 'observations' && layer.parameterId) {
        layer.points = _collectObservationPoints(layer.parameterId, {
            campaignId: layer.campaignId || null,
            matrix: layer.matrix || null,
        });
    }

    // Geology profile: recoleta contatos dos perfis litológicos
    if (layer.dataSource === 'geology_profile' && layer.parameterId) {
        layer.points = _collectGeologyContactPoints(layer.parameterId, layer.geologyContact || 'top');
    }

    if (!layer.points || layer.points.length < 2) {
        showToast(t('interpolation.insufficientData'), 'warning');
        return;
    }
    if (!layer.bounds) {
        layer.bounds = _getBoundaryBounds();
        if (!layer.bounds) return;
    }

    try {
        showToast(t('interpolation.interpolating'), 'info');

        // Interpola (inline — o worker pode ser usado para grids grandes)
        const result = await interpolateGrid(
            layer.points,
            layer.bounds,
            layer.gridSize,
            layer.method,
            layer.methodParams,
        );

        layer.grid = result.grid;
        layer.stats = result.stats;
        _clearLayerContours(layer);

        // Reconstrói mesh
        const oldMesh = _getMesh(layer);
        if (oldMesh) disposeSurface(oldMesh);

        // Offset vertical para geology layers evitar z-fighting com terreno
        const zOffset = layer.type === 'geology' ? 0.3 : 0;
        const mesh = buildSurfaceMesh(result.grid, layer.bounds, layer.gridSize, layer.colorRamp, result.stats, {
            opacity: layer.opacity,
            wireframe: layer.wireframe,
            zOffset,
            fixedColor: layer.fixedColor || null,
        });
        mesh.visible = layer.visible;

        if (_interpolationGroup) {
            _interpolationGroup.add(mesh);
        }

        layer.meshId = mesh.uuid;
        mesh.userData.layerId = layer.id;
        _rebuildLayerContours(layer);
        _persist();
        _notify();
        requestRender();

        showToast(t('interpolation.completed'), 'success');
    } catch (err) {
        console.error('[Interpolation] Recompute failed:', err);
        showToast(t('interpolation.error', { message: err.message }), 'error');
    }
}

// ----------------------------------------------------------------
// EXPORT / IMPORT
// ----------------------------------------------------------------

/**
 * Exporta layers para JSON (sem grid data — será recalculado).
 * @returns {Object[]}
 */
export function exportLayers() {
    return getAllLayers().map((l) => ({
        id: l.id,
        type: l.type,
        name: l.name,
        method: l.method,
        methodParams: l.methodParams,
        dataSource: l.dataSource,
        parameterId: l.parameterId,
        matrix: l.matrix || null,
        campaignId: l.campaignId || null,
        geologyContact: l.geologyContact || null,
        gridSize: l.gridSize,
        colorRamp: l.colorRamp,
        opacity: l.opacity,
        visible: l.visible,
        wireframe: l.wireframe,
        showContours: l.showContours ?? false,
        showContourLabels: l.showContourLabels ?? false,
        contourDensity: l.contourDensity || 'medium',
        fixedColor: l.fixedColor || null,
        textureMode: l.textureMode || null,
        satelliteUrls: l.satelliteUrls || null,
    }));
}

/**
 * Importa layers de JSON. Preserva terreno existente com mesh (evita re-fetch de tiles).
 * IMPORTANTE: createTerrainLayer chama addLayer internamente — nunca chamar addLayer antes dele.
 * @param {Object[]} layerConfigs
 */
export async function importLayers(layerConfigs) {
    if (!layerConfigs || !Array.isArray(layerConfigs)) return;

    // Dedup: manter apenas 1 config por tipo terrain (protecao contra IDB corrompido)
    const seen = new Set();
    const dedupConfigs = layerConfigs.filter((c) => {
        if (c.type === 'terrain') {
            if (seen.has('terrain')) return false;
            seen.add('terrain');
        }
        return true;
    });

    // Verificar se ja temos terrain com mesh renderizado ANTES de limpar
    const existingTerrainWithMesh = _findLayerByType('terrain', true);

    // Limpa todas as layers existentes (exceto terrain com mesh se import tem terrain)
    const importHasTerrain = dedupConfigs.some((c) => c.type === 'terrain');
    for (const [id, layer] of _layers) {
        if (importHasTerrain && layer.type === 'terrain' && layer.meshId) continue;
        removeLayer(id);
    }

    for (const config of dedupConfigs) {
        if (config.type === 'terrain') {
            if (existingTerrainWithMesh) {
                // Terreno ja renderizado — atualizar apenas props visuais
                if (config.opacity != null) existingTerrainWithMesh.opacity = config.opacity;
                if (config.visible != null) existingTerrainWithMesh.visible = config.visible;
                if (config.wireframe != null) existingTerrainWithMesh.wireframe = config.wireframe;
                if (config.colorRamp) existingTerrainWithMesh.colorRamp = config.colorRamp;
                continue;
            }
            // Nao existe terrain com mesh — criar (createTerrainLayer chama addLayer internamente)
            try {
                await createTerrainLayer({ gridSize: config.gridSize });
            } catch {
                /* skip — boundary/origin may not be available */
            }
            continue;
        }

        // Outros tipos: addLayer + recompute (createTerrainLayer nao e chamado aqui)
        addLayer(config);
        try {
            await recomputeLayer(config.id || [..._layers.keys()].pop());
        } catch {
            /* skip */
        }
    }
}

/**
 * Busca primeira layer de um tipo especifico.
 * @param {string} type
 * @param {boolean} [requireMesh=false] - se true, exige que tenha meshId
 * @returns {Object|null}
 */
function _findLayerByType(type, requireMesh = false) {
    for (const [, layer] of _layers) {
        if (layer.type === type && (!requireMesh || layer.meshId)) return layer;
    }
    return null;
}

// ----------------------------------------------------------------
// CONSULTA PONTUAL DE ELEVAÇÃO
// ----------------------------------------------------------------

/**
 * Amostra a elevação do terreno em uma posição (x, z) do cenário.
 * Interpola bilinearmente a partir do grid da terrain layer.
 * Retorna 0 se não houver terrain layer ou se o ponto estiver fora dos bounds.
 *
 * @param {number} x - posição X no cenário (Three.js)
 * @param {number} z - posição Z no cenário (Three.js)
 * @returns {number} elevação relativa em metros
 */
export function sampleTerrainElevation(x, z) {
    // Busca a primeira terrain layer com grid disponível
    const terrain = Array.from(_layers.values()).find((l) => l.type === 'terrain' && l.grid);
    if (!terrain || !terrain.bounds || !terrain.gridSize) return 0;

    const { minX, maxX, minZ, maxZ } = terrain.bounds;
    const { cols, rows } = terrain.gridSize;
    const grid = terrain.grid;

    // Ponto fora dos bounds → retorna 0
    if (x < minX || x > maxX || z < minZ || z > maxZ) return 0;

    // Converte posição para coordenadas contínuas do grid
    // Row 0 = minZ (norte), row last = maxZ (sul)
    const colF = ((x - minX) / (maxX - minX)) * (cols - 1);
    const rowF = ((z - minZ) / (maxZ - minZ)) * (rows - 1);

    // Indices e frações para interpolação bilinear
    const c0 = Math.floor(colF);
    const r0 = Math.floor(rowF);
    const c1 = Math.min(c0 + 1, cols - 1);
    const r1 = Math.min(r0 + 1, rows - 1);
    const fc = colF - c0;
    const fr = rowF - r0;

    // Quatro cantos
    const v00 = grid[r0 * cols + c0];
    const v10 = grid[r0 * cols + c1];
    const v01 = grid[r1 * cols + c0];
    const v11 = grid[r1 * cols + c1];

    // Interpolação bilinear
    return (1 - fc) * (1 - fr) * v00 + fc * (1 - fr) * v10 + (1 - fc) * fr * v01 + fc * fr * v11;
}

/**
 * Verifica se existe uma terrain layer com grid carregado.
 * @returns {boolean}
 */
export function hasTerrainGrid() {
    return Array.from(_layers.values()).some((l) => l.type === 'terrain' && l.grid);
}

/**
 * Sample any layer grid by type using bilinear interpolation.
 * Amostra qualquer layer pelo tipo — reutiliza mesma logica bilinear.
 *
 * @param {string} layerType - 'terrain' | 'water_table' | 'contamination'
 * @param {number} x - scene X position
 * @param {number} z - scene Z position
 * @returns {number} interpolated value (0 if unavailable)
 */
export function sampleLayerGrid(layerType, x, z) {
    const layer = Array.from(_layers.values()).find((l) => l.type === layerType && l.grid);
    if (!layer || !layer.bounds || !layer.gridSize) return 0;

    const { minX, maxX, minZ, maxZ } = layer.bounds;
    const { cols, rows } = layer.gridSize;
    const grid = layer.grid;

    if (x < minX || x > maxX || z < minZ || z > maxZ) return 0;

    const colF = ((x - minX) / (maxX - minX)) * (cols - 1);
    const rowF = ((z - minZ) / (maxZ - minZ)) * (rows - 1);

    const c0 = Math.floor(colF);
    const r0 = Math.floor(rowF);
    const c1 = Math.min(c0 + 1, cols - 1);
    const r1 = Math.min(r0 + 1, rows - 1);
    const fc = colF - c0;
    const fr = rowF - r0;

    const v00 = grid[r0 * cols + c0];
    const v10 = grid[r0 * cols + c1];
    const v01 = grid[r1 * cols + c0];
    const v11 = grid[r1 * cols + c1];

    return (1 - fc) * (1 - fr) * v00 + fc * (1 - fr) * v10 + (1 - fc) * fr * v01 + fc * fr * v11;
}

/**
 * Aplica elevação topográfica a todos os elementos do modelo.
 * Atualiza dados E meshes 3D para seguir o relevo do terreno.
 * Elementos subterrâneos (plume, well) mantêm offset relativo ao terreno.
 *
 * Deve ser chamado APÓS createTerrainLayer() quando terrainElevation=true.
 */
export function applyTerrainElevationToElements() {
    if (!hasTerrainGrid()) return;

    const elements = getAllElements();
    for (const el of elements) {
        const d = el.data;
        if (!d) continue;
        const mesh = getMeshByElementId(el.id);

        switch (el.family) {
            // --- Superfície: y = elevação do terreno ---
            case 'building':
            case 'spring':
            case 'marker':
            case 'sample':
            case 'waste_stream':
            case 'effluent_point':
            case 'sensor':
            case 'generic':
            case 'intangible':
                if (d.position) {
                    const elev = sampleTerrainElevation(d.position.x, d.position.z);
                    d.position.y = elev;
                    if (mesh) mesh.position.y = elev;
                }
                break;

            case 'emission_source':
                // Chaminés ficam acima da edificação, que já está no terreno
                if (d.position) {
                    const ground = sampleTerrainElevation(d.position.x, d.position.z);
                    const relativeH = d.position.y || 0;
                    d.position.y = ground + relativeH;
                    if (mesh) mesh.position.y = ground + relativeH;
                }
                break;

            case 'tank':
                if (d.position) {
                    const ground = sampleTerrainElevation(d.position.x, d.position.z);
                    const offset = d.type === 'underground' ? d.position.y || 0 : 0;
                    d.position.y = ground + offset;
                    if (mesh) mesh.position.y = ground + offset;
                }
                break;

            case 'well': {
                // Poços: cota da boca = terreno, mesh.y = elevation - depth/2
                if (d.coordinates) {
                    const ground = sampleTerrainElevation(d.coordinates.easting, d.coordinates.northing);
                    d.coordinates.elevation = ground;
                    if (mesh) {
                        const depth = d.construction?.totalDepth || 50;
                        mesh.position.y = ground - depth / 2;
                    }
                }
                break;
            }

            case 'lake':
                if (d.position) {
                    const elev = sampleTerrainElevation(d.position.x, d.position.z);
                    d.position.y = elev;
                    if (mesh) mesh.position.y = elev;
                }
                break;

            case 'river':
                // Rios: ponto médio define Y do mesh (geometria é relativa)
                if (d.path && Array.isArray(d.path)) {
                    for (const pt of d.path) {
                        pt.y = sampleTerrainElevation(pt.x, pt.z);
                    }
                    // Mesh precisa rebuild — mover o grupo Y para a média
                    if (mesh && d.path.length > 0) {
                        const avgY = d.path.reduce((s, p) => s + (p.y || 0), 0) / d.path.length;
                        mesh.position.y = avgY;
                    }
                }
                break;

            case 'boundary':
                // Boundary: move mesh Y para elevação média dos vértices
                if (d.vertices && Array.isArray(d.vertices)) {
                    let sum = 0;
                    for (const v of d.vertices) {
                        v.y = sampleTerrainElevation(v.x, v.z);
                        sum += v.y;
                    }
                    if (mesh && d.vertices.length > 0) {
                        mesh.position.y = sum / d.vertices.length;
                    }
                }
                break;

            case 'plume':
                // Plumas: center.y = terreno + profundidade relativa
                if (d.center) {
                    const ground = sampleTerrainElevation(d.center.x, d.center.z);
                    d.center.y = ground + (d.center.y || 0);
                    if (mesh) mesh.position.y = d.center.y;
                }
                break;

            // stratum, area, incident: não têm posição espacial
            default:
                break;
        }
    }

    requestRender();
}

// ----------------------------------------------------------------
// UTILITÁRIOS INTERNOS
// ----------------------------------------------------------------

/**
 * Busca bounds da boundary no modelo.
 * @returns {{ minX, maxX, minZ, maxZ }|null}
 */
function _getBoundaryBounds() {
    const elements = getAllElements();
    const boundary = elements.find((e) => e.family === 'boundary');
    if (!boundary || !boundary.data?.vertices?.length) return null;

    let minX = Infinity,
        maxX = -Infinity;
    let minZ = Infinity,
        maxZ = -Infinity;

    for (const v of boundary.data.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
    }

    // Margem de 10% para evitar cortes nas bordas
    const padX = (maxX - minX) * 0.1;
    const padZ = (maxZ - minZ) * 0.1;

    return {
        minX: minX - padX,
        maxX: maxX + padX,
        minZ: minZ - padZ,
        maxZ: maxZ + padZ,
    };
}

/**
 * Familias de elementos que possuem observacoes quimicas interpolaveis.
 * well = agua subterranea, marker = solo/ar, spring = nascente, lake = agua superficial.
 */
const INTERPOLABLE_FAMILIES = new Set(['well', 'marker', 'spring', 'lake']);

/**
 * Coleta pontos de observação de elementos para um parâmetro.
 * Retorna o valor mais recente de cada ponto.
 *
 * @param {string} parameterId
 * @param {Object} [opts]
 * @param {string|null} [opts.campaignId]
 * @param {string|null} [opts.matrix] - Filtro por sample_matrix ('soil', 'groundwater', 'surface water')
 * @param {number} [opts.tolerance=0.01]
 * @returns {Array<{x: number, z: number, value: number}>}
 */
function _collectObservationPoints(parameterId, opts = {}) {
    const { campaignId = null, matrix = null, tolerance = 0.01 } = opts;
    const elements = getAllElements();
    const raw = [];
    const aliases = _resolveParameterAliases(parameterId);

    console.log(
        '[Interpolation] Collecting points for %s (matrix=%s, campaign=%s)',
        parameterId,
        matrix || 'all',
        campaignId || 'all',
    );

    let skipped = 0;
    for (const el of elements) {
        if (!INTERPOLABLE_FAMILIES.has(el.family)) {
            skipped++;
            continue;
        }
        const observations = el.data?.observations;
        if (!Array.isArray(observations) || observations.length === 0) continue;

        const obs = observations
            .filter((o) => aliases.has(o.parameterId) && Number.isFinite(parseFloat(o.value)))
            .filter((o) => !campaignId || o.campaignId === campaignId)
            .filter((o) => !matrix || o.sample_matrix === matrix)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        if (obs.length === 0) continue;
        const value = parseFloat(obs[0].value);
        if (!Number.isFinite(value)) continue;

        const x = el.data?.coordinates?.easting ?? el.data?.position?.x ?? 0;
        const z = el.data?.coordinates?.northing ?? el.data?.position?.z ?? 0;

        raw.push({ x, z, value, date: obs[0].date });
    }

    console.log(
        '[Interpolation] %d points collected, %d elements skipped (non-interpolable families)',
        raw.length,
        skipped,
    );

    // RED-C3: Deduplicate co-located points (tolerance 0.01m), latest-value-wins
    // Prevents IDW NaN (division by zero at d=0)
    const seen = new Map();
    for (const pt of raw) {
        const kx = Math.round(pt.x / tolerance) * tolerance;
        const kz = Math.round(pt.z / tolerance) * tolerance;
        const key = `${kx}_${kz}`;
        const existing = seen.get(key);
        if (!existing || new Date(pt.date) > new Date(existing.date)) {
            seen.set(key, pt);
        }
    }

    return Array.from(seen.values()).map((p) => ({ x: p.x, z: p.z, value: p.value }));
}

// ----------------------------------------------------------------
// GEOLOGY CONTACT POINTS — Coleta contatos litológicos dos poços
// ----------------------------------------------------------------

/** Labels em português para tipos de solo ABGE */
const GEOLOGY_SOIL_LABELS = {
    clay: 'Argila',
    sand: 'Areia',
    silt: 'Silte',
    gravel: 'Cascalho',
    rock: 'Rocha',
    sandy_clay: 'Argila arenosa',
    clayey_sand: 'Areia argilosa',
    silty_sand: 'Areia siltosa',
    fill: 'Aterro',
    topsoil: 'Solo organico',
    peat: 'Turfa',
};

/**
 * Coleta pontos de contato geológico dos perfis litológicos dos poços.
 * Para cada poço com o tipo de solo solicitado, extrai a profundidade do
 * contato (topo ou base) e converte para elevação absoluta.
 *
 * @param {string} soilType - tipo de solo (clay, sand, rock, etc.)
 * @param {'top'|'bottom'} [contactType='top'] - topo ou base da camada
 * @returns {Array<{x: number, z: number, value: number}>}
 */
function _collectGeologyContactPoints(soilType, contactType = 'top') {
    const elements = getAllElements();
    const points = [];

    for (const el of elements) {
        if (el.family !== 'well') continue;
        const lithologic = el.data?.profile?.lithologic;
        if (!Array.isArray(lithologic) || lithologic.length === 0) continue;

        const matches = lithologic.filter((l) => l.soilType === soilType);
        if (matches.length === 0) continue;

        // Shallowest 'from' for top contact; deepest 'to' for bottom contact
        const depth =
            contactType === 'top' ? Math.min(...matches.map((m) => m.from)) : Math.max(...matches.map((m) => m.to));

        // Elevacao da boca do poco — mesmo path de _collectObservationPoints
        const surfaceElev = el.data?.coordinates?.elevation ?? 0;
        const value = surfaceElev - depth;

        const x = el.data?.coordinates?.easting ?? el.data?.position?.x ?? 0;
        const z = el.data?.coordinates?.northing ?? el.data?.position?.z ?? 0;

        points.push({ x, z, value });
    }

    console.log('[Interpolation] Geology contacts: %d wells with %s (%s)', points.length, soilType, contactType);
    return points;
}

/**
 * Descobre tipos de solo disponíveis nos perfis litológicos de todos os poços.
 * @returns {{ soilType: string, count: number }[]}
 */
export function getAvailableSoilTypes() {
    const counts = new Map();
    for (const el of getAllElements()) {
        if (el.family !== 'well') continue;
        const lithologic = el.data?.profile?.lithologic;
        if (!Array.isArray(lithologic)) continue;
        const seen = new Set();
        for (const layer of lithologic) {
            if (layer.soilType && !seen.has(layer.soilType)) {
                seen.add(layer.soilType);
                counts.set(layer.soilType, (counts.get(layer.soilType) || 0) + 1);
            }
        }
    }
    return Array.from(counts.entries())
        .map(([soilType, count]) => ({ soilType, count }))
        .sort((a, b) => b.count - a.count);
}

function _normalizeGridSize(gridSize) {
    if (typeof gridSize === 'number' && Number.isFinite(gridSize)) {
        const n = Math.max(8, Math.round(gridSize));
        return { cols: n, rows: n };
    }
    if (gridSize && typeof gridSize === 'object') {
        const cols = Number(gridSize.cols);
        const rows = Number(gridSize.rows);
        if (Number.isFinite(cols) && Number.isFinite(rows)) {
            return {
                cols: Math.max(8, Math.round(cols)),
                rows: Math.max(8, Math.round(rows)),
            };
        }
    }
    return { ...DEFAULT_GRID };
}

function _normalizeManualPoints(points) {
    if (!Array.isArray(points)) return [];
    const out = [];
    for (const pt of points) {
        if (!pt || typeof pt !== 'object') continue;
        const rawX = pt.x;
        const rawZ = pt.z ?? pt.y;
        const rawValue = pt.value;

        // Nao converte null/undefined/empty para 0 (evita pontos sinteticos 0,0,0).
        if (rawX == null || rawZ == null || rawValue == null) continue;
        if (rawX === '' || rawZ === '' || rawValue === '') continue;

        const x = Number(rawX);
        const z = Number(rawZ);
        const value = Number(rawValue);
        if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(value)) continue;
        out.push({
            x,
            z,
            value,
            complianceStatus: pt.complianceStatus || null,
        });
    }
    return out;
}

function _resolveParameterAliases(parameterId) {
    const pid = String(parameterId || '').trim();
    if (!pid) return new Set();
    if (pid === 'water_level' || pid === 'hydraulicHead') {
        return new Set(['water_level', 'hydraulicHead']);
    }
    return new Set([pid]);
}

/**
 * Busca mesh da layer no grupo da cena.
 * @param {Object} layer
 * @returns {THREE.Mesh|null}
 */
function _getMesh(layer) {
    if (!layer.meshId || !_interpolationGroup) return null;
    return _interpolationGroup.getObjectByProperty('uuid', layer.meshId) || null;
}

function _layerSupportsContours(layer) {
    if (!layer?.type) return false;
    return CONTOUR_FEATURE_FLAGS[layer.type] === true;
}

function _defaultShowContoursForType(type) {
    if (type === 'water_table') return true;
    if (type === 'terrain' || type === 'contamination') return false;
    return false;
}

function _defaultShowContourLabelsForType(type) {
    return type === 'water_table';
}

function _contourLevelCount(density) {
    return CONTOUR_DENSITY_LEVELS[density] || CONTOUR_DENSITY_LEVELS.medium;
}

function _applyContourVisibility(layer) {
    if (!Array.isArray(layer.contourObjectIds) || !_interpolationGroup) return;
    for (const id of layer.contourObjectIds) {
        const obj = _interpolationGroup.getObjectByProperty('uuid', id);
        if (obj) obj.visible = !!layer.visible;
    }
    if (!Array.isArray(layer.contourLabelObjectIds)) return;
    for (const id of layer.contourLabelObjectIds) {
        const obj = _interpolationGroup.getObjectByProperty('uuid', id);
        if (obj) obj.visible = !!layer.visible && !!layer.showContourLabels;
    }
}

function _clearLayerContours(layer) {
    const contourIds = Array.isArray(layer.contourObjectIds) ? layer.contourObjectIds : [];
    const labelIds = Array.isArray(layer.contourLabelObjectIds) ? layer.contourLabelObjectIds : [];
    if (contourIds.length === 0 && labelIds.length === 0) {
        layer.contourObjectIds = [];
        layer.contourLabelObjectIds = [];
        return;
    }
    if (_interpolationGroup) {
        for (const id of [...contourIds, ...labelIds]) {
            const obj = _interpolationGroup.getObjectByProperty('uuid', id);
            if (!obj) continue;
            if (obj.geometry?.dispose) obj.geometry.dispose();
            if (obj.material?.map?.dispose) obj.material.map.dispose();
            if (obj.material?.dispose) obj.material.dispose();
            _interpolationGroup.remove(obj);
        }
    }
    layer.contourObjectIds = [];
    layer.contourLabelObjectIds = [];
}

function _sampleLayerGridAt(layer, x, z) {
    if (!layer?.grid || !layer.bounds || !layer.gridSize) return 0;
    const { minX, maxX, minZ, maxZ } = layer.bounds;
    const { cols, rows } = layer.gridSize;
    const grid = layer.grid;
    if (x < minX || x > maxX || z < minZ || z > maxZ) return 0;

    const colF = ((x - minX) / (maxX - minX)) * (cols - 1);
    const rowF = ((z - minZ) / (maxZ - minZ)) * (rows - 1);
    const c0 = Math.floor(colF);
    const r0 = Math.floor(rowF);
    const c1 = Math.min(c0 + 1, cols - 1);
    const r1 = Math.min(r0 + 1, rows - 1);
    const fc = colF - c0;
    const fr = rowF - r0;

    const v00 = grid[r0 * cols + c0];
    const v10 = grid[r0 * cols + c1];
    const v01 = grid[r1 * cols + c0];
    const v11 = grid[r1 * cols + c1];
    return (1 - fc) * (1 - fr) * v00 + fc * (1 - fr) * v10 + (1 - fc) * fr * v01 + fc * fr * v11;
}

function _rebuildLayerContours(layer) {
    _clearLayerContours(layer);
    if (!layer || !layer.grid || !layer.bounds || !layer.gridSize) return;
    if (!_layerSupportsContours(layer) || !layer.showContours) return;
    if (!_interpolationGroup) return;

    const contours = buildContoursFromGrid({
        grid: layer.grid,
        bounds: layer.bounds,
        gridSize: layer.gridSize,
        levelCount: _contourLevelCount(layer.contourDensity),
    });
    if (!Array.isArray(contours) || contours.length === 0) return;

    const ids = [];
    const labelIds = [];
    let labelCount = 0;
    for (const line of contours) {
        if (!Array.isArray(line.points) || line.points.length < 2) continue;
        const points3d = line.points.map(
            (p) => new THREE.Vector3(p.x, _sampleLayerGridAt(layer, p.x, p.z) + CONTOUR_Z_OFFSET, p.z),
        );
        const geometry = new THREE.BufferGeometry().setFromPoints(points3d);
        const material = new THREE.LineBasicMaterial({
            color: 0x00bcd4,
            transparent: true,
            opacity: 0.95,
            depthTest: false,
            depthWrite: false,
        });
        const obj = new THREE.Line(geometry, material);
        obj.name = 'interpolationContour';
        obj.visible = !!layer.visible;
        obj.userData.layerId = layer.id;
        _interpolationGroup.add(obj);
        ids.push(obj.uuid);

        if (!layer.showContourLabels || labelCount >= MAX_CONTOUR_LABELS) continue;
        const anchor = _pickContourLabelAnchor(line.points);
        if (!anchor) continue;
        const text = `${Number(line.level).toFixed(2)} m`;
        const labelObj = _buildContourLabelSprite(text);
        labelObj.position.set(
            anchor.x,
            _sampleLayerGridAt(layer, anchor.x, anchor.z) + CONTOUR_LABEL_Z_OFFSET,
            anchor.z,
        );
        labelObj.visible = !!layer.visible && !!layer.showContourLabels;
        labelObj.userData.layerId = layer.id;
        labelObj.name = 'interpolationContourLabel';
        _interpolationGroup.add(labelObj);
        labelIds.push(labelObj.uuid);
        labelCount += 1;
    }
    layer.contourObjectIds = ids;
    layer.contourLabelObjectIds = labelIds;
}

function _pickContourLabelAnchor(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dz = points[i].z - points[i - 1].z;
        total += Math.hypot(dx, dz);
    }
    if (total <= 0) return points[Math.floor(points.length / 2)] || null;

    const target = total * 0.5;
    let acc = 0;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        if (acc + seg >= target && seg > 0) {
            const t = (target - acc) / seg;
            return {
                x: a.x + (b.x - a.x) * t,
                z: a.z + (b.z - a.z) * t,
            };
        }
        acc += seg;
    }
    return points[points.length - 1] || null;
}

function _buildContourLabelSprite(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(5, 16, 32, 0.75)';
        ctx.strokeStyle = 'rgba(0, 188, 212, 0.95)';
        ctx.lineWidth = 2;
        _roundRect(ctx, 2, 2, canvas.width - 4, canvas.height - 4, 12);
        ctx.fill();
        ctx.stroke();
        ctx.font = 'bold 30px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#e9fcff';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(5.5, 1.5, 1);
    return sprite;
}

function _roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/**
 * Persiste layers no IndexedDB (fire-and-forget — não bloqueia o caller).
 */
async function _persist() {
    if (isEphemeral()) return;
    const data = exportLayers();
    const ok = await idbSet(STORAGE_KEY, data);
    if (!ok) showToast('Storage full. Interpolation data may not persist.', 'warning');
}

/**
 * Restaura layers do IndexedDB. Migra automaticamente do localStorage na primeira execução.
 */
async function _restoreFromStorage() {
    try {
        const configs = await idbGetWithLegacy(STORAGE_KEY);
        console.log('[Interpolation] Restoring', configs?.length || 0, 'layers from IDB');
        if (!Array.isArray(configs)) return;
        // Guard: only recompute if interpolation group is available
        if (!_interpolationGroup) {
            console.warn(
                '[Interpolation] Cannot restore layers: interpolation group not available. Layers will be restored without mesh.',
            );
            for (const c of configs) {
                addLayer(c); // Add layer config only, no recompute
            }
            return;
        }

        for (const c of configs) {
            console.log('[Interpolation] Restoring layer:', c.id, 'type:', c.type);
            const layer = addLayer(c);
            // Recalcula em background — grid/mesh não são persistidos (exportLayers os exclui)
            if (layer.type === 'terrain') {
                console.log('[Interpolation] Triggering terrain recompute for:', layer.id);
                _recomputeTerrainLayer(layer).catch((err) =>
                    console.warn('[Interpolation] Terrain restore failed:', err.message),
                );
            } else if (layer.type === 'contamination' || layer.type === 'water_table') {
                recomputeLayer(layer.id).catch((err) =>
                    console.warn('[Interpolation] Layer restore failed:', err.message),
                );
            }
        }
    } catch (e) {
        console.warn('[Interpolation] falha ao restaurar dados:', e.message);
    }
}

/**
 * Mostra/oculta o overlay plano da boundary (imagem aérea ShapeGeometry).
 * Evita duplicação visual quando terreno texturizado está ativo.
 * @param {boolean} visible
 */
function _setBoundaryOverlayVisible(visible) {
    const group = getElementsGroup();
    if (!group) return;
    group.traverse((obj) => {
        if (obj.name === 'overlay' && obj.isMesh) {
            obj.visible = visible;
        }
    });
    requestRender();
}

/**
 * Dispara evento de mudança.
 */
function _notify() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('interpolationChanged'));
    }
    if (_updateAllUI) _updateAllUI();
}
