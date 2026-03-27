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
   MODEL IDENTITY, LINKS & CORPORATE I/O
   ================================================================

   Gerencia identidade unica do modelo, conexoes com outros modelos,
   e registro corporativo de compras (inputs) e vendas (outputs).

   MODEL ID:
   - SHA-256 hash (16 hex chars) gerado na criacao do projeto
   - Persiste entre exportacoes/importacoes
   - Identifica unicamente este modelo

   MODEL LINKS:
   - inputs[]: modelos dos quais este depende (upstream)
   - outputs[]: modelos que dependem deste (downstream)

   CORPORATE I/O:
   - corporateInputs[]: insumos e servicos comprados (perfuracao, lab, EPIs, etc.)
   - corporateOutputs[]: produtos e servicos vendidos (relatorios, consultoria, etc.)
   - Cada transacao pode ser vinculada a elementos 3D, campanhas e contratos

   ================================================================ */

// ----------------------------------------------------------------
// MODULE STATE
// ----------------------------------------------------------------

/** ID unico do modelo (16 hex chars) */
let modelId = null;

/** Links com outros modelos */
let modelLinks = {
    inputs: [], // [{ modelId, name, role }]
    outputs: [], // [{ modelId, name, role }]
};

/** Registro corporativo de compras e vendas */
let corporateInputs = []; // compras / insumos adquiridos
let corporateOutputs = []; // vendas / servicos entregues

/** Categorias pre-definidas para inputs (compras) */
export const INPUT_CATEGORIES = [
    { id: 'raw_material', icon: 'package' },
    { id: 'lab_services', icon: 'flask' },
    { id: 'drilling', icon: 'drill' },
    { id: 'equipment', icon: 'settings' },
    { id: 'ppe', icon: 'shield' },
    { id: 'fuel', icon: 'fuel' },
    { id: 'logistics', icon: 'truck' },
    { id: 'consulting_in', icon: 'users' },
    { id: 'rental', icon: 'key' },
    { id: 'reagents', icon: 'droplet' },
    { id: 'other_input', icon: 'more-horizontal' },
];

/** Categorias pre-definidas para outputs (vendas) */
export const OUTPUT_CATEGORIES = [
    { id: 'report', icon: 'file-text' },
    { id: 'monitoring', icon: 'activity' },
    { id: 'consulting_out', icon: 'briefcase' },
    { id: 'certificate', icon: 'award' },
    { id: 'remediation', icon: 'tool' },
    { id: 'training', icon: 'book-open' },
    { id: 'product', icon: 'box' },
    { id: 'other_output', icon: 'more-horizontal' },
];

/** Unidades comuns */
export const COMMON_UNITS = ['un', 'kg', 'm', 'L', 'hr', 'km', 'day', 'month', 'test', 'visit'];

// ----------------------------------------------------------------
// MODEL ID GENERATION
// ----------------------------------------------------------------

/**
 * Gera ID unico para o modelo usando SHA-256.
 * Combina timestamp + userAgent + UUID para entropia.
 *
 * @returns {Promise<string>} - 16 hex chars
 */
export async function generateModelId() {
    const raw = new Date().toISOString() + navigator.userAgent + crypto.randomUUID();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    modelId = hex.slice(0, 16);
    return modelId;
}

/**
 * Obtem o ID do modelo atual.
 * Se nao existir, gera um novo.
 *
 * @returns {Promise<string>}
 */
export async function getModelId() {
    if (!modelId) {
        await generateModelId();
    }
    return modelId;
}

/**
 * Define o ID do modelo (usado na importacao).
 *
 * @param {string} id - Model ID (16 hex chars)
 */
export function setModelId(id) {
    modelId = id || null;
}

/**
 * Retorna o model ID sincronamente (pode ser null).
 *
 * @returns {string|null}
 */
export function getModelIdSync() {
    return modelId;
}

// ----------------------------------------------------------------
// MODEL LINKS CRUD
// ----------------------------------------------------------------

/**
 * Obtem todos os links do modelo.
 *
 * @returns {{ inputs: Array, outputs: Array }}
 */
export function getModelLinks() {
    return {
        inputs: [...modelLinks.inputs],
        outputs: [...modelLinks.outputs],
    };
}

/**
 * Define todos os links (usado na importacao).
 *
 * @param {{ inputs?: Array, outputs?: Array }} links
 */
export function setModelLinks(links) {
    modelLinks = {
        inputs: Array.isArray(links?.inputs) ? links.inputs : [],
        outputs: Array.isArray(links?.outputs) ? links.outputs : [],
    };
}

/**
 * Adiciona um link de entrada (upstream model).
 *
 * @param {string} linkedModelId - ID do modelo upstream
 * @param {string} name - Nome descritivo
 * @param {string} role - Papel (ex: 'source', 'boundary')
 */
export function addInputLink(linkedModelId, name, role) {
    if (!linkedModelId) return;
    // Evita duplicatas
    if (modelLinks.inputs.some((l) => l.modelId === linkedModelId)) return;
    modelLinks.inputs.push({ modelId: linkedModelId, name: name || '', role: role || '' });
}

/**
 * Adiciona um link de saida (downstream model).
 *
 * @param {string} linkedModelId - ID do modelo downstream
 * @param {string} name - Nome descritivo
 * @param {string} role - Papel (ex: 'receptor', 'target')
 */
export function addOutputLink(linkedModelId, name, role) {
    if (!linkedModelId) return;
    if (modelLinks.outputs.some((l) => l.modelId === linkedModelId)) return;
    modelLinks.outputs.push({ modelId: linkedModelId, name: name || '', role: role || '' });
}

/**
 * Remove um link de entrada.
 *
 * @param {string} linkedModelId
 */
export function removeInputLink(linkedModelId) {
    modelLinks.inputs = modelLinks.inputs.filter((l) => l.modelId !== linkedModelId);
}

/**
 * Remove um link de saida.
 *
 * @param {string} linkedModelId
 */
export function removeOutputLink(linkedModelId) {
    modelLinks.outputs = modelLinks.outputs.filter((l) => l.modelId !== linkedModelId);
}

/**
 * Limpa todos os links e ID (para novo projeto).
 */
export function resetModelIdentity() {
    modelId = null;
    modelLinks = { inputs: [], outputs: [] };
    corporateInputs = [];
    corporateOutputs = [];
}

// ----------------------------------------------------------------
// CORPORATE I/O — Registro de compras e vendas
// ----------------------------------------------------------------

/**
 * Gera ID curto para transacao corporativa.
 * @returns {string} 8 hex chars
 */
function _genTxId() {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

/**
 * Retorna todas as compras (inputs corporativos).
 * @returns {Array}
 */
export function getCorporateInputs() {
    return [...corporateInputs];
}

/**
 * Retorna todas as vendas (outputs corporativos).
 * @returns {Array}
 */
export function getCorporateOutputs() {
    return [...corporateOutputs];
}

/**
 * Adiciona uma compra (input corporativo).
 * @param {Object} item - Dados da transacao
 * @returns {string} ID do item criado
 */
export function addCorporateInput(item) {
    const id = _genTxId();
    const total = (item.quantity || 0) * (item.unitCost || 0);
    corporateInputs.push({
        id,
        category: item.category || 'other_input',
        description: item.description || '',
        quantity: item.quantity || 0,
        unit: item.unit || 'un',
        unitCost: item.unitCost || 0,
        totalCost: Math.round(total * 100) / 100,
        currency: item.currency || 'BRL',
        date: item.date || '',
        supplier: item.supplier || '',
        invoiceRef: item.invoiceRef || '',
        status: item.status || 'completed',
        notes: item.notes || '',
        linkedElementIds: Array.isArray(item.linkedElementIds) ? item.linkedElementIds : [],
        linkedCampaignId: item.linkedCampaignId || null,
        linkedContractId: item.linkedContractId || null,
    });
    return id;
}

/**
 * Atualiza uma compra existente.
 * @param {string} id
 * @param {Object} updates
 */
export function updateCorporateInput(id, updates) {
    const idx = corporateInputs.findIndex((i) => i.id === id);
    if (idx === -1) return;
    Object.assign(corporateInputs[idx], updates);
    if (updates.quantity !== undefined || updates.unitCost !== undefined) {
        const it = corporateInputs[idx];
        it.totalCost = Math.round((it.quantity || 0) * (it.unitCost || 0) * 100) / 100;
    }
}

/**
 * Remove uma compra.
 * @param {string} id
 */
export function removeCorporateInput(id) {
    corporateInputs = corporateInputs.filter((i) => i.id !== id);
}

/**
 * Adiciona uma venda (output corporativo).
 * @param {Object} item - Dados da transacao
 * @returns {string} ID do item criado
 */
export function addCorporateOutput(item) {
    const id = _genTxId();
    const total = (item.quantity || 0) * (item.unitCost || 0);
    corporateOutputs.push({
        id,
        category: item.category || 'other_output',
        description: item.description || '',
        quantity: item.quantity || 0,
        unit: item.unit || 'un',
        unitCost: item.unitCost || 0,
        totalCost: Math.round(total * 100) / 100,
        currency: item.currency || 'BRL',
        date: item.date || '',
        supplier: item.supplier || '',
        invoiceRef: item.invoiceRef || '',
        status: item.status || 'completed',
        notes: item.notes || '',
        linkedElementIds: Array.isArray(item.linkedElementIds) ? item.linkedElementIds : [],
        linkedCampaignId: item.linkedCampaignId || null,
        linkedContractId: item.linkedContractId || null,
    });
    return id;
}

/**
 * Atualiza uma venda existente.
 * @param {string} id
 * @param {Object} updates
 */
export function updateCorporateOutput(id, updates) {
    const idx = corporateOutputs.findIndex((i) => i.id === id);
    if (idx === -1) return;
    Object.assign(corporateOutputs[idx], updates);
    if (updates.quantity !== undefined || updates.unitCost !== undefined) {
        const it = corporateOutputs[idx];
        it.totalCost = Math.round((it.quantity || 0) * (it.unitCost || 0) * 100) / 100;
    }
}

/**
 * Remove uma venda.
 * @param {string} id
 */
export function removeCorporateOutput(id) {
    corporateOutputs = corporateOutputs.filter((i) => i.id !== id);
}

/**
 * Retorna totais para Relacao com Investidores.
 * @returns {{ totalInputs: number, totalOutputs: number, margin: number, marginPct: number, inputCount: number, outputCount: number }}
 */
export function getCorporateTotals() {
    const totalInputs = corporateInputs.reduce((s, i) => s + (i.totalCost || 0), 0);
    const totalOutputs = corporateOutputs.reduce((s, i) => s + (i.totalCost || 0), 0);
    const margin = totalOutputs - totalInputs;
    const marginPct = totalInputs > 0 ? (margin / totalInputs) * 100 : 0;
    return {
        totalInputs: Math.round(totalInputs * 100) / 100,
        totalOutputs: Math.round(totalOutputs * 100) / 100,
        margin: Math.round(margin * 100) / 100,
        marginPct: Math.round(marginPct * 10) / 10,
        inputCount: corporateInputs.length,
        outputCount: corporateOutputs.length,
    };
}

/**
 * Retorna transacoes vinculadas a um elemento especifico.
 * @param {string} elementId
 * @returns {{ inputs: Array, outputs: Array }}
 */
export function getTransactionsByElement(elementId) {
    return {
        inputs: corporateInputs.filter((i) => i.linkedElementIds?.includes(elementId)),
        outputs: corporateOutputs.filter((i) => i.linkedElementIds?.includes(elementId)),
    };
}

/**
 * Exporta dados corporativos para serializacao (ECO1).
 * @returns {{ inputs: Array, outputs: Array }}
 */
export function exportCorporateIO() {
    return {
        inputs: [...corporateInputs],
        outputs: [...corporateOutputs],
    };
}

/**
 * Importa dados corporativos de payload (ECO1).
 * @param {{ inputs?: Array, outputs?: Array }} data
 */
export function importCorporateIO(data) {
    corporateInputs = Array.isArray(data?.inputs) ? data.inputs : [];
    corporateOutputs = Array.isArray(data?.outputs) ? data.outputs : [];
}
