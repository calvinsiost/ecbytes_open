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
   FORMAT REGISTRY — Registro plugável de formatos de arquivo
   ================================================================

   Catálogo central de formatos de importação/exportação.
   Cada formato se registra com suas capacidades e funções.

   PADRÃO:
   - Cada módulo de formato chama registerFormat() ao ser importado
   - O registry fornece listagem e lookup por ID
   - A UI de exportação/importação consulta o registry para opções

   ================================================================ */

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

const FORMAT_REGISTRY = new Map();

// ----------------------------------------------------------------
// API
// ----------------------------------------------------------------

/**
 * Registra um formato no catálogo.
 *
 * @param {Object} descriptor
 * @param {string} descriptor.id - Identificador único (ex: 'csv', 'geojson')
 * @param {string} descriptor.name - Nome para exibição (ex: 'GeoJSON')
 * @param {string[]} descriptor.extensions - Extensões de arquivo (ex: ['.csv'])
 * @param {string} descriptor.mimeType - Tipo MIME (ex: 'text/csv')
 * @param {boolean} descriptor.canExport - Se suporta exportação
 * @param {boolean} descriptor.canImport - Se suporta importação
 * @param {string[]} [descriptor.exportScopes] - O que exporta: 'elements', 'observations', 'campaigns', 'scene', 'full'
 * @param {Function} [descriptor.exportFn] - async (model, options) => Blob
 * @param {Function} [descriptor.importFn] - async (file, options) => parcial model
 * @param {boolean} [descriptor.needsOrigin] - Se requer origem UTM configurada
 */
export function registerFormat(descriptor) {
    if (!descriptor.id) {
        throw new Error('Format descriptor must have an id');
    }
    FORMAT_REGISTRY.set(descriptor.id, descriptor);
}

/**
 * Obtém um formato pelo ID.
 *
 * @param {string} id
 * @returns {Object|undefined}
 */
export function getFormat(id) {
    return FORMAT_REGISTRY.get(id);
}

/**
 * Lista todos os formatos registrados.
 *
 * @returns {Object[]}
 */
export function getAllFormats() {
    return Array.from(FORMAT_REGISTRY.values());
}

/**
 * Lista formatos que suportam exportação.
 *
 * @returns {Object[]}
 */
export function getExportFormats() {
    return getAllFormats().filter((f) => f.canExport);
}

/**
 * Lista formatos que suportam importação.
 *
 * @returns {Object[]}
 */
export function getImportFormats() {
    return getAllFormats().filter((f) => f.canImport);
}

/**
 * Detecta formato a partir da extensão de arquivo.
 *
 * @param {string} filename
 * @returns {Object|undefined}
 */
export function detectFormat(filename) {
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    return getAllFormats().find((f) => f.extensions.includes(ext));
}
