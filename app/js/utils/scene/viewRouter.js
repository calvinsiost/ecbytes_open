// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   VIEW ROUTER — 4-mode view state machine
   Roteador de views — maquina de estado para 4 modos

   Fonte unica de verdade para o modo de visualizacao ativo.
   controls.js recebe modo do viewRouter, nunca gerencia estado proprio.
   ================================================================ */

import { handleResize } from './setup.js';
import { t } from '../i18n/translations.js';

// --- Constants (exported for reuse across modules) ---
export const VIEW_MODES = Object.freeze({
    ACTIONS: 'actions',
    TWO_D: '2d',
    TWO_D_D: '2d-depth',
    THREE_D: '3d',
});

const VALID_MODES = Object.values(VIEW_MODES);
const LS_KEY = 'ecbyts-default-view';

// --- State ---
let _currentView = VIEW_MODES.ACTIONS;
let _sceneInitFn = null;
let _sceneReady = false;
let _initializing = false;
let _hasWebGL = true;

// --- Public API ---

/**
 * Initialize the view router. Reads localStorage for last-used view.
 * Apenas le o modo salvo — NAO aplica. Aplicar via applySavedView() apos boot.
 */
export function initViewRouter() {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && VALID_MODES.includes(saved)) {
        _currentView = saved;
    } else {
        _currentView = VIEW_MODES.ACTIONS;
    }
    _checkWebGL();
    _updateViewModeBadge(_currentView);
}

/**
 * Apply the saved view mode (call after boot completes).
 * Se modo salvo != 'actions', faz switchView para restaurar.
 */
export async function applySavedView() {
    if (_currentView !== VIEW_MODES.ACTIONS) {
        const mode = _currentView;
        _currentView = VIEW_MODES.ACTIONS; // reset so switchView doesn't no-op
        await switchView(mode);
    }
}

/**
 * Register the lazy scene initialization callback.
 * @param {Function} initFn - async function that initializes 3D scene
 */
export function onSceneReady(initFn) {
    _sceneInitFn = initFn;
}

/**
 * Switch between view modes. Single source of truth.
 * @param {string} mode
 */
export async function switchView(mode) {
    if (!VALID_MODES.includes(mode)) return;
    if (mode === _currentView) return;

    // Invite gate: block view switching for unauthenticated users in invite-only mode
    try {
        const { requireAuth } = await import('../auth/inviteGate.js');
        if (requireAuth()) return;
    } catch (_) {
        /* inviteGate not available = no gate */
    }

    const from = _currentView;
    _currentView = mode;

    // Persist
    try {
        localStorage.setItem(LS_KEY, mode);
    } catch {
        /* */
    }

    // Track telemetry
    import('../telemetry/tracker.js')
        .then(({ trackEvent }) => {
            trackEvent('toggle', 'view-mode', { from, to: mode });
        })
        .catch(() => {});

    _updateViewModeBadge(mode);

    if (mode === VIEW_MODES.ACTIONS) {
        // Lazy import to avoid circular dependency at module load time
        const { showHomeView } = await import('../ui/homeGrid.js');
        showHomeView();
    } else {
        // Ensure scene is initialized before showing canvas
        if (!_sceneReady && _sceneInitFn && !_initializing) {
            _initializing = true;
            // Show canvas first so loading indicator is visible
            const { hideHomeView } = await import('../ui/homeGrid.js');
            hideHomeView();
            _showLoadingInCanvas();
            try {
                await _sceneInitFn();
                _sceneReady = true;
            } catch (e) {
                console.error('[ecbyts:viewRouter] Scene init failed:', e?.message);
                _showSceneError();
            } finally {
                _initializing = false;
                _hideLoadingInCanvas();
            }
        } else {
            const { hideHomeView } = await import('../ui/homeGrid.js');
            hideHomeView();
        }

        // Ribbon pode ter sido inicializada com width=0 no modo Actions.
        // Recalcula overflow para garantir que o botão "Mais" apareça corretamente.
        import('../ui/ribbon.js')
            .then(({ refreshRibbonLayout }) => {
                refreshRibbonLayout();
            })
            .catch(() => {});

        // Handle specific spatial modes
        if (mode === VIEW_MODES.TWO_D_D && !_has2DDepthComponent()) {
            _showEmptyState2DD();
        } else {
            _hideEmptyState2DD();
            if (_sceneReady) {
                import('./controls.js')
                    .then(({ setViewMode }) => {
                        setViewMode(mode);
                    })
                    .catch(() => {});

                const container = document.getElementById('canvas-container');
                if (container) {
                    requestAnimationFrame(() => handleResize(container));
                }
            }
        }
    }

    window.dispatchEvent(new CustomEvent('viewChanged', { detail: { mode, from } }));
}

/** @returns {string} */
export function getCurrentView() {
    return _currentView;
}

/** @returns {boolean} */
export function isSceneReady() {
    return _sceneReady;
}

export function markSceneReady() {
    _sceneReady = true;
}

// --- Internal ---

function _updateViewModeBadge(mode) {
    const labels = {
        [VIEW_MODES.ACTIONS]: t('viewActions') || 'Actions',
        [VIEW_MODES.TWO_D]: t('view2d') || '2D',
        [VIEW_MODES.TWO_D_D]: t('view2dDepth') || '2D+D',
        [VIEW_MODES.THREE_D]: t('view3d') || '3D',
    };
    const badge = document.getElementById('view-mode-badge');
    if (!badge) return;

    const modeLabel = labels[mode] || '3D';
    badge.textContent = modeLabel;
    badge.classList.toggle('active', mode !== VIEW_MODES.THREE_D);
    badge.setAttribute('aria-current', 'true');
    badge.setAttribute('aria-label', `Toggle view mode (current: ${modeLabel})`);
    badge.setAttribute('title', _hasWebGL ? modeLabel : 'WebGL unavailable');
}

function _checkWebGL() {
    try {
        const canvas = document.createElement('canvas');
        _hasWebGL = !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
        /* */
    }
}

function _has2DDepthComponent() {
    return false; // v1: cross-section component does not exist yet
}

function _showEmptyState2DD() {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    _hideEmptyState2DD();

    const el = document.createElement('div');
    el.id = 'empty-state-2dd';
    el.className = 'home-empty-state';
    el.setAttribute('data-testid', 'empty-state-2dd');

    el.innerHTML = `
        <span data-icon="layers" data-icon-size="48px"></span>
        <h3>${t('emptyState2dd') || '2D+D Visualization'}</h3>
        <p>${t('emptyState2ddDesc') || 'This view requires depth data (wells, cross-sections).'}</p>
    `;

    const btn = document.createElement('button');
    btn.textContent = t('backToActions') || 'Back to Actions';
    btn.addEventListener('click', () => switchView(VIEW_MODES.ACTIONS));
    el.appendChild(btn);

    container.appendChild(el);
    if (typeof window.hydrateIcons === 'function') window.hydrateIcons();
}

function _hideEmptyState2DD() {
    const el = document.getElementById('empty-state-2dd');
    if (el) el.remove();
}

function _showLoadingInCanvas() {
    const container = document.getElementById('canvas-container');
    if (!container) return;

    const el = document.createElement('div');
    el.id = 'home-3d-loading';
    el.className = 'home-3d-loading';
    el.setAttribute('data-testid', 'loading-3d');
    el.innerHTML = `
        <div class="home-3d-loading-spinner"></div>
        <span>${t('loading3dScene') || 'Loading 3D scene...'}</span>
    `;
    container.appendChild(el);
}

function _hideLoadingInCanvas() {
    const el = document.getElementById('home-3d-loading');
    if (el) el.remove();
}

function _showSceneError() {
    const container = document.getElementById('canvas-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = 'home-empty-state';
    el.id = 'scene-error-state';
    el.innerHTML = `
        <h3>${t('sceneError') || '3D scene failed to load'}</h3>
        <p>${t('sceneErrorDesc') || 'Try refreshing the page.'}</p>
    `;
    const btn = document.createElement('button');
    btn.textContent = t('backToActions') || 'Back to Actions';
    btn.addEventListener('click', () => switchView(VIEW_MODES.ACTIONS));
    el.appendChild(btn);
    container.appendChild(el);
}
