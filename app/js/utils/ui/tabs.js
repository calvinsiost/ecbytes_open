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
   SISTEMA DE ABAS
   ================================================================

   Este modulo gerencia as abas do painel direito.

   O QUE SAO ABAS?
   Abas (tabs) permitem alternar entre diferentes conteudos
   em um mesmo espaco, economizando area na tela.

   ABAS DA APLICACAO:
   - Project: Informacoes do projeto e coordenadas
   - Elements: Lista de elementos do modelo
   - Campaigns, Scenes, Analytics, Stamps

   COMPORTAMENTO:
   - Apenas uma aba ativa por vez
   - Clicar em aba mostra seu conteudo
   - Abas inativas tem visual diferente

   ================================================================ */

// ----------------------------------------------------------------
// INICIALIZACAO
// ----------------------------------------------------------------

/**
 * Inicializa sistema de abas.
 * Deve ser chamado apos o DOM estar pronto.
 *
 * COMO FUNCIONA:
 * 1. Encontra todas as abas (elementos com classe .tab)
 * 2. Adiciona evento de clique em cada uma
 * 3. Clique ativa a aba e mostra conteudo correspondente
 */
export function initTabs() {
    // Seleciona todas as abas
    const tabs = document.querySelectorAll('.tab');

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            activateTab(tab);
        });
    });
}

// ----------------------------------------------------------------
// FUNCOES DE NAVEGACAO
// ----------------------------------------------------------------

/**
 * Ativa uma aba especifica.
 *
 * @param {HTMLElement} tab - Elemento da aba a ativar
 *
 * PROCESSO:
 * 1. Encontra o painel pai (left-panel ou right-panel)
 * 2. Remove classe 'active' das abas do MESMO painel
 * 3. Esconde conteudos do mesmo painel
 * 4. Adiciona 'active' na aba clicada
 * 5. Mostra conteudo correspondente
 */
function activateTab(tab) {
    // Obtem ID da aba (data-tab="project" -> "project")
    const tabId = tab.dataset.tab;
    if (!tabId) return;

    // Encontra o painel pai — escopo por painel, nao global
    const panel = tab.closest('#left-panel, #right-panel');
    if (!panel) return;

    // Remove 'active' apenas das abas do mesmo painel
    const panelTabs = panel.querySelectorAll('.tab');
    panelTabs.forEach((t) => t.classList.remove('active'));

    // Esconde conteudos apenas do mesmo painel
    const panelContents = panel.querySelectorAll('.tab-content');
    panelContents.forEach((c) => (c.style.display = 'none'));

    // Ativa aba clicada
    tab.classList.add('active');
    // Garante visibilidade da aba ativa no container com overflow vertical.
    const tabsContainer = tab.closest('.tabs');
    if (tabsContainer) {
        const ensureTabVisible = () => {
            const containerRect = tabsContainer.getBoundingClientRect();
            const tabRect = tab.getBoundingClientRect();
            if (tabRect.top < containerRect.top) {
                tabsContainer.scrollTop += tabRect.top - containerRect.top - 4;
            } else if (tabRect.bottom > containerRect.bottom) {
                tabsContainer.scrollTop += tabRect.bottom - containerRect.bottom + 4;
            }
        };
        ensureTabVisible();
        requestAnimationFrame(ensureTabVisible);
    }

    // Mostra conteudo correspondente
    const content = document.getElementById(`tab-${tabId}`);
    if (content) {
        content.style.display = 'block';
    }

    // Notifica para re-renderizar conteudo da aba recem-ativada
    window.dispatchEvent(new CustomEvent('tabChanged', { detail: { tab: tabId } }));
}

/**
 * Ativa aba pelo ID (programaticamente).
 *
 * @param {string} tabId - ID da aba ('project', 'elements', 'layers')
 *
 * EXEMPLO:
 *   activateTabById('elements'); // Abre aba de elementos
 */
export function activateTabById(tabId) {
    const tab = document.querySelector(`.tab[data-tab="${tabId}"]`);
    if (tab) {
        activateTab(tab);
    }
}

/**
 * Retorna ID da aba atualmente ativa.
 *
 * @returns {string|null} - ID da aba ativa ou null
 */
export function getActiveTab() {
    const activeTab = document.querySelector('.tab.active');
    return activeTab?.dataset?.tab || null;
}

// ----------------------------------------------------------------
// FUNCOES DE SECOES EXPANSIVEIS
// ----------------------------------------------------------------

/**
 * Inicializa secoes expansiveis (acordeoes).
 * Secoes podem ser expandidas ou colapsadas clicando no cabecalho.
 */
export function initSections() {
    const headers = document.querySelectorAll('.section-header');

    headers.forEach((header) => {
        header.addEventListener('click', () => {
            toggleSection(header.parentElement);
        });
    });
}

/**
 * Alterna estado de uma secao (expandida/colapsada).
 *
 * @param {HTMLElement} section - Elemento da secao
 */
function toggleSection(section) {
    if (!section) return;
    section.classList.toggle('collapsed');
}

/**
 * Expande uma secao.
 *
 * @param {HTMLElement} section - Elemento da secao
 */
export function expandSection(section) {
    if (section) {
        section.classList.remove('collapsed');
    }
}

/**
 * Colapsa uma secao.
 *
 * @param {HTMLElement} section - Elemento da secao
 */
export function collapseSection(section) {
    if (section) {
        section.classList.add('collapsed');
    }
}

/**
 * Expande todas as secoes.
 */
export function expandAllSections() {
    document.querySelectorAll('.section').forEach((section) => {
        section.classList.remove('collapsed');
    });
}

/**
 * Colapsa todas as secoes.
 */
export function collapseAllSections() {
    document.querySelectorAll('.section').forEach((section) => {
        section.classList.add('collapsed');
    });
}
