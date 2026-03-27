// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   LABEL RENDERER — CSS2DRenderer + Leader Lines + Decluttering
   ================================================================

   Tres sistemas sobrepostos ao canvas WebGL:

   1. CSS2DRenderer — labels DOM (texto nitido, billboard)
   2. Leader Line Canvas — curvas Bezier callout (estilo CAD)
   3. Declutter Engine — anti-colisao + fade por distancia

   Stacking order (de baixo para cima):
     WebGL canvas → leader canvas (z:1) → CSS2D div (z:2)

   Decluttering:
     A cada frame, apos CSS2D posicionar labels, o engine:
     - Calcula distancia de cada label a camera
     - Ordena por prioridade (distancia)
     - Detecta sobreposicao de retangulos na tela
     - Labels ocluidas ficam transparentes (fade out gracioso)
     - Labels distantes da camera tambem ficam translucidas
     - Labels nas bordas ou sobre paineis laterais sao ocultas
     - Leader lines so aparecem para labels efetivamente visiveis

   ================================================================ */

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { addRenderHook, addResizeHook } from '../scene/setup.js';
import { getVisibleLabelData, isLabelsEnabled } from './manager.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let css2dRenderer = null;
let leaderCanvas = null;
let leaderCtx = null;
let _container = null;

// Leader line style — callout CAD
const LINE_COLOR_BASE = [140, 175, 200];
const LINE_WIDTH = 1.0;
const LINE_ALPHA_MULT = 0.7; // Multiplicador de alpha da label
const DOT_ALPHA_MULT = 0.85; // Dots mais visiveis que a linha
const MIN_DRAW_ALPHA = 0.18; // Evita "ponto solto" quando linha fica imperceptivel
const DOT_RADIUS = 3.0;
const LABEL_DOT_RADIUS = 2.0;

// Declutter config
const PADDING = 8; // Margem entre labels (breathing room)
const FADE_OCCLUDED = 0.06; // Labels ocluidas: quase invisiveis mas nao zero
const FADE_IN_SPEED = 0.25; // Fade in rapido (4 frames = full)
const FADE_OUT_SPEED = 0.1; // Fade out moderado
const DIST_FADE_START = 300; // Distancia (world units) onde fade comeca
const DIST_FADE_END = 800; // Distancia onde opacidade chega ao minimo
const DIST_FADE_MIN = 0.3; // Labels distantes ainda ficam legiveis
let _maxVisible = 40; // Max labels simultaneas (configuravel)
let _leaderMinDistance = 10; // Distancia minima para desenhar link (px)
const EDGE_MARGIN = 15; // Margem das bordas do viewport (px)
const PANEL_SAFE_LEFT = 200; // Zona segura: nao sobrepor painel esquerdo (px)
const PANEL_SAFE_RIGHT = 40; // Zona segura: nao sobrepor abas laterais direitas (px)

// Nudge config
const NUDGE_DIRS = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0], // cardeal (cima primeiro)
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1], // diagonal
];
const NUDGE_STEP = 28; // px por tentativa
const NUDGE_MAX_STEPS = 3; // tentativas por direcao (max 84px)
const MAX_NUDGE = 15; // max labels nudgeadas por frame
const LERP_SPEED = 0.3; // velocidade de interpolacao
const NUDGE_CAPACITY_MULT = 1.5; // headroom para nudge (reserva slots alem do _maxVisible)

let _nudgeEnabled = false;
const _nudgeCache = new Map(); // elementId -> { mx, my }

// Family priority — array ordenado de familyIds (index 0 = maior prioridade)
let _familyPriority = [];
let _familyPriorityMap = new Map(); // familyId -> index (precomputed for O(1) lookup)

// Show all — desativa declutter (Fases 3-5), forca todas labels visiveis
let _showAll = false;

// Disabled families — familias cujas labels sao escondidas
const _disabledFamilies = new Set();

// Cache de opacidades atuais por elementId (smooth transitions)
const _opacityCache = new Map();

// ----------------------------------------------------------------
// INIT
// ----------------------------------------------------------------

/**
 * Inicializa o CSS2DRenderer, leader line canvas, e insere no container.
 * Deve ser chamado apos initScene() — precisa do container existir.
 *
 * @param {HTMLElement} container - Container do canvas 3D
 */
export function initLabelRenderer(container) {
    if (css2dRenderer) return;
    _container = container;

    const w = container.clientWidth;
    const h = container.clientHeight;

    // 1. Leader line canvas (abaixo das labels)
    leaderCanvas = document.createElement('canvas');
    leaderCanvas.id = 'label-leader-canvas';
    leaderCanvas.width = w * devicePixelRatio;
    leaderCanvas.height = h * devicePixelRatio;
    leaderCanvas.style.position = 'absolute';
    leaderCanvas.style.top = '0';
    leaderCanvas.style.left = '0';
    leaderCanvas.style.width = w + 'px';
    leaderCanvas.style.height = h + 'px';
    leaderCanvas.style.pointerEvents = 'none';
    leaderCanvas.style.zIndex = '1';
    leaderCtx = leaderCanvas.getContext('2d');
    leaderCtx.scale(devicePixelRatio, devicePixelRatio);
    container.appendChild(leaderCanvas);

    // 2. CSS2DRenderer (acima das leader lines)
    css2dRenderer = new CSS2DRenderer();
    css2dRenderer.setSize(w, h);

    const el = css2dRenderer.domElement;
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '2';
    el.id = 'label-renderer-overlay';
    container.appendChild(el);

    // Registra hooks
    addRenderHook(renderLabels);
    addResizeHook(resizeLabelRenderer);
}

// ----------------------------------------------------------------
// RENDER
// ----------------------------------------------------------------

/**
 * Render hook — chamado a cada frame pelo animate() em setup.js.
 * Renderiza CSS2D labels, aplica decluttering, e desenha leader lines.
 */
function renderLabels(scene, camera) {
    if (!css2dRenderer) return;

    // 1. Renderiza labels CSS2D (atualiza posicoes DOM)
    css2dRenderer.render(scene, camera);

    // 2. Declutter + leader lines
    _declutterAndDraw(camera);
}

// ----------------------------------------------------------------
// DECLUTTER ENGINE
// ----------------------------------------------------------------

/**
 * Sistema unificado: declutter labels + desenhar leader lines.
 * Opera em screen space apos CSS2DRenderer posicionar as divs.
 */
function _declutterAndDraw(camera) {
    if (!leaderCtx || !leaderCanvas) return;

    const w = parseInt(leaderCanvas.style.width) || leaderCanvas.width;
    const h = parseInt(leaderCanvas.style.height) || leaderCanvas.height;

    // Limpa canvas de leader lines
    leaderCtx.clearRect(0, 0, w, h);

    if (!isLabelsEnabled()) return;

    const data = getVisibleLabelData();
    if (!data || data.length === 0) return;

    const containerRect = _container.getBoundingClientRect();
    const camPos = camera.position;

    // Detecta paineis abertos para zona de exclusao
    const leftPanel = document.getElementById('left-panel');
    const rightTabs = document.querySelector('.right-tabs, .side-tabs');
    const safeLeft = leftPanel && leftPanel.offsetWidth > 10 ? leftPanel.offsetWidth + 10 : PANEL_SAFE_LEFT;
    const safeRight = rightTabs && rightTabs.offsetWidth > 10 ? rightTabs.offsetWidth + 10 : PANEL_SAFE_RIGHT;

    // Viewport seguro (dentro do container, sem sobrepor paineis)
    const safeViewport = {
        left: safeLeft,
        top: EDGE_MARGIN,
        right: w - safeRight,
        bottom: h - EDGE_MARGIN,
    };

    // -- Fase 1: Coleta dados de screen-space + distancia --
    const entries = [];
    for (const item of data) {
        const { elementId, worldPos, labelDiv, extraDivs } = item;
        if (!labelDiv || !worldPos) continue;
        if (labelDiv.style.display === 'none' || !labelDiv.isConnected) continue;

        // Familia desativada pelo usuario — esconder completamente
        if (_disabledFamilies.has(item.familyId)) {
            _setAllOpacity(labelDiv, extraDivs, 0);
            continue;
        }

        // Distancia 3D do elemento a camera
        const dist = camPos.distanceTo(worldPos);

        // Projetar posicao 3D para tela 2D
        const projected = worldPos.clone().project(camera);
        const ex = (projected.x * 0.5 + 0.5) * w;
        const ey = (-projected.y * 0.5 + 0.5) * h;

        // Atras da camera — sempre descartar (coordenadas sem sentido)
        if (projected.z > 1) {
            _setAllOpacity(labelDiv, extraDivs, 0);
            continue;
        }
        // Fora dos limites da tela (bypass em showAll para forcar visibilidade)
        if (!_showAll && (ex < -50 || ex > w + 50 || ey < -50 || ey > h + 50)) {
            _setAllOpacity(labelDiv, extraDivs, 0);
            continue;
        }

        // Salva margins de nudge anteriores e reseta para capturar rect original
        const prevML = labelDiv.style.marginLeft;
        const prevMT = labelDiv.style.marginTop;
        if (_nudgeEnabled || _showAll) {
            labelDiv.style.marginLeft = '0px';
            labelDiv.style.marginTop = '0px';
        }

        // Bounding rect da label na tela — posicao ORIGINAL (sem nudge)
        const rect = labelDiv.getBoundingClientRect();
        const labelRect = {
            left: rect.left - containerRect.left,
            top: rect.top - containerRect.top,
            right: rect.right - containerRect.left,
            bottom: rect.bottom - containerRect.top,
            width: rect.width,
            height: rect.height,
        };

        // Restaura margins para nao causar flash visual
        if ((_nudgeEnabled || _showAll) && (prevML || prevMT)) {
            labelDiv.style.marginLeft = prevML;
            labelDiv.style.marginTop = prevMT;
        }

        // Retangulo com padding para deteccao de colisao
        const paddedRect = {
            left: labelRect.left - PADDING,
            top: labelRect.top - PADDING,
            right: labelRect.right + PADDING,
            bottom: labelRect.bottom + PADDING,
        };

        // Centro-inferior da label (ponto de conexao da leader line)
        const lx = labelRect.left + labelRect.width / 2;
        const ly = labelRect.bottom;

        entries.push({
            elementId,
            familyId: item.familyId,
            worldPos,
            labelDiv,
            extraDivs,
            dist,
            ex,
            ey,
            lx,
            ly,
            labelRect,
            paddedRect,
            targetOpacity: 1.0,
            isInSafeZone: true,
        });
    }

    if (entries.length === 0) return;

    // -- Fase 2: Ordenar por prioridade de familia + distancia --
    entries.sort((a, b) => {
        if (_familyPriorityMap.size > 0) {
            const aPrio = _familyPriorityMap.get(a.familyId) ?? 999;
            const bPrio = _familyPriorityMap.get(b.familyId) ?? 999;
            if (aPrio !== bPrio) return aPrio - bPrio;
        }
        return a.dist - b.dist;
    });

    // -- Fase 3-5: ShowAll mode — pula fade, aplica nudge para separar --
    if (_showAll) {
        const placed = [];
        for (const entry of entries) {
            entry.nudgeX = 0;
            entry.nudgeY = 0;

            // Verifica colisao com labels ja colocadas
            let collides = false;
            for (const p of placed) {
                if (_rectsOverlap(entry.paddedRect, p.paddedRect)) {
                    collides = true;
                    break;
                }
            }

            if (collides) {
                // Tentar nudge para separar (sem limite MAX_NUDGE)
                for (const [dx, dy] of NUDGE_DIRS) {
                    let found = false;
                    for (let step = 1; step <= NUDGE_MAX_STEPS; step++) {
                        const ox = dx * step * NUDGE_STEP;
                        const oy = dy * step * NUDGE_STEP;
                        const candidate = {
                            left: entry.paddedRect.left + ox,
                            top: entry.paddedRect.top + oy,
                            right: entry.paddedRect.right + ox,
                            bottom: entry.paddedRect.bottom + oy,
                        };
                        let candidateCollides = false;
                        for (const p of placed) {
                            if (_rectsOverlap(candidate, p.paddedRect)) {
                                candidateCollides = true;
                                break;
                            }
                        }
                        if (!candidateCollides) {
                            entry.nudgeX = ox;
                            entry.nudgeY = oy;
                            entry.paddedRect = candidate;
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
                // Se nao encontrou posicao: fica sobreposta (nao esconde)
            }
            placed.push(entry);
        }
    } else {
        // -- Fase 3: Marcar labels fora da zona segura --
        for (const entry of entries) {
            const r = entry.labelRect;
            // Label cortada pelas bordas ou sobrepondo paineis
            if (
                r.right < safeViewport.left ||
                r.left > safeViewport.right ||
                r.bottom < safeViewport.top ||
                r.top > safeViewport.bottom
            ) {
                entry.targetOpacity = 0;
                entry.isInSafeZone = false;
            }
            // Label parcialmente cortada — fade suave
            else if (
                r.left < safeViewport.left + 20 ||
                r.right > safeViewport.right - 20 ||
                r.top < safeViewport.top + 10 ||
                r.bottom > safeViewport.bottom - 10
            ) {
                entry.targetOpacity = 0.3;
            }
        }

        // -- Fase 4: Aplicar fade por distancia --
        for (const entry of entries) {
            if (entry.targetOpacity === 0) continue; // ja marcada como fora
            if (entry.dist > DIST_FADE_START) {
                const t = Math.min(1, (entry.dist - DIST_FADE_START) / (DIST_FADE_END - DIST_FADE_START));
                const distFade = Math.max(DIST_FADE_MIN, 1.0 - t * (1.0 - DIST_FADE_MIN));
                entry.targetOpacity = Math.min(entry.targetOpacity, distFade);
            }
        }

        // -- Fase 5: Detecao de sobreposicao (greedy placement + nudge) --
        const placed = [];
        const effectiveMax = _nudgeEnabled ? Math.ceil(_maxVisible * NUDGE_CAPACITY_MULT) : _maxVisible;
        let nudgeCount = 0;

        for (const entry of entries) {
            entry.nudgeX = 0;
            entry.nudgeY = 0;

            // Ja marcada como invisivel
            if (entry.targetOpacity <= FADE_OCCLUDED) continue;

            // Limite de labels visiveis
            if (placed.length >= effectiveMax) {
                entry.targetOpacity = FADE_OCCLUDED;
                continue;
            }

            // Verifica colisao com labels ja colocadas
            let collides = false;
            for (const p of placed) {
                if (_rectsOverlap(entry.paddedRect, p.paddedRect)) {
                    collides = true;
                    break;
                }
            }

            if (collides && _nudgeEnabled && nudgeCount < MAX_NUDGE) {
                // Tentar nudge — buscar posicao livre
                let found = false;
                for (const [dx, dy] of NUDGE_DIRS) {
                    for (let step = 1; step <= NUDGE_MAX_STEPS; step++) {
                        const ox = dx * step * NUDGE_STEP;
                        const oy = dy * step * NUDGE_STEP;
                        const candidate = {
                            left: entry.paddedRect.left + ox,
                            top: entry.paddedRect.top + oy,
                            right: entry.paddedRect.right + ox,
                            bottom: entry.paddedRect.bottom + oy,
                        };

                        // Dentro da zona segura?
                        if (
                            candidate.left < safeViewport.left ||
                            candidate.right > safeViewport.right ||
                            candidate.top < safeViewport.top ||
                            candidate.bottom > safeViewport.bottom
                        ) {
                            continue;
                        }

                        // Colide com alguma label ja colocada?
                        let candidateCollides = false;
                        for (const p of placed) {
                            if (_rectsOverlap(candidate, p.paddedRect)) {
                                candidateCollides = true;
                                break;
                            }
                        }

                        if (!candidateCollides) {
                            entry.nudgeX = ox;
                            entry.nudgeY = oy;
                            entry.paddedRect = candidate;
                            found = true;
                            nudgeCount++;
                            break;
                        }
                    }
                    if (found) break;
                }

                if (found) {
                    placed.push(entry);
                } else {
                    entry.targetOpacity = FADE_OCCLUDED;
                }
            } else if (collides) {
                entry.targetOpacity = FADE_OCCLUDED;
            } else {
                placed.push(entry);
            }
        }
    } // fim do else (_showAll bypass)

    // -- Fase 5.5: Aplicar nudge margins com lerp suave --
    if (!_nudgeEnabled && !_showAll && _nudgeCache.size === 0) {
        // Sem nudge ativo e sem cache pendente — pular
    } else
        for (const entry of entries) {
            const id = entry.elementId;
            const targetMx = entry.nudgeX || 0;
            const targetMy = entry.nudgeY || 0;
            const prev = _nudgeCache.get(id) || { mx: 0, my: 0 };

            let mx = prev.mx + (targetMx - prev.mx) * LERP_SPEED;
            let my = prev.my + (targetMy - prev.my) * LERP_SPEED;

            // Snap to zero
            if (Math.abs(mx) + Math.abs(my) < 0.5) {
                mx = 0;
                my = 0;
                if (targetMx === 0 && targetMy === 0) {
                    _nudgeCache.delete(id);
                }
            }

            if (mx !== 0 || my !== 0) {
                _nudgeCache.set(id, { mx, my });
            }

            entry.labelDiv.style.marginLeft = mx !== 0 ? mx + 'px' : '';
            entry.labelDiv.style.marginTop = my !== 0 ? my + 'px' : '';

            // Atualiza ponto de conexao da leader line para posicao nudgeada
            entry.lx += mx;
            entry.ly += my;
        }

    // -- Fase 6: Aplicar opacidades --
    for (const entry of entries) {
        let current;

        if (_showAll) {
            // ShowAll: aplicar imediatamente sem smooth transition
            current = entry.targetOpacity;
        } else {
            const prev = _opacityCache.get(entry.elementId) ?? entry.targetOpacity;
            if (entry.targetOpacity > prev) {
                current = Math.min(entry.targetOpacity, prev + FADE_IN_SPEED);
            } else {
                current = Math.max(entry.targetOpacity, prev - FADE_OUT_SPEED);
            }
        }

        _opacityCache.set(entry.elementId, current);
        entry.currentOpacity = current;

        // Aplica opacidade na div da label + divs extras (obs, geo)
        _setAllOpacity(entry.labelDiv, entry.extraDivs, current);
    }

    // Limpa cache de labels que nao existem mais
    if (_opacityCache.size > entries.length * 2 || _nudgeCache.size > entries.length) {
        const activeIds = new Set(entries.map((e) => e.elementId));
        for (const key of _opacityCache.keys()) {
            if (!activeIds.has(key)) _opacityCache.delete(key);
        }
        for (const key of _nudgeCache.keys()) {
            if (!activeIds.has(key)) _nudgeCache.delete(key);
        }
    }

    // -- Fase 7: Desenhar leader lines (somente para labels efetivamente visiveis) --
    leaderCtx.lineWidth = LINE_WIDTH;

    for (const entry of entries) {
        const { ex, ey, lx, ly, currentOpacity } = entry;

        // Nao desenha leader line se label quase invisivel
        if (currentOpacity < 0.2) continue;

        // Distancia minima para desenhar (evita micro-linhas)
        const lineDist = Math.hypot(lx - ex, ly - ey);
        if (lineDist < _leaderMinDistance) continue;

        // Alpha da leader line proporcional a opacidade da label
        const alpha = currentOpacity * LINE_ALPHA_MULT;
        const dotAlpha = currentOpacity * DOT_ALPHA_MULT;
        if (alpha < MIN_DRAW_ALPHA || dotAlpha < MIN_DRAW_ALPHA) continue;
        const [r, g, b] = LINE_COLOR_BASE;

        // Curva Bezier quadratica: ponto de controle cria curva suave
        const cpx = lx;
        const cpy = ey;

        leaderCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        leaderCtx.beginPath();
        leaderCtx.moveTo(ex, ey);
        leaderCtx.quadraticCurveTo(cpx, cpy, lx, ly);
        leaderCtx.stroke();

        // Dot no ponto do elemento (ancora)
        leaderCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${dotAlpha})`;
        leaderCtx.beginPath();
        leaderCtx.arc(ex, ey, DOT_RADIUS, 0, Math.PI * 2);
        leaderCtx.fill();

        // Dot menor na ponta da label
        leaderCtx.beginPath();
        leaderCtx.arc(lx, ly, LABEL_DOT_RADIUS, 0, Math.PI * 2);
        leaderCtx.fill();
    }
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

/**
 * Verifica se dois retangulos se sobrepoem.
 */
function _rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Aplica opacidade no div da label e todos os extras (obs, geo).
 */
function _setAllOpacity(labelDiv, extraDivs, opacity) {
    const rounded = Math.round(opacity * 100) / 100;
    const str = String(rounded);
    if (labelDiv.style.opacity !== str) {
        labelDiv.style.opacity = str;
    }
    if (extraDivs) {
        for (const div of extraDivs) {
            if (div.style.opacity !== str) {
                div.style.opacity = str;
            }
        }
    }
}

// ----------------------------------------------------------------
// RESIZE
// ----------------------------------------------------------------

function resizeLabelRenderer(width, height) {
    if (css2dRenderer) {
        css2dRenderer.setSize(width, height);
    }
    if (leaderCanvas) {
        leaderCanvas.width = width * devicePixelRatio;
        leaderCanvas.height = height * devicePixelRatio;
        leaderCanvas.style.width = width + 'px';
        leaderCanvas.style.height = height + 'px';
        if (leaderCtx) {
            leaderCtx.setTransform(1, 0, 0, 1, 0, 0);
            leaderCtx.scale(devicePixelRatio, devicePixelRatio);
        }
    }
}

/**
 * Retorna o DOM element do CSS2DRenderer.
 * @returns {HTMLElement|null}
 */
export function getLabelRendererElement() {
    return css2dRenderer?.domElement || null;
}

/**
 * Define o numero maximo de labels visiveis simultaneamente.
 * @param {number} n - Valor entre 5 e 100
 */
export function setMaxVisible(n) {
    _maxVisible = Math.max(5, Math.min(100, n));
}

/**
 * Retorna o limite atual de labels visiveis.
 * @returns {number}
 */
export function getMaxVisible() {
    return _maxVisible;
}

/**
 * Define distancia minima (px) para desenhar leader lines.
 */
export function setLeaderMinDistance(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return;
    _leaderMinDistance = Math.max(4, Math.min(40, Math.round(v)));
}

/**
 * Retorna distancia minima atual de leader lines.
 */
export function getLeaderMinDistance() {
    return _leaderMinDistance;
}

/**
 * Ativa/desativa redistribuicao (nudge) de labels colididas.
 * @param {boolean} enabled
 */
export function setNudgeEnabled(enabled) {
    _nudgeEnabled = !!enabled;
    // Cache mantido ao desativar — Phase 5.5 faz lerp das margins de volta a zero
}

/**
 * Retorna se nudge esta ativo.
 * @returns {boolean}
 */
export function getNudgeEnabled() {
    return _nudgeEnabled;
}

/**
 * Define a ordem de prioridade das familias para exibicao de labels.
 * @param {string[]} families - Array de familyIds na ordem de prioridade (index 0 = maior)
 */
export function setFamilyPriority(families) {
    _familyPriority = Array.isArray(families) ? [...families] : [];
    _familyPriorityMap = new Map(_familyPriority.map((f, i) => [f, i]));
}

/**
 * Retorna a lista de familias prioritarias.
 * @returns {string[]}
 */
export function getFamilyPriority() {
    return [..._familyPriority];
}

/**
 * Ativa/desativa exibicao forcada de todas as labels (pula declutter).
 * @param {boolean} enabled
 */
export function setShowAll(enabled) {
    _showAll = !!enabled;
}

/**
 * Retorna se show-all esta ativo.
 * @returns {boolean}
 */
export function getShowAll() {
    return _showAll;
}

/**
 * Desativa/ativa labels de uma familia especifica.
 * @param {string} familyId
 * @param {boolean} disabled - true = esconder labels desta familia
 */
export function setFamilyDisabled(familyId, disabled) {
    if (disabled) {
        _disabledFamilies.add(familyId);
    } else {
        _disabledFamilies.delete(familyId);
    }
}

/**
 * Verifica se uma familia esta desativada.
 * @param {string} familyId
 * @returns {boolean}
 */
export function isFamilyDisabled(familyId) {
    return _disabledFamilies.has(familyId);
}

/**
 * Retorna lista de familias desativadas.
 * @returns {string[]}
 */
export function getDisabledFamilies() {
    return [..._disabledFamilies];
}
