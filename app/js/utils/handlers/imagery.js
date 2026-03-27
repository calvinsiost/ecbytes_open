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
   IMAGERY HANDLER — Badge de troca de imagem aerea/satelite
   ================================================================

   Controle flutuante no viewport 3D para trocar o provedor de tiles
   (Sentinel-2, OpenStreetMap) ou enviar imagem personalizada.
   Aplica-se ao overlay do boundary E a terrain layers.

   Padrao identico ao labels badge (#labels-toggle-badge).

   ================================================================ */

import { t } from '../i18n/translations.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let _currentProvider = _readStoredProvider();
let _customImageUrl = null;
let _customKeyActive = false;
let _customSectionOpen = false;
let _popupCloseHandler = null;
let _isApplying = false;

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function _readStoredProvider() {
    try {
        const stored = localStorage.getItem('ecbyts-tile-provider');
        if (stored != null) {
            const idx = parseInt(stored, 10);
            return Number.isFinite(idx) && idx >= 0 ? idx : 0;
        }
    } catch {
        /* noop */
    }
    return 0;
}

function _readStoredKey() {
    try {
        return localStorage.getItem('ecbyts-mapbox-key') || '';
    } catch {
        return '';
    }
}

async function _saveProvider(idx) {
    try {
        const { safeSetItem } = await import('../storage/storageMonitor.js');
        safeSetItem('ecbyts-tile-provider', String(idx));
    } catch {
        try {
            localStorage.setItem('ecbyts-tile-provider', String(idx));
        } catch {
            /* noop */
        }
    }
}

async function _saveKey(key) {
    try {
        const { safeSetItem } = await import('../storage/storageMonitor.js');
        safeSetItem('ecbyts-mapbox-key', key);
    } catch {
        try {
            localStorage.setItem('ecbyts-mapbox-key', key);
        } catch {
            /* noop */
        }
    }
}

// ----------------------------------------------------------------
// IDB IMAGE CACHE — evita re-fetch de tiles no mesmo bbox/provider
// ----------------------------------------------------------------

/** Gera cache key para IDB baseado no provider + bbox arredondado */
function _idbCacheKey(providerIdx, sw, ne, size) {
    return `ecbyts-imagery-${providerIdx}-${sw.latitude.toFixed(4)}_${sw.longitude.toFixed(4)}_${ne.latitude.toFixed(4)}_${ne.longitude.toFixed(4)}_${size}`;
}

/**
 * Busca imagem do IDB cache ou faz stitch remoto e salva no IDB.
 * @param {number} providerIdx - indice do provider
 * @param {Object} sw - southwest WGS84
 * @param {Object} ne - northeast WGS84
 * @param {number} imgSize - tamanho de saida
 * @param {boolean} [forceRefresh=false] - ignora cache e refaz fetch
 * @returns {Promise<string>} data URL ou string vazia
 */
async function _fetchOrCacheImagery(providerIdx, sw, ne, imgSize, forceRefresh = false) {
    const { idbGet, idbSet } = await import('../storage/idbStore.js');
    const cacheKey = _idbCacheKey(providerIdx, sw, ne, imgSize);

    // Tenta IDB cache primeiro (se nao e refresh)
    if (!forceRefresh) {
        const cached = await idbGet(cacheKey);
        if (cached) {
            console.info(`[Imagery] IDB cache hit: ${cacheKey.substring(0, 40)}...`);
            return cached;
        }
    }

    // Fetch remoto
    const { stitchTilesWithProvider } = await import('../../core/io/geo/tileStitcher.js');
    const dataUrl = await stitchTilesWithProvider(providerIdx, sw, ne, imgSize);

    // Salva no IDB para proxima vez
    if (dataUrl) {
        await idbSet(cacheKey, dataUrl);
        _idbCacheKeys.add(cacheKey);
    }

    return dataUrl;
}

/** Rastreia cache keys para limpeza seletiva */
const _idbCacheKeys = new Set();

/**
 * Limpa cache IDB de imagery para o provider atual.
 */
async function _clearImageryCache() {
    const { idbDelete } = await import('../storage/idbStore.js');
    for (const key of _idbCacheKeys) {
        await idbDelete(key);
    }
    _idbCacheKeys.clear();
}

// ----------------------------------------------------------------
// POPUP
// ----------------------------------------------------------------

/**
 * Abre/fecha o popup de selecao de imagery provider.
 * Padrao identico ao handleOpenLabelPopup em labels.js.
 */
function handleOpenImageryPopup(e) {
    e?.stopPropagation();
    const popup = document.getElementById('imagery-quick-popup');
    if (!popup) return;

    const isOpen = !popup.classList.contains('hidden');
    if (isOpen) {
        _closePopup();
        return;
    }

    _renderPopup(popup);
    popup.classList.remove('hidden');

    // Click-outside fecha (setTimeout evita auto-close imediato)
    _popupCloseHandler = (ev) => {
        if (!popup.contains(ev.target) && ev.target.id !== 'imagery-toggle-badge') {
            _closePopup();
        }
    };
    setTimeout(() => document.addEventListener('pointerdown', _popupCloseHandler), 0);
}

function _closePopup() {
    const popup = document.getElementById('imagery-quick-popup');
    if (popup) popup.classList.add('hidden');
    if (_popupCloseHandler) {
        document.removeEventListener('pointerdown', _popupCloseHandler);
        _popupCloseHandler = null;
    }
}

async function _renderPopup(popup) {
    const { TILE_PROVIDERS } = await import('../../core/io/geo/tileStitcher.js');

    const header = t('imagerySettings') || 'Imagem de Satelite';
    const uploadLabel = t('imageryUpload') || 'Enviar Imagem';
    const customLabel = t('imageryCustom') || 'Imagem Personalizada';
    const customProvLabel = t('imageryCustomProvider') || 'Provedor com Chave';
    const apiKeyLabel = t('imageryApiKey') || 'Chave API';
    const applyLabel = t('imageryApplyKey') || 'Aplicar';

    let html = `<div class="iqp-section"><span class="iqp-label">${header}</span></div>`;

    // Providers gratuitos
    TILE_PROVIDERS.forEach((p, idx) => {
        const active = !_customImageUrl && !_customKeyActive && _currentProvider === idx;
        const circle = active ? '&#9679;' : '&#9675;';
        const refreshBtn = active
            ? ` <button class="iqp-refresh-btn" onclick="event.stopPropagation(); handleRefreshImagery()" title="Refresh">&#8635;</button>`
            : '';
        html += `<div class="iqp-provider${active ? ' active' : ''}"
                      onclick="handleSelectImageryProvider(${idx})"
                      role="menuitemradio" aria-checked="${active}">
                    <span class="iqp-radio">${circle}</span>
                    <span class="iqp-provider-name">${p.name}</span>${refreshBtn}
                 </div>`;
    });

    // Custom image ativo
    if (_customImageUrl) {
        html += `<div class="iqp-provider active" role="menuitemradio" aria-checked="true">
                    <span class="iqp-radio">&#9679;</span>
                    <span>${customLabel}</span>
                 </div>`;
    }

    // Custom key provider ativo
    if (_customKeyActive) {
        html += `<div class="iqp-provider active" role="menuitemradio" aria-checked="true">
                    <span class="iqp-radio">&#9679;</span>
                    <span>Mapbox Satellite</span>
                 </div>`;
    }

    html += '<div class="iqp-divider"></div>';

    // Secao colapsavel: Provedor com Chave
    const arrow = _customSectionOpen ? '&#9662;' : '&#9656;';
    const savedKey = _readStoredKey();
    html += `<div class="iqp-disclosure" onclick="handleToggleImageryCustomSection()">
                <span class="iqp-disclosure-arrow">${arrow}</span>
                <span>${customProvLabel}</span>
             </div>`;
    html += `<div class="iqp-custom-section${_customSectionOpen ? '' : ' collapsed'}">
                <select class="iqp-provider-select" id="iqp-custom-provider-select">
                    <option value="mapbox">Mapbox Satellite</option>
                </select>
                <input type="text" class="iqp-key-input" id="iqp-api-key-input"
                       placeholder="${apiKeyLabel}" value="${savedKey}"
                       spellcheck="false" autocomplete="off">
                <button class="iqp-apply-btn" onclick="handleApplyCustomProvider()">
                    ${applyLabel}
                </button>
             </div>`;

    html += '<div class="iqp-divider"></div>';

    // Upload custom
    html += `<label class="iqp-upload-btn" role="button" tabindex="0">
                <span class="icon" data-icon="upload" data-icon-size="12px"></span>
                ${uploadLabel}
                <input type="file" accept="image/*"
                       onchange="handleUploadCustomImagery(this)"
                       style="display:none;">
             </label>`;

    popup.innerHTML = html;
}

// ----------------------------------------------------------------
// PROVIDER SWITCH
// ----------------------------------------------------------------

/**
 * Troca o provedor de tiles e re-aplica overlay no boundary + terrain layers.
 * @param {number} idx - Index do provider em TILE_PROVIDERS
 */
async function handleSelectImageryProvider(idx) {
    if (_isApplying) return;
    _isApplying = true;
    _customImageUrl = null;
    _customKeyActive = false;
    _currentProvider = idx;
    _saveProvider(idx);

    const badge = document.getElementById('imagery-toggle-badge');
    if (badge) badge.classList.add('iqp-loading');

    const { showToast } = await import('../ui/toast.js');
    showToast(t('imageryApplying') || 'Aplicando imagem...', 'info');

    try {
        // Limpa cache de tiles para forcar re-fetch com novo provider
        const { clearTileCache } = await import('../../core/io/geo/tileStitcher.js');
        clearTileCache();

        await _applyProviderToBoundaries(idx);
        await _applyProviderToTerrainLayers(idx);
        showToast(t('imageryApplied') || 'Imagem atualizada', 'success');
    } catch (err) {
        console.error('[Imagery] Provider switch failed:', err);
        showToast(err.message || 'Erro ao trocar imagem', 'error');
    } finally {
        _isApplying = false;
        if (badge) badge.classList.remove('iqp-loading');
        _closePopup();
    }
}

async function _applyProviderToBoundaries(providerIdx, forceRefresh = false) {
    const { getAllElements, getMeshByElementId } = await import('../../core/elements/manager.js');
    const { loadOverlayTexture } = await import('../../core/elements/meshFactory.js');
    const { utmToWGS84, relativeToUTM } = await import('../../core/io/geo/coordinates.js');
    const { requestRender } = await import('../scene/setup.js');

    const boundaries = getAllElements().filter((e) => e.family === 'boundary' && e.data?.vertices?.length >= 3);

    for (const boundary of boundaries) {
        const vs = boundary.data.vertices;
        const xs = vs.map((v) => v.x);
        const zs = vs.map((v) => v.z);
        const halfW = (Math.max(...xs) - Math.min(...xs)) / 2;
        const halfL = (Math.max(...zs) - Math.min(...zs)) / 2;
        const extentM = Math.max(halfW, halfL) * 2;
        const imgSize = Math.min(256, Math.max(128, Math.floor(extentM / 2)));

        const sw = utmToWGS84(relativeToUTM({ x: Math.min(...xs), y: 0, z: Math.max(...zs) }));
        const ne = utmToWGS84(relativeToUTM({ x: Math.max(...xs), y: 0, z: Math.min(...zs) }));

        // Usa cache IDB ou faz fetch remoto
        const newUrl = await _fetchOrCacheImagery(providerIdx, sw, ne, imgSize, forceRefresh);
        if (!newUrl) {
            console.warn(`[Imagery] Provider ${providerIdx} returned empty for boundary ${boundary.id}`);
            const { showToast } = await import('../ui/toast.js');
            const { TILE_PROVIDERS } = await import('../../core/io/geo/tileStitcher.js');
            const name = TILE_PROVIDERS[providerIdx]?.name || `Provider ${providerIdx}`;
            showToast(`${name}: ${t('imageryNoBoundary') || 'failed to fetch tiles'}`, 'warning');
            continue;
        }

        boundary.data.overlayUrl = newUrl;
        boundary.data.overlayFallbackUrls = [];

        const mesh = getMeshByElementId(boundary.id);
        if (mesh) {
            const overlay = mesh.getObjectByName('overlay');
            if (overlay && overlay.material) {
                // Descarta textura antiga para liberar GPU e forcar refresh
                if (overlay.material.map) {
                    overlay.material.map.dispose();
                    overlay.material.map = null;
                    overlay.material.needsUpdate = true;
                }
                await loadOverlayTexture([newUrl], overlay.material);
                console.info(`[Imagery] Boundary ${boundary.id} overlay reloaded`);
            } else {
                console.warn(`[Imagery] Boundary ${boundary.id}: no overlay child or material`);
            }
        } else {
            console.warn(`[Imagery] Boundary ${boundary.id}: mesh not found`);
        }
    }

    requestRender();
}

async function _applyProviderToTerrainLayers(providerIdx, forceRefresh = false) {
    const { getAllLayers, getLayerMesh } = await import('../../core/interpolation/manager.js');
    const { applySatelliteTexture } = await import('../../core/interpolation/surfaceBuilder.js');
    const { utmToWGS84, relativeToUTM } = await import('../../core/io/geo/coordinates.js');
    const { requestRender } = await import('../scene/setup.js');

    const layers = getAllLayers().filter((l) => l.textureMode === 'satellite');

    if (layers.length === 0) return;

    for (const layer of layers) {
        const mesh = getLayerMesh(layer.id);
        if (!mesh) continue;

        const bounds = layer.bounds;
        if (!bounds) continue;

        const sw = utmToWGS84(relativeToUTM({ x: bounds.minX, y: 0, z: bounds.maxZ }));
        const ne = utmToWGS84(relativeToUTM({ x: bounds.maxX, y: 0, z: bounds.minZ }));

        const newUrl = await _fetchOrCacheImagery(providerIdx, sw, ne, 256, forceRefresh);
        if (!newUrl) {
            console.warn(`[Imagery] Provider ${providerIdx} failed for terrain ${layer.id}`);
            continue;
        }

        // Descarta textura antiga do terrain mesh
        if (mesh.material?.map) {
            mesh.material.map.dispose();
            mesh.material.map = null;
            mesh.material.needsUpdate = true;
        }

        layer.satelliteUrls = [newUrl];
        applySatelliteTexture(mesh, [newUrl]);
    }

    requestRender();
}

// ----------------------------------------------------------------
// CUSTOM IMAGE UPLOAD
// ----------------------------------------------------------------

/**
 * Upload de imagem local como overlay do boundary.
 * @param {HTMLInputElement} input - File input element
 */
async function handleUploadCustomImagery(input) {
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
        const { showToast } = await import('../ui/toast.js');
        showToast('Selecione um arquivo de imagem (JPG, PNG)', 'error');
        return;
    }

    _isApplying = true;
    const badge = document.getElementById('imagery-toggle-badge');
    if (badge) badge.classList.add('iqp-loading');

    try {
        const blobUrl = URL.createObjectURL(file);
        _customImageUrl = blobUrl;

        const { getAllElements, getMeshByElementId } = await import('../../core/elements/manager.js');
        const { loadOverlayTexture } = await import('../../core/elements/meshFactory.js');
        const { requestRender } = await import('../scene/setup.js');

        const boundaries = getAllElements().filter((e) => e.family === 'boundary' && e.data?.vertices?.length >= 3);

        for (const boundary of boundaries) {
            boundary.data.overlayUrl = blobUrl;

            const mesh = getMeshByElementId(boundary.id);
            if (mesh) {
                const overlay = mesh.getObjectByName('overlay');
                if (overlay && overlay.material) {
                    await loadOverlayTexture([blobUrl], overlay.material);
                }
            }
        }

        // Aplica tambem aos terrain layers com textura de satelite
        const { getAllLayers, getLayerMesh } = await import('../../core/interpolation/manager.js');
        const { applySatelliteTexture } = await import('../../core/interpolation/surfaceBuilder.js');
        const terrainLayers = getAllLayers().filter((l) => l.textureMode === 'satellite');
        for (const layer of terrainLayers) {
            const tMesh = getLayerMesh(layer.id);
            if (tMesh) {
                if (tMesh.material?.map) {
                    tMesh.material.map.dispose();
                    tMesh.material.map = null;
                }
                layer.satelliteUrls = [blobUrl];
                applySatelliteTexture(tMesh, [blobUrl]);
            }
        }

        requestRender();

        const { showToast } = await import('../ui/toast.js');
        showToast(`Imagem "${file.name}" aplicada`, 'success');
    } catch (err) {
        console.error('[Imagery] Custom upload failed:', err);
        const { showToast } = await import('../ui/toast.js');
        showToast('Erro ao aplicar imagem', 'error');
    } finally {
        _isApplying = false;
        if (badge) badge.classList.remove('iqp-loading');
        _closePopup();
    }
}

// ----------------------------------------------------------------
// REFRESH
// ----------------------------------------------------------------

/**
 * Re-stitch imagery from current provider, clearing cache.
 * Forca re-download dos tiles (util quando tiles foram atualizados no servidor).
 */
async function handleRefreshImagery() {
    if (_isApplying) return;
    _isApplying = true;

    const badge = document.getElementById('imagery-toggle-badge');
    if (badge) badge.classList.add('iqp-loading');

    const { showToast } = await import('../ui/toast.js');
    showToast(t('imageryApplying') || 'Aplicando imagem...', 'info');

    try {
        // Limpa caches in-memory E IDB para forcar re-download completo
        const { clearTileCache } = await import('../../core/io/geo/tileStitcher.js');
        clearTileCache();
        await _clearImageryCache();

        await _applyProviderToBoundaries(_currentProvider, true);
        await _applyProviderToTerrainLayers(_currentProvider, true);
        showToast(t('imageryApplied') || 'Imagem atualizada', 'success');
    } catch (err) {
        console.error('[Imagery] Refresh failed:', err);
        showToast(err.message || 'Erro ao atualizar', 'error');
    } finally {
        _isApplying = false;
        if (badge) badge.classList.remove('iqp-loading');
        _closePopup();
    }
}

// ----------------------------------------------------------------
// CUSTOM PROVIDER (API KEY)
// ----------------------------------------------------------------

/** Mapbox tile URL templates indexed by dropdown value */
const CUSTOM_PROVIDERS = {
    mapbox: {
        name: 'Mapbox Satellite',
        urlTemplate: 'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token={key}',
        maxZoom: 19,
    },
};

/**
 * Toggle disclosure section for custom provider API key.
 */
function handleToggleImageryCustomSection() {
    _customSectionOpen = !_customSectionOpen;
    const popup = document.getElementById('imagery-quick-popup');
    if (popup) _renderPopup(popup);
}

/**
 * Apply custom provider with user-supplied API key.
 */
async function handleApplyCustomProvider() {
    const select = document.getElementById('iqp-custom-provider-select');
    const input = document.getElementById('iqp-api-key-input');
    if (!select || !input) return;

    const providerKey = select.value; // 'mapbox'
    const apiKey = input.value.trim();
    if (!apiKey) {
        const { showToast } = await import('../ui/toast.js');
        showToast(t('imageryApiKey') || 'Enter API key', 'warning');
        return;
    }

    const provider = CUSTOM_PROVIDERS[providerKey];
    if (!provider) return;

    _isApplying = true;
    const badge = document.getElementById('imagery-toggle-badge');
    if (badge) badge.classList.add('iqp-loading');

    const { showToast } = await import('../ui/toast.js');
    showToast(t('imageryApplying') || 'Aplicando imagem...', 'info');

    try {
        const url = provider.urlTemplate.replace('{key}', apiKey);

        const { clearTileCache, stitchTilesWithCustomUrl } = await import('../../core/io/geo/tileStitcher.js');
        clearTileCache();

        // Apply to boundaries
        const { getAllElements, getMeshByElementId } = await import('../../core/elements/manager.js');
        const { loadOverlayTexture } = await import('../../core/elements/meshFactory.js');
        const { utmToWGS84, relativeToUTM } = await import('../../core/io/geo/coordinates.js');
        const { requestRender } = await import('../scene/setup.js');

        const boundaries = getAllElements().filter((e) => e.family === 'boundary' && e.data?.vertices?.length >= 3);

        let success = false;
        for (const boundary of boundaries) {
            const vs = boundary.data.vertices;
            const xs = vs.map((v) => v.x);
            const zs = vs.map((v) => v.z);
            const extentM = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
            const imgSize = Math.min(512, Math.max(128, Math.floor(extentM / 2)));

            const sw = utmToWGS84(relativeToUTM({ x: Math.min(...xs), y: 0, z: Math.max(...zs) }));
            const ne = utmToWGS84(relativeToUTM({ x: Math.max(...xs), y: 0, z: Math.min(...zs) }));

            const newUrl = await stitchTilesWithCustomUrl(url, provider.maxZoom, sw, ne, imgSize);
            if (!newUrl) {
                showToast(`${provider.name}: key invalid or fetch failed`, 'error');
                continue;
            }

            boundary.data.overlayUrl = newUrl;
            const mesh = getMeshByElementId(boundary.id);
            if (mesh) {
                const overlay = mesh.getObjectByName('overlay');
                if (overlay?.material) {
                    if (overlay.material.map) {
                        overlay.material.map.dispose();
                        overlay.material.map = null;
                    }
                    await loadOverlayTexture([newUrl], overlay.material);
                }
            }
            success = true;
        }

        // Apply to terrain layers
        const { getAllLayers, getLayerMesh } = await import('../../core/interpolation/manager.js');
        const { applySatelliteTexture } = await import('../../core/interpolation/surfaceBuilder.js');
        const terrainLayers = getAllLayers().filter((l) => l.textureMode === 'satellite');
        for (const layer of terrainLayers) {
            const tMesh = getLayerMesh(layer.id);
            if (!tMesh || !layer.bounds) continue;

            const sw = utmToWGS84(relativeToUTM({ x: layer.bounds.minX, y: 0, z: layer.bounds.maxZ }));
            const ne = utmToWGS84(relativeToUTM({ x: layer.bounds.maxX, y: 0, z: layer.bounds.minZ }));
            const newUrl = await stitchTilesWithCustomUrl(url, provider.maxZoom, sw, ne, 256);
            if (!newUrl) continue;

            if (tMesh.material?.map) {
                tMesh.material.map.dispose();
                tMesh.material.map = null;
            }
            layer.satelliteUrls = [newUrl];
            applySatelliteTexture(tMesh, [newUrl]);
            success = true;
        }

        requestRender();

        if (success) {
            _customKeyActive = true;
            _customImageUrl = null;
            await _saveKey(apiKey);
            showToast(t('imageryApplied') || 'Imagem atualizada', 'success');
        }
    } catch (err) {
        console.error('[Imagery] Custom provider failed:', err);
        showToast(err.message || 'Erro ao aplicar', 'error');
    } finally {
        _isApplying = false;
        if (badge) badge.classList.remove('iqp-loading');
        _closePopup();
    }
}

// ----------------------------------------------------------------
// EXPORT
// ----------------------------------------------------------------

export const imageryHandlers = {
    handleOpenImageryPopup,
    handleSelectImageryProvider,
    handleUploadCustomImagery,
    handleToggleImageryCustomSection,
    handleApplyCustomProvider,
    handleRefreshImagery,
};
