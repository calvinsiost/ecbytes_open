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
   LABEL HANDLERS — Window.* functions for HTML onclick
   ================================================================

   Handlers para controles de labels 3D no modelo.
   Toggle global, toggle por categoria, modal de configuracao.

   ================================================================ */

import {
    getLabelConfig,
    isLabelsEnabled,
    setLabelsEnabled,
    setLabelCategoryEnabled,
    setLabelCategorySetting,
    setPerElementLabel,
    getPerElementLabel,
    resetLabelSettings,
    syncLabels,
} from '../labels/manager.js';
import {
    setMaxVisible,
    getMaxVisible,
    setLeaderMinDistance,
    getLeaderMinDistance,
    setNudgeEnabled,
    getNudgeEnabled,
    setFamilyPriority,
    getFamilyPriority,
    setShowAll,
    getShowAll,
    setFamilyDisabled,
    isFamilyDisabled,
    getDisabledFamilies,
} from '../labels/renderer.js';
import { getAllElements } from '../../core/elements/manager.js';
import { getFamilyName } from '../../core/elements/families.js';
import { escapeHtml } from '../helpers/html.js';
import { openModal, closeModal } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { getIcon } from '../ui/icons.js';
import { safeSetItem } from '../storage/storageMonitor.js';

// ----------------------------------------------------------------
// HANDLERS
// ----------------------------------------------------------------

/**
 * Toggle global de labels 3D.
 */
function handleToggleLabels() {
    setLabelsEnabled();
    const enabled = isLabelsEnabled();
    _updateToggleButton(enabled);
    showToast(enabled ? t('labels3dEnabled') : t('labels3dDisabled'), 'info');
}

/**
 * Abre modal de configuracao de labels.
 */
function handleOpenLabelSettings() {
    _renderLabelSettingsModal();
    openModal('labels-modal');
}

/**
 * Fecha modal de labels.
 */
function handleCloseLabelSettings() {
    closeModal('labels-modal');
}

/**
 * Toggle de uma categoria de labels.
 * @param {string} category - 'elementNames'|'observations'|'geology'|'modelTitle'
 */
function handleLabelCategoryToggle(category) {
    setLabelCategoryEnabled(category);
    _renderLabelSettingsModal();
}

/**
 * Altera um setting de uma categoria.
 * @param {string} category
 * @param {string} key
 * @param {*} value
 */
function handleLabelSettingChange(category, key, value) {
    setLabelCategorySetting(category, key, value);
}

/**
 * Toggle de label por elemento.
 * @param {string} elementId
 * @param {string} labelType - 'nameLabel'|'obsLabel'
 * @param {boolean} enabled
 */
function handleToggleElementLabel(elementId, labelType, enabled) {
    setPerElementLabel(elementId, { [labelType]: enabled });
}

/**
 * Reseta labels para configuracao padrao.
 */
function handleResetLabelSettings() {
    resetLabelSettings();
    _renderLabelSettingsModal();
    showToast(t('labelResetDone'), 'info');
}

// ----------------------------------------------------------------
// MODAL RENDERING
// ----------------------------------------------------------------

const CATEGORIES = [
    { id: 'elementNames', icon: 'tag', i18nKey: 'elementNameLabels' },
    { id: 'observations', icon: 'activity', i18nKey: 'observationLabels' },
    { id: 'geology', icon: 'layers', i18nKey: 'geologyLabels' },
    { id: 'modelTitle', icon: 'type', i18nKey: 'modelTitleLabel' },
];

function _renderLabelSettingsModal() {
    const body = document.getElementById('labels-modal-body');
    if (!body) return;

    const config = getLabelConfig();
    const cats = config.categories;

    let html = '';

    // Toggle global
    html += `
    <div class="label-settings-global">
        <label class="label-toggle-row">
            <input type="checkbox" ${config.enabled ? 'checked' : ''}
                onchange="handleToggleLabels()">
            <span class="label-toggle-text">${t('labels3dEnabled')}</span>
        </label>
    </div>`;

    // Categorias
    for (const cat of CATEGORIES) {
        const c = cats[cat.id];
        const expanded = c.enabled;

        html += `
        <div class="label-category-card ${expanded ? 'expanded' : ''}">
            <div class="label-category-header" onclick="handleLabelCategoryToggle('${cat.id}')">
                <span class="label-category-icon">${getIcon(cat.icon)}</span>
                <span class="label-category-name">${t(cat.i18nKey)}</span>
                <label class="label-category-toggle" onclick="event.stopPropagation()">
                    <input type="checkbox" ${c.enabled ? 'checked' : ''}
                        onchange="handleLabelCategoryToggle('${cat.id}')">
                </label>
            </div>`;

        if (c.enabled) {
            html += `<div class="label-category-body">`;
            html += _renderCategorySettings(cat.id, c);
            html += `</div>`;
        }

        html += `</div>`;
    }

    // Reset button
    html += `
    <div class="label-settings-footer">
        <button class="btn btn-secondary btn-sm" onclick="handleResetLabelSettings()">
            ${getIcon('refresh-cw')} ${t('labelResetDefaults')}
        </button>
    </div>`;

    body.innerHTML = html;
}

function _renderCategorySettings(catId, config) {
    let html = '';

    // Font size
    html += `
    <div class="label-setting-row">
        <label>${t('labelFontSize')}</label>
        <input type="range" min="8" max="24" value="${config.fontSize}"
            oninput="handleLabelSettingChange('${catId}', 'fontSize', Number(this.value))">
        <span class="label-setting-value">${config.fontSize}px</span>
    </div>`;

    // Color
    html += `
    <div class="label-setting-row">
        <label>${t('labelColor')}</label>
        <div class="label-color-options">
            ${
                catId === 'elementNames'
                    ? `
                <label>
                    <input type="radio" name="color-${catId}" value="auto"
                        ${config.color === 'auto' ? 'checked' : ''}
                        onchange="handleLabelSettingChange('${catId}', 'color', 'auto')">
                    ${t('labelAutoColor')}
                </label>
            `
                    : ''
            }
            <input type="color" value="${config.color === 'auto' ? '#ffffff' : config.color}"
                onchange="handleLabelSettingChange('${catId}', 'color', this.value)">
        </div>
    </div>`;

    // Background
    html += `
    <div class="label-setting-row">
        <label>${t('labelBackground')}</label>
        <select onchange="handleLabelSettingChange('${catId}', 'background', this.value)">
            <option value="rgba(0,0,0,0.6)" ${config.background === 'rgba(0,0,0,0.6)' ? 'selected' : ''}>Dark</option>
            <option value="rgba(0,0,0,0.3)" ${config.background === 'rgba(0,0,0,0.3)' ? 'selected' : ''}>Light Dark</option>
            <option value="rgba(255,255,255,0.7)" ${config.background === 'rgba(255,255,255,0.7)' ? 'selected' : ''}>Light</option>
            <option value="transparent" ${config.background === 'transparent' ? 'selected' : ''}>None</option>
        </select>
    </div>`;

    // Category-specific settings
    if (catId === 'observations') {
        html += `
        <div class="label-setting-row">
            <label>
                <input type="checkbox" ${config.showUnit ? 'checked' : ''}
                    onchange="handleLabelSettingChange('observations', 'showUnit', this.checked)">
                ${t('labelShowUnit')}
            </label>
        </div>
        <div class="label-setting-row">
            <label>
                <input type="checkbox" ${config.showDate ? 'checked' : ''}
                    onchange="handleLabelSettingChange('observations', 'showDate', this.checked)">
                ${t('labelShowDate')}
            </label>
        </div>`;
    }

    if (catId === 'modelTitle') {
        html += `
        <div class="label-setting-row">
            <label>${t('modelTitleText')}</label>
            <input type="text" value="${config.text || ''}"
                placeholder="${t('modelTitlePlaceholder')}"
                onchange="handleLabelSettingChange('modelTitle', 'text', this.value)">
        </div>`;
    }

    return html;
}

// ----------------------------------------------------------------
// QUICK POPUP — Badge "Aa" no viewport
// ----------------------------------------------------------------

let _popupCloseHandler = null;
let _overlayPositioningInit = false;
let _overlayPositionRAF = 0;
let _overlayResizeObserver = null;

function _scheduleOverlayPosition() {
    if (_overlayPositionRAF) cancelAnimationFrame(_overlayPositionRAF);
    _overlayPositionRAF = requestAnimationFrame(() => {
        _overlayPositionRAF = 0;
        _positionOverlayControls();
    });
}

/**
 * Posiciona badges/popups do viewport de forma programatica, ancorando no
 * #view-controls para evitar sobreposicao com HUD/paineis responsivos.
 */
function _positionOverlayControls() {
    const canvas = document.getElementById('canvas-container');
    const mainArea = document.getElementById('main-area');
    const viewControls = document.getElementById('view-controls');
    const labelsBadge = document.getElementById('labels-toggle-badge');
    const popup = document.getElementById('labels-quick-popup');
    const viewModeBadge = document.getElementById('view-mode-badge');

    if (!viewControls || !mainArea) return;

    const vcRect = viewControls.getBoundingClientRect();
    const mainRect = mainArea.getBoundingClientRect();
    const isSpatialAnchorVisible = vcRect.width > 0 && vcRect.height > 0;
    let viewBadgePlaced = false;

    const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    const VIEW_BADGE_GAP_FROM_AA = 12;
    const VIEW_BADGE_VERTICAL_OFFSET = 0;
    const POPUP_SIDE_GAP = 10;

    // Badge "Aa" e popup: apenas no canvas/spatial.
    if (canvas && labelsBadge && isSpatialAnchorVisible) {
        const canvasRect = canvas.getBoundingClientRect();
        if (canvasRect.width > 0 && canvasRect.height > 0) {
            const aaGapY = 8;
            const canvasOffsetX = Math.round(canvasRect.left - mainRect.left);
            const canvasOffsetY = Math.round(canvasRect.top - mainRect.top);
            const labelRect = labelsBadge.getBoundingClientRect();
            const labelW = Math.max(28, Math.round(labelRect.width || labelsBadge.offsetWidth || 34));
            const labelH = Math.max(20, Math.round(labelRect.height || labelsBadge.offsetHeight || 28));

            let aaLeftMain = Math.round(vcRect.left - mainRect.left);
            let aaTopMain = Math.round(vcRect.top - mainRect.top - labelH - aaGapY);

            const minAaLeftMain = canvasOffsetX + 8;
            const maxAaLeftMain = canvasOffsetX + Math.round(canvasRect.width) - labelW - 8;
            const minAaTopMain = canvasOffsetY + 8;
            const maxAaTopMain = canvasOffsetY + Math.round(canvasRect.height) - labelH - 8;

            aaLeftMain = Math.min(maxAaLeftMain, Math.max(minAaLeftMain, aaLeftMain));
            aaTopMain = Math.min(maxAaTopMain, Math.max(minAaTopMain, aaTopMain));

            const aaLeftCanvas = aaLeftMain - canvasOffsetX;
            const aaTopCanvas = aaTopMain - canvasOffsetY;

            labelsBadge.style.left = `${Math.round(Math.max(8, aaLeftCanvas))}px`;
            labelsBadge.style.top = `${Math.round(Math.max(8, aaTopCanvas))}px`;
            labelsBadge.style.bottom = 'auto';
            labelsBadge.style.right = 'auto';

            // Botao unico de view: horizontal preferencial ao lado do badge Aa.
            if (viewModeBadge) {
                const vmRect = viewModeBadge.getBoundingClientRect();
                const vmW = Math.max(34, Math.round(vmRect.width || viewModeBadge.offsetWidth || 46));
                const vmH = Math.max(20, Math.round(vmRect.height || viewModeBadge.offsetHeight || 28));
                const gap = VIEW_BADGE_GAP_FROM_AA;

                // Anti-overlap hard guard: never allow view badge to intercept Aa.
                const aaBox = {
                    left: aaLeftMain,
                    top: aaTopMain,
                    right: aaLeftMain + labelW,
                    bottom: aaTopMain + labelH,
                };

                // Keep view badge inside the visible canvas region (in main-area coordinates).
                const minVmLeftMain = canvasOffsetX + 8;
                const minVmTopMain = canvasOffsetY + 8;
                const maxVmLeftMain = Math.max(minVmLeftMain, canvasOffsetX + Math.round(canvasRect.width) - vmW - 8);
                const maxVmTopMain = Math.max(minVmTopMain, canvasOffsetY + Math.round(canvasRect.height) - vmH - 8);

                const clampVmPosition = (left, top) => ({
                    left: Math.min(maxVmLeftMain, Math.max(minVmLeftMain, Math.round(left))),
                    top: Math.min(maxVmTopMain, Math.max(minVmTopMain, Math.round(top))),
                });

                const toVmBox = (left, top) => ({
                    left,
                    top,
                    right: left + vmW,
                    bottom: top + vmH,
                });

                // Explicit fallback order:
                // 1) right of Aa (primary)
                // 2) left of Aa
                // 3) below Aa (last-resort layout fallback)
                const vmCandidates = [
                    { left: aaLeftMain + labelW + gap, top: aaTopMain + VIEW_BADGE_VERTICAL_OFFSET },
                    { left: aaLeftMain - vmW - gap, top: aaTopMain + VIEW_BADGE_VERTICAL_OFFSET },
                    { left: aaLeftMain, top: aaTopMain + labelH + gap },
                ];

                let chosenVmPos = null;
                for (const candidate of vmCandidates) {
                    const pos = clampVmPosition(candidate.left, candidate.top);
                    const box = toVmBox(pos.left, pos.top);
                    if (!intersects(box, aaBox)) {
                        chosenVmPos = pos;
                        break;
                    }
                }

                if (!chosenVmPos) {
                    chosenVmPos = clampVmPosition(aaLeftMain, aaTopMain + labelH + gap);
                }

                let vmLeftMain = chosenVmPos.left;
                let vmTopMain = chosenVmPos.top;
                let vmBox = toVmBox(vmLeftMain, vmTopMain);

                // Hard guard: if clamping still caused overlap, force-separate badges.
                if (intersects(vmBox, aaBox)) {
                    const tryRight = clampVmPosition(aaBox.right + gap, vmTopMain);
                    let tryBox = toVmBox(tryRight.left, tryRight.top);
                    if (!intersects(tryBox, aaBox)) {
                        vmLeftMain = tryRight.left;
                        vmTopMain = tryRight.top;
                        vmBox = tryBox;
                    } else {
                        const tryLeft = clampVmPosition(aaBox.left - vmW - gap, vmTopMain);
                        tryBox = toVmBox(tryLeft.left, tryLeft.top);
                        if (!intersects(tryBox, aaBox)) {
                            vmLeftMain = tryLeft.left;
                            vmTopMain = tryLeft.top;
                            vmBox = tryBox;
                        } else {
                            const tryBelow = clampVmPosition(vmLeftMain, aaBox.bottom + gap);
                            tryBox = toVmBox(tryBelow.left, tryBelow.top);
                            vmLeftMain = tryBelow.left;
                            vmTopMain = tryBelow.top;
                            vmBox = tryBox;
                        }
                    }
                }

                if (intersects(vmBox, aaBox)) {
                    // Extreme narrow scenarios: keep a deterministic non-blocking placement.
                    const forced = clampVmPosition(aaBox.right + gap, aaBox.bottom + gap);
                    vmLeftMain = forced.left;
                    vmTopMain = forced.top;
                }

                viewModeBadge.style.left = `${Math.round(vmLeftMain)}px`;
                viewModeBadge.style.top = `${Math.round(vmTopMain)}px`;
                viewModeBadge.style.bottom = 'auto';
                viewModeBadge.style.right = 'auto';
                viewBadgePlaced = true;
            }

            // Popup ancorado ao Aa com clamp dentro do canvas.
            if (popup && !popup.classList.contains('hidden')) {
                const popupRect = popup.getBoundingClientRect();
                const popupGap = 8;
                // Prefer side anchoring to avoid covering badge hitbox.
                let popupLeft = aaLeftCanvas + labelW + POPUP_SIDE_GAP;
                if (popupLeft + popupRect.width > canvasRect.width - 8) {
                    popupLeft = aaLeftCanvas - popupRect.width - POPUP_SIDE_GAP;
                }
                let popupTop = aaTopCanvas - Math.round((popupRect.height - labelH) / 2);
                const maxLeft = Math.max(8, canvasRect.width - popupRect.width - 8);
                const maxTop = Math.max(8, canvasRect.height - popupRect.height - 8);
                popupLeft = Math.min(maxLeft, Math.max(8, popupLeft));
                popupTop = Math.min(maxTop, Math.max(8, popupTop));

                // Hard guard: popup nunca deve interceptar o clique do badge "Aa".
                const popupBottom = popupTop + popupRect.height;
                const aaBottom = aaTopCanvas + labelH;
                const overlapsAa = popupTop < aaBottom && popupBottom > aaTopCanvas;
                if (overlapsAa) {
                    popupTop = Math.min(maxTop, aaBottom + popupGap);
                }

                popup.style.left = `${Math.round(popupLeft)}px`;
                popup.style.top = `${Math.round(popupTop)}px`;
                popup.style.bottom = 'auto';
                popup.style.right = 'auto';
            }
        }
    }

    // Actions (ou sem ancora espacial): deixa o badge de view no fallback CSS.
    if (viewModeBadge && !viewBadgePlaced) {
        viewModeBadge.style.removeProperty('top');
        viewModeBadge.style.removeProperty('left');
        viewModeBadge.style.removeProperty('right');
        viewModeBadge.style.removeProperty('bottom');
    }
}

function _initOverlayPositioning() {
    if (_overlayPositioningInit) return;
    _overlayPositioningInit = true;

    _scheduleOverlayPosition();
    window.addEventListener('resize', _scheduleOverlayPosition, { passive: true });
    window.addEventListener('viewChanged', _scheduleOverlayPosition);
    window.addEventListener('viewModeChanged', _scheduleOverlayPosition);

    if (typeof ResizeObserver === 'undefined') return;
    _overlayResizeObserver = new ResizeObserver(_scheduleOverlayPosition);
    ['main-area', 'canvas-container', 'view-controls', 'constellation-hud']
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .forEach((el) => _overlayResizeObserver.observe(el));
}

/**
 * Abre/fecha o popup rapido de labels ao clicar no badge "Aa".
 */
function handleOpenLabelPopup(e) {
    e?.stopPropagation();
    const popup = document.getElementById('labels-quick-popup');
    if (!popup) return;

    const isOpen = !popup.classList.contains('hidden');
    if (isOpen) {
        _closeLabelPopup();
        return;
    }

    // Sincroniza estado dos botoes antes de abrir
    _syncPopupState(popup);
    popup.classList.remove('hidden');
    _scheduleOverlayPosition();

    // Click-outside fecha
    _popupCloseHandler = (ev) => {
        if (!popup.contains(ev.target) && ev.target.id !== 'labels-toggle-badge') {
            _closeLabelPopup();
        }
    };
    setTimeout(() => document.addEventListener('pointerdown', _popupCloseHandler), 0);
}

function _closeLabelPopup() {
    const popup = document.getElementById('labels-quick-popup');
    if (popup) popup.classList.add('hidden');
    if (_popupCloseHandler) {
        document.removeEventListener('pointerdown', _popupCloseHandler);
        _popupCloseHandler = null;
    }
}

/**
 * Altera fontSize de todas as categorias de labels ativas.
 */
function handleLabelQuickSize(size, btn) {
    const clamped = Math.max(8, Math.min(24, Number(size)));
    if (!Number.isFinite(clamped)) return;
    const categories = ['elementNames', 'observations', 'geology', 'modelTitle'];
    for (const cat of categories) {
        setLabelCategorySetting(cat, 'fontSize', clamped);
    }
    if (btn) {
        const group = btn.parentElement;
        if (group) {
            group.querySelectorAll('.lqp-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
        }
    }
}

/**
 * Altera densidade (max labels visiveis).
 */
function handleLabelQuickDensity(n, btn) {
    setMaxVisible(n);
    safeSetItem('ecbyts-label-density', String(n));
    const group = btn.parentElement;
    if (group) {
        group.querySelectorAll('.lqp-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
    }
}

/**
 * Ajusta distancia minima para desenhar links label -> elemento.
 */
function handleLabelLinkDistance(n, btn) {
    setLeaderMinDistance(n);
    safeSetItem('ecbyts-label-leader-min-dist', String(n));
    const group = btn?.parentElement;
    if (group) {
        group.querySelectorAll('.lqp-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
    }
}

/**
 * Liga/desliga labels via popup.
 */
function handleLabelQuickToggle(btn) {
    setLabelsEnabled();
    const enabled = isLabelsEnabled();
    _updateToggleButton(enabled);
    _updateBadgeState(enabled);
    btn.textContent = enabled ? t('labelOff') || 'Desligar' : t('labelOn') || 'Ligar';
}

/**
 * Toggle redistribuicao (nudge) de labels via popup.
 */
function handleLabelQuickNudge(btn) {
    const newState = !getNudgeEnabled();
    setNudgeEnabled(newState);
    if (newState) {
        safeSetItem('ecbyts-label-nudge', '1');
    } else {
        try {
            localStorage.removeItem('ecbyts-label-nudge');
        } catch (_) {
            /* */
        }
    }
    if (btn) btn.classList.toggle('active', newState);
}

/**
 * Toggle "Mostrar Todos" — forca todas labels visiveis (pula declutter).
 */
function handleLabelShowAll(btn) {
    const newState = !getShowAll();
    setShowAll(newState);
    if (newState) {
        safeSetItem('ecbyts-label-show-all', '1');
    } else {
        try {
            localStorage.removeItem('ecbyts-label-show-all');
        } catch (_) {
            /* */
        }
    }
    if (btn) btn.classList.toggle('active', newState);
}

/**
 * Toggle visibilidade de labels de uma familia especifica.
 */
function handleLabelFamilyToggle(familyId) {
    const isDisabled = isFamilyDisabled(familyId);
    setFamilyDisabled(familyId, !isDisabled);
    // Persistir
    const disabled = getDisabledFamilies();
    if (disabled.length > 0) {
        safeSetItem('ecbyts-label-disabled-families', JSON.stringify(disabled));
    } else {
        try {
            localStorage.removeItem('ecbyts-label-disabled-families');
        } catch (_) {
            /* */
        }
    }
    // Re-renderiza lista no popup
    const popup = document.getElementById('labels-quick-popup');
    if (popup) {
        const list = _getModelFamilyOrder();
        _renderPriorityList(popup, list);
    }
}

/**
 * Move uma familia na lista de prioridade.
 * @param {string} familyId
 * @param {number} direction - -1 (sobe) ou +1 (desce)
 */
function handleLabelFamilyPriority(familyId, direction) {
    if (direction !== -1 && direction !== 1) return;
    const list = _getModelFamilyOrder();
    const idx = list.indexOf(familyId);
    if (idx === -1) return;

    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= list.length) return;

    // Swap
    [list[idx], list[newIdx]] = [list[newIdx], list[idx]];

    setFamilyPriority(list);
    safeSetItem('ecbyts-label-family-priority', JSON.stringify(list));

    // Re-renderiza a lista no popup
    const popup = document.getElementById('labels-quick-popup');
    if (popup) _renderPriorityList(popup, list);
}

/** Familias excluidas da lista de prioridade (sem labels) */
const _SKIP_PRIORITY = new Set(['intangible', 'generic', 'boundary', 'blueprint', 'area']);

/**
 * Retorna a lista ordenada de familias do modelo atual,
 * mesclada com a prioridade salva.
 */
function _getModelFamilyOrder() {
    const elements = getAllElements();
    const modelFamilies = new Set();
    for (const el of elements) {
        if (el.family && !_SKIP_PRIORITY.has(el.family)) {
            modelFamilies.add(el.family);
        }
    }

    // Mescla com prioridade salva: manter ordem salva, adicionar novas ao final
    const saved = getFamilyPriority();
    const ordered = [];
    for (const f of saved) {
        if (modelFamilies.has(f)) {
            ordered.push(f);
            modelFamilies.delete(f);
        }
    }
    // Familias novas (nao salvas) ao final
    for (const f of modelFamilies) {
        ordered.push(f);
    }
    return ordered;
}

/**
 * Renderiza a lista de prioridade no popup.
 */
function _renderPriorityList(popup, list) {
    const container = popup.querySelector('#lqp-priority-list');
    if (!container) return;

    const disabled = isFamilyDisabled;
    container.innerHTML = list
        .map((familyId, i) => {
            const safeId = escapeHtml(familyId);
            const safeName = escapeHtml(getFamilyName(familyId) || familyId);
            const isOff = disabled(familyId);
            return `<div class="lqp-priority-row${isOff ? ' lqp-family-off' : ''}">
            <button class="lqp-priority-toggle${isOff ? '' : ' active'}" data-family="${safeId}" aria-label="Toggle ${safeName}">&#9679;</button>
            <div class="lqp-priority-arrows">
                <button class="lqp-priority-arrow" data-family="${safeId}" data-dir="-1" aria-label="Move up">&#9650;</button>
                <button class="lqp-priority-arrow" data-family="${safeId}" data-dir="1" aria-label="Move down">&#9660;</button>
            </div>
            <span class="lqp-priority-rank">${i + 1}.</span>
            <span class="lqp-priority-name">${safeName}</span>
        </div>`;
        })
        .join('');

    // Event delegation
    container.querySelectorAll('.lqp-priority-arrow').forEach((btn) => {
        btn.onclick = () => handleLabelFamilyPriority(btn.dataset.family, parseInt(btn.dataset.dir));
    });
    container.querySelectorAll('.lqp-priority-toggle').forEach((btn) => {
        btn.onclick = () => handleLabelFamilyToggle(btn.dataset.family);
    });
}

function _updateBadgeState(enabled) {
    const badge = document.getElementById('labels-toggle-badge');
    if (badge) badge.classList.toggle('inactive', !enabled);
}

function _syncPopupState(popup) {
    const config = getLabelConfig();
    const enabled = config.enabled;
    const fontSize = config.categories?.elementNames?.fontSize || 11;
    const density = getMaxVisible();
    const linkDist = getLeaderMinDistance();

    // Sincroniza botoes de tamanho (via data-size attribute)
    popup.querySelectorAll('[data-size]').forEach((b) => {
        b.classList.toggle('active', parseInt(b.dataset.size) === fontSize);
    });

    // Sincroniza botoes de densidade (via data-density attribute)
    const densityMap = [10, 25, 40];
    const closestDensity = densityMap.reduce((prev, curr) =>
        Math.abs(curr - density) < Math.abs(prev - density) ? curr : prev,
    );
    popup.querySelectorAll('[data-density]').forEach((b) => {
        b.classList.toggle('active', parseInt(b.dataset.density) === closestDensity);
    });

    // Sincroniza botoes de distancia minima dos links
    const linkDistMap = [8, 12, 18];
    const closestLinkDist = linkDistMap.reduce((prev, curr) =>
        Math.abs(curr - linkDist) < Math.abs(prev - linkDist) ? curr : prev,
    );
    popup.querySelectorAll('[data-link-dist]').forEach((b) => {
        b.classList.toggle('active', parseInt(b.dataset.linkDist) === closestLinkDist);
    });

    // Renderiza lista de prioridade de familias
    const familyOrder = _getModelFamilyOrder();
    _renderPriorityList(popup, familyOrder);

    // Sincroniza botao show-all
    const showAllBtn = popup.querySelector('.lqp-show-all');
    if (showAllBtn) {
        showAllBtn.classList.toggle('active', getShowAll());
    }

    // Sincroniza botao nudge
    const nudgeBtn = popup.querySelector('.lqp-nudge');
    if (nudgeBtn) {
        nudgeBtn.classList.toggle('active', getNudgeEnabled());
    }

    // Sincroniza botao toggle
    const toggleBtn = popup.querySelector('.lqp-toggle');
    if (toggleBtn) {
        toggleBtn.textContent = enabled ? t('labelOff') || 'Desligar' : t('labelOn') || 'Ligar';
    }

    _updateBadgeState(enabled);
}

/**
 * Restaura densidade, nudge e prioridade salvos no localStorage.
 */
function restoreLabelDensity() {
    _initOverlayPositioning();

    const saved = localStorage.getItem('ecbyts-label-density');
    if (saved) {
        const n = parseInt(saved, 10);
        if (n >= 5 && n <= 100) setMaxVisible(n);
    }
    // Restaura distancia minima das leader lines
    const savedLinkDist = localStorage.getItem('ecbyts-label-leader-min-dist');
    if (savedLinkDist) {
        const n = parseInt(savedLinkDist, 10);
        if (n >= 4 && n <= 40) setLeaderMinDistance(n);
    }
    // Restaura nudge
    if (localStorage.getItem('ecbyts-label-nudge') === '1') {
        setNudgeEnabled(true);
    }
    // Restaura show-all
    if (localStorage.getItem('ecbyts-label-show-all') === '1') {
        setShowAll(true);
    }
    // Restaura prioridade de familias
    const savedPriority = localStorage.getItem('ecbyts-label-family-priority');
    if (savedPriority) {
        try {
            const parsed = JSON.parse(savedPriority);
            if (Array.isArray(parsed)) {
                setFamilyPriority(parsed.filter((f) => typeof f === 'string' && f.length < 64));
            }
        } catch (_) {
            /* invalid JSON */
        }
    }
    // Restaura familias desativadas
    const savedDisabled = localStorage.getItem('ecbyts-label-disabled-families');
    if (savedDisabled) {
        try {
            const parsed = JSON.parse(savedDisabled);
            if (Array.isArray(parsed)) {
                for (const f of parsed) {
                    if (typeof f === 'string' && f.length < 64) setFamilyDisabled(f, true);
                }
            }
        } catch (_) {
            /* invalid JSON */
        }
    }
    // Sincroniza badge
    _updateBadgeState(isLabelsEnabled());
    _scheduleOverlayPosition();
}

// ----------------------------------------------------------------
// UI HELPERS
// ----------------------------------------------------------------

function _updateToggleButton(enabled) {
    const btn = document.getElementById('toggle-labels-btn');
    if (btn) {
        btn.classList.toggle('active', enabled);
    }
}

// ----------------------------------------------------------------
// EXPORT
// ----------------------------------------------------------------

export { restoreLabelDensity };

export const labelHandlers = {
    handleToggleLabels,
    handleOpenLabelSettings,
    handleCloseLabelSettings,
    handleLabelCategoryToggle,
    handleLabelSettingChange,
    handleToggleElementLabel,
    handleResetLabelSettings,
    handleOpenLabelPopup,
    handleLabelQuickSize,
    handleLabelQuickDensity,
    handleLabelLinkDistance,
    handleLabelQuickToggle,
    handleLabelQuickNudge,
    handleLabelShowAll,
    handleLabelFamilyToggle,
    handleLabelFamilyPriority,
    restoreLabelDensity,
};
