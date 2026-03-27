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
   SMART IMPORT — AI-powered data normalization
   ================================================================

   Usa LLM para mapear colunas de arquivos desconhecidos para o
   schema ecbyts (elements, observations, campaigns).

   FLUXO:
   1. Usuario faz upload de CSV/JSON
   2. Sistema detecta colunas e mostra preview (5 linhas)
   3. LLM analisa colunas e sugere mapeamentos
   4. Usuario revisa/ajusta mapeamentos
   5. Sistema normaliza e importa

   ================================================================ */

import { sendMessage } from '../llm/client.js';
import { CONFIG } from '../../config.js';
import { getEnabledFamilies, getFamilyName } from '../elements/families.js';
import { getActiveParameters, isSAOActive } from '../sao/index.js';
import { parseCSVLine } from './formats/csv.js';

// ================================================================
// FILE ANALYSIS — Parse CSV/JSON and detect structure
// Analisa a estrutura do arquivo (colunas, separador, etc.)
// ================================================================

/**
 * Analyze file structure and extract column info.
 * Analisa o arquivo e extrai informacoes sobre colunas e dados.
 *
 * @param {string} content - File content as string
 * @param {string} filename - Original filename
 * @returns {Object} { columns, sampleRows, separator, rowCount, fileType }
 */
export function analyzeFileStructure(content, filename) {
    const ext = filename.split('.').pop().toLowerCase();

    if (ext === 'json') {
        return analyzeJSON(content);
    }
    // Default: CSV/TSV
    return analyzeCSV(content);
}

/**
 * Analyze CSV file structure.
 * Detecta separador, extrai colunas e primeiras 5 linhas.
 */
function analyzeCSV(content) {
    // Auto-detect separator
    const firstLine = content.split('\n')[0] || '';
    let separator = ',';
    if (firstLine.split('\t').length > firstLine.split(',').length) {
        separator = '\t';
    } else if (firstLine.split(';').length > firstLine.split(',').length) {
        separator = ';';
    }

    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length < 2) {
        throw new Error('File must have at least a header and one data row');
    }

    const columns = parseCSVLine(lines[0], separator);
    const sampleRows = [];

    for (let i = 1; i < Math.min(lines.length, 6); i++) {
        const values = parseCSVLine(lines[i], separator);
        const row = {};
        columns.forEach((col, idx) => {
            row[col] = values[idx] || '';
        });
        sampleRows.push(row);
    }

    return {
        columns,
        sampleRows,
        separator,
        rowCount: lines.length - 1,
        fileType: 'csv',
    };
}

/**
 * Analyze JSON file structure.
 * Detecta campos de objetos JSON (array de objetos).
 */
function analyzeJSON(content) {
    const data = JSON.parse(content);
    let rows;

    if (Array.isArray(data)) {
        rows = data;
    } else if (data.data && Array.isArray(data.data)) {
        rows = data.data;
    } else if (data.observations && Array.isArray(data.observations)) {
        rows = data.observations;
    } else if (data.elements && Array.isArray(data.elements)) {
        rows = data.elements;
    } else {
        throw new Error('JSON must contain an array of objects');
    }

    if (rows.length === 0) {
        throw new Error('JSON array is empty');
    }

    // Extract all unique keys
    const columnSet = new Set();
    rows.forEach((row) => {
        if (typeof row === 'object' && row !== null) {
            Object.keys(row).forEach((k) => columnSet.add(k));
        }
    });

    const columns = Array.from(columnSet);
    const sampleRows = rows.slice(0, 5).map((row) => {
        const obj = {};
        columns.forEach((col) => {
            obj[col] = row[col] !== undefined ? String(row[col]) : '';
        });
        return obj;
    });

    return {
        columns,
        sampleRows,
        separator: null,
        rowCount: rows.length,
        fileType: 'json',
    };
}

// ================================================================
// AI MAPPING — Use LLM to suggest column mappings
// Usa IA para sugerir mapeamentos de colunas
// ================================================================

/**
 * Build the LLM prompt for column mapping.
 * Constroi o prompt para o LLM mapear colunas ao schema ecbyts.
 *
 * @param {string[]} columns - Column names from file
 * @param {Object[]} sampleRows - First 5 data rows
 * @returns {string} System prompt
 */
function generateMappingPrompt(columns, sampleRows) {
    // Build parameter list
    // Use SAO-filtered parameters when active, otherwise first 30
    const paramSource = isSAOActive() ? getActiveParameters() : CONFIG.PARAMETERS;
    const params = paramSource
        .slice(0, 60)
        .map((p) => `${p.id} (${p.name})`)
        .join(', ');

    // Build unit list
    const units = CONFIG.UNITS.slice(0, 30)
        .map((u) => `${u.id} (${u.symbol})`)
        .join(', ');

    // Build family list
    const families = getEnabledFamilies()
        .map((f) => `${f} (${getFamilyName(f)})`)
        .join(', ');

    return `You are a data mapping expert for environmental monitoring systems.

ECBYTS SCHEMA:
- Elements: id, family (${families}), name, coordinates (easting, northing, elevation)
- Observations: elementId, parameterId, value, unitId, date, campaignId
  Parameters: ${params}
  Units: ${units}
- Campaigns: id, name, startDate, endDate

FILE COLUMNS: ${JSON.stringify(columns)}

SAMPLE DATA (first rows):
${JSON.stringify(sampleRows, null, 2)}

TASK: Analyze the columns and sample data. Map each column to the most appropriate ecbyts field.

Return ONLY valid JSON:
{
    "fileType": "observations" | "elements" | "campaigns",
    "columnMappings": {
        "source_column_name": {
            "target": "ecbyts_field_path",
            "confidence": 0.0-1.0,
            "notes": "explanation"
        }
    },
    "normalizations": [
        { "column": "name", "type": "unit_conversion|date_format|value_transform", "from": "ppb", "to": "ug_L" }
    ],
    "warnings": ["any issues or unmapped columns"],
    "overallConfidence": 0.0-1.0
}

Rules:
- Map column names by semantic meaning, not exact match
- Detect units embedded in column names (e.g. "Benzene (ppb)")
- Detect date formats and suggest normalization
- "elementId" / "well" / "point" / "station" columns map to element reference
- Coordinate columns (lat/lon/UTM) map to position fields
- Set confidence 0.0-1.0 based on mapping certainty
- List unmapped columns in warnings`;
}

/**
 * Request AI mapping for file columns.
 * Chama o LLM para sugerir mapeamentos de colunas.
 *
 * @param {string[]} columns - Column names
 * @param {Object[]} sampleRows - Sample data rows
 * @returns {Promise<Object>} Mapping result
 */
export async function requestAIMapping(columns, sampleRows) {
    const systemPrompt = generateMappingPrompt(columns, sampleRows);
    const userMessage = 'Analyze these columns and return the mapping JSON.';

    const response = await sendMessage(systemPrompt, userMessage, {
        maxTokens: 2000,
        temperature: 0.1,
    });

    // Parse JSON from response
    const content = response.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error('AI did not return valid JSON mapping');
    }

    return JSON.parse(jsonMatch[0]);
}

// ================================================================
// DATA TRANSFORMATION — Apply mapping to raw data
// Aplica o mapeamento aos dados brutos
// ================================================================

/**
 * Apply mapping to transform raw data into ecbyts format.
 * Transforma dados brutos usando o mapeamento da IA.
 *
 * @param {string} content - Raw file content
 * @param {Object} structure - Result from analyzeFileStructure
 * @param {Object} mapping - Result from requestAIMapping
 * @returns {Object} { elements: [], observations: [], campaigns: [], warnings: [] }
 */
export function applyMapping(content, structure, mapping) {
    const result = {
        elements: [],
        observations: [],
        campaigns: [],
        warnings: [...(mapping.warnings || [])],
    };

    // Parse all rows
    let allRows;
    if (structure.fileType === 'json') {
        const data = JSON.parse(content);
        allRows = Array.isArray(data) ? data : data.data || data.observations || data.elements || [];
    } else {
        const lines = content.split('\n').filter((l) => l.trim());
        const headers = parseCSVLine(lines[0], structure.separator);
        allRows = [];
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i], structure.separator);
            const row = {};
            headers.forEach((h, idx) => {
                row[h] = values[idx] || '';
            });
            allRows.push(row);
        }
    }

    // Transform each row using mapping
    for (const row of allRows) {
        try {
            const transformed = transformRow(row, mapping);
            if (mapping.fileType === 'observations') {
                result.observations.push(transformed);
            } else if (mapping.fileType === 'elements') {
                result.elements.push(transformed);
            } else if (mapping.fileType === 'campaigns') {
                result.campaigns.push(transformed);
            }
        } catch (e) {
            result.warnings.push(`Row skipped: ${e.message}`);
        }
    }

    return result;
}

/**
 * Transform a single row using the column mapping.
 * Transforma uma linha usando o mapeamento de colunas.
 */
function transformRow(row, mapping) {
    const result = {};

    for (const [sourceCol, mapInfo] of Object.entries(mapping.columnMappings)) {
        const value = row[sourceCol];
        if (value === undefined || value === '') continue;

        const target = typeof mapInfo === 'string' ? mapInfo : mapInfo.target;
        if (!target || target === 'ignore' || target === 'unmapped') continue;

        // Handle compound targets like "parameterId=benzene"
        if (target.includes('=')) {
            const [field, fixedValue] = target.split('=');
            result[field] = fixedValue;
            // Also set the value if it's a parameter mapping
            if (field === 'parameterId') {
                result.value = parseFloat(value) || value;
            }
        } else {
            // Apply normalizations
            const normalization = (mapping.normalizations || []).find((n) => n.column === sourceCol);
            result[target] = normalizeValue(value, target, normalization);
        }
    }

    return result;
}

/**
 * Normalize a single value based on target field type.
 * Normaliza um valor com base no tipo do campo de destino.
 */
function normalizeValue(value, targetField, normalization) {
    // Date fields
    if (targetField === 'date' || targetField === 'startDate' || targetField === 'endDate') {
        return parseDate(value);
    }

    // Numeric fields
    if (
        targetField === 'value' ||
        targetField === 'easting' ||
        targetField === 'northing' ||
        targetField === 'elevation' ||
        targetField === 'x' ||
        targetField === 'y' ||
        targetField === 'z'
    ) {
        const num = parseFloat(String(value).replace(',', '.'));
        return isNaN(num) ? 0 : num;
    }

    // String fields
    return String(value).trim();
}

/**
 * Parse various date formats to ISO.
 * Converte varios formatos de data para ISO.
 */
function parseDate(value) {
    if (!value) return new Date().toISOString().split('T')[0];

    // Already ISO format
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.split('T')[0];
    }

    // DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmyMatch) {
        return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
    }

    // MM/DD/YYYY
    const mdyMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (mdyMatch) {
        const m = parseInt(mdyMatch[1]);
        const d = parseInt(mdyMatch[2]);
        if (m > 12) {
            // DD/MM/YYYY
            return `${mdyMatch[3]}-${mdyMatch[2].padStart(2, '0')}-${mdyMatch[1].padStart(2, '0')}`;
        }
        return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}`;
    }

    // Try native parsing
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
    }

    return value;
}

// ================================================================
// VALIDATION — Check transformed data integrity
// ================================================================

/**
 * Validate mapped data before import.
 * Valida os dados mapeados antes de importar.
 *
 * @param {Object} data - Result from applyMapping
 * @returns {Object} { valid, errors, warnings }
 */
export function validateMappedData(data) {
    const errors = [];
    const warnings = [];

    if (data.observations.length > 0) {
        // Check observations have required fields
        data.observations.forEach((obs, i) => {
            if (!obs.value && obs.value !== 0) {
                warnings.push(`Row ${i + 1}: missing value`);
            }
        });
    }

    if (data.elements.length > 0) {
        data.elements.forEach((el, i) => {
            if (!el.family && !el.familyId) {
                warnings.push(`Element ${i + 1}: missing family`);
            }
        });
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings: [...warnings, ...data.warnings],
    };
}

// ================================================================
// ECBYTS TARGET FIELDS — For dropdown options in UI
// Campos alvo disponiveis para mapeamento manual
// ================================================================

export const TARGET_FIELDS = {
    observations: [
        { id: 'elementId', name: 'Element ID', required: false },
        { id: 'elementName', name: 'Element Name', required: false },
        { id: 'parameterId', name: 'Parameter', required: false },
        { id: 'value', name: 'Value', required: true },
        { id: 'unitId', name: 'Unit', required: false },
        { id: 'date', name: 'Date', required: false },
        { id: 'campaignId', name: 'Campaign ID', required: false },
        { id: 'x', name: 'Position X', required: false },
        { id: 'y', name: 'Position Y', required: false },
        { id: 'z', name: 'Position Z', required: false },
        { id: 'easting', name: 'UTM Easting', required: false },
        { id: 'northing', name: 'UTM Northing', required: false },
        { id: 'elevation', name: 'Elevation', required: false },
        { id: 'ignore', name: '— Ignore —', required: false },
    ],
    elements: [
        { id: 'family', name: 'Family', required: true },
        { id: 'id', name: 'ID', required: false },
        { id: 'name', name: 'Name', required: false },
        { id: 'easting', name: 'UTM Easting', required: false },
        { id: 'northing', name: 'UTM Northing', required: false },
        { id: 'elevation', name: 'Elevation', required: false },
        { id: 'x', name: 'Position X', required: false },
        { id: 'y', name: 'Position Y', required: false },
        { id: 'z', name: 'Position Z', required: false },
        { id: 'ignore', name: '— Ignore —', required: false },
    ],
    campaigns: [
        { id: 'id', name: 'ID', required: false },
        { id: 'name', name: 'Name', required: false },
        { id: 'startDate', name: 'Start Date', required: false },
        { id: 'endDate', name: 'End Date', required: false },
        { id: 'ignore', name: '— Ignore —', required: false },
    ],
};
