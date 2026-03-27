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
   REPORT EDITOR — Contenteditable rich-text editor with scene anchors
   Editor de texto rico com ancoras de cena para relatorios ambientais

   Renderiza toolbar (negrito, italico, titulo, listas, HR, blockquote)
   + area contenteditable. Suporta reparent entre containers
   (constellation HUD ↔ overlay full-screen).

   Ancoras de cena sao chips inline que, ao clicar, animam a camera.
   IntersectionObserver dispara transicoes de camera ao scrollar.
   ================================================================ */

import { getReport, setReportContent } from './manager.js';
import { getAllScenes, getSceneById } from '../scenes/manager.js';
import { animateCameraState } from '../scene/controls.js';
import { t } from '../i18n/translations.js';
import { showToast } from '../ui/toast.js';

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

let editorDiv = null;
let toolbarEl = null;
let resizeHandleEl = null;
let pickerEl = null;
let debounceTimer = null;
let anchorObserver = null;
let lastTriggeredScene = null;
let lastTriggerTime = 0;
let _readOnly = false;
let tooltipEl = null;
const thumbnailCache = new Map();
let metricPickerEl = null;

// ----------------------------------------------------------------
// METRIC ANCHOR TYPES — icons como HTML entities (sem emojis)
// ----------------------------------------------------------------

const METRIC_TYPES = [
    { id: 'projectSummary', icon: '&#9632;', labelKey: 'exportSectionProjectSummary', fallback: 'Project Summary' },
    { id: 'eis', icon: '&#9670;', labelKey: 'exportSectionEIS', fallback: 'EIS Integrity Score' },
    { id: 'costSummary', icon: '&#9733;', labelKey: 'exportSectionCost', fallback: 'Cost Summary' },
    { id: 'compliance', icon: '&#9650;', labelKey: 'exportSectionCompliance', fallback: 'Compliance' },
    { id: 'eva', icon: '&#9654;', labelKey: 'exportSectionEVA', fallback: 'EVA Analysis' },
    {
        id: 'elementInventory',
        icon: '&#9679;',
        labelKey: 'exportSectionElementInventory',
        fallback: 'Element Inventory',
    },
    { id: 'campaignSummary', icon: '&#9643;', labelKey: 'exportSectionCampaignSummary', fallback: 'Campaign Summary' },
    { id: 'calculator', icon: '&#9881;', labelKey: 'exportSectionCalculator', fallback: 'Calculator Metrics' },
    {
        id: 'complianceMatrix',
        icon: '&#9638;',
        labelKey: 'exportSectionComplianceMatrix',
        fallback: 'Compliance Matrix',
    },
];

// ----------------------------------------------------------------
// INITIALIZATION
// Cria toolbar + contenteditable dentro do container fornecido
// ----------------------------------------------------------------

/**
 * Initialize report editor inside the given container element.
 * Monta toolbar e area editavel, carrega conteudo salvo.
 *
 * @param {HTMLElement} container - #report-editor-container
 */
export function initReportEditor(container) {
    if (!container) return;

    // Evita dupla inicializacao
    if (editorDiv) return;

    // Resize handle (topo do HUD expandido)
    resizeHandleEl = document.createElement('div');
    resizeHandleEl.className = 'report-resize-handle';
    _setupResizeHandle(resizeHandleEl);
    container.appendChild(resizeHandleEl);

    // Toolbar
    toolbarEl = _buildToolbar();
    container.appendChild(toolbarEl);

    // Contenteditable
    editorDiv = document.createElement('div');
    editorDiv.id = 'report-editor-content';
    editorDiv.className = 'report-editor-content';
    editorDiv.contentEditable = 'true';
    editorDiv.setAttribute('data-placeholder', t('reportPlaceholder'));
    container.appendChild(editorDiv);

    // Carrega conteudo salvo
    const report = getReport();
    if (report.content) {
        editorDiv.innerHTML = report.content;
    }

    // Paste: forca plain text para prevenir XSS via clipboard
    editorDiv.addEventListener('paste', _onPastePlainText);

    // Sync de conteudo com debounce (salva a cada 500ms)
    editorDiv.addEventListener('input', _onEditorInput);

    // Click em ancoras de cena
    editorDiv.addEventListener('click', _onEditorClick);

    // Hover para thumbnail em scene anchors
    editorDiv.addEventListener('mouseover', _onAnchorHover);
    editorDiv.addEventListener('mouseout', _onAnchorLeave);

    // IntersectionObserver para transicoes ao scrollar
    _setupScrollObserver();

    // Marca ancoras orfas (cenas excluidas)
    _refreshOrphanAnchors();
}

/**
 * Sync editor content from manager state (after import).
 * Atualiza conteudo do editor a partir do estado do manager.
 */
export function updateReportEditor() {
    if (!editorDiv) return;
    const report = getReport();
    editorDiv.innerHTML = report.content || '';
    _refreshOrphanAnchors();
    _setupScrollObserver();
}

/**
 * Switch editor to the currently active report.
 * Flush debounce pendente, carrega conteudo do novo relatorio ativo.
 * Chamado pelo handler ao trocar de relatorio na tree view.
 */
export function switchEditorReport() {
    // Flush pending debounce
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    // Reload content from new active report
    updateReportEditor();
}

// ----------------------------------------------------------------
// REPARENT — Move editor entre containers (constellation ↔ overlay)
// ----------------------------------------------------------------

/**
 * Get the editor contenteditable element.
 * @returns {HTMLElement|null}
 */
export function getEditorElement() {
    return editorDiv;
}

/**
 * Reparent editor DOM (resize handle + toolbar + contenteditable)
 * to a different container. Reinicia observers apos mover.
 *
 * @param {HTMLElement} targetContainer - Novo container pai
 */
export function reparentEditor(targetContainer) {
    if (!editorDiv || !targetContainer) return;

    // Move na ordem: resize handle, toolbar, editor
    if (resizeHandleEl) targetContainer.appendChild(resizeHandleEl);
    if (toolbarEl) targetContainer.appendChild(toolbarEl);
    targetContainer.appendChild(editorDiv);

    // Reinicia IntersectionObserver (root muda com o container)
    _setupScrollObserver();
    _refreshOrphanAnchors();
}

// ----------------------------------------------------------------
// READ-ONLY MODE
// ----------------------------------------------------------------

/**
 * Toggle read-only mode.
 * @param {boolean} readonly
 */
export function setReadOnly(readonly) {
    _readOnly = !!readonly;
    if (editorDiv) {
        editorDiv.contentEditable = _readOnly ? 'false' : 'true';
    }
}

/**
 * Check if editor is in read-only mode.
 * @returns {boolean}
 */
export function isReadOnly() {
    return _readOnly;
}

// ----------------------------------------------------------------
// SCROLL / INSERT / ANCHOR
// ----------------------------------------------------------------

/**
 * Scroll the editor to the anchor matching the given scene ID.
 * Rola o editor ate a ancora da cena especificada (sync bidirecional).
 *
 * @param {string} sceneId
 */
export function scrollToAnchor(sceneId) {
    if (!editorDiv) return;
    const anchor = editorDiv.querySelector(`.report-scene-anchor[data-scene-id="${sceneId}"]`);
    if (anchor) {
        anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Flash effect
        anchor.classList.add('report-scene-anchor--active');
        setTimeout(() => anchor.classList.remove('report-scene-anchor--active'), 1500);
    }
}

/**
 * Insert a scene anchor at the current cursor position.
 * Insere chip de ancora de cena na posicao do cursor.
 *
 * @param {string} sceneId
 */
export function insertSceneAnchor(sceneId) {
    if (!editorDiv || _readOnly) return;
    const scene = getSceneById(sceneId);
    if (!scene) return;

    // Foca o editor se necessario
    editorDiv.focus();

    const anchorHtml = `<span class="report-scene-anchor" data-scene-id="${sceneId}" contenteditable="false">&#9654; [Scene: ${_escapeHtml(scene.name)}]</span>&nbsp;`;

    // Usa insertHTML para inserir na posicao do cursor
    document.execCommand('insertHTML', false, anchorHtml);

    // Salva
    clearTimeout(debounceTimer);
    setReportContent(editorDiv.innerHTML);

    // Re-observa as ancoras
    _setupScrollObserver();
}

/**
 * Insert a metric anchor at the current cursor position.
 * Insere chip de ancora de metrica na posicao do cursor.
 * Se filterPresetId fornecido, vincula o filtro a ancora.
 *
 * @param {string} metricType - One of METRIC_TYPES[].id
 * @param {string} [filterPresetId] - Optional filter preset ID
 */
export function insertMetricAnchor(metricType, filterPresetId) {
    if (!editorDiv || _readOnly) return;
    const def = METRIC_TYPES.find((m) => m.id === metricType);
    if (!def) return;

    editorDiv.focus();

    const label = t(def.labelKey) || def.fallback;
    const filterAttr = filterPresetId ? ` data-filter-preset="${filterPresetId}"` : '';
    const anchorHtml = `<span class="report-metric-anchor" data-metric-type="${metricType}"${filterAttr} contenteditable="false">${def.icon} [${_escapeHtml(label)}]</span>&nbsp;`;

    document.execCommand('insertHTML', false, anchorHtml);

    clearTimeout(debounceTimer);
    setReportContent(editorDiv.innerHTML);
}

// ----------------------------------------------------------------
// EVENT HANDLERS
// ----------------------------------------------------------------

/** @private */
function _onEditorInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if (editorDiv) setReportContent(editorDiv.innerHTML);
    }, 500);
}

/**
 * Paste handler: force plain text to prevent XSS via clipboard.
 * Intercepta paste de HTML e insere apenas o texto plano.
 * @param {ClipboardEvent} e
 */
function _onPastePlainText(e) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain');
    if (text) document.execCommand('insertText', false, text);
}

/** @private */
function _onEditorClick(e) {
    const anchor = e.target.closest('.report-scene-anchor');
    if (anchor) {
        e.preventDefault();
        const sceneId = anchor.dataset.sceneId;
        if (sceneId) window.handleReportAnchorClick(sceneId);
    }
}

// ----------------------------------------------------------------
// SCENE ANCHOR THUMBNAIL — Hover tooltip com preview da camera
// ----------------------------------------------------------------

/** @private */
function _onAnchorHover(e) {
    const anchor = e.target.closest('.report-scene-anchor');
    if (!anchor) return;

    const sceneId = anchor.dataset?.sceneId;
    if (!sceneId) return;

    const scene = getSceneById(sceneId);
    if (!scene?.viewStart) return;

    // Cria tooltip se necessario
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'report-scene-tooltip';
        document.body.appendChild(tooltipEl);
    }

    // Verifica cache de thumbnail
    const cached = thumbnailCache.get(sceneId);
    if (cached) {
        _showTooltip(anchor, scene.name, cached);
    } else {
        // Gera thumbnail async (import dinamico para evitar dep circular)
        _generateThumbnail(sceneId, scene).then((dataUrl) => {
            if (dataUrl) _showTooltip(anchor, scene.name, dataUrl);
        });
    }
}

/** @private */
function _onAnchorLeave(e) {
    const anchor = e.target.closest('.report-scene-anchor');
    if (!anchor && tooltipEl) {
        tooltipEl.classList.remove('visible');
    }
}

/** @private */
function _showTooltip(anchorEl, sceneName, imgDataUrl) {
    if (!tooltipEl) return;

    tooltipEl.innerHTML = `
        <img src="${imgDataUrl}" alt="${_escapeHtml(sceneName)}">
        <div class="report-scene-tooltip-label">${_escapeHtml(sceneName)}</div>
    `;

    // Posiciona acima do anchor
    const rect = anchorEl.getBoundingClientRect();
    tooltipEl.style.left = `${rect.left}px`;
    tooltipEl.style.top = `${rect.top - 160}px`;

    // Ajusta se sair da tela
    requestAnimationFrame(() => {
        const tr = tooltipEl.getBoundingClientRect();
        if (tr.top < 0) tooltipEl.style.top = `${rect.bottom + 8}px`;
        if (tr.right > window.innerWidth) tooltipEl.style.left = `${window.innerWidth - tr.width - 8}px`;
    });

    tooltipEl.classList.add('visible');
}

/** @private */
async function _generateThumbnail(sceneId, scene) {
    try {
        const { captureSceneScreenshot } = await import('./pdfExport.js');
        const dataUrl = captureSceneScreenshot(scene.viewStart);
        if (dataUrl) thumbnailCache.set(sceneId, dataUrl);
        return dataUrl;
    } catch {
        return null;
    }
}

// ----------------------------------------------------------------
// TOOLBAR
// Barra de ferramentas: B, I, H1-3, listas, HR, blockquote, cenas, PDF
// ----------------------------------------------------------------

/** @private */
function _buildToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'report-editor-toolbar';

    // Formatting buttons
    const fmtButtons = [
        { cmd: 'bold', label: 'B', title: t('reportBold'), style: 'font-weight:700' },
        { cmd: 'italic', label: 'I', title: t('reportItalic'), style: 'font-style:italic' },
        { cmd: 'formatBlock:h1', label: 'H1', title: t('reportHeading') + ' 1' },
        { cmd: 'formatBlock:h2', label: 'H2', title: t('reportHeading') + ' 2' },
        { cmd: 'formatBlock:h3', label: 'H3', title: t('reportHeading') + ' 3' },
        { cmd: 'insertUnorderedList', label: '•', title: t('reportBulletList') },
        { cmd: 'insertOrderedList', label: '1.', title: t('reportNumberedList') },
        { cmd: 'formatBlock:blockquote', label: '❝', title: t('reportBlockquote') || 'Citacao' },
        { cmd: 'insertHorizontalRule', label: '—', title: t('reportHorizontalRule') || 'Linha horizontal' },
    ];

    fmtButtons.forEach((btn) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'report-toolbar-btn';
        el.title = btn.title;
        el.innerHTML = `<span style="${btn.style || ''}">${btn.label}</span>`;
        el.addEventListener('click', (e) => {
            e.preventDefault();
            if (_readOnly) return;
            if (btn.cmd.startsWith('formatBlock:')) {
                document.execCommand('formatBlock', false, btn.cmd.split(':')[1]);
            } else {
                document.execCommand(btn.cmd, false, null);
            }
            editorDiv?.focus();
        });
        toolbar.appendChild(el);
    });

    // Separator
    const sep1 = document.createElement('div');
    sep1.className = 'report-toolbar-separator';
    toolbar.appendChild(sep1);

    // Insert Scene button
    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'report-toolbar-btn';
    insertBtn.title = t('insertScene');
    insertBtn.innerHTML = `<span style="font-size:10px">&#9654;</span> ${t('insertScene')}`;
    insertBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _toggleScenePicker(insertBtn);
    });
    toolbar.appendChild(insertBtn);

    // Insert Metric button
    const insertMetricBtn = document.createElement('button');
    insertMetricBtn.type = 'button';
    insertMetricBtn.className = 'report-toolbar-btn';
    insertMetricBtn.title = t('insertMetric') || 'Metric';
    insertMetricBtn.innerHTML = `<span style="font-size:10px">&#9638;</span> ${t('insertMetric') || 'Metric'}`;
    insertMetricBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _toggleMetricPicker(insertMetricBtn);
    });
    toolbar.appendChild(insertMetricBtn);

    // Separator
    const sep2 = document.createElement('div');
    sep2.className = 'report-toolbar-separator';
    toolbar.appendChild(sep2);

    // Export button (opens format/section picker)
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'report-toolbar-btn';
    exportBtn.title = t('exportReport') || 'Export';
    exportBtn.textContent = t('exportReport') || 'Export';
    exportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.handleExportReport();
    });
    toolbar.appendChild(exportBtn);

    return toolbar;
}

// ----------------------------------------------------------------
// SCENE PICKER
// Dropdown para selecionar cena a inserir como ancora
// ----------------------------------------------------------------

/** @private */
function _toggleScenePicker(anchorBtn) {
    // Fecha picker existente
    if (pickerEl) {
        pickerEl.remove();
        pickerEl = null;
        return;
    }

    const scenes = getAllScenes();
    pickerEl = document.createElement('div');
    pickerEl.className = 'report-scene-picker';

    if (scenes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'report-scene-picker-empty';
        empty.textContent = t('noScenesForAnchor');
        pickerEl.appendChild(empty);
    } else {
        scenes.forEach((scene) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'report-scene-picker-item';
            item.textContent = scene.name || scene.id;
            item.addEventListener('click', () => {
                insertSceneAnchor(scene.id);
                pickerEl.remove();
                pickerEl = null;
            });
            pickerEl.appendChild(item);
        });
    }

    // Posiciona abaixo do botao
    const rect = anchorBtn.getBoundingClientRect();
    pickerEl.style.position = 'fixed';
    pickerEl.style.left = `${rect.left}px`;
    pickerEl.style.bottom = `${window.innerHeight - rect.top + 4}px`;

    document.body.appendChild(pickerEl);

    // Fecha ao clicar fora
    const closeHandler = (e) => {
        if (pickerEl && !pickerEl.contains(e.target) && !anchorBtn.contains(e.target)) {
            pickerEl.remove();
            pickerEl = null;
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

// ----------------------------------------------------------------
// METRIC PICKER
// Dropdown para selecionar metrica a inserir como ancora
// ----------------------------------------------------------------

/** @private */
function _toggleMetricPicker(anchorBtn) {
    if (metricPickerEl) {
        metricPickerEl.remove();
        metricPickerEl = null;
        return;
    }

    metricPickerEl = document.createElement('div');
    metricPickerEl.className = 'report-metric-picker';

    METRIC_TYPES.forEach((metric) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'report-metric-picker-item';
        item.innerHTML = `<span class="report-metric-picker-icon">${metric.icon}</span> ${t(metric.labelKey) || metric.fallback}`;
        item.addEventListener('click', () => {
            insertMetricAnchor(metric.id);
            metricPickerEl.remove();
            metricPickerEl = null;
        });
        metricPickerEl.appendChild(item);
    });

    // Posiciona acima do botao
    const rect = anchorBtn.getBoundingClientRect();
    metricPickerEl.style.position = 'fixed';
    metricPickerEl.style.left = `${rect.left}px`;
    metricPickerEl.style.bottom = `${window.innerHeight - rect.top + 4}px`;

    document.body.appendChild(metricPickerEl);

    // Fecha ao clicar fora
    const closeHandler = (e) => {
        if (metricPickerEl && !metricPickerEl.contains(e.target) && !anchorBtn.contains(e.target)) {
            metricPickerEl.remove();
            metricPickerEl = null;
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

// ----------------------------------------------------------------
// SCROLL-TRIGGERED TRANSITIONS
// IntersectionObserver para transicoes de camera ao scrollar
// ----------------------------------------------------------------

/** @private */
function _setupScrollObserver() {
    // Limpa observer anterior
    if (anchorObserver) anchorObserver.disconnect();
    if (!editorDiv) return;

    // Encontra o scroll container real (pode ser o editor, o container pai, ou o document)
    const scrollRoot = _findScrollParent(editorDiv);

    anchorObserver = new IntersectionObserver(
        (entries) => {
            // Nao dispara durante digitacao ativa (selecao expandida = texto sendo escrito)
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && editorDiv.contains(sel.anchorNode)) return;

            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const sceneId = entry.target.dataset?.sceneId;
                    if (!sceneId) continue;

                    // Debounce: nao re-dispara para mesma cena em 2s
                    const now = Date.now();
                    if (sceneId === lastTriggeredScene && now - lastTriggerTime < 2000) continue;

                    lastTriggeredScene = sceneId;
                    lastTriggerTime = now;

                    const scene = getSceneById(sceneId);
                    if (scene?.viewStart) {
                        animateCameraState(scene.viewStart, 600);
                    }
                    break; // Apenas uma transicao por vez
                }
            }
        },
        {
            root: scrollRoot,
            threshold: 0.3, // Threshold menor — ancora menor precisa de menos visibilidade
            rootMargin: '0px 0px -30% 0px', // Dispara quando ancora entra na metade superior
        },
    );

    // Observa todas as ancoras
    const anchors = editorDiv.querySelectorAll('.report-scene-anchor');
    anchors.forEach((a) => anchorObserver.observe(a));
}

/**
 * Find the nearest scrollable ancestor of an element.
 * @param {HTMLElement} el
 * @returns {HTMLElement|null} Scroll container or null for viewport
 * @private
 */
function _findScrollParent(el) {
    let parent = el.parentElement;
    while (parent) {
        const ovf = getComputedStyle(parent).overflowY;
        if (ovf === 'auto' || ovf === 'scroll') return parent;
        parent = parent.parentElement;
    }
    return null; // null = viewport (padrao do IntersectionObserver)
}

// ----------------------------------------------------------------
// ORPHAN ANCHORS
// Marca ancoras cujas cenas foram excluidas
// ----------------------------------------------------------------

/** @private */
function _refreshOrphanAnchors() {
    if (!editorDiv) return;
    const anchors = editorDiv.querySelectorAll('.report-scene-anchor');
    anchors.forEach((a) => {
        const sceneId = a.dataset.sceneId;
        const scene = getSceneById(sceneId);
        if (!scene) {
            a.classList.add('report-scene-anchor--orphan');
            a.textContent = `▶ [Scene: ${t('sceneDeleted')}]`;
        } else {
            a.classList.remove('report-scene-anchor--orphan');
        }
    });
}

// ----------------------------------------------------------------
// RESIZE HANDLE
// Permite redimensionar o HUD arrastando o topo
// ----------------------------------------------------------------

/** @private */
function _setupResizeHandle(handle) {
    let startY = 0;
    let startHeight = 0;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const hud = document.getElementById('constellation-hud');
        if (!hud) return;

        startY = e.clientY;
        startHeight = hud.offsetHeight;

        const onMove = (me) => {
            const delta = startY - me.clientY;
            const newHeight = Math.max(160, Math.min(window.innerHeight * 0.85, startHeight + delta));
            hud.style.height = `${newHeight}px`;
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
// HELPERS
// ----------------------------------------------------------------

/** @private */
function _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
