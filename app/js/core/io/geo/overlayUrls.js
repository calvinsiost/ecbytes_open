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
   OVERLAY URL BUILDER — Satellite imagery for boundary overlays
   ================================================================

   Gera imagem satellite para overlay em boundary elements via
   tile stitching client-side (Sentinel-2 Cloudless by EOX).

   Sem API key. Sem dependencia de serviços proprietarios.
   Fallback: Sentinel-2 2021 → Sentinel-2 2018 → OpenStreetMap.

   ================================================================ */

import { relativeToUTM, utmToWGS84 } from './coordinates.js';
import { stitchTiles, stitchTilesWithProvider } from './tileStitcher.js';

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Build aerial overlay for a rectangular area around current origin.
 * Compõe tiles Sentinel-2 em imagem para o bbox do boundary.
 *
 * @param {number} halfW - Half-width in meters (X axis)
 * @param {number} halfL - Half-length in meters (Z axis)
 * @param {number} [providerIndex] - Specific tile provider index (omit for fallback chain)
 * @returns {Promise<{ overlayUrl: string, overlayFallbackUrls: string[] }>}
 */
export async function buildOverlayUrls(halfW, halfL, providerIndex) {
    const sw = utmToWGS84(relativeToUTM({ x: -halfW, y: 0, z: halfL }));
    const ne = utmToWGS84(relativeToUTM({ x: halfW, y: 0, z: -halfL }));

    const extentM = Math.max(halfW, halfL) * 2;
    const size = Math.min(256, Math.max(128, Math.floor(extentM / 2)));

    const overlayUrl =
        providerIndex != null
            ? await stitchTilesWithProvider(providerIndex, sw, ne, size)
            : await stitchTiles(sw, ne, size);
    return { overlayUrl, overlayFallbackUrls: [] };
}

/**
 * Build aerial overlay from pre-computed WGS84 coordinates.
 * Versão para callers que já possuem sw/ne em WGS84.
 *
 * @param {{ latitude: number, longitude: number }} sw - Southwest corner
 * @param {{ latitude: number, longitude: number }} ne - Northeast corner
 * @param {number} [size=256] - Output size in pixels
 * @param {number} [providerIndex] - Specific tile provider index (omit for fallback chain)
 * @returns {Promise<{ overlayUrl: string, overlayFallbackUrls: string[] }>}
 */
export async function buildOverlayUrlsFromBbox(sw, ne, size = 256, providerIndex) {
    const overlayUrl =
        providerIndex != null
            ? await stitchTilesWithProvider(providerIndex, sw, ne, size)
            : await stitchTiles(sw, ne, size);
    return { overlayUrl, overlayFallbackUrls: [] };
}
