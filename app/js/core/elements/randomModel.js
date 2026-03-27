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

// ================================================================
// randomModel.js — Random Model Generation
// Geração de modelo aleatório com elementos distribuídos espacialmente
// ================================================================

import { addElement, clearAllElements, getAllElements, nextElementCounter } from './manager.js';
import { createIssue, SERVICE_TYPES } from '../issues/manager.js';
import { resetProfiles, createProfile, saveProfiles } from '../symbology/manager.js';
import { addCampaign, clearCampaigns } from '../campaigns/manager.js';
import { CONFIG } from '../../config.js';
import { relativeToUTM, utmToWGS84, wgs84ToUTM, setOrigin } from '../io/geo/coordinates.js';
import { addCorporateInput, addCorporateOutput, importCorporateIO, exportCorporateIO } from '../io/modelLink.js';
import { generateId } from '../../utils/helpers/id.js';
import {
    getCostCatalog,
    getAnalyticalPrice,
    buildObservationCost,
    buildElementCostEntry,
    buildCampaignCost,
} from '../ingestion/documents/costCatalog.js';

// ── Helpers module (GAC 67 params, well tiers, meteorology, financial) ──
import {
    rand,
    randInt,
    pick,
    gaussianRand,
    gaussianRange,
    shuffle,
    clamp as clampH,
    formatPrecision,
    yieldToUI,
    GAC_PARAMETERS,
    GAC_ALL_PARAMS,
    WELL_TIERS,
    TOTAL_WELLS,
    TIER_INTERMEDIATE_PARAMS,
    TIER_UPSTREAM_PARAMS,
    CONTAMINANT_PARAM_IDS as GAC_CONTAMINANT_IDS,
    generateCampaignDates,
    generateSiteMeteorology,
    varyCampaignMeteo,
    PASQUILL_CLASSES,
    generateWBS,
    generateContracts,
    generateProjectRegistry,
    randomCredentialLevel as helperCredentialLevel,
} from './randomHelpers.js';

// ----------------------------------------------------------------
// FUNCOES DE GERACAO ALEATORIA
// ----------------------------------------------------------------

// Faixas de parametros hidrogeologicos realistas
export const PARAMETER_RANGES = {
    // === PARÂMETROS HIDROGEOLÓGICOS EXISTENTES ===
    pH: { min: 5.5, max: 8.5, unitId: 'pH' },
    conductivity: { min: 100, max: 2000, unitId: 'uS_cm' },
    temperature: { min: 15, max: 25, unitId: 'celsius' },
    redox: { min: -400, max: 400, unitId: 'mV', category: 'chemical' },
    benzene: { min: 0.001, max: 5, unitId: 'ug_L', casNumber: '71-43-2' },
    toluene: { min: 0.1, max: 700, unitId: 'ug_L', casNumber: '108-88-3' },
    ethylbenzene: { min: 0.05, max: 300, unitId: 'ug_L', casNumber: '100-41-4' },
    xylenes: { min: 0.1, max: 500, unitId: 'ug_L', casNumber: '1330-20-7' },
    naphthalene: { min: 0.01, max: 60, unitId: 'ug_L', casNumber: '91-20-3' },
    tph: { min: 0.1, max: 100, unitId: 'mg_L' },
    btex: { min: 0.01, max: 50, unitId: 'ug_L' },
    voc: { min: 0.01, max: 20, unitId: 'ug_L' },
    water_level: { min: -15, max: -1, unitId: 'm' },
    flow_rate: { min: 0.1, max: 10, unitId: 'L_s' },

    // === NOVOS: EMISSÕES ATMOSFÉRICAS ===
    ghg_scope1: { min: 100, max: 50000, unitId: 'tCO2e', category: 'emission' },
    ghg_scope2: { min: 50, max: 20000, unitId: 'tCO2e', category: 'emission' },
    pm25: { min: 5, max: 150, unitId: 'ug_m3', category: 'air_quality' },
    pm10: { min: 10, max: 250, unitId: 'ug_m3', category: 'air_quality' },
    nox: { min: 10, max: 500, unitId: 'mg_Nm3', category: 'air_quality' },
    sox: { min: 5, max: 300, unitId: 'mg_Nm3', category: 'air_quality' },

    // === NOVOS: RESÍDUOS ===
    waste_total: { min: 10, max: 5000, unitId: 't', category: 'waste' },
    waste_hazardous: { min: 1, max: 500, unitId: 't', category: 'waste' },
    waste_recycled_pct: { min: 10, max: 95, unitId: 'percent', category: 'waste' },

    // === NOVOS: EFLUENTES ===
    effluent_flow: { min: 10, max: 5000, unitId: 'm3', category: 'effluent' },
    bod: { min: 5, max: 300, unitId: 'mg_L', category: 'effluent' },
    cod: { min: 10, max: 600, unitId: 'mg_L', category: 'effluent' },
    tss: { min: 5, max: 200, unitId: 'mg_L', category: 'effluent' },

    // === NOVOS: H&S ===
    frequency_rate: { min: 0, max: 15, unitId: 'per_1M_hh', category: 'safety' },
    severity_rate: { min: 0, max: 500, unitId: 'days_per_1M', category: 'safety' },
    ltir: { min: 0, max: 5, unitId: 'per_200k_hh', category: 'safety' },
    near_miss: { min: 0, max: 50, unitId: 'count', category: 'safety' },
    noise_exposure: { min: 65, max: 95, unitId: 'dBA', category: 'occupational' },

    // === NOVOS: BIODIVERSIDADE ===
    species_count: { min: 5, max: 200, unitId: 'count', category: 'biodiversity' },
    protected_area: { min: 1, max: 500, unitId: 'ha', category: 'biodiversity' },
    biodiversity_index: { min: 0.1, max: 1.0, unitId: 'score', category: 'biodiversity' },
};

// Parametros por familia
export const FAMILY_PARAMETERS = {
    // === FAMÍLIAS EXISTENTES ===
    well: [
        'pH',
        'conductivity',
        'temperature',
        'redox',
        'water_level',
        'benzene',
        'toluene',
        'ethylbenzene',
        'xylenes',
        'naphthalene',
        'tph',
        'btex',
        'voc',
    ],
    plume: ['benzene', 'toluene', 'ethylbenzene', 'xylenes', 'naphthalene', 'tph', 'btex', 'voc'],
    spring: ['temperature', 'flow_rate', 'pH', 'conductivity', 'redox'],
    sample: ['pH', 'conductivity', 'temperature', 'redox', 'benzene', 'toluene', 'xylenes', 'tph', 'voc'],
    lake: ['pH', 'temperature', 'conductivity'],
    river: ['pH', 'temperature', 'flow_rate'],
    tank: ['tph', 'benzene'],

    // === NOVAS FAMÍLIAS ESG ===
    emission_source: ['ghg_scope1', 'ghg_scope2', 'pm25', 'pm10', 'nox', 'sox'],
    waste_stream: ['waste_total', 'waste_hazardous', 'waste_recycled_pct'],
    effluent_point: ['effluent_flow', 'bod', 'cod', 'tss', 'pH', 'temperature'],
    area: ['frequency_rate', 'severity_rate', 'ltir', 'near_miss'],
    habitat: ['species_count', 'biodiversity_index', 'protected_area'],
    individual: ['noise_exposure'],
    sensor: ['temperature', 'pH', 'conductivity', 'water_level'],

    // === FAMILIAS ESPACIAIS / GIS ===
    blueprint: ['pH', 'conductivity', 'temperature', 'benzene', 'tph'],

    // === FAMILIAS INTANGIVEIS ===
    intangible: [],
    generic: [],
};

// Variaveis de contexto por familia — preenchidas automaticamente no modelo aleatorio
// Cada variavel armazena { value, unit }. Indica matriz ambiental e tipo de fracao.
const AD = 'adimensional'; // unidade padrao para flags booleanos e categorias
export const FAMILY_VARIABLES = {
    well: { is_matrix_water: { value: '1', unit: AD }, fraction: { value: 'dissolved', unit: AD } },
    spring: { is_matrix_water: { value: '1', unit: AD }, fraction: { value: 'total', unit: AD } },
    lake: { is_matrix_water: { value: '1', unit: AD }, fraction: { value: 'total', unit: AD } },
    river: { is_matrix_water: { value: '1', unit: AD }, fraction: { value: 'total', unit: AD } },
    plume: {
        is_matrix_water: { value: '1', unit: AD },
        is_matrix_soil: { value: '1', unit: AD },
        fraction: { value: 'total', unit: AD },
    },
    sample: {
        is_matrix_water: { value: '1', unit: AD },
        is_matrix_soil: { value: '1', unit: AD },
        fraction: { value: 'dissolved', unit: AD },
    },
    emission_source: { is_matrix_air: { value: '1', unit: AD } },
    effluent_point: { is_matrix_water: { value: '1', unit: AD }, fraction: { value: 'total', unit: AD } },
    habitat: { is_matrix_biota: { value: '1', unit: AD } },
    area: { is_matrix_human: { value: '1', unit: AD } },
    individual: { is_matrix_human: { value: '1', unit: AD } },
    tank: { is_matrix_soil: { value: '1', unit: AD }, fraction: { value: 'total', unit: AD } },
    waste_stream: { is_matrix_soil: { value: '1', unit: AD } },
    sensor: { is_matrix_water: { value: '1', unit: AD } },
    stratum: { is_matrix_geotechnical: { value: '1', unit: AD } },
    intangible: {},
    generic: {},
};

/**
 * Gera campanhas aleatorias nos ultimos 2 anos.
 */
function generateRandomCampaigns(count) {
    const campaigns = [];
    const now = new Date();
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());

    for (let i = 0; i < count; i++) {
        const randomTime = twoYearsAgo.getTime() + Math.random() * (now.getTime() - twoYearsAgo.getTime());
        const date = new Date(randomTime);
        campaigns.push({
            id: `campaign-${i + 1}`,
            name: `Campanha ${i + 1}`,
            date: date,
        });
    }
    return campaigns.sort((a, b) => a.date - b.date);
}

/**
 * Gera valor aleatorio para um parametro.
 */
function generateParameterValue(parameterId) {
    const range = PARAMETER_RANGES[parameterId];
    if (!range) return { value: Math.random() * 100, unitId: 'mg_L' };

    let value = range.min + Math.random() * (range.max - range.min);
    if (value < 0.1) value = Math.round(value * 10000) / 10000;
    else if (value < 10) value = Math.round(value * 100) / 100;
    else value = Math.round(value * 10) / 10;

    return { value, unitId: range.unitId };
}

/**
 * Retorna nivel de credencial aleatorio com distribuicao ponderada.
 * Simula equipe de campo com diferentes niveis academicos.
 */
const CREDENTIAL_WEIGHTS = [
    { level: 'common', weight: 50 },
    { level: 'professional', weight: 25 },
    { level: 'pos_graduado', weight: 12 },
    { level: 'mestre', weight: 8 },
    { level: 'doutor', weight: 5 },
];
const CREDENTIAL_TOTAL_WEIGHT = CREDENTIAL_WEIGHTS.reduce((s, w) => s + w.weight, 0);

function randomCredentialLevel() {
    let r = Math.random() * CREDENTIAL_TOTAL_WEIGHT;
    for (const { level, weight } of CREDENTIAL_WEIGHTS) {
        r -= weight;
        if (r <= 0) return level;
    }
    return 'common';
}

/**
 * Embaralha array (Fisher-Yates).
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Gera observacoes para um elemento.
 */
// Parametros de contaminacao — valores decrescem ao longo das campanhas (remediacao)
const CONTAMINANT_PARAMS = new Set([
    'benzene',
    'toluene',
    'ethylbenzene',
    'xylenes',
    'naphthalene',
    'tph',
    'btex',
    'voc',
    'bod',
    'cod',
    'tss',
]);

function generateObservations(familyId, position, campaigns) {
    const observations = [];
    const parameters = FAMILY_PARAMETERS[familyId] || ['pH', 'temperature'];

    // Seleciona parametros consistentes para todas as campanhas deste elemento
    const numParams = 1 + Math.floor(Math.random() * Math.min(3, parameters.length));
    const selectedParams = shuffleArray([...parameters]).slice(0, numParams);

    // Gera valor base por parametro — campanhas variam em torno desse valor
    const baseValues = {};
    selectedParams.forEach((pid) => {
        const { value, unitId } = generateParameterValue(pid);
        baseValues[pid] = { base: value, unitId };
    });

    campaigns.forEach((campaign, campIdx) => {
        const progress = campaigns.length > 1 ? campIdx / (campaigns.length - 1) : 0;

        selectedParams.forEach((parameterId) => {
            const { base, unitId } = baseValues[parameterId];
            let value;
            if (CONTAMINANT_PARAMS.has(parameterId)) {
                // Contaminantes decrescem 30-60% ao longo do tempo (remediacao)
                const decay = 1 - progress * (0.3 + Math.random() * 0.3);
                value = base * decay * (0.9 + Math.random() * 0.2);
            } else {
                // Demais parametros flutuam ±15% em torno do base
                value = base * (0.85 + Math.random() * 0.3);
            }
            // Formata precisao
            if (value < 0.1) value = Math.round(value * 10000) / 10000;
            else if (value < 10) value = Math.round(value * 100) / 100;
            else value = Math.round(value * 10) / 10;

            const isPlanned = Math.random() < 0.25;
            const dateStr = campaign.date.toISOString().slice(0, 10);
            const px = position.x || 0;
            const py = position.y || 0;
            const pz = position.z || 0;

            observations.push({
                id: generateId('obs'),
                showPlanning: isPlanned,
                plannedDate: isPlanned ? dateStr : null,
                plannedParameterId: isPlanned ? parameterId : null,
                plannedUnitId: isPlanned ? unitId : null,
                plannedX: isPlanned ? px : null,
                plannedY: isPlanned ? py : null,
                plannedZ: isPlanned ? pz : null,
                expectedValue: null,
                x: px,
                y: py,
                z: pz,
                date: dateStr,
                campaignId: campaign.id,
                parameterId,
                value,
                unitId,
                autoConvert: false,
                qualFields: [],
                additionalReadings: [],
                variables: { ...(FAMILY_VARIABLES[familyId] || {}) },
                credentialLevel: randomCredentialLevel(),
                createdBy: null,
                cost: buildObservationCost(parameterId),
            });
        });
    });
    return observations;
}

// ----------------------------------------------------------------
// CORRELATED DATA GENERATION — Physics-based training data for NN
// Geracao de dados correlacionados entre pocos e plumas para ML
//
// Modelo fisico simplificado:
// - Concentracao decai com distancia ao centro da pluma (lei inversa)
// - Pluma encolhe ao longo do tempo (remediacao progressiva)
// - Parametros hidrogeologicos influenciam tamanho da pluma
// - pH e redox correlacionados com contaminacao (biodegradacao)
// ----------------------------------------------------------------

/**
 * Calcula fator de atenuacao por distancia entre poco e pluma.
 * Lei de decaimento exponencial: C = C0 * exp(-k * d / R)
 * onde d = distancia, R = raio medio, k = fator de atenuacao.
 *
 * @param {Object} wellPos - { x, z } posicao do poco
 * @param {Object} plumeCenter - { x, z } centro da pluma
 * @param {number} avgRadius - raio medio da pluma (XZ plane)
 * @returns {number} fator 0-1 (1 = no centro, ~0 = muito longe)
 */
function _distanceAttenuation(wellPos, plumeCenter, avgRadius) {
    const dx = wellPos.x - plumeCenter.x;
    const dz = wellPos.z - plumeCenter.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const k = 1.5; // fator de decaimento
    return Math.exp((-k * dist) / Math.max(avgRadius, 1));
}

/**
 * Gera snapshots temporais de geometria da pluma (shrinking).
 * A pluma comeca no tamanho maximo e encolhe com remediacao.
 *
 * @param {Object} baseShape - { radiusX, radiusY, radiusZ }
 * @param {Object} baseCenter - { x, y, z }
 * @param {number} numSteps - numero de campanhas
 * @param {number} shrinkFactor - reducao total (0.3 = 30% menor no final)
 * @returns {Array<{ shape, center }>} snapshot por campanha
 */
function _generatePlumeTimeline(baseShape, baseCenter, numSteps, shrinkFactor) {
    const timeline = [];
    for (let i = 0; i < numSteps; i++) {
        const progress = numSteps > 1 ? i / (numSteps - 1) : 0;
        const scale = 1 - progress * shrinkFactor;
        // Pequena variacao estocastica por campanha (±5%)
        const jitter = () => 0.95 + Math.random() * 0.1;
        timeline.push({
            shape: {
                radiusX: baseShape.radiusX * scale * jitter(),
                radiusY: baseShape.radiusY * scale * jitter(),
                radiusZ: baseShape.radiusZ * scale * jitter(),
            },
            center: {
                x: baseCenter.x + (Math.random() - 0.5) * 2, // drift leve
                y: baseCenter.y,
                z: baseCenter.z + (Math.random() - 0.5) * 2,
            },
        });
    }
    return timeline;
}

/**
 * Gera observacoes correlacionadas para um poco vinculado a uma pluma.
 * Os valores de contaminacao refletem a distancia e o estado temporal da pluma.
 * Inclui tanto parametros hidrogeologicos quanto contaminantes.
 *
 * @param {Object} wellPos - { x, z } posicao do poco
 * @param {Array} plumeTimeline - snapshots da pluma por campanha
 * @param {Object} plumeCenter - { x, z } centro base da pluma
 * @param {Array} campaigns - campanhas ordenadas cronologicamente
 * @returns {Array} observacoes no formato padrao
 */
function generateCorrelatedWellObs(wellPos, plumeTimeline, plumeCenter, campaigns) {
    const observations = [];

    // Parametros hidrogeologicos base (flutuam levemente)
    const baseHydro = {
        pH: 5.5 + Math.random() * 3.0, // 5.5-8.5
        conductivity: 200 + Math.random() * 1500, // 200-1700 uS/cm
        temperature: 16 + Math.random() * 8, // 16-24 °C
        redox: -200 + Math.random() * 500, // -200 to 300 mV
        water_level: -12 + Math.random() * 10, // -12 to -2 m
    };

    // Contaminantes base — faixa alta, sera modulada pela distancia
    const baseCont = {
        benzene: 0.5 + Math.random() * 4.0, // 0.5-4.5 ug/L
        toluene: 50 + Math.random() * 500, // 50-550 ug/L
        ethylbenzene: 20 + Math.random() * 200, // 20-220 ug/L
        xylenes: 30 + Math.random() * 350, // 30-380 ug/L
        naphthalene: 5 + Math.random() * 40, // 5-45 ug/L
        tph: 10 + Math.random() * 80, // 10-90 mg/L
        btex: 1 + Math.random() * 40, // 1-41 ug/L
        voc: 0.5 + Math.random() * 15, // 0.5-15.5 ug/L
    };

    // Todos os parametros: hidro + contaminacao
    const allParams = [
        'pH',
        'conductivity',
        'temperature',
        'redox',
        'water_level',
        'benzene',
        'toluene',
        'ethylbenzene',
        'xylenes',
        'naphthalene',
        'tph',
        'btex',
        'voc',
    ];

    campaigns.forEach((campaign, campIdx) => {
        const snap = plumeTimeline[campIdx];
        if (!snap) return;

        // Raio medio no plano XZ para calculo de atenuacao
        const avgR = (snap.shape.radiusX + snap.shape.radiusY) / 2;
        const attenuation = _distanceAttenuation(wellPos, plumeCenter, avgR);

        allParams.forEach((parameterId) => {
            let value;
            const range = PARAMETER_RANGES[parameterId];
            if (!range) return;

            if (CONTAMINANT_PARAMS.has(parameterId)) {
                // Contaminante: base * atenuacao por distancia * escala temporal
                const base = baseCont[parameterId] || 1;
                value = base * attenuation;
                // Adiciona ruido gaussiano (±10%)
                value *= 0.9 + Math.random() * 0.2;
            } else if (parameterId === 'pH') {
                // pH mais acido perto da pluma (biodegradacao produz acidos)
                // pH base - atenuacao * 1.5 (agua contaminada tende a pH ~5-6)
                value = baseHydro.pH - attenuation * 1.5 * (0.9 + Math.random() * 0.2);
            } else if (parameterId === 'redox') {
                // Redox mais negativo perto da pluma (reducao por atividade microbiana)
                value = baseHydro.redox - attenuation * 300 * (0.9 + Math.random() * 0.2);
            } else if (parameterId === 'conductivity') {
                // Condutividade maior perto da pluma (ions dissolvidos)
                value = baseHydro.conductivity * (1 + attenuation * 0.8) * (0.9 + Math.random() * 0.2);
            } else {
                // Demais parametros: flutuacao leve ±10%
                value = (baseHydro[parameterId] || 10) * (0.9 + Math.random() * 0.2);
            }

            // Clampa ao range fisico
            value = Math.max(range.min, Math.min(range.max, value));

            // Formata precisao
            if (value < 0.1) value = Math.round(value * 10000) / 10000;
            else if (value < 10) value = Math.round(value * 100) / 100;
            else value = Math.round(value * 10) / 10;

            const isPlanned = Math.random() < 0.25;
            const dateStr = campaign.date.toISOString().slice(0, 10);
            const wx = wellPos.x || 0;
            const wy = wellPos.y || 0;
            const wz = wellPos.z || 0;

            observations.push({
                id: generateId('obs'),
                showPlanning: isPlanned,
                plannedDate: isPlanned ? dateStr : null,
                plannedParameterId: isPlanned ? parameterId : null,
                plannedUnitId: isPlanned ? range.unitId : null,
                plannedX: isPlanned ? wx : null,
                plannedY: isPlanned ? wy : null,
                plannedZ: isPlanned ? wz : null,
                expectedValue: null,
                x: wx,
                y: wy,
                z: wz,
                date: dateStr,
                campaignId: campaign.id,
                parameterId,
                value,
                unitId: range.unitId,
                autoConvert: false,
                qualFields: [],
                additionalReadings: [],
                variables: { ...(FAMILY_VARIABLES.well || {}) },
                credentialLevel: randomCredentialLevel(),
                createdBy: null,
                cost: buildObservationCost(parameterId),
            });
        });
    });
    return observations;
}

/**
 * Gera observacoes correlacionadas para a propria pluma.
 * Contaminantes na pluma acompanham o encolhimento (remediacao).
 *
 * @param {Array} plumeTimeline - snapshots da pluma por campanha
 * @param {Object} baseCenter - { x, y, z }
 * @param {Array} campaigns
 * @returns {Array} observacoes
 */
function generateCorrelatedPlumeObs(plumeTimeline, baseCenter, campaigns) {
    const observations = [];
    const parameters = FAMILY_PARAMETERS.plume || ['benzene', 'tph', 'btex', 'voc'];

    // Valores base de contaminacao na pluma (altos — e a fonte)
    const baseValues = {};
    parameters.forEach((pid) => {
        const range = PARAMETER_RANGES[pid];
        if (range) {
            // Comeca na faixa alta do range (70-95% do maximo)
            baseValues[pid] = { base: range.max * (0.7 + Math.random() * 0.25), unitId: range.unitId };
        }
    });

    campaigns.forEach((campaign, campIdx) => {
        const snap = plumeTimeline[campIdx];
        if (!snap) return;

        // Fator de escala baseado no volume da pluma (raioX * raioY * raioZ)
        const baseVol =
            plumeTimeline[0].shape.radiusX * plumeTimeline[0].shape.radiusY * plumeTimeline[0].shape.radiusZ;
        const curVol = snap.shape.radiusX * snap.shape.radiusY * snap.shape.radiusZ;
        const volRatio = baseVol > 0 ? curVol / baseVol : 1;

        parameters.forEach((parameterId) => {
            const entry = baseValues[parameterId];
            if (!entry) return;
            const range = PARAMETER_RANGES[parameterId];
            if (!range) return;

            // Contaminacao proporcional ao volume da pluma + ruido
            let value = entry.base * volRatio * (0.9 + Math.random() * 0.2);
            value = Math.max(range.min, Math.min(range.max, value));

            if (value < 0.1) value = Math.round(value * 10000) / 10000;
            else if (value < 10) value = Math.round(value * 100) / 100;
            else value = Math.round(value * 10) / 10;

            const isPlanned = Math.random() < 0.25;
            const dateStr = campaign.date.toISOString().slice(0, 10);

            observations.push({
                id: generateId('obs'),
                showPlanning: isPlanned,
                plannedDate: isPlanned ? dateStr : null,
                plannedParameterId: isPlanned ? parameterId : null,
                plannedUnitId: isPlanned ? entry.unitId : null,
                plannedX: isPlanned ? snap.center.x : null,
                plannedY: isPlanned ? snap.center.y : null,
                plannedZ: isPlanned ? snap.center.z : null,
                expectedValue: null,
                x: snap.center.x,
                y: snap.center.y,
                z: snap.center.z,
                date: dateStr,
                campaignId: campaign.id,
                parameterId,
                value,
                unitId: entry.unitId,
                autoConvert: false,
                qualFields: [],
                additionalReadings: [],
                variables: { ...(FAMILY_VARIABLES.plume || {}) },
                credentialLevel: randomCredentialLevel(),
                createdBy: null,
                cost: buildObservationCost(parameterId),
            });
        });
    });
    return observations;
}

/**
 * Analisa features detectadas por reconhecimento de imagem e calcula centroides de zona.
 * Retorna null se a deteccao nao produziu diversidade suficiente (fallback para zonas fixas).
 *
 * @param {Array<Object>} features - DetectedFeature[] de analyzeByColor
 * @param {Object} extent - { minX, maxX, minZ, maxZ } em coordenadas de cena
 * @returns {Object|null} { industrial, water, natural, monitoring } ou null
 */
function _computeZoneCentroids(features) {
    if (!features || features.length === 0) return null;

    const groups = { building: [], water: [], vegetation: [], soil: [] };
    for (const f of features) {
        if (['building', 'tank'].includes(f.family)) groups.building.push(f);
        else if (['lake', 'river'].includes(f.family)) groups.water.push(f);
        else if (f.family === 'habitat') groups.vegetation.push(f);
        else groups.soil.push(f);
    }

    // Diversidade: <3 categorias com features OU >70% dominante → fallback
    const total = features.length;
    const populated = Object.values(groups).filter((g) => g.length > 0).length;
    const maxPct = Math.max(...Object.values(groups).map((g) => g.length)) / total;
    if (populated < 3 || maxPct > 0.7) return null;

    const centroid = (arr) => {
        if (arr.length === 0) return null;
        let sx = 0,
            sz = 0,
            sw = 0;
        for (const f of arr) {
            const w = f.confidence || 0.5;
            sx += f.position.x * w;
            sz += f.position.z * w;
            sw += w;
        }
        return { x: sx / sw, z: sz / sw };
    };

    return {
        industrial: centroid(groups.building),
        water: centroid(groups.water),
        natural: centroid(groups.vegetation),
        monitoring: centroid(groups.soil),
    };
}

/**
 * Terreno sintetico procedural (3 octaves, 0-20m variacao).
 * Zero CDN — funciona 100% offline.
 *
 * @param {number} x - Coordenada X de cena
 * @param {number} z - Coordenada Z de cena
 * @param {number} halfW - Metade da largura do boundary
 * @param {number} halfL - Metade do comprimento do boundary
 * @returns {number} Elevacao do terreno em metros
 */
function _syntheticTerrainElevation(x, z, halfW, halfL) {
    const nx = x / halfW,
        nz = z / halfL;
    // Offset +15m garante elevacao sempre positiva (range final ~1-29m)
    return (
        15 +
        8 * Math.sin(nx * Math.PI * 0.7) * Math.cos(nz * Math.PI * 0.5) +
        4 * Math.sin(nx * 2.3 + 0.7) * Math.cos(nz * 1.9 + 0.4) +
        2 * Math.sin(nx * 4.1 + 1.2) * Math.cos(nz * 3.7 + 0.8)
    );
}

/**
 * Nivel d'agua sintetico — raso perto de corpos d'agua, profundo longe.
 *
 * @param {number} terrainY - Elevacao do terreno
 * @param {number} distToWater - Distancia ao corpo d'agua mais proximo (m)
 * @returns {number} Elevacao do nivel d'agua (metros, abaixo do terreno)
 */
function _syntheticWaterTable(terrainY, distToWater) {
    const baseDepth = 3 + 9 * Math.min(1, distToWater / 200);
    return terrainY - baseDepth;
}

/**
 * Seed purchases/supplies and sales/deliveries for Project > Corporate I/O.
 * Gera transacoes corporativas vinculadas a elementos e campanhas do modelo random.
 *
 * @param {Array<{id:string,date:Date}>} campaigns
 * @param {Array<Object>} contracts
 */
function _seedCorporateIO(campaigns, contracts) {
    // Garante idempotencia em re-execucoes do random no mesmo runtime
    importCorporateIO({ inputs: [], outputs: [] });

    const elements = getAllElements();
    const campaignIds = (campaigns || []).map((c) => c.id).filter(Boolean);
    const campaignTimes = (campaigns || [])
        .map((c) => (c?.date instanceof Date ? c.date.getTime() : NaN))
        .filter(Number.isFinite);

    const now = Date.now();
    const minTs = campaignTimes.length > 0 ? Math.min(...campaignTimes) : now - 180 * 86400000;
    const maxTs = campaignTimes.length > 0 ? Math.max(...campaignTimes) : now;

    const pickCampaignId = () => (campaignIds.length > 0 ? pick(campaignIds) : null);
    const pickDateISO = () => new Date(rand(minTs, Math.max(minTs + 1, maxTs))).toISOString().slice(0, 10);
    const pickContractId = () => (Array.isArray(contracts) && contracts.length > 0 ? pick(contracts).id : null);
    const pickLinkedElementIds = (families = []) => {
        const pool = families.length > 0 ? elements.filter((e) => families.includes(e.family)) : elements;
        if (pool.length === 0) return [];
        const amount = randInt(1, Math.min(3, pool.length));
        return shuffle([...pool])
            .slice(0, amount)
            .map((e) => e.id);
    };
    const mkInvoiceRef = (prefix) => `${prefix}-${new Date().getFullYear()}-${randInt(1000, 9999)}`;

    const inputTemplates = [
        {
            category: 'drilling',
            description: 'Sondagem e instalacao de pocos de monitoramento',
            unit: 'm',
            qty: [180, 950],
            unitCost: [95, 260],
            supplier: 'GeoSonda Ltda',
            families: ['well', 'stratum'],
        },
        {
            category: 'lab_services',
            description: 'Analises laboratoriais de BTEX, TPH e metais',
            unit: 'test',
            qty: [40, 420],
            unitCost: [55, 190],
            supplier: 'LabAnalitica S.A.',
            families: ['well', 'sample', 'plume', 'effluent_point'],
        },
        {
            category: 'equipment',
            description: 'Aquisicao e manutencao de sensores de campo',
            unit: 'un',
            qty: [3, 22],
            unitCost: [1800, 12500],
            supplier: 'SensorNet IoT',
            families: ['sensor', 'well', 'river', 'lake'],
        },
        {
            category: 'logistics',
            description: 'Logistica de campanha e transporte de amostras',
            unit: 'visit',
            qty: [8, 60],
            unitCost: [120, 980],
            supplier: 'EcoLog Transporte',
            families: ['sample', 'well', 'river', 'spring'],
        },
        {
            category: 'consulting_in',
            description: 'Consultoria tecnica especializada em remediacao',
            unit: 'hr',
            qty: [40, 320],
            unitCost: [180, 520],
            supplier: 'EcoConsult Amb.',
            families: ['plume', 'tank', 'area', 'incident'],
        },
        {
            category: 'ppe',
            description: 'EPIs para equipe de campo e laboratorio',
            unit: 'un',
            qty: [25, 260],
            unitCost: [35, 210],
            supplier: 'SafeWork Equipamentos',
            families: ['area', 'individual', 'well'],
        },
        {
            category: 'fuel',
            description: 'Combustivel para deslocamento em campanhas',
            unit: 'L',
            qty: [300, 3500],
            unitCost: [4.5, 8.5],
            supplier: 'Posto Integrado',
            families: ['well', 'sample', 'river', 'spring'],
        },
    ];

    const outputTemplates = [
        {
            category: 'monitoring',
            description: 'Servico de monitoramento ambiental recorrente',
            unit: 'month',
            qty: [3, 18],
            unitCost: [3800, 18000],
            client: 'Cliente Industrial Alpha',
            families: ['well', 'plume', 'sensor'],
        },
        {
            category: 'report',
            description: 'Entrega de relatorios tecnicos e compliance',
            unit: 'un',
            qty: [2, 14],
            unitCost: [2500, 14000],
            client: 'Cliente Regulatorio Beta',
            families: ['area', 'incident', 'habitat'],
        },
        {
            category: 'consulting_out',
            description: 'Consultoria EHS para plano de acao corretivo',
            unit: 'hr',
            qty: [30, 280],
            unitCost: [280, 920],
            client: 'Cliente Energia Gamma',
            families: ['tank', 'emission_source', 'waste_stream', 'effluent_point'],
        },
        {
            category: 'remediation',
            description: 'Projeto e acompanhamento de remediacao',
            unit: 'day',
            qty: [10, 120],
            unitCost: [1200, 6200],
            client: 'Cliente Petro Delta',
            families: ['plume', 'well', 'tank'],
        },
        {
            category: 'certificate',
            description: 'Emissao de laudo e certificado ambiental',
            unit: 'un',
            qty: [1, 10],
            unitCost: [1800, 9500],
            client: 'Cliente Publico Omega',
            families: ['habitat', 'area', 'river', 'lake'],
        },
        {
            category: 'training',
            description: 'Treinamento de equipe para protocolos de campo',
            unit: 'day',
            qty: [2, 20],
            unitCost: [1200, 5400],
            client: 'Cliente Mineracao Sigma',
            families: ['individual', 'area', 'incident'],
        },
    ];

    const selectedInputs = shuffle([...inputTemplates]).slice(0, randInt(4, 6));
    selectedInputs.forEach((tpl) => {
        addCorporateInput({
            category: tpl.category,
            description: tpl.description,
            quantity: Math.round(rand(tpl.qty[0], tpl.qty[1]) * 10) / 10,
            unit: tpl.unit,
            unitCost: Math.round(rand(tpl.unitCost[0], tpl.unitCost[1]) * 100) / 100,
            currency: 'BRL',
            date: pickDateISO(),
            supplier: tpl.supplier,
            invoiceRef: mkInvoiceRef('NF-IN'),
            status: pick(['completed', 'completed', 'in_progress', 'planned']),
            notes: 'Item gerado automaticamente no random model',
            linkedElementIds: pickLinkedElementIds(tpl.families),
            linkedCampaignId: pickCampaignId(),
            linkedContractId: pickContractId(),
        });
    });

    const selectedOutputs = shuffle([...outputTemplates]).slice(0, randInt(3, 5));
    selectedOutputs.forEach((tpl) => {
        addCorporateOutput({
            category: tpl.category,
            description: tpl.description,
            quantity: Math.round(rand(tpl.qty[0], tpl.qty[1]) * 10) / 10,
            unit: tpl.unit,
            unitCost: Math.round(rand(tpl.unitCost[0], tpl.unitCost[1]) * 100) / 100,
            currency: 'BRL',
            date: pickDateISO(),
            supplier: tpl.client,
            invoiceRef: mkInvoiceRef('NF-OUT'),
            status: pick(['completed', 'completed', 'in_progress', 'planned']),
            notes: 'Item gerado automaticamente no random model',
            linkedElementIds: pickLinkedElementIds(tpl.families),
            linkedCampaignId: pickCampaignId(),
            linkedContractId: pickContractId(),
        });
    });
}

/**
 * Gera modelo aleatorio para demonstracao.
 * Cria todas as familias de elementos com observacoes.
 * @param {Set<string>|null} includeFamilies - Familias a incluir (null = todas)
 * @returns {Object} Campanhas geradas para uso no main.js
 */
export async function generateRandomModel(includeFamilies = null) {
    // Limpa modelo atual
    clearAllElements();

    // Filtro de familias — se null gera tudo (backward compatible)
    const include =
        includeFamilies ||
        new Set([
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
        ]);

    // Aliases locais para legibilidade (importados de randomHelpers.js)
    const randRange = rand;
    const randChoice = pick;

    // Gerar 20 campanhas com padrão temporal realista (mensal→trimestral→semestral)
    const campaigns = generateCampaignDates();
    const numCampaigns = campaigns.length;

    // Meteorologia base do site (usada por plumas aéreas)
    const siteMeteo = generateSiteMeteorology();

    // Configuracoes de profundidade para plumas
    const plumeDepths = [
        { level: 'shallow', top: 0, bottom: -15, yCenter: -7.5 },
        { level: 'middle', top: -15, bottom: -40, yCenter: -27.5 },
        { level: 'deep', top: -40, bottom: -80, yCenter: -60 },
    ];

    // Hierarquia espacial (containers) para organizar o modelo
    let siteProjectId = null;
    const siteAreaIds = [];
    const siteZoneIds = [];
    const getSpatialParentId = () => siteZoneIds[0] || siteAreaIds[0] || siteProjectId || null;

    if (include.has('site_project')) {
        siteProjectId = 'site-project-main';
        addElement('site_project', siteProjectId, 'Projeto (Site)', {
            code: `SITE-${randInt(100, 999)}`,
            country: randChoice(['BR', 'US', 'MX', 'AR', 'CL']),
            status: 'active',
        });
    }

    if (include.has('site_area')) {
        const areaDefs = [
            { id: 'site-area-invest', name: 'Area de Investigacao' },
            { id: 'site-area-oper', name: 'Area Operacional' },
        ];
        areaDefs.forEach((a, i) => {
            addElement(
                'site_area',
                a.id,
                a.name,
                {
                    areaType: i === 0 ? 'investigation' : 'operations',
                },
                {
                    hierarchy: { parentId: siteProjectId, order: i },
                },
            );
            siteAreaIds.push(a.id);
        });
    }

    if (include.has('site_zone')) {
        const zoneDefs = [
            { id: 'site-zone-ind', name: 'Zona Industrial', parent: siteAreaIds[1] || siteAreaIds[0] || siteProjectId },
            {
                id: 'site-zone-mon',
                name: 'Zona de Monitoramento',
                parent: siteAreaIds[0] || siteAreaIds[1] || siteProjectId,
            },
            { id: 'site-zone-nat', name: 'Zona Natural', parent: siteAreaIds[0] || siteAreaIds[1] || siteProjectId },
        ];
        zoneDefs.forEach((z, i) => {
            addElement(
                'site_zone',
                z.id,
                z.name,
                {
                    zoneType: i === 0 ? 'industrial' : i === 1 ? 'monitoring' : 'natural',
                },
                {
                    hierarchy: { parentId: z.parent || null, order: i },
                },
            );
            siteZoneIds.push(z.id);
        });
    }

    // Helper: resolve zona-pai adequada para cada familia de elemento
    // Mapeamento semantico baseado no centro espacial usado por cada familia
    const zoneForFamily = (family) => {
        const industrial = ['building', 'tank', 'emission_source', 'waste_stream', 'area'];
        const monitoring = ['well', 'plume', 'sample', 'marker', 'sensor'];
        const natural = ['lake', 'river', 'spring', 'effluent_point', 'habitat'];
        if (industrial.includes(family)) return siteZoneIds[0] || siteAreaIds[1] || siteProjectId || null;
        if (monitoring.includes(family)) return siteZoneIds[1] || siteAreaIds[0] || siteProjectId || null;
        if (natural.includes(family)) return siteZoneIds[2] || siteAreaIds[0] || siteProjectId || null;
        return siteProjectId || null;
    };
    // Contador de ordem por zona para manter siblings ordenados
    const _zoneOrder = {};
    const nextZoneOrder = (family) => {
        const zid = zoneForFamily(family);
        if (!zid) return 0;
        _zoneOrder[zid] = (_zoneOrder[zid] || 0) + 1;
        return _zoneOrder[zid];
    };
    // Shorthand: retorna meta com hierarchy para uma familia
    const hMeta = (family) => {
        const pid = zoneForFamily(family);
        return pid ? { hierarchy: { parentId: pid, order: nextZoneOrder(family) } } : {};
    };

    // ================================================================
    // 1. BOUNDARY (1 - define area de estudo com imagem aérea)
    // Gera coordenadas aleatorias em regioes continentais do mundo
    // e configura origem UTM + overlay ESRI World Imagery
    // ================================================================
    const _boundaryEc = nextElementCounter();
    const halfWidth = randRange(150, 300);
    const halfLength = randRange(150, 300);
    // Fator de escala para posicionar elementos dentro do boundary
    // Referencia: boundary antigo era ~30m, agora ~200m → escala ~6x
    const S = Math.min(halfWidth, halfLength) / 30;

    // Locais com imagens aereas ricas (areas urbanas/industriais, portos, aeroportos)
    // Cada ponto recebe jitter de ±0.02° (~2km) para variar posicoes
    const AERIAL_LOCATIONS = [
        { lat: -23.55, lon: -46.63 }, // São Paulo - Zona Industrial
        { lat: -22.91, lon: -43.17 }, // Rio de Janeiro - Centro
        { lat: -19.92, lon: -43.94 }, // Belo Horizonte - Pampulha
        { lat: -25.43, lon: -49.27 }, // Curitiba - CIC Industrial
        { lat: -29.97, lon: -51.18 }, // Porto Alegre - Refinaria
        { lat: -12.97, lon: -38.51 }, // Salvador - Porto
        { lat: 40.71, lon: -74.0 }, // New York - Manhattan
        { lat: 34.05, lon: -118.24 }, // Los Angeles - Downtown
        { lat: 29.76, lon: -95.37 }, // Houston - Refinarias
        { lat: 51.51, lon: -0.12 }, // Londres - Thames
        { lat: 48.86, lon: 2.35 }, // Paris - Centro
        { lat: 52.52, lon: 13.41 }, // Berlim
        { lat: 35.68, lon: 139.69 }, // Tóquio - Porto
        { lat: 31.23, lon: 121.47 }, // Xangai - Pudong
        { lat: 22.3, lon: 114.17 }, // Hong Kong
        { lat: -33.87, lon: 151.21 }, // Sydney - Porto
        { lat: 1.35, lon: 103.82 }, // Singapura - Jurong
        { lat: 25.2, lon: 55.27 }, // Dubai
        { lat: 19.43, lon: -99.13 }, // Cidade do México
        { lat: -34.6, lon: -58.38 }, // Buenos Aires - Porto
    ];
    const loc = randChoice(AERIAL_LOCATIONS);
    const rndLat = loc.lat + randRange(-0.02, 0.02);
    const rndLon = loc.lon + randRange(-0.02, 0.02);

    // Configura origem UTM a partir das coordenadas aleatorias
    const utm = wgs84ToUTM({ latitude: rndLat, longitude: rndLon });
    setOrigin({
        easting: utm.easting,
        northing: utm.northing,
        elevation: 0,
        zone: utm.zone,
        hemisphere: utm.hemisphere,
    });

    // Preenche campos da UI se existirem
    const eastingEl = document.getElementById('utm-origin-easting');
    const northingEl = document.getElementById('utm-origin-northing');
    if (eastingEl) eastingEl.value = utm.easting.toFixed(2);
    if (northingEl) northingEl.value = utm.northing.toFixed(2);

    // Tile stitching via Sentinel-2 Cloudless (substituiu ESRI/Google/Bing)
    const { stitchTiles, stitchTilesWithProvider } = await import('../io/geo/tileStitcher.js');
    const sw = utmToWGS84(relativeToUTM({ x: -halfWidth, y: 0, z: halfLength }));
    const ne = utmToWGS84(relativeToUTM({ x: halfWidth, y: 0, z: -halfLength }));
    const extentM = Math.max(halfWidth, halfLength) * 2;
    const imgSize = Math.min(256, Math.max(128, Math.floor(extentM / 2)));
    // Usa provider preferido do usuario se configurado
    const _storedProvider = localStorage.getItem('ecbyts-tile-provider');
    const _providerIdx = _storedProvider != null ? parseInt(_storedProvider, 10) : null;
    const overlayUrl =
        _providerIdx != null && Number.isFinite(_providerIdx)
            ? await stitchTilesWithProvider(_providerIdx, sw, ne, imgSize)
            : await stitchTiles(sw, ne, imgSize);
    const overlayFallbackUrls = [];

    // Reconhecimento de cobertura do solo na imagem aerea (zero CDN, ~100ms)
    const extent = { minX: -halfWidth, maxX: halfWidth, minZ: -halfLength, maxZ: halfLength };
    let detectedZones = null;
    let detectedFeatures = [];
    if (overlayUrl) {
        try {
            const { analyzeByColor } = await import('../recognition/colorAnalysis.js');
            detectedFeatures = (await analyzeByColor(overlayUrl, extent)) || [];
            detectedZones = _computeZoneCentroids(detectedFeatures);
        } catch (e) {
            console.warn('[random] analyzeByColor skipped:', e.message);
        }
    }

    if (include.has('boundary')) {
        const boundaryMeta = {};
        // Boundary e o container espacial principal — parenta ao project, nao a zone
        const boundaryParentId = siteProjectId || null;
        if (boundaryParentId) boundaryMeta.hierarchy = { parentId: boundaryParentId, order: 0 };
        addElement(
            'boundary',
            `boundary-${_boundaryEc}`,
            'Área de Estudo',
            {
                vertices: [
                    { x: -halfWidth, y: 0, z: -halfLength },
                    { x: halfWidth, y: 0, z: -halfLength },
                    { x: halfWidth, y: 0, z: halfLength },
                    { x: -halfWidth, y: 0, z: halfLength },
                ],
                type: 'study_area',
                overlayUrl,
                overlayFallbackUrls,
                overlayOpacity: 0.85,
                sourceLat: rndLat,
                sourceLon: rndLon,
            },
            boundaryMeta,
        );
    }

    // ================================================================
    // 2. STRATA (camadas geologicas do CONFIG)
    // ================================================================
    if (include.has('stratum') && CONFIG.STRATA && CONFIG.STRATA.length > 0) {
        CONFIG.STRATA.forEach((stratum) => {
            addElement(
                'stratum',
                `stratum-${stratum.id}`,
                stratum.name,
                {
                    layer: { id: stratum.id, top: stratum.top, bottom: stratum.bottom },
                    color: stratum.color,
                    extent: { width: halfWidth * 2, depth: halfLength * 2 },
                },
                { hierarchy: { parentId: siteProjectId || null, order: 0 } },
            );
        });
    }

    // ================================================================
    // ZONAS ESPACIAIS — layout coerente do site
    // Se reconhecimento detectou zonas na imagem, usa centroides reais.
    // Senao, fallback para layout fixo NW/center/SE.
    // ================================================================
    const industrialCenter = detectedZones?.industrial || { x: -halfWidth * 0.35, z: -halfLength * 0.35 };
    const monitoringCenter = detectedZones?.monitoring || { x: halfWidth * 0.1, z: halfLength * 0.1 };
    const naturalCenter = detectedZones?.natural ||
        detectedZones?.water || { x: halfWidth * 0.35, z: halfLength * 0.35 };
    const zoneSpread = Math.min(halfWidth, halfLength) * 0.25;

    // Helper: posicao jittered dentro de uma zona
    const inZone = (center, spread) => ({
        x: center.x + randRange(-spread, spread),
        z: center.z + randRange(-spread, spread),
    });
    // Clamp dentro do boundary
    const clamp = (v, limit) => Math.max(-limit * 0.9, Math.min(limit * 0.9, v));

    // ================================================================
    // 2b. BLUEPRINTS (1-2 footprints CAD/GIS sinteticos)
    // ================================================================
    if (include.has('blueprint')) {
        const numBlueprints = randInt(1, 2);
        const categories = ['industrial', 'urban', 'mixed', 'agricultural'];
        for (let i = 0; i < numBlueprints; i++) {
            const _ec = nextElementCounter();
            const anchor = i % 2 === 0 ? industrialCenter : monitoringCenter;
            const pos = inZone(anchor, zoneSpread * 0.6);
            const width = randRange(35, 120);
            const length = randRange(25, 90);
            const blueprintPos = { x: pos.x, y: 0, z: pos.z };
            const parentId = getSpatialParentId();
            const blueprintMeta = parentId ? { hierarchy: { parentId, order: i + 1 } } : {};

            addElement(
                'blueprint',
                `blueprint-${_ec}`,
                `Blueprint ${i + 1}`,
                {
                    category: randChoice(categories),
                    crs_source: `UTM-${utm.zone}${utm.hemisphere}`,
                    area_m2: Math.round(width * length * 10) / 10,
                    vertices: [
                        { x: pos.x - width / 2, z: pos.z - length / 2 },
                        { x: pos.x + width / 2, z: pos.z - length / 2 },
                        { x: pos.x + width / 2, z: pos.z + length / 2 },
                        { x: pos.x - width / 2, z: pos.z + length / 2 },
                    ],
                    observations: generateObservations('blueprint', blueprintPos, campaigns),
                },
                blueprintMeta,
            );
        }
    }

    // ================================================================
    // 3. BUILDINGS (2-4, zona industrial, dimensoes absolutas)
    // Gera edificacoes industriais/comerciais com tamanhos realistas
    // ================================================================
    const buildingPositions = [];
    if (include.has('building')) {
        const BUILDING_PRESETS = {
            industrial: {
                names: ['Galpão Industrial', 'Oficina', 'Área de Processo'],
                w: [20, 40],
                l: [25, 60],
                h: [6, 15],
            },
            commercial: {
                names: ['Escritório', 'Portaria', 'Centro Administrativo'],
                w: [10, 25],
                l: [15, 35],
                h: [4, 10],
            },
            residential: { names: ['Almoxarifado', 'Depósito', 'Guarita'], w: [8, 15], l: [10, 20], h: [3, 6] },
        };
        const numBuildings = randInt(2, 4);
        for (let i = 0; i < numBuildings; i++) {
            const _ec = nextElementCounter();
            const bType = i === 0 ? 'industrial' : randChoice(['industrial', 'commercial', 'residential']);
            const bp = BUILDING_PRESETS[bType];
            const pos = inZone(industrialCenter, zoneSpread);
            // Se deteccao encontrou building com dimensoes, usar como referencia
            const detBldg = detectedFeatures.find((f) => f.family === 'building' && f.confidence > 0.6 && f.dimensions);
            const scaleX = extent.maxX - extent.minX;
            const scaleZ = extent.maxZ - extent.minZ;
            const w = detBldg?.dimensions?.width
                ? Math.max(
                      bp.w[0],
                      Math.min(bp.w[1] * 1.5, detBldg.dimensions.width * scaleX * (0.8 + Math.random() * 0.4)),
                  )
                : randRange(bp.w[0], bp.w[1]);
            const l = detBldg?.dimensions?.length
                ? Math.max(
                      bp.l[0],
                      Math.min(bp.l[1] * 1.5, detBldg.dimensions.length * scaleZ * (0.8 + Math.random() * 0.4)),
                  )
                : randRange(bp.l[0], bp.l[1]);
            const h = randRange(bp.h[0], bp.h[1]);
            const groundY = _syntheticTerrainElevation(pos.x, pos.z, halfWidth, halfLength);
            buildingPositions.push({ x: pos.x, z: pos.z, h, w, l });
            addElement(
                'building',
                `building-${_ec}`,
                `${randChoice(bp.names)}`,
                {
                    position: { x: pos.x, y: groundY, z: pos.z },
                    footprint: { width: w, length: l },
                    height: h,
                    type: bType,
                },
                hMeta('building'),
            );
        }
    }

    // ================================================================
    // 4. PLUMES (1-3, zona de monitoramento, escala reduzida)
    // Cada pluma em profundidade diferente, dimensoes moderadas.
    // Gera timeline temporal (shrinking) para dados correlacionados ML.
    // ================================================================
    const plumePositions = [];
    /** @type {Array<{ timeline: Array, center: Object, id: string }>} */
    const plumeData = []; // Guarda timelines para correlacionar com pocos
    if (include.has('plume')) {
        const PLUME_DEPTH_NAMES = { shallow: 'Rasa', middle: 'Intermediária', deep: 'Profunda' };
        const numPlumes = randInt(1, 3);
        for (let i = 0; i < numPlumes; i++) {
            const depth = plumeDepths[i % plumeDepths.length];
            const _ec = nextElementCounter();
            const pos = inZone(monitoringCenter, zoneSpread * 0.5);
            const rx = randRange(3, 10) * S;
            const ry = randRange(2, 7) * S;
            const rz = randRange(2, 8);
            const baseShape = { radiusX: rx, radiusY: ry, radiusZ: rz };
            const baseCenter = { x: pos.x, y: depth.yCenter, z: pos.z };

            // Shrink proporcional ao tipo de contaminante dominante
            // BTEX: biodegradacao rapida (35-55%), TPH: moderado (20-35%), metais: lento (5-15%)
            const plumeParams = FAMILY_PARAMETERS.plume || [];
            const hasBTEX = plumeParams.some((p) =>
                ['benzene', 'toluene', 'ethylbenzene', 'xylenes', 'btex'].includes(p),
            );
            const hasMetals = plumeParams.some((p) => ['lead', 'chromium', 'arsenic', 'mercury'].includes(p));
            const shrinkFactor = hasMetals
                ? 0.05 + Math.random() * 0.1
                : hasBTEX
                  ? 0.35 + Math.random() * 0.2
                  : 0.2 + Math.random() * 0.15;
            const timeline = _generatePlumeTimeline(baseShape, baseCenter, numCampaigns, shrinkFactor);
            const plumeId = `plume-${_ec}`;

            plumePositions.push({ x: pos.x, z: pos.z, y: depth.yCenter, rx, ry });
            plumeData.push({ timeline, center: baseCenter, id: plumeId });

            addElement(
                'plume',
                plumeId,
                `Pluma ${PLUME_DEPTH_NAMES[depth.level]}`,
                {
                    depth: { level: depth.level, top: depth.top, bottom: depth.bottom },
                    shape: baseShape,
                    center: baseCenter,
                    // Snapshots temporais para treinamento ML (cada campanha -> geometria)
                    shapeTimeline: timeline.map((snap, idx) => ({
                        campaignId: campaigns[idx].id,
                        date: campaigns[idx].date.toISOString().slice(0, 10),
                        shape: { ...snap.shape },
                        center: { ...snap.center },
                    })),
                    observations: generateCorrelatedPlumeObs(timeline, baseCenter, campaigns),
                },
                hMeta('plume'),
            );
        }
    }

    // ----------------------------------------------------------------
    // Helper: gera profile de poco aleatorio (litologia + construtivo)
    // ----------------------------------------------------------------
    // Padrao geologico do site (1 por modelo — coerencia entre pocos)
    const GEOLOGY_PATTERNS = {
        sedimentary: [
            { type: 'clay', pct: [0.05, 0.15] },
            { type: 'sandy_clay', pct: [0.1, 0.25] },
            { type: 'sand', pct: [0.2, 0.35] },
            { type: 'gravel', pct: [0.1, 0.2] },
            { type: 'rock', pct: [0.15, 0.3] },
        ],
        alluvial: [
            { type: 'clay', pct: [0.08, 0.18] },
            { type: 'sand', pct: [0.25, 0.4] },
            { type: 'gravel', pct: [0.15, 0.25] },
            { type: 'silty_sand', pct: [0.2, 0.35] },
        ],
        crystalline: [
            { type: 'clay', pct: [0.05, 0.12] },
            { type: 'silt', pct: [0.1, 0.2] },
            { type: 'rock', pct: [0.55, 0.75] },
        ],
    };
    const geoRoll = Math.random();
    const siteGeology = geoRoll < 0.5 ? 'sedimentary' : geoRoll < 0.8 ? 'alluvial' : 'crystalline';
    const geoPattern = GEOLOGY_PATTERNS[siteGeology];

    // Ondulacao geologica por camada — offset absoluto em metros (nao fracao).
    // Frequencias distintas do terreno sintetico (0.7/0.5) para pattern visual diferente.
    // Amplitude 15-35% do totalDepth garante variacao de ±3-8m em contatos.
    const _geoWaves = geoPattern.map((_, i) => ({
        fx: 0.8 + i * 0.7,
        fz: 0.6 + i * 0.5,
        px: i * 2.1 + 0.5,
        pz: i * 1.4 + 1.1,
        amp: 0.15 + i * 0.05,
    }));

    function _generateWellProfile(totalDepth, diameter, wx, wz) {
        const moistures = ['dry', 'moist', 'saturated'];
        const nx = (wx || 0) / Math.max(halfWidth, 1);
        const nz = (wz || 0) / Math.max(halfLength, 1);

        // Gera camadas litologicas com ondulacao geologica visivelmente irregular
        const lithologic = [];
        let currentDepth = 0;
        for (let i = 0; i < geoPattern.length; i++) {
            const layer = geoPattern[i];
            const basePct = randRange(layer.pct[0], layer.pct[1]);
            // Ondulacao geologica: offset absoluto em metros proporcional a totalDepth
            const w = _geoWaves[i];
            const waveOffset =
                totalDepth * w.amp * Math.sin(nx * Math.PI * w.fx + w.px) * Math.cos(nz * Math.PI * w.fz + w.pz);
            const thickness =
                i === geoPattern.length - 1
                    ? totalDepth - currentDepth
                    : Math.max(0.5, totalDepth * basePct + waveOffset);
            const to = Math.min(currentDepth + thickness, totalDepth);
            lithologic.push({
                from: Math.round(currentDepth * 10) / 10,
                to: Math.round(to * 10) / 10,
                soilType: layer.type,
                description: '',
                classification: 'ABGE',
                color: '',
                moisture: currentDepth > totalDepth * 0.4 ? 'saturated' : randChoice(moistures),
                observations: '',
            });
            currentDepth = to;
            if (currentDepth >= totalDepth) break;
        }

        // Gera elementos construtivos tipicos
        const screenTop = Math.round(totalDepth * 0.4 * 10) / 10;
        const screenBottom = Math.round((totalDepth - 1) * 10) / 10;
        const sealBottom = Math.round(screenTop * 10) / 10;
        const elements = [
            { type: 'surface_completion', topDepth: 0, bottomDepth: 0.5, properties: {} },
            {
                type: 'cement_seal',
                topDepth: 0.5,
                bottomDepth: Math.round(Math.min(3, sealBottom) * 10) / 10,
                properties: {},
            },
            {
                type: 'bentonite_seal',
                topDepth: Math.round(Math.min(3, sealBottom) * 10) / 10,
                bottomDepth: sealBottom,
                properties: {},
            },
            { type: 'blank_casing', topDepth: 0, bottomDepth: screenTop, properties: {} },
            { type: 'screen', topDepth: screenTop, bottomDepth: screenBottom, properties: { slotSize: 0.5 } },
            { type: 'gravel_pack', topDepth: screenTop, bottomDepth: screenBottom, properties: {} },
            { type: 'sump', topDepth: screenBottom, bottomDepth: totalDepth, properties: {} },
        ];

        // Nivel d'agua (40-60% da profundidade)
        const wlDepth = Math.round(totalDepth * (0.4 + Math.random() * 0.2) * 100) / 100;

        // VOC readings (0-4 pontos)
        const vocCount = randInt(0, 4);
        const vocReadings = [];
        for (let i = 0; i < vocCount; i++) {
            vocReadings.push({
                depth: Math.round(Math.random() * totalDepth * 10) / 10,
                value: Math.round(Math.random() * 500 * 10) / 10,
            });
        }
        vocReadings.sort((a, b) => a.depth - b.depth);

        return {
            constructive: {
                totalDepth,
                drillingDepth: totalDepth,
                boreholeDiameter: 10,
                casingDiameter: diameter || 4,
                drillingMethod: randChoice(['hollow_stem_auger', 'rotary', 'percussion']),
                elements,
            },
            lithologic,
            waterLevel: { depth: wlDepth, date: new Date().toISOString().split('T')[0] },
            vocReadings,
        };
    }

    // ================================================================
    // 5. WELLS — 25 poços em 3 tiers (downstream GAC / intermediário / montante)
    //
    // Tier downstream (8): GAC completo 67 parâmetros, clustered ao redor das plumas
    // Tier intermediário (15): 20 parâmetros selecionados, rede de monitoramento
    // Tier montante/background (2): 8 parâmetros básicos, referência limpa
    //
    // Observações correlacionadas: contaminantes refletem distância à pluma
    // e estado temporal da remediação. ~80% belowDetection para PAH/metais.
    // ================================================================
    const wellPositions = [];
    if (include.has('well')) {
        let wellIndex = 0;

        // Helper: gera observações GAC para um poço com tier-based params
        function _generateTieredWellObs(tierParams, wellPos, linkedPlumeIdx, wDepth) {
            // Se há pluma vinculada, usa obs correlacionadas (contaminantes baseados em distância)
            if (linkedPlumeIdx >= 0 && plumeData[linkedPlumeIdx]) {
                const pd = plumeData[linkedPlumeIdx];
                return generateCorrelatedWellObs(
                    { x: wellPos.x, z: wellPos.z, y: -wDepth / 2 },
                    pd.timeline,
                    pd.center,
                    campaigns,
                );
            }
            // Senão, gera observações com os params do tier
            return generateObservations('well', { x: wellPos.x, y: -wDepth / 2, z: wellPos.z }, campaigns);
        }

        // Helper: posiciona poço ao redor de uma pluma
        function _wellNearPlume(distMin, distMax) {
            if (plumePositions.length === 0) return inZone(monitoringCenter, zoneSpread);
            const plumeIdx = wellIndex % plumePositions.length;
            const plume = plumePositions[plumeIdx];
            const angle = randRange(0, Math.PI * 2);
            const dist = randRange(distMin, distMax) * Math.max(plume.rx, plume.ry);
            return {
                x: clamp(plume.x + Math.cos(angle) * dist, halfWidth),
                z: clamp(plume.z + Math.sin(angle) * dist, halfLength),
                linkedPlumeIdx: plumeIdx,
            };
        }

        // Referencia de agua para calculo do NA sintetico
        const waterRef = detectedZones?.water || naturalCenter;
        const _wellDepthFromTerrain = (px, pz, tier) => {
            const groundY = _syntheticTerrainElevation(px, pz, halfWidth, halfLength);
            const distW = Math.sqrt((px - waterRef.x) ** 2 + (pz - waterRef.z) ** 2);
            const wtY = _syntheticWaterTable(groundY, distW);
            const wtDepth = groundY - wtY; // profundidade ate o NA
            const mult = tier === 'downstream' ? 2.5 : tier === 'intermediate' ? 1.8 : 1.2;
            return Math.max(10, wtDepth * mult + randRange(2, 8));
        };

        // ── TIER 1: Downstream — 8 poços com GAC completo (67 params) ──
        const downstreamCount = WELL_TIERS.downstream.count;
        for (let i = 0; i < downstreamCount; i++) {
            nextElementCounter();
            const wellId = `PM-${String(wellIndex + 1).padStart(2, '0')}`;
            const pos = _wellNearPlume(0.2, 1.2);
            const wDepth = _wellDepthFromTerrain(pos.x, pos.z, 'downstream');
            const linkedIdx = pos.linkedPlumeIdx ?? -1;

            const groundY = _syntheticTerrainElevation(pos.x, pos.z, halfWidth, halfLength);
            wellPositions.push({ x: pos.x, z: pos.z, depth: wDepth, tier: 'downstream' });

            addElement(
                'well',
                wellId,
                wellId,
                {
                    coordinates: { easting: pos.x, northing: pos.z, elevation: groundY },
                    construction: { totalDepth: wDepth, diameter: randChoice([2, 4, 6]) },
                    tier: 'downstream',
                    linkedPlumeId: linkedIdx >= 0 ? plumeData[linkedIdx].id : null,
                    observations: _generateTieredWellObs(GAC_ALL_PARAMS, pos, linkedIdx, wDepth),
                    profile: _generateWellProfile(wDepth, randChoice([2, 4, 6]), pos.x, pos.z),
                },
                hMeta('well'),
            );
            wellIndex++;
        }

        // ── TIER 2: Intermediário — 15 poços com 20 params selecionados ──
        const intermediateCount = WELL_TIERS.intermediate.count;
        for (let i = 0; i < intermediateCount; i++) {
            nextElementCounter();
            const wellId = `PM-${String(wellIndex + 1).padStart(2, '0')}`;
            // Distribuídos mais amplamente ao redor da zona de monitoramento
            const pos = _wellNearPlume(0.8, 2.5);
            const wDepth = _wellDepthFromTerrain(pos.x, pos.z, 'intermediate');
            const linkedIdx = pos.linkedPlumeIdx ?? -1;

            const groundY = _syntheticTerrainElevation(pos.x, pos.z, halfWidth, halfLength);
            wellPositions.push({ x: pos.x, z: pos.z, depth: wDepth, tier: 'intermediate' });

            addElement(
                'well',
                wellId,
                wellId,
                {
                    coordinates: { easting: pos.x, northing: pos.z, elevation: groundY },
                    construction: { totalDepth: wDepth, diameter: randChoice([2, 4]) },
                    tier: 'intermediate',
                    linkedPlumeId: linkedIdx >= 0 ? plumeData[linkedIdx].id : null,
                    observations: _generateTieredWellObs(TIER_INTERMEDIATE_PARAMS, pos, linkedIdx, wDepth),
                    profile: _generateWellProfile(wDepth, randChoice([2, 4]), pos.x, pos.z),
                },
                hMeta('well'),
            );
            wellIndex++;
        }

        // ── TIER 3: Montante/Background — 2 poços com 8 params básicos ──
        const upstreamCount = WELL_TIERS.upstream.count;
        for (let i = 0; i < upstreamCount; i++) {
            nextElementCounter();
            const wellId = `PM-${String(wellIndex + 1).padStart(2, '0')}`;
            // Longe das plumas, na zona montante (oposta ao fluxo subterrâneo)
            const x = clamp(monitoringCenter.x + randRange(-zoneSpread, zoneSpread), halfWidth);
            const z = clamp(monitoringCenter.z - zoneSpread * randRange(1.0, 2.0), halfLength);
            const wDepth = _wellDepthFromTerrain(x, z, 'upstream');

            const groundY = _syntheticTerrainElevation(x, z, halfWidth, halfLength);
            wellPositions.push({ x, z, depth: wDepth, tier: 'upstream' });

            addElement(
                'well',
                wellId,
                wellId,
                {
                    coordinates: { easting: x, northing: z, elevation: groundY },
                    construction: { totalDepth: wDepth, diameter: 2 },
                    tier: 'upstream',
                    linkedPlumeId: null,
                    observations: generateObservations('well', { x, y: -wDepth / 2, z }, campaigns),
                    profile: _generateWellProfile(wDepth, 2, x, z),
                },
                hMeta('well'),
            );
            wellIndex++;
        }
    }

    // ================================================================
    // 6. TANKS (1-3, proximos a edificacoes)
    // Tanques de armazenamento posicionados junto ao parque industrial
    // ================================================================
    if (include.has('tank')) {
        const TANK_CONTENTS = {
            diesel: 'Diesel',
            gasoline: 'Gasolina',
            fuel_oil: 'Óleo Combustível',
            chemicals: 'Químicos',
        };
        const numTanks = randInt(1, 3);
        for (let i = 0; i < numTanks; i++) {
            const _ec = nextElementCounter();
            // Fallback para zona industrial se nao ha edificacoes
            const bldg =
                buildingPositions.length > 0
                    ? randChoice(buildingPositions)
                    : { x: industrialCenter.x, z: industrialCenter.z, h: 6 };
            const x = clamp(bldg.x + randRange(-25, 25), halfWidth);
            const z = clamp(bldg.z + randRange(-25, 25), halfLength);
            const isUnderground = Math.random() > 0.3;
            const y = isUnderground ? randRange(-5, -2) : 0;
            const contents = randChoice(Object.keys(TANK_CONTENTS));
            addElement(
                'tank',
                `tank-${_ec}`,
                `Tanque de ${TANK_CONTENTS[contents]}`,
                {
                    position: { x, y, z },
                    dimensions: { diameter: randRange(2, 6), length: randRange(4, 10) },
                    type: isUnderground ? 'underground' : 'aboveground',
                    contents,
                    observations: generateObservations('tank', { x, y, z }, campaigns),
                },
                hMeta('tank'),
            );
        }
    }

    // ================================================================
    // 7. LAKE (60% chance, zona natural, dimensoes absolutas)
    // Lagoa de retencao ou corpo hidrico proximo a area natural
    // ================================================================
    let lakePosition = null;
    if (include.has('lake') && Math.random() > 0.4) {
        const _ec = nextElementCounter();
        // Se deteccao encontrou agua, posicionar lago no centroide
        const waterPos = detectedZones?.water || inZone(naturalCenter, zoneSpread * 0.4);
        const pos = detectedZones?.water ? waterPos : inZone(naturalCenter, zoneSpread * 0.4);
        const groundY = _syntheticTerrainElevation(pos.x, pos.z, halfWidth, halfLength);
        lakePosition = { x: pos.x, y: groundY, z: pos.z };
        addElement(
            'lake',
            `lake-${_ec}`,
            'Lagoa de Contenção',
            {
                position: lakePosition,
                shape: { radiusX: randRange(15, 50), radiusY: randRange(10, 35), depth: randRange(2, 8) },
                observations: generateObservations('lake', lakePosition, campaigns),
            },
            hMeta('lake'),
        );
    }

    // ================================================================
    // 8. RIVER (50% chance, zona natural, largura absoluta)
    // Corrego que corta a borda da area de estudo
    // ================================================================
    let riverMidpoint = null;
    if (include.has('river') && Math.random() > 0.5) {
        const _ec = nextElementCounter();
        const numPoints = randInt(3, 6);
        const points = [];
        const flowEast = Math.random() > 0.5;
        const startX = flowEast ? -halfWidth * 0.7 : halfWidth * 0.7;
        const startZ = naturalCenter.z + randRange(-zoneSpread, zoneSpread);
        const dir = flowEast ? 1 : -1;
        const step = (halfWidth * 1.4) / numPoints;
        for (let p = 0; p < numPoints; p++) {
            points.push({
                x: clamp(startX + dir * p * step + randRange(-8, 8), halfWidth),
                y: 0,
                z: clamp(startZ + randRange(-10, 10), halfLength),
            });
        }
        riverMidpoint = points[Math.floor(points.length / 2)];
        addElement(
            'river',
            `river-${_ec}`,
            'Córrego',
            {
                path: points,
                width: randRange(2, 6),
                observations: generateObservations('river', riverMidpoint, campaigns),
            },
            hMeta('river'),
        );
    }

    // ================================================================
    // 9. SPRINGS (0-2, zona natural)
    // Nascentes posicionadas perto de habitats naturais
    // ================================================================
    if (include.has('spring')) {
        const SPRING_NAMES = { artesian: 'Artesiana', gravity: 'Gravitacional', seepage: 'de Infiltração' };
        const numSprings = randInt(0, 2);
        for (let i = 0; i < numSprings; i++) {
            const _ec = nextElementCounter();
            const pos = inZone(naturalCenter, zoneSpread * 0.6);
            const sType = randChoice(['artesian', 'gravity', 'seepage']);
            addElement(
                'spring',
                `spring-${_ec}`,
                `Nascente ${SPRING_NAMES[sType]}`,
                {
                    position: { x: pos.x, y: 0, z: pos.z },
                    discharge: randRange(0.5, 10),
                    type: sType,
                    observations: generateObservations('spring', { x: pos.x, y: 0, z: pos.z }, campaigns),
                },
                hMeta('spring'),
            );
        }
    }

    // ================================================================
    // 10. MARKERS (0-3, espalhados pela area)
    // ================================================================
    if (include.has('marker')) {
        const numMarkers = randInt(0, 3);
        for (let i = 0; i < numMarkers; i++) {
            const _ec = nextElementCounter();
            addElement(
                'marker',
                `marker-${_ec}`,
                `Marcador ${i + 1}`,
                {
                    position: {
                        x: randRange(-halfWidth * 0.8, halfWidth * 0.8),
                        y: randRange(-5, 5),
                        z: randRange(-halfLength * 0.8, halfLength * 0.8),
                    },
                },
                hMeta('marker'),
            );
        }
    }

    // ================================================================
    // 10b. SAMPLE POINTS (1-4, zona de monitoramento)
    // Pontos de amostragem proximos a rede de monitoramento
    // ================================================================
    if (include.has('sample')) {
        const SAMPLE_NAMES = {
            soil: 'Solo',
            surface_water: 'Água Superficial',
            sediment: 'Sedimento',
            groundwater: 'Água Subterrânea',
        };
        const numSamples = randInt(1, 4);
        for (let i = 0; i < numSamples; i++) {
            const _ec = nextElementCounter();
            const pos = inZone(monitoringCenter, zoneSpread * 0.7);
            const matrix = randChoice(Object.keys(SAMPLE_NAMES));
            addElement(
                'sample',
                `sample-${_ec}`,
                `Amostra de ${SAMPLE_NAMES[matrix]}`,
                {
                    position: { x: pos.x, y: 0, z: pos.z },
                    matrix,
                    depth: randRange(0, 10),
                    observations: generateObservations('sample', { x: pos.x, y: 0, z: pos.z }, campaigns),
                },
                hMeta('sample'),
            );
        }
    }

    // ================================================================
    // 11. EMISSION SOURCES (1-3, sobre edificacoes)
    // Chamines e fontes de emissao posicionadas sobre predios
    // ================================================================
    if (include.has('emission_source')) {
        const EMISSION_NAMES = { combustion: 'da Caldeira', process: 'do Processo', flare: 'do Flare' };
        const numEmissionSources = randInt(1, 3);
        for (let i = 0; i < numEmissionSources; i++) {
            const _ec = nextElementCounter();
            const bldg =
                buildingPositions.length > 0
                    ? buildingPositions[i % buildingPositions.length]
                    : { x: industrialCenter.x, z: industrialCenter.z, h: 6 };
            const x = bldg.x + randRange(-5, 5);
            const z = bldg.z + randRange(-5, 5);
            const cat = randChoice(['combustion', 'process', 'flare']);
            addElement(
                'emission_source',
                `emission-${_ec}`,
                `Chaminé ${EMISSION_NAMES[cat]}`,
                {
                    position: { x, y: bldg.h + randRange(2, 8), z },
                    type: randChoice(['stack', 'vent', 'fugitive']),
                    sourceCategory: cat,
                    observations: generateObservations('emission_source', { x, y: bldg.h, z }, campaigns),
                },
                hMeta('emission_source'),
            );
        }
    }

    // ================================================================
    // 12. WASTE STREAMS (1-3, zona industrial com posicao)
    // Fluxos de residuos vinculados a area de operacao
    // ================================================================
    if (include.has('waste_stream')) {
        const WASTE_NAMES = { 'Class I': 'Perigoso', 'Class IIA': 'Não Inerte', 'Class IIB': 'Inerte' };
        const numWasteStreams = randInt(1, 3);
        for (let i = 0; i < numWasteStreams; i++) {
            const _ec = nextElementCounter();
            const bldg =
                buildingPositions.length > 0
                    ? randChoice(buildingPositions)
                    : { x: industrialCenter.x, z: industrialCenter.z };
            const wastePos = {
                x: clamp(bldg.x + randRange(-15, 15), halfWidth),
                y: 0,
                z: clamp(bldg.z + randRange(-15, 15), halfLength),
            };
            const wasteClass = randChoice(['Class I', 'Class IIA', 'Class IIB']);
            addElement(
                'waste_stream',
                `waste-${_ec}`,
                `Resíduo ${WASTE_NAMES[wasteClass]}`,
                {
                    position: wastePos,
                    wasteClass,
                    destination: randChoice(['recycling', 'landfill', 'incineration', 'coprocessing']),
                    observations: generateObservations('waste_stream', wastePos, campaigns),
                },
                hMeta('waste_stream'),
            );
        }
    }

    // ================================================================
    // 13. EFFLUENT POINTS (1-2, proximos a corpos hidricos)
    // Pontos de lancamento de efluentes no corpo receptor
    // ================================================================
    if (include.has('effluent_point')) {
        const EFFLUENT_NAMES = { industrial: 'Industrial', sanitary: 'Sanitário', stormwater: 'Pluvial' };
        const numEffluentPoints = randInt(1, 2);
        for (let i = 0; i < numEffluentPoints; i++) {
            const _ec = nextElementCounter();
            let x, z;
            const waterRef = riverMidpoint || lakePosition;
            if (waterRef) {
                x = clamp(waterRef.x + randRange(-20, 20), halfWidth);
                z = clamp(waterRef.z + randRange(-20, 20), halfLength);
            } else {
                x = halfWidth * randChoice([-0.9, 0.9]);
                z = randRange(-halfLength * 0.5, halfLength * 0.5);
            }
            const effType = randChoice(['industrial', 'sanitary', 'stormwater']);
            addElement(
                'effluent_point',
                `effluent-${_ec}`,
                `Efluente ${EFFLUENT_NAMES[effType]}`,
                {
                    position: { x, y: 0, z },
                    effluentType: effType,
                    receivingBody: riverMidpoint ? 'river' : lakePosition ? 'lake' : 'treatment_plant',
                    observations: generateObservations('effluent_point', { x, y: 0, z }, campaigns),
                },
                hMeta('effluent_point'),
            );
        }
    }

    // ================================================================
    // 14. AREAS/SETORES (2-4 áreas organizacionais)
    // Setores operacionais vinculados ao painel Project > Areas
    // ================================================================
    const generatedAreas = [];
    if (include.has('area')) {
        const AREA_NAMES = {
            production: 'Produção',
            warehouse: 'Armazém',
            office: 'Escritório',
            maintenance: 'Manutenção',
        };
        const areaTypes = Object.keys(AREA_NAMES);
        const numAreas = randInt(2, 4);
        for (let i = 0; i < numAreas; i++) {
            const _ec = nextElementCounter();
            const areaType = areaTypes[i % areaTypes.length];
            const areaName = `Setor ${AREA_NAMES[areaType]}`;
            addElement(
                'area',
                `area-${_ec}`,
                areaName,
                {
                    areaType,
                    headcount: randInt(10, 200),
                    workedHours: randInt(50000, 500000),
                    projectArea: areaName,
                    observations: generateObservations('area', { x: 0, y: 0, z: 0 }, campaigns),
                },
                hMeta('area'),
            );
            generatedAreas.push({ area: areaName, subarea: areaType });
        }
    }

    // ================================================================
    // 15. INCIDENTS (0-3 incidentes H&S)
    // ================================================================
    if (include.has('incident')) {
        const numIncidents = randInt(0, 3);
        for (let i = 0; i < numIncidents; i++) {
            const _ec = nextElementCounter();
            const incidentDate = new Date(Date.now() - randInt(1, 365) * 24 * 60 * 60 * 1000);
            addElement(
                'incident',
                `incident-${_ec}`,
                `Incidente ${i + 1}`,
                {
                    type: randChoice(['accident', 'near_miss', 'first_aid', 'medical_treatment']),
                    severity: randChoice(['low', 'medium', 'high', 'critical']),
                    lostDays: randInt(0, 30),
                    date: incidentDate.toISOString().slice(0, 10),
                    rootCause: randChoice(['behavioral', 'equipment', 'process', 'environmental']),
                },
                { hierarchy: { parentId: siteProjectId || null, order: i } },
            );
        }
    }

    // ================================================================
    // 16. HABITATS (1-3, zona natural)
    // Areas de biodiversidade posicionadas na regiao natural do site
    // ================================================================
    if (include.has('habitat')) {
        const HABITAT_NAMES = {
            forest: 'Mata Nativa',
            wetland: 'Área Alagável',
            grassland: 'Campo',
            riparian: 'Mata Ciliar',
        };
        const numHabitats = randInt(1, 3);
        for (let i = 0; i < numHabitats; i++) {
            const _ec = nextElementCounter();
            const pos = inZone(naturalCenter, zoneSpread * 0.5);
            const hType = randChoice(Object.keys(HABITAT_NAMES));
            addElement(
                'habitat',
                `habitat-${_ec}`,
                HABITAT_NAMES[hType],
                {
                    position: { x: pos.x, y: 0, z: pos.z },
                    habitatType: hType,
                    protectionStatus: randChoice(['none', 'buffer_zone', 'protected', 'restoration']),
                    area: randRange(1, 100),
                    observations: generateObservations('habitat', { x: pos.x, y: 0, z: pos.z }, campaigns),
                },
                hMeta('habitat'),
            );
        }
    }

    // ================================================================
    // 17. INDIVIDUALS (5-15 indivíduos - mix de pessoas e fauna)
    // ================================================================
    if (include.has('individual')) {
        const numIndividuals = randInt(5, 15);
        const individualTypes = ['person', 'person', 'person', 'animal', 'tree'];
        for (let i = 0; i < numIndividuals; i++) {
            const _ec = nextElementCounter();
            const indType = randChoice(individualTypes);
            const pos =
                indType === 'person'
                    ? inZone(industrialCenter, zoneSpread * 0.8)
                    : inZone(naturalCenter, zoneSpread * 0.9);
            const obsPos = { x: pos.x, y: 0, z: pos.z };

            if (indType === 'person') {
                const PERSON_ROLES = {
                    operator: 'Operador',
                    technician: 'Técnico',
                    supervisor: 'Supervisor',
                    manager: 'Gestor',
                };
                const role = randChoice(Object.keys(PERSON_ROLES));
                addElement(
                    'individual',
                    `individual-${_ec}`,
                    `${PERSON_ROLES[role]} ${i + 1}`,
                    {
                        position: obsPos,
                        individualType: 'person',
                        role,
                        department:
                            generatedAreas.length > 0 ? randChoice(generatedAreas).area : `Setor ${randInt(1, 4)}`,
                        observations: generateObservations('individual', obsPos, campaigns),
                    },
                    hMeta('building'),
                );
            } else if (indType === 'animal') {
                const species = randChoice(['Capivara', 'Tucano', 'Bugio', 'Onça-Pintada', 'Anta']);
                addElement(
                    'individual',
                    `individual-${_ec}`,
                    species,
                    {
                        position: obsPos,
                        individualType: 'animal',
                        species,
                        taxonId: `GBIF-${randInt(1000000, 9999999)}`,
                        observationDate: campaigns[randInt(0, campaigns.length - 1)].date.toISOString().slice(0, 10),
                        observations: generateObservations('habitat', obsPos, campaigns),
                    },
                    hMeta('habitat'),
                );
            } else {
                const species = randChoice(['Ipê Amarelo', 'Jatobá', 'Pau-Brasil', 'Araucária']);
                addElement(
                    'individual',
                    `individual-${_ec}`,
                    species,
                    {
                        position: obsPos,
                        individualType: 'tree',
                        species,
                        dbh: randRange(10, 100),
                        height: randRange(5, 30),
                        observations: generateObservations('habitat', obsPos, campaigns),
                    },
                    hMeta('habitat'),
                );
            }
        }
    }

    // ================================================================
    // 18. SENSORS (1-3, proximos a pocos ou corpos hidricos)
    // Sensores IoT posicionados em pontos estrategicos de monitoramento
    // ================================================================
    if (include.has('sensor')) {
        const SENSOR_NAMES = {
            temperature: 'Temperatura',
            multiparameter: 'Multiparâmetro',
            level: 'Nível',
            flow: 'Vazão',
        };
        const sensorTypes = Object.keys(SENSOR_NAMES);
        const numSensors = randInt(1, 3);
        for (let i = 0; i < numSensors; i++) {
            const _ec = nextElementCounter();
            const sType = randChoice(sensorTypes);
            let sx, sz;
            const sensorRef = wellPositions.length > 0 ? randChoice(wellPositions) : null;
            if (sensorRef) {
                sx = clamp(sensorRef.x + randRange(-10, 10), halfWidth);
                sz = clamp(sensorRef.z + randRange(-10, 10), halfLength);
            } else {
                const pos = inZone(monitoringCenter, zoneSpread);
                sx = pos.x;
                sz = pos.z;
            }
            addElement(
                'sensor',
                `sensor-${_ec}`,
                `Sensor de ${SENSOR_NAMES[sType]}`,
                {
                    position: { x: sx, y: 0, z: sz },
                    geoCoordinates: {
                        latitude: rndLat + sz / 111320,
                        longitude: rndLon + sx / (111320 * Math.cos((rndLat * Math.PI) / 180)),
                    },
                    userId: randInt(1, 10),
                    connectorKey: '',
                    sensorType: sType,
                    monitoredParameters: ['temperature', 'pH', 'conductivity', 'water_level'],
                    profile: null,
                    evaluation: null,
                    weather: null,
                    lastFetch: null,
                    errors: [],
                    observations: generateObservations('sensor', { x: sx, y: 0, z: sz }, campaigns),
                },
                hMeta('sensor'),
            );
        }
    }

    // ================================================================
    // 19. INTANGIBLE ASSETS (1-3 ativos intangiveis)
    // Contratos, creditos de carbono, certificacoes ambientais
    // Sem posicao fisica — aparecem como sprite billboard flutuante
    // ================================================================
    if (include.has('intangible')) {
        const INTANGIBLE_ITEMS = [
            { name: 'Crédito de Carbono', type: 'carbon_credit' },
            { name: 'Licença Ambiental', type: 'environmental_license' },
            { name: 'Certificação ISO 14001', type: 'certification' },
            { name: 'Contrato de Remediação', type: 'remediation_contract' },
            { name: 'Seguro Ambiental', type: 'insurance' },
            { name: 'Outorga de Uso de Água', type: 'water_use_permit' },
        ];
        const numIntangibles = randInt(1, 3);
        for (let i = 0; i < numIntangibles; i++) {
            const _ec = nextElementCounter();
            const item = INTANGIBLE_ITEMS[i % INTANGIBLE_ITEMS.length];
            addElement(
                'intangible',
                `intangible-${_ec}`,
                item.name,
                {
                    assetType: item.type,
                    issueDate: new Date(Date.now() - randInt(30, 730) * 86400000).toISOString().slice(0, 10),
                    expiryDate: new Date(Date.now() + randInt(30, 1095) * 86400000).toISOString().slice(0, 10),
                    value: randRange(10000, 500000).toFixed(2),
                    status: randChoice(['active', 'pending', 'expired', 'renewed']),
                },
                { hierarchy: { parentId: siteProjectId || null, order: i } },
            );
        }
    }

    // ================================================================
    // 20. GENERIC ELEMENTS (1-2 elementos genericos)
    // Itens diversos que nao se encaixam em outras familias
    // ================================================================
    if (include.has('generic')) {
        const GENERIC_ITEMS = [
            'Equipamento de Campo',
            'Estação Meteorológica',
            'Ponto de Referência',
            'Registro Fotográfico',
        ];
        const numGeneric = randInt(1, 2);
        for (let i = 0; i < numGeneric; i++) {
            const _ec = nextElementCounter();
            addElement(
                'generic',
                `generic-${_ec}`,
                GENERIC_ITEMS[i % GENERIC_ITEMS.length],
                {
                    description: `Elemento genérico ${i + 1} para demonstração`,
                    createdDate: new Date(Date.now() - randInt(1, 365) * 86400000).toISOString().slice(0, 10),
                },
                { hierarchy: { parentId: siteProjectId || null, order: i } },
            );
        }
    }

    // ================================================================
    // 21. EDGES - Vínculos entre elementos
    // ================================================================
    const edges = [];
    const elements = getAllElements();

    // Vincular incidents a areas
    const incidentElements = elements.filter((e) => e.family === 'incident');
    const areaElements = elements.filter((e) => e.family === 'area');
    const personElements = elements.filter((e) => e.family === 'individual' && e.data.individualType === 'person');

    incidentElements.forEach((incident) => {
        if (areaElements.length > 0) {
            const area = randChoice(areaElements);
            edges.push({
                id: `edge-${edges.length + 1}`,
                sourceId: incident.id,
                targetId: area.id,
                type: 'occurred_in',
                createdAt: new Date().toISOString(),
            });
        }
        if (personElements.length > 0 && Math.random() > 0.5) {
            const person = randChoice(personElements);
            edges.push({
                id: `edge-${edges.length + 1}`,
                sourceId: person.id,
                targetId: incident.id,
                type: 'involved_in',
                createdAt: new Date().toISOString(),
            });
        }
    });

    // Vincular fauna/flora a habitats
    const faunaFloraElements = elements.filter(
        (e) => e.family === 'individual' && ['animal', 'tree'].includes(e.data.individualType),
    );
    const habitatElements = elements.filter((e) => e.family === 'habitat');

    faunaFloraElements.forEach((individual) => {
        if (habitatElements.length > 0) {
            const habitat = randChoice(habitatElements);
            edges.push({
                id: `edge-${edges.length + 1}`,
                sourceId: individual.id,
                targetId: habitat.id,
                type: 'inhabits',
                createdAt: new Date().toISOString(),
            });
        }
    });

    // Vincular plumas a poços (monitoramento)
    const plumeElements = elements.filter((e) => e.family === 'plume');
    const wellElements = elements.filter((e) => e.family === 'well');

    plumeElements.forEach((plume) => {
        const numMonitors = randInt(1, Math.min(3, wellElements.length));
        const monitors = shuffleArray([...wellElements]).slice(0, numMonitors);
        monitors.forEach((well) => {
            mkEdge(well.id, plume.id, 'monitors');
        });
    });

    // Helper para criar edges de forma compacta
    function mkEdge(srcId, tgtId, type) {
        edges.push({
            id: `edge-${edges.length + 1}`,
            sourceId: srcId,
            targetId: tgtId,
            type,
            createdAt: new Date().toISOString(),
        });
    }

    // A. Adjacencia entre camadas geologicas (stratum ↔ stratum)
    const stratumElements = elements.filter((e) => e.family === 'stratum');
    const sortedStrata = [...stratumElements].sort((a, b) => (b.data?.layer?.top || 0) - (a.data?.layer?.top || 0));
    for (let i = 0; i < sortedStrata.length - 1; i++) {
        mkEdge(sortedStrata[i].id, sortedStrata[i + 1].id, 'adjacent_to');
    }

    // B. Areas contem poços
    if (areaElements.length > 0 && wellElements.length > 0) {
        areaElements.forEach((area) => {
            const numWells = randInt(1, Math.min(3, wellElements.length));
            shuffleArray([...wellElements])
                .slice(0, numWells)
                .forEach((well) => {
                    mkEdge(area.id, well.id, 'contains');
                });
        });
    }

    // C. Tanques impactam areas
    const tankElements = elements.filter((e) => e.family === 'tank');
    tankElements.forEach((tank) => {
        if (areaElements.length > 0) {
            mkEdge(tank.id, randChoice(areaElements).id, 'impacts');
        }
    });

    // D. Fontes de emissao impactam habitats ou rios
    const emissionElements = elements.filter((e) => e.family === 'emission_source');
    const riverElements = elements.filter((e) => e.family === 'river');
    const impactTargets = [...habitatElements, ...riverElements];
    emissionElements.forEach((em) => {
        if (impactTargets.length > 0) {
            mkEdge(em.id, randChoice(impactTargets).id, 'impacts');
        }
    });

    // E. Nascentes a montante de rios/lagos
    const springElements = elements.filter((e) => e.family === 'spring');
    const lakeElements = elements.filter((e) => e.family === 'lake');
    const downstreamTargets = [...riverElements, ...lakeElements];
    springElements.forEach((spring) => {
        if (downstreamTargets.length > 0) {
            mkEdge(spring.id, randChoice(downstreamTargets).id, 'upstream_of');
        }
    });

    // F. Pontos de efluente impactam rios/lagos
    const effluentElements = elements.filter((e) => e.family === 'effluent_point');
    effluentElements.forEach((eff) => {
        if (downstreamTargets.length > 0) {
            mkEdge(eff.id, randChoice(downstreamTargets).id, 'impacts');
        }
    });

    // G. Pessoas responsaveis por poços/areas (50% chance)
    const responsibilityTargets = [...wellElements, ...areaElements];
    personElements.forEach((person) => {
        if (Math.random() > 0.5 && responsibilityTargets.length > 0) {
            mkEdge(person.id, randChoice(responsibilityTargets).id, 'responsible_for');
        }
    });

    // Coleta planned readings das observacoes com showPlanning=true
    campaigns.forEach((c) => {
        c.plannedReadings = [];
    });
    for (const el of getAllElements()) {
        const obs = el?.data?.observations;
        if (!Array.isArray(obs)) continue;
        for (const o of obs) {
            if (!o.showPlanning || !o.campaignId || !o.parameterId) continue;
            const camp = campaigns.find((c) => c.id === o.campaignId);
            if (camp) {
                camp.plannedReadings.push({
                    elementId: el.id,
                    parameterId: o.parameterId,
                    x: o.x,
                    y: o.y,
                    z: o.z,
                    expectedValue: null,
                });
            }
        }
    }

    // ================================================================
    // COST ENRICHMENT — L2 (Element) + L3 (Campaign)
    // Gera custos por elemento (CAPEX+OPEX/ano) e por campanha
    // ================================================================

    const catalog = getCostCatalog();
    const currentYear = new Date().getFullYear();

    // L2 — Custos por elemento (por fiscal year)
    for (const el of getAllElements()) {
        const obs = el?.data?.observations;
        if (!Array.isArray(obs) || obs.length === 0) continue;

        // Agrupa observations por ano fiscal
        const obsByYear = {};
        for (const o of obs) {
            const yr = o.date ? parseInt(o.date.slice(0, 4)) : currentYear;
            if (!obsByYear[yr]) obsByYear[yr] = [];
            obsByYear[yr].push(o);
        }

        // Calcula custo médio analítico deste elemento
        const obsWithCost = obs.filter((o) => o.cost && o.cost.total > 0);
        const avgAnalyticalCost =
            obsWithCost.length > 0 ? obsWithCost.reduce((s, o) => s + o.cost.total, 0) / obsWithCost.length : 0;

        // Profundidade para drilling cost (wells)
        const depth = el.data?.construction?.totalDepth || 0;

        // Gera custo por fiscal year (CAPEX somente no primeiro ano)
        const sortedYears = Object.keys(obsByYear).sort();
        el.data.costs = sortedYears.map((yr, idx) => {
            const yearObs = obsByYear[yr];
            const isFirstYear = idx === 0;
            return buildElementCostEntry(el.family, parseInt(yr), {
                depth: isFirstYear ? depth : 0,
                numReadings: yearObs.length,
                avgAnalyticalCost,
                basis: 'estimate',
                includeCapex: isFirstYear,
            });
        });
    }

    // L3 — Custos por campanha
    for (const c of campaigns) {
        const campObs = [];
        const campElements = new Set();
        for (const el of getAllElements()) {
            const obs = el?.data?.observations;
            if (!Array.isArray(obs)) continue;
            for (const o of obs) {
                if (o.campaignId === c.id) {
                    campObs.push(o);
                    campElements.add(el.id);
                }
            }
        }
        const avgCost =
            campObs.length > 0
                ? campObs.filter((o) => o.cost?.total > 0).reduce((s, o) => s + (o.cost?.total || 0), 0) /
                  Math.max(1, campObs.filter((o) => o.cost?.total > 0).length)
                : 0;
        c.costs = buildCampaignCost(campElements.size, campObs.length, avgCost);
    }

    // Cria campanhas diretamente (garante que plannedReadings e costs sao preservados)
    const campaignColors = ['#3b6bff', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];
    clearCampaigns();
    campaigns.forEach((c, i) => {
        addCampaign({
            id: c.id,
            name: c.name,
            startDate: c.date.toISOString().slice(0, 10),
            color: campaignColors[i % campaignColors.length],
            visible: true,
            plannedReadings: c.plannedReadings,
            costs: c.costs || null,
        });
    });

    // ================================================================
    // FINANCIAL DATA — WBS + Contratos + EVA (Earned Value Analysis)
    // Dados de gestão financeira para o painel Governance
    // ================================================================
    const wbs = generateWBS();
    const contracts = generateContracts();
    const campaignIds = campaigns.map((c) => c.id);

    const financial = {
        wbs,
        contracts,
        projectRegistry: generateProjectRegistry(wbs, contracts, campaignIds),
        meteorology: siteMeteo,
        campaignMeteo: campaigns.map((c) => ({
            campaignId: c.id,
            date: c.date.toISOString().slice(0, 10),
            ...varyCampaignMeteo(siteMeteo),
        })),
    };

    // Registro corporativo (compras/insumos e vendas/entregas) para Project > Corporate I/O
    _seedCorporateIO(campaigns, contracts);

    // ================================================================
    // SERVICE REQUESTS — 2-3 solicitações planejadas de serviços ambientais
    // ================================================================
    _seedServiceRequests();

    // ================================================================
    // SYMBOLOGY PROFILES — 10 perfis padrão para o modelo aleatório
    // ================================================================
    _seedSymbologyProfiles();

    return {
        campaigns,
        edges,
        areas: generatedAreas,
        financial,
        corporateIO: exportCorporateIO(),
    };
}

/**
 * Cria elementos padrao para novo projeto.
 */
export function createDefaultElements() {
    // Plumas em diferentes profundidades
    addElement('plume', 'plume-shallow', 'Shallow Plume', {
        depth: { level: 'shallow', top: 0, bottom: -15 },
        shape: { radiusX: 18, radiusY: 14, radiusZ: 5 },
        center: { x: 0, y: -7.5, z: 0 },
    });

    addElement('plume', 'plume-middle', 'Middle Plume', {
        depth: { level: 'middle', top: -15, bottom: -40 },
        shape: { radiusX: 14, radiusY: 11, radiusZ: 8 },
        center: { x: 0, y: -27.5, z: 0 },
    });

    addElement('plume', 'plume-deep', 'Deep Plume', {
        depth: { level: 'deep', top: -40, bottom: -80 },
        shape: { radiusX: 10, radiusY: 8, radiusZ: 12 },
        center: { x: 0, y: -60, z: 0 },
    });

    // Pocos de monitoramento
    const wells = [
        { id: 'PM-01', x: 15, z: 10 },
        { id: 'PM-02', x: -12, z: 15 },
        { id: 'PM-03', x: 5, z: -18 },
    ];

    wells.forEach((w) => {
        addElement('well', w.id, w.id, {
            coordinates: { easting: w.x, northing: w.z, elevation: 0 },
            construction: { totalDepth: 50, diameter: 4 },
            profile: _generateSimpleWellProfile(50, 4),
        });
    });

    // Helper para gerar perfil simples (usado apenas neste modelo basico)
    function _generateSimpleWellProfile(totalDepth, diameter) {
        const lithologic = [
            { from: 0, to: 5, soilType: 'clay', description: 'Argila superficial' },
            { from: 5, to: 20, soilType: 'fine_sand', description: 'Areia fina' },
            { from: 20, to: totalDepth, soilType: 'rock', description: 'Rocha' },
        ];
        const screenTop = Math.round(totalDepth * 0.4 * 10) / 10;
        const screenBottom = Math.round((totalDepth - 1) * 10) / 10;
        const elements = [
            { type: 'surface_completion', topDepth: 0, bottomDepth: 0.5 },
            { type: 'cement_seal', topDepth: 0.5, bottomDepth: 3 },
            { type: 'blank_casing', topDepth: 0, bottomDepth: screenTop },
            { type: 'screen', topDepth: screenTop, bottomDepth: screenBottom, properties: { slotSize: 0.5 } },
            { type: 'gravel_pack', topDepth: screenTop, bottomDepth: screenBottom },
            { type: 'sump', topDepth: screenBottom, bottomDepth: totalDepth },
        ];
        return {
            constructive: {
                totalDepth,
                drillingDepth: totalDepth,
                boreholeDiameter: 10,
                casingDiameter: diameter,
                drillingMethod: 'hollow_stem_auger',
                elements,
            },
            lithologic,
        };
    }
}

// ================================================================
// SERVICE REQUESTS — Solicitações de serviços ambientais planejados

/**
 * Cria 2-3 service requests de demonstração após geração do modelo aleatório.
 */
function _seedServiceRequests() {
    const srTypes = Object.keys(SERVICE_TYPES);
    const count = 2 + Math.floor(Math.random() * 2); // 2 ou 3
    const spread = 50;

    for (let i = 0; i < count; i++) {
        const sType = srTypes[i % srTypes.length];
        createIssue({
            type: 'service_request',
            status: 'planned',
            title: `[Planejado] ${SERVICE_TYPES[sType]}`,
            serviceType: sType,
            severity: 'medium',
            description: 'Gerado automaticamente pelo modelo aleatório de demonstração.',
            position: {
                x: (Math.random() - 0.5) * spread * 2,
                y: 0,
                z: (Math.random() - 0.5) * spread * 2,
            },
            createdBy: 'demo',
        });
    }
}

// SYMBOLOGY PROFILES — Perfis padrão para modelos aleatórios
// 10 perfis com temas ambientais realistas (CONAMA 420, CETESB)
// ================================================================

/**
 * Limpa perfis existentes e semeadura 10 perfis padrão ambientais.
 * Chamado ao final de generateRandomModel().
 */
function _seedSymbologyProfiles() {
    // Limpa perfis do modelo anterior
    resetProfiles();

    // ── 1. Alerta Benzeno ────────────────────────────────────────────────────
    // Destaca poços com benzeno acima do VI (5 µg/L — CONAMA 420) em vermelho.
    // Poços entre VRQ (0.1) e VI ficam laranja. Resto: cinza.
    {
        const p = createProfile('Alerta Benzeno');
        p.rules = [
            {
                id: 'bem-vi',
                name: 'Benzeno > VI (5 µg/L)',
                match: { family: 'well', parameter: 'benzene', operator: '>', value: 5 },
                style: { color: '#e53935', opacity: 1, scaleMultiplier: 1.4 },
            },
            {
                id: 'bem-alert',
                name: 'Benzeno > VRQ (0.1 µg/L)',
                match: { family: 'well', parameter: 'benzene', operator: '>', value: 0.1 },
                style: { color: '#ff9800', opacity: 1, scaleMultiplier: 1.2 },
            },
        ];
        p.elements.byFamily.plume = { color: '#b71c1c', opacity: 0.35 };
        p.scene = { background: '#0d1117' };
    }

    // ── 2. Diagnóstico de Plumas ─────────────────────────────────────────────
    // Plumas em cores diferenciadas por família, poços em branco, alta visibilidade.
    {
        const p = createProfile('Diagnóstico de Plumas');
        p.elements.byFamily.plume = { color: '#0288d1', opacity: 0.65, wireframe: false };
        p.elements.byFamily.well = { color: '#ffffff', opacity: 1, scaleMultiplier: 1.2 };
        p.elements.byFamily.tank = { color: '#e65100', opacity: 0.9 };
        p.elements.byFamily.waste = { color: '#6a1b9a', opacity: 0.8 };
        p.scene = { ambientIntensity: 0.8, directionalIntensity: 1.2, background: '#0a1628' };
    }

    // ── 3. Conformidade CONAMA 420 ───────────────────────────────────────────
    // Verde = abaixo do VP; amarelo = entre VP e VI; vermelho = acima do VI.
    // Usa TCE como parâmetro indicador (VI = 70 µg/L CONAMA 420 Uso Industrial).
    {
        const p = createProfile('Conformidade CONAMA 420');
        p.rules = [
            {
                id: 'tce-vi',
                name: 'TCE > VI Industrial (70 µg/L)',
                match: { family: 'well', parameter: 'tce', operator: '>', value: 70 },
                style: { color: '#d32f2f', scaleMultiplier: 1.3 },
            },
            {
                id: 'tce-vp',
                name: 'TCE > VP (3 µg/L)',
                match: { family: 'well', parameter: 'tce', operator: '>', value: 3 },
                style: { color: '#f9a825', scaleMultiplier: 1.1 },
            },
        ];
        p.elements.byFamily.well = { color: '#2e7d32', opacity: 1 };
        p.elements.byFamily.plume = { color: '#b71c1c', opacity: 0.5 };
    }

    // ── 4. Vista de Apresentação ─────────────────────────────────────────────
    // Paleta limpa para relatórios executivos: azul/teal, sem wireframe, fundo escuro.
    {
        const p = createProfile('Vista de Apresentação');
        p.elements.byFamily.plume = { color: '#0097a7', opacity: 0.55 };
        p.elements.byFamily.well = { color: '#e0f7fa', opacity: 1, scaleMultiplier: 1.1 };
        p.elements.byFamily.building = { color: '#546e7a', opacity: 0.85 };
        p.elements.byFamily.boundary = { color: '#b0bec5', opacity: 0.5 };
        p.elements.byFamily.tank = { color: '#78909c', opacity: 0.9 };
        p.elements.byFamily.lake = { color: '#0277bd', opacity: 0.7 };
        p.elements.byFamily.river = { color: '#01579b', opacity: 0.8 };
        p.scene = {
            background: '#0d1b2a',
            ambientIntensity: 0.6,
            directionalIntensity: 1.0,
        };
    }

    // ── 5. Inspeção de Infraestrutura ────────────────────────────────────────
    // Destaca tanques e edificações; plumas invisíveis para foco nas estruturas.
    {
        const p = createProfile('Inspeção de Infraestrutura');
        p.elements.byFamily.plume = { visible: false };
        p.elements.byFamily.building = { color: '#ff6f00', opacity: 1, scaleMultiplier: 1.2 };
        p.elements.byFamily.tank = { color: '#e53935', opacity: 1, scaleMultiplier: 1.3, wireframe: false };
        p.elements.byFamily.waste = { color: '#7b1fa2', opacity: 0.9 };
        p.elements.byFamily.well = { color: '#90a4ae', opacity: 0.6 };
        p.scene = { background: '#1a1a2e', shadows: true };
    }

    // ── 6. Monitoramento de Metais ───────────────────────────────────────────
    // Arsênio > 0.01 mg/L (VI CONAMA) em vermelho; chumbo > 0.01 em laranja.
    {
        const p = createProfile('Monitoramento de Metais');
        p.rules = [
            {
                id: 'as-vi',
                name: 'Arsênio > VI (0.01 mg/L)',
                match: { family: 'well', parameter: 'arsenic', operator: '>', value: 0.01 },
                style: { color: '#c62828', scaleMultiplier: 1.4 },
            },
            {
                id: 'pb-vi',
                name: 'Chumbo > VI (0.01 mg/L)',
                match: { family: 'well', parameter: 'lead', operator: '>', value: 0.01 },
                style: { color: '#e65100', scaleMultiplier: 1.2 },
            },
        ];
        p.elements.byFamily.well = { color: '#4caf50', opacity: 1 };
        p.elements.byFamily.plume = { color: '#880e4f', opacity: 0.45 };
        p.scene = { background: '#0d1117' };
    }

    // ── 7. Modo Wireframe Técnico ────────────────────────────────────────────
    // Todos os elementos em wireframe com cores de contraste para análise geométrica.
    {
        const p = createProfile('Wireframe Técnico');
        p.elements.byFamily.plume = { color: '#00e5ff', opacity: 0.9, wireframe: true };
        p.elements.byFamily.well = { color: '#ffea00', opacity: 1, wireframe: true };
        p.elements.byFamily.building = { color: '#ff6d00', opacity: 0.8, wireframe: true };
        p.elements.byFamily.tank = { color: '#f50057', opacity: 0.8, wireframe: true };
        p.elements.byFamily.boundary = { color: '#76ff03', opacity: 0.7, wireframe: true };
        p.elements.byFamily.lake = { color: '#40c4ff', opacity: 0.7, wireframe: true };
        p.elements.byFamily.river = { color: '#18ffff', opacity: 0.7, wireframe: true };
        p.scene = { background: '#000000', wireframe: false };
    }

    // ── 8. Pluma Expandida (Scale-up) ────────────────────────────────────────
    // Aumenta escala de plumas para análise de extensão; poços miniaturizados.
    {
        const p = createProfile('Pluma Expandida');
        p.elements.byFamily.plume = { color: '#b71c1c', opacity: 0.5, scaleMultiplier: 2.0 };
        p.elements.byFamily.well = { color: '#ffffff', opacity: 0.7, scaleMultiplier: 0.6 };
        p.scene = {
            background: '#0d1117',
            verticalExaggeration: 2,
            ambientIntensity: 0.5,
        };
    }

    // ── 9. Hidroquímica — pH e Condutividade ─────────────────────────────────
    // pH < 6 (ácido) → laranja-vermelho; pH > 8 (alcalino) → azul; neutro → verde.
    {
        const p = createProfile('Hidroquímica — pH');
        p.rules = [
            {
                id: 'ph-acid',
                name: 'pH < 6 (ácido)',
                match: { family: 'well', parameter: 'pH', operator: '<', value: 6 },
                style: { color: '#e53935', scaleMultiplier: 1.2 },
            },
            {
                id: 'ph-alk',
                name: 'pH > 8 (alcalino)',
                match: { family: 'well', parameter: 'pH', operator: '>', value: 8 },
                style: { color: '#1565c0', scaleMultiplier: 1.2 },
            },
        ];
        p.elements.byFamily.well = { color: '#43a047', opacity: 1 };
        p.elements.byFamily.plume = { color: '#0288d1', opacity: 0.4 };
        p.scene = { background: '#0a1628' };
    }

    // ── 10. Vista Noturna / Campo ────────────────────────────────────────────
    // Fundo escuro profundo; poços em ciano brilhante; plumas em violeta.
    // Ideal para apresentações ou trabalho noturno em campo.
    {
        const p = createProfile('Vista Noturna');
        p.elements.byFamily.plume = { color: '#7b1fa2', opacity: 0.6 };
        p.elements.byFamily.well = { color: '#00e5ff', opacity: 1, scaleMultiplier: 1.1 };
        p.elements.byFamily.building = { color: '#ffd54f', opacity: 0.85 };
        p.elements.byFamily.tank = { color: '#ff5722', opacity: 0.9 };
        p.elements.byFamily.spring = { color: '#80deea', opacity: 0.9 };
        p.elements.byFamily.lake = { color: '#1565c0', opacity: 0.7 };
        p.elements.byFamily.river = { color: '#0288d1', opacity: 0.8 };
        p.elements.byFamily.boundary = { color: '#546e7a', opacity: 0.4 };
        p.scene = {
            background: '#00020a',
            ambientIntensity: 0.3,
            directionalIntensity: 1.5,
        };
    }

    // Persiste todas as modificações feitas nas referências dos perfis
    saveProfiles();
}
