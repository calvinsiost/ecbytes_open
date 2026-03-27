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
   COST ROLLUP — Agregação global de custos L1-L4
   ================================================================

   Motor de consolidação financeira que coleta dados de custo
   dispersos nos elementos, observações, campanhas e WBS, e retorna
   um objeto unificado para o dashboard de análise de custos.

   NÍVEIS AGREGADOS:
   L1 Reading  → observation.cost         (ensaio analítico)
   L2 Element  → element.data.costs[]     (CAPEX+OPEX por ano fiscal)
   L3 Campaign → campaign.costs           (mobilização, logística)
   L4 Project  → wbsItems + contracts     (EAP + contratos)

   DESIGN:
   - Agregação sob demanda (sem cache) — ver ADR-024
   - Single Currency Rule (ADR-022)
   - L1 e L2 reportados separadamente (possível sobreposição parcial)
   ================================================================ */

import { getAllElements } from '../../elements/manager.js';
import { getAllCampaigns } from '../../campaigns/manager.js';
import { getWbsItems, calculateProjectEVA } from '../../../utils/governance/wbsManager.js';
import { getContracts, getContractFinancialSummary } from '../../../utils/governance/contractManager.js';
import { getCurrency, getCostCategories, getEscalationRate } from '../../ingestion/documents/costCatalog.js';
import { getCostCenters, getAllAllocations, getBudget } from '../../../utils/governance/costCenterManager.js';

// ----------------------------------------------------------------
// MAIN AGGREGATION
// ----------------------------------------------------------------

/**
 * Build a consolidated cost rollup from all data sources (L1-L4).
 * Constrói agregação consolidada de custos de todas as fontes.
 *
 * @returns {CostRollup} Consolidated cost data
 */
export function buildCostRollup() {
    const elements = getAllElements() || [];
    const campaigns = getAllCampaigns() || [];
    const currency = getCurrency();
    const categories = getCostCategories();

    // Accumulators
    let totalCapex = 0;
    let totalOpex = 0;
    let totalObservationCost = 0;
    let observationCount = 0;

    const byFamily = {}; // { [familyId]: { capex, opex, total, elementCount } }
    const byFiscalYear = {}; // { [year]: { capex, opex, total } }
    const byCampaign = {}; // { [campaignId]: { name, date, total, items } }
    const byElement = {}; // { [elementId]: { name, family, capex, opex, total, costs } }
    const byCategory = {}; // { [categoryId]: { [itemId]: amount } }

    // ---- L2: Element-level costs ----
    for (const el of elements) {
        const costs = el.data?.costs;
        if (!Array.isArray(costs) || costs.length === 0) continue;

        let elCapex = 0;
        let elOpex = 0;

        for (const entry of costs) {
            const fy = entry.fiscalYear;
            const capex = entry.capexTotal || 0;
            const opex = entry.opexTotal || 0;

            elCapex += capex;
            elOpex += opex;
            totalCapex += capex;
            totalOpex += opex;

            // By fiscal year
            if (!byFiscalYear[fy]) byFiscalYear[fy] = { capex: 0, opex: 0, total: 0 };
            byFiscalYear[fy].capex += capex;
            byFiscalYear[fy].opex += opex;
            byFiscalYear[fy].total += capex + opex;

            // By category (item-level)
            if (Array.isArray(entry.items)) {
                for (const item of entry.items) {
                    const catId = item.categoryId;
                    const itemId = item.itemId;
                    if (!byCategory[catId]) byCategory[catId] = {};
                    if (!byCategory[catId][itemId]) byCategory[catId][itemId] = 0;
                    byCategory[catId][itemId] += item.amount || 0;
                }
            }
        }

        // By family
        const fam = el.family || 'unknown';
        if (!byFamily[fam]) byFamily[fam] = { capex: 0, opex: 0, total: 0, elementCount: 0 };
        byFamily[fam].capex += elCapex;
        byFamily[fam].opex += elOpex;
        byFamily[fam].total += elCapex + elOpex;
        byFamily[fam].elementCount += 1;

        // By element
        byElement[el.id] = {
            name: el.name || el.id,
            family: fam,
            capex: _round(elCapex),
            opex: _round(elOpex),
            total: _round(elCapex + elOpex),
            costs: costs,
        };

        // ---- L1: Observation-level costs ----
        const obs = el.data?.observations;
        if (Array.isArray(obs)) {
            for (const o of obs) {
                if (o.cost && o.cost.total > 0) {
                    totalObservationCost += o.cost.total;
                    observationCount++;
                }
            }
        }
    }

    // ---- L3: Campaign-level costs ----
    let totalCampaignCost = 0;
    for (const camp of campaigns) {
        if (!camp.costs || !camp.costs.total) continue;

        byCampaign[camp.id] = {
            name: camp.name || camp.id,
            date: camp.startDate || '',
            total: _round(camp.costs.total),
            items: camp.costs.items || [],
        };
        totalCampaignCost += camp.costs.total;
    }

    // ---- L4: Project-level (WBS + Contracts) ----
    const l4Summary = { wbsBAC: 0, wbsAC: 0, wbsEAC: 0, contractsTotal: 0, contractsPaid: 0, itemCount: 0 };
    try {
        const wbsItems = getWbsItems();
        if (wbsItems.length > 0) {
            const projectEVA = calculateProjectEVA();
            l4Summary.wbsBAC = projectEVA?.BAC || 0;
            l4Summary.wbsAC = projectEVA?.AC || 0;
            l4Summary.wbsEAC = projectEVA?.EAC || 0;
            l4Summary.itemCount = wbsItems.length;
        }

        const contracts = getContracts();
        for (const c of contracts) {
            const summary = getContractFinancialSummary(c.id);
            if (summary) {
                l4Summary.contractsTotal += summary.totalValue || 0;
                l4Summary.contractsPaid += summary.totalPaid || 0;
            }
        }
    } catch (e) {
        // Governance modules may not be initialized — graceful degradation
        console.warn('[CostRollup] L4 data unavailable:', e.message);
    }

    // ---- Cost Center aggregation ----
    let byCostCenter = {};
    try {
        byCostCenter = _buildCostCenterAggregation(byElement, byCampaign, elements, campaigns);
    } catch (e) {
        console.warn('[CostRollup] Cost center aggregation unavailable:', e.message);
    }

    // ---- Timeline (sorted by fiscal year, with cumulative) ----
    const timeline = _buildTimeline(byFiscalYear);

    // ---- KPIs ----
    const elementsWithCost = Object.keys(byElement).length;
    const campaignsWithCost = Object.keys(byCampaign).length;
    const grandTotal = totalCapex + totalOpex;

    // ---- Benchmark KPIs ----
    // Total well depth (soma de totalDepth de todos os poços)
    let totalWellDepthMeters = 0;
    const uniqueParams = new Set();
    let totalAnalyticalCost = 0;

    for (const el of elements) {
        // Profundidade dos poços
        if ((el.family === 'well' || el.familyId === 'well') && el.data?.construction?.totalDepth) {
            totalWellDepthMeters += el.data.construction.totalDepth;
        }
        // Parâmetros únicos e custo analítico via observações
        if (Array.isArray(el.data?.observations)) {
            for (const o of el.data.observations) {
                if (o.parameterId) uniqueParams.add(o.parameterId);
                if (o.cost?.items) {
                    for (const item of o.cost.items) {
                        if (item.itemId === 'analytical') totalAnalyticalCost += item.amount || 0;
                    }
                }
            }
        }
    }
    const uniqueParameterCount = uniqueParams.size;
    const drillingCost = byCategory?.capex?.drilling || 0;

    // Benchmarks: valor real vs referência setorial
    const benchmarks = {
        costPerMeter: totalWellDepthMeters > 0 ? _round(drillingCost / totalWellDepthMeters) : null,
        costPerMeterRef: 350,
        costPerObservation: observationCount > 0 ? _round(totalObservationCost / observationCount) : null,
        costPerObservationRef: 150,
        costPerCampaign: campaignsWithCost > 0 ? _round(totalCampaignCost / campaignsWithCost) : null,
        costPerCampaignRef: 9000,
        capexOpexRatio: totalOpex > 0 ? _round(totalCapex / totalOpex) : null,
        capexOpexRatioRef: 1.5,
        costPerElement: elementsWithCost > 0 ? _round(grandTotal / elementsWithCost) : null,
        costPerElementRef: 25000,
        analyticalCostPerParam: uniqueParameterCount > 0 ? _round(totalAnalyticalCost / uniqueParameterCount) : null,
        analyticalCostPerParamRef: 120,
    };

    return {
        totalCapex: _round(totalCapex),
        totalOpex: _round(totalOpex),
        grandTotal: _round(grandTotal),
        currency,
        byFamily,
        byFiscalYear,
        byCampaign,
        byElement,
        byCategory,
        byCostCenter,
        l4Summary,
        timeline,
        totalObservationCost: _round(totalObservationCost),
        totalCampaignCost: _round(totalCampaignCost),
        benchmarks,
        kpis: {
            elementCount: elements.length,
            elementsWithCost,
            campaignCount: campaigns.length,
            campaignsWithCost,
            observationCount,
            totalWellDepthMeters: _round(totalWellDepthMeters),
            uniqueParameterCount,
            avgCostPerElement: elementsWithCost > 0 ? _round(grandTotal / elementsWithCost) : 0,
            avgCostPerCampaign: campaignsWithCost > 0 ? _round(totalCampaignCost / campaignsWithCost) : 0,
        },
    };
}

// ----------------------------------------------------------------
// DRILL-DOWN FUNCTIONS
// ----------------------------------------------------------------

/**
 * Get detailed cost breakdown for a single element.
 * Retorna breakdown detalhado de custos de um elemento.
 *
 * @param {string} elementId
 * @returns {Object|null} { name, family, capex, opex, total, costsByYear, observationCosts }
 */
export function getCostByElement(elementId) {
    const elements = getAllElements() || [];
    const el = elements.find((e) => e.id === elementId);
    if (!el) return null;

    const costs = el.data?.costs || [];
    let capex = 0,
        opex = 0;
    const costsByYear = [];

    for (const entry of costs) {
        capex += entry.capexTotal || 0;
        opex += entry.opexTotal || 0;
        costsByYear.push({
            fiscalYear: entry.fiscalYear,
            capex: _round(entry.capexTotal || 0),
            opex: _round(entry.opexTotal || 0),
            total: _round(entry.total || 0),
            basis: entry.basis || 'estimate',
            items: entry.items || [],
        });
    }

    const observationCosts = [];
    if (Array.isArray(el.data?.observations)) {
        for (const o of el.data.observations) {
            if (o.cost && o.cost.total > 0) {
                observationCosts.push({
                    parameter: o.parameterId || o.parameter || 'unknown',
                    total: _round(o.cost.total),
                    source: o.cost.source || 'catalog',
                    items: o.cost.items || [],
                });
            }
        }
    }

    return {
        name: el.name || el.id,
        family: el.family || 'unknown',
        capex: _round(capex),
        opex: _round(opex),
        total: _round(capex + opex),
        costsByYear,
        observationCosts,
    };
}

/**
 * Get detailed cost breakdown for a single campaign.
 * Retorna breakdown detalhado de custos de uma campanha.
 *
 * @param {string} campaignId
 * @returns {Object|null} { name, date, total, items }
 */
export function getCostByCampaign(campaignId) {
    const campaigns = getAllCampaigns() || [];
    const camp = campaigns.find((c) => c.id === campaignId);
    if (!camp || !camp.costs) return null;

    return {
        name: camp.name || camp.id,
        date: camp.startDate || '',
        total: _round(camp.costs.total || 0),
        items: camp.costs.items || [],
        currency: camp.costs.currency || getCurrency(),
    };
}

/**
 * Project costs into future fiscal years using escalation rate.
 * Projeta custos para anos futuros usando taxa de escalação.
 *
 * @param {number} [horizonYears=5] - Number of years to project forward
 * @param {number} [escalationRate] - Annual escalation (default from catalog)
 * @returns {Array<{year, capex, opex, projected, cumulative}>}
 */
export function projectCosts(horizonYears = 5, escalationRate) {
    const rollup = buildCostRollup();
    const rate = escalationRate ?? getEscalationRate();
    const years = Object.keys(rollup.byFiscalYear)
        .map(Number)
        .sort((a, b) => a - b);

    if (years.length === 0) return [];

    // Use last known year's OPEX as base for projection
    const lastYear = years[years.length - 1];
    const lastEntry = rollup.byFiscalYear[lastYear];
    const baseOpex = lastEntry?.opex || 0;

    const projection = [];
    let cumulative = rollup.grandTotal;

    for (let i = 1; i <= horizonYears; i++) {
        const year = lastYear + i;
        const projectedOpex = _round(baseOpex * Math.pow(1 + rate, i));
        cumulative += projectedOpex;

        projection.push({
            year,
            capex: 0, // CAPEX tipicamente não recorre
            opex: projectedOpex,
            projected: true,
            cumulative: _round(cumulative),
        });
    }

    return projection;
}

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

/**
 * Build sorted timeline from byFiscalYear map with cumulative totals.
 * @param {Object} byFiscalYear
 * @returns {Array<{fiscalYear, capex, opex, total, cumulative}>}
 */
function _buildTimeline(byFiscalYear) {
    const years = Object.keys(byFiscalYear)
        .map(Number)
        .sort((a, b) => a - b);
    let cumulative = 0;

    return years.map((fy) => {
        const entry = byFiscalYear[fy];
        cumulative += entry.total;
        return {
            fiscalYear: fy,
            capex: _round(entry.capex),
            opex: _round(entry.opex),
            total: _round(entry.total),
            cumulative: _round(cumulative),
        };
    });
}

/**
 * Build cost center aggregation from element and campaign cost data.
 * Distribui custos por centros de custo usando tabela de alocacoes.
 *
 * @param {Object} byElement - Element cost map from L2
 * @param {Object} byCampaign - Campaign cost map from L3
 * @param {Array} elements - All elements
 * @param {Array} campaigns - All campaigns
 * @returns {Object} { [ccId]: { name, code, capex, opex, total, budget, variance, variancePct, sources } }
 */
function _buildCostCenterAggregation(byElement, byCampaign, elements, campaigns) {
    const ccList = getCostCenters();
    if (!ccList || ccList.length === 0) return {};

    const allAllocs = getAllAllocations();
    if (!allAllocs) return {};

    // Pre-build lookup: "sourceType:sourceId" → allocations[]
    const allocMap = new Map();
    for (const a of allAllocs) {
        const key = `${a.sourceType}:${a.sourceId}`;
        if (!allocMap.has(key)) allocMap.set(key, []);
        allocMap.get(key).push(a);
    }

    // Initialize accumulators
    const result = {};
    const _initCC = (ccId) => {
        if (result[ccId]) return;
        const cc = ccList.find((c) => c.id === ccId);
        result[ccId] = {
            name: cc?.name || ccId,
            code: cc?.code || '-',
            capex: 0,
            opex: 0,
            total: 0,
            budget: 0,
            variance: 0,
            variancePct: 0,
            sources: { elements: 0, campaigns: 0, wbs: 0, contracts: 0 },
        };
    };
    const _initUnassigned = () => {
        if (result['_unassigned']) return;
        result['_unassigned'] = {
            name: 'Unassigned',
            code: '-',
            capex: 0,
            opex: 0,
            total: 0,
            budget: 0,
            variance: 0,
            variancePct: 0,
            sources: { elements: 0, campaigns: 0, wbs: 0, contracts: 0 },
        };
    };

    // Distribute element costs (L2)
    for (const elId of Object.keys(byElement)) {
        const elCost = byElement[elId];
        const allocs = allocMap.get(`element:${elId}`);

        if (!allocs || allocs.length === 0) {
            _initUnassigned();
            result['_unassigned'].capex += elCost.capex;
            result['_unassigned'].opex += elCost.opex;
            result['_unassigned'].total += elCost.total;
            result['_unassigned'].sources.elements++;
            continue;
        }

        let allocatedPct = 0;
        for (const a of allocs) {
            _initCC(a.costCenterId);
            const frac = (a.percentage || 0) / 100;
            result[a.costCenterId].capex += _round(elCost.capex * frac);
            result[a.costCenterId].opex += _round(elCost.opex * frac);
            result[a.costCenterId].total += _round(elCost.total * frac);
            result[a.costCenterId].sources.elements++;
            allocatedPct += a.percentage || 0;
        }

        // Restante nao alocado
        if (allocatedPct < 100) {
            _initUnassigned();
            const remFrac = (100 - allocatedPct) / 100;
            result['_unassigned'].capex += _round(elCost.capex * remFrac);
            result['_unassigned'].opex += _round(elCost.opex * remFrac);
            result['_unassigned'].total += _round(elCost.total * remFrac);
            result['_unassigned'].sources.elements++;
        }
    }

    // Distribute campaign costs (L3)
    for (const campId of Object.keys(byCampaign)) {
        const campCost = byCampaign[campId];
        const allocs = allocMap.get(`campaign:${campId}`);

        if (!allocs || allocs.length === 0) {
            _initUnassigned();
            result['_unassigned'].total += campCost.total;
            result['_unassigned'].sources.campaigns++;
            continue;
        }

        let allocatedPct = 0;
        for (const a of allocs) {
            _initCC(a.costCenterId);
            const frac = (a.percentage || 0) / 100;
            result[a.costCenterId].total += _round(campCost.total * frac);
            result[a.costCenterId].sources.campaigns++;
            allocatedPct += a.percentage || 0;
        }

        if (allocatedPct < 100) {
            _initUnassigned();
            const remFrac = (100 - allocatedPct) / 100;
            result['_unassigned'].total += _round(campCost.total * remFrac);
            result['_unassigned'].sources.campaigns++;
        }
    }

    // Enrich with budget data (current fiscal year)
    const currentFY = new Date().getFullYear();
    for (const ccId of Object.keys(result)) {
        if (ccId === '_unassigned') continue;
        const budgetEntry = getBudget(ccId, currentFY);
        if (budgetEntry) {
            result[ccId].budget = budgetEntry.budgetTotal || 0;
            result[ccId].variance = _round(result[ccId].budget - result[ccId].total);
            result[ccId].variancePct =
                result[ccId].budget > 0 ? _round((result[ccId].variance / result[ccId].budget) * 100) : 0;
        }
        // Round totals
        result[ccId].capex = _round(result[ccId].capex);
        result[ccId].opex = _round(result[ccId].opex);
        result[ccId].total = _round(result[ccId].total);
    }

    // Round unassigned
    if (result['_unassigned']) {
        result['_unassigned'].capex = _round(result['_unassigned'].capex);
        result['_unassigned'].opex = _round(result['_unassigned'].opex);
        result['_unassigned'].total = _round(result['_unassigned'].total);
    }

    return result;
}

/**
 * Round to 2 decimal places.
 * @param {number} v
 * @returns {number}
 */
function _round(v) {
    return Math.round((v || 0) * 100) / 100;
}
