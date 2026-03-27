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
   ID GENERATION UTILITY
   Gera identificadores unicos com prefixo para entidades do modelo.
   Usa timestamp + random para garantir unicidade sem colisao.
   ================================================================ */

/**
 * Generate a unique ID with a given prefix.
 * Gera um ID unico no formato: prefixo-timestamp-random.
 *
 * @param {string} prefix - ID prefix (e.g. 'edge', 'stamp', 'contract')
 * @returns {string} Unique ID string
 */
export function generateId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
