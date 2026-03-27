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
   TOUR STEPS — Step definitions for the onboarding tour
   Definicoes de steps do tour de onboarding

   4 capitulos: basics, data, modules, advanced
   Cada step define: target (CSS selector), texto (i18n keys),
   acoes (action/postAction), e se e interativo.
   ================================================================ */

// ----------------------------------------------------------------
// PANEL HELPERS — Garantem que paineis estejam abertos
// Exportados para reuso nos guided tours (tours/)
// ----------------------------------------------------------------

export function ensureLeftPanel() {
    const lp = document.getElementById('left-panel');
    if (lp && lp.classList.contains('panel-minimized')) {
        window.toggleLeftPanel?.();
    }
}

export function ensureRightPanel() {
    const rp = document.getElementById('right-panel');
    if (rp && rp.classList.contains('panel-minimized')) {
        window.toggleRightPanel?.();
    }
}

export function ensureConstellationOpen() {
    const hud = document.getElementById('constellation-hud');
    if (hud && hud.classList.contains('constellation-collapsed')) {
        window.handleToggleConstellation?.();
    }
}

export function switchTab(tabName) {
    const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
    if (tab) tab.click();
}

// ----------------------------------------------------------------
// CHAPTER DEFINITIONS
// ----------------------------------------------------------------

export const TOUR_CHAPTERS = {
    basics: {
        id: 'basics',
        titleKey: 'tourChapterBasics',
        descKey: 'tourChapterBasicsDesc',
        icon: 'play-circle',
        color: '#3b82f6',
        steps: [
            {
                id: 'welcome-viewport',
                target: '#canvas-container',
                title: 'tourViewport',
                body: 'tourViewportBody',
                position: 'bottom',
                action: () => {
                    // Ensure 3D view is active - canvas-container must be visible
                    if (window.switchView) {
                        window.switchView('3d');
                    }
                },
            },
            {
                id: 'camera-controls',
                target: '#view-controls',
                title: 'tourCameraControls',
                body: 'tourCameraControlsBody',
                position: 'left',
            },
            {
                id: 'ribbon-menubar',
                target: '#menubar',
                title: 'tourRibbon',
                body: 'tourRibbonBody',
                position: 'bottom',
            },
            {
                id: 'ribbon-home',
                target: '[data-ribbon="home"]',
                title: 'tourRibbonHome',
                body: 'tourRibbonHomeBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('home'),
            },
            {
                id: 'ribbon-file',
                target: '[data-ribbon="file"]',
                title: 'tourRibbonFile',
                body: 'tourRibbonFileBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('file'),
            },
            {
                id: 'left-panel',
                target: '#left-panel',
                title: 'tourLeftPanel',
                body: 'tourLeftPanelBody',
                position: 'right',
                action: () => {
                    window.switchRibbonTab('home');
                    ensureLeftPanel();
                },
            },
            {
                id: 'families-list',
                target: '#families-list',
                title: 'tourFamilies',
                body: 'tourFamiliesBody',
                position: 'right',
                action: () => ensureLeftPanel(),
            },
            {
                id: 'add-element',
                target: '#families-list .family-item',
                title: 'tourAddElement',
                body: 'tourAddElementBody',
                position: 'right',
                interactive: true,
                waitFor: 'elementAdded',
                action: () => ensureLeftPanel(),
            },
            {
                id: 'right-panel',
                target: '#right-panel',
                title: 'tourRightPanel',
                body: 'tourRightPanelBody',
                position: 'left',
                action: () => ensureRightPanel(),
            },
            {
                id: 'project-tab',
                target: '.tab[data-tab="project"]',
                title: 'tourProjectTab',
                body: 'tourProjectTabBody',
                position: 'bottom',
                action: () => ensureRightPanel(),
            },
            {
                id: 'elements-tab',
                target: '.tab[data-tab="elements"]',
                title: 'tourElementsTab',
                body: 'tourElementsTabBody',
                position: 'bottom',
                action: () => ensureRightPanel(),
            },
            {
                id: 'basics-complete',
                target: '#canvas-container',
                title: 'tourBasicsComplete',
                body: 'tourBasicsCompleteBody',
                position: 'bottom',
            },
        ],
    },

    data: {
        id: 'data',
        titleKey: 'tourChapterData',
        descKey: 'tourChapterDataDesc',
        icon: 'database',
        color: '#22c55e',
        steps: [
            {
                id: 'data-intro',
                target: '#right-panel',
                title: 'tourDataIntro',
                body: 'tourDataIntroBody',
                position: 'left',
                action: () => ensureRightPanel(),
            },
            {
                id: 'campaigns-tab',
                target: '.tab[data-tab="campaigns"]',
                title: 'tourCampaignsTab',
                body: 'tourCampaignsTabBody',
                position: 'bottom',
                action: () => ensureRightPanel(),
            },
            {
                id: 'scenes-tab',
                target: '.tab[data-tab="scenes"]',
                title: 'tourScenesTab',
                body: 'tourScenesTabBody',
                position: 'bottom',
                action: () => ensureRightPanel(),
            },
            {
                id: 'analytics-tab',
                target: '.tab[data-tab="analytics"]',
                title: 'tourAnalyticsTab',
                body: 'tourAnalyticsTabBody',
                position: 'bottom',
                action: () => ensureRightPanel(),
            },
            {
                id: 'governance-tab',
                target: '.tab[data-tab="governance"]',
                title: 'tourGovernanceTab',
                body: 'tourGovernanceTabBody',
                position: 'bottom',
                action: () => ensureRightPanel(),
            },
            {
                id: 'insert-ribbon',
                target: '[data-ribbon="insert"]',
                title: 'tourInsertRibbon',
                body: 'tourInsertRibbonBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('insert'),
            },
            {
                id: 'modeling-ribbon',
                target: '[data-ribbon="modeling"]',
                title: 'tourModelingRibbon',
                body: 'tourModelingRibbonBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('modeling'),
            },
            {
                id: 'data-complete',
                target: '#right-panel',
                title: 'tourDataComplete',
                body: 'tourDataCompleteBody',
                position: 'left',
            },
        ],
    },

    modules: {
        id: 'modules',
        titleKey: 'tourChapterModules',
        descKey: 'tourChapterModulesDesc',
        icon: 'cpu',
        color: '#a855f7',
        steps: [
            {
                id: 'modules-intro',
                target: '#menubar',
                title: 'tourModulesIntro',
                body: 'tourModulesIntroBody',
                position: 'bottom',
            },
            {
                id: 'nn-btn',
                target: '[onclick*="handleOpenNNManager"]',
                title: 'tourNNBtn',
                body: 'tourNNBtnBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('optimize'),
                delay: 200,
            },
            {
                id: 'nn-modal',
                target: '#nn-modal',
                title: 'tourNNModal',
                body: 'tourNNModalBody',
                position: 'left',
                action: () => window.handleOpenNNManager?.(),
                postAction: () => window.closeModal?.('nn-modal'),
                delay: 300,
            },
            {
                id: 'aerial-btn',
                target: '[onclick*="handleOpenAerialModal"]',
                title: 'tourAerialBtn',
                body: 'tourAerialBtnBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('optimize'),
                delay: 200,
            },
            {
                id: 'aerial-modal',
                target: '#aerial-recognition-modal',
                title: 'tourAerialModal',
                body: 'tourAerialModalBody',
                position: 'left',
                action: () => window.handleOpenAerialModal?.(),
                postAction: () => window.closeModal?.('aerial-recognition-modal'),
                delay: 300,
            },
            {
                id: 'calculator-btn',
                target: '[onclick*="handleOpenCalculator"]',
                title: 'tourCalculatorBtn',
                body: 'tourCalculatorBtnBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('view'),
                delay: 200,
            },
            {
                id: 'calculator-modal',
                target: '#calculator-modal',
                title: 'tourCalculatorModal',
                body: 'tourCalculatorModalBody',
                position: 'left',
                action: () => window.handleOpenCalculator?.(),
                postAction: () => window.handleCloseCalculator?.(),
                delay: 300,
            },
            {
                id: 'interpolation-btn',
                target: '[onclick*="handleOpenInterpolationPanel"]',
                title: 'tourInterpolationBtn',
                body: 'tourInterpolationBtnBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('optimize'),
                delay: 200,
            },
            {
                id: 'interpolation-modal',
                target: '.modal-overlay#interpolation-modal, [id*="interpolation"]',
                title: 'tourInterpolationModal',
                body: 'tourInterpolationModalBody',
                position: 'left',
                action: () => window.handleOpenInterpolationPanel?.(),
                postAction: () => window.handleCloseInterpolationPanel?.(),
                delay: 300,
            },
            {
                id: 'cross-section-btn',
                target: '[onclick*="handleOpenCrossSectionPanel"]',
                title: 'tourCrossSectionBtn',
                body: 'tourCrossSectionBtnBody',
                position: 'left',
                action: () => {
                    window.handleOpenInterpolationPanel?.();
                    // Espera o modal abrir
                    setTimeout(() => {
                        const btn = document.querySelector('[onclick*="handleOpenCrossSectionPanel"]');
                        if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                },
                delay: 300,
            },
            {
                id: 'cross-section-panel',
                target: '#cross-section-panel',
                title: 'tourCrossSectionPanel',
                body: 'tourCrossSectionPanelBody',
                position: 'right',
                action: () => {
                    // Gera modelo aleatório se não houver elementos
                    const hasElements = window.getAllElements?.().length > 0;
                    if (!hasElements) {
                        window.generateRandomModel?.();
                        setTimeout(() => {
                            if (window.handleFamilySelectConfirm) window.handleFamilySelectConfirm();
                        }, 500);
                    }
                    setTimeout(() => window.handleOpenCrossSectionPanel?.(), 1000);
                },
                postAction: () => window.handleCloseCrossSectionPanel?.(),
                delay: 500,
            },
            {
                id: 'sao-btn',
                target: '[onclick*="handleOpenSAOMatrixPanel"]',
                title: 'tourSAOBtn',
                body: 'tourSAOBtnBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('optimize'),
                delay: 200,
            },
            {
                id: 'modules-complete',
                target: '#menubar',
                title: 'tourModulesComplete',
                body: 'tourModulesCompleteBody',
                position: 'bottom',
            },
        ],
    },

    advanced: {
        id: 'advanced',
        titleKey: 'tourChapterAdvanced',
        descKey: 'tourChapterAdvancedDesc',
        icon: 'shield',
        color: '#f59e0b',
        steps: [
            {
                id: 'export-btn',
                target: '[onclick*="openExportModal"]',
                title: 'tourExportBtn',
                body: 'tourExportBtnBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('file'),
                delay: 200,
            },
            {
                id: 'ai-chat-btn',
                target: '#toggle-chat-panel-btn',
                title: 'tourAIChatBtn',
                body: 'tourAIChatBtnBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('view'),
                delay: 200,
            },
            {
                id: 'ai-chat-panel',
                target: '#toggle-chat-panel-btn',
                title: 'tourAIChatPanel',
                body: 'tourAIChatPanelBody',
                position: 'left',
                action: () => window.toggleLLMChatPanel?.(),
                postAction: () => {
                    // Close chat panel if it was opened
                    const panel = document.getElementById('llm-chat-panel');
                    if (panel && panel.classList.contains('open')) {
                        window.toggleLLMChatPanel?.();
                    }
                },
                delay: 300,
            },
            {
                id: 'libraries-ribbon',
                target: '[data-ribbon="libraries"]',
                title: 'tourLibrariesRibbon',
                body: 'tourLibrariesRibbonBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('libraries'),
                delay: 200,
            },
            {
                id: 'ticker-btn',
                target: '[onclick*="handleToggleTicker"]',
                title: 'tourTickerBtn',
                body: 'tourTickerBtnBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('view'),
                delay: 200,
            },
            {
                id: 'help-ribbon',
                target: '[data-ribbon="help"]',
                title: 'tourHelpRibbon',
                body: 'tourHelpRibbonBody',
                position: 'bottom',
                action: () => window.switchRibbonTab('help'),
                delay: 200,
            },
            {
                id: 'advanced-complete',
                target: '#canvas-container',
                title: 'tourAdvancedComplete',
                body: 'tourAdvancedCompleteBody',
                position: 'bottom',
            },
        ],
    },
};

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

/**
 * Get steps for a specific chapter.
 * @param {string} chapterId
 * @returns {Array<Object>}
 */
export function getChapterSteps(chapterId) {
    const chapter = TOUR_CHAPTERS[chapterId];
    return chapter ? chapter.steps : [];
}
