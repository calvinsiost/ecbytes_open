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
   PARAMETER DISPLAY NAME HELPER
   Auxiliar para nome de exibição de parâmetros

   Retorna o nome do parâmetro no idioma ativo.
   Parâmetros com campo `names: { en, es }` usam a tradução;
   caso contrário, retorna `param.name` (padrão português).
   ================================================================ */

import { getCurrentLanguage } from '../../utils/i18n/translations.js';

/**
 * Get the display name for a parameter in the current language.
 * Falls back to param.name (Portuguese default) if no translation.
 *
 * @param {Object} param - Parameter object with name and optional names
 * @returns {string} Display name in the current language
 */
export function getParamDisplayName(param) {
    if (!param) return '';
    const lang = getCurrentLanguage();
    if (lang === 'pt') return param.name;
    if (param.names && param.names[lang]) return param.names[lang];
    return param.name;
}
