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
   TOUR HANDLERS — Window functions for onboarding tour
   Funcoes globais para o tour de onboarding

   Expoe funcoes no window.* para onclick do HTML.
   Conecta a UI com o tour engine e controller.
   ================================================================ */

import {
    initTour,
    setTourUpdateAllUI,
    startTour,
    nextStep,
    prevStep,
    exitTour,
    resetTour,
    isActive,
    startGuidedTour,
    getGuidedTourState,
    resetGuidedTours,
    getTourState,
} from '../tour/engine.js';

import { initTourUI, showChapterPicker, hideChapterPicker } from '../ui/tourController.js';

import {
    showGuidedTourPicker,
    hideGuidedTourPicker,
    selectCategory,
    backToCategories,
    filterTours,
} from '../ui/tourPicker.js';

// ----------------------------------------------------------------
// UPDATE INJECTION
// ----------------------------------------------------------------

let updateAllUI = null;

/**
 * Inject updateAllUI callback.
 * @param {Function} fn
 */
export function setTourHandlerUpdateAllUI(fn) {
    updateAllUI = fn;
    setTourUpdateAllUI(fn);
}

// ----------------------------------------------------------------
// HANDLERS
// ----------------------------------------------------------------

/**
 * Open tour panel (FAB click).
 * Se tour ativo, nao faz nada. Senao abre chapter picker.
 */
function handleOpenTour() {
    if (isActive()) return;
    if (typeof showChapterPicker !== 'function') {
        console.warn('[Tour] Tour system not initialized yet');
        window.showToast?.('Aguarde o sistema carregar...', 'warning');
        return;
    }
    showChapterPicker();
}

/**
 * Close tour panel.
 */
function handleCloseTour() {
    hideChapterPicker();
}

/**
 * Start tour from a specific chapter.
 * @param {string} chapterId
 */
async function handleStartTourChapter(chapterId) {
    if (typeof startTour !== 'function') {
        console.warn('[Tour] Tour engine not initialized yet');
        window.showToast?.('Aguarde o sistema carregar...', 'warning');
        return;
    }
    hideChapterPicker();
    await startTour(chapterId);
}

/**
 * Start tour from first incomplete chapter.
 */
async function handleStartTour() {
    hideChapterPicker();
    await startTour();
}

/**
 * Navigate to next step.
 */
async function handleTourNext() {
    if (typeof nextStep !== 'function') {
        console.warn('[Tour] Tour engine not initialized yet');
        return;
    }
    await nextStep();
}

/**
 * Navigate to previous step.
 */
async function handleTourPrev() {
    if (typeof prevStep !== 'function') {
        console.warn('[Tour] Tour engine not initialized yet');
        return;
    }
    await prevStep();
}

/**
 * Exit tour — cleanup and save progress.
 */
async function handleExitTour() {
    if (typeof exitTour !== 'function') {
        console.warn('[Tour] Tour engine not initialized yet');
        return;
    }
    await exitTour();
}

/**
 * Skip/exit tour from tooltip skip button.
 */
async function handleSkipTour() {
    await exitTour();
}

/**
 * Reset all tour progress.
 */
function handleResetTour() {
    resetTour();
}

// ----------------------------------------------------------------
// GUIDED TOUR HANDLERS
// ----------------------------------------------------------------

/**
 * Open guided tour picker (50 workflow tours).
 */
function handleOpenGuidedTours() {
    if (typeof showGuidedTourPicker !== 'function') {
        console.warn('[Tour] Tour picker not initialized yet');
        window.showToast?.('Aguarde o sistema carregar...', 'warning');
        return;
    }
    hideChapterPicker();
    showGuidedTourPicker();
}

/**
 * Close guided tour picker.
 */
function handleCloseGuidedTours() {
    hideGuidedTourPicker();
}

/**
 * Start a specific guided tour by ID.
 * Verifica pre-requisitos e inicia o tour.
 * @param {string} tourId
 */
async function handleStartGuidedTour(tourId) {
    hideGuidedTourPicker();

    // Get current app state for prerequisite check
    const appState = {
        elementCount: window.getElements?.()?.length ?? 0,
        campaignCount: window.getCampaigns?.()?.length ?? 0,
        observationCount: _countObservations(),
    };

    const result = await startGuidedTour(tourId, appState);

    if (!result.ok) {
        // Show toast with missing prerequisites
        window.showToast?.(`Cannot start tour: ${result.reason}`, 'warning');
    }
}

/**
 * Select a tour category in the picker.
 * @param {string} categoryId
 */
function handleSelectTourCategory(categoryId) {
    selectCategory(categoryId);
}

/**
 * Go back from tour list to categories.
 */
function handleGuidedTourBack() {
    backToCategories();
}

/**
 * Search guided tours.
 * @param {string} query
 */
function handleSearchGuidedTours(query) {
    filterTours(query);
}

/**
 * Reset all guided tour progress.
 */
function handleResetGuidedTours() {
    resetGuidedTours();
    window.showToast?.('Guided tour progress reset', 'info');
}

/**
 * Count total observations across all elements.
 * @returns {number}
 */
function _countObservations() {
    try {
        const elements = window.getElements?.() ?? [];
        let count = 0;
        for (const el of elements) {
            count += el.observations?.length ?? 0;
        }
        return count;
    } catch {
        return 0;
    }
}

// ----------------------------------------------------------------
// HANDLER EXPORT
// ----------------------------------------------------------------

export const tourHandlers = {
    handleOpenTour,
    handleCloseTour,
    handleStartTour,
    handleStartTourChapter,
    handleTourNext,
    handleTourPrev,
    handleExitTour,
    handleSkipTour,
    handleResetTour,
    handleOpenGuidedTours,
    handleCloseGuidedTours,
    handleStartGuidedTour,
    handleSelectTourCategory,
    handleGuidedTourBack,
    handleSearchGuidedTours,
    handleResetGuidedTours,
    getTourState,
};
