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
   CONSTELLATION — Element relationship graph visualization
   ================================================================

   Visualizacao interativa de relacoes entre elementos no viewport 3D.
   Inspirada na arvore de habilidades do Skyrim (constelacao).

   Barra fixa na parte inferior do viewport 3D mostrando:
   - Elemento selecionado como no central
   - Elementos conectados (edges) como nos satelite clicaveis
   - Observacoes como pontos ao redor do centro (clicaveis para editar)
   - Linhas de conexao coloridas por categoria de edge

   Renderizacao ESTATICA (sem requestAnimationFrame).
   Overlays HTML para edicao de observacoes.
   ================================================================ */

import { getElementById, getSelectedElement, getAllElements } from '../../core/elements/manager.js';
import { getConnectedEdges } from '../edges/manager.js';
import { EDGE_CATEGORIES, getEdgeType } from '../edges/types.js';
import { CONFIG } from '../../config.js';
import { getAllCampaigns } from '../../core/campaigns/manager.js';
import { hydrateIcons } from '../ui/icons.js';
import {
    updatePDPLUTable,
    exportPDPLUCSV,
    switchConstellationTab as _switchTab,
    getActiveConstellationTab,
} from './constellationTable.js';
import { isConstellationVisible } from '../ui/panelManager.js';
import { safeSetItem } from '../storage/storageMonitor.js';

// --- Module state ---
let canvas = null;
let ctx = null;
let currentNodes = [];
let currentLines = [];
let _onSelect = null;
let _selectedId = null;
let hoveredNodeId = null;
let activeEditIndex = null; // index of observation being edited
let activeObsList = false; // whether obs list popover is open
let canvasW = 800;
let canvasH = 120;
let _resizeObserver = null; // ECBT05: Cleanup reference

// Node sizes
const CENTER_RADIUS = 22;
const SATELLITE_RADIUS = 14;
const OBS_RADIUS = 4;

// Theme colors — read from CSS variables, updated before each draw
let _theme = {};
function _updateThemeColors() {
    const s = getComputedStyle(document.documentElement);
    const get = (v) => s.getPropertyValue(v).trim();
    _theme = {
        text: get('--bottom-text') || 'rgba(255,255,255,0.75)',
        textMuted: get('--bottom-text-muted') || 'rgba(255,255,255,0.5)',
        textFaint: get('--bottom-text-faint') || 'rgba(255,255,255,0.25)',
        bgSolid: get('--bottom-bg-solid') || 'rgba(10,14,20,0.75)',
        hover: get('--bottom-hover') || 'rgba(255,255,255,0.08)',
    };
}

// Colors by element family
const FAMILY_COLORS = {
    well: '#4FC3F7',
    plume: '#FF7043',
    lake: '#29B6F6',
    river: '#26C6DA',
    spring: '#66BB6A',
    building: '#9E9E9E',
    tank: '#FFA726',
    waste: '#EF5350',
    boundary: '#78909C',
    sensor: '#00BCD4',
    area: '#81C784',
    individual: '#CE93D8',
    incident: '#FF8A65',
    emission_source: '#A1887F',
    waste_stream: '#80CBC4',
    effluent_point: '#90CAF9',
    habitat: '#AED581',
    sample: '#AB47BC',
    marker: '#EF5350',
    stratum: '#8D6E63',
    intangible: '#BA68C8',
    generic: '#B0BEC5',
    default: '#90A4AE',
};

// Family icons (unicode symbols for quick rendering)
const FAMILY_ICONS = {
    well: '\u25CE',
    plume: '\u2601',
    lake: '\u223F',
    river: '\u2248',
    spring: '\u2734',
    building: '\u25A3',
    tank: '\u25CB',
    waste: '\u26A0',
    boundary: '\u25A1',
    sensor: '\u25C8',
    area: '\u25A2',
    individual: '\u263A',
    stratum: '\u2261',
    intangible: '\u2666',
    generic: '\u25CF',
    default: '\u25CF',
};

// Edge direction descriptors where the SOURCE entity is the "upstream" role.
// Used to position neighbors: upstream (RIGHT) vs downstream (LEFT).
const SOURCE_UPSTREAM_DIRS = new Set([
    'parent_to_child', // contains: parent is upstream
    'monitor_to_target', // monitors: monitor is upstream
    'source_to_affected', // impacts: source is upstream
    'cause_to_effect', // causes: cause is upstream
    'action_to_impact', // mitigates: action is upstream
    'upstream_to_downstream', // upstream_of: source is upstream
    'individual_to_asset', // responsible_for: authority is upstream
    'incident_to_location', // occurred_in: event is upstream
    'individual_to_incident', // involved_in: agent is upstream
    'individual_to_habitat', // inhabits: agent is upstream
    'individual_to_location', // observed_at: agent is upstream
]);

/**
 * Initialize the constellation canvas.
 * @param {Object} options
 * @param {Function} options.onSelect - Callback(elementId) when node clicked
 */
export function initConstellation(options = {}) {
    canvas = document.getElementById('constellation-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    _onSelect = options.onSelect || null;

    // Stop events from reaching the Three.js picker underneath
    canvas.addEventListener('click', handleCanvasClick, true);
    canvas.addEventListener('mousedown', stopEvent, true);
    canvas.addEventListener('mouseup', stopEvent, true);
    canvas.addEventListener('mousemove', handleCanvasHover);

    // Sync canvas drawing buffer to CSS display size via ResizeObserver
    // Observa o container pai — mais estavel que observar o canvas diretamente
    const viewContainer = canvas.parentElement;
    _resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            if (width > 50 && height > 20) {
                canvasW = Math.round(width);
                canvasH = Math.round(height);
                canvas.width = canvasW;
                canvas.height = canvasH;
                drawStatic();
            }
        }
    });
    if (viewContainer) _resizeObserver.observe(viewContainer);

    // Hydrate tab icons (data-icon spans in static HTML)
    const tabsBar = document.getElementById('constellation-tabs');
    if (tabsBar) {
        hydrateIcons(tabsBar);

        // Restaurar tab salva e ativar keyboard navigation
        const savedTab = getActiveConstellationTab();
        if (savedTab && savedTab !== 'graph') {
            // Defer para apos o init completo — a tab sera ativada via window.switchConstellationTab
            requestAnimationFrame(() => {
                if (window.switchConstellationTab) window.switchConstellationTab(savedTab);
            });
        }

        // Keyboard navigation: ArrowLeft/Right para navegar tabs, Enter/Space para ativar
        tabsBar.setAttribute('role', 'tablist');
        const tabButtons = tabsBar.querySelectorAll('.constellation-tab[data-ctab]');
        tabButtons.forEach((btn, i) => {
            btn.setAttribute('role', 'tab');
            btn.setAttribute('tabindex', btn.classList.contains('active') ? '0' : '-1');
            btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
        });

        tabsBar.addEventListener('keydown', (e) => {
            const tabs = [...tabsBar.querySelectorAll('.constellation-tab[data-ctab]')];
            const current = tabs.findIndex((t) => t === document.activeElement);
            if (current === -1) return;

            let next = -1;
            if (e.key === 'ArrowRight') next = (current + 1) % tabs.length;
            else if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
            else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                tabs[current].click();
                return;
            } else if (e.key === 'Escape') {
                if (window.toggleConstellationCollapse) window.toggleConstellationCollapse();
                return;
            } else return;

            e.preventDefault();
            tabs.forEach((t) => {
                t.setAttribute('tabindex', '-1');
                t.setAttribute('aria-selected', 'false');
            });
            tabs[next].setAttribute('tabindex', '0');
            tabs[next].setAttribute('aria-selected', 'true');
            tabs[next].focus();
        });
    }

    // Register window helpers for HTML overlay callbacks
    // Tab switching and PDPLU export handlers
    window.switchConstellationTab = (tabId) => {
        _switchTab(tabId);
        if (tabId === 'pdplu') {
            updatePDPLUTable(getSelectedElement());
        }
        if (tabId === 'report') {
            // Lazy-load report list (tree view) no painel inferior
            import('../report/reportList.js').then((m) => {
                const container = document.getElementById('report-editor-container');
                if (container && !container.dataset.listInitialized) {
                    m.initReportList(container);
                    container.dataset.listInitialized = 'true';
                } else {
                    m.updateReportList();
                }
                // Abre overlay em split-screen (3D + report) automaticamente
                window.handleToggleReportSplit?.();
            });
        }
        if (tabId === 'storyboard') {
            // Lazy-load sequencer e inicializa se necessario
            import('../../core/sequencer/manager.js')
                .then((mgr) => {
                    mgr.initSequencer();
                    import('../../core/sequencer/renderer.js')
                        .then((r) => {
                            r.initStoryboardUI();
                        })
                        .catch(() => {});
                })
                .catch(() => {});
        }
    };
    window.handleExportPDPLU = () => {
        const el = getSelectedElement();
        if (el) exportPDPLUCSV(el);
    };

    // Collapse/expand constellation HUD
    // Gerencia --bottom-panel-height ao colapsar para evitar bug do flex auto-height
    const _COLLAPSED_HEIGHT = '28px';
    window.toggleConstellationCollapse = () => {
        const hud = document.getElementById('constellation-hud');
        if (!hud) return;
        const mainArea = document.getElementById('main-area');
        const isCollapsing = !hud.classList.contains('constellation-collapsed');

        if (isCollapsing) {
            // Salvar altura atual antes de colapsar
            const currentH = getComputedStyle(mainArea).getPropertyValue('--bottom-panel-height').trim();
            if (currentH && currentH !== _COLLAPSED_HEIGHT) {
                try {
                    localStorage.setItem('ecbyts-constellation-height', parseInt(currentH, 10).toString());
                } catch (_) {}
            }
            mainArea.style.setProperty('--bottom-panel-height', _COLLAPSED_HEIGHT);
        } else {
            // Restaurar altura salva ao expandir
            const savedH = localStorage.getItem('ecbyts-constellation-height');
            const h = savedH ? parseInt(savedH, 10) : 120;
            mainArea.style.setProperty('--bottom-panel-height', (isNaN(h) ? 120 : h) + 'px');
        }

        hud.classList.toggle('constellation-collapsed');
        safeSetItem('ecbyts-constellation-collapsed', isCollapsing ? '1' : '');
    };

    // Click on tab bar when collapsed => expand
    const tabsBarEl = document.getElementById('constellation-tabs');
    const hudEl = document.getElementById('constellation-hud');
    if (tabsBarEl) {
        tabsBarEl.addEventListener('click', (e) => {
            if (!hudEl?.classList.contains('constellation-collapsed')) return;
            e.stopPropagation();
            window.toggleConstellationCollapse();
        });
    }

    // Restore collapsed state from localStorage
    if (localStorage.getItem('ecbyts-constellation-collapsed') === '1') {
        hudEl?.classList.add('constellation-collapsed');
        const mainArea = document.getElementById('main-area');
        if (mainArea) mainArea.style.setProperty('--bottom-panel-height', _COLLAPSED_HEIGHT);
    }

    window._constellationCloseEdit = () => hideObsEditCard();
    window._constellationCloseList = () => hideObsList();
    window._constellationEditObs = (obsIndex) => {
        hideObsList();
        const obsNode = currentNodes.find((n) => n.id === `obs-${obsIndex}`);
        showObsEditCard(obsIndex, obsNode ? obsNode.x : canvasW / 2, obsNode ? obsNode.y : canvasH / 2);
    };
    window._constellationParamChanged = (elementId, obsIndex, paramId) => {
        window.handleObservationParameterChange(elementId, obsIndex, paramId);
        // Re-render the edit card with updated unit options
        const obsNode = currentNodes.find((n) => n.id === `obs-${obsIndex}`);
        setTimeout(
            () => showObsEditCard(obsIndex, obsNode ? obsNode.x : canvasW / 2, obsNode ? obsNode.y : canvasH / 2),
            50,
        );
    };
}

function stopEvent(e) {
    e.stopPropagation();
}

// resizeCanvas() removida — ResizeObserver no canvas sincroniza automaticamente

/**
 * Draw the constellation once (no animation loop).
 * Desenha a constelacao uma unica vez.
 */
function drawStatic() {
    if (!ctx || !canvas) return;
    draw();
}

/**
 * Update constellation for the currently selected element.
 * @param {Object|null} element - The selected element
 */
export function updateConstellation(element) {
    const hud = document.getElementById('constellation-hud');
    if (!hud) return;

    // Respeita a preferencia do usuario — se HUD foi escondido, nao forca exibicao
    if (!isConstellationVisible()) return;

    hud.style.display = '';

    // Sync canvas buffer — fallback caso ResizeObserver nao tenha disparado
    if (canvas) {
        const cw = canvas.clientWidth;
        const ch = canvas.clientHeight;
        if (cw > 50 && ch > 20 && (canvas.width !== cw || canvas.height !== ch)) {
            canvasW = cw;
            canvasH = ch;
            canvas.width = cw;
            canvas.height = ch;
        }
    }

    // Atualiza botao de observacao
    const obsBtn = document.getElementById('constellation-add-obs');
    if (obsBtn) obsBtn.style.display = element ? 'flex' : 'none';

    // Fecha overlays se o elemento mudou
    const elementChanged = !element || element.id !== _selectedId;
    if (elementChanged) {
        hideObsEditCard();
        hideObsList();
    }

    if (!element) {
        currentNodes = [];
        currentLines = [];
        _selectedId = null;
        drawStatic();
        return;
    }

    _selectedId = element.id;
    buildNodeLayout(element);
    drawStatic();

    // Update PDPLU table if that tab is active
    if (getActiveConstellationTab() === 'pdplu') {
        updatePDPLUTable(element);
    }
}

// ================================================================
// LAYOUT BUILDER
// ================================================================

function buildNodeLayout(element) {
    currentNodes = [];
    currentLines = [];

    const centerX = canvasW / 2;
    const centerY = Math.round(canvasH * 0.5);

    // Central node — elemento selecionado
    const obsCount = element.data?.observations?.length || 0;
    const centerNode = {
        id: element.id,
        x: centerX,
        y: centerY,
        radius: CENTER_RADIUS,
        name: element.name,
        family: element.family,
        isCenter: true,
        isObservation: false,
        obsCount,
    };
    currentNodes.push(centerNode);

    // Get connected edges
    let connectedEdges = [];
    try {
        connectedEdges = getConnectedEdges(element.id) || [];
    } catch {
        /* edges module may not be initialized */
    }

    // Group edges by neighbor
    const neighborMap = new Map();
    connectedEdges.forEach((edge) => {
        const neighborId = edge.sourceId === element.id ? edge.targetId : edge.sourceId;
        if (!neighborMap.has(neighborId)) {
            neighborMap.set(neighborId, []);
        }
        neighborMap.get(neighborId).push(edge);
    });

    // Satellite nodes — apenas elementos visiveis (ocultos nao aparecem)
    const allNeighbors = Array.from(neighborMap.entries());
    const neighbors = allNeighbors.filter(([nId]) => {
        const n = getElementById(nId);
        return n && n.visible !== false;
    });
    const hiddenCount = allNeighbors.length - neighbors.length;
    const maxVisible = 10;
    const visibleNeighbors = neighbors.slice(0, maxVisible);
    const extraCount = Math.max(0, neighbors.length - maxVisible);

    // Classify neighbors as upstream (RIGHT), downstream (LEFT), or neutral (TOP)
    // based on edge type direction semantics
    const upstreamGroup = []; // RIGHT — sources, causes, authorities
    const downstreamGroup = []; // LEFT — targets, effects, dependents
    const neutralGroup = []; // TOP — symmetric (adjacent_to)

    visibleNeighbors.forEach((entry) => {
        const [, edges] = entry;
        const firstEdge = edges[0];
        const edgeType = getEdgeType(firstEdge.type);
        const direction = edgeType?.direction;
        const isOutgoing = firstEdge.sourceId === element.id;

        if (!direction || direction === 'symmetric' || edgeType?.bidirectional) {
            neutralGroup.push(entry);
        } else {
            const srcIsUpstream = SOURCE_UPSTREAM_DIRS.has(direction);
            // If outgoing: neighbor (target) is downstream when source is upstream
            // If incoming: neighbor (source) is upstream when source is upstream
            const neighborIsUpstream = isOutgoing ? !srcIsUpstream : srcIsUpstream;
            if (neighborIsUpstream) {
                upstreamGroup.push(entry);
            } else {
                downstreamGroup.push(entry);
            }
        }
    });

    const arcRadius = Math.min(canvasW * 0.35, 200);
    const margin = SATELLITE_RADIUS + 14;

    // Layout a group of neighbors on one side of the canvas
    const layoutSide = (group, side) => {
        const count = group.length;
        if (count === 0) return;
        const ySpread = Math.min(canvasH * 0.7, count * 30);
        const yStart = centerY - ySpread / 2;

        group.forEach(([neighborId, edges], i) => {
            const neighbor = getElementById(neighborId);
            if (!neighbor) return;

            const t = count === 1 ? 0.5 : i / (count - 1);
            const xJitter = (i % 2) * 15;
            let nx, ny;

            if (side === 'right') {
                nx = centerX + arcRadius * 0.65 + xJitter;
                ny = yStart + ySpread * t;
            } else if (side === 'left') {
                nx = centerX - arcRadius * 0.65 - xJitter;
                ny = yStart + ySpread * t;
            } else {
                // Neutral: spread horizontally above center
                nx = centerX + (t - 0.5) * arcRadius * 0.8;
                ny = centerY - arcRadius * 0.55;
            }

            ny = Math.max(margin, Math.min(canvasH - margin, ny));

            const nObs = neighbor.data?.observations?.length || 0;
            const node = {
                id: neighborId,
                x: nx,
                y: ny,
                radius: SATELLITE_RADIUS,
                name: neighbor.name,
                family: neighbor.family,
                isCenter: false,
                isObservation: false,
                obsCount: nObs,
                edgeTypes: edges.map((e) => e.type),
                side: side === 'right' ? 'upstream' : side === 'left' ? 'downstream' : 'neutral',
            };
            currentNodes.push(node);

            // Connection lines
            edges.forEach((edge) => {
                const isOutgoing = edge.sourceId === element.id;
                currentLines.push({
                    from: { x: centerX, y: centerY },
                    to: { x: node.x, y: node.y },
                    edge,
                    isOutgoing,
                });
            });
        });
    };

    layoutSide(upstreamGroup, 'right');
    layoutSide(downstreamGroup, 'left');
    layoutSide(neutralGroup, 'top');

    // Observation dots — pontos ao redor do centro
    const observations = element.data?.observations || [];
    const maxObs = 30;
    const visibleObs = observations.slice(0, maxObs);

    visibleObs.forEach((obs, i) => {
        const angle = (i / Math.max(visibleObs.length, 1)) * Math.PI * 2;
        const ring = Math.floor(i / 8);
        const dist = CENTER_RADIUS + 10 + ring * 8;
        currentNodes.push({
            id: `obs-${i}`,
            x: centerX + Math.cos(angle) * dist,
            y: centerY + Math.sin(angle) * dist * 0.45,
            radius: OBS_RADIUS,
            name: obs.parameterId || '',
            family: 'observation',
            isCenter: false,
            isObservation: true,
            obsData: obs,
        });
    });

    // Store extra count for legend
    centerNode._extraEdges = extraCount;
    centerNode._hiddenEdges = hiddenCount;
    centerNode._totalEdges = neighbors.length;
    centerNode._totalObs = observations.length;
}

// ================================================================
// DRAWING (static — no animation)
// ================================================================

function draw() {
    if (!ctx || !canvas) return;
    _updateThemeColors();
    ctx.clearRect(0, 0, canvasW, canvasH);

    const centerNode = currentNodes.find((n) => n.isCenter);
    if (!centerNode) {
        // Empty state — nenhum elemento selecionado
        ctx.font = '12px Inter, system-ui, sans-serif';
        ctx.fillStyle = _theme.textFaint;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Select an element to see its connections', canvasW / 2, canvasH / 2);
        return;
    }

    // 1. Connection lines (behind nodes)
    currentLines.forEach((line) => drawConnectionLine(line));

    // 2. Observation dots
    currentNodes.filter((n) => n.isObservation).forEach(drawObservationDot);

    // 3. Satellite nodes
    currentNodes.filter((n) => !n.isCenter && !n.isObservation).forEach((n) => drawNode(n, false));

    // 4. Central node (on top)
    drawNode(centerNode, true);

    // 5. Legend bar at bottom
    drawLegend(centerNode);
}

function drawNode(node, isCenter) {
    const color = FAMILY_COLORS[node.family] || FAMILY_COLORS.default;
    const isHovered = node.id === hoveredNodeId;
    const hoverScale = isHovered ? 1.15 : 1;
    const r = node.radius * hoverScale;

    ctx.save();

    // Subtle outer glow — wider, softer
    const glowR = r + (isCenter ? 16 : 10);
    const glow = ctx.createRadialGradient(node.x, node.y, r * 0.3, node.x, node.y, glowR);
    glow.addColorStop(0, color + '20');
    glow.addColorStop(0.6, color + '10');
    glow.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // Main circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color + 'DD';
    ctx.fill();
    ctx.strokeStyle = isHovered ? _theme.text : color;
    ctx.lineWidth = isCenter ? 2 : isHovered ? 2 : 1;
    ctx.stroke();

    // Inner highlight ring for depth
    ctx.beginPath();
    ctx.arc(node.x, node.y, r - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Family icon inside node
    const icon = FAMILY_ICONS[node.family] || FAMILY_ICONS.default;
    ctx.font = `${isCenter ? 12 : 10}px sans-serif`;
    ctx.fillStyle = _theme.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, node.x, node.y);

    ctx.restore();

    // Name label below node
    if (node.name) {
        ctx.save();
        const fontSize = isCenter ? 11 : 9;
        ctx.font = isCenter
            ? `bold ${fontSize}px Inter, system-ui, sans-serif`
            : `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const label = truncate(node.name, 18);
        const tw = ctx.measureText(label).width;
        const lx = node.x;
        const ly = node.y + r + 3;

        // Pill behind label
        ctx.fillStyle = _theme.bgSolid;
        const pad = 4;
        roundRect(ctx, lx - tw / 2 - pad, ly - 1, tw + pad * 2, fontSize + 4, 3);
        ctx.fill();

        ctx.fillStyle = isHovered ? _theme.text : _theme.textMuted;
        ctx.fillText(label, lx, ly + 1);

        // Observation count badge
        if (node.obsCount > 0 && !node.isObservation) {
            const badge = `${node.obsCount}`;
            ctx.font = 'bold 8px Inter, system-ui, sans-serif';
            const bw = ctx.measureText(badge).width + 6;
            const bx = node.x + r - 2;
            const by = node.y - r - 2;
            ctx.fillStyle = '#FFA726';
            ctx.beginPath();
            ctx.arc(bx, by, Math.max(bw / 2, 7), 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#000';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(badge, bx, by);
        }

        ctx.restore();
    }

    // Edge type labels for satellites
    if (!isCenter && node.edgeTypes && node.edgeTypes.length > 0) {
        ctx.save();
        ctx.font = '7px JetBrains Mono, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const typeLabel = node.edgeTypes[0].replace(/_/g, ' ');
        ctx.fillStyle = _theme.textFaint;
        ctx.fillText(typeLabel, node.x, node.y - r - 4);
        ctx.restore();
    }
}

function drawConnectionLine(line) {
    const { from, to, edge, isOutgoing } = line;
    const edgeType = getEdgeType(edge.type);
    const category = edgeType ? EDGE_CATEGORIES[edgeType.category] : null;
    const color = category?.color || '#607D8B';

    ctx.save();

    // Main line
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = color + '50';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Direction arrow at 65% along the line
    const t = 0.65;
    const ax = from.x + (to.x - from.x) * t;
    const ay = from.y + (to.y - from.y) * t;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const arrowDir = isOutgoing ? 0 : Math.PI;

    ctx.translate(ax, ay);
    ctx.rotate(angle + arrowDir);
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-3, -3);
    ctx.lineTo(-3, 3);
    ctx.closePath();
    ctx.fillStyle = color + '70';
    ctx.fill();

    ctx.restore();
}

function drawObservationDot(node) {
    const obsIndex = parseInt(node.id.replace('obs-', ''), 10);
    const isActive = activeEditIndex === obsIndex;
    const r = isActive ? node.radius * 1.6 : node.radius;

    // Outer glow when active
    if (isActive) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 167, 38, 0.3)';
        ctx.fill();
    }

    // Main dot
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? 'rgba(255, 200, 100, 0.9)' : 'rgba(255, 250, 200, 0.5)';
    ctx.fill();
}

function drawLegend(centerNode) {
    const totalEdges = centerNode._totalEdges || 0;
    const totalObs = centerNode._totalObs || 0;
    const extra = centerNode._extraEdges || 0;
    const hidden = centerNode._hiddenEdges || 0;

    const parts = [];
    if (totalEdges > 0) parts.push(`${totalEdges} ${totalEdges === 1 ? 'connection' : 'connections'}`);
    if (totalObs > 0) parts.push(`${totalObs} ${totalObs === 1 ? 'observation' : 'observations'}`);
    if (extra > 0) parts.push(`+${extra} more`);
    if (hidden > 0) parts.push(`${hidden} hidden`);
    if (parts.length === 0) parts.push('no connections');

    const legendText = parts.join('  \u00B7  ');
    ctx.font = '9px Inter, system-ui, sans-serif';
    const tw = ctx.measureText(legendText).width;

    // Background strip for legend
    ctx.fillStyle = _theme.bgSolid;
    roundRect(ctx, canvasW / 2 - tw / 2 - 8, canvasH - 18, tw + 16, 16, 4);
    ctx.fill();

    ctx.fillStyle = _theme.textFaint;
    ctx.textAlign = 'center';
    ctx.fillText(legendText, canvasW / 2, canvasH - 8);
}

// ================================================================
// INTERACTION
// ================================================================

function handleCanvasClick(e) {
    e.stopPropagation();
    e.preventDefault();

    const { mx, my } = getCanvasCoords(e);

    // Check satellite nodes first
    for (const node of currentNodes) {
        if (node.isObservation || node.isCenter) continue;
        const dx = mx - node.x;
        const dy = my - node.y;
        const hitR = node.radius + 8;
        if (dx * dx + dy * dy < hitR * hitR) {
            hideObsEditCard();
            hideObsList();
            if (_onSelect) _onSelect(node.id);
            return;
        }
    }

    // Check observation dots — open HTML edit card
    for (const node of currentNodes) {
        if (!node.isObservation) continue;
        const dx = mx - node.x;
        const dy = my - node.y;
        const hitR = node.radius + 8;
        if (dx * dx + dy * dy < hitR * hitR) {
            const obsIndex = parseInt(node.id.replace('obs-', ''), 10);
            if (activeEditIndex === obsIndex) {
                hideObsEditCard();
            } else {
                showObsEditCard(obsIndex, node.x, node.y);
            }
            return;
        }
    }

    // Check center node obs badge click — open list popover
    const centerNode = currentNodes.find((n) => n.isCenter);
    if (centerNode && centerNode.obsCount > 0) {
        const bx = centerNode.x + centerNode.radius - 2;
        const by = centerNode.y - centerNode.radius - 2;
        const dx = mx - bx;
        const dy = my - by;
        if (dx * dx + dy * dy < 12 * 12) {
            if (activeObsList) {
                hideObsList();
            } else {
                showObsList();
            }
            return;
        }
    }

    // Click empty space — close overlays
    hideObsEditCard();
    hideObsList();
}

function handleCanvasHover(e) {
    const { mx, my } = getCanvasCoords(e);
    let foundPointer = false;
    let newHovered = null;

    // Check satellite nodes
    for (const node of currentNodes) {
        if (node.isObservation || node.isCenter) continue;
        const dx = mx - node.x;
        const dy = my - node.y;
        if (dx * dx + dy * dy < (node.radius + 8) ** 2) {
            newHovered = node.id;
            foundPointer = true;
            break;
        }
    }

    // Check observation dots
    if (!foundPointer) {
        for (const node of currentNodes) {
            if (!node.isObservation) continue;
            const dx = mx - node.x;
            const dy = my - node.y;
            if (dx * dx + dy * dy < (node.radius + 8) ** 2) {
                foundPointer = true;
                break;
            }
        }
    }

    // Check obs badge
    if (!foundPointer) {
        const centerNode = currentNodes.find((n) => n.isCenter);
        if (centerNode && centerNode.obsCount > 0) {
            const bx = centerNode.x + centerNode.radius - 2;
            const by = centerNode.y - centerNode.radius - 2;
            const dx = mx - bx;
            const dy = my - by;
            if (dx * dx + dy * dy < 12 * 12) foundPointer = true;
        }
    }

    // Only redraw if hovered satellite changed
    if (hoveredNodeId !== newHovered) {
        hoveredNodeId = newHovered;
        drawStatic();
    }
    canvas.style.cursor = foundPointer ? 'pointer' : 'default';
}

function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        mx: (e.clientX - rect.left) * (canvasW / rect.width),
        my: (e.clientY - rect.top) * (canvasH / rect.height),
    };
}

// ================================================================
// OBSERVATION EDIT CARD (HTML overlay)
// ================================================================

/**
 * Show editable observation card near the clicked dot.
 * Mostra cartao editavel de observacao com campos de formulario.
 */
function showObsEditCard(obsIndex, canvasX, canvasY) {
    const container = document.getElementById('constellation-obs-edit');
    if (!container) return;

    const element = getSelectedElement();
    if (!element) return;

    const observations = element.data?.observations || [];
    const obs = observations[obsIndex];
    if (!obs) return;

    activeEditIndex = obsIndex;
    hideObsList();

    const parameters = CONFIG.PARAMETERS || [];
    const units = CONFIG.UNITS || [];
    const campaigns = getAllCampaigns();
    const elementId = element.id;

    // Resolve compatible units for selected parameter
    const selectedParam = parameters.find((p) => p.id === obs.parameterId);
    const selectedUnit = units.find((u) => u.id === (obs.unitId || selectedParam?.defaultUnitId));
    const compatibleUnits = selectedUnit ? units.filter((u) => u.dimension === selectedUnit.dimension) : units;

    // Family color for accent stripe
    const familyColor = FAMILY_COLORS[element.family] || FAMILY_COLORS.default;

    container.innerHTML = `
        <div class="constellation-edit-card" style="--obs-family-color: ${familyColor}">
            <div class="obs-header">
                <span class="obs-title">
                    <span class="obs-badge">#${obsIndex + 1}</span>
                    Observation
                </span>
                <button type="button" class="btn btn-icon" title="Close" aria-label="Close"
                        onclick="window._constellationCloseEdit()">
                    <span data-icon="x" data-icon-size="14px"></span>
                </button>
            </div>
            <div class="obs-section">
                <div class="obs-section-title">
                    <span class="section-icon" data-icon="activity" data-icon-size="12px"></span>
                    Reading
                </div>
                <div class="form-group">
                    <label class="form-label">Parameter</label>
                    <select class="form-input"
                            onchange="window._constellationParamChanged('${esc(elementId)}', ${obsIndex}, this.value)">
                        <option value="">-- Select --</option>
                        ${parameters
                            .map(
                                (p) => `
                            <option value="${esc(p.id)}" ${p.id === obs.parameterId ? 'selected' : ''}>
                                ${esc(p.name)}
                            </option>
                        `,
                            )
                            .join('')}
                    </select>
                </div>
                <div class="constellation-edit-row">
                    <div class="form-group" style="flex:1;">
                        <label class="form-label">Value</label>
                        <input class="form-input value-input" type="number" step="any"
                               value="${obs.value ?? ''}"
                               oninput="window.handleReadingChange('${esc(elementId)}', ${obsIndex}, 'primary', 'value', this.value, false)">
                    </div>
                    <div class="form-group" style="flex:0 0 90px;">
                        <label class="form-label">Unit</label>
                        <select class="form-input unit-select"
                                onchange="window.handleUnitChange('${esc(elementId)}', ${obsIndex}, 'primary', this.value, false)">
                            ${compatibleUnits
                                .map(
                                    (u) => `
                                <option value="${esc(u.id)}" ${u.id === (obs.unitId || selectedUnit?.id) ? 'selected' : ''}>
                                    ${esc(u.symbol || u.name)}
                                </option>
                            `,
                                )
                                .join('')}
                        </select>
                    </div>
                </div>
            </div>
            <div class="obs-section">
                <div class="obs-section-title">
                    <span class="section-icon" data-icon="clock" data-icon-size="12px"></span>
                    Context
                </div>
                <div class="form-group">
                    <label class="form-label">Date</label>
                    <input class="form-input" type="date"
                           value="${esc(obs.date || '')}"
                           oninput="window.handleObservationChange('${esc(elementId)}', ${obsIndex}, 'date', this.value)">
                </div>
                <div class="form-group">
                    <label class="form-label">Campaign</label>
                    <select class="form-input"
                            onchange="window.handleObservationChange('${esc(elementId)}', ${obsIndex}, 'campaignId', this.value)">
                        <option value="">--</option>
                        ${campaigns
                            .map(
                                (c) => `
                            <option value="${esc(c.id)}" ${c.id === obs.campaignId ? 'selected' : ''}>
                                ${esc(c.name)}
                            </option>
                        `,
                            )
                            .join('')}
                    </select>
                </div>
            </div>
            <div class="constellation-edit-footer">
                <button type="button" class="obs-remove-btn"
                        onclick="window.handleRemoveObservation('${esc(elementId)}', ${obsIndex}); window._constellationCloseEdit();">
                    <span class="remove-icon" data-icon="trash" data-icon-size="12px"></span>
                    Remove
                </button>
            </div>
        </div>
    `;

    // Position card above canvas near clicked dot
    const rect = canvas.getBoundingClientRect();
    const pxX = (canvasX / canvasW) * rect.width;
    const cardWidth = 280;
    let left = pxX - cardWidth / 2;
    left = Math.max(8, Math.min(rect.width - cardWidth - 8, left));

    container.style.left = left + 'px';
    const actualCanvasH = canvas.clientHeight || canvasH;
    container.style.bottom = actualCanvasH + 4 + 'px';
    container.style.display = 'block';
    hydrateIcons(container);

    drawStatic();
}

function hideObsEditCard() {
    const container = document.getElementById('constellation-obs-edit');
    if (container) {
        container.style.display = 'none';
        container.innerHTML = '';
    }
    if (activeEditIndex !== null) {
        activeEditIndex = null;
        drawStatic();
    }
}

// ================================================================
// OBSERVATION LIST POPOVER (HTML overlay)
// ================================================================

/**
 * Show scrollable list of all observations.
 * Mostra lista de todas as observacoes com clique para editar.
 */
function showObsList() {
    const container = document.getElementById('constellation-obs-list');
    if (!container) return;

    const element = getSelectedElement();
    if (!element) return;

    const observations = element.data?.observations || [];
    if (observations.length === 0) return;

    activeObsList = true;
    hideObsEditCard();

    container.innerHTML = `
        <div class="constellation-list-card">
            <div class="obs-header">
                <span class="obs-title">${observations.length} Observations</span>
                <button type="button" class="btn btn-icon" title="Close" aria-label="Close"
                        onclick="window._constellationCloseList()">
                    <span data-icon="x" data-icon-size="14px"></span>
                </button>
            </div>
            <div class="constellation-list-body">
                ${observations
                    .map((obs, i) => {
                        const paramName = resolveParamName(obs.parameterId);
                        const unitLabel = resolveUnitLabel(obs.unitId);
                        const valueStr = obs.value != null ? `${obs.value} ${unitLabel}` : '--';
                        return `
                        <div class="constellation-list-row"
                             onclick="window._constellationEditObs(${i})">
                            <span class="constellation-list-param">${esc(paramName)}</span>
                            <span class="constellation-list-value">${esc(valueStr)}</span>
                            <span class="constellation-list-date">${esc(obs.date || '--')}</span>
                        </div>
                    `;
                    })
                    .join('')}
            </div>
        </div>
    `;
    hydrateIcons(container);

    container.style.display = 'block';
}

function hideObsList() {
    const container = document.getElementById('constellation-obs-list');
    if (container) {
        container.style.display = 'none';
        container.innerHTML = '';
    }
    activeObsList = false;
}

// ================================================================
// RESOLVE HELPERS
// ================================================================

function resolveParamName(parameterId) {
    if (!parameterId) return '\u2014';
    const param = CONFIG.PARAMETERS.find((p) => p.id === parameterId);
    return param ? param.name : parameterId;
}

function resolveUnitLabel(unitId) {
    if (!unitId) return '';
    const unit = CONFIG.UNITS?.find((u) => u.id === unitId);
    return unit ? unit.symbol || unit.name : unitId;
}

// ================================================================
// HELPERS
// ================================================================

function truncate(text, maxLen) {
    return text.length > maxLen ? text.substring(0, maxLen - 1) + '\u2026' : text;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

/**
 * Escape HTML to prevent XSS in dynamic content.
 */
function esc(text) {
    if (text == null) return '';
    const d = document.createElement('div');
    d.textContent = String(text);
    return d.innerHTML;
}

// ----------------------------------------------------------------
// CLEANUP (ECBT05) — Remove event listeners and disconnect observer
// ----------------------------------------------------------------
// REPORT EXPAND BUTTON
// Botao para abrir overlay full-screen do relatorio
// ----------------------------------------------------------------

/** @private */
function _ensureExpandButton(container) {
    if (!container || container.querySelector('.report-expand-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'report-expand-btn';
    btn.title = 'Abrir editor full-screen';
    btn.innerHTML = '⛶';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.handleOpenReportOverlay?.();
    });
    container.style.position = 'relative';
    container.appendChild(btn);
}

// ----------------------------------------------------------------

/**
 * Destroy constellation, removing all listeners and observers.
 * Limpa listeners e ResizeObserver para evitar memory leaks.
 */
export function destroyConstellation() {
    if (canvas) {
        canvas.removeEventListener('click', handleCanvasClick, true);
        canvas.removeEventListener('mousedown', stopEvent, true);
        canvas.removeEventListener('mouseup', stopEvent, true);
        canvas.removeEventListener('mousemove', handleCanvasHover);
    }
    if (_resizeObserver) {
        _resizeObserver.disconnect();
        _resizeObserver = null;
    }
    canvas = null;
    ctx = null;
}
