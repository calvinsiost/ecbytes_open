// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

import { t } from '../i18n/translations.js';
import { showToast } from '../ui/toast.js';
import { buildPreview } from './filePreview.js';
import { getCachedList, getDownloadUrl, list } from './fileManager.js';
import { ERROR_CODE } from './fileConstants.js';

let _state = {
    extension: '',
    source: '',
    scopeType: '',
    tag: '',
    sortBy: 'updated_at',
    sortOrder: 'desc',
};

let _rendering = false;
const _LIST_TIMEOUT_MS = 12000;

export async function renderFilesPanel() {
    if (_rendering) return;
    _rendering = true;
    try {
        const host = document.getElementById('files-content');
        if (!host) return;

        // Feedback imediato enquanto a query Supabase roda
        host.innerHTML = _loadingHtml();

        let q;
        try {
            q = await Promise.race([
                list({
                    extension: _state.extension || undefined,
                    source: _state.source || undefined,
                    scopeType: _state.scopeType || undefined,
                    tag: _state.tag || undefined,
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Files list timeout')), _LIST_TIMEOUT_MS)),
            ]);
        } catch (err) {
            console.error('[Files] render error:', err);
            host.innerHTML = _panelHtml([], err?.message || 'Unknown error');
            return;
        }

        if (!q.ok) {
            host.innerHTML = q.code === ERROR_CODE.NOT_AUTHENTICATED ? _loginRequired() : _panelHtml([], q.error);
            return;
        }
        const rows = _sortRows(q.data, _state.sortBy, _state.sortOrder);
        host.innerHTML = _panelHtml(rows, '');
    } finally {
        _rendering = false;
    }
}

export function updateFilesFilter(key, value) {
    _state = { ..._state, [key]: String(value || '') };
}

export function resetFilesFilter() {
    _state = { extension: '', source: '', scopeType: '', tag: '', sortBy: 'updated_at', sortOrder: 'desc' };
}

export async function openInlinePreview(file) {
    const ext = String(file?.extension || '').toLowerCase();
    if (ext === 'dxf') {
        showToast('DXF preview not available yet.', 'info');
        return;
    }
    let response = await fetch(file?.signedUrl || '');
    // Signed URL pode ter expirado (1h) — tentar renovar antes de falhar
    if ((response.status === 401 || response.status === 403) && file?.id) {
        const renewed = await getDownloadUrl(file.id);
        if (renewed.ok) response = await fetch(renewed.data.url);
    }
    if (!response.ok) {
        showToast(`Preview failed (HTTP ${response.status})`, 'error');
        return;
    }
    const blob = await response.blob();
    const localFile = new File([blob], file.filename || 'file', { type: file.mime_type || blob.type });
    const preview = await buildPreview(localFile, ext);
    if (!preview.ok) {
        showToast(preview.error || 'Preview unavailable', 'error');
        return;
    }
    if (preview.data.type === 'message') {
        showToast(preview.data.message, 'info');
        return;
    }
    // Renderizar preview tabular no painel em vez de usar alert()
    _renderPreviewModal(file.filename || 'Preview', preview.data);
}

function _panelHtml(rows, errorMessage = '') {
    return `
        <div class="section">
            <div class="section-header"><span>${t('filesTab') || 'Files'}</span><span class="chevron">▼</span></div>
            <div class="section-content">
                ${_warningHtml()}
                ${errorMessage ? _error(errorMessage) : ''}
                ${_toolbarHtml(rows.length)}
                ${rows.length ? _tableHtml(rows) : _empty()}
            </div>
        </div>
    `;
}

function _toolbarHtml(total) {
    const extensions = _unique('extension');
    const sources = _unique('source');
    const scopes = _unique('scope_type');
    return `
        <div style="display:grid;grid-template-columns:repeat(3,minmax(80px,1fr));gap:8px;margin-bottom:8px;">
            ${_select('ext', 'extension', extensions, _state.extension)}
            ${_select('source', 'source', sources, _state.source)}
            ${_select('scope', 'scopeType', scopes, _state.scopeType)}
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;margin-bottom:10px;">
            <input type="text" value="${_esc(_state.tag)}" placeholder="tag"
                   oninput="window.handleFilesFilter('tag', this.value)" class="form-input" />
            ${_sortSelect()}
            <button type="button" class="btn btn-secondary" onclick="window.handleFilesClearFilters()">${t('clear') || 'Clear'}</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <input type="file" id="files-upload-input" style="display:none" onchange="window.handleFilesUploadInput(this)" />
            <button type="button" class="btn btn-primary" onclick="document.getElementById('files-upload-input')?.click()">${t('uploadFile') || 'Upload'}</button>
            <button type="button" class="btn btn-secondary" onclick="window.handleFilesDownloadContoursGeoJSON?.()">Baixar curvas (GeoJSON)</button>
            <button type="button" class="btn btn-secondary" onclick="window.handleFilesSaveContoursGeoJSON?.()">Salvar curvas (GeoJSON)</button>
            <span style="font-size:11px;color:var(--neutral-500);">${total} file(s)</span>
        </div>
        <div id="files-drop-zone" ondragover="window.handleFilesDragOver(event)" ondrop="window.handleFilesDrop(event)"
             style="border:1px dashed var(--neutral-300);border-radius:6px;padding:8px;font-size:11px;color:var(--neutral-500);margin-bottom:10px;">
             ${t('filesDropZone') || 'Drag and drop to register without ingestion'}
        </div>
    `;
}

function _tableHtml(rows) {
    const trs = rows
        .map(
            (f) => `
        <tr>
            <td>${_esc(f.filename || '')}</td>
            <td>${_esc((f.extension || '').toUpperCase())}</td>
            <td>${_fmtSize(f.size_bytes)}</td>
            <td>${_esc(f.source || '')}</td>
            <td>${_esc((f.tags || []).join(', '))}</td>
            <td>${_fmtDate(f.updated_at || f.created_at)}</td>
            <td>${_actions(f.id)}</td>
        </tr>
    `,
        )
        .join('');
    return `
        <div style="overflow:auto;max-height:380px;">
            <table class="table" style="width:100%;font-size:11px;">
                <thead><tr><th>${t('filesColName') || 'Name'}</th><th>${t('filesColExt') || 'Ext'}</th><th>${t('filesColSize') || 'Size'}</th><th>${t('filesColSource') || 'Source'}</th><th>${t('filesColTags') || 'Tags'}</th><th>${t('filesColUpdated') || 'Updated'}</th><th>${t('filesColActions') || 'Actions'}</th></tr></thead>
                <tbody>${trs}</tbody>
            </table>
        </div>
    `;
}

function _actions(id) {
    return `
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="btn btn-xs btn-secondary" onclick="window.handleFilesPreview('${id}')">${t('filesBtnPreview') || 'Preview'}</button>
            <button class="btn btn-xs btn-secondary" onclick="window.handleFilesDownload('${id}')">${t('filesBtnDownload') || 'Download'}</button>
            <button class="btn btn-xs btn-secondary" onclick="window.handleFilesReimport('${id}')">${t('filesBtnReimport') || 'Re-import'}</button>
            <button class="btn btn-xs btn-secondary" onclick="window.handleFilesEditTags('${id}')">${t('filesBtnTag') || 'Tag'}</button>
            <button class="btn btn-xs btn-danger" onclick="window.handleFilesDelete('${id}')">${t('filesBtnDelete') || 'Delete'}</button>
        </div>
    `;
}

function _sortSelect() {
    const selected = `${_state.sortBy}:${_state.sortOrder}`;
    return `
        <select class="form-input" onchange="window.handleFilesSort(this.value)">
            <option value="updated_at:desc" ${selected === 'updated_at:desc' ? 'selected' : ''}>Date ↓</option>
            <option value="updated_at:asc" ${selected === 'updated_at:asc' ? 'selected' : ''}>Date ↑</option>
            <option value="filename:asc" ${selected === 'filename:asc' ? 'selected' : ''}>Name A-Z</option>
            <option value="filename:desc" ${selected === 'filename:desc' ? 'selected' : ''}>Name Z-A</option>
            <option value="size_bytes:desc" ${selected === 'size_bytes:desc' ? 'selected' : ''}>Size ↓</option>
            <option value="size_bytes:asc" ${selected === 'size_bytes:asc' ? 'selected' : ''}>Size ↑</option>
        </select>
    `;
}

function _select(label, key, options, selected) {
    const values = options
        .map((v) => `<option value="${_esc(v)}" ${selected === v ? 'selected' : ''}>${_esc(v)}</option>`)
        .join('');
    return `
        <label style="font-size:10px;color:var(--neutral-500);">
            ${label}
            <select class="form-input" onchange="window.handleFilesFilter('${key}', this.value)">
                <option value="">all</option>
                ${values}
            </select>
        </label>
    `;
}

function _unique(key) {
    const values = getCachedList()
        .map((f) => String(f?.[key] || '').trim())
        .filter(Boolean);
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function _warningHtml() {
    try {
        const raw = localStorage.getItem('ecbyts-files-reconcile-warning');
        if (!raw) return '';
        const parsed = JSON.parse(raw);
        return `<div style="background:var(--warning-50);border:1px solid var(--warning-300);padding:8px;border-radius:6px;margin-bottom:8px;font-size:11px;">
            Reconciliation needed: ${_esc(parsed.code || 'files/register_failed')} (${_esc(parsed.at || '')})
            <button type="button" class="btn btn-xs btn-secondary" style="margin-left:8px;" onclick="window.handleFilesDismissWarning()">dismiss</button>
        </div>`;
    } catch (_) {
        return '';
    }
}

function _renderPreviewModal(title, data) {
    const existing = document.getElementById('files-preview-modal');
    if (existing) existing.remove();
    const header = (data.headers || [])
        .map(
            (h) =>
                `<th style="padding:4px 8px;border-bottom:1px solid var(--neutral-300);white-space:nowrap;">${_esc(String(h))}</th>`,
        )
        .join('');
    const rows = (data.rows || [])
        .slice(0, 50)
        .map(
            (r) =>
                `<tr>${r.map((c) => `<td style="padding:3px 8px;font-size:11px;">${_esc(String(c ?? ''))}</td>`).join('')}</tr>`,
        )
        .join('');
    const modal = document.createElement('div');
    modal.id = 'files-preview-modal';
    modal.style.cssText =
        'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
        <div style="background:var(--surface-100,#fff);border-radius:8px;padding:16px;max-width:90vw;max-height:80vh;overflow:auto;min-width:320px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <strong style="font-size:13px;">${_esc(title)}</strong>
                <button type="button" onclick="document.getElementById('files-preview-modal')?.remove()" style="background:none;border:none;font-size:16px;cursor:pointer;">&#10005;</button>
            </div>
            <div style="overflow:auto;">
                <table style="border-collapse:collapse;font-size:11px;width:100%;">
                    <thead><tr style="background:var(--neutral-100,#f5f5f5);">${header}</tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${data.rows?.length > 50 ? `<p style="font-size:10px;color:var(--neutral-500);margin-top:8px;">Showing 50 of ${data.rows.length} rows.</p>` : ''}
        </div>`;
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
}

function _loadingHtml() {
    return `
        <div class="section">
            <div class="section-header"><span>${t('filesTab') || 'Files'}</span><span class="chevron">&#9660;</span></div>
            <div class="section-content">
                <div style="padding:24px;text-align:center;">
                    <p style="font-size:12px;color:var(--neutral-500);">${t('filesLoading') || 'Loading files...'}</p>
                </div>
            </div>
        </div>`;
}

function _loginRequired() {
    return `
        <div class="section">
            <div class="section-header"><span>${t('filesTab') || 'Files'}</span><span class="chevron">&#9660;</span></div>
            <div class="section-content">
                <div style="padding:24px;text-align:center;">
                    <p style="font-size:13px;color:var(--neutral-500);margin-bottom:12px;">
                        ${t('filesLoginRequired') || 'Sign in to access your files.'}
                    </p>
                    <button type="button" class="btn btn-primary" onclick="window.handleOpenAuthModal?.()">
                        ${t('filesLoginBtn') || 'Sign In'}
                    </button>
                </div>
            </div>
        </div>`;
}

function _empty() {
    return `<p style="font-size:11px;color:var(--neutral-500);">${t('filesEmpty') || 'No files registered yet.'}</p>`;
}

function _error(message) {
    return `<p style="font-size:11px;color:var(--error-600);">Files load failed: ${_esc(String(message || 'Unknown error'))}</p>`;
}

function _sortRows(rows, sortBy, order) {
    const dir = order === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        if (sortBy === 'size_bytes') return ((a.size_bytes || 0) - (b.size_bytes || 0)) * dir;
        if (sortBy === 'filename') return String(a.filename || '').localeCompare(String(b.filename || '')) * dir;
        return String(a.updated_at || '').localeCompare(String(b.updated_at || '')) * dir;
    });
}

function _fmtSize(bytes) {
    const n = Number(bytes || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function _fmtDate(value) {
    if (!value) return '-';
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? '-' : dt.toLocaleString();
}

function _esc(v) {
    return String(v || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
