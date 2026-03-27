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

/**
 * staging.js — Staging object builder + confidence classifier
 * ADR-022: Neuro-Symbolic Document Ingestion — Layer 4 (Staging + Cost)
 *
 * Constroi staging objects para cada leitura extraida de um documento.
 * Orquestra as camadas 2 (deterministic) e 3 (semantic) para resolver parametros,
 * classifica confianca por cor, e preenche custos automaticamente.
 *
 * Classificacao:
 * - GREEN: match exato (alias table ou CAS) — auto-ingestivel, mas revisavel
 * - YELLOW: match semantico (transformer ou Levenshtein) — bloqueado para revisao
 * - RED: sem match, valor invalido, unidade desconhecida, ou confidence < 0.6
 *
 * @module core/ingestion/documents/staging
 */

import { resolveAlias } from './paramAliases.js';
import { extractCASNumbers, extractValue, extractUnit, resolveDocUnit } from './regexAnchors.js';
import { matchSemantic } from './semanticMatcher.js';
import { buildObservationCost, getCurrency } from './costCatalog.js';
import { canonicalizeWellId } from './wellIdCanon.js';
import { WELL_ID_RE as WELL_ID_RE_CANONICAL } from './types.js';

// ---------------------------------------------------------------------------
// Staging Object Builder
// ---------------------------------------------------------------------------

/**
 * Creates a staging object for a single reading.
 *
 * @param {Object} params
 * @param {string} params.parameterName - Raw parameter name from the document
 * @param {string} params.valueText - Raw value cell text
 * @param {string} [params.unitText] - Raw unit text (if separate from value)
 * @param {Object} [params.source] - Source location in the document
 * @param {number} [params.source.page] - Page number
 * @param {number} [params.source.x] - X coordinate
 * @param {number} [params.source.y] - Y coordinate
 * @param {string} [params.source.text] - Original text for audit trail
 * @param {number} [params.tableConfidence] - Table reconstruction confidence (0-1)
 * @returns {Promise<Object>} Staging object
 */
export async function buildStagingObject({ parameterName, valueText, unitText, source = {}, tableConfidence = 1.0 }) {
    const staging = {
        parameterId: null,
        parameterName: parameterName || '',
        value: null,
        unit: null,
        unitId: null,
        operator: '=',
        confidence: 'red',
        matchMethod: null,
        matchScore: null,
        family: 'generic',
        elementName: null,
        matrix: null, // P5: 'soil', 'groundwater', 'surface_water', 'air', null
        source: {
            page: source.page || null,
            x: source.x || null,
            y: source.y || null,
            text: source.text || `${parameterName || ''} ${valueText || ''}`.trim(),
        },
        cost: null,
        warnings: [],
        catalogVersionHash: 'v1.0',
    };

    // Step 1: Resolve parameter name
    if (parameterName) {
        // Layer 2: Deterministic — alias table
        const aliasResult = resolveAlias(parameterName);
        if (aliasResult) {
            staging.parameterId = aliasResult.parameterId;
            staging.confidence = 'green';
            staging.matchMethod = 'alias';
            staging.matchScore = 1.0;
        }

        // Layer 2: Deterministic — CAS number
        if (!staging.parameterId) {
            const casNumbers = extractCASNumbers(parameterName);
            if (casNumbers.length > 0) {
                // Try to resolve via CAS — will need CAS_TO_PARAM from mapper
                // For now, mark as found CAS but parameterId pending
                staging.warnings.push(`CAS found: ${casNumbers[0].cas} — needs CAS_TO_PARAM resolution`);
            }
        }

        // Layer 3: Semantic — transformer or Levenshtein
        if (!staging.parameterId) {
            try {
                const semanticResult = await matchSemantic(parameterName);
                if (semanticResult) {
                    staging.parameterId = semanticResult.parameterId;
                    staging.confidence = 'yellow';
                    staging.matchMethod = semanticResult.method;
                    staging.matchScore = semanticResult.score;
                    if (semanticResult.matchedAlias) {
                        staging.warnings.push(
                            `Matched via ${semanticResult.method}: "${semanticResult.matchedAlias}" (score: ${semanticResult.score.toFixed(2)})`,
                        );
                    }
                }
            } catch (e) {
                staging.warnings.push(`Semantic match failed: ${e.message}`);
            }
        }

        // No match at all
        if (!staging.parameterId) {
            staging.confidence = 'red';
            staging.warnings.push(`No match found for: "${parameterName}"`);
        }
    } else {
        staging.confidence = 'red';
        staging.warnings.push('Missing parameter name');
    }

    // Step 2: Extract value + operator
    if (valueText) {
        const valueResult = extractValue(valueText);
        if (valueResult) {
            staging.value = valueResult.value;
            staging.operator = valueResult.operator;
        } else {
            staging.confidence = 'red';
            staging.warnings.push(`Could not parse value: "${valueText}"`);
        }
    }

    // Step 3: Resolve unit
    if (unitText) {
        const unitResult = extractUnit(unitText);
        if (unitResult) {
            staging.unit = unitResult.unit;
            staging.unitId = unitResult.unitId;
        } else {
            staging.unitId = resolveDocUnit(unitText);
            staging.unit = unitText;
            if (!staging.unitId) {
                staging.warnings.push(`Unknown unit: "${unitText}"`);
            }
        }
    }

    // Step 3b: Detect matrix from unit (P5)
    const unitLower = (staging.unitId || staging.unit || '').toLowerCase();
    if (/mg\/kg|mg\/kg\s*ps|ppm\s*solo|mg\/kg\s*ms/i.test(unitLower)) {
        staging.matrix = 'soil';
    } else if (/[uμµ]g\/l|mg\/l|ppb/i.test(unitLower)) {
        staging.matrix = 'groundwater';
    } else if (/[uμµ]g\/m|mg\/m|ppm\s*ar/i.test(unitLower)) {
        staging.matrix = 'air';
    }

    // Step 4: Table confidence check
    if (tableConfidence < 0.6) {
        if (source._fallback) {
            // F6: fallback tables nao sao RED — marcamos YELLOW para revisao
            if (staging.confidence === 'red' && staging.parameterId) {
                staging.confidence = 'yellow';
            }
            staging.warnings.push(`Tabela com confianca baixa (${tableConfidence}) — revisao recomendada`);
        } else {
            staging.confidence = 'red';
            staging.warnings.push(`Table confidence too low: ${tableConfidence}`);
        }
    }

    // Step 5: Auto-fill cost (from catalog)
    if (staging.parameterId) {
        try {
            staging.cost = buildObservationCost(staging.parameterId, 'catalog');
        } catch (e) {
            // No cost data — not critical
            staging.cost = null;
        }
    }

    return staging;
}

/**
 * Processes an entire table into staging objects.
 * Assumes row 0 is the header row.
 *
 * @param {Object} params
 * @param {string[][]} params.table - 2D table data
 * @param {number} params.confidence - Table reconstruction confidence
 * @param {number} [params.page] - Source page number
 * @returns {Promise<Object[]>} Array of staging objects
 */
/**
 * F3: Gate — rejeita tabelas que nao sao analiticas (prosa, metadata, administrativa).
 * Chamada antes de iterar rows para evitar gerar readings de texto corrido.
 */
function isAnalyticalTable(table, header) {
    if (!table || table.length < 3 || !header) return false;

    // Check 1: Header keywords ambientais → force accept
    const ANALYTICAL_KEYWORDS =
        /composto|par[aâ]metro|analito|resultado|concentra[cç][aã]o|valor|v\.?i\.?|l\.?q\.?|substancia|substância|cas\b/i;
    if (header.some((h) => ANALYTICAL_KEYWORDS.test(h || ''))) return true;

    const dataRows = table.slice(1);

    // Check 2: Texto longo na col0 → prosa, nao parametro
    const col0Chars = dataRows.map((r) => (r[0] || '').trim().length);
    const avgCol0 = col0Chars.reduce((s, l) => s + l, 0) / (col0Chars.length || 1);
    if (avgCol0 > 60) return false;

    // Check 3: Sem numeros em nenhuma coluna → descritiva
    const numericRe = /\d+[.,]?\d*/;
    let numericRows = 0;
    for (const row of dataRows) {
        if (row.some((c) => numericRe.test(c || ''))) numericRows++;
    }
    if (numericRows / dataRows.length < 0.2) return false;

    // Check 4: > 80% single-column rows → prosa corrida
    let singleCol = 0;
    for (const row of dataRows) {
        if (row.filter((c) => (c || '').trim()).length <= 1) singleCol++;
    }
    if (singleCol / dataRows.length > 0.8) return false;

    // Check 5: Col0 too short → IDs, not parameters
    const col0Values = dataRows.map((r) => (r[0] || '').trim()).filter(Boolean);
    const avgCol0Len = col0Values.reduce((s, v) => s + v.length, 0) / (col0Values.length || 1);
    if (avgCol0Len <= 3) return false;

    // Check 6: Too many columns → clustering artefact (real tables have 2-8 cols)
    if (header.length > 8) return false;

    // Check 7: Header is prose or metadata (section labels, document metadata)
    const h0 = (header[0] || '').trim().toLowerCase();
    if (/^[a-z]\d*\.\d*\.?\s/.test(h0)) return false; // "D.2. ...", "E.1. ..."
    if (/^dados\s|^resumo\s|^sumario|^indice|^confidencial/i.test(h0)) return false;

    return true;
}

function _isValueLikeText(text) {
    if (!text) return false;
    const trimmed = String(text).trim();
    if (!trimmed) return false;
    if (/^[\u2014-]+$/.test(trimmed)) return false;
    return !!extractValue(trimmed);
}

function _normalizeText(raw) {
    return String(raw || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function _extractYearSequenceFromTable(table) {
    const years = new Set();
    for (const row of table || []) {
        for (const cell of row || []) {
            const txt = String(cell || '');
            const matches = txt.match(/\b(19|20)\d{2}\b/g) || [];
            for (const y of matches) years.add(parseInt(y, 10));
        }
    }
    return [...years].filter((y) => y >= 1900 && y <= 2099).sort((a, b) => a - b);
}

function _extractCollapsedNumberChunks(text) {
    const cleaned = String(text || '').replace(/\s+/g, '');
    if (!cleaned) return [];
    const tokens = [];
    const grouped = cleaned.match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?/g) || [];
    tokens.push(...grouped);

    // "310135" style fallback: split only when no separators and exactly 2+ 3-digit chunks.
    if (tokens.length === 0 && /^\d{6,}$/.test(cleaned) && cleaned.length % 3 === 0) {
        for (let i = 0; i < cleaned.length; i += 3) {
            tokens.push(cleaned.slice(i, i + 3));
        }
    }
    return tokens;
}

function _buildHistoricalTimeSeries(descriptorTail, latestRaw, years) {
    const series = [];
    const histTokens = _extractCollapsedNumberChunks(descriptorTail);
    for (const token of histTokens) {
        const parsed = extractValue(token);
        if (!parsed) continue;
        series.push({
            period: null,
            year: null,
            value: parsed.value ?? null,
            operator: parsed.operator || '=',
            raw: token,
        });
    }

    const latestParsed = extractValue(latestRaw);
    if (latestParsed) {
        series.push({
            period: 'latest',
            year: null,
            value: latestParsed.value ?? null,
            operator: latestParsed.operator || '=',
            raw: String(latestRaw || ''),
        });
    }

    if (series.length === 0) return [];

    // Use explicit years when we can infer enough labels.
    if (Array.isArray(years) && years.length >= series.length) {
        const mappedYears = years.slice(years.length - series.length);
        for (let i = 0; i < series.length; i++) {
            series[i].year = mappedYears[i];
            series[i].period = String(mappedYears[i]);
        }
        return series;
    }

    // Keep deterministic period labels when year cannot be inferred.
    for (let i = 0; i < series.length; i++) {
        if (i === series.length - 1) {
            series[i].period = 'latest';
        } else {
            series[i].period = `historical_${i + 1}`;
        }
    }
    return series;
}

const MATRIX_EVIDENCE_RULES = Object.freeze({
    soil: {
        header: /\bsolo\b|\bsoil\b|\bsediment\b/,
        unit: /\bmg\/kg\b|\bug\/kg\b|\bppm\s*solo\b|\bmg\/kg\s*ps\b|\bmg\/kg\s*ms\b/,
    },
    groundwater: {
        header: /\bagua\s*subterr\b|\bgroundwater\b|\bsubterranea\b|\bfreatic\b|\baquifero\b/,
        unit: /\bmg\/l\b|\bug\/l\b|\bppb\b/,
    },
    surface_water: {
        header: /\bagua\s*superfic\b|\bsurface\s*water\b|\brio\b|\blago\b|\brepresa\b/,
    },
    air: {
        header: /\bmatriz\s*ar\b|\bqualidade\s+do\s+ar\b|\bair\b|\batmosfer\b|\bvapor\b/,
        unit: /\bmg\/m3\b|\bug\/m3\b|\bppm\s*ar\b|\bmg\/m\^?3\b|\bug\/m\^?3\b/,
    },
});

function _collectMatrixUnitHints(header, dataRows, colRoles) {
    const hints = [];
    const pushHint = (txt) => {
        const normalized = _normalizeText(txt).replace(/\s+/g, '');
        if (!normalized) return;
        hints.push(normalized);
    };

    const headerText = header.join(' | ');
    const inParens = [...headerText.matchAll(/\(([^)]+)\)/g)];
    for (const m of inParens) pushHint(m[1]);
    if (colRoles?.headerUnit) pushHint(colRoles.headerUnit);

    if (Number.isInteger(colRoles?.unit) && colRoles.unit >= 0) {
        for (const row of dataRows || []) pushHint(row[colRoles.unit] || '');
    }

    // Value columns sometimes carry units inline (e.g., "< 0,05 mg/L").
    if (Number.isInteger(colRoles?.value) && colRoles.value >= 0) {
        for (const row of dataRows || []) {
            const txt = String(row[colRoles.value] || '');
            const unitLike = txt.match(/[a-zu]+\/[a-z0-9^]+/gi) || [];
            for (const u of unitLike) pushHint(u);
        }
    }
    return [...new Set(hints)];
}

function _detectTableMatrixEvidence({ header, dataRows, colRoles }) {
    const headerText = _normalizeText((header || []).join(' '));
    const unitHints = _collectMatrixUnitHints(header || [], dataRows || [], colRoles || {});
    const score = { soil: 0, groundwater: 0, surface_water: 0, air: 0 };

    for (const [matrix, rule] of Object.entries(MATRIX_EVIDENCE_RULES)) {
        if (rule.header && rule.header.test(headerText)) score[matrix] += 3;
        if (rule.unit && unitHints.some((u) => rule.unit.test(u))) score[matrix] += 2;
    }

    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    const [topMatrix, topScore] = ranked[0];
    const secondScore = ranked[1]?.[1] || 0;
    const ambiguous = topScore > 0 && topScore - secondScore < 2;

    if (ambiguous) return { matrix: null, ambiguous: true, score };
    if (topScore <= 0) return { matrix: null, ambiguous: false, score };
    if (topScore >= 3) return { matrix: topMatrix, ambiguous: false, score };
    return { matrix: null, ambiguous: false, score };
}

/**
 * Normalizes collapsed historical trend tables into simple [Parametro, Valor, Unidade, Elemento].
 * Example row: ["MW-01", "PCE 310135", "ND", "Decrescente"] -> ["PCE", "ND", "", "MW-01"]
 *
 * Keeps only the latest value column when yearly columns were collapsed by PDF extraction.
 * Returns original table when pattern is not confidently detected.
 *
 * @param {string[][]} table
 * @returns {string[][]}
 */
function normalizeHistoricalTrendTable(table) {
    if (!Array.isArray(table) || table.length < 3) return table;

    const inferredYears = _extractYearSequenceFromTable(table);
    const sample = table.slice(0, Math.min(table.length, 12));
    let wellRows = 0;
    let aliasRows = 0;
    let latestValueRows = 0;
    let trendRows = 0;

    for (const row of sample) {
        if (!Array.isArray(row) || row.length < 3) continue;
        const c0 = (row[0] || '').trim();
        const c1 = (row[1] || '').trim();
        const c2 = (row[2] || '').trim();
        const c3 = (row[3] || '').trim();

        if (WELL_ID_RE_CANONICAL.test(c0)) wellRows++;

        const m = c1.match(/^([A-Za-z0-9,.\-\/]+)\s+(.+)$/);
        const paramToken = (m?.[1] || c1).trim();
        if (paramToken && resolveAlias(paramToken)?.parameterId) aliasRows++;

        if (_isValueLikeText(c2)) latestValueRows++;
        if (/decrescente|crescente|estavel|estável|novo\s+poco|novo\s+poço|tendencia|tendência/i.test(c3)) {
            trendRows++;
        }
    }

    const minRows = Math.max(2, Math.floor(sample.length * 0.35));
    if (wellRows < minRows || aliasRows < minRows || latestValueRows < minRows || trendRows < 1) {
        return table;
    }

    const normalized = [['Parametro', 'Valor', 'Unidade', 'Elemento', 'TemporalSeries']];
    for (const row of table) {
        if (!Array.isArray(row) || row.length < 3) continue;
        const well = (row[0] || '').trim();
        const descriptor = (row[1] || '').trim();
        const latest = (row[2] || '').trim();
        if (!WELL_ID_RE_CANONICAL.test(well) || !descriptor) continue;

        const m = descriptor.match(/^([A-Za-z0-9,.\-\/]+)\s+(.+)$/);
        const paramName = (m?.[1] || descriptor).trim();
        if (!resolveAlias(paramName)?.parameterId) continue;

        let valueText = latest;
        if (!_isValueLikeText(valueText) && m?.[2] && _isValueLikeText(m[2])) {
            valueText = m[2].trim();
        }
        if (!_isValueLikeText(valueText)) continue;

        const series = _buildHistoricalTimeSeries(m?.[2] || '', latest, inferredYears);
        normalized.push([paramName, valueText, '', well, JSON.stringify(series)]);
    }

    return normalized.length >= 3 ? normalized : table;
}

export async function processTable({ table, confidence, page, tableIndex = null, _fallback = false, _bboxes = null }) {
    if (!table || table.length < 2) return [];
    table = normalizeHistoricalTrendTable(table);

    let header = table[0];
    let dataStartRow = 1;

    // BUG-1: Se header contem parametro conhecido (alias match), e na verdade uma data row
    // Gerar header sintetico e tratar row 0 como dados
    const originalHeader = [...header]; // Preserve for VI/VR/VP exclusion in detectColumnRoles
    const headerHasParam = header.some((h) => {
        const resolved = resolveAlias((h || '').trim());
        return resolved && resolved.parameterId;
    });
    if (headerHasParam) {
        // Generate synthetic header based on column count
        const cols = header.length;
        header = ['Parametro', 'Valor', ...Array(Math.max(0, cols - 2)).fill('')].slice(0, cols);
        dataStartRow = 0; // Process all rows including original "header"
    }

    // F3: Gate — rejeitar tabelas nao-analiticas
    if (!isAnalyticalTable(table, header)) return [];

    // Detect column roles from header + data rows (for numeric heuristic)
    // Pass originalHeader so VI/VR/VP exclusion works even with synthetic headers
    const dataRows = table.slice(dataStartRow, Math.min(table.length, dataStartRow + 5));
    const colRoles = detectColumnRoles(header, dataRows, originalHeader);
    const matrixEvidence = _detectTableMatrixEvidence({ header, dataRows, colRoles });
    const readings = [];

    // Process each data row
    for (let r = dataStartRow; r < table.length; r++) {
        const row = table[r];

        // Skip empty rows
        if (row.every((c) => !c || !c.trim())) continue;

        // F4: Skip metadata/administrative rows (improved)
        if (isMetadataRow(row)) continue;

        const paramCol = colRoles.parameter;
        const valueCol = colRoles.value;
        const unitCol = colRoles.unit;

        const paramName = paramCol !== -1 ? (row[paramCol] || '').trim() : '';
        const valueText = valueCol !== -1 ? (row[valueCol] || '').trim() : '';
        const unitText = unitCol !== -1 ? (row[unitCol] || '').trim() : '';
        const temporalSeriesCol = row[4] || '';

        if (!paramName && !valueText) continue;

        const staging = await buildStagingObject({
            parameterName: paramName,
            valueText: valueText,
            unitText: unitText || colRoles.headerUnit,
            source: { page, tableIndex, text: row.join(' | '), _fallback, bbox: _bboxes?.[r] || null },
            tableConfidence: confidence,
        });

        // Detect element family from context (heuristic — no LLM)
        const familyInfo = detectFamilyFromContext(paramName, header, row.join(' '));
        staging.family = familyInfo.family;
        if (familyInfo.elementName) staging.elementName = familyInfo.elementName;

        // Read "Elemento" column directly (col 3 in pdfplumber normalized tables)
        // May contain "MW-16||{bbox JSON}" encoded by pdfplumber
        const elementCol = row[3] || row[colRoles.parameter === 0 ? 3 : -1] || '';
        if (elementCol && elementCol.includes('||{')) {
            const parts = elementCol.split('||');
            staging.elementName = parts[0].trim();
            try {
                staging.source.bbox = JSON.parse(parts[1]);
            } catch {
                /* ignore */
            }
        } else if (elementCol && !staging.elementName && elementCol.length >= 2) {
            // Only accept as elementName if it looks like a well ID (F1-C: reject descriptors like "Voláteis")
            const trimmed = elementCol.trim();
            if (WELL_ID_RE_CANONICAL.test(trimmed)) {
                staging.elementName = canonicalizeWellId(trimmed) || trimmed;
            }
        }

        if (temporalSeriesCol) {
            try {
                const parsedSeries = JSON.parse(temporalSeriesCol);
                if (Array.isArray(parsedSeries) && parsedSeries.length > 0) {
                    staging.source.timeSeries = parsedSeries;
                    const latestWithYear = [...parsedSeries].reverse().find((s) => Number.isFinite(s?.year));
                    if (latestWithYear && !staging.dateLabel) staging.dateLabel = String(latestWithYear.year);
                }
            } catch {
                // Keep backward-compatible flow when temporal metadata is malformed.
            }
        }

        // Generic matrix evidence engine:
        // - explicit matrix assignment when evidence is strong
        // - ambiguous table context forces null for manual review
        if (matrixEvidence.ambiguous) {
            staging.matrix = null;
            staging.source.matrixAmbiguous = true;
            staging.warnings.push('Matrix ambiguous: header/unit evidence conflict');
        } else if (matrixEvidence.matrix) {
            staging.matrix = matrixEvidence.matrix;
        }

        staging.rowIndex = r;
        readings.push(staging);
    }

    return readings;
}

// ---------------------------------------------------------------------------
// Cross-Reference Table Detection (Melhoria 1)
// ---------------------------------------------------------------------------

/** Date pattern for header cells — matches temporal labels in cross-ref Format B/C */
const DATE_HEADER_RE =
    /(?:\d{4}[_\-/]\d{1,2}|\d{1,2}[_\-/]\d{4}|\d{1,2}\s*(?:SEM|sem)|(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|jan|feb|apr|may|aug|sep|oct|dec)[a-z]*[\/\-.]?\s*\d{2,4})/i;

/** Keywords for metadata columns between parameter and value columns (Melhoria 7) */
const META_COL_KEYWORDS = [
    'unidade',
    'unit',
    'un.',
    'unid',
    'referencia',
    'reference',
    'ref',
    'vi',
    'vr',
    'vp',
    'cma',
    'vmp',
    'legislacao',
    'legislation',
    'legis',
    'norma',
    'lei',
    'metodo',
    'method',
    'lq',
    'ld',
    'limite',
    'cas',
    'cas no',
    'n cas',
    'numero cas',
    'valor orientador',
    'valor de referencia',
    'padrao',
    'intervencao',
    'prevencao',
];

/** Reference value column keywords (Melhoria 7) */
const REF_COL_KEYWORDS = [
    'vi',
    'vr',
    'vp',
    'cma',
    'vmp',
    'referencia',
    'reference',
    'limite',
    'padrao',
    'conama',
    'cetesb',
    'intervencao',
    'prevencao',
    'orientador',
    'valor orientador',
    'valor de referencia',
];

/**
 * Classifies a table as simple or cross-reference layout.
 *
 * @param {string[][]} table - Full table (header + data rows)
 * @returns {{
 *   type: 'simple'|'crossref-a'|'crossref-b'|'crossref-c',
 *   wellAxis: 'column'|'row'|null,
 *   paramAxis: 'row'|'column'|null,
 *   wellCols: number[],
 *   metaCols: {index: number, role: string}[],
 *   refCols: {index: number, label: string}[],
 *   dateCols: Map<string, {colIndex: number, date: string}[]>|null,
 *   headerRows: number,
 *   paramCol: number
 * }}
 */
/** Non-anchored well ID regex — finds IDs anywhere in text (for concatenated cells) */
const WELL_ID_GLOBAL_RE = /\b(PM|MW|PZ|PP|PB|PT|PA|RB|SB|PMA|PMR|PMC|PMG|PI|PC|PE|SS|PF)\s*[-.]?\s*\d+[A-Z]?\b/gi;

/**
 * Counts well IDs found in a row's cells. Handles concatenated IDs ("PM-38A PM-39A PM-40A").
 * Returns { count, colIndices[] } where colIndices are columns containing well IDs.
 */
function _countWellsInRow(row) {
    let count = 0;
    const colIndices = [];
    for (let i = 0; i < (row || []).length; i++) {
        const cell = (row[i] || '').trim();
        const matches = cell.match(WELL_ID_GLOBAL_RE);
        if (matches && matches.length > 0) {
            count += matches.length;
            colIndices.push(i);
        }
    }
    return { count, colIndices };
}

export function classifyCrossRefLayout(table) {
    if (!table || table.length < 3)
        return {
            type: 'simple',
            wellAxis: null,
            paramAxis: null,
            wellCols: [],
            metaCols: [],
            refCols: [],
            dateCols: null,
            headerRows: 1,
            paramCol: 0,
        };

    // Scan rows 0-5 to find the best header row (the one with most well IDs)
    const scanRows = Math.min(table.length, 6);
    let bestHeaderRow = 0;
    let bestWellCount = 0;
    let bestWellCols = [];

    for (let r = 0; r < scanRows; r++) {
        const { count, colIndices } = _countWellsInRow(table[r]);
        if (count > bestWellCount) {
            bestWellCount = count;
            bestHeaderRow = r;
            bestWellCols = colIndices;
        }
    }

    const headerRow = table[bestHeaderRow];
    const nextRow = table[bestHeaderRow + 1] || [];

    // Count dates in the row after the best header
    let datesInNextRow = 0;
    for (const cell of nextRow) {
        if (DATE_HEADER_RE.test((cell || '').trim())) datesInNextRow++;
    }

    // Count well IDs in column 0 of data rows (for Format C)
    const dataRows = table.slice(bestHeaderRow + 1, Math.min(table.length, bestHeaderRow + 8));
    let wellsInCol0 = 0;
    for (const row of dataRows) {
        if (row[0] && WELL_ID_RE.test(row[0].trim())) wellsInCol0++;
    }

    // Detect metadata/reference columns from the header row
    const metaCols = [];
    const refCols = [];
    for (let i = 0; i < headerRow.length; i++) {
        const cell = (headerRow[i] || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
        for (const kw of META_COL_KEYWORDS) {
            if (cell.includes(kw)) {
                let role = 'metadata';
                if (['unidade', 'unit', 'un.', 'unid'].some((u) => cell.includes(u))) role = 'unit';
                else if (['metodo', 'method'].some((m) => cell.includes(m))) role = 'method';
                else if (['lq', 'ld', 'limite'].some((l) => cell.includes(l))) role = 'detection_limit';
                else if (['cas', 'n cas', 'numero cas'].some((c) => cell.includes(c))) role = 'cas';
                else if (REF_COL_KEYWORDS.some((r) => cell.includes(r))) role = 'reference';
                metaCols.push({ index: i, role });
                if (role === 'reference') {
                    refCols.push({ index: i, label: (headerRow[i] || '').trim() });
                }
                break;
            }
        }
    }

    const metaColIndices = new Set(metaCols.map((m) => m.index));

    if (bestWellCount >= 2) {
        // Wells in columns — Format A or B
        if (datesInNextRow >= 2) {
            const dateCols = _buildDoubleHeaderMap(headerRow, nextRow);
            return {
                type: 'crossref-b',
                wellAxis: 'column',
                paramAxis: 'row',
                wellCols: bestWellCols,
                metaCols,
                refCols,
                dateCols,
                headerRows: bestHeaderRow + 2,
                paramCol: _findParamCol(headerRow, nextRow, metaColIndices, bestWellCols),
            };
        }
        return {
            type: 'crossref-a',
            wellAxis: 'column',
            paramAxis: 'row',
            wellCols: bestWellCols,
            metaCols,
            refCols,
            dateCols: null,
            headerRows: bestHeaderRow + 1,
            paramCol: _findParamCol(headerRow, null, metaColIndices, bestWellCols),
        };
    }

    // Check dates in any of the scanned rows for Format C
    let datesInRow0 = 0;
    for (const cell of table[0]) {
        if (DATE_HEADER_RE.test((cell || '').trim())) datesInRow0++;
    }

    if (wellsInCol0 >= 2 && (datesInRow0 >= 2 || datesInNextRow >= 1)) {
        return {
            type: 'crossref-c',
            wellAxis: 'row',
            paramAxis: 'column',
            wellCols: [],
            metaCols,
            refCols,
            dateCols: null,
            headerRows: 1,
            paramCol: 0,
        };
    }

    return {
        type: 'simple',
        wellAxis: null,
        paramAxis: null,
        wellCols: [],
        metaCols,
        refCols,
        dateCols: null,
        headerRows: 1,
        paramCol: 0,
    };
}

/**
 * Finds the parameter column index (first non-well, non-meta column, usually col 0).
 */
function _findParamCol(row0, row1, metaColIndices, wellColIndices) {
    const wellSet = new Set(wellColIndices);
    for (let i = 0; i < row0.length; i++) {
        if (!wellSet.has(i) && !metaColIndices.has(i)) return i;
    }
    return 0;
}

/**
 * Builds a map of wellId → [{colIndex, date}] from double headers (Format B).
 * Propagates well ID from left for merged/empty cells.
 */
function _buildDoubleHeaderMap(row0, row1) {
    const map = new Map();
    let lastWell = null;

    for (let i = 0; i < Math.max(row0.length, row1.length); i++) {
        const cell0 = (row0[i] || '').trim();
        const cell1 = (row1[i] || '').trim();

        if (WELL_ID_RE.test(cell0)) {
            lastWell = canonicalizeWellId(cell0) || cell0;
        }

        if (lastWell && DATE_HEADER_RE.test(cell1)) {
            if (!map.has(lastWell)) map.set(lastWell, []);
            map.get(lastWell).push({ colIndex: i, date: cell1 });
        }
    }

    return map;
}

/**
 * Processes a cross-reference table into staging objects.
 * Each cell at the intersection of (parameter row × well column) becomes one reading.
 *
 * @param {Object} params
 * @param {string[][]} params.table - Full table data
 * @param {Object} params.layout - Result from classifyCrossRefLayout()
 * @param {number} params.confidence - Table confidence
 * @param {number} [params.page] - Page number
 * @returns {Promise<Object[]>} Array of staging objects
 */
export async function processCrossRefTable({ table, layout, confidence, page }) {
    if (!table || table.length < 3) return [];

    const readings = [];
    const dataStartRow = layout.headerRows;
    const metaColSet = new Set(layout.metaCols.map((m) => m.index));
    const wellColSet = new Set(layout.wellCols);
    const unitCol = layout.metaCols.find((m) => m.role === 'unit');
    const methodCol = layout.metaCols.find((m) => m.role === 'method');
    const dlCol = layout.metaCols.find((m) => m.role === 'detection_limit');

    if (layout.type === 'crossref-a' || layout.type === 'crossref-b') {
        // Parameters in rows, wells in columns
        const header = table[0];

        for (let r = dataStartRow; r < table.length; r++) {
            const row = table[r];
            if (row.every((c) => !c || !c.trim())) continue;
            if (isMetadataRow(row)) continue;

            const paramName = (row[layout.paramCol] || '').trim();
            if (!paramName) continue;

            // Extract per-row metadata
            const rowUnit = unitCol ? (row[unitCol.index] || '').trim() : null;
            const rowMethod = methodCol ? (row[methodCol.index] || '').trim() : null;
            const rowDL = dlCol ? (row[dlCol.index] || '').trim() : null;

            // Extract reference values (Melhoria 7)
            const refValues = [];
            for (const rc of layout.refCols) {
                const rv = (row[rc.index] || '').trim();
                if (rv) refValues.push({ value: rv, label: rc.label, source: 'document' });
            }

            // Iterate over well columns
            for (let c = 0; c < row.length; c++) {
                if (c === layout.paramCol) continue;
                if (metaColSet.has(c)) continue;
                if (!wellColSet.has(c) && layout.wellCols.length > 0) continue;

                const valueText = (row[c] || '').trim();
                if (!valueText) continue;

                // Determine well ID from header
                let wellId = (header[c] || '').trim();
                if (WELL_ID_RE.test(wellId)) {
                    wellId = canonicalizeWellId(wellId.match(WELL_ID_RE)[0]) || wellId;
                }

                // Determine date for Format B
                let dateLabel = null;
                if (layout.type === 'crossref-b' && layout.dateCols) {
                    const row1 = table[1] || [];
                    dateLabel = (row1[c] || '').trim() || null;
                }

                const staging = await buildStagingObject({
                    parameterName: paramName,
                    valueText,
                    unitText: rowUnit,
                    source: { page, text: `${paramName} | ${wellId} | ${valueText}` },
                    tableConfidence: confidence,
                });

                staging.elementName = wellId;
                staging.family = 'well';
                staging.rowIndex = r;
                staging.crossRef = true;
                if (dateLabel) staging.dateLabel = dateLabel;
                if (rowMethod) staging.analyticalMethod = rowMethod;
                if (rowDL) staging.detectionLimit = rowDL;
                if (refValues.length > 0) staging.referenceValues = refValues;

                readings.push(staging);
            }
        }
    } else if (layout.type === 'crossref-c') {
        // Wells in rows, dates/params in columns
        const header = table[0];

        for (let r = dataStartRow; r < table.length; r++) {
            const row = table[r];
            if (row.every((c) => !c || !c.trim())) continue;

            let wellId = (row[0] || '').trim();
            if (!WELL_ID_RE.test(wellId)) continue;
            wellId = canonicalizeWellId(wellId.match(WELL_ID_RE)[0]) || wellId;

            for (let c = 1; c < row.length; c++) {
                const valueText = (row[c] || '').trim();
                if (!valueText) continue;

                const colHeader = (header[c] || '').trim();

                const staging = await buildStagingObject({
                    parameterName: colHeader || 'unknown',
                    valueText,
                    source: { page, text: `${wellId} | ${colHeader} | ${valueText}` },
                    tableConfidence: confidence,
                });

                staging.elementName = wellId;
                staging.family = 'well';
                staging.rowIndex = r;
                staging.crossRef = true;
                if (DATE_HEADER_RE.test(colHeader)) staging.dateLabel = colHeader;

                readings.push(staging);
            }
        }
    }

    return readings;
}

// ---------------------------------------------------------------------------
// Column Role Detection
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Metadata / Non-Analytical Row Filter (Melhoria 3)
// ---------------------------------------------------------------------------

/**
 * Words that indicate a metadata/administrative row (not analytical data).
 * Matched against the FIRST cell of each row (column 0) after normalization.
 * Applied AFTER cross-ref detection to avoid filtering data rows.
 */
const METADATA_SKIP_WORDS = [
    // Administrative
    'referencia',
    'contratante',
    'endereco',
    'objeto',
    'responsavel',
    'coordenacao',
    'aprovacao',
    'classificacao',
    'laboratorio',
    'revisao',
    'pagina',
    'assinatura',
    'carimbo',
    'cnpj',
    'telefone',
    'email',
    'cep',
    'municipio',
    'estado',
    'documento',
    'protocolo',
    'versao',
    'data do relatorio',
    'numero do relatorio',
    // Subtotals / aggregates
    'total btex',
    'soma xilenos',
    'total voc',
    'subtotal',
    'total geral',
    'soma',
    'total',
    // Method / footnote
    'metodo',
    'method',
    'usepa',
    'observacao',
    'nota',
    'legenda',
    'fonte',
    'referencia bibliografica',
    // Report structure
    'cliente',
    'contrato',
    'projeto',
    'emissao',
    'validade',
    'analista',
    'gerente',
    'diretor',
    'crea',
    'crq',
];

/** Pre-built set for O(1) lookup after normalization */
const _METADATA_SKIP_SET = new Set(
    METADATA_SKIP_WORDS.map((w) =>
        w
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase(),
    ),
);

/**
 * Checks whether a row should be skipped as non-analytical metadata.
 * Only checks the first cell (column 0) to avoid false positives in data columns.
 *
 * @param {string[]} row - Table row cells
 * @returns {boolean} true if the row is metadata and should be skipped
 */
function isMetadataRow(row) {
    if (!row || row.length === 0) return true;

    // F4: Normalize all cells for substring search across all columns
    const normalized = row.map((c) =>
        (c || '')
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase(),
    );

    const cell0 = normalized[0];
    if (!cell0) return false;

    // Exact match or prefix match on col0
    if (_METADATA_SKIP_SET.has(cell0)) return true;
    for (const skip of _METADATA_SKIP_SET) {
        if (cell0.startsWith(skip + ':') || cell0.startsWith(skip + ' :')) return true;
    }

    // F4: Substring match across ALL columns for strong admin indicators
    const allText = normalized.join(' ');
    const ADMIN_SUBS = [
        'resp. tecnico',
        'resp tecnico',
        'responsavel tecnico',
        'crea-',
        'crea ',
        'crq-',
        'art n',
        'cpf ',
        'cnpj ',
        'assinatura',
        'confidencial',
        'pagina ',
        'quadro ',
        'uadro ',
        'tabela ',
        'figura ',
        'nota:',
        'obs:',
        'fonte:',
        'quadro e',
    ];
    for (const sub of ADMIN_SUBS) {
        if (allText.includes(sub)) return true;
    }

    return false;
}

// ---------------------------------------------------------------------------
// Column Role Detection (Melhoria 4 — expanded keywords + numeric heuristic)
// ---------------------------------------------------------------------------

/** Keywords that indicate a parameter name column */
const PARAM_KEYWORDS = [
    'parametro',
    'parameter',
    'analito',
    'analyte',
    'substancia',
    'substance',
    'composto',
    'compound',
    'ensaio',
    'teste',
    'test',
    'determinacao',
    'analise',
    'analysis',
    'nome',
    'name',
    'quimico',
    'chemical',
    // Melhoria 4: expanded
    'elemento',
    'ion',
    'metal',
    'organico',
    'inorganico',
    'indicador',
    'variavel',
    'especie',
];

/** Keywords that indicate a value/result column */
const VALUE_KEYWORDS = [
    'resultado',
    'result',
    'valor',
    'value',
    'concentracao',
    'concentration',
    'leitura',
    'reading',
    'medida',
    'measurement',
    'amostra',
    'sample',
    'quantificacao',
    'quantification',
    // Melhoria 4: expanded
    'teor',
    'teores',
    'detectado',
    'encontrado',
    'resultado final',
    'resultado analitico',
    'quantificado',
    'medido',
    'determinado',
];

/** Keywords that indicate a unit column */
const UNIT_KEYWORDS = ['unidade', 'unit', 'unid', 'un.', 'medida'];

/**
 * Detects column roles (parameter, value, unit) from header row.
 * Melhoria 4: Falls back to numeric density heuristic when keywords fail.
 *
 * @param {string[]} header - Header row cells
 * @param {string[][]} [dataRows] - First few data rows for numeric density fallback
 * @returns {{ parameter: number, value: number, unit: number, headerUnit: string|null }}
 */
function detectColumnRoles(header, dataRows, originalHeader = null) {
    const roles = { parameter: -1, value: -1, unit: -1, headerUnit: null };

    for (let i = 0; i < header.length; i++) {
        const cell = (header[i] || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        // Check for unit in parentheses in any header cell
        const unitMatch = cell.match(/\(([^)]+)\)/);

        if (roles.parameter === -1 && PARAM_KEYWORDS.some((k) => cell.includes(k))) {
            roles.parameter = i;
        } else if (roles.value === -1 && VALUE_KEYWORDS.some((k) => cell.includes(k))) {
            roles.value = i;
            // Extract unit from header if present (e.g., "Resultado (mg/L)")
            if (unitMatch) {
                roles.headerUnit = unitMatch[1].trim();
            }
        } else if (roles.unit === -1 && UNIT_KEYWORDS.some((k) => cell.includes(k))) {
            roles.unit = i;
        }
    }

    // Melhoria 4: Numeric density heuristic — if we found parameter but not value,
    // scan data rows to find the column with most numeric-like cells.
    // Excludes columns already identified as parameter or unit.
    if (roles.value === -1 && dataRows && dataRows.length > 0 && header.length >= 2) {
        const numericRE = /[<>=≤≥]?\s*\d+[.,]?\d*/;
        const scores = Array(header.length).fill(0);
        const excludeCols = new Set();
        if (roles.parameter !== -1) excludeCols.add(roles.parameter);
        if (roles.unit !== -1) excludeCols.add(roles.unit);

        // BUG-2: Exclude reference/threshold columns (VI, VR, VP, LQ) from value detection
        // Search both current header AND original header (handles synthetic header case)
        const headersToCheck = [header];
        if (originalHeader && originalHeader !== header) headersToCheck.push(originalHeader);
        for (const hdr of headersToCheck) {
            for (let c = 0; c < hdr.length; c++) {
                const h = (hdr[c] || '')
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '');
                if (
                    /^v\.?i\.?\b|valor de intervencao|valor de referencia|^v\.?r\.?\b|^v\.?p\.?\b|^l\.?q\.?\b|limite de quantificacao/i.test(
                        h,
                    )
                ) {
                    excludeCols.add(c);
                }
            }
        }

        for (const row of dataRows) {
            for (let c = 0; c < (row || []).length; c++) {
                if (excludeCols.has(c)) continue;
                if (numericRE.test((row[c] || '').trim())) {
                    scores[c]++;
                }
            }
        }

        const maxScore = Math.max(...scores);
        if (maxScore >= 2) {
            roles.value = scores.indexOf(maxScore);
        }
    }

    // Final fallback: if still no roles detected, assume col 0=param, col 1=value
    if (roles.parameter === -1 && roles.value === -1 && header.length >= 2) {
        roles.parameter = 0;
        roles.value = 1;
        if (header.length >= 3 && roles.unit === -1) {
            roles.unit = 2;
        }
    }

    // If we found value via heuristic but no parameter, assume col 0 = parameter
    if (roles.parameter === -1 && roles.value !== -1) {
        roles.parameter = 0;
    }

    return roles;
}

// ---------------------------------------------------------------------------
// Family Detection (heuristic — no LLM)
// ---------------------------------------------------------------------------

/** Well ID regex — canonical definition from types.js (BS-4: removed local duplicate) */
const WELL_ID_RE = WELL_ID_RE_CANONICAL;

/**
 * Keyword map: family → [keywords PT/EN]
 * All keywords are matched with word boundaries (regex \b) to avoid
 * false positives like "rio" inside "relatório" or "solo" inside "absoluto".
 */
const FAMILY_KEYWORDS = {
    well: ['poco', 'well', 'piezometro', 'piezometer', 'monitoring well', 'poco de monitoramento'],
    plume: ['pluma', 'plume', 'isoconcentracao', 'contaminacao', 'fase livre', 'napl', 'dnapl', 'lnapl'],
    lake: ['lago', 'lagoa', 'lake', 'represa', 'reservatorio hidrico', 'acude'],
    river: ['rio', 'corrego', 'arroio', 'river', 'stream', 'creek', 'drenagem', 'ribeiro'],
    spring: ['nascente', 'spring', 'surgencia', 'olho dagua', 'mina dagua'],
    building: ['edificacao', 'building', 'predio', 'galpao'],
    tank: ['tanque', 'tank', 'sasc', 'reservatorio subterraneo'],
    boundary: ['limite', 'boundary', 'perimetro', 'area de estudo', 'poligonal'],
    stratum: ['camada', 'stratum', 'litologia', 'estratigrafia', 'perfil geologico', 'sondagem'],
    sample: ['amostra solo', 'amostra sedimento', 'sample point', 'ponto coleta', 'coleta superficial'],
    area: ['setor', 'departamento', 'unidade operacional', 'area operacional'],
    individual: ['colaborador', 'funcionario', 'trabalhador', 'operador', 'empregado'],
    incident: ['acidente', 'incidente', 'quase-acidente', 'near miss', 'first aid', 'primeiros socorros'],
    emission_source: ['chamine', 'emissao fugitiva', 'emissao atmosferica', 'stack', 'exaustao'],
    waste_stream: ['residuo', 'waste', 'aterro', 'bota-fora', 'pgrs', 'classe i', 'classe ii'],
    effluent_point: ['efluente', 'effluent', 'descarga', 'tratamento efluente'],
    habitat: ['habitat', 'biodiversidade', 'ecossistema', 'reserva legal', 'fauna', 'flora'],
    sensor: ['sensor', 'estacao meteorologica', 'telemetria', 'datalogger'],
    intangible: ['licenca ambiental', 'credito carbono', 'certificado ambiental', 'alvara'],
    blueprint: ['planta baixa', 'dxf', 'cad', 'projeto executivo'],
};

/** Pre-compiled regex for each keyword — uses \b word boundary to avoid substring matches */
const _FAMILY_REGEX_CACHE = new Map();
function _getFamilyRegex(keyword) {
    if (!_FAMILY_REGEX_CACHE.has(keyword)) {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        _FAMILY_REGEX_CACHE.set(keyword, new RegExp('\\b' + escaped + '\\b'));
    }
    return _FAMILY_REGEX_CACHE.get(keyword);
}

/**
 * Detects the most likely element family from contextual text.
 * Uses regex for well IDs and keyword matching for other families.
 *
 * @param {string} parameterName - Parameter name from the table
 * @param {string[]} [tableHeaders] - Header row of the table
 * @param {string} [fullText] - Additional context text
 * @returns {{ family: string, elementName: string|null }}
 */
export function detectFamilyFromContext(parameterName, tableHeaders, fullText) {
    const allText = [parameterName || '', ...(tableHeaders || []), fullText || '']
        .join(' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    // Check for well ID pattern first (most specific)
    const wellMatch = (parameterName || '').match(WELL_ID_RE);
    if (wellMatch) {
        return { family: 'well', elementName: canonicalizeWellId(wellMatch[0]) || wellMatch[0] };
    }

    // Also check headers for well IDs
    for (const h of tableHeaders || []) {
        const hMatch = (h || '').match(WELL_ID_RE);
        if (hMatch) {
            return { family: 'well', elementName: null };
        }
    }

    // Keyword matching — uses \b word boundary to avoid false positives
    // (e.g., "rio" inside "relatório", "solo" inside "absoluto")
    for (const [family, keywords] of Object.entries(FAMILY_KEYWORDS)) {
        for (const kw of keywords) {
            const normalized = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const regex = _getFamilyRegex(normalized);
            if (regex.test(allText)) {
                return { family, elementName: null };
            }
        }
    }

    return { family: 'generic', elementName: null };
}

/**
 * Classifies an array of staging objects by confidence color.
 *
 * @param {Object[]} stagings - Array of staging objects
 * @returns {{ green: Object[], yellow: Object[], red: Object[] }}
 */
export function classifyByConfidence(stagings) {
    const classified = { green: [], yellow: [], red: [] };

    for (const s of stagings) {
        if (s.confidence === 'green') classified.green.push(s);
        else if (s.confidence === 'yellow') classified.yellow.push(s);
        else classified.red.push(s);
    }

    return classified;
}

/**
 * Returns a summary of staging results for display.
 *
 * @param {Object[]} stagings
 * @returns {{ total: number, green: number, yellow: number, red: number, autoIngestible: number }}
 */
export function getStagingSummary(stagings) {
    const classified = classifyByConfidence(stagings);
    return {
        total: stagings.length,
        green: classified.green.length,
        yellow: classified.yellow.length,
        red: classified.red.length,
        autoIngestible: classified.green.length,
    };
}

// ── Coordinate Table Detection + CRS ────────────────────────

const COORD_KEYWORDS = {
    wellId: ['ponto', 'point', 'poco', 'well', 'station', 'estacion', 'id', 'nome'],
    easting: ['easting', 'este', 'coord_x', 'x_utm', 'x', 'longitude', 'lon', 'lng', 'long'],
    northing: ['northing', 'norte', 'coord_y', 'y_utm', 'y', 'latitude', 'lat'],
    elevation: ['cota', 'elevacao', 'altitude', 'elevation', 'z', 'depth', 'profundidade', 'cota do terreno'],
};

/**
 * CRS patterns — universal, not just Brazilian.
 * Each pattern resolves to an EPSG code.
 */
const CRS_PATTERNS = [
    { re: /EPSG\s*:?\s*(\d{4,5})/i, resolve: (m) => `EPSG:${m[1]}` },
    { re: /WGS\s*[-]?\s*84/i, crs: 'EPSG:4326' },
    { re: /NAD\s*[-]?\s*83/i, crs: 'EPSG:4269' },
    { re: /NAD\s*[-]?\s*27/i, crs: 'EPSG:4267' },
    { re: /ETRS\s*[-]?\s*89/i, crs: 'EPSG:4258' },
    { re: /GDA\s*[-]?\s*2020/i, crs: 'EPSG:7844' },
    { re: /GDA\s*[-]?\s*94/i, crs: 'EPSG:4283' },
    { re: /JGD\s*[-]?\s*2011/i, crs: 'EPSG:6668' },
    { re: /NZGD\s*[-]?\s*2000/i, crs: 'EPSG:4167' },
    { re: /SWEREF\s*[-]?\s*99/i, crs: 'EPSG:3006' },
    { re: /OSGB\s*[-]?\s*36/i, crs: 'EPSG:27700' },
    {
        re: /SIRGAS\s*2000\s*(?:\/\s*)?UTM\s*(?:zona?|zone)?\s*(\d{1,2})\s*([NS])/i,
        resolve: (m) => `EPSG:${31960 + parseInt(m[1])}`,
    },
    { re: /SIRGAS\s*2000/i, crs: 'EPSG:4674' },
    { re: /SAD\s*[-]?\s*69/i, crs: 'EPSG:4618' },
    {
        re: /UTM\s*(?:zona?|zone)?\s*(\d{1,2})\s*([NS])/i,
        resolve: (m) => `EPSG:${m[2].toUpperCase() === 'N' ? 32600 + parseInt(m[1]) : 32700 + parseInt(m[1])}`,
    },
    { re: /fuso\s*(\d{1,2})/i, resolve: (m) => `EPSG:${32700 + parseInt(m[1])}` },
];

/**
 * Parse coordinate value handling both BR (333.456,78) and US (333,456.78) formats.
 * @param {string} text
 * @returns {number|null}
 */
export function parseCoordinate(text) {
    const t = (text || '').trim();
    if (!t) return null;
    // BR: "333.456,78" or "7.394.123,45"
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
    // US: "333,456.78"
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
    // Simple: "333456.78" or "333456,78"
    return parseFloat(t.replace(/,/g, '.')) || null;
}

/**
 * Detect CRS from free text (document body, headers, metadata).
 * Returns first match or null.
 * @param {string} text - Full document text
 * @returns {{ epsg: string, raw: string }|null}
 */
export function detectCRS(text) {
    if (!text) return null;
    for (const p of CRS_PATTERNS) {
        const m = p.re.exec(text);
        if (m) {
            const epsg = p.resolve ? p.resolve(m) : p.crs;
            return { epsg, raw: m[0] };
        }
    }
    return null;
}

/**
 * Detect if a table contains coordinate data.
 * @param {string[][]} table - 2D array (header + data rows)
 * @returns {{ wellCol: number, eastingCol: number, northingCol: number, elevationCol: number, coordinates: Array }|null}
 */
export function detectCoordinateTable(table) {
    if (!table || table.length < 2) return null;

    const header = table[0].map((h) =>
        (h || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim(),
    );

    // Find columns by keyword match
    const findCol = (keywords) => {
        for (let c = 0; c < header.length; c++) {
            if (keywords.some((kw) => header[c].includes(kw))) return c;
        }
        return -1;
    };

    const eastingCol = findCol(COORD_KEYWORDS.easting);
    const northingCol = findCol(COORD_KEYWORDS.northing);

    // Must have at least easting + northing
    if (eastingCol === -1 || northingCol === -1) return null;

    const wellCol = findCol(COORD_KEYWORDS.wellId);
    const elevationCol = findCol(COORD_KEYWORDS.elevation);

    // Extract coordinates from data rows
    const coordinates = [];
    for (let r = 1; r < table.length; r++) {
        const row = table[r];
        const easting = parseCoordinate(row[eastingCol]);
        const northing = parseCoordinate(row[northingCol]);
        if (easting == null || northing == null) continue;

        const wellId = wellCol >= 0 ? (row[wellCol] || '').trim() : null;
        const elevation = elevationCol >= 0 ? parseCoordinate(row[elevationCol]) : null;

        coordinates.push({ wellId, easting, northing, elevation });
    }

    if (coordinates.length === 0) return null;

    return { wellCol, eastingCol, northingCol, elevationCol, coordinates };
}

// ── Field Extractors ────────────────────────────────────────

const FIELD_EXTRACTORS = [
    {
        field: 'project.responsibleTechnical',
        patterns: [
            /respons[aá]vel\s*t[eé]cnico\s*:?\s*([^\n;]{3,80}?)(?:\.|$|\n|laborat|metodo|data|custo)/i,
            /technical\s*responsible\s*:?\s*([^\n;]{3,80}?)(?:\.|$|\n)/i,
        ],
        type: 'text',
        scope: 'project',
    },
    {
        field: 'observation.lab_name',
        patterns: [
            /laborat[oó]rio\s*:?\s*([^\n;]{3,80}?)(?:\.|$|\n|metodo|data|custo)/i,
            /laboratory\s*:?\s*([^\n;]{3,80}?)(?:\.|$|\n)/i,
        ],
        type: 'text',
        scope: 'observation',
    },
    {
        field: 'observation.analytical_method',
        patterns: [/m[eé]todo\s*(?:anal[ií]tico)?\s*:?\s*((?:EPA|USEPA|SMEWW|ASTM|ISO|ABNT|NBR)\s*\S+)/i],
        type: 'text',
        scope: 'observation',
    },
    {
        field: 'observation.date',
        patterns: [
            /data\s*(?:da\s*)?coleta\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
            /sampling\s*date\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
        ],
        type: 'date',
        scope: 'observation',
    },
    {
        field: 'well.profile.constructive.totalDepth',
        patterns: [/prof(?:undidade)?\s*(?:total)?\s*:?\s*(\d+[.,]?\d*)\s*m/i],
        type: 'number',
        scope: 'element',
    },
    {
        field: 'well.profile.waterLevel.depth',
        patterns: [
            /n[ií]vel\s*(?:d['´]?\s*[aá]gua|est[aá]tico)\s*:?\s*(\d+[.,]?\d*)/i,
            /(?:N\.?\s*A\.?|SWL|water\s*level)\s*:?\s*(\d+[.,]?\d*)/i,
        ],
        type: 'number',
        scope: 'element',
    },
    {
        field: 'observation.cost.analytical',
        patterns: [/custo\s*(?:anal[ií]tico)?\s*:?\s*R?\$?\s*(\d+[.,]?\d*)/i],
        type: 'currency',
        scope: 'observation',
    },
    {
        field: 'observation.detection_limit',
        patterns: [/(?:LQ|LD|LOQ|LOD|limite\s*de\s*(?:quantifica|detec))\s*:?\s*(\d+[.,]?\d*)/i],
        type: 'number',
        scope: 'observation',
    },
    {
        field: 'observation.sample_code',
        patterns: [/(?:amostra|sample)\s*(?:id|code|codigo)?\s*:?\s*([A-Z0-9][\w\-]+)/i],
        type: 'text',
        scope: 'observation',
    },
];

/**
 * Extract structured fields from free text using regex patterns.
 * Fields extracted from free text get confidence YELLOW (not GREEN).
 * @param {string} text - Document text
 * @returns {Array<{ field: string, value: string, type: string, scope: string, raw: string, confidence: string }>}
 */
export function extractFields(text) {
    if (!text) return [];
    const results = [];

    for (const extractor of FIELD_EXTRACTORS) {
        for (const pattern of extractor.patterns) {
            const m = pattern.exec(text);
            if (m && m[1]) {
                let value = m[1].trim();
                // Parse number types
                if (extractor.type === 'number' || extractor.type === 'currency') {
                    value = parseFloat(value.replace(/,/g, '.')) || value;
                }
                results.push({
                    field: extractor.field,
                    value,
                    type: extractor.type,
                    scope: extractor.scope,
                    raw: m[0],
                    confidence: 'yellow', // text corrido = YELLOW per devil's advocate
                });
                break; // first match per extractor
            }
        }
    }

    return results;
}

/**
 * Extract deterministic document metadata: CRS, coordinate tables, fields.
 * (Complementa extractDocumentMetadata em docAIAnalyzer.js que usa LLM)
 * @param {string} fullText - Full document text
 * @param {Array} tables - All extracted tables
 * @returns {{ crs: object|null, coordinateTables: Array, fields: Array }}
 */
export function extractDocMetadataDeterministic(fullText, tables) {
    const crs = detectCRS(fullText);
    const coordinateTables = [];

    for (let i = 0; i < (tables || []).length; i++) {
        const coordResult = detectCoordinateTable(tables[i].table || tables[i]);
        if (coordResult) {
            coordinateTables.push({ tableIndex: i, ...coordResult });
        }
    }

    const fields = extractFields(fullText);

    return { crs, coordinateTables, fields };
}
