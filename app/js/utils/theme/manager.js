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
   THEME MANAGER — Light/Dark Theme Switching
   ================================================================
   Gerencia tema claro/escuro da interface.
   Detecta preferencia do sistema, persiste no localStorage.
   Nao altera a cena 3D (controlada por VizSettings).
   ================================================================ */

import { safeSetItem } from '../storage/storageMonitor.js';

const STORAGE_KEY = 'ecbyts-theme';
const VALID = ['light', 'dark', 'system'];

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

/** @type {'light'|'dark'|'system'} */
let preference = 'system';

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Initialize theme from localStorage or system preference.
 * Restaura tema salvo ou detecta preferencia do sistema.
 */
export function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && VALID.includes(saved)) preference = saved;
    applyTheme();

    // Reage a mudancas na preferencia do SO (quando modo = 'system')
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (preference === 'system') applyTheme();
    });
}

// ----------------------------------------------------------------
// GETTERS
// ----------------------------------------------------------------

/**
 * Get current theme preference.
 * @returns {'light'|'dark'|'system'}
 */
export function getThemePreference() {
    return preference;
}

/**
 * Get the resolved (effective) theme.
 * @returns {'light'|'dark'}
 */
export function getEffectiveTheme() {
    if (preference === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return preference;
}

// ----------------------------------------------------------------
// MUTATIONS
// ----------------------------------------------------------------

/**
 * Set theme preference and apply.
 * @param {'light'|'dark'|'system'} pref
 */
export function setThemePreference(pref) {
    if (!VALID.includes(pref)) return;
    preference = pref;
    safeSetItem(STORAGE_KEY, pref);
    applyTheme();
}

// ----------------------------------------------------------------
// APPLICATION
// ----------------------------------------------------------------

/**
 * Apply current theme to DOM.
 * Define atributo data-theme no <html> e atualiza botoes do ribbon.
 */
function applyTheme() {
    const effective = getEffectiveTheme();
    document.documentElement.setAttribute('data-theme', effective);

    // Atualiza estado ativo dos botoes de tema no ribbon
    document.querySelectorAll('.theme-option-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.theme === preference);
    });

    window.dispatchEvent(
        new CustomEvent('themeChanged', {
            detail: { theme: effective, preference },
        }),
    );
}
