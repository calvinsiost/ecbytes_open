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
   XLSX HANDLER — Handler para exportacao de dados em planilhas
   ================================================================ */

import { exportXLSX } from '../../core/io/formats/xlsx.js';
import { buildModel } from '../../core/io/export.js';
import { canDo } from '../auth/permissions.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';

/**
 * Handle XLSX export of the model.
 * @param {string} template - 'edd-br' | 'edd-r2' | 'ohs-aiha' | 'ecbyts'
 */
export async function handleExportXLSX(template = 'ecbyts') {
    if (!canDo('export')) {
        showToast(t('auth.actionDenied') || "You don't have permission to perform this action.", 'error');
        return;
    }
    try {
        const model = buildModel();
        const blob = await exportXLSX(model, { template });

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ecbyts_export_${template}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);

        showToast(t('xlsxExported') || 'Planilha exportada com sucesso', 'success');
    } catch (e) {
        console.error('[XLSX] Export failed:', e);
        showToast(`Export error: ${e.message}`, 'error');
    }
}

/**
 * Open the XLSX export template selection dialog.
 * Abre o modal de selecao de template e dispara exportacao ao confirmar.
 */
export async function handleOpenExportTemplateDialog() {
    try {
        const { openExportTemplateModal } = await import('../ui/exportTemplateModal.js');
        openExportTemplateModal((templateId) => handleExportXLSX(templateId));
    } catch (e) {
        console.error('[XLSX] Failed to open template dialog:', e);
        showToast(`Error: ${e.message}`, 'error');
    }
}

export const xlsxHandlers = {
    handleExportXLSX,
    handleOpenExportTemplateDialog,
};
