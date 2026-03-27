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
   MAP PICKER — Interactive map for selecting UTM origin
   ================================================================

   Modal fullscreen com mapa interativo para seleção de ponto.
   Usa MapLibre GL JS (vector tiles, sem API key) como engine primário.
   Fallback para Leaflet se MapLibre falhar (rede, WebGL indisponível).

   STACK:
   - MapLibre GL JS 4.x (CDN, lazy loaded)
   - OpenFreeMap vector tiles (sem API key, open-source)
   - Sentinel-2 Cloudless by EOX satellite layer (sem API key, raster)
   - Nominatim geocoding (OpenStreetMap, sem API key)

   COMPONENTES:
   - Overlay fullscreen com mapa
   - Crosshair CSS no centro (ponto é o centro do mapa)
   - Barra de busca (Nominatim) com flyTo
   - Barra de info com lat/lon em tempo real
   - Toggle street/satellite
   - Botões Confirmar / Cancelar

   ================================================================ */

import { t } from '../i18n/translations.js';
import { getOrigin, hasOrigin, utmToWGS84 } from '../../core/io/geo/coordinates.js';
import { loadScriptCDN } from '../helpers/cdnLoader.js';

// ----------------------------------------------------------------
// CONSTANTS
// ----------------------------------------------------------------

// MapLibre GL JS (primary)
const MAPLIBRE_CSS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css';
const MAPLIBRE_JS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js';
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const SATELLITE_TILES =
    'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg';

// Leaflet (fallback)
const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css';
const LEAFLET_JS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js';
// NOTE: tile.openstreetmap.org prohibits heavy use in distributed apps.
// Using OpenFreeMap raster tiles (OSM data, free for commercial use).
const OSM_TILES = 'https://tile.openfreemap.org/styles/liberty/{z}/{x}/{y}.png';
const OSM_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';
const SATELLITE_ATTR =
    'Sentinel-2 cloudless &mdash; <a href="https://s2maps.eu" target="_blank">s2maps.eu</a> by EOX (Copernicus Sentinel data 2021)';

// Defaults
const DEFAULT_LAT = -15.0;
const DEFAULT_LON = -47.0;
const DEFAULT_ZOOM = 4;

// ----------------------------------------------------------------
// ENGINE DETECTION
// ----------------------------------------------------------------

let _engine = null; // 'maplibre' | 'leaflet' | null
let _satelliteAvailable = true;

/**
 * Try to load MapLibre GL JS. Falls back to Leaflet if it fails.
 * @returns {Promise<'maplibre'|'leaflet'>}
 */
async function _ensureEngine() {
    if (_engine) return _engine;

    // Try MapLibre first
    try {
        // CSS
        if (!document.querySelector(`link[href*="maplibre-gl"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = MAPLIBRE_CSS;
            document.head.appendChild(link);
        }

        // JS
        if (!window.maplibregl) {
            await loadScriptCDN(MAPLIBRE_JS, {
                name: 'MapLibre GL JS',
                globalVar: 'maplibregl',
                timeout: 12000,
            });
        }

        // Verify WebGL support
        const testCanvas = document.createElement('canvas');
        const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
        if (!gl) throw new Error('WebGL not available');

        await _preflightMapEndpoints();
        _engine = 'maplibre';
        console.log('[MapPicker] Using MapLibre GL JS');
        return _engine;
    } catch (err) {
        console.warn('[MapPicker] MapLibre failed, falling back to Leaflet:', err.message);
    }

    // Fallback: Leaflet
    try {
        if (!document.querySelector(`link[href*="leaflet"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = LEAFLET_CSS;
            document.head.appendChild(link);
        }
        if (!window.L) {
            await loadScriptCDN(LEAFLET_JS, {
                name: 'Leaflet',
                globalVar: 'L',
                timeout: 12000,
            });
        }
        _engine = 'leaflet';
        console.log('[MapPicker] Using Leaflet (fallback)');
        return _engine;
    } catch (err2) {
        throw new Error('Failed to load any map engine: ' + err2.message);
    }
}

async function _preflightMapEndpoints() {
    _satelliteAvailable = true;

    // Style endpoint is mandatory for MapLibre.
    await _fetchWithTimeout(OPENFREEMAP_STYLE, 7000, 'OpenFreeMap style');

    // Satellite endpoint is optional (street mode still works).
    const satProbe = SATELLITE_TILES.replace('{z}', '2').replace('{y}', '1').replace('{x}', '1');

    try {
        await _fetchWithTimeout(satProbe, 7000, 'EOX satellite');
    } catch (err) {
        _satelliteAvailable = false;
        console.warn('[MapPicker] Satellite tiles unavailable, using street as default:', err?.message || err);
    }
}

async function _fetchWithTimeout(url, timeoutMs, label) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { method: 'GET', mode: 'cors', signal: ctrl.signal });
        if (!res.ok) {
            throw new Error(`${label} returned HTTP ${res.status}`);
        }
        return true;
    } catch (err) {
        throw new Error(`${label} preflight failed (${err?.message || 'network/CSP'})`);
    } finally {
        clearTimeout(timeout);
    }
}

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Open the map picker modal.
 * @param {Object} [options={}]
 * @param {'point'|'bounds'} [options.mode='point'] - 'point' = crosshair center,
 *        'bounds' = visible viewport bounds (for segment-geospatial tile selection)
 * @returns {Promise<{latitude: number, longitude: number}|{sw:{latitude,longitude}, ne:{latitude,longitude}}|null>}
 */
export async function openMapPickerModal(options = {}) {
    const { mode = 'point' } = options;
    const engine = await _ensureEngine();
    _injectStyles();

    return new Promise((resolve) => {
        const overlay = _buildOverlay();
        document.body.appendChild(overlay);

        // Bounds mode: hide crosshair, show viewport border, change button text
        if (mode === 'bounds') {
            const crosshair = overlay.querySelector('.map-picker-crosshair');
            if (crosshair) crosshair.style.display = 'none';

            const confirmBtn = overlay.querySelector('.map-picker-btn-confirm');
            if (confirmBtn) confirmBtn.textContent = t('selectVisibleArea') || 'Select Visible Area';

            // Add viewport border indicator
            const wrapper = overlay.querySelector('.map-picker-map-wrapper');
            if (wrapper) {
                const border = document.createElement('div');
                border.className = 'map-picker-bounds-indicator';
                border.style.cssText =
                    'position:absolute;inset:12px;border:3px dashed rgba(59,130,246,0.7);border-radius:4px;pointer-events:none;z-index:5;';
                wrapper.style.position = 'relative';
                wrapper.appendChild(border);
            }
        }

        // Animate in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => overlay.classList.add('active'));
        });

        const mapContainer = overlay.querySelector('.map-picker-map');
        const infoBar = overlay.querySelector('.map-picker-info');

        // Init map based on engine
        let mapInstance;
        if (engine === 'maplibre') {
            mapInstance = _initMapLibre(mapContainer, infoBar, overlay);
        } else {
            mapInstance = _initLeaflet(mapContainer, infoBar);
            _syncInitialLayerButtons(overlay);
            _setupLayerToggle(overlay, mapInstance, 'leaflet');
        }

        // Search
        _setupSearch(overlay, mapInstance, engine);

        // Buttons
        _setupButtons(overlay, mapInstance, resolve, mode);
    });
}

// ----------------------------------------------------------------
// BUILD OVERLAY
// ----------------------------------------------------------------

function _buildOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'map-picker-overlay';
    overlay.innerHTML = `
        <div class="map-picker-container">
            <button class="map-picker-close" title="Close">&times;</button>

            <div class="map-picker-header">
                <div class="map-picker-search">
                    <input type="text" class="map-picker-search-input"
                           placeholder="${t('initMapSearchPlaceholder')}">
                    <button class="map-picker-search-btn">&#9906;</button>
                </div>
                <div class="map-picker-layer-toggle">
                    <button class="map-picker-layer-btn" data-layer="street" title="Street">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7l6-3 6 3 6-3v14l-6 3-6-3-6 3V7z"/></svg>
                    </button>
                    <button class="map-picker-layer-btn active" data-layer="satellite" title="Satellite">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    </button>
                </div>
            </div>

            <div class="map-picker-map-wrapper">
                <div class="map-picker-map"></div>
                <div class="map-picker-crosshair">
                    <div class="map-picker-crosshair-h"></div>
                    <div class="map-picker-crosshair-v"></div>
                    <div class="map-picker-crosshair-dot"></div>
                </div>
            </div>

            <div class="map-picker-footer">
                <div class="map-picker-info">
                    <span class="map-picker-info-coords">Lat: -- | Lon: --</span>
                </div>
                <div class="map-picker-actions">
                    <button class="map-picker-btn-cancel">${t('initMapCancel')}</button>
                    <button class="map-picker-btn-confirm">${t('initMapConfirm')}</button>
                </div>
            </div>
        </div>
    `;
    return overlay;
}

// ----------------------------------------------------------------
// MAPLIBRE GL JS INIT
// ----------------------------------------------------------------

function _initMapLibre(container, infoBar, overlay) {
    const { startLat, startLon, startZoom } = _getStartPosition();

    const map = new window.maplibregl.Map({
        container,
        style: OPENFREEMAP_STYLE,
        center: [startLon, startLat],
        zoom: startZoom,
        attributionControl: true,
        maxZoom: 19,
    });

    // Add satellite raster source (initially visible)
    map.on('load', () => {
        if (_satelliteAvailable) {
            map.addSource('satellite', {
                type: 'raster',
                tiles: [SATELLITE_TILES],
                tileSize: 256,
                attribution: SATELLITE_ATTR,
            });
            map.addLayer(
                {
                    id: 'satellite-layer',
                    type: 'raster',
                    source: 'satellite',
                    layout: { visibility: 'visible' },
                },
                map.getStyle().layers[0]?.id,
            ); // Insert below all vector layers

            // Move satellite to bottom so vector labels are on top
            const layers = map.getStyle().layers;
            if (layers.length > 1) {
                map.moveLayer('satellite-layer', layers[0].id);
            }
        }
    });

    // Navigation controls
    map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    // Info bar updates
    const coordsEl = infoBar.querySelector('.map-picker-info-coords');
    const updateCoords = () => {
        const center = map.getCenter();
        coordsEl.textContent = `Lat: ${center.lat.toFixed(6)}  |  Lon: ${center.lng.toFixed(6)}`;
    };
    map.on('move', updateCoords);
    updateCoords();

    // Layer toggle buttons
    _syncInitialLayerButtons(overlay);
    _setupLayerToggle(overlay, map, 'maplibre');

    return map;
}

// ----------------------------------------------------------------
// LEAFLET INIT (fallback)
// ----------------------------------------------------------------

function _initLeaflet(container, infoBar) {
    const { startLat, startLon, startZoom } = _getStartPosition();

    // R7: Loading indicator while tiles load
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'map-loading-indicator';
    loadingOverlay.style.cssText =
        'position:absolute;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:var(--neutral-200,#d4dce1);color:var(--text-secondary,#414f59);font-size:12px;pointer-events:none;transition:opacity 0.3s;';
    loadingOverlay.textContent = 'Loading map...';
    container.style.position = 'relative';
    container.appendChild(loadingOverlay);

    const map = window.L.map(container, {
        center: [startLat, startLon],
        zoom: startZoom,
        zoomControl: true,
        attributionControl: true,
    });

    // Satellite layer (default)
    const satelliteLayer = window.L.tileLayer(SATELLITE_TILES.replace('{z}', '{z}'), {
        attribution: SATELLITE_ATTR,
        maxZoom: 19,
    });
    const streetLayer = window.L.tileLayer(OSM_TILES, {
        attribution: OSM_ATTR,
        maxZoom: 19,
    });
    if (_satelliteAvailable) {
        satelliteLayer.addTo(map);
    } else {
        streetLayer.addTo(map);
    }

    // R7: Hide loading indicator when first tile loads
    const activeForLoad = _satelliteAvailable ? satelliteLayer : streetLayer;
    activeForLoad.once('load', () => {
        loadingOverlay.style.opacity = '0';
        setTimeout(() => loadingOverlay.remove(), 300);
    });

    // Store layers for toggle
    map._ecbtLayers = { street: streetLayer, satellite: satelliteLayer };
    map._ecbtActiveLayer = _satelliteAvailable ? 'satellite' : 'street';

    // Info bar updates
    const coordsEl = infoBar.querySelector('.map-picker-info-coords');
    const update = () => {
        const center = map.getCenter();
        coordsEl.textContent = `Lat: ${center.lat.toFixed(6)}  |  Lon: ${center.lng.toFixed(6)}`;
    };
    map.on('moveend', update);
    map.on('zoomend', update);
    update();

    setTimeout(() => map.invalidateSize(), 400);

    return map;
}

// ----------------------------------------------------------------
// LAYER TOGGLE
// ----------------------------------------------------------------

function _setupLayerToggle(overlay, map, engine) {
    const buttons = overlay.querySelectorAll('.map-picker-layer-btn');

    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const layer = btn.dataset.layer;
            if (layer === 'satellite' && !_satelliteAvailable) return;

            // Update active state
            buttons.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');

            if (engine === 'maplibre') {
                if (layer === 'satellite') {
                    try {
                        map.setLayoutProperty('satellite-layer', 'visibility', 'visible');
                    } catch (_) {
                        /* not loaded yet */
                    }
                } else {
                    try {
                        map.setLayoutProperty('satellite-layer', 'visibility', 'none');
                    } catch (_) {
                        /* not loaded yet */
                    }
                }
            } else {
                // Leaflet
                const layers = map._ecbtLayers;
                if (layer === 'satellite') {
                    map.removeLayer(layers.street);
                    layers.satellite.addTo(map);
                } else {
                    map.removeLayer(layers.satellite);
                    layers.street.addTo(map);
                }
                map._ecbtActiveLayer = layer;
            }
        });
    });
}

function _syncInitialLayerButtons(overlay) {
    if (!overlay) return;
    const streetBtn = overlay.querySelector('.map-picker-layer-btn[data-layer="street"]');
    const satBtn = overlay.querySelector('.map-picker-layer-btn[data-layer="satellite"]');
    if (!streetBtn || !satBtn) return;

    if (_satelliteAvailable) {
        satBtn.classList.add('active');
        streetBtn.classList.remove('active');
        satBtn.disabled = false;
        satBtn.removeAttribute('aria-disabled');
    } else {
        streetBtn.classList.add('active');
        satBtn.classList.remove('active');
        satBtn.disabled = true;
        satBtn.setAttribute('aria-disabled', 'true');
        satBtn.title = 'Satellite unavailable';
    }
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function _getStartPosition() {
    let startLat = DEFAULT_LAT;
    let startLon = DEFAULT_LON;
    let startZoom = DEFAULT_ZOOM;

    if (hasOrigin()) {
        const origin = getOrigin();
        const wgs = utmToWGS84({
            easting: origin.easting,
            northing: origin.northing,
            zone: origin.zone,
            hemisphere: origin.hemisphere,
        });
        startLat = wgs.latitude;
        startLon = wgs.longitude;
        startZoom = 14;
    }

    return { startLat, startLon, startZoom };
}

// ----------------------------------------------------------------
// SEARCH (Nominatim)
// ----------------------------------------------------------------

function _setupSearch(overlay, map, engine) {
    const input = overlay.querySelector('.map-picker-search-input');
    const btn = overlay.querySelector('.map-picker-search-btn');
    let searching = false;

    async function doSearch() {
        const query = input.value.trim();
        if (!query || searching) return;

        searching = true;
        btn.disabled = true;
        btn.textContent = '...';

        try {
            const { geocodeAddress } = await import('../../core/llm/siteResearch.js');
            const result = await geocodeAddress(query);

            if (result) {
                if (engine === 'maplibre') {
                    map.flyTo({ center: [result.lon, result.lat], zoom: 15, duration: 1500 });
                } else {
                    map.flyTo([result.lat, result.lon], 15, { duration: 1.5 });
                }
            } else {
                input.style.borderColor = '#ef4444';
                setTimeout(() => {
                    input.style.borderColor = '';
                }, 2000);
            }
        } catch (e) {
            console.error('[MapPicker] Search error:', e.message);
        } finally {
            searching = false;
            btn.disabled = false;
            btn.textContent = '\u26C2';
        }
    }

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
    });
}

// ----------------------------------------------------------------
// BUTTONS
// ----------------------------------------------------------------

function _setupButtons(overlay, map, resolve, mode = 'point') {
    // Escape — registrado antes de close() para referencia na closure
    const escHandler = (e) => {
        if (e.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', escHandler);

    function close(result) {
        document.removeEventListener('keydown', escHandler);
        overlay.classList.remove('active');
        setTimeout(() => {
            map.remove();
            overlay.remove();
            resolve(result);
        }, 350);
    }

    // Confirm — return center or bounds based on mode
    overlay.querySelector('.map-picker-btn-confirm').addEventListener('click', () => {
        if (mode === 'bounds') {
            // Return viewport bounds for tile segmentation
            const bounds = map.getBounds();
            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();
            close({
                sw: { latitude: sw.lat, longitude: sw.lng },
                ne: { latitude: ne.lat, longitude: ne.lng },
            });
        } else {
            const center = map.getCenter();
            close({ latitude: center.lat, longitude: center.lng });
        }
    });

    // Cancel
    overlay.querySelector('.map-picker-btn-cancel').addEventListener('click', () => close(null));

    // Close X
    overlay.querySelector('.map-picker-close').addEventListener('click', () => close(null));
}

// ----------------------------------------------------------------
// STYLES (injected once)
// ----------------------------------------------------------------

let stylesInjected = false;

function _injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.textContent = `
        /* --- Map Picker Overlay --- */
        .map-picker-overlay {
            position: fixed;
            inset: 0;
            z-index: 8500;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.7);
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s ease, visibility 0.3s ease;
        }
        .map-picker-overlay.active {
            opacity: 1;
            visibility: visible;
        }

        /* --- Container --- */
        .map-picker-container {
            width: 92%;
            max-width: 1000px;
            height: 85vh;
            max-height: 750px;
            background: #1e1e2e;
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
            transform: translateY(20px);
            transition: transform 0.3s ease;
            position: relative;
        }
        .map-picker-overlay.active .map-picker-container {
            transform: translateY(0);
        }

        /* --- Close button --- */
        .map-picker-close {
            position: absolute;
            top: 8px;
            right: 12px;
            z-index: 10;
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 50%;
            color: rgba(255, 255, 255, 0.6);
            font-size: 20px;
            width: 32px;
            height: 32px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
        }
        .map-picker-close:hover {
            color: #fff;
            background: rgba(239,68,68,0.3);
            border-color: rgba(239,68,68,0.5);
        }

        /* --- Header (search + layer toggle) --- */
        .map-picker-header {
            display: flex;
            gap: 8px;
            padding: 10px 14px;
            background: #161622;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            align-items: center;
        }
        .map-picker-search {
            display: flex;
            gap: 6px;
            flex: 1;
        }
        .map-picker-search-input {
            flex: 1;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 8px 12px;
            color: #e2e8f0;
            font-size: 13px;
            outline: none;
            transition: border-color 0.2s;
        }
        .map-picker-search-input:focus {
            border-color: rgba(59, 130, 246, 0.5);
        }
        .map-picker-search-input::placeholder {
            color: rgba(255, 255, 255, 0.3);
        }
        .map-picker-search-btn {
            background: rgba(59, 130, 246, 0.2);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 8px;
            padding: 8px 14px;
            color: #60a5fa;
            font-size: 15px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .map-picker-search-btn:hover {
            background: rgba(59, 130, 246, 0.35);
        }

        /* --- Layer toggle buttons --- */
        .map-picker-layer-toggle {
            display: flex;
            gap: 2px;
            background: rgba(255,255,255,0.05);
            border-radius: 8px;
            padding: 2px;
        }
        .map-picker-layer-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            background: transparent;
            border: none;
            border-radius: 6px;
            color: rgba(255,255,255,0.4);
            cursor: pointer;
            transition: all 0.15s;
        }
        .map-picker-layer-btn:hover {
            color: rgba(255,255,255,0.7);
            background: rgba(255,255,255,0.08);
        }
        .map-picker-layer-btn.active {
            color: #60a5fa;
            background: rgba(59,130,246,0.15);
        }

        /* --- Map wrapper (with crosshair) --- */
        .map-picker-map-wrapper {
            flex: 1;
            position: relative;
            min-height: 0;
        }
        .map-picker-map {
            width: 100%;
            height: 100%;
        }

        /* --- Crosshair --- */
        .map-picker-crosshair {
            position: absolute;
            inset: 0;
            pointer-events: none;
            z-index: 1000;
        }
        .map-picker-crosshair-h,
        .map-picker-crosshair-v {
            position: absolute;
            background: rgba(239, 68, 68, 0.6);
        }
        .map-picker-crosshair-h {
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 40px;
            height: 1.5px;
        }
        .map-picker-crosshair-v {
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 1.5px;
            height: 40px;
        }
        .map-picker-crosshair-dot {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: rgba(239, 68, 68, 0.8);
            box-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
        }

        /* --- Footer (info + actions) --- */
        .map-picker-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 14px;
            background: #161622;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .map-picker-info {
            font-size: 12px;
            color: rgba(255, 255, 255, 0.5);
            font-family: 'JetBrains Mono', Consolas, monospace;
            letter-spacing: 0.3px;
        }
        .map-picker-actions {
            display: flex;
            gap: 10px;
        }
        .map-picker-btn-cancel {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 8px 20px;
            color: #94a3b8;
            font-size: 13px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .map-picker-btn-cancel:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        .map-picker-btn-confirm {
            background: #3b82f6;
            border: none;
            border-radius: 8px;
            padding: 8px 22px;
            color: #fff;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s;
        }
        .map-picker-btn-confirm:hover {
            background: #2563eb;
        }

        /* --- MapLibre overrides (dark theme) --- */
        .map-picker-map .maplibregl-ctrl-attrib {
            background: rgba(0,0,0,0.5) !important;
            color: rgba(255,255,255,0.5) !important;
            font-size: 10px !important;
        }
        .map-picker-map .maplibregl-ctrl-attrib a {
            color: rgba(100,180,255,0.7) !important;
        }
        .map-picker-map .maplibregl-ctrl button {
            background: rgba(30,30,46,0.9) !important;
            border: 1px solid rgba(255,255,255,0.1) !important;
        }
        .map-picker-map .maplibregl-ctrl button span {
            filter: invert(1) !important;
        }

        /* --- Leaflet overrides (dark theme, fallback) --- */
        .map-picker-map .leaflet-control-layers {
            background: #1e1e2e;
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #e2e8f0;
            border-radius: 8px;
            padding: 8px 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
        .map-picker-map .leaflet-control-layers label {
            color: #e2e8f0;
        }

        /* --- Responsive --- */
        @media (max-width: 600px) {
            .map-picker-container {
                width: 98%;
                height: 92vh;
                border-radius: 10px;
            }
            .map-picker-footer {
                flex-direction: column;
                gap: 8px;
            }
        }
    `;
    document.head.appendChild(style);
}
