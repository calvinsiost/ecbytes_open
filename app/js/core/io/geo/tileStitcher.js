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
   TILE STITCHER — Canvas-based satellite tile compositor
   ================================================================

   Compõe tiles XYZ em uma imagem recortada por bbox (bounding box).
   Substitui o endpoint proprietário Esri MapServer/export por um
   processo 100% client-side usando tiles livres Sentinel-2 Cloudless.

   STACK:
   - Sentinel-2 Cloudless 2021 by EOX (CC BY 4.0 / Copernicus data)
   - Canvas 2D API (offscreen compositing)
   - Sem dependências externas, sem API key

   ALGORITMO:
   1. Calcular zoom ideal para o bbox (max 14 = resolução nativa 10m)
   2. Calcular quais tiles XYZ cobrem o bbox
   3. Fetch tiles em paralelo com timeout
   4. Compor no canvas na posição correta
   5. Recortar ao bbox exato (sub-tile precision)
   6. Exportar como data URL JPEG

   ================================================================ */

// ----------------------------------------------------------------
// TILE PROVIDERS
// ----------------------------------------------------------------

const PROVIDERS = [
    {
        name: 'Sentinel-2 Cloudless 2021',
        url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
        maxZoom: 14,
        attribution: 'Sentinel-2 cloudless — s2maps.eu by EOX (Copernicus Sentinel data 2021)',
    },
    {
        name: 'Sentinel-2 Cloudless 2018',
        url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2018_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
        maxZoom: 14,
        attribution: 'Sentinel-2 cloudless — s2maps.eu by EOX (Copernicus Sentinel data 2018)',
    },
    {
        name: 'ESRI World Imagery',
        // Endpoint legacy sem token — alta resolucao (zoom 19), CORS habilitado
        url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maxZoom: 19,
        attribution: 'Esri, Maxar, Earthstar Geographics',
    },
    {
        name: 'USGS Imagery',
        // NAIP 1m nos EUA, Landsat fallback global — public domain
        url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
        maxZoom: 16,
        attribution: 'USGS National Map',
    },
    {
        name: 'NASA Blue Marble',
        // Imagem composta global (batimetria + relevo) — public domain
        url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg',
        maxZoom: 8,
        attribution: 'NASA GIBS',
    },
    {
        name: 'OpenStreetMap',
        // OpenFreeMap liberty style — raster PNG. Pode falhar com CORS em canvas stitching.
        url: 'https://tile.openfreemap.org/styles/liberty/{z}/{x}/{y}.png',
        maxZoom: 18,
        attribution: '© OpenStreetMap contributors',
    },
];

// Sentinel-2 resolução nativa ~10m → acima de zoom 14, tiles são upscaled
const DEFAULT_MAX_ZOOM = 14;
const TILE_SIZE = 256;
const FETCH_TIMEOUT_MS = 5000;

// Cache para evitar re-fetch em edições repetidas do boundary
const _cache = new Map();
const MAX_CACHE_SIZE = 20;

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Stitch satellite tiles into a single image covering a bounding box.
 * Compõe tiles de satélite em uma imagem única cobrindo um bbox.
 *
 * @param {{ latitude: number, longitude: number }} sw - Southwest corner (WGS84)
 * @param {{ latitude: number, longitude: number }} ne - Northeast corner (WGS84)
 * @param {number} [outputSize=256] - Desired output size in pixels (square)
 * @returns {Promise<string>} Data URL (JPEG) or empty string on failure
 */
export async function stitchTiles(sw, ne, outputSize = 256) {
    // Cache key baseada no bbox arredondado (evita re-fetch para micro-edições)
    const cacheKey = [
        sw.latitude.toFixed(5),
        sw.longitude.toFixed(5),
        ne.latitude.toFixed(5),
        ne.longitude.toFixed(5),
        outputSize,
    ].join('|');

    if (_cache.has(cacheKey)) return _cache.get(cacheKey);

    // Tenta cada provider em sequência
    for (const provider of PROVIDERS) {
        try {
            const result = await _stitchFromProvider(provider, sw, ne, outputSize);
            if (result) {
                _cacheResult(cacheKey, result);
                return result;
            }
        } catch (err) {
            console.warn(`[TileStitcher] ${provider.name} failed:`, err.message);
        }
    }

    console.error('[TileStitcher] All providers failed');
    return '';
}

/**
 * Stitch tiles using a specific provider (no fallback chain).
 * Compõe tiles usando um provedor específico, sem tentar outros.
 *
 * @param {number} providerIndex - Index in TILE_PROVIDERS array
 * @param {{ latitude: number, longitude: number }} sw - Southwest corner (WGS84)
 * @param {{ latitude: number, longitude: number }} ne - Northeast corner (WGS84)
 * @param {number} [outputSize=256] - Desired output size in pixels (square)
 * @returns {Promise<string>} Data URL (JPEG) or empty string on failure
 */
export async function stitchTilesWithProvider(providerIndex, sw, ne, outputSize = 256) {
    const provider = PROVIDERS[providerIndex];
    if (!provider) {
        console.error(`[TileStitcher] Invalid provider index: ${providerIndex}`);
        return '';
    }

    const cacheKey = [
        providerIndex,
        sw.latitude.toFixed(5),
        sw.longitude.toFixed(5),
        ne.latitude.toFixed(5),
        ne.longitude.toFixed(5),
        outputSize,
    ].join('|');

    if (_cache.has(cacheKey)) return _cache.get(cacheKey);

    try {
        const result = await _stitchFromProvider(provider, sw, ne, outputSize);
        if (result) {
            _cacheResult(cacheKey, result);
            return result;
        }
    } catch (err) {
        console.warn(`[TileStitcher] ${provider.name} failed:`, err.message);
    }

    return '';
}

/**
 * Available tile providers (read-only reference).
 * Provedores de tiles disponíveis para seleção pelo usuário.
 */
export { PROVIDERS as TILE_PROVIDERS };

/**
 * Clear the tile cache (e.g., when switching providers).
 */
export function clearTileCache() {
    _cache.clear();
}

/**
 * Stitch tiles using a custom URL template (e.g., Mapbox with API key).
 * Compõe tiles usando URL arbitrária com template {z}/{x}/{y}.
 *
 * @param {string} templateUrl - URL template com {z}, {x}, {y} placeholders
 * @param {number} maxZoom - Maximum zoom level for this provider
 * @param {{ latitude: number, longitude: number }} sw - Southwest corner (WGS84)
 * @param {{ latitude: number, longitude: number }} ne - Northeast corner (WGS84)
 * @param {number} [outputSize=256] - Desired output size in pixels (square)
 * @returns {Promise<string>} Data URL (JPEG) or empty string on failure
 */
export async function stitchTilesWithCustomUrl(templateUrl, maxZoom, sw, ne, outputSize = 256) {
    const provider = { name: 'Custom', url: templateUrl, maxZoom, attribution: '' };

    const cacheKey = [
        'custom',
        templateUrl.substring(0, 60),
        sw.latitude.toFixed(5),
        sw.longitude.toFixed(5),
        ne.latitude.toFixed(5),
        ne.longitude.toFixed(5),
        outputSize,
    ].join('|');

    if (_cache.has(cacheKey)) return _cache.get(cacheKey);

    try {
        const result = await _stitchFromProvider(provider, sw, ne, outputSize);
        if (result) {
            _cacheResult(cacheKey, result);
            return result;
        }
    } catch (err) {
        console.warn(`[TileStitcher] Custom provider failed:`, err.message);
    }

    return '';
}

// ----------------------------------------------------------------
// TILE MATH
// ----------------------------------------------------------------

/**
 * Convert latitude to Web Mercator tile Y coordinate.
 * @param {number} lat - Latitude in degrees
 * @param {number} zoom - Zoom level
 * @returns {number} Tile Y index
 */
function _latToTileY(lat, zoom) {
    const latRad = (lat * Math.PI) / 180;
    const n = Math.pow(2, zoom);
    return Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
}

/**
 * Convert longitude to Web Mercator tile X coordinate.
 * @param {number} lon - Longitude in degrees
 * @param {number} zoom - Zoom level
 * @returns {number} Tile X index
 */
function _lonToTileX(lon, zoom) {
    const n = Math.pow(2, zoom);
    return Math.floor(((lon + 180) / 360) * n);
}

/**
 * Convert tile Y to latitude (north edge of tile).
 * @param {number} y - Tile Y index
 * @param {number} zoom - Zoom level
 * @returns {number} Latitude in degrees
 */
function _tileYToLat(y, zoom) {
    const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Convert tile X to longitude (west edge of tile).
 * @param {number} x - Tile X index
 * @param {number} zoom - Zoom level
 * @returns {number} Longitude in degrees
 */
function _tileXToLon(x, zoom) {
    return (x / Math.pow(2, zoom)) * 360 - 180;
}

/**
 * Calculate optimal zoom level for a bounding box.
 * Sentinel-2 nativo = 10m/pixel → zoom 14 é o limite útil.
 *
 * @param {number} lonExtent - Longitude extent in degrees
 * @param {number} maxZoom - Provider max zoom
 * @returns {number} Zoom level
 */
function _calculateZoom(lonExtent, maxZoom) {
    if (lonExtent <= 0) return maxZoom;
    const zoom = Math.floor(Math.log2(360 / lonExtent)) + 1;
    return Math.max(1, Math.min(maxZoom, zoom));
}

// ----------------------------------------------------------------
// TILE FETCHING
// ----------------------------------------------------------------

/**
 * Fetch a single tile image with timeout.
 * Busca uma tile com timeout via AbortController.
 *
 * @param {string} url - Tile URL
 * @returns {Promise<HTMLImageElement>}
 */
function _fetchTile(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        const timer = setTimeout(() => {
            img.src = '';
            reject(new Error(`Timeout fetching tile: ${url}`));
        }, FETCH_TIMEOUT_MS);

        img.onload = () => {
            clearTimeout(timer);
            resolve(img);
        };
        img.onerror = () => {
            clearTimeout(timer);
            reject(new Error(`Failed to load tile: ${url}`));
        };
        img.src = url;
    });
}

/**
 * Build tile URL from template.
 * @param {string} template - URL template with {z}/{x}/{y}
 * @param {number} z - Zoom
 * @param {number} x - Tile X
 * @param {number} y - Tile Y
 * @returns {string}
 */
function _buildTileUrl(template, z, x, y) {
    return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

// ----------------------------------------------------------------
// STITCHING
// ----------------------------------------------------------------

/**
 * Attempt to stitch tiles from a single provider.
 * Tenta compor tiles de um único provedor.
 *
 * @param {Object} provider - Provider config
 * @param {{ latitude: number, longitude: number }} sw
 * @param {{ latitude: number, longitude: number }} ne
 * @param {number} outputSize
 * @returns {Promise<string|null>} Data URL or null on failure
 */
async function _stitchFromProvider(provider, sw, ne, outputSize) {
    const lonExtent = Math.abs(ne.longitude - sw.longitude);
    const zoom = _calculateZoom(lonExtent, provider.maxZoom);

    // Tiles que cobrem o bbox
    const minTileX = _lonToTileX(sw.longitude, zoom);
    const maxTileX = _lonToTileX(ne.longitude, zoom);
    const minTileY = _latToTileY(ne.latitude, zoom); // norte = Y menor
    const maxTileY = _latToTileY(sw.latitude, zoom); // sul = Y maior

    const tilesWide = maxTileX - minTileX + 1;
    const tilesHigh = maxTileY - minTileY + 1;

    // Segurança: limitar a 4x4 tiles max (evitar download massivo)
    if (tilesWide > 4 || tilesHigh > 4) {
        console.warn(`[TileStitcher] Too many tiles (${tilesWide}x${tilesHigh}), reducing zoom`);
        return _stitchFromProvider({ ...provider, maxZoom: Math.max(1, zoom - 1) }, sw, ne, outputSize);
    }

    // Fetch todas as tiles em paralelo
    const tilePromises = [];
    for (let ty = minTileY; ty <= maxTileY; ty++) {
        for (let tx = minTileX; tx <= maxTileX; tx++) {
            const url = _buildTileUrl(provider.url, zoom, tx, ty);
            tilePromises.push(
                _fetchTile(url)
                    .then((img) => ({ tx, ty, img }))
                    .catch(() => ({ tx, ty, img: null })), // tile individual falha = skip
            );
        }
    }

    const tiles = await Promise.all(tilePromises);
    const loadedTiles = tiles.filter((t) => t.img !== null);

    if (loadedTiles.length === 0) return null; // nenhuma tile carregou

    // Canvas temporário para composição (tamanho total das tiles)
    const compCanvas = document.createElement('canvas');
    compCanvas.width = tilesWide * TILE_SIZE;
    compCanvas.height = tilesHigh * TILE_SIZE;
    const compCtx = compCanvas.getContext('2d');

    // Desenha cada tile na posição correta
    for (const { tx, ty, img } of loadedTiles) {
        const dx = (tx - minTileX) * TILE_SIZE;
        const dy = (ty - minTileY) * TILE_SIZE;
        compCtx.drawImage(img, dx, dy, TILE_SIZE, TILE_SIZE);
    }

    // Recortar ao bbox exato (sub-tile precision)
    // Calcula pixel offset do bbox dentro do canvas de tiles
    const totalLonMin = _tileXToLon(minTileX, zoom);
    const totalLonMax = _tileXToLon(maxTileX + 1, zoom);
    const totalLatMax = _tileYToLat(minTileY, zoom); // norte
    const totalLatMin = _tileYToLat(maxTileY + 1, zoom); // sul

    const totalWidth = compCanvas.width;
    const totalHeight = compCanvas.height;

    // Offset do bbox dentro do canvas (fração de pixel)
    const cropX = ((sw.longitude - totalLonMin) / (totalLonMax - totalLonMin)) * totalWidth;
    const cropY = ((totalLatMax - ne.latitude) / (totalLatMax - totalLatMin)) * totalHeight;
    const cropW = ((ne.longitude - sw.longitude) / (totalLonMax - totalLonMin)) * totalWidth;
    const cropH = ((ne.latitude - sw.latitude) / (totalLatMax - totalLatMin)) * totalHeight;

    // Canvas de saída no tamanho solicitado
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outputSize;
    outCanvas.height = outputSize;
    const outCtx = outCanvas.getContext('2d');

    outCtx.drawImage(
        compCanvas,
        cropX,
        cropY,
        cropW,
        cropH, // source rect (crop do bbox)
        0,
        0,
        outputSize,
        outputSize, // dest rect (output quadrado)
    );

    return outCanvas.toDataURL('image/jpeg', 0.8);
}

// ----------------------------------------------------------------
// CACHE
// ----------------------------------------------------------------

/**
 * Add result to cache with LRU eviction.
 * @param {string} key
 * @param {string} value
 */
function _cacheResult(key, value) {
    if (_cache.size >= MAX_CACHE_SIZE) {
        // Evict oldest entry
        const firstKey = _cache.keys().next().value;
        _cache.delete(firstKey);
    }
    _cache.set(key, value);
}
