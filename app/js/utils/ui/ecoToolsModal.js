// This file is part of ecbyts/ECBT (Environmental & Occupational Core Byte Tools).
// Copyright (C) 2026 Calvin Stefan Iost
// Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only).
// See LICENSE file or https://www.gnu.org/licenses/agpl-3.0.txt
//
// Module: EcoTools Modal — C1 UI
// Gerenciador de ferramentas customizadas criadas pelo assistente IA

import {
    getEcoTools,
    createEcoTool,
    removeEcoTool,
    updateEcoTool,
    saveEcoToolRecord,
} from '../../core/llm/toolBuilder.js';
import { showToast } from './toast.js';
import { t } from '../i18n/translations.js';

// ================================================================
// STATE
// ================================================================

const _state = {
    activeTool: null, // ID da ferramenta em execução no preview
    sandboxWorker: null, // Worker de sandbox ativo (reservado)
    msgHandler: null, // Listener de postMessage ativo (cleanup no fechar)
};

// ================================================================
// OPEN / CLOSE
// ================================================================

/**
 * Opens the EcoTools manager modal
 * Abre o modal de gerenciamento de EcoTools
 */
export function openEcoToolsModal() {
    const modal = document.getElementById('eco-tools-modal');
    if (!modal) _injectModal();

    if (getEcoTools().length === 0) {
        _seedDefaultTools();
    } else {
        // Migra HTML das seeds sem apagar records de sessões anteriores
        _migrateSeedTools();
    }

    const m = document.getElementById('eco-tools-modal');
    m.style.display = 'flex';
    renderEcoToolsList();

    const onKey = (e) => {
        if (e.key === 'Escape') {
            closeEcoToolsModal();
            document.removeEventListener('keydown', onKey);
        }
    };
    document.addEventListener('keydown', onKey);
}

/**
 * Closes the EcoTools modal
 * Fecha o modal de EcoTools e limpa listeners e worker de sandbox
 */
export function closeEcoToolsModal() {
    const modal = document.getElementById('eco-tools-modal');
    if (modal) modal.style.display = 'none';
    _cleanupMsgHandler();
    _cleanupSandbox();
}

// ================================================================
// MODAL TEMPLATE
// ================================================================

function _injectModal() {
    const div = document.createElement('div');
    div.innerHTML = `
        <div id="eco-tools-modal" class="modal-overlay" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="eco-tools-modal-title">
            <div class="modal-dialog" style="width:820px;max-width:95vw">
                <div class="modal-header">
                    <h3 id="eco-tools-modal-title">
                        <span class="icon" data-icon="tool"></span>
                        EcoTools
                    </h3>
                    <button class="modal-close" onclick="window.closeEcoToolsModal()" aria-label="Fechar">&#x2715;</button>
                </div>
                <div class="modal-body eco-tools-body">
                    <div class="eco-tools-hint">
                        <span class="eco-tools-hint-icon">&#9432;</span>
                        <span>Ferramentas são criadas pelo assistente IA. No chat, peça: <em>Crie uma EcoTool que calcule [...]</em></span>
                    </div>
                    <div id="eco-tools-list-container"></div>
                    <div id="eco-tools-preview-container" style="display:none">
                        <div class="eco-tools-preview-wrap">
                            <div class="eco-tools-preview-header">
                                <span class="eco-tools-preview-title" id="eco-tools-preview-title"></span>
                                <button class="btn btn-secondary btn-xs" onclick="window.handleCloseEcoToolPreview()">Fechar</button>
                            </div>
                            <iframe id="eco-tools-preview-frame" class="eco-tools-preview-frame"></iframe>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(div.firstElementChild);
    if (window.hydrateIcons) window.hydrateIcons(document.getElementById('eco-tools-modal'));
}

// ================================================================
// LIST
// ================================================================

/**
 * Renders the list of available EcoTools
 * Renderiza a lista de EcoTools disponíveis com badge de registros e botão Editar
 */
export function renderEcoToolsList() {
    const container = document.getElementById('eco-tools-list-container');
    if (!container) return;

    const tools = getEcoTools();

    if (tools.length === 0) {
        container.innerHTML = `
            <div class="eco-tools-empty">
                <div class="eco-tools-empty-icon">&#9881;</div>
                <div class="eco-tools-empty-title">Nenhuma EcoTool ainda</div>
                <div class="eco-tools-empty-sub">Use o chat IA para criar ferramentas personalizadas para sua análise.</div>
                <div class="eco-tools-empty-cmd">Crie uma EcoTool que calcule ISQ por poço</div>
            </div>
        `;
        if (window.hydrateIcons) window.hydrateIcons(container);
        return;
    }

    // Detectar porta da API (mesmo host, usa window.location.port — porta 4000 em produção)
    const apiBase =
        window._ecoApiBase ||
        (window.location.port
            ? `${window.location.protocol}//${window.location.hostname}:${window.location.port}`
            : window.location.origin);

    container.innerHTML = `
        <div class="eco-tools-grid">
            ${tools
                .map((tool) => {
                    const recCount = tool.records?.length || 0;
                    const descPreview =
                        _escape(tool.description.substring(0, 120)) + (tool.description.length > 120 ? '...' : '');
                    const apiUrl = `${apiBase}/api/ecotool-records?id=${tool.id}`;
                    return `
                <div class="eco-tool-card" data-id="${tool.id}" data-tool-id="${tool.id}">
                    <div class="eco-tool-card-header">
                        <span class="eco-tool-name">${_escape(tool.name)}</span>
                        <span class="eco-tool-date">${new Date(tool.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div class="eco-tool-description">${descPreview}</div>
                    <div class="eco-tool-meta">
                        <span class="eco-tool-badge">${recCount} registro${recCount === 1 ? '' : 's'}</span>
                        <a class="eco-tool-api-link" href="${_escape(apiUrl)}" target="_blank" title="API de registros desta EcoTool">
                            <span class="icon" data-icon="link"></span> API
                        </a>
                    </div>
                    <div class="eco-tool-actions">
                        <button class="btn btn-secondary btn-xs" onclick="window.handlePreviewEcoTool('${tool.id}')">
                            <span class="icon" data-icon="play"></span> Preview
                        </button>
                        <button class="btn btn-secondary btn-xs" onclick="window.handleOpenEcoToolInTab('${tool.id}')">
                            <span class="icon" data-icon="external-link"></span> Abrir
                        </button>
                        <button class="btn btn-secondary btn-xs" onclick="window.handleEditEcoTool('${tool.id}')">
                            <span class="icon" data-icon="edit-2"></span> Editar
                        </button>
                        <button class="btn btn-danger btn-xs" onclick="window.handleDeleteEcoTool('${tool.id}')">
                            <span class="icon" data-icon="trash-2"></span> Remover
                        </button>
                    </div>
                </div>`;
                })
                .join('')}
        </div>
    `;
    if (window.hydrateIcons) window.hydrateIcons(container);
}

// ================================================================
// PREVIEW — iframe sandbox com bridge postMessage
// ================================================================

/**
 * Opens a sandboxed preview of an EcoTool
 * Abre o preview isolado de uma EcoTool no container do modal
 * @param {string} toolId
 */
export function previewEcoTool(toolId) {
    const tools = getEcoTools();
    const tool = tools.find((t) => t.id === toolId);
    if (!tool) {
        showToast('EcoTool não encontrada', 'error');
        return;
    }

    _state.activeTool = toolId;

    const preview = document.getElementById('eco-tools-preview-container');
    const frame = document.getElementById('eco-tools-preview-frame');
    const title = document.getElementById('eco-tools-preview-title');

    if (!preview || !frame || !title) return;

    // Fechar editor caso esteja aberto
    const editor = document.getElementById('eco-tool-editor');
    if (editor) editor.style.display = 'none';
    frame.style.display = '';

    title.textContent = tool.name;
    preview.style.display = 'block';

    const sandboxHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { font-family: system-ui, sans-serif; padding: 12px; margin: 0; color: #1a202c; }
* { box-sizing: border-box; }
</style>
</head>
<body>
${tool.htmlContent}
</body>
</html>`;

    // F02 — sandbox SEM allow-same-origin: impede frame srcdoc de acessar parent DOM/storage
    // postMessage continua funcionando (origin opaca 'null' para parent)
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.setAttribute('srcdoc', sandboxHtml);
    frame.style.cssText = 'width:100%;height:340px;border:none;border-radius:4px;background:#fff;';
    frame.setAttribute('title', `Preview: ${tool.name}`);

    // Bridge postMessage — captura contentWindow após load para garantir referência correta
    // em iframes sandboxed (origem nula), onde contentWindow pode mudar na navegação
    _cleanupMsgHandler();
    const capturedToolId = toolId;
    frame.onload = () => {
        _cleanupMsgHandler();
        const iframeWin = frame.contentWindow;
        _state.msgHandler = (event) => {
            // Guard primario (unforgeable): referencia de objeto do iframe
            if (event.source !== iframeWin) return;
            // Guard secundario: srcdoc sem allow-same-origin tem origin 'null' (string literal).
            // NOTA: se allow-same-origin for re-adicionado, origin mudaria para 'http://...'
            // e este guard bloquearia mensagens legitimas. Manter allow-same-origin FORA do sandbox.
            if (event.origin !== 'null') return;
            if (event.data?.type !== 'ecobytes-save') return;
            const record = _sanitizeRecord(event.data?.record);
            if (!record) return;
            _handleEcoSave(capturedToolId, record);
        };
        window.addEventListener('message', _state.msgHandler);
    };

    showToast(`Preview: ${tool.name}`, 'info');
}

/**
 * F02 — Sanitiza record recebido via postMessage do iframe sandboxed.
 * Limita a 50 chaves, valores primitivos apenas (string/number/boolean).
 * @param {*} record
 * @returns {Object|null}
 */
function _sanitizeRecord(record) {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) return null;
    const MAX_KEYS = 50;
    const MAX_VALUE_LEN = 1000;
    const keys = Object.keys(record).slice(0, MAX_KEYS);
    const out = {};
    for (const k of keys) {
        const v = record[k];
        if (typeof v === 'string') out[k] = v.slice(0, MAX_VALUE_LEN);
        else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
        // objetos aninhados e arrays: ignorados por seguranca
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Trata o evento de salvar registro vindo do iframe via postMessage
 * Fix #5: atualiza badge cirurgicamente sem re-render da lista
 * @param {string} toolId
 * @param {Object} record
 */
function _handleEcoSave(toolId, record) {
    const saved = saveEcoToolRecord(toolId, record);
    if (!saved) {
        showToast('Erro ao salvar registro.', 'error');
        return;
    }

    const fieldCount = Object.keys(record).length;
    showToast(`Registro salvo no modelo (${fieldCount} campo${fieldCount === 1 ? '' : 's'}).`, 'success');

    // Atualiza só o badge do card específico — sem re-render completo
    const badge = document.querySelector(`[data-tool-id="${toolId}"] .eco-tool-badge`);
    if (badge) {
        const tool = getEcoTools().find((t) => t.id === toolId);
        const count = tool?.records?.length || 0;
        badge.textContent = `${count} registro${count === 1 ? '' : 's'}`;
    }
}

/**
 * Closes the EcoTool preview
 * Fecha o preview da EcoTool e remove listener de postMessage
 */
export function closeEcoToolPreview() {
    _cleanupMsgHandler();

    const preview = document.getElementById('eco-tools-preview-container');
    const frame = document.getElementById('eco-tools-preview-frame');
    const editor = document.getElementById('eco-tool-editor');

    if (frame) {
        frame.removeAttribute('srcdoc');
        frame.removeAttribute('sandbox');
    }
    if (editor) editor.style.display = 'none';
    if (preview) preview.style.display = 'none';

    _state.activeTool = null;
}

// ================================================================
// EDIT — editor inline no container de preview
// ================================================================

/**
 * Abre o editor inline de uma EcoTool no container de preview.
 * Mostra nome, description (prompt) e htmlContent em campos editáveis.
 * @param {string} toolId
 */
export function openEditEcoTool(toolId) {
    const tools = getEcoTools();
    const tool = tools.find((t) => t.id === toolId);
    if (!tool) {
        showToast('EcoTool não encontrada.', 'error');
        return;
    }

    _state.activeTool = toolId;

    const preview = document.getElementById('eco-tools-preview-container');
    const title = document.getElementById('eco-tools-preview-title');
    const frame = document.getElementById('eco-tools-preview-frame');
    if (!preview || !title) return;

    // Esconde iframe, mostra editor
    if (frame) frame.style.display = 'none';

    title.textContent = 'Editar: ' + tool.name;
    preview.style.display = 'block';

    let editor = document.getElementById('eco-tool-editor');
    if (!editor) {
        editor = document.createElement('div');
        editor.id = 'eco-tool-editor';
        preview.querySelector('.eco-tools-preview-wrap').appendChild(editor);
    }

    editor.style.display = 'block';
    editor.innerHTML = `
        <div class="eco-tool-edit-form">
            <div class="eco-tool-edit-row">
                <label for="ete-name">Nome</label>
                <input id="ete-name" type="text" value="${_escape(tool.name)}" maxlength="80">
            </div>
            <div class="eco-tool-edit-row">
                <label for="ete-desc">Prompt / Descri&#231;&#227;o</label>
                <textarea id="ete-desc" rows="4">${_escape(tool.description)}</textarea>
            </div>
            <div class="eco-tool-edit-row">
                <label for="ete-html">HTML / JS</label>
                <textarea id="ete-html" rows="12" style="font-family:monospace;font-size:11px">${_escape(tool.htmlContent)}</textarea>
            </div>
            <div class="eco-tool-edit-actions">
                <button class="btn btn-primary btn-xs"
                    onclick="window.handleSaveEcoTool('${tool.id}')">Salvar</button>
                <button class="btn btn-secondary btn-xs"
                    onclick="window.handleCancelEcoToolEdit()">Cancelar</button>
            </div>
        </div>
    `;
    if (window.hydrateIcons) window.hydrateIcons(editor);
}

/**
 * Salva as edições feitas no editor inline e atualiza a lista.
 * @param {string} toolId
 */
export function saveEditEcoTool(toolId) {
    const name = document.getElementById('ete-name')?.value?.trim();
    const desc = document.getElementById('ete-desc')?.value ?? '';
    const html = document.getElementById('ete-html')?.value ?? '';

    if (!name) {
        showToast('Nome obrigatório.', 'warning');
        return;
    }

    const ok = updateEcoTool(toolId, { name, description: desc, htmlContent: html });
    if (!ok) {
        showToast('Erro ao salvar.', 'error');
        return;
    }

    showToast('EcoTool atualizada.', 'success');
    cancelEditEcoTool();
    renderEcoToolsList();
}

/**
 * Fecha o editor sem salvar e restaura o estado do container de preview.
 */
export function cancelEditEcoTool() {
    const editor = document.getElementById('eco-tool-editor');
    if (editor) editor.style.display = 'none';
    const frame = document.getElementById('eco-tools-preview-frame');
    if (frame) frame.style.display = '';
    const preview = document.getElementById('eco-tools-preview-container');
    if (preview) preview.style.display = 'none';
    _state.activeTool = null;
}

// ================================================================
// DELETE
// ================================================================

/**
 * Deletes an EcoTool after confirmation
 * Remove uma EcoTool com confirmação
 * @param {string} toolId
 */
export function deleteEcoTool(toolId) {
    const tools = getEcoTools();
    const tool = tools.find((t) => t.id === toolId);
    if (!tool) return;

    if (!confirm(`Remover "${tool.name}"? Esta ação não pode ser desfeita.`)) return;

    import('../../core/llm/toolBuilder.js').then(({ removeEcoTool: rm }) => {
        const removed = rm(toolId);
        if (removed) {
            if (_state.activeTool === toolId) closeEcoToolPreview();
            showToast(`EcoTool "${tool.name}" removida.`, 'success');
            renderEcoToolsList();
        }
    });
}

// ================================================================
// DEFAULT TOOLS SEED
// ================================================================

/**
 * Retorna as definições das 3 seeds sem criar EcoTools.
 * Usado por _seedDefaultTools() e _migrateSeedTools().
 * @returns {Array<{name: string, description: string, htmlContent: string}>}
 */
function _buildSeedDefs() {
    return [
        {
            name: 'Calculadora de ISQ',
            description:
                'Prompt: Crie uma EcoTool que calcule o ISQ (Índice de Qualidade Simplificado) de um poço a partir de múltiplos parâmetros e seus valores de referência CETESB.',
            htmlContent: `<style>
body{font-family:system-ui,sans-serif;padding:14px;color:#1a202c;font-size:13px}
h3{margin:0 0 12px;font-size:14px;color:#2d3748}
.row{display:flex;gap:8px;margin-bottom:8px;align-items:center}
label{min-width:140px;font-size:12px;color:#4a5568}
input{flex:1;padding:5px 8px;border:1px solid #cbd5e0;border-radius:4px;font-size:12px}
button{padding:6px 16px;background:#3182ce;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px}
button:hover{background:#2b6cb0}
.result{margin-top:12px;padding:10px;border-radius:6px;font-weight:600;font-size:14px;text-align:center}
.ok{background:#f0fff4;color:#276749;border:1px solid #9ae6b4}
.warn{background:#fffbeb;color:#92400e;border:1px solid #fbd38d}
.fail{background:#fff5f5;color:#9b2c2c;border:1px solid #feb2b2}
</style>
<h3>Calculadora ISQ &#8212; Po&#231;o de Monitoramento</h3>
<div class="row"><label>Concentra&#231;&#227;o (&#956;g/L):</label><input id="c" type="number" placeholder="Ex: 15" step="0.01"></div>
<div class="row"><label>VP CETESB (&#956;g/L):</label><input id="vp" type="number" placeholder="Ex: 300" step="0.01"></div>
<div class="row"><label>VI CETESB (&#956;g/L):</label><input id="vi" type="number" placeholder="Ex: 750" step="0.01"></div>
<button onclick="calc()">Calcular ISQ</button>
<div id="res" class="result" style="display:none"></div>
<script>
function calc(){
  var c=+document.getElementById('c').value,vp=+document.getElementById('vp').value,vi=+document.getElementById('vi').value;
  if(!c||!vp||!vi){_fb('Preencha todos os campos',false);return}
  var isq=Math.max(0,Math.min(100,100*(1-c/vi)));
  var cls=c<=vp?'ok':c<=vi?'warn':'fail';
  var lbl=c<=vp?'Abaixo do VP \u2014 Qualidade satisfat\u00f3ria':c<=vi?'Entre VP e VI \u2014 Requer monitoramento':'Acima do VI \u2014 Remedia\u00e7\u00e3o indicada';
  var d=document.getElementById('res');
  d.style.display='block';d.className='result '+cls;
  d.innerHTML='ISQ = '+isq.toFixed(1)+' &nbsp;|&nbsp; '+lbl;
}
function _fb(msg,ok){
  var d=document.getElementById('res');
  d.style.display='block';d.className='result '+(ok?'ok':'fail');d.textContent=msg;
}
</script>`,
        },
        {
            name: 'Formulário de Coleta de Campo',
            description:
                "Prompt: Crie uma EcoTool de formulário para registro de coleta de campo em poço de monitoramento, com campos para parâmetros físico-químicos, nível d'água e observações, com botões de copiar e salvar no modelo.",
            htmlContent: `<style>
body{font-family:system-ui,sans-serif;padding:14px;color:#1a202c;font-size:12px}
h3{margin:0 0 10px;font-size:13px;color:#2d3748}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}
.field{display:flex;flex-direction:column;gap:2px}
label{font-size:11px;font-weight:600;color:#4a5568;text-transform:uppercase}
input,textarea,select{padding:5px 7px;border:1px solid #cbd5e0;border-radius:4px;font-size:12px}
textarea{resize:vertical}
.full{grid-column:1/-1}
.actions{margin-top:10px;display:flex;gap:8px}
button{padding:5px 12px;border:none;border-radius:4px;cursor:pointer;font-size:12px}
.copy{background:#3182ce;color:#fff}.copy:hover{background:#2b6cb0}
.save{background:#276749;color:#fff}.save:hover{background:#22543d}
.clear{background:#e2e8f0;color:#4a5568}.clear:hover{background:#cbd5e0}
#feedback{display:none;padding:8px;margin-top:8px;border-radius:4px;font-size:12px;text-align:center}
</style>
<h3>Registro de Coleta &#8212; Campo</h3>
<div class="grid">
  <div class="field"><label>Data</label><input id="f_data" type="date"></div>
  <div class="field"><label>Po&#231;o / Elem.</label><input id="f_poco" type="text" placeholder="PM-01"></div>
  <div class="field"><label>pH</label><input id="f_ph" type="number" step="0.01" placeholder="7.0"></div>
  <div class="field"><label>Condutividade (&#956;S/cm)</label><input id="f_cond" type="number" step="0.1" placeholder="150"></div>
  <div class="field"><label>OD (mg/L)</label><input id="f_od" type="number" step="0.01" placeholder="5.2"></div>
  <div class="field"><label>Eh (mV)</label><input id="f_eh" type="number" step="1" placeholder="120"></div>
  <div class="field"><label>N&#237;vel est&#225;tico (m)</label><input id="f_ne" type="number" step="0.01" placeholder="2.40"></div>
  <div class="field"><label>Turbidez (NTU)</label><input id="f_turb" type="number" step="0.1" placeholder="5"></div>
  <div class="field full"><label>Observa&#231;&#245;es</label><textarea id="f_obs" rows="2" placeholder="Condi&#231;&#245;es da tampa, cor da &#225;gua, odor..."></textarea></div>
</div>
<div class="actions">
  <button class="copy" onclick="copiar()">Copiar dados</button>
  <button class="save" onclick="salvar()">Salvar no Modelo</button>
  <button class="clear" onclick="limpar()">Limpar</button>
</div>
<div id="feedback"></div>
<script>
var CAMPOS={date:'f_data',poco:'f_poco',ph:'f_ph',cond:'f_cond',od:'f_od',eh:'f_eh',ne:'f_ne',turb:'f_turb',obs:'f_obs'};
function _showFeedback(msg,ok){
  var el=document.getElementById('feedback');
  el.textContent=msg;el.style.display='block';
  el.style.background=ok?'#c6f6d5':'#fed7d7';
  el.style.color=ok?'#22543d':'#9b2c2c';
  setTimeout(function(){el.style.display='none'},3000);
}
function _vals(){
  var r={};
  Object.keys(CAMPOS).forEach(function(k){
    var v=(document.getElementById(CAMPOS[k])||{}).value;
    if(v)r[k]=v;
  });
  return r;
}
function copiar(){
  var labels={date:'Data',poco:'Po\u00e7o',ph:'pH',cond:'Condutividade',od:'OD',eh:'Eh',ne:'NE',turb:'Turbidez',obs:'Obs'};
  var v=_vals();
  var txt=Object.keys(v).map(function(k){return labels[k]+': '+v[k]}).join('\\n');
  navigator.clipboard.writeText(txt)
    .then(function(){_showFeedback('Copiado!',true)})
    .catch(function(){_showFeedback('Erro ao copiar.',false)});
}
function salvar(){
  var record=_vals();
  if(Object.keys(record).length===0){_showFeedback('Preencha ao menos um campo.',false);return;}
  window.parent.postMessage({type:'ecobytes-save',record:record},'*');
  _showFeedback('Enviando...',true);
}
function limpar(){document.querySelectorAll('input,textarea').forEach(function(el){el.value=''})}
</script>`,
        },
        {
            name: 'Conformidade CONAMA 420',
            description:
                'Prompt: Crie uma EcoTool que compare concentrações medidas com os valores de referência CONAMA 420 (VP e VI para solo residencial) e mostre um semáforo de conformidade por parâmetro.',
            htmlContent: `<style>
body{font-family:system-ui,sans-serif;padding:14px;color:#1a202c;font-size:12px}
h3{margin:0 0 10px;font-size:13px;color:#2d3748}
table{width:100%;border-collapse:collapse}
th{background:#edf2f7;padding:6px 8px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;color:#4a5568}
td{padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:12px}
input{width:90%;padding:3px 5px;border:1px solid #cbd5e0;border-radius:3px;font-size:12px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700}
.ok{background:#f0fff4;color:#276749}.warn{background:#fffbeb;color:#b7791f}.fail{background:#fff5f5;color:#9b2c2c}.nd{background:#f7fafc;color:#718096}
button{margin-top:10px;padding:5px 14px;background:#3182ce;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px}
</style>
<h3>Conformidade CONAMA 420 &#8212; Solo Residencial</h3>
<table>
<tr><th>Par&#226;metro</th><th>Medido (mg/kg)</th><th>VP</th><th>VI Res.</th><th>Status</th></tr>
<tr><td>Benzeno</td><td><input id="b1" type="number" step="0.001" placeholder="&#8212;" onchange="upd(0)"></td><td>0.08</td><td>0.08</td><td id="s1"><span class="badge nd">&#8212;</span></td></tr>
<tr><td>Tolueno</td><td><input id="b2" type="number" step="0.01" placeholder="&#8212;" onchange="upd(1)"></td><td>0.03</td><td>0.03</td><td id="s2"><span class="badge nd">&#8212;</span></td></tr>
<tr><td>Chumbo</td><td><input id="b3" type="number" step="0.1" placeholder="&#8212;" onchange="upd(2)"></td><td>72</td><td>180</td><td id="s3"><span class="badge nd">&#8212;</span></td></tr>
<tr><td>C&#225;dmio</td><td><input id="b4" type="number" step="0.01" placeholder="&#8212;" onchange="upd(3)"></td><td>1.3</td><td>3</td><td id="s4"><span class="badge nd">&#8212;</span></td></tr>
<tr><td>Ars&#234;nio</td><td><input id="b5" type="number" step="0.1" placeholder="&#8212;" onchange="upd(4)"></td><td>15</td><td>35</td><td id="s5"><span class="badge nd">&#8212;</span></td></tr>
</table>
<button onclick="avaliar()">Avaliar todos</button>
<script>
var VP=[0.08,0.03,72,1.3,15],VI=[0.08,0.03,180,3,35];
function upd(i){
  var v=+document.getElementById('b'+(i+1)).value;
  var s=document.getElementById('s'+(i+1));
  if(!v){s.innerHTML='<span class="badge nd">&#8212;</span>';return}
  var cls=v<=VP[i]?'ok':v<=VI[i]?'warn':'fail';
  var lbl=v<=VP[i]?'OK':v<=VI[i]?'VP &lt; c &le; VI':'EXCEDE VI';
  s.innerHTML='<span class="badge '+cls+'">'+lbl+'</span>';
}
function avaliar(){for(var i=0;i<5;i++)upd(i)}
</script>`,
        },
    ];
}

/**
 * Popula 3 ferramentas de exemplo na primeira abertura do modal
 */
function _seedDefaultTools() {
    _buildSeedDefs().forEach((def) => {
        createEcoTool(def.name, def.description, def.htmlContent);
    });
}

/**
 * Atualiza o htmlContent das seeds padrão preservando records existentes.
 * Identifica seeds pelo nome exato — não toca ferramentas customizadas do usuário.
 */
function _migrateSeedTools() {
    const seeds = _buildSeedDefs();
    const tools = getEcoTools();
    seeds.forEach((seed) => {
        const existing = tools.find((t) => t.name === seed.name);
        if (existing && existing.htmlContent !== seed.htmlContent) {
            updateEcoTool(existing.id, { htmlContent: seed.htmlContent });
        }
    });
}

// ================================================================
// OPEN IN NEW TAB
// ================================================================

/**
 * Abre uma EcoTool em uma aba própria do browser via Blob URL.
 * Na aba, window.parent === window, então postMessage não salva no modelo —
 * o usuário vê e interage com a ferramenta de forma standalone.
 * @param {string} toolId
 */
export function openEcoToolInTab(toolId) {
    const tool = getEcoTools().find((t) => t.id === toolId);
    if (!tool) {
        showToast('EcoTool não encontrada.', 'error');
        return;
    }

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${tool.name.replace(/</g, '&lt;')}</title>
<style>
body { font-family: system-ui, sans-serif; padding: 20px; margin: 0; color: #1a202c; max-width: 800px; }
* { box-sizing: border-box; }
</style>
</head>
<body>
${tool.htmlContent}
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const tab = window.open(url, '_blank');
    if (!tab) {
        showToast('Popup bloqueado. Permita pop-ups para este site.', 'warning');
    }
    // Revogar URL após 30s — tempo suficiente para o tab carregar
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ================================================================
// HELPERS
// ================================================================

function _escape(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _cleanupMsgHandler() {
    if (_state.msgHandler) {
        window.removeEventListener('message', _state.msgHandler);
        _state.msgHandler = null;
    }
}

function _cleanupSandbox() {
    if (_state.sandboxWorker) {
        _state.sandboxWorker.terminate();
        _state.sandboxWorker = null;
    }
    _state.activeTool = null;
}
