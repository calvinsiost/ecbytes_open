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
   FUNCOES DE EXPORTACAO
   ================================================================

   Este modulo gerencia a exportacao do modelo.

   FORMAS DE EXPORTACAO:
   1. Chave ECO - String compacta para compartilhar
   2. URL - Link com a chave para abrir no navegador
   3. Arquivo - Download de arquivo .ecokey

   FUNCIONALIDADES:
   - Construir modelo completo para exportacao
   - Copiar para area de transferencia
   - Gerar URL de compartilhamento
   - Download de arquivo

   ================================================================ */

import { CONFIG } from '../../config.js';
import { getSAOExportState } from '../sao/index.js';
import { encodeKey, encodeKeyV3 } from './encoder.js';
import { exportFamilies } from '../elements/families.js';
import { exportElements } from '../elements/manager.js';
import { exportEdges } from '../../utils/edges/manager.js';
import { exportCampaigns } from '../campaigns/manager.js';
import { exportScenes } from '../../utils/scenes/manager.js';
import { exportContracts } from '../../utils/governance/contractManager.js';
import { exportWbs } from '../../utils/governance/wbsManager.js';
import { exportProjects } from '../../utils/governance/projectManager.js';
import { exportCostCenters } from '../../utils/governance/costCenterManager.js';
import { exportMACState } from '../../utils/handlers/macCurve.js';
import { exportUserTools } from '../llm/chatTools.js';
import { exportEcoTools } from '../llm/toolBuilder.js';
import { exportTicker } from '../../utils/ticker/manager.js';
import { exportCalculator } from '../calculator/manager.js';
import { exportConstants, getUserConstants, getUserConstantById } from '../constants/manager.js';
import { exportLayers as exportInterpolation } from '../interpolation/manager.js';
import { exportPermissions } from '../../utils/auth/permissions.js';
import { exportGroups } from '../../utils/groups/manager.js';
import { exportReport } from '../../utils/report/manager.js';
import { exportPresets as exportFilterPresets } from '../../utils/report/filterPresets.js';
import { exportLibraries } from '../../utils/libraries/manager.js';
import { exportClassifier } from '../recognition/userClassifier.js';
import { exportAllNetworks } from '../nn/manager.js';
import { getCameraState } from '../../utils/scene/controls.js';
import { getModelIdSync, getModelLinks, exportCorporateIO } from './modelLink.js';
import { exportLabels } from '../../utils/labels/manager.js';
import { resolveAllBindings } from '../bindings/resolver.js';
import { getAllElements } from '../elements/manager.js';
import { getAllCampaigns } from '../campaigns/manager.js';

// ----------------------------------------------------------------
// ESTADO DO MODULO BLOCKCHAIN
// ----------------------------------------------------------------

/**
 * Estado atual das opcoes de blockchain.
 */
let blockchainOptions = {
    enabled: CONFIG.BLOCKCHAIN?.ENABLED_BY_DEFAULT || false,
    keyId: null,
    previousKey: null,
    previousVersion: 0,
};

/**
 * Configura opcoes de blockchain para exportacao.
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Habilitar blockchain
 * @param {string} options.keyId - ID da chave para assinar
 * @param {string} options.previousKey - Chave anterior (cadeia)
 * @param {number} options.previousVersion - Versao anterior
 */
export function setBlockchainOptions(options) {
    blockchainOptions = { ...blockchainOptions, ...options };
}

/**
 * Obtem opcoes atuais de blockchain.
 */
export function getBlockchainOptions() {
    return { ...blockchainOptions };
}

/**
 * Verifica se blockchain esta habilitado.
 */
export function isBlockchainEnabled() {
    return blockchainOptions.enabled;
}

// ----------------------------------------------------------------
// CONSTRUCAO DO MODELO
// ----------------------------------------------------------------

/**
 * Constroi objeto modelo completo para exportacao.
 * Coleta dados de todos os modulos e monta estrutura final.
 *
 * @returns {Object} - Modelo completo
 *
 * ESTRUTURA DO MODELO:
 * {
 *   ecbyts: versao,
 *   timestamp: data/hora,
 *   project: { name, description, author },
 *   coordinate: { system, zone, hemisphere },
 *   families: {...},
 *   elements: [...],
 *   view: { camera, target },
 *   campaigns: [...],
 *   scenes: [...]
 * }
 */
export function buildModel() {
    // Resolve todos os bindings antes de exportar (garante valores atualizados)
    resolveAllBindings(getAllElements(), getAllCampaigns(), {
        constants: getUserConstants(),
        getConstantById: (id) => getUserConstantById(id),
    });

    return {
        // Metadados
        ecbyts: CONFIG.VERSION,
        schemaVersion: 2,
        timestamp: new Date().toISOString(),

        // Identidade do modelo
        modelId: getModelIdSync(),
        modelLinks: getModelLinks(),
        corporateIO: exportCorporateIO(),

        // Informacoes do projeto (do formulario)
        project: {
            name: getInputValue('project-name', 'New Project'),
            description: getInputValue('project-description', ''),
            author: getInputValue('project-author', ''),
            responsibleTechnical: getInputValue('project-responsible-tech', ''),
            responsibleLegal: getInputValue('project-responsible-legal', ''),
            areas: getProjectAreas(),
            areasTree: getAreasTree(),
        },

        // Sistema de coordenadas (inclui origem UTM para georeferenciamento)
        coordinate: {
            system: getInputValue('coord-system', 'UTM'),
            zone: parseInt(getInputValue('utm-zone', '23')) || 23,
            hemisphere: getInputValue('utm-hemisphere', 'S'),
            origin: {
                easting: parseFloat(getInputValue('utm-origin-easting', '0')) || 0,
                northing: parseFloat(getInputValue('utm-origin-northing', '0')) || 0,
                elevation: parseFloat(getInputValue('utm-origin-elevation', '0')) || 0,
            },
        },

        // Familias de elementos
        families: exportFamilies(),

        // Elementos do modelo
        elements: exportElements(),

        // Relacoes do grafo
        edges: exportEdges(),

        // Estado da visualizacao
        view: getCameraState(),

        // Campanhas e cenas
        campaigns: exportCampaigns(),
        scenes: exportScenes(),

        // Governanca
        contracts: exportContracts(),
        wbs: exportWbs(),
        projectRegistry: exportProjects(),
        costCenters: exportCostCenters(),
        macState: exportMACState(),

        // Protocolo SAO (cenario, tier, matrizes ativas)
        sao: getSAOExportState(),

        // Ferramentas customizadas do usuario
        userTools: exportUserTools(),

        // Ferramentas customizadas (EcoTools) criadas por IA
        ecoTools: exportEcoTools(),

        // Ticker bar (barra de metricas configuravel)
        ticker: exportTicker(),

        // Controle de acesso (permissoes, roles, observer mode)
        access: exportPermissions(),

        // Grupos customizaveis de elementos e familias
        groups: exportGroups(),

        // Relatorio ambiental (tab Report no HUD)
        report: exportReport(),

        // Filter presets (subconjuntos reutilizaveis para relatorios)
        filterPresets: exportFilterPresets(),

        // Bibliotecas instaladas (manifests + estado)
        libraries: exportLibraries(),

        // Classificador de rede neural do usuario (pesos + strokes — formato legado)
        classifier: exportClassifier(),

        // Redes neurais registradas (formato generico v2.0)
        nn: exportAllNetworks(),

        // Calculator (metricas compostas, regras, ratios)
        calculator: exportCalculator(),

        // Constantes do usuario (fatores de emissao, incertezas, conversoes, etc.)
        userConstants: exportConstants(),

        // Interpolation (camadas interpoladas: terreno, nível d'água, contaminação)
        interpolation: exportInterpolation(),

        // Validacao profissional (selo de profissional verificado nos elementos)
        professionalValidation: getProfessionalValidation(),

        // Storyboard / Sequencer (keyframes, speed, loop)
        storyboard: getStoryboardState(),

        // Configuracao de labels 3D (nomes, observacoes, geologia, titulo)
        labels: exportLabels(),
    };
}

/**
 * Get professional validation data (lazy — avoids circular import).
 * Busca dados de validacao profissional sem import estatico.
 *
 * @returns {Object|null}
 */
function getProfessionalValidation() {
    try {
        const mod = window.__ecbyts_validation;
        return mod ? mod.exportProfessionalValidation() : null;
    } catch {
        return null;
    }
}

/**
 * Get storyboard/sequencer state (lazy import).
 * Busca estado do sequencer sem import estatico.
 *
 * @returns {Object|null}
 */
function getStoryboardState() {
    try {
        // Lazy — avoids circular dependency with sequencer
        const mod = window.__ecbyts_sequencer;
        return mod ? mod.getSerializableState() : null;
    } catch {
        return null;
    }
}

/**
 * Helper para obter valor de input do formulario.
 *
 * @param {string} id - ID do elemento input
 * @param {string} defaultValue - Valor padrao se vazio
 * @returns {string} - Valor do input ou padrao
 */
function getInputValue(id, defaultValue) {
    const element = document.getElementById(id);
    return element?.value || defaultValue;
}

/**
 * Coleta lista de areas/subareas do formulario.
 *
 * @returns {Array<{area: string, subarea: string}>}
 */
function getProjectAreas() {
    const rows = Array.from(document.querySelectorAll('[data-project-area-row]'));
    return rows
        .map((row) => {
            const areaInput = row.querySelector('[data-project-area]');
            const subareaInput = row.querySelector('[data-project-subarea]');
            const area = areaInput?.value?.trim() || '';
            const subarea = subareaInput?.value?.trim() || '';
            return { area, subarea };
        })
        .filter((entry) => entry.area || entry.subarea);
}

/**
 * Coleta a arvore de areas do ribbon.
 *
 * @returns {Array}
 */
function getAreasTree() {
    return Array.isArray(window.areasTreeData) ? window.areasTreeData : [];
}

/**
 * Sanitiza a arvore de areas para exportacao.
 * Protege dados pessoais (CPF) com mascaramento e criptografia AES-GCM.
 * Campos nao-pessoais (CNPJ, EIN, etc.) passam em plaintext.
 * Deve ser chamada nos pontos de export (generateKey, etc.).
 *
 * @param {Array} tree - Arvore de areas original
 * @returns {Promise<Array>} - Clone sanitizado
 */
async function sanitizeAreasTreeForExport(tree) {
    if (!Array.isArray(tree) || tree.length === 0) return tree;

    const PERSONAL_TYPES = ['cpf'];
    let encryptField;
    try {
        const vault = await import('../crypto/aesVault.js');
        if (vault.isVaultReady()) encryptField = vault.encryptField;
    } catch {
        /* vault indisponivel */
    }

    const clone = structuredClone(tree);

    async function sanitizeNode(node) {
        if (PERSONAL_TYPES.includes(node.registryType) && node.registryNumber?.trim()) {
            const full = node.registryNumber;
            const digits = full.replace(/\D/g, '');
            node.registryNumber = digits.length >= 2 ? `***.***. ***-${digits.slice(-2)}` : '***';
            if (encryptField) {
                node.registryNumberEncrypted = await encryptField(full);
            }
        }
        if (Array.isArray(node.children)) {
            for (const child of node.children) await sanitizeNode(child);
        }
    }

    for (const node of clone) await sanitizeNode(node);
    return clone;
}

// ----------------------------------------------------------------
// EXPORTACAO COMO CHAVE
// ----------------------------------------------------------------

/**
 * Gera chave codificada do modelo atual.
 * Usa ECO1 simples ou ECO1 blockchain conforme configuracao.
 * F10 — Hard enforcement: checkAndConsume antes de gerar chave.
 *
 * @returns {Promise<string>} - Chave ECO
 * @throws {Error} Se quota excedida
 */
export async function generateKey() {
    // F10 — Gate atomico de quota para eco1_exports
    try {
        const { checkAndConsume } = await import('../metering/quota.js');
        const quota = await checkAndConsume('eco1_exports', 1);
        if (!quota.allowed) {
            const { showToast } = await import('../../utils/ui/toast.js');
            showToast('Limite de exportações ECO1 atingido este mês.', 'error');
            throw new Error('quota_exceeded:eco1_exports');
        }
    } catch (e) {
        if (e.message === 'quota_exceeded:eco1_exports') throw e;
        // Graceful degradation: se metering indisponivel, prosseguir
    }

    const model = buildModel();

    // LGPD: sanitiza dados pessoais na arvore antes de exportar
    if (model.project?.areasTree) {
        model.project.areasTree = await sanitizeAreasTreeForExport(model.project.areasTree);
    }

    if (blockchainOptions.enabled && blockchainOptions.keyId) {
        // ECO1 blockchain
        return encodeKeyV3(model, {
            keyId: blockchainOptions.keyId,
            previousKey: blockchainOptions.previousKey,
            previousVersion: blockchainOptions.previousVersion,
        });
    }

    // ECO1 simples
    return encodeKey(model);
}

/**
 * Gera chave ECO1 simples (sempre simples, sem blockchain).
 *
 * @returns {string} - Chave ECO1
 */
export async function generateKeySimple() {
    const model = buildModel();
    if (model.project?.areasTree) {
        model.project.areasTree = await sanitizeAreasTreeForExport(model.project.areasTree);
    }
    return encodeKey(model);
}

/**
 * Gera chave ECO1 blockchain (com blockchain).
 *
 * @param {string} keyId - ID da chave para assinar
 * @param {string} previousKey - Chave anterior (opcional)
 * @param {number} previousVersion - Versao anterior (opcional)
 * @returns {Promise<string>} - Chave ECO1 blockchain
 */
export async function generateKeyWithBlockchain(keyId, previousKey = null, previousVersion = 0) {
    const model = buildModel();
    if (model.project?.areasTree) {
        model.project.areasTree = await sanitizeAreasTreeForExport(model.project.areasTree);
    }
    return encodeKeyV3(model, { keyId, previousKey, previousVersion });
}

/**
 * Copia chave para area de transferencia.
 *
 * @returns {Promise<boolean>} - true se copiou com sucesso
 *
 * USA CLIPBOARD API:
 * - navigator.clipboard.writeText()
 * - Requer pagina em HTTPS ou localhost
 */
export async function copyKeyToClipboard() {
    try {
        const key = await generateKey();
        await navigator.clipboard.writeText(key);
        return true;
    } catch (error) {
        console.error('Erro ao copiar para clipboard:', error);
        return false;
    }
}

// ----------------------------------------------------------------
// EXPORTACAO COMO URL
// ----------------------------------------------------------------

/**
 * Gera URL de compartilhamento com a chave.
 *
 * @returns {Promise<string>} - URL completa
 *
 * FORMATO:
 * https://exemplo.com/app/?key=ECO1-PWM-...
 *
 * A URL pode ser compartilhada e ao abrir, o modelo sera carregado.
 */
export async function generateShareURL() {
    const key = await generateKey();
    const baseURL = `${window.location.origin}${window.location.pathname}`;
    return `${baseURL}?key=${key}`;
}

/**
 * Copia URL de compartilhamento para clipboard.
 *
 * @returns {Promise<boolean>} - true se copiou com sucesso
 */
export async function copyShareURL() {
    try {
        const url = await generateShareURL();
        await navigator.clipboard.writeText(url);
        return true;
    } catch (error) {
        console.error('Erro ao copiar URL:', error);
        return false;
    }
}

// ----------------------------------------------------------------
// AUTO-BACKUP
// ----------------------------------------------------------------

/**
 * Cria backup automatico do modelo atual antes de operacoes destrutivas.
 * Gera chave ECO1 simples e dispara download.
 * Usado por safeNewProject() e pelo wizard de ingestao (D11).
 *
 * @param {string} reason - Motivo do backup (ex: 'new-project', 'pre-ingestion')
 * @returns {Promise<{success: boolean, key?: string, filename?: string, error?: string}>}
 */
export async function createAutoBackup(reason = 'backup') {
    try {
        const key = await generateKeySimple();
        const date = new Date().toISOString().slice(0, 10);
        const safeName = `ecbyts-${reason}-${date}`;
        const filename = `${safeName}.ecokey`;

        const blob = new Blob([key], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);

        return { success: true, key, filename };
    } catch (error) {
        console.error('[ecbyts] Auto-backup failed:', error);
        // Fallback: tentar copiar para clipboard
        try {
            const key = await generateKeySimple();
            await navigator.clipboard.writeText(key);
            return { success: true, key, filename: '(clipboard)' };
        } catch {
            return { success: false, error: error.message };
        }
    }
}

// ----------------------------------------------------------------
// EXPORTACAO COMO ARQUIVO
// ----------------------------------------------------------------

/**
 * Faz download da chave como arquivo.
 *
 * @param {string} filename - Nome do arquivo (sem extensao)
 *
 * PROCESSO:
 * 1. Gera a chave
 * 2. Cria Blob com o conteudo
 * 3. Cria URL temporaria
 * 4. Dispara download
 * 5. Limpa URL temporaria
 */
export async function downloadKeyFile(filename = 'model') {
    const key = await generateKey();

    // Limpa nome do arquivo
    const safeName = filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');

    // Cria Blob (objeto binario)
    const blob = new Blob([key], { type: 'text/plain' });

    // Cria URL temporaria para o Blob
    const url = URL.createObjectURL(blob);

    // Cria elemento <a> para download
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName}.ecokey`;

    // Dispara o download
    link.click();

    // Limpa URL temporaria (libera memoria)
    URL.revokeObjectURL(url);
}

/**
 * Exporta modelo como JSON (formato legivel).
 * Util para debug ou integracao com outros sistemas.
 *
 * @param {string} filename - Nome do arquivo
 */
export function downloadJSONFile(filename = 'model') {
    const model = buildModel();

    // Injetar referencia ao JSON Schema para autocomplete em IDEs (VS Code, etc.)
    model.$schema = 'https://raw.githubusercontent.com/calvinsiost/ecbyts/main/docs/ecbyts-model.schema.json';

    const json = JSON.stringify(model, null, 2); // Formatado

    const safeName = filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName}.json`;
    link.click();

    URL.revokeObjectURL(url);
}
