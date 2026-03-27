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
   SAFE RENDER — Unified rendering helper with i18n and icons
   Helper unificado para renderização segura com tradução e ícones

   Padrão para todos os módulos de UI que renderizam HTML dinâmico.
   Resolve problemas de:
   - Traduções não aplicadas a conteúdo dinâmico
   - Ícones não hidratados após render
   - Inconsistência entre módulos
   ================================================================ */

import { applyTranslations } from '../i18n/translations.js';
import { hydrateIcons } from './icons.js';

/**
 * Render HTML safely with i18n and icons hydration.
 * Padrão unificado para todos os módulos de UI.
 *
 * @param {HTMLElement} container - Elemento onde o HTML será injetado
 * @param {string} html - String HTML a ser renderizada
 * @param {Object} opts - Opções
 * @param {boolean} opts.hydrateIcons - Hidratar ícones SVG (default: true)
 * @param {boolean} opts.applyI18n - Aplicar traduções (default: true)
 */
export function safeRender(container, html, opts = {}) {
    const { hydrateIcons: doIcons = true, applyI18n = true } = opts;

    container.innerHTML = html;

    if (doIcons) {
        hydrateIcons(container);
    }

    if (applyI18n) {
        applyTranslations(container);
    }
}

/**
 * Render HTML with i18n only (no icon hydration).
 * Use quando os ícones já estão hidratados ou não são necessários.
 *
 * @param {HTMLElement} container
 * @param {string} html
 */
export function safeRenderI18n(container, html) {
    safeRender(container, html, { hydrateIcons: false, applyI18n: true });
}

/**
 * Render HTML with icons only (no i18n).
 * Use quando as traduções já foram aplicadas no momento do render.
 *
 * @param {HTMLElement} container
 * @param {string} html
 */
export function safeRenderIcons(container, html) {
    safeRender(container, html, { hydrateIcons: true, applyI18n: false });
}
