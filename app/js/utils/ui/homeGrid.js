// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   HOME GRID — Action-first launchpad
   Grid de acoes da pagina inicial

   Cards sao estaticos (renderizados uma vez em initHomeGrid).
   Stats e acao sugerida sao dinamicos (atualizados via renderHomeGrid).
   ================================================================ */

import { t } from '../i18n/translations.js';
import { getAllElements } from '../../core/elements/manager.js';
import { getAllCampaigns } from '../../core/campaigns/manager.js';
import { VIEW_MODES } from '../scene/viewRouter.js';
import { getHomeCardsConfig } from '../customize/manager.js';

// --- State ---
let _homeEl = null;
let _bootStateEl = null;
let _statsEl = null;
let _suggestedEl = null;
let _gridEl = null;
let _initialized = false;
let _active = true;
let _bootPreparingRandom = false;
let _lastCardHash = '';

// --- Action Card Definitions (v1, hardcoded) ---
const ACTION_CARDS = [
    {
        id: 'analyze-monitoring',
        icon: 'chart-bar',
        i18nKey: 'homeAnalyzeData',
        i18nDescKey: 'homeAnalyzeDataDesc',
        handler: 'handleOpenIngestionModal',
    },
    {
        id: 'marketplace',
        icon: 'shopping-bag',
        i18nKey: 'homeMarketplace',
        i18nDescKey: 'homeMarketplaceDesc',
        handler: 'handleOpenMarketplace',
    },
    {
        id: 'automate',
        icon: 'cpu',
        i18nKey: 'homeAutomate',
        i18nDescKey: 'homeAutomateDesc',
        handler: 'handleOpenPipelineManager',
    },
    {
        id: 'project-mgmt',
        icon: 'clipboard',
        i18nKey: 'homeProjectMgmt',
        i18nDescKey: 'homeProjectMgmtDesc',
        handler: 'handleOpenGovernancePanel',
    },
    {
        id: 'generate-key',
        icon: 'key',
        i18nKey: 'homeGenerateKey',
        i18nDescKey: 'homeGenerateKeyDesc',
        handler: 'openExportModal',
    },
    {
        id: 'eis-assessment',
        icon: 'shield-check',
        i18nKey: 'homeEIS',
        i18nDescKey: 'homeEISDesc',
        handler: 'handleOpenEisDashboard',
    },
    {
        id: 'export-data',
        icon: 'download',
        i18nKey: 'homeExportData',
        i18nDescKey: 'homeExportDataDesc',
        handler: 'openExportModal',
    },
    {
        id: 'compare-models',
        icon: 'git-compare',
        i18nKey: 'homeCompareModels',
        i18nDescKey: 'homeCompareModelsDesc',
        handler: 'handleOpenMergeModal',
    },
    {
        id: 'spatial-view',
        icon: 'map',
        i18nKey: 'homeSpatialView',
        i18nDescKey: 'homeSpatialViewDesc',
        handler: null,
        viewTarget: VIEW_MODES.THREE_D,
    },
    {
        id: 'customize',
        icon: 'sliders',
        i18nKey: 'homeCustomize',
        i18nDescKey: 'homeCustomizeDesc',
        handler: 'handleOpenCustomize',
    },
];

// --- Public API ---

/**
 * Build home grid DOM and render static cards.
 * Constroi DOM da home e renderiza cards estaticos (uma unica vez).
 * Deve ser chamado APOS registerAllHandlers (precisa de hydrateIcons).
 */
export function initHomeGrid() {
    if (_initialized) return;

    _homeEl = document.getElementById('home-container');
    if (!_homeEl) return;

    // Boot state (transient feedback during random-model startup)
    _bootStateEl = document.createElement('div');
    _bootStateEl.className = 'home-boot-state';
    _bootStateEl.setAttribute('data-testid', 'home-random-boot-state');
    _homeEl.appendChild(_bootStateEl);

    // Stats bar (dynamically updated)
    _statsEl = document.createElement('div');
    _statsEl.className = 'home-stats';
    _statsEl.setAttribute('data-testid', 'home-stats');
    _homeEl.appendChild(_statsEl);

    // Suggested action (dynamically updated)
    _suggestedEl = document.createElement('div');
    _suggestedEl.className = 'home-suggested';
    _suggestedEl.setAttribute('data-testid', 'home-suggested');
    _homeEl.appendChild(_suggestedEl);

    // Action cards grid (rendered once, static)
    _gridEl = document.createElement('div');
    _gridEl.className = 'home-grid';
    _gridEl.setAttribute('data-testid', 'home-grid');
    _homeEl.appendChild(_gridEl);

    // Cards are static — render once
    _renderCards();

    _initialized = true;

    // Initial stats + suggested
    _updateDynamic();
}

/**
 * Refresh stats + suggested action only (cards are static).
 * Chamado de updateAllUI.
 */
export function renderHomeGrid() {
    if (!_initialized || !_active) return;

    // Re-render cards if customize config changed
    const cards = _getVisibleOrderedCards();
    const hash = cards.map((c) => c.id).join(',');
    if (hash !== _lastCardHash) {
        _renderCards();
    }

    _updateDynamic();
}

/**
 * Get all ACTION_CARD definitions (for customizeModal).
 * @returns {Array<{id: string, i18nKey: string}>}
 */
export function getActionCardDefs() {
    return ACTION_CARDS.map((c) => ({ id: c.id, i18nKey: c.i18nKey }));
}

/**
 * Show home container, hide canvas.
 */
export function showHomeView() {
    _active = true;
    const homeEl = document.getElementById('home-container');
    const canvasEl = document.getElementById('canvas-container');
    const appEl = document.getElementById('app');

    if (homeEl) {
        homeEl.style.display = '';
        homeEl.scrollTop = 0;
    }
    if (canvasEl) canvasEl.style.display = 'none';
    if (appEl) appEl.classList.add('view-actions');
    _syncGridRows();
}

/**
 * Hide home container, show canvas.
 */
export function hideHomeView() {
    _active = false;
    const homeEl = document.getElementById('home-container');
    const canvasEl = document.getElementById('canvas-container');
    const appEl = document.getElementById('app');

    if (homeEl) homeEl.style.display = 'none';
    if (canvasEl) canvasEl.style.display = '';
    if (appEl) appEl.classList.remove('view-actions');
    _syncGridRows();
}

/**
 * @returns {boolean}
 */
export function isHomeViewActive() {
    return _active;
}

/**
 * Toggle transient random-boot state on Home.
 * Exibe/oculta feedback "preparando modelo random".
 * @param {boolean} preparing
 */
export function setHomePreparingRandom(preparing) {
    _bootPreparingRandom = preparing === true;
    if (_initialized) _updateDynamic();
}

// --- Internal ---

function _updateDynamic() {
    _renderBootState();
    _renderStats();
    _renderSuggested();
}

function _syncGridRows() {
    try {
        window.dispatchEvent(new CustomEvent('tickerChanged'));
    } catch (_) {}
    import('./panelManager.js')
        .then(({ rebuildGridRows }) => {
            rebuildGridRows();
        })
        .catch(() => {});
}

function _safeGetElements() {
    try {
        return getAllElements();
    } catch {
        return [];
    }
}

function _safeGetCampaigns() {
    try {
        return getAllCampaigns();
    } catch {
        return [];
    }
}

function _renderStats() {
    if (!_statsEl) return;

    const elements = _safeGetElements();
    const campaigns = _safeGetCampaigns();
    const lastSave = _getLastSave();

    _statsEl.innerHTML = '';

    // D20: completeness score
    const check = elements.length > 0 || campaigns.length > 0 ? computeCompleteness() : null;
    const completenessStr = check ? `${check.score}/${check.total}` : '--';

    const stats = [
        { value: elements.length, label: t('homeStatsElements') || 'Elements' },
        { value: campaigns.length, label: t('homeStatsCampaigns') || 'Campaigns' },
        { value: completenessStr, label: t('homeStatsCompleteness') || 'Completeness' },
        { value: lastSave, label: t('homeStatsLastSave') || 'Last Save' },
    ];

    for (const stat of stats) {
        const card = document.createElement('div');
        card.className = 'home-stat-card';
        card.setAttribute('data-testid', 'stat-card');

        const val = document.createElement('span');
        val.className = 'home-stat-value';
        val.setAttribute('data-testid', 'stat-value');
        val.textContent = String(stat.value);

        const label = document.createElement('span');
        label.className = 'home-stat-label';
        label.textContent = stat.label;

        card.appendChild(val);
        card.appendChild(label);
        _statsEl.appendChild(card);
    }
}

function _renderSuggested() {
    if (!_suggestedEl) return;

    if (_bootPreparingRandom) {
        _suggestedEl.innerHTML = '';
        return;
    }

    const check = computeCompleteness();
    _suggestedEl.innerHTML = '';

    if (!check || check.gaps.length === 0) return;

    // Mostrar ate 3 gaps como sugestoes acionaveis
    const maxGaps = Math.min(check.gaps.length, 3);
    for (let i = 0; i < maxGaps; i++) {
        const gap = check.gaps[i];
        const row = document.createElement('div');
        row.className = 'home-suggested-row';
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';

        const icon = document.createElement('span');
        icon.style.cssText = `font-size:10px;color:${gap.severity === 'warning' ? 'var(--warning-600,#ca8a04)' : 'var(--neutral-400)'};`;
        icon.textContent = gap.severity === 'warning' ? '\u26A0' : '\u2139';

        const msg = document.createElement('span');
        msg.className = 'home-suggested-msg';
        msg.textContent = gap.msg;

        const btn = document.createElement('button');
        btn.className = 'home-suggested-btn';
        btn.setAttribute('data-testid', 'suggested-action-btn');
        btn.textContent = '\u25B6';
        btn.title = t('homeSuggestedGo') || 'Go';
        btn.addEventListener('click', () => _executeHandler(gap.handler));

        row.appendChild(icon);
        row.appendChild(msg);
        row.appendChild(btn);
        _suggestedEl.appendChild(row);
    }
}

/**
 * Get ordered, visible cards based on customize config.
 * @returns {Array} Filtered and ordered ACTION_CARDS
 */
function _getVisibleOrderedCards() {
    const config = getHomeCardsConfig();
    if (!config) return ACTION_CARDS;

    // Build lookup for visibility and order
    const lookup = {};
    for (const c of config) lookup[c.id] = c;

    // Filter visible and sort by order
    const visible = ACTION_CARDS.filter((card) => {
        const cfg = lookup[card.id];
        return !cfg || cfg.visible !== false;
    }).sort((a, b) => {
        const oa = lookup[a.id]?.order ?? 999;
        const ob = lookup[b.id]?.order ?? 999;
        return oa - ob;
    });

    return visible;
}

function _renderCards() {
    if (!_gridEl) return;
    const missingHandlers = [];
    const cards = _getVisibleOrderedCards();

    // Hash to detect changes for re-render
    const hash = cards.map((c) => c.id).join(',');
    _lastCardHash = hash;

    _gridEl.innerHTML = '';

    for (const card of cards) {
        const unavailable = !card.viewTarget && !_hasHandler(card.handler);
        const el = document.createElement('div');
        el.className = 'home-card';
        el.setAttribute('data-testid', 'action-card');
        el.setAttribute('data-card-id', card.id);
        el.setAttribute('data-route', card.viewTarget ? `#${card.viewTarget}` : `#${card.id}`);
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', t(card.i18nKey) || card.i18nKey);

        if (unavailable) {
            el.classList.add('home-card-disabled');
            el.setAttribute('aria-disabled', 'true');
            el.setAttribute('tabindex', '-1');
        }

        const iconWrap = document.createElement('div');
        iconWrap.className = 'home-card-icon';
        const iconEl = document.createElement('span');
        iconEl.setAttribute('data-icon', card.icon);
        iconEl.setAttribute('data-icon-size', '20px');
        iconWrap.appendChild(iconEl);

        const title = document.createElement('div');
        title.className = 'home-card-title';
        title.textContent = t(card.i18nKey) || card.i18nKey;

        const desc = document.createElement('div');
        desc.className = 'home-card-desc';
        desc.textContent = t(card.i18nDescKey) || card.i18nDescKey;

        el.appendChild(iconWrap);
        el.appendChild(title);
        el.appendChild(desc);

        if (!unavailable) {
            el.addEventListener('click', () => _onCardClick(card));
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    _onCardClick(card);
                }
            });
        } else if (card.handler) {
            missingHandlers.push({ cardId: card.id, handler: card.handler });
        }

        _gridEl.appendChild(el);
    }

    if (missingHandlers.length > 0) {
        console.warn('[ecbyts:home] Missing handlers for cards:', missingHandlers);
    }

    // Hydrate SVG icons (available after registerAllHandlers)
    if (typeof window.hydrateIcons === 'function') {
        window.hydrateIcons();
    }
}

async function _onCardClick(card) {
    // Invite gate: require auth before any action in invite-only mode
    try {
        const { requireAuth } = await import('../auth/inviteGate.js');
        if (requireAuth()) return;
    } catch (_) {
        /* inviteGate not available = no gate */
    }

    import('../telemetry/tracker.js')
        .then(({ trackEvent }) => {
            trackEvent('click', card.id, { source: 'home-card' });
        })
        .catch(() => {});

    if (card.viewTarget) {
        if (typeof window.handleSwitchView === 'function') {
            window.handleSwitchView(card.viewTarget);
        }
    } else {
        _executeHandler(card.handler);
    }
}

function _executeHandler(handlerName) {
    if (!handlerName) return;
    if (typeof window[handlerName] === 'function') {
        try {
            window[handlerName]();
        } catch (e) {
            console.error(`[ecbyts:home] Handler ${handlerName} failed:`, e?.message);
        }
    } else {
        console.warn(`[ecbyts:home] Handler not found: ${handlerName}`);
    }
}

function _hasHandler(handlerName) {
    return !!handlerName && typeof window[handlerName] === 'function';
}

function _renderBootState() {
    if (!_bootStateEl) return;
    if (_bootPreparingRandom) {
        _bootStateEl.style.display = 'flex';
        _bootStateEl.innerHTML = `
            <span class="home-inline-spinner" aria-hidden="true"></span>
            <span>${t('homePreparingRandom') || 'Preparing random model...'}</span>
        `;
        return;
    }
    _bootStateEl.style.display = 'none';
    _bootStateEl.innerHTML = '';
}

function _computeSuggestion() {
    const check = computeCompleteness();
    if (!check) return null;

    // Retorna a acao de maior prioridade
    for (const gap of check.gaps) {
        return { msg: gap.msg, handler: gap.handler };
    }
    return { msg: t('homeSuggestExport') || 'Export your model for sharing', handler: 'openExportModal' };
}

/**
 * D20: Completeness Checker — analisa o modelo e retorna gaps.
 * Usado pelo home grid (sugestao) e pelo toast pos-import.
 *
 * @returns {{ score: number, total: number, gaps: Array<{id: string, msg: string, handler: string, severity: 'info'|'warning'}> }}
 */
export function computeCompleteness() {
    const els = _safeGetElements();
    const camps = _safeGetCampaigns();
    const gaps = [];
    let score = 0;
    const total = 6; // criterios avaliados

    // 1. Tem elementos?
    if (els.length === 0) {
        gaps.push({
            id: 'no-elements',
            msg: t('homeSuggestCreate') || 'Get started by creating your first model',
            handler: 'handleOpenIngestionModal',
            severity: 'warning',
        });
    } else {
        score++;
    }

    // 2. Tem campanhas?
    if (els.length > 0 && camps.length === 0) {
        gaps.push({
            id: 'no-campaigns',
            msg: t('homeSuggestCampaign') || 'Add a monitoring campaign to your model',
            handler: 'handleAddCampaign',
            severity: 'warning',
        });
    } else if (camps.length > 0) {
        score++;
    }

    // 3. Elementos tem observacoes?
    const withObs = els.filter((e) => e.data?.observations?.length > 0).length;
    if (els.length > 0 && withObs === 0) {
        gaps.push({
            id: 'no-observations',
            msg: (t('gapNoObs') || '{count} elements without observations. Import monitoring data.').replace(
                '{count}',
                els.length,
            ),
            handler: 'handleOpenIngestionModal',
            severity: 'warning',
        });
    } else if (withObs > 0) {
        score++;
    }

    // 4. Elementos tem coordenadas?
    const withCoords = els.filter((e) => {
        const c = e.data?.coordinates;
        const p = e.data?.position;
        return (c && (c.easting || c.northing)) || (p && (p.x || p.z));
    }).length;
    const noCoords = els.length - withCoords;
    if (els.length > 0 && noCoords > 0) {
        gaps.push({
            id: 'missing-coords',
            msg: (t('gapMissingCoords') || '{count} elements without coordinates').replace('{count}', noCoords),
            handler: 'handleOpenIngestionModal',
            severity: 'info',
        });
    } else if (els.length > 0) {
        score++;
    }

    // 5. Tem boundary definido?
    const hasBoundary = els.some((e) => e.family === 'boundary');
    if (els.length >= 3 && !hasBoundary) {
        gaps.push({
            id: 'no-boundary',
            msg: t('gapNoBoundary') || 'No site boundary defined. Import a shapefile or create manually.',
            handler: 'handleOpenSpatialModal',
            severity: 'info',
        });
    } else if (hasBoundary) {
        score++;
    }

    // 6. Mais de 1 campanha (serie temporal)?
    if (camps.length >= 2) {
        score++;
    } else if (camps.length === 1 && els.length > 0) {
        gaps.push({
            id: 'single-campaign',
            msg: t('gapSingleCampaign') || 'Only 1 campaign. Import more for trend analysis (Mann-Kendall).',
            handler: 'handleOpenIngestionModal',
            severity: 'info',
        });
    }

    return { score, total, gaps };
}

function _getLastSave() {
    try {
        const ts = localStorage.getItem('ecbyts-last-save');
        if (!ts) return '--';
        const d = new Date(ts);
        if (isNaN(d.getTime())) return '--';
        const diff = Date.now() - d.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return t('homeJustNow') || 'Just now';
        if (mins < 60) return `${mins}min`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h`;
        return `${Math.floor(hours / 24)}d`;
    } catch {
        return '--';
    }
}
