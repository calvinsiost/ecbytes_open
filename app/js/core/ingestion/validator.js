// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   INGESTION VALIDATOR — Pre-ingestion data quality checks
   Validacao de dados mapeados antes de inserir no modelo.

   Verifica:
   - Tipos de dados (numerico onde espera numerico)
   - Campos obrigatorios (elementName, sampleCode)
   - Duplicatas (amostras repetidas)
   - Amostras orfas (sem local correspondente)
   - Outliers (valores muito acima ou abaixo do esperado)
   - Conformidade regulatoria (valores vs limites CETESB/CONAMA)
   ================================================================ */

import { resolveChemical, resolveUnit } from './mapper.js';
import { normalizeDate } from './dateNormalizer.js';

/**
 * Retorna funcao normalizeDate para uso sincrono dentro de transformData.
 * Separado para facilitar fallback se modulo nao carregar.
 */
function _getNormalizeDate() {
    return normalizeDate;
}

// ----------------------------------------------------------------
// REGULATORY LIMITS — Para pre-validacao de conformidade
// Limites CETESB 2021 para agua subterranea (principais).
// ----------------------------------------------------------------

const REGULATORY_LIMITS_AS = {
    '71-43-2': { name: 'Benzeno', limit: 5, unit: 'ug/L', source: 'CETESB 2021' },
    '108-88-3': { name: 'Tolueno', limit: 700, unit: 'ug/L', source: 'CETESB 2021' },
    '100-41-4': { name: 'Etilbenzeno', limit: 300, unit: 'ug/L', source: 'CETESB 2021' },
    '1330-20-7': { name: 'Xilenos', limit: 500, unit: 'ug/L', source: 'CETESB 2021' },
    '7440-38-2': { name: 'Arsênio', limit: 10, unit: 'ug/L', source: 'CETESB 2021' },
    '7440-43-9': { name: 'Cádmio', limit: 5, unit: 'ug/L', source: 'CETESB 2021' },
    '7439-92-1': { name: 'Chumbo', limit: 10, unit: 'ug/L', source: 'CETESB 2021' },
    '7439-97-6': { name: 'Mercúrio', limit: 1, unit: 'ug/L', source: 'CETESB 2021' },
    '127-18-4': { name: 'PCE', limit: 40, unit: 'ug/L', source: 'CETESB 2021' },
    '79-01-6': { name: 'TCE', limit: 70, unit: 'ug/L', source: 'CETESB 2021' },
};

// ----------------------------------------------------------------
// MAIN VALIDATION FUNCTION
// ----------------------------------------------------------------

/**
 * Valida dados mapeados antes da ingestao.
 * Recebe dados ja transformados pelo mapper e retorna report.
 *
 * @param {Object} data - Dados transformados
 * @param {Array} data.locations - Linhas de locais mapeados
 * @param {Array} data.samples - Linhas de amostras mapeadas
 * @param {Array} data.results - Linhas de resultados mapeados
 * @param {Object} mapping - MappingProposal usado na transformacao
 * @returns {ValidationReport}
 */
export function validateMappedData(data, mapping) {
    const errors = [];
    const warnings = [];

    const locations = data.locations || [];
    const samples = data.samples || [];
    const results = data.results || [];

    // ---- 1. Validar locais ----
    const locationNames = new Set();
    locations.forEach((loc, i) => {
        const name = loc.elementName;
        if (!name || String(name).trim() === '') {
            errors.push({
                type: 'missing_required',
                sheet: 'locations',
                row: i + 1,
                column: 'elementName',
                message: `Linha ${i + 1}: local sem identificador (sys_loc_code vazio)`,
                severity: 'error',
            });
        } else if (locationNames.has(name)) {
            warnings.push({
                type: 'duplicate',
                sheet: 'locations',
                row: i + 1,
                column: 'elementName',
                message: `Linha ${i + 1}: local duplicado '${name}'`,
                severity: 'warning',
            });
        } else {
            locationNames.add(name);
        }

        // Coordenadas
        if (loc.latitude != null && (isNaN(Number(loc.latitude)) || Math.abs(Number(loc.latitude)) > 90)) {
            errors.push({
                type: 'type_mismatch',
                sheet: 'locations',
                row: i + 1,
                column: 'latitude',
                message: `Linha ${i + 1}: latitude invalida '${loc.latitude}'`,
                severity: 'error',
            });
        }
        if (loc.longitude != null && (isNaN(Number(loc.longitude)) || Math.abs(Number(loc.longitude)) > 180)) {
            errors.push({
                type: 'type_mismatch',
                sheet: 'locations',
                row: i + 1,
                column: 'longitude',
                message: `Linha ${i + 1}: longitude invalida '${loc.longitude}'`,
                severity: 'error',
            });
        }
    });

    // ---- 2. Validar amostras ----
    const sampleCodes = new Set();
    samples.forEach((sample, i) => {
        const code = sample.sampleCode;
        if (!code || String(code).trim() === '') {
            errors.push({
                type: 'missing_required',
                sheet: 'samples',
                row: i + 1,
                column: 'sampleCode',
                message: `Linha ${i + 1}: amostra sem codigo (sys_sample_code vazio)`,
                severity: 'error',
            });
            return;
        }

        if (sampleCodes.has(code)) {
            warnings.push({
                type: 'duplicate',
                sheet: 'samples',
                row: i + 1,
                column: 'sampleCode',
                message: `Linha ${i + 1}: amostra duplicada '${code}'`,
                severity: 'warning',
            });
        }
        sampleCodes.add(code);

        // Amostra sem local correspondente
        const locRef = sample.elementName;
        if (locRef && !locationNames.has(locRef)) {
            warnings.push({
                type: 'orphan_sample',
                sheet: 'samples',
                row: i + 1,
                column: 'elementName',
                message: `Linha ${i + 1}: amostra '${code}' referencia local '${locRef}' nao encontrado em Locais`,
                severity: 'warning',
            });
        }

        // Data de coleta
        if (sample.sampleDate) {
            const d = new Date(sample.sampleDate);
            if (isNaN(d.getTime())) {
                warnings.push({
                    type: 'type_mismatch',
                    sheet: 'samples',
                    row: i + 1,
                    column: 'sampleDate',
                    message: `Linha ${i + 1}: data de coleta invalida '${sample.sampleDate}'`,
                    severity: 'warning',
                });
            }
        }
    });

    // ---- 3. Validar resultados ----
    let detectedCount = 0;
    let nonDetectCount = 0;
    const chemicalSet = new Set();
    const exceedances = [];

    results.forEach((result, i) => {
        // Resultado sem amostra correspondente
        const sampleRef = result.sampleCode;
        if (sampleRef && !sampleCodes.has(sampleRef)) {
            warnings.push({
                type: 'orphan_sample',
                sheet: 'results',
                row: i + 1,
                column: 'sampleCode',
                message: `Linha ${i + 1}: resultado referencia amostra '${sampleRef}' nao encontrada`,
                severity: 'warning',
            });
        }

        // Tipo de dado do valor
        const val = result.resultValue;
        const detectFlag = String(result.detectFlag || '').toUpperCase();

        if (detectFlag === 'Y' || detectFlag === '') {
            if (val != null && val !== '' && isNaN(Number(val))) {
                errors.push({
                    type: 'type_mismatch',
                    sheet: 'results',
                    row: i + 1,
                    column: 'resultValue',
                    message: `Linha ${i + 1}: valor nao numerico '${val}'`,
                    severity: 'error',
                });
            }
        }

        // Contagem detect/non-detect
        if (detectFlag === 'N') {
            nonDetectCount++;
        } else if (val != null && val !== '') {
            detectedCount++;
        }

        // Quimico
        const chemName = result.chemicalName || '';
        const cas = result.casNumber || '';
        if (chemName) chemicalSet.add(chemName);

        // Conformidade regulatoria (pré-validação)
        if (val != null && val !== '' && !isNaN(Number(val)) && cas) {
            const reg = REGULATORY_LIMITS_AS[cas];
            if (reg && Number(val) > reg.limit) {
                const ratio = (Number(val) / reg.limit).toFixed(0);
                exceedances.push({
                    type: 'exceeds_limit',
                    sheet: 'results',
                    row: i + 1,
                    column: 'resultValue',
                    message: `${result.elementName || sampleRef} ${reg.name} ${val} ${result.resultUnit || 'ug/L'} excede ${reg.source} (${reg.limit} ${reg.unit}) em ${ratio}x`,
                    severity: 'warning',
                });
            }
        }
    });

    warnings.push(...exceedances);

    // ---- 4. Detectar campanhas ----
    const campaignPrefixes = new Set();
    samples.forEach((s) => {
        const code = s.sampleCode || '';
        const prefix = code.split('_')[0];
        if (prefix && /^\d{8}$/.test(prefix)) {
            campaignPrefixes.add(prefix);
        }
    });

    // ---- 5. Detectar date range ----
    const dates = samples
        .map((s) => s.sampleDate)
        .filter((d) => d != null)
        .map((d) => new Date(d))
        .filter((d) => !isNaN(d.getTime()))
        .sort((a, b) => a - b);

    // ---- 6. Stats ----
    const stats = {
        locations: locations.length,
        samples: samples.length,
        results: results.length,
        campaigns: campaignPrefixes.size || 1,
        detected: detectedCount,
        nonDetect: nonDetectCount,
        chemicals: [...chemicalSet],
        dateRange: {
            min: dates.length ? dates[0].toISOString().slice(0, 10) : null,
            max: dates.length ? dates[dates.length - 1].toISOString().slice(0, 10) : null,
        },
        exceedances: exceedances.length,
    };

    // ---- 7. D13: QAQC por parametro ----
    // Calcula estatisticas de deteccao/nao-deteccao por composto quimico.
    // Produz top 10 parametros por frequencia de medicao.
    const paramStats = {};
    for (const result of results) {
        const pid = result.casNumber || result.chemicalName || 'unknown';
        if (!paramStats[pid]) {
            paramStats[pid] = {
                name: result.chemicalName || pid,
                nObs: 0,
                nDet: 0,
                nND: 0,
                values: [],
                unit: result.resultUnit || '',
            };
        }
        const ps = paramStats[pid];
        ps.nObs++;
        const isND = String(result.detectFlag || '').toUpperCase() === 'N';
        if (isND) {
            ps.nND++;
        } else {
            ps.nDet++;
            if (result.resultValue != null && result.resultValue !== '') {
                const v = Number(result.resultValue);
                if (!isNaN(v)) ps.values.push(v);
            }
        }
    }

    stats.qaqc = {
        byParameter: Object.entries(paramStats)
            .map(([pid, ps]) => ({
                parameterId: pid,
                parameterName: ps.name,
                nObs: ps.nObs,
                nDet: ps.nDet,
                nND: ps.nND,
                pctND: ps.nObs > 0 ? Math.round((ps.nND / ps.nObs) * 100) : 0,
                meanDet: ps.values.length > 0 ? ps.values.reduce((a, b) => a + b, 0) / ps.values.length : null,
                maxDet: ps.values.length > 0 ? Math.max(...ps.values) : null,
                unit: ps.unit,
            }))
            .sort((a, b) => b.nObs - a.nObs)
            .slice(0, 10),
        dateRange: { min: stats.dateRange.min, max: stats.dateRange.max },
    };

    // Tambem conta action levels detectados pelo mapper para uso no wizard
    stats.actionLevels = 0; // sera sobrescrito pelo mapper se necessario

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats,
    };
}

// ----------------------------------------------------------------
// OHS VALIDATION
// ----------------------------------------------------------------

/**
 * Valida dados ocupacionais mapeados.
 * Complementa validateMappedData para dominio OHS.
 *
 * @param {Object} data - Dados transformados (com campos OHS)
 * @param {Object} mapping - MappingProposal
 * @returns {{errors: Array, warnings: Array, ohsStats: Object}}
 */
export function validateOHSData(data, mapping) {
    const errors = [];
    const warnings = [];
    const results = data.results || [];

    let aboveOEL = 0;
    let aboveBEI = 0;
    let hasWorkerPII = false;
    const workerIds = new Set();
    const gheIds = new Set();
    const agents = new Set();

    results.forEach((r, i) => {
        // Coleta IDs unicos
        if (r.workerId) {
            workerIds.add(String(r.workerId).trim());
            hasWorkerPII = true;
        }
        if (r.workerName) hasWorkerPII = true;
        if (r.gheId) gheIds.add(String(r.gheId).trim());
        if (r.exposureAgent || r.chemicalName) {
            agents.add(String(r.exposureAgent || r.chemicalName).trim());
        }

        // TWA-8h vs OEL: flag se excede
        const twa = r.twa8h != null ? Number(r.twa8h) : null;
        const oel = r.oel != null ? Number(r.oel) : null;
        if (twa != null && oel != null && !isNaN(twa) && !isNaN(oel) && twa > oel) {
            aboveOEL++;
            const workerRef = r.workerId || r.workerName || `linha ${i + 1}`;
            const agentRef = r.exposureAgent || r.chemicalName || 'agente';
            warnings.push({
                type: 'exceeds_oel',
                sheet: 'results',
                row: i + 1,
                message: `${workerRef} ${agentRef}: TWA ${twa} > OEL ${oel}`,
                severity: 'warning',
            });
        }

        // BEI: flag se biomonitoramento excede
        const bei = r.bei != null ? Number(r.bei) : null;
        const val = r.resultValue != null ? Number(r.resultValue) : null;
        if (bei != null && val != null && !isNaN(bei) && !isNaN(val) && val > bei) {
            aboveBEI++;
            const workerRef = r.workerId || r.workerName || `linha ${i + 1}`;
            const analyte = r.chemicalName || r.exposureAgent || 'analito';
            warnings.push({
                type: 'exceeds_bei',
                sheet: 'results',
                row: i + 1,
                message: `${workerRef} ${analyte}: ${val} > BEI ${bei}`,
                severity: 'warning',
            });
        }

        // Duracao > 8h — possivelmente incorreto
        const duration = r.durationHours != null ? Number(r.durationHours) : null;
        if (duration != null && !isNaN(duration) && duration > 12) {
            warnings.push({
                type: 'outlier',
                sheet: 'results',
                row: i + 1,
                message: `Linha ${i + 1}: duracao de exposicao ${duration}h (>12h) — verificar`,
                severity: 'warning',
            });
        }
    });

    // LGPD warning
    if (hasWorkerPII) {
        warnings.push({
            type: 'lgpd',
            message:
                'Dados pessoais de trabalhadores detectados (nome, matricula, CPF). Verifique consentimento LGPD antes de importar.',
            severity: 'warning',
        });
    }

    return {
        errors,
        warnings,
        ohsStats: {
            workers: workerIds.size,
            ghes: gheIds.size,
            agents: [...agents],
            aboveOEL,
            aboveBEI,
            hasWorkerPII,
        },
    };
}

/**
 * Transforma dados brutos (rows) usando mapeamento de colunas.
 * Aplica o MappingProposal para gerar locations[], samples[], results[].
 *
 * @param {ParsedSpreadsheet} parsed
 * @param {MappingProposal} mapping
 * @param {{dateLocale?: 'dd/mm'|'mm/dd'|'auto'}} options - Opcoes de normalizacao
 * @returns {{locations: Array, samples: Array, results: Array, actionLevels: Array}}
 */
export function transformData(parsed, mapping, options = {}) {
    const locations = [];
    const samples = [];
    const results = [];
    const actionLevels = [];

    // Lazy import para evitar dependencia circular
    let _normalizeDate = null;
    try {
        // Sera resolvido sincronamente se modulo ja foi carregado
        _normalizeDate = _getNormalizeDate();
    } catch {
        /* fallback: sem normalizacao */
    }

    const dateLocale = options.dateLocale || 'dd/mm';

    for (const sheetMapping of mapping.sheetMappings) {
        const sheet = parsed.sheets.find((s) => s.name === sheetMapping.sourceSheet);
        if (!sheet) continue;

        // Coleta mapeamentos de coluna para esta sheet
        const colMap = {};
        for (const col of mapping.columns) {
            if (col.sourceSheet === sheetMapping.sourceSheet && col.targetField) {
                colMap[col.sourceColumn] = col.targetField;
            }
        }

        for (const row of sheet.rows) {
            const mapped = {};
            for (const [srcCol, targetField] of Object.entries(colMap)) {
                mapped[targetField] = row[srcCol];
            }

            // Normalizar campos de data (DD/MM/YYYY, Date objects, serials Excel → ISO)
            if (_normalizeDate && mapped.sampleDate != null) {
                mapped.sampleDate = _normalizeDate(mapped.sampleDate, dateLocale);
            }

            switch (sheetMapping.targetEntity) {
                case 'elements':
                    locations.push(mapped);
                    break;
                case 'samples':
                    samples.push(mapped);
                    break;
                case 'results':
                    results.push(mapped);
                    break;
                case 'actionLevels':
                    actionLevels.push(mapped);
                    break;
            }
        }
    }

    // Enriquece results com elementName via join com samples
    const sampleLocMap = {};
    for (const s of samples) {
        if (s.sampleCode && s.elementName) {
            sampleLocMap[s.sampleCode] = s.elementName;
        }
    }
    for (const r of results) {
        if (r.sampleCode && !r.elementName) {
            r.elementName = sampleLocMap[r.sampleCode] || null;
        }
    }

    return { locations, samples, results, actionLevels };
}
