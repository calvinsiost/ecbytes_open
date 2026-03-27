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
   PLUME ANIMATION DIALOG
   utils/ui/plumeAnimationDialog.js

   Modal para configuracao e geracao de animacao temporal de plumas.
   Permite selecionar parametro, metodo de interpolacao e visualizar
   preview das campanhas que serao usadas como frames.

   Regra: se < 2 campanhas com dados -> mensagem de erro, botao desabilitado.
   ================================================================ */

import { showToast } from './toast.js';
import { t } from '../i18n/translations.js';
import { getAllCampaigns } from '../../core/campaigns/manager.js';
import { getAllElements } from '../../core/elements/manager.js';

// ----------------------------------------------------------------
// ESTADO
// ----------------------------------------------------------------

let _modalEl = null;
let _currentElementId = null;
let _onGenerateCallback = null;

// ----------------------------------------------------------------
// API PUBLICA
// ----------------------------------------------------------------

/**
 * Abre o dialogo de configuracao de animacao de pluma.
 *
 * @param {string} elementId - ID do elemento pluma
 * @param {Function} onGenerate - Callback chamado com as opcoes configuradas
 */
export function openPlumeAnimationDialog(elementId, onGenerate) {
    closePlumeAnimationDialog();

    _currentElementId = elementId;
    _onGenerateCallback = onGenerate;

    const element = getAllElements().find((e) => e.id === elementId);
    if (!element) {
        showToast(t('plumeAnimation.elementNotFound') || 'Elemento nao encontrado.', 'error');
        return;
    }

    // Coletar parametros disponiveis
    const paramIds = _getAvailableParameters(element);

    // Coletar campanhas disponiveis
    const campaigns = getAllCampaigns();
    const campaignPreview = _buildCampaignPreview(paramIds[0] || null, campaigns);

    _modalEl = _buildModal(element, paramIds, campaignPreview);
    document.body.appendChild(_modalEl);

    // Bind eventos
    _bindModalEvents();
}

/**
 * Fecha o dialogo se estiver aberto.
 */
export function closePlumeAnimationDialog() {
    if (_modalEl) {
        _modalEl.remove();
        _modalEl = null;
    }
    _currentElementId = null;
    _onGenerateCallback = null;
}

// ----------------------------------------------------------------
// CONSTRUCAO DO DOM
// ----------------------------------------------------------------

/**
 * Constroi o elemento modal.
 * @param {Object} element
 * @param {string[]} paramIds
 * @param {Object} campaignPreview - { campaigns: [], hasEnough: boolean }
 * @returns {HTMLElement}
 */
function _buildModal(element, paramIds, campaignPreview) {
    const overlay = document.createElement('div');
    overlay.id = 'plume-anim-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', t('plumeAnimation.dialogTitle') || 'Animacao de Pluma');

    // Overlay click fecha
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closePlumeAnimationDialog();
    });

    const modal = document.createElement('div');
    modal.id = 'plume-anim-dialog';

    // Header
    const header = document.createElement('div');
    header.className = 'pa-dialog-header';

    const title = document.createElement('h3');
    title.className = 'pa-dialog-title';
    title.textContent = t('plumeAnimation.dialogTitle') || 'Gerar Animacao de Pluma';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pa-dialog-close';
    closeBtn.type = 'button';
    closeBtn.innerHTML = '&#10005;';
    closeBtn.setAttribute('aria-label', t('close') || 'Fechar');
    closeBtn.addEventListener('click', closePlumeAnimationDialog);

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'pa-dialog-body';

    // Info do elemento
    const infoRow = document.createElement('div');
    infoRow.className = 'pa-info-row';
    infoRow.textContent = `${t('element') || 'Elemento'}: ${element.name || element.id}`;
    body.appendChild(infoRow);

    // Seletor de parametro
    const paramRow = document.createElement('div');
    paramRow.className = 'pa-field-row';

    const paramLabel = document.createElement('label');
    paramLabel.htmlFor = 'pa-param-select';
    paramLabel.textContent = t('plumeAnimation.parameter') || 'Parametro';

    const paramSelect = document.createElement('select');
    paramSelect.id = 'pa-param-select';
    paramSelect.className = 'pa-select';

    if (paramIds.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = t('plumeAnimation.noParameters') || 'Nenhum parametro disponivel';
        paramSelect.appendChild(opt);
        paramSelect.disabled = true;
    } else {
        for (const pid of paramIds) {
            const opt = document.createElement('option');
            opt.value = pid;
            opt.textContent = pid;
            paramSelect.appendChild(opt);
        }
    }

    paramRow.appendChild(paramLabel);
    paramRow.appendChild(paramSelect);
    body.appendChild(paramRow);

    // Metodo de interpolacao
    const methodRow = document.createElement('div');
    methodRow.className = 'pa-field-row';

    const methodLabel = document.createElement('span');
    methodLabel.className = 'pa-field-label';
    methodLabel.textContent = t('plumeAnimation.method') || 'Metodo';

    const methodGroup = document.createElement('div');
    methodGroup.className = 'pa-radio-group';

    for (const [val, label] of [
        ['idw', 'IDW'],
        ['kriging', 'Kriging'],
    ]) {
        const radioWrap = document.createElement('label');
        radioWrap.className = 'pa-radio-label';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'pa-method';
        radio.value = val;
        if (val === 'idw') radio.checked = true;

        radioWrap.appendChild(radio);
        radioWrap.appendChild(document.createTextNode(' ' + label));
        methodGroup.appendChild(radioWrap);
    }

    methodRow.appendChild(methodLabel);
    methodRow.appendChild(methodGroup);
    body.appendChild(methodRow);

    // Preview de campanhas
    const previewSection = document.createElement('div');
    previewSection.id = 'pa-campaign-preview';
    previewSection.className = 'pa-campaign-preview';
    _renderCampaignPreview(previewSection, campaignPreview);
    body.appendChild(previewSection);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'pa-dialog-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'pa-btn pa-btn-secondary';
    cancelBtn.textContent = t('cancel') || 'Cancelar';
    cancelBtn.addEventListener('click', closePlumeAnimationDialog);

    const generateBtn = document.createElement('button');
    generateBtn.id = 'pa-generate-btn';
    generateBtn.type = 'button';
    generateBtn.className = 'pa-btn pa-btn-primary';
    generateBtn.textContent = t('plumeAnimation.generate') || 'Gerar Animacao';
    generateBtn.disabled = !campaignPreview.hasEnough || paramIds.length === 0;

    footer.appendChild(cancelBtn);
    footer.appendChild(generateBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    _injectStyles();
    return overlay;
}

/**
 * Renderiza o preview de campanhas dentro de um container.
 * @param {HTMLElement} container
 * @param {{ campaigns: Array, hasEnough: boolean }} preview
 */
function _renderCampaignPreview(container, preview) {
    container.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'pa-preview-label';
    label.textContent = t('plumeAnimation.campaignsPreview') || 'Campanhas disponiveis como frames:';
    container.appendChild(label);

    if (!preview.hasEnough) {
        const warn = document.createElement('div');
        warn.className = 'pa-warning';
        warn.setAttribute('role', 'alert');
        warn.textContent =
            preview.campaigns.length === 0
                ? t('plumeAnimation.noCampaigns') || 'Nenhuma campanha com dados para o parametro selecionado.'
                : t('plumeAnimation.insufficientCampaigns') || 'Sao necessarias pelo menos 2 campanhas com dados.';
        container.appendChild(warn);
        return;
    }

    const list = document.createElement('ul');
    list.className = 'pa-campaign-list';

    for (const c of preview.campaigns) {
        const li = document.createElement('li');
        li.className = 'pa-campaign-item';
        li.textContent = `${c.name} — ${c.date || ''} (${c.pointCount} ${t('plumeAnimation.points') || 'pontos'})`;
        list.appendChild(li);
    }

    container.appendChild(list);
}

// ----------------------------------------------------------------
// EVENTOS
// ----------------------------------------------------------------

function _bindModalEvents() {
    if (!_modalEl) return;

    // Atualizar preview ao mudar parametro
    const paramSelect = _modalEl.querySelector('#pa-param-select');
    if (paramSelect) {
        paramSelect.addEventListener('change', () => {
            const newParamId = paramSelect.value;
            const campaigns = getAllCampaigns();
            const preview = _buildCampaignPreview(newParamId, campaigns);

            const previewSection = _modalEl?.querySelector('#pa-campaign-preview');
            if (previewSection) _renderCampaignPreview(previewSection, preview);

            const generateBtn = _modalEl?.querySelector('#pa-generate-btn');
            if (generateBtn) generateBtn.disabled = !preview.hasEnough;
        });
    }

    // Gerar animacao
    const generateBtn = _modalEl.querySelector('#pa-generate-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', () => {
            const paramId = paramSelect?.value;
            const methodRadio = _modalEl?.querySelector('input[name="pa-method"]:checked');
            const method = methodRadio?.value || 'idw';

            if (!paramId) {
                showToast(t('plumeAnimation.selectParameter') || 'Selecione um parametro.', 'warning');
                return;
            }

            const opts = { parameterId: paramId, method };
            closePlumeAnimationDialog();

            if (typeof _onGenerateCallback === 'function') {
                _onGenerateCallback(_currentElementId, opts);
            }
        });
    }

    // Escape fecha
    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            closePlumeAnimationDialog();
            document.removeEventListener('keydown', onKeyDown);
        }
    };
    document.addEventListener('keydown', onKeyDown);
}

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

/**
 * Retorna IDs de parametros com observacoes numericas no elemento.
 * @param {Object} element
 * @returns {string[]}
 */
function _getAvailableParameters(element) {
    const obs = element.data?.observations;
    if (!Array.isArray(obs)) return [];

    const seen = new Set();
    for (const o of obs) {
        if (o.parameterId && Number.isFinite(parseFloat(o.value))) {
            seen.add(o.parameterId);
        }
    }

    // Tambem incluir parametros de outros pocos para interpolacao
    const allElements = getAllElements();
    for (const el of allElements) {
        if (el.family !== 'well') continue;
        for (const o of el.data?.observations || []) {
            if (o.parameterId && Number.isFinite(parseFloat(o.value))) {
                seen.add(o.parameterId);
            }
        }
    }

    return [...seen].sort();
}

/**
 * Constroi preview das campanhas disponiveis para um parametro.
 * @param {string|null} parameterId
 * @param {Object[]} campaigns
 * @returns {{ campaigns: Array<{id, name, date, pointCount}>, hasEnough: boolean }}
 */
function _buildCampaignPreview(parameterId, campaigns) {
    if (!parameterId) return { campaigns: [], hasEnough: false };

    const allElements = getAllElements();
    const campaignCounts = new Map();

    for (const el of allElements) {
        if (el.family !== 'well') continue;
        for (const obs of el.data?.observations || []) {
            if (obs.parameterId !== parameterId) continue;
            if (!Number.isFinite(parseFloat(obs.value))) continue;
            if (!obs.campaignId) continue;
            campaignCounts.set(obs.campaignId, (campaignCounts.get(obs.campaignId) || 0) + 1);
        }
    }

    const result = [];
    for (const [cid, count] of campaignCounts.entries()) {
        const camp = campaigns.find((c) => c.id === cid);
        result.push({
            id: cid,
            name: camp?.name || cid,
            date: camp?.startDate || '',
            pointCount: count,
        });
    }

    result.sort((a, b) => a.date.localeCompare(b.date));

    return { campaigns: result, hasEnough: result.length >= 2 };
}

// ----------------------------------------------------------------
// ESTILOS (injetados uma unica vez)
// ----------------------------------------------------------------

let _stylesInjected = false;

function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;

    const style = document.createElement('style');
    style.textContent = `
        #plume-anim-dialog-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.55);
            z-index: 9000;
            display: flex; align-items: center; justify-content: center;
        }
        #plume-anim-dialog {
            background: var(--surface-color, #1e1e2e);
            border: 1px solid var(--border-color, #333);
            border-radius: 8px;
            width: min(480px, 94vw);
            max-height: 80vh;
            display: flex; flex-direction: column;
            color: var(--text-color, #e0e0e0);
            font-size: 13px;
        }
        .pa-dialog-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 16px 10px;
            border-bottom: 1px solid var(--border-color, #333);
        }
        .pa-dialog-title { margin: 0; font-size: 14px; font-weight: 600; }
        .pa-dialog-close {
            background: none; border: none; color: inherit;
            cursor: pointer; font-size: 16px; padding: 2px 6px;
            opacity: 0.7;
        }
        .pa-dialog-close:hover { opacity: 1; }
        .pa-dialog-body { padding: 14px 16px; overflow-y: auto; flex: 1; }
        .pa-info-row {
            font-size: 12px; opacity: 0.7;
            margin-bottom: 12px;
        }
        .pa-field-row {
            display: flex; align-items: center; gap: 10px;
            margin-bottom: 12px;
        }
        .pa-field-label, label.pa-field-row > label {
            min-width: 100px; font-size: 12px; opacity: 0.85;
        }
        .pa-select {
            flex: 1;
            background: var(--input-bg, #2a2a3e);
            border: 1px solid var(--border-color, #444);
            color: inherit; border-radius: 4px;
            padding: 4px 8px; font-size: 12px;
        }
        .pa-radio-group { display: flex; gap: 16px; }
        .pa-radio-label { display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12px; }
        .pa-preview-label { font-size: 12px; opacity: 0.8; margin-bottom: 6px; }
        .pa-campaign-list {
            list-style: none; margin: 0; padding: 0;
            max-height: 160px; overflow-y: auto;
            border: 1px solid var(--border-color, #333);
            border-radius: 4px;
        }
        .pa-campaign-item {
            padding: 5px 10px; font-size: 11px;
            border-bottom: 1px solid var(--border-color, #2a2a3a);
        }
        .pa-campaign-item:last-child { border-bottom: none; }
        .pa-warning {
            color: var(--warning-color, #f59e0b);
            font-size: 12px; padding: 8px;
            border: 1px solid var(--warning-color, #f59e0b);
            border-radius: 4px; background: rgba(245,158,11,0.08);
        }
        .pa-dialog-footer {
            display: flex; justify-content: flex-end; gap: 8px;
            padding: 10px 16px 14px;
            border-top: 1px solid var(--border-color, #333);
        }
        .pa-btn {
            padding: 6px 16px; border-radius: 4px;
            border: 1px solid transparent;
            cursor: pointer; font-size: 12px; font-weight: 500;
        }
        .pa-btn-secondary {
            background: transparent;
            border-color: var(--border-color, #444);
            color: inherit;
        }
        .pa-btn-primary {
            background: var(--accent-color, #3b82f6);
            color: #fff;
        }
        .pa-btn-primary:disabled {
            opacity: 0.4; cursor: not-allowed;
        }
    `;
    document.head.appendChild(style);
}
