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
   PANEL MANAGER — Dockable & Minimizable Panels
   ================================================================

   Gerencia paineis dockaveis com suporte a:
   - Dock em qualquer lado (left/right)
   - Minimizar com tab clicavel na borda
   - Arrastar header para floating
   - Redimensionar via drag handle
   - Persistir layout no localStorage

   PAINEIS REGISTRADOS:
   - families: Lista de familias de elementos (dock left)
   - properties: Propriedades e abas (dock right)

   ESTADOS DE PAINEL:
   - docked: fixado em um lado (left/right)
   - minimized: colapsado com tab visivel na borda
   - floating: janela flutuante arrastavel

   ================================================================ */

import { handleResize } from '../scene/setup.js';
import { getIcon } from './icons.js';
import { activateTabById } from './tabs.js';
import { t } from '../i18n/translations.js';
import { addFloatingResizeHandles } from './resizeHandles.js';
import { safeSetItem } from '../storage/storageMonitor.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

/** @type {Map<string, PanelState>} */
const panels = new Map();

/**
 * @typedef {Object} PanelState
 * @property {string} id
 * @property {string} title
 * @property {HTMLElement} el - O elemento DOM do painel
 * @property {'docked'|'minimized'|'floating'} state
 * @property {'left'|'right'} dock - Lado atual
 * @property {number} size - Largura em pixels
 * @property {number} minSize
 * @property {number} maxSize
 */

let analyticsFullscreen = false;

// Cleanup function para resize handles da constellation flutuante
let _constellationResizeCleanup = null;

// Containers para tabs minimizados (criados no init)
let minTabsLeft = null;
let minTabsRight = null;
let minTabsBottom = null;

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Initialize the panel manager.
 * Registra paineis, cria tabs containers, carrega layout salvo.
 */
export function initPanelManager() {
    // Criar containers para tabs minimizados
    createMinTabContainers();

    // Registrar paineis existentes
    registerPanel({
        id: 'families',
        title: 'Element Families',
        elId: 'left-panel',
        dock: 'left',
        size: 300,
        minSize: 220,
        maxSize: 450,
    });

    registerPanel({
        id: 'properties',
        title: 'Properties',
        elId: 'right-panel',
        dock: 'right',
        size: 280,
        minSize: 220,
        maxSize: 500,
    });

    // Setup resize handles
    setupResizeHandles();

    // Injetar botoes nos headers dos paineis
    injectPanelHeaders();

    // Injetar controles em toolbar e constellation
    injectBarControls();

    // Aplicar layout de tabs (posicoes padrao ou salvas)
    applyTabLayout();
    applyRailTabTitles();

    // Criar menu de contexto para tabs
    createContextMenu();

    // Carregar layout salvo (panel states)
    const _hadSavedLayout = loadLayout();

    // Registrar handlers globais
    window.toggleLeftPanel = () => togglePanel('families');
    window.toggleRightPanel = () => togglePanel('properties');
    window.toggleAnalyticsFullscreen = toggleAnalyticsFullscreen;
    window.dockPanel = dockPanel;
    window.minimizePanel = minimizePanel;
    window.restorePanel = restorePanel;
    window.floatPanel = floatPanel;
    window.moveTab = moveTab;

    // Toggle toolbar, statusbar e constellation
    window.toggleToolbar = toggleToolbar;
    window.toggleStatusbar = toggleStatusbar;
    window.toggleConstellation = toggleConstellation;
    window.floatToolbar = floatToolbar;
    window.dockToolbar = dockToolbar;
    window.floatConstellation = floatConstellation;
    window.dockConstellation = dockConstellation;
    window.restoreConstellation = _restoreConstellation;

    // Carregar estado salvo de toolbar/statusbar
    loadBarsState();

    // Paineis iniciam recolhidos apenas se não há layout salvo
    if (!_hadSavedLayout) {
        minimizePanel('families');
        minimizePanel('properties');
    }

    // Constellation: colapsar apenas se não há estado salvo
    const hud = document.getElementById('constellation-hud');
    const _constellationWasSaved =
        !!localStorage.getItem('ecbyts-constellation-collapsed') ||
        !!localStorage.getItem('ecbyts-constellation-height');
    if (hud && !_constellationWasSaved && !hud.classList.contains('constellation-collapsed')) {
        hud.classList.add('constellation-collapsed');
    } else if (hud && _constellationWasSaved) {
        const _collapsed = localStorage.getItem('ecbyts-constellation-collapsed') === '1';
        if (_collapsed && !hud.classList.contains('constellation-collapsed')) {
            hud.classList.add('constellation-collapsed');
        } else if (!_collapsed) {
            hud.classList.remove('constellation-collapsed');
            const _savedH = localStorage.getItem('ecbyts-constellation-height');
            if (_savedH) {
                const mainArea = document.getElementById('main-area');
                if (mainArea) mainArea.style.setProperty('--bottom-panel-height', parseInt(_savedH, 10) + 'px');
            }
        }
    }

    // Ticker bar: atualiza grid quando visibilidade muda
    window.addEventListener('tickerChanged', () => rebuildGridRows());
    window.addEventListener('languageChanged', () => applyRailTabTitles());

    // Auto-mostrar toolbar quando usuario clica no menu
    // Garante acesso ao ribbon mesmo quando colapsado
    document.getElementById('menubar')?.addEventListener('click', (e) => {
        if (e.target.closest('.menu-item')) ensureToolbarVisible();
    });

    // Double-click no menubar (fora de tabs/botoes) toggle o ribbon
    document.getElementById('menubar')?.addEventListener('dblclick', (e) => {
        if (!e.target.closest('.menu-item') && !e.target.closest('.ribbon-toggle-btn')) {
            toggleToolbar();
        }
    });

    // Ctrl+F1 — atalho para colapsar/expandir o ribbon
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F1' && e.ctrlKey) {
            e.preventDefault();
            toggleToolbar();
        }
    });

    // Scroll arrows para tabs bars com overflow (mesmo pattern do ribbon)
    injectTabsScrollArrows();

    // Expor updateRibbonToggleState para outros modulos (evita deps circulares)
    window._updateRibbonToggleState = updateRibbonToggleState;

    // Reposicionar paineis flutuantes quando janela encolhe
    window.addEventListener('resize', _clampFloatingPanels);

    // Toggle do painel de chat IA — usa toggleAIWidget (FAB ↔ chat panel)
    window.toggleLLMChatPanel = () => {
        if (window.toggleAIWidget) window.toggleAIWidget();
        else {
            const chatPanel = document.getElementById('llm-chat-panel');
            if (chatPanel?.classList.contains('open')) {
                if (window.closeLLMChat) window.closeLLMChat();
            } else {
                if (window.openLLMChat) window.openLLMChat();
            }
        }
        updateRibbonToggleState();
    };
}

// ----------------------------------------------------------------
// PANEL REGISTRATION
// ----------------------------------------------------------------

/**
 * Register a panel.
 * @param {Object} config
 */
function registerPanel(config) {
    const el = document.getElementById(config.elId);
    if (!el) return;

    panels.set(config.id, {
        id: config.id,
        title: config.title,
        el,
        state: 'docked',
        dock: config.dock,
        size: config.size,
        minSize: config.minSize || 180,
        maxSize: config.maxSize || 500,
    });
}

// ----------------------------------------------------------------
// MINIMIZE TAB CONTAINERS
// ----------------------------------------------------------------

/**
 * Create containers for minimized panel tabs.
 * Cria divs absolutas nas bordas do main area para tabs de paineis minimizados.
 */
function createMinTabContainers() {
    const mainArea = document.getElementById('main-area');
    if (!mainArea) return;

    // Tab container na borda esquerda
    minTabsLeft = document.createElement('div');
    minTabsLeft.id = 'min-tabs-left';
    minTabsLeft.className = 'min-tabs min-tabs--left';
    mainArea.appendChild(minTabsLeft);

    // Tab container na borda direita
    minTabsRight = document.createElement('div');
    minTabsRight.id = 'min-tabs-right';
    minTabsRight.className = 'min-tabs min-tabs--right';
    mainArea.appendChild(minTabsRight);

    // Tab container na borda inferior (para constellation minimizada)
    minTabsBottom = document.createElement('div');
    minTabsBottom.id = 'min-tabs-bottom';
    minTabsBottom.className = 'min-tabs min-tabs--bottom';
    mainArea.appendChild(minTabsBottom);
}

// ----------------------------------------------------------------
// PANEL HEADER INJECTION
// ----------------------------------------------------------------

/**
 * Inject minimize button into panel tabs bars.
 * Adiciona botao de minimize na barra de tabs de cada painel.
 */
function injectPanelHeaders() {
    panels.forEach((panel) => {
        // Usa .tabs como header (ambos paineis agora tem .tabs)
        const tabsBar = panel.el.querySelector('.tabs');
        if (!tabsBar) return;

        // Chevron unico integrado na tabs bar (mesmo pattern do ribbon)
        const chevronIcon =
            panel.dock === 'left'
                ? '<polyline points="15 18 9 12 15 6"/>' // chevron-left
                : '<polyline points="9 6 15 12 9 18"/>'; // chevron-right

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'panel-toggle-btn';
        btn.title = t('minimizePanel');
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${chevronIcon}</svg>`;
        btn.addEventListener('click', () => minimizePanel(panel.id));
        tabsBar.appendChild(btn);

        // Tornar tabs bar arrastavel para float
        setupDragToFloat(panel.id, tabsBar);
    });
}

// ----------------------------------------------------------------
// TOOLBAR & CONSTELLATION BAR CONTROLS
// ----------------------------------------------------------------

let toolbarFloating = false;
let constellationFloating = false;

/**
 * Inject float + collapse controls into toolbar and constellation.
 * Adiciona botoes de flutuante e recolher na toolbar e constelacao.
 */
function injectBarControls() {
    // Toolbar controls REMOVED — now handled by #ribbon-toggle-btn in menubar
    // Constellation glassmorphic controls REMOVED — collapse via .constellation-collapse-btn
    // Float still available via View > Panels and window.floatConstellation()

    const hud = document.getElementById('constellation-hud');
    if (hud) {
        setupBarDragToFloat(hud, floatConstellation, () => constellationFloating);
        setupConstellationVerticalResize(hud);
        // Restaurar altura salva do painel inferior via custom property
        // Se o painel estiver colapsado, usar altura minima em vez da salva
        const isCollapsed = localStorage.getItem('ecbyts-constellation-collapsed') === '1';
        if (isCollapsed) {
            const mainArea = document.getElementById('main-area');
            if (mainArea) mainArea.style.setProperty('--bottom-panel-height', '28px');
        } else {
            const savedH = localStorage.getItem('ecbyts-constellation-height');
            if (savedH) {
                const maxH = Math.min(500, Math.round(window.innerHeight * 0.45));
                const parsed = parseInt(savedH, 10);
                if (!isNaN(parsed)) {
                    const clamped = Math.max(80, Math.min(parsed, maxH));
                    const mainArea = document.getElementById('main-area');
                    if (mainArea) mainArea.style.setProperty('--bottom-panel-height', clamped + 'px');
                    if (clamped !== parsed) {
                        try {
                            localStorage.setItem('ecbyts-constellation-height', clamped);
                        } catch (_) {}
                    }
                }
            }
        }
    }
}

/**
 * Setup vertical resize handle at the top of docked constellation.
 * Permite o usuario redimensionar a altura da constellation arrastando a borda superior.
 * @param {HTMLElement} hud
 */
function setupConstellationVerticalResize(hud) {
    if (hud.querySelector('.constellation-resize-top')) return;

    const resizeDiv = document.createElement('div');
    resizeDiv.className = 'constellation-resize-top';
    hud.insertBefore(resizeDiv, hud.firstChild);

    let startY, startH;
    const mainArea = document.getElementById('main-area');

    // Aplica nova altura via CSS custom property — todas as views respondem via flex
    const applyHeight = (h) => {
        if (mainArea) mainArea.style.setProperty('--bottom-panel-height', h + 'px');
    };

    resizeDiv.addEventListener('mousedown', (e) => {
        // Nao redimensionar se esta floating (usa handles do addFloatingResizeHandles)
        if (constellationFloating) return;

        e.stopPropagation(); // Impedir que setupBarDragToFloat intercepte o evento

        startY = e.clientY;
        startH = hud.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';

        const onMove = (me) => {
            const delta = startY - me.clientY; // arrastar para cima = aumentar
            const maxH = Math.min(500, Math.round(window.innerHeight * 0.45));
            const newH = Math.max(80, Math.min(maxH, startH + delta));
            applyHeight(newH);
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            // Persistir altura no localStorage
            const currentH = hud.offsetHeight;
            try {
                localStorage.setItem('ecbyts-constellation-height', currentH);
            } catch (_) {}
            saveBarsState();
            // Atualizar Three.js renderer apos mudanca de layout
            requestAnimationFrame(() => {
                const c = document.getElementById('canvas-container');
                if (c) handleResize(c);
            });
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
    });

    // Double-click cicla alturas preset: 120 -> 250 -> 40vh -> 120
    const PRESET_HEIGHTS = [120, 250, Math.round(window.innerHeight * 0.4)];
    resizeDiv.addEventListener('dblclick', (e) => {
        if (constellationFloating) return;
        e.preventDefault();
        const currentH = hud.offsetHeight;
        // Encontra o proximo preset maior que o atual (com margem de 20px)
        const next = PRESET_HEIGHTS.find((p) => p > currentH + 20) || PRESET_HEIGHTS[0];
        applyHeight(next);
        try {
            localStorage.setItem('ecbyts-constellation-height', next);
        } catch (_) {}
        saveBarsState();
        requestAnimationFrame(() => {
            const c = document.getElementById('canvas-container');
            if (c) handleResize(c);
        });
    });
}

// ----------------------------------------------------------------
// TABS SCROLL ARROWS
// ----------------------------------------------------------------

const TABS_SCROLL_STEP = 120;

/**
 * Inject scroll arrows into .tabs bars that overflow horizontally.
 * Cria setas de navegacao lateral nas barras de abas dos paineis.
 * Mesmo pattern visual das setas do ribbon toolbar.
 */
function injectTabsScrollArrows() {
    document.querySelectorAll('.tabs').forEach((tabs) => {
        if (tabs.parentElement?.classList.contains('tabs-wrapper')) return;

        // Envolve .tabs num wrapper para posicionar setas FORA do scroll
        // Mesmo pattern do ribbon: setas no container pai, scroll no filho
        const wrapper = document.createElement('div');
        wrapper.className = 'tabs-wrapper';
        tabs.parentElement.insertBefore(wrapper, tabs);
        wrapper.appendChild(tabs);

        const arrowLeft = document.createElement('button');
        arrowLeft.type = 'button';
        arrowLeft.className = 'tabs-scroll-arrow scroll-left';
        arrowLeft.innerHTML =
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
        arrowLeft.addEventListener('click', (e) => {
            e.stopPropagation();
            tabs.scrollBy({ left: -TABS_SCROLL_STEP, behavior: 'smooth' });
        });

        const arrowRight = document.createElement('button');
        arrowRight.type = 'button';
        arrowRight.className = 'tabs-scroll-arrow scroll-right';
        arrowRight.innerHTML =
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
        arrowRight.addEventListener('click', (e) => {
            e.stopPropagation();
            tabs.scrollBy({ left: TABS_SCROLL_STEP, behavior: 'smooth' });
        });

        // Setas sao filhas do wrapper, NAO do .tabs (ficam fora do scroll)
        wrapper.appendChild(arrowLeft);
        wrapper.appendChild(arrowRight);

        const updateArrows = () => {
            if (tabs.scrollWidth <= tabs.clientWidth + 2) {
                arrowLeft.classList.remove('visible');
                arrowRight.classList.remove('visible');
                return;
            }
            arrowLeft.classList.toggle('visible', tabs.scrollLeft > 2);
            arrowRight.classList.toggle('visible', tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 2);
        };

        tabs.addEventListener('scroll', updateArrows, { passive: true });
        window.addEventListener('resize', updateArrows);

        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(updateArrows).observe(tabs);
        }

        requestAnimationFrame(updateArrows);
    });
}

/**
 * Update bar control icons based on floating state.
 * @param {string} barId - 'toolbar-controls' ou 'constellation-controls'
 * @param {boolean} isFloating
 * @param {string} dockFn - Nome da funcao de dock no window
 * @param {string} floatFn - Nome da funcao de float no window
 */
function updateBarControlIcon(barId, isFloating, dockFn, floatFn) {
    const ctrl = document.getElementById(barId);
    if (!ctrl) return;
    const btn = ctrl.querySelector('.panel-ctrl-btn[data-action="float"]');
    if (!btn) return;

    if (isFloating) {
        btn.innerHTML = getIcon('dock-top', { size: '14px' });
        btn.title = t('dockLeft');
        btn.setAttribute('onclick', `${dockFn}()`);
    } else {
        btn.innerHTML = getIcon('maximize', { size: '14px' });
        btn.title = t('floatPanel');
        btn.setAttribute('onclick', `${floatFn}()`);
    }
}

/**
 * Float the toolbar as a draggable window.
 * Destaca a toolbar do grid e posiciona como janela flutuante.
 */
function floatToolbar() {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar || toolbarFloating) return;

    toolbarFloating = true;
    toolbarVisible = true;
    toolbar.style.overflow = '';
    toolbar.classList.add('panel-floating');
    toolbar.style.position = 'fixed';
    toolbar.style.left = '80px';
    toolbar.style.top = '80px';
    toolbar.style.width = `${Math.min(window.innerWidth - 160, 900)}px`;
    toolbar.style.height = 'auto';
    toolbar.style.zIndex = '200';

    rebuildGridRows();
    updateBarControlIcon('toolbar-controls', true, 'dockToolbar', 'floatToolbar');
    updateRibbonToggleState();
    saveBarsState();
}

/**
 * Dock the toolbar back to the grid.
 * Restaura a toolbar para sua posicao fixa no layout do grid.
 */
function dockToolbar() {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar) return;

    toolbarFloating = false;
    toolbarVisible = true;
    toolbar.classList.remove('panel-floating');
    toolbar.style.removeProperty('position');
    toolbar.style.removeProperty('left');
    toolbar.style.removeProperty('top');
    toolbar.style.removeProperty('width');
    toolbar.style.removeProperty('height');
    toolbar.style.removeProperty('z-index');
    toolbar.style.overflow = '';

    rebuildGridRows();
    updateBarControlIcon('toolbar-controls', false, 'dockToolbar', 'floatToolbar');
    updateRibbonToggleState();
    saveBarsState();
}

/**
 * Float the constellation as a draggable window.
 * Destaca a constelacao do viewport e posiciona como janela flutuante.
 */
function floatConstellation() {
    const hud = document.getElementById('constellation-hud');
    if (!hud || constellationFloating) return;

    constellationFloating = true;
    constellationVisible = true;
    hud.style.display = '';
    hud.classList.add('panel-floating');
    hud.style.position = 'fixed';
    hud.style.left = '80px';
    hud.style.bottom = '';
    hud.style.top = `${window.innerHeight - 240}px`;
    hud.style.width = `${Math.min(window.innerWidth - 160, 900)}px`;
    hud.style.height = '180px';
    hud.style.zIndex = '200';
    hud.style.right = '';

    // Adicionar handles de resize customizados
    _constellationResizeCleanup?.();
    _constellationResizeCleanup = addFloatingResizeHandles(hud, {
        minWidth: 300,
        maxWidth: window.innerWidth - 100,
        minHeight: 120,
        maxHeight: 500,
        onEnd: () => saveBarsState(),
    });

    updateBarControlIcon('constellation-controls', true, 'dockConstellation', 'floatConstellation');
    updateRibbonToggleState();
    saveBarsState();
}

/**
 * Dock the constellation back to viewport bottom.
 * Restaura a constelacao para o fundo do viewport 3D.
 */
function dockConstellation() {
    const hud = document.getElementById('constellation-hud');
    if (!hud) return;

    _constellationResizeCleanup?.();
    _constellationResizeCleanup = null;

    constellationFloating = false;
    constellationVisible = true;
    hud.classList.remove('panel-floating');
    // Remover TODOS os inline styles — CSS (position: relative; flex-shrink: 0) governa
    hud.style.removeProperty('position');
    hud.style.removeProperty('left');
    hud.style.removeProperty('right');
    hud.style.removeProperty('bottom');
    hud.style.removeProperty('top');
    hud.style.removeProperty('width');
    hud.style.removeProperty('height');
    hud.style.removeProperty('z-index');
    hud.style.display = '';
    // Restaurar altura salva via custom property (respeitar estado colapsado)
    const isCollapsed = hud.classList.contains('constellation-collapsed');
    if (!isCollapsed) {
        const savedH = localStorage.getItem('ecbyts-constellation-height');
        if (savedH) {
            const parsed = parseInt(savedH, 10);
            if (!isNaN(parsed)) {
                const mainArea = document.getElementById('main-area');
                if (mainArea) mainArea.style.setProperty('--bottom-panel-height', parsed + 'px');
            }
        }
    }

    updateBarControlIcon('constellation-controls', false, 'dockConstellation', 'floatConstellation');
    updateRibbonToggleState();
    saveBarsState();
}

/**
 * Setup drag-to-float on a bar element (toolbar/constellation).
 * @param {HTMLElement} el - O elemento da barra
 * @param {Function} floatFn - Funcao para flutuar
 * @param {Function} isFloatingFn - Funcao que retorna se ja esta flutuando
 */
function setupBarDragToFloat(el, floatFn, isFloatingFn) {
    const dragThreshold = 30;

    el.addEventListener('mousedown', (e) => {
        if (
            e.target.closest('button') ||
            e.target.closest('.panel-ctrl-btn') ||
            e.target.closest('select') ||
            e.target.closest('input') ||
            e.target.closest('.constellation-resize-top') ||
            e.target.closest('.float-resize')
        )
            return;

        // Se ja floating, permitir mover
        if (isFloatingFn()) {
            const offsetX = e.clientX - el.offsetLeft;
            const offsetY = e.clientY - el.offsetTop;
            const onMove = (me) => {
                el.style.left = `${me.clientX - offsetX}px`;
                el.style.top = `${me.clientY - offsetY}px`;
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.body.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
            e.preventDefault();
            return;
        }

        // Drag threshold para ativar float
        const startX = e.clientX;
        const startY = e.clientY;
        const onMove = (me) => {
            if (Math.abs(me.clientX - startX) > dragThreshold || Math.abs(me.clientY - startY) > dragThreshold) {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                floatFn();
                // Iniciar drag imediatamente
                const ox = me.clientX - el.offsetLeft;
                const oy = me.clientY - el.offsetTop;
                const onFloatMove = (fe) => {
                    el.style.left = `${fe.clientX - ox}px`;
                    el.style.top = `${fe.clientY - oy}px`;
                };
                const onFloatUp = () => {
                    document.removeEventListener('mousemove', onFloatMove);
                    document.removeEventListener('mouseup', onFloatUp);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                };
                document.addEventListener('mousemove', onFloatMove);
                document.addEventListener('mouseup', onFloatUp);
                document.body.style.cursor = 'grabbing';
                document.body.style.userSelect = 'none';
            }
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ----------------------------------------------------------------
// PANEL CONTROL ICON UPDATES
// ----------------------------------------------------------------

/**
 * Update panel control button icons based on current state.
 * Atualiza icones dos botoes de controle conforme estado do painel.
 * @param {string} panelId
 */
function updatePanelControlIcons(panelId) {
    // Chevron unico nao precisa trocar icone — float nao tem mais botao visual
    // Float/dock feito via context menu ou View > Panels
}

/**
 * Update ribbon toggle button active states.
 * Sincroniza a aparencia dos botoes de toggle do ribbon com o estado dos paineis.
 */
export function updateRibbonToggleState() {
    // Left panel toggle
    const leftBtn = document.getElementById('toggle-left-panel-btn');
    const leftPanel = panels.get('families');
    if (leftBtn && leftPanel) {
        leftBtn.classList.toggle('active', leftPanel.state !== 'minimized');
    }

    // Right panel toggle
    const rightBtn = document.getElementById('toggle-right-panel-btn');
    const rightPanel = panels.get('properties');
    if (rightBtn && rightPanel) {
        rightBtn.classList.toggle('active', rightPanel.state !== 'minimized');
    }

    // Toolbar toggle
    const toolbarBtn = document.getElementById('toggle-toolbar-btn');
    if (toolbarBtn) {
        toolbarBtn.classList.toggle('active', toolbarVisible);
    }

    // Statusbar toggle
    const statusbarBtn = document.getElementById('toggle-statusbar-btn');
    if (statusbarBtn) {
        statusbarBtn.classList.toggle('active', statusbarVisible);
    }

    // Constellation toggle
    const constBtn = document.getElementById('toggle-constellation-btn');
    if (constBtn) {
        constBtn.classList.toggle('active', constellationVisible);
    }

    // Chat panel toggle
    const chatBtn = document.getElementById('toggle-chat-panel-btn');
    const chatPanel = document.getElementById('llm-chat-panel');
    if (chatBtn && chatPanel) {
        chatBtn.classList.toggle('active', chatPanel.classList.contains('open'));
    }
}

// ----------------------------------------------------------------
// TOGGLE (backward compat)
// ----------------------------------------------------------------

/**
 * Toggle panel between docked and minimized.
 * @param {string} panelId
 */
function togglePanel(panelId) {
    const panel = panels.get(panelId);
    if (!panel) return;

    if (panel.state === 'minimized') {
        restorePanel(panelId);
    } else {
        minimizePanel(panelId);
    }
}

// ----------------------------------------------------------------
// DOCK PANEL
// ----------------------------------------------------------------

/**
 * Dock a panel to a specific side.
 * Move o painel para o lado especificado.
 *
 * @param {string} panelId - ID do painel
 * @param {'left'|'right'} position - Lado alvo
 */
export function dockPanel(panelId, position) {
    const panel = panels.get(panelId);
    if (!panel) return;

    // Se ja esta dockado nesse lado, nada a fazer
    if (panel.state === 'docked' && panel.dock === position) return;

    // Se tava floating, remover estado floating e handles de resize
    if (panel.state === 'floating') {
        panel._cleanupResize?.();
        panel._cleanupResize = null;
        panel.el.classList.remove('panel-floating');
        panel.el.style.removeProperty('left');
        panel.el.style.removeProperty('top');
        panel.el.style.removeProperty('width');
        panel.el.style.removeProperty('height');
        panel.el.style.removeProperty('position');
        panel.el.style.removeProperty('z-index');
    }

    // Remover tab de minimizado se existia
    removeMinTab(panelId);

    // Verificar se outro painel ja esta nessa posicao
    const otherPanel = findPanelAtDock(position, panelId);
    if (otherPanel && otherPanel.state === 'docked') {
        // Trocar posicoes: o outro vai pro lado oposto
        const otherSide = position === 'left' ? 'right' : 'left';
        otherPanel.dock = otherSide;
        otherPanel.el.setAttribute('data-dock', otherSide);
    }

    // Atualizar estado
    panel.dock = position;
    panel.state = 'docked';
    panel.el.setAttribute('data-dock', position);
    panel.el.classList.remove('collapsed', 'panel-floating', 'panel-minimized');

    rebuildLayout();
    saveLayout();
    updatePanelControlIcons(panelId);
    updateRibbonToggleState();
}

// ----------------------------------------------------------------
// MINIMIZE PANEL
// ----------------------------------------------------------------

/**
 * Minimize a panel to an edge tab.
 * @param {string} panelId
 */
export function minimizePanel(panelId) {
    const panel = panels.get(panelId);
    if (!panel) return;

    // Ja minimizado — nao duplicar min-tab
    if (panel.state === 'minimized') return;

    panel.state = 'minimized';
    panel.el.classList.add('panel-minimized');

    // Criar tab na borda
    createMinTab(panel);

    rebuildLayout();
    saveLayout();
    updateRibbonToggleState();
}

// ----------------------------------------------------------------
// RESTORE PANEL
// ----------------------------------------------------------------

/**
 * Restore a minimized panel to its dock position.
 * @param {string} panelId
 */
export function restorePanel(panelId, tabId) {
    const panel = panels.get(panelId);
    if (!panel) return;

    panel.state = 'docked';
    panel.el.classList.remove('panel-minimized', 'panel-floating');

    // Ensure chevron stays immediately visible when restoring a scrolled tabs bar
    const tabs = panel.el.querySelector('.tabs');
    if (tabs) tabs.scrollTop = 0;

    // Remover tab
    removeMinTab(panelId);

    rebuildLayout();
    saveLayout();
    updatePanelControlIcons(panelId);
    updateRibbonToggleState();

    // Ativar sub-aba especifica se solicitado
    if (tabId) activateTabById(tabId);
}

// ----------------------------------------------------------------
// FLOAT PANEL
// ----------------------------------------------------------------

/**
 * Make a panel floating.
 * @param {string} panelId
 */
export function floatPanel(panelId) {
    const panel = panels.get(panelId);
    if (!panel) return;

    panel.state = 'floating';
    panel.el.classList.remove('panel-minimized');
    panel.el.classList.add('panel-floating');

    // Posicionar no centro da tela
    const rect = panel.el.getBoundingClientRect();
    panel.el.style.position = 'fixed';
    panel.el.style.left = `${Math.max(50, (window.innerWidth - panel.size) / 2)}px`;
    panel.el.style.top = '150px';
    panel.el.style.width = `${panel.size}px`;
    panel.el.style.height = `${window.innerHeight - 250}px`;
    panel.el.style.zIndex = '200';

    // Remover tab se existia
    removeMinTab(panelId);

    // Adicionar handles de resize customizados
    panel._cleanupResize?.();
    panel._cleanupResize = addFloatingResizeHandles(panel.el, {
        minWidth: panel.minSize,
        maxWidth: panel.maxSize,
        minHeight: 150,
        maxHeight: window.innerHeight - 100,
        onEnd: () => saveLayout(),
    });

    rebuildLayout();
    saveLayout();
    updatePanelControlIcons(panelId);
    updateRibbonToggleState();
}

// ----------------------------------------------------------------
// MINIMIZE TABS
// ----------------------------------------------------------------

/**
 * Create a minimized tab for a panel.
 * @param {PanelState} panel
 */
function createMinTab(panel) {
    removeMinTab(panel.id);
    const container = panel.dock === 'left' ? minTabsLeft : minTabsRight;
    if (!container) return;

    // Ler sub-abas do painel para criar um min-tab por aba
    const subTabs = Array.from(panel.el.querySelectorAll('.tabs .tab[data-tab]'));

    if (subTabs.length === 0) {
        // Fallback: min-tab unica com titulo do painel
        const tab = document.createElement('button');
        tab.className = 'min-tab';
        tab.id = `min-tab-${panel.id}`;
        tab.title = panel.title;
        tab.innerHTML = `<span class="min-tab-icon">${getIcon('grid', { size: '12px' })}</span><span class="min-tab-text">${panel.title}</span>`;
        tab.addEventListener('click', () => restorePanel(panel.id));
        container.appendChild(tab);
        return;
    }

    // Wrapper agrupa todas as sub-abas deste painel
    const wrapper = document.createElement('div');
    wrapper.className = 'min-tab-group';
    wrapper.id = `min-tab-${panel.id}`;

    // No painel direito minimizado, manter Automation sempre visivel no topo.
    // Evita que fique fora do viewport em alturas menores.
    if (panel.id === 'properties') {
        subTabs.sort((a, b) => {
            const aa = a.dataset.tab === 'automation' ? 0 : 1;
            const bb = b.dataset.tab === 'automation' ? 0 : 1;
            return aa - bb;
        });
    }

    subTabs.forEach((sub) => {
        const tabId = sub.dataset.tab;
        const label = sub.textContent.trim();
        const isActive = sub.classList.contains('active');
        const icon = getMinTabIconName(tabId);
        const btn = document.createElement('button');
        btn.className = 'min-tab' + (isActive ? ' min-tab--active' : '');
        btn.dataset.tab = tabId;
        btn.title = label;
        btn.innerHTML = `<span class="min-tab-icon">${getIcon(icon, { size: '12px' })}</span><span class="min-tab-text">${label}</span>`;
        btn.addEventListener('click', () => restorePanel(panel.id, tabId));
        wrapper.appendChild(btn);
    });

    container.appendChild(wrapper);
}

/**
 * Resolve icon name for a tab id in minimized rail chips.
 * @param {string} tabId
 * @returns {string}
 */
function getMinTabIconName(tabId) {
    const map = {
        families: 'layers',
        elements: 'box',
        sensors: 'radio',
        areas: 'grid',
        project: 'folder',
        files: 'file-text',
        campaigns: 'target',
        scenes: 'camera',
        analytics: 'bar-chart',
        stamps: 'share',
        governance: 'shield',
        'cost-analysis': 'dollar-sign',
        automation: 'settings',
    };
    return map[tabId] || 'grid';
}

/**
 * Remove a minimized tab.
 * @param {string} panelId
 */
function removeMinTab(panelId) {
    const tab = document.getElementById(`min-tab-${panelId}`);
    if (tab) tab.remove();
}

// ----------------------------------------------------------------
// CONSTELLATION MIN-TAB (bottom edge)
// ----------------------------------------------------------------

/**
 * Create minimized tab strip for constellation at bottom edge.
 * Mostra as sub-abas da constellation como botoes horizontais na borda inferior.
 */
function _createConstellationMinTab() {
    _removeConstellationMinTab();
    if (!minTabsBottom) return;
    const hud = document.getElementById('constellation-hud');
    if (!hud) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'min-tab-group min-tab-group--horizontal';
    wrapper.id = 'min-tab-constellation';

    const cTabs = hud.querySelectorAll('.constellation-tab[data-ctab]');
    cTabs.forEach((ct) => {
        const ctabId = ct.dataset.ctab;
        const label = ct.textContent.trim();
        const isActive = ct.classList.contains('active');
        const btn = document.createElement('button');
        btn.className = 'min-tab min-tab--horizontal' + (isActive ? ' min-tab--active' : '');
        btn.title = label;
        btn.innerHTML = `<span class="min-tab-text">${label}</span>`;
        btn.addEventListener('click', () => _restoreConstellation(ctabId));
        wrapper.appendChild(btn);
    });
    minTabsBottom.appendChild(wrapper);
}

function _removeConstellationMinTab() {
    const el = document.getElementById('min-tab-constellation');
    if (el) el.remove();
}

/**
 * Restore constellation from minimized state.
 * @param {string} [ctabId] - Sub-aba da constellation para ativar (graph, pdplu, report)
 */
function _restoreConstellation(ctabId) {
    constellationVisible = true;
    const hud = document.getElementById('constellation-hud');
    if (hud) hud.style.display = '';
    _removeConstellationMinTab();
    rebuildGridRows();
    updateRibbonToggleState();
    saveBarsState();
    if (ctabId && window.switchConstellationTab) {
        window.switchConstellationTab(ctabId);
    }
}

// ----------------------------------------------------------------
// LAYOUT REBUILD
// ----------------------------------------------------------------

/**
 * Rebuild the CSS grid layout based on current panel states.
 * Recalcula grid-template-columns do #app baseado nos estados dos paineis.
 */
function rebuildLayout() {
    const app = document.getElementById('app');
    if (!app) return;

    // No mobile, o layout é controlado por CSS (responsive.css) + drawers
    if (document.body.classList.contains('mobile')) return;

    // Encontrar paineis em cada posicao
    const leftPanel = findDockedPanelAt('left');
    const rightPanel = findDockedPanelAt('right');

    // Calcular larguras
    const leftWidth = leftPanel ? `${leftPanel.size}px` : '0px';
    const rightWidth = rightPanel ? `${rightPanel.size}px` : '0px';
    const leftResize = leftPanel ? '4px' : '0px';
    const rightResize = rightPanel ? '4px' : '0px';

    // Atualizar CSS variables
    app.style.setProperty('--left-panel-width', leftWidth);
    app.style.setProperty('--right-panel-width', rightWidth);

    // Mostrar/esconder resize handles conforme estado dos paineis
    const leftResizeEl = document.getElementById('resize-handle-left');
    if (leftResizeEl) leftResizeEl.style.display = leftPanel ? '' : 'none';
    const rightResizeEl = document.getElementById('resize-handle-right');
    if (rightResizeEl) rightResizeEl.style.display = rightPanel ? '' : 'none';

    // Posicionar paineis na grid
    panels.forEach((panel) => {
        if (panel.state === 'floating') return;

        if (panel.state === 'minimized') {
            // Painel minimizado: esconder sem pointer-events issues
            panel.el.style.display = 'none';
        } else if (panel.state === 'docked') {
            panel.el.style.display = '';
            panel.el.style.removeProperty('position');
            panel.el.style.removeProperty('left');
            panel.el.style.removeProperty('top');
            panel.el.style.removeProperty('width');
            panel.el.style.removeProperty('height');
            panel.el.style.removeProperty('z-index');

            // Colocar na coluna certa
            if (panel.dock === 'left') {
                panel.el.style.gridColumn = '1';
            } else {
                panel.el.style.gridColumn = '5';
            }
        }
    });

    // Recalcular canvas 3D
    requestAnimationFrame(() => {
        const container = document.getElementById('canvas-container');
        if (container) handleResize(container);
    });
}

/**
 * Find a docked panel at a specific position (excludes minimized/floating).
 * @param {'left'|'right'} position
 * @returns {PanelState|null}
 */
function findDockedPanelAt(position) {
    for (const panel of panels.values()) {
        if (panel.dock === position && panel.state === 'docked') {
            return panel;
        }
    }
    return null;
}

/**
 * Find any panel at a dock position (any state).
 * @param {'left'|'right'} position
 * @param {string} [excludeId]
 * @returns {PanelState|null}
 */
function findPanelAtDock(position, excludeId) {
    for (const panel of panels.values()) {
        if (panel.dock === position && panel.id !== excludeId && panel.state !== 'floating') {
            return panel;
        }
    }
    return null;
}

// ----------------------------------------------------------------
// RESIZE HANDLES
// ----------------------------------------------------------------

/**
 * Setup resize handles for docked panels.
 */
function setupResizeHandles() {
    const app = document.getElementById('app');

    // --- Left panel resize ---
    const leftHandle = document.getElementById('resize-handle-left');
    if (leftHandle) {
        let isResizingLeft = false;
        let leftPanel = null;

        leftHandle.addEventListener('mousedown', (e) => {
            leftPanel = findDockedPanelAt('left');
            if (!leftPanel) return;
            isResizingLeft = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizingLeft || !leftPanel) return;
            const newWidth = Math.min(leftPanel.maxSize, Math.max(leftPanel.minSize, e.clientX));
            leftPanel.size = newWidth;
            app.style.setProperty('--left-panel-width', newWidth + 'px');
            const container = document.getElementById('canvas-container');
            if (container) handleResize(container);
        });

        document.addEventListener('mouseup', () => {
            if (isResizingLeft) {
                isResizingLeft = false;
                leftPanel = null;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                saveLayout();
            }
        });
    }

    // --- Right panel resize ---
    const rightHandle = document.getElementById('resize-handle-right');
    if (rightHandle) {
        let isResizingRight = false;
        let rightPanel = null;

        rightHandle.addEventListener('mousedown', (e) => {
            rightPanel = findDockedPanelAt('right');
            if (!rightPanel) return;
            isResizingRight = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizingRight || !rightPanel) return;
            // Painel direito: largura = viewport width - posicao X do mouse
            const newWidth = Math.min(rightPanel.maxSize, Math.max(rightPanel.minSize, window.innerWidth - e.clientX));
            rightPanel.size = newWidth;
            app.style.setProperty('--right-panel-width', newWidth + 'px');
            const container = document.getElementById('canvas-container');
            if (container) handleResize(container);
        });

        document.addEventListener('mouseup', () => {
            if (isResizingRight) {
                isResizingRight = false;
                rightPanel = null;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                saveLayout();
            }
        });
    }
}

// ----------------------------------------------------------------
// DRAG TO FLOAT
// ----------------------------------------------------------------

/**
 * Setup drag-to-float on a panel header.
 * @param {string} panelId
 * @param {HTMLElement} header
 */
function setupDragToFloat(panelId, header) {
    const dragThreshold = 30; // px antes de ativar floating

    header.addEventListener('mousedown', (e) => {
        // Nao iniciar drag se clicou em um botao
        if (e.target.closest('button') || e.target.closest('.panel-ctrl-btn')) return;

        const panel = panels.get(panelId);
        if (!panel) return;

        // Se ja floating, permitir mover diretamente
        if (panel.state === 'floating') {
            const offsetX = e.clientX - panel.el.offsetLeft;
            const offsetY = e.clientY - panel.el.offsetTop;

            const onMove = (moveE) => {
                panel.el.style.left = `${moveE.clientX - offsetX}px`;
                panel.el.style.top = `${moveE.clientY - offsetY}px`;
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.body.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
            e.preventDefault();
            return;
        }

        // Guardar posicao inicial
        const startX = e.clientX;
        const startY = e.clientY;

        const onMove = (moveE) => {
            const dx = Math.abs(moveE.clientX - startX);
            const dy = Math.abs(moveE.clientY - startY);

            if (dx > dragThreshold || dy > dragThreshold) {
                // Threshold reached — convert to floating
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);

                floatPanel(panelId);

                // Reposicionar na posicao do mouse
                const panel = panels.get(panelId);
                if (panel) {
                    panel.el.style.left = `${moveE.clientX - 100}px`;
                    panel.el.style.top = `${moveE.clientY - 15}px`;

                    // Iniciar drag imediatamente
                    const floatStartX = moveE.clientX - panel.el.offsetLeft;
                    const floatStartY = moveE.clientY - panel.el.offsetTop;

                    const onFloatMove = (fmE) => {
                        panel.el.style.left = `${fmE.clientX - floatStartX}px`;
                        panel.el.style.top = `${fmE.clientY - floatStartY}px`;
                    };

                    const onFloatUp = () => {
                        document.removeEventListener('mousemove', onFloatMove);
                        document.removeEventListener('mouseup', onFloatUp);
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                    };

                    document.addEventListener('mousemove', onFloatMove);
                    document.addEventListener('mouseup', onFloatUp);
                    document.body.style.cursor = 'grabbing';
                    document.body.style.userSelect = 'none';
                }
            }
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ----------------------------------------------------------------
// ANALYTICS FULLSCREEN
// ----------------------------------------------------------------

/**
 * Toggle analytics fullscreen mode.
 */
function toggleAnalyticsFullscreen() {
    const analyticsTab = document.getElementById('tab-analytics');
    const btn = document.getElementById('analytics-fullscreen-btn');
    if (!analyticsTab) return;

    analyticsFullscreen = !analyticsFullscreen;

    if (analyticsFullscreen) {
        analyticsTab.classList.add('analytics-fullscreen');
        if (btn) btn.textContent = 'Collapse';
        activateTabById('analytics');
    } else {
        analyticsTab.classList.remove('analytics-fullscreen');
        if (btn) btn.textContent = 'Expand';
    }
}

// ----------------------------------------------------------------
// TOOLBAR & STATUSBAR TOGGLE
// ----------------------------------------------------------------

let toolbarVisible = true;
let statusbarVisible = true;
let constellationVisible = true;

/**
 * Check if constellation HUD is visible.
 * Retorna se a barra de constelacao esta visivel (para outros modulos consultarem).
 * @returns {boolean}
 */
export function isConstellationVisible() {
    return constellationVisible;
}

const BARS_KEY = 'ecbyts-bars-layout';

/**
 * Rebuild grid rows based on toolbar/statusbar visibility.
 * Recalcula grid-template-rows conforme visibilidade da toolbar e statusbar.
 */
export function rebuildGridRows() {
    const app = document.getElementById('app');
    if (!app) return;

    if (app.classList.contains('view-actions')) {
        app.style.gridTemplateRows = '40px 0px 0px 0px 1fr 0px';
    } else {
        // Toolbar flutuante sai do grid.
        const toolbarRow = toolbarVisible && !toolbarFloating ? '56px' : '0px';
        const tickerEl = document.getElementById('ticker-bar');
        const tickerVisible = !!(tickerEl && getComputedStyle(tickerEl).display !== 'none');
        const tickerRow = tickerVisible ? '28px' : '0px';
        const statusRow = statusbarVisible ? '26px' : '0px';
        app.style.gridTemplateRows = `40px 0px ${toolbarRow} ${tickerRow} 1fr ${statusRow}`;
    }

    // Recalcular canvas 3D apos mudanca de grid
    requestAnimationFrame(() => {
        const container = document.getElementById('canvas-container');
        if (container) handleResize(container);
    });
}

/**
 * Clamp floating panels back inside the viewport after a window resize.
 * Garante que paineis flutuantes nao escapem da tela ao redimensionar.
 */
function _clampFloatingPanels() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    panels.forEach((panel) => {
        if (panel.state !== 'floating') return;
        const el = panel.el;
        const rect = el.getBoundingClientRect();
        if (rect.right > vw) el.style.left = Math.max(0, vw - rect.width - 8) + 'px';
        if (rect.bottom > vh) el.style.top = Math.max(0, vh - rect.height - 8) + 'px';
        if (rect.left < 0) el.style.left = '0px';
        if (rect.top < 0) el.style.top = '0px';
    });
    // Clamp toolbar and constellation if floating
    [document.getElementById('toolbar'), document.getElementById('constellation-hud')].forEach((el) => {
        if (!el || !el.classList.contains('panel-floating')) return;
        const rect = el.getBoundingClientRect();
        if (rect.right > vw) el.style.left = Math.max(0, vw - rect.width - 8) + 'px';
        if (rect.bottom > vh) el.style.top = Math.max(0, vh - rect.height - 8) + 'px';
        if (rect.left < 0) el.style.left = '0px';
        if (rect.top < 0) el.style.top = '0px';
    });
}

/**
 * Toggle toolbar (ribbon) visibility.
 * Mostra/esconde a faixa de opcoes (ribbon).
 * Se flutuante, docka primeiro e depois recolhe.
 */
function toggleToolbar() {
    // Se flutuante, docka primeiro
    if (toolbarFloating) {
        dockToolbar();
        return;
    }
    toolbarVisible = !toolbarVisible;
    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
        toolbar.classList.toggle('ribbon-collapsed', !toolbarVisible);
    }
    // Atualiza chevron no menubar
    const toggleBtn = document.getElementById('ribbon-toggle-btn');
    if (toggleBtn) {
        toggleBtn.classList.toggle('collapsed', !toolbarVisible);
        toggleBtn.title = toolbarVisible ? 'Collapse ribbon (Ctrl+F1)' : 'Expand ribbon (Ctrl+F1)';
    }
    rebuildGridRows();
    updateRibbonToggleState();
    saveBarsState();
    // Atualiza --chrome-top para analytics-fullscreen acompanhar
    const toolbarH = toolbarVisible ? 56 : 0;
    document.documentElement.style.setProperty('--chrome-top', 40 + toolbarH + 'px');
}

/**
 * Toggle statusbar visibility.
 * Mostra/esconde a barra de status inferior.
 */
function toggleStatusbar() {
    statusbarVisible = !statusbarVisible;
    const statusbar = document.getElementById('statusbar');
    if (statusbar) statusbar.style.display = statusbarVisible ? '' : 'none';
    rebuildGridRows();
    updateRibbonToggleState();
    saveBarsState();
    // Atualiza --chrome-bottom para analytics-fullscreen acompanhar
    document.documentElement.style.setProperty('--chrome-bottom', statusbarVisible ? '26px' : '0px');
}

/**
 * Toggle constellation HUD visibility.
 * Mostra/esconde a barra de constelacao (relacoes do elemento) na parte inferior.
 * Se flutuante, docka primeiro e depois recolhe.
 */
function toggleConstellation() {
    // Se flutuante, docka primeiro
    if (constellationFloating) {
        dockConstellation();
        return;
    }
    constellationVisible = !constellationVisible;
    const hud = document.getElementById('constellation-hud');
    if (hud) hud.style.display = constellationVisible ? '' : 'none';

    // Mostrar/esconder min-tab no bottom
    if (!constellationVisible) _createConstellationMinTab();
    else _removeConstellationMinTab();

    rebuildGridRows();
    updateRibbonToggleState();
    saveBarsState();
}

/**
 * Ensure toolbar is visible (called when menu item is clicked).
 * Garante que a toolbar esteja visivel quando o usuario clica no menu.
 */
function ensureToolbarVisible() {
    if (!toolbarVisible) {
        toolbarVisible = true;
        const toolbar = document.getElementById('toolbar');
        if (toolbar) toolbar.classList.remove('ribbon-collapsed');
        const toggleBtn = document.getElementById('ribbon-toggle-btn');
        if (toggleBtn) {
            toggleBtn.classList.remove('collapsed');
            toggleBtn.title = 'Collapse ribbon (Ctrl+F1)';
        }
        rebuildGridRows();
        updateRibbonToggleState();
        saveBarsState();
    }
}

/** Save toolbar/statusbar/constellation state to localStorage. */
function saveBarsState() {
    try {
        safeSetItem(
            BARS_KEY,
            JSON.stringify({
                toolbar: toolbarVisible,
                statusbar: statusbarVisible,
                constellation: constellationVisible,
                toolbarFloating,
                constellationFloating,
            }),
        );
        window.dispatchEvent(new CustomEvent('panelLayoutChanged'));
    } catch (e) {
        /* ignore */
    }
}

/** Load toolbar/statusbar state from localStorage. */
function loadBarsState() {
    try {
        const saved = localStorage.getItem(BARS_KEY);
        if (!saved) return false;
        const state = JSON.parse(saved);
        if (state.toolbar === false) {
            toolbarVisible = false;
            const toolbar = document.getElementById('toolbar');
            if (toolbar) toolbar.classList.add('ribbon-collapsed');
            const toggleBtn = document.getElementById('ribbon-toggle-btn');
            if (toggleBtn) toggleBtn.classList.add('collapsed');
        }
        // Statusbar sempre visivel por padrao — contem disclaimer legal
        // Ignorar estado salvo para garantir visibilidade
        if (state.constellation === false) {
            constellationVisible = false;
            const hud = document.getElementById('constellation-hud');
            if (hud) hud.style.display = 'none';
            _createConstellationMinTab();
        }
        // Restaurar estado flutuante (toolbar e constellation)
        if (state.toolbarFloating) floatToolbar();
        if (state.constellationFloating) floatConstellation();
        rebuildGridRows();
        return true;
    } catch (e) {
        return false;
    }
}

// ----------------------------------------------------------------
// PERSISTENCE
// ----------------------------------------------------------------

const LAYOUT_KEY = 'ecbyts-panel-layout';

/**
 * Save current layout to localStorage.
 */
function saveLayout() {
    try {
        const layout = {};
        panels.forEach((panel, id) => {
            layout[id] = {
                state: panel.state,
                dock: panel.dock,
                size: panel.size,
            };
        });
        safeSetItem(LAYOUT_KEY, JSON.stringify(layout));
        window.dispatchEvent(new CustomEvent('panelLayoutChanged'));
    } catch (e) {
        // Silently fail
    }
}

/**
 * Load layout from localStorage.
 */
function loadLayout() {
    try {
        const saved = localStorage.getItem(LAYOUT_KEY);
        if (!saved) return false;

        const layout = JSON.parse(saved);

        for (const [id, config] of Object.entries(layout)) {
            const panel = panels.get(id);
            if (!panel) continue;

            panel.dock = config.dock || panel.dock;
            panel.size = config.size || panel.size;

            // Aplicar estado
            if (config.state === 'minimized') {
                minimizePanel(id);
            } else if (config.state === 'docked') {
                dockPanel(id, config.dock);
            }
            // Nao restaurar floating — sempre come back docked
        }
        return true;
    } catch (e) {
        return false;
    }
}

// ----------------------------------------------------------------
// TAB LAYOUT — Move tabs between panels
// ----------------------------------------------------------------

/** Default tab positions — quais abas pertencem a cada painel */
const DEFAULT_TAB_POSITIONS = {
    families: 'left',
    elements: 'left',
    campaigns: 'left',
    scenes: 'left',
    stamps: 'left',
    'cost-analysis': 'left',
    bounty: 'left',
    areas: 'right',
    project: 'right',
    sensors: 'right',
    files: 'right',
    analytics: 'right',
    governance: 'right',
    automation: 'right',
};

const TAB_LAYOUT_KEY = 'ecbyts-tab-layout';

/**
 * Apply tab layout — move tabs to their assigned panels.
 * Carrega posicoes salvas (ou usa padrao) e move abas entre paineis.
 */
function applyTabLayout() {
    const positions = loadTabPositions();

    for (const [tabId, side] of Object.entries(positions)) {
        const tabBtn = document.querySelector(`.tab[data-tab="${tabId}"]`);
        if (!tabBtn) continue;

        const currentPanel = tabBtn.closest('#left-panel, #right-panel');
        const currentSide = currentPanel?.id === 'left-panel' ? 'left' : 'right';

        // Mover apenas se esta no painel errado
        if (currentSide !== side) {
            moveTabDOM(tabId, side);
        }
    }

    // Garantir que cada painel tem uma aba ativa
    ensureActiveTab('left');
    ensureActiveTab('right');
    applyRailTabTitles();
}

/**
 * Ensure rail tabs expose full labels via native tooltip.
 * Mantem title sincronizado com o texto visivel de cada tab.
 */
function applyRailTabTitles() {
    document.querySelectorAll('#left-panel .tab[data-tab], #right-panel .tab[data-tab]').forEach((tab) => {
        const label = (tab.textContent || '').trim();
        if (label) tab.title = label;
    });
}

/**
 * Move a tab to a different panel.
 * Move o botao da aba e seu conteudo para o painel alvo.
 *
 * @param {string} tabId - ID da aba (ex: 'elements', 'families')
 * @param {'left'|'right'} targetSide - Painel alvo
 */
function moveTab(tabId, targetSide) {
    const tabBtn = document.querySelector(`.tab[data-tab="${tabId}"]`);
    if (!tabBtn) return;

    // Se a aba era ativa, desativar e esconder conteudo antes de mover
    const wasActive = tabBtn.classList.contains('active');
    if (wasActive) {
        tabBtn.classList.remove('active');
        const content = document.getElementById(`tab-${tabId}`);
        if (content) content.style.display = 'none';
    }

    moveTabDOM(tabId, targetSide);

    // Ativar a aba movida no painel destino
    tabBtn.classList.add('active');
    const content = document.getElementById(`tab-${tabId}`);
    if (content) content.style.display = 'block';

    // Desativar outras abas no painel destino
    const targetPanel = tabBtn.closest('#left-panel, #right-panel');
    if (targetPanel) {
        targetPanel.querySelectorAll('.tab[data-tab]').forEach((t) => {
            if (t !== tabBtn) {
                t.classList.remove('active');
                const c = document.getElementById(`tab-${t.dataset.tab}`);
                if (c) c.style.display = 'none';
            }
        });
    }

    // Garantir que o painel de origem tem uma aba ativa
    ensureActiveTab('left');
    ensureActiveTab('right');
    saveTabPositions();
}

/**
 * Move tab DOM elements (button + content) to target panel.
 * @param {string} tabId
 * @param {'left'|'right'} targetSide
 */
function moveTabDOM(tabId, targetSide) {
    const tabBtn = document.querySelector(`.tab[data-tab="${tabId}"]`);
    const tabContent = document.getElementById(`tab-${tabId}`);
    if (!tabBtn) return;

    const targetTabsBar = document.getElementById(targetSide === 'left' ? 'left-tabs' : 'right-tabs');
    const targetContent = document.getElementById(targetSide === 'left' ? 'left-panel-content' : 'right-panel-content');
    if (!targetTabsBar || !targetContent) return;

    // Inserir botao antes do .panel-controls (se existir)
    const controls = targetTabsBar.querySelector('.panel-controls');
    if (controls) {
        targetTabsBar.insertBefore(tabBtn, controls);
    } else {
        targetTabsBar.appendChild(tabBtn);
    }

    // Mover conteudo da aba
    if (tabContent) {
        targetContent.appendChild(tabContent);
    }
}

/**
 * Ensure a panel has an active tab.
 * Se nenhuma aba estiver ativa no painel, ativa a primeira.
 *
 * @param {'left'|'right'} side
 */
function ensureActiveTab(side) {
    const panel = document.getElementById(side === 'left' ? 'left-panel' : 'right-panel');
    if (!panel) return;

    const tabs = panel.querySelectorAll('.tab[data-tab]');
    if (tabs.length === 0) return;

    const hasActive = panel.querySelector('.tab.active');
    if (hasActive) {
        // Garantir que o conteudo esta visivel
        const activeId = hasActive.dataset.tab;
        const content = document.getElementById(`tab-${activeId}`);
        if (content) content.style.display = 'block';
        return;
    }

    // Nenhuma ativa — ativar primeira
    const first = tabs[0];
    first.classList.add('active');
    const content = document.getElementById(`tab-${first.dataset.tab}`);
    if (content) content.style.display = 'block';
}

/**
 * Load tab positions from localStorage.
 * @returns {Object<string, 'left'|'right'>}
 */
function loadTabPositions() {
    try {
        const saved = localStorage.getItem(TAB_LAYOUT_KEY);
        const parsed = saved ? JSON.parse(saved) : {};
        const shouldRebalanceLegacy = isLegacyRightHeavyLayout(parsed);
        const source = shouldRebalanceLegacy ? {} : parsed;
        const { positions, changed } = normalizeTabPositions(source);
        if (changed || shouldRebalanceLegacy) {
            safeSetItem(TAB_LAYOUT_KEY, JSON.stringify(positions));
        }
        return positions;
    } catch (e) {
        /* ignore */
    }
    return normalizeTabPositions({}).positions;
}

/**
 * Detect legacy right-heavy saved layouts and opt-in to new balanced defaults.
 * Rebalance only when no explicit custom-left tabs are present.
 *
 * @param {Record<string, unknown>} raw
 * @returns {boolean}
 */
function isLegacyRightHeavyLayout(raw) {
    if (!raw || typeof raw !== 'object') return false;

    const validSide = (value) => value === 'left' || value === 'right';
    const entries = Object.entries(raw).filter(([, side]) => validSide(side));
    if (entries.length === 0) return false;

    // If user already customized any additional tab to the left, preserve it.
    const leftTabs = entries.filter(([, side]) => side === 'left').map(([tabId]) => tabId);
    if (leftTabs.some((tabId) => tabId !== 'families' && tabId !== 'elements')) {
        return false;
    }

    // Keep strict right-only expectations from previous defaults.
    const legacyRightTabs = [
        'areas',
        'project',
        'sensors',
        'files',
        'campaigns',
        'scenes',
        'analytics',
        'governance',
        'automation',
    ];
    for (const tabId of legacyRightTabs) {
        const side = raw[tabId];
        if (validSide(side) && side !== 'right') return false;
    }

    // Tabs moved by the new default were previously right or unset.
    const rebalancedTabs = ['campaigns', 'scenes', 'stamps', 'cost-analysis', 'bounty'];
    return rebalancedTabs.every((tabId) => raw[tabId] !== 'left');
}

/**
 * Normalize persisted tab positions.
 * - Preenche chaves faltantes com defaults atuais
 * - Remove valores invalidos (so left/right)
 * - Forca regras de produto: files e automation no painel direito
 *
 * @param {Record<string, unknown>} raw
 * @returns {{ positions: Record<string, 'left'|'right'>, changed: boolean }}
 */
function normalizeTabPositions(raw) {
    const valid = new Set(['left', 'right']);
    const incoming = raw && typeof raw === 'object' ? raw : {};
    const positions = { ...DEFAULT_TAB_POSITIONS };
    let changed = false;

    // Preserve valid saved positions (including future/extra tabs)
    for (const [tabId, side] of Object.entries(incoming)) {
        if (valid.has(side)) {
            positions[tabId] = side;
        } else {
            changed = true;
        }
    }

    // Ensure all default keys exist with valid values
    for (const [tabId, side] of Object.entries(DEFAULT_TAB_POSITIONS)) {
        if (!valid.has(positions[tabId])) {
            positions[tabId] = side;
            changed = true;
        }
    }

    // Product policy: these tabs must always live on right panel
    if (positions.files !== 'right') {
        positions.files = 'right';
        changed = true;
    }
    if (positions.automation !== 'right') {
        positions.automation = 'right';
        changed = true;
    }

    // Persist only when normalized output differs from raw persisted payload
    const normalizedFromRaw = {};
    for (const [tabId, side] of Object.entries(incoming)) {
        if (valid.has(side)) normalizedFromRaw[tabId] = side;
    }
    if (JSON.stringify(positions) !== JSON.stringify({ ...DEFAULT_TAB_POSITIONS, ...normalizedFromRaw })) {
        changed = true;
    }

    return { positions, changed };
}

/**
 * Save current tab positions to localStorage.
 */
function saveTabPositions() {
    try {
        const positions = {};
        document.querySelectorAll('.tab[data-tab]').forEach((tab) => {
            const panel = tab.closest('#left-panel, #right-panel');
            if (panel) {
                positions[tab.dataset.tab] = panel.id === 'left-panel' ? 'left' : 'right';
            }
        });
        safeSetItem(TAB_LAYOUT_KEY, JSON.stringify(positions));
    } catch (e) {
        /* ignore */
    }
}

// ----------------------------------------------------------------
// CONTEXT MENU — Right-click on panels, tabs, bars, and windows
// ----------------------------------------------------------------

/** @type {HTMLElement|null} */
let contextMenuEl = null;
/** @type {{ type: string, id: string, panelId?: string, tabId?: string }|null} */
let contextMenuCtx = null;

/**
 * Create the panel context menu element and register listeners.
 * Menu de contexto universal para todos os paineis, barras e janelas.
 */
function createContextMenu() {
    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'panel-context-menu';
    contextMenuEl.id = 'panel-context-menu';
    document.body.appendChild(contextMenuEl);

    // Click em item do menu — executa acao e fecha
    contextMenuEl.addEventListener('click', (e) => {
        const item = e.target.closest('.panel-context-menu-item');
        if (!item || !contextMenuCtx) return;
        executeContextAction(item.dataset.action, contextMenuCtx);
        hideContextMenu();
    });

    // Impedir menu nativo sobre nosso menu
    contextMenuEl.addEventListener('contextmenu', (e) => e.preventDefault());

    // Fechar ao clicar fora
    document.addEventListener('click', (e) => {
        if (contextMenuEl && !contextMenuEl.contains(e.target)) hideContextMenu();
    });

    // Fechar com Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideContextMenu();
    });

    // Registrar listeners de contextmenu em todos os paineis e barras
    document.getElementById('left-panel')?.addEventListener('contextmenu', handlePanelContextMenu);
    document.getElementById('right-panel')?.addEventListener('contextmenu', handlePanelContextMenu);
    document.getElementById('constellation-hud')?.addEventListener('contextmenu', handlePanelContextMenu);

    // Viz settings bar e criado dinamicamente — observar adição ao DOM
    const observer = new MutationObserver(() => {
        const vizBar = document.getElementById('viz-settings-bar');
        if (vizBar && !vizBar._ctxRegistered) {
            vizBar.addEventListener('contextmenu', handlePanelContextMenu);
            vizBar._ctxRegistered = true;
        }
        const chatPanel = document.querySelector('.llm-chat-panel');
        if (chatPanel && !chatPanel._ctxRegistered) {
            chatPanel.addEventListener('contextmenu', handlePanelContextMenu);
            chatPanel._ctxRegistered = true;
        }
    });
    const mainArea = document.getElementById('main-area');
    if (mainArea) observer.observe(mainArea, { childList: true, subtree: false });
    // Tambem observar body para chat (fixed position, appendado em body ou main)
    observer.observe(document.body, { childList: true, subtree: false });
}

/**
 * Handle right-click on any panel, bar, or window.
 * Detecta o contexto (tab, painel docked, constellation, viz, chat, floating, modal)
 * e mostra o menu apropriado.
 * @param {MouseEvent} e
 */
function handlePanelContextMenu(e) {
    // Nao mostrar menu se clicou em input, select, textarea
    if (e.target.closest('input, select, textarea')) return;

    const x = e.clientX;
    const y = e.clientY;

    // 1. Tab em painel docked
    const tab = e.target.closest('.tab[data-tab]');
    const dockedPanel = e.target.closest('#left-panel, #right-panel');
    if (tab && dockedPanel) {
        e.preventDefault();
        const panelId = findPanelIdByElement(dockedPanel);
        showPanelContextMenu({ type: 'tab', tabId: tab.dataset.tab, panelId, id: dockedPanel.id }, x, y);
        return;
    }

    // 2. Painel docked (fora de tab)
    if (dockedPanel) {
        e.preventDefault();
        const panelId = findPanelIdByElement(dockedPanel);
        const isFloating = dockedPanel.classList.contains('panel-floating');
        showPanelContextMenu(
            {
                type: isFloating ? 'floating' : 'docked',
                panelId,
                id: dockedPanel.id,
            },
            x,
            y,
        );
        return;
    }

    // 3. Constellation HUD
    const hud = e.target.closest('#constellation-hud');
    if (hud) {
        e.preventDefault();
        const isCollapsed = hud.classList.contains('constellation-collapsed');
        const isFloating = constellationFloating;
        showPanelContextMenu(
            {
                type: isFloating ? 'constellation-floating' : isCollapsed ? 'constellation-collapsed' : 'constellation',
                id: 'constellation-hud',
            },
            x,
            y,
        );
        return;
    }

    // 4. Viz Settings bar
    const vizBar = e.target.closest('#viz-settings-bar');
    if (vizBar) {
        e.preventDefault();
        showPanelContextMenu({ type: 'viz-settings', id: 'viz-settings-bar' }, x, y);
        return;
    }

    // 5. Chat LLM
    const chatPanel = e.target.closest('.llm-chat-panel');
    if (chatPanel) {
        e.preventDefault();
        showPanelContextMenu({ type: 'chat', id: chatPanel.id || 'llm-chat-panel' }, x, y);
        return;
    }

    // 6. Floating panel (generica)
    const floating = e.target.closest('.panel-floating');
    if (floating) {
        e.preventDefault();
        const panelId = findPanelIdByElement(floating);
        showPanelContextMenu({ type: 'floating', panelId, id: floating.id }, x, y);
        return;
    }

    // 7. Modal resizable
    const modal = e.target.closest('.modal-resizable');
    if (modal) {
        e.preventDefault();
        showPanelContextMenu({ type: 'modal', id: modal.closest('.modal-overlay')?.id || '' }, x, y);
        return;
    }
}

/**
 * Find panel state ID from a DOM element.
 * @param {HTMLElement} el
 * @returns {string|undefined}
 */
function findPanelIdByElement(el) {
    for (const panel of panels.values()) {
        if (panel.el === el) return panel.id;
    }
    return undefined;
}

/**
 * Build and show the context menu based on context type.
 * @param {Object} ctx - Contexto: { type, id, panelId?, tabId? }
 * @param {number} x
 * @param {number} y
 */
function showPanelContextMenu(ctx, x, y) {
    if (!contextMenuEl) return;
    contextMenuCtx = ctx;

    const items = [];
    const sep = '<div class="panel-context-menu-sep"></div>';
    const ico = (name) => getIcon(name, { size: '14px' });

    switch (ctx.type) {
        case 'tab': {
            // Determinar posicao atual
            const tabBtn = document.querySelector(`.tab[data-tab="${ctx.tabId}"]`);
            const panel = tabBtn?.closest('#left-panel, #right-panel');
            const isLeft = panel?.id === 'left-panel';
            const isRight = panel?.id === 'right-panel';

            items.push(
                menuItem('dock-left', ico('dock-left'), t('dockLeft'), isLeft),
                menuItem('dock-right', ico('dock-right'), t('dockRight'), isRight),
                sep,
                menuItem('minimize', ico('minus'), t('minimizePanel')),
                menuItem('float', ico('external-link'), t('floatPanel')),
            );
            break;
        }
        case 'docked':
            items.push(
                menuItem('minimize', ico('minus'), t('minimizePanel')),
                menuItem('float', ico('external-link'), t('floatPanel')),
            );
            break;

        case 'floating':
            items.push(
                menuItem('dock', ico('dock-left'), t('dock') || 'Dock'),
                sep,
                menuItem('minimize', ico('minus'), t('minimizePanel')),
            );
            break;

        case 'constellation':
            items.push(
                menuItem('collapse', ico('chevron-down'), t('collapse')),
                menuItem('float-constellation', ico('external-link'), t('floatPanel')),
                sep,
                menuItem('hide', ico('eye-off'), t('hidePanel') || 'Hide'),
            );
            break;

        case 'constellation-collapsed':
            items.push(
                menuItem('expand', ico('chevron-up'), t('expandPanel') || 'Expand'),
                menuItem('float-constellation', ico('external-link'), t('floatPanel')),
                sep,
                menuItem('hide', ico('eye-off'), t('hidePanel') || 'Hide'),
            );
            break;

        case 'constellation-floating':
            items.push(
                menuItem('dock-constellation', ico('dock-left'), t('dock') || 'Dock'),
                sep,
                menuItem('hide', ico('eye-off'), t('hidePanel') || 'Hide'),
            );
            break;

        case 'viz-settings':
            items.push(menuItem('hide-viz', ico('eye-off'), t('hidePanel') || 'Hide'));
            break;

        case 'chat':
            items.push(
                menuItem('reset-size', ico('maximize'), t('resetSize') || 'Reset Size'),
                sep,
                menuItem('close-chat', ico('x'), t('close')),
            );
            break;

        case 'modal':
            items.push(
                menuItem('reset-size-modal', ico('maximize'), t('resetSize') || 'Reset Size'),
                sep,
                menuItem('close-modal', ico('x'), t('close')),
            );
            break;

        default:
            return;
    }

    contextMenuEl.innerHTML = items.join('');

    // Posicionar e mostrar
    contextMenuEl.style.left = `${x}px`;
    contextMenuEl.style.top = `${y}px`;
    contextMenuEl.classList.add('visible');

    // Ajustar se sair da tela
    requestAnimationFrame(() => {
        const rect = contextMenuEl.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            contextMenuEl.style.left = `${window.innerWidth - rect.width - 8}px`;
        }
        if (rect.bottom > window.innerHeight) {
            contextMenuEl.style.top = `${window.innerHeight - rect.height - 8}px`;
        }
    });
}

/**
 * Build a single menu item HTML string.
 * @param {string} action
 * @param {string} icon - HTML do icone
 * @param {string} label
 * @param {boolean} [active=false]
 * @returns {string}
 */
function menuItem(action, icon, label, active = false) {
    return `<button class="panel-context-menu-item${active ? ' active' : ''}" data-action="${action}">
        ${icon}<span>${label}</span>
    </button>`;
}

/**
 * Execute a context menu action.
 * @param {string} action
 * @param {Object} ctx - Contexto do menu
 */
function executeContextAction(action, ctx) {
    switch (action) {
        // Tab actions
        case 'dock-left':
            if (ctx.tabId) moveTab(ctx.tabId, 'left');
            break;
        case 'dock-right':
            if (ctx.tabId) moveTab(ctx.tabId, 'right');
            break;

        // Panel docked actions
        case 'minimize':
            if (ctx.panelId) minimizePanel(ctx.panelId);
            break;
        case 'float':
            if (ctx.panelId) floatPanel(ctx.panelId);
            break;

        // Floating panel actions
        case 'dock':
            if (ctx.panelId) {
                const panel = panels.get(ctx.panelId);
                if (panel) dockPanel(ctx.panelId, panel.dock);
            }
            break;

        // Constellation actions
        case 'collapse':
        case 'expand':
            if (window.toggleConstellationCollapse) window.toggleConstellationCollapse();
            break;
        case 'float-constellation':
            floatConstellation();
            break;
        case 'dock-constellation':
            dockConstellation();
            break;
        case 'hide':
            toggleConstellation();
            break;

        // Viz settings
        case 'hide-viz':
            if (window.handleToggleVizSettings) window.handleToggleVizSettings();
            break;

        // Chat LLM
        case 'reset-size': {
            const chat = document.querySelector('.llm-chat-panel');
            if (chat) {
                chat.style.removeProperty('width');
                chat.style.removeProperty('height');
                try {
                    localStorage.removeItem('ecbyts-chat-dims');
                } catch (_) {}
            }
            break;
        }
        case 'close-chat':
            if (window.toggleAIWidget) window.toggleAIWidget();
            break;

        // Modal
        case 'reset-size-modal': {
            const modal = ctx.id ? document.querySelector(`#${ctx.id} .modal`) : null;
            if (modal) {
                modal.style.removeProperty('width');
                modal.style.removeProperty('height');
            }
            break;
        }
        case 'close-modal':
            if (window.closeModal) window.closeModal();
            break;
    }
}

/**
 * Hide the context menu.
 */
function hideContextMenu() {
    if (contextMenuEl) {
        contextMenuEl.classList.remove('visible');
        contextMenuCtx = null;
    }
}
