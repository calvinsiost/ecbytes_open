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
   API KEY MODAL — Fase 2 Freemium
   Gerenciamento de chaves de API para acesso programático (MCP)

   FUNCIONALIDADES:
   - Lista chaves existentes (ativas e revogadas)
   - Botão "Generate New Key": solicita nome, gera, exibe UMA vez
   - Geração: caixa destacada com chave + botão "Copy" + checkbox
     "I've saved my key" + botão "Done" (desabilitado até checkbox)
   - Revogação: botão "Revoke" em cada chave ativa
   ================================================================ */

import { generateApiKey, revokeApiKey, listApiKeys } from '../cloud/apiKeys.js';
import { getCurrentUser } from '../auth/session.js';
import { showToast } from './toast.js';
import { t } from '../i18n/translations.js';
import { escapeHtml } from '../helpers/html.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

let _escHandler = null;

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Open the API Keys management modal.
 * Abre o modal de gerenciamento de chaves de API.
 */
export async function openApiKeyModal() {
    if (!document.getElementById('api-key-modal')) {
        _injectModal();
    }

    const modal = document.getElementById('api-key-modal');
    modal.style.display = 'flex';

    _renderKeyList(null); // mostra "loading" enquanto carrega
    await _loadAndRenderKeys();

    if (_escHandler) document.removeEventListener('keydown', _escHandler);
    _escHandler = (e) => {
        if (e.key === 'Escape') closeApiKeyModal();
    };
    document.addEventListener('keydown', _escHandler);
}

/**
 * Close the API Keys modal.
 * Fecha o modal de gerenciamento de chaves de API.
 */
export function closeApiKeyModal() {
    const modal = document.getElementById('api-key-modal');
    if (modal) modal.style.display = 'none';
    if (_escHandler) {
        document.removeEventListener('keydown', _escHandler);
        _escHandler = null;
    }
    // Limpa estado de nova chave se ainda exibida
    _clearNewKeyBox();
}

// ----------------------------------------------------------------
// INTERNAL — RENDER
// ----------------------------------------------------------------

/**
 * Load keys from Supabase and render the list.
 */
async function _loadAndRenderKeys() {
    if (!getCurrentUser()) {
        _renderKeyList([]);
        return;
    }
    try {
        const keys = await listApiKeys();
        _renderKeyList(keys);
    } catch (e) {
        console.error('[ecbyts] apiKeyModal load error:', e);
        _renderKeyList([], e.message);
    }
}

/**
 * Render the key list into #api-key-list.
 * @param {Array|null} keys — null = loading
 * @param {string} [error]
 */
function _renderKeyList(keys, error) {
    const container = document.getElementById('api-key-list');
    if (!container) return;

    if (keys === null) {
        container.innerHTML = `<div class="api-key-empty">${t('loading') || 'Loading...'}</div>`;
        return;
    }

    if (error) {
        container.innerHTML = `<div class="api-key-empty api-key-error">${escapeHtml(error)}</div>`;
        return;
    }

    if (!getCurrentUser()) {
        container.innerHTML = `<div class="api-key-empty">${t('apiKey.loginRequired') || 'Login required to manage API keys.'}</div>`;
        return;
    }

    if (keys.length === 0) {
        container.innerHTML = `<div class="api-key-empty">${t('apiKey.noKeys') || 'No API keys yet. Generate one to get started.'}</div>`;
        return;
    }

    const rows = keys.map((k) => {
        const isRevoked = !!k.revoked_at;
        const revokedClass = isRevoked ? ' api-key-row--revoked' : '';
        const lastUsed = k.last_used ? new Date(k.last_used).toLocaleDateString() : t('apiKey.never') || 'Never';
        const createdAt = new Date(k.created_at).toLocaleDateString();
        const statusLabel = isRevoked
            ? `<span class="api-key-badge api-key-badge--revoked">${t('apiKey.revoked') || 'Revoked'}</span>`
            : `<span class="api-key-badge api-key-badge--active">${t('apiKey.active') || 'Active'}</span>`;
        const revokeBtn = isRevoked
            ? ''
            : `
            <button class="btn btn-sm btn-danger api-key-revoke-btn"
                    onclick="window._apiKeyRevoke(${JSON.stringify(k.id)})">
                ${t('apiKey.revoke') || 'Revoke'}
            </button>`;

        return `
        <div class="api-key-row${revokedClass}">
            <div class="api-key-row-info">
                <span class="api-key-name">${escapeHtml(k.name || 'API Key')}</span>
                <span class="api-key-prefix">${escapeHtml(k.prefix)}...</span>
                ${statusLabel}
            </div>
            <div class="api-key-row-meta">
                <span>${t('apiKey.created') || 'Created'}: ${createdAt}</span>
                <span>${t('apiKey.lastUsed') || 'Last used'}: ${lastUsed}</span>
            </div>
            <div class="api-key-row-actions">
                ${revokeBtn}
            </div>
        </div>`;
    });

    container.innerHTML = rows.join('');
}

/**
 * Show the "new key" box with the generated key.
 * @param {string} fullKey
 */
function _showNewKeyBox(fullKey) {
    const box = document.getElementById('api-key-new-box');
    const keyDisplay = document.getElementById('api-key-new-value');
    const doneBtn = document.getElementById('api-key-done-btn');
    const savedCheckbox = document.getElementById('api-key-saved-checkbox');

    if (!box || !keyDisplay) return;

    keyDisplay.value = fullKey;
    if (doneBtn) doneBtn.disabled = true;
    if (savedCheckbox) savedCheckbox.checked = false;
    box.style.display = 'block';
}

/**
 * Clear and hide the new key box.
 */
function _clearNewKeyBox() {
    const box = document.getElementById('api-key-new-box');
    const keyDisplay = document.getElementById('api-key-new-value');
    if (box) box.style.display = 'none';
    if (keyDisplay) keyDisplay.value = '';
}

// ----------------------------------------------------------------
// INTERNAL — ACTIONS (exposed on window for onclick attributes)
// ----------------------------------------------------------------

/**
 * Handle "Generate New Key" button.
 * Solicita nome, chama generateApiKey(), exibe resultado.
 */
window._apiKeyGenerate = async function () {
    const nameInput = document.getElementById('api-key-name-input');
    const name = nameInput?.value?.trim() || 'API Key';

    const generateBtn = document.getElementById('api-key-generate-btn');
    if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.textContent = t('apiKey.generating') || 'Generating...';
    }

    try {
        const fullKey = await generateApiKey(name);
        _showNewKeyBox(fullKey);
        if (nameInput) nameInput.value = '';
        // Recarrega lista para refletir nova chave
        await _loadAndRenderKeys();
    } catch (e) {
        showToast(e.message || t('apiKey.generateError') || 'Error generating key', 'error');
    } finally {
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.textContent = t('apiKey.generate') || 'Generate New Key';
        }
    }
};

/**
 * Handle "Copy" button next to new key.
 */
window._apiKeyCopy = function () {
    const keyDisplay = document.getElementById('api-key-new-value');
    if (!keyDisplay?.value) return;

    navigator.clipboard
        .writeText(keyDisplay.value)
        .then(() => {
            showToast(t('apiKey.copied') || 'Key copied to clipboard', 'success');
        })
        .catch(() => {
            // Fallback para browsers sem clipboard API
            keyDisplay.select();
            document.execCommand('copy');
            showToast(t('apiKey.copied') || 'Key copied to clipboard', 'success');
        });
};

/**
 * Handle checkbox "I've saved my key" — enables Done button.
 */
window._apiKeySavedChange = function (checkbox) {
    const doneBtn = document.getElementById('api-key-done-btn');
    if (doneBtn) doneBtn.disabled = !checkbox.checked;
};

/**
 * Handle "Done" button — hides new key box.
 */
window._apiKeyDone = function () {
    _clearNewKeyBox();
};

/**
 * Handle "Revoke" button for a key.
 * @param {string} keyId
 */
window._apiKeyRevoke = async function (keyId) {
    const confirmed = await _confirmRevoke();
    if (!confirmed) return;

    try {
        await revokeApiKey(keyId);
        showToast(t('apiKey.revokeSuccess') || 'API key revoked', 'success');
        await _loadAndRenderKeys();
    } catch (e) {
        showToast(e.message || t('apiKey.revokeError') || 'Error revoking key', 'error');
    }
};

/**
 * Simple confirm dialog for revoke action.
 * @returns {Promise<boolean>}
 */
function _confirmRevoke() {
    return Promise.resolve(window.confirm(t('apiKey.revokeConfirm') || 'Revoke this API key? This cannot be undone.'));
}

// ----------------------------------------------------------------
// INTERNAL — MODAL INJECTION
// ----------------------------------------------------------------

/**
 * Inject modal HTML into document.body (criado apenas uma vez).
 */
function _injectModal() {
    const div = document.createElement('div');
    div.innerHTML = `
<div id="api-key-modal" class="usage-dashboard-overlay" style="display:none;"
     role="dialog" aria-modal="true" aria-label="${escapeHtml(t('apiKey.title') || 'API Keys')}">
    <div class="usage-dashboard-modal api-key-modal-content">

        <!-- Header -->
        <div class="usage-dashboard-header">
            <h3 class="usage-dashboard-title">${t('apiKey.title') || 'API Keys'}</h3>
            <button class="usage-dashboard-close" onclick="window.closeApiKeyModal()"
                    aria-label="${escapeHtml(t('close') || 'Close')}">&#10005;</button>
        </div>

        <!-- Description -->
        <p class="api-key-description">
            ${escapeHtml(t('apiKey.description') || 'API keys allow external tools (MCP, integrations) to authenticate with ecbyts on your behalf.')}
        </p>

        <!-- Generate form -->
        <div class="api-key-generate-form">
            <input type="text" id="api-key-name-input"
                   class="form-input form-input-sm"
                   maxlength="64"
                   placeholder="${escapeHtml(t('apiKey.namePlaceholder') || 'Key name (e.g. Claude Desktop)')}"
                   style="flex:1;">
            <button id="api-key-generate-btn" class="btn btn-primary btn-sm"
                    onclick="window._apiKeyGenerate()">
                ${t('apiKey.generate') || 'Generate New Key'}
            </button>
        </div>

        <!-- New key reveal box (hidden until key is generated) -->
        <div id="api-key-new-box" class="api-key-new-box" style="display:none;">
            <p class="api-key-new-warning">
                <strong>${t('apiKey.saveWarning') || 'Save this key now — it will not be shown again.'}</strong>
            </p>
            <div class="api-key-new-row">
                <input type="text" id="api-key-new-value" class="form-input api-key-value-input"
                       readonly aria-label="${escapeHtml(t('apiKey.keyValue') || 'Generated API key')}">
                <button class="btn btn-sm btn-secondary" onclick="window._apiKeyCopy()">
                    ${t('apiKey.copy') || 'Copy'}
                </button>
            </div>
            <label class="api-key-confirm-label">
                <input type="checkbox" id="api-key-saved-checkbox"
                       onchange="window._apiKeySavedChange(this)">
                ${t('apiKey.savedConfirm') || "I've saved my key"}
            </label>
            <button id="api-key-done-btn" class="btn btn-sm btn-primary"
                    onclick="window._apiKeyDone()" disabled>
                ${t('apiKey.done') || 'Done'}
            </button>
        </div>

        <!-- Key list -->
        <div class="api-key-list-header">
            <span class="usage-dashboard-label">${t('apiKey.yourKeys') || 'Your API Keys'}</span>
        </div>
        <div id="api-key-list" class="api-key-list" role="list">
            <div class="api-key-empty">${t('loading') || 'Loading...'}</div>
        </div>

        <!-- Footer -->
        <div class="usage-dashboard-footer">
            <button class="btn btn-sm btn-secondary" onclick="window.closeApiKeyModal()">
                ${t('close') || 'Close'}
            </button>
        </div>
    </div>
</div>`;
    document.body.appendChild(div.firstElementChild);
    _injectStyles();
}

/**
 * Inject scoped CSS for the API key modal.
 * Reutiliza variáveis CSS do design system existente.
 */
function _injectStyles() {
    if (document.getElementById('api-key-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'api-key-modal-styles';
    style.textContent = `
.api-key-modal-content {
    width: 560px;
    max-width: 95vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.api-key-description {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0;
}
.api-key-generate-form {
    display: flex;
    gap: 8px;
    align-items: center;
}
.api-key-new-box {
    background: var(--surface-elevated, var(--bg-secondary));
    border: 1px solid var(--warning-400, #f59e0b);
    border-radius: 6px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.api-key-new-warning {
    font-size: 12px;
    color: var(--warning-600, #d97706);
    margin: 0;
}
.api-key-new-row {
    display: flex;
    gap: 8px;
    align-items: center;
}
.api-key-value-input {
    flex: 1;
    font-family: monospace;
    font-size: 12px;
    letter-spacing: 0.02em;
    background: var(--bg-primary);
    color: var(--text-primary);
}
.api-key-confirm-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
}
.api-key-list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.api-key-list {
    overflow-y: auto;
    max-height: 260px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.api-key-empty {
    text-align: center;
    padding: 16px;
    color: var(--text-muted);
    font-size: 12px;
}
.api-key-error {
    color: var(--danger-500, #ef4444);
}
.api-key-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-primary);
}
.api-key-row--revoked {
    opacity: 0.55;
}
.api-key-row-info {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.api-key-name {
    font-weight: 600;
    font-size: 12px;
    color: var(--text-primary);
}
.api-key-prefix {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-secondary);
    padding: 1px 4px;
    border-radius: 3px;
}
.api-key-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.api-key-badge--active {
    background: var(--success-100, #d1fae5);
    color: var(--success-700, #065f46);
}
.api-key-badge--revoked {
    background: var(--neutral-200, #e5e7eb);
    color: var(--neutral-600, #4b5563);
}
.api-key-row-meta {
    display: flex;
    gap: 16px;
    font-size: 11px;
    color: var(--text-muted);
}
.api-key-row-actions {
    display: flex;
    justify-content: flex-end;
}`;
    document.head.appendChild(style);
}
