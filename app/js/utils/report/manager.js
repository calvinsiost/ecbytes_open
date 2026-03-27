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
   REPORT MANAGER — Multi-report system with folder hierarchy
   Gerenciador de multiplos relatorios com organizacao por pastas

   Suporta multiplos relatorios organizados em pastas (ate 4 niveis).
   Cada relatorio: { id, folderId, title, content, lastModified }
   Cada pasta:     { id, name, parentId }

   Pasta default "Geral" criada automaticamente na inicializacao.
   Estado mantido em closure do modulo (padrao groups/manager).
   Persistencia via localStorage + export/import do modelo.
   ================================================================ */

// ----------------------------------------------------------------
// MODULE STATE
// Estado do modulo — closure privada
// ----------------------------------------------------------------

import { isEphemeral } from '../storage/storageMonitor.js';
import { idbSet, idbGetWithLegacy, idbDelete } from '../storage/idbStore.js';
import { showToast } from '../ui/toast.js';

const STORAGE_KEY = 'ecbyts-reports';
const MAX_REPORTS = 20;
const MAX_DEPTH = 4;

/** @type {Array<{id: string, name: string, parentId: string|null}>} */
let folders = [];

/** @type {Array<{id: string, folderId: string, title: string, content: string, lastModified: string|null}>} */
let reports = [];

/** @type {string|null} */
let activeReportId = null;

/** @type {number} Monotonic counter for unique IDs */
let counter = 0;

// ----------------------------------------------------------------
// ID GENERATION
// Gera IDs unicos monotonico-crescentes
// ----------------------------------------------------------------

/** @private */
function _nextId(prefix) {
    counter++;
    return `${prefix}-${counter}`;
}

// ----------------------------------------------------------------
// INITIALIZATION
// Carrega relatorios salvos no localStorage
// ----------------------------------------------------------------

/**
 * Initialize reports from localStorage.
 * Carrega estado salvo ou cria pasta default com relatorio vazio.
 */
export async function initReport() {
    try {
        const parsed = await idbGetWithLegacy(STORAGE_KEY);
        if (parsed) {
            folders = Array.isArray(parsed.folders) ? parsed.folders : [];
            reports = Array.isArray(parsed.reports) ? parsed.reports : [];
            activeReportId = parsed.activeReportId || null;
            counter = parsed.counter || 0;
        }
    } catch (e) {
        console.error('Failed to load reports from IDB:', e);
    }

    // Garante pelo menos uma pasta e um relatorio
    if (folders.length === 0) {
        const fId = _nextId('folder');
        folders.push({ id: fId, name: 'Geral', parentId: null });
        if (reports.length === 0) {
            const rId = _nextId('rpt');
            reports.push({ id: rId, folderId: fId, title: '', content: '', lastModified: null });
            activeReportId = rId;
        }
        _persist();
    }

    // Garante que activeReportId aponta para relatorio existente
    if (!activeReportId || !reports.find((r) => r.id === activeReportId)) {
        activeReportId = reports.length > 0 ? reports[0].id : null;
        _persist();
    }
}

// ----------------------------------------------------------------
// PERSISTENCE
// Salva estado no localStorage e dispara evento
// ----------------------------------------------------------------

/** @private */
async function _persist() {
    if (!isEphemeral()) {
        const ok = await idbSet(STORAGE_KEY, { folders, reports, activeReportId, counter });
        if (!ok) showToast('Storage full. Report data may not persist.', 'warning');
    }
    window.dispatchEvent(new CustomEvent('reportChanged'));
}

// ----------------------------------------------------------------
// ACTIVE REPORT — GETTERS / SETTERS
// Compatibilidade: operam no relatorio ativo
// ----------------------------------------------------------------

/**
 * Get active report state (backward-compat shape).
 * @returns {{ title: string, content: string, lastModified: string|null }}
 */
export function getReport() {
    const active = reports.find((r) => r.id === activeReportId);
    if (!active) return { title: '', content: '', lastModified: null };
    return { title: active.title, content: active.content, lastModified: active.lastModified };
}

/**
 * Set active report title.
 * @param {string} title
 */
export function setReportTitle(title) {
    const active = reports.find((r) => r.id === activeReportId);
    if (!active) return;
    active.title = title;
    active.lastModified = new Date().toISOString();
    _persist();
}

/**
 * Set active report HTML content.
 * @param {string} html - innerHTML from contenteditable
 */
export function setReportContent(html) {
    const active = reports.find((r) => r.id === activeReportId);
    if (!active) return;
    active.content = html;
    active.lastModified = new Date().toISOString();
    _persist();
}

// ----------------------------------------------------------------
// SCENE ANCHORS & METRIC ANCHORS
// Extrai ancoras do HTML do relatorio ativo
// ----------------------------------------------------------------

/**
 * Parse active report HTML and extract scene anchor references.
 * @returns {Array<{sceneId: string}>}
 */
export function getSceneAnchors() {
    const active = reports.find((r) => r.id === activeReportId);
    if (!active || !active.content) return [];
    const anchors = [];
    const regex = /data-scene-id="([^"]+)"/g;
    let match;
    while ((match = regex.exec(active.content)) !== null) {
        anchors.push({ sceneId: match[1] });
    }
    return anchors;
}

/**
 * Parse active report HTML and extract metric anchor references.
 * Inclui filterPresetId se presente no atributo data-filter-preset.
 *
 * @returns {Array<{metricType: string, filterPresetId?: string}>}
 */
export function getMetricAnchors() {
    const active = reports.find((r) => r.id === activeReportId);
    if (!active || !active.content) return [];
    const anchors = [];
    // Captura spans com data-metric-type e opcionalmente data-filter-preset
    const regex = /data-metric-type="([^"]+)"(?:\s+data-filter-preset="([^"]+)")?/g;
    let match;
    while ((match = regex.exec(active.content)) !== null) {
        const anchor = { metricType: match[1] };
        if (match[2]) anchor.filterPresetId = match[2];
        anchors.push(anchor);
    }
    return anchors;
}

// ----------------------------------------------------------------
// REPORT CRUD
// Criar, duplicar, remover, mover relatorios
// ----------------------------------------------------------------

/**
 * Get all reports.
 * @returns {Array}
 */
export function getAllReports() {
    return [...reports];
}

/**
 * Get report by ID.
 * @param {string} id
 * @returns {Object|undefined}
 */
export function getReportById(id) {
    return reports.find((r) => r.id === id);
}

/**
 * Get active report ID.
 * @returns {string|null}
 */
export function getActiveReportId() {
    return activeReportId;
}

/**
 * Add a new report inside a folder.
 * Retorna o relatorio criado ou null se limite atingido.
 *
 * @param {string} folderId - Target folder
 * @param {Object} [data] - Optional initial data { title, content }
 * @returns {Object|null}
 */
export function addReport(folderId, data) {
    if (reports.length >= MAX_REPORTS) return null;
    if (!folders.find((f) => f.id === folderId)) return null;

    const id = _nextId('rpt');
    const report = {
        id,
        folderId,
        title: data?.title || '',
        content: data?.content || '',
        lastModified: new Date().toISOString(),
    };
    reports.push(report);
    _persist();
    return report;
}

/**
 * Remove a report by ID.
 * Nao permite remover o ultimo relatorio.
 *
 * @param {string} id
 * @returns {boolean} true if removed
 */
export function removeReport(id) {
    if (reports.length <= 1) return false;
    const idx = reports.findIndex((r) => r.id === id);
    if (idx === -1) return false;

    reports.splice(idx, 1);

    // Se removeu o ativo, troca para o primeiro disponivel
    if (activeReportId === id) {
        activeReportId = reports[0]?.id || null;
    }
    _persist();
    return true;
}

/**
 * Duplicate a report (same folder).
 * @param {string} id
 * @returns {Object|null} New report or null if limit reached
 */
export function duplicateReport(id) {
    if (reports.length >= MAX_REPORTS) return null;
    const src = reports.find((r) => r.id === id);
    if (!src) return null;

    const newId = _nextId('rpt');
    const dup = {
        id: newId,
        folderId: src.folderId,
        title: src.title + ' (copia)',
        content: src.content,
        lastModified: new Date().toISOString(),
    };
    reports.push(dup);
    _persist();
    return dup;
}

/**
 * Set active report.
 * @param {string} id
 * @returns {boolean}
 */
export function setActiveReport(id) {
    if (!reports.find((r) => r.id === id)) return false;
    activeReportId = id;
    _persist();
    return true;
}

/**
 * Move a report to another folder.
 * @param {string} reportId
 * @param {string} targetFolderId
 * @returns {boolean}
 */
export function moveReport(reportId, targetFolderId) {
    const report = reports.find((r) => r.id === reportId);
    if (!report) return false;
    if (!folders.find((f) => f.id === targetFolderId)) return false;

    report.folderId = targetFolderId;
    report.lastModified = new Date().toISOString();
    _persist();
    return true;
}

// ----------------------------------------------------------------
// FOLDER CRUD
// Criar, renomear, remover, mover pastas
// ----------------------------------------------------------------

/**
 * Get all folders.
 * @returns {Array}
 */
export function getAllFolders() {
    return [...folders];
}

/**
 * Get folder by ID.
 * @param {string} id
 * @returns {Object|undefined}
 */
export function getFolderById(id) {
    return folders.find((f) => f.id === id);
}

/**
 * Get root folders (parentId === null).
 * @returns {Array}
 */
export function getRootFolders() {
    return folders.filter((f) => f.parentId === null);
}

/**
 * Get child folders of a parent.
 * @param {string} parentId
 * @returns {Array}
 */
export function getChildFolders(parentId) {
    return folders.filter((f) => f.parentId === parentId);
}

/**
 * Get reports inside a specific folder (non-recursive).
 * @param {string} folderId
 * @returns {Array}
 */
export function getReportsInFolder(folderId) {
    return reports.filter((r) => r.folderId === folderId);
}

/**
 * Calculate folder depth (0 = root).
 * @private
 * @param {string|null} parentId
 * @returns {number}
 */
function _getFolderDepth(parentId) {
    let depth = 0;
    let current = parentId;
    while (current !== null) {
        const parent = folders.find((f) => f.id === current);
        if (!parent) break;
        current = parent.parentId;
        depth++;
        if (depth > MAX_DEPTH + 1) break; // safety
    }
    return depth;
}

/**
 * Add a new folder.
 * Retorna a pasta criada ou null se profundidade excede MAX_DEPTH.
 *
 * @param {string} name
 * @param {string|null} [parentId=null]
 * @returns {Object|null}
 */
export function addFolder(name, parentId = null) {
    // Valida que parentId existe (se nao for null)
    if (parentId !== null && !folders.find((f) => f.id === parentId)) return null;

    // Verifica profundidade
    const depth = _getFolderDepth(parentId) + 1;
    if (depth > MAX_DEPTH) return null;

    const id = _nextId('folder');
    const folder = { id, name: name || 'Nova Pasta', parentId };
    folders.push(folder);
    _persist();
    return folder;
}

/**
 * Remove folder and all sub-folders + reports recursively.
 * @param {string} id
 * @returns {boolean}
 */
export function removeFolder(id) {
    const folder = folders.find((f) => f.id === id);
    if (!folder) return false;

    // Nao permite remover se e a unica pasta e tem relatorios
    if (folders.length <= 1) return false;

    // Coleta IDs de sub-pastas recursivamente
    const toRemove = new Set();
    const queue = [id];
    while (queue.length > 0) {
        const fId = queue.shift();
        toRemove.add(fId);
        folders.filter((f) => f.parentId === fId).forEach((f) => queue.push(f.id));
    }

    // Remove relatorios dessas pastas
    const removedReports = new Set();
    reports = reports.filter((r) => {
        if (toRemove.has(r.folderId)) {
            removedReports.add(r.id);
            return false;
        }
        return true;
    });

    // Remove pastas
    folders = folders.filter((f) => !toRemove.has(f.id));

    // Se ativo foi removido, troca
    if (removedReports.has(activeReportId)) {
        activeReportId = reports[0]?.id || null;
    }

    // Garante pelo menos uma pasta e relatorio
    if (folders.length === 0) {
        const fId = _nextId('folder');
        folders.push({ id: fId, name: 'Geral', parentId: null });
        if (reports.length === 0) {
            const rId = _nextId('rpt');
            reports.push({ id: rId, folderId: fId, title: '', content: '', lastModified: null });
            activeReportId = rId;
        }
    }
    if (reports.length === 0) {
        const rId = _nextId('rpt');
        reports.push({ id: rId, folderId: folders[0].id, title: '', content: '', lastModified: null });
        activeReportId = rId;
    }

    _persist();
    return true;
}

/**
 * Rename a folder.
 * @param {string} id
 * @param {string} name
 * @returns {boolean}
 */
export function renameFolder(id, name) {
    const folder = folders.find((f) => f.id === id);
    if (!folder) return false;
    folder.name = name;
    _persist();
    return true;
}

/**
 * Check if targetId is a descendant of folderId.
 * Previne loop ao mover pasta para dentro de si mesma.
 * @private
 */
function _isDescendant(folderId, targetId) {
    let current = targetId;
    while (current !== null) {
        if (current === folderId) return true;
        const f = folders.find((fo) => fo.id === current);
        if (!f) break;
        current = f.parentId;
    }
    return false;
}

/**
 * Move a folder to a new parent.
 * Bloqueia se target e descendente (loop detection).
 *
 * @param {string} folderId
 * @param {string|null} targetParentId - null = root
 * @returns {boolean}
 */
export function moveFolder(folderId, targetParentId) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return false;
    if (folderId === targetParentId) return false;

    // Valida target existe
    if (targetParentId !== null && !folders.find((f) => f.id === targetParentId)) return false;

    // Loop detection
    if (targetParentId !== null && _isDescendant(folderId, targetParentId)) return false;

    // Verifica profundidade resultante
    const newDepth = _getFolderDepth(targetParentId) + 1;
    if (newDepth > MAX_DEPTH) return false;

    folder.parentId = targetParentId;
    _persist();
    return true;
}

// ----------------------------------------------------------------
// EXPORT / IMPORT
// Serializa e restaura relatorios no modelo
// ----------------------------------------------------------------

/**
 * Export all reports/folders for model serialization.
 * Retorna null se nao ha relatorios com conteudo.
 *
 * @returns {Object|null}
 */
export function exportReport() {
    const hasContent = reports.some((r) => r.title || r.content);
    if (!hasContent) return null;
    return {
        folders: folders.map((f) => ({ ...f })),
        reports: reports.map((r) => ({ ...r })),
        activeReportId,
        counter,
    };
}

/**
 * Import reports from model data.
 * Aceita novo formato { folders, reports } ou formato legado { title, content }.
 *
 * @param {Object} data - Report data from model
 */
export function importReport(data) {
    if (!data) return;

    if (Array.isArray(data.folders) && Array.isArray(data.reports)) {
        // Novo formato multi-report
        folders = data.folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId ?? null }));
        reports = data.reports.map((r) => ({
            id: r.id,
            folderId: r.folderId,
            title: r.title || '',
            content: r.content || '',
            lastModified: r.lastModified || null,
        }));
        activeReportId = data.activeReportId || (reports[0]?.id ?? null);
        counter = data.counter || 0;
    } else if (data.title !== undefined || data.content !== undefined) {
        // Formato legado single-report — converte para novo formato
        folders = [];
        reports = [];
        counter = 0;
        const fId = _nextId('folder');
        folders.push({ id: fId, name: 'Geral', parentId: null });
        const rId = _nextId('rpt');
        reports.push({
            id: rId,
            folderId: fId,
            title: data.title || '',
            content: data.content || '',
            lastModified: data.lastModified || null,
        });
        activeReportId = rId;
    }

    // Garante estado minimo
    if (folders.length === 0) {
        const fId = _nextId('folder');
        folders.push({ id: fId, name: 'Geral', parentId: null });
    }
    if (reports.length === 0) {
        const rId = _nextId('rpt');
        reports.push({ id: rId, folderId: folders[0].id, title: '', content: '', lastModified: null });
        activeReportId = rId;
    }

    _persist();
}

/**
 * Clear all reports.
 * Limpa tudo e recria pasta default.
 */
export function clearReport() {
    folders = [];
    reports = [];
    activeReportId = null;
    counter = 0;
    try {
        idbDelete(STORAGE_KEY).catch(() => {});
        localStorage.removeItem('ecbyts-report'); // limpa chave legada
    } catch (e) {
        /* ignore */
    }

    // Recria estado minimo
    const fId = _nextId('folder');
    folders.push({ id: fId, name: 'Geral', parentId: null });
    const rId = _nextId('rpt');
    reports.push({ id: rId, folderId: fId, title: '', content: '', lastModified: null });
    activeReportId = rId;

    _persist();
}

// ----------------------------------------------------------------
// RANDOM REPORT GENERATION
// Gera relatorio simplificado para modelo aleatorio
// ----------------------------------------------------------------

/**
 * Generate a simplified environmental report for the random model.
 * Cria pasta "Geral" com 1 relatorio estruturado com ancoras de cena.
 *
 * @param {Array} scenes - Created scenes array [{id, name}]
 * @param {Array} elements - All elements in the model
 * @param {Array} campaigns - Created campaigns [{name, startDate}]
 */
export function generateRandomReport(scenes, elements, campaigns) {
    // Limpa estado e recria
    folders = [];
    reports = [];
    counter = 0;

    const fId = _nextId('folder');
    folders.push({ id: fId, name: 'Geral', parentId: null });

    const rId = _nextId('rpt');
    const projectName = document.getElementById('project-name')?.value || 'Projeto Demo';

    // Conta elementos por familia
    const counts = {};
    elements.forEach((el) => {
        const fam = el.familyId || 'unknown';
        counts[fam] = (counts[fam] || 0) + 1;
    });

    // Helper para criar ancoras de cena no HTML
    const anchor = (sceneId, sceneName) =>
        `<span class="report-scene-anchor" data-scene-id="${sceneId}" contenteditable="false">&#9654; [Scene: ${sceneName}]</span>`;

    // Monta lista de campanhas
    const campaignList =
        campaigns.length > 0
            ? campaigns.map((c) => `<li>${c.name} — ${c.startDate || ''}</li>`).join('\n')
            : '<li>Nenhuma campanha registrada</li>';

    // Descricao de elementos
    const elementSummary = Object.entries(counts)
        .map(([fam, n]) => `${n} ${fam}${n > 1 ? 's' : ''}`)
        .join(', ');

    // Monta ancoras conforme cenas disponiveis
    const sceneAnchorMap = {};
    scenes.forEach((s) => {
        sceneAnchorMap[s.name] = s.id;
    });

    const baseAnchor = sceneAnchorMap['Linha de Base'] ? anchor(sceneAnchorMap['Linha de Base'], 'Linha de Base') : '';
    const evolAnchor = sceneAnchorMap['Evolucao'] ? anchor(sceneAnchorMap['Evolucao'], 'Evolucao') : '';
    const atualAnchor = sceneAnchorMap['Estado Atual'] ? anchor(sceneAnchorMap['Estado Atual'], 'Estado Atual') : '';

    const plumeCount = counts['plume'] || 0;
    const wellCount = counts['well'] || 0;
    const lakeCount = counts['lake'] || 0;
    const riverCount = counts['river'] || 0;
    const buildingCount = counts['building'] || 0;
    const tankCount = counts['tank'] || 0;
    const boundaryCount = counts['boundary'] || 0;
    const totalElements = elements.length;

    const topAnchor = sceneAnchorMap['Vista Superior']
        ? anchor(sceneAnchorMap['Vista Superior'], 'Vista Superior')
        : sceneAnchorMap['Top']
          ? anchor(sceneAnchorMap['Top'], 'Top')
          : '';
    const frontAnchor = sceneAnchorMap['Vista Frontal']
        ? anchor(sceneAnchorMap['Vista Frontal'], 'Vista Frontal')
        : sceneAnchorMap['Front']
          ? anchor(sceneAnchorMap['Front'], 'Front')
          : '';

    const reportDate = new Date().toISOString().slice(0, 10);

    const html = `<h1>Relatorio de Investigacao Ambiental</h1>
<h3>${projectName}</h3>
<p><em>Data de emissao: ${reportDate}</em></p>

<hr>

<h2>1. Introducao</h2>
<p>Este relatorio apresenta os resultados da investigacao ambiental conduzida na area de estudo do projeto <strong>${projectName}</strong>. O objetivo principal e caracterizar as condicoes ambientais do local, identificar possiveis fontes de contaminacao e avaliar os riscos associados a saude humana e ao meio ambiente.</p>
<p>O modelo digital ambiental contempla <strong>${totalElements}</strong> elementos (${elementSummary || 'diversos tipos'}), distribuidos na area de estudo conforme o levantamento de campo e dados historicos disponiveis.</p>
<p>O escopo do trabalho inclui: (i) levantamento de dados primarios e secundarios, (ii) amostragem de solo e agua subterranea, (iii) modelagem conceitual do site, e (iv) avaliacao de risco preliminar.</p>

<h2>2. Caracterizacao da Area</h2>
${baseAnchor ? '<p>' + baseAnchor + '</p>' : ''}

<h3>2.1 Localizacao e Contexto</h3>
<p>A area de estudo compreende uma zona ${plumeCount > 0 ? 'com evidencias de contaminacao' : 'monitorada'} inserida em contexto ${buildingCount > 0 ? 'urbano-industrial' : 'ambiental'}, com area delimitada por ${boundaryCount} perimetro${boundaryCount !== 1 ? 's' : ''} de estudo.</p>
${topAnchor ? '<p>' + topAnchor + '</p>' : ''}
<p>O contexto hidrogeologico da regiao indica a presenca de aquifero livre com fluxo predominante no sentido ${['norte-sul', 'nordeste-sudoeste', 'leste-oeste', 'noroeste-sudeste'][Math.floor(Math.random() * 4)]}, conforme evidenciado pelas medidas de nivel d'agua nos pocos de monitoramento.</p>

<h3>2.2 Infraestrutura Existente</h3>
<p>Foram identificados no local:</p>
<ul>
<li><strong>${wellCount}</strong> poco${wellCount !== 1 ? 's' : ''} de monitoramento instalados para acompanhamento da qualidade das aguas subterraneas</li>
${tankCount > 0 ? '<li><strong>' + tankCount + '</strong> tanque' + (tankCount > 1 ? 's' : '') + ' de armazenamento (potenciais fontes de contaminacao)</li>' : ''}
${buildingCount > 0 ? '<li><strong>' + buildingCount + '</strong> edificacao' + (buildingCount > 1 ? 'oes' : '') + ' na area de influencia</li>' : ''}
${lakeCount > 0 ? '<li><strong>' + lakeCount + '</strong> corpo' + (lakeCount > 1 ? 's' : '') + " d'agua superficial" + (lakeCount > 1 ? 'is' : '') + '</li>' : ''}
${riverCount > 0 ? '<li><strong>' + riverCount + '</strong> curso' + (riverCount > 1 ? 's' : '') + " d'agua</li>" : ''}
</ul>

<h3>2.3 Historico de Campanhas</h3>
<p>Foram realizadas <strong>${campaigns.length}</strong> campanhas de amostragem no periodo de monitoramento:</p>
<ul>
${campaignList}
</ul>
<p>As campanhas seguiram os procedimentos estabelecidos na norma ABNT NBR 15847 para amostragem de agua subterranea e ABNT NBR 15492 para sondagens de reconhecimento.</p>

<h2>3. Modelo Conceitual</h2>
${frontAnchor ? '<p>' + frontAnchor + '</p>' : ''}
<p>O modelo conceitual do site foi elaborado com base nos dados coletados durante as campanhas de investigacao e considera os seguintes aspectos:</p>
<ul>
<li><strong>Fonte:</strong> ${tankCount > 0 ? 'Possiveis vazamentos nos tanques de armazenamento identificados na area' : plumeCount > 0 ? 'Fonte primaria de contaminacao associada as atividades historicas no local' : 'Nenhuma fonte ativa de contaminacao identificada'}</li>
<li><strong>Mecanismo de transporte:</strong> Dispersao e adveccao pela agua subterranea, com possivel contribuicao da infiltracao pluvial</li>
<li><strong>Receptores:</strong> ${wellCount > 0 ? 'Pocos de monitoramento e potenciais receptores ecologicos a jusante' : 'Ecossistemas aquaticos adjacentes'}</li>
</ul>

<h2>4. Resultados Analiticos</h2>
${evolAnchor ? '<p>' + evolAnchor + '</p>' : ''}

<h3>4.1 Agua Subterranea</h3>
<p>${plumeCount > 0 ? 'Foram identificadas <strong>' + plumeCount + '</strong> pluma' + (plumeCount > 1 ? 's' : '') + ' de contaminacao na area de estudo, com extensao variavel conforme o tipo de contaminante.' : 'Nao foram identificadas plumas de contaminacao significativas nos resultados analiticos.'}</p>
<p>Os resultados analiticos das campanhas de monitoramento indicam ${plumeCount > 0 ? 'tendencia de atenuacao natural dos contaminantes ao longo do tempo, com reducao gradual das concentracoes nos pocos sentinela' : 'condicoes estaveis dentro dos padroes de referencia estabelecidos pela legislacao vigente (CONAMA 420/2009)'}.</p>

<h3>4.2 Evolucao Temporal</h3>
<p>Os dados de monitoramento dos <strong>${wellCount}</strong> poco${wellCount !== 1 ? 's' : ''} demonstram ${campaigns.length >= 5 ? 'tendencia consistente de melhoria nos parametros monitorados' : 'necessidade de continuidade do monitoramento para avaliacao de tendencias'}, permitindo avaliar a evolucao temporal das concentracoes.</p>
${plumeCount > 0 ? '<blockquote>Nota: Os valores de referencia utilizados sao os estabelecidos pela Resolucao CONAMA 420/2009 e pelos valores orientadores da CETESB (2021) para uso do solo e agua subterranea.</blockquote>' : ''}

<h2>5. Avaliacao de Risco</h2>
<p>A avaliacao de risco preliminar foi conduzida considerando os cenarios de exposicao aplicaveis ao uso atual e futuro da area:</p>
<ul>
<li><strong>Cenario 1:</strong> Contato direto com solo — ${plumeCount > 0 ? 'risco moderado' : 'risco baixo'}</li>
<li><strong>Cenario 2:</strong> Ingestao de agua subterranea — ${plumeCount > 0 ? 'risco elevado (necessita intervencao)' : 'risco aceitavel'}</li>
<li><strong>Cenario 3:</strong> Inalacao de vapores — ${plumeCount > 0 ? 'risco moderado' : 'risco insignificante'}</li>
</ul>

<h2>6. Conclusoes e Recomendacoes</h2>
${atualAnchor ? '<p>' + atualAnchor + '</p>' : ''}
<p>Com base nos resultados obtidos ao longo das <strong>${campaigns.length}</strong> campanhas de monitoramento, conclui-se que:</p>
<ul>
<li>A rede de monitoramento com ${wellCount} poco${wellCount !== 1 ? 's' : ''} e adequada para acompanhamento das condicoes ambientais do local.</li>
<li>${plumeCount > 0 ? 'As plumas de contaminacao apresentam tendencia de reducao, indicando eficacia dos processos de atenuacao natural.' : 'Os parametros monitorados se encontram dentro dos valores de referencia aplicaveis (CONAMA 420/2009).'}</li>
<li>${tankCount > 0 ? 'Os tanques de armazenamento identificados devem ser objeto de inspecao periodica para prevencao de novos vazamentos.' : 'Nao foram identificadas novas fontes potenciais de contaminacao na area.'}</li>
<li>Recomenda-se a continuidade do programa de monitoramento com frequencia ${campaigns.length >= 3 ? 'semestral' : 'trimestral'}.</li>
</ul>

<h3>6.1 Proximos Passos</h3>
<ol>
<li>Manter o programa de monitoramento com coleta ${campaigns.length >= 3 ? 'semestral' : 'trimestral'} de amostras de agua subterranea</li>
<li>${plumeCount > 0 ? 'Avaliar a necessidade de implantacao de sistema de remediacao ativa na area das plumas' : 'Continuar o acompanhamento para confirmacao da estabilidade dos resultados'}</li>
<li>Atualizar o modelo conceitual do site com os dados das proximas campanhas</li>
<li>Elaborar relatorio de acompanhamento apos proxima campanha de amostragem</li>
</ol>

<hr>
<p><em>Documento gerado automaticamente pelo modelo digital ambiental ecbyts v0.1.0-beta. Os dados apresentados sao hipoteticos e para fins de demonstracao.</em></p>`;

    reports.push({
        id: rId,
        folderId: fId,
        title: `Relatorio — ${projectName}`,
        content: html,
        lastModified: new Date().toISOString(),
    });
    activeReportId = rId;
    _persist();
}
