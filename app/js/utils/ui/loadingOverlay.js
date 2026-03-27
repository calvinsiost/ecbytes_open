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

/**
 * Loading Overlay — Indicador universal de carregamento
 *
 * Overlay fullscreen reutilizavel para operacoes async longas:
 * processamento de arquivos, carregamento de IA, etc.
 *
 * API:
 *   showLoading(message?)         — mostra overlay com spinner
 *   hideLoading()                 — esconde overlay
 *   setLoadingMessage(msg)        — atualiza mensagem sem piscar
 *   setLoadingProgress(pct, msg?) — modo progress bar (0-100)
 *   withLoading(promise, msg?)    — auto show/hide em torno de promise
 */

// ── Estado ──────────────────────────────────────────────────
let _overlay = null;
let _messageEl = null;
let _progressBar = null;
let _progressTrack = null;
let _percentEl = null;
let _visible = false;
let _refCount = 0; // permite chamadas aninhadas
let _startTime = 0;
let _timerInterval = null;
let _stuckTimer = null;
const LOADING_MAX_MS = 180000; // failsafe: evita loading infinito

// ── CSS (injetado uma vez) ──────────────────────────────────
const OVERLAY_CSS = `
.ecbt-loading-overlay {
    position: fixed;
    inset: 0;
    z-index: 99998;
    background: rgba(6, 15, 28, 0.92);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 1.25rem;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
}
.ecbt-loading-overlay.visible {
    opacity: 1;
    pointer-events: auto;
}

/* Container com glassmorphism sutil */
.ecbt-loading-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.25rem;
    padding: 2.5rem 3rem;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

/* Spinner duplo-anel */
.ecbt-loading-spinner {
    position: relative;
    width: 56px;
    height: 56px;
}
.ecbt-loading-spinner::before,
.ecbt-loading-spinner::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid transparent;
}
.ecbt-loading-spinner::before {
    border-top-color: #5eead4;
    border-right-color: rgba(94, 234, 212, 0.3);
    animation: ecbt-spin 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.ecbt-loading-spinner::after {
    inset: 6px;
    border-bottom-color: rgba(94, 234, 212, 0.5);
    border-left-color: rgba(94, 234, 212, 0.15);
    animation: ecbt-spin 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite reverse;
}

.ecbt-loading-message {
    font-family: Inter, system-ui, sans-serif;
    font-size: 0.9rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.75);
    letter-spacing: 0.02em;
    text-align: center;
    max-width: 320px;
    line-height: 1.5;
}

.ecbt-loading-percent {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.75rem;
    color: rgba(94, 234, 212, 0.8);
    letter-spacing: 0.05em;
    display: none;
}

.ecbt-loading-progress-track {
    width: 220px;
    height: 3px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    overflow: hidden;
    display: none;
}
.ecbt-loading-progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #5eead4, #2dd4bf);
    border-radius: 4px;
    width: 0%;
    transition: width 0.35s ease;
    box-shadow: 0 0 8px rgba(94, 234, 212, 0.4);
}

/* Botao cancelar — visivel imediatamente */
.ecbt-loading-cancel {
    margin-top: 0.5rem;
    padding: 6px 20px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.75rem;
    font-family: Inter, system-ui, sans-serif;
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.03em;
}
.ecbt-loading-cancel:hover {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.8);
    border-color: rgba(255, 255, 255, 0.25);
}

@keyframes ecbt-spin { to { transform: rotate(360deg); } }
`;

// ── Inicializacao lazy ──────────────────────────────────────
function _ensureDOM() {
    if (_overlay) return;

    // Injetar CSS
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    document.head.appendChild(style);

    // Criar overlay
    _overlay = document.createElement('div');
    _overlay.className = 'ecbt-loading-overlay';
    _overlay.innerHTML = `
        <div class="ecbt-loading-card">
            <div class="ecbt-loading-spinner"></div>
            <div class="ecbt-loading-message"></div>
            <div class="ecbt-loading-percent"></div>
            <div class="ecbt-loading-progress-track">
                <div class="ecbt-loading-progress-bar"></div>
            </div>
            <button class="ecbt-loading-cancel" onclick="window.forceHideLoading()" title="Cancel">&#10005;</button>
        </div>
    `;
    _messageEl = _overlay.querySelector('.ecbt-loading-message');
    _percentEl = _overlay.querySelector('.ecbt-loading-percent');
    _progressTrack = _overlay.querySelector('.ecbt-loading-progress-track');
    _progressBar = _overlay.querySelector('.ecbt-loading-progress-bar');
    document.body.appendChild(_overlay);
}

// ── API Publica ─────────────────────────────────────────────

/**
 * Mostra overlay de carregamento.
 * Chamadas aninhadas sao seguras (ref-counted).
 * @param {string} [message=''] - Mensagem exibida abaixo do spinner
 */
export function showLoading(message = '') {
    _ensureDOM();
    _refCount++;
    _messageEl.textContent = message;
    _progressTrack.style.display = 'none';
    _progressBar.style.width = '0%';
    if (_percentEl) {
        _percentEl.style.display = 'none';
        _percentEl.textContent = '';
    }
    if (!_visible) {
        _visible = true;
        _startTime = Date.now();
        _startElapsedTimer();
        _startStuckTimer();
        _overlay.offsetHeight;  
        _overlay.classList.add('visible');
    }
}

/**
 * Timer que atualiza tempo decorrido a cada segundo (quando sem progress bar).
 */
function _startElapsedTimer() {
    _stopElapsedTimer();
    _timerInterval = setInterval(() => {
        if (!_visible || !_percentEl) return;
        // So mostrar elapsed se nao estiver em modo progress (que ja mostra %)
        if (_progressTrack && _progressTrack.style.display === 'block') return;
        const elapsed = Math.floor((Date.now() - _startTime) / 1000);
        if (elapsed >= 2) {
            _percentEl.style.display = 'block';
            _percentEl.textContent = _formatElapsed(elapsed);
        }
    }, 1000);
}

function _stopElapsedTimer() {
    if (_timerInterval) {
        clearInterval(_timerInterval);
        _timerInterval = null;
    }
}

function _startStuckTimer() {
    _stopStuckTimer();
    _stuckTimer = setTimeout(() => {
        if (!_visible) return;
        const elapsedMs = Date.now() - _startTime;
        console.warn(`[loadingOverlay] force hide after ${elapsedMs}ms`);
        forceHideLoading();
        try {
            window.dispatchEvent(new CustomEvent('ecbyts:loading-stuck', { detail: { elapsedMs } }));
        } catch {
            // noop
        }
    }, LOADING_MAX_MS);
}

function _stopStuckTimer() {
    if (_stuckTimer) {
        clearTimeout(_stuckTimer);
        _stuckTimer = null;
    }
}

function _formatElapsed(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

/**
 * Esconde overlay. Se houve chamadas aninhadas, so esconde quando
 * todas terminarem.
 */
export function hideLoading() {
    if (_refCount > 0) _refCount--;
    if (_refCount <= 0) {
        _refCount = 0;
        _visible = false;
        _stopElapsedTimer();
        _stopStuckTimer();
        if (_overlay) _overlay.classList.remove('visible');
    }
}

/**
 * Atualiza mensagem sem piscar o overlay.
 * @param {string} message
 */
export function setLoadingMessage(message) {
    if (_messageEl) _messageEl.textContent = message;
}

/**
 * Ativa modo progress bar e atualiza percentual.
 * @param {number} percent - 0 a 100
 * @param {string} [message] - Mensagem opcional (atualiza se fornecida)
 */
export function setLoadingProgress(percent, message) {
    _ensureDOM();
    const pct = Math.min(100, Math.max(0, percent));
    if (_progressTrack) _progressTrack.style.display = 'block';
    if (_progressBar) _progressBar.style.width = pct + '%';
    if (message !== undefined && _messageEl) _messageEl.textContent = message;

    // Mostrar percentual + ETA
    if (_percentEl && pct > 0) {
        _percentEl.style.display = 'block';
        const elapsed = (Date.now() - _startTime) / 1000;
        let etaText = '';
        if (pct > 5 && elapsed > 2) {
            const totalEstimated = elapsed / (pct / 100);
            const remaining = Math.max(0, Math.ceil(totalEstimated - elapsed));
            etaText = remaining > 0 ? ` &#8212; ~${_formatElapsed(remaining)} restante` : '';
        }
        _percentEl.innerHTML = `${Math.round(pct)}%${etaText}`;
    }
}

/**
 * Wrapper: mostra loading durante execucao de uma Promise.
 * @param {Promise} promise - Promise a executar
 * @param {string} [message='Processing...'] - Mensagem
 * @returns {Promise} Resultado da promise original
 */
export async function withLoading(promise, message = 'Processing...') {
    showLoading(message);
    try {
        return await promise;
    } finally {
        hideLoading();
    }
}

/**
 * Forca reset do loading (limpa ref count).
 * Usar apenas em error boundaries.
 */
export function forceHideLoading() {
    _refCount = 0;
    _visible = false;
    _stopElapsedTimer();
    _stopStuckTimer();
    if (_overlay) _overlay.classList.remove('visible');
}
