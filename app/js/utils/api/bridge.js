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
   API BRIDGE — WebSocket bridge for remote automation
   Ponte WebSocket para automacao remota e testes

   Este modulo conecta o navegador a um servidor de automacao,
   permitindo que ferramentas externas (Claude Code, scripts de teste)
   controlem a aplicacao programaticamente via REST API.

   ATIVACAO:
   - URL com ?api=1
   - localStorage com ecbyts-api = true
   - Automatico quando servido pelo api-server.js

   SEGURANCA:
   - Apenas conexoes ao mesmo host (localhost)
   - Whitelist de acoes permitidas por pattern de nome
   - Nenhum dado sensivel e transmitido
   ================================================================ */

// --- Element state ---
import {
    getAllElements,
    getElementById,
    addNewElement,
    removeElement,
    updateElement,
    getSelectedElement,
} from '../../core/elements/manager.js';

// --- Campaigns ---
import { getAllCampaigns, addCampaign, removeCampaign } from '../../core/campaigns/manager.js';

// --- Scenes ---
import { getAllScenes } from '../scenes/manager.js';

// --- Edges ---
import { getAllEdges, getConnectedEdges, getEdgeById } from '../edges/manager.js';

// --- Stamps ---
import { getStamps, getStampById } from '../stamps/manager.js';

// --- Families ---
import { getAllFamilies, addCustomFamily, deleteFamily } from '../../core/elements/families.js';

// --- IO ---
import { buildModel, generateKeySimple } from '../../core/io/export.js';
import { importFromString, applyModel } from '../../core/io/import.js';

// --- Scene (screenshot) ---
import { getRenderer, getScene, getCamera } from '../scene/setup.js';

// --- CDN Loader ---
import { loadScriptCDN } from '../helpers/cdnLoader.js';

// --- Registry ---
import { ACTION_REGISTRY } from './registry.js';

// --- Groups ---
import { getGroupById, exportGroups } from '../groups/manager.js';

// --- Auth ---
import { getCurrentUser, isLoggedIn, getUserEmail } from '../auth/session.js';
import {
    getUserRole,
    getObserverMode,
    isAccessControlActive,
    getRules,
    getOwner,
    exportPermissions,
} from '../auth/permissions.js';

// --- Ticker ---
import { exportTicker, computeAll as computeTickerAll } from '../ticker/manager.js';

// --- SAO ---
import {
    getActiveScenario,
    getActiveTier,
    getActiveMatrixIds,
    getActiveParameters,
    isSAOActive,
    getParameterCounts,
} from '../../core/sao/index.js';

// --- Sensor ---
import { getAppData as getSensorAppData } from '../../core/sensor/index.js';

// --- Agents ---
import { getAllAgents, getAgentById, getActiveAgent } from '../../core/llm/agents.js';

// --- LLM Client ---
import {
    setApiKey,
    setProvider,
    setModel,
    getApiKey,
    getProvider,
    getModel,
    hasApiKey,
    testConnection,
} from '../../core/llm/client.js';
import { getProviderConfig } from '../../core/llm/providers.js';

// --- Aerial Diagnostic ---
// Carregado dinamicamente via import() para nao impactar bundle quando nao usado

// ================================================================
// STATE
// ================================================================

let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let bridgeStatus = 'idle';
let lastDisconnectLogAt = 0;
let apiPort = null;
let _cachedDiscoveredActions = null;
const MAX_RECONNECT = 50;
const RECONNECT_BASE_DELAY = 2000;
const RECONNECT_MAX_DELAY = 30000;
const BRIDGE_VERBOSE = typeof localStorage !== 'undefined' && localStorage.getItem('ecbyts-api-verbose') === 'true';

// Pattern para whitelist de acoes permitidas via executeAction
const ACTION_PATTERN =
    /^(handle|generate|open|close|set|toggle|switch|zoom|reset|new|update|copy|share|execute|add|download|minimize|restore|dock|float|filter|select|save|send|confirm|cancel|test|refresh|move|fit|show|get|clear|is)/;

// ================================================================
// INITIALIZATION
// ================================================================

/**
 * Initialize the API bridge.
 * Inicializa a ponte de automacao — conecta WebSocket e registra no window.
 * @param {string|null} port - Porta do api-server (ex: '3001'), ou null para mesma porta
 */
export function initBridge(port) {
    apiPort = port || localStorage.getItem('ecbyts-api-port') || null;
    connect();
    registerOnWindow();
    if (BRIDGE_VERBOSE) {
        console.log(`[API Bridge] Initialized${apiPort ? ` (api-server port: ${apiPort})` : ''}`);
    }
}

// ================================================================
// WEBSOCKET CONNECTION
// ================================================================

function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    // Conecta ao api-server — usa porta passada via ?api=PORTA ou mesma porta da pagina
    const host = apiPort ? `localhost:${apiPort}` : location.host;
    const wsUrl = `ws://${host}/ws`;

    try {
        bridgeStatus = 'connecting';
        ws = new WebSocket(wsUrl);
    } catch (e) {
        bridgeStatus = 'disconnected';
        console.warn('[API Bridge] WebSocket creation failed:', e.message);
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        const wasConnected = bridgeStatus === 'connected';
        reconnectAttempts = 0;
        bridgeStatus = 'connected';
        if (!wasConnected && BRIDGE_VERBOSE) {
            console.log('[API Bridge] Connected');
        }

        // Send ready payload off the onopen hot-path to reduce long-task warnings.
        const sendReady = () => {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            if (!_cachedDiscoveredActions) {
                _cachedDiscoveredActions = discoverActions();
            }
            send({
                type: 'ready',
                actions: _cachedDiscoveredActions,
            });
        };
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(sendReady, { timeout: 500 });
        } else {
            setTimeout(sendReady, 0);
        }
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'command') {
                handleCommand(msg);
            } else if (msg.type === 'reload') {
                console.log('[API Bridge] Reload requested by server');
                // Cache-bust: navega para URL com timestamp para forcar recarga de modulos ES
                const url = new URL(location.href);
                url.searchParams.set('_cb', Date.now());
                location.href = url.toString();
            }
        } catch (e) {
            console.error('[API Bridge] Message parse error:', e.message);
        }
    };

    ws.onclose = () => {
        const now = Date.now();
        if (BRIDGE_VERBOSE && (bridgeStatus === 'connected' || now - lastDisconnectLogAt > 10000)) {
            console.log('[API Bridge] Disconnected');
            lastDisconnectLogAt = now;
        }
        bridgeStatus = 'disconnected';
        scheduleReconnect();
    };

    ws.onerror = () => {
        // onclose will handle reconnect
    };
}

function scheduleReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT) {
        console.warn('[API Bridge] Max reconnect attempts reached');
        return;
    }
    if (reconnectTimer) return;
    reconnectAttempts++;
    const delay = Math.min(RECONNECT_BASE_DELAY * 2 ** (reconnectAttempts - 1), RECONNECT_MAX_DELAY);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, delay);
}

// ================================================================
// COMMAND HANDLERS
// ================================================================

const COMMANDS = {
    // --- State queries ---
    // Consultas de estado — retornam dados do modelo atual

    getState: () => buildModel(),

    getElements: () => getAllElements().map(simplifyElement),

    getElement: ({ id }) => {
        const el = getElementById(id);
        if (!el) throw new Error(`Element not found: ${id}`);
        return simplifyElement(el);
    },

    getCampaigns: () => getAllCampaigns(),

    getScenes: () => getAllScenes(),

    getEdges: () => getAllEdges(),

    // --- Stamps (per element) ---
    // Leitura de estampas vinculadas a um elemento

    getStamps: ({ elementId }) => {
        const el = getElementById(elementId);
        if (!el) throw new Error(`Element not found: ${elementId}`);
        return getStamps(el);
    },

    getStamp: ({ elementId, stampId }) => {
        const el = getElementById(elementId);
        if (!el) throw new Error(`Element not found: ${elementId}`);
        const stamp = getStampById(el, stampId);
        if (!stamp) throw new Error(`Stamp not found: ${stampId}`);
        return stamp;
    },

    // --- Edges (per element) ---
    // Leitura de arestas conectadas a um elemento

    getEdgesByElement: ({ elementId }) => {
        if (!elementId) throw new Error('elementId is required');
        return getConnectedEdges(elementId);
    },

    getEdge: ({ edgeId }) => {
        if (!edgeId) throw new Error('edgeId is required');
        const edge = getEdgeById(edgeId);
        if (!edge) throw new Error(`Edge not found: ${edgeId}`);
        return edge;
    },

    // --- Observations (per element) ---
    // Leitura de observacoes de um elemento

    getObservations: ({ elementId }) => {
        const el = getElementById(elementId);
        if (!el) throw new Error(`Element not found: ${elementId}`);
        return el.data?.observations || [];
    },

    // --- Tab switching ---
    // Troca de aba do ribbon

    switchTab: ({ tabId }) => {
        if (!tabId) throw new Error('tabId is required');
        if (typeof window.switchRibbonTab === 'function') {
            window.switchRibbonTab(tabId);
            return { switched: tabId };
        }
        throw new Error('switchRibbonTab not available');
    },

    // --- Campaign update ---
    // Atualizacao de campo de campanha

    updateCampaign: ({ id, field, value }) => {
        if (!id) throw new Error('id is required');
        if (!field) throw new Error('field is required');
        if (typeof window.handleCampaignChange === 'function') {
            window.handleCampaignChange(id, field, value);
            triggerUIUpdate();
            return { updated: true };
        }
        throw new Error('handleCampaignChange not available');
    },

    // --- Scene CRUD ---
    // Criacao e remocao de cenas

    addScene: () => {
        if (typeof window.handleAddScene === 'function') {
            window.handleAddScene();
            triggerUIUpdate();
            return { added: true };
        }
        throw new Error('handleAddScene not available');
    },

    removeScene: ({ id }) => {
        if (!id) throw new Error('id is required');
        if (typeof window.handleRemoveScene === 'function') {
            window.handleRemoveScene(id);
            triggerUIUpdate();
            return { removed: true };
        }
        throw new Error('handleRemoveScene not available');
    },

    // --- Panel state ---
    // Estado dos paineis laterais e analytics

    getPanelState: () => {
        const left = document.getElementById('families-panel');
        const right = document.getElementById('properties-panel');
        const analytics = document.getElementById('analytics-container');
        return {
            left: left?.dataset?.state || (left?.classList.contains('minimized') ? 'minimized' : 'docked'),
            right: right?.dataset?.state || (right?.classList.contains('minimized') ? 'minimized' : 'docked'),
            analyticsFullscreen: analytics?.classList.contains('fullscreen') || false,
        };
    },

    // --- Element CRUD ---
    // Operacoes de criacao, atualizacao e remocao de elementos

    addElement: ({ familyId }) => {
        if (!familyId) throw new Error('familyId is required');
        const el = addNewElement(familyId);
        if (!el) throw new Error(`Failed to add element of family: ${familyId}`);
        triggerUIUpdate();
        return simplifyElement(el);
    },

    removeElement: ({ id }) => {
        if (!id) throw new Error('id is required');
        const removed = removeElement(id);
        triggerUIUpdate();
        return { removed: !!removed };
    },

    updateElement: ({ id, updates }) => {
        if (!id) throw new Error('id is required');
        if (!updates) throw new Error('updates is required');
        updateElement(id, updates);
        triggerUIUpdate();
        const el = getElementById(id);
        return el ? simplifyElement(el) : null;
    },

    selectElement: ({ id }) => {
        if (typeof window.handleSelectElement === 'function') {
            window.handleSelectElement(id);
        }
        return { selected: id };
    },

    // --- Campaign CRUD ---
    addCampaign: () => {
        const campaign = addCampaign();
        triggerUIUpdate();
        return campaign;
    },

    removeCampaign: ({ id }) => {
        if (!id) throw new Error('id is required');
        const removed = removeCampaign(id);
        triggerUIUpdate();
        return { removed: !!removed };
    },

    // --- Family CRUD ---
    // Gerenciamento de familias (tipos de elementos)

    getFamilies: () => {
        const families = getAllFamilies();
        return Object.values(families).map((f) => ({
            id: f.id,
            name: f.name || f.nameKey || f.id,
            icon: f.icon,
            code: f.code,
            enabled: f.enabled,
            custom: !!f.custom,
        }));
    },

    addFamily: ({ id, name, icon }) => {
        if (!id) throw new Error('id is required');
        if (!name) throw new Error('name is required');
        const family = addCustomFamily(id, name, icon || 'cube');
        if (!family) throw new Error(`Failed to add family: ${id} (already exists or invalid)`);
        triggerUIUpdate();
        window.dispatchEvent(new CustomEvent('familiesChanged'));
        return family;
    },

    deleteFamily: ({ id }) => {
        if (!id) throw new Error('id is required');
        const removed = deleteFamily(id);
        if (!removed) throw new Error(`Failed to delete family: ${id} (not found or not custom)`);
        triggerUIUpdate();
        window.dispatchEvent(new CustomEvent('familiesChanged'));
        return { deleted: true };
    },

    // --- Export ---
    // Exportacao do modelo em JSON ou chave ECO1

    exportJSON: () => buildModel(),

    exportKey: async () => {
        const key = await generateKeySimple();
        return key;
    },

    // --- Import ---
    // Importacao de modelo via chave ECO ou JSON

    importKey: async ({ key }) => {
        if (!key) throw new Error('key is required');
        await importFromString(key);
        triggerUIUpdate();
        return { imported: true };
    },

    importJSON: ({ model }) => {
        if (!model) throw new Error('model is required');
        applyModel(model);
        triggerUIUpdate();
        return { imported: true };
    },

    // --- Generic action execution ---
    // Execucao generica de qualquer funcao window.* registrada
    // Stub confirm/alert durante execucao via API para evitar bloqueio do WebSocket

    executeAction: ({ action, args }) => {
        if (!action) throw new Error('action is required');

        // Validate action exists
        if (typeof window[action] !== 'function') {
            throw new Error(`Unknown action: ${action}`);
        }

        // Whitelist check: only handler-pattern functions allowed
        if (!ACTION_PATTERN.test(action)) {
            throw new Error(`Action not allowed: ${action}. Must match handler pattern.`);
        }

        // Stub confirm/alert para evitar bloqueio do JS thread
        // Dialogs nativos pausam o event loop e impedem pong do WebSocket
        const origConfirm = window.confirm;
        const origAlert = window.alert;
        window.confirm = () => true;
        window.alert = () => {};
        try {
            const result = window[action](...(Array.isArray(args) ? args : []));
            return result;
        } finally {
            window.confirm = origConfirm;
            window.alert = origAlert;
        }
    },

    // --- UI state query ---
    // Consulta estado atual da interface

    getUIState: () => ({
        selectedElement: getSelectedElement()?.id || null,
        elementCount: getAllElements().length,
        campaignCount: getAllCampaigns().length,
        sceneCount: getAllScenes().length,
        language: document.documentElement.lang || 'en',
        activeRibbonTab: document.querySelector('.menu-item.active')?.dataset?.ribbon || null,
    }),

    // --- Chat messages ---
    // Leitura das mensagens do chat do assistente IA
    getChatMessages: ({ last } = {}) => {
        const container = document.getElementById('llm-messages');
        if (!container) return [];
        const msgs = [...container.querySelectorAll('.llm-message')].map((el) => ({
            type: el.className.replace('llm-message ', '').trim(),
            text: el.textContent.trim(),
        }));
        if (last && last > 0) return msgs.slice(-last);
        return msgs;
    },

    // --- Toasts ---
    // Leitura dos toasts visiveis na tela
    getToasts: () => {
        const container = document.getElementById('toast-container');
        if (!container) return [];
        return [...container.querySelectorAll('.toast')].map((el) => ({
            type: [...el.classList].find((c) => c !== 'toast' && c !== 'show') || 'info',
            text: el.querySelector('.toast-message')?.textContent?.trim() || el.textContent.trim(),
        }));
    },

    // --- Screenshot (canvas 3D) ---
    // Captura apenas do canvas 3D como imagem PNG base64
    captureScreenshot: ({ mode } = {}) => {
        if (mode === 'full') {
            // Full page via html2canvas (carregado dinamicamente)
            return COMMANDS.captureFullScreenshot();
        }
        const renderer = getRenderer();
        if (!renderer) return null;
        const scene = getScene();
        const camera = getCamera();
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');
        return dataUrl.replace(/^data:image\/png;base64,/, '');
    },

    // --- Screenshot (full page) ---
    // Captura da pagina inteira usando html2canvas (CDN)
    captureFullScreenshot: async () => {
        // Carrega html2canvas sob demanda
        if (!window.html2canvas) {
            await loadScriptCDN('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', {
                name: 'html2canvas',
                globalVar: 'html2canvas',
            });
        }
        // Renderiza frame 3D antes da captura
        const renderer = getRenderer();
        if (renderer) {
            renderer.render(getScene(), getCamera());
        }

        // html2canvas nao captura WebGL canvas corretamente.
        // Solucao: substituir temporariamente o canvas WebGL por uma <img>
        // com o conteudo renderizado, capturar, e restaurar.
        const glCanvas = renderer?.domElement;
        let imgPlaceholder = null;
        if (glCanvas && glCanvas.parentNode) {
            try {
                const dataUrl3d = glCanvas.toDataURL('image/png');
                imgPlaceholder = document.createElement('img');
                imgPlaceholder.src = dataUrl3d;
                imgPlaceholder.style.cssText = glCanvas.style.cssText;
                imgPlaceholder.style.width = glCanvas.clientWidth + 'px';
                imgPlaceholder.style.height = glCanvas.clientHeight + 'px';
                imgPlaceholder.style.display = 'block';
                glCanvas.style.display = 'none';
                glCanvas.parentNode.insertBefore(imgPlaceholder, glCanvas);
            } catch (e) {
                imgPlaceholder = null;
            }
        }

        // Normalizar transforms de overlays que html2canvas nao captura
        // (position: absolute + transform: translateX() sao ignorados)
        const fixedEls = [];
        document.querySelectorAll('.inspector-panel.visible, .nn-side-panel.visible').forEach((el) => {
            fixedEls.push({
                el,
                transform: el.style.transform,
                position: el.style.position,
                zIndex: el.style.zIndex,
            });
            el.style.transform = 'none';
            el.style.position = 'fixed';
            el.style.zIndex = '9999';
        });

        // html2canvas falha com "addColorStop non-finite" quando elementos
        // com gradients CSS tem dimensao zero (focus-mode, collapsed).
        // Solucao: remover background-image de elementos zero-size com gradients.
        const gradientFixes = [];
        document.querySelectorAll('*').forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.height < 1 || rect.width < 1) {
                const bg = getComputedStyle(el).backgroundImage;
                if (bg && bg.includes('gradient')) {
                    gradientFixes.push({ el, bg: el.style.backgroundImage });
                    el.style.backgroundImage = 'none';
                }
            }
        });

        // html2canvas 1.4.1 nao parseia color-mix() (CSS Color Level 4).
        // Solucao: resolver via getComputedStyle() no primeiro elemento que
        // matcha o seletor e substituir temporariamente na regra CSS.
        const colorMixFixes = [];
        try {
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) {
                        if (!rule.style || !rule.cssText?.includes('color-mix(')) continue;
                        for (let j = 0; j < rule.style.length; j++) {
                            const prop = rule.style[j];
                            const val = rule.style.getPropertyValue(prop);
                            if (!val.includes('color-mix(')) continue;
                            let resolved = null;
                            try {
                                const el = document.querySelector(rule.selectorText);
                                if (el) resolved = getComputedStyle(el).getPropertyValue(prop);
                            } catch {}
                            colorMixFixes.push({ style: rule.style, prop, original: val });
                            rule.style.setProperty(prop, resolved || 'transparent');
                        }
                    }
                } catch {} // cross-origin sheets — skip
            }
        } catch (e) {
            console.warn('[API Bridge] color-mix preprocessing failed:', e.message);
        }

        // Usa document.body como alvo para capturar overlays fora de #app
        // (auth-modal, credential-modal). Dimensoes viewport para evitar
        // que html2canvas use scrollWidth (pode ser menor que a janela).
        const target = document.body;
        const captureW = Math.max(window.innerWidth, target.scrollWidth);
        const captureH = Math.max(window.innerHeight, target.scrollHeight);

        let canvas;
        try {
            canvas = await window.html2canvas(target, {
                useCORS: true,
                allowTaint: true,
                backgroundColor: null,
                scale: 1,
                logging: false,
                scrollX: 0,
                scrollY: 0,
                width: captureW,
                height: captureH,
                windowWidth: captureW,
                windowHeight: captureH,
            });
        } catch (h2cError) {
            console.warn('[API Bridge] html2canvas failed, falling back to 3D canvas:', h2cError.message);
            // Restaurar todas as modificacoes temporarias antes do fallback
            if (imgPlaceholder && glCanvas) {
                imgPlaceholder.remove();
                glCanvas.style.display = '';
            }
            fixedEls.forEach(({ el, transform, position, zIndex }) => {
                el.style.transform = transform;
                el.style.position = position;
                el.style.zIndex = zIndex;
            });
            gradientFixes.forEach(({ el, bg }) => {
                el.style.backgroundImage = bg;
            });
            colorMixFixes.forEach(({ style, prop, original }) => {
                style.setProperty(prop, original);
            });
            // Fallback: capturar apenas o canvas 3D
            return COMMANDS.captureScreenshot({ mode: '3d' });
        }

        // Restaurar canvas WebGL original
        if (imgPlaceholder && glCanvas) {
            imgPlaceholder.remove();
            glCanvas.style.display = '';
        }

        // Restaurar transforms de overlays normalizados
        fixedEls.forEach(({ el, transform, position, zIndex }) => {
            el.style.transform = transform;
            el.style.position = position;
            el.style.zIndex = zIndex;
        });

        // Restaurar gradients de elementos zero-size
        gradientFixes.forEach(({ el, bg }) => {
            el.style.backgroundImage = bg;
        });

        // Restaurar color-mix() nas regras CSS
        colorMixFixes.forEach(({ style, prop, original }) => {
            style.setProperty(prop, original);
        });

        const resultUrl = canvas.toDataURL('image/png');
        return resultUrl.replace(/^data:image\/png;base64,/, '');
    },

    // --- Open modals query ---
    // Lista todos os modais visiveis na tela (para detectar sobreposicao)
    getOpenModals: () => {
        const results = [];
        // Standard modal overlays (.modal-overlay.active or display:flex)
        document.querySelectorAll('.modal-overlay').forEach((overlay) => {
            const isVisible =
                overlay.classList.contains('active') ||
                (overlay.style.display && overlay.style.display !== 'none' && overlay.style.display !== '');
            if (isVisible) {
                const modal = overlay.querySelector('.modal') || overlay;
                const header = modal.querySelector('.modal-header');
                const closeBtn = header?.querySelector('button') || modal.querySelector('.modal-close');
                results.push({
                    id: overlay.id,
                    title:
                        modal.querySelector('.modal-title, .modal-header h2, .modal-header h3')?.textContent?.trim() ||
                        '',
                    hasHeader: !!header,
                    hasBody: !!modal.querySelector('.modal-body'),
                    hasFooter: !!modal.querySelector('.modal-footer'),
                    hasCloseButton: !!closeBtn,
                });
            }
        });
        // Auth modal overlays (.auth-modal-overlay.active)
        document.querySelectorAll('.auth-modal-overlay').forEach((overlay) => {
            if (overlay.classList.contains('active')) {
                const card = overlay.querySelector('.auth-card') || overlay;
                const subtitle = card.querySelector('.auth-subtitle');
                results.push({
                    id: overlay.id,
                    title: subtitle?.textContent?.trim() || overlay.id,
                    hasHeader: !!card.querySelector('.auth-brand'),
                    hasBody: true,
                    hasFooter: false,
                    hasCloseButton: !!card.querySelector('.auth-card-close'),
                });
            }
        });
        return results;
    },

    // --- Close all modals ---
    // Fecha todos os modais abertos (limpeza de estado)
    closeAllModals: () => {
        let closed = 0;
        // Standard overlays via closeModal
        document.querySelectorAll('.modal-overlay').forEach((overlay) => {
            const isVisible =
                overlay.classList.contains('active') ||
                (overlay.style.display && overlay.style.display !== 'none' && overlay.style.display !== '');
            if (isVisible && overlay.id) {
                if (typeof window.closeModal === 'function') {
                    window.closeModal(overlay.id);
                } else {
                    overlay.classList.remove('active');
                    overlay.style.display = 'none';
                }
                closed++;
            }
        });
        // SAO modals (dynamic, may not have .modal-overlay class)
        if (typeof window.closeSAOScenarioModal === 'function') {
            try {
                window.closeSAOScenarioModal();
            } catch {}
        }
        // Stamp modal
        if (typeof window.closeStampModal === 'function') {
            try {
                window.closeStampModal();
            } catch {}
        }
        // Edge modal
        if (typeof window.closeEdgeModal === 'function') {
            try {
                window.closeEdgeModal();
            } catch {}
        }
        return { closed };
    },

    // --- Check modal structure ---
    // Inspeciona a estrutura DOM de um modal aberto para validacao de consistencia
    checkModalStructure: ({ modalId }) => {
        const overlay = document.getElementById(modalId);
        if (!overlay) return null;
        const modal = overlay.querySelector('.modal') || overlay;
        const header = modal.querySelector('.modal-header');
        const body = modal.querySelector('.modal-body');
        const footer = modal.querySelector('.modal-footer');
        const closeBtn = header?.querySelector('button') || modal.querySelector('.modal-close');
        const title = header?.querySelector('h2, h3, .modal-title')?.textContent?.trim() || '';

        // Button classes audit
        const buttons = [...modal.querySelectorAll('button.btn')];
        const buttonInfo = buttons.map((b) => ({
            text: b.textContent.trim(),
            classes: [...b.classList].filter((c) => c !== 'btn').join(' '),
            hasValidClass:
                b.classList.contains('btn-primary') ||
                b.classList.contains('btn-secondary') ||
                b.classList.contains('btn-success') ||
                b.classList.contains('btn-danger') ||
                b.classList.contains('btn-icon') ||
                b.classList.contains('btn-link'),
        }));

        return {
            id: modalId,
            visible: overlay.classList.contains('active') || overlay.style.display !== 'none',
            title,
            structure: {
                hasHeader: !!header,
                hasBody: !!body,
                hasFooter: !!footer,
                hasCloseButton: !!closeBtn,
            },
            buttons: buttonInfo,
            dimensions: {
                width: modal.offsetWidth,
                height: modal.offsetHeight,
            },
        };
    },

    // --- UI consistency audit ---
    // Auditoria completa de consistencia visual (icones, fontes, botoes, tema)
    checkUIConsistency: () => {
        // 1. Icon hydration
        const allIcons = document.querySelectorAll('[data-icon]');
        const hydratedIcons = document.querySelectorAll('[data-icon] svg');
        const emptyIcons = [...allIcons]
            .filter((el) => !el.querySelector('svg'))
            .map((el) => el.getAttribute('data-icon'));

        // 2. Font families
        const bodyFont = getComputedStyle(document.body).fontFamily;

        // 3. Open modals (should be 0 for clean state)
        const openModals = [];
        document.querySelectorAll('.modal-overlay').forEach((o) => {
            if (
                o.classList.contains('active') ||
                (o.style.display && o.style.display !== 'none' && o.style.display !== '')
            ) {
                openModals.push(o.id);
            }
        });

        // 4. Buttons audit
        const allBtns = [...document.querySelectorAll('button')];
        const styledBtns = allBtns.filter((b) => b.classList.contains('btn'));
        const modalCloseBtns = allBtns.filter((b) => b.classList.contains('modal-close'));

        // 5. CSS theme variables loaded
        const root = getComputedStyle(document.documentElement);
        const themeVars = {
            primary500: root.getPropertyValue('--primary-500').trim(),
            accent500: root.getPropertyValue('--accent-500').trim(),
            neutral800: root.getPropertyValue('--neutral-800').trim(),
            radiusSm: root.getPropertyValue('--radius-sm').trim(),
            space2: root.getPropertyValue('--space-2').trim(),
        };

        // 6. Form inputs
        const classedInputs = document.querySelectorAll(
            'input.form-input, select.form-input, textarea.form-textarea',
        ).length;
        const unclassedInputs = [
            ...document.querySelectorAll(
                'input:not(.form-input):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]):not([type="color"]):not([type="range"])',
            ),
        ].length;

        return {
            icons: {
                total: allIcons.length,
                hydrated: hydratedIcons.length,
                empty: emptyIcons.slice(0, 20),
            },
            fonts: { body: bodyFont },
            modals: { openCount: openModals.length, openIds: openModals },
            buttons: { total: allBtns.length, styled: styledBtns.length, modalClose: modalCloseBtns.length },
            theme: { loaded: !!themeVars.primary500, vars: themeVars },
            forms: { classed: classedInputs, unclassed: unclassedInputs },
        };
    },

    // --- Action registry ---
    getActionRegistry: () => ACTION_REGISTRY,

    // --- Groups ---
    // Estado dos agrupamentos de elementos e familias

    getGroups: () => exportGroups(),

    getGroup: ({ id }) => {
        if (!id) throw new Error('id is required');
        const g = getGroupById(id);
        if (!g) throw new Error(`Group not found: ${id}`);
        return g;
    },

    // --- Auth ---
    // Estado de autenticacao e controle de acesso

    getAuthStatus: () => ({
        user: getCurrentUser(),
        loggedIn: isLoggedIn(),
        email: getUserEmail(),
        role: getUserRole(),
        observerMode: getObserverMode(),
        accessControlActive: isAccessControlActive(),
        owner: getOwner(),
    }),

    getAccessRules: () => getRules(),

    getPermissions: () => exportPermissions(),

    // --- Ticker ---
    // Configuracao e valores calculados da barra de metricas

    getTicker: () => exportTicker(),

    getTickerValues: () => computeTickerAll(),

    // --- SAO ---
    // Estado do protocolo SAO (cenarios, matrizes, parametros ativos)

    getSAOStatus: () => ({
        active: isSAOActive(),
        scenario: getActiveScenario(),
        tier: getActiveTier(),
        matrices: getActiveMatrixIds(),
        parameterCounts: getParameterCounts(),
    }),

    getSAOParameters: () => getActiveParameters(),

    // --- Governance ---
    // Contratos e WBS extraidos do modelo completo

    getGovernance: () => {
        const m = buildModel();
        return m.governance || null;
    },

    // --- Sensors ---
    // Dados de sensores IoT com hidratacao dinamica

    getSensorData: async ({ elementId }) => {
        if (!elementId) throw new Error('elementId is required');
        const el = getElementById(elementId);
        if (!el) throw new Error(`Element not found: ${elementId}`);
        if (el.family !== 'sensor') throw new Error(`Element ${elementId} is not a sensor`);
        return await getSensorAppData(el);
    },

    // --- Agents ---
    // Agentes IA (system + user)

    getAgents: () => getAllAgents(),

    getAgent: ({ id }) => {
        if (!id) throw new Error('id is required');
        const a = getAgentById(id);
        if (!a) throw new Error(`Agent not found: ${id}`);
        return a;
    },

    getActiveAgentId: () => ({ id: getActiveAgent() }),

    // --- Stamps (all elements) ---
    // Estampas de todos os elementos em uma unica consulta

    getAllStamps: () => {
        return getAllElements()
            .filter((el) => el.stamps?.length)
            .map((el) => ({
                elementId: el.id,
                elementName: el.name,
                family: el.family,
                stamps: el.stamps,
            }));
    },

    // --- LLM Configuration ---
    // Configuracao do provedor LLM via API (para testes automatizados)

    configureLLM: ({ provider, apiKey, model } = {}) => {
        if (provider) setProvider(provider);
        if (apiKey) setApiKey(apiKey);
        if (model) setModel(model);
        return {
            provider: getProvider(),
            model: getModel(),
            hasKey: hasApiKey(),
            providerConfig: getProviderConfig(getProvider())?.name || null,
        };
    },

    getLLMConfig: () => ({
        provider: getProvider(),
        model: getModel(),
        hasKey: hasApiKey(),
        providerConfig: getProviderConfig(getProvider())?.name || null,
    }),

    testLLMConnection: async () => {
        return testConnection();
    },

    // --- Aerial Recognition (full pipeline) ---
    // Roda analise aerea e importa features como elementos 3D direto

    runAerialRecognition: async ({ method, includeAI, resolution, calibration } = {}) => {
        const { analyzeByColor } = await import('../../core/recognition/colorAnalysis.js');
        const { analyzeWithAI, loadImageAsDataUrl } = await import('../../core/recognition/analyzer.js');
        const { addElement, getAllElements, removeElement } = await import('../../core/elements/manager.js');
        const { generateId } = await import('../helpers/id.js');
        const { addElementGroup, setElementGroup } = await import('../groups/manager.js');

        // Find boundary with overlay
        const boundary = getAllElements().find((e) => e.family === 'boundary' && e.data?.overlayUrl);
        if (!boundary) return { error: 'No boundary with overlay URL' };

        const verts = boundary.data.vertices || [];
        let minX = Infinity,
            maxX = -Infinity,
            minZ = Infinity,
            maxZ = -Infinity;
        for (const v of verts) {
            if (v.x < minX) minX = v.x;
            if (v.x > maxX) maxX = v.x;
            if (v.z < minZ) minZ = v.z;
            if (v.z > maxZ) maxZ = v.z;
        }
        const extent = { minX, maxX, minZ, maxZ };

        // Load image
        const res = resolution || 512;
        const dataUrl = await loadImageAsDataUrl(boundary.data.overlayUrl, res);

        // Run analysis
        let features;
        const useAI = method === 'ai' || includeAI;
        if (useAI) {
            const { analyzeWithAI: aiAnalyze } = await import('../../core/recognition/analyzer.js');
            features = await aiAnalyze(dataUrl, extent);
        } else if (method === 'ml') {
            const { analyzeWithML: mlAnalyze } = await import('../../core/recognition/analyzer.js');
            features = await mlAnalyze(dataUrl, extent);
        } else {
            features = await analyzeByColor(dataUrl, extent, calibration || null);
        }

        if (!features || features.length === 0) return { count: 0, features: [] };

        // Assign sequential names
        const familyCounts = {};
        const LABELS = {
            building: 'Edificacao',
            tank: 'Tanque',
            lake: 'Lago',
            river: 'Rio',
            habitat: 'Habitat',
            well: 'Poco',
            marker: 'Ponto',
        };
        for (const f of features) {
            familyCounts[f.family] = (familyCounts[f.family] || 0) + 1;
            f.label = `${LABELS[f.family] || f.family} ${familyCounts[f.family]}`;
        }

        // Create group
        const group = addElementGroup({ name: 'Aerial Recognition', color: '#4dabf7' });
        const createdIds = [];

        for (const feature of features) {
            const id = generateId(feature.family);
            const pos = feature.position;
            const dims = feature.dimensions || {};
            const rotDeg = Math.round((((feature.rotation || 0) * 180) / Math.PI) * 10) / 10;
            let data;

            switch (feature.family) {
                case 'building': {
                    // Cap building footprint to 60m per side to avoid covering the overlay
                    const fp = dims.footprint || { width: 10, length: 10 };
                    fp.width = Math.min(fp.width, 60);
                    fp.length = Math.min(fp.length, 60);
                    data = {
                        position: { x: pos.x, y: 0, z: pos.z },
                        footprint: fp,
                        height: dims.height || 6,
                        type: dims.type || 'industrial',
                        rotation: { x: 0, y: rotDeg, z: 0 },
                        observations: [],
                    };
                    break;
                }
                case 'tank':
                    data = {
                        position: { x: pos.x, y: 0, z: pos.z },
                        dimensions: dims.dimensions || { diameter: 5, length: 5 },
                        type: dims.type || 'aboveground',
                        contents: 'unknown',
                        rotation: { x: 0, y: rotDeg, z: 0 },
                        observations: [],
                    };
                    break;
                case 'lake':
                    data = {
                        position: { x: pos.x, y: 0, z: pos.z },
                        shape: dims.shape || { radiusX: 10, radiusY: 8, depth: 3 },
                        observations: [],
                    };
                    break;
                case 'river':
                    data = {
                        path: dims.path || [
                            { x: pos.x - 20, y: 0, z: pos.z },
                            { x: pos.x + 20, y: 0, z: pos.z },
                        ],
                        width: dims.width || 3,
                        observations: [],
                    };
                    break;
                case 'habitat':
                    data = {
                        position: { x: pos.x, y: 0, z: pos.z },
                        habitatType: dims.habitatType || 'forest',
                        protectionStatus: 'none',
                        area: Math.min(dims.area || 100, 500),
                        footprint: dims.footprint || null,
                        observations: [],
                    };
                    break;
                case 'well':
                    data = {
                        coordinates: { easting: pos.x, northing: pos.z, elevation: 0 },
                        construction: { totalDepth: 30, diameter: 4, screenTop: 10, screenBottom: 25 },
                        observations: [],
                    };
                    break;
                default:
                    data = { position: { x: pos.x, y: 0, z: pos.z }, observations: [] };
            }

            try {
                addElement(feature.family, id, feature.label, data);
                createdIds.push(id);
            } catch (e) {
                /* skip */
            }
        }

        // Assign to group
        for (const id of createdIds) setElementGroup(id, group.id);

        // Update UI
        window.dispatchEvent(new CustomEvent('apiBridgeUpdate'));

        return {
            count: createdIds.length,
            features: features.map((f) => ({
                family: f.family,
                label: f.label,
                confidence: f.confidence,
                position: f.position,
            })),
        };
    },

    // Debug SegFormer model output
    debugSegFormer: async () => {
        const { getAllElements } = await import('../../core/elements/manager.js');
        const { loadImageAsDataUrl } = await import('../../core/recognition/analyzer.js');
        const { debugSegFormer: dbg } = await import('../../core/recognition/segformerDetector.js');

        const boundary = getAllElements().find((e) => e.family === 'boundary' && e.data?.overlayUrl);
        if (!boundary) return { error: 'No boundary with overlay' };

        const dataUrl = await loadImageAsDataUrl(boundary.data.overlayUrl, 512);
        return await dbg(dataUrl);
    },

    // Auto-calibrate aerial recognition from boundary image
    autoCalibrate: async ({ resolution } = {}) => {
        const { getAllElements } = await import('../../core/elements/manager.js');
        const { loadImageAsDataUrl } = await import('../../core/recognition/analyzer.js');
        const { autoCalibrate: autoCal } = await import('../../core/recognition/calibration.js');

        const boundary = getAllElements().find((e) => e.family === 'boundary' && e.data?.overlayUrl);
        if (!boundary) return { error: 'No boundary with overlay' };

        const res = resolution || 512;
        const dataUrl = await loadImageAsDataUrl(boundary.data.overlayUrl, res);

        // Load into offscreen canvas
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('Failed to load image'));
            i.src = dataUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = res;
        canvas.height = res;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, res, res);
        const imageData = ctx.getImageData(0, 0, res, res);

        return autoCal(imageData.data, res, res);
    },

    // Remove elements by family (for cleanup)
    removeElementsByFamily: async ({ familyId } = {}) => {
        const { getAllElements, removeElement } = await import('../../core/elements/manager.js');
        const toRemove = getAllElements()
            .filter((e) => e.family === familyId)
            .map((e) => e.id);
        toRemove.forEach((id) => removeElement(id));
        window.dispatchEvent(new CustomEvent('apiBridgeUpdate'));
        return { removed: toRemove.length };
    },

    // Remove non-boundary elements (clean slate for recognition test)
    removeNonBoundaryElements: async () => {
        const { getAllElements, removeElement } = await import('../../core/elements/manager.js');
        const toRemove = getAllElements()
            .filter((e) => e.family !== 'boundary')
            .map((e) => e.id);
        toRemove.forEach((id) => removeElement(id));
        window.dispatchEvent(new CustomEvent('apiBridgeUpdate'));
        return { removed: toRemove.length };
    },

    // --- Aerial Diagnostic ---
    // Analise diagnostica do reconhecimento aereo (import dinamico)

    runAerialDiagnostic: async ({ includeAI, resolution } = {}) => {
        const { runDiagnostic } = await import('../../core/recognition/diagnostic.js');
        return runDiagnostic({ includeAI: !!includeAI, resolution: resolution || 512 });
    },

    // --- Expression reader (test helper) ---
    // Leitura segura de expressoes literais e caminhos simples (sem eval)
    evalExpr: ({ expr }) => {
        if (typeof expr !== 'string' || !expr.trim()) {
            throw new Error('expr must be a non-empty string');
        }
        const raw = expr.trim();

        if (raw === 'true') return true;
        if (raw === 'false') return false;
        if (raw === 'null') return null;
        if (raw === 'undefined') return undefined;

        if (/^-?\d+(\.\d+)?$/.test(raw)) {
            return Number(raw);
        }

        if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
            return raw.slice(1, -1);
        }

        if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
            return JSON.parse(raw);
        }

        if (/^(window\.)?[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(raw)) {
            const path = raw.startsWith('window.') ? raw.slice('window.'.length) : raw;
            return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), window);
        }

        throw new Error('Unsupported expression format (eval disabled by CSP)');
    },

    // --- DOM Query ---
    // Inspeciona elementos pelo seletor CSS (para testes de UI)
    // Pipeline automation
    getPipelines: () => {
        const { getAllPipelines } = window.__pipelinesModule || {};
        if (getAllPipelines) return getAllPipelines();
        // Fallback: read directly from localStorage
        try {
            return Object.values(JSON.parse(localStorage.getItem('ecbyts-pipelines') || '{}'));
        } catch {
            return [];
        }
    },
    getPipeline: ({ id }) => {
        try {
            const m = JSON.parse(localStorage.getItem('ecbyts-pipelines') || '{}');
            return m[id] || null;
        } catch {
            return null;
        }
    },
    savePipeline: (entry) => {
        if (typeof window.handleSavePipeline === 'function') return window.handleSavePipeline();
        return null;
    },
    deletePipeline: ({ id }) => {
        if (typeof window.handleDeletePipeline === 'function') return window.handleDeletePipeline(id);
        return null;
    },
    runPipeline: async ({ id }) => {
        if (typeof window.handleRunPipeline === 'function') return window.handleRunPipeline(id);
        return null;
    },

    queryDOM: ({ selector, props = [] }) => {
        const els = document.querySelectorAll(selector);
        return [...els].map((el) => {
            const result = { tagName: el.tagName, text: el.textContent?.trim()?.substring(0, 200) };
            if (props.includes('html')) result.html = el.innerHTML.substring(0, 500);
            if (props.includes('style')) {
                const cs = getComputedStyle(el);
                result.style = {
                    color: cs.color,
                    bg: cs.backgroundColor,
                    display: cs.display,
                    height: cs.height,
                    overflow: cs.overflow,
                    visibility: cs.visibility,
                };
            }
            if (props.includes('box')) {
                const r = el.getBoundingClientRect();
                result.box = {
                    x: Math.round(r.x),
                    y: Math.round(r.y),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                };
            }
            if (props.includes('classes')) result.classes = [...el.classList];
            return result;
        });
    },
};

// ================================================================
// COMMAND DISPATCH
// ================================================================

async function handleCommand(msg) {
    const { requestId, command, args } = msg;

    try {
        const handler = COMMANDS[command];
        if (!handler) {
            throw new Error(`Unknown command: ${command}`);
        }

        let data = handler(args || {});

        // Await if Promise returned
        if (data && typeof data.then === 'function') {
            data = await data;
        }

        sendResponse(requestId, true, data);
    } catch (e) {
        sendResponse(requestId, false, null, e.message);
    }
}

// ================================================================
// WEBSOCKET COMMUNICATION
// ================================================================

function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

function sendResponse(requestId, success, data, error) {
    send({
        type: 'response',
        requestId,
        success,
        data: data !== undefined ? data : null,
        error: error || null,
    });
}

// ================================================================
// HELPERS
// ================================================================

/**
 * Trigger full UI refresh via custom event.
 * O bridge nao importa updateAllUI() diretamente (funcao local do main.js).
 * Em vez disso, dispara um evento customizado que o main.js escuta.
 * Mesmo padrao usado por languageChanged e familiesChanged.
 */
function triggerUIUpdate() {
    window.dispatchEvent(new CustomEvent('apiBridgeUpdate'));
}

/**
 * Simplify element for JSON serialization.
 * Remove referencias de mesh/Three.js que nao sao serializaveis.
 * @param {Object} el - Element object from manager
 * @returns {Object} Simplified element safe for JSON
 */
function simplifyElement(el) {
    if (!el) return null;
    return {
        id: el.id,
        family: el.family,
        name: el.name,
        visible: el.visible,
        label: el.label,
        color: el.color,
        iconClass: el.iconClass,
        description: el.description || '',
        data: el.data,
        stamps: el.stamps || [],
    };
}

/**
 * Discover all available window.* actions matching handler pattern.
 * Descobre todas as funcoes window.* que podem ser executadas via API.
 * @returns {string[]} Sorted array of action names
 */
function discoverActions() {
    const actions = [];
    for (const key of Object.keys(window)) {
        if (typeof window[key] === 'function' && ACTION_PATTERN.test(key)) {
            actions.push(key);
        }
    }
    return actions.sort();
}

// ================================================================
// WINDOW API (for browser console access)
// Expoe API no console do browser para uso direto
// ================================================================

function registerOnWindow() {
    window.__ECBYTS_API__ = {
        // State queries
        getState: COMMANDS.getState,
        getElements: COMMANDS.getElements,
        getElement: COMMANDS.getElement,
        getCampaigns: COMMANDS.getCampaigns,
        getScenes: COMMANDS.getScenes,
        getEdges: COMMANDS.getEdges,
        getStamps: COMMANDS.getStamps,
        getStamp: COMMANDS.getStamp,
        getEdgesByElement: COMMANDS.getEdgesByElement,
        getEdge: COMMANDS.getEdge,
        getObservations: COMMANDS.getObservations,
        getPanelState: COMMANDS.getPanelState,

        // Campaign/Scene CRUD
        updateCampaign: COMMANDS.updateCampaign,
        addScene: COMMANDS.addScene,
        removeScene: COMMANDS.removeScene,
        switchTab: COMMANDS.switchTab,

        // Family CRUD
        getFamilies: COMMANDS.getFamilies,
        addFamily: COMMANDS.addFamily,
        deleteFamily: COMMANDS.deleteFamily,

        // Element CRUD
        addElement: COMMANDS.addElement,
        removeElement: COMMANDS.removeElement,
        updateElement: COMMANDS.updateElement,
        selectElement: COMMANDS.selectElement,

        // Export/Import
        exportJSON: COMMANDS.exportJSON,
        exportKey: COMMANDS.exportKey,
        importKey: COMMANDS.importKey,
        importJSON: COMMANDS.importJSON,

        // Generic action
        executeAction: COMMANDS.executeAction,

        // UI
        getUIState: COMMANDS.getUIState,

        // Chat & Toasts
        getChatMessages: COMMANDS.getChatMessages,
        getToasts: COMMANDS.getToasts,

        // Screenshot
        captureScreenshot: COMMANDS.captureScreenshot,
        captureFullScreenshot: COMMANDS.captureFullScreenshot,

        // Modal inspection
        getOpenModals: COMMANDS.getOpenModals,
        closeAllModals: COMMANDS.closeAllModals,
        checkModalStructure: COMMANDS.checkModalStructure,
        checkUIConsistency: COMMANDS.checkUIConsistency,

        // Connection status
        isConnected: () => ws && ws.readyState === WebSocket.OPEN,

        // Action registry
        getActions: () => ACTION_REGISTRY,

        // Groups
        getGroups: COMMANDS.getGroups,
        getGroup: COMMANDS.getGroup,

        // Auth & Permissions
        getAuthStatus: COMMANDS.getAuthStatus,
        getAccessRules: COMMANDS.getAccessRules,
        getPermissions: COMMANDS.getPermissions,

        // Ticker
        getTicker: COMMANDS.getTicker,
        getTickerValues: COMMANDS.getTickerValues,

        // SAO Protocol
        getSAOStatus: COMMANDS.getSAOStatus,
        getSAOParameters: COMMANDS.getSAOParameters,

        // Governance
        getGovernance: COMMANDS.getGovernance,

        // Sensors
        getSensorData: COMMANDS.getSensorData,

        // Agents
        getAgents: COMMANDS.getAgents,
        getAgent: COMMANDS.getAgent,
        getActiveAgentId: COMMANDS.getActiveAgentId,

        // All stamps (cross-element)
        getAllStamps: COMMANDS.getAllStamps,

        // LLM configuration
        configureLLM: COMMANDS.configureLLM,
        getLLMConfig: COMMANDS.getLLMConfig,
        testLLMConnection: COMMANDS.testLLMConnection,

        // Aerial recognition (full pipeline)
        runAerialRecognition: COMMANDS.runAerialRecognition,
        autoCalibrate: COMMANDS.autoCalibrate,
        removeElementsByFamily: COMMANDS.removeElementsByFamily,
        removeNonBoundaryElements: COMMANDS.removeNonBoundaryElements,
        debugSegFormer: COMMANDS.debugSegFormer,

        // Aerial diagnostic
        runAerialDiagnostic: COMMANDS.runAerialDiagnostic,

        // DOM query
        queryDOM: COMMANDS.queryDOM,

        // Pipeline automation
        getPipelines: COMMANDS.getPipelines,
        getPipeline: COMMANDS.getPipeline,
        savePipeline: COMMANDS.savePipeline,
        deletePipeline: COMMANDS.deletePipeline,
        runPipeline: COMMANDS.runPipeline,
    };
}
