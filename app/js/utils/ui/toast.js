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
   SISTEMA DE NOTIFICACOES (TOAST)
   ================================================================

   Este modulo gerencia as notificacoes temporarias.

   O QUE E UM TOAST?
   Uma pequena mensagem que aparece temporariamente na tela.
   Chamada "toast" por parecer uma torrada saindo da torradeira.

   TIPOS DE TOAST:
   - success (verde): Acao bem sucedida
   - error (vermelho): Algo deu errado
   - warning (amarelo): Atencao necessaria
   - info (azul): Informacao geral

   COMPORTAMENTO:
   - Aparece no canto inferior direito
   - Desaparece automaticamente apos alguns segundos
   - Pode ser fechado manualmente clicando no X
   - Maximo de 3 toasts visiveis simultaneamente

   ================================================================ */

import { getIcon } from './icons.js';
import { escapeHtml } from '../helpers/html.js';
// ----------------------------------------------------------------
// CONFIGURACAO
// ----------------------------------------------------------------

/**
 * Configuracoes do sistema de toast.
 */
const TOAST_CONFIG = {
    /**
     * Duracao padrao em milissegundos.
     * 3000ms = 3 segundos
     */
    duration: 3000,

    /**
     * Maximo de toasts visiveis simultaneamente.
     */
    maxVisible: 3,

    /**
     * ID do container onde toasts sao adicionados.
     */
    containerId: 'toast-container',

    /**
     * Icones para cada tipo de toast.
     */
    icons: {
        success: 'check',
        error: 'x',
        warning: 'alert-triangle',
        info: 'info',
    },
};

// ----------------------------------------------------------------
// FUNCAO PRINCIPAL
// ----------------------------------------------------------------

/**
 * Exibe uma notificacao toast.
 *
 * @param {string} message - Mensagem a exibir
 * @param {string} type - Tipo: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duracao em ms (opcional, padrao: 4000)
 *
 * EXEMPLO:
 *   showToast('Arquivo salvo!', 'success');
 *   showToast('Erro ao conectar', 'error');
 *   showToast('Verificar configuracao', 'warning');
 */
export function showToast(message, type = 'info', duration = TOAST_CONFIG.duration) {
    // Obtem container
    const container = document.getElementById(TOAST_CONFIG.containerId);
    if (!container) {
        console.warn('Container de toast nao encontrado');
        return;
    }

    // Limita numero de toasts visiveis (remove os mais antigos)
    while (container.children.length >= TOAST_CONFIG.maxVisible) {
        const oldest = container.firstChild;
        if (oldest) {
            oldest.remove();
        }
    }

    // Cria elemento toast
    const toast = createToastElement(message, type);

    // Adiciona ao container
    container.appendChild(toast);

    // Remove automaticamente apos duracao (0 = persistente, usuario fecha manualmente)
    if (duration > 0) {
        setTimeout(() => {
            removeToast(toast);
        }, duration);
    }
}

// ----------------------------------------------------------------
// FUNCOES AUXILIARES
// ----------------------------------------------------------------

/**
 * Cria elemento HTML do toast.
 *
 * @param {string} message - Mensagem
 * @param {string} type - Tipo
 * @returns {HTMLElement} - Elemento toast
 */
function createToastElement(message, type) {
    // Cria div principal
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    // Acessibilidade: erros usam role="alert" (assertivo, interrompe screen reader)
    if (type === 'error') toast.setAttribute('role', 'alert');

    // Define icone baseado no tipo
    const iconName = TOAST_CONFIG.icons[type] || TOAST_CONFIG.icons.info;

    // Monta HTML interno
    toast.innerHTML = `
        <span class="toast-icon">${getIcon(iconName, { size: '14px' })}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
        <button class="toast-close" type="button" aria-label="Fechar">${getIcon('x', { size: '12px' })}</button>
    `;

    // Adiciona evento de fechar
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => {
        removeToast(toast);
    });

    return toast;
}

/**
 * Remove um toast com animacao.
 *
 * @param {HTMLElement} toast - Elemento a remover
 */
function removeToast(toast) {
    if (!toast || !toast.parentNode) return;

    // Adiciona classe de saida para animacao
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';

    // Remove do DOM apos animacao
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 300); // Duracao da animacao CSS
}
// ----------------------------------------------------------------
// FUNCOES DE CONVENIENCIA
// ----------------------------------------------------------------

/**
 * Exibe toast de sucesso.
 *
 * @param {string} message - Mensagem
 */
export function showSuccess(message) {
    showToast(message, 'success');
}

/**
 * Exibe toast de erro.
 *
 * @param {string} message - Mensagem
 */
export function showError(message) {
    showToast(message, 'error');
}

/**
 * Exibe toast de aviso.
 *
 * @param {string} message - Mensagem
 */
export function showWarning(message) {
    showToast(message, 'warning');
}

/**
 * Exibe toast informativo.
 *
 * @param {string} message - Mensagem
 */
export function showInfo(message) {
    showToast(message, 'info');
}

// ----------------------------------------------------------------
// FUNCOES DE GERENCIAMENTO
// ----------------------------------------------------------------

/**
 * Remove todos os toasts ativos.
 * Util para limpar antes de uma operacao importante.
 */
export function clearAllToasts() {
    const container = document.getElementById(TOAST_CONFIG.containerId);
    if (container) {
        container.innerHTML = '';
    }
}

/**
 * Retorna quantidade de toasts ativos.
 *
 * @returns {number} - Numero de toasts visiveis
 */
export function getActiveToastCount() {
    const container = document.getElementById(TOAST_CONFIG.containerId);
    return container ? container.children.length : 0;
}
