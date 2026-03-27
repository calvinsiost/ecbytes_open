// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   GEO PROJECTION — Lat/Long to local XYZ coordinates
   Conversao de coordenadas geograficas para o sistema local 3D.

   Usa projecao centroide-relativa: o centro do site vira (0, 0, 0)
   e os pontos sao deslocados em metros usando formula de Haversine.
   ================================================================ */

/**
 * Converte graus para radianos.
 * @param {number} deg
 * @returns {number}
 */
function toRad(deg) {
    return (deg * Math.PI) / 180;
}

/**
 * Calcula distancia em metros entre dois pontos lat/long.
 * Formula de Haversine — precisao suficiente para areas de ate ~50km.
 *
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} distancia em metros
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // raio medio da Terra em metros
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calcula o centroide (media) de um array de coordenadas.
 *
 * @param {Array<{latitude: number, longitude: number}>} points
 * @returns {{latitude: number, longitude: number}}
 */
export function computeCentroid(points) {
    if (!points.length) return { latitude: 0, longitude: 0 };
    const sum = points.reduce(
        (acc, p) => ({
            latitude: acc.latitude + p.latitude,
            longitude: acc.longitude + p.longitude,
        }),
        { latitude: 0, longitude: 0 },
    );
    return {
        latitude: sum.latitude / points.length,
        longitude: sum.longitude / points.length,
    };
}

/**
 * Projeta um ponto lat/long para coordenadas XYZ locais relativas ao centroide.
 *
 * X = deslocamento Leste-Oeste (longitude) em metros
 * Z = deslocamento Norte-Sul (latitude) em metros (Three.js Z = profundidade)
 * Y = elevacao (default 0)
 *
 * @param {number} lat - Latitude em graus decimais
 * @param {number} lng - Longitude em graus decimais
 * @param {{latitude: number, longitude: number}} origin - Centroide de referencia
 * @param {number} [elevation=0] - Elevacao em metros
 * @returns {{x: number, y: number, z: number}}
 */
export function projectToLocal(lat, lng, origin, elevation = 0) {
    // Deslocamento EW (longitude) — distancia ao longo do paralelo
    const dx = haversineDistance(origin.latitude, origin.longitude, origin.latitude, lng);
    const x = lng >= origin.longitude ? dx : -dx;

    // Deslocamento NS (latitude) — distancia ao longo do meridiano
    const dz = haversineDistance(origin.latitude, origin.longitude, lat, origin.longitude);
    const z = lat >= origin.latitude ? -dz : dz; // Three.js: -Z = norte

    return { x, y: elevation, z };
}

/**
 * Projeta um array de locais com lat/long para coordenadas XYZ.
 * Calcula centroide automaticamente ou usa origem fornecida.
 *
 * @param {Array<{latitude: number, longitude: number, elevation?: number}>} locations
 * @param {{latitude: number, longitude: number}|null} [customOrigin=null]
 * @returns {{origin: {latitude, longitude}, projected: Array<{x, y, z}>}}
 */
export function projectLocations(locations, customOrigin = null) {
    const origin = customOrigin || computeCentroid(locations);
    const projected = locations.map((loc) => projectToLocal(loc.latitude, loc.longitude, origin, loc.elevation || 0));
    return { origin, projected };
}
