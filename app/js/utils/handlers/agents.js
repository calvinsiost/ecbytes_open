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
   AGENT HANDLERS — UI handlers for agent management
   ================================================================

   Controla o modal de biblioteca de agentes IA:
   criar, editar, excluir, selecionar, exportar e importar agentes.

   ================================================================ */

import {
    getAllAgents,
    getAgentById,
    saveUserAgent,
    deleteUserAgent,
    getActiveAgent,
    setActiveAgent,
    exportAgent,
    importAgent,
} from '../../core/llm/agents.js';
import { openModal, closeModal } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/translations.js';
import { getIcon } from '../ui/icons.js';
import { escapeHtml } from '../helpers/html.js';
import { asyncConfirm } from '../ui/asyncDialogs.js';

// ================================================================
// AGENT LIBRARY MODAL
// ================================================================

/**
 * Open the agents library modal.
 * Abre o modal da biblioteca de agentes.
 */
export function openAgentsModal() {
    refreshAgentList();
    showAgentList();
    openModal('agents-modal');
}

/**
 * Show agent list view, hide editor.
 * Mostra a lista de agentes, esconde o editor.
 */
function showAgentList() {
    const list = document.getElementById('agents-list-view');
    const editor = document.getElementById('agents-editor-view');
    if (list) list.style.display = '';
    if (editor) editor.style.display = 'none';
}

/**
 * Show agent editor view, hide list.
 * Mostra o editor de agente, esconde a lista.
 */
function showAgentEditor() {
    const list = document.getElementById('agents-list-view');
    const editor = document.getElementById('agents-editor-view');
    if (list) list.style.display = 'none';
    if (editor) editor.style.display = '';
}

// ================================================================
// AGENT CRUD HANDLERS
// ================================================================

/**
 * Open editor to create a new agent.
 * Abre o editor para criar um novo agente.
 */
export function handleCreateAgent() {
    // Clear form
    const nameInput = document.getElementById('agent-edit-name');
    const descInput = document.getElementById('agent-edit-description');
    const promptInput = document.getElementById('agent-edit-prompt');
    const idInput = document.getElementById('agent-edit-id');

    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (promptInput) promptInput.value = '';
    if (idInput) idInput.value = '';

    showAgentEditor();
}

/**
 * Open editor with existing agent data.
 * Abre o editor com dados de um agente existente.
 *
 * @param {string} agentId - Agent identifier
 */
export function handleEditAgent(agentId) {
    const agent = getAgentById(agentId);
    if (!agent || agent.isSystem) return;

    const nameInput = document.getElementById('agent-edit-name');
    const descInput = document.getElementById('agent-edit-description');
    const promptInput = document.getElementById('agent-edit-prompt');
    const idInput = document.getElementById('agent-edit-id');

    if (nameInput) nameInput.value = agent.name || '';
    if (descInput) descInput.value = agent.description || '';
    if (promptInput) promptInput.value = agent.systemPromptAddition || '';
    if (idInput) idInput.value = agent.id || '';

    showAgentEditor();
}

/**
 * Save agent from editor form.
 * Salva o agente a partir do formulario do editor.
 */
export function handleSaveAgent() {
    const name = document.getElementById('agent-edit-name')?.value?.trim();
    const description = document.getElementById('agent-edit-description')?.value?.trim();
    const prompt = document.getElementById('agent-edit-prompt')?.value?.trim();
    const id = document.getElementById('agent-edit-id')?.value?.trim();

    if (!name) {
        showToast(t('agentName') + ' required', 'error');
        return;
    }

    const agent = {
        id: id || undefined,
        name: name,
        description: description || '',
        systemPromptAddition: prompt || '',
        icon: 'user',
    };

    saveUserAgent(agent);
    showToast(t('agentSaved') || 'Agent saved', 'success');
    refreshAgentList();
    showAgentList();
}

/**
 * Cancel editing and return to list.
 * Cancela edicao e volta para a lista.
 */
export function handleCancelEditAgent() {
    showAgentList();
}

/**
 * Delete a user agent.
 * Exclui um agente personalizado.
 *
 * @param {string} agentId - Agent identifier
 */
export async function handleDeleteAgent(agentId) {
    const agent = getAgentById(agentId);
    if (!agent || agent.isSystem) return;

    if (!(await asyncConfirm(`${t('deleteAgent') || 'Delete agent'}: "${agent.name}"?`))) return;

    deleteUserAgent(agentId);
    showToast(t('agentDeleted') || 'Agent deleted', 'success');
    refreshAgentList();
    updateChatAgentBadge();
}

/**
 * Select an agent as active.
 * Seleciona um agente como ativo.
 *
 * @param {string} agentId - Agent identifier
 */
export function handleSelectAgent(agentId) {
    setActiveAgent(agentId);
    showToast(t('agentActivated') || 'Agent activated', 'success');
    refreshAgentList();
    updateChatAgentBadge();
}

// ================================================================
// EXPORT / IMPORT HANDLERS
// ================================================================

/**
 * Export an agent as JSON file download.
 * Exporta um agente como arquivo JSON.
 *
 * @param {string} agentId - Agent identifier
 */
export function handleExportAgent(agentId) {
    const json = exportAgent(agentId);
    if (!json) return;

    const agent = getAgentById(agentId);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-${agent.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(t('agentExported') || 'Agent exported', 'success');
}

/**
 * Import agent from file input.
 * Importa agente de um arquivo JSON.
 */
export function handleImportAgent() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            importAgent(text);
            showToast(t('agentImported') || 'Agent imported', 'success');
            refreshAgentList();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };
    input.click();
}

// ================================================================
// UI RENDERING
// ================================================================

/**
 * Refresh the agent list in the modal.
 * Atualiza a lista de agentes no modal.
 */
function refreshAgentList() {
    const container = document.getElementById('agents-list');
    if (!container) return;

    const agents = getAllAgents();
    const activeId = getActiveAgent();

    container.innerHTML = agents
        .map((a) => {
            const isActive = a.id === activeId;
            const badgeClass = a.isSystem ? 'system' : '';
            const badgeText = a.isSystem ? t('systemAgent') || 'System' : t('userAgent') || 'Custom';

            return `<div class="agent-card ${isActive ? 'active' : ''}">
            <div class="agent-card-header">
                <strong>${escapeHtml(a.name)}</strong>
                <span class="agent-badge ${badgeClass}">${badgeText}</span>
            </div>
            <p>${escapeHtml(a.description || '')}</p>
            <div class="agent-card-actions">
                <button class="btn btn-primary" onclick="window.handleSelectAgent('${a.id}')"
                    ${isActive ? 'disabled' : ''}>
                    ${isActive ? getIcon('check', { size: '12px' }) : t('selectAgent') || 'Select'}
                </button>
                ${!a.isSystem ? `<button class="btn btn-secondary" onclick="window.handleEditAgent('${a.id}')">${t('edit') || 'Edit'}</button>` : ''}
                ${!a.isSystem ? `<button class="btn btn-secondary" onclick="window.handleDeleteAgent('${a.id}')">${t('delete') || 'Delete'}</button>` : ''}
                <button class="btn btn-secondary" onclick="window.handleExportAgent('${a.id}')" title="${t('exportAgent') || 'Export'}">${getIcon('download', { size: '14px' })}</button>
            </div>
        </div>`;
        })
        .join('');
}

/**
 * Update the agent name badge in the chat panel header.
 * Atualiza o badge com o nome do agente ativo no header do chat.
 */
function updateChatAgentBadge() {
    const badge = document.getElementById('llm-agent-badge');
    if (!badge) return;

    const activeId = getActiveAgent();
    if (!activeId || activeId === 'default') {
        badge.style.display = 'none';
        return;
    }

    const agent = getAgentById(activeId);
    if (agent) {
        badge.textContent = agent.name;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

// ================================================================
// EXPORTED HANDLER OBJECT
// ================================================================

export const agentHandlers = {
    openAgentsModal,
    handleCreateAgent,
    handleEditAgent,
    handleSaveAgent,
    handleCancelEditAgent,
    handleDeleteAgent,
    handleSelectAgent,
    handleExportAgent,
    handleImportAgent,
};
