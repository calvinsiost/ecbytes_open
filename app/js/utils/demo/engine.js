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
   DEMO ENGINE — Interactive onboarding state machine
   Motor de demonstracao interativa para onboarding de usuarios

   Gerencia o ciclo de vida do modo demo:
   - Carrega 50 casos pre-definidos em 4 verticais
   - Executa steps interativos com acoes visuais
   - Salva/restaura estado para cleanup limpo

   VERTICAIS: mining, forestry, contamination, occupational_health
   MODULOS: neural_net, ai_bot, satellite

   ================================================================ */

import { addElement, removeElement, getAllElements } from '../../core/elements/manager.js';
import { getFamily } from '../../core/elements/families.js';
import { getCameraState, animateCameraState } from '../scene/controls.js';
import { getElementsGroup, requestRender } from '../scene/setup.js';
import { showToast } from '../ui/toast.js';
import { fetchDemoCases, generateMockCases } from './cases.js';
import { addDemoTickerLogs, clearDemoTickerLogs, simulateTickerSequence } from './ticker.js';
import { createHeatmapGrid, createWorkerRoutes, removeAllHeatmaps } from './heatmap.js';

// ----------------------------------------------------------------
// MODULE STATE
// Estado do modulo — closure privada
// ----------------------------------------------------------------

/**
 * @typedef {'mining'|'forestry'|'contamination'|'occupational_health'} DemoVertical
 * @typedef {'neural_net'|'ai_bot'|'satellite'} DemoModule
 * @typedef {'low'|'med'|'high'} RiskLevel
 *
 * @typedef {Object} DemoState
 * @property {boolean} active
 * @property {Object|null} currentCase
 * @property {number} currentStep
 * @property {string[]} createdElementIds
 * @property {string[]} createdTickerIds
 * @property {Object|null} savedCameraState
 * @property {boolean} isAnimating
 * @property {number} maxStepReached - Furthest step reached (for prev navigation)
 */

/** @type {DemoState} */
let state = createInitialState();

/** @type {Array<Object>} All 50 demo cases */
let allCases = [];

/** @type {Function|null} updateAllUI callback */
let updateAllUI = null;

/** @type {number|null} Active ticker simulation interval */
let tickerInterval = null;

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function createInitialState() {
    return {
        active: false,
        currentCase: null,
        currentStep: -1,
        createdElementIds: [],
        createdTickerIds: [],
        savedCameraState: null,
        isAnimating: false,
        maxStepReached: -1,
    };
}

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Initialize demo engine.
 * Busca cases do Supabase (async), com fallback local.
 */
export async function initDemo() {
    state = createInitialState();
    // Carrega fallback imediato, depois busca Supabase em background
    allCases = generateMockCases();
    try {
        const remoteCases = await fetchDemoCases();
        if (remoteCases.length > 0) {
            allCases = remoteCases;
        }
    } catch (e) {
        console.warn('[Demo] Using fallback cases:', e.message);
    }
}

/**
 * Inject updateAllUI callback.
 * @param {Function} fn
 */
export function setDemoUpdateAllUI(fn) {
    updateAllUI = fn;
}

// ----------------------------------------------------------------
// STATE ACCESS
// ----------------------------------------------------------------

/** @returns {DemoState} Current demo state */
export function getDemoState() {
    return { ...state };
}

/** @returns {boolean} Whether demo is active */
export function isActive() {
    return state.active;
}

/** @returns {Array<Object>} All cases */
export function getAllCases() {
    return allCases;
}

/**
 * Get cases filtered by vertical.
 * @param {DemoVertical} vertical
 * @returns {Array<Object>}
 */
export function getCasesByVertical(vertical) {
    return allCases.filter((c) => c.vertical === vertical);
}

/**
 * Get cases filtered by vertical and module.
 * @param {DemoVertical} vertical
 * @param {DemoModule} module
 * @returns {Array<Object>}
 */
export function getCasesByVerticalAndModule(vertical, module) {
    return allCases.filter((c) => c.vertical === vertical && c.module === module);
}

/**
 * Get a random case for a vertical (optionally filtered by module).
 * @param {DemoVertical} vertical
 * @param {DemoModule} [module]
 * @returns {Object|null}
 */
export function getRandomCase(vertical, module) {
    const pool = module ? getCasesByVerticalAndModule(vertical, module) : getCasesByVertical(vertical);
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ----------------------------------------------------------------
// DEMO LIFECYCLE
// ----------------------------------------------------------------

/**
 * Start demo with a specific case.
 * Salva estado atual, cria elementos do caso, e vai pro step 0.
 *
 * @param {string} caseId
 * @returns {Promise<boolean>} true if started successfully
 */
export async function startDemo(caseId) {
    const demoCase = allCases.find((c) => c.id === caseId);
    if (!demoCase) {
        showToast('Demo case not found', 'error');
        return false;
    }

    // Salva estado atual para restaurar depois
    state.savedCameraState = getCameraState();
    state.active = true;
    state.currentCase = demoCase;
    state.currentStep = -1;
    state.maxStepReached = -1;
    state.createdElementIds = [];
    state.createdTickerIds = [];

    // Cria elementos iniciais do caso
    if (demoCase.elements && demoCase.elements.length > 0) {
        for (const elDef of demoCase.elements) {
            try {
                const el = addElement(elDef.family, elDef.id, elDef.name, elDef.data, elDef.meta || {});
                if (el) {
                    state.createdElementIds.push(el.id);
                }
            } catch (e) {
                console.warn('[Demo] Erro ao criar elemento:', e.message);
            }
        }
    }

    // Anima camera para posicao inicial do caso
    if (demoCase.initialCamera) {
        await animateCameraState(demoCase.initialCamera, 1000);
    }

    // Dispara evento para UI
    window.dispatchEvent(new CustomEvent('demoChanged'));
    if (updateAllUI) updateAllUI();

    // Avanca para o primeiro step
    await nextStep();

    return true;
}

/**
 * Advance to the next step.
 * @returns {Promise<boolean>}
 */
export async function nextStep() {
    if (!state.active || !state.currentCase) return false;
    if (state.isAnimating) return false;

    const steps = state.currentCase.steps;
    const nextIdx = state.currentStep + 1;

    if (nextIdx >= steps.length) {
        // Fim da demo — mostra toast de conclusao
        showToast('Demo completed! Click exit to return.', 'success', 0);
        return false;
    }

    state.currentStep = nextIdx;
    if (nextIdx > state.maxStepReached) {
        state.maxStepReached = nextIdx;
    }

    // Executa a acao do step
    await executeStep(steps[nextIdx]);

    window.dispatchEvent(new CustomEvent('demoChanged'));
    if (updateAllUI) updateAllUI();
    return true;
}

/**
 * Go back to the previous step.
 * Restaura visual do step anterior.
 * @returns {Promise<boolean>}
 */
export async function prevStep() {
    if (!state.active || !state.currentCase) return false;
    if (state.isAnimating) return false;
    if (state.currentStep <= 0) return false;

    state.currentStep--;

    // Re-executa o step atual (restaura visual)
    const steps = state.currentCase.steps;
    await executeStep(steps[state.currentStep]);

    window.dispatchEvent(new CustomEvent('demoChanged'));
    if (updateAllUI) updateAllUI();
    return true;
}

/**
 * Exit demo mode, cleanup everything.
 * Remove elementos criados, restaura camera, limpa ticker.
 * @returns {Promise<void>}
 */
export async function exitDemo() {
    if (!state.active) return;

    state.isAnimating = true;

    // Para qualquer ticker simulation em andamento
    if (tickerInterval) {
        clearInterval(tickerInterval);
        tickerInterval = null;
    }

    // Remove heatmaps criados na demo
    removeAllHeatmaps();

    // Remove elementos criados pela demo (em ordem reversa)
    const idsToRemove = [...state.createdElementIds].reverse();
    for (const id of idsToRemove) {
        try {
            removeElement(id);
        } catch (e) {
            console.warn('[Demo] Erro ao remover elemento:', e.message);
        }
    }

    // Limpa ticker logs da demo
    clearDemoTickerLogs();

    // Restaura camera
    if (state.savedCameraState) {
        await animateCameraState(state.savedCameraState, 600);
    }

    // Reseta estado
    state = createInitialState();

    window.dispatchEvent(new CustomEvent('demoChanged'));
    if (updateAllUI) updateAllUI();
    requestRender();
}

// ----------------------------------------------------------------
// STEP EXECUTION ENGINE
// Executa acoes visuais de cada step
// ----------------------------------------------------------------

/**
 * Execute a single step action.
 * Interpreta o tipo da acao e executa o efeito visual correspondente.
 *
 * @param {Object} step - The step to execute
 */
async function executeStep(step) {
    state.isAnimating = true;

    try {
        // Delay opcional antes da acao
        if (step.delay && step.delay > 0) {
            await sleep(step.delay);
        }

        switch (step.action) {
            case 'camera':
                await executeCameraAction(step.params);
                break;

            case 'addElements':
                executeAddElements(step.params);
                break;

            case 'toggleLayer':
                executeToggleLayer(step.params);
                break;

            case 'simulateAI':
                await executeSimulateAI(step.params);
                break;

            case 'showToast':
                showToast(
                    step.params.message,
                    step.params.type || 'info',
                    0, // persistente — usuario fecha manualmente
                );
                break;

            case 'tickerLog':
                executeTicker(step.params);
                break;

            case 'highlight':
                executeHighlight(step.params);
                break;

            case 'heatmap':
                executeHeatmap(step.params);
                break;

            case 'composite':
                for (const subStep of step.params.actions) {
                    await executeStep(subStep);
                }
                break;

            default:
                console.warn(`[Demo] Acao desconhecida: ${step.action}`);
        }

        // Mostra descricao narrativa como toast se presente
        if (step.description) {
            showToast(step.description, 'info', 0);
        }
    } catch (e) {
        console.error('[Demo] Erro ao executar step:', e);
    } finally {
        state.isAnimating = false;
    }
}

// ----------------------------------------------------------------
// ACTION EXECUTORS
// Implementacao de cada tipo de acao
// ----------------------------------------------------------------

async function executeCameraAction(params) {
    if (params.target) {
        await animateCameraState(params.target, params.duration || 800);
    }
}

function executeAddElements(params) {
    if (!params.elements) return;
    for (const elDef of params.elements) {
        try {
            const el = addElement(elDef.family, elDef.id, elDef.name, elDef.data, elDef.meta || {});
            if (el) {
                state.createdElementIds.push(el.id);
            }
        } catch (e) {
            console.warn('[Demo] Erro ao criar elemento no step:', e.message);
        }
    }
    requestRender();
}

function executeToggleLayer(params) {
    // Usa import dinamico para evitar dependencia circular
    import('../../core/elements/manager.js').then(({ setElementVisibility }) => {
        if (params.elementId) {
            setElementVisibility(params.elementId, params.visible !== false);
        }
        requestRender();
    });
}

async function executeSimulateAI(params) {
    const logs = params.logs || [];
    const duration = params.duration || 3000;

    // Mostra logs no ticker com efeito sequencial
    if (logs.length > 0) {
        await simulateTickerSequence(logs, Math.floor(duration / logs.length));
    }

    // Efeito de glow no elemento alvo (se especificado)
    if (params.glowTarget) {
        executeHighlight({ elementId: params.glowTarget, duration: 2000 });
    }
}

function executeTicker(params) {
    if (params.logs) {
        addDemoTickerLogs(params.logs);
    }
}

function executeHighlight(params) {
    if (!params.elementId) return;

    // Busca mesh do elemento e aplica efeito pulsante
    import('../../core/elements/manager.js').then(({ getMeshByElementId }) => {
        const mesh = getMeshByElementId(params.elementId);
        if (!mesh) return;

        const originalEmissive = mesh.material?.emissive?.clone();
        const originalIntensity = mesh.material?.emissiveIntensity || 0;
        const dur = params.duration || 2000;

        if (mesh.material && mesh.material.emissive) {
            mesh.material.emissive.setHex(params.color ? parseInt(params.color.replace('#', ''), 16) : 0x44ff44);
            mesh.material.emissiveIntensity = 0.5;
            requestRender();

            setTimeout(() => {
                if (originalEmissive) mesh.material.emissive.copy(originalEmissive);
                mesh.material.emissiveIntensity = originalIntensity;
                requestRender();
            }, dur);
        }
    });
}

function executeHeatmap(params) {
    if (params.grid) {
        createHeatmapGrid(params);
    }
    if (params.routes) {
        createWorkerRoutes(params.routes);
    }
    requestRender();
}

// ----------------------------------------------------------------
// UTILITIES
// ----------------------------------------------------------------

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
