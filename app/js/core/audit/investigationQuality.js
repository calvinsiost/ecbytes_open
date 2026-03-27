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
   INVESTIGATION QUALITY — Domain-specific environmental checks
   ================================================================

   Verifica a qualidade da investigacao ambiental:
   - Metodos de investigacao ultrapassados (trado manual, etc.)
   - Integridade hidroestratigrafica (pocos cruzando unidades)
   - Cobertura espacial dos pontos de monitoramento
   - Cobertura temporal (lacunas nas campanhas)
   - Completude de parametros analiticos

   ================================================================ */

import { getAllElements } from '../elements/manager.js';
import { getAllCampaigns } from '../campaigns/manager.js';
import { calculateCoverage, findGaps } from '../analytics/spatial.js';

// ================================================================
// PATTERN DICTIONARIES
// Dicionarios de padroes para deteccao
// ================================================================

/**
 * Outdated investigation methods.
 * Metodos de investigacao ultrapassados ou inadequados.
 */
const OUTDATED_METHODS = [
    {
        pattern: /trado\s+manual/gi,
        severity: 'high',
        finding:
            'Manual auger boring (trado manual) — limited depth, disturbs samples, inadequate for volatile compounds',
        recommendation: 'Use direct-push (Geoprobe) or hollow-stem auger with continuous sampling',
    },
    {
        pattern: /hand\s+auger/gi,
        severity: 'high',
        finding: 'Hand auger — same limitations as trado manual',
        recommendation: 'Use direct-push (Geoprobe) or hollow-stem auger',
    },
    {
        pattern: /sondagem\s+manual/gi,
        severity: 'high',
        finding: 'Manual boring — limited sample quality and depth capability',
        recommendation: 'Use mechanized drilling with appropriate methods for target depth',
    },
    {
        pattern: /trado\s+mec[aâ]nico\s+sem\s+revestimento/gi,
        severity: 'medium',
        finding: 'Mechanized auger without casing — risk of cross-contamination between layers',
        recommendation: 'Use cased drilling or direct-push technology',
    },
    {
        pattern: /sondagem\s+[aà]\s+percuss[aã]o/gi,
        severity: 'medium',
        finding: 'Percussion boring without complementary methods — limited stratigraphic resolution',
        recommendation: 'Complement with continuous core sampling or direct-push',
    },
    {
        pattern: /coleta\s+(?:com\s+)?balde/gi,
        severity: 'high',
        finding: 'Bucket sampling — unacceptable for groundwater quality samples',
        recommendation: 'Use low-flow sampling (micropurge) per ASTM D6771 or equivalent',
    },
    {
        pattern: /purga\s+(?:de\s+)?3\s+volumes/gi,
        severity: 'medium',
        finding: 'Three-volume purge method — outdated, causes excessive turbidity and volatile loss',
        recommendation: 'Use low-flow (micropurge) sampling per EPA SESDGUID-GW-001',
    },
    {
        pattern: /bailer/gi,
        severity: 'medium',
        finding: 'Bailer sampling — causes aeration and volatile loss',
        recommendation: 'Use dedicated bladder pump or peristaltic pump for low-flow sampling',
    },
];

/**
 * Required parameters by contamination type.
 * Parametros obrigatorios por tipo de contaminacao.
 */
const REQUIRED_PARAMS = {
    btex: {
        required: ['benzene', 'toluene', 'ethylbenzene', 'xylenes'],
        recommended: ['naphthalene', 'tph_gas', 'mtbe'],
        standard: 'CONAMA 420/2009',
    },
    metals_heavy: {
        required: ['lead', 'cadmium', 'chromium', 'mercury', 'arsenic'],
        recommended: ['nickel', 'copper', 'zinc', 'selenium'],
        standard: 'CONAMA 420/2009',
    },
    pah: {
        required: ['naphthalene', 'benzo_a_pyrene', 'anthracene'],
        recommended: ['fluoranthene', 'pyrene', 'chrysene'],
        standard: 'CONAMA 420/2009',
    },
    chlorinated: {
        required: ['tce', 'pce', 'vinyl_chloride', 'dcm'],
        recommended: ['chloroform', 'carbon_tetrachloride'],
        standard: 'CONAMA 420/2009',
    },
    pesticides: {
        required: ['aldrin', 'dieldrin', 'ddt', 'lindane'],
        recommended: ['heptachlor', 'endrin', 'chlordane'],
        standard: 'CONAMA 420/2009, Stockholm Convention',
    },
};

// ================================================================
// METHOD QUALITY CHECK
// Verifica metodos de investigacao no texto do relatorio
// ================================================================

/**
 * Check for outdated investigation methods in report text.
 * Detecta metodos de investigacao ultrapassados no texto.
 *
 * @param {string} reportText - Report text content
 * @returns {Array<{severity, category, finding, recommendation, match}>}
 */
export function checkInvestigationMethods(reportText) {
    if (!reportText) return [];

    const findings = [];

    for (const method of OUTDATED_METHODS) {
        const matches = reportText.match(method.pattern);
        if (matches) {
            findings.push({
                severity: method.severity,
                category: 'OUTDATED_METHODS',
                finding: method.finding,
                recommendation: method.recommendation,
                match: matches[0],
                count: matches.length,
            });
        }
    }

    return findings;
}

// ================================================================
// HYDROSTRATIGRAPHIC INTEGRITY
// Verifica se pocos cruzam multiplas unidades hidroestratigraficas
// ================================================================

/**
 * Check if monitoring wells cross multiple hydrostratigraphic units.
 * Verifica se pocos de monitoramento atravessam mais de uma unidade.
 *
 * @param {Object[]} elements - Array of model elements (optional, defaults to all)
 * @returns {Array<{severity, category, finding, elementId, elementName}>}
 */
export function checkHydrostratigraphicIntegrity(elements = null) {
    const allElements = elements || getAllElements();
    const findings = [];

    // Get wells
    const wells = allElements.filter((el) => el.family === 'well');

    for (const well of wells) {
        const data = well.data;
        if (!data) continue;

        // Check if well has strata/screen data
        const totalDepth = data.totalDepth || data.depth || 0;
        const screenTop = data.screenTop || data.filterTop || null;
        const screenBottom = data.screenBottom || data.filterBottom || null;
        const strata = data.strata || data.lithology || [];

        // Flag 1: Very deep wells without nested well design
        if (totalDepth > 30 && !data.nestedWell && !data.multiLevel) {
            // Check if strata data shows multiple units
            if (strata.length >= 2) {
                const uniqueUnits = new Set(strata.map((s) => s.unit || s.aquifer || s.formation).filter(Boolean));
                if (uniqueUnits.size > 1) {
                    findings.push({
                        severity: 'high',
                        category: 'HYDROSTRAT_VIOLATION',
                        finding: `Well "${well.name}" (depth ${totalDepth}m) crosses ${uniqueUnits.size} hydrostratigraphic units: ${[...uniqueUnits].join(', ')}`,
                        recommendation: 'Install nested wells or multi-level monitoring system for each unit',
                        elementId: well.id,
                        elementName: well.name,
                    });
                }
            }
        }

        // Flag 2: Screen interval spanning multiple units
        if (screenTop !== null && screenBottom !== null && strata.length >= 2) {
            const screenedUnits = strata.filter((s) => {
                const strataTop = s.top || 0;
                const strataBottom = s.bottom || s.top || 0;
                return screenTop <= strataBottom && screenBottom >= strataTop;
            });

            const uniqueScreenedUnits = new Set(
                screenedUnits.map((s) => s.unit || s.aquifer || s.formation).filter(Boolean),
            );

            if (uniqueScreenedUnits.size > 1) {
                findings.push({
                    severity: 'critical',
                    category: 'HYDROSTRAT_VIOLATION',
                    finding: `Well "${well.name}" filter screen (${screenTop}-${screenBottom}m) spans ${uniqueScreenedUnits.size} units: ${[...uniqueScreenedUnits].join(', ')}`,
                    recommendation: 'Reconstruct well with screen in single hydrostratigraphic unit',
                    elementId: well.id,
                    elementName: well.name,
                });
            }
        }

        // Flag 3: Very long screen intervals (>6m) without justification
        if (screenTop !== null && screenBottom !== null) {
            const screenLength = Math.abs(screenBottom - screenTop);
            if (screenLength > 6) {
                findings.push({
                    severity: 'medium',
                    category: 'HYDROSTRAT_VIOLATION',
                    finding: `Well "${well.name}" has ${screenLength.toFixed(1)}m screen interval — may span multiple units`,
                    recommendation:
                        'Verify screen interval targets single hydrostratigraphic unit (max 3-6m recommended)',
                    elementId: well.id,
                    elementName: well.name,
                });
            }
        }
    }

    return findings;
}

// ================================================================
// SPATIAL COVERAGE CHECK
// Verifica cobertura espacial dos pontos de monitoramento
// ================================================================

/**
 * Check monitoring spatial coverage adequacy.
 * Verifica se a cobertura espacial e adequada.
 *
 * @param {Object[]} elements - Array of model elements (optional)
 * @returns {Array<{severity, category, finding, recommendation}>}
 */
export function checkSpatialCoverage(elements = null) {
    const allElements = elements || getAllElements();
    const findings = [];

    const coverage = calculateCoverage(allElements);
    const gaps = findGaps(allElements);

    // Low coverage warning
    if (coverage.coverage < 0.5 && coverage.pointCount >= 2) {
        findings.push({
            severity: 'high',
            category: 'COVERAGE_GAP',
            finding: `Monitoring coverage is only ${(coverage.coverage * 100).toFixed(1)}% of study area`,
            recommendation: 'Install additional monitoring points to achieve >70% coverage',
        });
    } else if (coverage.coverage < 0.7 && coverage.pointCount >= 2) {
        findings.push({
            severity: 'medium',
            category: 'COVERAGE_GAP',
            finding: `Monitoring coverage is ${(coverage.coverage * 100).toFixed(1)}% — below recommended 70%`,
            recommendation: 'Consider additional monitoring points in gap areas',
        });
    }

    // Large gaps
    const largeGaps = gaps.filter((g) => g.nearestDistance > 100);
    if (largeGaps.length > 0) {
        findings.push({
            severity: 'high',
            category: 'COVERAGE_GAP',
            finding: `${largeGaps.length} areas with >100m from nearest monitoring point`,
            recommendation: 'Install monitoring wells in identified gap areas',
        });
    }

    // Check for plume without surrounding wells
    const plumes = allElements.filter((el) => el.family === 'plume');
    const wells = allElements.filter((el) => el.family === 'well');

    for (const plume of plumes) {
        const plumeCenter = plume.data?.center;
        if (!plumeCenter) continue;

        // Count wells near plume
        let nearbyWells = 0;
        let hasUpgradient = false;
        let hasDowngradient = false;

        for (const well of wells) {
            const wCoords = well.data?.coordinates;
            if (!wCoords) continue;

            const dx = (wCoords.easting || 0) - (plumeCenter.x || 0);
            const dz = (wCoords.northing || 0) - (plumeCenter.z || 0);
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < 150) {
                nearbyWells++;
                // Simple heuristic: wells "behind" plume are upgradient
                if (dz > 0) hasUpgradient = true;
                if (dz < 0) hasDowngradient = true;
            }
        }

        if (nearbyWells < 3) {
            findings.push({
                severity: 'high',
                category: 'COVERAGE_GAP',
                finding: `Plume "${plume.name}" has only ${nearbyWells} monitoring well(s) within 150m`,
                recommendation: 'Install minimum 3 wells around plume (upgradient + lateral + downgradient)',
            });
        }

        if (!hasUpgradient) {
            findings.push({
                severity: 'medium',
                category: 'COVERAGE_GAP',
                finding: `No upgradient (background) well detected for plume "${plume.name}"`,
                recommendation: 'Install background well upgradient of contamination source',
            });
        }
    }

    return findings;
}

// ================================================================
// TEMPORAL COVERAGE CHECK
// Verifica cobertura temporal das campanhas
// ================================================================

/**
 * Check temporal monitoring coverage.
 * Verifica se as campanhas cobrem adequadamente o periodo de monitoramento.
 *
 * @param {Object[]} campaigns - Campaigns (optional, defaults to all)
 * @param {Object[]} elements - Elements with observations (optional)
 * @returns {Array<{severity, category, finding, recommendation}>}
 */
export function checkTemporalCoverage(campaigns = null, elements = null) {
    const allCampaigns = campaigns || getAllCampaigns();
    const allElements = elements || getAllElements();
    const findings = [];

    if (allCampaigns.length === 0) {
        findings.push({
            severity: 'medium',
            category: 'TEMPORAL_GAP',
            finding: 'No monitoring campaigns registered',
            recommendation: 'Register campaigns with dates to enable temporal analysis',
        });
        return findings;
    }

    // Sort campaigns by date
    const sortedCampaigns = [...allCampaigns]
        .filter((c) => c.startDate)
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    if (sortedCampaigns.length < 2) return findings;

    // Check for large gaps between campaigns
    for (let i = 1; i < sortedCampaigns.length; i++) {
        const prev = new Date(sortedCampaigns[i - 1].startDate);
        const curr = new Date(sortedCampaigns[i].startDate);
        const gapDays = (curr - prev) / (1000 * 60 * 60 * 24);

        if (gapDays > 180) {
            findings.push({
                severity: 'high',
                category: 'TEMPORAL_GAP',
                finding: `${Math.round(gapDays)}-day gap between campaigns "${sortedCampaigns[i - 1].name}" and "${sortedCampaigns[i].name}"`,
                recommendation: 'Maintain quarterly monitoring frequency (max 90-day intervals)',
            });
        } else if (gapDays > 120) {
            findings.push({
                severity: 'medium',
                category: 'TEMPORAL_GAP',
                finding: `${Math.round(gapDays)}-day gap between campaigns — exceeds quarterly frequency`,
                recommendation: 'Consider increasing monitoring frequency to quarterly',
            });
        }
    }

    // Check total monitoring duration
    const firstDate = new Date(sortedCampaigns[0].startDate);
    const lastDate = new Date(sortedCampaigns[sortedCampaigns.length - 1].startDate);
    const totalMonths = (lastDate - firstDate) / (1000 * 60 * 60 * 24 * 30);

    if (totalMonths < 12 && sortedCampaigns.length >= 2) {
        findings.push({
            severity: 'medium',
            category: 'TEMPORAL_GAP',
            finding: `Total monitoring period is only ${Math.round(totalMonths)} months — insufficient for trend analysis`,
            recommendation: 'Minimum 12 months (4 quarterly campaigns) recommended for reliable trends',
        });
    }

    // Check seasonal coverage
    const months = sortedCampaigns.map((c) => new Date(c.startDate).getMonth());
    const seasons = new Set(
        months.map((m) => {
            if (m <= 1 || m === 11) return 'wet_summer'; // Dec-Feb (BR)
            if (m >= 2 && m <= 4) return 'transition_fall';
            if (m >= 5 && m <= 7) return 'dry_winter';
            return 'transition_spring';
        }),
    );

    if (seasons.size < 2 && sortedCampaigns.length >= 3) {
        findings.push({
            severity: 'medium',
            category: 'TEMPORAL_GAP',
            finding: `Campaigns cover only ${seasons.size} season(s) — seasonal variation not captured`,
            recommendation: 'Include campaigns in both wet and dry seasons for seasonal variability assessment',
        });
    }

    return findings;
}

// ================================================================
// PARAMETER COMPLETENESS CHECK
// Verifica se os parametros obrigatorios estao presentes
// ================================================================

/**
 * Check if required parameters are present for declared contamination type.
 * Verifica completude dos parametros analiticos.
 *
 * @param {Object[]} elements - Elements with observations (optional)
 * @param {string} contaminationType - Type of contamination (e.g., 'btex', 'metals_heavy')
 * @returns {Array<{severity, category, finding, recommendation}>}
 */
export function checkParameterCompleteness(elements = null, contaminationType = null) {
    const allElements = elements || getAllElements();
    const findings = [];

    // Collect all observed parameter IDs
    const observedParams = new Set();
    for (const el of allElements) {
        if (el.data?.observations) {
            el.data.observations.forEach((obs) => {
                if (obs.parameterId) observedParams.add(obs.parameterId);
            });
        }
    }

    if (observedParams.size === 0) return findings;

    // Auto-detect contamination type if not specified
    const typesToCheck = contaminationType ? [contaminationType] : detectContaminationTypes(observedParams);

    for (const type of typesToCheck) {
        const reqDef = REQUIRED_PARAMS[type];
        if (!reqDef) continue;

        const missing = reqDef.required.filter((p) => !observedParams.has(p));
        const missingRecommended = reqDef.recommended.filter((p) => !observedParams.has(p));

        if (missing.length > 0) {
            findings.push({
                severity: 'high',
                category: 'PARAM_COMPLETENESS',
                finding: `Missing required parameters for ${type}: ${missing.join(', ')}`,
                recommendation: `Add ${missing.join(', ')} per ${reqDef.standard}`,
            });
        }

        if (missingRecommended.length > 0) {
            findings.push({
                severity: 'low',
                category: 'PARAM_COMPLETENESS',
                finding: `Missing recommended parameters for ${type}: ${missingRecommended.join(', ')}`,
                recommendation: `Consider adding ${missingRecommended.join(', ')} for comprehensive assessment`,
            });
        }
    }

    return findings;
}

/**
 * Auto-detect contamination types from observed parameters.
 * @param {Set<string>} observedParams
 * @returns {string[]}
 */
function detectContaminationTypes(observedParams) {
    const types = [];

    // Check BTEX
    if (observedParams.has('benzene') || observedParams.has('toluene')) {
        types.push('btex');
    }

    // Check heavy metals
    if (observedParams.has('lead') || observedParams.has('cadmium') || observedParams.has('arsenic')) {
        types.push('metals_heavy');
    }

    // Check PAH
    if (observedParams.has('naphthalene') || observedParams.has('benzo_a_pyrene')) {
        types.push('pah');
    }

    // Check chlorinated
    if (observedParams.has('tce') || observedParams.has('pce') || observedParams.has('vinyl_chloride')) {
        types.push('chlorinated');
    }

    return types;
}

// ================================================================
// EXPORTS
// ================================================================

export { REQUIRED_PARAMS, OUTDATED_METHODS };
