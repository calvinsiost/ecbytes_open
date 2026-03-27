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
   CAMPAIGN HANDLERS — Sampling campaign management
   Handlers para campanhas de amostragem

   Uma "campanha" e um evento de coleta de dados em campo.
   Ex: "Campanha de Monitoramento - Janeiro 2026"
   Cada campanha tem uma data, equipe responsavel e cor de identificacao.
   As observacoes (medicoes) sao vinculadas a campanhas.
   ================================================================ */

import {
    addCampaign,
    updateCampaign,
    removeCampaign,
    setCampaignVisibility,
    addPlannedReading,
    updatePlannedReading,
    removePlannedReading,
    getCampaignById,
} from '../../core/campaigns/manager.js';
import { getElementById, updateElement } from '../../core/elements/manager.js';
import { CONFIG } from '../../config.js';
import { getCurrentUser } from '../auth/session.js';
import { canDo } from '../auth/permissions.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { updateCampaignsList, updateScenesList, updateElementDetails } from '../ui/lists.js';
import { requireOwnershipPermission } from '../../core/ownership/index.js';

// ----------------------------------------------------------------
// CAMPAIGN CRUD
// Criar, editar e remover campanhas de amostragem.
// ----------------------------------------------------------------

/**
 * Add a new empty campaign.
 * Cria uma nova campanha de amostragem vazia.
 */
export function handleAddCampaign(params) {
    // P2: Headless mode — create campaign without UI
    if (typeof params === 'object' && params?._headless) {
        const { name, startDate, endDate, color } = params;
        const campaign = addCampaign({});
        if (campaign && name) {
            updateCampaign(campaign.id, { name });
            if (startDate) updateCampaign(campaign.id, { startDate });
            if (endDate) updateCampaign(campaign.id, { endDate });
            if (color) updateCampaign(campaign.id, { color });
        }
        return campaign ? { success: true, campaignId: campaign.id } : { error: 'creation_failed' };
    }

    const c = addCampaign({});
    updateCampaignsList();
    if (c) window.dispatchEvent(new CustomEvent('ecbt:campaignAdded', { detail: { id: c.id } }));
}

/**
 * Update a field in a campaign.
 * Atualiza um campo da campanha (nome, data, cor, etc.)
 *
 * @param {string} campaignId - Campaign ID
 * @param {string} field - Field to update
 * @param {*} value - New value
 */
export function handleCampaignChange(campaignId, field, value) {
    updateCampaign(campaignId, { [field]: value });
    updateCampaignsList();
}

/**
 * Toggle campaign visibility in the model.
 * Mostra ou esconde os dados de uma campanha na visualizacao.
 *
 * @param {string} campaignId - Campaign ID
 * @param {boolean} visible - Visibility state
 */
export function handleCampaignVisibility(campaignId, visible) {
    setCampaignVisibility(campaignId, visible);
    updateCampaignsList();
}

/**
 * Remove a campaign.
 * Remove uma campanha e atualiza a lista de cenas
 * (cenas podem referenciar campanhas).
 *
 * @param {string} campaignId - Campaign ID to remove
 */
export function handleRemoveCampaign(campaignId) {
    if (!canDo('delete')) {
        showToast(t('auth.actionDenied') || "You don't have permission to perform this action.", 'error');
        return;
    }
    const ownership = requireOwnershipPermission('campaign_remove');
    if (!ownership.ok) {
        showToast(t('auth.actionDenied') || ownership.error, 'error');
        return;
    }
    removeCampaign(campaignId);
    updateCampaignsList();
    updateScenesList();
}

// ----------------------------------------------------------------
// PLANNED READINGS CRUD
// Gerenciar leituras planejadas (elemento + parametro esperados).
// ----------------------------------------------------------------

/**
 * Add a new empty planned reading to a campaign.
 * Adiciona uma leitura planejada vazia (usuario seleciona elemento e parametro).
 *
 * @param {string} campaignId
 */
export function handleAddPlannedReading(campaignId) {
    addPlannedReading(campaignId, { elementId: null, parameterId: null });
    updateCampaignsList();
}

/**
 * Update a field in a planned reading.
 * Edita o elementId ou parameterId de uma leitura planejada.
 *
 * @param {string} campaignId
 * @param {number} index
 * @param {string} field - 'elementId' or 'parameterId'
 * @param {string} value
 */
export function handlePlannedReadingChange(campaignId, index, field, value) {
    // Campos numericos: posicao e valor esperado
    const numericFields = ['x', 'y', 'z', 'expectedValue'];
    const parsed = numericFields.includes(field) ? (value === '' ? null : Number(value)) : value;
    updatePlannedReading(campaignId, parseInt(index, 10), field, parsed);
    updateCampaignsList();
}

/**
 * Remove a planned reading from a campaign.
 * Remove uma leitura planejada pelo indice.
 *
 * @param {string} campaignId
 * @param {number} index
 */
export function handleRemovePlannedReading(campaignId, index) {
    removePlannedReading(campaignId, parseInt(index, 10));
    updateCampaignsList();
}

/**
 * Quick-fill: create an observation from a planned reading.
 * Cria uma observacao no elemento com campaignId e parameterId ja preenchidos.
 * Atalho para o tecnico nao precisar abrir o elemento e preencher manualmente.
 *
 * @param {string} campaignId
 * @param {string} elementId
 * @param {string} parameterId
 */
export function handleFillFromPlan(campaignId, elementId, parameterId) {
    const element = getElementById(elementId);
    if (!element) {
        showToast(t('elementNotFound') || 'Element not found', 'error');
        return;
    }

    // Busca dados planejados da campanha (posicao e valor esperado)
    const campaign = getCampaignById(campaignId);
    const plannedReading = campaign?.plannedReadings?.find(
        (r) => r.elementId === elementId && r.parameterId === parameterId,
    );

    const param = CONFIG.PARAMETERS.find((p) => p.id === parameterId);
    const observations = Array.isArray(element.data?.observations) ? [...element.data.observations] : [];

    observations.push({
        // Posicao planejada (copiada do plano da campanha)
        plannedX: plannedReading?.x ?? null,
        plannedY: plannedReading?.y ?? null,
        plannedZ: plannedReading?.z ?? null,
        // Posicao executada (comeca em 0, tecnico preenche)
        x: 0,
        y: 0,
        z: 0,
        date: new Date().toISOString().slice(0, 10),
        campaignId,
        parameterId: parameterId || null,
        // Valor esperado vs coletado
        expectedValue: plannedReading?.expectedValue ?? null,
        value: null,
        unitId: param?.defaultUnitId || null,
        autoConvert: false,
        additionalReadings: [],
        variables: {},
        detect_flag: null,
        qualifier: null,
        detection_limit: null,
        cas_number: null,
        lab_name: null,
        sample_code: null,
        analytical_method: null,
        dilution_factor: null,
        sample_matrix: null,
        credentialLevel: getCurrentUser()?.credentialLevel || 'common',
        createdBy: getCurrentUser()?.email || null,
    });

    updateElement(elementId, { data: { ...element.data, observations } });
    updateCampaignsList();
    updateElementDetails();
    showToast(t('observationFilledFromPlan') || 'Observation created from planned reading', 'success');
}

/**
 * All campaign handler functions exposed to HTML via window.
 * Objeto com todas as funcoes de campanha para o HTML.
 */
export const campaignHandlers = {
    handleAddCampaign,
    handleCampaignChange,
    handleCampaignVisibility,
    handleRemoveCampaign,
    handleAddPlannedReading,
    handlePlannedReadingChange,
    handleRemovePlannedReading,
    handleFillFromPlan,
};
