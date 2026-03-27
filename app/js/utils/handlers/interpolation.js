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
   INTERPOLATION HANDLERS — UI e ações do módulo de interpolação
   Handlers para criação/gestão de camadas interpoladas (terreno,
   nível d'água, contaminação, etc.)

   Padrão: exporta interpolationHandlers + setInterpolationHandlerUpdateAllUI
   ================================================================ */

import {
    getAllLayers,
    getLayer,
    removeLayer,
    updateLayer,
    createTerrainLayer,
    createWaterTableLayer,
    createContaminationLayer,
    createGeologyLayer,
    getAvailableSoilTypes,
    createPotentiometricMap,
    createPlumeFromCampaign,
    recomputeLayer,
    GRID_SIZES,
    getLayerMesh,
    getSelectedLayer,
    setSelectedLayer,
} from '../../core/interpolation/manager.js';
import { INTERPOLATION_METHODS } from '../../core/interpolation/engine.js';
import { getRampNames } from '../../core/interpolation/colorRamps.js';
import { getIcon } from '../ui/icons.js';
import { t } from '../i18n/translations.js';
import { showToast } from '../ui/toast.js';
import { escapeHtml } from '../helpers/html.js';
import { setSelectedElement, getAllElements } from '../../core/elements/manager.js';
import { highlightMesh, clearHighlight } from '../scene/picker.js';
import { highlightSelectedLayer } from '../ui/lists.js';
import { requestRender } from '../scene/setup.js';
import { setSelectedVolume } from '../../core/voxel/manager.js';
import { CONFIG } from '../../config.js';

let _updateAllUI = null;
const CONTOUR_UI_TYPES = new Set(['water_table', 'terrain', 'contamination']);

export function setInterpolationHandlerUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ----------------------------------------------------------------
// MODAL OPEN/CLOSE
// ----------------------------------------------------------------

function handleOpenInterpolationPanel() {
    const modal = document.getElementById('interpolation-modal');
    if (!modal) return;
    modal.classList.add('visible');
    _refreshContaminationParameterSelect();
    _refreshGeologySoilTypeSelect();
    _renderInterpolationModal();
}

function handleCloseInterpolationPanel() {
    const modal = document.getElementById('interpolation-modal');
    if (modal) modal.classList.remove('visible');
}

// ----------------------------------------------------------------
// CREATE LAYERS
// ----------------------------------------------------------------

async function handleAddTerrainLayer() {
    try {
        const gridSize = _getSelectedGridSize();
        await createTerrainLayer({ gridSize });
        _renderInterpolationModal();
    } catch (err) {
        console.error('[Interpolation handler] Terrain:', err);
    }
}

async function handleAddWaterTableLayer() {
    try {
        const gridSize = _getSelectedGridSize();
        const method = _getSelectedMethod();
        await createWaterTableLayer({ gridSize, method });
        _renderInterpolationModal();
    } catch (err) {
        console.error('[Interpolation handler] Water table:', err);
    }
}

async function handleAddContaminationLayer(parameterId) {
    if (!parameterId) {
        showToast('Selecione um parâmetro para interpolação.', 'warning');
        return;
    }
    try {
        const gridSize = _getSelectedGridSize();
        const method = _getSelectedMethod();
        const matrix = _getSelectedMatrix();
        await createContaminationLayer(parameterId, { gridSize, method, matrix });
        _renderInterpolationModal();
    } catch (err) {
        console.error('[Interpolation handler] Contamination:', err);
    }
}

function handleMatrixFilterChange() {
    _refreshContaminationParameterSelect();
}

// ----------------------------------------------------------------
// LAYER ACTIONS
// ----------------------------------------------------------------

function handleRemoveInterpolationLayer(id) {
    removeLayer(id);
    _renderInterpolationModal();
}

function handleToggleInterpolationLayer(id) {
    const layer = getLayer(id);
    if (!layer) return;
    updateLayer(id, { visible: !layer.visible });
    _renderInterpolationModal();
}

function handleChangeInterpolationMethod(id, method) {
    updateLayer(id, { method });
}

function handleChangeInterpolationOpacity(id, value) {
    const opacity = parseFloat(value);
    if (!isNaN(opacity)) updateLayer(id, { opacity: Math.max(0, Math.min(1, opacity)) });
}

function handleChangeInterpolationColorRamp(id, rampName) {
    updateLayer(id, { colorRamp: rampName });
    // Recompute necessário para atualizar vertex colors
    recomputeLayer(id);
}

function handleChangeInterpolationGridSize(id, colsStr) {
    const cols = parseInt(colsStr, 10);
    if (isNaN(cols)) return;
    updateLayer(id, { gridSize: { cols, rows: cols } });
    recomputeLayer(id);
}

async function handleRefreshInterpolationLayer(id) {
    const layer = getLayer(id);
    if (!layer) return;
    if (layer.type === 'terrain') {
        // Re-fetch terrain data
        removeLayer(id);
        await createTerrainLayer({ gridSize: layer.gridSize });
    } else {
        await recomputeLayer(id);
    }
    _renderInterpolationModal();
}

function handleToggleWireframe(id) {
    const layer = getLayer(id);
    if (!layer) return;
    updateLayer(id, { wireframe: !layer.wireframe });
    _renderInterpolationModal();
}

function handleChangeInterpolationTexture(id, mode) {
    updateLayer(id, { textureMode: mode });
    _renderInterpolationModal();
}

/**
 * D6: Upload de imagem aerea local como overlay no terreno.
 * Cria Blob URL da imagem e aplica como textura no mesh.
 *
 * @param {string} id — layer ID
 * @param {File} file — imagem (JPG, PNG, etc.)
 */
async function handleUploadTerrainOverlay(id, file) {
    if (!file || !file.type.startsWith('image/')) {
        const { showToast } = await import('../ui/toast.js');
        showToast('Selecione um arquivo de imagem (JPG, PNG)', 'error');
        return;
    }

    const layer = getLayer(id);
    if (!layer?.mesh) return;

    // Cria Blob URL para a imagem local
    const blobUrl = URL.createObjectURL(file);

    // Aplica como textura via surfaceBuilder
    const { applySatelliteTexture } = await import('../../core/interpolation/surfaceBuilder.js');
    applySatelliteTexture(layer.mesh, [blobUrl]);

    // Salva referencia no layer para persistencia
    updateLayer(id, { textureMode: 'custom', customOverlayName: file.name });

    const { showToast } = await import('../ui/toast.js');
    showToast(`Imagem "${file.name}" aplicada ao terreno`, 'success');

    _renderInterpolationModal();
}

function handleToggleInterpolationContours(id) {
    const layer = getLayer(id);
    if (!layer || !_supportsContourUI(layer)) return;
    updateLayer(id, { showContours: !layer.showContours });
    _renderInterpolationModal();
}

function handleChangeInterpolationContourDensity(id, density) {
    const layer = getLayer(id);
    if (!layer || !_supportsContourUI(layer)) return;
    updateLayer(id, { contourDensity: density });
    _renderInterpolationModal();
}

function handleToggleInterpolationContourLabels(id) {
    const layer = getLayer(id);
    if (!layer || !_supportsContourUI(layer)) return;
    updateLayer(id, { showContourLabels: !layer.showContourLabels });
    _renderInterpolationModal();
}

// ----------------------------------------------------------------
// RENDER MODAL
// ----------------------------------------------------------------

function _renderInterpolationModal() {
    const container = document.getElementById('interpolation-layers-list');
    if (!container) return;
    _refreshContaminationParameterSelect();
    _refreshGeologySoilTypeSelect();

    const layers = getAllLayers();

    if (layers.length === 0) {
        container.innerHTML = `
            <div class="interpolation-empty">
                ${getIcon('layers', 32)}
                <p>${t('interpolationNoLayers') || 'Nenhuma camada de interpolação. Use os botões acima para criar.'}</p>
            </div>`;
        return;
    }

    container.innerHTML = layers.map((l) => _renderLayerCard(l)).join('');
}

function _renderLayerCard(layer) {
    const typeLabels = {
        terrain: 'Terreno',
        water_table: "Nível d'Água",
        contamination: 'Contaminação',
        geology: 'Geologia',
        custom: 'Custom',
    };
    const typeColors = {
        terrain: '#4caf50',
        water_table: '#2196f3',
        contamination: '#f44336',
        geology: '#795548',
        custom: '#9e9e9e',
    };

    const methodOptions = Object.values(INTERPOLATION_METHODS)
        .map((m) => `<option value="${m.id}" ${layer.method === m.id ? 'selected' : ''}>${m.name}</option>`)
        .join('');

    const gridOptions = GRID_SIZES.map(
        (g) => `<option value="${g.cols}" ${layer.gridSize.cols === g.cols ? 'selected' : ''}>${g.label}</option>`,
    ).join('');

    const rampOptions = getRampNames()
        .map((name) => `<option value="${name}" ${layer.colorRamp === name ? 'selected' : ''}>${name}</option>`)
        .join('');

    const stats = layer.stats
        ? `<span class="interpolation-stats">Min: ${layer.stats.min.toFixed(1)} | Max: ${layer.stats.max.toFixed(1)} | Média: ${layer.stats.mean.toFixed(1)}</span>`
        : '';

    return `
    <div class="interpolation-card ${layer.visible ? '' : 'interpolation-card-hidden'}">
        <div class="interpolation-card-header">
            <span class="interpolation-type-badge" style="background:${typeColors[layer.type] || '#9e9e9e'}">
                ${escapeHtml(typeLabels[layer.type] || layer.type)}
            </span>
            <span class="interpolation-card-name">${escapeHtml(layer.name)}</span>
            <div class="interpolation-card-actions">
                <button onclick="handleToggleInterpolationLayer('${layer.id}')" title="${layer.visible ? 'Ocultar' : 'Mostrar'}">
                    ${getIcon(layer.visible ? 'eye' : 'eye-off', 14)}
                </button>
                <button onclick="handleToggleWireframe('${layer.id}')" title="Wireframe" class="${layer.wireframe ? 'active' : ''}">
                    ${getIcon('grid', 14)}
                </button>
                <button onclick="handleRefreshInterpolationLayer('${layer.id}')" title="Recalcular">
                    ${getIcon('refresh-cw', 14)}
                </button>
                <button onclick="handleRemoveInterpolationLayer('${layer.id}')" title="Remover" class="btn-danger-subtle">
                    ${getIcon('trash-2', 14)}
                </button>
            </div>
        </div>
        <div class="interpolation-card-body">
            <label>
                Método
                <select onchange="handleChangeInterpolationMethod('${layer.id}', this.value)">
                    ${methodOptions}
                </select>
            </label>
            <label>
                Resolução
                <select onchange="handleChangeInterpolationGridSize('${layer.id}', this.value)">
                    ${gridOptions}
                </select>
            </label>
            ${
                layer.fixedColor
                    ? `<label style="display:flex;align-items:center;gap:8px;">
                    Cor
                    <span style="display:inline-block;width:24px;height:24px;border-radius:4px;background:${escapeHtml(layer.fixedColor)};border:1px solid rgba(255,255,255,0.3);vertical-align:middle;"></span>
                    <span style="font-size:11px;opacity:0.7;">${escapeHtml(layer.parameterId || '')}</span>
                   </label>`
                    : `<label>
                    Paleta
                    <select onchange="handleChangeInterpolationColorRamp('${layer.id}', this.value)">
                        ${rampOptions}
                    </select>
                   </label>`
            }
            <label>
                Opacidade
                <input type="range" min="0" max="1" step="0.05"
                    value="${layer.opacity}"
                    oninput="handleChangeInterpolationOpacity('${layer.id}', this.value)">
            </label>
            ${
                _supportsContourUI(layer)
                    ? `
            <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox"
                    ${layer.showContours ? 'checked' : ''}
                    onchange="handleToggleInterpolationContours('${layer.id}')">
                ${layer.type === 'contamination' ? 'Isolinhas' : 'Curvas de nÃ­vel'}
            </label>
            <label>
                Densidade das curvas
                <select onchange="handleChangeInterpolationContourDensity('${layer.id}', this.value)">
                    <option value="low" ${layer.contourDensity === 'low' ? 'selected' : ''}>Baixa</option>
                    <option value="medium" ${layer.contourDensity !== 'low' && layer.contourDensity !== 'high' ? 'selected' : ''}>MÃ©dia</option>
                    <option value="high" ${layer.contourDensity === 'high' ? 'selected' : ''}>Alta</option>
                </select>
            </label>
            <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox"
                    ${layer.showContourLabels ? 'checked' : ''}
                    onchange="handleToggleInterpolationContourLabels('${layer.id}')">
                ${layer.type === 'water_table' ? 'Labels de cota' : 'Labels das curvas'}
            </label>`
                    : ''
            }
            ${
                layer.type === 'terrain'
                    ? `
            <label>
                ${t('interpolationTexture') || 'Textura'}
                <select onchange="handleChangeInterpolationTexture('${layer.id}', this.value)">
                    ${layer.satelliteUrls ? `<option value="satellite" ${layer.textureMode === 'satellite' ? 'selected' : ''}>${t('interpolationSatellite') || 'Satelite'}</option>` : ''}
                    <option value="colorRamp" ${layer.textureMode === 'colorRamp' || (!layer.satelliteUrls && layer.textureMode !== 'custom') ? 'selected' : ''}>${t('interpolationColorRamp') || 'Rampa de Cores'}</option>
                    <option value="custom" ${layer.textureMode === 'custom' ? 'selected' : ''}>${t('interpolationCustomImage') || 'Imagem local'}</option>
                </select>
            </label>
            ${
                layer.textureMode === 'custom'
                    ? `
            <label style="margin-top:4px;">
                <input type="file" accept="image/*" style="font-size:10px;"
                       onchange="handleUploadTerrainOverlay('${layer.id}', this.files[0])">
            </label>`
                    : ''
            }`
                    : ''
            }
            ${stats}
        </div>
    </div>`;
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function _getSelectedGridSize() {
    const sel = document.getElementById('interpolation-grid-size');
    if (sel) {
        const cols = parseInt(sel.value, 10);
        if (!isNaN(cols)) return { cols, rows: cols };
    }
    return { cols: 64, rows: 64 };
}

function _getSelectedMethod() {
    const sel = document.getElementById('interpolation-method');
    return sel?.value || 'idw';
}

function _getSelectedMatrix() {
    const sel = document.getElementById('interpolation-matrix-filter');
    return sel?.value || null;
}

function _supportsContourUI(layer) {
    return CONTOUR_UI_TYPES.has(layer?.type);
}

function _refreshContaminationParameterSelect() {
    const select = document.getElementById('interpolation-contamination-parameter');
    const button = document.getElementById('interpolation-add-contamination-btn');
    if (!select || !button) return;

    const previousValue = select.value;
    const parameters = _getContaminationParametersFromObservations();

    const placeholder = '<option value="">Parâmetro contaminação...</option>';
    const options = parameters
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
        .join('');
    select.innerHTML = placeholder + options;

    if (parameters.length === 0) {
        select.value = '';
        button.disabled = true;
        button.title = 'Sem observações válidas para parâmetros de contaminação';
        return;
    }

    if (previousValue && parameters.some((p) => p.id === previousValue)) {
        select.value = previousValue;
    } else {
        select.value = parameters[0].id;
    }

    button.disabled = false;
    button.title = 'Interpolar contaminação';
}

function _getContaminationParametersFromObservations() {
    const matrixFilter = _getSelectedMatrix();
    const observedParamIds = new Set();
    for (const element of getAllElements()) {
        const observations = Array.isArray(element?.data?.observations) ? element.data.observations : [];
        for (const obs of observations) {
            const value = Number.parseFloat(obs?.value);
            if (!Number.isFinite(value)) continue;
            if (matrixFilter && obs.sample_matrix !== matrixFilter) continue;
            const parameterId = String(obs?.parameterId || '').trim();
            if (!parameterId) continue;
            observedParamIds.add(parameterId);
        }
    }

    const catalog = Array.isArray(CONFIG?.PARAMETERS) ? CONFIG.PARAMETERS : [];
    const byId = new Map(catalog.map((param) => [param.id, param]));
    const options = [];

    for (const id of observedParamIds) {
        const param = byId.get(id);
        if (param && param.category !== 'contaminant') continue;
        options.push({
            id,
            name: param?.name || id,
        });
    }

    return options.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// ----------------------------------------------------------------
// LAYER SELECTION — Seleção de layer no painel de elementos
// ----------------------------------------------------------------

/**
 * Select an interpolation layer in the elements panel.
 * Seleciona uma layer de interpolação (mutuamente exclusivo com elementos).
 *
 * @param {string} layerId
 */
function handleSelectLayer(layerId) {
    // Limpa seleção de elemento e volume
    setSelectedElement(null);
    setSelectedVolume(null);
    clearHighlight();

    const prev = getSelectedLayer();
    if (prev === layerId) {
        // Deselecionar se clicou de novo
        setSelectedLayer(null);
        highlightSelectedLayer(null);
        if (_updateAllUI) _updateAllUI();
        return;
    }

    setSelectedLayer(layerId);

    // Highlight mesh 3D
    const mesh = getLayerMesh(layerId);
    if (mesh) highlightMesh(mesh);

    // Rebuild lista para mostrar inline controls do layer selecionado
    if (_updateAllUI) _updateAllUI();

    requestRender();
}

/**
 * Toggle visibility of an interpolation layer from the elements panel.
 * @param {string} layerId
 */
function handleToggleLayerVisibility(layerId) {
    const layer = getLayer(layerId);
    if (!layer) return;
    updateLayer(layerId, { visible: !layer.visible });
    if (_updateAllUI) _updateAllUI();
}

// ----------------------------------------------------------------
// EXPORT
// ----------------------------------------------------------------

// --- GeoML Maps Phase 1 handlers ---

/**
 * Generate a potentiometric map from water_level observations.
 * Uses Kriging by default; falls back to IDW on CDN timeout.
 */
async function handleGeneratePotentiometricMap() {
    if (!CONFIG.FEATURES?.GEOML_MAPS) return;
    try {
        const layer = await createPotentiometricMap({ method: 'idw' });
        if (layer) {
            showToast(t('interpolation.potentiometric_created') || 'Mapa potenciometrico gerado', 'success');
            _renderInterpolationModal();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/**
 * Generate a contamination plume from campaign observations.
 * @param {string} [parameterId] - Parameter to interpolate (e.g., 'benzene')
 */
async function handleGeneratePlumeFromCampaign(parameterId) {
    if (!CONFIG.FEATURES?.GEOML_MAPS) return;
    if (!parameterId) {
        showToast('Selecione um parametro de contaminacao.', 'warning');
        return;
    }
    try {
        const result = await createPlumeFromCampaign({ parameterId, method: 'idw' });
        if (result?.layer) {
            showToast(t('interpolation.plume_created') || `Pluma de ${parameterId} gerada`, 'success');
            _renderInterpolationModal();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ----------------------------------------------------------------
// GEOLOGY LAYER — Superfícies geológicas de perfis litológicos
// ----------------------------------------------------------------

const SOIL_LABELS_UI = {
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

async function handleAddGeologyLayer() {
    const soilTypeSelect = document.getElementById('interpolation-geology-soiltype');
    const contactSelect = document.getElementById('interpolation-geology-contact');
    const soilType = soilTypeSelect?.value;
    const contactType = contactSelect?.value || 'top';

    if (!soilType) {
        showToast('Selecione um tipo de solo.', 'warning');
        return;
    }

    try {
        const gridSize = _getSelectedGridSize();
        const method = _getSelectedMethod();
        await createGeologyLayer(soilType, { contactType, gridSize, method });
        _renderInterpolationModal();
    } catch (err) {
        console.error('[Interpolation handler] Geology:', err);
    }
}

function _refreshGeologySoilTypeSelect() {
    const select = document.getElementById('interpolation-geology-soiltype');
    const button = document.getElementById('interpolation-add-geology-btn');
    if (!select || !button) return;

    const previousValue = select.value;
    const available = getAvailableSoilTypes();

    const placeholder = '<option value="">Tipo de solo...</option>';
    const options = available
        .map(
            (s) =>
                `<option value="${escapeHtml(s.soilType)}">${escapeHtml(SOIL_LABELS_UI[s.soilType] || s.soilType)} (${s.count})</option>`,
        )
        .join('');
    select.innerHTML = placeholder + options;

    if (available.length === 0) {
        select.value = '';
        button.disabled = true;
        button.title = 'Nenhum poco com perfil litologico';
        return;
    }

    if (previousValue && available.some((s) => s.soilType === previousValue)) {
        select.value = previousValue;
    } else {
        select.value = available[0].soilType;
    }
    button.disabled = false;
}

export const interpolationHandlers = {
    handleOpenInterpolationPanel,
    handleCloseInterpolationPanel,
    handleAddTerrainLayer,
    handleAddWaterTableLayer,
    handleAddContaminationLayer,
    handleAddGeologyLayer,
    handleMatrixFilterChange,
    handleRemoveInterpolationLayer,
    handleToggleInterpolationLayer,
    handleChangeInterpolationMethod,
    handleChangeInterpolationOpacity,
    handleChangeInterpolationColorRamp,
    handleChangeInterpolationGridSize,
    handleRefreshInterpolationLayer,
    handleToggleWireframe,
    handleChangeInterpolationTexture,
    handleUploadTerrainOverlay,
    handleToggleInterpolationContours,
    handleChangeInterpolationContourDensity,
    handleToggleInterpolationContourLabels,
    handleSelectLayer,
    handleToggleLayerVisibility,
    handleGeneratePotentiometricMap,
    handleGeneratePlumeFromCampaign,
};
