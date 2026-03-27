// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Module: toolBuilder — EcoTools (ferramentas customizadas criadas por IA)
// Status: STUB — implementação completa pendente (CREATE_ECO_TOOL action)

/* ================================================================
   TOOL BUILDER — EcoTools criadas por LLM via CREATE_ECO_TOOL
   ================================================================

   EcoTools são widgets HTML gerados pelo assistente IA (ex: calculadoras,
   formulários customizados) e persistidos no modelo ECO1 via export/import.

   Fluxo:
     LLM → CREATE_ECO_TOOL { name, htmlContent } → createEcoTool()
     → armazenado em _ecoTools[]
     → exportEcoTools() salva no modelo
     → importEcoTools() restaura do modelo

   ================================================================ */

import { generateId } from '../../utils/helpers/id.js';

/** @type {Array<{id: string, name: string, description: string, htmlContent: string, createdAt: string}>} */
let _ecoTools = [];

/**
 * Cria uma nova EcoTool a partir de conteúdo HTML gerado pelo LLM.
 * @param {string} name - Nome da ferramenta
 * @param {string} description - Descrição breve
 * @param {string} htmlContent - HTML completo da ferramenta (calculadora, formulário, etc.)
 * @returns {{ id: string, name: string, description: string, htmlContent: string, createdAt: string }}
 */
export function createEcoTool(name, description = '', htmlContent = '') {
    const tool = {
        id: generateId('ecotool'),
        name: String(name || 'EcoTool').substring(0, 80),
        description: String(description), // sem limite — usado como prompt completo
        htmlContent: String(htmlContent),
        createdAt: new Date().toISOString(),
        records: [],
    };
    _ecoTools.push(tool);
    return tool;
}

/**
 * Exporta todas as EcoTools para serialização no modelo ECO1.
 * @returns {Array} Lista de EcoTools
 */
export function exportEcoTools() {
    return _ecoTools.map((t) => ({ ...t }));
}

/**
 * Importa EcoTools a partir do modelo ECO1.
 * @param {Array} tools - Lista de EcoTools restauradas do modelo
 */
export function importEcoTools(tools) {
    if (!Array.isArray(tools)) return;
    _ecoTools = tools.map((t) => ({
        id: t.id || generateId('ecotool'),
        name: String(t.name || '').substring(0, 80),
        description: String(t.description || ''),
        htmlContent: String(t.htmlContent || ''),
        createdAt: t.createdAt || new Date().toISOString(),
        records: Array.isArray(t.records) ? t.records : [],
    }));
}

/**
 * Retorna todas as EcoTools carregadas.
 * @returns {Array}
 */
export function getEcoTools() {
    return _ecoTools;
}

/**
 * Remove uma EcoTool pelo id.
 * @param {string} id
 * @returns {boolean} true se removida
 */
export function removeEcoTool(id) {
    const before = _ecoTools.length;
    _ecoTools = _ecoTools.filter((t) => t.id !== id);
    return _ecoTools.length < before;
}

/**
 * Salva um registro de output de uma EcoTool no modelo.
 * Spread de data ANTES de id/timestamp — impede iframe sobrescrever metadados.
 * @param {string} toolId
 * @param {Object} data - campos do formulário ou resultado do cálculo
 * @returns {{ id: string, timestamp: string } | null}
 */
export function saveEcoToolRecord(toolId, data) {
    if (!toolId || typeof data !== 'object' || data === null) return null;
    const tool = _ecoTools.find((t) => t.id === toolId);
    if (!tool) return null;
    const record = {
        ...data,
        id: generateId('ecorec'),
        timestamp: new Date().toISOString(),
    };
    tool.records.push(record);
    if (tool.records.length > 500) tool.records = tool.records.slice(-500);
    return record;
}

/**
 * Retorna cópia dos registros salvos de uma EcoTool.
 * @param {string} toolId
 * @returns {Array}
 */
export function getEcoToolRecords(toolId) {
    const tool = _ecoTools.find((t) => t.id === toolId);
    return tool ? [...tool.records] : [];
}

/**
 * Atualiza campos editáveis de uma EcoTool preservando id, records e createdAt.
 * @param {string} toolId
 * @param {{ name?: string, description?: string, htmlContent?: string }} updates
 * @returns {boolean} true se atualizado
 */
export function updateEcoTool(toolId, updates) {
    const tool = _ecoTools.find((t) => t.id === toolId);
    if (!tool) return false;
    if (updates.name !== undefined) tool.name = String(updates.name).substring(0, 80);
    if (updates.description !== undefined) tool.description = String(updates.description);
    if (updates.htmlContent !== undefined) tool.htmlContent = String(updates.htmlContent);
    return true;
}
