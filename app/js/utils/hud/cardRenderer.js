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
   HUD CARDS RENDERER — DOM, accordion, visibility
   ================================================================

   Renderiza cards de intangiveis/genericos como HUD fixo no viewport.
   Posicionado no canto inferior esquerdo, acima da constellation bar.
   Cada card exibe resumo do elemento com expansao/recolhimento.

   ================================================================ */

import { getHudCardsConfig, getIntangibleGenericElements, isCardExpanded } from './cardManager.js';
import { getIcon } from '../ui/icons.js';
import { escapeHtml } from '../helpers/html.js';
import { t } from '../i18n/translations.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let panel = null;
let _minimized = true;

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Create HUD cards panel DOM element.
 * Appended to #main-area for absolute positioning over the 3D viewport.
 */
export function initHudCardsPanel() {
    if (panel) return;

    panel = document.createElement('div');
    panel.id = 'hud-cards-panel';
    panel.className = 'hud-cards-panel';

    panel.innerHTML = `
        <div class="hud-cards-header" id="hud-cards-header">
            <span class="hud-cards-title">${getIcon('sparkles', { size: '14px' })} ${t('hudCards') || 'Intangibles'}</span>
            <div class="hud-cards-actions">
                <button type="button" class="hud-cards-btn" onclick="handleExpandAllHudCards()" title="${t('expandAll') || 'Expand All'}">
                    ${getIcon('chevrons-down', { size: '12px' })}
                </button>
                <button type="button" class="hud-cards-btn" onclick="handleCollapseAllHudCards()" title="${t('collapseAll') || 'Collapse All'}">
                    ${getIcon('chevrons-up', { size: '12px' })}
                </button>
                <button type="button" class="hud-cards-btn hud-minimize-btn" id="hud-minimize-btn" title="${t('minimize') || 'Minimize'}">
                    ${getIcon('minus', { size: '12px' })}
                </button>
                <button type="button" class="hud-cards-btn" onclick="handleToggleHudCards()" title="${t('close') || 'Close'}">
                    ${getIcon('x', { size: '12px' })}
                </button>
            </div>
        </div>
        <div class="hud-cards-body" id="hud-cards-body"></div>
    `;

    const container = document.getElementById('canvas-container') || document.getElementById('main-area');
    if (container) {
        container.appendChild(panel);
    }

    // Nasce minimizado — só header visivel
    panel.classList.add('hud-cards-minimized');
    const bodyEl = document.getElementById('hud-cards-body');
    if (bodyEl) bodyEl.style.display = 'none';

    // Minimize toggle
    const minBtn = document.getElementById('hud-minimize-btn');
    if (minBtn) {
        minBtn.addEventListener('click', () => {
            _minimized = !_minimized;
            const body = document.getElementById('hud-cards-body');
            if (body) body.style.display = _minimized ? 'none' : '';
            panel.classList.toggle('hud-cards-minimized', _minimized);
        });
    }

    // Posicionamento procedural: alinha ao lado direito do #view-controls
    _positionHudPanel();
    const viewControls = document.getElementById('view-controls');
    if (viewControls && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(_positionHudPanel).observe(viewControls);
    }

    // Limpar localStorage legado de resize incompatível
    try {
        localStorage.removeItem('ecbyts-hudcards-dims');
    } catch (_) {}
}

/**
 * Recalcula `left` do panel baseado na largura real de #view-controls.
 * Evita hardcode de número de botões.
 */
function _positionHudPanel() {
    if (!panel) return;
    const vc = document.getElementById('view-controls');
    if (!vc) return;
    const gap = 12; // px de espaço entre view-controls e o panel
    const vcRect = vc.getBoundingClientRect();
    const containerRect = (vc.offsetParent || vc).getBoundingClientRect();
    const left = vcRect.left - containerRect.left + vcRect.width + gap;
    panel.style.left = left + 'px';
    // Remover left do CSS (que era calc hardcoded)
    panel.style.removeProperty('--hud-left-override');
}

// ----------------------------------------------------------------
// RENDERING
// ----------------------------------------------------------------

/**
 * Render HUD cards based on current model elements.
 * Gera cards para cada elemento intangible/generic.
 */
export function renderHudCards() {
    if (!panel) return;

    const config = getHudCardsConfig();
    panel.style.display = config.visible ? '' : 'none';

    if (!config.visible) return;
    _positionHudPanel();

    const elements = getIntangibleGenericElements();
    const body = document.getElementById('hud-cards-body');
    if (!body) return;

    if (elements.length === 0) {
        body.innerHTML = `<div class="hud-cards-empty">${t('noElements') || 'No intangible/generic elements'}</div>`;
        return;
    }

    body.innerHTML = elements
        .map((el) => {
            const expanded = isCardExpanded(el.id);
            const icon = el.family === 'intangible' ? 'sparkles' : 'cube';
            const familyColor = el.family === 'intangible' ? '#BA68C8' : '#B0BEC5';
            const obsCount = (el.data?.observations || []).length;
            const lastObs = obsCount > 0 ? el.data.observations[obsCount - 1].date || '—' : '—';
            const assetType = el.data?.assetType || el.family;
            const chevron = expanded ? 'chevron-up' : 'chevron-down';

            return `
            <div class="hud-card ${expanded ? 'hud-card-expanded' : ''}" data-element-id="${el.id}">
                <div class="hud-card-header" onclick="handleToggleHudCard('${el.id}')" style="border-left: 3px solid ${familyColor}">
                    <span class="hud-card-icon">${getIcon(icon, { size: '14px' })}</span>
                    <span class="hud-card-name">${escapeHtml(el.name)}</span>
                    <span class="hud-card-chevron">${getIcon(chevron, { size: '12px' })}</span>
                </div>
                ${
                    expanded
                        ? `
                <div class="hud-card-body">
                    <div class="hud-card-row">
                        <span class="hud-card-label">${t('type') || 'Type'}:</span>
                        <span class="hud-card-value">${escapeHtml(assetType)}</span>
                    </div>
                    <div class="hud-card-row">
                        <span class="hud-card-label">${t('observations') || 'Obs'}:</span>
                        <span class="hud-card-value">${obsCount}</span>
                    </div>
                    <div class="hud-card-row">
                        <span class="hud-card-label">${t('date') || 'Last'}:</span>
                        <span class="hud-card-value">${escapeHtml(lastObs)}</span>
                    </div>
                    <div class="hud-card-buttons">
                        <button type="button" class="hud-card-action" onclick="handleSelectElement('${el.id}')" title="${t('select') || 'Select'}">
                            ${getIcon('crosshair', { size: '12px' })} ${t('select') || 'Select'}
                        </button>
                        <button type="button" class="hud-card-action" onclick="handleAddObservation('${el.id}')" title="${t('addObservation') || '+ Obs'}">
                            ${getIcon('plus', { size: '12px' })} ${t('observation') || 'Obs'}
                        </button>
                    </div>
                </div>
                `
                        : ''
                }
            </div>
        `;
        })
        .join('');
}

// ----------------------------------------------------------------
// VISIBILITY
// ----------------------------------------------------------------

/**
 * Show or hide the HUD cards panel.
 * @param {boolean} visible
 */
export function setHudCardsPanelVisible(visible) {
    if (panel) {
        panel.style.display = visible ? '' : 'none';
    }
}
