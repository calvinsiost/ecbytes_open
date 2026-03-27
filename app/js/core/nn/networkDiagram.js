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
   NETWORK DIAGRAM — Canvas 2D visualization of MLP architecture
   Diagrama visual da arquitetura da rede neural (Multi-Layer Perceptron)

   Mostra nos de entrada, ocultos (N camadas) e saida com conexoes
   cuja espessura/opacidade reflete magnitude dos pesos treinados.
   Suporta 1 a 5 hidden layers com layout dinamico de colunas.
   ================================================================ */

// ----------------------------------------------------------------
// THEME-AWARE COLORS — resolved at draw time from CSS variables
// ----------------------------------------------------------------

const COLORS = {
    input: '#3b82f6', // accent-blue
    hidden: '#94a3b8', // neutral-400
    output: '#22c55e', // accent-green
    posWeight: '#3b82f6', // blue for positive weights
    negWeight: '#ef4444', // red for negative weights
    untrained: 'rgba(150, 150, 150, 0.12)',
    text: '#64748b', // neutral-500
    labelText: '#334155', // neutral-700
};

// Hidden layer column colors (cycle through for visual distinction)
const HIDDEN_COLORS = [
    '#94a3b8', // neutral-400
    '#a78bfa', // violet-400
    '#f472b6', // pink-400
    '#fb923c', // orange-400
    '#34d399', // emerald-400
];

const MAX_VISIBLE_NODES = 8; // Limita nos visiveis por camada
const NODE_RADIUS = 10;
const LABEL_FONT = '10px monospace';
const LAYER_FONT = '9px sans-serif';

// ----------------------------------------------------------------
// MAIN DRAW FUNCTION
// ----------------------------------------------------------------

/**
 * Draw the neural network diagram on a canvas element.
 * Desenha o diagrama MLP no canvas com nos, conexoes e labels.
 * Suporta N hidden layers com layout dinamico.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} nn - SimpleNN instance (needs inputSize, hiddenLayerSizes, outputSize, _weights, trained)
 * @param {Object} [mapping] - { inputs: [{variableId}], outputs: [{variableId}] }
 */
export function drawNetworkDiagram(canvas, nn, mapping) {
    if (!canvas || !nn) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Set canvas size for crisp rendering
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;

    ctx.clearRect(0, 0, W, H);

    // Resolve theme colors from computed styles
    _resolveThemeColors(canvas);

    // Dynamic column layout: Input | H1 | H2 | ... | HN | Output
    const hiddenLayerSizes = nn.hiddenLayerSizes || [nn.hiddenSize];
    const numColumns = 2 + hiddenLayerSizes.length;

    // Reduce padding when many columns to avoid cramped layout
    const padding = {
        top: 20,
        bottom: 28,
        left: numColumns > 4 ? 50 : 80,
        right: numColumns > 4 ? 50 : 80,
    };

    const usableWidth = W - padding.left - padding.right;

    // Evenly space columns
    const layerX = [];
    for (let c = 0; c < numColumns; c++) {
        layerX.push(padding.left + (numColumns > 1 ? (usableWidth * c) / (numColumns - 1) : usableWidth / 2));
    }

    // Calculate node positions per layer
    const allLayerNodes = [];

    // Input layer
    allLayerNodes.push(_layoutNodes(layerX[0], padding.top, H - padding.bottom, nn.inputSize));

    // Hidden layers
    for (let h = 0; h < hiddenLayerSizes.length; h++) {
        const size = hiddenLayerSizes[h];
        const visibleCount = Math.min(size, MAX_VISIBLE_NODES);
        const truncated = size > MAX_VISIBLE_NODES;
        allLayerNodes.push(
            _layoutNodes(layerX[1 + h], padding.top, H - padding.bottom, visibleCount + (truncated ? 1 : 0)),
        );
    }

    // Output layer
    allLayerNodes.push(_layoutNodes(layerX[numColumns - 1], padding.top, H - padding.bottom, nn.outputSize));

    // 1. Draw connections between adjacent layers (behind nodes)
    _drawAllConnections(ctx, nn, allLayerNodes, hiddenLayerSizes);

    // 2. Draw nodes per layer
    // Input
    _drawNodes(ctx, allLayerNodes[0], COLORS.input);

    // Hidden layers (with distinct colors per layer)
    for (let h = 0; h < hiddenLayerSizes.length; h++) {
        const size = hiddenLayerSizes[h];
        const visibleCount = Math.min(size, MAX_VISIBLE_NODES);
        const truncated = size > MAX_VISIBLE_NODES;
        const color = HIDDEN_COLORS[h % HIDDEN_COLORS.length];
        _drawNodes(ctx, allLayerNodes[1 + h].slice(0, visibleCount), color);
        if (truncated) {
            _drawEllipsisNode(ctx, allLayerNodes[1 + h][visibleCount]);
        }
    }

    // Output
    _drawNodes(ctx, allLayerNodes[numColumns - 1], COLORS.output);

    // 3. Draw labels (variable names)
    _drawLabels(ctx, allLayerNodes[0], mapping?.inputs, 'left', W);
    _drawLabels(ctx, allLayerNodes[numColumns - 1], mapping?.outputs, 'right', W);

    // 4. Draw layer labels at bottom
    _drawLayerLabel(ctx, layerX[0], H - 6, `Input (${nn.inputSize})`);
    for (let h = 0; h < hiddenLayerSizes.length; h++) {
        const label =
            hiddenLayerSizes.length === 1 ? `Hidden (${hiddenLayerSizes[h]})` : `H${h + 1} (${hiddenLayerSizes[h]})`;
        _drawLayerLabel(ctx, layerX[1 + h], H - 6, label);
    }
    _drawLayerLabel(ctx, layerX[numColumns - 1], H - 6, `Output (${nn.outputSize})`);
}

// ----------------------------------------------------------------
// NODE LAYOUT — Calculate vertical positions per layer
// ----------------------------------------------------------------

function _layoutNodes(x, top, bottom, count) {
    const nodes = [];
    if (count <= 0) return nodes;
    if (count === 1) {
        nodes.push({ x, y: (top + bottom) / 2 });
        return nodes;
    }
    const spacing = (bottom - top) / (count - 1);
    for (let i = 0; i < count; i++) {
        nodes.push({ x, y: top + i * spacing });
    }
    return nodes;
}

// ----------------------------------------------------------------
// CONNECTION DRAWING — Lines between adjacent layers
// Desenha conexoes entre camadas adjacentes com peso codificado
// ----------------------------------------------------------------

function _drawAllConnections(ctx, nn, allLayerNodes, hiddenLayerSizes) {
    const trained = nn.trained;
    const numConnections = allLayerNodes.length - 1;

    for (let l = 0; l < numConnections; l++) {
        const fromNodes = allLayerNodes[l];
        const toNodes = allLayerNodes[l + 1];

        // Determine visible count for target layer
        let toVisibleCount;
        if (l < hiddenLayerSizes.length) {
            // Target is a hidden layer
            toVisibleCount = Math.min(hiddenLayerSizes[l], MAX_VISIBLE_NODES);
        } else {
            // Target is output layer
            toVisibleCount = toNodes.length;
        }

        // Determine visible count for source layer
        let fromVisibleCount;
        if (l === 0) {
            // Source is input layer
            fromVisibleCount = fromNodes.length;
        } else {
            // Source is a hidden layer
            fromVisibleCount = Math.min(hiddenLayerSizes[l - 1], MAX_VISIBLE_NODES);
        }

        // Get weight matrix for this connection
        const W_l = trained && nn._weights ? nn._weights[l] : null;

        for (let t = 0; t < toVisibleCount; t++) {
            for (let f = 0; f < fromVisibleCount; f++) {
                const weight = W_l ? (W_l[t]?.[f] ?? 0) : 0;
                _drawWeightLine(ctx, fromNodes[f], toNodes[t], weight, trained);
            }
        }
    }
}

function _drawWeightLine(ctx, from, to, weight, trained) {
    ctx.beginPath();
    ctx.moveTo(from.x + NODE_RADIUS, from.y);
    ctx.lineTo(to.x - NODE_RADIUS, to.y);

    if (!trained) {
        ctx.strokeStyle = COLORS.untrained;
        ctx.lineWidth = 0.5;
    } else {
        const absW = Math.min(Math.abs(weight), 2); // clamp for vis
        const opacity = 0.08 + absW * 0.25;
        const thickness = 0.5 + absW * 1.2;
        const color = weight >= 0 ? COLORS.posWeight : COLORS.negWeight;

        ctx.strokeStyle = _withOpacity(color, Math.min(opacity, 0.6));
        ctx.lineWidth = Math.min(thickness, 3);
    }

    ctx.stroke();
}

// ----------------------------------------------------------------
// NODE DRAWING — Circles with fill and subtle border
// ----------------------------------------------------------------

function _drawNodes(ctx, nodes, color) {
    for (const node of nodes) {
        // Glow effect (subtle)
        const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, NODE_RADIUS * 1.8);
        gradient.addColorStop(0, _withOpacity(color, 0.15));
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.fillRect(node.x - NODE_RADIUS * 2, node.y - NODE_RADIUS * 2, NODE_RADIUS * 4, NODE_RADIUS * 4);

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = _withOpacity(color, 0.2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

function _drawEllipsisNode(ctx, node) {
    if (!node) return;
    ctx.font = '14px sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('···', node.x, node.y);
}

// ----------------------------------------------------------------
// LABEL DRAWING — Variable names next to nodes
// ----------------------------------------------------------------

function _drawLabels(ctx, nodes, mappedVars, side, canvasWidth) {
    if (!mappedVars) return;

    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';

    for (let i = 0; i < nodes.length && i < mappedVars.length; i++) {
        const label = _truncate(mappedVars[i].variableId, 12);
        ctx.fillStyle = COLORS.labelText;

        if (side === 'left') {
            ctx.textAlign = 'right';
            ctx.fillText(label, nodes[i].x - NODE_RADIUS - 6, nodes[i].y);
        } else {
            ctx.textAlign = 'left';
            ctx.fillText(label, nodes[i].x + NODE_RADIUS + 6, nodes[i].y);
        }
    }
}

function _drawLayerLabel(ctx, x, y, text) {
    ctx.font = LAYER_FONT;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, x, y);
}

// ----------------------------------------------------------------
// UTILITIES
// ----------------------------------------------------------------

function _truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function _withOpacity(hexColor, opacity) {
    // Convert hex to rgba
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Resolve theme colors from CSS custom properties.
 * Falls back to hardcoded defaults if not available.
 */
function _resolveThemeColors(canvas) {
    try {
        const style = getComputedStyle(canvas);
        const resolve = (varName, fallback) => {
            const val = style.getPropertyValue(varName).trim();
            return val || fallback;
        };

        COLORS.input = resolve('--accent-blue', '#3b82f6');
        COLORS.output = resolve('--accent-green', '#22c55e');
        COLORS.posWeight = resolve('--accent-blue', '#3b82f6');
        COLORS.negWeight = resolve('--accent-red', '#ef4444');
        COLORS.labelText = resolve('--window-text', '#334155');
        COLORS.text = resolve('--neutral-500', '#64748b');
    } catch {
        /* ignore — use defaults */
    }
}
