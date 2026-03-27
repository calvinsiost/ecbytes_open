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
   ASYNC DIALOGS — Non-blocking replacements for prompt() and confirm()
   ================================================================

   Substitui prompt() e confirm() nativos do navegador por modais
   customizados que nao bloqueiam a thread principal.

   Retorna Promises — use com await.

   ================================================================ */

import { getIcon } from './icons.js';

// ----------------------------------------------------------------
// SHARED HELPERS
// ----------------------------------------------------------------

let _activeDialog = null;

/** Remove the active dialog and clean up */
function _destroyDialog() {
    if (_activeDialog) {
        _activeDialog.remove();
        _activeDialog = null;
    }
}

/**
 * Create the overlay + dialog container.
 * @param {'confirm'|'prompt'} type
 * @returns {HTMLElement} The dialog container
 */
function _createShell(type) {
    _destroyDialog();

    const overlay = document.createElement('div');
    overlay.className = 'async-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    overlay.innerHTML = `
        <div class="async-dialog async-dialog--${type}">
            <div class="async-dialog-body"></div>
            <div class="async-dialog-actions"></div>
        </div>
    `;

    document.body.appendChild(overlay);
    _activeDialog = overlay;
    return overlay;
}

// ----------------------------------------------------------------
// asyncConfirm
// ----------------------------------------------------------------

/**
 * Non-blocking replacement for window.confirm().
 * Mostra um modal de confirmacao com botoes Cancelar e Confirmar.
 *
 * @param {string} message - Mensagem de confirmacao
 * @param {Object} [options]
 * @param {string} [options.confirmLabel='OK'] - Texto do botao de confirmacao
 * @param {string} [options.cancelLabel='Cancelar'] - Texto do botao de cancelamento
 * @param {boolean} [options.danger=false] - Se true, botao de confirmacao fica vermelho
 * @returns {Promise<boolean>} true se confirmado, false se cancelado
 */
export function asyncConfirm(message, options = {}) {
    const { confirmLabel = 'OK', cancelLabel = 'Cancelar', danger = false } = options;

    return new Promise((resolve) => {
        const overlay = _createShell('confirm');
        const body = overlay.querySelector('.async-dialog-body');
        const actions = overlay.querySelector('.async-dialog-actions');

        body.innerHTML = `<p class="async-dialog-message">${_escapeHtml(message)}</p>`;

        actions.innerHTML = `
            <button type="button" class="async-dialog-btn async-dialog-btn--cancel">${_escapeHtml(cancelLabel)}</button>
            <button type="button" class="async-dialog-btn async-dialog-btn--confirm ${danger ? 'async-dialog-btn--danger' : ''}">${_escapeHtml(confirmLabel)}</button>
        `;

        const cancelBtn = actions.querySelector('.async-dialog-btn--cancel');
        const confirmBtn = actions.querySelector('.async-dialog-btn--confirm');

        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                done(false);
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                done(true);
            }
        };

        const done = (result) => {
            document.removeEventListener('keydown', onKey);
            _destroyDialog();
            resolve(result);
        };

        cancelBtn.addEventListener('click', () => done(false));
        confirmBtn.addEventListener('click', () => done(true));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) done(false);
        });

        document.addEventListener('keydown', onKey);

        confirmBtn.focus();
    });
}

// ----------------------------------------------------------------
// asyncPrompt
// ----------------------------------------------------------------

/**
 * Non-blocking replacement for window.prompt().
 * Mostra um modal com campo de texto para entrada do usuario.
 *
 * @param {string} message - Mensagem/label para o campo
 * @param {string} [defaultValue=''] - Valor padrao do campo
 * @param {Object} [options]
 * @param {string} [options.confirmLabel='OK'] - Texto do botao de confirmacao
 * @param {string} [options.cancelLabel='Cancelar'] - Texto do botao de cancelamento
 * @param {string} [options.placeholder=''] - Placeholder do campo
 * @returns {Promise<string|null>} Valor digitado ou null se cancelado
 */
export function asyncPrompt(message, defaultValue = '', options = {}) {
    const { confirmLabel = 'OK', cancelLabel = 'Cancelar', placeholder = '' } = options;

    return new Promise((resolve) => {
        const overlay = _createShell('prompt');
        const body = overlay.querySelector('.async-dialog-body');
        const actions = overlay.querySelector('.async-dialog-actions');

        body.innerHTML = `
            <p class="async-dialog-message">${_escapeHtml(message)}</p>
            <input type="text" class="async-dialog-input" value="${_escapeAttr(defaultValue)}" placeholder="${_escapeAttr(placeholder)}">
        `;

        actions.innerHTML = `
            <button type="button" class="async-dialog-btn async-dialog-btn--cancel">${_escapeHtml(cancelLabel)}</button>
            <button type="button" class="async-dialog-btn async-dialog-btn--confirm">${_escapeHtml(confirmLabel)}</button>
        `;

        const input = body.querySelector('.async-dialog-input');
        const cancelBtn = actions.querySelector('.async-dialog-btn--cancel');
        const confirmBtn = actions.querySelector('.async-dialog-btn--confirm');

        const done = (result) => {
            _destroyDialog();
            resolve(result);
        };

        cancelBtn.addEventListener('click', () => done(null));
        confirmBtn.addEventListener('click', () => done(input.value));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) done(null);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                done(input.value);
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                done(null);
            }
        });

        input.focus();
        input.select();
    });
}

// ----------------------------------------------------------------
// ESCAPING
// ----------------------------------------------------------------

function _escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
