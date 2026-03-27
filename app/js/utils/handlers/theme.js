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
   THEME HANDLERS — Window.* functions for HTML onclick
   ================================================================
   Handler para alternar tema claro/escuro/sistema.
   ================================================================ */

import { setThemePreference } from '../theme/manager.js';

/**
 * Set theme preference from ribbon button.
 * @param {'light'|'dark'|'system'} pref
 */
function handleSetTheme(pref) {
    setThemePreference(pref);
}

export const themeHandlers = {
    handleSetTheme,
};
