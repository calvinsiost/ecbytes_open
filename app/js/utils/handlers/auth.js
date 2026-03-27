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
   AUTH HANDLERS — Login, logout, access control management
   Acoes do usuario para autenticacao e controle de acesso

   FUNCIONALIDADES:
   - Login/logout via Google, GitHub, Microsoft e email
   - Modal SSO fullscreen para login
   - Menu de usuario no titlebar (quando logado)
   - Painel de controle de acesso (aba Governanca)
   - Gerenciamento de regras (admin: email, papel, areas)
   - Indicador de status na barra de status
   ================================================================ */

import {
    loginWithEmail,
    registerWithEmail,
    loginGoogle,
    loginGitHub,
    loginMicrosoft,
    logout,
    getCurrentUser,
    getUserEmail,
    sendPasswordReset,
} from '../auth/session.js';

import { submitCredentialRequest, getUserCredentials } from '../cloud/professional.js';
import { startConnectOnboarding, checkConnectStatus } from '../cloud/subscription.js';
import {
    getUnreadNotificationCount,
    fetchNotifications,
    markNotificationsRead,
} from '../libraries/supabaseMarketplace.js';
import { EIS_CREDENTIAL_LABELS, EIS_CREDENTIAL_MULTIPLIERS } from '../../core/eis/eisCalculator.js';

import {
    isOwner,
    isAdmin,
    isAccessControlActive,
    claimOwnership,
    getOwner,
    setOwner,
    getUserRole,
    getObserverMode,
    setObserverMode,
    getRules,
    addRule,
    removeRule,
    updateRule,
    exportPermissions,
} from '../auth/permissions.js';

import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { openModal, closeModal } from '../ui/modals.js';
import { escapeHtml, escapeAttr } from '../helpers/html.js';
import { openApiKeyModal, closeApiKeyModal } from '../ui/apiKeyModal.js';
import { CONFIG } from '../../config.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

let updateAllUIRef = null;
let _notifPollInterval = null;
const _THROTTLE_MAX_ATTEMPTS = 5;
const _THROTTLE_LOCKOUT_MS = 15 * 60_000;
const _THROTTLE_WINDOW_MS = 10 * 60_000;
const _THROTTLE_CAPTCHA_THRESHOLD = 3;

/**
 * Inject updateAllUI reference.
 * @param {Function} fn
 */
export function setAuthUpdateAllUI(fn) {
    updateAllUIRef = fn;
}

function _getThrottle() {
    try {
        return JSON.parse(sessionStorage.getItem('ecbyts-auth-throttle')) || {};
    } catch {
        return {};
    }
}

function _recordFailedAttempt() {
    const now = Date.now();
    const data = _getThrottle();
    const windowStart = now - _THROTTLE_WINDOW_MS;
    const inWindow = Number(data.firstAt) > windowStart;
    const count = (inWindow ? Number(data.count || 0) : 0) + 1;
    const lockedUntil = count >= _THROTTLE_MAX_ATTEMPTS ? now + _THROTTLE_LOCKOUT_MS : null;
    sessionStorage.setItem(
        'ecbyts-auth-throttle',
        JSON.stringify({
            count,
            firstAt: inWindow ? Number(data.firstAt) : now,
            lockedUntil,
        }),
    );
    return { count, lockedUntil };
}

function _clearThrottle() {
    sessionStorage.removeItem('ecbyts-auth-throttle');
}

function _checkThrottleLockout() {
    const data = _getThrottle();
    if (!data.lockedUntil) return { locked: false, remainingMs: 0 };
    const remainingMs = Number(data.lockedUntil) - Date.now();
    if (remainingMs <= 0) {
        _clearThrottle();
        return { locked: false, remainingMs: 0 };
    }
    return { locked: true, remainingMs };
}

export function throttleNeedsCaptcha() {
    const data = _getThrottle();
    return Number(data.count || 0) >= _THROTTLE_CAPTCHA_THRESHOLD;
}

// ----------------------------------------------------------------
// AUTH MODAL (SSO fullscreen)
// ----------------------------------------------------------------

/** Invite-lock state — when true, auth modal cannot be closed. */
let _inviteLocked = false;

/**
 * Block Escape key while auth modal is invite-locked.
 * Impede Escape de fechar o modal durante fluxo de convite.
 * @param {KeyboardEvent} e
 */
function _blockEscapeInvite(e) {
    if (_inviteLocked && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
    }
}

/**
 * Unlock the auth modal after successful login.
 * Restaura comportamento normal do modal apos autenticacao.
 */
function _unlockInviteGate() {
    _inviteLocked = false;
    document.removeEventListener('keydown', _blockEscapeInvite);
    const modal = document.getElementById('auth-modal');
    if (modal) {
        const closeBtn = modal.querySelector('.auth-card-close');
        if (closeBtn) closeBtn.style.display = '';
    }
}

/**
 * Open the SSO login modal.
 * Abre o modal fullscreen de login.
 * Quando chamado com { inviteLock: true }, impede fechamento ate login.
 *
 * @param {Object} [options]
 * @param {boolean} [options.inviteLock] - Trava o modal (sem X, sem Escape, sem overlay click)
 */
function handleOpenAuthModal(options) {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;

    // Invite-lock: hide close button, block Escape
    if (options?.inviteLock) {
        _inviteLocked = true;
        const closeBtn = modal.querySelector('.auth-card-close');
        if (closeBtn) closeBtn.style.display = 'none';
        document.addEventListener('keydown', _blockEscapeInvite);
    }

    modal.classList.add('active');
    // Clear previous state
    const errorEl = document.getElementById('auth-inline-error');
    if (errorEl) errorEl.style.display = 'none';
    const emailInput = document.getElementById('auth-email-input');
    if (emailInput) emailInput.value = '';
    const passInput = document.getElementById('auth-password-input');
    if (passInput) passInput.value = '';
}

/**
 * Close the SSO login modal.
 * Fecha o modal fullscreen de login.
 * Bloqueado quando _inviteLocked ativo (fluxo invite-only).
 */
function handleCloseAuthModal() {
    if (_inviteLocked) {
        showToast(t('invite.mustLogin') || 'Please sign in to continue', 'warning');
        return;
    }
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.remove('active');
    // Garante que o seletor de tipo de cadastro é ocultado ao fechar
    handleHideRegistrationTypes();
}

// ----------------------------------------------------------------
// REGISTRATION TYPE SELECTION — Simples vs Profissional
// ----------------------------------------------------------------

/**
 * Show the registration type selector (Simple / Professional).
 * Exibe o seletor de tipo de cadastro quando o usuário clica em "Criar Conta".
 */
function handleShowRegistrationTypes() {
    const selector = document.getElementById('auth-registration-type');
    const form = document.querySelector('#auth-modal form');
    const forgotBtn = document.querySelector('.auth-forgot-link');
    if (selector) selector.style.display = 'block';
    if (form) form.style.display = 'none';
    if (forgotBtn) forgotBtn.style.display = 'none';
}

/**
 * Hide the registration type selector and restore the form.
 * Oculta o seletor e restaura o formulário de email/senha.
 */
function handleHideRegistrationTypes() {
    const selector = document.getElementById('auth-registration-type');
    const form = document.querySelector('#auth-modal form');
    const forgotBtn = document.querySelector('.auth-forgot-link');
    if (selector) selector.style.display = 'none';
    if (form) form.style.display = '';
    if (forgotBtn) forgotBtn.style.display = '';
}

/**
 * Process the selected account type and proceed with email/password registration.
 * Processa o tipo de conta escolhido e prossegue com o cadastro.
 *
 * Para 'professional', o usuário é instruído a verificar via CREA/CRC após o cadastro.
 * Para 'common', cadastro padrão.
 *
 * @param {'common'|'professional'} userType - Tipo de conta
 */
function handleSelectUserType(userType) {
    handleHideRegistrationTypes();

    // Armazena o tipo escolhido para o handler de registro usar
    window._pendingUserType = userType;

    if (userType === 'professional') {
        showToast(
            t('registerProfessionalInfo') ||
                'Create your account, then go to your profile to submit your professional credentials.',
            'info',
        );
    }

    // Foca no campo de email para o usuário continuar o cadastro
    const emailInput = document.getElementById('auth-email-input');
    if (emailInput) emailInput.focus();
}

// ----------------------------------------------------------------
// CREDENTIAL UPLOAD MODAL
// ----------------------------------------------------------------

/**
 * Open the credential verification modal (Auth Fase 2).
 * Abre o modal de verificacao de credenciais com formulario e historico.
 * Lazy-loads credentialModal.js para evitar carregar codigo desnecessario.
 */
async function handleOpenCredentialModal() {
    try {
        const { openCredentialModal } = await import('../ui/credentialModal.js');
        openCredentialModal();
    } catch (e) {
        console.error('[Auth] Failed to open credential modal:', e.message);
    }
}

/**
 * Submit credential from the new modal (Auth Fase 2).
 * Submete credencial a partir do novo modal — delegado ao credentialModal.js.
 * Mantido como handler registrado para acesso via window.handleSubmitCredential().
 */
async function handleSubmitCredential() {
    try {
        const { openCredentialModal } = await import('../ui/credentialModal.js');
        // O submit e feito internamente pelo modal; abrir caso nao esteja aberto
        openCredentialModal();
    } catch (e) {
        console.error('[Auth] Failed to open credential modal for submit:', e.message);
    }
}

/**
 * Close the credential upload modal.
 * Fecha o modal de upload de credencial.
 */
function handleCloseCredentialModal() {
    const modal = document.getElementById('credential-upload-modal');
    if (modal) modal.classList.remove('active');
}

/**
 * Update the EIS multiplier preview when credential type changes.
 * Atualiza o preview do multiplicador EIS conforme o tipo selecionado.
 */
function updateCredentialEisPreview() {
    const select = document.getElementById('credential-type-select');
    const previewText = document.getElementById('credential-eis-preview-text');
    if (!select || !previewText) return;

    const type = select.value;
    const multiplier = EIS_CREDENTIAL_MULTIPLIERS[type] || 1.0;
    const label = EIS_CREDENTIAL_LABELS[type] || '';
    previewText.textContent = `${label} — EIS T-axis multiplier: ${multiplier}×`;
}

/**
 * Submit the credential upload form.
 * Submete o diploma para verificação por IA (Gemini Vision).
 */
async function handleSubmitCredentialUpload() {
    const typeSelect = document.getElementById('credential-type-select');
    const fileInput = document.getElementById('credential-file-input');
    const consentCheckbox = document.getElementById('credential-consent-checkbox');
    const statusEl = document.getElementById('credential-upload-status');
    const submitBtn = document.querySelector('#credential-upload-modal .auth-btn-signin');

    const credentialType = typeSelect?.value;
    const file = fileInput?.files?.[0];
    const consent = consentCheckbox?.checked || false;

    if (!file) {
        showCredentialStatus(t('selectFile') || 'Please select a document to upload.', 'error');
        return;
    }
    if (!consent) {
        showCredentialStatus(t('consentRequired') || 'You must accept the legal consent to proceed.', 'error');
        return;
    }

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span class="auth-spinner"></span> ${t('verifying') || 'Verifying...'}`;
        }

        const result = await submitCredentialRequest(credentialType, file, consent);

        if (result.approved) {
            showToast(
                `${EIS_CREDENTIAL_LABELS[result.level] || ''} ${t('credentialApproved') || 'Credential approved!'} — ${result.institution || ''}`,
                'success',
            );
            handleCloseCredentialModal();
            if (updateAllUIRef) updateAllUIRef();
        } else {
            showCredentialStatus(`${t('credentialRejected') || 'Verification failed'}: ${result.reason}`, 'error');
        }
    } catch (e) {
        showCredentialStatus(e.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span data-i18n="credential.submit">${t('submitVerification') || 'Submit for Verification'}</span>`;
        }
    }
}

/**
 * Show status message inside the credential upload modal.
 * @param {string} message
 * @param {'error'|'success'} type
 */
function showCredentialStatus(message, type = 'error') {
    const el = document.getElementById('credential-upload-status');
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
    el.style.color = type === 'success' ? 'var(--success-600)' : 'var(--danger-500)';
    if (type === 'error') {
        setTimeout(() => {
            el.style.display = 'none';
        }, 6000);
    }
}

// ----------------------------------------------------------------
// LOGIN / LOGOUT
// ----------------------------------------------------------------

/**
 * Login with email and password.
 * Faz login com email e senha via Supabase.
 */
async function handleLoginEmail() {
    const emailInput = document.getElementById('auth-email-input');
    const passInput = document.getElementById('auth-password-input');
    const btn = document.getElementById('auth-btn-login');
    const email = emailInput?.value?.trim();
    const password = passInput?.value;

    const lockout = _checkThrottleLockout();
    if (lockout.locked) {
        const mins = Math.ceil(lockout.remainingMs / 60_000);
        const msg = t('auth.tooManyAttempts', { mins });
        showAuthError(msg);
        return;
    }

    // Fase 1b usa este hook quando CAPTCHA estiver habilitado
    if (throttleNeedsCaptcha() && typeof window._captchaGetToken === 'function') {
        const token = await window._captchaGetToken();
        if (!token) {
            showAuthError(t('auth.captchaRequired') || 'Complete security verification to continue.');
            return;
        }
    }

    if (!email || !password) {
        showAuthError(t('enterEmailAndPassword') || 'Enter email and password');
        return;
    }

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="auth-spinner"></span> ${t('signingIn') || 'Signing in...'}`;
        }
        await loginWithEmail(email, password);
        _clearThrottle();
        _unlockInviteGate();
        handleCloseAuthModal();
    } catch (e) {
        const { count, lockedUntil } = _recordFailedAttempt();
        if (lockedUntil) {
            showAuthError(t('auth.lockedOut', { mins: 15 }));
        } else {
            const remaining = Math.max(0, _THROTTLE_MAX_ATTEMPTS - count);
            const leftMsg = t('auth.attemptsLeft') || 'attempt(s) left';
            showAuthError(`${supabaseErrorMessage(e)} (${remaining} ${leftMsg})`);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<span data-i18n="signIn">${t('signIn') || 'Sign In'}</span>`;
        }
    }
}

/**
 * Register new account with email and password.
 * Cria nova conta — Supabase envia email de confirmacao.
 */
async function handleRegisterEmail() {
    const emailInput = document.getElementById('auth-email-input');
    const passInput = document.getElementById('auth-password-input');
    const btn = document.getElementById('auth-btn-register');
    const email = emailInput?.value?.trim();
    const password = passInput?.value;

    if (!email || !password) {
        showAuthError(t('enterEmailAndPassword') || 'Enter email and password');
        return;
    }

    if (password.length < 6) {
        showAuthError(t('passwordTooShort') || 'Password must be at least 6 characters');
        return;
    }

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="auth-spinner"></span> ${t('creating') || 'Creating...'}`;
        }
        const user = await registerWithEmail(email, password);
        showToast(t('accountCreated') || 'Account created! Check your email for verification.', 'success');

        // INV-4: Claim invite code + generate user invites
        await _processInviteAfterSignup(user?.id);

        _unlockInviteGate();
        handleCloseAuthModal();
    } catch (e) {
        showAuthError(supabaseErrorMessage(e));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<span data-i18n="createAccount">${t('createAccount') || 'Create Account'}</span>`;
        }
    }
}

/**
 * Login with Google via Supabase OAuth redirect.
 */
async function handleLoginGoogle() {
    try {
        await loginGoogle();
    } catch (e) {
        showAuthError(supabaseErrorMessage(e));
    }
}

/**
 * Login with GitHub via Supabase OAuth redirect.
 */
async function handleLoginGitHub() {
    try {
        await loginGitHub();
    } catch (e) {
        showAuthError(supabaseErrorMessage(e));
    }
}

/**
 * Login with Microsoft via Supabase OAuth redirect.
 */
async function handleLoginMicrosoft() {
    try {
        await loginMicrosoft();
    } catch (e) {
        showAuthError(supabaseErrorMessage(e));
    }
}

/**
 * Send password reset email.
 */
async function handleForgotPassword() {
    const emailInput = document.getElementById('auth-email-input');
    const email = emailInput?.value?.trim();

    if (!email) {
        showAuthError(t('enterEmail') || 'Enter your email address first');
        return;
    }

    try {
        await sendPasswordReset(email);
        showToast(t('resetEmailSent') || 'Password reset email sent. Check your inbox.', 'success');
    } catch (e) {
        showAuthError(supabaseErrorMessage(e));
    }
}

/**
 * Show inline error in the auth modal.
 * @param {string} message
 */
function showAuthError(message) {
    const el = document.getElementById('auth-inline-error');
    if (el) {
        el.textContent = message;
        el.style.display = 'block';
        setTimeout(() => {
            el.style.display = 'none';
        }, 5000);
    }
}

/**
 * Convert Supabase error to user-friendly message.
 * Converte erro Supabase para mensagem amigavel.
 *
 * @param {Error} e - Supabase error
 * @returns {string}
 */
function supabaseErrorMessage(e) {
    const msg = e.message || '';
    const map = {
        'Invalid login credentials': t('wrongPassword') || 'Incorrect email or password',
        'Email not confirmed': t('emailNotConfirmed') || 'Please confirm your email first',
        'User already registered': t('emailInUse') || 'This email is already registered',
        'Password should be at least 6 characters': t('passwordTooShort') || 'Password must be at least 6 characters',
        'Email rate limit exceeded': t('tooManyAttempts') || 'Too many attempts. Try again later',
        'For security purposes': t('tooManyAttempts') || 'Too many attempts. Try again later',
        'Unable to validate email address': t('invalidEmail') || 'Invalid email address',
    };

    for (const [key, value] of Object.entries(map)) {
        if (msg.includes(key)) return value;
    }
    return msg || 'Authentication error';
}

/**
 * Logout current user.
 * Encerra a sessao do usuario atual.
 */
function handleLogout() {
    logout();
    showToast(t('loggedOut') || 'Logged out', 'info');
}

// ----------------------------------------------------------------
// AUTH MENU (TITLEBAR)
// ----------------------------------------------------------------

/**
 * Toggle auth: open SSO modal (if not logged in) or dropdown (if logged in).
 * Abre modal SSO ou dropdown conforme estado de login.
 */
function handleToggleAuthMenu() {
    const user = getCurrentUser();

    if (!user) {
        // Not logged in — open SSO modal
        handleOpenAuthModal();
        return;
    }

    // Logged in — toggle dropdown
    const menu = document.getElementById('auth-menu');
    if (!menu) return;

    const isVisible = menu.style.display !== 'none';
    menu.style.display = isVisible ? 'none' : 'block';

    if (!isVisible) {
        const close = (e) => {
            if (!menu.contains(e.target) && e.target.id !== 'auth-button') {
                menu.style.display = 'none';
                document.removeEventListener('click', close);
            }
        };
        setTimeout(() => document.addEventListener('click', close), 0);
    }
}

// ----------------------------------------------------------------
// ACCESS CONTROL MODAL
// ----------------------------------------------------------------

/**
 * Open Access Control modal.
 * Abre o modal de controle de acesso (so para admin/owner).
 */
function handleOpenAccessModal() {
    if (isAccessControlActive() && !isAdmin()) {
        showToast(t('permissionDenied') || 'Permission denied', 'error');
        return;
    }
    renderAccessModal();
    openModal('access-modal');
}

/**
 * Claim model ownership.
 * Reivindica propriedade do modelo (primeiro login).
 */
function handleClaimOwnership() {
    const email = getUserEmail();
    if (!email) {
        showToast(t('loginFirst') || 'Please login first', 'error');
        return;
    }

    if (getOwner()) {
        showToast(t('ownerExists') || 'Model already has an owner', 'error');
        return;
    }

    claimOwnership(email);
    renderAccessModal();
    if (updateAllUIRef) updateAllUIRef();
    showToast(t('ownershipClaimed') || 'Ownership claimed', 'success');
}

// ----------------------------------------------------------------
// RULE MANAGEMENT
// ----------------------------------------------------------------

/**
 * Add a new empty access rule.
 */
function handleAddAccessRule() {
    addRule({ email: '', role: 'viewer', areas: ['*'] });
    renderAccessModal();
}

/**
 * Remove an access rule by index.
 * @param {number} index
 */
function handleRemoveAccessRule(index) {
    removeRule(index);
    renderAccessModal();
}

/**
 * Update a rule field.
 * @param {number} index
 * @param {string} field - 'email', 'role', or 'areas'
 * @param {string} value
 */
function handleUpdateAccessRule(index, field, value) {
    if (field === 'areas') {
        const areas = value
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean);
        updateRule(index, { areas: areas.length > 0 ? areas : ['*'] });
    } else {
        updateRule(index, { [field]: value });
    }
}

/**
 * Update observer mode.
 * @param {string} mode
 */
function handleObserverModeChange(mode) {
    setObserverMode(mode);
    if (updateAllUIRef) updateAllUIRef();
}

// ----------------------------------------------------------------
// UI RENDERING
// ----------------------------------------------------------------

/**
 * Update auth UI: titlebar button, status bar, dropdown content.
 * Atualiza toda a interface de autenticacao.
 */
export function updateAuthUI() {
    updateAuthButton();
    updateAuthStatus();
    updateAuthMenuContent();
    updateNotificationBell();
    // Start/stop notification polling based on login state
    if (getCurrentUser()) startNotificationPolling();
    else stopNotificationPolling();
}

/**
 * Start background notification polling (60s interval).
 * Inicia polling de notificacoes a cada 60 segundos.
 */
function startNotificationPolling() {
    stopNotificationPolling();
    _notifPollInterval = setInterval(() => {
        if (!getCurrentUser()) {
            stopNotificationPolling();
            return;
        }
        updateNotificationBell();
    }, 60000);
}

/**
 * Stop background notification polling.
 * Para o polling de notificacoes.
 */
function stopNotificationPolling() {
    if (_notifPollInterval) {
        clearInterval(_notifPollInterval);
        _notifPollInterval = null;
    }
}

/**
 * Update the auth button in the titlebar.
 */
function updateAuthButton() {
    const label = document.getElementById('auth-button-label');
    if (!label) return;

    const user = getCurrentUser();
    if (user) {
        label.textContent = user.displayName.split(' ')[0];
    } else {
        label.textContent = t('login') || 'Login';
    }
}

/**
 * Update auth status indicator in status bar.
 */
function updateAuthStatus() {
    const el = document.getElementById('auth-status');
    if (!el) return;

    if (!isAccessControlActive()) {
        el.style.display = 'none';
        return;
    }

    el.style.display = '';
    const user = getCurrentUser();
    const role = getUserRole();

    if (!user) {
        const obsMode = getObserverMode();
        if (obsMode === 'public') {
            el.textContent = t('observerPublic') || 'Observer (Public)';
            el.className = 'status-item auth-status auth-observer';
        } else {
            el.textContent = t('notLoggedIn') || 'Not logged in';
            el.className = 'status-item auth-status auth-none';
        }
    } else {
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        el.textContent = `${roleLabel}: ${user.email}`;
        el.className = `status-item auth-status auth-${role}`;
    }
}

/**
 * Update auth dropdown content (logged-in state).
 * Atualiza conteudo do dropdown quando logado.
 */
function updateAuthMenuContent() {
    const menu = document.getElementById('auth-menu');
    if (!menu) return;

    const user = getCurrentUser();

    if (user) {
        const nameEl = document.getElementById('auth-display-name');
        const emailEl = document.getElementById('auth-email');
        if (nameEl) nameEl.textContent = user.displayName;
        if (emailEl) emailEl.textContent = user.email;

        // Exibe badge de credencial se usuário tiver nível acima de common
        const badgeEl = document.getElementById('auth-credential-badge');
        if (badgeEl) {
            const level = user.credentialLevel || 'common';
            if (level !== 'common') {
                badgeEl.textContent = EIS_CREDENTIAL_LABELS[level] || '';
                badgeEl.style.display = 'inline-block';
            } else {
                badgeEl.style.display = 'none';
            }
        }

        // INV-6: Exibe badge de tier (Early Adopter, VIP, etc.)
        const tierBadgeEl = document.getElementById('auth-tier-badge');
        if (tierBadgeEl) {
            const tier = user.tier || 'free';
            if (tier === 'early_adopter' || tier === 'vip' || tier === 'beta_tester') {
                const labels = {
                    early_adopter: t('invite.earlyAdopter') || 'Early Adopter',
                    vip: 'VIP',
                    beta_tester: 'Beta Tester',
                };
                tierBadgeEl.textContent = labels[tier] || tier;
                tierBadgeEl.className = `auth-tier-badge auth-tier-${tier.replace(/_/g, '-')}`;
                tierBadgeEl.style.display = 'inline-block';
            } else {
                tierBadgeEl.style.display = 'none';
            }
        }

        // INV-4: Exibe botao "Meus Convites" se INVITE_ONLY ativo
        const inviteBtn = document.getElementById('auth-invite-btn');
        if (inviteBtn) {
            inviteBtn.style.display = CONFIG.FEATURES.INVITE_ONLY ? '' : 'none';
        }

        // INV-5: Exibe botao "Admin Invites" se platform admin
        const adminInviteBtn = document.getElementById('auth-admin-invite-btn');
        if (adminInviteBtn) {
            const admins = CONFIG.PLATFORM_ADMINS || [];
            adminInviteBtn.style.display = admins.includes((user.email || '').toLowerCase()) ? '' : 'none';
        }

        // Show Stripe Connect button for all logged-in users
        const connectBtn = document.getElementById('stripe-connect-menu-btn');
        if (connectBtn) {
            connectBtn.style.display = '';
            // Update label based on Connect status
            checkConnectStatus()
                .then(({ status }) => {
                    const label = connectBtn.querySelector('[data-i18n="stripeConnect"]');
                    if (label) {
                        if (status === 'active') {
                            label.textContent = t('stripeConnectActive') || 'Stripe Connected';
                            connectBtn.classList.add('connect-active');
                        } else if (status === 'pending') {
                            label.textContent = t('stripeConnectPending') || 'Complete Stripe Setup';
                        } else {
                            label.textContent = t('stripeConnect') || 'Stripe Connect';
                            connectBtn.classList.remove('connect-active');
                        }
                    }
                })
                .catch(() => {
                    /* silently fail if Supabase unavailable */
                });
        }

        // Close SSO modal if open (user just logged in)
        handleCloseAuthModal();
    } else {
        // Hide dropdown when not logged in
        menu.style.display = 'none';
        // Hide Stripe Connect button
        const connectBtn = document.getElementById('stripe-connect-menu-btn');
        if (connectBtn) connectBtn.style.display = 'none';
    }
}

/**
 * Render the Access Control section in governance tab.
 * Renderiza a secao de controle de acesso na aba Governanca.
 *
 * @returns {string} HTML string
 */
export function renderAccessControlSection() {
    const owner = getOwner();
    const obsMode = getObserverMode();
    const rules = getRules();
    const canManage = !isAccessControlActive() || isAdmin();

    const areaOptions = getAreaOptions();

    let html = `
        <div class="section">
            <div class="section-header" onclick="window.toggleSection && window.toggleSection(this)">
                <span>${t('accessControl') || 'Access Control'}</span>
                <span class="section-chevron">&#9660;</span>
            </div>
            <div class="section-content">`;

    // Model Owner
    html += `
                <div class="gov-subsection-header">${t('modelOwner') || 'Model Owner'}</div>
                <div class="form-group" style="margin-bottom: 12px;">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="text" class="form-input form-input-sm" id="access-owner-display"
                               value="${escapeAttr(owner || '')}" readonly
                               placeholder="${t('noOwner') || 'No owner set'}"
                               style="flex: 1;">`;

    if (!owner) {
        html += `
                        <button class="btn btn-sm btn-primary" onclick="window.handleClaimOwnership()">
                            ${t('claimOwnership') || 'Claim'}
                        </button>`;
    }

    html += `
                    </div>
                </div>`;

    // Observer Mode
    html += `
                <div class="gov-subsection-header">${t('observerMode') || 'Observer Mode'}</div>
                <div class="form-group" style="margin-bottom: 12px;">
                    <select class="form-input form-input-sm" id="access-observer-mode"
                            onchange="window.handleObserverModeChange(this.value)"
                            ${canManage ? '' : 'disabled'}>
                        <option value="disabled" ${obsMode === 'disabled' ? 'selected' : ''}>
                            ${t('observerDisabled') || 'Disabled'}
                        </option>
                        <option value="authenticated" ${obsMode === 'authenticated' ? 'selected' : ''}>
                            ${t('observerAuthenticated') || 'Authenticated (email required)'}
                        </option>
                        <option value="public" ${obsMode === 'public' ? 'selected' : ''}>
                            ${t('observerPublic') || 'Public (anyone)'}
                        </option>
                    </select>
                    <small style="color: var(--neutral-500); font-size: 10px;">
                        ${t('observerHint') || 'Observers submit observations pending approval.'}
                    </small>
                </div>`;

    // Access Rules
    if (canManage) {
        html += `
                <div class="gov-subsection-header">
                    ${t('accessRules') || 'Access Rules'} (${rules.length})
                </div>`;

        if (rules.length === 0) {
            html += `<div class="gov-empty" style="font-size: 11px;">
                        ${t('noRules') || 'No rules defined. All users have full access.'}
                     </div>`;
        } else {
            for (let i = 0; i < rules.length; i++) {
                const rule = rules[i];
                html += `
                <div class="access-rule-row" style="display: flex; gap: 4px; margin-bottom: 4px; align-items: center;">
                    <input type="email" class="form-input form-input-sm" style="flex: 2;"
                           value="${escapeAttr(rule.email)}"
                           placeholder="user@example.com"
                           onchange="window.handleUpdateAccessRule(${i}, 'email', this.value)">
                    <select class="form-input form-input-sm" style="flex: 1;"
                            onchange="window.handleUpdateAccessRule(${i}, 'role', this.value)">
                        <option value="admin" ${rule.role === 'admin' ? 'selected' : ''}>Admin</option>
                        <option value="editor" ${rule.role === 'editor' ? 'selected' : ''}>Editor</option>
                        <option value="viewer" ${rule.role === 'viewer' ? 'selected' : ''}>Viewer</option>
                    </select>
                    <input type="text" class="form-input form-input-sm" style="flex: 1;"
                           value="${escapeAttr(rule.areas.join(', '))}"
                           placeholder="* (all)"
                           onchange="window.handleUpdateAccessRule(${i}, 'areas', this.value)">
                    <button class="btn btn-sm btn-danger" style="flex-shrink: 0;"
                            onclick="window.handleRemoveAccessRule(${i})">
                        <span data-icon="trash-2" data-icon-size="12px"></span>
                    </button>
                </div>`;
            }
        }

        html += `
                <button class="btn btn-sm btn-primary" onclick="window.handleAddAccessRule()" style="margin-top: 4px;">
                    + ${t('addRule') || 'Add Rule'}
                </button>`;
    }

    html += `
            </div>
        </div>`;

    return html;
}

/**
 * Render the access modal content.
 */
function renderAccessModal() {
    const container = document.getElementById('access-modal-body');
    if (!container) return;
    container.innerHTML = renderAccessControlSection();

    requestAnimationFrame(() => {
        if (window.hydrateIcons) window.hydrateIcons();
    });
}

/**
 * Get area options from the areas tree.
 * @returns {Array<{ id: string, name: string }>}
 */
function getAreaOptions() {
    const tree = window.areasTreeData || [];
    const options = [];
    function walk(node) {
        options.push({ id: node.id, name: node.name });
        if (Array.isArray(node.children)) {
            node.children.forEach(walk);
        }
    }
    tree.forEach(walk);
    return options;
}

// ----------------------------------------------------------------
// API KEYS
// Gerenciamento de chaves de API para acesso programático (MCP)
// ----------------------------------------------------------------

/**
 * Open the API Keys management modal.
 * Abre o modal de gerenciamento de chaves de API.
 */
function handleOpenApiKeys() {
    const user = getCurrentUser();
    if (!user) {
        showToast(t('loginRequired') || 'Login required', 'warning');
        return;
    }
    openApiKeyModal();
}

/**
 * Close the API Keys management modal.
 * Fecha o modal de gerenciamento de chaves de API.
 */
function handleCloseApiKeys() {
    closeApiKeyModal();
}

// ----------------------------------------------------------------
// STRIPE CONNECT
// Onboarding para criadores venderem bibliotecas
// ----------------------------------------------------------------

/**
 * Open Stripe Connect onboarding or show status.
 * Redireciona para onboarding do Stripe Express ou mostra status.
 */
async function handleOpenStripeConnect() {
    const user = getCurrentUser();
    if (!user) {
        showToast(t('loginRequired') || 'Login required', 'warning');
        return;
    }

    try {
        const { status } = await checkConnectStatus();

        if (status === 'active') {
            showToast(t('stripeConnectActive') || 'Stripe account connected!', 'success');
            return;
        }

        // Start or resume onboarding
        const url = await startConnectOnboarding();
        window.location.href = url;
    } catch (err) {
        showToast(err.message || 'Error starting Stripe Connect', 'error');
    }
}

// ----------------------------------------------------------------
// NOTIFICATIONS — Bell icon in titlebar
// Notificacoes in-app discretas (sem push, sem email, sem som)
// ----------------------------------------------------------------

/**
 * Update notification bell visibility and unread count.
 * Mostra/esconde o sino e atualiza badge de nao-lidas.
 */
function updateNotificationBell() {
    const wrapper = document.getElementById('notification-bell-wrapper');
    if (!wrapper) return;

    const user = getCurrentUser();
    if (!user) {
        wrapper.style.display = 'none';
        return;
    }

    wrapper.style.display = '';

    // Fetch unread count (non-blocking)
    getUnreadNotificationCount()
        .then((count) => {
            const badge = document.getElementById('notification-badge');
            if (badge) {
                if (count > 0) {
                    badge.textContent = count > 99 ? '99+' : String(count);
                    badge.style.display = '';
                } else {
                    badge.style.display = 'none';
                }
            }
        })
        .catch(() => {
            /* silently fail if Supabase unavailable */
        });
}

/**
 * Toggle notification dropdown.
 * Abre/fecha o dropdown de notificacoes.
 */
async function handleToggleNotifications() {
    const dropdown = document.getElementById('notification-dropdown');
    if (!dropdown) return;

    const isOpen = dropdown.classList.contains('open');
    if (isOpen) {
        dropdown.classList.remove('open');
        return;
    }

    // Open and load notifications
    dropdown.classList.add('open');
    const listEl = document.getElementById('notification-list');
    if (!listEl) return;

    listEl.innerHTML = `<div class="notification-empty">${t('libraryLoadingMarketplace') || 'Loading...'}</div>`;

    try {
        const items = await fetchNotifications(30);
        if (!items || items.length === 0) {
            listEl.innerHTML = `<div class="notification-empty">${t('noNotifications') || 'No notifications'}</div>`;
            return;
        }

        listEl.innerHTML = items
            .map((n) => {
                const iconMap = {
                    comment_on_yours: 'message-circle',
                    reply_to_comment: 'message-circle',
                    new_follower: 'user-plus',
                    library_update: 'refresh-cw',
                    purchase_confirmed: 'check',
                    rating_received: 'star',
                };
                const icon = iconMap[n.type] || 'bell';
                const unreadClass = n.is_read ? '' : ' unread';
                const time = _notifTimeAgo(n.created_at);

                return `<div class="notification-item${unreadClass}" data-notif-id="${escapeAttr(n.id)}">
                <div class="notification-item-icon"><span data-icon="${icon}" data-icon-size="14px"></span></div>
                <div class="notification-item-body">
                    <div class="notification-item-title">${escapeHtml(n.title)}</div>
                    <div class="notification-item-time">${time}</div>
                </div>
            </div>`;
            })
            .join('');

        // Hydrate icons in the dropdown
        if (typeof window.hydrateIcons === 'function') {
            requestAnimationFrame(() => window.hydrateIcons(dropdown));
        }
    } catch {
        listEl.innerHTML = `<div class="notification-empty">${t('error') || 'Error'}</div>`;
    }
}

/**
 * Mark all notifications as read.
 */
async function handleMarkAllNotificationsRead() {
    try {
        await markNotificationsRead([]);
        updateNotificationBell();
        // Update UI: remove unread styling
        const items = document.querySelectorAll('.notification-item.unread');
        items.forEach((el) => el.classList.remove('unread'));
    } catch {
        /* silent */
    }
}

/** Simple time-ago for notifications */
function _notifTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('justNow') || 'just now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
}

// Close notification dropdown when clicking outside
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('notification-dropdown');
    const wrapper = document.getElementById('notification-bell-wrapper');
    if (dropdown && wrapper && !wrapper.contains(e.target)) {
        dropdown.classList.remove('open');
    }
});

// ----------------------------------------------------------------
// INVITE-ONLY HANDLERS (INV-4)
// ----------------------------------------------------------------

/**
 * Process invite claim + generation after successful signup.
 * Reivindica o convite usado e gera 3 novos para o usuario.
 *
 * @param {string|undefined} userId - auth.users.id do novo usuario
 */
async function _processInviteAfterSignup(userId) {
    if (!userId) return;

    try {
        const { claimInviteCode, generateUserInvites } = await import('../auth/session.js');

        // Claim: ler codigo de sessionStorage ou localStorage (RED-1 fallback)
        const code = sessionStorage.getItem('ecbyts-invite-code') || localStorage.getItem('ecbyts-pending-invite');

        if (code) {
            await claimInviteCode(code, userId);
            sessionStorage.removeItem('ecbyts-invite-code');
            localStorage.removeItem('ecbyts-pending-invite');
        }

        // Gerar 3 convites para o novo usuario
        await generateUserInvites(userId);
    } catch (e) {
        console.warn('[Auth] Invite processing skipped:', e.message);
    }
}

/**
 * Open the "My Invites" panel.
 * Abre o painel com os codigos de convite do usuario.
 */
async function handleOpenInvitePanel() {
    try {
        const { renderInvitePanel } = await import('../ui/invitePanel.js');
        await renderInvitePanel();
    } catch (e) {
        console.error('[Auth] Failed to open invite panel:', e.message);
    }
}

/**
 * Copy invite link to clipboard.
 * @param {string} code - Codigo do convite
 */
async function handleCopyInviteLink(code) {
    const link = `${location.origin}/?invite=${code}`;
    try {
        await navigator.clipboard.writeText(link);
        showToast(t('invite.linkCopied') || 'Invite link copied!', 'success');
    } catch {
        showToast('Failed to copy', 'error');
    }
}

/**
 * Open the invite admin dashboard (platform admins only).
 * Abre o painel administrativo de convites e waitlist.
 */
async function handleOpenInviteAdmin() {
    try {
        const { openInviteAdminModal } = await import('../ui/inviteAdminModal.js');
        await openInviteAdminModal();
    } catch (e) {
        console.error('[Auth] Failed to open invite admin:', e.message);
    }
}

// ----------------------------------------------------------------
// EXPORTS
// ----------------------------------------------------------------

export const authHandlers = {
    handleLoginEmail,
    handleRegisterEmail,
    handleLoginGoogle,
    handleLoginGitHub,
    handleLoginMicrosoft,
    handleForgotPassword,
    handleLogout,
    handleToggleAuthMenu,
    handleOpenAuthModal,
    handleCloseAuthModal,
    handleOpenAccessModal,
    handleClaimOwnership,
    handleAddAccessRule,
    handleRemoveAccessRule,
    handleUpdateAccessRule,
    handleObserverModeChange,
    updateAuthUI,
    // Novos: tipo de cadastro e credenciais
    handleShowRegistrationTypes,
    handleHideRegistrationTypes,
    handleSelectUserType,
    handleOpenCredentialModal,
    handleCloseCredentialModal,
    handleSubmitCredentialUpload,
    handleSubmitCredential,
    updateCredentialEisPreview,
    handleOpenStripeConnect,
    handleToggleNotifications,
    handleMarkAllNotificationsRead,
    handleOpenApiKeys,
    handleCloseApiKeys,
    // INV-4/5: Invite handlers
    handleOpenInvitePanel,
    handleCopyInviteLink,
    handleOpenInviteAdmin,
};
