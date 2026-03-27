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
   TICKER RENDERER — DOM rendering and CSS scroll animation
   Renderizador da barra de metricas com animacao de rolagem

   A barra usa CSS @keyframes com translateX para rolagem suave
   acelerada por GPU. O conteudo e duplicado para loop continuo.
   Pausa no hover via animation-play-state.
   ================================================================ */

import { getTickerConfig } from './manager.js';
import { getIcon } from '../ui/icons.js';
import { escapeHtml } from '../helpers/html.js';
import { getLockedBadges } from '../libraries/locks.js';

// ----------------------------------------------------------------
// CONSTANTS
// ----------------------------------------------------------------

const SPEED_PX_PER_SEC = { slow: 30, medium: 60, fast: 120 };

// ----------------------------------------------------------------
// INITIALIZATION
// Cria o elemento DOM do ticker (chamado antes de registerAllHandlers)
// ----------------------------------------------------------------

/**
 * Initialize ticker bar DOM element.
 * Cria a estrutura HTML do ticker e insere no grid.
 * O ticker começa oculto e aparece quando o usuario ativa.
 */
export function initTickerBar() {
    const existing = document.getElementById('ticker-bar');
    if (existing) return; // Ja existe

    const bar = document.createElement('div');
    bar.id = 'ticker-bar';
    bar.style.display = 'none'; // Começa oculto

    bar.innerHTML = `
        <div class="ticker-controls">
            <button type="button" class="ticker-config-btn"
                    onclick="handleOpenTickerConfig()"
                    title="Configure Ticker">
                ${getIcon('settings', { size: '14px' })}
            </button>
        </div>
        <div class="ticker-track">
            <div class="ticker-content" id="ticker-content"></div>
        </div>
    `;

    // Insere depois do toolbar (#toolbar) no DOM
    // O grid auto-placement coloca na row 4 (entre toolbar e paineis)
    const toolbar = document.getElementById('toolbar');
    if (toolbar && toolbar.nextSibling) {
        toolbar.parentNode.insertBefore(bar, toolbar.nextSibling);
    } else {
        document.getElementById('app')?.appendChild(bar);
    }

    // Restaura visibilidade salva
    const config = getTickerConfig();
    if (config.visible) {
        bar.style.display = '';
        window.dispatchEvent(new CustomEvent('tickerChanged'));
    }
}

// ----------------------------------------------------------------
// RENDERING
// Popula o ticker com os itens computados
// ----------------------------------------------------------------

/**
 * Render computed ticker items into the bar.
 * Popula o conteudo do ticker com os textos calculados.
 * Duplica o conteudo para loop continuo da animacao.
 *
 * @param {Array<{ id: string, text: string, color: string }>} items
 */
export function renderTicker(items) {
    const container = document.getElementById('ticker-content');
    if (!container) return;

    const config = getTickerConfig();

    if (!items || items.length === 0) {
        container.innerHTML = '<span class="ticker-item ticker-empty">\u2014</span>';
        container.classList.add('no-scroll');
        container.style.removeProperty('animation-duration');
        return;
    }

    // Prepend locked badges from libraries (non-removable)
    const lockedBadges = getLockedBadges();
    const badgesHtml = lockedBadges.map((badge) => {
        const style = badge.color ? `color: ${escapeHtml(badge.color)}` : '';
        return `<span class="ticker-item ticker-locked" style="${style}"><span class="ticker-lock-icon">${getIcon(badge.icon || 'lock', { size: '12px' })}</span>${escapeHtml(badge.label)}</span>`;
    });

    // Gera HTML dos itens com separadores
    const sep = `<span class="ticker-separator">${escapeHtml(config.separator)}</span>`;
    const itemsHtml = [
        ...badgesHtml,
        ...items.map((item) => {
            const style = item.color ? `color: ${escapeHtml(item.color)}` : '';
            // Detecta tendencia para classe CSS
            let cls = 'ticker-item';
            if (item.text.includes('\u2191')) cls += ' ticker-trend-up';
            else if (item.text.includes('\u2193')) cls += ' ticker-trend-down';

            return `<span class="${cls}" style="${style}">${escapeHtml(item.text)}</span>`;
        }),
    ].join(sep);

    // Duplica conteudo para loop continuo (A + sep + B = A + sep + A)
    container.innerHTML = itemsHtml + sep + itemsHtml;

    // Verifica se precisa de scroll ou exibe estático
    requestAnimationFrame(() => {
        updateTickerAnimation();
    });
}

// ----------------------------------------------------------------
// ANIMATION CONTROL
// Controle da velocidade e duração da animação CSS
// ----------------------------------------------------------------

/**
 * Recalculate animation duration based on content width and speed.
 * Recalcula duracao da animacao CSS com base na largura do conteudo.
 */
export function updateTickerAnimation() {
    const container = document.getElementById('ticker-content');
    const track = container?.parentElement;
    if (!container || !track) return;

    const config = getTickerConfig();
    const pxPerSec = SPEED_PX_PER_SEC[config.speed] || SPEED_PX_PER_SEC.medium;

    // Metade do conteudo (porque duplicamos)
    const halfWidth = container.scrollWidth / 2;
    const trackWidth = track.clientWidth;

    if (halfWidth <= trackWidth) {
        // Conteúdo cabe sem scroll — exibe estático centralizado
        container.classList.add('no-scroll');
        container.style.removeProperty('animation-duration');
    } else {
        // Ativa scroll — calcula duracao para a velocidade desejada
        container.classList.remove('no-scroll');
        const duration = halfWidth / pxPerSec;
        container.style.animationDuration = `${duration}s`;
    }
}

// ----------------------------------------------------------------
// VISIBILITY
// Mostra/esconde o ticker e atualiza o grid
// ----------------------------------------------------------------

/**
 * Show or hide the ticker bar.
 * Altera visibilidade e dispara evento para atualizar grid.
 *
 * @param {boolean} visible
 */
export function setTickerBarVisible(visible) {
    const bar = document.getElementById('ticker-bar');
    if (bar) {
        bar.style.display = visible ? '' : 'none';
    }
    window.dispatchEvent(new CustomEvent('tickerChanged'));
}

// ----------------------------------------------------------------
// PREVIEW (for config modal)
// Renderiza preview no modal de configuração
// ----------------------------------------------------------------

/**
 * Render a static preview of computed items into a container.
 * Usado no modal de configuração para mostrar como o ticker ficará.
 *
 * @param {string} containerId - ID do elemento container do preview
 * @param {Array<{ id: string, text: string, color: string }>} items
 */
export function renderTickerPreview(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const config = getTickerConfig();

    // Prepend locked badges (same as main ticker)
    const lockedBadges = getLockedBadges();
    const badgesHtml = lockedBadges.map((badge) => {
        const style = badge.color ? `color: ${escapeHtml(badge.color)}` : '';
        return `<span class="ticker-item ticker-locked" style="${style}"><span class="ticker-lock-icon">${getIcon(badge.icon || 'lock', { size: '12px' })}</span>${escapeHtml(badge.label)}</span>`;
    });

    if ((!items || items.length === 0) && badgesHtml.length === 0) {
        container.innerHTML = '<span class="ticker-item ticker-empty">\u2014</span>';
        return;
    }

    const sep = `<span class="ticker-separator">${escapeHtml(config.separator)}</span>`;
    const regularHtml = (items || []).map((item) => {
        const style = item.color ? `color: ${escapeHtml(item.color)}` : '';
        let cls = 'ticker-item';
        if (item.text.includes('\u2191')) cls += ' ticker-trend-up';
        else if (item.text.includes('\u2193')) cls += ' ticker-trend-down';
        return `<span class="${cls}" style="${style}">${escapeHtml(item.text)}</span>`;
    });

    container.innerHTML = [...badgesHtml, ...regularHtml].join(sep);
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------
