// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   GUIDED TOURS — 3D Modeling & Reporting (5 tours, 22 steps)
   Tours 27-31: voxel geology, voxel edit, create report,
   scene anchors, export report PDF
   ================================================================ */

import { registerGuidedTour } from '../categories.js';
import { ensureRightPanel } from '../steps.js';

// ----------------------------------------------------------------
// Tour 27: Generate Voxel Geology
// ----------------------------------------------------------------

registerGuidedTour({
    id: 'generate-voxel-geology',
    categoryId: 'analysis-modeling',
    nameKey: 'guidedTourVoxelGeology',
    descKey: 'guidedTourVoxelGeologyDesc',
    icon: 'box',
    difficulty: 'intermediate',
    estimatedMinutes: 3,
    prerequisites: { minElements: 3, autoScaffold: true },
    steps: [
        {
            id: 'gt-voxgeo-ribbon',
            target: '[data-ribbon="optimize"]',
            title: 'gtVoxelGeologyRibbon',
            body: 'gtVoxelGeologyRibbonBody',
            position: 'bottom',
            action: () => window.switchRibbonTab?.('optimize'),
        },
        {
            id: 'gt-voxgeo-btn',
            target: '[onclick*="handleGenerateGeology"]',
            title: 'gtVoxelGeologyBtn',
            body: 'gtVoxelGeologyBtnBody',
            position: 'bottom',
        },
        {
            id: 'gt-voxgeo-generate',
            target: '#canvas-container',
            title: 'gtVoxelGeologyGenerate',
            body: 'gtVoxelGeologyGenerateBody',
            position: 'bottom',
        },
        {
            id: 'gt-voxgeo-toolbar',
            target: '#voxel-toolbar, .voxel-toolbar',
            title: 'gtVoxelGeologyToolbar',
            body: 'gtVoxelGeologyToolbarBody',
            position: 'bottom',
            delay: 300,
        },
        {
            id: 'gt-voxgeo-complete',
            target: '#canvas-container',
            title: 'gtVoxelGeologyComplete',
            body: 'gtVoxelGeologyCompleteBody',
            position: 'bottom',
        },
    ],
});

// ----------------------------------------------------------------
// Tour 28: Voxel Edit Mode
// ----------------------------------------------------------------

registerGuidedTour({
    id: 'voxel-edit-mode',
    categoryId: 'analysis-modeling',
    nameKey: 'guidedTourVoxelEdit',
    descKey: 'guidedTourVoxelEditDesc',
    icon: 'edit-2',
    difficulty: 'advanced',
    estimatedMinutes: 3,
    prerequisites: { minElements: 3, autoScaffold: true },
    steps: [
        {
            id: 'gt-voxedit-mode',
            target: '[onclick*="handleToggleVoxelMode"]',
            title: 'gtVoxelEditMode',
            body: 'gtVoxelEditModeBody',
            position: 'bottom',
            action: () => window.switchRibbonTab?.('optimize'),
            delay: 200,
        },
        {
            id: 'gt-voxedit-solid',
            target: '[data-voxel-mode="solid"]',
            title: 'gtVoxelEditSolid',
            body: 'gtVoxelEditSolidBody',
            position: 'bottom',
        },
        {
            id: 'gt-voxedit-individual',
            target: '[data-voxel-mode="voxels"]',
            title: 'gtVoxelEditIndividual',
            body: 'gtVoxelEditIndividualBody',
            position: 'bottom',
        },
        {
            id: 'gt-voxedit-complete',
            target: '#canvas-container',
            title: 'gtVoxelEditComplete',
            body: 'gtVoxelEditCompleteBody',
            position: 'bottom',
        },
    ],
});

// ----------------------------------------------------------------
// Tour 29: Create Report
// ----------------------------------------------------------------

registerGuidedTour({
    id: 'create-report',
    categoryId: 'analysis-modeling',
    nameKey: 'guidedTourCreateReport',
    descKey: 'guidedTourCreateReportDesc',
    icon: 'file-text',
    difficulty: 'beginner',
    estimatedMinutes: 3,
    prerequisites: { minElements: 0, autoScaffold: false },
    steps: [
        {
            id: 'gt-rep-tab',
            target: '.tab[data-tab="reports"], .tab[data-tab="report"]',
            title: 'gtCreateReportTab',
            body: 'gtCreateReportTabBody',
            position: 'bottom',
            action: () => {
                ensureRightPanel();
                document.querySelector('.tab[data-tab="reports"]')?.click();
                document.querySelector('.tab[data-tab="report"]')?.click();
            },
        },
        {
            id: 'gt-rep-add',
            target: '#right-panel',
            title: 'gtCreateReportAdd',
            body: 'gtCreateReportAddBody',
            position: 'left',
        },
        {
            id: 'gt-rep-editor',
            target: '#right-panel',
            title: 'gtCreateReportEditor',
            body: 'gtCreateReportEditorBody',
            position: 'left',
        },
        {
            id: 'gt-rep-sections',
            target: '#right-panel',
            title: 'gtCreateReportSections',
            body: 'gtCreateReportSectionsBody',
            position: 'left',
        },
        {
            id: 'gt-rep-complete',
            target: '#right-panel',
            title: 'gtCreateReportComplete',
            body: 'gtCreateReportCompleteBody',
            position: 'left',
        },
    ],
});

// ----------------------------------------------------------------
// Tour 30: Report Scene Anchors
// ----------------------------------------------------------------

registerGuidedTour({
    id: 'report-scene-anchors',
    categoryId: 'analysis-modeling',
    nameKey: 'guidedTourSceneAnchors',
    descKey: 'guidedTourSceneAnchorsDesc',
    icon: 'anchor',
    difficulty: 'intermediate',
    estimatedMinutes: 2,
    prerequisites: { minElements: 1, autoScaffold: true },
    steps: [
        {
            id: 'gt-anch-report',
            target: '#right-panel',
            title: 'gtSceneAnchorsReport',
            body: 'gtSceneAnchorsReportBody',
            position: 'left',
            action: () => {
                ensureRightPanel();
                document.querySelector('.tab[data-tab="reports"]')?.click();
                document.querySelector('.tab[data-tab="report"]')?.click();
            },
        },
        {
            id: 'gt-anch-insert',
            target: '#right-panel',
            title: 'gtSceneAnchorsInsert',
            body: 'gtSceneAnchorsInsertBody',
            position: 'left',
        },
        {
            id: 'gt-anch-navigate',
            target: '#right-panel',
            title: 'gtSceneAnchorsNavigate',
            body: 'gtSceneAnchorsNavigateBody',
            position: 'left',
        },
        {
            id: 'gt-anch-complete',
            target: '#right-panel',
            title: 'gtSceneAnchorsComplete',
            body: 'gtSceneAnchorsCompleteBody',
            position: 'left',
        },
    ],
});

// ----------------------------------------------------------------
// Tour 31: Export Report PDF/DOCX
// ----------------------------------------------------------------

registerGuidedTour({
    id: 'export-report-pdf',
    categoryId: 'analysis-modeling',
    nameKey: 'guidedTourExportReport',
    descKey: 'guidedTourExportReportDesc',
    icon: 'printer',
    difficulty: 'intermediate',
    estimatedMinutes: 2,
    prerequisites: { minElements: 1, autoScaffold: true },
    steps: [
        {
            id: 'gt-reppdf-tab',
            target: '#right-panel',
            title: 'gtExportReportTab',
            body: 'gtExportReportTabBody',
            position: 'left',
            action: () => {
                ensureRightPanel();
                document.querySelector('.tab[data-tab="reports"]')?.click();
                document.querySelector('.tab[data-tab="report"]')?.click();
            },
        },
        {
            id: 'gt-reppdf-format',
            target: '#right-panel',
            title: 'gtExportReportFormat',
            body: 'gtExportReportFormatBody',
            position: 'left',
        },
        {
            id: 'gt-reppdf-options',
            target: '#right-panel',
            title: 'gtExportReportOptions',
            body: 'gtExportReportOptionsBody',
            position: 'left',
        },
        {
            id: 'gt-reppdf-complete',
            target: '#right-panel',
            title: 'gtExportReportComplete',
            body: 'gtExportReportCompleteBody',
            position: 'left',
        },
    ],
});
