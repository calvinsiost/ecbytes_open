// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)

/* ================================================================
   INGESTION PARSER — Parse XLSX/CSV and detect EDD format
   Leitor de planilhas com deteccao automatica de formato EPA EDD.

   Formatos suportados:
   - XLSX/XLS via SheetJS (CDN)
   - CSV com auto-deteccao de separador
   - Deteccao: EDD R2/R3/R5, EDD-BR, ecbyts CSV, desconhecido

   FORMATOS AMBIENTAIS CONHECIDOS (referencia para expansao futura):
   ────────────────────────────────────────────────────────────────

   ▸ EPA EDD (Electronic Data Deliverable) — IMPLEMENTADO
     Formato padrao da EPA para entrega eletronica de dados de
     investigacao ambiental. Variantes por regiao (R2, R3, R5).
     Sheets: Location, Sample, TestResultsQC, Well, WaterLevel.
     Colunas-chave: sys_loc_code, sys_sample_code, chemical_name,
     result_value, detect_flag, reporting_detection_limit.
     Ref: https://www.epa.gov/edd

   ▸ EQuIS Schema (EarthSoft Environmental Quality Information System)
     Padrao de mercado dominante em projetos de remediacao.
     Similar ao EDD mas com esquema proprietario (EQuIS EDD Format).
     Sheets: DT_LOCATION, DT_SAMPLE, DT_RESULT, DT_WELL, DT_WATER_LEVEL.
     Colunas-chave: LOC_ID, SYS_SAMPLE_CODE, CHEMICAL_NAME,
     RESULT_VALUE, DETECT_FLAG, REPORTING_LIMIT.
     Ref: https://earthsoft.com/products/equis/

   ▸ WQX (Water Quality Exchange) — EPA/USGS
     Formato XML/CSV para submissao de dados de qualidade de agua
     ao WQX Web e STORET. Usado por estados e tribos nos EUA.
     Entidades: Organization, Project, MonitoringLocation, Activity,
     Result, BiologicalResult.
     Colunas-chave: MonitoringLocationIdentifier, ActivityStartDate,
     CharacteristicName, ResultMeasureValue, ResultDetectionCondition.
     Ref: https://www.epa.gov/waterdata/water-quality-data-wqx

   ▸ SEDD (Staged Electronic Data Deliverable) — EPA
     Formato intermediario entre planilhas e banco de dados EPA.
     Versao simplificada do EDD com stages: Location, Sample, Result.
     Foco em compatibilidade com STORET/WQX via lookup tables.
     Ref: https://www.epa.gov/edd (sub-formato do EDD framework)

   ▸ ERPIMS (Environmental Resources Program Information Management System)
     Formato legado do US Army Corps of Engineers.
     Usado em projetos BRAC (Base Realignment and Closure).
     Tabelas: LOCATION, SAMPLE, CHEMISTRY, FIELD_MEAS.
     Colunas: LOCID, SAMPID, PARAM, CONC, UNITS, DETFLAG, QUALF.
     Ref: https://www.usace.army.mil/ERPIMS

   ▸ ADaM (Analytical Data Model) — DoD/EDSP
     Modelo de dados analiticos do Department of Defense.
     Similar ao EDD com foco em CLP (Contract Laboratory Program).
     Tabelas: SITE, STATION, SAMPLE, TESTRESULT.
     Colunas: STA_ID, SAM_ID, ANA_TYPE, RES_VALUE, RES_QUAL.

   ▸ SDWIS (Safe Drinking Water Information System) — EPA
     Sistema de dados de agua potavel. Monitoramento de conformidade
     com Safe Drinking Water Act (SDWA).
     Entidades: WaterSystem, Violation, Sample, Analyte.
     Colunas: PWSID, SamplePointID, AnalyteCode, Concentration.
     Ref: https://www.epa.gov/ground-water-and-drinking-water/sdwis

   ▸ ESdat (Environmental Data Management System)
     Software australiano/internacional de gestao de dados ambientais.
     CSV export com formato padronizado (Location, ChemistryResult, etc.).
     Colunas: SampleCode, ChemCode, ChemName, Result_Total,
     Result_Unit, LOR_Num, LOR_Unit, Method.
     Ref: https://www.esdat.net/

   ▸ OGC SensorThings API — Open Geospatial Consortium
     API REST/JSON para IoT e sensores ambientais em tempo real.
     Entidades: Thing, Location, Datastream, Observation.
     JSON com @iot.navigationLink entre entidades.
     Relevante para integracao com redes de sensores (sensor.js).
     Ref: https://www.ogc.org/standard/sensorthings/

   ▸ WaterML 2.0 — OGC/WMO
     Formato XML para series temporais hidrologicas.
     Parte do WMO HY_Features model. Usado em redes de monitoramento.
     Elementos: MonitoringPoint, ObservationProcess, MeasurementTimeseries.
     Ref: https://www.ogc.org/standard/waterml/

   ▸ GeoSciML (Geoscience Markup Language) — OGC/CGI
     Formato XML/GML para dados geologicos e geotecnicos.
     Modela: GeologicUnit, MappedFeature, Borehole, BoreholeLog.
     Relevante para integracao com dados de sondagem (borehole.js).
     Ref: https://www.ogc.org/standard/geosciml/

   ▸ LIMS-Export (Laboratory Information Management System)
     Padrao generico de exportacao de sistemas de laboratorio.
     Varia por fornecedor (LIMS2000, STARLIMS, LabWare, etc.)
     Colunas tipicas: LabSampleID, ClientSampleID, Analyte,
     Result, Units, MDL, RDL, AnalysisDate, Method, QCType.
     Sem formato unico — requer mapeamento adaptativo (mapper.js).

   FORMATOS OCUPACIONAIS (OHS) CONHECIDOS:
   ────────────────────────────────────────────────────────────────

   ▸ AIHA Essential Data Attributes — IMPLEMENTADO
     Formato padrao da AIHA para dados de higiene industrial.
     Colunas-chave: worker_id, ghe, agent, twa_8h, stel, sample_type.

   ▸ DOEHRS-IH EDD — IMPLEMENTADO
     Formato do Departamento de Defesa dos EUA para exposicao militar.
     Colunas-chave: ssn_last4, ghe_code, agent_name, result, oel.

   ▸ NR-15 Assessment (Brasil/MTE) — IMPLEMENTADO
     Avaliacao de insalubridade conforme NR-15.
     Colunas-chave: matricula, agente, nivel, limite_tolerancia, grau.

   ▸ PPRA/PGR Report (Brasil/NR-9) — IMPLEMENTADO
     Programa de riscos ambientais / Gerenciamento de riscos.
     Colunas-chave: setor, ghe, risco, probabilidade, severidade.

   ▸ PCMSO Exams (Brasil/NR-7) — IMPLEMENTADO
     Programa de controle medico de saude ocupacional.
     Colunas-chave: matricula, exame, resultado, data, apto.

   ▸ LIMS Biomonitoring — IMPLEMENTADO
     Exportacoes de laboratorio para bioindicadores.
     Colunas-chave: patient_id, analyte, specimen, result, bei.

   NOTA: Apenas EPA EDD e formatos OHS estao implementados nesta versao.
   Os demais formatos estao documentados aqui como referencia para
   expansao futura. O mapeamento adaptativo via IA (mapper.js)
   consegue lidar com muitos desses formatos mesmo sem regras
   deterministicas, pois a estrutura columnar e similar.
   ================================================================ */

// ----------------------------------------------------------------
// SHEET NAME ALIASES — Nomes reconhecidos por conceito
// Cada formato EDD usa nomes diferentes para as mesmas tabelas.
// ----------------------------------------------------------------

const SHEET_ALIASES = {
    locations: ['location_v1', 'location_v3', 'location', 'locais', 'locations', 'sites', 'pontos', 'loc'],
    samples: ['sample_v4', 'labsample_v1', 'fieldsample_v1', 'sample', 'amostras', 'samples', 'coletas'],
    results: [
        'testresultsqc_v4',
        'testresults_v1',
        'fieldresults_v1',
        'testes e resultados',
        'results',
        'resultados',
        'analises',
        'test results',
        'testresults',
    ],
    wells: ['well_v1', 'wells', 'pocos', 'well'],
    waterLevels: ['waterlevel_v1', 'waterlevels', "nivel d'agua", 'niveis de agua', 'water_level'],
    actionLevels: [
        'ref_niveis de acao',
        'actionlevels',
        'action_levels',
        'standards',
        'limites',
        'valid values',
        'niveis de acao',
        'reference',
    ],
    formatInfo: ['format information', 'formatinfo', 'info'],
    // OHS sheet aliases
    exposures: ['exposures', 'exposicoes', 'exposure_data', 'ih_data', 'dados_exposicao', 'medicoes', 'measurements'],
    workers: ['workers', 'trabalhadores', 'employees', 'funcionarios', 'pessoal', 'personnel', 'workforce'],
    incidents: ['incidents', 'incidentes', 'acidentes', 'accidents', 'near_misses', 'quase_acidentes', 'events'],
    medical: ['medical', 'exames', 'pcmso', 'medical_surveillance', 'saude', 'health', 'aso', 'exames_medicos'],
    risks: ['risks', 'riscos', 'ppra', 'pgr', 'risk_assessment', 'avaliacao_risco', 'hazard_assessment'],
};

/**
 * Identifica a categoria de uma aba pelo nome.
 * Normaliza para lowercase e compara com aliases conhecidos.
 *
 * @param {string} sheetName
 * @returns {string|null} 'locations'|'samples'|'results'|...|null
 */
function classifySheet(sheetName) {
    const normalized = sheetName
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    for (const [category, aliases] of Object.entries(SHEET_ALIASES)) {
        if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) {
            return category;
        }
    }
    return null;
}

// ----------------------------------------------------------------
// FILE PARSING
// ----------------------------------------------------------------

/**
 * Faz parse de um arquivo (XLSX, CSV, XLS).
 * Usa SheetJS (window.XLSX) para binarios, parse manual para CSV.
 *
 * @param {File} file - Arquivo do input[type=file]
 * @returns {Promise<ParsedSpreadsheet>}
 */
export async function parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        return parseCSVFile(file);
    }

    // Guard: rejeitar arquivos XLSX > 10 MB (previne zip-bomb / DoS)
    // BS3: aumentado de 2 MB para 10 MB para suportar exports SIAGAS e EDDs grandes
    const MAX_XLSX_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_XLSX_BYTES) {
        throw new Error(
            `Arquivo XLSX excede o limite de 10 MB (${(file.size / 1024 / 1024).toFixed(1)} MB). Reduza o arquivo ou divida em partes.`,
        );
    }

    // XLSX / XLS — lazy-load SheetJS (Apache-2.0, cdnjs 0.18.5 — frozen version)
    if (!window.XLSX) {
        const { loadScriptCDN } = await import('../../utils/helpers/cdnLoader.js');
        await loadScriptCDN('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', {
            name: 'SheetJS',
            globalVar: 'XLSX',
        });
    }
    if (!window.XLSX) {
        throw new Error('SheetJS carregou mas window.XLSX nao esta disponivel.');
    }

    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true });

    const sheets = workbook.SheetNames.map((name) => {
        const ws = workbook.Sheets[name];
        const raw = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

        if (!raw.length) return { name, headers: [], typeRow: null, rows: [], rowCount: 0 };

        // Row 1: headers (remove # prefix do EDD)
        const headers = raw[0].map((h) => (h != null ? String(h).replace(/^#/, '').trim() : ''));

        // Row 2: tipo EDD? (contém "Text(", "Numeric", "DateTime")
        let typeRow = null;
        let dataStart = 1;
        if (raw.length > 1) {
            const row2Str = raw[1].map((c) => (c != null ? String(c) : '')).join(' ');
            if (/Text\(\d+\)|Numeric|DateTime/i.test(row2Str)) {
                typeRow = raw[1].map((c) => (c != null ? String(c).trim() : ''));
                dataStart = 2;
            }
        }

        // Data rows: converte para objetos {header: value}
        const rows = [];
        for (let i = dataStart; i < raw.length; i++) {
            const row = raw[i];
            if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;
            const obj = {};
            headers.forEach((h, j) => {
                if (h) obj[h] = row[j] != null ? row[j] : null;
            });
            rows.push(obj);
        }

        return {
            name,
            headers,
            typeRow,
            rows,
            rowCount: rows.length,
        };
    });

    return { fileName: file.name, sheets };
}

/**
 * Parse de arquivo CSV puro.
 * Auto-detecta separador (virgula, ponto-e-virgula, tab).
 *
 * @param {File} file
 * @returns {Promise<ParsedSpreadsheet>}
 */
async function parseCSVFile(file) {
    const text = await file.text();
    const separator = detectSeparator(text);
    const lines = text.split(/\r?\n/).filter((l) => l.trim());

    if (!lines.length) return { fileName: file.name, sheets: [] };

    const headers = parseCSVLine(lines[0], separator).map((h) => h.replace(/^#/, '').trim());

    // Check for type row
    let typeRow = null;
    let dataStart = 1;
    if (lines.length > 1) {
        const row2 = parseCSVLine(lines[1], separator).join(' ');
        if (/Text\(\d+\)|Numeric|DateTime/i.test(row2)) {
            typeRow = parseCSVLine(lines[1], separator);
            dataStart = 2;
        }
    }

    const rows = [];
    for (let i = dataStart; i < lines.length; i++) {
        const values = parseCSVLine(lines[i], separator);
        if (values.every((v) => !v.trim())) continue;
        const obj = {};
        headers.forEach((h, j) => {
            if (h) obj[h] = values[j] !== undefined && values[j].trim() !== '' ? values[j].trim() : null;
        });
        rows.push(obj);
    }

    const sheetName = file.name.replace(/\.(csv|tsv|txt)$/i, '');
    return {
        fileName: file.name,
        sheets: [{ name: sheetName, headers, typeRow, rows, rowCount: rows.length }],
    };
}

/**
 * Auto-detecta separador CSV por frequencia.
 * @param {string} text
 * @returns {string}
 */
function detectSeparator(text) {
    const sample = text.slice(0, 2000);
    const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
    for (const ch of sample) {
        if (ch in counts) counts[ch]++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Parse de uma linha CSV com suporte a campos entre aspas.
 * @param {string} line
 * @param {string} sep
 * @returns {string[]}
 */
function parseCSVLine(line, sep) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                current += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === sep) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

// ----------------------------------------------------------------
// OHS FORMAT MARKERS — Colunas que indicam dados ocupacionais
// ----------------------------------------------------------------

const OHS_MARKERS = [
    'ghe',
    'ghe_code',
    'grupo_homogeneo',
    'twa_8h',
    'twa',
    'stel',
    'ceiling',
    'worker_id',
    'matricula',
    'employee_id',
    'exposure_route',
    'via_exposicao',
    'bei',
    'oel',
    'tlv',
    'pel',
    'rel',
    'limite_tolerancia',
    'specimen',
    'biological_matrix',
    'matriz_biologica',
    'grau_insalubridade',
    'insalubridade',
    'nr15',
    'risco',
    'probabilidade',
    'severidade',
    'tipo_exame',
    'exam_type',
    'apto',
    'aptidao',
    'epi',
    'ppe',
    'ppe_status',
    'dias_perdidos',
    'days_lost',
    'tipo_acidente',
    'incident_type',
];

/**
 * Detecta subtipo OHS baseado nos headers presentes.
 *
 * @param {string[]} headers - Headers normalizados (lowercase)
 * @returns {string} 'ohs-aiha'|'ohs-doehrs'|'ohs-nr15'|'ohs-ppra'|'ohs-pcmso'|'ohs-bio'|'ohs-generic'
 */
function detectOHSSubtype(headers) {
    const h = new Set(headers);

    // DOEHRS-IH: ssn_last4 + ghe_code + agent_name
    if (h.has('ssn_last4') && h.has('ghe_code')) return 'ohs-doehrs';

    // NR-15: grau_insalubridade ou nr15 ou limite_tolerancia + matricula
    if (
        (h.has('grau_insalubridade') || h.has('insalubridade') || h.has('nr15')) &&
        (h.has('matricula') || h.has('agente'))
    )
        return 'ohs-nr15';

    // PPRA/PGR: risco + probabilidade + severidade
    if (h.has('risco') && (h.has('probabilidade') || h.has('severidade'))) return 'ohs-ppra';

    // PCMSO: tipo_exame ou exam_type ou apto
    if (h.has('tipo_exame') || h.has('exam_type') || h.has('apto') || h.has('aptidao')) return 'ohs-pcmso';

    // Biomonitoring: specimen/biological_matrix + bei/ibmp
    if (
        (h.has('specimen') || h.has('biological_matrix') || h.has('matriz_biologica')) &&
        (h.has('bei') || h.has('ibmp'))
    )
        return 'ohs-bio';

    // AIHA: ghe + twa_8h (ou twa) + agent
    if ((h.has('ghe') || h.has('similar_exposure_group')) && (h.has('twa_8h') || h.has('twa'))) return 'ohs-aiha';

    // Generico: qualquer OHS marker presente
    return 'ohs-generic';
}

// ----------------------------------------------------------------
// FORMAT DETECTION
// ----------------------------------------------------------------

/**
 * Detecta o formato de um ParsedSpreadsheet.
 * Retorna tipo, confianca e evidencias encontradas.
 *
 * @param {ParsedSpreadsheet} parsed
 * @returns {FormatInfo}
 */
export function detectFormat(parsed) {
    const evidence = [];
    let type = 'unknown';
    let confidence = 0;
    let version = null;

    // Classifica cada sheet
    const classified = {};
    for (const sheet of parsed.sheets) {
        const category = classifySheet(sheet.name);
        if (category) {
            classified[category] = sheet;
            evidence.push(`sheet '${sheet.name}' → ${category}`);
        }
    }

    // Verifica formato pela combinacao de sheets presentes
    const hasLocations = !!classified.locations;
    const hasSamples = !!classified.samples;
    const hasResults = !!classified.results;

    // Check format info sheet for version
    if (classified.formatInfo) {
        const infoSheet = classified.formatInfo;
        for (const row of infoSheet.rows || []) {
            const firstVal = Object.values(row).find((v) => v != null);
            if (firstVal) {
                const str = String(firstVal);
                if (str.includes('EPARegion2')) {
                    type = 'edd-r2';
                    evidence.push(`format info: ${str}`);
                } else if (str.includes('EPARegion3')) {
                    type = 'edd-r3';
                    evidence.push(`format info: ${str}`);
                } else if (str.includes('EPARegion5')) {
                    type = 'edd-r5';
                    evidence.push(`format info: ${str}`);
                }
                const vMatch = str.match(/Version:\s*([\d.]+)/i);
                if (vMatch) version = vMatch[1];
            }
        }
    }

    // Deteccao por sheet names formais
    if (type === 'unknown') {
        const sheetNames = parsed.sheets.map((s) => s.name.toLowerCase());

        if (
            sheetNames.some((n) => /^location_v\d/.test(n)) ||
            sheetNames.some((n) => /^sample_v\d/.test(n)) ||
            sheetNames.some((n) => /^testresults/i.test(n))
        ) {
            // Diferencia R2 vs R3 vs R5 por versao de sheet
            if (sheetNames.some((n) => n.includes('_v4'))) type = 'edd-r2';
            else if (sheetNames.some((n) => n.includes('_v3'))) type = 'edd-r5';
            else type = 'edd-r3';
            evidence.push('formal EDD sheet names detected');
        }
    }

    // Deteccao por sheet names PT-BR
    if (type === 'unknown') {
        const sheetNames = parsed.sheets.map((s) => s.name.toLowerCase());
        if (sheetNames.some((n) => n.includes('locais')) && sheetNames.some((n) => n.includes('amostra'))) {
            type = 'edd-br';
            evidence.push('Brazilian EDD sheet names detected');
        }
    }

    // Deteccao por colunas (single-sheet CSV)
    if (type === 'unknown' && parsed.sheets.length === 1) {
        const headers = parsed.sheets[0].headers.map((h) => h.toLowerCase());
        if (headers.includes('element_id') && headers.includes('parameter_id')) {
            type = 'ecbyts-csv';
            evidence.push('ecbyts native CSV columns detected');
        } else if (headers.includes('sys_loc_code') || headers.includes('sys_sample_code')) {
            type = 'edd-r2'; // assume R2 como default para CSV EDD
            evidence.push('EDD key columns found in CSV');
        }
    }

    // Deteccao OHS — sheets ocupacionais reconhecidas
    if (type === 'unknown') {
        const hasExposures = !!classified.exposures;
        const hasWorkers = !!classified.workers;
        const hasIncidents = !!classified.incidents;
        const hasMedical = !!classified.medical;
        const hasRisks = !!classified.risks;

        if (hasExposures || hasWorkers || hasIncidents || hasMedical || hasRisks) {
            // Multi-sheet OHS — detecta subtipo pela sheet mais especifica
            if (hasMedical) type = 'ohs-pcmso';
            else if (hasRisks) type = 'ohs-ppra';
            else if (hasIncidents) type = 'ohs-generic';
            else type = 'ohs-aiha';
            evidence.push('OHS sheet names detected');
        }
    }

    // Deteccao OHS — headers com markers ocupacionais
    if (type === 'unknown') {
        const allHeaders = parsed.sheets.flatMap((s) => s.headers.map((h) => h.toLowerCase().trim()));
        const ohsMatches = allHeaders.filter((h) => OHS_MARKERS.includes(h));
        if (ohsMatches.length >= 2) {
            type = detectOHSSubtype(allHeaders);
            evidence.push(`OHS markers: ${ohsMatches.join(', ')}`);
        }
    }

    // Calcula confianca
    if (type !== 'unknown') {
        confidence = 0.5;
        if (type.startsWith('ohs-')) {
            // OHS: confianca por sheets ocupacionais e markers
            if (classified.workers) confidence += 0.15;
            if (classified.exposures) confidence += 0.15;
            if (classified.medical || classified.risks || classified.incidents) confidence += 0.15;
            // Boost por quantidade de OHS markers encontrados
            const allHeaders = parsed.sheets.flatMap((s) => s.headers.map((h) => h.toLowerCase().trim()));
            const ohsCount = allHeaders.filter((h) => OHS_MARKERS.includes(h)).length;
            if (ohsCount >= 4) confidence += 0.1;
            else if (ohsCount >= 2) confidence += 0.05;
        } else {
            // Ambiental: confianca por sheets classicas
            if (hasLocations) confidence += 0.15;
            if (hasSamples) confidence += 0.15;
            if (hasResults) confidence += 0.15;
            if (version) confidence += 0.05;
        }
        confidence = Math.min(confidence, 1.0);
    }

    return { type, confidence, evidence, version, classified };
}

// Export for testing and use by other ingestion modules
export { OHS_MARKERS, SHEET_ALIASES };
