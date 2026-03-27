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
   RESIZE HANDLES — Utilitario compartilhado de redimensionamento
   ================================================================

   Fornece funcoes reutilizaveis para adicionar comportamento de
   resize a qualquer elemento da UI (paineis, janelas, modais).

   FUNCOES EXPORTADAS:
   - attachResize(handle, config)         — Liga um handle a resize
   - addFloatingResizeHandles(el, config) — Injeta 8 handles em bordas/cantos

   PATTERN:
   mousedown no handle → cursor muda → mousemove atualiza dimensoes
   → mouseup limpa listeners e cursor.

   ================================================================ */

// Cursors por direcao de resize
const CURSORS = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
    sw: 'nesw-resize',
};

/**
 * Attach resize behavior to a handle element.
 *
 * @param {HTMLElement} handle - Elemento que o usuario arrasta
 * @param {Object} config
 * @param {HTMLElement} config.target - Elemento sendo redimensionado
 * @param {'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'} config.edge - Borda do handle
 * @param {number} [config.minWidth=100]
 * @param {number} [config.maxWidth=Infinity]
 * @param {number} [config.minHeight=50]
 * @param {number} [config.maxHeight=Infinity]
 * @param {Function} [config.onResize] - Callback durante resize ({width, height, left, top})
 * @param {Function} [config.onEnd] - Callback ao finalizar resize
 * @returns {Function} cleanup - Remove os listeners
 */
export function attachResize(handle, config) {
    const {
        target,
        edge,
        minWidth = 100,
        maxWidth = Infinity,
        minHeight = 50,
        maxHeight = Infinity,
        onResize,
        onEnd,
    } = config;

    const cursor = CURSORS[edge] || 'nwse-resize';
    handle.style.cursor = cursor;

    let startX, startY, startW, startH, startLeft, startTop;

    function onMouseDown(e) {
        if (e.button !== 0) return; // Apenas botao esquerdo
        e.preventDefault();
        e.stopPropagation();

        const rect = target.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startW = rect.width;
        startH = rect.height;
        startLeft = target.offsetLeft;
        startTop = target.offsetTop;

        document.body.style.cursor = cursor;
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newW = startW;
        let newH = startH;
        let newLeft = startLeft;
        let newTop = startTop;

        // Horizontal resize
        if (edge.includes('e')) {
            newW = Math.max(minWidth, Math.min(maxWidth, startW + dx));
        }
        if (edge.includes('w')) {
            const proposedW = startW - dx;
            newW = Math.max(minWidth, Math.min(maxWidth, proposedW));
            // Ajustar left para manter borda direita fixa
            newLeft = startLeft + (startW - newW);
        }

        // Vertical resize
        if (edge.includes('s')) {
            newH = Math.max(minHeight, Math.min(maxHeight, startH + dy));
        }
        if (edge === 'n' || edge === 'ne' || edge === 'nw') {
            const proposedH = startH - dy;
            newH = Math.max(minHeight, Math.min(maxHeight, proposedH));
            // Ajustar top para manter borda inferior fixa
            newTop = startTop + (startH - newH);
        }

        target.style.width = newW + 'px';
        target.style.height = newH + 'px';

        // Atualizar posicao apenas para bordas N/W (elemento move ao redimensionar)
        if (edge.includes('w') || edge === 'n' || edge === 'ne' || edge === 'nw') {
            if (edge.includes('w')) target.style.left = newLeft + 'px';
            if (edge === 'n' || edge === 'ne' || edge === 'nw') target.style.top = newTop + 'px';
        }

        if (onResize) onResize({ width: newW, height: newH, left: newLeft, top: newTop });
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (onEnd) onEnd();
    }

    // Touch support para tablet
    function onTouchStart(e) {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        onMouseDown({
            clientX: touch.clientX,
            clientY: touch.clientY,
            button: 0,
            preventDefault: () => e.preventDefault(),
            stopPropagation: () => e.stopPropagation(),
        });

        function onTouchMove(te) {
            if (te.touches.length !== 1) return;
            const t = te.touches[0];
            onMouseMove({ clientX: t.clientX, clientY: t.clientY });
        }
        function onTouchEnd() {
            onMouseUp();
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
        }
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
    }

    handle.addEventListener('mousedown', onMouseDown);
    handle.addEventListener('touchstart', onTouchStart, { passive: false });

    return function cleanup() {
        handle.removeEventListener('mousedown', onMouseDown);
        handle.removeEventListener('touchstart', onTouchStart);
    };
}

/**
 * Add edge and corner resize handles to a floating element.
 * Cria 8 divs invisiveis (n, s, e, w, ne, nw, se, sw) nas bordas e cantos.
 *
 * @param {HTMLElement} el - Elemento flutuante
 * @param {Object} config
 * @param {number} [config.minWidth=200]
 * @param {number} [config.maxWidth]
 * @param {number} [config.minHeight=150]
 * @param {number} [config.maxHeight]
 * @param {Function} [config.onEnd] - Callback ao finalizar qualquer resize
 * @returns {Function} cleanup - Remove todos os handles e listeners
 */
export function addFloatingResizeHandles(el, config = {}) {
    const {
        minWidth = 200,
        maxWidth = window.innerWidth - 40,
        minHeight = 150,
        maxHeight = window.innerHeight - 40,
        onEnd,
    } = config;

    // Garantir position relative para handles absolutos
    const computed = getComputedStyle(el);
    if (computed.position === 'static') {
        el.style.position = 'relative';
    }

    const handles = [];
    const cleanups = [];

    const edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

    for (const edge of edges) {
        const div = document.createElement('div');
        div.className = `float-resize float-resize--${edge}`;
        div.dataset.resizeEdge = edge;
        el.appendChild(div);
        handles.push(div);

        const cleanupFn = attachResize(div, {
            target: el,
            edge,
            minWidth,
            maxWidth,
            minHeight,
            maxHeight,
            onEnd,
        });
        cleanups.push(cleanupFn);
    }

    return function cleanup() {
        cleanups.forEach((fn) => fn());
        handles.forEach((h) => h.remove());
    };
}
