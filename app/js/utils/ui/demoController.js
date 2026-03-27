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
   DEMO CONTROLLER UI — FAB button, selection panel, navigation overlay
   Interface do modo de demonstracao interativa

   Componentes:
   1. FAB (Floating Action Button) — canto inferior direito
   2. Painel de selecao — vertical/modulo/caso
   3. Navigation overlay — prev/next/exit durante demo ativa

   ================================================================ */

import { getIcon } from './icons.js';
import { t, applyTranslations } from '../i18n/translations.js';

// ----------------------------------------------------------------
// VERTICAL & MODULE METADATA
// ----------------------------------------------------------------

const VERTICALS = [
    {
        id: 'mining',
        icon: 'mountain',
        labelKey: 'demoMining',
        fallback: 'Mining',
        color: '#e67e22',
    },
    {
        id: 'forestry',
        icon: 'trees',
        labelKey: 'demoForestry',
        fallback: 'Forestry',
        color: '#27ae60',
    },
    {
        id: 'contamination',
        icon: 'flask-round',
        labelKey: 'demoContamination',
        fallback: 'Contaminated Areas',
        color: '#e74c3c',
    },
    {
        id: 'occupational_health',
        icon: 'hard-hat',
        labelKey: 'demoOccupationalHealth',
        fallback: 'Occupational Health',
        color: '#3498db',
    },
];

const MODULES = [
    {
        id: 'neural_net',
        icon: 'brain',
        labelKey: 'demoNeuralNet',
        fallback: 'Neural Network',
        color: '#9b59b6',
    },
    {
        id: 'ai_bot',
        icon: 'bot',
        labelKey: 'demoAIBot',
        fallback: 'AI Bot',
        color: '#1abc9c',
    },
    {
        id: 'satellite',
        icon: 'satellite',
        labelKey: 'demoSatellite',
        fallback: 'Satellite Recognition',
        color: '#f39c12',
    },
];

// ----------------------------------------------------------------
// RISK LEVEL BADGES
// ----------------------------------------------------------------

const RISK_COLORS = {
    low: { bg: '#dcfce7', text: '#166534', label: 'LOW' },
    med: { bg: '#fef3c7', text: '#92400e', label: 'MED' },
    high: { bg: '#fecaca', text: '#991b1b', label: 'HIGH' },
};

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Initialize demo UI components.
 * Creates FAB button if not already present.
 */
export function initDemoUI() {
    // FAB button is in index.html, just ensure it exists
    const fab = document.getElementById('tour-controller');
    if (!fab) {
        console.warn('[DemoUI] #tour-controller not found in DOM');
    }
}

// ----------------------------------------------------------------
// PANEL RENDERING
// ----------------------------------------------------------------

/**
 * Show the demo selection panel.
 */
export function showDemoPanel() {
    const panel = document.getElementById('demo-panel');
    if (panel) {
        panel.style.display = '';
        panel.classList.add('active');
    }
    // Hide FAB when panel is open
    const fab = document.getElementById('tour-controller');
    if (fab) fab.style.display = 'none';
}

/**
 * Hide the demo selection panel.
 */
export function hideDemoPanel() {
    const panel = document.getElementById('demo-panel');
    if (panel) {
        panel.classList.remove('active');
        panel.style.display = 'none';
    }
    // Show FAB again
    const fab = document.getElementById('tour-controller');
    if (fab) fab.style.display = '';
}

/**
 * Render the demo controller panel content.
 * @param {Object} state - DemoState
 * @param {string|null} selectedVertical
 * @param {string|null} selectedModule
 * @param {Object|null} [previewCase] - Optional case to preview
 */
export function renderDemoController(state, selectedVertical, selectedModule, previewCase) {
    const panel = document.getElementById('demo-panel');
    if (!panel) return;

    let html = '';

    // Header
    html += `
        <div class="demo-panel-header">
            <h3>${safeIcon('play-circle')} ${tSafe('demoMode', 'Demo Mode')}</h3>
            <button class="demo-panel-close" onclick="window.handleCloseDemo()" title="Close">
                ${safeIcon('x')}
            </button>
        </div>
    `;

    // Step 1: Vertical selection
    html += `<div class="demo-section">
        <div class="demo-section-label">${tSafe('demoSelectVertical', 'Select Vertical')}</div>
        <div class="demo-grid">`;

    for (const v of VERTICALS) {
        const isSelected = selectedVertical === v.id;
        const cls = isSelected ? 'demo-card selected' : 'demo-card';
        html += `
            <button class="${cls}" onclick="window.handleSelectVertical('${v.id}')"
                    style="--card-color: ${v.color}">
                <span class="demo-card-icon">${safeIcon(v.icon)}</span>
                <span class="demo-card-label">${tSafe(v.labelKey, v.fallback)}</span>
            </button>`;
    }
    html += `</div></div>`;

    // Step 2: Module selection (only if vertical selected)
    if (selectedVertical) {
        html += `<div class="demo-section">
            <div class="demo-section-label">${tSafe('demoSelectModule', 'Select Module')}</div>
            <div class="demo-grid demo-grid-3">`;

        for (const m of MODULES) {
            const isSelected = selectedModule === m.id;
            const cls = isSelected ? 'demo-card selected' : 'demo-card';
            html += `
                <button class="${cls}" onclick="window.handleSelectModule('${m.id}')"
                        style="--card-color: ${m.color}">
                    <span class="demo-card-icon">${safeIcon(m.icon)}</span>
                    <span class="demo-card-label">${tSafe(m.labelKey, m.fallback)}</span>
                </button>`;
        }
        html += `</div></div>`;
    }

    // Step 3: Start button
    if (selectedVertical) {
        const moduleLabel = selectedModule
            ? MODULES.find((m) => m.id === selectedModule)?.fallback || ''
            : tSafe('demoAnyModule', 'any module');

        html += `
            <div class="demo-section demo-actions">
                <button class="demo-start-btn" onclick="window.handleStartDemo()">
                    ${safeIcon('play')} ${tSafe('demoStart', 'Start Demo')}
                </button>
                <span class="demo-hint">
                    ${tSafe('demoRandomCase', 'A random case will be selected')}
                </span>
            </div>`;
    }

    panel.innerHTML = html;
    applyTranslations(panel);
}

// ----------------------------------------------------------------
// NAVIGATION OVERLAY
// ----------------------------------------------------------------

/**
 * Show the navigation overlay during active demo.
 * @param {Object} state - DemoState from getDemoState()
 */
export function showNavigationOverlay(state) {
    const overlay = document.getElementById('demo-overlay');
    if (!overlay) return;

    overlay.style.display = '';

    if (!state.currentCase) return;

    const steps = state.currentCase.steps;
    const current = state.currentStep;
    const total = steps.length;
    const step = current >= 0 && current < total ? steps[current] : null;
    const progress = total > 0 ? ((current + 1) / total) * 100 : 0;

    const canPrev = current > 0;
    const canNext = current < total - 1;

    // Risk badge
    const risk = RISK_COLORS[state.currentCase.riskLevel] || RISK_COLORS.med;

    const titleEl = document.getElementById('demo-step-title');
    const counterEl = document.getElementById('demo-step-counter');
    const progressFill = document.getElementById('demo-progress-fill');
    const caseTitle = document.getElementById('demo-case-title');
    const riskBadge = document.getElementById('demo-risk-badge');
    const prevBtn = document.getElementById('demo-prev-btn');
    const nextBtn = document.getElementById('demo-next-btn');

    if (caseTitle) {
        caseTitle.textContent = state.currentCase.title || '';
    }

    if (riskBadge) {
        riskBadge.textContent = risk.label;
        riskBadge.style.backgroundColor = risk.bg;
        riskBadge.style.color = risk.text;
    }

    if (titleEl && step) {
        titleEl.textContent = step.title || '';
    }

    if (counterEl) {
        counterEl.textContent = `${current + 1} / ${total}`;
    }

    if (progressFill) {
        progressFill.style.width = `${progress}%`;
    }

    if (prevBtn) {
        prevBtn.disabled = !canPrev;
        prevBtn.style.opacity = canPrev ? '1' : '0.3';
    }

    if (nextBtn) {
        nextBtn.disabled = !canNext;
        nextBtn.style.opacity = canNext ? '1' : '0.3';
    }
}

/**
 * Hide the navigation overlay.
 */
export function hideNavigationOverlay() {
    const overlay = document.getElementById('demo-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function safeIcon(name) {
    try {
        return getIcon(name, { size: '16px' });
    } catch {
        return '';
    }
}

function tSafe(key, fallback) {
    try {
        const val = t(key);
        return val && val !== key ? val : fallback;
    } catch {
        return fallback;
    }
}
