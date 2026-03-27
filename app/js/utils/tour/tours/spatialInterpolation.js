// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   GUIDED TOURS — Spatial & Interpolation (6 tours, 28 steps)
   Tours 21-26: DXF blueprint, map picker, terrain layer,
   contamination layer, potentiometric map, method config
   ================================================================ */

import { registerGuidedTour } from '../categories.js';

// ----------------------------------------------------------------
// Tour 21: Import DXF/CAD Blueprint
// ----------------------------------------------------------------

registerGuidedTour({
    id: 'import-dxf-blueprint',
    categoryId: 'spatial-interpolation',
    nameKey: 'guidedTourDXFImport',
    descKey: 'guidedTourDXFImportDesc',
    icon: 'layout',
    difficulty: 'intermediate',
    estimatedMinutes: 3,
    prerequisites: { minElements: 0, autoScaffold: false },
    steps: [
        {
            id: 'gt-dxf-ribbon',
            target: '[data-ribbon="insert"]',
            title: 'gtDXFImportRibbon',
            body: 'gtDXFImportRibbonBody',
            position: 'bottom',
            action: () => window.switchRibbonTab?.('insert'),
        },
        {
            id: 'gt-dxf-btn',
            target: '[onclick*="handleOpenSpatialModal"]',
            title: 'gtDXFImportBtn',
            body: 'gtDXFImportBtnBody',
            position: 'bottom',
        },
        {
            id: 'gt-dxf-modal',
            target: '#spatial-modal, .spatial-blueprint-modal',
            title: 'gtDXFImportModal',
            body: 'gtDXFImportModalBody',
            position: 'left',
            action: () => window.handleOpenSpatialModal?.(),
            delay: 400,
        },
        {
            id: 'gt-dxf-upload',
            target: '#spatial-modal, .spatial-blueprint-modal',
            title: 'gtDXFImportUpload',
            body: 'gtDXFImportUploadBody',
            position: 'left',
        },
        {
            id: 'gt-dxf-crs',
            target: '#spatial-modal, .spatial-blueprint-modal',
            title: 'gtDXFImportCRS',
            body: 'gtDXFImportCRSBody',
            position: 'left',
        },
        {
            id: 'gt-dxf-complete',
            target: '#canvas-container',
            title: 'gtDXFImportComplete',
            body: 'gtDXFImportCompleteBody',
            position: 'bottom',
            postAction: () => window.closeModal?.('spatial-modal'),
        },
    ],
});

// ----------------------------------------------------------------
// Tour 22: Map Picker (Geo-location)
// ----------------------------------------------------------------

registerGuidedTour({
    id: 'map-picker-geolocation',
    categoryId: 'spatial-interpolation',
    nameKey: 'guidedTourMapPicker',
    descKey: 'guidedTourMapPickerDesc',
    icon: 'map-pin',
    difficulty: 'beginner',
    estimatedMinutes: 2,
    prerequisites: { minElements: 0, autoScaffold: false },
    steps: [
        {
            id: 'gt-map-project',
            target: '.tab[data-tab="project"]',
            title: 'gtMapPickerProject',
            body: 'gtMapPickerProjectBody',
            position: 'bottom',
            action: () => {
                const rp = document.getElementById('right-panel');
                if (rp && rp.classList.contains('panel-minimized')) window.toggleRightPanel?.();
                document.querySelector('.tab[data-tab="project"]')?.click();
            },
        },
        {
            id: 'gt-map-btn',
            target: '[onclick*="handleOpenMapPicker"]',
            title: 'gtMapPickerBtn',
            body: 'gtMapPickerBtnBody',
            position: 'left',
        },
        {
            id: 'gt-map-overlay',
            target: '.map-picker-overlay, #map-picker-modal',
            title: 'gtMapPickerOverlay',
            body: 'gtMapPickerOverlayBody',
            position: 'bottom',
            action: () => window.handleOpenMapPicker?.(),
            delay: 500,
        },
        {
            id: 'gt-map-complete',
            target: '#canvas-container',
            title: 'gtMapPickerComplete',
            body: 'gtMapPickerCompleteBody',
            position: 'bottom',
            postAction: () => {
                const overlay = document.querySelector('.map-picker-overlay');
                if (overlay) overlay.style.display = 'none';
            },
        },
    ],
});

// ----------------------------------------------------------------
// Tour 23: Create Terrain Layer
// ----------------------------------------------------------------

registerGuidedTour({
    id: 'terrain-layer',
    categoryId: 'spatial-interpolation',
    nameKey: 'guidedTourTerrainLayer',
    descKey: 'guidedTourTerrainLayerDesc',
    icon: 'triangle',
    difficulty: 'intermediate',
    estimatedMinutes: 3,
    prerequisites: { minElements: 3, minObservations: 3, autoScaffold: true },
    steps: [
        {
            id: 'gt-terrain-ribbon',
            target: '[data-ribbon="optimize"]',
            title: 'gtTerrainLayerRibbon',
            body: 'gtTerrainLayerRibbonBody',
            position: 'bottom',
            action: () => window.switchRibbonTab?.('optimize'),
        },
        {
            id: 'gt-terrain-btn',
            target: '[onclick*="handleAddTerrainLayer"]',
            title: 'gtTerrainLayerBtn',
            body: 'gtTerrainLayerBtnBody',
            position: 'bottom',
        },
        {
            id: 'gt-terrain-config',
            target: '#canvas-container',
            title: 'gtTerrainLayerConfig',
            body: 'gtTerrainLayerConfigBody',
            position: 'bottom',
        },
        {
            id: 'gt-terrain-result',
            target: '#canvas-container',
            title: 'gtTerrainLayerResult',
            body: 'gtTerrainLayerResultBody',
            position: 'bottom',
        },
        {
            id: 'gt-terrain-complete',
            target: '#canvas-container',
            title: 'gtTerrainLayerComplete',
            body: 'gtTerrainLayerCompleteBody',
            position: 'bottom',
        },
    ],
});

// ----------------------------------------------------------------
// Tour 24: Create Contamination Layer
// ----------------------------------------------------------------

registerGuidedTour({
    id: 'contamination-layer',
    categoryId: 'spatial-interpolation',
    nameKey: 'guidedTourContamLayer',
    descKey: 'guidedTourContamLayerDesc',
    icon: 'alert-triangle',
    difficulty: 'intermediate',
    estimatedMinutes: 3,
    prerequisites: { minElements: 3, minObservations: 3, autoScaffold: true },
    steps: [
        {
            id: 'gt-contam-ribbon',
            target: '[onclick*="handleOpenInterpolationPanel"]',
            title: 'gtContamLayerRibbon',
            body: 'gtContamLayerRibbonBody',
            position: 'bottom',
            action: () => window.switchRibbonTab?.('optimize'),
            delay: 200,
        },
        {
            id: 'gt-contam-modal',
            target: '#interpolation-modal, [id*="interpolation"]',
            title: 'gtContamLayerModal',
            body: 'gtContamLayerModalBody',
            position: 'left',
            action: () => window.handleOpenInterpolationPanel?.(),
            delay: 300,
        },
        {
            id: 'gt-contam-param',
            target: '#interpolation-modal, [id*="interpolation"]',
            title: 'gtContamLayerParam',
            body: 'gtContamLayerParamBody',
            position: 'left',
        },
        {
            id: 'gt-contam-method',
            target: '#interpolation-modal, [id*="interpolation"]',
            title: 'gtContamLayerMethod',
            body: 'gtContamLayerMethodBody',
            position: 'left',
        },
        {
            id: 'gt-contam-complete',
            target: '#canvas-container',
            title: 'gtContamLayerComplete',
            body: 'gtContamLayerCompleteBody',
            position: 'bottom',
            postAction: () => window.handleCloseInterpolationPanel?.(),
        },
    ],
});

// ----------------------------------------------------------------
// Tour 25: Potentiometric Map
// ----------------------------------------------------------------

registerGuidedTour({
    id: 'potentiometric-map',
    categoryId: 'spatial-interpolation',
    nameKey: 'guidedTourPotentiometric',
    descKey: 'guidedTourPotentiometricDesc',
    icon: 'activity',
    difficulty: 'advanced',
    estimatedMinutes: 3,
    prerequisites: { minElements: 3, minObservations: 3, autoScaffold: true },
    steps: [
        {
            id: 'gt-pot-ribbon',
            target: '[onclick*="handleOpenInterpolationPanel"]',
            title: 'gtPotentiometricRibbon',
            body: 'gtPotentiometricRibbonBody',
            position: 'bottom',
            action: () => window.switchRibbonTab?.('optimize'),
            delay: 200,
        },
        {
            id: 'gt-pot-modal',
            target: '#interpolation-modal, [id*="interpolation"]',
            title: 'gtPotentiometricModal',
            body: 'gtPotentiometricModalBody',
            position: 'left',
            action: () => window.handleOpenInterpolationPanel?.(),
            delay: 300,
        },
        {
            id: 'gt-pot-water',
            target: '#interpolation-modal, [id*="interpolation"]',
            title: 'gtPotentiometricWater',
            body: 'gtPotentiometricWaterBody',
            position: 'left',
        },
        {
            id: 'gt-pot-flow',
            target: '#interpolation-modal, [id*="interpolation"]',
            title: 'gtPotentiometricFlow',
            body: 'gtPotentiometricFlowBody',
            position: 'left',
        },
        {
            id: 'gt-pot-complete',
            target: '#canvas-container',
            title: 'gtPotentiometricComplete',
            body: 'gtPotentiometricCompleteBody',
            position: 'bottom',
            postAction: () => window.handleCloseInterpolationPanel?.(),
        },
    ],
});

// ----------------------------------------------------------------
// Tour 26: Configure Interpolation Method
// ----------------------------------------------------------------

registerGuidedTour({
    id: 'interpolation-method-config',
    categoryId: 'spatial-interpolation',
    nameKey: 'guidedTourInterpMethod',
    descKey: 'guidedTourInterpMethodDesc',
    icon: 'sliders',
    difficulty: 'advanced',
    estimatedMinutes: 2,
    prerequisites: { minElements: 3, minObservations: 3, autoScaffold: true },
    steps: [
        {
            id: 'gt-interpm-open',
            target: '[onclick*="handleOpenInterpolationPanel"]',
            title: 'gtInterpMethodOpen',
            body: 'gtInterpMethodOpenBody',
            position: 'bottom',
            action: () => window.switchRibbonTab?.('optimize'),
            delay: 200,
        },
        {
            id: 'gt-interpm-methods',
            target: '#interpolation-modal, [id*="interpolation"]',
            title: 'gtInterpMethodMethods',
            body: 'gtInterpMethodMethodsBody',
            position: 'left',
            action: () => window.handleOpenInterpolationPanel?.(),
            delay: 300,
        },
        {
            id: 'gt-interpm-params',
            target: '#interpolation-modal, [id*="interpolation"]',
            title: 'gtInterpMethodParams',
            body: 'gtInterpMethodParamsBody',
            position: 'left',
        },
        {
            id: 'gt-interpm-complete',
            target: '#interpolation-modal, [id*="interpolation"]',
            title: 'gtInterpMethodComplete',
            body: 'gtInterpMethodCompleteBody',
            position: 'left',
            postAction: () => window.handleCloseInterpolationPanel?.(),
        },
    ],
});

// ----------------------------------------------------------------
// Tour 27: Geological Cross-section
// ----------------------------------------------------------------

registerGuidedTour({
    id: 'geological-cross-section',
    categoryId: 'spatial-interpolation',
    nameKey: 'guidedTourCrossSection',
    descKey: 'guidedTourCrossSectionDesc',
    icon: 'activity',
    difficulty: 'intermediate',
    estimatedMinutes: 4,
    prerequisites: { minElements: 0, autoScaffold: true, autoGenerateModel: true },
    steps: [
        {
            id: 'gt-xs-intro',
            target: '#canvas-container',
            title: 'gtCrossSectionIntro',
            body: 'gtCrossSectionIntroBody',
            position: 'bottom',
            action: () => {
                // Gera modelo com perfis geológicos se não existir
                const hasWells = window.getAllElements?.().some((e) => e.family === 'well');
                if (!hasWells) {
                    window.generateRandomModel?.();
                    setTimeout(() => {
                        if (window.handleFamilySelectConfirm) window.handleFamilySelectConfirm();
                    }, 500);
                }
            },
            delay: 1000,
        },
        {
            id: 'gt-xs-open',
            target: '[onclick*="handleOpenInterpolationPanel"]',
            title: 'gtCrossSectionOpen',
            body: 'gtCrossSectionOpenBody',
            position: 'bottom',
            action: () => window.switchRibbonTab?.('optimize'),
            delay: 200,
        },
        {
            id: 'gt-xs-btn',
            target: '[onclick*="handleOpenCrossSectionPanel"]',
            title: 'gtCrossSectionBtn',
            body: 'gtCrossSectionBtnBody',
            position: 'left',
            action: () => {
                window.handleOpenInterpolationPanel?.();
            },
            delay: 300,
        },
        {
            id: 'gt-xs-draw',
            target: '#cross-section-panel',
            title: 'gtCrossSectionDraw',
            body: 'gtCrossSectionDrawBody',
            position: 'right',
            action: () => {
                window.handleOpenCrossSectionPanel?.();
                setTimeout(() => {
                    // Inicia modo de desenho automaticamente
                    window.handleStartCrossSection?.();
                }, 500);
            },
            delay: 500,
        },
        {
            id: 'gt-xs-result',
            target: '#cross-section-canvas',
            title: 'gtCrossSectionResult',
            body: 'gtCrossSectionResultBody',
            position: 'right',
            // Simula o resultado quando o usuário completa o passo
        },
        {
            id: 'gt-xs-export',
            target: '#cross-section-panel .side-panel-actions',
            title: 'gtCrossSectionExport',
            body: 'gtCrossSectionExportBody',
            position: 'left',
        },
        {
            id: 'gt-xs-complete',
            target: '#canvas-container',
            title: 'gtCrossSectionComplete',
            body: 'gtCrossSectionCompleteBody',
            position: 'bottom',
            postAction: () => window.handleCloseCrossSectionPanel?.(),
        },
    ],
});
