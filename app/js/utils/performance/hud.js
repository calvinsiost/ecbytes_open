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
   PERFORMANCE HUD — On-screen metrics display
   Overlay no canto inferior-direito com metricas de performance.

   Mostra FPS, Renders/s, UI Updates/s, RAM e status do loop.
   Toggle via Ctrl+Shift+P ou handleTogglePerfMonitor().
   ================================================================ */

import { getPerfMonitor } from './monitor.js';
import { safeSetItem } from '../storage/storageMonitor.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

let _hud = null;
let _intervalId = null;
let _visible = false;

const STORAGE_KEY = 'ecbyts-perf-hud';
const UPDATE_INTERVAL = 1000; // 1s refresh

// ----------------------------------------------------------------
// INIT
// ----------------------------------------------------------------

/**
 * Initialize the Performance HUD.
 * Cria o elemento DOM e restaura visibilidade salva.
 */
export function initPerfHud() {
    if (_hud) return;

    _hud = document.createElement('div');
    _hud.id = 'perf-hud';
    _hud.className = 'perf-hud';
    document.body.appendChild(_hud);

    // Restore saved state
    try {
        if (localStorage.getItem(STORAGE_KEY) === 'true') {
            _show();
        }
    } catch {
        /* ignore */
    }

    // Keyboard shortcut: Ctrl+Shift+P
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'P') {
            e.preventDefault();
            togglePerfHud();
        }
    });
}

// ----------------------------------------------------------------
// TOGGLE
// ----------------------------------------------------------------

/**
 * Toggle HUD visibility.
 * Alterna exibicao do painel de metricas.
 */
export function togglePerfHud() {
    if (_visible) _hide();
    else _show();
}

function _show() {
    if (!_hud) return;
    _visible = true;
    _hud.classList.add('visible');
    _startUpdating();
    _persist();
}

function _hide() {
    if (!_hud) return;
    _visible = false;
    _hud.classList.remove('visible');
    _stopUpdating();
    _persist();
}

// ----------------------------------------------------------------
// RENDERING — Update HUD content every second
// ----------------------------------------------------------------

function _startUpdating() {
    if (_intervalId) return;
    _updateDisplay(); // Immediate first render
    _intervalId = setInterval(_updateDisplay, UPDATE_INTERVAL);
}

function _stopUpdating() {
    if (_intervalId) {
        clearInterval(_intervalId);
        _intervalId = null;
    }
}

function _updateDisplay() {
    if (!_hud || !_visible) return;

    const m = getPerfMonitor().getMetrics();

    const fpsColor =
        m.fps >= 50
            ? 'var(--accent-green, #22c55e)'
            : m.fps >= 25
              ? 'var(--accent-yellow, #eab308)'
              : 'var(--accent-red, #ef4444)';

    const loopStatus = m.loopRunning ? 'ACTIVE' : 'PAUSED';
    const loopColor = m.loopRunning ? 'var(--accent-green, #22c55e)' : 'var(--accent-blue, #3b82f6)';

    _hud.innerHTML = `
        <span style="color:${fpsColor}">${m.fps}</span> FPS
        <span class="perf-sep">|</span>
        <span>${m.renderCount}</span> R/s
        <span class="perf-sep">|</span>
        <span>${m.uiUpdateCount}</span> UI/s
        <span class="perf-sep">|</span>
        <span>${m.memoryMB || '—'}</span> MB
        <span class="perf-sep">|</span>
        <span style="color:${loopColor}">${loopStatus}</span>`;
}

// ----------------------------------------------------------------
// PERSISTENCE
// ----------------------------------------------------------------

function _persist() {
    try {
        safeSetItem(STORAGE_KEY, _visible ? 'true' : 'false');
    } catch {
        /* ignore */
    }
}
