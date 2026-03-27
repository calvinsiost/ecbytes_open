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
   TOUR ENGINE — Onboarding tour state machine
   Motor do tour de onboarding com steps interativos

   Gerencia o ciclo de vida do tour:
   - 4 capitulos com steps sequenciais (onboarding)
   - 50 guided tours com steps por workflow
   - Steps informativos (Next avanca) e interativos (espera acao)
   - Persistencia de progresso via localStorage
   - Coachmark spotlight + tooltip persistente
   ================================================================ */

import { TOUR_CHAPTERS } from './steps.js';
import { getGuidedTour } from './categories.js';
import { initSpotlight, showSpotlight, hideSpotlight } from './spotlight.js';
import { initTooltip, showTooltip, hideTooltip, enableNextButton, setTooltipCallbacks } from './tooltip.js';
import { t } from '../i18n/translations.js';
import { safeSetItem } from '../storage/storageMonitor.js';

// ----------------------------------------------------------------
// CONSTANTS
// ----------------------------------------------------------------

const STORAGE_KEY = 'ecbyts-tour-state';
const GUIDED_STORAGE_KEY = 'ecbyts-guided-tour-state';
const INTERACTION_TIMEOUT = 30000; // 30s fallback for interactive steps
const TARGET_RETRY_INTERVAL = 100; // ms between retries to find target
const TARGET_MAX_RETRIES = 20; // max retries (2s total)

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

/** @type {Function|null} */
let updateAllUI = null;

let state = {
    active: false,
    currentChapter: null,
    currentStepIndex: -1,
    isAnimating: false,
    waitingForInteraction: false,
    currentWaitFor: null, // event name the interactive step is waiting for
    guidedTourId: null, // non-null = guided tour mode (vs onboarding chapter)
};

/** @type {number|null} Interaction timeout timer */
let interactionTimer = null;

/** @type {Function|null} Event listener cleanup */
let interactionCleanup = null;

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Initialize tour engine.
 * Prepara spotlight e tooltip no DOM.
 */
export function initTour() {
    initSpotlight();
    initTooltip();
    setTooltipCallbacks({
        onNext: nextStep,
        onPrev: prevStep,
        onSkip: exitTour,
    });
}

/**
 * Inject updateAllUI callback.
 * @param {Function} fn
 */
export function setTourUpdateAllUI(fn) {
    updateAllUI = fn;
}

// ----------------------------------------------------------------
// STATE ACCESS
// ----------------------------------------------------------------

/** @returns {boolean} Whether tour is active */
export function isActive() {
    return state.active;
}

/** @returns {Object} Copy of current state */
export function getTourState() {
    return { ...state };
}

/**
 * Get chapter metadata with completion status.
 * @returns {Array<Object>}
 */
export function getChapters() {
    const persisted = _loadState();
    return Object.values(TOUR_CHAPTERS).map((ch) => ({
        id: ch.id,
        titleKey: ch.titleKey,
        descKey: ch.descKey,
        icon: ch.icon,
        color: ch.color,
        stepCount: ch.steps.length,
        status: persisted.chaptersCompleted?.[ch.id]
            ? 'completed'
            : persisted.lastChapter === ch.id && persisted.lastStep >= 0
              ? 'in-progress'
              : 'pending',
    }));
}

// ----------------------------------------------------------------
// TOUR LIFECYCLE
// ----------------------------------------------------------------

/**
 * Start tour from a specific chapter.
 * @param {string} [chapterId] - Chapter to start. Defaults to first incomplete.
 */
export async function startTour(chapterId) {
    const chapters = Object.keys(TOUR_CHAPTERS);

    if (!chapterId) {
        // Find first incomplete chapter
        const persisted = _loadState();
        chapterId = chapters.find((id) => !persisted.chaptersCompleted?.[id]) || chapters[0];
    }

    const chapter = TOUR_CHAPTERS[chapterId];
    if (!chapter || chapter.steps.length === 0) return;

    state.active = true;
    state.currentChapter = chapterId;
    state.currentStepIndex = -1;
    state.isAnimating = false;
    state.waitingForInteraction = false;

    window.dispatchEvent(new CustomEvent('tourChanged'));

    // Advance to first step
    await nextStep();
}

/**
 * Advance to the next step.
 * Funciona para onboarding chapters e guided tours.
 * @returns {Promise<boolean>}
 */
export async function nextStep() {
    if (!state.active) return false;
    if (!state.currentChapter && !state.guidedTourId) return false;
    if (state.isAnimating) return false;

    // Cleanup previous interaction listener
    _cleanupInteraction();

    const steps = _getCurrentSteps();
    const prevIdx = state.currentStepIndex;
    const nextIdx = prevIdx + 1;

    // Execute postAction of current step (if any)
    if (prevIdx >= 0 && prevIdx < steps.length) {
        const prevStep = steps[prevIdx];
        if (prevStep.postAction) {
            try {
                await prevStep.postAction();
            } catch (e) {
                console.warn('[Tour] postAction error:', e.message);
            }
        }
    }

    // Check if tour/chapter is complete
    if (nextIdx >= steps.length) {
        if (state.guidedTourId) {
            _completeGuidedTour();
        } else {
            await _completeChapter();
        }
        return false;
    }

    state.currentStepIndex = nextIdx;
    state.isAnimating = true;

    const step = steps[nextIdx];

    try {
        // Execute pre-action (e.g., open a modal)
        if (step.action) {
            await step.action();
        }

        // Wait for delay if specified
        if (step.delay && step.delay > 0) {
            await new Promise((r) => setTimeout(r, step.delay));
        }

        // Wait for target element to appear in DOM
        const targetFound = await _waitForTarget(step.target);

        if (!targetFound) {
            console.warn(`[Tour] Target not found: ${step.target} — skipping step`);
            state.isAnimating = false;
            await nextStep();
            return true;
        }

        // Show spotlight and tooltip
        showSpotlight(step.target);

        const tourName = _getCurrentName();
        showTooltip(step, nextIdx, steps.length, tourName);

        // If interactive: setup listener + allow click-through
        if (step.interactive && step.waitFor) {
            _enableClickThrough(step.target);
            _setupInteractionListener(step.waitFor);
        } else {
            _disableClickThrough();
        }

        // Persist progress
        if (state.guidedTourId) {
            _saveGuidedProgress();
        } else {
            _saveProgress();
        }
    } catch (e) {
        console.error('[Tour] Step execution error:', e);
    } finally {
        state.isAnimating = false;
    }

    window.dispatchEvent(new CustomEvent('tourChanged'));
    return true;
}

/**
 * Go back to previous step.
 * @returns {Promise<boolean>}
 */
export async function prevStep() {
    if (!state.active) return false;
    if (!state.currentChapter && !state.guidedTourId) return false;
    if (state.isAnimating) return false;
    if (state.currentStepIndex <= 0) return false;

    _cleanupInteraction();

    const steps = _getCurrentSteps();
    const currentStep = steps[state.currentStepIndex];

    // Execute postAction of current step
    if (currentStep?.postAction) {
        try {
            await currentStep.postAction();
        } catch (e) {
            console.warn('[Tour] postAction error:', e.message);
        }
    }

    state.currentStepIndex--;
    state.isAnimating = true;

    const step = steps[state.currentStepIndex];

    try {
        if (step.action) {
            await step.action();
        }

        if (step.delay && step.delay > 0) {
            await _sleep(step.delay);
        }

        await _waitForTarget(step.target);
        showSpotlight(step.target);

        const tourName = _getCurrentName();
        showTooltip(step, state.currentStepIndex, steps.length, tourName);

        if (step.interactive && step.waitFor) {
            _enableClickThrough(step.target);
            _setupInteractionListener(step.waitFor);
        } else {
            _disableClickThrough();
        }
    } catch (e) {
        console.error('[Tour] Prev step error:', e);
    } finally {
        state.isAnimating = false;
    }

    window.dispatchEvent(new CustomEvent('tourChanged'));
    return true;
}

/**
 * Exit tour, cleanup and save progress.
 */
export async function exitTour() {
    if (!state.active) return;

    _cleanupInteraction();
    _disableClickThrough();

    // Execute postAction of current step
    const steps = _getCurrentSteps();
    if (state.currentStepIndex >= 0 && state.currentStepIndex < steps.length) {
        const step = steps[state.currentStepIndex];
        if (step?.postAction) {
            try {
                await step.postAction();
            } catch (e) {
                console.warn('[Tour] Exit postAction error:', e.message);
            }
        }
    }

    hideSpotlight();
    hideTooltip();

    if (state.guidedTourId) {
        _saveGuidedProgress();
    } else {
        _saveProgress();
    }

    state = {
        active: false,
        currentChapter: null,
        currentStepIndex: -1,
        isAnimating: false,
        waitingForInteraction: false,
        guidedTourId: null,
    };

    window.dispatchEvent(new CustomEvent('tourChanged'));
    if (updateAllUI) updateAllUI();
}

/**
 * Reset all tour progress.
 */
export function resetTour() {
    localStorage.removeItem(STORAGE_KEY);
    exitTour();
}

// ----------------------------------------------------------------
// CHAPTER COMPLETION
// ----------------------------------------------------------------

async function _completeChapter() {
    hideSpotlight();
    hideTooltip();

    // Mark chapter as completed in localStorage
    const persisted = _loadState();
    if (!persisted.chaptersCompleted) persisted.chaptersCompleted = {};
    persisted.chaptersCompleted[state.currentChapter] = true;
    persisted.lastChapter = null;
    persisted.lastStep = -1;
    _saveState(persisted);

    state.active = false;
    state.currentChapter = null;
    state.currentStepIndex = -1;

    window.dispatchEvent(new CustomEvent('tourChanged'));
    window.dispatchEvent(new CustomEvent('tourChapterComplete'));
    if (updateAllUI) updateAllUI();
}

// ----------------------------------------------------------------
// CLICK-THROUGH FOR INTERACTIVE STEPS
// ----------------------------------------------------------------

/** @type {HTMLElement|null} Element with elevated z-index */
let _elevatedTarget = null;
let _originalZIndex = '';
let _originalPosition = '';

/**
 * Allow user to click the target element during interactive steps.
 * Disables pointer-events on backdrop, elevates target above overlay.
 */
function _enableClickThrough(selector) {
    _disableClickThrough(); // cleanup previous

    const backdrop = document.getElementById('tour-backdrop');
    if (backdrop) backdrop.style.pointerEvents = 'none';

    // Elevate target above the spotlight (z-index 10000)
    const target = document.querySelector(selector);
    if (target) {
        _elevatedTarget = target;
        _originalZIndex = target.style.zIndex;
        _originalPosition = target.style.position;
        const computed = getComputedStyle(target).position;
        if (computed === 'static') target.style.position = 'relative';
        target.style.zIndex = '10001';
    }
}

/**
 * Restore backdrop pointer-events and target z-index.
 */
function _disableClickThrough() {
    const backdrop = document.getElementById('tour-backdrop');
    if (backdrop) backdrop.style.pointerEvents = '';

    if (_elevatedTarget) {
        _elevatedTarget.style.zIndex = _originalZIndex;
        _elevatedTarget.style.position = _originalPosition;
        _elevatedTarget = null;
        _originalZIndex = '';
        _originalPosition = '';
    }
}

// ----------------------------------------------------------------
// INTERACTION LISTENER
// ----------------------------------------------------------------

function _setupInteractionListener(eventName) {
    state.waitingForInteraction = true;
    state.currentWaitFor = eventName;

    const handler = () => {
        _cleanupInteraction();
        enableNextButton();
        // Auto-advance after a short pause
        setTimeout(() => nextStep(), 500);
    };

    window.addEventListener(eventName, handler, { once: true });
    interactionCleanup = () => window.removeEventListener(eventName, handler);

    // Timeout fallback: enable Next after 30s
    interactionTimer = setTimeout(() => {
        state.waitingForInteraction = false;
        enableNextButton();
    }, INTERACTION_TIMEOUT);
}

function _cleanupInteraction() {
    state.waitingForInteraction = false;
    state.currentWaitFor = null;
    if (interactionTimer) {
        clearTimeout(interactionTimer);
        interactionTimer = null;
    }
    if (interactionCleanup) {
        interactionCleanup();
        interactionCleanup = null;
    }
}

// ----------------------------------------------------------------
// TARGET WAITING
// ----------------------------------------------------------------

function _waitForTarget(selector) {
    return new Promise((resolve) => {
        const deadline = Date.now() + 2000; // 2s hard deadline

        function check() {
            if (document.querySelector(selector) || Date.now() > deadline) {
                resolve(!!document.querySelector(selector));
                return;
            }
            requestAnimationFrame(check);
        }

        check();
    });
}

// ----------------------------------------------------------------
// PERSISTENCE
// ----------------------------------------------------------------

function _loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function _saveState(data) {
    try {
        safeSetItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
        // localStorage may be full or disabled
    }
}

function _saveProgress() {
    const persisted = _loadState();
    persisted.lastChapter = state.currentChapter;
    persisted.lastStep = state.currentStepIndex;
    persisted.version = 1;
    _saveState(persisted);
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function _t(key, fallback) {
    try {
        const val = t(key);
        return val && val !== key ? val : fallback || key;
    } catch {
        return fallback || key;
    }
}

/**
 * Get current steps array — works for both onboarding chapters and guided tours.
 * Retorna os steps do capitulo atual ou do guided tour ativo.
 * @returns {Array<Object>}
 */
function _getCurrentSteps() {
    if (state.guidedTourId) {
        const tour = getGuidedTour(state.guidedTourId);
        return tour ? tour.steps : [];
    }
    if (state.currentChapter && TOUR_CHAPTERS[state.currentChapter]) {
        return TOUR_CHAPTERS[state.currentChapter].steps;
    }
    return [];
}

/**
 * Get display name for current tour/chapter.
 * @returns {string}
 */
function _getCurrentName() {
    if (state.guidedTourId) {
        const tour = getGuidedTour(state.guidedTourId);
        return tour ? _t(tour.nameKey, tour.id) : '';
    }
    if (state.currentChapter) {
        const ch = TOUR_CHAPTERS[state.currentChapter];
        return ch ? _t(ch.titleKey, ch.id) : '';
    }
    return '';
}

// ----------------------------------------------------------------
// GUIDED TOUR LIFECYCLE
// ----------------------------------------------------------------

/**
 * Start a guided workflow tour by ID.
 * Verifica pre-requisitos e auto-scaffold se necessario.
 * @param {string} tourId
 * @param {Object} [appState] - Current app state for prerequisite check
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function startGuidedTour(tourId, appState = {}) {
    const tour = getGuidedTour(tourId);
    if (!tour || !tour.steps.length) {
        return { ok: false, reason: 'Tour not found' };
    }

    // Prerequisite check
    const prereqs = tour.prerequisites || {};
    const elemCount = appState.elementCount ?? 0;
    const campCount = appState.campaignCount ?? 0;
    const obsCount = appState.observationCount ?? 0;

    const missing = [];
    if ((prereqs.minElements || 0) > elemCount) missing.push(`${prereqs.minElements} elements`);
    if ((prereqs.minCampaigns || 0) > campCount) missing.push(`${prereqs.minCampaigns} campaigns`);
    if ((prereqs.minObservations || 0) > obsCount) missing.push(`${prereqs.minObservations} observations`);

    if (missing.length > 0) {
        if (prereqs.autoScaffold) {
            // Auto-generate minimal model
            try {
                window.generateRandomModel?.();
                await new Promise((r) => setTimeout(r, 500));
            } catch (e) {
                console.warn('[GuidedTour] Auto-scaffold failed:', e.message);
            }
        } else {
            return { ok: false, reason: `Missing: ${missing.join(', ')}` };
        }
    }

    // Set guided tour state
    state.active = true;
    state.guidedTourId = tourId;
    state.currentChapter = null;
    state.currentStepIndex = -1;
    state.isAnimating = false;
    state.waitingForInteraction = false;

    window.dispatchEvent(new CustomEvent('tourChanged'));

    try {
        await nextStep();
    } catch (e) {
        console.error('[GuidedTour] Failed to start:', e);
        state.active = false;
        state.guidedTourId = null;
        return { ok: false, reason: 'Failed to start tour' };
    }
    return { ok: true };
}

/**
 * Get guided tour persistence state.
 * @returns {Object}
 */
export function getGuidedTourState() {
    return _loadGuidedState();
}

/**
 * Reset all guided tour progress.
 */
export function resetGuidedTours() {
    localStorage.removeItem(GUIDED_STORAGE_KEY);
}

// ----------------------------------------------------------------
// GUIDED TOUR PERSISTENCE
// ----------------------------------------------------------------

function _loadGuidedState() {
    try {
        const raw = localStorage.getItem(GUIDED_STORAGE_KEY);
        return raw ? JSON.parse(raw) : { version: 1, toursCompleted: {}, totalCompleted: 0 };
    } catch {
        return { version: 1, toursCompleted: {}, totalCompleted: 0 };
    }
}

function _saveGuidedState(data) {
    try {
        safeSetItem(GUIDED_STORAGE_KEY, JSON.stringify(data));
    } catch {
        // localStorage may be full
    }
}

function _completeGuidedTour() {
    hideSpotlight();
    hideTooltip();

    const guided = _loadGuidedState();
    if (!guided.toursCompleted) guided.toursCompleted = {};
    guided.toursCompleted[state.guidedTourId] = true;
    guided.totalCompleted = Object.keys(guided.toursCompleted).length;
    guided.lastTourId = null;
    guided.lastStepIndex = -1;
    _saveGuidedState(guided);

    const completedTourId = state.guidedTourId;

    state.active = false;
    state.guidedTourId = null;
    state.currentChapter = null;
    state.currentStepIndex = -1;

    window.dispatchEvent(new CustomEvent('tourChanged'));
    window.dispatchEvent(new CustomEvent('guidedTourComplete', { detail: { tourId: completedTourId } }));
    if (updateAllUI) updateAllUI();
}

function _saveGuidedProgress() {
    if (!state.guidedTourId) return;
    const guided = _loadGuidedState();
    guided.lastTourId = state.guidedTourId;
    guided.lastStepIndex = state.currentStepIndex;
    _saveGuidedState(guided);
}
