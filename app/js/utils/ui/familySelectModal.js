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
   FAMILY SELECTION MODAL
   ================================================================

   Modal reutilizavel para selecionar familias antes de gerar
   modelo aleatorio ou limpar modelo existente.

   O QUE FAZ?
   Exibe lista de familias com checkboxes para o usuario escolher
   quais incluir na operacao (Random ou Clear).
   A selecao e salva no localStorage para lembrar entre sessoes.

   ================================================================ */

import { getAllFamilies, getFamilyName } from '../../core/elements/families.js';
import { countByFamily } from '../../core/elements/manager.js';
import { getIcon } from './icons.js';
import { openModal, closeModal } from './modals.js';
import { t } from '../i18n/translations.js';
import { safeSetItem } from '../storage/storageMonitor.js';

// ----------------------------------------------------------------
// CONSTANTES
// ----------------------------------------------------------------

const LS_RANDOM_KEY = 'ecbyts-random-families';
const LS_CLEAR_KEY = 'ecbyts-clear-families';

/** Familias geradas pelo randomModel */
const RANDOM_FAMILIES = [
    'site_project',
    'site_area',
    'site_zone',
    'boundary',
    'stratum',
    'building',
    'plume',
    'well',
    'tank',
    'lake',
    'river',
    'spring',
    'marker',
    'sample',
    'emission_source',
    'waste_stream',
    'effluent_point',
    'area',
    'incident',
    'habitat',
    'individual',
    'sensor',
    'intangible',
    'generic',
    'blueprint',
];

// ----------------------------------------------------------------
// ESTADO DO MODULO
// ----------------------------------------------------------------

let _currentMode = null; // 'random' | 'clear'
let _onConfirm = null; // callback(Set<string>)

// ----------------------------------------------------------------
// LOCALSTORAGE
// ----------------------------------------------------------------

/**
 * Load saved family selection from localStorage.
 * Carrega selecao salva; retorna null se nao existir.
 * @param {'random'|'clear'} mode
 * @returns {Set<string>|null}
 */
export function loadFamilySelection(mode) {
    const key = mode === 'random' ? LS_RANDOM_KEY : LS_CLEAR_KEY;
    try {
        const saved = localStorage.getItem(key);
        if (saved) return new Set(JSON.parse(saved));
    } catch (e) {
        console.warn('[FamilySelect] Error loading from localStorage:', e.message);
    }
    return null;
}

/**
 * Save family selection to localStorage.
 * Persiste array de IDs selecionados.
 * @param {'random'|'clear'} mode
 * @param {Set<string>} selected
 */
export function saveFamilySelection(mode, selected) {
    const key = mode === 'random' ? LS_RANDOM_KEY : LS_CLEAR_KEY;
    try {
        safeSetItem(key, JSON.stringify([...selected]));
    } catch (e) {
        console.warn('[FamilySelect] Error saving to localStorage:', e.message);
    }
}

// ----------------------------------------------------------------
// MODAL API
// ----------------------------------------------------------------

/**
 * Open the family selection modal.
 * Abre o modal com checkboxes para escolher familias.
 * @param {'random'|'clear'} mode
 * @param {Function} onConfirm - callback(Set<string> selectedFamilyIds)
 */
export function openFamilySelectModal(mode, onConfirm) {
    _currentMode = mode;
    _onConfirm = onConfirm;

    // Titulo e subtitulo
    const titleEl = document.getElementById('family-select-title');
    const subtitleEl = document.getElementById('family-select-subtitle');
    const confirmBtn = document.getElementById('family-select-confirm');

    if (titleEl) titleEl.textContent = t('selectFamilies') || 'Select Families';
    if (subtitleEl) {
        subtitleEl.textContent =
            mode === 'random'
                ? t('selectFamiliesToGenerate') || 'Choose families to generate:'
                : t('selectFamiliesToClear') || 'Choose families to remove:';
    }
    if (confirmBtn) {
        confirmBtn.textContent =
            mode === 'random' ? t('generate') || 'Generate' : t('clearSelected') || 'Clear Selected';
        confirmBtn.className = mode === 'random' ? 'btn btn-success' : 'btn btn-danger';
    }

    _renderFamilyList(mode);
    openModal('family-select-modal');
}

// ----------------------------------------------------------------
// RENDER
// ----------------------------------------------------------------

/**
 * Render checkbox list inside modal body.
 * Renderiza lista de familias com checkboxes e icones.
 */
function _renderFamilyList(mode) {
    const container = document.getElementById('family-select-list');
    if (!container) return;

    const allFamilies = getAllFamilies();
    const saved = loadFamilySelection(mode);
    const counts = countByFamily();

    // Determina quais familias mostrar
    let familyIds;
    if (mode === 'random') {
        // Apenas familias que o randomModel gera
        familyIds = RANDOM_FAMILIES.filter((id) => allFamilies[id]);
    } else {
        // Clear: mostra todas as familias que tem elementos
        familyIds = Object.keys(allFamilies).filter((id) => (counts[id] || 0) > 0);
    }

    if (familyIds.length === 0) {
        container.innerHTML = `<p style="padding:16px;text-align:center;color:var(--primary-text-soft);">
            ${t('noElements') || 'No elements to clear.'}
        </p>`;
        const confirmBtn = document.getElementById('family-select-confirm');
        if (confirmBtn) confirmBtn.disabled = true;
        return;
    }

    // Gera HTML
    container.innerHTML = familyIds
        .map((id) => {
            const f = allFamilies[id];
            const name = getFamilyName(f);
            const icon = getIcon(f.icon, { size: '18px' });
            const count = counts[id] || 0;
            // Se tem cache, usa; senao, default = selecionado
            const checked = saved ? saved.has(id) : true;
            const countLabel = mode === 'clear' ? ` <span class="family-select-count">(${count})</span>` : '';

            return `<label class="family-select-item">
            <input type="checkbox" id="fsel-${id}" data-family="${id}"
                   ${checked ? 'checked' : ''}>
            <span class="family-select-icon">${icon}</span>
            <span>${name}${countLabel}</span>
        </label>`;
        })
        .join('');

    // Listener de change em cada checkbox para atualizar botao confirm
    container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', _updateConfirmButton);
    });

    // Event listener robusto no botao confirm (backup do onclick inline)
    const confirmBtn = document.getElementById('family-select-confirm');
    if (confirmBtn) {
        confirmBtn.removeEventListener('click', _handleConfirmClick);
        confirmBtn.addEventListener('click', _handleConfirmClick);
    }

    _updateConfirmButton();
}

/**
 * Internal click handler for confirm button.
 * Wrapper com try/catch para capturar erros visivelmente.
 */
function _handleConfirmClick() {
    try {
        handleFamilySelectConfirm();
    } catch (e) {
        console.error('[FamilySelect] Error in confirm:', e);
    }
}

/**
 * Update confirm button enabled state.
 * Desabilita se nenhuma familia selecionada.
 */
function _updateConfirmButton() {
    const confirmBtn = document.getElementById('family-select-confirm');
    if (!confirmBtn) return;
    const checked = document.querySelectorAll('#family-select-list input[type="checkbox"]:checked');
    confirmBtn.disabled = checked.length === 0;
}

// ----------------------------------------------------------------
// HANDLERS (expostos no window via index.js)
// ----------------------------------------------------------------

/**
 * Toggle all checkboxes on/off.
 * Alterna todos: se algum esta desmarcado, marca todos; senao desmarca todos.
 */
export function handleFamilySelectToggleAll() {
    const checkboxes = document.querySelectorAll('#family-select-list input[type="checkbox"]');
    if (checkboxes.length === 0) return;

    const allChecked = [...checkboxes].every((cb) => cb.checked);
    checkboxes.forEach((cb) => {
        cb.checked = !allChecked;
    });
    _updateConfirmButton();
}

/**
 * Confirm selection and execute callback.
 * Salva selecao no cache e chama o callback com o Set de IDs.
 */
export function handleFamilySelectConfirm() {
    try {
        // Idempotent guard: modal confirm can be bound both inline and via addEventListener.
        // After the first successful confirm we reset mode/callback; duplicate events should no-op.
        if (!_currentMode) return;

        const checkboxes = document.querySelectorAll('#family-select-list input[type="checkbox"]:checked');
        const selected = new Set([...checkboxes].map((cb) => cb.dataset.family));

        console.log('[FamilySelect] Confirm:', selected.size, 'families, mode:', _currentMode);

        if (selected.size === 0) return;

        saveFamilySelection(_currentMode, selected);
        closeModal('family-select-modal');

        // Capture callback then reset state BEFORE invoking callback
        // so duplicate click handlers in the same event cycle do not re-enter.
        const onConfirm = _onConfirm;
        _currentMode = null;
        _onConfirm = null;

        if (onConfirm) {
            onConfirm(selected);
        } else {
            console.warn('[FamilySelect] No callback registered (_onConfirm is null)');
        }
    } catch (e) {
        console.error('[FamilySelect] Error in confirm handler:', e);
    }
}
