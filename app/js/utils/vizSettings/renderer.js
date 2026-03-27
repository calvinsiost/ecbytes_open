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
   VIZ SETTINGS RENDERER — DOM controls, sliders, color picker
   ================================================================

   Barra de visualizacao 3D no rodape do viewport.
   Presets como botoes, controles individuais como toggles/sliders.
   Posicao absoluta, empurra constellation para cima quando visivel.

   ================================================================ */

import { getVizSettingsConfig, getActiveSettings, getBuiltinPresets, getUserPresets } from './manager.js';
import { getIcon } from '../ui/icons.js';
import { t } from '../i18n/translations.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let bar = null;

// ----------------------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------------------

/**
 * Create viz settings bar DOM element.
 * Appended to #main-area for absolute positioning.
 */
export function initVizSettingsBar() {
    if (bar) return;

    bar = document.createElement('div');
    bar.id = 'viz-settings-bar';
    bar.className = 'viz-settings-bar';
    bar.style.display = 'none';

    // Inserido antes do constellation HUD no flex flow do main-area
    // Nao usar position:absolute — ocupa espaco no flex e nao bloqueia o resize handle
    const mainArea = document.getElementById('main-area');
    const hud = document.getElementById('constellation-hud');
    if (mainArea && hud) {
        mainArea.insertBefore(bar, hud);
    } else if (mainArea) {
        mainArea.appendChild(bar);
    }

    renderVizSettings();
    setupVizSettingsResize();
}

/**
 * Setup vertical resize handle at the top of viz settings bar.
 * Permite o usuario redimensionar a altura do painel arrastando a borda superior.
 */
function setupVizSettingsResize() {
    if (!bar || bar.querySelector('.vizSettings-resize-top')) return;

    const resizeDiv = document.createElement('div');
    resizeDiv.className = 'vizSettings-resize-top';
    bar.insertBefore(resizeDiv, bar.firstChild);

    // Restaurar altura salva
    const savedH = localStorage.getItem('ecbyts-vizsettings-height');
    if (savedH) bar.style.height = savedH;

    let startY, startH;

    resizeDiv.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();

        startY = e.clientY;
        startH = bar.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';

        const onMove = (me) => {
            const delta = startY - me.clientY;
            const newH = Math.max(80, Math.min(400, startH + delta));
            bar.style.height = newH + 'px';
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            try {
                localStorage.setItem('ecbyts-vizsettings-height', bar.style.height);
            } catch (_) {}
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ----------------------------------------------------------------
// RENDERING
// ----------------------------------------------------------------

/**
 * Render the viz settings bar content.
 * Gera presets, controles, e botoes de acao.
 */
export function renderVizSettings() {
    if (!bar) return;

    const config = getVizSettingsConfig();
    bar.style.display = config.visible ? '' : 'none';

    if (config.visible) {
        document.getElementById('main-area')?.classList.add('viz-settings-active');
    } else {
        document.getElementById('main-area')?.classList.remove('viz-settings-active');
        return;
    }

    const s = getActiveSettings();
    const presets = getBuiltinPresets();
    const userPresets = getUserPresets();

    // --- Preset buttons ---
    const presetButtons = Object.entries(presets)
        .map(([id, p]) => {
            const active = config.activePreset === id ? 'viz-preset-active' : '';
            return `<button type="button" class="viz-preset-btn ${active}" onclick="handleApplyVizPreset('${id}')" title="${p.name}">
            ${getIcon(p.icon, { size: '14px' })}
            <span>${p.name}</span>
        </button>`;
        })
        .join('');

    const userPresetButtons = userPresets
        .map((p) => {
            const active = config.activePreset === p.id ? 'viz-preset-active' : '';
            return `<button type="button" class="viz-preset-btn viz-preset-user ${active}" onclick="handleApplyVizPreset('${p.id}')" title="${p.name}">
            ${getIcon('bookmark', { size: '14px' })}
            <span>${p.name}</span>
            <span class="viz-preset-delete" onclick="event.stopPropagation(); handleDeleteVizPreset('${p.id}')" title="Delete">
                ${getIcon('x', { size: '10px' })}
            </span>
        </button>`;
        })
        .join('');

    const customActive = config.activePreset === 'custom' ? 'viz-preset-active' : '';

    // --- Build HTML ---
    bar.innerHTML = `
        <div class="viz-settings-header" onclick="handleToggleVizSettingsCollapsed()" style="cursor:pointer" title="${config.collapsed ? 'Expand' : 'Collapse'}">
            <span class="viz-settings-title">${getIcon('sliders', { size: '14px' })} ${t('vizSettings') || 'Viz Settings'}</span>
            <div class="viz-settings-header-actions">
                <button type="button" class="viz-settings-btn" onclick="event.stopPropagation(); handleToggleVizSettingsCollapsed()" title="${config.collapsed ? 'Expand' : 'Collapse'}">
                    ${getIcon(config.collapsed ? 'chevron-up' : 'chevron-down', { size: '14px' })}
                </button>
                <button type="button" class="viz-settings-btn" onclick="event.stopPropagation(); handleToggleVizSettings()" title="${t('close') || 'Close'}">
                    ${getIcon('x', { size: '14px' })}
                </button>
            </div>
        </div>
        ${
            config.collapsed
                ? ''
                : `
        <div class="viz-settings-body">
            <div class="viz-presets-row">
                ${presetButtons}
                ${userPresetButtons}
                <button type="button" class="viz-preset-btn ${customActive}" onclick="handleResetVizSettings()" title="Custom">
                    ${getIcon('settings', { size: '14px' })}
                    <span>${t('custom') || 'Custom'}</span>
                </button>
            </div>
            <div class="viz-controls-grid">
                ${renderToggle('fog.enabled', t('fog') || 'Fog', s.fog.enabled)}
                ${renderSlider('fog.near', t('fogNear') || 'Near', s.fog.near, 10, 500, 10, !s.fog.enabled)}
                ${renderSlider('fog.far', t('fogFar') || 'Far', s.fog.far, 50, 2000, 50, !s.fog.enabled)}
                ${renderColorPicker('background', 'BG', s.background)}
                ${renderToggle('grid', t('grid') || 'Grid', s.grid)}
                ${renderToggle('wireframe', t('wireframe') || 'Wire', s.wireframe)}
                ${renderToggle('shadows', t('shadows') || 'Shadows', s.shadows)}
                ${renderToggle('strata', t('strata') || 'Strata', s.strata)}
                ${renderSlider('ambientIntensity', t('ambient') || 'Ambient', s.ambientIntensity, 0, 1.5, 0.05)}
                ${renderSlider('directionalIntensity', t('sun') || 'Sun', s.directionalIntensity, 0, 1.5, 0.05)}
                ${renderSlider('overlayOpacity', t('overlayOpacity') || 'Overlay', s.overlayOpacity, 0, 1, 0.05)}
                ${renderSlider('verticalExaggeration', t('verticalExag') || 'V.Exag', s.verticalExaggeration, 0.5, 10, 0.5)}
                <div class="viz-control-separator"></div>
                <button type="button" class="viz-action-btn viz-clip-btn" onclick="handleOpenClipPlanes()" title="${t('clipPlanes') || 'Clip Planes'}">
                    ${getIcon('crosshair', { size: '14px' })} ${t('clipPlanes') || 'Clip'}
                    ${(s.clipPlanes || []).filter((p) => p.enabled).length > 0 ? `<span class="viz-clip-badge">${(s.clipPlanes || []).filter((p) => p.enabled).length}</span>` : ''}
                </button>
            </div>
            <div class="viz-actions-row">
                <button type="button" class="viz-action-btn" onclick="handleSaveVizPreset()" title="${t('savePreset') || 'Save Preset'}">
                    ${getIcon('save', { size: '14px' })} ${t('savePreset') || 'Save Preset'}
                </button>
                <button type="button" class="viz-action-btn" onclick="handleResetVizSettings()" title="${t('resetDefault') || 'Reset'}">
                    ${getIcon('rotate-ccw', { size: '14px' })} ${t('resetDefault') || 'Reset'}
                </button>
            </div>
        </div>
        `
        }
    `;
}

// ----------------------------------------------------------------
// CONTROL HELPERS
// ----------------------------------------------------------------

function renderToggle(key, label, checked) {
    const id = `viz-toggle-${key.replace('.', '-')}`;
    return `
        <div class="viz-control viz-control-toggle">
            <label class="viz-toggle-label" for="${id}">${label}</label>
            <label class="viz-toggle-switch">
                <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}
                    onchange="handleVizSettingChange('${key}', this.checked)">
                <span class="viz-toggle-slider"></span>
            </label>
        </div>
    `;
}

function renderSlider(key, label, value, min, max, step, disabled = false) {
    const id = `viz-slider-${key.replace('.', '-')}`;
    const displayValue = value % 1 === 0 ? value : value.toFixed(2);
    return `
        <div class="viz-control viz-control-slider ${disabled ? 'viz-control-disabled' : ''}">
            <label class="viz-slider-label" for="${id}">${label}</label>
            <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"
                ${disabled ? 'disabled' : ''}
                oninput="this.nextElementSibling.textContent = this.value; handleVizSettingChange('${key}', parseFloat(this.value))">
            <span class="viz-slider-value">${displayValue}</span>
        </div>
    `;
}

function renderColorPicker(key, label, value) {
    const id = `viz-color-${key}`;
    return `
        <div class="viz-control viz-control-color">
            <label class="viz-color-label" for="${id}">${label}</label>
            <input type="color" id="${id}" value="${value}"
                onchange="handleVizSettingChange('${key}', this.value)">
        </div>
    `;
}

// ----------------------------------------------------------------
// VISIBILITY
// ----------------------------------------------------------------

/**
 * Show or hide the viz settings bar.
 * @param {boolean} visible
 */
export function setVizSettingsBarVisible(visible) {
    if (bar) {
        bar.style.display = visible ? '' : 'none';
        if (visible) {
            document.getElementById('main-area')?.classList.add('viz-settings-active');
        } else {
            document.getElementById('main-area')?.classList.remove('viz-settings-active');
        }
    }
}
