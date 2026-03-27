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
   VIZ SETTINGS HANDLERS — Window.* functions for HTML onclick
   ================================================================

   Handlers para controles da barra de visualizacao 3D e
   modal de clip planes (multiplos planos de corte).

   ================================================================ */

import {
    getVizSettingsConfig,
    getActiveSettings,
    getUserPresets,
    setVizSettingsVisible,
    setVizSettingsCollapsed,
    applyPreset,
    changeSetting,
    saveUserPreset,
    deleteUserPreset,
    resetToDefault,
    addClipPlane,
    updateClipPlane,
    removeClipPlane,
    duplicateClipPlane,
} from '../vizSettings/manager.js';
import { renderVizSettings, setVizSettingsBarVisible } from '../vizSettings/renderer.js';
import { getAllElements } from '../../core/elements/manager.js';
import { showToast } from '../ui/toast.js';
import { getIcon } from '../ui/icons.js';
import { escapeHtml } from '../helpers/html.js';
import { t } from '../i18n/translations.js';

// ----------------------------------------------------------------
// HANDLERS — Viz Settings Bar
// ----------------------------------------------------------------

/**
 * Toggle viz settings bar visibility.
 */
function handleToggleVizSettings() {
    const config = getVizSettingsConfig();
    const newVisible = !config.visible;
    setVizSettingsVisible(newVisible);
    setVizSettingsBarVisible(newVisible);
    if (newVisible) renderVizSettings();
}

/**
 * Toggle collapsed state (header only vs full controls).
 */
function handleToggleVizSettingsCollapsed() {
    const config = getVizSettingsConfig();
    setVizSettingsCollapsed(!config.collapsed);
    renderVizSettings();
}

/**
 * Apply a preset (builtin or user).
 * @param {string} presetId
 */
function handleApplyVizPreset(presetId) {
    const success = applyPreset(presetId);
    if (success) {
        renderVizSettings();
    }
}

/**
 * Change a single viz setting value.
 * @param {string} key
 * @param {*} value
 */
function handleVizSettingChange(key, value) {
    changeSetting(key, value);
    renderVizSettings();
}

/**
 * Save current settings as a user preset.
 * Nome gerado automaticamente — sem prompt() bloqueante.
 */
function handleSaveVizPreset() {
    const n = (getUserPresets?.() || []).length + 1;
    const name = `Preset ${n}`;
    saveUserPreset(name);
    renderVizSettings();
    showToast(t('presetSaved') || 'Preset saved', 'success');
}

/**
 * Delete a user preset.
 * @param {string} presetId
 */
function handleDeleteVizPreset(presetId) {
    deleteUserPreset(presetId);
    renderVizSettings();
    showToast(t('presetDeleted') || 'Preset deleted', 'info');
}

/**
 * Reset all settings to the default preset.
 */
function handleResetVizSettings() {
    resetToDefault();
    renderVizSettings();
}

// ----------------------------------------------------------------
// HANDLERS — Clip Planes Modal
// ----------------------------------------------------------------

function handleOpenClipPlanes() {
    const modal = document.getElementById('clipplanes-modal');
    if (!modal) return;
    modal.classList.add('visible');
    _renderClipPlanesModal();
}

function handleCloseClipPlanes() {
    const modal = document.getElementById('clipplanes-modal');
    if (modal) modal.classList.remove('visible');
}

function handleAddClipPlane() {
    addClipPlane();
    _renderClipPlanesModal();
    renderVizSettings();
}

function handleRemoveClipPlane(id) {
    removeClipPlane(id);
    _renderClipPlanesModal();
    renderVizSettings();
    showToast(t('clipPlaneRemoved') || 'Clip plane removed', 'info');
}

function handleDuplicateClipPlane(id) {
    duplicateClipPlane(id);
    _renderClipPlanesModal();
    renderVizSettings();
}

function handleToggleClipPlane(id) {
    const s = getActiveSettings();
    const plane = s.clipPlanes.find((p) => p.id === id);
    if (plane) {
        updateClipPlane(id, { enabled: !plane.enabled });
        _renderClipPlanesModal();
        renderVizSettings();
    }
}

function handleUpdateClipPlaneField(id, field, value) {
    const parsed = ['height', 'angle'].includes(field)
        ? Number(value)
        : ['flip', 'enabled'].includes(field)
          ? !!value
          : value;
    updateClipPlane(id, { [field]: parsed });
    // Re-render apenas se nao for um slider (evita flicker durante drag)
    if (!['height', 'angle'].includes(field)) {
        _renderClipPlanesModal();
    }
}

function handleSetClipPlaneScope(id, scope) {
    const changes = { scope };
    if (scope === 'all') changes.elementIds = [];
    updateClipPlane(id, changes);
    _renderClipPlanesModal();
}

function handleToggleClipPlaneElement(planeId, elementId) {
    const s = getActiveSettings();
    const plane = s.clipPlanes.find((p) => p.id === planeId);
    if (!plane) return;
    const ids = [...plane.elementIds];
    const idx = ids.indexOf(elementId);
    if (idx === -1) ids.push(elementId);
    else ids.splice(idx, 1);
    updateClipPlane(planeId, { elementIds: ids });
    _renderClipPlanesModal();
}

// ----------------------------------------------------------------
// MODAL RENDERING
// ----------------------------------------------------------------

/**
 * Renderiza o conteudo do modal de clip planes.
 * Lista de cards, cada um com controles de posicao, angulo, escopo.
 */
function _renderClipPlanesModal() {
    const body = document.getElementById('clipplanes-modal-body');
    if (!body) return;

    const settings = getActiveSettings();
    const planes = settings.clipPlanes || [];
    const allElements = getAllElements();

    if (planes.length === 0) {
        body.innerHTML = `<div class="clipplanes-empty">
            <p>${t('clipPlanesEmpty') || 'No clip planes yet. Add one to slice the 3D scene.'}</p>
        </div>`;
        return;
    }

    body.innerHTML = planes
        .map((plane) => {
            const scopeAll = plane.scope === 'all' || !plane.scope;
            const disabledClass = plane.enabled ? '' : 'clipplane-disabled';

            return `<div class="clipplane-item ${disabledClass}" data-id="${plane.id}">
            <div class="clipplane-header">
                <input type="text" class="clipplane-name" value="${escapeHtml(plane.name || '')}"
                    onchange="window.handleUpdateClipPlaneField('${plane.id}','name',this.value)"
                    placeholder="${t('clipPlaneName') || 'Plane name'}">
                <div class="clipplane-actions">
                    <button type="button" onclick="window.handleToggleClipPlane('${plane.id}')" title="${plane.enabled ? 'Disable' : 'Enable'}">
                        ${getIcon(plane.enabled ? 'eye' : 'eye-off', { size: '14px' })}
                    </button>
                    <button type="button" onclick="window.handleDuplicateClipPlane('${plane.id}')" title="Duplicate">
                        ${getIcon('copy', { size: '14px' })}
                    </button>
                    <button type="button" class="btn-danger" onclick="window.handleRemoveClipPlane('${plane.id}')" title="Remove">
                        ${getIcon('trash-2', { size: '14px' })}
                    </button>
                </div>
            </div>
            <div class="clipplane-body">
                <div class="clipplane-controls">
                    ${_renderClipSlider(plane.id, 'height', t('clipHeight') || 'Depth', plane.height, -100, 100, 1)}
                    ${_renderClipSlider(plane.id, 'angle', t('clipAngle') || 'Angle', plane.angle, 0, 360, 5)}
                    <div class="clipplane-toggle">
                        <label class="viz-toggle-label">${t('clipFlip') || 'Flip'}</label>
                        <label class="viz-toggle-switch">
                            <input type="checkbox" ${plane.flip ? 'checked' : ''}
                                onchange="window.handleUpdateClipPlaneField('${plane.id}','flip',this.checked)">
                            <span class="viz-toggle-slider"></span>
                        </label>
                    </div>
                </div>
                <div class="clipplane-scope">
                    <label class="clipplane-scope-label">${t('clipScope') || 'Scope'}:</label>
                    <select class="clipplane-scope-select" onchange="window.handleSetClipPlaneScope('${plane.id}',this.value)">
                        <option value="all" ${scopeAll ? 'selected' : ''}>${t('clipScopeAll') || 'All elements'}</option>
                        <option value="elements" ${!scopeAll ? 'selected' : ''}>${t('clipScopeElements') || 'Specific elements...'}</option>
                    </select>
                </div>
                ${!scopeAll ? _renderElementPicker(plane, allElements) : ''}
            </div>
        </div>`;
        })
        .join('');
}

/**
 * Renderiza um slider inline para o clip plane modal.
 */
function _renderClipSlider(planeId, field, label, value, min, max, step) {
    const displayValue = value % 1 === 0 ? value : value.toFixed(1);
    return `<div class="clipplane-slider">
        <label class="viz-slider-label">${label}</label>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${value}"
            oninput="this.nextElementSibling.textContent=this.value; window.handleUpdateClipPlaneField('${planeId}','${field}',parseFloat(this.value))">
        <span class="viz-slider-value">${displayValue}</span>
    </div>`;
}

/**
 * Renderiza o picker de elementos para escopo per-element.
 */
function _renderElementPicker(plane, allElements) {
    if (allElements.length === 0) {
        return '<div class="clipplane-picker-empty">No elements in model</div>';
    }
    const checks = allElements
        .map((el) => {
            const checked = (plane.elementIds || []).includes(el.id);
            return `<label class="clipplane-el-check ${checked ? 'clipplane-el-active' : ''}">
            <input type="checkbox" ${checked ? 'checked' : ''}
                onchange="window.handleToggleClipPlaneElement('${plane.id}','${el.id}')">
            <span>${escapeHtml(el.name || el.id)}</span>
            <small>(${el.family})</small>
        </label>`;
        })
        .join('');
    return `<div class="clipplane-element-picker">${checks}</div>`;
}

// ----------------------------------------------------------------
// EXPORT
// ----------------------------------------------------------------

export const vizSettingsHandlers = {
    handleToggleVizSettings,
    handleToggleVizSettingsCollapsed,
    handleApplyVizPreset,
    handleVizSettingChange,
    handleSaveVizPreset,
    handleDeleteVizPreset,
    handleResetVizSettings,
    handleOpenClipPlanes,
    handleCloseClipPlanes,
    handleAddClipPlane,
    handleRemoveClipPlane,
    handleDuplicateClipPlane,
    handleToggleClipPlane,
    handleUpdateClipPlaneField,
    handleSetClipPlaneScope,
    handleToggleClipPlaneElement,
};
