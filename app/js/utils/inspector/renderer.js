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
   JSON INSPECTOR — Panel Renderer
   Renderizador do painel inspetor JSON.

   Cria o DOM do painel, gerencia visibilidade, resize,
   busca e chama o treeBuilder para montar a arvore.
   ================================================================ */

import { getIcon, hydrateIcons } from '../ui/icons.js';
import { t } from '../i18n/translations.js';
import { getInspectorConfig, setInspectorWidth, setSearchQuery, expandPathTo } from './manager.js';
import { buildInspectorTree } from './treeBuilder.js';
import { buildModel } from '../../core/io/export.js';
import { getSelectedElement, getAllElements } from '../../core/elements/manager.js';

let panel = null;
let _searchTimeout = null;

// ----------------------------------------------------------------
// INIT
// ----------------------------------------------------------------

/**
 * Create the inspector panel DOM and append to #main-area.
 * Cria o painel do inspetor e adiciona ao viewport principal.
 */
export function initInspectorPanel() {
    if (panel) return;

    panel = document.createElement('div');
    panel.id = 'inspector-panel';
    panel.className = 'inspector-panel';

    panel.innerHTML = buildPanelHTML();

    const mainArea = document.getElementById('main-area');
    if (mainArea) {
        mainArea.appendChild(panel);
    }

    setupResizeHandle();
    setupSearchInput();
    setupDelegatedEvents();

    // Apply initial visibility
    const config = getInspectorConfig();
    panel.style.width = config.width + 'px';
    if (config.visible) {
        requestAnimationFrame(() => panel.classList.add('visible'));
    }
}

/**
 * Build the panel's static HTML structure.
 * Monta estrutura HTML estatica do painel.
 */
function buildPanelHTML() {
    return `
        <div class="inspector-resize-handle"></div>
        <div class="inspector-header">
            <div class="inspector-title">
                <span class="inspector-title-icon">${getIcon('braces', { size: '14px' })}</span>
                <span data-i18n="inspector">Inspector</span>
            </div>
            <div class="inspector-header-actions">
                <input type="text" class="inspector-search" placeholder="${t('searchInspector') || 'Search...'}" spellcheck="false">
                <button class="inspector-hdr-btn" data-action="expand-all" title="${t('expandAll') || 'Expand All'}">
                    ${getIcon('chevrons-down', { size: '14px' })}
                </button>
                <button class="inspector-hdr-btn" data-action="collapse-all" title="${t('collapseAll') || 'Collapse All'}">
                    ${getIcon('chevrons-up', { size: '14px' })}
                </button>
                <button class="inspector-hdr-btn" data-action="close" title="Close (Ctrl+J)">
                    ${getIcon('x', { size: '14px' })}
                </button>
            </div>
        </div>
        <div class="inspector-breadcrumb" id="inspector-breadcrumb"></div>
        <div class="inspector-body" id="inspector-body"></div>
    `;
}

// ----------------------------------------------------------------
// RENDERING
// ----------------------------------------------------------------

/**
 * Render the inspector tree based on current selection.
 * Renderiza a arvore do inspetor conforme elemento selecionado.
 */
export function renderInspector() {
    if (!panel) return;

    const config = getInspectorConfig();

    // Update visibility
    if (config.visible) {
        panel.classList.add('visible');
    } else {
        panel.classList.remove('visible');
        return; // Don't render content if hidden
    }

    panel.style.width = config.width + 'px';

    const body = panel.querySelector('#inspector-body');
    if (!body) return;

    // Resolve selected element index for highlighting
    const selected = getSelectedElement();
    const allEls = getAllElements();
    let selectedPath = null;
    let selectedIdx = -1;
    if (selected) {
        selectedIdx = allEls.indexOf(selected);
        if (selectedIdx >= 0) {
            selectedPath = `model.elements.${selectedIdx}`;
            // Auto-expand ancestors so the selected element node is visible
            expandPathTo(selectedPath);
        }
    }

    // Always show the full model export JSON
    const model = buildModel();
    const elementIds = allEls.map((e) => e.id);
    const html = buildInspectorTree(model, 'model', selectedPath, elementIds);
    updateBreadcrumb(
        selected
            ? `model.elements.${selectedIdx} — ${selected.name || selected.id}`
            : 'model — ' + (model.project?.name || 'ecbyts'),
    );

    body.innerHTML = html;
    hydrateIcons(body);

    // Scroll to the selected element node
    if (selectedPath) {
        const selectedNode = body.querySelector('.inspector-node-selected');
        if (selectedNode) {
            selectedNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // Update toggle button state
    const btn = document.getElementById('toggle-inspector-btn');
    if (btn) btn.classList.toggle('active', config.visible);
}

/**
 * Update breadcrumb bar text.
 * Atualiza texto da barra de navegacao (breadcrumb).
 */
function updateBreadcrumb(text) {
    const bc = panel?.querySelector('#inspector-breadcrumb');
    if (bc) bc.textContent = text;
}

// ----------------------------------------------------------------
// VISIBILITY
// ----------------------------------------------------------------

/**
 * Set panel visibility with animation.
 * Define visibilidade do painel com animacao.
 */
export function setInspectorPanelVisible(visible) {
    if (!panel) return;
    if (visible) {
        panel.classList.add('visible');
        renderInspector();
    } else {
        panel.classList.remove('visible');
    }
}

// ----------------------------------------------------------------
// RESIZE HANDLE
// ----------------------------------------------------------------

function setupResizeHandle() {
    const handle = panel.querySelector('.inspector-resize-handle');
    if (!handle) return;

    let startX, startWidth;

    function onMouseDown(e) {
        e.preventDefault();
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    }

    function onMouseMove(e) {
        // Dragging left edge: moving left increases width
        const delta = startX - e.clientX;
        const newWidth = Math.max(280, Math.min(600, startWidth + delta));
        panel.style.width = newWidth + 'px';
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setInspectorWidth(panel.offsetWidth);
    }

    handle.addEventListener('mousedown', onMouseDown);
}

// ----------------------------------------------------------------
// SEARCH INPUT
// ----------------------------------------------------------------

function setupSearchInput() {
    const input = panel.querySelector('.inspector-search');
    if (!input) return;

    input.addEventListener('input', () => {
        clearTimeout(_searchTimeout);
        _searchTimeout = setTimeout(() => {
            setSearchQuery(input.value);
            renderInspector();
            // Restore focus and cursor position
            input.focus();
        }, 250);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            input.value = '';
            setSearchQuery('');
            renderInspector();
            input.focus();
        }
        e.stopPropagation(); // Prevent global shortcuts while typing
    });
}

// ----------------------------------------------------------------
// DELEGATED EVENTS
// ----------------------------------------------------------------

function setupDelegatedEvents() {
    // Click delegation on the body for toggle, edit, copy, etc.
    panel.addEventListener('click', (e) => {
        // Toggle node expand/collapse
        const toggle = e.target.closest('.inspector-toggle');
        if (toggle) {
            const path = toggle.dataset.path;
            if (path) window.handleToggleNode?.(path);
            return;
        }

        // Header action buttons
        const hdrBtn = e.target.closest('.inspector-hdr-btn');
        if (hdrBtn) {
            const action = hdrBtn.dataset.action;
            if (action === 'expand-all') window.handleExpandAllNodes?.();
            else if (action === 'collapse-all') window.handleCollapseAllNodes?.();
            else if (action === 'close') window.handleToggleInspector?.();
            return;
        }

        // Don't trigger selection while editing an inline input
        if (e.target.tagName === 'INPUT') return;

        // Click on element node → select in 3D viewport
        const node = e.target.closest('.inspector-node[data-element-id]');
        if (node) {
            const elementId = node.dataset.elementId;
            if (elementId) {
                window.handleSelectElement?.(elementId);
            }
        }
    });

    // Double-click to start editing
    panel.addEventListener('dblclick', (e) => {
        const valueSpan = e.target.closest('.inspector-value[data-editable="true"]');
        if (valueSpan) {
            const path = valueSpan.dataset.path;
            if (path) window.handleStartEdit?.(path);
        }
    });

    // Right-click context menu for add/delete
    panel.addEventListener('contextmenu', (e) => {
        const node = e.target.closest('.inspector-node');
        if (node) {
            e.preventDefault();
            const path = node.dataset.path;
            const type = node.dataset.type;
            if (path) window.handleInspectorContextMenu?.(e, path, type);
        }
    });

    // Breadcrumb click to copy path
    const bc = panel.querySelector('#inspector-breadcrumb');
    if (bc) {
        bc.addEventListener('click', () => {
            window.handleCopyPath?.('model');
        });
    }

    // Prevent global keyboard shortcuts when editing inside inspector
    panel.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            e.stopPropagation();
        }
    });
}
