// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   CUSTOMIZE MODAL — UI Customization Interface
   ================================================================
   Modal com 4 tabs: Appearance, Home Actions, Layout, Presets.
   Mudancas aplicadas em tempo real (live preview).
   Segue padrao modal do projeto: overlay + container + close.
   ================================================================ */

import { t } from '../i18n/translations.js';
import {
    getCustomizeState,
    setCustomizeSetting,
    setHomeCards,
    resetCustomize,
    saveUserPreset,
    loadUserPreset,
    deleteUserPreset,
    exportCustomize,
    importCustomize,
    getPaletteDefs,
    getFontOptions,
    getValidDensities,
    contrastRatio,
    generatePalette,
} from '../customize/manager.js';

// ----------------------------------------------------------------
// STATE
// ----------------------------------------------------------------

let _overlayEl = null;
let _activeTab = 'appearance';
let _updateAllUI = null;
let _debounceTimer = null;

/** Known ACTION_CARD ids — lazily loaded from homeGrid */
let _actionCardIds = [];

// ----------------------------------------------------------------
// PUBLIC API
// ----------------------------------------------------------------

/**
 * Inject updateAllUI callback.
 * @param {Function} fn
 */
export function setCustomizeModalUpdateAllUI(fn) {
    _updateAllUI = fn;
}

/**
 * Open the customize modal.
 */
export async function openCustomizeModal() {
    if (_overlayEl) return;
    _activeTab = 'appearance';

    // Lazy-load card definitions to avoid circular dependency
    if (_actionCardIds.length === 0) {
        try {
            const { getActionCardDefs } = await import('./homeGrid.js');
            _actionCardIds = getActionCardDefs();
        } catch {
            /* fallback: empty list */
        }
    }

    _buildModal();
}

/**
 * Close the customize modal.
 */
export function closeCustomizeModal() {
    if (!_overlayEl) return;
    _overlayEl.remove();
    _overlayEl = null;
    if (_updateAllUI) _updateAllUI();
}

// ----------------------------------------------------------------
// BUILD MODAL
// ----------------------------------------------------------------

function _buildModal() {
    const overlay = document.createElement('div');
    overlay.className = 'customize-overlay sym-overlay';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeCustomizeModal();
    });

    const modal = document.createElement('div');
    modal.className = 'customize-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', t('customizeTitle') || 'Customize Interface');

    // Header
    const header = document.createElement('div');
    header.className = 'customize-header';

    const title = document.createElement('h2');
    title.className = 'customize-title';
    title.textContent = t('customizeTitle') || 'Customize Interface';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'customize-close';
    closeBtn.setAttribute('aria-label', t('close') || 'Close');
    closeBtn.innerHTML = '&#10005;';
    closeBtn.addEventListener('click', closeCustomizeModal);

    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Tabs
    const tabBar = _buildTabBar();
    modal.appendChild(tabBar);

    // Content
    const content = document.createElement('div');
    content.className = 'customize-content';
    content.id = 'customize-content';
    modal.appendChild(content);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    _overlayEl = overlay;

    // Keyboard
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeCustomizeModal();
    });

    _renderTab();
    modal.querySelector('.customize-tab-btn')?.focus();
}

function _buildTabBar() {
    const bar = document.createElement('div');
    bar.className = 'customize-tabs';

    const tabs = [
        { id: 'appearance', label: t('customizeAppearance') || 'Appearance' },
        { id: 'homeActions', label: t('customizeHomeActions') || 'Home Actions' },
        { id: 'layout', label: t('customizeLayout') || 'Layout' },
        { id: 'presets', label: t('customizePresets') || 'Presets & Data' },
    ];

    for (const tab of tabs) {
        const btn = document.createElement('button');
        btn.className = 'customize-tab-btn';
        btn.dataset.tab = tab.id;
        btn.textContent = tab.label;
        if (tab.id === _activeTab) btn.classList.add('active');
        btn.addEventListener('click', () => {
            _activeTab = tab.id;
            bar.querySelectorAll('.customize-tab-btn').forEach((b) =>
                b.classList.toggle('active', b.dataset.tab === tab.id),
            );
            _renderTab();
        });
        bar.appendChild(btn);
    }

    return bar;
}

function _renderTab() {
    const content = document.getElementById('customize-content');
    if (!content) return;
    content.innerHTML = '';

    switch (_activeTab) {
        case 'appearance':
            _renderAppearanceTab(content);
            break;
        case 'homeActions':
            _renderHomeActionsTab(content);
            break;
        case 'layout':
            _renderLayoutTab(content);
            break;
        case 'presets':
            _renderPresetsTab(content);
            break;
    }
}

// ----------------------------------------------------------------
// TAB 1: APPEARANCE
// ----------------------------------------------------------------

function _renderAppearanceTab(container) {
    const state = getCustomizeState();

    // --- Font Family ---
    const fontSection = _section(t('customizeFontFamily') || 'Font Family');
    const fontSelect = document.createElement('select');
    fontSelect.className = 'customize-select';
    const fonts = getFontOptions();
    for (const [id, stack] of Object.entries(fonts)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id === 'system' ? 'System Default' : stack.split("'")[1] || id;
        opt.selected = id === state.fontFamily;
        fontSelect.appendChild(opt);
    }
    fontSelect.addEventListener('change', () => {
        setCustomizeSetting('fontFamily', fontSelect.value);
    });
    fontSection.appendChild(fontSelect);
    container.appendChild(fontSection);

    // --- Font Size ---
    const sizeSection = _section(t('customizeFontSize') || 'Font Size');
    const sizeRow = document.createElement('div');
    sizeRow.className = 'customize-row';

    const sizeSlider = document.createElement('input');
    sizeSlider.type = 'range';
    sizeSlider.min = '10';
    sizeSlider.max = '16';
    sizeSlider.step = '1';
    sizeSlider.value = String(state.fontSize);
    sizeSlider.className = 'customize-slider';

    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'customize-value';
    sizeLabel.textContent = `${state.fontSize}px`;

    sizeSlider.addEventListener('input', () => {
        sizeLabel.textContent = `${sizeSlider.value}px`;
        _debounced(() => setCustomizeSetting('fontSize', Number(sizeSlider.value)));
    });

    sizeRow.appendChild(sizeSlider);
    sizeRow.appendChild(sizeLabel);
    sizeSection.appendChild(sizeRow);
    container.appendChild(sizeSection);

    // --- UI Density ---
    const densitySection = _section(t('customizeDensity') || 'UI Density');
    const densityRow = document.createElement('div');
    densityRow.className = 'customize-density-row';

    for (const d of getValidDensities()) {
        const label = document.createElement('label');
        label.className = 'customize-radio-label';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'customize-density';
        radio.value = d;
        radio.checked = d === state.density;
        radio.addEventListener('change', () => {
            setCustomizeSetting('density', d);
        });

        const text = document.createElement('span');
        text.textContent = t(`customizeDensity_${d}`) || d.charAt(0).toUpperCase() + d.slice(1);

        label.appendChild(radio);
        label.appendChild(text);
        densityRow.appendChild(label);
    }

    densitySection.appendChild(densityRow);
    container.appendChild(densitySection);

    // --- Color Palette ---
    const paletteSection = _section(t('customizePalette') || 'Color Palette');
    const paletteGrid = document.createElement('div');
    paletteGrid.className = 'customize-palette-grid';

    const defs = getPaletteDefs();
    for (const [id, def] of Object.entries(defs)) {
        const card = document.createElement('button');
        card.className = 'customize-palette-card';
        if (id === state.palette) card.classList.add('active');
        card.title = def.name;

        // Color swatch strip
        const strip = document.createElement('div');
        strip.className = 'customize-palette-strip';
        const shades = generatePalette(def.h, def.s, false);
        const keys = ['--primary-200', '--primary-400', '--primary-500', '--primary-600', '--primary-800'];
        for (const k of keys) {
            const swatch = document.createElement('span');
            swatch.className = 'customize-swatch';
            swatch.style.background = shades[k];
            strip.appendChild(swatch);
        }

        const name = document.createElement('span');
        name.className = 'customize-palette-name';
        name.textContent = def.name;

        card.appendChild(strip);
        card.appendChild(name);
        card.addEventListener('click', () => {
            paletteGrid.querySelectorAll('.customize-palette-card').forEach((c) => c.classList.remove('active'));
            card.classList.add('active');
            setCustomizeSetting('palette', id);
        });

        paletteGrid.appendChild(card);
    }

    paletteSection.appendChild(paletteGrid);
    container.appendChild(paletteSection);

    // --- Accent Color Override ---
    const accentSection = _section(t('customizeAccent') || 'Accent Color');
    const accentRow = document.createElement('div');
    accentRow.className = 'customize-row';

    const accentPicker = document.createElement('input');
    accentPicker.type = 'color';
    accentPicker.className = 'customize-color-picker';
    accentPicker.value = state.accentColor || '#2d8a7a';

    const accentLabel = document.createElement('span');
    accentLabel.className = 'customize-value';
    accentLabel.textContent = state.accentColor || t('customizeAccentDefault') || 'Using palette default';

    const accentWarning = document.createElement('span');
    accentWarning.className = 'customize-contrast-warning';
    accentWarning.style.display = 'none';

    const accentClear = document.createElement('button');
    accentClear.className = 'customize-btn-small';
    accentClear.textContent = t('customizeAccentReset') || 'Reset';
    accentClear.addEventListener('click', () => {
        setCustomizeSetting('accentColor', null);
        accentLabel.textContent = t('customizeAccentDefault') || 'Using palette default';
        accentWarning.style.display = 'none';
    });

    accentPicker.addEventListener('input', () => {
        const hex = accentPicker.value;
        accentLabel.textContent = hex;
        _debounced(() => {
            setCustomizeSetting('accentColor', hex);
            _checkContrast(hex, accentWarning);
        });
    });

    accentRow.appendChild(accentPicker);
    accentRow.appendChild(accentLabel);
    accentRow.appendChild(accentClear);
    accentSection.appendChild(accentRow);
    accentSection.appendChild(accentWarning);
    container.appendChild(accentSection);

    // Check initial contrast
    if (state.accentColor) _checkContrast(state.accentColor, accentWarning);
}

function _checkContrast(hex, warningEl) {
    const surfaceBg = getComputedStyle(document.documentElement).getPropertyValue('--surface-1').trim() || '#f9fbfc';
    const ratio = contrastRatio(hex, surfaceBg);
    if (ratio < 3) {
        warningEl.textContent = `${t('customizeContrastWarn') || 'Low contrast'}: ${ratio.toFixed(1)}:1 (${t('customizeContrastMin') || 'min 3:1'})`;
        warningEl.style.display = '';
    } else {
        warningEl.style.display = 'none';
    }
}

// ----------------------------------------------------------------
// TAB 2: HOME ACTIONS
// ----------------------------------------------------------------

function _renderHomeActionsTab(container) {
    const state = getCustomizeState();
    const cards = _actionCardIds;
    if (cards.length === 0) {
        container.textContent = t('customizeNoCards') || 'No action cards available.';
        return;
    }

    // Build config from state or defaults
    let config = state.homeCards;
    if (!config) {
        config = cards.map((c, i) => ({ id: c.id, visible: true, order: i }));
    }

    // Ensure all known cards exist in config
    for (const c of cards) {
        if (!config.find((x) => x.id === c.id)) {
            config.push({ id: c.id, visible: true, order: config.length });
        }
    }

    // Sort by order
    config.sort((a, b) => a.order - b.order);

    const hint = document.createElement('p');
    hint.className = 'customize-hint';
    hint.textContent = t('customizeHomeHint') || 'Toggle visibility and drag to reorder action cards.';
    container.appendChild(hint);

    const list = document.createElement('div');
    list.className = 'customize-card-list';

    for (let i = 0; i < config.length; i++) {
        const item = config[i];
        const cardDef = cards.find((c) => c.id === item.id);
        if (!cardDef) continue;

        const isCustomize = item.id === 'customize';
        const row = document.createElement('div');
        row.className = 'customize-card-row';
        row.draggable = !isCustomize;
        row.dataset.index = String(i);
        row.dataset.cardId = item.id;

        // Drag handle
        const handle = document.createElement('span');
        handle.className = 'customize-drag-handle';
        handle.textContent = isCustomize ? '' : '\u2630';
        handle.setAttribute('aria-hidden', 'true');
        row.appendChild(handle);

        // Checkbox
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = item.visible;
        check.disabled = isCustomize;
        if (isCustomize) check.title = t('customizeCardAlwaysVisible') || 'This card is always visible';
        check.addEventListener('change', () => {
            item.visible = check.checked;
            _saveCardConfig(config);
        });
        row.appendChild(check);

        // Label
        const label = document.createElement('span');
        label.className = 'customize-card-label';
        label.textContent = t(cardDef.i18nKey) || cardDef.id;
        row.appendChild(label);

        // Arrow buttons for keyboard reorder
        if (!isCustomize) {
            const upBtn = document.createElement('button');
            upBtn.className = 'customize-btn-icon';
            upBtn.textContent = '\u25B2';
            upBtn.title = t('customizeMoveUp') || 'Move up';
            upBtn.disabled = i === 0;
            upBtn.addEventListener('click', () => _moveCard(config, i, -1, list, container));

            const downBtn = document.createElement('button');
            downBtn.className = 'customize-btn-icon';
            downBtn.textContent = '\u25BC';
            downBtn.title = t('customizeMoveDown') || 'Move down';
            downBtn.disabled = i === config.length - 1;
            downBtn.addEventListener('click', () => _moveCard(config, i, 1, list, container));

            row.appendChild(upBtn);
            row.appendChild(downBtn);
        }

        // Drag events
        if (!isCustomize) {
            row.addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(i));
                row.classList.add('dragging');
            });
            row.addEventListener('dragend', () => row.classList.remove('dragging'));
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                row.classList.add('drag-over');
            });
            row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.classList.remove('drag-over');
                const fromIndex = Number(e.dataTransfer.getData('text/plain'));
                const toIndex = i;
                if (fromIndex !== toIndex) {
                    const [moved] = config.splice(fromIndex, 1);
                    config.splice(toIndex, 0, moved);
                    _reindex(config);
                    _saveCardConfig(config);
                    _renderHomeActionsTab(container);
                }
            });
        }

        list.appendChild(row);
    }

    container.appendChild(list);
}

function _moveCard(config, index, direction, list, container) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= config.length) return;
    const temp = config[index];
    config[index] = config[newIndex];
    config[newIndex] = temp;
    _reindex(config);
    _saveCardConfig(config);
    // Clear and re-render
    container.innerHTML = '';
    _renderHomeActionsTab(container);
}

function _reindex(config) {
    for (let i = 0; i < config.length; i++) config[i].order = i;
}

function _saveCardConfig(config) {
    // Guard: at least 1 card besides 'customize' must be visible
    const visibleNonCustomize = config.filter((c) => c.id !== 'customize' && c.visible);
    if (visibleNonCustomize.length === 0 && config.length > 1) {
        // Re-enable first non-customize card
        const first = config.find((c) => c.id !== 'customize');
        if (first) first.visible = true;
    }

    // Ensure customize is always visible
    const customizeCard = config.find((c) => c.id === 'customize');
    if (customizeCard) customizeCard.visible = true;

    setHomeCards(config.map((c) => ({ id: c.id, visible: c.visible, order: c.order })));
}

// ----------------------------------------------------------------
// TAB 3: LAYOUT
// ----------------------------------------------------------------

function _renderLayoutTab(container) {
    const state = getCustomizeState();
    const layout = state.layout;

    const hint = document.createElement('p');
    hint.className = 'customize-hint';
    hint.textContent = t('customizeLayoutHint') || 'Set default visibility of UI elements when the app starts.';
    container.appendChild(hint);

    const toggles = [
        { key: 'leftPanel', label: t('customizeLeftPanel') || 'Left Panel' },
        { key: 'rightPanel', label: t('customizeRightPanel') || 'Right Panel' },
        { key: 'bottomHud', label: t('customizeBottomHud') || 'Bottom HUD' },
        { key: 'statusBar', label: t('customizeStatusBar') || 'Status Bar' },
        { key: 'menuBar', label: t('customizeMenuBar') || 'Menu Bar' },
    ];

    for (const toggle of toggles) {
        const row = document.createElement('div');
        row.className = 'customize-toggle-row';

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = layout[toggle.key] !== false;
        check.id = `customize-layout-${toggle.key}`;
        check.addEventListener('change', () => {
            const newLayout = { ...state.layout, [toggle.key]: check.checked };
            setCustomizeSetting('layout', newLayout);
        });

        const label = document.createElement('label');
        label.htmlFor = check.id;
        label.textContent = toggle.label;

        row.appendChild(check);
        row.appendChild(label);
        container.appendChild(row);
    }
}

// ----------------------------------------------------------------
// TAB 4: PRESETS & DATA
// ----------------------------------------------------------------

function _renderPresetsTab(container) {
    const state = getCustomizeState();

    // --- Save Preset ---
    const saveSection = _section(t('customizeSavePreset') || 'Save Current as Preset');
    const saveRow = document.createElement('div');
    saveRow.className = 'customize-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'customize-input';
    nameInput.placeholder = t('customizePresetName') || 'Preset name...';
    nameInput.maxLength = 50;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'customize-btn';
    saveBtn.textContent = t('customizeSave') || 'Save';
    saveBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) return;
        if (saveUserPreset(name)) {
            nameInput.value = '';
            _renderPresetsTab(container);
        }
    });

    saveRow.appendChild(nameInput);
    saveRow.appendChild(saveBtn);
    saveSection.appendChild(saveRow);
    container.appendChild(saveSection);

    // --- User Presets List ---
    if (state.userPresets.length > 0) {
        const listSection = _section(t('customizeUserPresets') || 'Your Presets');
        const list = document.createElement('div');
        list.className = 'customize-preset-list';

        for (let i = 0; i < state.userPresets.length; i++) {
            const preset = state.userPresets[i];
            const row = document.createElement('div');
            row.className = 'customize-preset-row';

            const name = document.createElement('span');
            name.className = 'customize-preset-name';
            name.textContent = preset.name;

            const loadBtn = document.createElement('button');
            loadBtn.className = 'customize-btn-small';
            loadBtn.textContent = t('customizeLoad') || 'Load';
            loadBtn.addEventListener('click', () => {
                loadUserPreset(i);
                _renderTab(); // re-render all tabs with new state
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'customize-btn-small customize-btn-danger';
            delBtn.textContent = '&#10005;';
            delBtn.title = t('customizeDelete') || 'Delete';
            delBtn.addEventListener('click', () => {
                deleteUserPreset(i);
                _renderPresetsTab(container);
            });

            row.appendChild(name);
            row.appendChild(loadBtn);
            row.appendChild(delBtn);
            list.appendChild(row);
        }

        listSection.appendChild(list);
        container.appendChild(listSection);
    }

    // --- Actions ---
    const actionsSection = _section(t('customizeActions') || 'Actions');

    // Reset
    const resetBtn = document.createElement('button');
    resetBtn.className = 'customize-btn customize-btn-danger';
    resetBtn.textContent = t('customizeResetDefaults') || 'Reset to Defaults';
    resetBtn.addEventListener('click', async () => {
        try {
            const { asyncConfirm } = await import('./asyncDialogs.js');
            const ok = await asyncConfirm(t('customizeResetConfirm') || 'Reset all customization to defaults?');
            if (!ok) return;
        } catch {
            if (!confirm(t('customizeResetConfirm') || 'Reset all customization to defaults?')) return;
        }
        resetCustomize();
        _renderTab();
    });
    actionsSection.appendChild(resetBtn);

    // Export
    const exportBtn = document.createElement('button');
    exportBtn.className = 'customize-btn';
    exportBtn.textContent = t('customizeExport') || 'Export Settings';
    exportBtn.addEventListener('click', () => {
        const json = exportCustomize();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ecbyts-customize.json';
        a.click();
        URL.revokeObjectURL(url);
    });
    actionsSection.appendChild(exportBtn);

    // Import
    const importBtn = document.createElement('button');
    importBtn.className = 'customize-btn';
    importBtn.textContent = t('customizeImport') || 'Import Settings';
    importBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const result = importCustomize(reader.result);
                if (result.ok) {
                    _renderTab();
                    _showToast(t('customizeImportSuccess') || 'Settings imported successfully');
                } else {
                    _showToast(`${t('customizeImportError') || 'Import failed'}: ${result.error}`, 'error');
                }
            };
            reader.readAsText(file);
        });
        input.click();
    });
    actionsSection.appendChild(importBtn);

    container.appendChild(actionsSection);
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function _section(title) {
    const section = document.createElement('div');
    section.className = 'customize-section';

    const h = document.createElement('h3');
    h.className = 'customize-section-title';
    h.textContent = title;
    section.appendChild(h);

    return section;
}

function _debounced(fn) {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(fn, 60);
}

function _showToast(msg, type = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(msg, type);
    }
}
