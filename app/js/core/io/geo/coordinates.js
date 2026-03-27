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
   GEOREFERENCING — Coordinate transformations
   ================================================================

   Converte coordenadas entre o sistema relativo da aplicação (Three.js)
   e sistemas absolutos (UTM, WGS84 lat/lon).

   SISTEMA INTERNO (Three.js):
   - X = easting offset (metros da origem)
   - Y = vertical (elevação, positivo para cima)
   - Z = northing offset (positivo = sul em Three.js, invertido)

   TRANSFORMAÇÕES:
   - Relativo → UTM absoluto (soma offset de origem)
   - UTM → WGS84 lat/lon (fórmulas do elipsoide WGS84)
   - Inversas para importação

   ================================================================ */

import { safeSetItem } from '../../../utils/storage/storageMonitor.js';
import { normalizeUTMInput, normalizeWGS84Input } from './crsAdapter.js';

// ----------------------------------------------------------------
// CONSTANTES DO ELIPSOIDE WGS84
// ----------------------------------------------------------------

const WGS84 = {
    a: 6378137.0, // Semi-eixo maior (metros)
    f: 1 / 298.257223563, // Achatamento
    get b() {
        return this.a * (1 - this.f);
    },
    get e() {
        return Math.sqrt(2 * this.f - this.f * this.f);
    },
    get e2() {
        return 2 * this.f - this.f * this.f;
    },
    get ep2() {
        return this.e2 / (1 - this.e2);
    },
};

const K0 = 0.9996; // Fator de escala UTM
const FALSE_EASTING = 500000;
const FALSE_NORTHING_S = 10000000; // Para hemisfério sul

// ----------------------------------------------------------------
// ESTADO — Origem UTM do modelo
// ----------------------------------------------------------------

const ORIGIN_STORAGE_KEY = 'ecbyts-last-origin';

let utmOrigin = {
    easting: 0,
    northing: 0,
    elevation: 0,
    zone: 23,
    hemisphere: 'S',
};

/**
 * Define a origem UTM do modelo.
 * Chamado quando o usuário configura o ponto de referência.
 * Persiste no localStorage para restaurar em sessões futuras.
 *
 * @param {Object} origin - { easting, northing, elevation, zone, hemisphere }
 */
export function setOrigin(origin) {
    const oldOrigin = { ...utmOrigin };
    utmOrigin = { ...utmOrigin, ...origin };

    // Persiste origem no localStorage para modo "Último Local"
    _persistOrigin();

    // Notifica HUD do globo e elementos que a origem mudou
    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('originChanged', {
                detail: { oldOrigin, newOrigin: { ...utmOrigin } },
            }),
        );
    }
}

/**
 * Persiste a origem atual no localStorage.
 * Salva apenas se a origem é não-trivial (easting ou northing != 0).
 */
function _persistOrigin() {
    if (utmOrigin.easting === 0 && utmOrigin.northing === 0) return;
    safeSetItem(
        ORIGIN_STORAGE_KEY,
        JSON.stringify({
            easting: utmOrigin.easting,
            northing: utmOrigin.northing,
            elevation: utmOrigin.elevation,
            zone: utmOrigin.zone,
            hemisphere: utmOrigin.hemisphere,
        }),
    );
}

/**
 * Restaura a última origem salva no localStorage.
 * Retorna null se não houver origem salva.
 *
 * @returns {Object|null} - { easting, northing, elevation, zone, hemisphere } ou null
 */
export function getLastSavedOrigin() {
    try {
        const raw = localStorage.getItem(ORIGIN_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed) return null;
        // Valida que os valores são números finitos (protege contra NaN/Infinity/lixo)
        if (!Number.isFinite(parsed.easting) || !Number.isFinite(parsed.northing)) return null;
        if (parsed.easting === 0 && parsed.northing === 0) return null;
        // Garante zona válida (1-60)
        const zone = parseInt(parsed.zone, 10);
        if (!Number.isFinite(zone) || zone < 1 || zone > 60) return null;
        return {
            easting: parsed.easting,
            northing: parsed.northing,
            elevation: Number.isFinite(parsed.elevation) ? parsed.elevation : 0,
            zone,
            hemisphere: parsed.hemisphere === 'N' ? 'N' : 'S',
        };
    } catch {
        return null;
    }
}

/**
 * Obtém a origem UTM atual.
 *
 * @returns {Object}
 */
export function getOrigin() {
    return { ...utmOrigin };
}

/**
 * Verifica se a origem foi configurada (diferente de 0,0).
 *
 * @returns {boolean}
 */
export function hasOrigin() {
    return utmOrigin.easting !== 0 || utmOrigin.northing !== 0;
}

/**
 * Retorna origem efetiva para conversões UTM.
 * Quando a origem não está configurada (0,0), usa fallback neutro
 * correspondente a 0°N, 0°E (Equador/Greenwich) — zona UTM 31N.
 *
 * @returns {Object} - Origem UTM válida para cálculos
 */
export function getEffectiveOrigin() {
    if (hasOrigin()) {
        return { ...utmOrigin };
    }
    // Fallback: UTM de (0°N, 0°E) — zona 31N
    return {
        easting: 166021,
        northing: 0,
        elevation: 0,
        zone: 31,
        hemisphere: 'N',
    };
}

// ----------------------------------------------------------------
// CONVERSÃO: Relativo → UTM
// ----------------------------------------------------------------

/**
 * Converte coordenadas relativas (Three.js) para UTM absolutas.
 * Three.js Z é invertido em relação ao northing.
 * Usa getEffectiveOrigin() para garantir UTM válido mesmo sem origem configurada.
 *
 * @param {{ x: number, y: number, z: number }} rel - Coordenadas relativas
 * @returns {{ easting: number, northing: number, elevation: number, zone: number, hemisphere: string }}
 */
export function relativeToUTM(rel) {
    const origin = getEffectiveOrigin();
    return {
        easting: origin.easting + (rel.x || 0),
        northing: origin.northing - (rel.z || 0),
        elevation: origin.elevation + (rel.y || 0),
        zone: origin.zone,
        hemisphere: origin.hemisphere,
    };
}

// ----------------------------------------------------------------
// CONVERSÃO: UTM → WGS84
// ----------------------------------------------------------------

/**
 * Converte coordenadas UTM para WGS84 (latitude/longitude).
 * Implementação padrão do algoritmo de Karney simplificado.
 *
 * @param {{ easting: number, northing: number, zone: number, hemisphere: string }} utm
 * @returns {{ latitude: number, longitude: number }}
 */
export function utmToWGS84(utm) {
    const norm = normalizeUTMInput(utm);
    if (!norm.valid) {
        return { latitude: NaN, longitude: NaN };
    }
    const { easting, northing, zone, hemisphere } = norm;
    const { a, e2, ep2 } = WGS84;
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

    // Remove false easting/northing
    const x = easting - FALSE_EASTING;
    const y = hemisphere === 'S' ? northing - FALSE_NORTHING_S : northing;

    // Meridiano central da zona
    const lonOrigin = (zone - 1) * 6 - 180 + 3;

    const M = y / K0;
    const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));

    // Latitude do pé (footpoint latitude)
    const phi1 =
        mu +
        ((3 * e1) / 2 - (27 * e1 * e1 * e1) / 32) * Math.sin(2 * mu) +
        ((21 * e1 * e1) / 16 - (55 * e1 * e1 * e1 * e1) / 32) * Math.sin(4 * mu) +
        ((151 * e1 * e1 * e1) / 96) * Math.sin(6 * mu) +
        ((1097 * e1 * e1 * e1 * e1) / 512) * Math.sin(8 * mu);

    const sinPhi1 = Math.sin(phi1);
    const cosPhi1 = Math.cos(phi1);
    const tanPhi1 = Math.tan(phi1);

    const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
    const T1 = tanPhi1 * tanPhi1;
    const C1 = ep2 * cosPhi1 * cosPhi1;
    const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
    const D = x / (N1 * K0);

    // Latitude
    const lat =
        phi1 -
        ((N1 * tanPhi1) / R1) *
            ((D * D) / 2 -
                ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D * D * D * D) / 24 +
                ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D * D * D * D * D * D) / 720);

    // Longitude
    const lon =
        (D -
            ((1 + 2 * T1 + C1) * D * D * D) / 6 +
            ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D * D * D * D * D) / 120) /
        cosPhi1;

    return {
        latitude: toDegrees(lat),
        longitude: toDegrees(lon) + lonOrigin,
    };
}

// ----------------------------------------------------------------
// CONVERSÃO: WGS84 → UTM
// ----------------------------------------------------------------

/**
 * Converte WGS84 (lat/lon) para UTM.
 *
 * @param {{ latitude: number, longitude: number }} latLon
 * @param {number} [forceZone] - Forçar zona UTM específica
 * @returns {{ easting: number, northing: number, zone: number, hemisphere: string }}
 */
export function wgs84ToUTM(latLon, forceZone) {
    const norm = normalizeWGS84Input(latLon);
    if (!norm.valid) {
        return {
            easting: NaN,
            northing: NaN,
            zone: Number.isFinite(forceZone) ? Number(forceZone) : 0,
            hemisphere: 'N',
        };
    }

    const { a, e2, ep2 } = WGS84;
    const lat = toRadians(norm.latitude);
    const lon = toRadians(norm.longitude);

    const zone = forceZone || Math.floor((norm.longitude + 180) / 6) + 1;
    const lonOrigin = toRadians((zone - 1) * 6 - 180 + 3);

    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const tanLat = Math.tan(lat);

    const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    const T = tanLat * tanLat;
    const C = ep2 * cosLat * cosLat;
    const A = cosLat * (lon - lonOrigin);

    const M =
        a *
        ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * lat -
            ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * lat) +
            ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * lat) -
            ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * lat));

    const easting =
        K0 *
            N *
            (A + ((1 - T + C) * A * A * A) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A * A * A * A * A) / 120) +
        FALSE_EASTING;

    let northing =
        K0 *
        (M +
            N *
                tanLat *
                ((A * A) / 2 +
                    ((5 - T + 9 * C + 4 * C * C) * A * A * A * A) / 24 +
                    ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A * A * A * A * A * A) / 720));

    if (norm.latitude < 0) {
        northing += FALSE_NORTHING_S;
    }

    return {
        easting,
        northing,
        zone,
        hemisphere: norm.latitude >= 0 ? 'N' : 'S',
    };
}

// ----------------------------------------------------------------
// CONVERSÃO: UTM → Relativo
// ----------------------------------------------------------------

/**
 * Converte UTM absolutas para coordenadas relativas (Three.js).
 * Usa getEffectiveOrigin() para garantir UTM válido mesmo sem origem configurada.
 *
 * @param {{ easting: number, northing: number, elevation?: number }} utm
 * @returns {{ x: number, y: number, z: number }}
 */
export function utmToRelative(utm) {
    const origin = getEffectiveOrigin();
    return {
        x: (utm.easting || 0) - origin.easting,
        y: (utm.elevation || 0) - origin.elevation,
        z: -((utm.northing || 0) - origin.northing),
    };
}

// ----------------------------------------------------------------
// ATALHOS COMPOSTOS
// ----------------------------------------------------------------

/**
 * Relativo → WGS84 direto.
 *
 * @param {{ x: number, y: number, z: number }} rel
 * @returns {{ latitude: number, longitude: number, elevation: number }}
 */
export function relativeToWGS84(rel) {
    const utm = relativeToUTM(rel);
    const wgs = utmToWGS84(utm);
    return { ...wgs, elevation: utm.elevation };
}

/**
 * WGS84 → Relativo direto.
 *
 * @param {{ latitude: number, longitude: number, elevation?: number }} latLon
 * @returns {{ x: number, y: number, z: number }}
 */
export function wgs84ToRelative(latLon) {
    const origin = getEffectiveOrigin();
    const utm = wgs84ToUTM(latLon, origin.zone);
    return utmToRelative({ ...utm, elevation: latLon.elevation || 0 });
}

/**
 * Calcula código EPSG a partir de zona UTM e hemisfério.
 * Norte: EPSG:326xx, Sul: EPSG:327xx
 *
 * @param {number} zone
 * @param {string} hemisphere - 'N' ou 'S'
 * @returns {number}
 */
export function getEPSG(zone, hemisphere) {
    return hemisphere === 'N' ? 32600 + zone : 32700 + zone;
}

// ----------------------------------------------------------------
// UTILIDADES
// ----------------------------------------------------------------

function toRadians(deg) {
    return (deg * Math.PI) / 180;
}
function toDegrees(rad) {
    return (rad * 180) / Math.PI;
}

/**
 * Extrai posição {x, y, z} de um elemento, independente da família.
 * Diferentes famílias armazenam posição de formas diferentes.
 *
 * @param {Object} element - Elemento do modelo
 * @returns {{ x: number, y: number, z: number }}
 */
export function getElementPosition(element) {
    const d = element.data || {};

    // Plume: center
    if (d.center) {
        return { x: d.center.x || 0, y: d.center.y || 0, z: d.center.z || 0 };
    }

    // Well: coordinates (easting/northing)
    if (d.coordinates) {
        return {
            x: d.coordinates.easting || 0,
            y: d.coordinates.elevation || 0,
            z: d.coordinates.northing || 0,
        };
    }

    // Generic: position
    if (d.position) {
        return { x: d.position.x || 0, y: d.position.y || 0, z: d.position.z || 0 };
    }

    // River/Path: midpoint
    if (d.path && d.path.length > 0) {
        const mid = d.path[Math.floor(d.path.length / 2)];
        return { x: mid.x || 0, y: mid.y || 0, z: mid.z || 0 };
    }

    // Boundary: centroid
    if (d.vertices && d.vertices.length > 0) {
        const cx = d.vertices.reduce((s, v) => s + (v.x || 0), 0) / d.vertices.length;
        const cy = d.vertices.reduce((s, v) => s + (v.y || 0), 0) / d.vertices.length;
        const cz = d.vertices.reduce((s, v) => s + (v.z || 0), 0) / d.vertices.length;
        return { x: cx, y: cy, z: cz };
    }

    return { x: 0, y: 0, z: 0 };
}

/**
 * Re-projeta todos os elementos apos mudanca de origin.
 * Converte coordenadas relativas (old origin) → absolutas UTM → relativas (new origin).
 * Trata os 5 padroes de posicao: center, coordinates, position, path, vertices.
 *
 * @param {Object} oldOrigin - { easting, northing }
 * @param {Object} newOrigin - { easting, northing }
 */
export function reProjectAllElements(oldOrigin, newOrigin) {
    const { getAllElements } = _getElementsManager();
    if (!getAllElements) return;

    const dx = oldOrigin.easting - newOrigin.easting;
    const dz = oldOrigin.northing - newOrigin.northing;
    if (dx === 0 && dz === 0) return;

    for (const el of getAllElements()) {
        const d = el.data;
        if (!d) continue;

        if (d.center) {
            d.center.x = (d.center.x || 0) + dx;
            d.center.z = (d.center.z || 0) + dz;
        }
        if (d.coordinates) {
            d.coordinates.easting = (d.coordinates.easting || 0) + dx;
            d.coordinates.northing = (d.coordinates.northing || 0) + dz;
        }
        if (d.position) {
            d.position.x = (d.position.x || 0) + dx;
            d.position.z = (d.position.z || 0) + dz;
        }
        if (d.path && Array.isArray(d.path)) {
            for (const pt of d.path) {
                pt.x = (pt.x || 0) + dx;
                pt.z = (pt.z || 0) + dz;
            }
        }
        if (d.vertices && Array.isArray(d.vertices)) {
            for (const v of d.vertices) {
                v.x = (v.x || 0) + dx;
                v.z = (v.z || 0) + dz;
            }
        }
    }
}

// Lazy reference para evitar circular dependency com elements/manager.js
// Injetada por main.js apos boot via setElementsGetter()
let _getAllElementsFn = null;

/**
 * Registra a funcao getAllElements para uso em reProjectAllElements.
 * Chamada por main.js para evitar circular import.
 * @param {Function} fn - getAllElements do elements/manager.js
 */
export function setElementsGetter(fn) {
    _getAllElementsFn = fn;
}

function _getElementsManager() {
    return { getAllElements: _getAllElementsFn || (() => []) };
}
