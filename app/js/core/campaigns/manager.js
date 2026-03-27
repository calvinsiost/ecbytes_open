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
   GERENCIADOR DE CAMPANHAS
   ================================================================

   Este modulo gerencia campanhas de monitoramento.

   CAMPANHA = AGRUPAMENTO DE DATAS + LEITURAS PLANEJADAS
   - id: identificador unico
   - name: nome de exibicao
   - startDate: data inicial (obrigatoria)
   - endDate: data final (opcional)
   - color: cor de destaque
   - visible: se esta ativa na visualizacao
   - plannedReadings: leituras esperadas [{ elementId, parameterId }]

   PLANEJADO vs EXECUTADO:
   Cada campanha define leituras planejadas (elemento + parametro).
   Observacoes reais vinculadas por campaignId sao o "executado".
   A razao executado/planejado alimenta o eixo Cp (Completude) do EIS.

   ================================================================ */

import { requireOwnershipPermission } from '../ownership/index.js';

// ----------------------------------------------------------------
// ESTADO DO MODULO
// ----------------------------------------------------------------

let campaigns = [];
let campaignCounter = 0;

// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------

function createId() {
    campaignCounter += 1;
    return `campaign-${campaignCounter}`;
}

function normalizeCampaign(campaign) {
    const today = new Date().toISOString().slice(0, 10);
    return {
        id: campaign.id || createId(),
        name: campaign.name || `Campanha ${campaignCounter}`,
        startDate: campaign.startDate || today,
        endDate: campaign.endDate || '',
        color: campaign.color || '#3b6bff',
        visible: campaign.visible !== false,
        plannedReadings: Array.isArray(campaign.plannedReadings)
            ? campaign.plannedReadings.map((r) => ({
                  elementId: r.elementId || null,
                  parameterId: r.parameterId || null,
                  x: r.x ?? null,
                  y: r.y ?? null,
                  z: r.z ?? null,
                  expectedValue: r.expectedValue ?? null,
              }))
            : [],
        costs: campaign.costs || null,
    };
}

// ----------------------------------------------------------------
// FUNCOES DE ACESSO
// ----------------------------------------------------------------

export function getAllCampaigns() {
    return campaigns;
}

export function getCampaignById(id) {
    return campaigns.find((c) => c.id === id);
}

// ----------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------

export function addCampaign(data = {}) {
    const campaign = normalizeCampaign(data);
    campaigns.push(campaign);
    return campaign;
}

export function updateCampaign(id, updates) {
    const campaign = getCampaignById(id);
    if (!campaign) return null;

    Object.assign(campaign, updates);

    if (!campaign.startDate) {
        campaign.startDate = new Date().toISOString().slice(0, 10);
    }

    return campaign;
}

export function removeCampaign(id, options = {}) {
    if (!options?.skipOwnershipCheck) {
        const ownership = requireOwnershipPermission('campaign_remove');
        if (!ownership.ok) return false;
    }
    const index = campaigns.findIndex((c) => c.id === id);
    if (index === -1) return false;
    campaigns.splice(index, 1);
    return true;
}

export function setCampaignVisibility(id, visible) {
    const campaign = getCampaignById(id);
    if (campaign) {
        campaign.visible = visible;
    }
}

// ----------------------------------------------------------------
// PLANNED READINGS — Leituras planejadas (elemento + parametro)
// ----------------------------------------------------------------

/**
 * Add a planned reading to a campaign.
 * Adiciona uma leitura esperada (elemento + parametro) a campanha.
 *
 * @param {string} campaignId
 * @param {{ elementId: string|null, parameterId: string|null }} reading
 * @returns {Object|null} Updated campaign or null if not found.
 */
export function addPlannedReading(campaignId, reading = {}) {
    const campaign = getCampaignById(campaignId);
    if (!campaign) return null;
    if (!campaign.plannedReadings) campaign.plannedReadings = [];
    campaign.plannedReadings.push({
        elementId: reading.elementId || null,
        parameterId: reading.parameterId || null,
        x: reading.x ?? null,
        y: reading.y ?? null,
        z: reading.z ?? null,
        expectedValue: reading.expectedValue ?? null,
    });
    return campaign;
}

/**
 * Update a field in a planned reading.
 * Edita o elementId ou parameterId de uma leitura planejada.
 *
 * @param {string} campaignId
 * @param {number} index - Index in the plannedReadings array.
 * @param {string} field - 'elementId' or 'parameterId'.
 * @param {string} value
 * @returns {Object|null}
 */
export function updatePlannedReading(campaignId, index, field, value) {
    const campaign = getCampaignById(campaignId);
    if (!campaign?.plannedReadings?.[index]) return null;
    campaign.plannedReadings[index][field] = value;
    return campaign;
}

/**
 * Remove a planned reading from a campaign.
 * Remove uma leitura planejada pelo indice.
 *
 * @param {string} campaignId
 * @param {number} index
 * @returns {boolean}
 */
export function removePlannedReading(campaignId, index) {
    const campaign = getCampaignById(campaignId);
    if (!campaign?.plannedReadings) return false;
    if (index < 0 || index >= campaign.plannedReadings.length) return false;
    campaign.plannedReadings.splice(index, 1);
    return true;
}

/**
 * Compute completeness for a campaign: planned vs executed.
 * Para cada {elementId, parameterId} planejado, verifica se existe
 * pelo menos uma observacao com campaignId + elementId + parameterId
 * com value != null.
 *
 * @param {string} campaignId
 * @param {Array<Object>} allElements - From getAllElements().
 * @returns {{ planned: number, executed: number, ratio: number, details: Array<{ elementId: string, parameterId: string, executed: boolean }> }}
 */
export function getCampaignCompleteness(campaignId, allElements) {
    const campaign = getCampaignById(campaignId);
    if (!campaign?.plannedReadings?.length) {
        return { planned: 0, executed: 0, ratio: 0, details: [] };
    }

    // Coleta observacoes executadas para esta campanha
    const executedSet = new Set();
    for (const el of allElements) {
        const obs = el?.data?.observations || [];
        for (const o of obs) {
            if (o.campaignId === campaignId && o.parameterId && o.value != null) {
                executedSet.add(`${el.id}::${o.parameterId}`);
            }
        }
    }

    const details = campaign.plannedReadings.map((pr) => ({
        elementId: pr.elementId,
        parameterId: pr.parameterId,
        executed: pr.elementId && pr.parameterId ? executedSet.has(`${pr.elementId}::${pr.parameterId}`) : false,
    }));

    const executed = details.filter((d) => d.executed).length;
    const planned = campaign.plannedReadings.length;
    const ratio = planned > 0 ? executed / planned : 0;

    return { planned, executed, ratio, details };
}

// ----------------------------------------------------------------
// SERIALIZACAO
// ----------------------------------------------------------------

export function exportCampaigns() {
    return campaigns.map((c) => ({ ...c }));
}

export function importCampaigns(imported) {
    if (!Array.isArray(imported)) {
        campaigns = [];
        campaignCounter = 0;
        return;
    }

    campaigns = imported.map((c) => normalizeCampaign(c));
    campaignCounter = campaigns.length;
}

export function clearCampaigns() {
    campaigns = [];
    campaignCounter = 0;
}
