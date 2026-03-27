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
   HTML ESCAPE UTILITIES
   Funcoes para escapar texto em contextos HTML e atributos.
   Previne XSS ao inserir conteudo dinamico no DOM.
   ================================================================ */

/**
 * Escape HTML special characters to prevent XSS.
 * Escapa caracteres especiais do HTML para uso seguro em innerHTML.
 *
 * @param {string} text - Raw text to escape
 * @returns {string} Escaped HTML-safe string
 */
export function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escape HTML attribute special characters.
 * Escapa caracteres especiais para uso seguro em atributos HTML.
 *
 * @param {string} text - Raw text to escape
 * @returns {string} Escaped attribute-safe string
 */
export function escapeAttr(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Escape text for use inside JS string literals within HTML attributes.
 * Escapa texto para uso em strings JS dentro de atributos HTML (onclick, onchange).
 * Ex: onclick="func('${escapeJsAttr(value)}')"
 *
 * @param {string} text - Raw text to escape
 * @returns {string} Escaped string safe for JS-in-HTML context
 */
export function escapeJsAttr(text) {
    if (!text) return '';
    return String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

/**
 * Format uncertainty for display (ISO/IEC 17025 / GUM).
 * Formata incerteza para exibicao: absoluta (± valor) ou relativa (± valor%).
 *
 * @param {number|null} uncertainty - Uncertainty value
 * @param {'absolute'|'relative'|null} uncertaintyType - How to interpret
 * @param {number|null} coverageFactor - Coverage factor k (display omitted when 2 or null)
 * @returns {string} Formatted string, e.g. '± 0.5', '± 10%', '± 0.3 (k=3)', or ''
 */
export function formatUncertainty(uncertainty, uncertaintyType, coverageFactor) {
    if (uncertainty == null || !Number.isFinite(uncertainty)) return '';
    const suffix = uncertaintyType === 'relative' ? '%' : '';
    const kStr =
        coverageFactor != null && Number.isFinite(coverageFactor) && coverageFactor !== 2
            ? ` (k=${coverageFactor})`
            : '';
    return `\u00B1\u00A0${uncertainty}${suffix}${kStr}`;
}
