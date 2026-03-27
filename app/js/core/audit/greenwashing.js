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
   GREENWASHING AUDIT — Cross-validate ESG claims against data
   ================================================================

   Orquestrador principal do modulo de auditoria.
   Executa 3 camadas de analise:

   LAYER 1: Testes estatisticos (app-side)
   - Lei de Benford (primeiros digitos)
   - Deteccao de outliers (Z-score, IQR)

   LAYER 2: Qualidade da investigacao (app-side, rule-based)
   - Metodos ultrapassados
   - Integridade hidroestratigrafica
   - Cobertura espacial e temporal
   - Completude de parametros

   LAYER 3: Analise semantica via LLM
   - Extrai alegacoes do texto
   - Valida contra dados reais
   - Detecta linguagem vaga

   OUTPUT: ESG Dissonance Report + Reliability Index (0-100)

   ================================================================ */

import { benfordTest } from './benford.js';
import {
    checkInvestigationMethods,
    checkHydrostratigraphicIntegrity,
    checkSpatialCoverage,
    checkTemporalCoverage,
    checkParameterCompleteness,
} from './investigationQuality.js';
import { getAllElements } from '../elements/manager.js';
import { getAllCampaigns } from '../campaigns/manager.js';
import { detectOutlierZScore, detectOutlierIQR, calculateStats } from '../validation/rules.js';
import { sendMessage, hasApiKey } from '../llm/client.js';

// ================================================================
// AUDIT CATEGORIES
// Categorias de achados da auditoria
// ================================================================

export const AuditCategories = {
    VAGUE_CLAIMS: 'Vague or unsubstantiated claims',
    MISSING_DATA: 'Missing baseline, scope, or verification data',
    MATH_ERRORS: 'Mathematical inconsistencies',
    CHERRY_PICKING: 'Selective reporting of favorable metrics',
    OUTDATED_DATA: 'Data older than acceptable reporting period',
    NO_VERIFICATION: 'No third-party verification',
    OUTDATED_METHODS: 'Outdated investigation methods',
    HYDROSTRAT_VIOLATION: 'Hydrostratigraphic integrity violation',
    DATA_FABRICATION: 'Statistical patterns suggesting fabrication',
    COVERAGE_GAP: 'Monitoring coverage gap',
    TEMPORAL_GAP: 'Temporal monitoring gap',
    PARAM_COMPLETENESS: 'Parameter completeness issue',
};

// ================================================================
// VAGUE LANGUAGE PATTERNS
// Padroes de linguagem vaga sem metricas
// ================================================================

const VAGUE_PATTERNS = [
    { pattern: /eco[- ]?friendly/gi, term: 'eco-friendly' },
    { pattern: /sustain\w*/gi, term: 'sustainable/sustainability' },
    { pattern: /green\s+(?:solution|product|approach|initiative)/gi, term: 'green (adjective)' },
    { pattern: /carbon[- ]?neutral/gi, term: 'carbon neutral' },
    { pattern: /net[- ]?zero/gi, term: 'net zero' },
    { pattern: /clean(?:er)?\s+(?:energy|technology|solution)/gi, term: 'clean (adjective)' },
    { pattern: /environmentally\s+(?:responsible|conscious|aware)/gi, term: 'environmentally responsible' },
    { pattern: /100%\s+(?:natural|organic|recycled)/gi, term: '100% claim' },
    { pattern: /impacto\s+(?:zero|nulo|negligenciavel|insignificante)/gi, term: 'impacto zero/negligível' },
    { pattern: /ambientalmente\s+(?:responsavel|correto|adequado)/gi, term: 'ambientalmente responsável' },
    { pattern: /totalmente\s+(?:limpo|seguro|natural)/gi, term: 'totalmente limpo/seguro' },
];

// ================================================================
// LAYER 1: STATISTICAL TESTS
// Testes estatisticos nos dados do modelo
// ================================================================

/**
 * Run statistical fraud detection tests on model data.
 * Executa testes estatisticos de deteccao de fraude.
 *
 * @param {Object[]} elements - Model elements
 * @returns {Object} { benford, outliers, findings }
 */
export function runStatisticalTests(elements = null) {
    const allElements = elements || getAllElements();
    const findings = [];

    // Collect all observation values
    const allValues = [];
    const elementValues = {};

    for (const el of allElements) {
        if (!el.data?.observations) continue;

        const vals = el.data.observations.map((o) => parseFloat(o.value)).filter((v) => isFinite(v) && v !== 0);

        allValues.push(...vals);
        if (vals.length > 0) {
            elementValues[el.id] = { name: el.name, values: vals };
        }
    }

    // Benford's Law test on all values
    const benford = benfordTest(allValues);

    if (benford.conformity === 'non-conforming') {
        findings.push({
            severity: 'high',
            category: 'DATA_FABRICATION',
            finding: `Benford's Law: First-digit distribution is non-conforming (χ²=${benford.chiSquared.toFixed(2)}, p=${benford.pValue.toFixed(4)})`,
            recommendation:
                'Review data collection procedures — digit distribution suggests possible fabrication or systematic bias',
        });
    } else if (benford.conformity === 'suspicious') {
        findings.push({
            severity: 'medium',
            category: 'DATA_FABRICATION',
            finding: `Benford's Law: First-digit distribution is suspicious (χ²=${benford.chiSquared.toFixed(2)}, p=${benford.pValue.toFixed(4)})`,
            recommendation: 'Verify data entry procedures and original laboratory reports',
        });
    }

    // Outlier detection per element
    const outlierSummary = [];
    for (const [elId, data] of Object.entries(elementValues)) {
        if (data.values.length < 5) continue;

        const stats = calculateStats(data.values);
        let outlierCount = 0;

        for (const val of data.values) {
            const zResult = detectOutlierZScore(val, stats.mean, stats.stdDev);
            const iqrResult = detectOutlierIQR(val, stats.q1, stats.q3);
            if (zResult || iqrResult) outlierCount++;
        }

        if (outlierCount > 0) {
            const pct = ((outlierCount / data.values.length) * 100).toFixed(1);
            outlierSummary.push({
                elementId: elId,
                elementName: data.name,
                outlierCount,
                totalValues: data.values.length,
                percentage: pct,
            });

            if (outlierCount / data.values.length > 0.2) {
                findings.push({
                    severity: 'medium',
                    category: 'DATA_FABRICATION',
                    finding: `${data.name}: ${outlierCount}/${data.values.length} values (${pct}%) are statistical outliers`,
                    recommendation: 'Verify flagged values against original lab reports',
                });
            }
        }
    }

    return { benford, outliers: outlierSummary, findings };
}

// ================================================================
// LAYER 2: INVESTIGATION QUALITY
// Verificacoes de qualidade da investigacao
// ================================================================

/**
 * Run all investigation quality checks.
 * Executa todas as verificacoes de qualidade.
 *
 * @param {string} reportText - Report text (for method checks)
 * @param {Object[]} elements - Model elements
 * @returns {Object} { methods, hydrostratigraphic, spatial, temporal, parameters, findings }
 */
export function runQualityChecks(reportText, elements = null) {
    const allElements = elements || getAllElements();

    const methods = reportText ? checkInvestigationMethods(reportText) : [];
    const hydrostratigraphic = checkHydrostratigraphicIntegrity(allElements);
    const spatial = checkSpatialCoverage(allElements);
    const temporal = checkTemporalCoverage(null, allElements);
    const parameters = checkParameterCompleteness(allElements);

    const findings = [...methods, ...hydrostratigraphic, ...spatial, ...temporal, ...parameters];

    return { methods, hydrostratigraphic, spatial, temporal, parameters, findings };
}

// ================================================================
// LAYER 3: LLM SEMANTIC ANALYSIS
// Analise semantica via LLM
// ================================================================

/**
 * Detect vague language in text (rule-based, no LLM needed).
 * Detecta linguagem vaga no texto (sem LLM).
 *
 * @param {string} text
 * @returns {Array<{severity, category, finding, match}>}
 */
export function detectVagueLanguage(text) {
    if (!text) return [];

    const findings = [];

    for (const vp of VAGUE_PATTERNS) {
        const matches = text.match(vp.pattern);
        if (matches) {
            findings.push({
                severity: 'medium',
                category: 'VAGUE_CLAIMS',
                finding: `Vague term "${vp.term}" used ${matches.length} time(s) without quantitative metrics`,
                match: matches[0],
                count: matches.length,
            });
        }
    }

    return findings;
}

/**
 * Extract claims and cross-validate via LLM.
 * Extrai alegacoes e valida via LLM contra dados reais.
 *
 * @param {string} reportText - Report text
 * @param {Object[]} elements - Model elements with observations
 * @returns {Promise<Array<{claim, verdict, evidence, severity, category}>>}
 */
export async function extractAndValidateClaims(reportText, elements = null) {
    if (!hasApiKey() || !reportText) return [];

    const allElements = elements || getAllElements();

    // Build model context for LLM
    const modelSummary = allElements
        .map((el) => {
            const obsCount = el.data?.observations?.length || 0;
            const lastObs = el.data?.observations?.slice(-3) || [];
            const obsDetail = lastObs
                .map((o) => `${o.parameterId}: ${o.value} ${o.unitId || ''} (${o.date || 'no date'})`)
                .join('; ');
            return `- ${el.name} (${el.family}): ${obsCount} obs. Latest: ${obsDetail || 'none'}`;
        })
        .join('\n');

    const systemPrompt = `You are an ESG auditor specialized in environmental greenwashing detection.
Analyze the report text below and compare its claims against the actual monitoring data.

ACTUAL MODEL DATA:
${modelSummary}

For each environmental claim found in the text, evaluate whether it is:
- SUPPORTED: backed by the model data
- UNSUPPORTED: no data to confirm or deny
- CONTRADICTED: model data contradicts the claim
- VAGUE: claim is too vague to verify

Return JSON array:
[
    {
        "claim": "the extracted claim text",
        "verdict": "SUPPORTED|UNSUPPORTED|CONTRADICTED|VAGUE",
        "evidence": "explanation with specific data references",
        "severity": "low|medium|high",
        "category": "VAGUE_CLAIMS|MISSING_DATA|CHERRY_PICKING|MATH_ERRORS"
    }
]

Be specific and cite actual values from the model data when contradicting claims.`;

    const userMessage = `REPORT TEXT:\n\n${reportText.substring(0, 6000)}`;

    try {
        const response = await sendMessage(systemPrompt, userMessage, { maxTokens: 2000 });
        const jsonMatch = response.content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return [];
    } catch (e) {
        console.error('LLM claim validation error:', e);
        return [];
    }
}

// ================================================================
// RELIABILITY INDEX
// Calcula o indice de confiabilidade (0-100)
// ================================================================

/**
 * Calculate reliability index from all findings.
 * Calcula o indice de confiabilidade baseado nos achados.
 *
 * @param {Array} findings - All findings from all layers
 * @returns {{ score: number, grade: string, redFlags: string[] }}
 */
export function calculateReliabilityIndex(findings) {
    if (!findings || findings.length === 0) {
        return { score: 100, grade: 'A', redFlags: [] };
    }

    // Weight by severity
    const weights = {
        critical: 15,
        high: 10,
        medium: 5,
        low: 2,
    };

    let totalPenalty = 0;
    const redFlags = [];

    for (const f of findings) {
        const severity = f.severity || 'medium';
        const penalty = weights[severity] || 5;
        totalPenalty += penalty;

        if (severity === 'critical' || severity === 'high') {
            redFlags.push(f.finding);
        }
    }

    // Score: 100 minus penalties, clamped to 0-100
    const score = Math.max(0, Math.min(100, 100 - totalPenalty));

    // Grade
    let grade;
    if (score >= 90) grade = 'A';
    else if (score >= 75) grade = 'B';
    else if (score >= 60) grade = 'C';
    else if (score >= 40) grade = 'D';
    else grade = 'F';

    return { score, grade, redFlags };
}

// ================================================================
// MAIN ORCHESTRATOR
// Orquestrador principal: executa todas as 3 camadas
// ================================================================

/**
 * Run full audit analysis (all 3 layers).
 * Executa a auditoria completa (3 camadas).
 *
 * @param {string} reportText - Report text for analysis
 * @returns {Promise<Object>} Full audit results
 */
export async function analyzeReport(reportText) {
    const elements = getAllElements();
    const campaigns = getAllCampaigns();

    // Layer 1: Statistical tests (sync)
    const statistical = runStatisticalTests(elements);

    // Layer 2: Quality checks (sync)
    const quality = runQualityChecks(reportText, elements);

    // Rule-based vague language (sync)
    const vagueFindings = detectVagueLanguage(reportText);

    // Layer 3: LLM claim validation (async)
    let claims = [];
    if (hasApiKey() && reportText) {
        claims = await extractAndValidateClaims(reportText, elements);
    }

    // Aggregate all findings
    const allFindings = [
        ...statistical.findings,
        ...quality.findings,
        ...vagueFindings,
        ...claims
            .filter((c) => c.verdict !== 'SUPPORTED')
            .map((c) => ({
                severity: c.severity || 'medium',
                category: c.category || 'VAGUE_CLAIMS',
                finding: `Claim: "${c.claim}" — ${c.verdict}: ${c.evidence}`,
            })),
    ];

    // Calculate reliability index
    const reliability = calculateReliabilityIndex(allFindings);

    return {
        statistical,
        quality,
        vagueLanguage: vagueFindings,
        claims,
        allFindings,
        reliability,
        summary: {
            totalFindings: allFindings.length,
            critical: allFindings.filter((f) => f.severity === 'critical').length,
            high: allFindings.filter((f) => f.severity === 'high').length,
            medium: allFindings.filter((f) => f.severity === 'medium').length,
            low: allFindings.filter((f) => f.severity === 'low').length,
            elementsAnalyzed: elements.length,
            campaignsAnalyzed: campaigns.length,
        },
    };
}
