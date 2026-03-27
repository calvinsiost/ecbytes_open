// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Module: CRS Adapter (input normalization and contract hardening)

/* ================================================================
   crsAdapter.js
   ---------------------------------------------------------------
   Unifica contratos de entrada para conversoes CRS no app:
   - WGS84: aceita { latitude, longitude } e aliases { lat, lon }
   - UTM: valida campos basicos e normaliza hemisphere (N/S)

   Objetivo: reduzir falhas silenciosas por mismatch de propriedades
   entre modulos (ex.: lat/lon vs latitude/longitude).
   ================================================================ */

/**
 * Normalize WGS84 input to canonical keys.
 *
 * @param {any} input
 * @returns {{ latitude:number, longitude:number, valid:boolean, source:string }}
 */
export function normalizeWGS84Input(input) {
    const hasCanonical =
        input &&
        typeof input === 'object' &&
        Object.prototype.hasOwnProperty.call(input, 'latitude') &&
        Object.prototype.hasOwnProperty.call(input, 'longitude');
    const hasAlias =
        input &&
        typeof input === 'object' &&
        Object.prototype.hasOwnProperty.call(input, 'lat') &&
        Object.prototype.hasOwnProperty.call(input, 'lon');

    const latitude = Number(hasCanonical ? input.latitude : input?.lat);
    const longitude = Number(hasCanonical ? input.longitude : input?.lon);

    const finite = Number.isFinite(latitude) && Number.isFinite(longitude);
    const rangeOk = finite && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;

    return {
        latitude,
        longitude,
        valid: rangeOk,
        source: hasCanonical ? 'canonical' : hasAlias ? 'alias' : 'unknown',
    };
}

/**
 * Normalize UTM input to canonical shape.
 *
 * @param {any} input
 * @returns {{ easting:number, northing:number, zone:number, hemisphere:'N'|'S', valid:boolean }}
 */
export function normalizeUTMInput(input) {
    const easting = Number(input?.easting);
    const northing = Number(input?.northing);
    const zone = Number(input?.zone);
    const hemisphereRaw = String(input?.hemisphere || '').toUpperCase();
    const hemisphere = hemisphereRaw === 'N' ? 'N' : 'S';

    const valid =
        Number.isFinite(easting) && Number.isFinite(northing) && Number.isFinite(zone) && zone >= 1 && zone <= 60;

    return { easting, northing, zone, hemisphere, valid };
}
