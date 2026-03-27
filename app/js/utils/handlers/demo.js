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
   DEMO HANDLERS — Window functions for demo mode UI
   Funcoes globais para o modo de demonstracao interativa

   Expoe funcoes no window.* para onclick do HTML.
   Conecta a UI com o demo engine.
   ================================================================ */

import {
    initDemo,
    startDemo,
    nextStep,
    prevStep,
    exitDemo,
    getDemoState,
    getAllCases,
    getCasesByVertical,
    getRandomCase,
    isActive,
    setDemoUpdateAllUI,
} from '../demo/engine.js';

import {
    initDemoUI,
    renderDemoController,
    showDemoPanel,
    hideDemoPanel,
    showNavigationOverlay,
    hideNavigationOverlay,
} from '../ui/demoController.js';

import { showToast } from '../ui/toast.js';

// ----------------------------------------------------------------
// UPDATE INJECTION
// ----------------------------------------------------------------

let updateAllUI = null;

/**
 * Inject updateAllUI callback.
 * @param {Function} fn
 */
export function setDemoHandlerUpdateAllUI(fn) {
    updateAllUI = fn;
    setDemoUpdateAllUI(fn);
}

// ----------------------------------------------------------------
// SELECTED STATE
// ----------------------------------------------------------------

let selectedVertical = null;
let selectedModule = null;
let demoInitialized = false;

// ----------------------------------------------------------------
// HANDLERS
// ----------------------------------------------------------------

/**
 * Open demo panel (FAB click).
 * Abre o painel de selecao de vertical/modulo.
 * Inicializa demo engine sob demanda na primeira abertura.
 */
async function handleOpenDemo() {
    if (!demoInitialized) {
        await initDemo();
        demoInitialized = true;
    }
    if (isActive()) {
        // Se demo ja esta ativa, mostra overlay
        const state = getDemoState();
        if (state.currentCase) {
            showNavigationOverlay(state);
        }
        return;
    }
    selectedVertical = null;
    selectedModule = null;
    showDemoPanel();
    renderDemoController(getDemoState(), selectedVertical, selectedModule);
}

/**
 * Close demo panel.
 * Fecha o painel sem iniciar demo.
 */
function handleCloseDemo() {
    hideDemoPanel();
}

/**
 * Select a vertical.
 * @param {string} vertical - 'mining'|'forestry'|'contamination'|'occupational_health'
 */
function handleSelectVertical(vertical) {
    selectedVertical = vertical;
    selectedModule = null;
    renderDemoController(getDemoState(), selectedVertical, selectedModule);
}

/**
 * Select a module.
 * @param {string} module - 'neural_net'|'ai_bot'|'satellite'
 */
function handleSelectModule(module) {
    selectedModule = module;
    renderDemoController(getDemoState(), selectedVertical, selectedModule);
}

/**
 * Start demo with a random case from selected vertical/module.
 */
async function handleStartDemo() {
    if (!selectedVertical) {
        showToast('Select a vertical first', 'warning');
        return;
    }

    const demoCase = getRandomCase(selectedVertical, selectedModule);
    if (!demoCase) {
        showToast('No cases available for this combination', 'error');
        return;
    }

    hideDemoPanel();

    const started = await startDemo(demoCase.id);
    if (started) {
        const state = getDemoState();
        showNavigationOverlay(state);
    }
}

/**
 * Start demo with a specific case ID.
 * @param {string} caseId
 */
async function handleStartDemoCase(caseId) {
    hideDemoPanel();
    const started = await startDemo(caseId);
    if (started) {
        const state = getDemoState();
        showNavigationOverlay(state);
    }
}

/**
 * Navigate to next step.
 */
async function handleDemoNext() {
    const advanced = await nextStep();
    if (advanced) {
        const state = getDemoState();
        showNavigationOverlay(state);
    }
}

/**
 * Navigate to previous step.
 */
async function handleDemoPrev() {
    const went = await prevStep();
    if (went) {
        const state = getDemoState();
        showNavigationOverlay(state);
    }
}

/**
 * Exit demo mode — cleanup and restore.
 */
async function handleExitDemo() {
    await exitDemo();
    hideNavigationOverlay();
    hideDemoPanel();
}

/**
 * Get a random case for the selected vertical.
 */
function handleDemoRandomCase() {
    if (!selectedVertical) return;
    const demoCase = getRandomCase(selectedVertical, selectedModule);
    if (demoCase) {
        renderDemoController(getDemoState(), selectedVertical, selectedModule, demoCase);
    }
}

// ----------------------------------------------------------------
// HANDLER EXPORT
// ----------------------------------------------------------------

export const demoHandlers = {
    handleOpenDemo,
    handleCloseDemo,
    handleSelectVertical,
    handleSelectModule,
    handleStartDemo,
    handleStartDemoCase,
    handleDemoNext,
    handleDemoPrev,
    handleExitDemo,
    handleDemoRandomCase,
};
