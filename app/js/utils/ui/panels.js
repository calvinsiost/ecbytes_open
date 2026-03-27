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
   PANEL MANAGEMENT — Collapsible & Resizable Panels
   ================================================================

   Este modulo gerencia os paineis laterais da aplicacao:
   - Painel esquerdo (familias): colapsavel + redimensionavel
   - Painel direito (propriedades): colapsavel
   - Analytics fullscreen: expande para area inteira

   CONTROLES:
   - Botao colapsar: esconde/mostra painel
   - Handle de resize: arrastar para redimensionar (apenas esquerdo)
   - Fullscreen analytics: toggle entre sidebar e tela inteira

   ================================================================ */

import { handleResize } from '../scene/setup.js';
import { activateTabById } from './tabs.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let leftCollapsed = false;
let rightCollapsed = false;
let analyticsFullscreen = false;

/** Largura original do painel esquerdo (para restaurar) */
let leftPanelWidth = 260;

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Initialize panel controls.
 * Configura resize handle e botoes de colapso.
 */
export function initPanels() {
    setupResizeHandle();
}

// ----------------------------------------------------------------
// LEFT PANEL — Collapsible + Resize
// ----------------------------------------------------------------

/**
 * Toggle left panel visibility.
 * Alterna o painel esquerdo entre visivel e colapsado.
 */
export function toggleLeftPanel() {
    const app = document.getElementById('app');
    const panel = document.getElementById('left-panel');
    const btn = document.getElementById('btn-collapse-left');

    leftCollapsed = !leftCollapsed;

    if (leftCollapsed) {
        app.style.setProperty('--left-panel-width', '0px');
        panel.classList.add('collapsed');
        if (btn) btn.textContent = '»';
    } else {
        app.style.setProperty('--left-panel-width', leftPanelWidth + 'px');
        panel.classList.remove('collapsed');
        if (btn) btn.textContent = '«';
    }

    // Recalcular canvas 3D apos mudanca de layout
    requestAnimationFrame(() => {
        const container = document.getElementById('canvas-container');
        if (container) handleResize(container);
    });
}

/**
 * Setup drag-to-resize handle for left panel.
 * Configura o handle de arrasto para redimensionar o painel esquerdo.
 */
function setupResizeHandle() {
    const handle = document.getElementById('resize-handle-left');
    if (!handle) return;

    let isResizing = false;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        // Limites: min 180px, max 400px
        const newWidth = Math.min(400, Math.max(180, e.clientX));
        leftPanelWidth = newWidth;

        const app = document.getElementById('app');
        app.style.setProperty('--left-panel-width', newWidth + 'px');

        // Recalcular canvas 3D durante resize
        const container = document.getElementById('canvas-container');
        if (container) handleResize(container);
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// ----------------------------------------------------------------
// RIGHT PANEL — Collapsible
// ----------------------------------------------------------------

/**
 * Toggle right panel visibility.
 * Alterna o painel direito entre visivel e colapsado.
 */
export function toggleRightPanel() {
    const app = document.getElementById('app');
    const panel = document.getElementById('right-panel');
    const btn = document.getElementById('btn-collapse-right');

    rightCollapsed = !rightCollapsed;

    if (rightCollapsed) {
        app.style.setProperty('--right-panel-width', '0px');
        panel.classList.add('collapsed');
        if (btn) btn.textContent = '«';
    } else {
        app.style.setProperty('--right-panel-width', '320px');
        panel.classList.remove('collapsed');
        if (btn) btn.textContent = '»';
    }

    // Recalcular canvas 3D
    requestAnimationFrame(() => {
        const container = document.getElementById('canvas-container');
        if (container) handleResize(container);
    });
}

// ----------------------------------------------------------------
// ANALYTICS FULLSCREEN
// ----------------------------------------------------------------

/**
 * Toggle analytics between sidebar and fullscreen mode.
 * Alterna analytics entre modo sidebar (320px) e tela inteira.
 */
export function toggleAnalyticsFullscreen() {
    const analyticsTab = document.getElementById('tab-analytics');
    const btn = document.getElementById('analytics-fullscreen-btn');
    if (!analyticsTab) return;

    analyticsFullscreen = !analyticsFullscreen;

    if (analyticsFullscreen) {
        analyticsTab.classList.add('analytics-fullscreen');
        if (btn) btn.textContent = 'Collapse';
        // Ativa aba analytics automaticamente
        activateTabById('analytics');
    } else {
        analyticsTab.classList.remove('analytics-fullscreen');
        if (btn) btn.textContent = 'Expand';
    }
}
