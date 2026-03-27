// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Project: ECBT (Environmental & Occupational Core Byte Tools)
// Version: 0.1-beta
// Authorship: Calvin Stefan Iost
// Copyright (c) 2026 Calvin Stefan Iost

/* ================================================================
   PIPELINES HANDLER — window.* handlers para automação de pipelines
   Padrão idêntico ao workflows.js: export handlers + setUpdateAllUI.

   Dois modais:
   - #pipeline-manager-modal : lista de pipelines + progresso de run
   - #pipeline-editor-modal  : editor (linear ou bpmn-js se CDN ok)
   ================================================================ */

import {
    getAllPipelines,
    getPipeline,
    savePipeline,
    deletePipeline,
    getRunLogs,
    loadFromStorage,
} from '../../core/pipelines/index.js';
import { parseBpmnXml, validatePipeline, serializeToBpmn, BPMN_TEMPLATE } from '../../core/pipelines/schema.js';
import { runPipeline, abortRun } from '../../core/pipelines/executor.js';
import {
    renderPipelineList,
    renderRunProgress,
    initBpmnCanvas,
    renderLinearEditor,
    getModeler,
    selectPipelineElement,
    deselectPipelineElements,
} from '../ui/pipelineEditor.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { activateTabById } from '../ui/tabs.js';

// ----------------------------------------------------------------
// INJEÇÃO DE DEPENDÊNCIAS (padrão do projeto)
// ----------------------------------------------------------------

/** @type {Function|null} */
let _updateAllUI = null;

/**
 * Injeta a função updateAllUI (chamada por handlers/index.js).
 * @param {Function} fn
 */
export function setPipelinesUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ----------------------------------------------------------------
// ESTADO DO MÓDULO
// ----------------------------------------------------------------

/** @type {Object|null} PipelineRun corrente (para poder abortar) */
let _currentRun = null;

/** @type {boolean} Indica se há run em andamento */
const _runningIds = new Set();

// ----------------------------------------------------------------
// MANAGER — sidebar tab + modal legado
// ----------------------------------------------------------------

/**
 * Renderiza a lista de pipelines na aba "Automação" da sidebar direita.
 * Chamada por updateAllUI() quando a aba está visível.
 */
export function renderPipelineManagerTab() {
    const content = document.getElementById('automation-content');
    if (!content) return;
    loadFromStorage();
    const pipelines = getAllPipelines();

    // Action bar com botões de criação/importação
    const actionBar = `<div class="pipeline-tab-actions">
        <button type="button" class="btn-primary btn-sm" onclick="handleNewPipeline()">
            &#43; <span data-i18n="pipeline.manager.new">${t('pipeline.manager.new') || 'Nova Automacao'}</span>
        </button>
        <button type="button" class="btn-secondary btn-sm" onclick="handleImportPipeline()">
            &#8595; <span data-i18n="pipeline.manager.import">${t('pipeline.manager.import') || 'Importar .bpmn'}</span>
        </button>
    </div>`;

    // Renderizar lista em div temporário para combinar com action bar
    const listDiv = document.createElement('div');
    renderPipelineList(listDiv, pipelines, _runningIds);
    content.innerHTML = actionBar + listDiv.innerHTML;
}

/**
 * Abre o Pipeline Manager ativando a aba "Automação" na sidebar direita.
 */
export function handleOpenPipelineManager() {
    activateTabById('automation');
    if (typeof _updateAllUI === 'function') _updateAllUI();
}

/**
 * Fecha o Pipeline Manager modal (fallback legado).
 */
export function handleClosePipelineManager() {
    const modal = document.getElementById('pipeline-manager-modal');
    if (modal) modal.style.display = 'none';
}

function _renderManager() {
    renderPipelineManagerTab();
    const content = document.getElementById('pipeline-manager-content');
    if (!content) return;
    loadFromStorage();
    const pipelines = getAllPipelines();
    renderPipelineList(content, pipelines, _runningIds);
}

// ----------------------------------------------------------------
// EDITOR MODAL
// ----------------------------------------------------------------

/** Pipeline sendo editado (ou novo) */
let _editingId = null;

/**
 * Abre editor para novo pipeline (template padrão).
 */
export async function handleNewPipeline() {
    _editingId = null;
    _openEditor(BPMN_TEMPLATE, '');
}

/**
 * Abre editor para pipeline existente.
 * @param {string} id - Pipeline ID
 */
export async function handleEditPipeline(id) {
    const entry = getPipeline(id);
    if (!entry) {
        showToast('Pipeline não encontrado.', 'error');
        return;
    }
    _editingId = id;
    _openEditor(entry.xml, entry.name);
}

async function _openEditor(xml, name) {
    const modal = document.getElementById('pipeline-editor-modal');
    if (!modal) return;

    // Preencher nome
    const nameInput = document.getElementById('pipeline-editor-name');
    if (nameInput) nameInput.value = name || '';

    modal.style.display = 'flex';
    modal.removeAttribute('hidden');

    // Tentar carregar canvas bpmn-js; fallback para editor linear
    const canvas = document.getElementById('bpmn-canvas');
    if (canvas) {
        try {
            await initBpmnCanvas('bpmn-canvas', xml);
        } catch {
            // CDN offline — usar editor linear
            const def = parseBpmnXml(xml);
            renderLinearEditor(canvas, def);
        }
    }
}

/**
 * Fecha o editor de pipeline.
 */
export function handleClosePipelineEditor() {
    const modal = document.getElementById('pipeline-editor-modal');
    if (modal) modal.style.display = 'none';
    _editingId = null;
}

/**
 * Salva o pipeline corrente (do modeler bpmn-js ou editor linear).
 */
export async function handleSavePipeline() {
    const nameInput = document.getElementById('pipeline-editor-name');
    const name = nameInput ? nameInput.value.trim() : 'Pipeline';

    let xml = '';
    const modeler = getModeler();

    if (modeler) {
        try {
            const { xml: savedXml } = await modeler.saveXML({ format: true });
            xml = savedXml;
        } catch (e) {
            showToast('Erro ao salvar XML do modeler: ' + e.message, 'error');
            return;
        }
    } else {
        // Editor linear: serializar a partir da definição atual no DOM
        const canvas = document.getElementById('bpmn-canvas');
        if (!canvas) return;
        const def = _collectLinearEditorDef(canvas);
        if (!def) return;
        xml = serializeToBpmn({ ...def, name });
    }

    // Validar
    const parsed = parseBpmnXml(xml);
    const validation = validatePipeline(parsed);
    if (!validation.valid) {
        showToast(validation.errors.map((e) => t(e) || e).join(' | '), 'error');
        return;
    }

    savePipeline({ id: _editingId || undefined, name, xml });
    showToast(t('pipeline.export.success') || 'Pipeline salvo.', 'success');
    handleClosePipelineEditor();
    _renderManager();
}

/**
 * Coleta definição do editor linear a partir do DOM.
 * Lê os campos de formulário visíveis por tipo de nó — não o textarea escondido.
 * @param {HTMLElement} canvas
 * @returns {Object|null}
 */
function _collectLinearEditorDef(canvas) {
    const nodeCards = canvas.querySelectorAll('[data-node-id]');
    const nodes = [];
    const edges = [];

    nodeCards.forEach((card, i) => {
        const id = card.dataset.nodeId;
        const type = card.dataset.nodeType;
        const label = card.querySelector('.pipeline-node-label')?.value || id;
        const config = _readConfigFromForm(card, type);

        nodes.push({ id, type, label, config });

        // Edge sequencial simples
        const nextCard = canvas.querySelectorAll('[data-node-id]')[i + 1];
        if (nextCard) {
            edges.push({ id: 'e_' + id + '_' + nextCard.dataset.nodeId, from: id, to: nextCard.dataset.nodeId });
        }
    });

    const startNode = nodes.find((n) => n.type === 'trigger');
    return { nodes, edges, startNodeId: startNode?.id || null };
}

/**
 * Lê config de um node-card a partir dos campos de formulário visíveis.
 * Fallback para o textarea escondido se campos não estiverem presentes.
 * @param {HTMLElement} card
 * @param {string} type
 * @returns {Object}
 */
function _readConfigFromForm(card, type) {
    switch (type) {
        case 'trigger': {
            const triggerType = card.querySelector('.pipeline-cfg-trigger-type')?.value;
            if (triggerType !== undefined) return { triggerType };
            break;
        }
        case 'action': {
            const action = card.querySelector('.pipeline-cfg-action')?.value;
            const paramsRaw = card.querySelector('.pipeline-cfg-params')?.value || '{}';
            let params = {};
            try {
                params = JSON.parse(paramsRaw);
            } catch {
                params = {};
            }
            if (action !== undefined) return { action, params };
            break;
        }
        case 'condition': {
            const subject = card.querySelector('.pipeline-cfg-subject')?.value;
            const operator = card.querySelector('.pipeline-cfg-operator')?.value;
            const value = Number(card.querySelector('.pipeline-cfg-value')?.value ?? 0);
            if (subject !== undefined) return { subject, operator, value };
            break;
        }
        case 'delay': {
            const ms = Number(card.querySelector('.pipeline-cfg-ms')?.value ?? 0);
            const msEl = card.querySelector('.pipeline-cfg-ms');
            if (msEl) return { ms };
            break;
        }
        case 'api_call': {
            const url = card.querySelector('.pipeline-cfg-url')?.value || '';
            const method = card.querySelector('.pipeline-cfg-method')?.value || 'GET';
            const bodyRaw = card.querySelector('.pipeline-cfg-body')?.value || '{}';
            const timeoutMs = Number(card.querySelector('.pipeline-cfg-timeout')?.value ?? 30000);
            let body = {};
            try {
                body = JSON.parse(bodyRaw);
            } catch {
                body = {};
            }
            if (card.querySelector('.pipeline-cfg-url')) return { url, method, body, timeoutMs };
            break;
        }
    }
    // Fallback: textarea escondido
    try {
        const configInput = card.querySelector('.pipeline-node-config');
        if (configInput) return JSON.parse(configInput.value || '{}');
    } catch {
        /* ignore */
    }
    return {};
}

// ----------------------------------------------------------------
// RUN
// ----------------------------------------------------------------

/**
 * Executa um pipeline pelo ID.
 * @param {string} id - Pipeline ID
 */
export async function handleRunPipeline(id) {
    if (_runningIds.has(id)) {
        showToast(t('pipeline.run.alreadyRunning') || 'Já em execução.', 'warning');
        return;
    }

    const entry = getPipeline(id);
    if (!entry) {
        showToast('Pipeline não encontrado.', 'error');
        return;
    }

    const def = parseBpmnXml(entry.xml);
    def.pipelineId = id;
    const validation = validatePipeline(def);
    if (!validation.valid) {
        showToast(validation.errors.map((e) => t(e) || e).join(' | '), 'error');
        return;
    }

    _runningIds.add(id);
    showToast(t('pipeline.run.starting') || 'Iniciando...', 'info');

    // Contexto da app (elements, campaigns, scenes via window globals)
    const appCtx = {
        elements: (window.getAllElements && window.getAllElements()) || [],
        campaigns: (window.getAllCampaigns && window.getAllCampaigns()) || [],
        scenes: (window.getAllScenes && window.getAllScenes()) || [],
    };

    // Mostrar progresso no manager
    _renderManager();

    try {
        const run = await runPipeline(def, {
            appCtx,
            onProgress: (r) => {
                _currentRun = r;
                _showRunProgressInManager(id, r);
            },
            onLog: () => {},
        });

        _currentRun = run;
        _runningIds.delete(id);

        if (run.status === 'completed') {
            showToast(t('pipeline.run.completed') || 'Automação concluída.', 'success');
        } else if (run.status === 'aborted') {
            showToast(t('pipeline.run.aborted') || 'Interrompida.', 'warning');
        } else {
            showToast((t('pipeline.run.failed') || 'Falhou') + ': ' + (run.error || ''), 'error');
        }

        if (_updateAllUI) _updateAllUI();
    } catch (e) {
        _runningIds.delete(id);
        showToast('Erro inesperado: ' + e.message, 'error');
    }

    _renderManager();
}

/**
 * Aborta o run corrente de um pipeline.
 * @param {string} runId
 */
export function handleAbortPipeline(runId) {
    abortRun(runId);
    showToast(t('pipeline.run.aborted') || 'Abortando...', 'warning');
}

function _showRunProgressInManager(pipelineId, run) {
    const content = document.getElementById('pipeline-manager-content');
    if (!content) return;
    const card = content.querySelector(`[data-pipeline-id="${pipelineId}"]`);
    if (!card) return;
    const progressArea = card.querySelector('.pipeline-run-progress');
    if (progressArea) renderRunProgress(progressArea, run);
}

// ----------------------------------------------------------------
// EXPORT / IMPORT DE ARQUIVO
// ----------------------------------------------------------------

/**
 * Exporta pipeline como arquivo .bpmn para download.
 * @param {string} id - Pipeline ID
 */
export function handleExportPipeline(id) {
    const entry = getPipeline(id);
    if (!entry) return;
    const blob = new Blob([entry.xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (entry.name || 'pipeline').replace(/[^a-z0-9_-]/gi, '_') + '.bpmn';
    a.click();
    URL.revokeObjectURL(url);
    showToast(t('pipeline.export.success') || 'Exportado.', 'success');
}

/**
 * Abre seletor de arquivo para importar .bpmn.
 */
export function handleImportPipeline() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bpmn,.xml';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const xml = await file.text();
            const def = parseBpmnXml(xml);
            if (def.error) throw new Error(def.error);
            // Nome do arquivo como nome do pipeline
            const name = file.name.replace(/\.(bpmn|xml)$/i, '').replace(/_/g, ' ');
            savePipeline({ name, xml });
            showToast(t('pipeline.import.success') || 'Importado.', 'success');
            _renderManager();
        } catch (err) {
            showToast((t('pipeline.import.error') || 'Arquivo inválido') + ': ' + err.message, 'error');
        }
    };
    input.click();
}

// ----------------------------------------------------------------
// DELETE
// ----------------------------------------------------------------

/**
 * Remove pipeline após confirmação.
 * @param {string} id
 */
export async function handleDeletePipeline(id) {
    const msg = t('pipeline.delete.confirm') || 'Excluir esta automação?';
    // asyncConfirm se disponível, senão confirm nativo
    let confirmed;
    if (window.asyncConfirm) {
        confirmed = await window.asyncConfirm(msg);
    } else {
        confirmed = window.confirm(msg);
    }
    if (!confirmed) return;
    deletePipeline(id);
    _renderManager();
}

// ----------------------------------------------------------------
// EXPORT DO MÓDULO
// ----------------------------------------------------------------

// Exposto para testes E2E
export { selectPipelineElement, deselectPipelineElements };

export const pipelineHandlers = {
    handleOpenPipelineManager,
    handleClosePipelineManager,
    renderPipelineManagerTab,
    handleNewPipeline,
    handleEditPipeline,
    handleClosePipelineEditor,
    handleSavePipeline,
    handleRunPipeline,
    handleAbortPipeline,
    handleExportPipeline,
    handleImportPipeline,
    handleDeletePipeline,
    pipelineSelectElement: selectPipelineElement,
    pipelineDeselectAll: deselectPipelineElements,
};
