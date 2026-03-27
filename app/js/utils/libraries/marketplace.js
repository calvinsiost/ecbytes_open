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
   MARKETPLACE — Catalog of available libraries (Dual-Source)
   Catalogo de bibliotecas disponiveis para instalacao

   Fonte dupla: Supabase (remoto) com fallback para BUILTIN_EXAMPLES.
   Quando online, busca do banco; quando offline, usa exemplos locais.
   ================================================================ */

import { getInstalledLibraries } from './manager.js';
import { fetchRemoteCatalog as _fetchRemote, getUserLikedSet } from './supabaseMarketplace.js';

// ----------------------------------------------------------------
// BUILTIN EXAMPLE LIBRARIES
// Bibliotecas de exemplo pre-definidas para demonstrar o sistema
// Servem como fallback offline e seed inicial do marketplace
// ----------------------------------------------------------------

export const BUILTIN_EXAMPLES = [
    {
        ecbytsLibrary: '1.0.0',
        id: 'conama-420-groundwater',
        name: 'CONAMA 420/2009 — Groundwater',
        version: '1.0.0',
        author: { name: 'ecbyts' },
        description:
            'Brazilian CONAMA 420/2009 groundwater quality criteria. Includes regulatory limits for BTEX, metals, and PAHs in groundwater and soil matrices.',
        license: 'MIT',
        tags: ['regulatory', 'brazil', 'groundwater', 'CONAMA'],
        icon: 'shield',
        dependencies: [],
        contents: {
            parameters: [
                {
                    id: 'vinyl_chloride',
                    name: 'Cloreto de vinila',
                    names: { en: 'Vinyl chloride', pt: 'Cloreto de vinila', es: 'Cloruro de vinilo' },
                    defaultUnitId: 'ug_L',
                    type: 'SI',
                    category: 'contaminant',
                },
                {
                    id: 'dichloroethene',
                    name: '1,2-Dicloroeteno',
                    names: { en: '1,2-Dichloroethene', pt: '1,2-Dicloroeteno', es: '1,2-Dicloroeteno' },
                    defaultUnitId: 'ug_L',
                    type: 'SI',
                    category: 'contaminant',
                },
                {
                    id: 'trichloroethene',
                    name: 'Tricloroeteno',
                    names: { en: 'Trichloroethene', pt: 'Tricloroeteno', es: 'Tricloroeteno' },
                    defaultUnitId: 'ug_L',
                    type: 'SI',
                    category: 'contaminant',
                },
            ],
            validationRules: {
                regulatoryLimits: {
                    '75-01-4': { groundwater: { max: 5, unit: 'ug_L', source: 'CONAMA 420/2009' } },
                    '156-59-2': { groundwater: { max: 50, unit: 'ug_L', source: 'CONAMA 420/2009' } },
                    '79-01-6': { groundwater: { max: 70, unit: 'ug_L', source: 'CONAMA 420/2009' } },
                },
            },
            agents: [
                {
                    id: 'conama-420-expert',
                    name: 'CONAMA 420 Specialist',
                    description: 'Expert in CONAMA 420/2009 groundwater and soil quality criteria',
                    systemPromptAddition:
                        'You are an expert in CONAMA 420/2009 — Brazilian soil and groundwater quality criteria for contaminated site management. Always cite specific articles and annexes. Cross-reference values with CETESB guiding values when applicable.',
                    icon: 'shield',
                },
            ],
            i18n: {
                en: {
                    conamaGroundwater: 'CONAMA 420 Groundwater',
                    conamaGroundwaterDesc: 'Brazilian groundwater quality standards',
                },
                pt: {
                    conamaGroundwater: 'CONAMA 420 Águas Subterrâneas',
                    conamaGroundwaterDesc: 'Padrões brasileiros de qualidade de águas subterrâneas',
                },
                es: {
                    conamaGroundwater: 'CONAMA 420 Aguas Subterráneas',
                    conamaGroundwaterDesc: 'Estándares brasileños de calidad de aguas subterráneas',
                },
            },
            lockedFields: [
                {
                    id: 'conama-420-badge',
                    type: 'ticker_badge',
                    lock: 'display',
                    content: { label: 'CONAMA 420/2009', icon: 'shield', color: '#2d8a7a' },
                },
            ],
        },
    },
    {
        ecbytsLibrary: '1.0.0',
        id: 'epa-rsls-screening',
        name: 'EPA RSLs — Regional Screening Levels',
        version: '1.0.0',
        author: { name: 'ecbyts' },
        description:
            'US EPA Regional Screening Levels for chemical contaminants in soil and groundwater. Risk-based values for residential and industrial land use.',
        license: 'MIT',
        tags: ['regulatory', 'usa', 'epa', 'screening'],
        icon: 'shield',
        dependencies: [],
        contents: {
            parameters: [
                {
                    id: 'pcbs_total',
                    name: 'PCBs Totais',
                    names: { en: 'Total PCBs', pt: 'PCBs Totais', es: 'PCBs Totales' },
                    defaultUnitId: 'mg_kg',
                    type: 'SI',
                    category: 'contaminant',
                },
                {
                    id: 'pfos',
                    name: 'PFOS',
                    names: { en: 'PFOS', pt: 'PFOS', es: 'PFOS' },
                    defaultUnitId: 'ug_L',
                    type: 'SI',
                    category: 'contaminant',
                },
                {
                    id: 'pfoa',
                    name: 'PFOA',
                    names: { en: 'PFOA', pt: 'PFOA', es: 'PFOA' },
                    defaultUnitId: 'ug_L',
                    type: 'SI',
                    category: 'contaminant',
                },
            ],
            validationRules: {
                regulatoryLimits: {
                    '1336-36-3': { soil: { max: 0.23, unit: 'mg_kg', source: 'EPA RSL 2024 (residential)' } },
                    '1763-23-1': { groundwater: { max: 0.07, unit: 'ug_L', source: 'EPA RSL 2024' } },
                    '335-67-1': { groundwater: { max: 0.004, unit: 'ug_L', source: 'EPA RSL 2024' } },
                },
            },
            agents: [
                {
                    id: 'epa-rsl-expert',
                    name: 'EPA RSL Specialist',
                    description: 'Expert in EPA Regional Screening Levels and risk assessment',
                    systemPromptAddition:
                        'You are an expert in US EPA Regional Screening Levels (RSLs). Always specify whether screening values are for residential or industrial land use. Reference the latest RSL tables and underlying toxicity values.',
                    icon: 'shield',
                },
            ],
            i18n: {
                en: { epaRsls: 'EPA RSLs', epaRslsDesc: 'US EPA Regional Screening Levels' },
                pt: { epaRsls: 'EPA RSLs', epaRslsDesc: 'Níveis de triagem regionais da EPA' },
                es: { epaRsls: 'EPA RSLs', epaRslsDesc: 'Niveles de detección regionales de la EPA' },
            },
            lockedFields: [
                {
                    id: 'epa-rsl-badge',
                    type: 'ticker_badge',
                    lock: 'display',
                    content: { label: 'EPA RSL 2024', icon: 'shield', color: '#3b6ea5' },
                },
            ],
        },
    },
    {
        ecbytsLibrary: '1.0.0',
        id: 'synthetic-monitoring-demo',
        name: 'Synthetic Monitoring Demo',
        version: '1.0.0',
        author: { name: 'ecbyts' },
        description:
            'Demonstration library with AI-generated hypothetical monitoring data. Includes locked disclaimer badge to warn users about synthetic data.',
        license: 'MIT',
        tags: ['demo', 'synthetic', 'training'],
        icon: 'sparkles',
        dependencies: [],
        contents: {
            families: {
                synthetic_well: {
                    id: 'synthetic_well',
                    name: 'Synthetic Well',
                    icon: 'well',
                    code: 'Y',
                    enabled: true,
                    custom: true,
                },
            },
            tickerItems: [
                {
                    label: 'Demo Wells: ',
                    filters: [{ dimension: 'family', operator: 'is', value: 'synthetic_well' }],
                    calculation: 'count',
                    precision: 0,
                    color: '#aa6633',
                },
            ],
            i18n: {
                en: { syntheticDemo: 'Synthetic Demo', hypotheticalData: 'Hypothetical Data' },
                pt: { syntheticDemo: 'Demo Sintético', hypotheticalData: 'Dados Hipotéticos' },
                es: { syntheticDemo: 'Demo Sintético', hypotheticalData: 'Datos Hipotéticos' },
            },
            lockedFields: [
                {
                    id: 'synthetic-disclaimer',
                    type: 'ticker_badge',
                    lock: 'display',
                    content: { label: '⚠ Hypothetical Data', icon: 'alert-triangle', color: '#c44' },
                },
                { id: 'synthetic-family-lock', type: 'family_enabled', lock: 'display', target: 'synthetic_well' },
            ],
        },
    },
    {
        ecbytsLibrary: '1.0.0',
        id: 'esg-reporting-pack',
        name: 'ESG Reporting Pack',
        version: '1.0.0',
        author: { name: 'ecbyts' },
        description:
            'Environmental, Social, and Governance reporting templates. Includes GRI-aligned parameters, benchmarks, and report template.',
        license: 'MIT',
        tags: ['esg', 'reporting', 'gri', 'sustainability'],
        icon: 'leaf',
        dependencies: [],
        contents: {
            parameters: [
                {
                    id: 'scope1_emissions',
                    name: 'Emissões Escopo 1',
                    names: { en: 'Scope 1 Emissions', pt: 'Emissões Escopo 1', es: 'Emisiones Alcance 1' },
                    defaultUnitId: 'tCO2e',
                    type: 'SI',
                    category: 'emission',
                },
                {
                    id: 'scope2_emissions',
                    name: 'Emissões Escopo 2',
                    names: { en: 'Scope 2 Emissions', pt: 'Emissões Escopo 2', es: 'Emisiones Alcance 2' },
                    defaultUnitId: 'tCO2e',
                    type: 'SI',
                    category: 'emission',
                },
                {
                    id: 'water_withdrawal',
                    name: 'Captação de água',
                    names: { en: 'Water Withdrawal', pt: 'Captação de água', es: 'Extracción de agua' },
                    defaultUnitId: 'm3',
                    type: 'SI',
                    category: 'physical',
                },
            ],
            validationRules: {
                benchmarks: {
                    scope1_intensity: {
                        industry_avg: 100,
                        top_quartile: 50,
                        world_class: 20,
                        unit: 'tCO2e_unit',
                        source: 'GRI 305',
                    },
                    water_intensity: {
                        industry_avg: 5,
                        top_quartile: 2,
                        world_class: 1,
                        unit: 'm3_unit',
                        source: 'GRI 303',
                    },
                },
            },
            reportTemplate: {
                title: 'ESG Compliance Report',
                content:
                    '<h1>ESG Compliance Report</h1><h2>1. Environmental Performance</h2><p>Scope 1 & 2 emissions, water withdrawal, waste generation metrics.</p><h2>2. Social Indicators</h2><p>Health & safety rates, community engagement metrics.</p><h2>3. Governance</h2><p>Compliance status, audit findings, corrective actions.</p>',
            },
            chatTools: [
                {
                    id: 'esg-advisor',
                    name: 'ESG Advisor',
                    description: 'Reviews data against GRI standards',
                    icon: 'leaf',
                    promptAddition:
                        'When analyzing data, always compare against GRI Standards (GRI 303 Water, GRI 305 Emissions, GRI 306 Waste). Highlight alignment or gaps with ESG reporting requirements.',
                },
            ],
            i18n: {
                en: { esgPack: 'ESG Reporting', esgPackDesc: 'GRI-aligned ESG reporting templates' },
                pt: { esgPack: 'Relatório ESG', esgPackDesc: 'Templates de relatório ESG alinhados ao GRI' },
                es: { esgPack: 'Informe ESG', esgPackDesc: 'Plantillas de informes ESG alineadas con GRI' },
            },
        },
    },
    {
        ecbytsLibrary: '1.0.0',
        id: 'sample-aerial-sentinel',
        name: 'Sentinel-2 Sample — S\u00e3o Paulo',
        version: '1.0.0',
        author: { name: 'ecbyts' },
        description:
            'Sample Sentinel-2 cloudless imagery (10m/px) for the S\u00e3o Paulo metropolitan region. Generated on-demand from open Sentinel-2 tiles — no API key required.',
        license: 'MIT',
        tags: ['imagery', 'satellite', 'brazil', 'sentinel-2'],
        icon: 'image',
        dependencies: [],
        contents: {
            imagery: [
                {
                    id: 'sentinel-sp-metro-2021',
                    name: 'S\u00e3o Paulo Metro — 2021',
                    bbox: [-23.65, -46.8, -23.45, -46.55],
                    resolution: '10m/px',
                    date: '2021-01-01',
                    format: 'jpeg',
                    source: 'sentinel-tiles',
                },
            ],
            i18n: {
                en: { sentinelSample: 'Sentinel-2 Sample', sentinelSampleDesc: 'Satellite imagery for S\u00e3o Paulo' },
                pt: {
                    sentinelSample: 'Amostra Sentinel-2',
                    sentinelSampleDesc: 'Imagem de sat\u00e9lite para S\u00e3o Paulo',
                },
                es: {
                    sentinelSample: 'Muestra Sentinel-2',
                    sentinelSampleDesc: 'Imagen satelital para S\u00e3o Paulo',
                },
            },
        },
    },
];

// ----------------------------------------------------------------
// CATALOG ACCESS — Dual-source (Supabase + builtin fallback)
// ----------------------------------------------------------------

/**
 * Get the full marketplace catalog (async, dual-source).
 * Tenta buscar do Supabase; se indisponivel, usa builtins.
 * Marca bibliotecas ja instaladas localmente.
 *
 * @param {string} [query] - Search query
 * @param {Object} [filters] - { tags: string[] }
 * @returns {Promise<{items: Object[], isOffline: boolean}>}
 */
export async function getMarketplaceCatalog(query = '', filters = {}) {
    const installedIds = new Set(getInstalledLibraries().map((l) => l.manifest.id));

    // Try remote first
    const remote = await _fetchRemote(query, filters).catch(() => null);

    if (remote && remote.length > 0) {
        // Merge: remote items + builtins not in remote
        const remoteLibIds = new Set(remote.map((r) => r.library_id));
        const missingBuiltins = _getFilteredBuiltins(query, filters)
            .filter((b) => !remoteLibIds.has(b.id))
            .map((b) => _builtinToRemoteShape(b));

        const merged = [...remote, ...missingBuiltins].map((lib) => ({
            ...lib,
            _installed: installedIds.has(lib.library_id || lib.id),
        }));

        // Fetch liked set for current user
        const dbIds = merged.filter((m) => m.id && m._isRemote).map((m) => m.id);
        const likedSet = await getUserLikedSet(dbIds);
        merged.forEach((m) => {
            m._liked = likedSet.has(m.id);
        });

        return { items: merged, isOffline: false };
    }

    // Fallback to builtins
    const builtins = _getFilteredBuiltins(query, filters).map((lib) => ({
        ..._builtinToRemoteShape(lib),
        _installed: installedIds.has(lib.id),
    }));

    return { items: builtins, isOffline: true };
}

/**
 * Offline-only catalog (sync, for internal use).
 * Comportamento original: retorna builtins marcados com _installed.
 *
 * @returns {Object[]}
 */
export function getMarketplaceCatalogOffline() {
    const installedIds = new Set(getInstalledLibraries().map((l) => l.manifest.id));
    return BUILTIN_EXAMPLES.map((lib) => ({
        ...lib,
        _installed: installedIds.has(lib.id),
    }));
}

/**
 * Search catalog (async, dual-source).
 * @param {string} query
 * @param {Object} [filters]
 * @returns {Promise<{items: Object[], isOffline: boolean}>}
 */
export async function searchCatalog(query, filters = {}) {
    return getMarketplaceCatalog(query, filters);
}

/**
 * Get full details for a specific catalog library.
 * Busca no catalogo remoto primeiro, depois nos builtins.
 *
 * @param {string} libraryId - manifest.id (e.g., 'conama-420-groundwater')
 * @returns {Object|undefined} manifest object (builtin fallback)
 */
export function getLibraryDetails(libraryId) {
    return BUILTIN_EXAMPLES.find((lib) => lib.id === libraryId);
}

/**
 * Collect all unique tags from the builtin catalog.
 * Retorna todas as tags unicas do catalogo builtin.
 * @returns {string[]}
 */
export function getAllBuiltinTags() {
    const tags = new Set();
    BUILTIN_EXAMPLES.forEach((lib) => (lib.tags || []).forEach((t) => tags.add(t)));
    return [...tags].sort();
}

// ----------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------

/**
 * Filter builtins by query and tags (offline search).
 * @param {string} query
 * @param {Object} filters
 * @returns {Object[]}
 */
function _getFilteredBuiltins(query, filters) {
    let results = [...BUILTIN_EXAMPLES];

    if (query && query.trim()) {
        const q = query.trim().toLowerCase();
        results = results.filter(
            (lib) =>
                lib.name.toLowerCase().includes(q) ||
                lib.description.toLowerCase().includes(q) ||
                (lib.tags || []).some((tag) => tag.toLowerCase().includes(q)) ||
                lib.author?.name?.toLowerCase().includes(q),
        );
    }

    if (filters.tags && filters.tags.length > 0) {
        results = results.filter((lib) => filters.tags.some((t) => (lib.tags || []).includes(t)));
    }

    return results;
}

/**
 * Convert a builtin example to the same shape as a remote library.
 * Normaliza campos para que o handler de render funcione igual.
 *
 * @param {Object} builtin
 * @returns {Object}
 */
function _builtinToRemoteShape(builtin) {
    return {
        id: null, // no DB UUID
        library_id: builtin.id,
        manifest: builtin,
        name: builtin.name,
        description: builtin.description || '',
        version: builtin.version || '1.0.0',
        icon: builtin.icon || 'package',
        is_paid: false,
        price_cents: 0,
        currency: 'usd',
        likes_count: 0,
        comments_count: 0,
        avg_rating: 0,
        total_ratings: 0,
        install_count: 0,
        status: 'published',
        _creatorName: builtin.author?.name || 'ecbyts',
        _creatorType: 'common',
        _creatorStatus: 'none',
        _charityPct: 0,
        _charityName: null,
        _isRemote: false,
        _liked: false,
        tags: builtin.tags || [],
    };
}
