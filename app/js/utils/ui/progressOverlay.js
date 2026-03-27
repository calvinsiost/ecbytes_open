// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// @since v0.1.5

/**
 * progressOverlay.js — Modal overlay de progresso para operacoes longas.
 *
 * Exibe progress bar, fase atual, e log de warnings/erros em tempo real.
 * Valor principal: surfacea warnings que hoje ficam escondidos no console.
 *
 * @module utils/ui/progressOverlay
 */

import { t } from '../i18n/translations.js';

// ---------------------------------------------------------------------------
// Singleton guard — apenas 1 overlay por vez
// ---------------------------------------------------------------------------

let _activeOverlay = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mostra overlay de progresso para operacao longa.
 *
 * @param {string} title — titulo do overlay (ex: 'Importando dados...')
 * @returns {ProgressController} — controller para atualizar/fechar
 */
export function showProgressOverlay(title) {
    // Dismiss overlay anterior se existir
    if (_activeOverlay) {
        _activeOverlay.dismiss();
    }

    const overlay = document.createElement('div');
    overlay.className = 'progress-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', title);

    overlay.innerHTML = `
        <div class="progress-overlay-content">
            <h3 class="progress-overlay-title">${_escapeHtml(title)}</h3>
            <progress class="progress-overlay-bar" value="0" max="100"></progress>
            <div class="progress-overlay-phase"></div>
            <div class="progress-overlay-log" aria-live="polite"></div>
            <div class="progress-overlay-footer" style="display:none;">
                <div class="progress-overlay-summary"></div>
                <button class="btn btn-primary progress-overlay-close">${t('close') || 'Close'}</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const bar = overlay.querySelector('.progress-overlay-bar');
    const phaseEl = overlay.querySelector('.progress-overlay-phase');
    const logEl = overlay.querySelector('.progress-overlay-log');
    const footerEl = overlay.querySelector('.progress-overlay-footer');
    const summaryEl = overlay.querySelector('.progress-overlay-summary');
    const closeBtn = overlay.querySelector('.progress-overlay-close');

    let logCount = 0;
    const MAX_LOG_LINES = 500;

    closeBtn.addEventListener('click', () => dismiss());

    function dismiss() {
        if (overlay.parentNode) overlay.remove();
        _activeOverlay = null;
    }

    function _appendLog(msg, cls) {
        if (logCount >= MAX_LOG_LINES) {
            logEl.removeChild(logEl.firstChild);
        }
        const line = document.createElement('div');
        line.className = `progress-log-line ${cls}`;
        line.textContent = msg;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
        logCount++;
    }

    const controller = {
        /**
         * Atualiza progresso.
         * @param {string} phase — nome da fase atual
         * @param {number} current — item atual
         * @param {number} total — total de items
         */
        update(phase, current, total) {
            const pct = total > 0 ? Math.round((current / total) * 100) : 0;
            bar.value = pct;
            phaseEl.textContent = `${phase}... ${current}/${total}`;
        },

        /** Adiciona warning ao log (amarelo). */
        addWarning(msg) {
            _appendLog(msg, 'progress-log-warning');
        },

        /** Adiciona erro ao log (vermelho). */
        addError(msg) {
            _appendLog(msg, 'progress-log-error');
        },

        /** Adiciona info ao log. */
        addInfo(msg) {
            _appendLog(msg, 'progress-log-info');
        },

        /**
         * Finaliza overlay com resumo.
         * @param {{elements?: number, campaigns?: number, observations?: number, warnings?: number, errors?: number}} stats
         */
        finish(stats) {
            bar.value = 100;
            phaseEl.textContent = t('completed') || 'Completed';

            if (stats) {
                const parts = [];
                if (stats.elements != null) parts.push(`${stats.elements} ${t('elements') || 'elements'}`);
                if (stats.campaigns != null) parts.push(`${stats.campaigns} ${t('campaigns') || 'campaigns'}`);
                if (stats.observations != null) parts.push(`${stats.observations} obs`);
                if (stats.warnings) parts.push(`${stats.warnings} warnings`);
                if (stats.errors) parts.push(`${stats.errors} ${t('errors') || 'errors'}`);
                summaryEl.textContent = parts.join(' | ');
            }

            footerEl.style.display = '';
            closeBtn.focus();
        },

        /** Remove overlay do DOM. */
        dismiss,
    };

    _activeOverlay = controller;
    return controller;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
