/* ================================================================
   CREDENTIAL MODAL — Envio e historico de credenciais academicas
   Modal para submissao de diplomas/certificados com verificacao por IA
   e exibicao do historico de auditoria (credential_audit_log).

   Integra com professional.js (submitCredentialRequest, getCredentialHistory,
   getUserCredentials) e session.js para autenticacao.
   ================================================================ */

import { t } from '../i18n/translations.js';
import { escapeHtml } from '../helpers/html.js';
import { showToast } from './toast.js';
import { submitCredentialRequest, getUserCredentials, getCredentialHistory } from '../cloud/professional.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

let _overlay = null;

// ----------------------------------------------------------------
// CREDENTIAL TYPES — tipos aceitos pelo sistema
// ----------------------------------------------------------------

const CREDENTIAL_TYPES = [
    { value: 'professional', label: 'Professional' },
    { value: 'pos_graduado', label: 'Pos-Graduado' },
    { value: 'mestre', label: 'Mestre' },
    { value: 'doutor', label: 'Doutor' },
];

// ----------------------------------------------------------------
// STATUS BADGE — cor conforme status da credencial
// ----------------------------------------------------------------

/**
 * Returns inline style for a status badge.
 * Retorna estilo inline para badge de status.
 *
 * @param {string} status - 'pending' | 'approved' | 'rejected'
 * @returns {string} CSS inline style string
 */
function badgeStyle(status) {
    const colors = {
        pending: 'background:#e6a817;color:#000',
        approved: 'background:#2e7d32;color:#fff',
        rejected: 'background:#c62828;color:#fff',
    };
    return `display:inline-block;padding:2px 8px;border-radius:3px;font-size:12px;${colors[status] || 'background:#666;color:#fff'}`;
}

/**
 * Returns localized label for a status.
 * Retorna label traduzido do status.
 *
 * @param {string} status
 * @returns {string}
 */
function statusLabel(status) {
    const map = {
        pending: t('credential.statusPending') || 'Pending',
        approved: t('credential.statusApproved') || 'Approved',
        rejected: t('credential.statusRejected') || 'Rejected',
    };
    return map[status] || status;
}

// ----------------------------------------------------------------
// CREATE MODAL DOM
// ----------------------------------------------------------------

/**
 * Builds the modal overlay element (created once, reused).
 * Constroi o overlay do modal (criado uma vez, reutilizado).
 *
 * @returns {HTMLElement} The overlay element
 */
function _createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'credential-modal-overlay';
    overlay.style.cssText =
        'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9000;align-items:center;justify-content:center;';

    const modal = document.createElement('div');
    modal.id = 'credential-modal';
    modal.style.cssText =
        'background:var(--bg-primary,#1e1e2e);color:var(--text-primary,#cdd6f4);border-radius:8px;padding:24px;max-width:560px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.4);';

    overlay.appendChild(modal);

    // Fechar ao clicar no overlay (fora do modal)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeCredentialModal();
    });

    // Fechar com Escape
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeCredentialModal();
    });

    document.body.appendChild(overlay);
    return overlay;
}

// ----------------------------------------------------------------
// RENDER
// ----------------------------------------------------------------

/**
 * Renders the modal content (form + history).
 * Renderiza o conteudo do modal (formulario + historico).
 */
async function _render() {
    const modal = _overlay?.querySelector('#credential-modal');
    if (!modal) return;

    // Header
    const title = t('credential.modalTitle') || 'Credential Verification';
    const closeLabel = t('close') || 'Close';

    let html = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="margin:0;font-size:18px;">${escapeHtml(title)}</h3>
            <button id="credential-modal-close" style="background:none;border:none;color:var(--text-secondary,#aaa);font-size:20px;cursor:pointer;" aria-label="${escapeHtml(closeLabel)}">&times;</button>
        </div>
    `;

    // -- Form section --
    const typeLabel = t('credential.type') || 'Credential Type';
    const fileLabel = t('credential.file') || 'Document (PDF or image)';
    const consentLabel =
        t('credential.consent') || 'I confirm this document is authentic and I authorize its verification.';
    const submitLabel = t('credential.submit') || 'Submit for Verification';

    html += `
        <div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border-color,#333);">
            <label style="display:block;margin-bottom:6px;font-weight:600;">${escapeHtml(typeLabel)}</label>
            <select id="cred-type-select" style="width:100%;padding:8px;border-radius:4px;border:1px solid var(--border-color,#444);background:var(--bg-secondary,#2a2a3c);color:inherit;">
                ${CREDENTIAL_TYPES.map((ct) => `<option value="${ct.value}">${escapeHtml(ct.label)}</option>`).join('')}
            </select>

            <label style="display:block;margin:12px 0 6px;font-weight:600;">${escapeHtml(fileLabel)}</label>
            <input type="file" id="cred-file-input" accept=".pdf,.jpg,.jpeg,.png" style="width:100%;padding:6px;border-radius:4px;border:1px solid var(--border-color,#444);background:var(--bg-secondary,#2a2a3c);color:inherit;" />

            <label style="display:flex;align-items:flex-start;gap:8px;margin:14px 0 12px;cursor:pointer;">
                <input type="checkbox" id="cred-consent-check" style="margin-top:3px;" />
                <span style="font-size:13px;">${escapeHtml(consentLabel)}</span>
            </label>

            <button id="cred-submit-btn" style="width:100%;padding:10px;border:none;border-radius:4px;background:var(--accent-color,#4a6cf7);color:#fff;font-weight:600;cursor:pointer;">
                ${escapeHtml(submitLabel)}
            </button>
            <div id="cred-submit-status" style="display:none;margin-top:8px;padding:8px;border-radius:4px;font-size:13px;"></div>
        </div>
    `;

    // -- Credentials list --
    const credListTitle = t('credential.yourCredentials') || 'Your Credentials';
    html += `<h4 style="margin:0 0 8px;font-size:15px;">${escapeHtml(credListTitle)}</h4>`;
    html += `<div id="cred-list-container" style="margin-bottom:16px;"><span style="color:var(--text-secondary,#888);font-size:13px;">${escapeHtml(t('loading') || 'Loading...')}</span></div>`;

    // -- Audit history --
    const historyTitle = t('credential.auditHistory') || 'Audit History';
    html += `<h4 style="margin:0 0 8px;font-size:15px;">${escapeHtml(historyTitle)}</h4>`;
    html += `<div id="cred-history-container"><span style="color:var(--text-secondary,#888);font-size:13px;">${escapeHtml(t('loading') || 'Loading...')}</span></div>`;

    modal.innerHTML = html;

    // Bind close button
    modal.querySelector('#credential-modal-close')?.addEventListener('click', closeCredentialModal);

    // Bind submit
    modal.querySelector('#cred-submit-btn')?.addEventListener('click', _handleSubmit);

    // Load async data
    _loadCredentials();
    _loadHistory();
}

// ----------------------------------------------------------------
// ASYNC DATA LOADERS
// ----------------------------------------------------------------

/**
 * Load and render the user's credentials list.
 * Carrega e renderiza a lista de credenciais do usuario.
 */
async function _loadCredentials() {
    const container = document.getElementById('cred-list-container');
    if (!container) return;

    try {
        const creds = await getUserCredentials();
        if (!creds.length) {
            container.innerHTML = `<span style="color:var(--text-secondary,#888);font-size:13px;">${escapeHtml(t('credential.noneYet') || 'No credentials submitted yet.')}</span>`;
            return;
        }
        container.innerHTML = creds
            .map((c) => {
                const typeLabel =
                    CREDENTIAL_TYPES.find((ct) => ct.value === c.credential_type)?.label || c.credential_type;
                const date = new Date(c.created_at).toLocaleDateString();
                const inst = c.institution ? ` — ${escapeHtml(c.institution)}` : '';
                const year = c.graduation_year ? ` (${c.graduation_year})` : '';
                const reason = c.rejection_reason
                    ? `<div style="font-size:12px;color:#ef5350;margin-top:2px;">${escapeHtml(c.rejection_reason)}</div>`
                    : '';
                return `<div style="padding:8px;margin-bottom:6px;background:var(--bg-secondary,#2a2a3c);border-radius:4px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:600;">${escapeHtml(typeLabel)}${inst}${year}</span>
                    <span style="${badgeStyle(c.status)}">${escapeHtml(statusLabel(c.status))}</span>
                </div>
                <div style="font-size:12px;color:var(--text-secondary,#888);margin-top:2px;">${escapeHtml(date)}</div>
                ${reason}
            </div>`;
            })
            .join('');
    } catch (err) {
        console.error('[ecbyts] _loadCredentials:', err);
        container.innerHTML = `<span style="color:#ef5350;font-size:13px;">${escapeHtml(t('error') || 'Error loading credentials.')}</span>`;
    }
}

/**
 * Load and render the credential audit history.
 * Carrega e renderiza o historico de auditoria de credenciais.
 */
async function _loadHistory() {
    const container = document.getElementById('cred-history-container');
    if (!container) return;

    try {
        const history = await getCredentialHistory();
        if (!history.length) {
            container.innerHTML = `<span style="color:var(--text-secondary,#888);font-size:13px;">${escapeHtml(t('credential.noHistory') || 'No audit history.')}</span>`;
            return;
        }
        container.innerHTML = history
            .map((h) => {
                const date = new Date(h.created_at).toLocaleString();
                const actionColor =
                    h.action === 'approved'
                        ? '#2e7d32'
                        : h.action === 'rejected'
                          ? '#c62828'
                          : h.action === 'revoked'
                            ? '#6a1b9a'
                            : '#e6a817';
                const notes = h.notes ? ` — ${escapeHtml(h.notes)}` : '';
                return `<div style="padding:6px 8px;margin-bottom:4px;font-size:13px;border-left:3px solid ${actionColor};padding-left:10px;">
                <span style="font-weight:600;color:${actionColor};">${escapeHtml(h.action)}</span>
                <span style="color:var(--text-secondary,#888);"> ${escapeHtml(h.credential_type)} — ${escapeHtml(date)}</span>${notes}
            </div>`;
            })
            .join('');
    } catch (err) {
        console.error('[ecbyts] _loadHistory:', err);
        container.innerHTML = `<span style="color:#ef5350;font-size:13px;">${escapeHtml(t('error') || 'Error loading history.')}</span>`;
    }
}

// ----------------------------------------------------------------
// SUBMIT HANDLER
// ----------------------------------------------------------------

/**
 * Handles the credential submission form.
 * Processa o formulario de envio de credencial.
 */
async function _handleSubmit() {
    const typeSelect = document.getElementById('cred-type-select');
    const fileInput = document.getElementById('cred-file-input');
    const consentCheck = document.getElementById('cred-consent-check');
    const submitBtn = document.getElementById('cred-submit-btn');
    const statusEl = document.getElementById('cred-submit-status');

    const credentialType = typeSelect?.value;
    const file = fileInput?.files?.[0];
    const consent = consentCheck?.checked || false;

    // Validacao local
    if (!file) {
        _showStatus(statusEl, t('credential.selectFile') || 'Please select a document to upload.', 'error');
        return;
    }
    if (!consent) {
        _showStatus(
            statusEl,
            t('credential.consentRequired') || 'You must accept the legal consent to proceed.',
            'error',
        );
        return;
    }

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = t('credential.verifying') || 'Verifying...';
        }

        const result = await submitCredentialRequest(credentialType, file, consent);

        if (result.approved) {
            _showStatus(
                statusEl,
                `${t('credential.approved') || 'Credential approved!'} ${result.institution || ''}`,
                'success',
            );
            showToast(t('credential.approved') || 'Credential approved!', 'success');
        } else {
            _showStatus(
                statusEl,
                `${t('credential.rejected') || 'Credential rejected.'} ${result.reason || ''}`,
                'error',
            );
        }

        // Refresh lists
        _loadCredentials();
        _loadHistory();
    } catch (err) {
        console.error('[ecbyts] credential submit error:', err);
        _showStatus(statusEl, err.message || t('error') || 'Error', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = t('credential.submit') || 'Submit for Verification';
        }
    }
}

/**
 * Show a status message below the submit button.
 * Mostra mensagem de status abaixo do botao de envio.
 *
 * @param {HTMLElement|null} el - Status element
 * @param {string} message - Text to display
 * @param {'success'|'error'} type - Message type
 */
function _showStatus(el, message, type) {
    if (!el) return;
    el.style.display = 'block';
    el.style.background = type === 'success' ? 'rgba(46,125,50,0.15)' : 'rgba(198,40,40,0.15)';
    el.style.color = type === 'success' ? '#66bb6a' : '#ef5350';
    el.textContent = message;
}

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Open the credential verification modal.
 * Abre o modal de verificacao de credenciais.
 */
export function openCredentialModal() {
    if (!_overlay) {
        _overlay = _createOverlay();
    }
    _overlay.style.display = 'flex';
    _render();
}

/**
 * Close the credential verification modal.
 * Fecha o modal de verificacao de credenciais.
 */
export function closeCredentialModal() {
    if (_overlay) _overlay.style.display = 'none';
}
