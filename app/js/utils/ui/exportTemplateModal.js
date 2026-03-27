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
   EXPORT TEMPLATE MODAL — Seletor de template para exportacao XLSX
   ================================================================

   Exibe modal com radio buttons para escolher o template de
   exportacao. Templates desabilitados aparecem com "(coming soon)".
   Mostra preview com descricao e nomes das planilhas do template.

   ================================================================ */

import { XLSX_TEMPLATES } from '../../core/io/formats/xlsxTemplates.js';
import { t } from '../i18n/translations.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

let _overlay = null;
let _selectedTemplate = 'edd-br';

// ----------------------------------------------------------------
// OPEN / CLOSE
// ----------------------------------------------------------------

/**
 * Open the XLSX export template dialog.
 * Abre o modal de selecao de template de exportacao.
 * @param {Function} onExport - callback(templateId: string)
 */
export function openExportTemplateModal(onExport) {
    _destroyModal();

    _selectedTemplate = _getDefaultEnabled();
    _overlay = _buildOverlay(onExport);
    document.body.appendChild(_overlay);
    _overlay.querySelector('.etm-export-btn').focus();

    const onKey = (e) => {
        if (e.key === 'Escape') {
            document.removeEventListener('keydown', onKey);
            _destroyModal();
        }
    };
    document.addEventListener('keydown', onKey);
}

/**
 * Close and remove the modal from the DOM.
 * Remove o modal e limpa o estado.
 */
function _destroyModal() {
    if (_overlay) {
        _overlay.remove();
        _overlay = null;
    }
}

// ----------------------------------------------------------------
// BUILD
// ----------------------------------------------------------------

/**
 * Build the full overlay element.
 * Constroi overlay + conteudo do modal.
 * @param {Function} onExport
 * @returns {HTMLElement}
 */
function _buildOverlay(onExport) {
    const overlay = document.createElement('div');
    overlay.className = 'etm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', t('xlsxExportDialogTitle') || 'Export XLSX');

    overlay.innerHTML = `
        <div class="etm-dialog">
            <div class="etm-header">
                <span class="etm-title">${_esc(t('xlsxExportDialogTitle') || 'Export XLSX')}</span>
                <button type="button" class="etm-close-btn" aria-label="Close">&#x2715;</button>
            </div>
            <div class="etm-body">
                <div class="etm-template-list" role="radiogroup" aria-label="Template"></div>
                <div class="etm-preview"></div>
            </div>
            <div class="etm-footer">
                <button type="button" class="btn etm-cancel-btn">${_esc(t('cancel') || 'Cancel')}</button>
                <button type="button" class="btn btn-primary etm-export-btn">${_esc(t('export') || 'Export')}</button>
            </div>
        </div>
    `;

    _renderTemplateList(overlay);
    _renderPreview(overlay, _selectedTemplate);

    overlay.querySelector('.etm-close-btn').addEventListener('click', _destroyModal);
    overlay.querySelector('.etm-cancel-btn').addEventListener('click', _destroyModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) _destroyModal();
    });

    overlay.querySelector('.etm-export-btn').addEventListener('click', () => {
        _destroyModal();
        onExport(_selectedTemplate);
    });

    return overlay;
}

/**
 * Render radio buttons for each template.
 * Renderiza lista de templates com radio buttons.
 * @param {HTMLElement} overlay
 */
function _renderTemplateList(overlay) {
    const list = overlay.querySelector('.etm-template-list');
    list.innerHTML = Object.values(XLSX_TEMPLATES)
        .map((tpl) => {
            const name = _esc(t(tpl.nameKey) || tpl.id);
            const comingSoon = tpl.enabled
                ? ''
                : ` <span class="etm-coming-soon">(${_esc(t('comingSoon') || 'coming soon')})</span>`;
            const checked = tpl.id === _selectedTemplate && tpl.enabled ? 'checked' : '';
            const disabled = tpl.enabled ? '' : 'disabled';

            return `<label class="etm-radio-item${tpl.enabled ? '' : ' etm-radio-item--disabled'}">
            <input type="radio" name="xlsx-template" value="${_esc(tpl.id)}"
                   ${checked} ${disabled}>
            <span class="etm-radio-label">${name}${comingSoon}</span>
        </label>`;
        })
        .join('');

    list.querySelectorAll('input[type="radio"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            _selectedTemplate = radio.value;
            _renderPreview(overlay, _selectedTemplate);
        });
    });
}

/**
 * Render preview panel for the selected template.
 * Mostra descricao e lista de planilhas do template selecionado.
 * @param {HTMLElement} overlay
 * @param {string} templateId
 */
function _renderPreview(overlay, templateId) {
    const preview = overlay.querySelector('.etm-preview');
    const tpl = XLSX_TEMPLATES[templateId];
    if (!tpl) {
        preview.innerHTML = '';
        return;
    }

    const desc = _esc(t(tpl.descKey) || '');
    const sheetNames = tpl.sheets.map((s) => `<span class="etm-sheet-chip">${_esc(s.name)}</span>`).join('');

    preview.innerHTML = `
        <p class="etm-preview-desc">${desc}</p>
        <div class="etm-sheet-chips">${sheetNames}</div>
    `;
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

/**
 * Return the first enabled template id.
 * Retorna o id do primeiro template habilitado.
 * @returns {string}
 */
function _getDefaultEnabled() {
    const first = Object.values(XLSX_TEMPLATES).find((t) => t.enabled);
    return first ? first.id : 'ecbyts';
}

/** Escape HTML for safe insertion. */
function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
