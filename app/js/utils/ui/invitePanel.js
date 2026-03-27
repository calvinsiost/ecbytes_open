// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Module: Invite Panel — "Meus Convites" UI
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   INVITE PANEL — Painel "Meus Convites"
   Exibe os codigos de convite do usuario com status e link copiavel.

   FUNCIONALIDADES:
   - Lista de codigos gerados pelo usuario
   - Status: disponivel (verde), usado (cinza), expirado (vermelho)
   - Botao copiar link para clipboard
   - Countdown de expiracao
   ================================================================ */

import { getUserInvites } from '../auth/session.js';
import { t } from '../i18n/translations.js';
import { escapeHtml } from '../helpers/html.js';
import { showToast } from './toast.js';

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Render the "My Invites" panel inside a target container or as modal.
 * Renderiza o painel de convites do usuario.
 *
 * @param {HTMLElement} [container] - Elemento alvo. Se null, cria modal.
 */
export async function renderInvitePanel(container) {
    const invites = await getUserInvites();
    const html = _buildPanelHTML(invites);

    let target = container;
    if (!target) {
        target = _getOrCreateModal();
        target.querySelector('.invite-panel-body').innerHTML = html;
        target.style.display = 'flex';
    } else {
        target.innerHTML = html;
    }

    _bindPanelEvents(target);
}

/**
 * Close the invite panel modal.
 * Fecha o modal de convites.
 */
export function closeInvitePanel() {
    const modal = document.getElementById('invite-panel-modal');
    if (modal) modal.style.display = 'none';
}

// ----------------------------------------------------------------
// BUILD
// ----------------------------------------------------------------

/**
 * Build HTML for invite list.
 * @param {Array} invites - Array de convites do usuario
 * @returns {string}
 */
function _buildPanelHTML(invites) {
    if (!invites || invites.length === 0) {
        return `<div class="invite-panel-empty">${t('invite.noInvites') || 'No invites yet'}</div>`;
    }

    const rows = invites
        .map((inv) => {
            const status = _getInviteStatus(inv);
            const daysLeft = _getDaysLeft(inv.expires_at);
            const link = `${location.origin}/?invite=${inv.code}`;

            return `
            <div class="invite-panel-row invite-status-${status.key}">
                <div class="invite-panel-code">${escapeHtml(inv.code.slice(0, 4))}-${escapeHtml(inv.code.slice(4))}</div>
                <span class="invite-panel-badge invite-badge-${status.key}">${status.label}</span>
                ${status.key === 'available' ? `<span class="invite-panel-expires">${t('invite.expiresIn', { days: daysLeft }) || daysLeft + 'd'}</span>` : ''}
                ${status.key === 'available' ? `<button class="invite-panel-copy" data-link="${escapeHtml(link)}" title="${t('invite.copyLink') || 'Copy link'}">&#9741;</button>` : ''}
            </div>
        `;
        })
        .join('');

    return `<div class="invite-panel-list">${rows}</div>`;
}

/**
 * Get invite status based on use_count and expiry.
 * @param {Object} invite
 * @returns {{key: string, label: string}}
 */
function _getInviteStatus(invite) {
    if (invite.use_count >= invite.max_uses) {
        return { key: 'used', label: t('invite.codeUsed') || 'Used' };
    }
    if (new Date(invite.expires_at) < new Date()) {
        return { key: 'expired', label: t('invite.codeExpired') || 'Expired' };
    }
    return { key: 'available', label: t('invite.codeAvailable') || 'Available' };
}

/**
 * Calculate days remaining until expiry.
 * @param {string} expiresAt - ISO timestamp
 * @returns {number}
 */
function _getDaysLeft(expiresAt) {
    const ms = new Date(expiresAt) - new Date();
    return Math.max(0, Math.ceil(ms / 86400000));
}

// ----------------------------------------------------------------
// MODAL
// ----------------------------------------------------------------

/**
 * Get or create the invite panel modal container.
 * @returns {HTMLElement}
 */
function _getOrCreateModal() {
    let modal = document.getElementById('invite-panel-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'invite-panel-modal';
    modal.className = 'invite-panel-modal-overlay';
    modal.innerHTML = `
        <div class="invite-panel-modal">
            <div class="invite-panel-header">
                <span class="invite-panel-title">${t('invite.myInvites') || 'My Invites'}</span>
                <button class="invite-panel-close" id="invite-panel-close-btn">&times;</button>
            </div>
            <div class="invite-panel-body"></div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#invite-panel-close-btn').addEventListener('click', closeInvitePanel);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeInvitePanel();
    });

    return modal;
}

// ----------------------------------------------------------------
// EVENTS
// ----------------------------------------------------------------

/**
 * Bind copy-link buttons inside the panel.
 * @param {HTMLElement} container
 */
function _bindPanelEvents(container) {
    container.querySelectorAll('.invite-panel-copy').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const link = btn.getAttribute('data-link');
            try {
                await navigator.clipboard.writeText(link);
                showToast(t('invite.linkCopied') || 'Invite link copied!', 'success');
            } catch {
                // Fallback para browsers sem clipboard API
                const ta = document.createElement('textarea');
                ta.value = link;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                showToast(t('invite.linkCopied') || 'Invite link copied!', 'success');
            }
        });
    });
}
