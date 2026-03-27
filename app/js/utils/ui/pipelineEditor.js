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
   PIPELINE EDITOR — Render do manager e editor de pipelines
   Dois modos de editor:
   1. Editor linear (Plan A, offline) — lista de node-cards
   2. bpmn-js canvas (upgrade CDN)   — lazy-loaded, fallback automático

   Regra UI: sem emojis — usar HTML entities e CSS classes.
   Watermark bpmn-js: obrigatório pela licença bpmn.io — não remover.
   ================================================================ */

import { loadScriptCDN } from '../helpers/cdnLoader.js';
import { NODE_TYPES, ALLOWED_PATHS, createPipelineId } from '../../core/pipelines/schema.js';
import { getRegisteredActions } from '../../core/pipelines/executor.js';
import { getHeadlessMeta } from '../api/registry.js';
import { ACTION_REGISTRY } from '../api/registry.js';
import { t } from '../i18n/translations.js';

// ----------------------------------------------------------------
// METADADOS DE CATEGORIAS — label PT-BR + cor para o action picker
// ----------------------------------------------------------------

const CAT_META = {
    elements: { label: 'Elementos', color: '#22c55e' },
    observations: { label: 'Observações', color: '#3b82f6' },
    campaigns: { label: 'Campanhas', color: '#a855f7' },
    families: { label: 'Famílias', color: '#10b981' },
    edges: { label: 'Conexões', color: '#6366f1' },
    stamps: { label: 'Timestamps', color: '#f97316' },
    parameters: { label: 'Parâmetros', color: '#f59e0b' },
    scenes: { label: 'Cenas', color: '#06b6d4' },
    camera: { label: 'Câmera', color: '#0ea5e9' },
    panels: { label: 'Painéis', color: '#64748b' },
    ui: { label: 'Interface', color: '#94a3b8' },
    project: { label: 'Projeto', color: '#d97706' },
    model: { label: 'Modelo', color: '#b45309' },
    governance: { label: 'Governança', color: '#dc2626' },
    io: { label: 'Import/Export', color: '#7c3aed' },
    merge: { label: 'Mesclagem', color: '#0d9488' },
    storage: { label: 'Armazenamento', color: '#475569' },
    analytics: { label: 'Análise', color: '#0891b2' },
    calculator: { label: 'Calculadora', color: '#0369a1' },
    interpolation: { label: 'Interpolação', color: '#0284c7' },
    sao: { label: 'SAO / ESH', color: '#be123c' },
    sensor: { label: 'Sensores', color: '#15803d' },
    ticker: { label: 'Ticker', color: '#a16207' },
    llm: { label: 'IA / LLM', color: '#7c3aed' },
    agents: { label: 'Agentes', color: '#6d28d9' },
    smartImport: { label: 'Smart Import', color: '#0f766e' },
    report: { label: 'Relatórios', color: '#e11d48' },
    outros: { label: 'Outros', color: '#6b7280' },
};

// ----------------------------------------------------------------
// CDN URLs para bpmn-js
// ----------------------------------------------------------------

const BPMN_JS_URL = 'https://unpkg.com/bpmn-js@18.13.1/dist/bpmn-modeler.production.min.js';
const BPMN_CSS_URLS = [
    'https://unpkg.com/bpmn-js@18.13.1/dist/assets/diagram-js.css',
    'https://unpkg.com/bpmn-js@18.13.1/dist/assets/bpmn-js.css',
    'https://unpkg.com/bpmn-js@18.13.1/dist/assets/bpmn-font/css/bpmn.css',
];

// ----------------------------------------------------------------
// ESTADO DO MÓDULO
// ----------------------------------------------------------------

/** @type {Object|null} Instância singleton do BpmnJS modeler */
let _modeler = null;
let _bpmnCssInjected = false;
let _kvIdCounter = 0;

/**
 * Retorna instância singleton do BpmnJS modeler (ou null).
 * @returns {Object|null}
 */
export function getModeler() {
    return _modeler;
}

/**
 * Seleciona um elemento do canvas bpmn-js pelo ID e abre o painel de propriedades.
 * Útil para testes E2E e integrações externas.
 * @param {string} elementId - ID do elemento BPMN (ex: 'Task_vis')
 * @returns {boolean} true se o elemento foi encontrado e selecionado
 */
// Helper exposto para o inline-onchange do select de ações
window._pipelineActionMeta = function (actionName) {
    const meta = ACTION_REGISTRY.find((e) => e.name === actionName);
    return meta?.params?.length
        ? `Parâmetros: <b>${meta.params.join(', ')}</b>`
        : actionName
          ? 'Sem parâmetros obrigatórios'
          : 'Selecione uma ação';
};

export function selectPipelineElement(elementId) {
    if (!_modeler) return false;
    try {
        const er = _modeler.get('elementRegistry');
        const el = er.get(elementId);
        if (!el) return false;
        const modeling = _modeler.get('modeling');
        _showPropPanel(el, modeling);
        _modeler.get('selection').select(el);
        return true;
    } catch {
        return false;
    }
}

/**
 * Deseleciona todos os elementos e oculta o painel de propriedades.
 * Útil para testes E2E.
 */
export function deselectPipelineElements() {
    if (_modeler) {
        try {
            _modeler.get('selection').select([]);
        } catch {
            /* ignore */
        }
    }
    _hidePropPanel();
}

// ----------------------------------------------------------------
// BPMN-JS CANVAS (upgrade CDN)
// ----------------------------------------------------------------

/**
 * Injeta CSS do bpmn-js (once).
 */
function injectBpmnCss() {
    if (_bpmnCssInjected) return;
    BPMN_CSS_URLS.forEach((url) => {
        if (!document.querySelector(`link[href="${url}"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            document.head.appendChild(link);
        }
    });
    _bpmnCssInjected = true;
}

/**
 * Inicializa o canvas bpmn-js no container especificado.
 * Se CDN falhar, lança erro (caller deve fazer fallback para renderLinearEditor).
 *
 * @param {string} containerId - ID do elemento container
 * @param {string} xmlString   - BPMN 2.0 XML inicial
 * @throws {Error} Se CDN não disponível ou importXML falhar
 */
export async function initBpmnCanvas(containerId, xmlString) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container #${containerId} não encontrado`);

    // Mostrar spinner de loading
    container.innerHTML = `<div class="pipeline-canvas-loading"><span>${t('pipeline.editor.loading') || 'Carregando editor BPMN...'}</span></div>`;

    injectBpmnCss();

    // Carregar bpmn-js via CDN (timeout 15s)
    await loadScriptCDN(BPMN_JS_URL, {
        name: 'bpmn-js',
        globalVar: 'BpmnJS',
        timeout: 15000,
    });

    if (!window.BpmnJS) throw new Error('BpmnJS não disponível após carregamento');

    // Limpar spinner
    container.innerHTML = '';

    // Destruir instância anterior se existir
    if (_modeler) {
        try {
            _modeler.destroy();
        } catch {
            /* ignore */
        }
    }

    _modeler = new window.BpmnJS({ container });

    try {
        await _modeler.importXML(xmlString || '');
        // Centralizar e ajustar zoom ao diagrama importado
        try {
            _modeler.get('canvas').zoom('fit-viewport', 'auto');
        } catch {
            /* ignore */
        }
    } catch (e) {
        // XML vazio ou sem BPMNDiagram (sem layout visual) — canvas vazio é aceitável
        if (!xmlString || xmlString.trim() === '') {
            // ok — novo diagrama em branco
        } else if (e.message && e.message.includes('no diagram to display')) {
            // XML tem semântica BPMN mas sem seção bpmndi — canvas em branco, editável
        } else {
            throw new Error('Falha ao importar XML: ' + e.message);
        }
    }

    // Painel de propriedades — aparece ao selecionar um elemento
    const eventBus = _modeler.get('eventBus');
    const modeling = _modeler.get('modeling');

    eventBus.on('selection.changed', ({ newSelection }) => {
        if (!newSelection || newSelection.length !== 1) {
            _hidePropPanel();
            return;
        }
        const element = newSelection[0];
        if (element.type === 'bpmn:Process' || element.type === 'bpmn:Collaboration' || element.type === 'label')
            return;
        _showPropPanel(element, modeling);
    });

    // Adicionar nota de licença bpmn.io (obrigação da licença) — overlay discreto no canto
    const existingNote = container.querySelector('.pipeline-bpmn-license-note');
    if (existingNote) existingNote.remove();
    const note = document.createElement('div');
    note.className = 'pipeline-bpmn-license-note';
    note.textContent = t('pipeline.watermark.note') || 'bpmn.io';
    container.appendChild(note);
}

// ----------------------------------------------------------------
// PIPELINE MANAGER — lista de pipelines
// ----------------------------------------------------------------

/**
 * Renderiza lista de pipelines no container.
 *
 * @param {HTMLElement} container
 * @param {Array} pipelines - Array de PipelineDefinition
 * @param {Set<string>} runningIds - IDs de pipelines em execução
 */
export function renderPipelineList(container, pipelines, runningIds = new Set()) {
    if (!container) return;

    if (!pipelines || pipelines.length === 0) {
        container.innerHTML = `<p class="pipeline-empty">${t('pipeline.manager.empty') || 'Nenhuma automação definida.'}</p>`;
        return;
    }

    container.innerHTML = pipelines
        .map((p) => {
            const nodeCount = _countNodes(p.xml);
            const stepsLabel = t('pipeline.manager.steps', { n: nodeCount });
            const dateLabel = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '';
            const isRunning = runningIds.has(p.id);
            const runBtnDisabled = isRunning ? 'disabled' : '';

            return `<div class="pipeline-card" data-pipeline-id="${p.id}">
  <div class="pipeline-card-header">
    <span class="pipeline-card-name">${_esc(p.name)}</span>
    <span class="pipeline-card-meta">${stepsLabel} &bull; ${dateLabel}</span>
  </div>
  <div class="pipeline-run-progress"></div>
  <div class="pipeline-card-actions">
    <button class="btn-pipeline-run" onclick="handleRunPipeline('${p.id}')" ${runBtnDisabled}
            title="${t('pipeline.run.starting') || 'Executar'}">&#9654;</button>
    <button class="btn-pipeline-edit" onclick="handleEditPipeline('${p.id}')"
            title="Editar">&#9998;</button>
    <button class="btn-pipeline-export" onclick="handleExportPipeline('${p.id}')"
            title="${t('pipeline.export.success') || 'Exportar'}">&#8595;</button>
    <button class="btn-pipeline-delete" onclick="handleDeletePipeline('${p.id}')"
            title="${t('pipeline.delete.confirm') || 'Excluir'}">&#9003;</button>
  </div>
</div>`;
        })
        .join('');
}

/**
 * Conta nós BPMN em um XML (estimativa rápida por regex).
 * @param {string} xml
 * @returns {number}
 */
function _countNodes(xml) {
    if (!xml) return 0;
    const matches = xml.match(
        /<bpmn:(startEvent|serviceTask|exclusiveGateway|intermediateCatchEvent|scriptTask|endEvent)/g,
    );
    return matches ? matches.length : 0;
}

// ----------------------------------------------------------------
// RUN PROGRESS — progresso inline no card
// ----------------------------------------------------------------

/**
 * Renderiza progresso de execução no elemento dado.
 *
 * @param {HTMLElement} container
 * @param {Object} run - PipelineRun corrente
 */
export function renderRunProgress(container, run) {
    if (!container || !run) return;

    const statusClass =
        {
            running: 'status-running',
            completed: 'status-completed',
            failed: 'status-failed',
            aborted: 'status-aborted',
        }[run.status] || '';

    const logHtml = (run.log || [])
        .map((entry) => {
            const cls =
                entry.status === 'completed' ? 'log-ok' : entry.status === 'failed' ? 'log-fail' : 'log-running';
            const errStr = entry.error ? ` — ${_esc(entry.error)}` : '';
            return `<div class="pipeline-log-entry ${cls}">&#9679; ${_esc(entry.nodeId)} [${entry.status}]${errStr}</div>`;
        })
        .join('');

    const abortBtn =
        run.status === 'running'
            ? `<button class="btn-pipeline-abort" onclick="handleAbortPipeline('${run.runId}')">${t('pipeline.run.abort') || 'Abortar'}</button>`
            : '';

    container.innerHTML = `<div class="pipeline-run-status ${statusClass}">
  ${abortBtn}
  <div class="pipeline-log-scroll">${logHtml || '<em>Iniciando...</em>'}</div>
</div>`;
}

// ----------------------------------------------------------------
// EDITOR LINEAR (Plan A — offline, sem bpmn-js)
// ----------------------------------------------------------------

/**
 * Renderiza editor linear de nodes no container.
 * Lista vertical de node-cards com botões ▲/▼/✕ e "+ Adicionar passo".
 *
 * @param {HTMLElement} container
 * @param {{ nodes: Array, edges: Array, startNodeId: string|null }} def
 */
export function renderLinearEditor(container, def) {
    if (!container) return;

    const nodes = def && def.nodes ? [...def.nodes] : [];

    const notice = `<div class="pipeline-linear-notice">${t('pipeline.editor.linearMode') || 'Editor linear (modo offline)'}</div>`;
    const addBtn = `<button class="btn-add-node" onclick="_pipelineAddNode()">${t('pipeline.editor.addStep') || '+ Adicionar passo'}</button>`;

    container.innerHTML =
        notice +
        '<div id="pipeline-nodes-list">' +
        nodes.map((node, i) => _renderNodeCard(node, i, nodes.length)).join(_addBtnBetween()) +
        '</div>' +
        addBtn;

    // Expor callbacks de manipulação de nós no window (escopo linear editor)
    window._pipelineAddNode = () => _addNode(container);
    window._pipelineMoveUp = (i) => _moveNode(container, def, i, -1);
    window._pipelineMoveDown = (i) => _moveNode(container, def, i, +1);
    window._pipelineRemoveNode = (i) => _removeNode(container, def, i);
    window._pipelineNodeType = (i, type) => _changeNodeType(container, def, i, type);
}

function _addBtnBetween() {
    return '<div class="pipeline-add-between">&#43;</div>';
}

/**
 * Renderiza card de um nó individual.
 * @param {Object} node
 * @param {number} index
 * @param {number} total
 * @returns {string} HTML
 */
function _renderNodeCard(node, index, total) {
    const configJson = JSON.stringify(node.config || {}, null, 2);
    const configSummaryLabel = t('pipeline.node.config') || 'Configuracao';

    // Nó terminal (endEvent) — exibido como read-only, sem edição de tipo nem config
    if (node.type === 'end') {
        const endLabel = t('pipeline.node.type.end') || 'Fim';
        return `<div class="pipeline-node-card pipeline-node-card--end" data-node-id="${_esc(node.id)}" data-node-type="end">
  <div class="pipeline-node-header">
    <span class="pipeline-node-type-badge pipeline-node-badge--end">${endLabel}</span>
    <span class="pipeline-node-label-readonly">${_esc(node.label || node.id)}</span>
  </div>
</div>`;
    }

    const typeOptions = Object.values(NODE_TYPES)
        .map(
            (nt) =>
                `<option value="${nt}" ${nt === node.type ? 'selected' : ''}>${t('pipeline.node.type.' + nt) || nt}</option>`,
        )
        .join('');

    const configFormHtml = _renderConfigForm(node);
    const typeClass = `pipeline-node-card--${node.type || 'action'}`;

    return `<div class="pipeline-node-card ${typeClass}" data-node-id="${_esc(node.id)}" data-node-type="${_esc(node.type)}">
  <div class="pipeline-node-header">
    <select class="pipeline-node-type-select" onchange="_pipelineNodeType(${index}, this.value)" title="Tipo do passo">${typeOptions}</select>
    <input class="pipeline-node-label" type="text" value="${_esc(node.label || node.id)}" placeholder="Nome do passo" />
    <div class="pipeline-node-btns">
      ${index > 0 ? `<button onclick="_pipelineMoveUp(${index})" title="Mover acima">&#9650;</button>` : ''}
      ${index < total - 1 ? `<button onclick="_pipelineMoveDown(${index})" title="Mover abaixo">&#9660;</button>` : ''}
      <button onclick="_pipelineRemoveNode(${index})" title="Remover">&#10005;</button>
    </div>
  </div>
  <details class="pipeline-node-config-wrap">
    <summary>${configSummaryLabel}</summary>
    ${configFormHtml}
    <textarea class="pipeline-node-config" rows="3" style="display:none">${_esc(configJson)}</textarea>
  </details>
</div>`;
}

/**
 * Renderiza formulário de config específico por tipo.
 * @param {Object} node
 * @returns {string} HTML
 */
function _renderConfigForm(node) {
    const cfg = node.config || {};

    switch (node.type) {
        case NODE_TYPES.TRIGGER: {
            return `<label>Tipo de gatilho:
              <select class="pipeline-cfg-trigger-type" name="triggerType">
                <option value="manual" ${cfg.triggerType !== 'eventBus' ? 'selected' : ''}>Manual</option>
                <option value="eventBus" ${cfg.triggerType === 'eventBus' ? 'selected' : ''}>Evento do sistema</option>
              </select></label>`;
        }

        case NODE_TYPES.ACTION: {
            const actions = getRegisteredActions();
            const options = actions
                .map((a) => `<option value="${_esc(a)}" ${a === cfg.action ? 'selected' : ''}>${_esc(a)}</option>`)
                .join('');
            const paramsStr = JSON.stringify(cfg.params || {});

            // P2: Schema-driven param form when paramsSchema available (YELLOW-C3)
            let paramsFormHtml = '';
            const meta = cfg.action ? getHeadlessMeta(cfg.action) : null;
            if (meta?.paramsSchema) {
                const schema = meta.paramsSchema;
                const params = cfg.params || {};
                paramsFormHtml =
                    '<div class="pipeline-params-form" style="margin-top:6px;padding:6px;border:1px solid var(--border-color,#444);border-radius:4px;">';
                paramsFormHtml += `<div style="font-size:10px;color:var(--text-muted,#888);margin-bottom:4px;">Headless params (${meta.headlessSafe ? 'headless-safe' : 'UI fallback'})</div>`;
                for (const [key, def] of Object.entries(schema)) {
                    const val = params[key] ?? def.default ?? '';
                    const reqMark = def.required ? ' *' : '';
                    if (def.type === 'select' && def.options) {
                        const opts = def.options
                            .map((o) => `<option value="${_esc(o)}" ${o === val ? 'selected' : ''}>${_esc(o)}</option>`)
                            .join('');
                        paramsFormHtml += `<label style="font-size:11px;">${_esc(def.label || key)}${reqMark}: <select class="pipeline-param" data-param="${_esc(key)}">${opts}</select></label>`;
                    } else {
                        const inputType = def.type === 'number' ? 'number' : 'text';
                        paramsFormHtml += `<label style="font-size:11px;">${_esc(def.label || key)}${reqMark}: <input class="pipeline-param" data-param="${_esc(key)}" type="${inputType}" value="${_esc(String(val))}" /></label>`;
                    }
                }
                paramsFormHtml += `<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Tip: use $prev.fieldName for chaining</div>`;
                paramsFormHtml += '</div>';
            }

            return `<label>Acao:
              <select class="pipeline-cfg-action" name="action">${options}</select></label>
              ${paramsFormHtml}
              <label>Parametros (JSON):
              <input class="pipeline-cfg-params" type="text" value="${_esc(paramsStr)}" placeholder="{}" /></label>`;
        }

        case NODE_TYPES.CONDITION: {
            const subjectOptions = Object.keys(ALLOWED_PATHS)
                .map((k) => `<option value="${_esc(k)}" ${k === cfg.subject ? 'selected' : ''}>${_esc(k)}</option>`)
                .join('');
            const ops = ['>', '<', '>=', '<=', '===', '!=='];
            const opOptions = ops
                .map((op) => `<option value="${op}" ${op === cfg.operator ? 'selected' : ''}>${op}</option>`)
                .join('');
            return `<label>Sujeito: <select class="pipeline-cfg-subject">${subjectOptions}</select></label>
              <label>Operador: <select class="pipeline-cfg-operator">${opOptions}</select></label>
              <label>Valor: <input class="pipeline-cfg-value" type="number" value="${_esc(String(cfg.value ?? '0'))}" /></label>`;
        }

        case NODE_TYPES.DELAY: {
            return `<label>Aguardar (ms):
              <input class="pipeline-cfg-ms" type="number" min="0" max="300000" value="${_esc(String(cfg.ms || 0))}" /></label>`;
        }

        case NODE_TYPES.API_CALL: {
            const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
            const methOpts = methods
                .map((m) => `<option value="${m}" ${m === (cfg.method || 'GET') ? 'selected' : ''}>${m}</option>`)
                .join('');
            return `<label>URL: <input class="pipeline-cfg-url" type="url" value="${_esc(cfg.url || '')}" placeholder="https://..." /></label>
              <label>Metodo: <select class="pipeline-cfg-method">${methOpts}</select></label>
              <label>Body (JSON): <textarea class="pipeline-cfg-body" rows="2">${_esc(JSON.stringify(cfg.body || {}))}</textarea></label>
              <label>Timeout (ms): <input class="pipeline-cfg-timeout" type="number" min="1000" max="120000" value="${_esc(String(cfg.timeoutMs || 30000))}" /></label>`;
        }

        default:
            return '<em>Configure este passo via JSON:</em>';
    }
}

// ----------------------------------------------------------------
// AÇÕES DO EDITOR LINEAR
// ----------------------------------------------------------------

function _addNode(container) {
    const list = container.querySelector('#pipeline-nodes-list');
    if (!list) return;
    const newNode = {
        id: 'n_' + Date.now().toString(36),
        type: NODE_TYPES.ACTION,
        label: 'Novo passo',
        config: {},
    };
    const div = document.createElement('div');
    div.innerHTML = _renderNodeCard(newNode, list.children.length, list.children.length + 1);
    list.appendChild(div.firstElementChild);
}

function _moveNode(container, def, index, delta) {
    const nodes = [...(def.nodes || [])];
    const newIdx = index + delta;
    if (newIdx < 0 || newIdx >= nodes.length) return;
    [nodes[index], nodes[newIdx]] = [nodes[newIdx], nodes[index]];
    def.nodes = nodes;
    renderLinearEditor(container, def);
}

function _removeNode(container, def, index) {
    const nodes = [...(def.nodes || [])];
    nodes.splice(index, 1);
    def.nodes = nodes;
    renderLinearEditor(container, def);
}

function _changeNodeType(container, def, index, newType) {
    const nodes = [...(def.nodes || [])];
    if (!nodes[index]) return;
    nodes[index] = { ...nodes[index], type: newType, config: {} };
    def.nodes = nodes;
    renderLinearEditor(container, def);
}

// ----------------------------------------------------------------
// UTILITÁRIOS
// ----------------------------------------------------------------

/**
 * Escapa HTML para prevenir XSS em strings de usuário em innerHTML.
 * @param {string} str
 * @returns {string}
 */
function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ----------------------------------------------------------------
// UTILITÁRIOS DE UI — nomes amigáveis, kv-editor
// ----------------------------------------------------------------

/**
 * Converte nome de handler em rótulo legível para o usuário.
 * Ex: "handleOpenReportOverlay" → "Open Report Overlay"
 * @param {string} name
 * @returns {string}
 */
function _toFriendlyName(name) {
    return (
        String(name || '')
            .replace(/^handle/, '')
            .replace(/([A-Z])/g, ' $1')
            .trim() || name
    );
}

/**
 * Renderiza um editor visual de pares chave-valor.
 * @param {string} cfgKey - data-cfg-key do campo
 * @param {Object} obj    - Objeto { chave: valor }
 * @param {string} keyPlaceholder
 * @param {string} valPlaceholder
 * @returns {string} HTML
 */
function _renderKvEditor(cfgKey, obj, keyPlaceholder = 'Chave', valPlaceholder = 'Valor') {
    const rows = Object.entries(obj || {})
        .map(
            ([k, v]) =>
                `<div class="kv-row">
            <input class="kv-key" placeholder="${_escProp(keyPlaceholder)}" value="${_escProp(k)}" />
            <input class="kv-value" placeholder="${_escProp(valPlaceholder)}" value="${_escProp(String(v ?? ''))}" />
            <button type="button" class="kv-remove" title="Remover linha">&#10005;</button>
        </div>`,
        )
        .join('');
    return `<div class="kv-editor" data-cfg-key="${_escProp(cfgKey)}" data-kv="1"
        data-kv-key-ph="${_escProp(keyPlaceholder)}" data-kv-val-ph="${_escProp(valPlaceholder)}">
        ${rows}
        <button type="button" class="kv-add">&#43; Adicionar</button>
    </div>`;
}

/**
 * Lê um kv-editor e retorna o objeto { chave: valor }.
 * @param {HTMLElement} kvEl
 * @returns {Object}
 */
function _readKvEditor(kvEl) {
    const obj = {};
    kvEl.querySelectorAll('.kv-row').forEach((row) => {
        // guided row tem chave fixa em data-param-key; free row usa input.kv-key
        const k = row.dataset.paramKey || row.querySelector('.kv-key')?.value?.trim();
        const v = row.querySelector('.kv-value')?.value?.trim();
        if (k) obj[k] = v ?? '';
    });
    return obj;
}

/**
 * Renderiza params guiados: chaves conhecidas como labels + input de valor;
 * params extras como linha editável livre.
 * @param {string} action - Nome da ação selecionada
 * @param {string[]} knownParams - Lista de params conhecidos da ação
 * @param {Object} currentParams - Valores já salvos
 * @returns {string} HTML
 */
function _renderGuidedParams(action, knownParams, currentParams) {
    const guided = (knownParams || [])
        .map((p) => {
            const v = currentParams?.[p] ?? '';
            return `<div class="kv-row kv-row-guided" data-param-key="${_escProp(p)}">
            <span class="kv-key-label" title="${_escProp(p)}">${_escProp(p)}</span>
            <input class="kv-value" value="${_escProp(String(v))}" placeholder="valor" />
        </div>`;
        })
        .join('');
    const extras = Object.entries(currentParams || {})
        .filter(([k]) => !(knownParams || []).includes(k))
        .map(
            ([k, v]) =>
                `<div class="kv-row">
                <input class="kv-key" value="${_escProp(k)}" placeholder="chave" />
                <input class="kv-value" value="${_escProp(String(v ?? ''))}" placeholder="valor" />
                <button type="button" class="kv-remove">&#10005;</button>
            </div>`,
        )
        .join('');
    return `<div class="kv-editor" data-cfg-key="params" data-kv="1"
            data-kv-key-ph="chave" data-kv-val-ph="valor" data-params-panel="1">
        ${guided}${extras}
        <button type="button" class="kv-add">&#43; Param extra</button>
    </div>`;
}

// ----------------------------------------------------------------
// PROPERTIES PANEL — painel de propriedades inline no canvas bpmn-js
// ----------------------------------------------------------------

/**
 * Lê ecbyts:config do elemento bpmn-js.
 * @param {Object} element - Elemento bpmn-js
 * @returns {{ type: string, config: Object }}
 */
function _getEcbytsCfg(element) {
    try {
        const bo = element.businessObject;
        const ext = bo.extensionElements;
        if (!ext || !ext.values) return { type: null, config: {} };
        for (const val of ext.values) {
            const text = val.$body || val.value || '';
            if (text) {
                const parsed = JSON.parse(text);
                return { type: parsed.type || null, config: parsed.config || {} };
            }
        }
    } catch {
        /* ignore */
    }
    return { type: null, config: {} };
}

/**
 * Grava ecbyts:config de volta no elemento bpmn-js via modeling.
 * @param {Object} element - Elemento bpmn-js
 * @param {Object} modeling - Serviço modeling do bpmn-js
 * @param {string} type - Tipo do nó
 * @param {Object} config - Configuração a salvar
 */
function _setEcbytsCfg(element, modeling, type, config) {
    try {
        const bo = element.businessObject;
        const configJson = JSON.stringify({ type, config });

        if (bo.extensionElements && bo.extensionElements.values) {
            for (const val of bo.extensionElements.values) {
                if (val.$body !== undefined || val.value !== undefined) {
                    if (val.$body !== undefined) val.$body = configJson;
                    else val.value = configJson;
                    modeling.updateProperties(element, {});
                    return;
                }
            }
        }
        console.warn('[pipelineEditor] Sem extensionElements para atualizar config');
    } catch (e) {
        console.warn('[pipelineEditor] Falha ao salvar config:', e.message);
    }
}

/**
 * Esconde o painel de propriedades.
 */
function _hidePropPanel() {
    const panel = document.getElementById('pipeline-props-panel');
    if (panel) panel.style.display = 'none';
    const titleEl = document.getElementById('pipeline-props-title');
    if (titleEl) titleEl.textContent = 'Propriedades';
}

/**
 * Anexa event listeners de add/remove/input em um kv-editor.
 * Extraído para reutilização ao re-renderizar params após troca de ação.
 */
function _attachKvListeners(kvEl, element, modeling, nodeType, body) {
    kvEl.addEventListener('input', () => _savePropFields(element, modeling, nodeType, body));
    kvEl.addEventListener('change', () => _savePropFields(element, modeling, nodeType, body));
    kvEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.classList.contains('kv-remove')) {
            btn.closest('.kv-row')?.remove();
            _savePropFields(element, modeling, nodeType, body);
        } else if (btn.classList.contains('kv-add')) {
            const kPh = kvEl.dataset.kvKeyPh || 'Chave';
            const vPh = kvEl.dataset.kvValPh || 'Valor';
            const row = document.createElement('div');
            row.className = 'kv-row';
            row.innerHTML =
                `<input class="kv-key" id="kv-key-${_kvIdCounter}" placeholder="${_escProp(kPh)}" aria-label="${_escProp(kPh)}" />` +
                `<input class="kv-value" id="kv-val-${_kvIdCounter++}" placeholder="${_escProp(vPh)}" aria-label="${_escProp(vPh)}" />` +
                `<button type="button" class="kv-remove" title="Remover linha">&#10005;</button>`;
            btn.before(row);
            row.querySelector('.kv-key').focus();
            _savePropFields(element, modeling, nodeType, body);
        }
    });
}

/**
 * Mostra painel de propriedades para o elemento selecionado.
 * @param {Object} element - Elemento bpmn-js selecionado
 * @param {Object} modeling - Serviço modeling do bpmn-js
 */
function _showPropPanel(element, modeling) {
    const panel = document.getElementById('pipeline-props-panel');
    const body = document.getElementById('pipeline-props-body');
    if (!panel || !body) return;

    const { type, config } = _getEcbytsCfg(element);
    const elType = element.type || '';
    const nodeType = type || _bpmnTypeToNodeType(elType);

    body.innerHTML = _renderPropFields(nodeType, config, element);
    panel.style.display = 'flex';

    // Atualizar título do painel com tipo + nome do elemento
    const titleEl = document.getElementById('pipeline-props-title');
    if (titleEl) {
        const bo = element.businessObject;
        const elName = bo?.name || element.id || '';
        titleEl.innerHTML = `<span class="props-type-badge props-type-${_escProp(nodeType)}">${_escProp(nodeType)}</span>&nbsp;${_escProp(elName)}`;
    }

    // Listeners em todos os campos diretos (excluindo kv e action-picker)
    body.querySelectorAll('[data-cfg-key]:not([data-kv]):not([data-action-picker])').forEach((input) => {
        input.addEventListener('change', () => _savePropFields(element, modeling, nodeType, body));
        input.addEventListener('input', () => _savePropFields(element, modeling, nodeType, body));
    });
    // Listeners delegados nos kv-editors
    body.querySelectorAll('[data-kv]').forEach((kvEl) => _attachKvListeners(kvEl, element, modeling, nodeType, body));
    // Action picker: filter + click
    const searchEl = body.querySelector('.props-action-search');
    const pickerEl = body.querySelector('[data-action-picker]');
    if (searchEl && pickerEl) {
        searchEl.addEventListener('input', () => {
            const v = searchEl.value.toLowerCase();
            pickerEl.querySelectorAll('.action-option').forEach((o) => {
                o.hidden =
                    !!v && !o.textContent.toLowerCase().includes(v) && !o.dataset.value.toLowerCase().includes(v);
            });
            pickerEl.querySelectorAll('.action-cat-group').forEach((g) => {
                g.hidden = !!v && !Array.from(g.querySelectorAll('.action-option')).some((o) => !o.hidden);
            });
        });
        pickerEl.addEventListener('click', (e) => {
            const opt = e.target.closest('.action-option');
            if (!opt) return;
            pickerEl.querySelectorAll('.action-option.selected').forEach((o) => o.classList.remove('selected'));
            opt.classList.add('selected');
            const actionName = opt.dataset.value;
            const knownParams = JSON.parse(opt.dataset.params || '[]');
            // Atualizar hint
            const hintEl = body.querySelector('.props-action-hint');
            if (hintEl)
                hintEl.innerHTML = knownParams.length
                    ? `Parâmetros: <b>${knownParams.join(', ')}</b>`
                    : actionName
                      ? 'Sem parâmetros obrigatórios'
                      : 'Selecione uma ação';
            // Re-renderizar params guiados
            const oldParams = body.querySelector('[data-params-panel]');
            if (oldParams) {
                oldParams.outerHTML = _renderGuidedParams(actionName, knownParams, {});
                const newParams = body.querySelector('[data-params-panel]');
                if (newParams) _attachKvListeners(newParams, element, modeling, nodeType, body);
            }
            _savePropFields(element, modeling, nodeType, body);
        });
    }
}

/**
 * Mapeia tipo BPMN para tipo interno ecbyts.
 * @param {string} bpmnType
 * @returns {string}
 */
function _bpmnTypeToNodeType(bpmnType) {
    const map = {
        'bpmn:StartEvent': 'trigger',
        'bpmn:ServiceTask': 'action',
        'bpmn:ExclusiveGateway': 'condition',
        'bpmn:IntermediateCatchEvent': 'delay',
        'bpmn:ScriptTask': 'api_call',
        'bpmn:EndEvent': 'end',
    };
    return map[bpmnType] || 'action';
}

/**
 * Renderiza os campos de formulário baseado no tipo de nó.
 * @param {string} nodeType
 * @param {Object} config
 * @param {Object} element
 * @returns {string} HTML dos campos
 */
function _renderPropFields(nodeType, config, element) {
    const bo = element.businessObject;
    const label = bo.name || '';

    let fields = `
        <div class="props-field">
            <label class="props-label">Nome</label>
            <input class="props-input" data-cfg-key="__name__" type="text" value="${_escProp(label)}" placeholder="Nome do passo" />
        </div>
        <div class="props-field props-field--type">
            <label class="props-label">Tipo</label>
            <span class="props-type-badge props-type-${_escProp(nodeType)}">${_escProp(nodeType)}</span>
        </div>
    `;

    switch (nodeType) {
        case 'trigger':
            fields += `
                <div class="props-field">
                    <label class="props-label">Tipo de gatilho</label>
                    <select class="props-input" data-cfg-key="triggerType">
                        <option value="manual" ${config.triggerType === 'manual' ? 'selected' : ''}>Manual</option>
                        <option value="schedule" ${config.triggerType === 'schedule' ? 'selected' : ''}>Agendado</option>
                        <option value="event" ${config.triggerType === 'event' ? 'selected' : ''}>Evento</option>
                    </select>
                </div>`;
            break;

        case 'action': {
            // Agrupar ações registradas por categoria
            const registered = new Set(getRegisteredActions());
            const groups = {};
            for (const entry of ACTION_REGISTRY) {
                if (!registered.has(entry.name)) continue;
                const cat = entry.cat || 'outros';
                (groups[cat] = groups[cat] || []).push(entry);
            }
            // Ações não mapeadas → "outros"
            const mappedSet = new Set(ACTION_REGISTRY.map((e) => e.name));
            const unmapped = [...registered].filter((n) => !mappedSet.has(n));
            if (unmapped.length) {
                groups.outros = (groups.outros || []).concat(unmapped.map((n) => ({ name: n, params: [] })));
            }
            // Gerar picker rows
            const pickerRows = Object.entries(groups)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([cat, entries]) => {
                    const catMeta = CAT_META[cat] || CAT_META.outros;
                    const opts = entries
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(
                            (e) =>
                                `<div class="action-option${e.name === config.action ? ' selected' : ''}"
                                  data-value="${_escProp(e.name)}"
                                  data-params="${_escProp(JSON.stringify(e.params || []))}"
                                  title="${_escProp(e.name)}">${_escProp(_toFriendlyName(e.name))}</div>`,
                        )
                        .join('');
                    return `<div class="action-cat-group" data-cat="${_escProp(cat)}">
                        <div class="action-cat-header" style="--cat-color:${catMeta.color}">
                            <span class="action-cat-dot"></span>${_escProp(catMeta.label)}
                        </div>
                        ${opts}
                    </div>`;
                })
                .join('');
            // Hint dos parâmetros esperados
            const actionMeta = ACTION_REGISTRY.find((e) => e.name === config.action);
            const knownParams = actionMeta?.params || [];
            const paramHint = knownParams.length
                ? `Parâmetros: <b>${knownParams.join(', ')}</b>`
                : config.action
                  ? 'Sem parâmetros obrigatórios'
                  : 'Selecione uma ação';
            fields += `
                <div class="props-field">
                    <label class="props-label">Buscar ação</label>
                    <input type="search" class="props-action-search" placeholder="Filtrar..." />
                    <div class="action-picker" data-cfg-key="action" data-action-picker="1">${pickerRows}</div>
                </div>
                <div class="props-field">
                    <span class="props-action-hint">${paramHint}</span>
                </div>
                <div class="props-field">
                    <label class="props-label">Parâmetros</label>
                    ${_renderGuidedParams(config.action, knownParams, config.params || {})}
                </div>`;
            break;
        }

        case 'condition':
            fields += `
                <div class="props-field">
                    <label class="props-label">Sujeito</label>
                    <input class="props-input" data-cfg-key="subject" type="text" value="${_escProp(config.subject || '')}" placeholder="ex: elements.length" />
                </div>
                <div class="props-field">
                    <label class="props-label">Operador</label>
                    <select class="props-input" data-cfg-key="operator">
                        <option value=">=" ${config.operator === '>=' ? 'selected' : ''}>&gt;=</option>
                        <option value=">" ${config.operator === '>' ? 'selected' : ''}>&gt;</option>
                        <option value="==" ${config.operator === '==' ? 'selected' : ''}>=</option>
                        <option value="!=" ${config.operator === '!=' ? 'selected' : ''}>!=</option>
                        <option value="<" ${config.operator === '<' ? 'selected' : ''}>&lt;</option>
                        <option value="<=" ${config.operator === '<=' ? 'selected' : ''}>&lt;=</option>
                    </select>
                </div>
                <div class="props-field">
                    <label class="props-label">Valor</label>
                    <input class="props-input" data-cfg-key="value" type="text" value="${_escProp(String(config.value ?? ''))}" placeholder="ex: 1" />
                </div>`;
            break;

        case 'delay':
            fields += `
                <div class="props-field">
                    <label class="props-label">Delay (ms)</label>
                    <input class="props-input" data-cfg-key="ms" type="number" value="${config.ms || 1000}" min="0" step="100" />
                </div>`;
            break;

        case 'api_call':
            fields += `
                <div class="props-field">
                    <label class="props-label">URL</label>
                    <input class="props-input" data-cfg-key="url" type="text" value="${_escProp(config.url || '')}" placeholder="https://api.exemplo.com/endpoint" />
                </div>
                <div class="props-field">
                    <label class="props-label">Metodo HTTP</label>
                    <select class="props-input" data-cfg-key="method">
                        <option value="GET"    ${(config.method || 'GET') === 'GET' ? 'selected' : ''}>GET — Buscar dados</option>
                        <option value="POST"   ${config.method === 'POST' ? 'selected' : ''}>POST — Enviar dados</option>
                        <option value="PUT"    ${config.method === 'PUT' ? 'selected' : ''}>PUT — Substituir</option>
                        <option value="PATCH"  ${config.method === 'PATCH' ? 'selected' : ''}>PATCH — Atualizar parcial</option>
                        <option value="DELETE" ${config.method === 'DELETE' ? 'selected' : ''}>DELETE — Excluir</option>
                    </select>
                </div>
                <div class="props-field">
                    <label class="props-label">Timeout (ms)</label>
                    <input class="props-input" data-cfg-key="timeoutMs" type="number" value="${config.timeoutMs || 10000}" min="1000" step="1000" />
                </div>
                <div class="props-field">
                    <label class="props-label">Headers</label>
                    ${_renderKvEditor('headers', config.headers || {}, 'Header', 'Valor')}
                </div>
                <div class="props-field">
                    <label class="props-label">Body (pares chave-valor)</label>
                    ${_renderKvEditor('body', typeof config.body === 'object' ? config.body || {} : {}, 'Campo', 'Valor')}
                </div>`;
            break;

        case 'end':
            fields += `<p class="props-note">Evento de fim &#8212; sem configuracao adicional.</p>`;
            break;
    }

    return fields;
}

/**
 * Lê os campos do painel e salva via modeling.
 * @param {Object} element
 * @param {Object} modeling
 * @param {string} nodeType
 * @param {HTMLElement} body
 */
function _savePropFields(element, modeling, nodeType, body) {
    const config = {};
    body.querySelectorAll('[data-cfg-key]').forEach((el) => {
        const key = el.dataset.cfgKey;
        if (key === '__name__') return;
        // action-picker: ler a opção selecionada
        if (el.dataset.actionPicker) {
            const sel = el.querySelector('.action-option.selected');
            config[key] = sel?.dataset.value || '';
            return;
        }
        // kv-editor: serializar pares chave-valor como objeto
        if (el.dataset.kv) {
            config[key] = _readKvEditor(el);
            return;
        }
        let val = el.value;
        if (el.type === 'number') val = parseFloat(val) || 0;
        config[key] = val;
    });

    const nameInput = body.querySelector('[data-cfg-key="__name__"]');
    if (nameInput) {
        try {
            modeling.updateLabel(element, nameInput.value);
        } catch {
            /* ignore */
        }
    }

    _setEcbytsCfg(element, modeling, nodeType, config);
}

/**
 * Escapa atributos HTML para uso em innerHTML do painel de propriedades.
 * @param {string} str
 * @returns {string}
 */
function _escProp(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
