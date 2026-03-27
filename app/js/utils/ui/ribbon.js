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
   TOOLBAR FLAT — SISTEMA DE GRUPOS E DROPDOWNS
   ================================================================

   Substitui o sistema de abas (ribbon) por uma toolbar única
   com grupos permanentes e dropdowns de progressive disclosure.

   COMPORTAMENTO DOS DROPDOWNS:
   - Trigger: botão com class .toolbar-dropdown-trigger e data-dropdown="<id>"
   - Target:  div.toolbar-dropdown com id="<id>"
   - Aberto:  classe .open no target + aria-expanded="true" no trigger
   - Fecha ao: clicar fora, pressionar Escape, selecionar item, Tab
   - Posição:  fixed, calculada por positionDropdown() para não sair da viewport
   - A11y:    arrow keys (↑↓) navegam entre items; focus no primeiro ao abrir
              items têm tabindex="-1" (ver HTML); role="menu"/"menuitem"

   COMPATIBILIDADE:
   - switchRibbonTab(tabId) ainda existe para uso em editToolbar.js.
     Quando tabId === 'edit', esconde #ribbon-main e mostra #ribbon-edit.
     Qualquer outro tabId restaura #ribbon-main.
   - Painel ativo rastreado via data-active="true" (robusto a variações de
     whitespace no style attribute).
   - IDs preservados: #ribbon-view-mode-btn, #ribbon-view-mode-label,
     #voxel-controls, #edit-ribbon-*, #toggle-*-btn

   ================================================================ */

// ----------------------------------------------------------------
// COMPATIBILIDADE: switchRibbonTab
// ----------------------------------------------------------------

/**
 * Troca entre toolbar principal e toolbar contextual de edição de forma.
 * Mantida para compatibilidade com editToolbar.js.
 * Usa data-active="true" para rastrear o painel ativo (não style string match).
 *
 * @param {string} tabId - 'edit' para modo de edição; qualquer outro valor
 *                         restaura a toolbar principal.
 */
export function switchRibbonTab(tabId) {
    const mainPanel = document.getElementById('ribbon-main');
    const editPanel = document.getElementById('ribbon-edit');

    if (tabId === 'edit') {
        if (mainPanel) {
            mainPanel.style.display = 'none';
            mainPanel.removeAttribute('data-active');
        }
        if (editPanel) {
            editPanel.style.display = 'flex';
            editPanel.dataset.active = 'true';
        }
    } else {
        if (mainPanel) {
            mainPanel.style.display = 'flex';
            mainPanel.dataset.active = 'true';
        }
        if (editPanel) {
            editPanel.style.display = 'none';
            editPanel.removeAttribute('data-active');
        }
    }

    requestAnimationFrame(updateScrollArrows);
}

// ----------------------------------------------------------------
// DROPDOWNS
// ----------------------------------------------------------------

/**
 * Fecha todos os dropdowns abertos.
 * Se returnFocus=true, devolve o foco ao trigger do dropdown fechado.
 *
 * @param {HTMLElement|null} except      - Dropdown a não fechar.
 * @param {boolean}          returnFocus - Se true, foca o trigger ao fechar.
 */
function closeAllDropdowns(except = null, returnFocus = false) {
    document.querySelectorAll('.toolbar-dropdown.open').forEach((d) => {
        if (d === except) return;
        d.classList.remove('open');
        const trigger = document.querySelector(`[data-dropdown="${d.id}"]`);
        if (trigger) {
            trigger.setAttribute('aria-expanded', 'false');
            if (returnFocus) trigger.focus();
        }
    });
}

/**
 * Posiciona um dropdown abaixo do seu trigger, corrigindo overflow da viewport.
 * Usa position: fixed para aparecer acima de qualquer z-index de painel.
 * Dois rAF encadeados garantem que o browser finalizou o layout após
 * visibility:visible + max-height antes de medir a altura real.
 *
 * @param {HTMLElement} dropdown
 * @param {HTMLElement} trigger
 */
function positionDropdown(dropdown, trigger) {
    const rect = trigger.getBoundingClientRect();
    const ddMinWidth = 220;
    const margin = 8;

    const leftAligned = rect.left;
    const rightAligned = rect.right - ddMinWidth;
    const wouldOverflowRight = leftAligned + ddMinWidth > window.innerWidth - margin;

    dropdown.style.top = rect.bottom + 2 + 'px';
    dropdown.style.left = (wouldOverflowRight ? Math.max(margin, rightAligned) : leftAligned) + 'px';

    // Dois rAFs: 1º para .open ser aplicado; 2º para medir altura final
    requestAnimationFrame(() =>
        requestAnimationFrame(() => {
            const ddRect = dropdown.getBoundingClientRect();
            if (ddRect.bottom > window.innerHeight - margin) {
                dropdown.style.top = rect.top - ddRect.height - 2 + 'px';
            }
        }),
    );
}

/**
 * Abre um dropdown, posiciona e foca o primeiro item acessível.
 * Focus no primeiro item é requisito WCAG 2.1 SC 4.1.2 (role=menu).
 *
 * @param {HTMLElement} dropdown
 * @param {HTMLElement} trigger
 */
function openDropdown(dropdown, trigger) {
    dropdown.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    positionDropdown(dropdown, trigger);
    requestAnimationFrame(() => {
        const firstItem = dropdown.querySelector('.toolbar-dropdown-item:not([disabled])');
        firstItem?.focus();
    });
}

/**
 * Registra os listeners de dropdown na toolbar.
 * Um único listener de click delegado — evita múltiplos handlers no document.
 * Keyboard: ↑↓ navega, Escape fecha+retorna foco, Tab fecha, Home/End.
 * Chamada uma única vez em initRibbon().
 */
function initDropdowns() {
    // Único listener de click delegado
    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.toolbar-dropdown-trigger');
        const item = e.target.closest('.toolbar-dropdown-item');

        if (trigger) {
            e.stopPropagation();
            const ddId = trigger.dataset.dropdown;
            const dropdown = ddId ? document.getElementById(ddId) : null;
            if (!dropdown) return;

            const isOpen = dropdown.classList.contains('open');
            closeAllDropdowns();

            if (!isOpen) openDropdown(dropdown, trigger);
            return;
        }

        if (item) {
            // Item clicado: onclick já executou antes de chegar aqui (bubbling)
            setTimeout(() => closeAllDropdowns(), 0);
            return;
        }

        closeAllDropdowns();
    });

    // Keyboard navigation — WCAG 2.1 role=menu pattern
    document.addEventListener('keydown', (e) => {
        const openDd = document.querySelector('.toolbar-dropdown.open');

        if (e.key === 'Escape') {
            if (openDd) closeAllDropdowns(null, true /* returnFocus */);
            return;
        }

        if (!openDd) return;

        const items = Array.from(openDd.querySelectorAll('.toolbar-dropdown-item:not([disabled])'));
        const focused = document.activeElement;
        const idx = items.indexOf(focused);

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                (items[idx + 1] ?? items[0])?.focus();
                break;
            case 'ArrowUp':
                e.preventDefault();
                (items[idx - 1] ?? items[items.length - 1])?.focus();
                break;
            case 'Home':
                e.preventDefault();
                items[0]?.focus();
                break;
            case 'End':
                e.preventDefault();
                items[items.length - 1]?.focus();
                break;
            case 'Tab':
                closeAllDropdowns();
                break;
        }
    });
}

// ----------------------------------------------------------------
// SCROLL ARROWS (mantidas para overflow horizontal)
// ----------------------------------------------------------------

let _scrollArrowLeft = null;
let _scrollArrowRight = null;
const SCROLL_STEP = 200;

/**
 * Injeta setas de navegação lateral no #toolbar quando o conteúdo transborda.
 */
function injectScrollArrows() {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar || toolbar.querySelector('.ribbon-scroll-arrow')) return;

    _scrollArrowLeft = document.createElement('button');
    _scrollArrowLeft.type = 'button';
    _scrollArrowLeft.className = 'ribbon-scroll-arrow scroll-left';
    _scrollArrowLeft.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
    _scrollArrowLeft.addEventListener('click', () => scrollActivePanel(-SCROLL_STEP));

    _scrollArrowRight = document.createElement('button');
    _scrollArrowRight.type = 'button';
    _scrollArrowRight.className = 'ribbon-scroll-arrow scroll-right';
    _scrollArrowRight.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    _scrollArrowRight.addEventListener('click', () => scrollActivePanel(SCROLL_STEP));

    toolbar.appendChild(_scrollArrowLeft);
    toolbar.appendChild(_scrollArrowRight);
}

/**
 * Retorna o painel do ribbon ativo via data-active="true".
 * Robusto a variações de whitespace no style attribute (fix selector frágil).
 * @returns {HTMLElement|null}
 */
function getActivePanel() {
    return document.querySelector('.ribbon-panel[data-active="true"]');
}

function scrollActivePanel(delta) {
    const panel = getActivePanel();
    if (panel) panel.scrollBy({ left: delta, behavior: 'smooth' });
}

function updateScrollArrows() {
    const panel = getActivePanel();
    if (!_scrollArrowLeft || !_scrollArrowRight) return;

    if (!panel || panel.scrollWidth <= panel.clientWidth + 2) {
        _scrollArrowLeft.classList.remove('visible');
        _scrollArrowRight.classList.remove('visible');
        return;
    }

    const atStart = panel.scrollLeft <= 2;
    const atEnd = panel.scrollLeft + panel.clientWidth >= panel.scrollWidth - 2;

    _scrollArrowLeft.classList.toggle('visible', !atStart);
    _scrollArrowRight.classList.toggle('visible', !atEnd);
}

// ----------------------------------------------------------------
// INIT
// ----------------------------------------------------------------

/**
 * Inicializa a toolbar flat: mostra #ribbon-main com data-active, injeta
 * setas de scroll, registra listeners de dropdown e scroll/resize.
 */
// ----------------------------------------------------------------
// LIBRARY GALLERY
// ----------------------------------------------------------------

/**
 * Popula o #lib-gallery com ícones das bibliotecas instaladas.
 * Cada item é um botão 30×20px com o ícone da biblioteca.
 * Ícones que não cabem nos 12 slots visíveis ficam acessíveis via seta (dd-libs).
 *
 * Chamada uma vez em initRibbon() e novamente após instalar/remover bibliotecas.
 * Exposta como window.refreshLibGallery() para handlers de biblioteca.
 */
export function refreshLibGallery() {
    const gallery = document.getElementById('lib-gallery');
    if (!gallery) return;
    gallery.innerHTML = '';
    const STANDARD_LIBRARY_ICON = 'book-open';
    const allowedGalleryIcons = new Set([
        'book-open',
        'package',
        'box',
        'database',
        'folder',
        'file-text',
        'layers',
        'globe',
    ]);

    // Importação dinâmica para não criar dependência circular
    import('../libraries/manager.js')
        .then(({ getInstalledLibraries }) => {
            const libs = getInstalledLibraries();

            if (libs.length === 0) {
                // Nenhuma biblioteca: ícone padrão da seção que abre marketplace
                const placeholder = document.createElement('button');
                placeholder.className = 'lib-gallery-item lib-gallery-placeholder';
                placeholder.tabIndex = -1;
                placeholder.title = 'Explorar bibliotecas';
                placeholder.setAttribute('role', 'option');
                placeholder.onclick = () => window.handleOpenMarketplace?.();
                placeholder.innerHTML = `<span class="icon lib-gallery-item-icon" data-icon="${STANDARD_LIBRARY_ICON}" data-icon-size="14px"></span>`;
                gallery.appendChild(placeholder);
                if (typeof window.hydrateIcons === 'function') window.hydrateIcons(gallery);
                return;
            }

            libs.forEach((lib) => {
                const btn = document.createElement('button');
                btn.className = 'lib-gallery-item';
                btn.tabIndex = -1;
                btn.title = lib.manifest.name;
                btn.setAttribute('role', 'option');
                btn.onclick = () => window.handleActivateLibrary?.(lib.manifest.id);

                if (lib.manifest.thumbnail) {
                    // Thumbnail base64 ou URL
                    const img = document.createElement('img');
                    img.src = lib.manifest.thumbnail;
                    img.alt = lib.manifest.name;
                    btn.appendChild(img);
                } else {
                    // Fallback: ícone padronizado para manter consistência visual da toolbar
                    const iconEl = document.createElement('span');
                    iconEl.className = 'icon lib-gallery-item-icon';
                    const iconId = String(lib.manifest.icon || '').trim();
                    iconEl.dataset.icon = allowedGalleryIcons.has(iconId) ? iconId : STANDARD_LIBRARY_ICON;
                    iconEl.dataset.iconSize = '14px';
                    btn.appendChild(iconEl);
                }

                gallery.appendChild(btn);
            });

            // Re-hidratar ícones Lucide dos itens recém-criados
            if (typeof window.hydrateIcons === 'function') window.hydrateIcons(gallery);
        })
        .catch(() => {
            // Falha silenciosa — galeria fica vazia, seta abre dd-libs com as opções textuais
        });
}

// ----------------------------------------------------------------
// OVERFLOW — Priority+ pattern
// ----------------------------------------------------------------

/**
 * Avalia quais grupos do ribbon cabem na largura disponível.
 * Grupos que transbordam são ocultados da toolbar e seus itens
 * são clonados no dropdown #dd-overflow do botão "Mais".
 *
 * Estratégia:
 *  1. Medir largura disponível no #ribbon-main (excluindo spacer e collapse-btn)
 *  2. Iterar grupos da direita para a esquerda (menos prioritários primeiro)
 *  3. Ocultar grupos que não cabem; mostrar botão #tg-more sempre que houver overflow
 *  4. Reconstruir #dd-overflow com clones profundos dos itens dos grupos ocultos
 *
 * Grupos nunca ocultados: tg-file, tg-history (IDs na lista PINNED_GROUPS).
 */
const PINNED_GROUPS = new Set(['tg-file', 'tg-history']);

function updateOverflow() {
    const panel = document.getElementById('ribbon-main');
    if (!panel) return;

    const moreTrigger = document.querySelector('#tg-more > .toolbar-dropdown-trigger');
    const moreGroup = document.getElementById('tg-more');
    const overflowDd = document.getElementById('dd-overflow');
    if (!moreGroup || !overflowDd) return;

    // Grupos candidatos ao overflow (da direita para esquerda, exceto "Mais" e pinned)
    const groups = Array.from(panel.querySelectorAll('.toolbar-group:not(#tg-more):not(#voxel-controls)')).reverse(); // da direita (menos prioritário) para esquerda

    // Restaurar todos os grupos antes de medir
    groups.forEach((g) => (g.style.display = ''));
    overflowDd.innerHTML = '';

    // Medir: largura dos grupos permanentes + dividers + spacer + collapse-btn
    const spacer = panel.querySelector('.toolbar-spacer');
    const collapseBtn = panel.querySelector('.toolbar-collapse-btn');
    const panelWidth = panel.clientWidth;

    // Disponível = largura do panel menos spacer (min 8px) e collapse-btn
    const reservedWidth = (collapseBtn?.offsetWidth ?? 34) + 24; // 24px = margin spacer
    const overflow = [];

    // Força layout para medir scrollWidth real após restaurar todos os grupos
    requestAnimationFrame(() => {
        const overflowing = panel.scrollWidth > panelWidth + 2;

        if (!overflowing) {
            // Tudo cabe — mostrar apenas o trigger original do "Mais" (sem overflow indicator)
            if (moreTrigger) moreTrigger.dataset.overflow = 'false';
            return;
        }

        // Colapsar grupos da direita até caber
        for (const g of groups) {
            if (PINNED_GROUPS.has(g.id)) continue;
            if (panel.scrollWidth <= panelWidth + 2) break;

            // Clonar itens do grupo para o overflow dropdown
            const sectionLabel = document.createElement('div');
            sectionLabel.className = 'toolbar-dropdown-section-label';
            sectionLabel.textContent = g.querySelector('.toolbar-group-label')?.textContent?.trim() || '';
            overflowDd.appendChild(sectionLabel);

            // Clonar botões diretos do grupo (não os dropdowns internos)
            g.querySelectorAll(
                ':scope > .toolbar-btn:not(.toolbar-dropdown-trigger), :scope > .toolbar-split-btn',
            ).forEach((btn) => {
                const item = document.createElement('button');
                item.className = 'toolbar-dropdown-item';
                item.tabIndex = -1;
                item.setAttribute('role', 'menuitem');
                // Copiar onclick do botão original
                const origBtn = btn.classList.contains('toolbar-split-btn')
                    ? btn.querySelector('.toolbar-btn:not(.toolbar-dropdown-trigger)')
                    : btn;
                if (origBtn?.onclick) item.onclick = origBtn.onclick;
                else if (origBtn?.getAttribute('onclick'))
                    item.setAttribute('onclick', origBtn.getAttribute('onclick'));
                item.innerHTML = origBtn?.innerHTML || btn.innerHTML;
                overflowDd.appendChild(item);
            });

            // Clonar botões dropdown-trigger do grupo como items
            g.querySelectorAll(':scope > .toolbar-dropdown-trigger').forEach((trigger) => {
                const ddId = trigger.dataset.dropdown;
                const sourceDd = ddId ? document.getElementById(ddId) : null;
                if (!sourceDd) return;

                const sectionLabel2 = document.createElement('div');
                sectionLabel2.className = 'toolbar-dropdown-section-label';
                sectionLabel2.textContent = trigger.querySelector('span:not(.icon)')?.textContent?.trim() || '';
                overflowDd.appendChild(sectionLabel2);

                sourceDd.querySelectorAll('.toolbar-dropdown-item').forEach((item) => {
                    const clone = item.cloneNode(true);
                    clone.tabIndex = -1;
                    overflowDd.appendChild(clone);
                });
            });

            g.style.display = 'none';
            overflow.push(g.id);
        }

        // Mostrar indicador no botão "Mais" quando há overflow
        if (overflow.length > 0) {
            // Adicionar separador + itens do dd-more original ao overflow dropdown
            const sourceDdMore = document.getElementById('dd-more');
            if (sourceDdMore) {
                const sep = document.createElement('hr');
                sep.className = 'toolbar-dropdown-divider';
                overflowDd.appendChild(sep);
                sourceDdMore
                    .querySelectorAll(
                        '.toolbar-dropdown-item, .toolbar-dropdown-section-label, .toolbar-dropdown-divider',
                    )
                    .forEach((el) => {
                        overflowDd.appendChild(el.cloneNode(true));
                    });
            }
            // Trigger aponta para overflow dropdown
            if (moreTrigger) moreTrigger.dataset.dropdown = 'dd-overflow';
            if (moreTrigger) moreTrigger.dataset.overflow = 'true';
        } else {
            // Sem overflow — trigger aponta para dd-more normal
            if (moreTrigger) moreTrigger.dataset.dropdown = 'dd-more';
            if (moreTrigger) moreTrigger.dataset.overflow = 'false';
        }
    });
}

/**
 * Recalcula layout visual da ribbon (setas + overflow/"Mais").
 * Deve ser chamado sempre que a ribbon volta a ficar visivel apos estar oculta.
 */
export function refreshRibbonLayout() {
    updateScrollArrows();
    updateOverflow();
}

export function initRibbon() {
    const mainPanel = document.getElementById('ribbon-main');
    const editPanel = document.getElementById('ribbon-edit');

    if (mainPanel) {
        mainPanel.style.display = 'flex';
        mainPanel.dataset.active = 'true';
    }
    if (editPanel) {
        editPanel.style.display = 'none';
        editPanel.removeAttribute('data-active');
    }

    injectScrollArrows();
    initDropdowns();
    refreshLibGallery();
    window.refreshLibGallery = refreshLibGallery;
    window.addEventListener('librariesChanged', refreshLibGallery);

    document.querySelectorAll('.ribbon-panel').forEach((panel) => {
        panel.addEventListener('scroll', updateScrollArrows, { passive: true });
    });

    // Overflow inicial + ao redimensionar
    requestAnimationFrame(refreshRibbonLayout);

    window.addEventListener('resize', () => {
        refreshRibbonLayout();
        const openDd = document.querySelector('.toolbar-dropdown.open');
        if (openDd) {
            const trigger = document.querySelector(`[data-dropdown="${openDd.id}"]`);
            if (trigger) positionDropdown(openDd, trigger);
        }
    });
}
