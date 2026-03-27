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
   LLM CHAT HANDLERS — AI assistant chat interface
   Handlers para o chat do assistente de inteligencia artificial

   O assistente IA entende comandos em linguagem natural:
   "adicionar benzeno 10 mg/L no ponto 1 campanha 2"
   Ele interpreta o comando, pede confirmacao e executa a acao.
   ================================================================ */

import {
    processCommand,
    confirmAction,
    cancelAction,
    setPendingAction,
    hasApiKey,
    setApiKey,
    getApiKey,
    setProvider,
    getProvider,
    setModel,
    getModel,
    testConnection,
} from '../../core/llm/index.js';
import {
    getProviderConfig,
    getProviderModels,
    getApiKeyUrl,
    fetchProviderModels,
    setProviderModels,
} from '../../core/llm/providers.js';
import {
    CHAT_TOOLS,
    toggleTool,
    isToolActive,
    getToolById,
    getActiveTools,
    getAllTools,
    addUserTool,
    updateUserTool,
    removeUserTool,
    getUserTools,
} from '../../core/llm/chatTools.js';
import {
    EngineType,
    getEngine,
    setEngine,
    getEngineDisplayName,
    getEngineConfig,
    validateEngineConfig,
    getBrowserModel,
    setBrowserModel,
    getWebLlmModel,
    setWebLlmModel,
    getLocalUrl,
    setLocalUrl,
    getLocalModel,
    setLocalModel,
    routeMessageStream,
} from '../../core/llm/router.js';
import {
    loadBrowserModel,
    getBrowserModels,
    getBrowserModelStatus,
    isBrowserEngineAvailable,
} from '../../core/llm/browserEngine.js';
import {
    loadWebLlmModel,
    getWebLlmModels,
    getWebLlmModelStatus,
    isWebLlmAvailable,
} from '../../core/llm/webllmEngine.js';
import { testLocalConnection, fetchLocalModels } from '../../core/llm/localEngine.js';
import { saveKeyToSupabase } from '../../core/llm/client.js';
import { getCurrentUser, getSupabaseClient } from '../auth/session.js';
import { runBenchmark } from '../../core/llm/benchmark.js';
import { buildSystemPrompt, formatUserMessage } from '../../core/llm/promptBuilder.js';
import { parseResponse, validateActionParams } from '../../core/llm/parser.js';
import { openModal, closeModal } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { getElementById } from '../../core/elements/manager.js';
import { hydrateIcons } from '../ui/icons.js';
import { addFloatingResizeHandles } from '../ui/resizeHandles.js';
import { escapeHtml } from '../helpers/html.js';
import { safeSetItem } from '../storage/storageMonitor.js';

// updateAllUI sera injetada pelo main.js
let _updateAllUI = null;

// Cleanup de resize do chat panel
let _chatResizeCleanup = null;

// Toggle para chat contextual — quando ativo, ao selecionar um
// elemento o LLM recebe o contexto dele e fica pronto para conversar.
let _contextualChatEnabled = false;

/**
 * Set the updateAllUI callback.
 * Define a funcao que atualiza toda a interface.
 *
 * @param {Function} fn - The updateAllUI function
 */
export function setUpdateAllUI(fn) {
    _updateAllUI = fn;
}

// ----------------------------------------------------------------
// CHAT PANEL CONTROLS
// Abrir, fechar e configurar o painel de chat.
// ----------------------------------------------------------------

/**
 * Toggle AI widget between FAB (collapsed) and expanded chat panel.
 * Alterna entre o estado minimizado (bolha FAB) e expandido (janela de chat).
 */
export function toggleAIWidget() {
    const panel = document.getElementById('llm-chat-panel');
    const fab = document.getElementById('ai-widget-fab');
    if (!panel) return;

    const isOpen = panel.classList.contains('open');

    if (isOpen) {
        // Collapse to FAB
        panel.classList.remove('open');
        if (fab) fab.classList.remove('hidden');
        // Reset posicao para padrao (bottom-right CSS)
        panel.style.left = '';
        panel.style.right = '';
        panel.style.bottom = '';
    } else {
        // Expand from FAB
        panel.classList.add('open');
        if (fab) fab.classList.add('hidden');
        document.getElementById('llm-input')?.focus();
        updateEngineBadge();
        initAIWidgetDrag();
        initAIWidgetResize();

        // Restaurar dimensoes salvas do chat
        restoreChatDimensions(panel);

        // Verifica configuracao — browser engine nao precisa de API key
        const validation = validateEngineConfig();
        if (!validation.valid) openLLMConfig();
    }
    // Sincronizar estado do toggle no ribbon
    if (window._updateRibbonToggleState) window._updateRibbonToggleState();
}

/**
 * Open the AI chat panel.
 * Abre o painel de chat do assistente IA (wrapper para backward-compat).
 */
export function openLLMChat() {
    const panel = document.getElementById('llm-chat-panel');
    if (panel && !panel.classList.contains('open')) toggleAIWidget();
}

/**
 * Close the AI chat panel.
 * Fecha o painel de chat do assistente IA (wrapper para backward-compat).
 */
export function closeLLMChat() {
    const panel = document.getElementById('llm-chat-panel');
    if (panel && panel.classList.contains('open')) toggleAIWidget();
}

/**
 * Open the AI configuration modal.
 * Abre o modal para configurar provedor, modelo e chave de API.
 * Preenche os campos com as configuracoes atuais.
 */
export function openLLMConfig() {
    // Seleciona engine card ativo
    const currentEngine = getEngine();
    selectEngine(currentEngine);

    // Cloud config — preenche campos existentes
    const providerSelect = document.getElementById('llm-provider');
    const currentProvider = getProvider();
    if (providerSelect) providerSelect.value = currentProvider;
    updateModelDropdown(currentProvider);
    const modelSelect = document.getElementById('llm-model');
    if (modelSelect) modelSelect.value = getModel();
    const keyInput = document.getElementById('llm-api-key');
    if (keyInput) keyInput.value = getApiKey() || '';
    updateApiKeyLink(currentProvider);
    const testStatus = document.getElementById('llm-test-status');
    if (testStatus) testStatus.textContent = '';

    // Browser config — preenche modelos e config atual
    populateBrowserModels();
    const browserModelSelect = document.getElementById('browser-model');
    if (browserModelSelect) browserModelSelect.value = getBrowserModel();

    // Web-LLM config — preenche modelos e status GPU
    populateWebLlmModels();
    const webllmModelSelect = document.getElementById('webllm-model');
    if (webllmModelSelect) webllmModelSelect.value = getWebLlmModel();

    // Local config — preenche campos
    const localUrlInput = document.getElementById('local-server-url');
    if (localUrlInput) localUrlInput.value = getLocalUrl();
    const localModelInput = document.getElementById('local-model-name');
    if (localModelInput) localModelInput.value = getLocalModel();
    const localTestStatus = document.getElementById('local-test-status');
    if (localTestStatus) localTestStatus.textContent = '';

    openModal('llm-config-modal');

    // Roda benchmark se browser engine selecionada
    if (currentEngine === EngineType.BROWSER) {
        runAndDisplayBenchmark();
    }
    // Mostra status GPU se web-llm selecionada
    if (currentEngine === EngineType.WEB_LLM) {
        displayWebLlmGpuStatus();
    }
}

/**
 * Handle provider selection change.
 * Quando o usuario muda o provedor, atualiza modelos e link da API key.
 */
export function handleProviderChange() {
    const providerSelect = document.getElementById('llm-provider');
    if (!providerSelect) return;

    const providerId = providerSelect.value;
    updateModelDropdown(providerId);
    updateApiKeyLink(providerId);

    // Update placeholder hint for API key
    const config = getProviderConfig(providerId);
    const keyInput = document.getElementById('llm-api-key');
    if (keyInput && config) {
        keyInput.placeholder = config.keyHint || 'Enter your API key';
    }
}

/**
 * Test connection to the selected LLM provider.
 * Testa a conexao com o provedor selecionado.
 */
export async function testLLMConnection() {
    const testStatus = document.getElementById('llm-test-status');
    const testBtn = document.getElementById('llm-test-btn');

    // Temporarily save config for test
    const key = document.getElementById('llm-api-key')?.value?.trim();
    const provider = document.getElementById('llm-provider')?.value;
    const model = document.getElementById('llm-model')?.value;

    if (!key) {
        if (testStatus) testStatus.textContent = t('apiKeyRequired') || 'API key required';
        return;
    }

    // Save temporarily
    setProvider(provider);
    setApiKey(key);
    if (model) setModel(model);

    if (testStatus) testStatus.textContent = '...';
    if (testBtn) testBtn.disabled = true;

    try {
        const result = await testConnection();
        if (testStatus) {
            testStatus.textContent = result.success
                ? t('connectionSuccess') || 'Connected!'
                : (t('connectionFailed') || 'Failed: ') + result.message;
            testStatus.className = result.success ? 'test-success' : 'test-error';
        }
    } catch (e) {
        if (testStatus) {
            testStatus.textContent = (t('connectionFailed') || 'Failed: ') + e.message;
            testStatus.className = 'test-error';
        }
    } finally {
        if (testBtn) testBtn.disabled = false;
    }
}

/**
 * Fetch available models from the provider's API.
 * Busca modelos disponiveis direto da API do provedor.
 */
export async function refreshLLMModels() {
    const key = document.getElementById('llm-api-key')?.value?.trim();
    const providerId = document.getElementById('llm-provider')?.value;
    const hint = document.getElementById('llm-model-hint');
    const refreshBtn = document.getElementById('llm-refresh-models-btn');

    if (!key) {
        if (hint) hint.textContent = t('apiKeyRequired') || 'Enter API key first';
        return;
    }

    if (hint) hint.textContent = '...';
    if (refreshBtn) refreshBtn.disabled = true;

    try {
        const models = await fetchProviderModels(providerId, key);

        if (models.length === 0) {
            if (hint) hint.textContent = 'No models found';
            return;
        }

        // Update provider's model list in registry
        setProviderModels(providerId, models);

        // Re-render dropdown
        updateModelDropdown(providerId);

        if (hint) hint.textContent = `${models.length} ${t('modelsFound') || 'models found'}`;
    } catch (e) {
        if (hint) hint.textContent = `Error: ${e.message}`;
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

/**
 * Save AI configuration (provider, model, and API key).
 * Salva as configuracoes do assistente IA.
 * A chave e armazenada apenas na sessao do navegador.
 */
export function saveLLMConfig() {
    const engine = getEngine();

    switch (engine) {
        case EngineType.CLOUD: {
            const key = document.getElementById('llm-api-key')?.value?.trim();
            if (!key) {
                showToast(t('apiKeyRequired') || 'API key required', 'error');
                return;
            }
            const provider = document.getElementById('llm-provider')?.value;
            setProvider(provider);
            setApiKey(key);
            const model = document.getElementById('llm-model')?.value;
            if (model) setModel(model);
            // Persiste no Supabase se usuario estiver logado (fire-and-forget)
            const sessionUser = getCurrentUser();
            const supabase = getSupabaseClient();
            if (sessionUser?.id && supabase) {
                saveKeyToSupabase(supabase, sessionUser.id, provider, key, model || null)
                    .then(() => {
                        const hint = document.getElementById('llm-key-hint');
                        if (hint) hint.textContent = t('apiKeyHintSaved') || 'Key saved to your account';
                    })
                    .catch((err) => console.warn('[ecbyts] LLM key sync failed:', err.message));
            }
            break;
        }
        case EngineType.BROWSER: {
            const model = document.getElementById('browser-model')?.value;
            if (model) setBrowserModel(model);
            break;
        }
        case EngineType.WEB_LLM: {
            const model = document.getElementById('webllm-model')?.value;
            if (model) setWebLlmModel(model);
            break;
        }
        case EngineType.LOCAL: {
            const url = document.getElementById('local-server-url')?.value?.trim();
            const model = document.getElementById('local-model-name')?.value?.trim();
            if (!model) {
                showToast(t('modelLoadError') || 'Enter a model name', 'error');
                return;
            }
            if (url) setLocalUrl(url);
            setLocalModel(model);
            break;
        }
    }

    updateEngineBadge();
    showToast(t('saved') || 'Saved!', 'success');
    closeModal('llm-config-modal');
}

// ----------------------------------------------------------------
// CONFIG UI HELPERS
// Funcoes auxiliares para o modal de configuracao.
// ----------------------------------------------------------------

/**
 * Update model dropdown options for a given provider.
 * Atualiza as opcoes do dropdown de modelo para um provedor.
 *
 * @param {string} providerId - Provider identifier
 */
function updateModelDropdown(providerId) {
    const modelSelect = document.getElementById('llm-model');
    if (!modelSelect) return;

    const models = getProviderModels(providerId);
    modelSelect.innerHTML = models.map((m) => `<option value="${m.id}">${m.name}</option>`).join('');

    // Select default model
    const config = getProviderConfig(providerId);
    if (config) modelSelect.value = config.defaultModel;
}

/**
 * Update the "Get API key" link for a given provider.
 * Atualiza o link "Obter chave" para um provedor.
 *
 * @param {string} providerId - Provider identifier
 */
function updateApiKeyLink(providerId) {
    const link = document.getElementById('llm-api-key-link');
    if (!link) return;

    const url = getApiKeyUrl(providerId);
    const config = getProviderConfig(providerId);
    link.href = url;
    link.textContent = `${t('getApiKey') || 'Get API key'} → ${config?.name || providerId}`;
}

// ----------------------------------------------------------------
// MESSAGE HANDLING
// Enviar mensagens e processar respostas do assistente.
// ----------------------------------------------------------------

/**
 * Send a message to the AI assistant.
 * Envia uma mensagem de texto para o assistente IA.
 * O assistente interpreta o comando e sugere uma acao.
 *
 * @param {string} [messageText] - Texto opcional (via API). Se omitido, le do input DOM.
 */
export async function sendLLMMessage(messageText) {
    const input = document.getElementById('llm-input');
    const container = document.getElementById('llm-messages');
    if (!container) return;

    const msg = messageText || (input ? input.value.trim() : '');
    if (!msg) return;
    if (input) input.value = '';

    // Verifica configuracao da engine ativa
    const validation = validateEngineConfig();
    if (!validation.valid) {
        addMessage(validation.message, 'error');
        openLLMConfig();
        return;
    }

    addMessage(msg, 'user');

    const engine = getEngine();

    // Streaming para browser e local engines
    if (engine === EngineType.BROWSER || engine === EngineType.LOCAL) {
        await sendLLMMessageStreaming(msg, container);
    } else {
        // Cloud engine — usa pipeline sincrona existente
        const typingId = showTypingIndicator();
        try {
            const result = await processCommand(msg);
            removeTypingIndicator(typingId);

            if (result.needsConfig) {
                addMessage(result.message, 'error');
                openLLMConfig();
                return;
            }
            if (!result.success) {
                addMessage(result.message, 'error');
                return;
            }
            if (!result.understood) {
                addMessage(result.message, 'assistant');
                return;
            }
            if (result.needsConfirmation) {
                addConfirmationMessage(result.confirmation);
            }
        } catch (e) {
            removeTypingIndicator(typingId);
            addMessage(e.message, 'error');
        }
    }
}

/**
 * Send message with streaming support.
 * Cria div de mensagem e faz append token-by-token para browser/local engines.
 * Apos stream completo, faz parse da resposta acumulada pelo pipeline existente.
 *
 * @param {string} msg - User message
 * @param {HTMLElement} container - Messages container
 */
async function sendLLMMessageStreaming(msg, container) {
    // Mostra progress bar indeterminate
    showProgressBar(true);

    // Cria div de streaming
    const streamDiv = document.createElement('div');
    streamDiv.className = 'llm-message assistant streaming';
    container.appendChild(streamDiv);

    let fullContent = '';

    try {
        const systemPrompt = buildSystemPrompt();
        const userMessage = formatUserMessage(msg);

        for await (const token of routeMessageStream(systemPrompt, userMessage)) {
            fullContent += token;
            streamDiv.textContent = fullContent;
            container.scrollTop = container.scrollHeight;
            // Esconde progress bar apos primeiro token
            hideProgressBar();
        }

        streamDiv.classList.remove('streaming');

        // Parse da resposta acumulada usando pipeline existente
        const parsed = parseResponse(fullContent);

        if (!parsed.success) {
            if (parsed.data?.confirmation) {
                streamDiv.textContent = parsed.data.confirmation;
            }
            return;
        }

        const data = parsed.data;

        if (!data.understood) {
            // Mensagem ja esta no streamDiv — apenas garante que esta correto
            if (data.confirmation && data.confirmation !== fullContent) {
                streamDiv.textContent = data.confirmation;
            }
            return;
        }

        // Acao entendida — valida e mostra confirmacao
        const validationResult = validateActionParams(data.action, data.params);
        if (!validationResult.valid) {
            streamDiv.textContent = data.confirmation || validationResult.errors.join('; ');
            return;
        }

        // Armazena acao pendente para confirmacao
        setPendingAction({
            action: data.action,
            params: validationResult.resolvedParams,
            confirmation: data.confirmation,
        });

        // Remove streaming div e mostra confirmacao com botoes
        streamDiv.remove();
        addConfirmationMessage(data.confirmation);
    } catch (e) {
        streamDiv.remove();
        hideProgressBar();
        addMessage(e.message, 'error');
    }
}

/**
 * Confirm a pending AI action.
 * Confirma a acao sugerida pelo assistente IA.
 * Ex: "Sim, adicionar benzeno 10 mg/L ao poco PM-01".
 */
export async function confirmLLMAction() {
    const typingId = showTypingIndicator();
    try {
        const result = await confirmAction();
        removeTypingIndicator(typingId);
        addMessage(result.message, result.success ? 'success' : 'error');
        if (result.success && _updateAllUI) _updateAllUI();
    } catch (e) {
        removeTypingIndicator(typingId);
        addMessage(e.message, 'error');
    }
    // Remove os botoes de confirmacao
    document.getElementById('llm-confirm-msg')?.querySelector('.llm-message-actions')?.remove();
}

/**
 * Cancel a pending AI action.
 * Cancela a acao sugerida pelo assistente IA.
 */
export function cancelLLMAction() {
    cancelAction();
    addMessage(t('actionCanceled') || 'Canceled', 'assistant');
    document.getElementById('llm-confirm-msg')?.querySelector('.llm-message-actions')?.remove();
}

// ----------------------------------------------------------------
// UI HELPERS
// Funcoes auxiliares para o chat (mensagens, indicador de digitacao).
// ----------------------------------------------------------------

/**
 * Add a message to the chat.
 * Adiciona uma mensagem ao historico do chat.
 *
 * @param {string} content - Message text
 * @param {string} type - Message type ('user', 'assistant', 'error', 'success')
 */
function addMessage(content, type) {
    const container = document.getElementById('llm-messages');
    if (!container) return;

    const div = document.createElement('div');
    div.className = `llm-message ${type}`;
    div.textContent = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

/**
 * Add a confirmation message with action buttons.
 * Adiciona uma mensagem de confirmacao com botoes Sim/Nao.
 *
 * @param {string} content - Confirmation text
 */
function addConfirmationMessage(content) {
    const container = document.getElementById('llm-messages');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'llm-message confirmation';
    div.id = 'llm-confirm-msg';
    div.innerHTML = `<div>${escapeHtml(content)}</div><div class="llm-message-actions"><button class="btn btn-primary" onclick="window.confirmLLMAction()">${t('confirmYes') || 'Yes'}</button><button class="btn btn-secondary" onclick="window.cancelLLMAction()">${t('confirmNo') || 'No'}</button></div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

/**
 * Show typing animation.
 * Mostra animacao de "digitando..." no chat.
 *
 * @returns {string} Typing indicator element ID
 */
function showTypingIndicator() {
    const container = document.getElementById('llm-messages');
    if (!container) return null;

    const id = 'typing-' + Date.now();
    const div = document.createElement('div');
    div.className = 'llm-typing';
    div.id = id;
    div.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
}

/**
 * Remove typing animation.
 * Remove a animacao de "digitando..." do chat.
 *
 * @param {string} id - Typing indicator element ID
 */
function removeTypingIndicator(id) {
    if (id) document.getElementById(id)?.remove();
}

// ----------------------------------------------------------------
// CHAT TOOLS — Ferramentas ativaveis no painel de chat
// Padrao inspirado no Gemini "Ferramentas"
// ----------------------------------------------------------------

/**
 * Toggle the tools dropdown menu.
 * Abre/fecha o menu de ferramentas do chat.
 */
export function toggleChatToolsMenu() {
    const dropdown = document.getElementById('llm-tools-dropdown');
    if (!dropdown) return;

    const isOpen = dropdown.style.display !== 'none';

    // Renderiza dinamicamente ao abrir (inclui ferramentas do usuario)
    if (!isOpen) renderToolsDropdown();

    dropdown.style.display = isOpen ? 'none' : 'flex';

    // Close on click outside
    if (!isOpen) {
        setTimeout(() => {
            const close = (e) => {
                if (!dropdown.contains(e.target) && !e.target.closest('.llm-tools-btn')) {
                    dropdown.style.display = 'none';
                    document.removeEventListener('click', close);
                }
            };
            document.addEventListener('click', close);
        }, 0);
    }
}

/**
 * Toggle a chat tool on/off and update UI.
 * Liga/desliga uma ferramenta e atualiza chips e checkmarks.
 *
 * @param {string} toolId - Tool identifier (trends, sampling, audit)
 */
export function handleToggleChatTool(toolId) {
    const nowActive = toggleTool(toolId);
    updateToolCheckmark(toolId, nowActive);
    renderToolChips();
}

/**
 * Update checkmark icon for a tool option.
 * @param {string} toolId
 * @param {boolean} active
 */
function updateToolCheckmark(toolId, active) {
    const check = document.getElementById(`llm-tool-check-${toolId}`);
    if (check) {
        check.textContent = active ? '\u2713' : '';
        check.classList.toggle('active', active);
    }
}

/**
 * Render active tool chips in the tools bar.
 * Mostra os chips das ferramentas ativas abaixo do input.
 * Inclui ferramentas built-in E customizadas do usuario.
 */
function renderToolChips() {
    const container = document.getElementById('llm-tools-chips');
    if (!container) return;

    container.innerHTML = '';
    for (const tool of getAllTools()) {
        if (!isToolActive(tool.id)) continue;

        const label = tool.isUserTool ? tool.name : t(tool.nameKey) || tool.nameKey;

        const chip = document.createElement('span');
        chip.className = 'llm-tool-chip';

        // Ferramentas com upload (Smart Import) mostram botao de envio de arquivo
        const safeLabel = escapeHtml(label);
        if (tool.hasUpload) {
            chip.innerHTML = `<span class="icon" data-icon="${tool.icon}"></span> ${safeLabel} <button class="llm-tool-chip-upload" onclick="event.stopPropagation(); window.openSmartImportModal()" title="${t('uploadFile') || 'Upload file'}"><span class="icon" data-icon="upload"></span></button> <button class="llm-tool-chip-remove" onclick="window.handleToggleChatTool('${tool.id}')">\u00d7</button>`;
        } else {
            chip.innerHTML = `<span class="icon" data-icon="${tool.icon}"></span> ${safeLabel} <button class="llm-tool-chip-remove" onclick="window.handleToggleChatTool('${tool.id}')">\u00d7</button>`;
        }
        container.appendChild(chip);
    }
    hydrateIcons(container);
}

/**
 * Dynamically render the full tools dropdown (built-in + user).
 * Renderiza o dropdown completo de ferramentas dinamicamente.
 * Chamada ao abrir o menu ou apos CRUD de ferramenta customizada.
 */
export function renderToolsDropdown() {
    const dropdown = document.getElementById('llm-tools-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '';
    const tools = getAllTools();

    let addedUserSeparator = false;

    for (const tool of tools) {
        // Adiciona separador visual antes das ferramentas do usuario
        if (tool.isUserTool && !addedUserSeparator) {
            const sep = document.createElement('div');
            sep.className = 'llm-tool-separator';
            sep.innerHTML = `<span>${t('custom') || 'Custom'}</span>`;
            dropdown.appendChild(sep);
            addedUserSeparator = true;
        }

        const label = tool.isUserTool ? tool.name : t(tool.nameKey) || tool.nameKey;
        const desc = tool.isUserTool ? tool.description || '' : t(tool.descKey) || tool.descKey;

        const div = document.createElement('div');
        div.className = 'llm-tool-option';
        div.onclick = () => handleToggleChatTool(tool.id);
        div.innerHTML = `
            <span class="icon" data-icon="${tool.icon}"></span>
            <div class="llm-tool-info">
                <span class="llm-tool-name">${label}</span>
                <small class="llm-tool-desc">${desc}</small>
            </div>
            <span class="llm-tool-check ${isToolActive(tool.id) ? 'active' : ''}" id="llm-tool-check-${tool.id}">${isToolActive(tool.id) ? '\u2713' : ''}</span>
            ${tool.isUserTool ? `<button class="llm-tool-edit-btn" onclick="event.stopPropagation(); window.handleEditCustomTool('${tool.id}')" title="Edit">✎</button>` : ''}
        `;
        dropdown.appendChild(div);
    }

    // Botao "+ Criar Ferramenta"
    const createBtn = document.createElement('div');
    createBtn.className = 'llm-tool-option llm-tool-create';
    createBtn.onclick = () => handleCreateCustomTool();
    createBtn.innerHTML = `
        <span class="icon" data-icon="plus"></span>
        <div class="llm-tool-info">
            <span class="llm-tool-name">${t('createTool') || 'Create Tool'}</span>
            <small class="llm-tool-desc">${t('createToolDesc') || 'Create a custom prompt-based tool'}</small>
        </div>
    `;
    dropdown.appendChild(createBtn);
    hydrateIcons(dropdown);
}

// ----------------------------------------------------------------
// USER CUSTOM TOOLS CRUD — Criar, editar, remover ferramentas
// ----------------------------------------------------------------

/**
 * Open the custom tool creation form.
 * Abre formulario inline para criar nova ferramenta customizada.
 */
export function handleCreateCustomTool() {
    openModal('custom-tool-modal');
    // Limpa campos
    const nameInput = document.getElementById('custom-tool-name');
    const descInput = document.getElementById('custom-tool-desc');
    const promptInput = document.getElementById('custom-tool-prompt');
    const idInput = document.getElementById('custom-tool-edit-id');
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (promptInput) promptInput.value = '';
    if (idInput) idInput.value = '';
}

/**
 * Open the custom tool editor for an existing tool.
 * @param {string} toolId
 */
export function handleEditCustomTool(toolId) {
    const tool = getToolById(toolId);
    if (!tool || !tool.isUserTool) return;

    openModal('custom-tool-modal');
    const nameInput = document.getElementById('custom-tool-name');
    const descInput = document.getElementById('custom-tool-desc');
    const promptInput = document.getElementById('custom-tool-prompt');
    const idInput = document.getElementById('custom-tool-edit-id');
    if (nameInput) nameInput.value = tool.name;
    if (descInput) descInput.value = tool.description;
    if (promptInput) promptInput.value = tool.promptAddition;
    if (idInput) idInput.value = tool.id;
}

/**
 * Save a custom tool (create or update).
 * Salva ferramenta customizada (cria ou atualiza).
 */
export function handleSaveCustomTool() {
    const name = document.getElementById('custom-tool-name')?.value?.trim();
    const description = document.getElementById('custom-tool-desc')?.value?.trim();
    const prompt = document.getElementById('custom-tool-prompt')?.value?.trim();
    const editId = document.getElementById('custom-tool-edit-id')?.value?.trim();

    if (!name) {
        showToast(t('enterToolName') || 'Enter a tool name', 'error');
        return;
    }
    if (!prompt) {
        showToast(t('enterToolPrompt') || 'Enter tool prompt instructions', 'error');
        return;
    }

    if (editId) {
        // Atualizar existente
        updateUserTool(editId, { name, description, prompt });
        showToast(t('toolUpdated') || 'Tool updated', 'success');
    } else {
        // Criar nova
        addUserTool({ name, description, prompt });
        showToast(t('toolCreated') || 'Tool created', 'success');
    }

    closeModal('custom-tool-modal');
    renderToolsDropdown();
    renderToolChips();
}

/**
 * Remove a custom tool.
 * @param {string} toolId
 */
export function handleRemoveCustomTool(toolId) {
    removeUserTool(toolId);
    showToast(t('toolRemoved') || 'Tool removed', 'info');
    renderToolsDropdown();
    renderToolChips();
}

// ----------------------------------------------------------------
// CONTEXTUAL CHAT — Auto-carrega contexto ao selecionar elemento
// ----------------------------------------------------------------

/**
 * Toggle contextual chat mode on/off.
 * Quando ativo, selecionar um elemento injeta seu contexto no chat.
 */
export function toggleContextualChat() {
    _contextualChatEnabled = !_contextualChatEnabled;
    const btn = document.getElementById('llm-contextual-toggle');
    if (btn) {
        btn.classList.toggle('active', _contextualChatEnabled);
        btn.title = _contextualChatEnabled
            ? (t('contextualChat') || 'Contextual Chat') + ' ON'
            : (t('contextualChat') || 'Contextual Chat') + ' OFF';
    }
    return _contextualChatEnabled;
}

/**
 * Check if contextual chat is enabled.
 * @returns {boolean}
 */
export function isContextualChatEnabled() {
    return _contextualChatEnabled;
}

/**
 * Load element context into the chat when an element is selected.
 * Carrega o contexto do elemento selecionado no chat.
 * O LLM lê esse contexto e se prepara para conversar sobre o elemento.
 *
 * Chamada por handleSelectElement quando contextual chat está ON
 * e há pelo menos uma custom tool ativa.
 *
 * @param {string} elementId - ID do elemento selecionado
 */
export function loadElementContext(elementId) {
    if (!_contextualChatEnabled) return;
    if (!hasApiKey()) return;
    if (getActiveTools().length === 0) return;

    const element = getElementById(elementId);
    if (!element) return;

    // Abre o painel se estiver fechado
    const panel = document.getElementById('llm-chat-panel');
    if (panel && !panel.classList.contains('open')) {
        panel.classList.add('open');
    }

    // Gera resumo do elemento para o contexto visual
    const obsCount = element.data?.observations?.length || 0;
    const msgCount = element.messages?.length || 0;
    const contextHint =
        `💬 ${t('contextLoaded') || 'Context loaded'}: ${element.name} (${element.family}). ` +
        `${obsCount} obs, ${msgCount} msgs. ` +
        (t('askMeSomething') || 'Ask me something.');

    addMessage(contextHint, 'assistant');
}

// ----------------------------------------------------------------
// ENGINE SELECTOR — Selecao de engine no modal de configuracao
// ----------------------------------------------------------------

/**
 * Select an engine type and update UI.
 * Atualiza cards ativos e mostra/esconde paineis de configuracao.
 *
 * @param {string} engineType - 'cloud' | 'browser' | 'local'
 */
export function selectEngine(engineType) {
    setEngine(engineType);

    // Atualiza cards visuais
    document.querySelectorAll('.engine-card').forEach((card) => {
        card.classList.toggle('active', card.dataset.engine === engineType);
    });

    // Mostra/esconde paineis de configuracao
    const panels = {
        'engine-config-cloud': EngineType.CLOUD,
        'engine-config-browser': EngineType.BROWSER,
        'engine-config-webllm': EngineType.WEB_LLM,
        'engine-config-local': EngineType.LOCAL,
    };
    for (const [id, type] of Object.entries(panels)) {
        const el = document.getElementById(id);
        if (el) el.style.display = engineType === type ? '' : 'none';
    }

    // Roda benchmark ao selecionar browser engine
    if (engineType === EngineType.BROWSER) {
        runAndDisplayBenchmark();
    }

    // Popula modelos e status WebGPU ao selecionar web-llm
    if (engineType === EngineType.WEB_LLM) {
        populateWebLlmModels();
        displayWebLlmGpuStatus();
    }
}

// ----------------------------------------------------------------
// BROWSER ENGINE HELPERS — Benchmark, download, model selection
// ----------------------------------------------------------------

/**
 * Populate browser model dropdown.
 * Preenche o select de modelos do browser com opcoes disponiveis.
 */
function populateBrowserModels() {
    const select = document.getElementById('browser-model');
    if (!select) return;

    const models = getBrowserModels();
    select.innerHTML = models
        .map((m) => `<option value="${m.id}">${t(m.nameKey) || m.name} (${m.size})</option>`)
        .join('');
}

/**
 * Handle browser model selection change.
 * Salva modelo selecionado no router state.
 */
export function handleBrowserModelChange() {
    const select = document.getElementById('browser-model');
    if (select) setBrowserModel(select.value);
}

/**
 * Download selected browser model.
 * Inicia download do modelo com callback de progresso na UI.
 */
export async function downloadBrowserModel() {
    const modelId = document.getElementById('browser-model')?.value || getBrowserModel();
    const btn = document.getElementById('browser-download-btn');
    const progressBar = document.getElementById('browser-download-progress');
    const progressFill = document.getElementById('browser-download-fill');
    const progressLabel = document.getElementById('browser-download-label');

    if (btn) btn.disabled = true;
    if (progressBar) progressBar.style.display = '';

    try {
        await loadBrowserModel(modelId, (info) => {
            if (progressFill) progressFill.style.width = `${info.progress}%`;
            if (progressLabel) progressLabel.textContent = info.message;

            // Mostra fallback warning
            if (info.status === 'fallback') {
                showToast(t('noWebGPU') || info.message, 'warning');
            }
        });

        showToast(t('modelReady') || 'Model ready!', 'success');
        if (progressLabel) progressLabel.textContent = t('modelReady') || 'Model ready!';
    } catch (e) {
        showToast((t('modelLoadError') || 'Failed to load model') + ': ' + e.message, 'error');
        if (progressLabel) progressLabel.textContent = e.message;
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * Run benchmark and display results.
 * Executa deteccao de hardware e renderiza no painel de config.
 */
export async function runAndDisplayBenchmark() {
    const container = document.getElementById('benchmark-results');
    if (!container) return;

    container.innerHTML = `<div class="benchmark-loading">${t('benchmarkRunning') || 'Evaluating device capabilities...'}</div>`;

    try {
        const result = await runBenchmark();

        // Encontra nome do modelo recomendado
        const models = getBrowserModels();
        const recommended = models.find((m) => m.id === result.recommended);
        const recName = recommended ? t(recommended.nameKey) || recommended.name : result.recommended;

        container.innerHTML = `
            <div class="benchmark-row">
                <span class="benchmark-label">WebGPU</span>
                <span class="benchmark-value ${result.webgpu ? 'available' : 'unavailable'}">
                    ${result.webgpu ? t('webgpuAvailable') || 'Available' : t('webgpuUnavailable') || 'Not available (CPU)'}
                </span>
            </div>
            ${
                result.gpu
                    ? `<div class="benchmark-row">
                <span class="benchmark-label">${t('gpuDetected') || 'GPU'}</span>
                <span class="benchmark-value">${result.gpu}</span>
            </div>`
                    : ''
            }
            ${
                result.vramGB
                    ? `<div class="benchmark-row">
                <span class="benchmark-label">VRAM</span>
                <span class="benchmark-value">${result.vramGB} GB</span>
            </div>`
                    : ''
            }
            ${
                result.ramGB
                    ? `<div class="benchmark-row">
                <span class="benchmark-label">${t('ramDetected') || 'RAM'}</span>
                <span class="benchmark-value">${result.ramGB} GB</span>
            </div>`
                    : ''
            }
            <div class="benchmark-row">
                <span class="benchmark-label">Device</span>
                <span class="benchmark-value">${result.deviceType === 'mobile' ? '📱 Mobile' : '🖥️ Desktop'}</span>
            </div>
            <div class="benchmark-recommendation">
                <strong>${t('recommendedModel') || 'Recommended'}:</strong> ${recName}
            </div>
        `;

        // Auto-seleciona modelo recomendado no dropdown
        const select = document.getElementById('browser-model');
        if (select && result.recommended) {
            select.value = result.recommended;
            setBrowserModel(result.recommended);
        }
    } catch (e) {
        container.innerHTML = `<div class="benchmark-loading">Error: ${escapeHtml(e.message)}</div>`;
    }
}

// ----------------------------------------------------------------
// WEB-LLM HELPERS — Model selection, download, GPU status
// ----------------------------------------------------------------

/**
 * Populate web-llm model dropdown.
 * Preenche o select de modelos MLC com opcoes disponiveis.
 */
function populateWebLlmModels() {
    const select = document.getElementById('webllm-model');
    if (!select) return;

    const models = getWebLlmModels();
    select.innerHTML = models
        .map((m) => `<option value="${m.id}">${t(m.nameKey) || m.name} (${m.size})</option>`)
        .join('');
    select.value = getWebLlmModel();
}

/**
 * Handle web-llm model selection change.
 * Salva modelo selecionado no router state.
 */
export function handleWebLlmModelChange() {
    const select = document.getElementById('webllm-model');
    if (select) setWebLlmModel(select.value);
}

/**
 * Download selected web-llm model.
 * Inicia download do modelo MLC com callback de progresso na UI.
 */
export async function downloadWebLlmModel() {
    const modelId = document.getElementById('webllm-model')?.value || getWebLlmModel();
    const btn = document.getElementById('webllm-download-btn');
    const progressBar = document.getElementById('webllm-download-progress');
    const progressFill = document.getElementById('webllm-download-fill');
    const progressLabel = document.getElementById('webllm-download-label');

    if (btn) btn.disabled = true;
    if (progressBar) progressBar.style.display = '';

    try {
        await loadWebLlmModel(modelId, (info) => {
            if (progressFill) progressFill.style.width = `${info.progress}%`;
            if (progressLabel) progressLabel.textContent = info.message;
        });

        showToast(t('modelReady') || 'Model ready!', 'success');
        if (progressLabel) progressLabel.textContent = t('modelReady') || 'Model ready!';
    } catch (e) {
        showToast((t('modelLoadError') || 'Failed to load model') + ': ' + e.message, 'error');
        if (progressLabel) progressLabel.textContent = e.message;
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * Display WebGPU availability status for web-llm panel.
 * Mostra se WebGPU esta disponivel e info do GPU.
 */
async function displayWebLlmGpuStatus() {
    const container = document.getElementById('webllm-gpu-status');
    if (!container) return;

    const avail = isWebLlmAvailable();
    if (!avail.webgpu) {
        container.innerHTML = `
            <div class="benchmark-row">
                <span class="benchmark-label">WebGPU</span>
                <span class="benchmark-value unavailable">
                    ${t('webgpuUnavailable') || 'Not available'}
                </span>
            </div>
            <div class="benchmark-recommendation" style="color:var(--error-color);">
                ${t('webllmRequiresWebGPU') || 'WebGPU is required for this engine. Use Chrome 113+ or Edge 113+.'}
            </div>
        `;
        return;
    }

    let gpuName = '';
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
            const info = await adapter.requestAdapterInfo?.();
            gpuName = info?.device || info?.description || '';
        }
    } catch {
        /* ignore */
    }

    container.innerHTML = `
        <div class="benchmark-row">
            <span class="benchmark-label">WebGPU</span>
            <span class="benchmark-value available">
                ${t('webgpuAvailable') || 'Available'}
            </span>
        </div>
        ${
            gpuName
                ? `<div class="benchmark-row">
            <span class="benchmark-label">${t('gpuDetected') || 'GPU'}</span>
            <span class="benchmark-value">${gpuName}</span>
        </div>`
                : ''
        }
    `;
}

// ----------------------------------------------------------------
// LOCAL SERVER HELPERS — Test, refresh models
// ----------------------------------------------------------------

/**
 * Test connection to local server.
 * Testa conectividade com o servidor local configurado.
 */
export async function testLocalServer() {
    const url = document.getElementById('local-server-url')?.value?.trim();
    const model = document.getElementById('local-model-name')?.value?.trim();
    const status = document.getElementById('local-test-status');

    if (!url || !model) {
        if (status) status.textContent = 'Enter URL and model name';
        return;
    }

    if (status) status.textContent = '...';

    const result = await testLocalConnection(url, model);
    if (status) {
        status.textContent = result.message;
        status.className = result.success ? 'test-success' : 'test-error';
    }
}

/**
 * Refresh models from local server.
 * Busca lista de modelos disponiveis no servidor local.
 */
export async function refreshLocalModels() {
    const url = document.getElementById('local-server-url')?.value?.trim();
    const modelInput = document.getElementById('local-model-name');
    const status = document.getElementById('local-test-status');

    if (!url) {
        if (status) status.textContent = 'Enter server URL first';
        return;
    }

    if (status) status.textContent = '...';

    try {
        const models = await fetchLocalModels(url);
        if (models.length > 0) {
            // Mostra primeiro modelo encontrado no input
            if (modelInput && !modelInput.value) modelInput.value = models[0];
            if (status) status.textContent = `${models.length} models: ${models.join(', ')}`;
            status.className = 'test-success';
        } else {
            if (status) status.textContent = 'No models found';
        }
    } catch (e) {
        if (status) {
            status.textContent = e.message;
            status.className = 'test-error';
        }
    }
}

// ----------------------------------------------------------------
// ENGINE BADGE & PROGRESS BAR — UI updates
// ----------------------------------------------------------------

/**
 * Update engine badge in chat header.
 * Atualiza o badge de engine no header do chat panel.
 */
function updateEngineBadge() {
    const badge = document.getElementById('llm-engine-badge');
    if (!badge) return;

    const engine = getEngine();
    const displayName = getEngineDisplayName();

    badge.className = `engine-badge engine-${engine}`;
    badge.textContent = displayName;
    badge.title = `${t('engineActive') || 'Active engine'}: ${displayName}`;
}

/**
 * Show progress bar in chat panel.
 * Mostra barra de progresso abaixo do header.
 * @param {boolean} [indeterminate=false] - Se true, mostra shimmer animation
 */
function showProgressBar(indeterminate = false) {
    const bar = document.getElementById('llm-progress-bar');
    if (!bar) return;
    bar.style.display = '';
    if (indeterminate) {
        bar.classList.add('indeterminate');
    }
}

/**
 * Hide progress bar.
 * Esconde barra de progresso.
 */
function hideProgressBar() {
    const bar = document.getElementById('llm-progress-bar');
    if (!bar) return;
    bar.style.display = 'none';
    bar.classList.remove('indeterminate');
}

/**
 * Update progress bar fill percentage.
 * Atualiza preenchimento da barra de progresso.
 * @param {number} percent - 0-100
 */
function updateProgressBar(percent) {
    const fill = document.getElementById('llm-progress-fill');
    if (fill) fill.style.width = `${percent}%`;
}

/* ----------------------------------------------------------------
   AI WIDGET DRAG — permite arrastar o widget pelo header
   ---------------------------------------------------------------- */

let _dragInitialized = false;

/**
 * Setup drag-to-move on the AI chat widget header.
 * Arrasta o widget flutuante do AI Assistant pelo header.
 */
function initAIWidgetDrag() {
    if (_dragInitialized) return;
    const header = document.querySelector('.llm-chat-header');
    const panel = document.getElementById('llm-chat-panel');
    if (!header || !panel) return;

    header.addEventListener('mousedown', (e) => {
        // Nao arrastar se clicou num botao
        if (e.target.closest('button')) return;

        panel.classList.add('dragged');

        const rect = panel.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeft = rect.left;
        const startBottom = window.innerHeight - rect.bottom;

        const onMove = (me) => {
            const dx = me.clientX - startX;
            const dy = me.clientY - startY;

            let newLeft = startLeft + dx;
            let newBottom = startBottom - dy;

            const pw = panel.offsetWidth;
            const ph = panel.offsetHeight;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            newLeft = Math.max(0, Math.min(newLeft, vw - pw));
            newBottom = Math.max(0, Math.min(newBottom, vh - ph));

            panel.style.right = 'auto';
            panel.style.left = newLeft + 'px';
            panel.style.bottom = newBottom + 'px';
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            panel.classList.remove('dragged');
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
    });

    _dragInitialized = true;
}

/**
 * Setup resize handles on the AI chat widget.
 * Adiciona handles de redimensionamento nas bordas e cantos do chat.
 */
function initAIWidgetResize() {
    const panel = document.getElementById('llm-chat-panel');
    if (!panel || _chatResizeCleanup) return;

    _chatResizeCleanup = addFloatingResizeHandles(panel, {
        minWidth: 300,
        maxWidth: 700,
        minHeight: 300,
        maxHeight: window.innerHeight - 40,
        onEnd: () => {
            try {
                safeSetItem(
                    'ecbyts-chat-dims',
                    JSON.stringify({
                        width: panel.offsetWidth,
                        height: panel.offsetHeight,
                    }),
                );
            } catch (e) {
                /* quota exceeded — ignora */
            }
        },
    });
}

/**
 * Restore saved chat panel dimensions from localStorage.
 * Restaura dimensoes salvas do painel de chat.
 * @param {HTMLElement} panel
 */
function restoreChatDimensions(panel) {
    try {
        const saved = JSON.parse(localStorage.getItem('ecbyts-chat-dims'));
        if (saved && saved.width && saved.height) {
            panel.style.setProperty('--chat-w', saved.width + 'px');
            panel.style.setProperty('--chat-h', saved.height + 'px');
        }
    } catch (e) {
        /* ignore */
    }
}

/**
 * All LLM chat handler functions exposed to HTML via window.
 * Objeto com todas as funcoes do chat IA para o HTML.
 */
export const llmChatHandlers = {
    toggleAIWidget,
    openLLMChat,
    closeLLMChat,
    openLLMConfig,
    saveLLMConfig,
    sendLLMMessage,
    confirmLLMAction,
    cancelLLMAction,
    handleProviderChange,
    testLLMConnection,
    refreshLLMModels,
    toggleChatToolsMenu,
    handleToggleChatTool,
    toggleContextualChat,
    handleCreateCustomTool,
    handleEditCustomTool,
    handleSaveCustomTool,
    handleRemoveCustomTool,
    // Novas funcoes de engine routing
    selectEngine,
    handleBrowserModelChange,
    downloadBrowserModel,
    runAndDisplayBenchmark,
    // Web-LLM engine
    handleWebLlmModelChange,
    downloadWebLlmModel,
    // Local server
    testLocalServer,
    refreshLocalModels,
};
