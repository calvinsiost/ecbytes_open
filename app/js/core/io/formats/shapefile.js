// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// @since v0.1.5

/* ================================================================
   SHAPEFILE FORMAT — Import de Shapefiles ESRI via shpjs
   ================================================================

   Aceita .zip (contendo .shp+.dbf+.prj) ou .shp individual.
   Converte para GeoJSON via shpjs (MIT, CDN lazy-loaded) e depois
   reutiliza importGeoJSON() existente para criar elementos ecbyts.

   Dependencia: shpjs v4+ (MIT license, ~200KB via CDN)
   CDN: https://unpkg.com/shpjs@latest/dist/shp.min.js

   ================================================================ */

import { registerFormat } from './registry.js';
import { importGeoJSON } from './geojson.js';
import { importCDN } from '../../../utils/helpers/cdnLoader.js';

// ----------------------------------------------------------------
// REGISTRO
// ----------------------------------------------------------------

registerFormat({
    id: 'shapefile',
    name: 'ESRI Shapefile',
    extensions: ['.shp', '.zip'],
    mimeType: 'application/octet-stream',
    canExport: false,
    canImport: true,
    needsOrigin: true,
    exportScopes: [],
});

// ----------------------------------------------------------------
// CDN CONFIG
// ----------------------------------------------------------------

// shpjs v4 — MIT license, pinned version
const SHPJS_CDN = 'https://unpkg.com/shpjs@4.0.4/dist/shp.min.js';

// ----------------------------------------------------------------
// IMPORT
// ----------------------------------------------------------------

/**
 * Importa shapefile (.zip ou .shp) e converte para elementos ecbyts.
 *
 * Pipeline: File → ArrayBuffer → shpjs → GeoJSON → importGeoJSON()
 *
 * @param {File} file — arquivo .zip ou .shp
 * @param {Object} options
 * @param {string} options.targetFamily — familia default para features sem type info
 * @returns {Promise<{elements: Array, warnings: string[], crs: string|null}>}
 */
export async function importShapefile(file, options = {}) {
    const { targetFamily = 'well' } = options;

    // Lazy-load shpjs via CDN
    if (!window.shp) {
        const { loadScriptCDN } = await import('../../../utils/helpers/cdnLoader.js');
        await loadScriptCDN(SHPJS_CDN, { name: 'shpjs', globalVar: 'shp' });
    }

    if (!window.shp) {
        throw new Error('shpjs nao carregou. Verifique sua conexao com a internet.');
    }

    const buffer = await file.arrayBuffer();

    // shpjs retorna GeoJSON FeatureCollection (projeta para WGS84 se .prj presente)
    let geojson;
    try {
        geojson = await window.shp(buffer);
    } catch (err) {
        throw new Error(`Erro ao parsear shapefile: ${err.message}`);
    }

    // shpjs pode retornar array de FeatureCollections (multi-layer zip)
    // ou um unico FeatureCollection
    const collections = Array.isArray(geojson) ? geojson : [geojson];

    const allElements = [];
    const allWarnings = [];
    const detectedCrs = null;

    for (const fc of collections) {
        if (!fc || fc.type !== 'FeatureCollection') continue;

        // Extrair CRS do fileName se disponivel
        if (fc.fileName) {
            allWarnings.push(`Layer: ${fc.fileName}`);
        }

        // Injetar familia default em features sem 'family' property
        for (const feature of fc.features || []) {
            if (!feature.properties) feature.properties = {};
            if (!feature.properties.family) {
                feature.properties.family = targetFamily;
            }
            // Usar campo de nome se disponivel nos atributos
            if (!feature.properties.name) {
                feature.properties.name =
                    feature.properties.NAME ||
                    feature.properties.Name ||
                    feature.properties.NOME ||
                    feature.properties.nome ||
                    feature.properties.ID ||
                    feature.properties.id ||
                    null;
            }
        }

        // Delegar para importGeoJSON existente
        const jsonStr = JSON.stringify(fc);
        try {
            const result = importGeoJSON(jsonStr);
            allElements.push(...result.elements);
            allWarnings.push(...result.warnings);
        } catch (err) {
            allWarnings.push(`Layer ignorada: ${err.message}`);
        }
    }

    if (allElements.length === 0) {
        throw new Error('Nenhum elemento extraido do shapefile. Verifique se o arquivo contem geometrias validas.');
    }

    return {
        elements: allElements,
        warnings: allWarnings,
        crs: detectedCrs,
    };
}
