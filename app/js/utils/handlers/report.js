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
   REPORT HANDLERS — Window functions for report tab & overlay
   Funcoes globais para a tab Report do HUD e overlay full-screen

   Handlers registrados em window.* pelo handlers/index.js
   para uso nos onclick do HTML e chamadas da API bridge.
   ================================================================ */

import {
    setReportTitle,
    addReport,
    removeReport,
    duplicateReport,
    setActiveReport,
    moveReport,
    addFolder,
    removeFolder,
    renameFolder,
    getRootFolders,
} from '../report/manager.js';
import { getSceneById } from '../scenes/manager.js';
import { animateCameraState, setCameraState } from '../scene/controls.js';
import { setReadOnly, isReadOnly } from '../report/editor.js';
import { canDo } from '../auth/permissions.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { asyncConfirm } from '../ui/asyncDialogs.js';

// ----------------------------------------------------------------
// UPDATE ALL UI INJECTION
// ----------------------------------------------------------------

let _updateAllUI = null;

/**
 * Inject updateAllUI function to avoid circular dependency.
 * @param {Function} fn
 */
export function setReportUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ----------------------------------------------------------------
// EXISTING HANDLERS (backward compat — nomes inalterados)
// ----------------------------------------------------------------

/**
 * Handle report title change.
 * @param {string} value - New title
 */
function handleReportTitleChange(value) {
    setReportTitle(value);
}

/**
 * Handle "Insert Scene" button click.
 * Abre o scene picker no editor (delegado ao editor.js via lazy import).
 */
function handleInsertSceneAnchor() {
    // O picker e gerenciado diretamente pelo editor.js toolbar
    // Este handler existe para a API bridge
    import('../report/editor.js').then((m) => {
        const scenes = window.getAllScenes?.() || [];
        if (scenes.length > 0) {
            m.insertSceneAnchor(scenes[0].id);
        } else {
            showToast(t('noScenesForAnchor'), 'warning');
        }
    });
}

/**
 * Handle click on a scene anchor — animate camera to scene's viewStart.
 * Ao clicar numa ancora, transiciona camera para a vista da cena.
 *
 * @param {string} sceneId
 */
function handleReportAnchorClick(sceneId) {
    const scene = getSceneById(sceneId);
    if (!scene) {
        showToast(`Scene "${sceneId}" ${t('sceneDeleted')}`, 'warning');
        return;
    }

    // Aplica visibilidade de elementos da cena (se definida)
    if (scene.elementVisibility) {
        Object.entries(scene.elementVisibility).forEach(([elId, visible]) => {
            window.handleSceneElementFilter?.(sceneId, elId, visible);
        });
    }

    // Aplica campanhas da cena (se definidas)
    if (scene.campaignsStart && scene.campaignsStart.length > 0) {
        // Marca campanhas como visiveis/invisiveis
    }

    // Anima camera para viewStart da cena
    if (scene.viewStart) {
        animateCameraState(scene.viewStart, 600);
    } else if (scene.viewEnd) {
        animateCameraState(scene.viewEnd, 600);
    }
}

/**
 * Handle unified report export — shows format/section picker, then exports.
 * Abre dialog de opções, exporta no formato escolhido com seções selecionadas.
 */
async function handleExportReport() {
    if (!canDo('export')) {
        showToast(t('auth.actionDenied') || "You don't have permission to perform this action.", 'error');
        return;
    }
    try {
        const { showExportOptionsDialog } = await import('../report/exportOptions.js');
        const options = await showExportOptionsDialog();
        if (!options) return; // Cancelado

        if (options.format === 'pdf') {
            const { exportReportPDF } = await import('../report/pdfExport.js');
            await exportReportPDF(options);
            showToast(t('reportExportedPDF') || 'Report exported as PDF', 'success');
        } else if (options.format === 'docx') {
            const { exportReportDOCX } = await import('../report/docxExport.js');
            const result = await exportReportDOCX(options);
            const okMsg = result?.hadInvalidChars
                ? t('reportExportedDOCXSanitized') ||
                  'Report exported as Word document. Invalid characters were removed automatically.'
                : t('reportExportedDOCX') || 'Report exported as Word document';
            showToast(okMsg, 'success');
        }
    } catch (e) {
        console.error('[Report] Export failed:', e);
        if (e?.message === 'DOCX_EXPORT_IN_PROGRESS') {
            showToast(t('reportDocxExportInProgress') || 'A DOCX export is already in progress.', 'warning');
        } else if (e?.message === 'DOCX_EMPTY_CONTENT') {
            showToast(t('reportDocxEmpty') || 'Report is empty.', 'warning');
        } else if (e?.message === 'DOCX_GENERATION_FAILED') {
            showToast(t('reportDocxGenerationFailed') || 'Word export failed. Please try again.', 'error');
        } else {
            showToast(`Export error: ${e.message}`, 'error');
        }
    }
}

/**
 * Handle PDF export of the report (backward compat / API bridge).
 * Carrega dinamicamente o modulo de export e gera o PDF.
 */
async function handleExportReportPDF() {
    try {
        const { exportReportPDF } = await import('../report/pdfExport.js');
        await exportReportPDF();
        showToast(t('reportExported'), 'success');
    } catch (e) {
        console.error('[Report] PDF export failed:', e);
        showToast(`PDF export error: ${e.message}`, 'error');
    }
}

/**
 * Scroll report editor to the anchor for a given scene (bidirectional sync).
 * Chamado ao clicar "Go to Report" no painel de cenas.
 *
 * @param {string} sceneId
 */
function handleScrollToReportAnchor(sceneId) {
    // Switch to report tab first
    window.switchConstellationTab?.('report');

    // After tab switch and lazy load, scroll to anchor
    setTimeout(() => {
        import('../report/editor.js').then((m) => {
            m.scrollToAnchor(sceneId);
        });
    }, 100);
}

// ----------------------------------------------------------------
// NEW HANDLERS — Overlay full-screen, split, read mode
// ----------------------------------------------------------------

/**
 * Open the report overlay in full-screen mode.
 * Carrega overlay.js sob demanda e mostra o editor full-screen.
 */
async function handleOpenReportOverlay() {
    try {
        const { showOverlay } = await import('../report/overlay.js');
        showOverlay();
    } catch (e) {
        console.error('[Report] Overlay failed to open:', e);
        showToast('Report overlay error', 'error');
    }
}

/**
 * Close the report overlay and return to embedded mode.
 * Reparenta editor de volta para o HUD Constellation.
 */
async function handleCloseReportOverlay() {
    try {
        const { hideOverlay } = await import('../report/overlay.js');
        hideOverlay();
    } catch (e) {
        console.error('[Report] Overlay failed to close:', e);
    }
}

/**
 * Toggle split-screen mode in the report overlay.
 * Alterna entre full-screen e viewport 3D + report lado a lado.
 */
async function handleToggleReportSplit() {
    try {
        const { toggleSplit, isOverlayVisible } = await import('../report/overlay.js');
        if (isOverlayVisible()) {
            toggleSplit();
        } else {
            // Se overlay nao esta aberto, abre primeiro em split
            const { showOverlay } = await import('../report/overlay.js');
            showOverlay();
            setTimeout(() => toggleSplit(), 100);
        }
    } catch (e) {
        console.error('[Report] Split toggle failed:', e);
    }
}

/**
 * Toggle read/edit mode in the report.
 * Alterna entre modo leitura (toolbar escondida, nao editavel) e edicao.
 */
async function handleToggleReportReadMode() {
    const newState = !isReadOnly();
    setReadOnly(newState);

    // Sync overlay button state
    try {
        const { syncReadModeState } = await import('../report/overlay.js');
        syncReadModeState();
    } catch {
        // Overlay nao carregado — ok em embedded mode
    }
}

/**
 * Placeholder for print preview (future feature).
 */
function handleReportPrintPreview() {
    showToast('Print preview — em breve', 'info');
}

/**
 * Handle technical drawing plate PDF export.
 * Carrega dinamicamente o modulo plateExport e gera a prancha tecnica.
 */
async function handleExportPlatePDF() {
    try {
        const { exportPlatePDF } = await import('../report/plateExport.js');
        await exportPlatePDF();
        showToast(t('plateExported'), 'success');
    } catch (e) {
        console.error('[Plate] PDF export failed:', e);
        showToast(`Plate PDF error: ${e.message}`, 'error');
    }
}

// ----------------------------------------------------------------
// MULTI-REPORT HANDLERS — CRUD de relatorios e pastas
// ----------------------------------------------------------------

/**
 * Add new report in the specified folder.
 * @param {string} [folderId] - Target folder; defaults to first root folder
 */
function handleAddReport(folderId) {
    const targetFolder = folderId || getRootFolders()[0]?.id;
    if (!targetFolder) return;

    const report = addReport(targetFolder);
    if (!report) {
        showToast(t('reportMaxReached') || 'Max reports reached (20)', 'warning');
        return;
    }
    setActiveReport(report.id);
    _syncEditorAndOverlay();
    showToast(t('reportAdd') || 'New report created', 'success');
}

/**
 * Remove a report by ID.
 * @param {string} [id] - Report ID; skips if only 1 report left
 */
async function handleRemoveReport(id) {
    if (!id) return;
    if (!(await asyncConfirm(t('reportRemove') + '?'))) return;
    const ok = removeReport(id);
    if (!ok) {
        showToast('Cannot delete the last report', 'warning');
        return;
    }
    _syncEditorAndOverlay();
    showToast(t('reportRemove') || 'Report deleted', 'success');
}

/**
 * Duplicate a report.
 * @param {string} [id] - Source report ID
 */
function handleDuplicateReport(id) {
    if (!id) return;
    const dup = duplicateReport(id);
    if (!dup) {
        showToast(t('reportMaxReached') || 'Max reports reached', 'warning');
        return;
    }
    setActiveReport(dup.id);
    _syncEditorAndOverlay();
    showToast(t('reportDuplicate') || 'Report duplicated', 'success');
}

/**
 * Switch to a different report.
 * @param {string} id - Target report ID
 */
async function handleSwitchReport(id) {
    if (!id) return;
    setActiveReport(id);

    // Switch editor content
    try {
        const { switchEditorReport } = await import('../report/editor.js');
        switchEditorReport();
    } catch {
        /* editor not loaded yet */
    }

    // Sync overlay title
    try {
        const { syncOverlayTitle } = await import('../report/overlay.js');
        syncOverlayTitle?.();
    } catch {
        /* overlay not loaded */
    }

    // Open overlay in split if not visible
    window.handleToggleReportSplit?.();
}

/**
 * Move a report to a different folder.
 * @param {string} reportId
 * @param {string} targetFolderId
 */
function handleMoveReport(reportId, targetFolderId) {
    if (!reportId || !targetFolderId) return;
    moveReport(reportId, targetFolderId);
    showToast(t('reportSwitched') || 'Report moved', 'success');
}

/**
 * Add a new folder.
 * @param {string|null} [parentId=null] - Parent folder; null = root
 */
function handleAddFolder(parentId) {
    const name = t('reportFolderDefault') || 'General';
    const folder = addFolder(name, parentId || null);
    if (!folder) {
        showToast(t('reportFolderMaxDepth') || 'Max folder depth reached', 'warning');
        return;
    }
    showToast(t('reportFolderAdd') || 'Folder created', 'success');
}

/**
 * Remove a folder and all its contents.
 * @param {string} id
 */
async function handleRemoveFolder(id) {
    if (!id) return;
    if (!(await asyncConfirm(t('reportFolderRemoveConfirm') || 'Delete folder and all its contents?'))) return;
    const ok = removeFolder(id);
    if (!ok) {
        showToast('Cannot delete the last folder', 'warning');
        return;
    }
    _syncEditorAndOverlay();
    showToast(t('reportFolderRemove') || 'Folder deleted', 'success');
}

/**
 * Rename a folder.
 * @param {string} id
 * @param {string} name
 */
function handleRenameFolder(id, name) {
    if (!id || !name) return;
    renameFolder(id, name);
    showToast(t('reportFolderRename') || 'Folder renamed', 'success');
}

/**
 * Helper: sync editor and overlay after CRUD.
 * @private
 */
async function _syncEditorAndOverlay() {
    try {
        const { switchEditorReport } = await import('../report/editor.js');
        switchEditorReport();
    } catch {
        /* */
    }
    try {
        const { syncOverlayTitle } = await import('../report/overlay.js');
        syncOverlayTitle?.();
    } catch {
        /* */
    }
}

// ----------------------------------------------------------------
// FILTER PRESETS — Abre modal de gerenciamento de filter presets
// ----------------------------------------------------------------

/**
 * Open the filter preset management modal.
 */
async function handleOpenFilterPresets() {
    try {
        const { openFilterPresetModal } = await import('../ui/filterPresetModal.js');
        openFilterPresetModal();
    } catch (e) {
        console.error('[Report] Filter preset modal failed:', e);
        showToast('Filter preset error', 'error');
    }
}

// ----------------------------------------------------------------
// EXPORT
// ----------------------------------------------------------------

export const reportHandlers = {
    handleReportTitleChange,
    handleInsertSceneAnchor,
    handleReportAnchorClick,
    handleExportReport,
    handleExportReportPDF,
    handleExportPlatePDF,
    handleScrollToReportAnchor,
    handleOpenReportOverlay,
    handleCloseReportOverlay,
    handleToggleReportSplit,
    handleToggleReportReadMode,
    handleReportPrintPreview,
    // Multi-report CRUD
    handleAddReport,
    handleRemoveReport,
    handleDuplicateReport,
    handleSwitchReport,
    handleMoveReport,
    // Folder CRUD
    handleAddFolder,
    handleRemoveFolder,
    handleRenameFolder,
    // Filter presets
    handleOpenFilterPresets,
};
