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
   TOUR CONTROLLER UI — Chapter picker and FAB button
   Interface do tour de onboarding (seletor de capitulos)

   Componentes:
   1. FAB (Floating Action Button) — canto inferior direito
   2. Chapter picker — painel com 4 capitulos e status
   ================================================================ */

import { getIcon } from './icons.js';
import { t, applyTranslations } from '../i18n/translations.js';
import { getChapters, isActive } from '../tour/engine.js';

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Initialize tour UI components.
 * Verifica se o FAB existe no DOM.
 */
export function initTourUI() {
    const fab = document.getElementById('tour-controller');
    if (!fab) {
        console.warn('[TourUI] #tour-controller not found in DOM');
    }
}

// ----------------------------------------------------------------
// CHAPTER PICKER
// ----------------------------------------------------------------

/**
 * Show the chapter picker panel.
 */
export function showChapterPicker() {
    const panel = document.getElementById('tour-chapters');
    if (!panel) return;

    _renderChapterPicker(panel);
    panel.style.display = 'block';

    // Apply translations to dynamically rendered content
    applyTranslations(panel);

    // Hide FAB when panel is open
    const fab = document.getElementById('tour-controller');
    if (fab) fab.style.display = 'none';
}

/**
 * Hide the chapter picker panel.
 */
export function hideChapterPicker() {
    const panel = document.getElementById('tour-chapters');
    if (panel) panel.style.display = 'none';

    // Show FAB again
    const fab = document.getElementById('tour-controller');
    if (fab) fab.style.display = '';
}

// ----------------------------------------------------------------
// RENDERING
// ----------------------------------------------------------------

function _renderChapterPicker(panel) {
    const chapters = getChapters();

    let html = `
        <div class="tour-chapters-header">
            <h3>${_safeIcon('play-circle')} ${_t('tourTitle', 'Product Tour')}</h3>
            <button class="tour-chapters-close" onclick="window.handleCloseTour()" title="Close">
                ${_safeIcon('x')}
            </button>
        </div>
    `;

    for (const ch of chapters) {
        const badgeClass =
            ch.status === 'completed' ? 'completed' : ch.status === 'in-progress' ? 'in-progress' : 'pending';

        const badgeText =
            ch.status === 'completed'
                ? _t('tourCompleted', 'Done')
                : ch.status === 'in-progress'
                  ? _t('tourInProgress', 'In Progress')
                  : `${ch.stepCount} ${_t('tourSteps', 'steps')}`;

        const cardClass = `tour-chapter-card ${ch.status === 'completed' ? 'completed' : ''}`;

        html += `
            <button class="${cardClass}"
                    onclick="window.handleStartTourChapter('${ch.id}')">
                <span class="tour-chapter-icon" style="background: ${ch.color}20; color: ${ch.color}">
                    ${_safeIcon(ch.icon)}
                </span>
                <span class="tour-chapter-info">
                    <span class="tour-chapter-name-card">${_t(ch.titleKey, ch.id)}</span>
                    <span class="tour-chapter-desc">${_t(ch.descKey, '')}</span>
                </span>
                <span class="tour-chapter-badge ${badgeClass}">${badgeText}</span>
            </button>
        `;
    }

    // Separator + Guided Tours (50 workflow tours)
    html += `
        <div style="border-top: 1px solid var(--border, #333); margin-top: 8px; padding-top: 8px;">
            <button class="tour-chapter-card"
                    onclick="window.handleOpenGuidedTours();">
                <span class="tour-chapter-icon" style="background: #14b8a620; color: #14b8a6">
                    ${_safeIcon('compass')}
                </span>
                <span class="tour-chapter-info">
                    <span class="tour-chapter-name-card">${_t('guidedToursTitle', 'Guided Tours')}</span>
                    <span class="tour-chapter-desc">${_t('guidedToursDesc', '50 workflow-specific tutorials')}</span>
                </span>
                <span class="tour-chapter-badge pending">50 tours</span>
            </button>
        </div>
    `;

    // Demo Mode option
    html += `
        <div style="border-top: 1px solid var(--border, #333); margin-top: 8px; padding-top: 8px;">
            <button class="tour-chapter-card"
                    onclick="window.handleCloseTour(); window.handleOpenDemo();">
                <span class="tour-chapter-icon" style="background: #e6722020; color: #e67e22">
                    ${_safeIcon('play')}
                </span>
                <span class="tour-chapter-info">
                    <span class="tour-chapter-name-card">${_t('demoMode', 'Demo Mode')}</span>
                    <span class="tour-chapter-desc">${_t('demoSelectVertical', 'Select Vertical')}</span>
                </span>
                <span class="tour-chapter-badge pending">50 cases</span>
            </button>
        </div>
    `;

    panel.innerHTML = html;
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function _safeIcon(name) {
    try {
        return getIcon(name, { size: '16px' });
    } catch {
        return '';
    }
}

function _t(key, fallback) {
    try {
        const val = t(key);
        return val && val !== key ? val : fallback;
    } catch {
        return fallback;
    }
}
